# Proposals Are Born Linked — Design

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan
**Author:** CEO + Claude

## Problem

Approving a proposal only produces work if the resulting campaign is linked to an
objective. Today they arrive unlinked:

- The deterministic generator's **campaign proposal** carries no `objective_id`, no
  `northStarMetric`, empty `product`, and a name that shares no tokens with any
  objective — so the `deriveObjectiveId` auto-link heuristic (used by BOTH the server
  `materialize.js` and the client `actions.html` twin) finds nothing and the campaign
  materializes orphaned (`objective_id: null`).
- An **orphaned campaign's** auto-replenished tasks inherit `objective_id: null`
  ([campaign-lifecycle.js:231](../../api/companyHeartbeat/campaign-lifecycle.js)) and
  are then **blocked by the objective gate** ([index.js:2260-2286](../../api/companyHeartbeat/index.js))
  when an agent tries to start work — social/blog categories are not exempt. Tasks
  stall in `todo`, logging `policy-violation`.
- A **childless objective** (approved with no campaign) spawns no tasks at all — it
  just sits at 0%.
- The **agent path** (`agent-runner.js` `propose-campaign`) can carry `objectiveId`
  but does not require it, so it can orphan too.

Net: the CEO approves a proposal and nothing happens.

## Goal

Proposals are born linked. Approving a generated (or agent) proposal always yields a
campaign attached to an objective, so tasks flow immediately. No orphan campaigns; no
childless objectives.

## Decisions (from brainstorming)

1. **Scope:** full pairing + harden the agent path.
2. **Standalone campaign** (when a suitable active objective exists): set its
   `objective_id` to that objective — the existing materialize honors it, no new type,
   no UI change.
3. **New objective needed** (or campaign needed with no linkable objective): emit ONE
   **`growth_plan_proposal`** bundle (objective + starter campaign), approved together
   as a single card, materialized atomically linked.
4. **Bundle editing:** full edit parity — the bundle is editable in the drawer like
   the campaign/objective proposals shipped earlier today (option a).

## Architecture

### Component 1 — Generator unified decision (`api/companyHeartbeat/proposal-generator.js`)

`computeProposals(state, nowMs)` today evaluates campaign-need and objective-need
independently and can emit two orphan items. Replace with one policy:

```
needObjective = <existing objective triggers: count<3 / near-complete / stale-substantive>
needCampaign  = <existing campaign triggers: count<3 / declining-uncovered / all-stagnant>
parent        = _pickParentObjective(activeObjectives, campaignHints)   // may be null

if needObjective OR (needCampaign AND !parent):
    emit ONE growth_plan_proposal   (new objective + starter campaign, linked)
elif needCampaign AND parent:
    emit ONE standalone campaign_proposal with objective_id = parent.id
else:
    emit nothing
```

- **`_pickParentObjective(objectives, hints)`** (new pure helper): filter to active
  objectives; prefer one whose `northStarMetric` equals the campaign's intended metric,
  else whose title/description mentions the campaign product, else the sole active
  objective, else the most-recently-updated active objective. Returns the objective or
  `null`. Mirrors the priority order of `deriveObjectiveId` so generation-time and
  approval-time linking agree.
- **Dedup:** the growth-plan path is deduped against a pending `growth_plan_proposal`
  (24h) AND against pending campaign/objective proposals, so a run never doubles up.
  Reuse the existing `_isDeduped` window; add `growth_plan_proposal` to it.
- **`_expireStaleGeneratorProposals`** extended to also expire stale pending
  `growth_plan_proposal` entries (same 7-day rule).
- The bundle's **starter campaign** additionally sets `northStarMetric` = the bundle
  objective's `northStarMetric`, so the pieces would still auto-link even if ever split.

### Component 2 — `growth_plan_proposal` shape

One approvalQueue entry:

```js
{
  id: 'gplan_' + nowMs + '_auto',
  type: 'growth_plan_proposal',
  status: 'pending',
  proposedBy: 'nova',
  source: 'auto:proposal-generator',
  objective: { title, description, successCriteria, northStarMetric, metricTarget,
               metricDeadline, timeHorizon, rationale, strategyFlag },
  campaign:  { name, description, platforms, frequency, cadence, duration, product,
               kpiTarget, northStarMetric, rationale },
  rationale: '<why this growth plan>',
  createdAt: iso
}
```

The campaign half carries NO `objective_id` at proposal time (the objective doesn't
exist yet); materialize resolves it to the newly-created objective's id.

### Component 3 — Materialize the bundle (BOTH paths)

Add a `growth_plan_proposal` branch to:
- **`api/proposalDecide/materialize.js`** (server), and
- the client twin in **`modules/company/actions.html`** (`approveGrowthPlan`).

Branch behavior (atomic, ordered, idempotent):
1. Build the objective entity from `proposal.objective` (reuse today's objective
   materialize), id `obj_<nowMs>_gplan`.
2. Build the campaign entity from `proposal.campaign` with `objective_id` = that new
   objective id; run the existing task-type/enrichment normalization.
3. Set `objective.linkedCampaigns = [campaign.id]`.
4. Persist: push objective into `objectives`, campaign into `campaigns`.
5. `isLiveDuplicate` guards each (retry-safe; a re-approve does not double-create).

**Contract change:** `materializeFromProposal` today returns a single
`{ stateKey, entity }`. Extend it to return `{ entities: [{stateKey, entity}, …] }`
for multi-entity proposals (or an additive `extraEntities` array), and update
`api/proposalDecide/index.js` to iterate. Keep single-entity proposals working
unchanged (back-compat: normalize single → one-element list).

### Component 4 — Actions UI (`modules/company/actions.html`)

