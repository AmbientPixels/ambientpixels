# AmbientOS Agent System Tuneup — Design Spec

**Date:** 2026-04-12
**Goal:** Transform agents from a content-churning treadmill into a high-signal autonomous system that produces real value.

---

## Problem Statement

The 8-agent system runs reliably but produces low-leverage output. Root causes:

1. **Memory is 70% noise** — agents re-record the same insights hourly, 14+ memory layers with no dedup or TTL
2. **Prompts are bloated** — 25-30K tokens per agent, 40-50% irrelevant context, near model ceiling
3. **Execution is over-gated** — 42 agent-specific branches, 69 blocking gates, agents blocked by invisible rules
4. **Idle agents** — Pixel and Forge produce 0 actions for consecutive cycles
5. **Busywork loop** — campaign auto-replenish spawns infinite tasks with no outcome gate
6. **Governance is theater** — escalations auto-resolve, Quill acts as pseudo-CEO

---

## Phase 1: Memory Deduplication (High Impact, Low Risk)

**Problem:** Cipher records "$0.46/day" 9 times in 8 hours. Scribe records the same SEO tip 8 times. 40% of all memories are exact/near-exact duplicates.

**Fix in `api/companyHeartbeat/agent-runner.js`**, in the memory-save handler:

Before writing a new memory, check existing memories for the same agent:
- Normalize both strings: lowercase, trim, collapse whitespace, strip numbers/currency (so "$0.46/day" and "approximately 46 cents daily" both become "approximately cents daily")
- Token-overlap check: split into word tokens, compute Jaccard similarity (intersection/union). If overlap > 70% with any memory from the last 24 hours → skip
- This catches both exact dupes ("$0.46/day" x9) AND semantic dupes ("Cost is $0.46" vs "Daily spend approximately 46 cents") without needing embeddings
- Log the skip: `[Heartbeat] ${agentId}: skipped duplicate memory (${Math.round(similarity*100)}% overlap with existing)`
- **Known limitation:** Won't catch fully rephrased memories with different vocabulary. Acceptable — catches the 80% case (repeated stats, repeated learnings). Embedding-based dedup is a future option if this proves insufficient.

**Also enforce the existing MAX_MEMORIES_PER_AGENT (20 per constants.js):**
- If agent has 20+ memories, evict oldest before adding new
- This FIFO is supposedly in place but memories are accumulating past 20 — verify enforcement

**Files:**
- `api/companyHeartbeat/agent-runner.js` — memory save handler (~line 500-550)
- `api/companyHeartbeat/constants.js` — MAX_MEMORIES_PER_AGENT

**Expected result:** 40% fewer memories stored, cleaner context in future prompts, ~$50/month savings on wasted token processing.

---

## Phase 2: Per-Agent Prompt Routing (High Impact, Medium Risk)

**Problem:** Every agent gets all 23 context sections. Pixel sees Echo's social metrics. Cipher sees Pixel's design queue. 40-50% of each prompt is irrelevant.

**Fix in `api/companyHeartbeat/prompt-builders.js`:**

Create a routing table at the top of the file:

```javascript
const AGENT_CONTEXT_MAP = {
  nova:   ['core', 'campaigns', 'objectives', 'recentActivity', 'costSummary', 'productBriefs'],
  cipher: ['core', 'financeDigest', 'costSummary', 'campaigns'],
  pixel:  ['core', 'pixelVisualPerf', 'pixelDesignQueue', 'pixelProductVisual', 'pixelDesignGaps', 'productBriefs'],
  forge:  ['core', 'forgeOpsDigest', 'costSummary'],
  echo:   ['core', 'socialIntel', 'campaignVelocity', 'trendRadar', 'recentActivity', 'productBriefs', 'founderVoice'],
  scribe: ['core', 'recentActivity', 'contentPerf', 'campaignStatus', 'quillFeedback', 'founderVoice', 'productBriefs'],
  quill:  ['core', 'productFacts'],
  scout:  ['core', 'researchDemand', 'trendRadar', 'productBriefs']
};
```

In `buildHeartbeatPrompt()`, only include sections that appear in the agent's list. The `core` section includes: identity, seed memories, agent memories, tasks, workspace state.

**Target:** Reduce average prompt from ~27K tokens to ~15-18K tokens per agent.

**Pre-step:** Before changing any routing logic, add a one-liner to `agent-runner.js` after line 275 that logs prompt.length for every agent on every run (not just threshold breaches):
```javascript
context.log('[Heartbeat] ' + agentId + ': prompt ' + prompt.length + ' chars (~' + _estimatedTokens + ' tokens)');
```
Ship this logging alone first, let 2-3 heartbeats run to capture baseline numbers, then ship the routing changes. This gives a clean before/after comparison.

