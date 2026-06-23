# AmbientOS Agentic Meetings — Design Spec

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan
**Author:** CEO + Claude (brainstorm session)

## Problem

The fleet executes work well but rarely *originates* quality work on its own. Work
origination today is either a single agent's solo `propose-campaign` (which has fired
**0 times in 100+ runs**) or the deterministic `proposalGeneratorCron` (generic, and
deliberately conservative after the 2026-06-23 junk-loop fix). When the strategic
initiatives Nova was decomposing finished (Pixel Agents v2.1/v2.2, archived ~06-20),
the fleet went quiet because nothing was feeding it new initiatives.

Agentic Meetings give the fleet a **deliberation-and-vote** mechanism to originate work:
agents propose what's worth meeting about, debate it, vote, and the winners route to real
work. The meeting + vote is a **quality gate** — far stronger than one agent's solo
suggestion — and produces an auditable transcript explaining *why* the fleet wants something.

## Approved decisions

| Decision | Choice |
|---|---|
| **Trigger** | A **button** (manual, always available) + an **autonomy switch** that, when on, auto-convenes (weekly cadence + signal-triggered). Manual is v1's primary path; autonomy is the same core behind a toggle. |
| **Passed-vote output** | **Route by blast radius** — internal/low-risk auto-creates; strategic/external becomes a fleet-endorsed proposal in the CEO approval queue (with transcript + tally). |
| **Voting** | **Simple majority** of attendees (approve/reject/abstain + one-line rationale), **Nova breaks ties**, plus a **deterministic budget pre-check** (reuses Capital Allocation) so unaffordable items can't pass. |
| **Run location** | **Server-side reusable core** — required because autonomy can't depend on a browser tab. Both the button endpoint and the autonomy cron call the same function. |
| **Attendees (v1)** | The 6 strategic agents: nova, echo, scout, cipher, pixel, forge. Scribe/Quill excluded (they execute, not originate). |
| **Discussion depth (v1)** | One discussion round, then one vote round. Multi-round debate is a possible v2. |

## Architecture

One server-side core, two thin callers, total isolation from the heartbeat.

```
[Meetings UI button] ──POST──▶ /api/agentic-meeting-trigger ─┐
                                                             ├─▶ runAgenticMeeting()  ──▶ meetings store
[systemConfig.agenticMeetings.enabled] ──▶ agenticMeetingCron ┘         │                       │
        (weekly + signal, capped)                                      ├─▶ task-mutations (internal auto-create)
                                                                       └─▶ approvalQueue (strategic → CEO)
```

- **`api/companyMeeting/meeting-core.js`** — exports `runAgenticMeeting({ storage, nowMs, log, trigger })` plus pure helpers (`tallyVote`, `classifyBlastRadius`, `budgetEligible`, `buildAgendaPrompt`, `extractCandidates`). Returns the full meeting record.
- **`api/agentic-meeting-trigger/`** — HTTP `POST /api/agentic-meeting-trigger` (x-company-secret), the button. Runs the core once, returns the record. Mirrors `proposal-generator-trigger`.
- **`api/agenticMeetingCron/`** — timer. If `systemConfig.agenticMeetings.enabled`, run the core (weekly cadence + signal check, deduped, `maxPerWeek` cap); else no-op.
- **`api/meetings/`** (or extend existing) — `GET` endpoint for the dashboard to read the meetings list.
- **Persistence** — meeting records written via `_utils/companyStorage` to a dedicated **`agenticMeetings`** key (kept separate from the client-side CEO `ap_meetings` store to avoid collisions), **bypassing `company-state` VALID_KEYS** (the `heartbeatProgress`/`pingLog` pattern). No edit to `company-state/index.js` or heartbeat `index.js`.
- **Reuses** — `gemini.js` (respects `systemConfig.heartbeatModel`), Capital Allocation digest (budget), approvalQueue + task-mutations conventions.

## The meeting flow (`runAgenticMeeting`)

1. **Agenda proposal.** Nova reads current state — active/recently-finished objectives, active campaigns, coverage gaps, declining products, top unactioned research signals — and proposes **1–3 agenda topics** worth deciding. If nothing qualifies, returns `{ convened: false, reason }` (button shows "nothing worth convening on"; cron skips and logs).
2. **Discussion.** The 6 strategic agents each speak once, in order, seeing prior turns. Each pitches 0–2 concrete work items: `{ kind, title, description, rationale, estimatedCost, blastRadius, targetObjectiveId? }`. Nova opens (frames the agenda) and closes (synthesizes the candidate slate). Reuses the sequential transcript pattern from the existing `runMeeting`.
3. **Candidate slate.** Parse all turns into a deduped list of proposed work items (dedupe by normalized title + kind).
4. **Budget pre-check.** For each item carrying `estimatedCost`, check Capital Allocation headroom (system + proposing-agent). Over-budget items are marked `eligible: false` and cannot pass (recorded with reason).
5. **Vote.** Each attendee casts `approve | reject | abstain` + a one-line rationale on each *eligible* item. `approveCount > rejectCount` among non-abstain votes → `passed`. Exact ties → **Nova's vote decides**; if Nova abstained on a tie, the item fails (conservative default).
6. **Route by blast radius.**
   - **Internal/low-risk** (`research_task`, `internal_doc`, `execution_task` under an existing objective): auto-create directly via the task-mutation / create-doc path, tagged `source: 'meeting'`, `meetingId`.
   - **Strategic/external** (`campaign`, `objective`, `product_*`, `social`): write an approvalQueue entry of the matching type (`campaign_proposal` / `objective_proposal` / etc.), `source: 'meeting'`, with `meetingId`, the vote tally, and the rationale. Surfaces in the existing Actions-page proposal panels.
