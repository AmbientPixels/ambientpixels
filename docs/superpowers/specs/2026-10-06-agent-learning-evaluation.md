# Agent learning evaluation: does the fleet learn from real outcomes?

**Date:** 2026-10-06, 02:55 to 03:30 UTC (Fable 5.1, read-only session)
**Inputs:** production state read at ~02:58 UTC (heartbeatRuns, objectives, approvalQueue, agentExperiments, agentMemories, agentSeedMemories, agentRegistry, campaigns, tasks, actions, outcomeSnapshots, governanceLog, runtimeMemory, systemConfig, companyStrategy, emergenceDigest, agentRewards endpoint), the pre-restart backup, and the code under `api/`.
**Status:** evaluation and proposal. Nothing was changed, deployed, or written to production.
**Rule applied throughout:** a failed or absent read is reported as *unmeasured*, never as zero.

---

## 0. Verdict in six lines

1. **The CEO's claim is right, and it is worse than stated.** Of 57 runtime memories, **zero** reference a real person using a product. 13 are about the 3-action rate limit, 13 are the agents arguing about Milestone Herald, 10 are quality-gate rejections, 2 literally read "Core belief: string".
2. **Nothing the fleet learns changes future behaviour through code.** Every learning system ends in prompt text (a memory line, a digest block, a reflection callout). The only code-enforced consequences are the proposal gates, the privilege tier (±1 action slot), and the quality gate, and none of those read an outcome.
3. **Three of the learning systems are measuring their own plumbing.** Experiment "verdicts" measure CEO absence (approval rate over n=3 while nobody was approving). `avgLikesPerPost` sums cumulative poll samples (the 22x bug, again). The emergence monitor has not run since 2026-08-04.
4. **Experiment verdicts have never reached an agent.** They are pushed into memory *after* the only save of `agentMemories` in the cycle, so all 34 conclusions were lost while the "already logged" flag was persisted. Performance insights die the same way.
5. **The doctrine layer still says "REVENUE FIRST / paying customers" in four places** (global seed, every per-agent seed, every registry doctrine, and a hardcoded Echo block). The 2026-10-06 retarget changed one of five sources. That is why 62 of the last 100 runs reasoned about paying customers and 7 about anything qualified.
6. **What to build:** one outcome ledger keyed by `betKey`, written by code at campaign end, read by code at proposal time, with a sample floor and a verdict with denominators. Retire the three fake signals. Everything else below is detail.

---

## 1. First heartbeat after the restart

**The 06:00 UTC run had not happened at the time of this session (02:58 to 03:30 UTC).** The latest entry in `heartbeatRuns` is `cycle-1791244800039` at 00:00 UTC, which ran *before* the 01:45 restart. So every item below is the pre-restart baseline, and the 06:00 reading is **unmeasured**.

| Check | 00:00 UTC run (pre-restart baseline) | 06:00 UTC run |
|---|---|---|
| `backlogPressure` | activeTasks **58 / cap 50**, overdue 54, oldest 1375h, newTasksThisCycle 0 | unmeasured |
| `guardrails.taskCeilingBlocked` | **2** this run; **160** summed over the 100 runs 09-11 to 10-06 | unmeasured |
| Scribe `promptDegraded` | **true**, and true in **100 of 100** runs in the window | unmeasured |
| Per-agent reasoning | Nova: "serving our goal of acquiring the first paying customer". Echo: "contradicts my primary goal of acquiring paying customers". Over 100 runs: **62 mention "paying customer", 7 mention "qualified"**. | unmeasured |
| `obj-build-public.measuredValue` | **absent** (key not present). Retargeted at 02:27 UTC; no cycle has run since. `criteria.baseline` is `null`. | unmeasured |
| `approvalQueue` pending | **0**. All 100 retained entries are `expired` (75 bluesky_reply, 10 action, 10 campaign_proposal, 4 objective_proposal, 1 pace escalation). The last campaign proposal before the wipe was Echo's "Cold Start Conversion: First Paying Customer", north star `paying_customers`, trigger `declining-platform`, no hypothesis, evidence, kill rule or expected effect. | unmeasured |

Two things the 00:00 run already shows that will not fix themselves at 06:00:

- **Nova, Scribe and Quill all cite "paying customer" or Milestone Herald in their reasoning** even though both are gone. The reasons are in section 3.7 (stale doctrine in four sources).
- **Skipped agents in 100 runs:** Scout 100, Vale 100, Pixel 98, Cipher 94, Forge 85, Quill 40. "No assigned tasks or mentions" is the skip reason every time. These are not idle agents; they are agents with no lane.