**Files:**
- `api/companyHeartbeat/agent-runner.js` — add always-on prompt size logging (line ~275)
- `api/companyHeartbeat/prompt-builders.js` — buildHeartbeatPrompt function

**Expected result:** 40% smaller prompts, more room for agent reasoning, fewer irrelevant distractions, lower cost per cycle.

---

## Phase 3: Surface Gate Blocks to Agents (Medium Impact, Low Risk)

**Problem:** Agents attempt actions, get silently blocked by server-side gates, waste a cycle. They never learn the constraint because the block isn't in their next prompt.

**Fix in `api/companyHeartbeat/agent-runner.js`:**

Instrument the **top 5 most-hit gates** first (not all 69). Ranking is from code review observation (gate density + known agent behavior patterns), not from measured block counts. Verify by checking `guardrails` counters in the last 5 heartbeatRuns before coding — if the actual top blockers differ, instrument those instead.

Likely top 5 based on audit:
1. Orphan task gate (missing objective_id/campaign_id)
2. Task ceiling (50 active tasks)
3. Social promo gate (missing reviewed_copy)
4. Exact/fuzzy duplicate
5. Research ceiling (5 active research tasks)

When an action is blocked by any instrumented gate, collect the block reason:
```javascript
blockedActions.push({
  action: action.type,
  target: action.summary,
  reason: 'Task ceiling reached (50 active tasks)'
});
```

In `prompt-builders.js`, add a new section (only if blockedActions is non-empty):
```
── BLOCKED ACTIONS FROM LAST CYCLE ──
Your previous actions were blocked by system rules:
- create-task "Draft LinkedIn post" → BLOCKED: Task ceiling reached (50 active tasks)
- create-social-action → BLOCKED: Missing reviewed_copy on parent task
Do not retry these actions unless the underlying constraint has changed.
```

**Files:**
- `api/companyHeartbeat/agent-runner.js` — gate enforcement sections
- `api/companyHeartbeat/prompt-builders.js` — new blocked-actions section
- `api/companyHeartbeat/index.js` — pass blocked actions from previous run into next cycle (store in heartbeatRuns)

**Expected result:** Agents stop wasting cycles on impossible actions. Self-correcting behavior.

---

## Phase 4: Campaign Outcome Gates (High Impact, Medium Risk)

**Problem:** Auto-replenish spawns tasks indefinitely with no quality check. "Build in Public v2" will generate 30+ posts by May regardless of engagement.

**Fix in `api/companyHeartbeat/index.js`**, in the campaign auto-replenish logic (~line 305):

**Pre-implementation data audit required.** Before coding, verify:
1. Do completed tasks have a link back to the social action that was created from them? (Check `_social_action_created` flag or `actions` store for task references)
2. Do social actions in the `actions` store have engagement data populated? (Check `socialMetricsEvents` for action-level metrics)
3. If engagement data lives in `socialEngagementSnapshots` or `socialWeeklySnapshots`, is it per-post or aggregate?

If per-task engagement data does NOT exist in the current data model, the engagement gate can't be built as-is. Fallback: gate on **approval rate** instead (CEO approves/rejects/revises — that data IS in the approval queue).

**Assuming data exists or using approval-rate fallback:**

Before creating a new task for a campaign, check the last 3 completed tasks for that campaign:
- If all 3 had CEO revisions requested → pause replenish, add system comment "Campaign paused: 3 consecutive revisions"
- If 0 of last 3 resulted in approved actions (all rejected or no action created) → slow replenish to 2x cadence
- If campaign has produced 10+ tasks with 0 approved actions → auto-pause campaign with CEO notification

This doesn't block manual task creation — it only gates the automatic replenish.

**Files:**
- `api/companyHeartbeat/index.js` — campaign auto-replenish section (~lines 305-400)
- Data audit targets: `actions`, `approvalQueue`, `socialMetricsEvents`

**Expected result:** Campaigns that aren't producing value slow down or pause. CEO attention directed to strategy, not treadmill maintenance.

---

## Phase 5: Collapse Memory Layers (High Impact, High Risk)

**Problem:** 14+ distinct memory/state concepts create maintenance burden, inconsistent patterns, and cognitive overload for both agents and developers.

**Consolidate to 5 core layers:**