- New **"Growth Plans"** panel + `renderGrowthPlanProposals()` (mirrors
  `renderCampaignProposals`/`renderObjectiveProposals`), listing pending
  `growth_plan_proposal` entries into `window._growthPlanProposals`.
- **`openGrowthPlanDrawer(idx)`**: renders the objective half and the campaign half.
  Rationale/provenance read-only; substantive fields editable via the existing
  `_pinput`/`_pval`/`_pcheckboxes`/`_attr` helpers, with **prefixed ids**
  (`pe_obj_title`, `pe_obj_metricTarget`, …, `pe_camp_name`, `pe_camp_platforms`, …) so
  the two halves don't collide. A `pe_msg` div + **Save changes** / **Approve** /
  **Reject** buttons.
- **`saveGrowthPlanEdit(id)`**: builds `patch = { objective:{…}, campaign:{…} }` from the
  prefixed inputs, POSTs to `/api/proposalEdit`, updates the cached entry in place, shows
  "saved ✓".
- **`approveGrowthPlan(id)`**: client materialize per Component 3 (create objective +
  linked campaign, back-link, flip queue entry). **`rejectGrowthPlan(id)`**: reject via
  the existing path.

### Component 5 — Extend `proposalEdit` for the bundle

- **`api/proposalEdit/validate.js`**: handle `type === 'growth_plan_proposal'`. The
  patch shape is `{ objective?: {...}, campaign?: {...} }`. Validate each present half
  with the existing `_objective` / `_campaign` field validators; return
  `{ clean: { objective?: {...}, campaign?: {...} }, error }`. A required-field emptiness
  in either half is a hard error (prefixed message, e.g. "objective title is required").
- **`api/proposalEdit/index.js`**: for a `growth_plan_proposal`, merge `clean.objective`
  into `target.objective` and `clean.campaign` into `target.campaign`; reconcile
  `target.objective.strategyFlag` (objective rule). Governance `proposal-edited` event
  includes which halves changed.

### Component 6 — Harden the agent path (`api/companyHeartbeat/agent-runner.js`)

In the `propose-campaign` handler (~5063), after the existing auth/dedup/capital gates,
resolve an objective link:
- If `action.campaign.objectiveId` names an active objective, use it.
- Else `_pickParentObjective(objectives)`; if found, set it (flag `objectiveInferred`).
- If none exists, **block** the proposal with reason
  `no active objective to link — propose an objective or growth plan first` (log a
  `policy-violation` with `gate: 'campaign_needs_objective'`), rather than queue an
  orphan. Fail-open on state-read error (don't block on transient failure).

The materialized `campaign_proposal` now always carries `objective_id`.

## Data flow

```
generator → needs → { standalone campaign(objective_id=parent) | growth_plan(objective+campaign) }
                                              │
CEO approves ── growth_plan ──► materialize: create objective → create campaign(objective_id) → linkedCampaigns
                                              │
                          campaign-lifecycle auto-replenish → tasks inherit objective_id
                                              │
                          objective gate PASSES → agents execute → work ships
```

## Error handling

- Generator: any error is a no-op (existing fail-safe). `_pickParentObjective` returns
  `null` safely on empty/malformed objectives.
- Materialize: objective created before campaign; if the campaign write fails, the
  objective still exists (childless, visible, fixable) — no partial campaign. Re-approve
  is idempotent via `isLiveDuplicate`.
- proposalEdit: unchanged guards (pending-only, 404/409); a malformed bundle patch half
  is coerced/omitted, empty required field → 400.
- Agent path: block is logged, not fatal; the run continues.

## Testing

- **`proposal-generator.test.js`** (extend): standalone campaign gets `objective_id`
  when an active objective exists; growth_plan emitted when no active objective / when
  objective-need fires; never emits an orphan campaign; `_pickParentObjective` priority
  order; dedup against pending growth_plan.
- **`proposalEdit/validate.test.js`** (extend): growth_plan patch validates both halves,
  drops unknown keys, clamps, required-field-in-half → error.
- **Materialize** (new small harness or existing test file): growth_plan branch creates
  a linked objective+campaign with `linkedCampaigns` set; idempotent on retry.
- **Manual E2E:** trigger the generator with zero active objectives → a growth_plan
  appears → approve in the UI → confirm objectives + campaigns both created and linked
  (`campaign.objective_id` set, `objective.linkedCampaigns` populated) → confirm the
  next heartbeat's auto-replenished task carries `objective_id` and is NOT gate-blocked.

## Files touched

- `api/companyHeartbeat/proposal-generator.js` (+ `.test.js`) — decision policy,
  `_pickParentObjective`, growth_plan builder, standalone `objective_id`, dedup/expiry.
- `api/proposalDecide/materialize.js` — growth_plan branch + multi-entity return.
- `api/proposalDecide/index.js` — iterate multi-entity materialize result.
- `api/proposalEdit/validate.js` (+ `.test.js`) — growth_plan patch validation.
- `api/proposalEdit/index.js` — growth_plan merge branch.
- `api/companyHeartbeat/agent-runner.js` — propose-campaign objective requirement.
- `modules/company/actions.html` — Growth Plans panel, bundle drawer (editable),
  approve/reject/save, client materialize twin.

## Out of scope / known debt

- **Materialize triplication:** this adds one more type to the two hand-synced paths
  (`materialize.js` + `actions.html`). Consolidating to one server path is the real fix;
  deferred. Both paths MUST be kept in sync for `growth_plan_proposal`.
- `kpiTarget` / `product` still aren't read by materialize into the created campaign
  (pre-existing).
- Blog-campaign platform checkboxes (fast-follow from the edit feature) unchanged here.

## Rollback

Purely additive (new proposal type + new branches; existing campaign/objective proposals
untouched). Revert the commits; no state migration. Any `growth_plan_proposal` already
in the queue would need manual dismissal if the type is removed.