Check script for after 06:07 UTC (read-only):

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=heartbeatRuns" -o hb.json
node -e "const r=JSON.parse(require('fs').readFileSync('hb.json')).value.at(-1);console.log(r.runId,r.startedAt,JSON.stringify(r.backlogPressure),JSON.stringify(r.guardrails),'scribeDegraded',r.perAgent.scribe&&r.perAgent.scribe.promptDegraded);Object.entries(r.perAgent).forEach(([a,v])=>console.log(a,'|',(v.reasoning||'').slice(0,220)))"
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=objectives" -o obj.json
node -e "const o=JSON.parse(require('fs').readFileSync('obj.json')).value.find(x=>x.id==='obj-build-public');console.log('measuredValue',o.measuredValue===undefined?'UNMEASURED':o.measuredValue,o.measuredAt)"
```

---

## 2. Testing the claim

**Claim:** the fleet records a lot about itself, but almost none of it is tied to whether a real person used a product because of what an agent did; its learning signals are approval rate, likes, and self-assessment.

**Measured against production:**

| Store | What it holds | Tied to a person using a product? |
|---|---|---|
| `agentMemories` (57) | 13 rate-limit notices, 13 Milestone Herald arguments, 10 quality-gate rejections, 2 "Core belief: string", 1 CEO edit, 1 weekly report, 1 campaign-pace note, 2 experiment announcements, 14 reflections/decisions about voice violations | **0 of 57** |
| `agentExperiments` (38, all Echo) | `baselineMetric {ceoApprovalRate, avgLikesPerPost}`, `experimentMetric {ceoApprovalRate, samples}` only | **0 of 38**. `taskIds` is `[]` on every one. |
| `outcomeSnapshots` (168 posts, 07-07 to 09-01) | likes/comments/reposts/views/clicks at t0/t1/t7, plus a `downstream` block | **Partly.** `downstream` counts `paywall_shown`, `checkout_started`, `report_unlocked`, `email_captured`, `blogViews`, `formSubmits`. Totals across all 168: blogViews 11, everything else 0, clicks 0. It does **not** count `scan_completed` or `run_delivered`. |
| `agentRewards` | XP by `task_done` (1), `social_ship` (2), `engagement`, `assist`, `review_done`, `proposal_approved` (8), plus a revenue lane | Revenue lane exists, but `first_sale` on Echo and Scribe came from the CEO's refunded self-purchases (`revenueTotals.unattributedCents: 39800`), and `scansAttributed: 35` on Echo is mostly fallback credit (section 3.10). |
| `reflectionDigest` | role drift, decision patterns, strategy fatigue, repeated failures | `decisionPatterns` is empty for 8 of 9 agents; `strategyFatigue` empty for all 9; `repeatedFailures` empty for all 9. |
| `emergenceDigest` | proposal rate, reject rate, churn | last generated **2026-08-04**. |

**Verdict: the claim holds.** The one honest outcome signal that exists (`outcomeSnapshots.downstream`) is wired to the wrong events and to no decision. The fleet's scoreboard is approval, likes, task counts, and self-report, and two of those are measured wrong.

The best counter-evidence I found: Quill's memory "Data from 107 samples shows posts starting with a question on Bluesky have a median engagement of 0." That is a real, denominated finding (it matches `outcomeDigest.perHook`: bluesky|question n=107 median 0). It is also engagement, not usage, and Quill cannot act on it; Quill reviews copy it did not brief.

---

## 3. System-by-system audit

Format for each: signal → honest? denominator? gameable? → changes behaviour by code or by prompt → loop closed? → verdict.

### 3.1 Memory stack L1–L9 (`api/memoryStack/index.js:23`)

- **Signal:** none of its own. It is an injection order: personality, doctrine, seeds, runtime memories, CEO notes, site digest, research, configs, weekly reports. The explorer endpoint is a *viewer*; it does not decide what gets injected.
- **Honest:** it is a map, so the question is whether the layers are current. L2 (registry doctrine) and L3 (seeds) are both stale (3.7). L7 research intel has 20 entries with no dates or status fields. L9 weekly reports is **not a valid state key** (the read returned the VALID_KEYS error), so the explorer's L9 reads as empty whether or not reports exist.
- **Code vs prompt:** prompt only, by design.
- **Loop:** not applicable; it is a bus, not a loop.
- **Verdict: keep as a viewer.** Fix L2/L3 content (3.7).

### 3.2 Runtime memories + consolidation (`agentMemories`, `api/memoryConsolidate/index.js`)

- **Signal:** whatever the agent chooses to `remember`, plus four system writers: rate-limit (`auto:rate-limit`), quality-gate rejections (`auto:quality-gate`, `agent-runner.js:3598-3610`), campaign pace, CEO edits. Experiment verdicts and performance insights are also meant to land here but never do (3.5, bug B2).
- **Honest, denominator, gameable:** self-report with no denominator. Not gamed, but **swamped**: 13 of 57 are "I emitted more than 3 actions last cycle". Echo's 9 consolidated beliefs are 6 rate-limit notices, 2 copies of "my post was rejected for lacking offer details", and 1 "Core belief: string".
- **Code vs prompt:** prompt only. `prompt-builders.js:1393` injects **the last 10 memories by array position**, no type weighting, no relevance. For Echo today that is nine rate-limit beliefs and one experiment announcement. The write-time dedup gate (`agent-runner.js:5373-5425`, similarity ≥ 0.75) and the FIFO cap of 50 (`constants.js:139`) are the only code. TTLs: `constants.js:152-161`, 14 to 90 days.
- **Consolidation** (`memoryConsolidate/index.js`): clusters by `type | first 30 chars | top-3 words` (line 53), keeps the newest entry's text as the "core belief" (line 115). It cannot tell a lesson from a log line, which is why rate-limit spam becomes "beliefs" with a 90-day TTL. The "string" beliefs are a cluster whose keeper's `text` was literally `string` (a schema placeholder that passed the write gate), consolidated from 5 such entries.
- **Loop:** signal → store → prompt. Nothing reads a memory in code. **Open.**
- **Verdict: keep the store, replace the selection, gate the writers.** (a) Inject by type priority, not recency: verdicts and CEO corrections first, then constraints/decisions, then at most 2 feedback entries. (b) Rate-limit notices become a one-line counter in the prompt, never a memory. (c) Reject `text.length < 20` and `text === 'string'` at write time. (d) Consolidation skips `source: auto:*`.

### 3.3 Seed memories (`agentSeedMemories`, L3)

- **Signal:** CEO-curated text. No feedback.
- **Honest:** currently **false**. All ten keys (`_global` plus nine agents) open with `## PRIORITY: REVENUE FIRST` (CEO directive, 2026-07-31). Scribe's seed still says "Mention the $199 teardown". Echo's says "You are the conversion owner. Funnel: public scans -> report sales -> teardowns." These are injected under the heading "CEO KNOWLEDGE BASE — always follow these instructions" (`prompt-builders.js:1385`), *above* the agent's memories, every cycle.
- **Code vs prompt:** prompt. There is no mechanism to retire a seed, and no date on a seed.
- **Verdict: rewrite now, then date-stamp.** This is the single cheapest fix in the document and probably the one with the largest effect on proposal content. Add `validUntil` to seed blocks and have the builder drop expired ones with a log line, so a directive cannot outlive the strategy it served.

### 3.4 Self-reflection (`reflection-intel.js`, `reflectionWriterCron`, `awarenessDigest`)

- **Signal:** `agentDecisions` (empty in practice: `decisionPatterns` is `[]` for 8 of 9 agents), outcome snapshots (for "strategy fatigue": `[]` for all 9), task comments (for "repeated failures": `[]` for all 9), and the agent's own role-adherence mix.
- **Honest:** it is honest about having nothing: the digest says `reflectionOverdue: true, reflectionDueDays: 999` for Nova, Cipher, Pixel, Forge and Echo, meaning no reflection has ever been written for them.
- **The writer cron has left no trace.** `reflectionWriterCron` (15:30 UTC daily) writes memories with `source: 'auto:reflection'` and a 30-day TTL (`reflectionWriter.js:4-7`). There are **zero** such memories in production, and zero in the pre-restart backup. The 8 reflections that do exist were written by Scribe and Quill themselves via `remember`. Either the cron is disabled in Azure (`AzureWebJobs.reflectionWriterCron.Disabled`), the demo guard skips it, or it fails before saving. **I could not read the Azure app settings (permission classifier blocked `az functionapp config appsettings list`).** This needs the CEO to check or to grant that read.
- **Code vs prompt:** prompt only ("YOUR SELF-REFLECTION" block, `reflection-intel.js:375-459`). Quill's own reflection says it best: "my repeated attempts to fix this through feedback have failed." Nothing it concludes moves a lever.
- **Verdict: theatre as built. Freeze the writer cron (or confirm it is already dead) and delete the prompt block until there is an outcome to reflect on.** Keep `classifyDrift` (role adherence) as a monitoring number only. The reflection cost is small; the harm is that it manufactures confident narrative from empty inputs.

### 3.5 Experiments (`agentExperiments`, `performance-intel.js:893-938`, `outcome-intel.js:116-151`)

Four separate problems, each verified in data and code.

**(a) The verdict measures CEO absence.** `evaluateExperiments` (`performance-intel.js:893`) counts actions carrying the `experiment_tag`, and the "experiment metric" is `approved / submitted` over those actions (`:920-930`). `EXPERIMENT_MIN_SAMPLES = 3`, threshold ±10% (`constants.js:388-389`). With the CEO away, every submitted action sits pending, `expRate = 0`, improvement = -1, result **discard**. That is 27 of the 34 "discard" verdicts. The experiment "linkedin-bip-negative-metrics" was *discarded* after 3 actions in 1 day (09-08 to 09-09). No post was published.

**(b) Baselines are the 22x cumulative bug, reintroduced.** `baselineMetric.avgLikesPerPost` is copied from `performanceDigest.agents[echo].avgLikesPerPost` at experiment creation (`agent-runner.js:5496`). That number is computed in `performance-intel.js:325-345` by iterating every `socialEngagementSnapshots` row in a 30-day window and doing `likes += m.likes` per post, where each row is the post's *cumulative lifetime* count at poll time. Then `:394` divides by the number of posts. Measured: Echo `avgLikesPerPost 35`, `topPostLikes 404`; Scribe `topPostLikes 60`. Truth from `outcomeSnapshots` t7 samples: total likes across all 168 posts = **34**, best post = **4**. Baselines rose 8 → 37 between 08-19 and 09-30 while publishing fell to zero after 09-01, because the remaining in-window posts kept being polled. **The baseline measured the poll schedule.** Same class as `project_engagement_inbox_and_kpi_inflation`, fixed in `socialEngagement` on 08-09 and never fixed here. `socialIntel.engagement.byPlatform.bluesky` (likes7d 40 on posts7d 1, against a best live post of 4) looks like the same defect.

