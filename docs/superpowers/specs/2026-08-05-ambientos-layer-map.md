# AmbientOS Layer Map — What's Load-Bearing, What's Meta, What's Vestigial

**Date:** 2026-08-05
**Purpose:** Make the complexity visible so it can be reasoned about from the outside. Built from code and live state (not from design docs, which describe intent). Companion to `2026-08-05-ambientos-monetization-analysis.md`.
**Scope:** Map only. Nothing was changed, disabled, or deleted in this pass.

---

## 1. The scale of the thing, measured today

| Layer | Count | Serves |
|---|---|---|
| API function folders | 193 (198 incl. shared/_lib) | split ~half products, ~half the machine |
| Cron timers | 26 | see census below |
| Valid state keys | 63 (+ several out-of-band: `pingLog`, `weeklyReports`, `agenticMeetings`, `heartbeatProgress`, roast queue) | mostly the machine |
| CEO dashboard pages | 50 HTML pages in `modules/company/` | one user: the CEO |
| Heartbeat directory | ~33,000 lines (~28K excl. tests), 40+ modules | the fleet |
| Named systems | 15 (identity → emergence monitoring) | the fleet |
| LLM agent slots per cycle | 10 (9 fleet agents + Nova closing pass), 6 cycles/day | the fleet |
| Products with public surface | 6 (AmbientScore, roast, CardForge, StoryForge, Blindspot, Pixel Agents/Forge) | external users |

Against: **34 unique users/30d, 130 events, $0 lifetime revenue, ~140 followers.** Live fleet throughput (last 6 runs): 7-18 actions/cycle, status ok/warn — the machine runs clean. That is precisely the problem: it is a clean-running machine whose output has almost no audience.

---

## 2. Classification buckets

- **A — Product rails.** External humans or money touch it directly.
- **B — Reality instrumentation.** Measures the outside world honestly (the self-dealing-metric guards live here).
- **C — The deliberation engine.** The fleet itself: prompts, gates, memory, execution. Works as designed; consumes 96% of burn.
- **D — Meta-machinery.** Layers that exist to manage, observe, motivate, or report on other layers.
- **E — Vestigial / dormant.** Proven-zero channels or surfaces with ~no usage.

## 3. Cron census — all 26, classified

| Cron | Schedule | Bucket | Notes |
|---|---|---|---|
| asScanRunner | */10 min | **A** | Executes real scans — core product rail |
| asTeardownRunner | */15 min | **A** | $199 fulfillment rail (0 sales, but the rail is the offer) |
| roastRewriteRunner | */15 min | **A** | $9 fulfillment rail (live, verified 08-04) |
| pixel-agent-payout-timer | monthly | **A/E** | Creator payouts for a marketplace with 2 runs/30d — rail sized for a scale that doesn't exist |
| actionsScheduler | */5 min | **A** | Ships approved actions (social/replies). The rail is fine; the channels it ships to are ~dead |
| formIntakeDigestTimer | daily | **A** | Inbound contact processing (rare but external) |
| autoPublishGrace | hourly | **C/D** | Trust-milestone machinery for a content pipeline with ~no readers |
| actionsMetricsPull | */15 min | **B** | Engagement metrics ingestion |
| socialEngagementPull | 6h | **B** | Same |
| socialAccountStatsRefreshCron | daily | **B** | Follower stats (LinkedIn scrape known-broken) |
| productAnalyticsRollup | daily | **B** | The 34-users number comes from here — keep |
| outcomeRefresh | daily | **B** | Attribution sampling (t1/t7/t30) |
| companyTrendIngest | 6h | **B/D** | Trend radar — audit whether any trend has ever changed a decision |
| asProspectCron | 2h | **E (AS half) / hold (roast half)** | AS cold-reply lane is a proven hard zero (40→0→0). Roast half matures ~08-07 |
| companyHeartbeat | 4h | **C** | The pump. 96% of all burn |
| proposalGeneratorCron | 6h | **C/D** | LLM composes proposals for the CEO to judge |
| agenticMeetingCron | daily | **D** | Agents hold meetings about their own work |
| memoryConsolidate | daily | **D** | Manages memory the fleet generates |
| reflectionWriterCron | daily | **D** | Forces agents to introspect on their own decisions |
| rewardsEngineCron | hourly | **D** | XP/levels/seasons for the agents (deterministic, cheap in $, nonzero in complexity) |
| emergenceCheckCron | daily | **D** | Watches for compound patterns across the other systems — the immune system for the machine |
| companyMorningReport | daily | **D** | Reports on the machine, to the CEO |
| companyWeeklyReport | weekly | **D** | Same, weekly |
| valeBriefCron | 2×/day | **D** | Chief-of-staff briefs about the machine |
| milestoneHeraldCron | daily | **D** | Celebrates the machine's milestones publicly |
| actionsArchiver | daily | **D** | Retention hygiene for the machine's own records |

**Score: 6 product rails, 6 instrumentation, 3 engine, ~11 meta, 1+ vestigial.** Nearly half the scheduled compute exists to run, observe, motivate, or report on the fleet — and the fleet's entire externally visible output is a handful of social posts and replies per day into channels that measured zero.

