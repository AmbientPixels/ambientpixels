# Heartbeat Model-Driven Cadence (Design Spec)

**Date:** 2026-06-12
**Status:** DESIGN — approved in brainstorm 2026-06-12, hardened after code review, not yet implemented
**Type:** Runtime gate in `companyHeartbeat` + read-only display in dashboard dev view
**Surfaces:** `api/companyHeartbeat/`, `modules/company/dashboard.html` (AI Model Fleet panel)

> Supersedes the earlier "cadence slider" framing. The brainstorm pivoted from a
> manual minutes slider to a model-driven cadence: run frequency is a *consequence*
> of the selected heartbeat model, not a separate knob. Rev 3 hardens the gate per
> a 2026-06-12 code review (see "History").

## Summary

The heartbeat's run frequency is automatically derived from the selected model. It
is a **cost-vs-quality lever**: cheap models run often, premium models run rarely,
to control spend. There is **no slider and no separate cadence setting** — the
existing model picker in the dashboard IS the control. Pick a model, the rhythm
follows.

The Azure timer fires at a fixed fine base tick (every 30 min). A **runtime gate**
at the top of the heartbeat reads the active model, looks up that model's cadence,
and skips the tick unless enough time has passed since the **last real run**
(read from the existing `heartbeatRuns` log — not a new timestamp). Manual triggers
bypass the gate. Nothing about cadence requires a redeploy to retune once shipped.

## Motivation

Per-run cost scales with `heartbeatModel`. When the fleet is on an expensive model
the CEO wants fewer runs; on a cheap model, more. Binding cadence to the model
choice makes the cost/quality tradeoff a single decision.

## Decisions (brainstorm + code review, 2026-06-12)

- **Model-driven, not a slider.** Cadence = lookup(active model). The dashboard
  model picker is the only control; a read-only line shows the resulting cadence.
- **Architecture: runtime gating** (over app-setting-cron and edit+redeploy). Live,
  no Azure credentials in the API, no redeploy to retune cadence.
- **Cost-true table** (pricier model = runs less often):

  | Model key       | Cadence (min) | ≈      | Runs/day |
  |-----------------|---------------|--------|----------|
  | `gemini`        | 60            | 1 h    | ~24      |
  | `claude-haiku`  | 150           | 2.5 h  | ~10      |
  | `claude-sonnet` | 330           | 5.5 h  | ~4       |

