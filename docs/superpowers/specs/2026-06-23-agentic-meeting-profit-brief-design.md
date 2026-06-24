# Agentic Meeting — Profit Brief & Knowledge Upgrade (Design)

**Date:** 2026-06-23
**Status:** Approved (design) → ready for implementation plan
**Owner:** CEO + Claude
**Area:** `api/companyMeeting/` (meeting engine), no heartbeat changes

## Problem

The agentic meeting system produces **low-quality task proposals**. A review of 10 proposals from 5 consecutive meeting runs found:

1. **Blind to the business.** The meeting feeds agents almost no state — only active objective titles + progress %, campaign titles, and the last 5 finished titles. The two fields that could carry business signal (`decliningProducts`, `researchSignals`) are **hardcoded empty** (`meeting-core.js:191`). Agents reason in a vacuum, so they propose objective-hygiene ("the 75%-done objective is stalled, decide on it") because the progress bar is the only thing they can see.
2. **Ceremony, not execution.** ~10/10 proposals were human-management rituals — "convene a 30-min sync," "assign a DRI," "lock an SLA," "go/no-go gate." None is work a real agent can execute, and the fleet has no syncs, DRIs, or sponsors.
3. **Zero profit focus.** 0/10 mentioned revenue, customers, pricing, conversion, acquisition, or monetization — despite that being the company's actual goal.
4. **Redundant.** No dedup across meetings. Each run regenerates the same agenda over the same persistent state, so the queue accumulated 4× "decide on AmbientScore+Blindspot" and 3× "decide on Pulse Daily."
5. **Unrouted.** All proposals land with no assignee, no taskType, no objective link.

## Goals

- Feed meeting agents the **money picture** (revenue, product usage/paid, funnel/ROI, costs, runway) plus **role-targeted memory**, so they can propose work that moves profit.
- Make meetings produce **two clearly separated output lanes**: executable fleet work (with a named owner + deliverable) and CEO decision-requests (money calls only the CEO makes).
- **Dedup across meetings** so repeats stop accumulating.
- Pin meetings to a model that can actually use the richer context.

## Non-goals

- No changes to the heartbeat engine (`companyHeartbeat/`), agents' heartbeat prompts, or the approval UI beyond rendering the new `decision_request` type.
- No new aggregation of metrics that the platform doesn't already compute — the brief **reuses** existing digests as data sources.
- Not redefining the agentic-meetings governance model (vote gate, blast-radius routing stays).

## Decisions locked (with CEO)

1. **Output:** two lanes, clearly separated — executable fleet work **and** CEO decision-requests.
2. **Knowledge depth:** a shared business brief (same for all attendees) **plus** a per-agent specialty memory slice.
3. **Model:** meetings pinned to **Claude Sonnet** (fallback to the global model on error).
4. **Governance:** a passed `fleet_task` **auto-creates an internal task** assigned to its named owner (the fleet does the work; no approval-queue clutter). A `ceo_decision` routes to the approval queue.

## Architecture & data flow

```
runAgenticMeeting (meeting-core.js):
  1. load state: objectives, campaigns, capitalAllocation
       + NEW: revenueLedger, runtimeMemory (digests), researchIntel,
              weeklyReports, agentMemories, agentSeedMemories, tasks, approvalQueue
  2. brief   = buildSharedBrief(state)                  // one money-picture brief, all attendees
  3. agenda  = callModel(buildAgendaPrompt(nova, brief, pendingTopics))   // Nova, profit-framed, avoids re-litigating pending topics
  4. for each attendee:
        slice = buildAgentMemorySlice(agentId, state)
        reply = callModel(buildDiscussionPrompt(agentId, agenda, transcript, brief, slice))
        items = parseItemsFromReply(reply)              // now carries lane/owner/deliverable/profitThesis
  5. vote (quality gate: reject no-thesis / no-owner / ceremony / duplicate)
  6. route passed items by KIND (execution_task split by LANE), after cross-meeting dedup:
        execution_task+fleet_task   → internal task assigned to owner (objective link if given)
        execution_task+ceo_decision → approvalQueue { type: 'decision_request' }
        research_task / internal_doc → internal task (unchanged)
        campaign/objective/product_*/social → existing *_proposal (unchanged)
  7. persist meeting record (incl. suppressedDuplicates)
  * all callModel calls pinned to claude-sonnet; on error fall back to global model
```

