# Handoff — Self-Sufficiency Tightening (2026-06-10)

**Context:** CEO (Chad) let AmbientOS run **fully unsupervised for ~7–9 days** as a self-sufficiency test, then logged in. This session triaged agent health, fixed three systemic issues (all deployed), audited the unsupervised week, and produced a self-sufficiency rating. Work is paused at a clean phase boundary — **Phase 1 (quality hardening) has not started.**

Branch: `master` · all work committed + pushed · Function App: `ambientpixels-nova-api` (rg `ambientpixelsV2`).

---

## 1. What shipped today (3 commits, all deployed)

| Commit | What | Why |
|---|---|---|
| `14b4e87e` | **Financial RED alert fix** — `FINANCE_BUDGET_DAILY` $0.50 → **$1.15** + Cipher prompt "$0.75 RED" → "$1.73 RED" ([constants.js:454](../../../api/companyHeartbeat/constants.js#L454), :59) | Daily budget contradicted monthly ($35 = $1.17/day). Real run-rate $0.95/day tripped RED *every cycle*. Now RED fires at $1.73 (genuine spikes only). Monthly guardrail untouched. |
| `1e37783a` | **Weekly-report cron** — new `companyWeeklyReport` (timer, Sun 16:00 UTC) + `company-weekly-report-trigger` (manual HTTP) | The 3 weekly reports (Cipher/Forge/Nova) had **never once** been produced (0 `weekly_report` memories ever). They depended on agents spending 2 of 3 action slots — always lost to firefighting. Now a cron generates them directly (like the daily report). **Backfilled + verified live this session.** |
| `8a0905d0` | **Reflection evidence-gate fix** — gate now exempts full `L4_STRUCTURAL_TYPES` set, not just `weekly_report` ([agent-runner.js:4553](../../../api/companyHeartbeat/agent-runner.js#L4553)) | Proactive `type='reflection'` memories were silently dropped (1 ever vs 108 reactive). The 3-day cadence nudge demands `evidence.runId` that agents omit → blocked as policy-violation. Echo (never gets rejected) had **0** reflections. Now reflection + consolidated_belief are evidence-exempt (they synthesize, not assert). Factual types still gated (stale-loop protection intact). |

**Also this session (non-code):**
- **Cleared the action queue** (was 27 items, backed up ~3 weeks): approved + rescheduled 7 quality posts to a 2/day interval (06-11→06-14), dismissed 17 dup/dead items, sent the "First 100 Agent Decisions" blog back for rewrite (`revision_requested`, fabricated 72/18/10 metrics — verified against logs: real ratio ~63/37 approve/reject). Backups at `C:\tmp\backup-actions-20260610.json` / `backup-approvalQueue-20260610.json`.
- **Repaired git repo corruption** — deleted local-only broken tag `phase-1-discarded` (held missing tree/blob objects, caused `gc`/repack failures on push). `git fsck` now fully clean. `master` + remote untouched.

---

## 2. Self-Sufficiency Rating: **5.5 / 10**

*Operationally self-sufficient (keeps itself alive & busy indefinitely) — NOT outcome-self-sufficient (can't ship, maintain quality, or advance strategy without the CEO).*

| Dimension | Score | Evidence (past week) |
|---|---|---|
| Reliability / uptime | 🟢 9 | 100 cycles, **0 errors**, 23s avg, 1,200 auto-fixes, 1 agent-skip |
| Governance / safety | 🟢 8 | No runaway; 19 policy-violations (benign memory drops) |
| Self-evolution | 🟡 6 | Reactive reflection strong (108); proactive + weekly reports were dead → **fixed today** |
| Financial | 🟡 7 | $0.95/day vs $35/mo; threshold miscalibrated → **fixed today** |
| Throughput | 🟡 5 | 28 done / 28 created — but **all scribe+echo**; 6/8 agents completed 0 tasks |
| Content quality (unsupervised) | 🔴 4 | ~11 near-dup posts, 1 hallucinated-metrics blog, **fuzzy-dedup blocked 0 all week** |
| Strategic progress | 🔴 4 | 11 objectives avg **16%**, 4 at 0%; 3 experiments stagnant since Feb, 0 concluded |
| Autonomy / shipping | 🔴 3 | **The ceiling** — all outward-facing work needs CEO approval; 27 items stalled ~20d, 0 shipped |

**Core finding:** the approval queue is a hard human gate with no autonomous fallback. Unsupervised, nothing outward-facing ships, quality decays with no CEO feedback signal, and strategy stalls while agents stay busy on social tasks.

---

## 3. THE PLAN — pick up here

**Sequencing principle: fix quality BEFORE loosening the gate.** The quality gate (Haiku) currently misses both duplicates and hallucinated metrics (proven this session). Auto-publishing on QG-pass would just ship garbage faster. So harden quality first, *then* automate shipping.

### ▶ Phase 1 — Quality hardening (DO FIRST, this is the next task)
Both are heartbeat changes → deploy via `git push origin master` (CI/CD). **Read before editing — fragile.**

1. **Semantic dedup for social posts.** The fuzzy-dup guardrail blocked **0** all week while ~11 near-identical Startup Obituary posts went through. Locate the dedup gate (counters at [agent-runner.js:316-319](../../../api/companyHeartbeat/agent-runner.js#L316): `exactDupBlocked`, `fuzzyDupBlocked`, `socialPromoGateBlocked`) and the `create-social-action` injection path ([agent-runner.js:1135-1233](../../../api/companyHeartbeat/agent-runner.js#L1135)). Add semantic/near-duplicate detection (normalized text similarity against recent posts of the same campaign/platform) that blocks at **creation**, not at the queue. Increment `fuzzyDupBlocked`.
2. **Campaign variation cap.** "Pixel Agents Acquisition - Daily Social" churned 11 same-topic posts. Cadence gate is around [agent-runner.js:1310-1321](../../../api/companyHeartbeat/agent-runner.js#L1310) (`_earlyTaskType`, `maxTasks` from `frequency`). Add per-campaign topic rotation / daily cap so one campaign can't flood a single theme.

**Verify dedup actually fires** before declaring done (it's the thing that was silently 0).

### ▶ Phase 2 — Autonomy unlock (ONLY after Phase 1 verified)
3. **Auto-publish advisory social after a 48h grace window** (NOT immediate-on-QG). Advisory-classification posts that pass the QG auto-publish if the CEO doesn't act within 48h. Keeps CEO in the loop but absence no longer halts everything. Safe only once dedup is live. **Open decision — CEO must confirm posture** (grace-window vs immediate vs keep-manual). Scheduler that posts approved actions: [actionsScheduler/index.js](../../../api/actionsScheduler/index.js) (reads `actions` key, fires `approval.status=approved` + `payload.scheduled_for` within 7d, 5/cycle). Approval/auto-approve logic: `approveAction` in [js/agent-engine.js:2912](../../../js/agent-engine.js#L2912).

### ▶ Phase 3 — Defer (real, but bigger / lower leverage)
4. **Stalled-objective driver** — make Nova act on 0% objectives, not just spawn social tasks.
5. **Experiment cadence** — Echo has 3 experiments since Feb (`agentExperiments` key), none concluded. Force conclude-or-drop.
6. **Strengthen autonomous QG** — it passed duplicates (95-99%) and the hallucinated blog. Needed because CEO feedback can be absent for a week+. See AQ-audit note: read `payload.text` fully, Haiku has false-negatives at 92-95%.

---

## 4. Operational reference (learned this session)

- **Read state:** `curl -s ".../api/company-state?key=KEY" -H "x-company-secret: pixelpusher"`. NOT all keys are in `VALID_KEYS` (e.g. `weeklyReports`, `geminiUsage`, `heartbeatRuns` are written via `storage.getState` blobs but NOT readable via the HTTP API — read them in-function or via the trigger's returned summary).
- **Bash↔Node path gotcha (Windows):** Git Bash `/tmp` ≠ Windows Node `C:\tmp`. Use the **Write tool** to create `.cjs` scripts under `C:\tmp\` and run with `node C:/tmp/x.cjs` (forward slashes). Avoid `cat > /tmp/...` heredocs + node reads — they mismatch.
- **Scheduler:** `actionsScheduler` (every 5 min) posts approved social actions whose `payload.scheduled_for` is past but **within 7 days** (older = auto-failed stale), max 5/cycle. `SOCIAL_PLATFORMS_ENABLED=x,linkedin,bluesky` (all live).
- **Memory types:** `feedback` (120, incl. reactive reflections source `auto:reflection`), `consolidated_belief` (38), `reflection` (proactive, was ~0 — fix deployed), `weekly_report` (was 0 — cron deployed). `agentMemories` is keyed by agent; FIFO-capped ~50/agent.
- **Heartbeat runs hourly** (`heartbeatRuns`, capped ~100). Per-run telemetry: `perAgent`, `agentActions`, `guardrails`, `autoFixes`, `backlogPressure`.
- **Do-NOT-touch reminders** (CLAUDE.md): `companyHeartbeat/index.js`, `company-state/index.js`, `staticwebapp.config.json`, `company-actions.json`, CI workflow, `governance.html`. Heartbeat module edits (agent-runner.js, constants.js, etc.) need explicit CEO go-ahead + deploy — which Phase 1/2 have (CEO greenlit "good plan").

## 5. Open decisions for next session
1. **Auto-publish posture** (Phase 2): grace-window (recommended) vs immediate-on-QG vs keep-manual. CEO leaning toward proceeding; confirm before building Phase 2.
2. Whether to fold Phase 2 into the Phase 1 pass or keep sequential (recommended: sequential — verify dedup first).

---
*Generated 2026-06-10. Next session: start Phase 1, item 1 (semantic dedup). Read the dedup gate in agent-runner.js before editing.*
