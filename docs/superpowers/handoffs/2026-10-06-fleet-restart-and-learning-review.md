# Handoff: fleet restart, and the question of whether these agents can learn

**Session:** 2026-10-06, about 01:30 → 02:55 UTC (Opus 5.5)
**Commits:** `a47c0c08`, `4306d729`, `1bc63283` (PR #1). All pushed and deployed; prod verified.
**For:** a fresh session (Fable, high effort). The task is to evaluate the AmbientOS setup and propose how the agents can **evolve, learn, and adapt**, not just run.

Read this whole file before touching anything. Then read the two documents it links:

- [`../specs/2026-10-06-autonomy-brief.md`](../specs/2026-10-06-autonomy-brief.md): the measured state of the fleet, written for outside review.
- [`../plans/2026-10-06-autonomy-plan.md`](../plans/2026-10-06-autonomy-plan.md): synthesis of three Fable reviews (critic, architect, growth). It has been verified against the code.

---

## 1. Where things stand, in one paragraph

The CEO came back after six weeks away and found a fleet that ran perfectly and produced nothing. There were 100 of 100 clean heartbeats, but zero public output since 09-01. About 190 items were waiting on a human who wasn't there, the task ceiling was jammed, and agents were re-proposing the same campaign every few days. This session:

- cleared the stale queues;
- turned off two self-defeating lanes;
- collapsed four objectives into one, with an honest metric;
- made the blog visible to Google for the first time;
- recorded a new standing rule from the CEO: **agents may publish without per-post approval inside CEO-approved campaigns, once safety controls exist.**

Those controls are not built yet. Nothing auto-publishes today.

## 2. What changed this session

### Production data (written through ETag-guarded `mutateState`, backup first)

- **Backup.** `C:\Dev\Ambientpixels\state-backup-2026-10-06-pre-restart.json` holds all 63 state keys (27MB), taken before any write.
- **Cleared:**
  - 60 tasks set to `canceled`.
  - 159 actions set to `approval.status: 'cancelled'`.
  - 34 approval-queue items set to `expired`, with `expiryReason: 'restart_2026_10_06'`.
  - This was verified in code to be neutral for `ceoApprovalRate` and the proposal reject cooldowns, so it is not a negative training signal.
  - **Agent memories were kept.**
- **Off:**
  - `systemConfig.milestoneHerald.enabled=false`, and campaign `camp-milestone-herald` paused. It minted posts about agents' XP that Scribe and Quill refused for weeks (16 of 58 stuck tasks).
  - `systemConfig.roastProspecting.enabled=false`. Its own pre-committed kill gate had fired: 1 person and 0 runs in 30 days.
- **One objective:** `obj-build-public`.
  - Metric: `qualified_uses_week`. Target: 10/week by **2026-12-03**, with a checkpoint of 3/week by 11-05.
  - `obj-revenue-engine`, `obj-resume-roast-demand` and `obj-first-customer` were archived. The last was falsely "complete" from the founder's own test purchases; external revenue is $0.
- **`companyStrategy.northStar`** is now `[qualified_uses_week (p1), paying_customers (p2)]`.
  - Before, it listed paying customers, Bluesky followers and blog views, all expired.
  - **This block is injected into every agent's prompt.** It is why every proposal argued about "paying customers".

### Code (all tested; 91 API test files pass)

- **`a47c0c08`: new north star `qualified_uses_week`.**
  - It counts delivered Resume Roasts plus successful public AmbientScore scans over a trailing 7×24h.
  - It excludes agent-minted, failed, and own-site scans.
  - It returns `null` if either half is unmeasured.
  - The old metric counted **failed scans** as demand and did not count Resume Roast at all.
  - Files: `companyHeartbeat/strategy-intel.js` (`qualified_uses_week`, `isQualifiedScan`), `pa-metrics.js` (`countResumeRoastRuns7d`), and two small wiring lines in `index.js`.
- **`4306d729`: Nova now receives the product-facts block.** It proposes the company's campaigns and objectives, but had never been given what the products are. Its prompt went from about 22.7K to about 24.6K tokens.
- **`1bc63283` (PR #1): the blog is pre-rendered at deploy time.**
  - Script: `scripts/prerenderBlog.js`, run from the CI workflow.
  - Before, Googlebot got "Journal — AmbientPixels" and "Loading…" for every post. Now the 22 newest posts serve the real article. The other 10, and anything published since the last deploy, keep the client-side shell, which is unchanged.
  - The routing config is at Azure's 20KB cap. That is why only 22 are routed; redundant `allowedRoles:["anonymous"]` entries are stripped in the deployed copy only.
  - A daily 09:40 UTC run refreshes the pages and skips the API deploy.
  - **Never route `/blog/*` to the API.** Same-URL server rendering needs a linked backend, and linking one took the whole API down on 2026-08-08.

### CEO decisions (explicit, via question prompt)

1. Agents publish posts **without per-post approval** inside approved campaigns, **after** the safety controls ship. This supersedes the 08-22 "never turn off approval" rule. Memory has been updated.
2. **The CEO approves every new campaign.** The "envelope" idea (bets inside CEO-set bounds auto-launch after 72h) is deferred.
3. **Replies to specific people always need CEO approval.**
4. Objective and targets as above.

## 3. Verified facts that matter for learning and adaptation

These came out of the audit and the three reviews, and were checked against the code or production.

- **Campaigns are never scored.** `campaign-lifecycle.js` flips `endDate → complete` and records nothing about whether the campaign worked. There is no kill-rule machinery anywhere.
- **A campaign marked `complete` before its end date is reactivated next cycle** (`campaign-lifecycle.js` ~L142). An auto-kill needs a terminal status that loop ignores.
- **Duplicate detection is easy to dodge.**
  - Dedup is title similarity ≥ 0.6, and the reject cooldown matches the exact name only.
  - A reworded proposal bypasses both, which produced 13 near-identical proposals in 18 days.
- **Proposals are reactive, not strategic** (`prompt-builders.js` `_PROPOSAL_AGENT_GUIDE`).
  - Each agent may propose only when an alarm trigger fires. For Echo, that is "platform declining week-over-week".
  - The form is effectively "post on platform X about product Y N times a week". There is no option for search pages, directories, communities, or tools.
- **Attribution is half-built, and that is good news.**
  - Every outbound link carries `utm_content=<actionId>`.
  - Product-analytics `agent_run_completed`/`run_delivered` (Resume Roast) and `scan_completed` (AmbientScore) events carry it as first-touch.
  - action → `_parentTaskId` → `task.campaign_id` gives per-campaign attribution **server-side, with no change to post text**.
  - The actions archiver persists an actionId→campaign index for archived actions.
- **The quality gate fails open** when the Haiku call returns null, and the grace-window daily cap counts only grace-published posts.
- **Scribe's prompt exceeded the 30K ceiling in 100/100 cycles** before the restart, so it always ran a degraded rebuild. The likely cause is task-list size; check whether the cleared queue fixed it.
- **Prompt rules lose to objectives.** In August, 22/22 replies pitched despite a "never pitch at raw pain" rule. Every gate written as code held. Readiness is a coverage problem.
- **The only channel that teaches is `revision_requested` with a written reason.** Approval teaches nothing, and rejection teaches only "no".

## 4. The learning machinery that already exists (your main subject)

Most of this was built across 2026 under names like "Self-Awareness", "Outcome Attribution", "Emergence" and "Agent XP". Inventory it before proposing anything new, because the pattern in this codebase is that pieces exist but the loop isn't closed.

| System | Where | What it does | Observed state (2026-10-06) |
|---|---|---|---|
| Memory stack L1–L9 | `api/memoryStack/index.js`, UI `modules/company/memory-stack.html` | Personality, doctrine, seed memories, runtime memories, CEO notes, site digest, research intel, configs, and weekly reports are injected into prompts | Canonical model is 9 layers (see the memory file `project_ambientos_memory_stack`) |
| Runtime memories | blob `agentMemories` (keyed by agent), written by the agent `remember` action | Agents record learnings, decisions, constraints, reflections | **57 total.** Scribe 20, Quill 19, Echo 12 (9 consolidated). **Cipher, Pixel, Forge: 0.** Recent entries are mostly the agents arguing about Milestone Herald. |
| Consolidation | `api/memoryConsolidate` (daily 15:00 UTC) | Collapses clusters of 5+ similar memories into a `consolidated_belief` (90-day TTL) | Running. Note that it iterates retired agents too (see `_utils/inheritanceEscrow.js`). |
| Seed memories | blob `agentSeedMemories` | Static per-agent plus `_global` seed text | Present for all agents |
| Self-reflection | `companyHeartbeat/reflection-intel.js`, `api/reflectionWriterCron` (daily 15:30), `api/awarenessDigest`, UI `awareness.html` | Per-agent introspection digest plus a "YOUR SELF-REFLECTION" prompt block | Running. Agents do reflect, e.g. Quill: "my repeated attempts to fix this through feedback have failed". **Reflection isn't connected to any lever that changes behaviour.** |
| Experiments | blob `agentExperiments`, `performance-intel.js` | Agent states a hypothesis, the system measures before and after | **38 experiments, all Echo** (34 concluded). Measured on `ceoApprovalRate` and `avgLikesPerPost`, **not on people reached**. Baseline `avgLikesPerPost` values of 37–99 look inflated against a best-ever post of 5 likes. Verify, and suspect the cumulative-metric inflation bug (memory `project_engagement_inbox_and_kpi_inflation`). |
| Outcome attribution | `outcome-intel.js`, `outcomeSnapshots`, `api/outcomeRefresh` | Per-agent, experiment, hook and campaign engagement rollup from T+7 snapshots | Exists. It measures engagement, which is near zero, and not usage. |
| Performance digest | `performance-intel.js` | `ceoApprovalRate`, block rate, handoff pass rate and similar per agent, fed back to agents | Pending items count as submitted-not-approved; cancelled items are excluded |
| Emergence monitoring | `emergence-intel.js` | Fleet-level signals: reject rate, churn, silent-agent outage | Exists |
| Agent XP / rewards | `rewards-engine.js`, blob `agentRewards`, skill `agent-rewards` | XP, levels, ranks, achievements, Renown from logged outcomes. A probation tier gets −1 action and a cheaper model. | Exists. **It rewards activity proxies.** The architect review suggests wiring `bet_scored:won` into it. |
| Agent evolution | `approveProposal` (`agent_*` proposals), Forge-only `propose_hire_agent` / `propose_retire_agent` / `propose_role_evolution`, `_utils/inheritanceEscrow.js` | Hire, retire, or reshape agents through CEO-approved proposals; retirement freezes knowledge into escrow | Exists. Scout and Vale **never ran in 25 days** (no tasks), so they are candidates. |
| Revision loop | approval queue `revision_requested` and CEO notes | CEO sends work back with a reason; the agent revises | **The one proven learning channel.** |

**The core gap, stated plainly:** the fleet records a great deal about itself (memories, reflections, experiments, XP), but almost nothing it records is tied to **whether a real person used a product because of what an agent did**. Its learning signals are approval rate, likes, and self-assessment. A fleet that optimises those gets better at being approved and liked by its own scoreboard. `qualified_uses_week` and per-campaign attribution are the first outcome signals honest enough to learn from.

## 5. Plan already agreed (from the autonomy plan; do not relitigate without a reason)

**Phase 0 (foundations):**

- ✅ Blog pre-rendering.
- ✅ North-star metric.
- ⏳ Per-campaign attribution via `utm_content` → action → task → campaign.
- ⏳ Scribe's prompt under 30K. Check after the cleared queue first.

**Phase 1 (controls, then publishing autonomy):**

1. Bet schema enforced by a code validator: mechanism (closed enum), hypothesis, evidence with `n`, expected, kill, scale.
2. `betKey` fingerprint dedup in place of title similarity.
3. An evidence block in the proposal prompt: per-channel people k/n, last 10 verdicts, mechanisms never tried.
4. Kill rule evaluated every cycle, writing a terminal `killed` status.
5. `scoreBet` at campaign end writing to a `betLedger`, fed back into proposals and rewards.
6. An account-wide per-platform publish cap.
7. Replies never auto-publish, enforced by action type.
8. Quality gate fails closed when auto-publish is on.
9. A first-person lint for original brand posts.
10. A metric breaker: 6 or more posts with 0 people pauses the campaign.
11. Then enable auto-publish, Bluesky first.

**Phase 2:**

- Absence mode (`ceoLastWriteAt`; tighten automatically after 14 days).
- Vale's weekly board minute.
- A biweekly 20-minute CEO routine, including a 5-post sampled audit with reasons.
- A lane trust ladder.

**First bets (Growth review):**

- Launch-day teardown gift on Bluesky (replies, so CEO-approved).
- Role-intent search pages for Resume Roast (now unblocked by the blog fix).
- A weekly scoreboard post that replaces daily broadcast.
- A listing sprint.

## 6. What the new session is asked to do

Evaluate, then propose. Concretely:

1. **Audit the learning loop end to end.** For each system in section 4:
   - What signal does it learn from?
   - Is that signal honest? Does it have a denominator? Can it be gamed by the fleet?
   - Does anything it learns **change future behaviour through code**, or only through prompt text, which loses to objectives?
2. **Design how agents should learn from outcomes.** Cover:
   - how a campaign or bet verdict becomes durable knowledge;
   - how that knowledge reaches the right agent at proposal time;
   - how stale or wrong beliefs are retired;
   - how a lesson learned by one agent transfers to others.

   Use the bet ledger idea from the plan as a starting point and improve it.
3. **Agent evolution.**
   - What should earn an agent more autonomy, a different role, or retirement?
   - What should demote it?
   - How should this work when the CEO is absent for weeks?

   Consider Scout and Vale (never run), Forge (cannot act by design; see memory `project_forge_cannot_act`), and Quill (tier 4, review only).
4. **Fix the experiment system.** It measures approval and likes, and its baselines look inflated. Make experiments measure people, with a sample floor and a verdict.
5. **Sequence it.** Give a concrete first 2 weeks, with the measurements that prove the agents are actually learning. For example: verdict calibration error falls; distinct mechanisms tried rises; a lost bet is not re-proposed without new evidence.

Prefer mechanisms enforced in code over prompt principles. Reuse existing systems before adding new ones. Cite file:line.

## 7. Constraints and gotchas (read before acting)

- **Code root.** All code is under `C:\Dev\Ambientpixels\ambientpixels\`, and `.git` is there. The workspace root is not the code root.
- **High-blast-radius files** (CLAUDE.md lists them) need explicit CEO request:
  - `companyHeartbeat/index.js`
  - `company-state/index.js`
  - `staticwebapp.config.json`
  - the CI workflow
  - `data/company-actions.json`
  - `governance.html`
- **Heartbeat** runs every 6h at 00/06/12/18 UTC. Never write heartbeat-owned keys during :00–:07. (CLAUDE.md says every 2h; that is stale.)
- **State writes.** Use `storage.mutateState` (ETag-guarded) from a local Node script, with `AZURE_STORAGE_CONNECTION_STRING` from `ambientpixels/local.settings.json`. **Guard against the silent local-file fallback:** refuse if `getStateWithMeta(...).local` is true. Back up before bulk writes. `systemConfig` is read-modify-write.
- **Permissions.** The auto-mode classifier blocks production writes, deploys, and rule changes without explicit CEO wording for that specific action. Ask with the AskUserQuestion tool and name the exact action. Don't work around a denial.
- **Deploy.** Deploy is a push to `master`, which triggers GitHub Actions. **PR runs also deploy the API to production**, and PR previews give a test URL (`calm-sky-05cc8e110-<PR#>.centralus.6.azurestaticapps.net`). A green run can skip the API deploy, so check the log for `Kudu HTTP status: 200`.
- **GitHub.** The active `gh` account is HansonHeroes. For this repo, use `GH_TOKEN=$(gh auth token --user AmbientPixels) gh ...` per command. Do not switch the global account.
- **Never `az staticwebapp backends link`.** That caused the 2026-08-08 API outage.
- **Concurrent sessions and an auto-committer** have pushed this repo before. Stage by path and work in a worktree for anything unfinished.
- **Tooling.** Python is not available; use Node. `jq` is not installed.
- **Loose ends:**
  - Worktree `C:\Dev\Ambientpixels\wt-autonomy` (branch `autonomy-restart`, merged) still holds an **untracked, obsolete** `api/_utils/campaignAutonomy.js` (auto-approve campaigns, superseded by decision 2) and an `api/node_modules` junction. Ask before deleting.
  - The main checkout has an unrelated uncommitted edit to `docs/superpowers/handoffs/2026-08-09-instagram-analytics-rewards-handoff.md` that is not from this session. Leave it.

## 8. Open questions and first checks

1. **The 06:00 UTC 2026-10-06 heartbeat was the first run on cleared queues.** Read `heartbeatRuns` `.at(-1)` and check:
   - `backlogPressure` and `taskCeilingBlocked`;
   - whether Scribe still shows `promptDegraded`;
   - whether proposals now cite `qualified_uses_week` rather than `paying_customers`;
   - whether `obj-build-public` got a `measuredValue` (the first live reading of the new metric).
2. **No content campaigns are active,** so agents will propose until the CEO approves one. Campaigns are approved on the Actions page (`/modules/company/actions.html`, Approvals → Campaign Proposals). An earlier open issue said CEO-browser actions failed (`attempts: 0`). If approve fails, it can be done via `/api/proposalDecide` with the write secret on the CEO's explicit instruction.
3. **Is the 20KB SWA config limit real** at this tier? The deploy accepted 18,829 bytes. If the limit is higher, all posts could be routed.

---

## Kickoff prompt for the next session

```
Read docs/superpowers/handoffs/2026-10-06-fleet-restart-and-learning-review.md in full,
then docs/superpowers/specs/2026-10-06-autonomy-brief.md and
docs/superpowers/plans/2026-10-06-autonomy-plan.md. Load memory (MEMORY.md +
working-guidelines.md) first.

First: read the latest heartbeatRuns entry and report the four checks in section 8.1.

Then: evaluate the AmbientOS learning loop (section 4 inventory) and propose how the
agents can evolve, learn, and adapt from REAL outcomes (people who used a product),
not approval rate or likes. Follow section 6. Cite file:line, prefer code-enforced
mechanisms over prompt text, reuse existing systems before building new ones, and
give a sequenced 2-week plan with measurements that prove learning is happening.

Do not change production state or deploy without asking the CEO for that specific
action. Do not turn auto-publishing on — the Phase 1 controls are not built yet.
```
