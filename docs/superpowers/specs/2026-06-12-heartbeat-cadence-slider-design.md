# Heartbeat Cadence Slider (Design Spec)

**Date:** 2026-06-12
**Status:** DESIGN — approved in brainstorm 2026-06-12, not yet implemented
**Type:** Dashboard control (dev view) + runtime gate in `companyHeartbeat`
**Surfaces:** `modules/company/dashboard.html` (AI Model Fleet panel), `api/companyHeartbeat/`

## Summary

A live, CEO-adjustable slider that throttles how often the agent fleet actually
does work. It is a **cost lever**: slow the heartbeat down when running expensive
models (e.g. Claude Opus), speed it up on cheap ones. Cadence is changed from the
dashboard with no redeploy.

The Azure timer cannot be reprogrammed from the browser — its schedule is a fixed
cron in `api/companyHeartbeat/function.json`. So the slider does not change the
timer. Instead, the timer fires at a fixed fine base tick (every 30 min) and a
**runtime gate** at the top of the heartbeat handler skips ticks until the chosen
cadence has elapsed. The slider just writes a single number to state.

## Motivation

The fleet's per-run cost varies with `heartbeatModel`. When the fleet is on a
high-cost model, the CEO wants to reduce run frequency to control spend; on a
cheap model, run more often. Today cadence is hard-coded in the deployed cron and
can only be changed by editing `function.json` and redeploying. This makes the
lever live and self-serve.

## Decisions (from brainstorm 2026-06-12)

- **Architecture: runtime gating** (chosen over app-setting-cron and edit+redeploy).
  Fully live, no Azure credentials in the API, no redeploy to change cadence. The
  only cost is that the gate can only make cadence **coarser** than the base tick.
- **Base tick → 30 min**, one-time deploy. `function.json` schedule changes from
  `0 0 * * * *` (hourly) to `0 */30 * * * *` (every 30 min) so 30 min is the
  finest cadence the gate can deliver. Net behaviour is unchanged when cadence is
  set to 60 — the extra ticks are simply skipped.
- **Range: 30 min – 24 h, mixed steps** — `[30, 60, 90, 120, 150, 180, 210, 240,
  360, 480, 720, 1440]`. 30-min steps up to 4 h, then coarse jumps for a near-idle
  "once a day" mode on costly models.
- **Apply on release** — dragging and releasing the slider POSTs the new value and
  shows a toast. No separate Save/Confirm button (it is dev-view / CEO-only).
- **Manual trigger bypasses the gate** — `company-heartbeat-trigger` always runs a
  cycle. The gate applies only to timer-driven runs.
- **Readout = runs/day + current model** — the slider shows e.g. "Every 90 min ·
  16 runs/day" plus the current `heartbeatModel` name, so the cost tradeoff is
  visible while dragging. A `$/day` estimate is explicitly deferred (YAGNI).

## Architecture

### 1. Base timer change (one-time deploy)

`api/companyHeartbeat/function.json`:

```
"schedule": "0 0 * * * *"   →   "schedule": "0 */30 * * * *"
```

The stale `// every 30 minutes` comment at the top of `index.js` becomes accurate
again as a side effect.

### 2. Runtime gate

**New pure helper in `helpers.js`** (unit-testable in isolation, no I/O):

```
shouldSkipForCadence(nowMs, lastRunMs, cadenceMinutes) -> boolean
// true  => skip this tick (not enough time elapsed)
// false => run (or lastRunMs is null/0 — first run always proceeds)
```

**Minimal touch in `index.js`** — at the very top of the timer handler, before any
agent work:

1. Read `heartbeatCadenceMinutes` from `systemConfig` (default 60).
2. Read the last *effective* run timestamp (`lastHeartbeatEffectiveRunAt`).
3. If `shouldSkipForCadence(...)` is true: write a lightweight skip entry to the
   run log (`{ skipped: true, reason: 'cadence-gate', cadenceMinutes }`) and
   `return` before running agents.
4. Otherwise stamp `lastHeartbeatEffectiveRunAt = now` at run **start** (not
   success — measuring from start prevents pile-ups if a run errors), then proceed.

