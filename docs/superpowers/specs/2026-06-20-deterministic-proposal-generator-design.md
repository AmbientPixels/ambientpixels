# Deterministic Proposal Generator — Design

**Date:** 2026-06-20
**Status:** Approved (CEO), ready to build
**Author:** Claude (investigation + design)

## Problem

Agents (Nova, Echo) never emit `propose-campaign` / `propose-objective` — confirmed **zero** in 30+ days of `governanceLog`, on **both Gemini and Claude**. This is not a model-comprehension problem and not a budget gate (system is GREEN 62%, `actionsBlocked = 0`, all guardrail counters 0). It is a **structural routing bug**:

1. The authoritative output-envelope contract (`prompt-builders.js:1697-1699`) tells every agent to put proposals in the `proposals` array as generic schema-v1 objects, and restricts `taskUpdates` to `create/update/move-task`. It never tells the model to emit `{type:'propose-campaign', campaign:{…}}`.
2. The `proposals` array is processed (`agent-runner.js:5824-5854`) as generic "CEO suggestions" — it never dispatches by `.type` to the `propose-campaign` / `propose-objective` handlers, so those proposals never become `campaign_proposal` / `objective_proposal` queue entries.
3. `propose-campaign` and `propose-objective` are missing from `KNOWN_ACTION_TYPES` (`constants.js:245-253`), so any legacy-format emission is silently dropped at `normalization.js:100`.

The handlers at `agent-runner.js:4951` (campaign) and `:5044` (objective) **exist but are stranded** — reachable only if the model violates the envelope contract.

Secondary factors (downstream of the above): the "stagnant campaign" trigger condition is **stated but never computed** (no STAGNANT flag exists; `social-intel.js` only emits ON TRACK/BEHIND/OVERDUE), and reactive duties consume the 3-action cap before the proposal trigger is reached.

**Decision:** stop relying on the model. Generate proposals deterministically, server-side.

## Goal

When company state warrants new strategic work, deterministically create `campaign_proposal` and `objective_proposal` entries in `approvalQueue` for CEO approval. No LLM in the loop. Nothing auto-executes — the CEO approves everything via the existing Actions-page panels.

## Approach

Standalone Azure Function cron (mirrors `emergenceCheckCron` / `memoryConsolidate`). **No edits to the high-blast-radius `index.js` / heartbeat.** Independently testable and revocable (disable the function).

### Components

- **`api/companyHeartbeat/proposal-generator.js`** — domain module (lives with the other intel modules; same place `emergence-intel.js` lives).
  - `computeProposals(state, nowMs) → ProposalEntry[]` — **pure** function, the unit-tested core. No IO. Returns 0–2 entries.
  - `runProposalGenerator({ storage, nowMs, log }) → summary` — IO orchestration: loads state, calls `computeProposals`, appends results to `approvalQueue`, returns a summary. `storage` is injected so it is testable with a mock.
- **`api/proposalGeneratorCron/`** — `index.js` (timer) + `function.json`. Schedule: `0 0 */6 * * *` (every 6h). Thin shell → `runProposalGenerator`.
- **`api/proposal-generator-trigger/`** — `index.js` (HTTP POST, `x-company-secret` gated) + `function.json`. Thin shell → `runProposalGenerator`, returns JSON. For on-demand testing.

### Inputs to `computeProposals(state, nowMs)`

`{ campaigns, objectives, tasks, strategicDigest, socialAccountStats, approvalQueue }` — all read-only.

### Detection (fires at most 1 campaign + 1 objective proposal per run)

**Campaign** — propose when ANY:
- active campaigns `< 3`, OR
- ≥1 product is `DECLINING` / `NO DATA` in `strategicDigest.perProduct` with **no active campaign covering it** (`campaign.product` match, case-insensitive), OR
- all active campaigns are stagnant (no task with that `campaign_id` reached `done` in the last 14 days).

Skip if a `campaign_proposal` is already `pending`, OR the generator created a `campaign_proposal` in the last 24h (`source === 'auto:proposal-generator'`). → queue never holds >1 pending of this type and ≤1/day.

**Objective** — propose when ANY:
- active objectives `< 3`, OR
- an active objective is stale (no linked active campaign/tasks in 14 days), OR
- an active objective is `≥95%` complete (needs a successor).

Same pending / 24h dedup guard for `objective_proposal`.

If a state read fails or required inputs are missing → return `[]` (fail-safe, no-op).

### Content (computed skeleton, no LLM)

Built from real data already in state — templated structure, real specifics:
- **Campaign**: name (e.g. "Re-activate <ProductA> + <ProductB>"), rationale citing the declining products + their actual traffic deltas + "no active campaign covers it" / "0 posts in 7d", `platforms` = live social platforms from `socialAccountStats` (valid `social_*` types only), `frequency`/`cadence` defaults (3/weekly), `kpiTarget` tied to a north-star metric, `product` = primary target. `northStarMetric` set when a valid one is available, else null.
- **Objective**: title, description, rationale (cites all-products-declining / 0 posts 7d / only N active objectives), `successCriteria` (measurable), `timeHorizon` (e.g. "60 days"), `northStarMetric` + `metricTarget` + `metricDeadline` computed best-effort (both-or-neither, matching the existing handler rule).

### Output entry shape (CRITICAL — byte-match existing handlers)

Entries **must match** the shapes emitted by `agent-runner.js:5020-5037` (campaign) and `:5095-5111` (objective) so the existing Actions-page panels (`actions.html:1280`, `:1435`) and approve flow consume them unchanged. Differences vs agent-authored:
- `proposedBy: 'nova'` (campaigns/objectives are Nova's strategic domain)
- add `source: 'auto:proposal-generator'` so the entries are identifiable and dedup-able
- `id` prefix reused: `cprop_…` / `oprop_…`

### Safety

- **Purely additive.** Only ever appends new `approvalQueue` entries. Never mutates or deletes existing state. Never auto-executes — CEO approves everything.
- **Cannot flood.** Pending-exists + 24h-per-type guards cap it at ≤1 of each type per day.
- **Fail-safe.** Any error / missing input → no-op.
- No high-blast-radius files touched (`index.js`, `company-state`, `staticwebapp.config.json`, `company-actions.json`, CI workflow all untouched).

### Testing

`api/companyHeartbeat/proposal-generator.test.js` (plain `node:assert`, run `node …/proposal-generator.test.js`, matching `nova-voice-tts/ssml.test.js`). Cases:
- campaign fires when active < 3 / declining-uncovered product / all stagnant
- objective fires when active < 3 / stale / ≥95% complete
- dedup: pending exists → no proposal
- dedup: generated in last 24h → no proposal
- empty/missing state → `[]` (no-op)
- output entries match required shape (fields + `source` + `proposedBy`)

## Out of scope (YAGNI)

The routing bug that kills *agent-volunteered* proposals (add `propose-campaign`/`-objective` to `KNOWN_ACTION_TYPES` + dispatch the `proposals` array by `.type`). The cron delivers deterministic proposals without it. Tracked as a known latent bug; optional follow-up to re-enable agent creativity.

Products (`propose-product`/pivot/retire) are also out of scope — higher blast radius, partially works already.
