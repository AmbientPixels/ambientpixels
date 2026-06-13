# Heartbeat Model-Driven Cadence (Design Spec)

**Date:** 2026-06-12
**Status:** DESIGN — approved in brainstorm 2026-06-12, not yet implemented
**Type:** Runtime gate in `companyHeartbeat` + read-only display in dashboard dev view
**Surfaces:** `api/companyHeartbeat/`, `modules/company/dashboard.html` (AI Model Fleet panel)

> Supersedes the earlier "cadence slider" framing in this file's first revision.
> The brainstorm pivoted from a manual minutes slider to a model-driven cadence:
> the run frequency is a *consequence* of the selected heartbeat model, not a
> separate knob. See "History" at the bottom.

## Summary

The heartbeat's run frequency is automatically derived from the selected model. It
is a **cost-vs-quality lever**: cheap models run often, premium models run rarely,
to control spend. There is **no slider and no separate cadence setting** — the
existing model picker in the dashboard IS the control. Pick a model, the rhythm
follows.

The Azure timer fires at a fixed fine base tick (every 30 min). A **runtime gate**
at the top of the heartbeat reads the active model, looks up that model's cadence,
and skips the tick unless enough time has passed since the last real run. Nothing
about cadence requires a redeploy to change once shipped — the lookup table lives
in `systemConfig`.

## Motivation

Per-run cost scales with `heartbeatModel`. When the fleet is on an expensive model
the CEO wants fewer runs; on a cheap model, more. Rather than manage a second knob,
cadence is bound to the model choice so the cost/quality tradeoff is a single
decision.

## Decisions (from brainstorm 2026-06-12)

- **Model-driven, not a slider.** Cadence = lookup(active model). The dashboard
  model picker is the only control; a read-only line shows the resulting cadence.
- **Architecture: runtime gating** (chosen over app-setting-cron and edit+redeploy).
  Live, no Azure credentials in the API, no redeploy to retune cadence.
- **Cost-true table** (pricier model = runs less often):

  | Model key       | Cadence (min) | ≈      | Runs/day |
  |-----------------|---------------|--------|----------|
  | `gemini`        | 60            | 1 h    | ~24      |
  | `claude-haiku`  | 150           | 2.5 h  | ~10      |
  | `claude-sonnet` | 330           | 5.5 h  | ~4       |

- **Table stored in `systemConfig.modelCadence`**, seeded with the defaults above.
  The gate and the dashboard both read it; if absent, both fall back to hardcoded
  defaults. Numbers are tunable later with no deploy (same pattern as
  `heartbeatModel`).
- **Base tick → 30 min**, one-time, in the same deploy as the gate. `function.json`
  changes from `0 0 * * * *` to `0 */30 * * * *` so 150 and 330 land precisely
  (both divide by 30). Net behaviour at 60 is unchanged — extra ticks just skip.
- **Skips are logged lightly** — a `context.log` line only, never a `heartbeatRuns`
  entry. `heartbeatRuns` is a protected audit trail and must not be polluted with
  skip records.
- **Evaluated against the current model each tick** — switching to a cheaper model
  speeds the fleet up on the next tick; switching to a premium model stretches the
  gap. No "apply" action needed; changing the model pill is the action.
- **Dropped** from the earlier revision: the slider, the manual minutes value,
  "run once on apply," and the two-timeline staging (it is now one deploy).

## Architecture

### 1. Base timer change (one-time, same deploy)

`api/companyHeartbeat/function.json`:

```
"schedule": "0 0 * * * *"   →   "schedule": "0 */30 * * * *"
```

The stale `// every 30 minutes` comment atop `index.js` becomes accurate again.

### 2. Cadence lookup

**New tiny module/helper** (e.g. `cadence.js` in `companyHeartbeat/`, or an export
in `helpers.js`):

```
DEFAULT_MODEL_CADENCE = { gemini: 60, 'claude-haiku': 150, 'claude-sonnet': 330 }
DEFAULT_CADENCE_MINUTES = 60   // unknown model → hourly

getCadenceMinutes(modelKey, modelCadenceConfig) -> number
  // modelCadenceConfig = systemConfig.modelCadence (may be undefined)
  // returns config[modelKey] ?? DEFAULT_MODEL_CADENCE[modelKey] ?? DEFAULT_CADENCE_MINUTES

shouldSkipForCadence(nowMs, lastRunMs, cadenceMinutes) -> boolean
  // true => skip (not enough elapsed). lastRunMs null/0 => never skip (first run).
  // lastRunMs in the future (clock skew) => never skip (fail open).
```

Both functions are pure and unit-testable with no I/O.

### 3. Runtime gate (minimal touch in `index.js`)

At the very top of the **timer** handler, before any agent work:

