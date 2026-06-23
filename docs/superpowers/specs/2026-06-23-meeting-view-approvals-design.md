# Meeting-View Approvals — Design Spec

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan
**Author:** CEO + Claude (brainstorm session)
**Follows:** `2026-06-23-agentic-meetings-design.md` (the meetings this approves the output of)

## Problem

Agentic Meetings convene, vote, and route winners — internal work auto-creates as tasks,
strategic work routes to the CEO approval queue. But the **Meetings dashboard only shows a
summary row** ("3 tasks, 0 to approval"); there is no way to *ratify* a meeting's strategic
output from the meeting itself. The CEO expected approve/reject buttons "like a normal meeting."

Worse, there is **no reusable approval action** to wire those buttons to:

- `approveProposal` (server) only handles `product_*` and `agent_*` proposal types.
- Campaign and objective approval lives **only as bespoke client-side code in the Actions page**
  (`approveCampaignProposal` / `approveObjectiveProposal` — each reads state, *materializes* the
  real campaign/objective, then flips the queue status via `company-state` POSTs).
- `task_proposal` (the type meetings emit most, from execution_tasks with no objective link)
  has **no approval handler anywhere** — those entries sit in the queue unactioned.

So "approve buttons in the meeting view" is not just UI — it needs working, reusable approval
*logic* for campaign/objective/task proposals.

## Approved decisions

| Decision | Choice |
|---|---|
| **Where approvals happen** | In the **meeting view** (Meetings dashboard), not only the Actions page. The meeting becomes the ratification surface for its own strategic output. |
| **How the action is built** | A **new server endpoint** (`POST /api/proposalDecide`) that materializes the real entity from a queued proposal and flips its status — server-side, unit-tested, reusable. (Not: duplicating Actions-page client code; not: trimming routing scope.) |
| **Internal items** | Stay **auto-created** (the low-friction path). Shown read-only as "✓ auto-created as task" — no buttons. |
| **Reject note** | `ceoNote` is **optional** on reject (less friction in the meeting flow; recorded if given). Differs deliberately from `approveProposal`, which requires it. |
| **Proposal types handled (v1)** | `campaign_proposal`, `objective_proposal`, `task_proposal`. Others (`social_*`, `product_*`) get status-flip only (no materialization); `product_*` continues to use the existing `approveProposal`. |

## Architecture

One new server endpoint with a pure, testable materialization core; one small orchestrator
tweak so the UI can target proposals reliably; the meeting-view render block (already built)
gains per-candidate action state.

```
[Meeting view: passed strategic candidate]
        │  Approve / Reject
        ▼
POST /api/proposalDecide { id, decision, ceoNote? }
        │
        ├─ approve → materializeFromProposal(proposal) ──▶ campaigns | objectives | tasks
        │                                          └─ flip approvalQueue entry → 'approved'
        └─ reject  → flip approvalQueue entry → 'rejected' (+ ceoNote, decisionLog mirror)
```

- **`api/proposalDecide/index.js` + `function.json`** — `POST /api/proposalDecide`
  (`x-company-secret` or `x-ms-client-principal`). Loads `approvalQueue`, finds the pending
  entry by `id`, applies the decision, persists. Returns `{ ok, entry, created }`.
- **`api/proposalDecide/materialize.js`** — pure helper `materializeFromProposal(proposal, nowIso)`
  returning `{ stateKey, entity }` (or `null` for unsupported types). Kept out of the handler
  for unit-testability; mirrors the Actions-page field mapping for campaign/objective.
- **`api/proposalDecide/materialize.test.js`** — node `assert` tests (mirrors `proposal-generator.test.js`).
- **Orchestrator tweak** (`api/companyMeeting/meeting-core.js`) — `_routeStrategicProposal`
  already creates the queue proposal; additionally stamp `candidate.proposalId = p.id` so the
  meeting view can bind a button to the exact queue entry (no fragile title-matching).
- **Meeting view** (`modules/company/meetings.html`) — the existing render block expands each
  convened meeting to its passed candidates with action state (see below).

No edits to `approveProposal`, the heartbeat `index.js`, or `company-state/index.js`.

## Endpoint interface

```
POST /api/proposalDecide
Headers: x-company-secret: <secret>   (or x-ms-client-principal)
Body:    { "id": "<approvalQueue entry id>", "decision": "approved"|"rejected", "ceoNote"?: "<string>" }

200 → { "ok": true, "entry": <updated queue entry>, "created": <materialized entity | null> }
400 → bad/missing id or decision
403 → unauthorized
404 → proposal not found or not pending
```