**(c) Two verdict systems contradict each other and only the wrong one reaches the agent.** `outcome-intel.js:22-26` defines honest gates (≥10 samples, ≥5 per arm, |effect| ≥ 0.15) on t7 engagement. Its result for the same 38 experiments: **1 discard, 37 inconclusive**, and `treatmentSamples: 0` for 20 of them (no tagged post ever published). The agent's prompt block (`performance-intel.js:942-958`) shows the approval-rate verdicts: "DISCARD: linkedin-bip-negative-metrics — approval rate: 0%". The honest system's output is injected too (`prompt-builders.js:1430-1437`) but only when `outcomeDigest.totals.complete > 0` and only for Echo, so Echo sees both and they disagree.

**(d) Verdict memories have never been saved.** `index.js:4097` is the only `setState('agentMemories', …)` in the cycle. The experiment-conclusion memory is pushed at `:4167`, the engagement verdict at `:4245`, and the daily performance insight at `:4148`, all *after* the save. `_memoryLogged = true` is set at `:4174` and persisted with `agentExperiments` at `:4269`, so the write is never retried. Confirmed by data: 34 concluded experiments, **0** memories with `source: auto:experiment-conclusion`, `auto:experiment-verdict`, or `auto:performance-reflection`, in production or in the backup.

Also: `prompt-builders.js:2362` says "MANDATORY: If ZERO experiments are running, your FIRST action MUST be to start one." That rule, not curiosity, produced 38 experiments on 141 followers.

- **Verdict: delete `evaluateExperiments` and the MANDATORY rule. Keep `outcome-intel`'s gates and move experiments inside the bet ledger (section 7).**

### 3.6 Outcome attribution (`outcome-intel.js`, `outcomeRefresh`, `outcomeSnapshots`)

- **Signal:** per-post engagement at t0/t1/t7 (honest: point samples differenced by lag, `outcomeRefresh/index.js:168`), plus `downstream` counts joined on `props.utm_content === actionId` (`:269-330`).
- **What is right:** this is the only honest, denominated, per-action pipe in the system. `buildActionAttributionMap` (`outcome-intel.js:273-295`) already resolves action → parent task → `campaign_id`, and `actionsArchiver` persists that index for archived actions.
- **What is wrong, three things:**
  1. `PA_EVENT_MAP` (`outcomeRefresh/index.js:287-292`) maps only `paywall_shown`, `checkout_started`, `report_unlocked`, `email_captured`. **`scan_completed` and `run_delivered`, the two events that define `qualified_uses_week`, are not counted per action.** So the north star cannot be attributed to a post today even though the UTM is there.
  2. `snapshot.campaignId` is `null` on **168 of 168** snapshots, and `perCampaign` (`outcome-intel.js:183`) filters on that field, so every campaign shows `postsPublished: 0`. The resolver that would fix it is twenty lines below in the same file and is only used for revenue.
  3. The "YOUR RECENT OUTCOMES" block (`prompt-builders.js:1422-1483`) is Echo-only for experiments and shows campaign outcomes that are all zero.
- **Code vs prompt:** prompt only. Nothing gates on an outcome.
- **Verdict: this is the foundation. Fix the three items above, and it becomes the ledger's data source.** Two of the three are one-line changes in files that are not on the do-not-touch list.

### 3.7 Performance digest (`performance-intel.js`, `runtimeMemory.agentPerformance`) and the stale doctrine

- **Signal:** `ceoApprovalRate`, block rate, handoff pass rate, task duration, `avgLikesPerPost`, `qualityScore` (a weighted blend, `:548-620`).
- **Honest:** `ceoApprovalRate` is 0 for every agent (nobody approved anything in 30 days; "pending counts as submitted-not-approved" makes an absent CEO read as a 0% agent). `blockRate` reads the under-counting field (`project_action_block_counting`). `avgLikesPerPost` is bug B1. `qualityScore` is built from those (`:483`, `:580`, `:616`), so Echo's quality score is 0 and Scribe's is 43 for reasons that have nothing to do with their work.
- **Code vs prompt:** prompt only (`_buildPerformancePromptBlock`, `:655-800`). It tells Scribe "0% approved" every cycle, which Scribe then writes into reflections ("0% CEO approval rate ... reveals a consistent failure to internalize core doctrines"). **The fleet is learning self-blame from a measurement of the CEO's calendar.**
- **The doctrine problem belongs here because this is where "paying customers" keeps being reinforced:**
  - `agentSeedMemories._global` and all nine agent seeds: "PRIORITY: REVENUE FIRST" (3.3).
  - `agentRegistry.agents[*].doctrine.coreQuestion`: Nova "Does this move a paying customer closer, or is it motion?", Echo "Did we add a paying customer?", Scout "who is the buyer, and what would make them pay this week?", Scribe "does that click reach a checkout?". These are L2 and are echoed into the reflection block as the agent's "core question" (`reflection-intel.js:385-387`).
  - `prompt-builders.js:2257-2262`, hardcoded for Echo: "You own the paying_customers north star. The company has NEVER made a sale ... propose-campaign should serve northStarMetric paying_customers, not follower counts."
  - The campaign proposal form (`prompt-builders.js:211`) asks for `northStarMetric` and SE-1 flags proposals that name none; nothing checks that the named metric is *current*.
  - Only `companyStrategy.northStar` was retargeted on 10-06.
- **Verdict: keep the digest as monitoring; stop injecting approval rate and likes into prompts until both are honest; retarget the three stale doctrine sources in the same commit.** A proposal naming a north star that is not in `companyStrategy.northStar` should be blocked, not flagged.

### 3.8 Emergence monitoring (`emergence-intel.js`, `emergenceCheckCron` 16:00 UTC)

- **Signal:** proposal velocity, CEO reject rate, fleet churn, capital red streak, approval depth, throughput collapse.
- **Observed:** `emergenceDigest.generatedAt = 2026-08-04T16:00:00Z`. One YELLOW signal from that day. The cron has not written in 63 days. Also, `rejectRate` only counts `resolvedBy === 'ceo'`, so during absence it is structurally empty.
- **Verdict: dead. Either fix the cron (check `AzureWebJobs.emergenceCheckCron.Disabled`) or delete the block from `prompt-builders` and the state key.** Of its signals, only "silent agent" and "throughput collapse" are useful, and the handoff's absence mode covers both more simply.

### 3.9 Rewards engine (`rewards-engine.js`, `agentRewards`, `rewardsEngineCron` every 30 min)

- **Signal (XP table, `:21-29`):** proposal_approved 8, action_approved 4, blog_ship 6, doc_ship 3, social_ship 2, task_done 1, review_done 1, engagement +1 per 25 (capped 8), assists, plus the revenue lane (sale, lead, scan).
- **Honest, denominator, gameable:**
  - `task_done` is the dominant source. Scribe: `tasksDone: 943`, XP 1063, Level 8, "champion" of the 2026-09 season. The tasks were largely fleet-minted (Milestone Herald, roast prospect tasks like `task_1791224700178_roast_pi25`). **An agent earns XP for completing work the system invented for it.** Pure activity proxy, fully gameable by any lane that mints tasks.
  - `first_sale` achievements on Echo and Scribe, `sales: 2` each: the CEO's refunded self-purchases (`revenueTotals.unattributedCents: 39800`, `project_revenue_seasons`).
  - `scansAttributed: 35` on Echo: `conversionFallbackAgents` (`:425-440`) credits any unattributed public scan to every agent who touched a conversion campaign in 30 days, at 50% (`:443-466`). Credit without attribution is noise with a leaderboard.
  - `engagement` XP reads `outcomeSnapshots` (`:483-493`), which is honest, but capped and tiny.
