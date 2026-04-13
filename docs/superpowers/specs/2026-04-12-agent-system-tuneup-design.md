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
- Normalize both strings (lowercase, trim, collapse whitespace)
- If Levenshtein similarity > 85% with any memory from the last 24 hours → skip
- Log the skip: `[Heartbeat] ${agentId}: skipped duplicate memory`

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

**Files:**
- `api/companyHeartbeat/prompt-builders.js` — buildHeartbeatPrompt function

**Expected result:** 40% smaller prompts, more room for agent reasoning, fewer irrelevant distractions, lower cost per cycle.

---

## Phase 3: Surface Gate Blocks to Agents (Medium Impact, Low Risk)

**Problem:** Agents attempt actions, get silently blocked by server-side gates, waste a cycle. They never learn the constraint because the block isn't in their next prompt.

**Fix in `api/companyHeartbeat/agent-runner.js`:**

When an action is blocked by any gate, collect the block reason:
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

Before creating a new task for a campaign, check the last 3 completed tasks for that campaign:
- If all 3 had CEO revisions requested → pause replenish, add system comment "Campaign paused: 3 consecutive revisions"
- If 0 of last 3 got any social engagement (likes + comments + reposts = 0) → slow replenish to 2x cadence
- If campaign has produced 10+ tasks with 0 approved actions → auto-pause campaign with CEO notification

This doesn't block manual task creation — it only gates the automatic replenish.

**Files:**
- `api/companyHeartbeat/index.js` — campaign auto-replenish section (~lines 305-400)

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

**Pixel fix:** Pixel's design director contract says to proactively create tasks for campaigns missing visual assets. Check if this is actually triggering. If Pixel has no tasks and no campaigns need design, Pixel should:
- Audit existing hero images for staleness (older than 30 days)
- Propose design refreshes for top-traffic product pages

**Forge fix:** Forge's ops watchdog has stalled-agent detection but may not be triggering. Check `ops-intel.js` — is the stall detection actually running? Forge should be creating system directives for stalled agents (Pixel is stalled — Forge should notice and act).

**Files:**
- `api/companyHeartbeat/ops-intel.js` — stalled agent detection
- `api/companyHeartbeat/prompt-builders.js` — Pixel and Forge contracts

**Expected result:** Pixel and Forge become proactive instead of idle.

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

**Fix:** Add TTL to agent memories:
- Default TTL: 14 days (configurable per agent in constants.js)
- On each heartbeat, prune memories older than TTL
- When an agent re-records a similar memory, reset the TTL (memory is refreshed)
- Seed memories have no TTL (permanent until CEO updates)

**Files:**
- `api/companyHeartbeat/agent-runner.js` — memory save + prune
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
- Average prompt tokens: 27K → 15-18K
- Pixel/Forge actions per day: 0 → 3+
- Campaign tasks with 0 engagement: auto-slow instead of infinite replenish
- Blocked actions repeated next cycle: current ~9% → <2%