1. Read `systemConfig` once (active `heartbeatModel`, `modelCadence`,
   `lastHeartbeatEffectiveRunAt`).
2. `cadence = getCadenceMinutes(heartbeatModel, modelCadence)`.
3. If `shouldSkipForCadence(now, lastEffectiveRun, cadence)` → `context.log` a skip
   line and `return` before running agents (no spend, no `heartbeatRuns` entry).
4. Else stamp `lastHeartbeatEffectiveRunAt = now` (at run **start**, to prevent
   pile-ups if a run errors), then proceed as normal.

Kept to one `require` plus one guard block; the decision logic lives in the
testable helper. The manual `company-heartbeat-trigger` path does **not** call the
gate — manual runs always execute.

**Fail open:** any error reading config/timestamp must default to running, never to
skipping — a bad value must never silently freeze the fleet.

### 4. Storage (no new endpoint)

- `systemConfig.modelCadence` — the table (seeded once; gate falls back to defaults
  if missing).
- `systemConfig.lastHeartbeatEffectiveRunAt` — written by the heartbeat at run start.
- Both read via existing `GET /api/company-state?key=systemConfig`; cadence table
  edits (if ever exposed) use existing `POST /api/company-state` (merge). No new
  Azure Function.

### 5. Dashboard display — AI Model Fleet panel (dev view)

In `modules/company/dashboard.html`, in the existing model-picker / `#panel-fleet`
area (already dev-view gated):

- A read-only line under the active model pill:
  `{Model name} · runs every {≈cadence} (~{runsPerDay}/day)`,
  e.g. `Claude Haiku · runs every ~2.5 h (~10/day)`.
- Source: read `systemConfig.modelCadence` (fallback to a hardcoded copy of the
  defaults — 3 entries) and compute from the active model key already tracked as
  `_activeModelKey` ([dashboard.html:2666](../../../modules/company/dashboard.html)).
- Updates when a different model pill is chosen (the picker already POSTs
  `heartbeatModel`; we just recompute the label from the new key).
- Reuses existing fleet/panel CSS + theme tokens. New scoped `cadence-*` class. No
  `!important`, no raw hex.

## Data flow

```
CEO picks a model pill
  → existing flow: POST systemConfig.heartbeatModel = <key>   (merge)
  → dashboard recomputes the cadence label from the table

Azure timer fires (every 30 min)
  → index.js reads systemConfig: heartbeatModel (M), modelCadence (T), lastEffectiveRun (L)
  → cadence = getCadenceMinutes(M, T)
  → shouldSkipForCadence(now, L, cadence)?
        yes → context.log skip, return   (no agent work, no spend, no run record)
        no  → stamp lastEffectiveRun = now, run fleet as normal

Manual trigger → runs unconditionally (gate not consulted)
```

## Testing

- Unit-test `getCadenceMinutes`: known keys → table values; unknown key → 60;
  config override beats default; missing config → defaults.
- Unit-test `shouldSkipForCadence`: first run (null) → run; just ran → skip;
  exactly at boundary → run; well past → run; lastRun in the future → run (fail open).
- Manual verification: set model to Claude Sonnet → confirm gate skips ticks for
  ~5.5 h and runs once at the boundary; switch to Gemini → confirm it runs on the
  next tick. Confirm skips do **not** appear in `heartbeatRuns`. Confirm manual
  trigger still runs during a skip window. Confirm dashboard label matches the
  active model.

## Success criteria

1. Heartbeat run frequency matches the active model's cadence (60 / 150 / 330 min).
2. Switching models changes the rhythm on the next tick, no redeploy.
3. Skipped ticks do no agent work, cost nothing, and are not recorded in
   `heartbeatRuns`.
4. Manual trigger always runs regardless of the gate.
5. Dashboard shows the active model's cadence, read-only, and updates on switch.

## Risks / guardrails

- **Protected file:** `index.js` is "do not touch without explicit request." The
  change is one `require` + one guard block; logic is isolated in a testable helper.
  CEO go-ahead given in the 2026-06-12 brainstorm.
- **One deploy:** dropping the base cron to 30 min, the gate, the helper, and the
  dashboard line all ship together via CI/CD.
- **Fail open** on any config/timestamp error — never skip on uncertainty.
- **Floor is 30 min** by design; cadence cannot go finer than the base tick.
- **Extra ticks are cheap:** at a 30-min base the timer fires 48×/day; skipped ticks
  early-return after two state reads — negligible cost/load.

## History

- **Rev 1 (slider):** a manual 30 min–24 h stepped slider writing
  `heartbeatCadenceMinutes`. Superseded — replaced by binding cadence to the model
  so there is one decision (quality vs cost) instead of two knobs.
- **Rev 2 (this doc):** model-driven cadence, cost-true table, no slider.