### New module: `companyMeeting/meeting-brief.js`

Pure, unit-testable functions. No state I/O (the caller loads state and passes it in).

**`buildSharedBrief(state) → string`** — the money picture, hard cap ~2,500 chars (throws if a formatting bug overflows, mirroring world-state-intel). Sections, each omitted if its source is missing/stale (fail-open):
- **MONEY:** 30-day revenue (sum of `revenueLedger`), paying customers / north-star, spend MTD + runway (`runtimeMemory.financeDigest` / `capitalAllocation`), system budget status.
- **PRODUCTS:** per-product line — usage + paid conversions + verdict (`runtimeMemory.strategicDigest.perProduct` + product usage from finance digest). Explicitly labels **earns vs burns**.
- **FUNNEL:** engagement → site → signups + cost per outcome (`runtimeMemory.outcomeDigest`).
- **PIPELINE:** active objectives/campaigns with pace; what's stalled.

Reuses cached digests from `runtimeMemory` (built by the heartbeat) as **data sources only** — never recomputes. When `runtimeMemory.worldState` exists, its fields are preferred for the MONEY/PIPELINE lines (single source of truth).

**`buildAgentMemorySlice(agentId, state) → string`** — role-targeted, hard cap ~1,500 chars, fail-open to `''`:

| Agent | Sources |
|------|---------|
| cipher | `financeDigest` detail + latest `weeklyReports.cipher` (L9) + budget/ROI `agentMemories.cipher` (L4) |
| scout | `researchIntel` top items (L7) + own research memories |
| echo | `outcomeDigest` funnel detail + experiment verdicts + social memories |
| pixel | product-visual performance memories |
| forge | ops/cost memories + latest `weeklyReports.forge` |
| nova | `strategicDigest` + own reflections + recent decisions |
| *all* | top 2–3 relevant `agentSeedMemories` (L3) + recent `type:'reflection'` / `auto:experiment-verdict` memories (L4) |

### Changes: `companyMeeting/prompts.js`

- `buildAgendaPrompt(agentId, brief, pendingTopics)` — reframed: "From the MONEY picture below, where is the biggest opportunity or leak? Convene only on items that move revenue, cost, or growth." Includes `brief`; lists `pendingTopics` (already-queued decision topics + recent meeting tasks) to avoid re-litigating.
- `buildDiscussionPrompt(agentId, agenda, transcript, brief, memorySlice)` — includes the shared brief + the agent's memory slice. Asks for 0–2 items, each tagged with a **lane** and required fields (below). Explicitly bans ceremony phrasing.
- `buildVotePrompt(agentId, candidates)` — quality gate hardened: instructs reject of any item lacking a `profitThesis` or (for `fleet_task`) a real `owner`, or that is ceremony/duplicate/off-strategy.

### Output contract (item schema)

**`kind` is retained; `lane` is added for execution work.** The existing strategic kinds (`campaign`, `objective`, `product_launch`, `product_pivot`, `product_retire`, `social`) are *unchanged* — they still route to their existing `*_proposal` types through the (recently hardened) approval pipeline; they are inherently CEO decisions. The two new lanes apply only to the **`execution_task`** kind, which was the source of all the ceremony junk. `research_task` and `internal_doc` kinds continue to route to internal tasks as today.

`parseItemsFromReply` accepts and validates these fields per item (in addition to existing `kind`/`title`/`description`/`rationale`/`estimatedCost`/`targetObjectiveId`):

```jsonc
{
  "kind": "execution_task | research_task | internal_doc | campaign | objective | product_launch | product_pivot | product_retire | social",
  "lane": "fleet_task | ceo_decision",   // REQUIRED when kind === 'execution_task'; ignored otherwise
  "owner": "<agent id>",                  // required when lane === 'fleet_task'; must be a known agent
  "deliverable": "<concrete artifact + definition of done>", // required when lane === 'fleet_task'
  "profitThesis": "<revenue/cost/growth lever, citing a number from the brief>" // REQUIRED on every item
}
```

Validation (dropped at parse time, logged, not routed): any item missing `profitThesis`; an `execution_task` missing a valid `lane`; a `fleet_task` missing a known `owner` or a `deliverable`.