7. **Persist + log.** Write the full meeting record to the meetings store (FIFO cap, e.g. 50). Append one `agentic-meeting` summary to governanceLog (convened?, agenda topics, candidates, passed count, routed internal/external counts).

### Blast-radius classification (the gate's routing table)

| Candidate kind | Class | Destination |
|---|---|---|
| `research_task` | internal | auto-create task (assignee scout) |
| `internal_doc` (spec/runbook) | internal | auto-create doc |
| `execution_task` under an existing active objective | internal | auto-create task |
| `campaign` (new) | strategic | approvalQueue `campaign_proposal` |
| `objective` (new) | strategic | approvalQueue `objective_proposal` |
| `product_launch/pivot/retire` | strategic | approvalQueue `product_*_proposal` |
| `social` | strategic | approvalQueue (existing social path) |

Unknown/ambiguous kinds default to **strategic** (route to CEO) — fail safe toward human review.

## Controls

- **Button:** "Run Agentic Meeting" in the Meetings UI → calls the trigger endpoint, renders agenda → discussion → vote tally → routing outcome.
- **Switch:** `systemConfig.agenticMeetings = { enabled: false, cadence: 'weekly', maxPerWeek: 2, signalsEnabled: true }`. UI toggle flips `enabled`. Off = button-only.
- **Signals (cron, when enabled):** finished-initiative-without-successor, coverage gap (`<3` active objectives, or a declining product with no campaign), high-score unactioned research signal. Dedup per signal within 7 days; respect `maxPerWeek`.
- **Cost:** ~16–20 model calls per meeting (6 discussion + agenda + 6 votes + close). Capped per week. Pennies on Gemini; respects the active model toggle.

## Governance & safety

- Strategic/external work **never auto-executes** — it always routes to the CEO approval queue, preserving the existing "external → CEO" rule. Only internal/low-risk work auto-creates.
- Budget pre-check prevents the fleet voting through work it can't afford.
- `maxPerWeek` cap + signal dedup bound cost and noise.
- Fully isolated from the heartbeat; reversible (toggle off, remove the button). No high-blast-radius file edits (`index.js`, `company-state/index.js`, `staticwebapp.config.json`, `company-actions.json` untouched).

## Data shapes

```js
// meeting record (persisted)
{
  id: 'amtg-<ts>',
  trigger: 'button' | 'cron-weekly' | 'signal:<type>',
  convened: true,
  agenda: [{ topic, rationale }],
  attendees: ['nova','echo','scout','cipher','pixel','forge'],
  transcript: [{ agentId, name, role, text, ts }],
  candidates: [{
    id, kind, title, description, rationale, proposedBy,
    estimatedCost, blastRadius: 'internal'|'strategic',
    eligible: true, ineligibleReason: null,
    votes: [{ agentId, vote: 'approve'|'reject'|'abstain', rationale }],
    approveCount, rejectCount, abstainCount, tiebreak: false, passed: true
  }],
  routed: { internalCreated: [taskId...], proposalsQueued: [aqId...] },
  model, createdAt, durationMs
}
```

## Testing

Mirror the `proposal-generator` / `actionsArchiver` test pattern (pure-function unit tests + mocked run):

- **`tallyVote`** — majority pass/fail, abstains excluded from base, exact tie → Nova decides, Nova-abstain tie → fail.
- **`classifyBlastRadius`** — each kind maps to the right class; unknown → strategic.
- **`budgetEligible`** — over-budget → ineligible with reason; within budget → eligible; fail-open on unreadable allocation state.
- **`extractCandidates`** — dedup by title+kind, cap per agent.
- **End-to-end `runAgenticMeeting`** with stubbed model replies — asserts internal items auto-create, strategic items queue, ineligible items don't pass, record shape is complete.

## Scope

**v1 (this spec):** server-side core, button trigger, autonomy switch (weekly + signals), majority+Nova+budget vote, blast-radius routing, persistence + dashboard render, tests.

**Explicitly out of v1 (possible v2):** multi-round debate, all-8-agent attendance, weighted/role-veto voting, richer signal detectors, meeting-to-meeting memory/threading beyond the existing `topicKey` relation.

## Non-goals

- Not replacing the deterministic `proposalGeneratorCron` (it stays as the always-on backstop).
- Not auto-executing strategic/external work.
- Not modifying the heartbeat engine or `company-state` VALID_KEYS.
