# Dynamic Agentic Proposal Generation — Design

**Date:** 2026-06-20
**Status:** Approved (design), pending implementation plan
**Related:** [2026-06-20-deterministic-proposal-generator-design.md](2026-06-20-deterministic-proposal-generator-design.md) (the cron this builds on)

## Problem

The fleet's agents see rich, real-time data every heartbeat — finance/runway (Cipher),
research demand (Scout), social analytics (Echo), ops health (Forge), the shared World
State (all of them) — but they **never propose new campaigns or objectives** off it.
Confirmed: zero `propose-campaign` / `propose-objective` emissions in 30+ days on both
Gemini and Claude.

The deterministic `proposalGeneratorCron` (shipped 2026-06-20) keeps the floor filled but
its output is generic ("Establish a measurable growth objective") — it reacts to structural
gaps, not insight. We want agents to propose strategic work grounded in the data they
already hold, while keeping the cron as a reliability backstop.

## Root cause (verified in code)

The agentic path is ~90% built; one allowlist gap disables it:

1. **The handlers exist and are correct.** [`agent-runner.js`](../../../api/companyHeartbeat/agent-runner.js)
   has a full `propose-campaign` handler (~line 4988: builds a `campaign_proposal` with
   name/platforms/cadence/KPI/north-star check/dedup/1-per-day limit, writes to
   `approvalQueue`) and a `propose-objective` handler (~line 5045).
2. **The normalizer drops the action before the handler runs.**
   [`constants.js`](../../../api/companyHeartbeat/constants.js) `KNOWN_ACTION_TYPES` lists
   `propose-product`, `propose-hire-agent`, etc. but **not** `propose-campaign` /
   `propose-objective`. So [`normalization.js:98-102`](../../../api/companyHeartbeat/normalization.js)
   sends the action to the `else` branch → `[unknown-action-type]` observation → discarded.
   The handler is reachable code that is never reached.
3. **The alternate `proposals:[]` envelope is also dead.** Those land in `result.proposals`,
   which [`index.js:1936`](../../../api/companyHeartbeat/index.js) only turns into display
   breadcrumbs; nothing writes them to `approvalQueue`, and `_normalizeProposal` would coerce
   them into a generic task-improvement shape, not a campaign/objective.

So the cron was a workaround for a 2-line allowlist gap. Opening the route + prompting the
agents to use it is the real fix.

## Decisions (from brainstorming)

1. **Both — cron as safety net.** Agentic proposals are primary; the cron self-silences when
   agents are productive and fills genuine floor gaps. Chosen for graceful degradation across
   models (Sonnet → agents do rich work; Haiku/Gemini → cron keeps the floor).
2. **All strategic agents propose:** Nova, Echo, Scout, Cipher, Pixel, Forge (Quill excluded —
   editor). Domain emerges from trigger conditions, not hard type restrictions.
3. **Fleet cap + condition-gated.** Hard fleet-wide daily cap (2 campaign + 2 objective from
   agents), best-first by severity, and agents only propose when a real data trigger fires.
4. **Flag, don't block.** Weakly-grounded proposals (no trigger / no valid north-star) still
   reach the queue with a warning badge. CEO stays the gate. Matches graduated-autonomy
   precedent.

## Architecture

### Components & data flow

```
heartbeat cycle
  └─ per agent (nova, cipher, pixel, forge, scribe, quill, echo, scout)
       ├─ prompt-builders injects: action schema + agent-specific TRIGGER block   [§3]
       ├─ model emits propose-campaign / propose-objective action (if trigger true)
       ├─ normalization keeps it (now in KNOWN_ACTION_TYPES)                       [§1]
       └─ handler: authorize → validate → score severity → STAGE to buffer        [§2,§4]
  └─ post-agent-loop step (index.js, additive, like pace-tracker):
       ├─ read runtimeMemory.pendingAgentProposals
       ├─ select top 2 campaign + top 2 objective by severity                      [§4]
       ├─ write selected to approvalQueue (flag weak grounding)                    [§4]
       └─ log/clear the rest (deferred)
  └─ proposalGeneratorCron (every 6h, unchanged cadence):
       └─ computeProposals defers to recent agent proposals when checking floors   [§5]

CEO reviews on Actions page → approve → existing approveProposal side-effects create
the real campaign / objective. Nothing auto-executes.
```

### §1 — Open the route
- Add `'propose-campaign'`, `'propose-objective'` to `KNOWN_ACTION_TYPES` in `constants.js`.

### §2 — Authorization
- Add `PROPOSAL_AUTHORIZED_AGENTS = new Set(['nova','echo','scout','cipher','pixel','forge'])`
  to `constants.js`.
- Both handlers reject agents not in the set (log + `continue`). No per-agent type lock —
  the trigger taxonomy shapes domain.

### §3 — Trigger taxonomy (condition-gating)
Each authorized agent gets a prompt block: *"Propose only when one of these is true in your
data, and cite the specific number/signal in `rationale`."*