- **Last-run source = `heartbeatRuns`, not a new stamp.** Every real run (timer
  *and* manual) already appends `startedAt` to the bounded (≤100) `heartbeatRuns`
  log. The gate reads the last entry's `startedAt`. This means manual runs reset
  the cadence clock for free, and the heartbeat writes **nothing** to `systemConfig`
  for cadence — avoiding the read-modify-write race below. *(Fixes review #1 and #4.)*
- **Unknown model → slowest cadence, not fastest.** An unrecognized model key
  defaults to `max(table values)` (currently 330) plus a `context.log.warn`, never
  to 60. Safe direction for a spend lever. *(Fixes review #2.)*
- **Grace epsilon on the boundary.** The gate compares elapsed *time*, not ticks;
  timer jitter at the boundary would otherwise round cadence up by a full base tick
  (Sonnet 330→360). Run when `elapsed >= cadence − 60s`. 60s ≪ the 30-min base, so
  no earlier tick leaks through. *(Fixes review #3.)*
- **`cadence.js` is the source of truth** for the table. `systemConfig.modelCadence`
  is an *optional* override that is **never auto-seeded** (auto-seeding would
  reintroduce a `systemConfig` write/race). The dashboard label carries a mirror of
  the defaults for the cold path; `cadence.js` is canonical. *(Addresses review #5.)*
- **Base tick → 30 min**, one-time, same deploy. `function.json` changes from
  `0 0 * * * *` to `0 */30 * * * *` so 150 and 330 land on the dot. Net behaviour at
  60 is unchanged — extra ticks just skip.
- **Skips logged lightly** — a `context.log` line only, never a `heartbeatRuns`
  entry (it is a protected audit trail).
- **Dropped** from earlier revisions: the slider, the manual minutes value, "run
  once on apply," the separate `lastHeartbeatEffectiveRunAt` stamp, and the
  two-timeline staging.

## Architecture

### 1. Base timer change (one-time, same deploy)

`api/companyHeartbeat/function.json`:

```
"schedule": "0 0 * * * *"   →   "schedule": "0 */30 * * * *"
```

### 2. Cadence lookup (new `cadence.js`, pure + unit-testable)

```
DEFAULT_MODEL_CADENCE = { gemini: 60, 'claude-haiku': 150, 'claude-sonnet': 330 }
CADENCE_GRACE_MS = 60 * 1000
SLOWEST = Math.max(...Object.values(DEFAULT_MODEL_CADENCE))   // unknown-model default

getCadenceMinutes(modelKey, overrideTable) -> number
  // overrideTable = systemConfig.modelCadence (usually undefined)
  // returns overrideTable?.[modelKey] ?? DEFAULT_MODEL_CADENCE[modelKey] ?? SLOWEST
  // logs a warn when modelKey is unknown (falls through to SLOWEST)

shouldSkipForCadence(nowMs, lastRunMs, cadenceMinutes) -> boolean
  // lastRunMs null/0  => false  (first run / no history → run)
  // lastRunMs > nowMs => false  (clock skew → fail open, run)
  // else: skip when (nowMs - lastRunMs) < (cadenceMinutes*60000 - CADENCE_GRACE_MS)
```

No I/O; both functions are unit-tested in isolation.

### 3. Runtime gate (minimal touch in `index.js`)

`companyHeartbeat/index.js` exports a single function used by both the timer and the
manual trigger (`module.exports = async (context, req) => …`; the manual trigger
calls it with `req = null`). At the very top, before lock acquisition or any agent
work:

1. **Manual bypass:** if `req` is null/undefined → manual run → skip the gate
   entirely, proceed (subject only to the existing lock).
2. **Timer path:** read `heartbeatRuns` and `systemConfig` (for an optional
   `modelCadence` override) and the active `heartbeatModel`.
   - `lastRunMs = startedAt of heartbeatRuns[last]` (or null if empty/unparseable).
   - `cadence = getCadenceMinutes(heartbeatModel, modelCadence)`.
   - If `shouldSkipForCadence(now, lastRunMs, cadence)` → `context.log` a skip line
     and `return { skipped: true, reason: 'cadence' }` before the lock/body (no
     spend, no `heartbeatRuns` entry).
3. Otherwise fall through to the existing lock + run body unchanged. The body
   already appends to `heartbeatRuns` at the end, which serves as the next tick's
   last-run timestamp — **no new write is added.**

Kept to one `require` plus one guard block; the decision logic lives in `cadence.js`.

**Fail open:** any error reading `heartbeatRuns`/`systemConfig`/model must default to
running, never to skipping — a bad value must never silently freeze the fleet.

### 4. Storage (no new key, no new endpoint)

- **No new state.** Last-run time comes from the existing `heartbeatRuns` key.
- `systemConfig.modelCadence` — optional override only; absent by default; never
  written by the heartbeat. If ever exposed for tuning, it uses the existing
  `POST /api/company-state`.
- The heartbeat performs **zero** `systemConfig` writes for this feature, so it can
  never clobber a concurrent model-pill write.

### 5. Dashboard display — AI Model Fleet panel (dev view)

In `modules/company/dashboard.html`, in the existing model-picker / `#panel-fleet`
area (already dev-view gated):

- A read-only line under the active model pill:
  `{Model name} · runs every {≈cadence} (~{runsPerDay}/day)`,
  e.g. `Claude Haiku · runs every ~2.5 h (~10/day)`.
- Source: `systemConfig.modelCadence` if present, else a hardcoded **mirror** of
  `DEFAULT_MODEL_CADENCE` (3 entries; `cadence.js` is canonical — keep in sync),
  computed from the active key already tracked as `_activeModelKey`
  ([dashboard.html:2666](../../../modules/company/dashboard.html)).
- Updates when a different model pill is chosen (the picker already POSTs
  `heartbeatModel`; we recompute the label from the new key).
- Reuses existing fleet/panel CSS + theme tokens. New scoped `cadence-*` class. No
  `!important`, no raw hex.

## Data flow

```
CEO picks a model pill
  → existing flow: POST systemConfig.heartbeatModel = <key>   (client-side merge)
  → dashboard recomputes the cadence label from the table

Azure timer fires (every 30 min), req != null
  → index.js reads heartbeatRuns[last].startedAt (L), heartbeatModel (M), modelCadence (T)
  → cadence = getCadenceMinutes(M, T)
  → shouldSkipForCadence(now, L, cadence)?
        yes → context.log skip, return {skipped:'cadence'}   (no work, no spend, no run record)
        no  → lock + run body as normal → body appends to heartbeatRuns (= next L)

Manual trigger calls heartbeat(context, null)
  → gate bypassed → runs (subject to lock) → appends to heartbeatRuns (resets the clock)
```

## Testing

- Unit-test `getCadenceMinutes`: known keys → table values; unknown key → SLOWEST
  (+ warn); override beats default; missing override → defaults.
- Unit-test `shouldSkipForCadence`: null/empty history → run; just ran → skip;
  exactly at boundary → run; `cadence − 30s` elapsed → run (grace); `cadence − 5min`
  elapsed → skip; lastRun in the future → run (fail open).
- Manual verification: set model to Sonnet → gate skips ticks ~5.5 h, runs once at
  the boundary (not 6 h — confirms grace); switch to Gemini → runs next tick; fire a
  manual trigger mid-window → it runs and the *next* timer tick waits a fresh full
  cadence (confirms the clock reset via `heartbeatRuns`). Confirm skips never appear
  in `heartbeatRuns`. Confirm the dashboard label matches the active model.

## Success criteria

1. Run frequency matches the active model's cadence (60 / 150 / 330 min, within one
   base tick + grace).
2. Switching models changes the rhythm on the next tick, no redeploy.
3. A manual trigger runs immediately AND resets the cadence clock (no double-run on
   the following tick).
4. Skipped ticks do no agent work, cost nothing, and are not recorded in
   `heartbeatRuns`.
5. The heartbeat writes nothing to `systemConfig`, so model-pill writes can't be
   clobbered.
6. Dashboard shows the active model's cadence, read-only, and updates on switch.

## Risks / guardrails

- **Protected file:** `index.js` is "do not touch without explicit request." The
  change is one `require` + one guard block; logic is isolated in `cadence.js`. CEO
  go-ahead given in the 2026-06-12 brainstorm.
- **One deploy:** base-cron change, the gate, `cadence.js`, and the dashboard line
  ship together via CI/CD.
- **Fail open** on any error — never skip on uncertainty.
- **Failed runs burn a cadence window** *(by design):* a fatal run still appends to
  `heartbeatRuns`, so the next run waits a full cadence (a Sonnet error → ~5.5 h
  gap). The existing throughput-collapse alarm (Emergence Signal 6) is the backstop.
  Revisit only if it proves too coarse.
- **Sub-30-min cadence rounds up** to the 30-min base tick *(by design)* — the floor
  is the base tick; cadence cannot go finer.
- **Table mirror drift:** `cadence.js` and the dashboard fallback both carry the 3
  defaults; `cadence.js` is canonical. Static-site/Functions split makes a shared
  import impractical; keep the mirror in sync (documented here).

## History

- **Rev 1 (slider):** manual 30 min–24 h stepped slider writing
  `heartbeatCadenceMinutes`. Superseded.
- **Rev 2 (model-driven):** cadence bound to the model via a cost-true table; no
  slider. Used a `systemConfig.lastHeartbeatEffectiveRunAt` stamp.
- **Rev 3 (this doc, hardened after code review):** last-run read from
  `heartbeatRuns` instead of a stamp (fixes manual-run double-spend and the
  `systemConfig` race together); unknown model defaults slow; 60s grace epsilon on
  the boundary; `cadence.js` named source of truth.