This keeps the protected-file change to one `require` plus one guard block. The
gate decision lives in the testable helper, not in `index.js`.

The gate is wired only into the **timer** entry path. The manual
`company-heartbeat-trigger` path does not call it.

### 3. Storage + API (no new endpoint)

- `heartbeatCadenceMinutes` is stored in `systemConfig` (merging write — safe).
- `lastHeartbeatEffectiveRunAt` is stored in `systemConfig` (or a sibling small
  key) and written by the heartbeat itself.
- The dashboard reads both via existing `GET /api/company-state?key=systemConfig`
  and writes the cadence via existing `POST /api/company-state` (merge). No new
  Azure Function.

### 4. Dashboard UI — AI Model Fleet panel (dev view)

In `modules/company/dashboard.html`, inside the existing `#panel-fleet` /
`AI Model Fleet` panel (dev view, already gated):

- A stepped `<input type="range">` indexing into the step array
  `[30,60,90,120,150,180,210,240,360,480,720,1440]` (slider value = array index;
  the label maps index → minutes so steps feel even).
- Live readout: `Every {label} · {runsPerDay} runs/day` where
  `runsPerDay = Math.round(1440 / minutes)` (label uses "h" formatting above 60).
- Current model line pulled from the fleet data already rendered in `renderFleet()`
  (`AgentEngine.getModelFleet()` — primary model name).
- On `change` (release): POST `{ heartbeatCadenceMinutes: minutes }` merged into
  `systemConfig`, optimistic UI update, toast `Cadence set to {label}`.
- On load: read `systemConfig.heartbeatCadenceMinutes` and set the slider to the
  matching index (default 60 → index 1).
- Reuses existing dashboard panel + fleet CSS and theme tokens. New scoped class
  `cadence-*`. No `!important`, no raw hex.

## Data flow

```
CEO drags slider (release)
  → POST /api/company-state  systemConfig.heartbeatCadenceMinutes = N   (merge)
  → toast

Azure timer fires (every 30 min)
  → index.js reads systemConfig.heartbeatCadenceMinutes (N) + lastHeartbeatEffectiveRunAt (T)
  → shouldSkipForCadence(now, T, N)?
      yes → log skip, return  (no agent work, no spend)
      no  → stamp lastHeartbeatEffectiveRunAt = now, run fleet as normal

Manual trigger → runs unconditionally (gate not consulted)
```

## Testing

- Unit-test `shouldSkipForCadence(now, lastRun, cadence)` in isolation:
  null/first-run → run; just-ran → skip; exactly at boundary → run; well past →
  run; clock skew / lastRun in future → run (fail open, never wedge the fleet).
- Manual verification: set cadence to 120 in dashboard → confirm `systemConfig`
  holds 120 → confirm timer ticks inside the window log a skip and one runs at the
  boundary → reload dashboard, slider shows 120.
- Verify manual trigger still runs while a gate window is open.

## Success criteria

1. Slider in the AI Model Fleet panel shows the saved cadence on load.
2. Dragging to a new step writes `systemConfig.heartbeatCadenceMinutes` and toasts.
3. Timer ticks inside the cadence window are skipped and logged; one effective run
   happens per window.
4. Manual trigger always runs regardless of the gate.
5. No redeploy needed to change cadence after the one-time base-cron deploy.

## Risks / guardrails

- **Protected file:** `index.js` is on the "do not touch without explicit request"
  list. The change is deliberately minimal (one require + one guard block) and the
  logic is isolated in a testable helper. Implementation requires the CEO's
  explicit go-ahead (given in the 2026-06-12 brainstorm).
- **One-time deploy required:** dropping the base cron to 30 min is a deploy via
  CI/CD. Until that deploy lands, the gate can only deliver hourly-or-coarser even
  if the slider shows 30.
- **Fail open:** any error reading cadence/last-run must default to running, never
  to skipping — a bad config value must not silently freeze the fleet.
- **Cannot go finer than the base tick** by design. 30 min is the floor.
```