## 4. Heartbeat directory — where 28K lines went

| Group | Modules | ~Lines | Bucket |
|---|---|---|---|
| Execution core | index, agent-runner, prompt-builders, task-mutations, execution-engine, normalization, helpers, constants, gemini, model-registry, workspace-context, convergence, campaign-lifecycle | ~16,500 | **C** |
| Intel/digest builders (feed prompts) | performance-, social-, ops-, finance-, research-, strategic-, content-, site-, outcome-, allocation-, emergence-, reflection-, revenue-, strategy-, world-state-intel | ~5,900 | **C/D** — 15 separate lenses so 10 LLM slots can deliberate with context |
| Fleet self-management | rewards-engine, proposal-generator, agent-proposal-select, milestone-herald | ~2,300 | **D** |
| Outbound/product-adjacent | prospect-pipeline, engagement-reply, quality gates | ~1,900 | **A/C** — quality gates are genuinely good; prospect-pipeline's AS lane is proven-zero |

The engine is real engineering and it works. But note the shape: **fifteen intelligence modules** exist so that ten agent slots can think carefully about marketing to an audience of ~140 people, and a further layer (reflection, rewards, emergence, allocation) exists to manage the thinkers.

## 5. The middle-management census

Listed together because seeing them in one place is the point. Each solved a real problem the fleet created; each works; together they are a full middle-management hierarchy for a workforce whose external output reaches almost nobody:

1. Reflection system — agents introspect on their decisions
2. Memory consolidation — compresses the memories agents write
3. Emergence monitoring — watches for patterns across the other systems
4. Capital allocation — Cipher approves other agents' spend requests
5. Agent identity evolution — hire/retire/evolve the roster
6. Rewards/XP/seasons/retirement ladder — motivates the agents
7. Agentic meetings — agents meet about their work
8. World state — shared briefing so agents agree on facts
9. Vale — chief of staff briefing the CEO on all of the above
10. Morning/weekly reports — the machine reporting on itself
11. Milestone herald — announcing the machine's achievements
12. Awareness/attribution/allocation/emergence/fleet/goals dashboards — UIs to watch the watchers
13. Governance log + archiver — audit trail of all of the above

## 6. What is genuinely strong (survives any restructure)

- **Payment/fulfillment rails (bucket A):** checkout, webhooks, credit ledgers, scan/rewrite/teardown runners. Rated 8-9/10 for a reason. ~Zero marginal cost to keep.
- **Integrity instrumentation (bucket B):** the internal-purchase filter, `publicScans7d` vs `scans7d`, unmeasured≠zero, UTM attribution. This is the rarest thing built here — a system that refuses to lie to itself. Any future version keeps this pattern.
- **Safety architecture:** `execution_mode` kill switch, approval queue, budget caps, 21 gates, blast-radius tiers. Right-sized versions of these belong in anything that acts autonomously.
- **The failure corpus itself:** five months of governance logs, heartbeat runs, and honest zeros. It is the raw material of the autopsy story and of any Season 2 design.

## 7. Provably dead or dormant (evidence-backed only)

| Item | Evidence |
|---|---|
| AS cold-reply outbound lane | 40 replies → 0 clicks → 0 checkouts (terminal n=40) |
| Followers-as-a-channel | 76→82 Bluesky in 5 weeks against a 500 target; obj retargeted 08-05 |
| LinkedIn stats scrape | reads 2 (was ~127) — broken |
| Agent Forge submissions | 1 event in 30d |
| Pixel Agents marketplace scale assumptions | 2 runs/30d vs payout/Connect machinery built for a creator economy |
| StoryForge usage | 5 events/30d against 7 endpoints + Stripe subs |
| Auto-publish grace path | had fired zero times as of the 06-11 codex assessment (re-verify before citing as current) |

Not called dead without evidence: trend radar, agentic meetings, herald — flagged for a usage audit ("has this ever changed a decision / reached a reader?") rather than condemned.

## 8. The two different costs — and which lever moves which

- **Dollars:** 96% of burn is the heartbeat's LLM calls (input tokens). The meta-crons are mostly deterministic or small — **turning them off saves little money.** The dollar levers remain heartbeat cadence (done: */4) and per-agent skill routing (~$70→~$35/mo, unbuilt).
- **Comprehension:** the meta-layers are what makes the system feel unsortable — 26 timers, 63 keys, 50 pages, 15 systems. **Turning them off buys back the CEO's ability to reason about the system.** That is a real cost even at $0/mo.

The feeling of "too many layers" is accurate, and the map shows why: complexity grew inward. Five months of effort flowed to the only thing that responded to effort — the machine — because the outside world never gave feedback. Every layer above is individually defensible; the *stack* is sized for a 50-person org, mounted on a company with 34 monthly users.

---

## 9. Three shapes for "a different approach" (decision, not action — nothing flipped)