Behavior:
- **approve:** `entity = materializeFromProposal(entry, now)`. If non-null, append to its
  `stateKey` state array (with a dedup guard for campaigns/objectives — don't create a second
  live entity with the same normalized title) and persist. Then set `entry.status='approved'`,
  `entry.approvedAt`, `entry.resolvedBy='ceo'`. If the type is unsupported, flip status only and
  return `created:null`.
- **reject:** set `entry.status='rejected'`, `entry.rejectedAt`, `entry.rejectionNote=ceoNote||''`;
  mirror a `rejected` entry into `capitalAllocation.decisionLog` (same shape `approveProposal` writes).
- Idempotent by state-check: only acts on a `pending` entry; a second call returns 404 (already resolved).

## Materialization rules

| Proposal `type` | `stateKey` | Entity built (mirrors) |
|---|---|---|
| `campaign_proposal` | `campaigns` | `approveCampaignProposal`: `{ id:'camp-…', title, description, status:'active', startDate, endDate, allowedTaskTypes, frequency, cadence, northStarMetric, objective_id, source:'meeting', proposalId, createdAt }` |
| `objective_proposal` | `objectives` | `approveObjectiveProposal`: objective with `status:'active'`, `source:'meeting'`, `proposalId`, `createdAt` |
| `task_proposal` | `tasks` | `{ id:'task-…', title, description, taskType:'general', status:'todo', priority:'medium', assignee: proposedBy || 'nova', objective_id:null, source:'meeting', meetingId, created_by, createdAt, updatedAt }` |
| anything else | — | `null` (status-flip only) |

Dedup: campaign/objective materialization skips creation if a live entity (status in
`active|paused|complete|completed`) already has the same normalized title — the proposal still
flips to `approved` (matches the Actions-page guard).

## Meeting-view behavior

The render block (already present in `meetings.html`) expands each **convened** meeting:

- Lists **passed** candidates; failed-by-vote candidates collapse into a muted "N rejected by vote".
- For each passed candidate:
  - **Internal** (`blastRadius==='internal'`): read-only `✓ auto-created as task`.
  - **Strategic + proposal pending**: **Approve** / **Reject** buttons → `POST /api/proposalDecide`
    with `candidate.proposalId` → on success re-render.
  - **Strategic + proposal already decided**: green `Approved` / red `Rejected` badge (read from
    the matching `approvalQueue` entry's status), no buttons.
- Decision state is resolved by fetching `approvalQueue` (filtered to `source==='meeting'`) and
  matching on `proposalId`. Uses `CompanyStore.getServerBase()/getWriteHeaders()` and HTML-escaped
  rendering, consistent with the existing block.

## Data shapes

```js
// candidate (meeting record) — NEW field:
{ …existing…, proposalId: 'mprop_…' | undefined }   // present only for routed strategic candidates

// proposalDecide response
{ ok: true, entry: { id, type, status:'approved', approvedAt, proposalId?, … }, created: { …entity… } | null }
```

## Testing

Mirror the `proposal-generator` test pattern (pure-function unit tests + a load check):

- **`materializeFromProposal`** — campaign/objective/task each produce the right `stateKey` and a
  well-formed entity; unknown type → `null`; missing fields tolerated.
- **Dedup** — a campaign/objective whose title matches a live entity → no second entity, still resolvable.
- **Endpoint load** — `node -e "require('./api/proposalDecide')"` loads without throwing.
- (Decision/persistence is exercised via the pure helper + a mocked-storage handler test if cheap;
  otherwise validated by the post-deploy smoke.)

## Scope

**v1 (this spec):** `proposalDecide` endpoint + pure materialize helper + tests; orchestrator
`proposalId` stamp; meeting-view expand with approve/reject/decided states for campaign/objective/task.

**Out of v1:** migrating the Actions page onto `proposalDecide` (it can adopt it later), reworking
the execution_task→strategic routing/noise, social/product materialization, multi-approver/roles.

## Non-goals

- Not changing the meeting/vote logic or what gets routed where.
- Not auto-executing strategic work — approval stays an explicit CEO action.
- Not editing `approveProposal`, heartbeat `index.js`, or `company-state` VALID_KEYS.