| Layer | Contains | State Keys |
|-------|----------|------------|
| **Agent Working Memory** | Per-agent insights, learnings, observations | `agentMemories` (keep) |
| **Agent Seed Memory** | Role definition, voice guidelines, strategic directives | `agentSeedMemories` (keep) |
| **Org Memory** | Governance, operating constitution, strategic decisions | `workspaceMemory` (keep) |
| **Live Intel** | Social metrics, cost data, research findings, trends | Merge: `runtimeMemory` + `researchIntel` + `socialWeeklySnapshots` → `liveIntel` |
| **Audit Trail** | Heartbeat runs, governance log, action log | Keep as-is: `heartbeatRuns`, `governanceLog`, `actionAuditLog` |

**What gets merged:**
- `runtimeMemory` (social digest) + `socialWeeklySnapshots` + `socialMetricsEvents` + `socialEngagementSnapshots` + `socialAccountStats` → single `socialIntel` section within `liveIntel`
- `researchIntel` + `trendInsightsStore` → single `researchIntel` section within `liveIntel`
- `workspaceMemory` stays as-is (only 2 entries, foundational)

**What gets removed:**
- Separate trend stores (`trendRadarStore`, `trendInsightsStore`, `trendActionsStore`) → fold into `researchIntel`

**This is a multi-session refactor.** Phase 5 should be planned separately with its own spec after Phases 1-4 are validated.

---

## Phase 6: Wake Up Idle Agents (Medium Impact, Low Risk)

**Problem:** Pixel and Forge produce 0 actions for consecutive heartbeats.

**This phase is investigation-first, then targeted fixes.**

**Step 1 — Diagnose (read-only):**
- Read `prompt-builders.js` Pixel contract section: what conditions trigger proactive design task creation?
- Read `ops-intel.js` stalled agent detection: what's the threshold? Is `zeroActionRuns` being computed correctly from recent heartbeatRuns?
- Fetch last 5 heartbeat runs and check: does Forge's ops digest show Pixel as stalled? If yes, why isn't Forge acting? If no, the detection is broken.

**Step 2 — Fix based on diagnosis (one of these):**
- If Pixel's contract conditions are never met (e.g., all campaigns have design tasks): lower the threshold or add "idle mode" behavior — when 0 tasks assigned, audit hero images >30 days old
- If Forge's stall detection isn't firing: fix `ops-intel.js` `zeroActionRuns` computation (likely reading wrong data format — known issue from audit: `r.agentResults` vs `r.perAgent`)
- If Forge detects stall but doesn't act: check if Forge's prompt includes the stall data and if the directive creation gate allows it

**Files:**
- `api/companyHeartbeat/ops-intel.js` — stalled agent detection (~line 80-120)
- `api/companyHeartbeat/prompt-builders.js` — Pixel contract, Forge contract
- `api/companyHeartbeat/agent-runner.js` — system_directive creation gate

**Expected result:** Pixel and Forge produce at least 1 action within 3 heartbeats of this fix shipping.

---

## Phase 7: Simplify Agent-Specific Branches (Medium Impact, High Risk)

**Problem:** 42 if-else branches in agent-runner.js make the system unmaintainable and impossible to add a 9th agent.

**Fix:** Extract agent-specific behavior into a config table:

```javascript
const AGENT_CAPABILITIES = {
  nova:   { canPropose: ['objective', 'campaign'], canDirective: true, canLifecycle: true },
  echo:   { canSocialAction: true, canPropose: ['campaign'], canExperiment: true },
  scribe: { canPublish: true, canSocialCopy: true, canBlueskyReply: true },
  quill:  { canReview: true, maxWritesPerDay: 5 },
  scout:  { canResearch: true, canDiscover: true, maxResearchTasks: 5 },
  pixel:  { canGenerateImage: true, canDesignAudit: true },
  forge:  { canDirective: true, canOpsBreakfix: true, canRunbook: true },
  cipher: { canFinanceReport: true, canBudgetAlert: true }
};
```

Replace if-else chains with capability lookups:
```javascript
if (AGENT_CAPABILITIES[agentId]?.canSocialAction) { ... }
```

**This is a large refactor.** Should be done incrementally — start with the top 10 most-duplicated branches, extract to config, validate, then continue.

**Files:**
- `api/companyHeartbeat/agent-runner.js` — all 42 branches
- New: `api/companyHeartbeat/agent-capabilities.js` — config table

---

## Phase 8: Memory TTL and Validation (Medium Impact, Medium Risk)

**Problem:** Memories never expire. A false assertion from Week 1 still consumes tokens in Week 3.

**Fix:** Add tiered TTL to agent memories:

