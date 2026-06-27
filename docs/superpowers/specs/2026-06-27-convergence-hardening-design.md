# Convergence Hardening — Design

**Date:** 2026-06-27
**Status:** Approved (design)
**Area:** Heartbeat — task convergence / revision-loop handling
**Files:** `api/companyHeartbeat/constants.js`, `api/companyHeartbeat/agent-runner.js`, `api/companyHeartbeat/execution-engine.js`

## Problem

Vague, low-stakes tasks (the trigger case was an auto-created `design_asset` "Design Coverage: Re-activate AmbientScore + Blindspot" covering 6 products) draw an unbounded multi-agent revision pile-on, hit the convergence lock, then spam the task forever until a human deletes it.

Observed on `task-1782352800875-prgb`: 54 comments, 0 net-accepted deliverable, `critical` priority, status stuck in `review`. The assignee (Pixel) produced a deliverable; seven different agents (Forge, Scribe, Quill, Cipher, Echo, Scout, Nova) layered critique — Forge even demanded "production-ops metadata" on a design asset — so Pixel re-drafted repeatedly. At 5 deliverables the convergence guard locked it, and every subsequent heartbeat re-posted `[SYSTEM] Review blocked: task is convergence-locked…`. The CEO had to delete it by hand.

### Two distinct defects

1. **Cause — the pile-on.** Nothing scopes *who* meaningfully reviews or *what counts as done*. Critiques arrive via `comment-task` (ungated by domain), driving redrafts until the deliverable count burns to the threshold.
2. **Symptom — infinite spam + manual cleanup.** The review-block dedup is buggy: `agent-runner.js:3582` checks whether the last system comment contains `"Review loop"`, but the message it posts says `"Review blocked: task is convergence-locked"`. The strings never match, so the dedup never fires → the message re-posts every cycle, and the only exit is a human closing the task.

### Current mechanism (as built)

- The convergence threshold `5` is hardcoded in **four** places: execute-task guard (`agent-runner.js` ~1757), review-task guard (~3580), review-stuck escalation scan (~1094), and the peer-review-injection exclusion (~1045).
- A `type: 'deliverable'` comment is the unit counted.
- At `>= 5`: task moves to `review`, a `convergence_escalation` entry is pushed to `approvalQueue` (Needs Attention panel), and it waits for the CEO indefinitely.

## Approach (chosen: "Converge by accepting, with lane discipline")

Core insight: for low-stakes **internal** deliverables, the right answer at N drafts is "ship the best one," not "halt forever." For **public-facing** deliverables (which already require CEO sign-off before going out), keep escalation but make it self-clearing.

### 1. Threshold as a constant with per-type overrides — `constants.js`

```js
const CONVERGENCE_THRESHOLD = 5;                       // default
const CONVERGENCE_THRESHOLD_BY_TYPE = { design_asset: 3 };
const CONVERGENCE_AUTO_ACCEPT_TYPES = new Set(['design_asset', 'internal_doc', 'research', 'general']);
const CONVERGENCE_GRACE_HOURS = 48;
function convergenceThresholdFor(taskType) {
  return CONVERGENCE_THRESHOLD_BY_TYPE[String(taskType || '').toLowerCase()] || CONVERGENCE_THRESHOLD;
}
```

All four hardcoded `5`s are replaced with `convergenceThresholdFor(task.taskType)`.

### 2. Pure decision function — the testable core

`classifyConvergence(task, nowMs)` → `{ action, reason, threshold, deliverableCount }`, where `action` ∈:

- `none` — deliverable count below threshold.
- `auto-accept` — at/over threshold AND `taskType ∈ CONVERGENCE_AUTO_ACCEPT_TYPES`.
- `escalate` — at/over threshold AND externally-gated type (anything not in the auto-accept set, e.g. `social_*`, `blog_post`) AND not already escalated.
- `grace-close` — externally-gated task already escalated (`_convergenceState.escalatedAt`) whose escalation is older than `CONVERGENCE_GRACE_HOURS` and still unresolved.

The function reads `task.comments` (deliverable count), `task.taskType`, and `task._convergenceState`. No IO. This is where the unit tests live.

### 3. Auto-accept for internal tasks — `agent-runner.js` triage (~909 / ~1085)