- **Code consequences (the one place rewards touch behaviour):** `privileges.tiers` by season XP (`:614-618`): top-2 vanguard +1 action slot, bottom-2 probation −1 slot and **no proposals** (`agent-runner.js:1365-1369`, `:5623`, `:5823`). Today: Scribe and Echo vanguard, **Vale probation** (Vale has never run, so its season XP is 0). `ladderStatus` (`safe/watch/squeezed/retirement_pending`, `:588-590`) has **no consumer anywhere outside rewards-engine.js**; nothing drafts a retirement. `budgetPlan` merit reallocation needs `MERIT_MIN_SIGNAL = 30` trailing revenue XP (`:80`), and trailing is 0 for all nine, so caps are flat.
- **Loop:** activity → XP → ±1 action slot. Closed, but around the wrong signal.
- **Verdict: freeze the ladder and tiers; rewire the engine to the ledger (section 6.4).** Delete `task_done` XP and the fallback credit. The engine's dedup and season machinery are good and worth keeping; the inputs are not.

### 3.10 Agent evolution: hire / retire / role-evolution proposals and escrow

- **Mechanism:** `propose-hire-agent`, `propose-retire-agent`, `propose-role-evolution` in `agent-runner.js:6393-6690` with validation, cost ceilings, fleet min/max (`constants.js:439-441`: protected nova+cipher, min 5, max 12), a 14-day reject cooldown, then CEO approval in `approveProposal/index.js:164-235`. Retirement archives the registry entry and freezes memories and reports into `agentInheritance` (`_utils/inheritanceEscrow.js`).
- **Signal:** whatever the proposing agent argues. There is no code input: no track record, no idle detector, no outcome. The escrow's own header: "Nothing reads these escrows yet" (`inheritanceEscrow.js:10-11`).
- **Observed:** `fleetChurn` 0/0/0 in 30 days; the only retirement ever is `testbot` (04-15). Scout and Vale have been skipped in 100 of 100 runs. Nothing proposes anything about that because the only trigger for a retirement proposal is an LLM deciding to write one, and the LLM never sees "this agent has not run in 25 days" as a number with a verdict.
- **Verdict: keep the proposal machinery and the escrow; add the code that feeds them** (section 6).

### 3.11 The revision loop

- **Mechanism:** CEO sets `revision_requested` or `rejected` with a note. For queue items, the note is stamped on the entry (`proposalDecide/index.js:148-149`) and mirrored to `capitalAllocation.decisionLog`. It reaches agents through the "RECENT CEO DECISIONS (last 7d)" line in the proposal block (`prompt-builders.js:188-200`) and, for actions, `ceoRevisionNotes` in the performance block.
- **Observed:** 0 `revision_requested` entries in the retained queue (cap 100) and 0 in the retained governance log (cap 500, 09-14 to 10-06). The pre-restart backup has none either. **The one proven training channel produced zero signal in the measured window**, because the CEO was absent, which is the design flaw: it depends on attention.
- **Durability:** 7 days in the prompt, then gone. A rejection reason never becomes a memory, a constraint, or a gate.
- **Verdict: keep, and make the reason durable.** A `rejected` or `revision_requested` with a note should write a `constraint` memory with `source: auto:ceo-revision` (that source is already exempt from pruning at `index.js:3043`) and, when the item is a campaign proposal, stamp the reason on the `betKey` in the ledger so the next proposal with that key must cite newer evidence.

### 3.12 Summary table

| System | Signal | Honest? | Denominator? | Fleet can game it? | Code consequence today | Loop closed? | Call |
|---|---|---|---|---|---|---|---|
| Memory stack L1–L9 | none (bus) | layers stale | n/a | n/a | none | n/a | keep as viewer |
| agentMemories + consolidate | self-report + system spam | no (swamped) | no | not gamed, swamped | dedup, cap, TTL | open | fix selection + writers |
| Seed memories | CEO text | **stale** | n/a | n/a | none | n/a | rewrite + date |
| Reflection | empty inputs | honest about nothing | no | n/a | none | open | freeze |
| Experiments | CEO approval n=3; inflated likes | **no** | no | yes (via approvals) | none | open, and verdicts never saved | delete, fold into ledger |
| Outcome attribution | engagement t7 + downstream | **yes** | yes | no | none | open | **foundation; fix 3 gaps** |
| Performance digest | approval, blocks, likes | no | partial | partial | none | open | monitoring only |
| Emergence | proposal/reject rates | dead since 08-04 | yes | no | none | dead | fix cron or delete |
| Rewards | task_done, ships, fallback credit | **no** | no | yes | ±1 action slot, proposal block | closed on wrong signal | freeze; rewire |
| Evolution + escrow | LLM argument | n/a | none | n/a | registry change on CEO approval | open (no inputs) | feed it |
| Revision loop | CEO note | yes | n/a | no | none; 7-day prompt line | open when CEO absent | make durable |

---

## 4. Bugs, ranked by what they distort

| # | Bug | Where | Effect | Fix size |
|---|---|---|---|---|
| B1 | Cumulative likes summed per poll | `performance-intel.js:325-345, 394-396` | avgLikes 35 / top 404 vs truth 4; experiment baselines; quality score; socialIntel likely too | small: read `outcomeSnapshots` t7 (already differenced) or difference per post as `socialEngagement` does |
| B2 | Memories pushed after the only save | `index.js:4097` vs `:4148, :4167, :4245` | 34 experiment verdicts and every performance insight lost; `_memoryLogged` persisted so never retried | small, **but in `index.js` (do-not-touch): needs explicit OK**. Move the three pushes above `:4097`, or add a second save after `:4269` |
| B3 | Experiment verdict = approval rate over n=3 | `performance-intel.js:893-938`, `constants.js:388-389` | 27 false "discard" verdicts; agents told to "stop using" approaches never tested | delete the function and the prompt block |
| B4 | Two verdict systems disagree; agent sees the wrong one | `performance-intel.js:942-958` vs `outcome-intel.js:116-151` | contradictory instructions in one prompt | delete the legacy block |
| B5 | `scan_completed` / `run_delivered` not in `PA_EVENT_MAP` | `outcomeRefresh/index.js:287-292` | north-star events never attributed per action | one map entry + one counter |
| B6 | `snapshot.campaignId` null on 168/168; `perCampaign` filters on it | `outcome-intel.js:183`; capture in `actionsExecute/executors/_utils/outcomeBaseline.js` | every campaign reads 0 posts | resolve via `buildActionAttributionMap` (same file, `:273`) |
| B7 | Stale doctrine in 4 sources | seeds; `agentRegistry.doctrine`; `prompt-builders.js:2257-2262`; SE-1 flag-not-block | 62/100 runs reason about paying customers | text edits + one gate |
| B8 | Memory injection = last 10 by position | `prompt-builders.js:1393` | Echo's whole memory block is rate-limit notices | small |
| B9 | Rate-limit notice written as a memory, then consolidated into a 90-day "belief" | `agent-runner.js:6938-6941`, `memoryConsolidate` | 13 of 57 memories; 7 of 11 consolidated beliefs | small |
| B10 | "Core belief: string" | write gate accepts placeholder text; `memoryConsolidate/index.js:115` | 2 beliefs with no content | small |
| B11 | Emergence cron dead since 08-04 | `emergenceCheckCron` / Azure setting | stale block in every prompt | verify Azure; fix or delete |
| B12 | Reflection writer has left zero memories ever | `reflectionWriterCron` / Azure setting | none (it would only add narrative) | verify Azure; freeze |
| B13 | XP for `task_done` on fleet-minted tasks; fallback conversion credit; refunded `first_sale` | `rewards-engine.js:27, :425-466, :529-532` | leaderboard measures volume; Vale on probation for never running | medium |
| B14 | `ladderStatus` has no consumer | `rewards-engine.js:588-590` | "retirement_pending" can never happen | wire to 6.3 or delete |
| B15 | Rejection reason lives 7 days in a prompt line | `proposalDecide/index.js:148-149`, `prompt-builders.js:188-200` | the training signal evaporates | small |
| B16 | MANDATORY experiment rule | `prompt-builders.js:2362` | 38 experiments on 141 followers | delete one line |
| B17 | `qualityScore` built from B1 and from "pending = not approved" | `performance-intel.js:436, :483-620` | Echo 0, Scribe 43, written into reflections as self-blame | stop injecting until inputs are honest |

