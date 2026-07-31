# Track C — Retirement knowledge inheritance

**Date:** 2026-07-31 · **Status:** Phase 1 approved for build; Phase 2 deliberately deferred.

## 1. The gap

The ladder's most existential prompt line tells an agent facing retirement:

> *"Your successor would inherit your memories."*
> — `api/companyHeartbeat/rewards-engine.js:783`

That is not true. The retirement proposal body already admits it:

> *"Standard retire flow: open tasks reassign to the domain lead on approval. Successor seeding (knowledge inheritance) is Track C."*
> — `api/companyHeartbeat/rewards-engine.js:953`

**What retirement actually does today** (`api/approveProposal/index.js:180-224`):

1. Reassigns the retired agent's open tasks to the domain lead.
2. Flips `agentRegistry` status to `archived`, sets `retiredAt` / `retiredReason`.
3. Appends an `agent-retired` entry to `governanceLog`.

Memories are untouched. They remain in `agentMemories[<id>]` and are never read again, because prompt injection looks up by *active* agent name (`prompt-builders.js:1360`).

**Structural fact that shapes the whole design:** retirement does not create a successor. `agent_retire_proposal` and `agent_hire_proposal` are independent flows. A retirement can happen with no replacement ever hired.

## 2. What "memories" means mechanically

| Layer | Store | Volume | What reaches a prompt |
|---|---|---|---|
| L4 runtime memories | `agentMemories[id]` | FIFO cap 50 | last **10**, truncated to **200 chars** each (`prompt-builders.js:1360-1367`) |
| L9 weekly reports | `weeklyReports[id]` | rolling 12 | via its own block |
| L2 doctrine | `agentRegistry.agents[].doctrine` | + `doctrineHistory` | always |
| L3 seeds | `agentSeedMemories` | CEO-owned | budgeted, see `project_seed_memory_truncation` |

Because only ~10 × 200 chars ever reach a prompt, **inheritance must be distilled, not copied.** A 50-entry dump is impossible regardless of design.

## 3. Decisions taken

These are the CEO's decisions for the feature **as a whole**. Only Phase 1 (§5) is approved for build; decisions 3 and 4 describe Phase 2 behaviour and are recorded here so the deferred half is not re-litigated from scratch. Two of them are explicitly reopened in §6.

| # | Question | Decision |
|---|---|---|
| 1 | Who is the successor? | **A future hire only.** Not the domain lead who absorbs the tasks. Knowledge sits in escrow until a genuine replacement is hired into the role. |
| 2 | Which layers are inherited? | **L4 runtime memories + L9 weekly reports.** Doctrine is excluded (the hire proposal supplies its own, and two strategic frames in one prompt is a known hazard). Seeds are excluded (CEO-owned and role-generic). |
| 3 | How is a successor identified? | **Explicit `successorTo: '<retiredAgentId>'` on the hire proposal.** Nothing is inferred from role strings. No match → no inheritance. Unclaimed escrows are surfaced so a months-old escrow is not silently forgotten. |
| 4 | Where does it land, for how long? | **Its own `INHERITED FROM YOUR PREDECESSOR` prompt block**, separate from `YOUR MEMORY` so the FIFO cannot evict it, ageing out after the successor's first scored season or a 120-day backstop. |

Decision 1 was taken with its cost understood and stated: an escrow may never be read.

## 4. The seam — why this ships in two phases

The feature splits cleanly, and only one half has a clock on it.

**Finding that establishes the seam:** retirement never deletes memories, but `memoryConsolidate` iterates **every key** in `agentMemories` with no active-agent filter (`api/memoryConsolidate/index.js:75`). It keeps grinding an archived agent's bucket forever, collapsing clusters of 5+ similar entries older than 7 days. So the raw material is not deleted at retirement — it slowly compresses afterward.

| | Phase 1 — build now | Phase 2 — deferred |
|---|---|---|
| Scope | Freeze the snapshot at retirement | Distil, match at hire, render, age out, alert |
| Why now / later | Consolidation degrades the source from the moment of retirement | Cannot do anything until a successor exists |
| Deadline | Before the **first retirement approval** (earliest 2026-10-01) | Before the **first successor hire** — strictly later |
| Size | ~30 lines + a VALID_KEY + tests | A cron, a trigger, an LLM call, a prompt block, ageing, alerting |

**Phase 1 makes the promise keepable, not kept.** It preserves the material so Phase 2 can be built at any time, with full knowledge of who the successor actually is. The prompt line stays as written — *"would inherit"* is conditional and remains honest.

**Why Phase 2 is deferred rather than built:**

- The economy fights decision 1. An agent is retired because it is not earning; that is the budget saving. Hiring a same-role replacement spends it straight back. The retire → same-role-hire chain the delivery half depends on is the less likely outcome, not the default.
- Phase 2 is where all the cost and all the new failure modes live: a cron, a trigger endpoint, a two-state escrow, retry counters, stuck-detection and alerting — to summarise ~50 short strings, a handful of times in this system's life. The source is already 200-char human-readable prose, so the quality gap over "the 8 best, verbatim" is small.
- Silent failure is this codebase's most expensive recurring bug class (seed truncation; the 46h Scribe preflight skip). Adding a new silent-failure surface for a payload that may never be delivered is a poor trade *today*, and a fine one once a real successor exists.