On `auto-accept`:
- Mark the task `done`, keeping the latest deliverable.
- Post **one** system comment: `Converged: auto-accepted latest of N drafts (internal task, no external gate).`
- Resolve any open `convergence_escalation` for the task in `approvalQueue`.
- Emit governance event `convergence-auto-accept`.
- No new escalation, no lock, no manual delete.

### 4. Grace auto-close for public-facing tasks — `agent-runner.js` triage

Externally-gated tasks still escalate to the CEO as today. On `grace-close` (escalated, 48h elapsed, still unresolved):
- Mark the task **`canceled`** — public content that never converged and was never CEO-reviewed must not auto-ship. (CEO can re-create if it mattered.)
- Post one system comment noting the grace cancellation.
- Resolve the `convergence_escalation`.
- Emit governance event `convergence-grace-close`.

This mirrors the existing 48h auto-publish-grace posture, but in the safe direction (cancel, not ship).

### 5. Dedup via a structural flag — kills the 54-comment spam at the root

Replace all brittle substring checks with a structural marker set when the system first acts on convergence:

```js
task._convergenceState = { notified: true, escalatedAt: <iso|null>, deliverableCount: <n> };
```

Every guard site (execute ~1757, review ~3580, review-stuck ~1094) checks `task._convergenceState?.notified` before posting a comment. One comment, ever. `escalatedAt` is set only on the `escalate` path and drives the grace window.

### 6. Lane-disciplined review prompt — `execution-engine.js` reviewTask (~278–301)

Add to the reviewer instructions:
- Judge **only within your domain**. A `design_asset` is graded on visual/brand quality; an `internal_doc` on clarity/accuracy — not on ops, finance, or SEO concerns outside your role.
- Out-of-scope concerns are **not** grounds for rejection.
- If the deliverable is **adequate for its stated purpose, APPROVE.** Perfection is not the bar.

Soft (prompt-level) reinforcement of the deterministic threshold; reduces the scope-creep critiques that drove the redrafts.

## Data flow

```
execute-task / review-task / triage scan
        │
        ▼
classifyConvergence(task, nowMs)  ── pure ──▶ { action }
        │
   ┌────┼─────────────┬──────────────┐
 none  auto-accept   escalate      grace-close
  │      │             │               │
 no-op  done +        review +        canceled +
        accept note   escalation +    note + resolve
        + resolve     _convergenceState  escalation +
        escalation    {escalatedAt}   gov event
        + gov event   + one comment
```

## Error handling

- All `approvalQueue` / `governanceLog` writes stay in `try/catch` (non-fatal), matching existing convergence-escalation code.
- `classifyConvergence` is defensive: missing `comments`, missing `taskType`, missing `_convergenceState` all resolve to safe defaults (`none` / default threshold).
- Grace-close requires a valid `escalatedAt`; absent or unparseable timestamps never trigger a close (fail safe = keep waiting).

## Testing

Unit tests (pure, no IO) for:
- `convergenceThresholdFor`: `design_asset` → 3, unknown/absent → 5.
- `classifyConvergence`:
  - design_asset with 3 deliverables → `auto-accept`
  - internal_doc with 5 deliverables → `auto-accept`
  - social_x with 5 deliverables, not yet escalated → `escalate`
  - social_x escalated 49h ago, unresolved → `grace-close`
  - social_x escalated 10h ago → `none` (still waiting)
  - any task already `notified` → no duplicate comment (covered by guard-site check; assert via flag)
  - task under threshold → `none`

## Scope / blast radius

Bounded to `constants.js`, `agent-runner.js`, `execution-engine.js`. `agent-runner.js` is the fragile heartbeat engine; changes are additive guards + a new pure helper + replacing magic numbers + one new triage branch. The intentional behavior changes are: internal tasks auto-accept at threshold; public tasks auto-cancel 48h after escalation. No task-lifecycle restructuring, no changes to `index.js` / `company-state` / `staticwebapp.config.json`.

## Out of scope (YAGNI)

- Single-designated-reviewer-per-task (Approach B) — larger lifecycle change, deferred.
- Gating `comment-task` by domain — the lane-disciplined review prompt covers the practical case without new gates.
- Configurable grace hours / thresholds via dashboard — constants are CEO-editable in code; no UI needed yet.