| Agent | Type(s) | Trigger condition (must cite) |
|---|---|---|
| Nova | objective + campaign | active objectives or campaigns below floor (3); or a live product with no active campaign |
| Cipher | objective | runway < 30d, OR system budget RED, OR an agent RED on cost → cost/efficiency objective |
| Scout | campaign | a research signal shows demand for a product that has no active campaign |
| Echo | campaign | a platform DECLINING (WoW), OR a campaign ≥2wk behind pace → corrective campaign/experiment |
| Forge | objective | a recurring incident pattern (3+ same `ops_breakfix`) → reliability objective |
| Pixel | campaign | a product with a design-asset gap AND real page traffic (most conservative) |

The cited trigger text is stored in the proposal `rationale`. The post-loop step inspects
`rationale` for a recognizable trigger reference + a valid `northStarMetric`; if either is
missing, it stamps a `strategyFlag` (e.g. `no-data-trigger`, `no-north-star-metric`) — it
does **not** drop the proposal.

### §4 — Staging buffer + best-first selection
- Handlers no longer write to `approvalQueue` directly. They append a candidate to
  `runtimeMemory.pendingAgentProposals` (per-cycle list), each carrying:
  `{ type, proposedBy, payload (the built campaign/objective entry), severity, trigger,
  strategyFlag, createdAt }`.
- **Severity scoring** is a pure function per trigger. Examples (higher = more urgent):
  runway <15d (90) > <30d (60); platform −50% WoW (80) > −20% (40); objectives at 0 active (95);
  design-gap with high traffic (50) > low traffic (20). Scores are coarse buckets, not precise.
- **Per-agent cap** (existing): 1/day/agent/type still enforced at stage time.
- **Fleet cap + best-first**: after the agent loop, a new additive block in `index.js`
  (modeled on the existing pace-tracker / auto-post post-loop blocks) reads the buffer, sorts
  each type by severity desc, writes the **top 2 campaign + top 2 objective** to
  `approvalQueue`, and logs the remainder as `proposal-deferred` (governanceLog) so nothing
  vanishes silently. Buffer is cleared each cycle.
- Proposals written here reuse the exact entry shape the existing handlers already produce
  (so the dashboard/approveProposal flow is unchanged).

### §5 — Cron deference (safety net)
- `computeProposals(state, nowMs)` in `proposal-generator.js`: when evaluating the
  count-based floors, treat a recent agent-sourced proposal (last 24h, same type, status
  pending/approved) as satisfying the floor — the cron self-silences when agents are active.
- Keep the cron's `declining-product` and `near-complete-objective` triggers (structural gaps
  agents may not catch). `_isDeduped` already prevents same-type pile-ups.

### §6 — Prompt advertising (the bulk of the work)
- `prompt-builders.js`: for each of the 6 authorized agents, inject (a) the exact action JSON
  schema for `propose-campaign` / `propose-objective` and (b) the agent's TRIGGER block from
  §3. Without this, opening the route is inert — the model won't emit an unknown action.
  This is why prior prompt nudges did nothing (route was closed) and why this is the real lift.

## Error handling & edge cases
- Buffer read/write failures are non-fatal — the post-loop block wraps in try/catch and
  no-ops on error (proposals are a nice-to-have, never block the heartbeat).
- If `runtimeMemory.pendingAgentProposals` is missing/corrupt, treat as empty.
- Dedup: a pending agent proposal with the same name/title as an existing pending entry is
  skipped at stage time (handler-level, already present for campaigns).
- Cron + agent same-cycle race: cron runs on its own 6h timer, not inside the heartbeat;
  the deference check in §5 reads committed `approvalQueue`, so no in-cycle race.
- Quill or any non-authorized agent emitting the action → rejected at §2, logged.

## Testing
- **Unit:** severity scoring (bucket boundaries); cap selection (>4 candidates → top-2 each,
  rest deferred); cron deference (recent agent proposal → floor satisfied → cron silent);
  authorization (quill rejected, pixel accepted).
- **Smoke (Sonnet):** trigger a heartbeat with a real gap present (e.g. objectives <3) →
  confirm ≥1 grounded proposal routes to `approvalQueue` with a cited rationale.
- **Smoke (Haiku/Gemini, degradation):** confirm cron still fills the floor when agents stay
  quiet.

## Blast radius & safety
- Files touched: `constants.js`, `agent-runner.js`, `proposal-generator.js`,
  `prompt-builders.js`, **`index.js` (high blast radius)**.
- The `index.js` change is purely additive — a post-loop select+write block alongside the
  existing pace-tracker/auto-post blocks. No changes to the agent loop, state loading, or
  concurrency.
- All proposals remain CEO-approved; nothing auto-executes. The feature is additive to
  `approvalQueue` only.
- Heartbeat work is explicitly authorized by the CEO for this task.

## Out of scope (YAGNI for v1)
- Precise/continuous severity scoring (coarse buckets are enough).
- Cross-cycle proposal ranking (selection is per-cycle).
- Agent proposals for product lifecycle / fleet changes (those have their own systems 13/14).
- A quality-gate LLM pass on proposals (CEO is the gate; flag-don't-block covers grounding).