### Routing (meeting-core.js step 6)

Routing is by `kind`, with `execution_task` split by `lane`. Dedup (below) runs first on all paths.

- **`execution_task` + `lane: fleet_task`** → internal task:
  `{ status:'todo', priority:'medium', assignee: owner, taskType: _taskTypeForOwner(owner), objective_id: targetObjectiveId||null, description: deliverable, source:'meeting', meetingId }`, where `_taskTypeForOwner` = `scout→'research'`, `scribe→'internal_doc'`, else `'general'`. Bounded by the existing 50 active-task ceiling; over-ceiling items are skipped and logged.
- **`execution_task` + `lane: ceo_decision`** → `approvalQueue` entry
  `{ type:'decision_request', status:'pending', proposedBy: owner||'nova', source:'meeting', title, description, profitThesis, voteTally, createdAt }`. Rendered on the Meetings page (the existing per-candidate Approve/Reject view extended to show `decision_request`).
- **`research_task` / `internal_doc`** → internal task (unchanged from today).
- **strategic kinds** (`campaign`/`objective`/`product_*`/`social`) → existing `*_proposal` routing into `approvalQueue` (unchanged).

### Cross-meeting dedup

Pure helper `isDuplicateTopic(candidate, existing)`:
- **Topic key** = significant tokens of `title` + any product/objective names it mentions (stop-words removed). Two items are duplicates if they share **≥2 significant tokens** OR the same non-null `targetObjectiveId`.
- `fleet_task` (and `research_task`/`internal_doc`) deduped against existing **active/todo tasks**.
- `ceo_decision` deduped against **pending + last-14-day `decision_request`s** in `approvalQueue`.
- strategic kinds deduped against existing **pending same-type proposals** in `approvalQueue` (e.g. a `campaign` item vs pending `campaign_proposal`s) — this is what stops the repeated "decide on X" pileup across runs.
- Suppressed items are recorded on the meeting record as `suppressedDuplicates: [{title, matchedId}]` for transparency.
- Fails open: any read/parse error → do not suppress (never blocks routing).

### Model pin

`runAgenticMeeting` passes `model: 'claude-sonnet'` to `callModel`. Requires `callGemini`/`callModel` to accept an explicit model override (verify signature in the plan; add an override param if absent). On a Claude error after retries, fall back to the globally-configured model so a Claude outage never blocks meetings.

## Error handling

- `buildSharedBrief` / `buildAgentMemorySlice` / dedup all **fail open** — missing or stale data degrades a section to omitted, never throws (except the brief's char-cap guard, which is a developer assertion).
- Model pin falls back to the global model on Claude error.
- Routing skips (and logs) any item that fails validation or exceeds the task ceiling.

## Testing (TDD)

New `companyMeeting/meeting-brief.test.js` + extend the meeting-core test:
- `buildSharedBrief`: assembles from mock state; omits sections whose source is missing; respects the char cap; prefers `worldState` fields when present.
- `buildAgentMemorySlice`: correct per-role source mapping; bounded; fail-open to `''` for an agent with no memory.
- `isDuplicateTopic`: the real incident cluster collapses — 4 "AmbientScore + Blindspot …" → 1, 3 "Pulse Daily …" → 1; distinct topics are NOT suppressed (no false positives on the Build-in-Public items).
- `parseItemsFromReply`: parses new lane/owner/deliverable/profitThesis; drops `fleet_task` with no owner and any item with no `profitThesis`.
- Routing: `fleet_task` → task with assignee=owner; `ceo_decision` → `decision_request` in approvalQueue.

## Rollout / verification

- All changes are in `api/companyMeeting/` + the Meetings page render for `decision_request`. Deploy via `git push origin master`.
- Post-deploy: trigger one meeting; confirm (a) the brief/memory appear in the meeting record's prompts, (b) outputs carry lanes + profitThesis, (c) no duplicate of an already-pending topic is created, (d) fleet_tasks land on the task board assigned to real agents.

## Out of scope (future)

- A dedicated CEO "Decisions" dashboard panel (v1 renders `decision_request` inline on Meetings).
- Auto-concluding/expiring stale `decision_request`s (can reuse the proposal-generator expiry pattern later).
- Feeding meeting outcomes back into the rewards/attribution systems.