---

## 5. Proposal A: learning from outcomes (the ledger)

Start from the plan's bet ledger (Phase 1 steps 5–8) and change four things: put the bet *on the campaign* instead of in a new blob (no `company-state` edit, no new VALID_KEY); make the proposal-time evidence block a **code-built** section, not a memory; add calibration; add belief retirement.

### 5.1 Data model (reuses `campaigns`, `runtimeMemory`, `agentMemories`)

```js
// on the campaign object (campaigns blob), written by validateBet at proposal time
bet: {
  betKey: 'search_page|resumeroast|google|job-seekers',   // mechanism|product|channel|audience, normalized
  mechanism: 'search_page',   // closed enum, see 5.2
  hypothesis: '...',
  evidence: [{ metric: 'qualified_uses_week', k: 0, n: 7, window: '30d', source: 'outcomeDigest.perChannel', asOf: '2026-10-06' }],
  expected: { metric: 'qualified_uses_week', delta: 3, byDay: 28 },
  kill:     { metric: 'campaign_qualified_uses', below: 2, byDay: 14 },
  scale:    { metric: 'campaign_qualified_uses', above: 6, byDay: 14 },
  proposedBy: 'scout', proposedAt: '...'
}
// written by scoreBet at end (killed | enddate | CEO complete)
verdict: {
  result: 'won' | 'lost' | 'killed' | 'inconclusive' | 'unmeasured',
  actual: { k: 4, n: 11 /* posts or pages */, people: 4, window: '28d', source: 'outcomeDigest.perCampaign' },
  expectedDelta: 3, calibrationError: 0.33,   // |expected - actual| / max(expected, 1)
  scoredAt: '...', scoredBy: 'code'
}
```

`runtimeMemory.betLedger` = the last 100 `{betKey, campaignId, mechanism, proposedBy, result, actual, calibrationError, scoredAt, ceoNote?}` rows, rebuilt each cycle from `campaigns` (so it can never drift from the source). `runtimeMemory` is already a valid key and already carries digests.

### 5.2 Code gates, in order of where they sit in the cycle

1. **`validateBet(campaign)`** in the `propose-campaign` path (`agent-runner.js:~5700`, next to the existing SE-1 check). Rejects a proposal missing any field, an `evidence[]` entry without `n`, an `expected.metric` or `kill.metric` not in `companyStrategy.northStar` or `campaign_qualified_uses`, or a `mechanism` outside the enum. Enum (first cut): `search_page`, `directory_listing`, `community_reply`, `broadcast_post`, `weekly_scoreboard`, `tool_or_utility`, `partnership`, `email`. The enum is the "mechanisms never tried" list; it is also what makes "rewording" impossible.
2. **`betKey` dedup** replaces title similarity (`agent-runner.js:5707-5714`) and the exact-name cooldown (`:5727-5735`). Block if any campaign (any status) or ledger row shares the key and: result `won` and still active → "already running"; result `lost`/`killed` within 60 days → "lost; cite evidence with `asOf` newer than `verdict.scoredAt`" (the gate reads `evidence[].asOf` and lets it through only if newer); `inconclusive` → allowed with the prior row attached. This is the rule "a lost bet is never re-proposed without new evidence", in code.
3. **Kill and scale evaluation** every cycle in `campaign-lifecycle.js`, before the end-date pass (`:125`). Reads `outcomeDigest.perCampaign[c.id].qualifiedUses` (after B5/B6). Writes `status: 'killed'` (terminal; the reactivation loop at `:141-160` only touches `complete`, so it is already safe) with a governance event. **If the measurement is `null`, nothing fires and the campaign is stamped `measurementGap: true`**, which the proposal block surfaces. Scale rule only raises `frequency` within the per-platform publish cap.
4. **`scoreBet`** at any terminal transition (killed, end-date, CEO complete/cancel): computes `verdict`, requires `actual.n >= 8` posts/pages *and* 14 days elapsed for anything but `unmeasured`; else `inconclusive`. Writes the verdict on the campaign, a `verified_fact` memory to the proposer (`source: auto:bet-verdict`, 90 days, with `evidence.betKey`), and the governance event `bet_scored`. **The push must happen before the memory save** (B2).
5. **Evidence block at proposal time**, code-built in `_buildProposalPromptBlock` (`prompt-builders.js:174`), for every authorized proposer (`constants.js:340`): per channel last 30 days `posts n / attributed people k`; the last 10 ledger rows with result and calibration; `mechanisms never tried` (enum minus ledger); the proposer's own calibration error (mean over its scored bets); and any CEO note attached to a betKey. Because it is built from the ledger, not from the proposer's memories, **it transfers across agents by construction**: Scout sees Echo's lost bet.
6. **Calibration** is the learning metric: `calibrationError` per bet, mean per agent over trailing 5 scored bets, in the evidence block and in `agentPerformance`. An agent whose expected effects keep missing by >2x loses proposal rights for 30 days (code, in the same gate as the probation check at `agent-runner.js:5623`).

### 5.3 Retiring stale or wrong knowledge

- Ledger rows carry `scoredAt`; the evidence block labels rows older than 90 days as `stale` and the betKey gate ignores them (so a lost search bet from June does not block a search bet in October).
- A `won` row whose campaign later gets `killed` on the same betKey flips to `superseded`.
- Memories written by `scoreBet` are `verified_fact` (90-day TTL) and dedup on `evidence.betKey`, so a re-scored bet replaces, not duplicates.
- CEO notes attached to a betKey (from `proposalDecide`) never expire (`auto:ceo-revision` is already pruning-exempt, `index.js:3043`) but are shown with their date.

### 5.4 What this does to the agreed plan

Plan steps 5–8 stay. Changes: no new blob key; `betKey` dedup *replaces* (not supplements) similarity; the evidence block is code, injected for all proposers; calibration is added; `unmeasured` is a first-class verdict; kill rules cannot fire on null.

---

## 6. Proposal B: agent evolution by track record, absence-safe

### 6.1 The principle