```javascript
// constants.js
const MEMORY_TTL_DAYS = {
  short: 3,    // Cost figures, daily metrics, transient stats
  default: 14, // Task learnings, execution insights, campaign observations
  long: 60     // Strategic learnings, platform insights, CEO feedback patterns
};
```

- Each memory gets a TTL category based on content heuristics:
  - Contains `$`, cost/spend/budget keywords → `short` (3 days)
  - Contains strategic/learning/insight keywords → `long` (60 days)
  - Everything else → `default` (14 days)
- On each heartbeat, prune memories older than their TTL
- When an agent re-records a similar memory (caught by Phase 1 dedup), reset the TTL instead of creating a duplicate
- **Implementation note:** Phase 1 ships first without TTL. When implementing Phase 8, add a TTL reset hook to the Phase 1 skip path — when dedup catches a match, update the existing memory's `createdAt` timestamp (or add an `expiresAt` field) so it stays alive. The Phase 1 dedup function needs to return the matched memory reference, not just skip silently.
- Seed memories have no TTL (permanent until CEO updates)

**Files:**
- `api/companyHeartbeat/agent-runner.js` — memory save + prune + back-reference Phase 1 skip path
- `api/companyHeartbeat/constants.js` — MEMORY_TTL_DAYS

---

## Implementation Order

| Phase | Risk | Effort | Impact | Priority |
|-------|------|--------|--------|----------|
| 1. Memory dedup | Low | Small | High | **Do first** |
| 2. Prompt routing | Medium | Medium | High | **Do second** |
| 3. Surface gate blocks | Low | Small | Medium | **Do third** |
| 4. Campaign outcome gates | Medium | Medium | High | **Do fourth** |
| 6. Wake idle agents | Low | Small | Medium | **Do fifth** |
| 8. Memory TTL | Medium | Small | Medium | **Do sixth** |
| 5. Collapse memory layers | High | Large | High | Plan separately |
| 7. Simplify branches | High | Large | Medium | Plan separately |

Phases 1-4 and 6, 8 can be done in 2-3 sessions. Phases 5 and 7 are multi-session refactors that need their own specs.

---

## Rollback Strategy

Each phase ships as a **separate commit**. If a phase causes regressions:
- `git revert <commit>` restores the previous behavior
- Azure Blob state (agentMemories, heartbeatRuns, etc.) is NOT affected by git reverts — only code changes roll back
- If Phase 2 (prompt routing) causes agents to miss context they actually needed, revert and add the missing section to that agent's routing list before re-shipping

**Most likely rollback scenario:** Phase 2 removes a context section an agent silently depended on. Symptom: agent produces 0 actions or generic actions after the change. Fix: check heartbeatRuns perAgent for the affected agent, compare to pre-change run, add back the missing section.

---

## Baselines (measured 2026-04-12)

These are from the live system audit, not estimates:
- **Memory duplicates:** Cipher 9/9 identical, Scribe 8/8 identical, Echo 3/20 duplicates = ~40% system-wide duplicate rate
- **Prompt tokens:** Estimated 25-30K per agent (based on `prompt.length / 4` in agent-runner.js logs — known to be ~40% inaccurate, real tokens likely 18-22K)
- **Pixel actions/3 cycles:** 0. **Forge actions/3 cycles:** 0.
- **Blocked actions:** 4 blocks across 3 cycles across all agents = ~9% of total attempted actions (4 blocked / ~45 attempted)
- **Active campaigns:** 2. **Active tasks at time of audit:** ~8-10.
- **Heartbeat cost:** ~$0.46/day (Cipher's own measurement, confirmed via geminiUsage)

---

## Verification

After each phase:
1. Trigger a manual heartbeat: `curl -X POST https://ambientpixels-nova-api.azurewebsites.net/api/company-heartbeat-trigger -H "Content-Type: application/json" -H "x-company-secret: pixelpusher"`
2. Check heartbeatRuns for the new run — verify agents produced actions
3. Check agentMemories — verify no new duplicates (Phase 1)
4. Check prompt token estimates in logs — verify reduction (Phase 2)
5. Check next run's blocked actions section — verify agents see their blocks (Phase 3)
6. Verify Pixel and Forge produce at least 1 action within 3 heartbeats (Phase 6)

---

## Success Criteria

- Agent memory signal-to-noise ratio: 30% → 80%+
- Average prompt size: **40% reduction from baseline** (measured by `prompt.length` in agent-runner.js logs — same metric as baseline, ~40% inaccurate for real tokens but consistent for relative comparison)
- Pixel/Forge actions per day: 0 → 3+
- Campaign tasks with 0 engagement: auto-slow instead of infinite replenish
- Blocked actions repeated next cycle: current ~9% → <2%