## 5. Phase 1 specification

### 5.1 New state key `agentInheritance`

Added to `VALID_KEYS` in `api/company-state/index.js` (currently ends at `'asProspects'`) so the escrow is readable for inspection and future dashboard surfacing.

```js
{
  escrows: {
    '<retiredAgentId>': {
      agentId, name, role,
      retiredAt, retiredReason,
      capturedAt,
      status: 'raw',                 // Phase 2 adds 'ready' | 'failed' | 'claimed'
      memoryCount, reportCount,      // at-a-glance, no need to walk raw
      raw: {
        memories: [ ...agentMemories[id] ],   // frozen copy
        reports:  [ ...weeklyReports[id] ]    // frozen copy
      }
    }
  },
  updatedAt
}
```

`status` is written as `'raw'` and left alone. Phase 2 owns every other value.

### 5.2 Capture at retirement

In `api/approveProposal/index.js`, `agent_retire_proposal` branch, as a new step between the registry flip (step 2) and the governance log (step 3):

- Read `agentMemories` and `weeklyReports`; freeze the retired agent's entries into the escrow.
- **Idempotent:** if `escrows[targetAgentId]` already exists, do nothing. Re-approving must not overwrite a frozen snapshot with a consolidation-degraded one.
- **Non-fatal:** wrapped in `try/catch` like the existing governance-log step. A storage hiccup must never block a CEO retirement.
- **Source is not deleted.** `agentMemories[<id>]` stays exactly as it is. Capture failure is therefore recoverable, not a permanent loss.
- Record `name` and `role` from the agent's `agentRegistry` entry, so the escrow is self-describing once the agent is archived and drops out of the active roster.

### 5.3 Visibility

The existing `agent-retired` governance entry gains two fields so a failed capture is visible rather than silent:

```js
{ at, type: 'agent-retired', targetAgent, reassignedCount, ceoNote, proposalId,
  inheritanceCaptured: true|false, inheritanceCounts: { memories: N, reports: N } }
```

This is the entire alerting surface in Phase 1. It is proportionate: the event happens at most a few times ever, always as a result of a deliberate CEO approval, so it will be looked at.

### 5.4 Testing

Pure and near-pure logic, tested in the style of `rewards-engine.test.js`:

- A retirement with memories and reports produces a well-formed escrow with correct counts.
- A retirement for an agent with **no** memories and **no** reports produces an escrow with empty arrays and zero counts — not a missing escrow, so the record shows the agent genuinely had nothing.
- Re-approving the same retirement does not overwrite the existing escrow.
- A storage failure during capture leaves the retirement itself successful (tasks reassigned, registry archived) and records `inheritanceCaptured: false`.
- The retired agent's `agentMemories` entry is unchanged after capture.

## 6. Phase 2 sketch and open forks

Recorded so the deferred half has a home, **not** approved for build.

Intended shape: a distillation step produces ≤8 lessons of ≤200 chars; the successor's registry entry stores only the pointer `successorTo` plus `inheritanceStartedAt`, and the prompt block reads the escrow live. Storing a pointer rather than a copy removes the race between hiring and distillation entirely — the block simply appears once the lessons exist, regardless of ordering.

Two forks were flagged during design and are deliberately left open, because both are cheaper to decide when a real successor exists:

1. **Decision 1 revisited — hire-only vs. lead-now.** If, when the first retirement lands, no replacement is planned, the escrow delivers nothing. The alternative ("distil to the domain lead who absorbs the tasks, and to a future hire if one arrives") costs one extra read site and makes the pipeline pay off in the common case.
2. **Distillation method — LLM synthesis vs. deterministic selection.** The approved answer was async LLM synthesis via a cron. Deterministic selection (rank by type, recency and evidence; take the top 8 verbatim) is a pure function and a test, with no cron, no trigger endpoint, no retry counters, and no stuck-escrow failure mode. The escrow shape above supports either without migration, since `raw` is retained.

The ageing rule, if built as designed, is computed in the prompt builder from `agentRewards` — a completed scored season since `inheritanceStartedAt`, or a hard 120-day backstop. The backstop matters because the season path silently never fires if the rewards engine is disabled. The block's rendered length should be logged alongside the existing `runtimeMemories` telemetry (`prompt-builders.js:2614`) rather than silently truncated, per `project_seed_memory_truncation`.

## 7. Out of scope

- `memoryConsolidate` running over archived agents' buckets is wasted work and quietly degrades an historical record. It is noted here as the finding that sets Phase 1's deadline, but fixing its scoping is a separate change and is not part of this design.
- No change to the `rewards-engine.js:783` prompt line. *"Would inherit"* is conditional and stays honest under this design.
- No change to the retirement ladder, par, or draft gating.

## 8. Related

- Skill `agent-rewards` — economy mechanics, ladder, retirement drafting.
- `docs/superpowers/specs/2026-07-30-revenue-seasons-design.md` — the season/ladder system this hangs off.
- `docs/superpowers/handoffs/2026-07-31-revenue-focus-handoff.md` §5 — Track C listed as open.
- Memories `project_revenue_seasons`, `project_seed_memory_truncation`, `feedback_systemconfig_read_modify_write`.