An agent earns or loses scope from **a per-lane record computed in code from outcomes and post-publish checks**, never from XP, approval rate, or its own argument. "Lane" = agent × action type × platform (the plan's trust ladder). The record is `{ n, qualifiedUsesAttributed, betsWon, betsLost, calibrationMean, qgFailClosedHits, firstPersonLintHits, ceoAuditWouldReject, lastActiveAt }`, rebuilt each cycle into `runtimeMemory.laneRecords` from the ledger, `outcomeSnapshots`, the governance log, and the CEO audit log.

### 6.2 Promotion (more autonomy)

- **Auto-publish in a lane** (after Phase 1 controls): `n >= 10` published items in the lane, `qgFailClosedHits == 0` in the last 20, `firstPersonLintHits == 0` in the last 20, and (one of) `betsWon >= 1` on a campaign the lane served or a CEO 5-post audit with 0 "would reject" in the last 30 days.
- **Proposal rights** (already gated by `PROPOSAL_AUTHORIZED_AGENTS`): add the calibration gate from 5.2.6.
- **Extra action slot** (the current vanguard perk): earned by `qualifiedUsesAttributed` in 30 days, not by season XP.

### 6.3 Demotion and retirement

- **Lane to manual for 14 days:** any fabricated-claim or first-person lint hit, or two "would reject" findings in one CEO audit, or a killed bet the lane served when the agent proposed it. Code, immediate, logged.
- **Retirement proposal drafted by code:** an agent with 0 executed actions in 60 days *and* no lane assigned *and* not in `PROTECTED_AGENTS` gets an `agent_retire_proposal` minted (the existing path `agent-runner.js:6494-6573` as a system-emitted entry) for the CEO to decide. Nothing retires without the CEO, which also means absence never retires anyone; it only queues the question. `RETIREMENT_EXEMPT_AGENTS` (`rewards-engine.js:96`: vale, quill) is kept.
- **Dormant status** instead of retirement for support agents with no current lane: `agentRegistry.status: 'dormant'` skips the prompt (already free: they are skipped today) but keeps memories and seeds, and a lane assignment reactivates them. This is the honest word for Pixel and Cipher right now.

### 6.4 Rewards engine rewire

Keep `applyEvents`, dedup, seasons, achievements. Change `extractEvents` (`rewards-engine.js:468`): drop `task_done` and `assist` as XP sources (keep as counters); drop `conversionFallbackAgents` entirely; add `bet_scored` (won +40, lost-but-scored +5 if `calibrationError < 0.5`), `qualified_use_attributed` (+10 per person, utm-attributed only), `lane_promoted` (+15); keep `blog_ship`/`social_ship` at 1. Tiers (`:614-618`) then read something real, and Vale stops being on probation for never having run. Reverse the refunded `first_sale` achievements by hand (a `ceoNote`-stamped correction; the ledger has `processedEventIds`, so it needs an explicit reversal entry).

### 6.5 The agents named in the brief

| Agent | Finding | Proposal |
|---|---|---|
| **Scout** | Skipped 100/100 runs. Its only proposal trigger is `research-demand`, which needs a research signal nobody produces. 20 undated `researchIntel` entries, last useful one June. | Give it the one job nobody has: **mechanism discovery.** Each week, auto-mint one task (the auto-replenish path in `campaign-lifecycle.js:~165` already exists) to produce *one* bet proposal for a mechanism in the "never tried" list, with evidence `n` from a real source (Search Console impressions, directory traffic, a community's post volume). Scout's promotion metric is bets scored, not research filed. If after 4 weeks none of its bets reach `n >= 8`, dormant. |
| **Vale** | Skipped 100/100. Tier 1 Chief of Staff with a Discord brief cron (`valeBriefCron`, no-op without the webhook) and a separate memory helper (`_utils/vale-memory.js`) that the heartbeat does not use. On probation by XP. | **Absence-mode owner.** Code stamps `ceoLastWriteAt`; Vale's weekly board minute (plan step 12) is a *code-built* digest from the ledger and lane records (bets scored, kills fired, lanes demoted, questions queued), with one LLM pass for prose. Vale never gains publish or proposal rights; its "performance" is whether the CEO's 20-minute session needs anything that was not in the minute. Remove it from the XP ladder (it is already retirement-exempt). |
| **Forge** | Cannot act by design (`project_forge_cannot_act`). 85/100 skipped. Its proposal trigger is `recurring-incident`. | **Bounded parameter tuning on the ledger**, exactly as the memory file proposes: an allowlist (`newTasksCap`, queue depths, publish cap per platform, kill thresholds) with hard bounds, CEO approval, and automatic revert if the next 7 days' `qualified_uses_week` or lane records fall. Forge's track record = parameter changes that were not reverted. No git access until that record has `n >= 5`. |
| **Quill** | Tier 4, review-only, 40/100 skipped, 46 reviews, the one agent with a denominated finding. | **Post-publish auditor.** Once auto-publish exists, Quill re-checks a sample of published posts against the quality gate and first-person lint and files `wouldReject` findings into the lane record. That is the fleet-side half of the CEO's biweekly 5-post audit, and it gives demotion a signal that does not depend on the CEO being present. Keep it off the XP ladder. |
| **Cipher, Pixel** | 0 memories, 94 and 98 skipped. Cipher's finance digest is already code (`finance-intel.js`). Pixel has no outcome lane. | Cipher: **ledger scorer owner** in name only; `scoreBet` is code, Cipher writes the monthly "what we learned" doc from it (one LLM call a month). Pixel: **dormant** until a bet needs a design asset (hero image for a search page is a real case); reactivation by lane assignment. |
| **Echo, Scribe, Nova** | The three that run. Nova is protected; Echo is the only social creator; Scribe is degraded 100/100. | Echo and Scribe get lanes and the ladder in 6.2. Nova's "campaign or objective" triggers (`prompt-builders.js:165`) are replaced by the bet form; Nova keeps the orchestration role and is measured on calibration. **Scribe's prompt size must be measured, not guessed**: the `prompt-size` governance event (`agent-runner.js:503`) is emitted but 0 such entries exist in the retained log, so either it is filtered or the cap evicts it. Make it survive, read `sections`, then cut. |

### 6.6 Absence behaviour, stated as rules

- No CEO write for 14 days → no new campaigns start, publish cap 1/day/platform, QG fails closed, reply-shaped actions never publish (plan step 11). Add: **lane promotions pause; demotions still fire.** Trust only ratchets down without a human.
- Kills still fire on measured numbers; never on `null`.
- Retirement proposals queue; nothing retires.
- Vale's minute is produced regardless and is the first thing the CEO reads back.

---

## 7. Proposal C: experiments that measure people

1. **Delete** `evaluateExperiments` (`performance-intel.js:893-938`), `_buildExperimentPromptBlock` (`:942-958`), the MANDATORY rule (`prompt-builders.js:2362`), and the `agentExperiments` baseline copy at `agent-runner.js:5496`. Mark the 38 existing experiments `status: 'void', reason: 'verdict_measured_approval_rate'` so their history stays readable but no block cites them.
2. **An experiment is a bet with `mechanism: 'copy_variant'` inside an existing campaign**, two arms tagged by `experiment_tag` (the auto-inject at `agent-runner.js:3315-3343` stays). It inherits the campaign's attribution, so "people" means `downstream.qualifiedUses` and `clicks` per arm from `outcomeSnapshots`, differenced at t7, never `socialEngagementSnapshots`.
3. **Sample floor, enforced in `outcome-intel.js:116-151` (already there, keep):** ≥5 per arm, ≥10 total, |effect| ≥ 0.15 on engagement; **add** a people gate: a `won` verdict on a copy variant requires ≥20 attributed people across both arms in the campaign window, otherwise the verdict is `inconclusive (engagement only)` and says so. On this account that gate will hold almost every experiment at inconclusive for a while. That is the honest answer, and it stops the fleet "applying KEEP results" that were noise.
4. **Verdict text carries denominators** ("3 of 11 treatment posts reached a person vs 1 of 12 baseline; effect +0.6; n too small to act"), written by `scoreBet`, persisted before the memory save, shown in the evidence block.
5. **Max 1 active copy-variant bet per campaign**, auto-expire at 30 days to `inconclusive`.

---

## 8. Other things I would change

- **Stop injecting `ceoApprovalRate`, `avgLikesPerPost`, `qualityScore` and the reflection block** until each is honest. Today they teach self-blame and false confidence in equal measure.
- **Memory writer hygiene:** rate-limit notices become a prompt counter, not a memory (`agent-runner.js:6938-6941`); quality-gate rejections stay (they are real and specific) but cap at 3 per agent and roll up into one `constraint` after that; write gate rejects placeholder text.
- **Seeds get `validUntil`.** A directive that is not re-affirmed expires with a log line. The July "REVENUE FIRST" block would have expired in September.
- **Block, do not flag,** a campaign proposal whose `northStarMetric` is not in `companyStrategy.northStar` (SE-1 is currently flag-only).
- **Kill the Herald code path** (`milestone-herald.js`, `milestoneHeraldCron`) rather than leaving it disabled; a disabled cron re-fires on restart (`project_milestone_herald_dormant`).
- **Make the `prompt-size` event survive** so Scribe's 30K problem is measured by section.
- **Delete `agenticMeetingCron`'s prompt surface** if `systemConfig.agenticMeetings.enabled` is not set (it is not in the current config). Another "exists, unused" surface.
- **Weekly reports L9** is not a valid state key; either add it or remove L9 from the explorer so the stack stops claiming a layer it cannot read.

What not to build: an LLM devil's advocate, peer review with XP consequences, a new memory type. The ledger plus lane records cover all three with numbers.

---

## 9. Two-week plan with the measurements that prove learning

Everything in week 1 is a correctness fix or a text retarget; nothing changes publishing behaviour. Week 2 adds the gates. Items marked **[idx]** touch `companyHeartbeat/index.js` and need the CEO's explicit OK per CLAUDE.md.

### Week 1 (10-07 to 10-13): make the signals honest

| Day | Change | Files | Proof it worked |
|---|---|---|---|
| 1 | B7: rewrite seeds (`_global` + 9), registry `doctrine.coreQuestion` for all agents, delete the Echo "paying_customers" block, SE-1 flag → block | `agentSeedMemories` (prod write, CEO-approved), `agentRegistry` (prod write), `prompt-builders.js:2257-2262, ~5740` | **M1:** runs whose reasoning cites `qualified_uses_week` ≥ 90% of 8 runs (baseline 7/100); runs citing "paying customer" 0 |
| 1 | B2: move the three memory pushes above the save **[idx]**, with a test that asserts a concluded verdict is present after the cycle | `index.js:4097-4269` | **M2:** verdict memories persisted = verdicts scored (baseline 0 of 34) |
| 2 | B1: `avgLikesPerPost`/`topPostLikes` from `outcomeSnapshots` t7; stop injecting approval rate, likes, quality score; stop injecting reflection block | `performance-intel.js:325-396, 655-800`, `prompt-builders.js:1492, 1576` | **M3:** `agentPerformance.echo.topPostLikes` ≤ max t7 likes (4); experiment baselines no longer rise during silence |
| 2 | B5 + B6: `scan_completed` (qualified) and `run_delivered` → `downstream.qualifiedUses`; `perCampaign` via `buildActionAttributionMap` | `outcomeRefresh/index.js:287-330`, `outcome-intel.js:183-195` | **M4:** `perCampaign` shows `postsPublished > 0` for the 168 historical posts; `qualifiedUses` populated (expected ~0, but *measured*) |
| 3 | B3/B4/B16: delete legacy experiment evaluator and block; void the 38 | `performance-intel.js:893-958`, `prompt-builders.js:1577, 2362`, `index.js:4159-4176` **[idx]** | **M5:** one verdict system; no "DISCARD ... approval rate" line in any prompt |
| 3 | B8/B9/B10: memory selection by type priority; rate-limit as counter; write gate | `prompt-builders.js:1393`, `agent-runner.js:6938-6941, 5373-5440` | **M6:** ≤ 2 of 10 injected memories per agent are `auto:rate-limit`/`auto:quality-gate` (baseline 9 of 10 for Echo) |
| 4 | B15: rejection/revision notes → `constraint` memory with `auto:ceo-revision`; attach to betKey when a campaign | `proposalDecide/index.js:148-163`, `actionsApprove` equivalent | **M7:** every CEO note written in week 2 is still in the agent's memory 14 days later |
| 4 | B11/B12: CEO reads Azure `AzureWebJobs.*Disabled` for `emergenceCheckCron`, `reflectionWriterCron`; decide fix vs delete | Azure portal / `az` (blocked for me) | **M8:** `emergenceDigest.generatedAt` current, or the block is gone |
| 5 | Scribe prompt: make `prompt-size` persist; read sections; cut | `agent-runner.js:503`, `helpers.js logEvent` | **M9:** Scribe `promptDegraded` 0 of 8 runs (baseline 100/100) |
| 5–7 | Tests for all of the above (the repo has 138 test files; add to `performance-intel`, `outcome-intel`, `memoryConsolidate`) | | all green before any push |

### Week 2 (10-14 to 10-20): close the loop in code

| Day | Change | Files | Proof it worked |
|---|---|---|---|
| 8 | `validateBet` + enum + `betKey` dedup replacing similarity/cooldown | `agent-runner.js:~5700-5740`, new `companyHeartbeat/bet-schema.js` + test | **M10:** semantic-dup blocks per week < 3 (baseline 57 in 3 weeks); distinct `betKey`s proposed ≥ 3; proposals without a kill rule 0 |
| 9 | Kill/scale evaluation + `killed` terminal; `measurementGap` on null | `campaign-lifecycle.js:~120` + test | **M11:** no campaign completes without a verdict or `unmeasured` stamp; 0 kills fired on null |
| 10 | `scoreBet` + `runtimeMemory.betLedger` + verdict memory (before save) + `bet_scored` event | `campaign-lifecycle.js`, `index.js` runtimeMemory build **[idx]**, `outcome-intel.js` | **M12:** every terminal campaign since day 10 has `verdict` with `actual.n`; calibration series exists |
| 11 | Evidence block (per-channel k/n, last 10 verdicts, never-tried mechanisms, own calibration, CEO notes by betKey) | `prompt-builders.js:174-216` | **M13:** 100% of proposals cite an `evidence[].n`; a lost betKey re-proposed without newer `asOf` is blocked (count the gate) |
| 12 | Lane records + promotion/demotion rules (demotion live; promotion gated behind Phase 1 controls) | new `companyHeartbeat/lane-records.js` + test; `agent-runner.js:1365` tier read | **M14:** `laneRecords` rebuilt each cycle; Vale not on probation |
| 13 | Rewards rewire (6.4); freeze ladder; reverse refunded `first_sale` | `rewards-engine.js:21-29, 425-545` + its 1182-line test file | **M15:** no XP from `task_done` or fallback; achievements corrected |
| 14 | Scout weekly mechanism task; Vale minute from ledger; Pixel/Cipher dormant status; retire-proposal-by-code | `campaign-lifecycle.js` replenish, `valeBriefCron`, `agentRegistry` | **M16:** Scout runs ≥ 1 of 4 cycles/day with a bet proposal containing `n`; Vale minute produced with 0 LLM-invented numbers (every figure traceable to a ledger row) |

### The four measurements that mean "the agents are learning" (track weekly from day 10)

1. **Calibration error falls:** mean `|expected − actual| / max(expected,1)` over scored bets, per agent, trending down over 3 consecutive scored bets. Not scorable before ~day 24 (first 14-day windows), so the week-2 deliverable is the series existing with `n`.
2. **Distinct mechanisms tried rises:** count of unique `bet.mechanism` with a scored verdict. Baseline: 1 (`broadcast_post`, never scored). Target by 11-05: 3.
3. **A lost bet is never re-proposed without new evidence:** `proposal_betkey_lost` gate count > 0 *and* 0 lost keys reaching the queue with stale `asOf`.
4. **The doctrine is current:** 0 runs citing a retired north star; 0 injected memories older than their TTL; 0 seed blocks past `validUntil`.

And one that says the plumbing is honest: **every campaign that ends has a verdict with a denominator or the word `unmeasured`.** No silent completes.

---

## 10. Decisions I need from you

1. **OK to edit `companyHeartbeat/index.js`** for B2 (move three memory pushes above the save at `:4097`) and for the ledger digest build in week 2. Both are do-not-touch per CLAUDE.md. Without B2 nothing a verdict produces will ever reach an agent.
2. **Production writes for the doctrine retarget:** rewrite `agentSeedMemories` (all 10 keys) and `agentRegistry.agents[*].doctrine` to the `qualified_uses_week` strategy. I will draft the text for your review first; the writes go through ETag-guarded `mutateState` from a local script with a backup, outside the :00–:07 window.
3. **Read Azure app settings** (`AzureWebJobs.reflectionWriterCron.Disabled`, `AzureWebJobs.emergenceCheckCron.Disabled`, `DEMO_MODE`) or tell me the values. The classifier blocked my read. This decides fix-vs-delete for 3.4 and 3.8.
4. **Delete vs freeze:** I recommend deleting the legacy experiment evaluator, the MANDATORY experiment rule, the emergence prompt block, and the reflection prompt block, and voiding the 38 experiments. Say "freeze" if you want them kept dark instead.
5. **Rewards:** approve removing `task_done` XP, assists as XP, and fallback conversion credit, and reversing the two refunded `first_sale` achievements. This changes the public Fleet page numbers.
6. **Agent status:** Pixel and Cipher to `dormant` (reactivated by lane assignment); Scout gets the mechanism-discovery lane; Vale gets absence mode and leaves the XP ladder. Say which of the four you do not want.
7. **Sequencing:** week 1 as written (fixes only, no behaviour change), then week 2. Or compress by starting `validateBet` in week 1 in parallel.

Everything in weeks 1–2 is reversible by git except the two production writes in decision 2, which have a backup.

---

## 11. Build status (same session, after CEO approval of all seven decisions)

Branch `learning-loop` in worktree `C:\Dev\Ambientpixels\wt-learning` (kept out of the auto-committing main checkout). Full API suite: 96 test files, all green at the end of the session.

**Committed on the branch**
- `b6496a6d` week 1: likes inflation fix, scorecard trimmed, legacy experiment evaluator deleted, verdict memories saved, CEO corrections harvested into permanent memories (`ceo-feedback-intel.js`), type-aware memory injection (`memory-select.js`), `qualifiedUses` attributed per action and per campaign, north-star check blocks instead of flags, Echo block rewritten, mandatory-experiment rule removed, rate-limit memory writer removed, placeholder memories rejected, consolidation skips system notices, reflection block no longer injected.
- `cce76dc7` doctrine retarget drafts + guarded apply script + experiment-void script (nothing run).

**Uncommitted in the worktree (the commit was blocked by the permission classifier; `git add` by path and commit from the worktree)**
- `api/companyHeartbeat/bet-schema.js` + test: bet contract, `betKey`, 60-day lost-key block.
- `api/companyHeartbeat/bet-ledger.js` + test: kill/scale rules (never on null), `scoreBets` with calibration error and a verdict memory to the proposer, ledger digest, evidence block.
- `agent-runner.js`: propose-campaign requires a valid bet; title-similarity dedup replaced by the betKey gate. `materialize.js`: bet travels onto the campaign. `index.js`: ledger wired after the outcome digest, attached as `outcomeDigest.betLedger`. `prompt-builders.js`: evidence block for every proposer, bet shape in the form, product wording corrected (eight products; Resume Roast is one of the 24 Pixel Agents).
- `rewards-engine.js` + test: `task_done`/`assist` pay no XP unless a caller opts in; fallback conversion credit off by default; new outcome lane `bet_won` 40 / `bet_scored` 5 / `qualified_use` 10 (face value, cap-exempt, counts toward season standings); Vale and Quill never on probation; two new achievements.
- `scripts/ops/`: `set-agent-status.js` (dormant/active), `reverse-refunded-first-sale.js`, `disable-proposal-generator.js`. None run.

**Production writes, ALL APPLIED 2026-10-06 ~04:07–04:12Z on CEO instruction (backups in `C:\Dev\Ambientpixels\state-backup-2026-10-06-*.json`):** apply-doctrine-retarget (10 seeds + 9 registry doctrines), void-legacy-experiments (35 of 38 to `void`, 3 active kept), disable-proposal-generator, set-agent-status dormant pixel cipher, reverse-refunded-first-sale (echo + scribe), apply-northstar-widen (seed definition, objective text, strategy label).

**Built after the first status (same session):** Scout's weekly mechanism-discovery task (`companyHeartbeat/scout-mechanism-task.js`, minted from the ledger's never-tried list, wired in `index.js` after the ledger), Vale's ledger-built board minute (`_utils/vale-brief.js` + `valeBriefCron`: north-star reading, running bets with kill-check day and measurement gaps, verdicts this week, mechanisms never tried), and the widened north star. **Still not built:** Vale absence mode (`ceoLastWriteAt`), lane records with promotion rules (the auto-publish consumer does not exist yet), the Azure check of `AzureWebJobs.reflectionWriterCron/emergenceCheckCron.Disabled` (the `az` session needs an interactive login).

**Product note (CEO, 2026-10-06):** the brief's "two products" is wrong. Product-facts lists eight: AmbientOS, AmbientScore, Pixel Agents (a catalog of 24 agents, Resume Roast among them), Agent Forge, CardForge, StoryForge, Blindspot, Pulse. Thirty-day product-analytics users: Pixel Agents 20 views / 1 run delivered, CardForge 2 views / 1 quick build, Blindspot 14 views / 0 cards, StoryForge 3 views / 0 adventures, Agent Forge 3 views / 0 submissions, AmbientScore 0 scans, Resume Roast 0 runs. The north star counts only the last two. Decision 8 below.

**Decision 8 (new, DECIDED by delegation 2026-10-06 ~04:10Z): widened.** `qualified_uses_week` = successful public AmbientScore scans (cc_analytics) + every other product's first-value event from product analytics: any Pixel Agents run delivered (Resume Roast is one of the 24), `quickbuild_completed`, `adventure_started`, `card_created`, `agent_submitted`; internal sessions excluded; null if either half is unmeasured. Code: `pa-metrics.countQualifiedPaUses7d`, `strategy-intel.qualified_uses_week`, the `outcomeRefresh` event map. Data: `scripts/ops/apply-northstar-widen.js` applied the seed sentence, the objective description and note, and the strategy label. Kill rules and the ledger needed no change.

## 12. Azure cron settings (read 2026-10-06 ~04:25Z after CEO device-code sign-in)

| Function | `AzureWebJobs.<name>.Disabled` | Consequence |
|---|---|---|
| reflectionWriterCron | **true** | Explains 3.4: no `auto:reflection` memory was ever written. Keep disabled; the prompt block is no longer injected. |
| emergenceCheckCron | **true** | Explains 3.8: digest frozen at 2026-08-04. Prompt injection now skips a digest older than 7 days (`prompt-builders.js`, emergence section). Delete the key or re-enable; a re-enable fires immediately on restart. |
| memoryConsolidate | **true** | Consolidation has not run since the setting was added; the "Core belief" entries are historical. The guard added in 3.2 applies if it is ever re-enabled. |
| companyWeeklyReport | **true** | L9 (weekly reports) is empty by construction, and `weeklyReports` is not a valid state key. |
| agenticMeetingCron | **true** | Also gated by `systemConfig.agenticMeetings.enabled` (unset). |
| milestoneHeraldCron | false | Runs, but `systemConfig.milestoneHerald.enabled=false` makes it a no-op. Code path still exists (section 8). |
| rewardsEngineCron | false | Runs every 30 min; now on the outcome lane. |

No `DEMO_MODE` / `DEMO_EXPIRES_AT` setting is present, so `demoGuard.timerSkip` is not the cause of anything above.