### Option 1 — Freeze the meta, keep the rails (recommended first move)
Suspend bucket-D crons (meetings, reflection writer, rewards, herald, morning/weekly/vale briefs, emergence — all restorable), disable the dead AS-lane half of prospecting, leave buckets A + B fully running, drop the heartbeat further (*/8 or observe-mode) or leave at */4. Products remain fully sellable; analytics keep measuring; every change is a config/systemConfig/cron toggle — **reversible in minutes, ~1 day of careful work.** Buys: a system small enough to hold in your head, plus modest burn relief. Costs: the fleet's self-improvement theater pauses — which measured zero external effect anyway.

### Option 2 — Re-point the surviving fleet at exactly one job: demand
After Option 1, the fleet's only mission becomes producing things strangers can find: SEO pages (the one compounding channel shipped), blog/content with search intent, and processing real user events. Objectives collapse to `qualified_visitors_week` (already retargeted) and nothing else. Agents that don't serve that mission stay frozen. This is a re-aim, not a rebuild — the campaign→content machinery exists.

### Option 3 — Season 2 rebuild around a validated core
The full teardown/rebuild — **gated on a demand signal**, per the monetization analysis. If the autopsy test (or roast/SEO data) shows an audience that responds, rebuild toward that specific validated thing, in public, with the Season 1 autopsy as the opening chapter. Rebuilding before a signal re-runs the inward spiral with cleaner code.

**Recommended sequence: 1 now → 2 immediately after → 3 only on a signal.** This keeps "it will work" alive on the cheapest possible footing: rails ready to take money, instrumentation honest, machine quiet, and all remaining effort pointed at the only unsolved problem — being found.

## 10. EXECUTED — Step 1 completed 2026-08-05 ~02:00Z (CEO-approved)

1. **Full state snapshot taken first:** `c:/Dev/Ambientpixels/state-backup-2026-08-05.json` (11.5 MB, all 62 VALID_KEYS, stored OUTSIDE the repo — do not commit).
2. **Nine meta crons disabled** via Azure app settings (`AzureWebJobs.<fn>.Disabled=true` — no code change, reversible in one command, survives deploys): `agenticMeetingCron`, `reflectionWriterCron`, `rewardsEngineCron`, `milestoneHeraldCron`, `companyMorningReport`, `companyWeeklyReport`, `valeBriefCron`, `emergenceCheckCron`, `memoryConsolidate`. Verified via app-settings query; healthz 200 after restart.
3. **AS cold-reply lane disabled:** `systemConfig.asProspecting.enabled = false` (read-modify-write; `disabledReason` embedded). Roast lane (`roastProspecting.enabled: true`) verified untouched. Gate confirmed in code: `prospect-pipeline.js:344` (AS) vs `:732` (roast — independent switch).
4. **Deliberately left running:** all product rails, all analytics/instrumentation, `actionsScheduler`, `actionsArchiver` (retention hygiene — disabling it causes blob bloat/500s), `asProspectCron` function (roast lane rides it), `autoPublishGrace`, `proposalGeneratorCron`, heartbeat at `*/4`, `HEARTBEAT_MODEL` untouched (`gemini-pro`).

**Expected side effects (not bugs):** Season 1 XP frozen mid-season; Vale emails stop; morning/weekly reports go stale on dashboards; awareness/emergence/meetings dashboards go stale; agent prompts still render fine (stale digests degrade gracefully by design). **To re-enable anything:** delete its `AzureWebJobs.<fn>.Disabled` app setting.

**Step 2 EXECUTED 2026-08-05 ~02:30Z (CEO chose "Pause all 8 + SEO campaign"):**
- **Objectives unchanged** — kept all 3 active: `obj-build-public` (the mission), `obj-revenue-engine` (conversion goal), `obj-ms98rscb-ilkj` (budget caps).
- **All 8 active campaigns paused** (reversible; `pauseReason` embedded on each): camp-pulse-daily, camp-milestone-herald, camp-ms5gdc1g-yjb7, camp-ms9x4s7n-g7j3, camp-msckchvl-u5ck, camp-ms9nl7dy-dcbp, camp-ms9sfbhv-ojzn, camp-mscdtdej-hxwn. Every one was social/outbound-shaped — the measured-zero channels. The 3 previously-paused campaigns left as-is.
- **Created `camp-seo-search-intent`** ("Search-Intent Content", obj-build-public, `["blog_post"]`, weekly ×1, northStar `qualified_visitors_week`, ends 2026-09-30). Now the ONLY active campaign — the fleet's entire content mission is one findable page per week.
- Expected noise: in-flight tasks of paused campaigns will hit freeze gates (logged, harmless); stale approval-queue items from paused campaigns can be dismissed at leisure. Agent roster untouched — the objective/orphan gates now naturally constrain the fleet to demand work.

## 11. Guardrails for the sorting process

- No state-key wipes, no memory purges, no file deletions as part of "simplifying" — freezes and toggles only, so every step is reversible.
- Protected files stay protected (`companyHeartbeat/index.js`, `company-state/index.js`, `staticwebapp.config.json`, etc.) — cron disabling happens via `function.json` schedules or `systemConfig` switches, case by case, each named explicitly before it's touched.
- Archive a full state snapshot before any restructuring session (blob data is not in git).
- `systemConfig` is read-modify-write — GET before every POST.
