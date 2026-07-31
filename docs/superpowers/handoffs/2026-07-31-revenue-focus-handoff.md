# Handoff — Revenue Seasons + memory retune SHIPPED; Seasons dashboard is next

**Date:** 2026-07-31 · **Prior work:** complete, deployed, verified live. **Next task:** build the Seasons dashboard (§4).

**Read first:** skill `agent-rewards`; memories `project_revenue_seasons`, `project_revenue_first_retune`, `project_seed_memory_truncation`, `feedback_systemconfig_read_modify_write`.

---

## 1. Context: the company just made its first money, and can't explain it

**FIRST REVENUE: $398** — two $199 AmbientScore Teardowns, 1 paying customer, on 2026-07-30. Both sales are **unattributed**: no UTM, no lead record, no campaign. The outbound prospect pipeline shows no conversion either (49 prospects: 16 sent, 7 declined, 0 won).

Meanwhile the fleet's own funnel produced nothing:

| Last 7 days | |
|---|---|
| Fleet output | 24 social replies, 24 scheduled posts, 8 research approvals, 6 documents = **62 actions** |
| Public scans | **0** |
| Leads | **0** |
| Attributed revenue | **$0** |

That gap — busy fleet, zero measurable funnel movement, money arriving from an untracked channel — is the thing the next session should keep in view. It is also what the dashboard in §4 is designed to make visible.

---

## 2. What shipped today (do NOT redo)

### Revenue Seasons — the XP economy is now revenue-first with real stakes
Spec `docs/superpowers/specs/2026-07-30-revenue-seasons-design.md` (Status block lists every deviation). Plan `docs/superpowers/plans/2026-07-30-revenue-seasons.md` (header marks it complete). 73 engine tests + 25 smoke green. Mechanics live in the `agent-rewards` skill.

Load-bearing invariants, each learned from a real defect — do not "simplify" these:
- Each source event pays **exactly once ever** (`paidBases` from `processedEventIds`).
- An **unscored season** (par null) confers no par misses AND no privilege tiers.
- The budget floor follows the CEO's **hand-tuned registry caps**, never an even split.
- A mid-month reallocation **floors each cap at spend × 1.5** — past spending can never become a violation.
- Protected from tier demotion: nova, cipher. Exempt from retirement drafts: vale, quill (plus nova, cipher).

### Memory retune — the revenue agenda now actually reaches the fleet
- **Seeds restructured** (`agentSeedMemories`): was 27,884 chars authored with **14,962 silently truncated away** — including the CEO's own `REVENUE FIRST` directive, which no agent had ever seen. Now 12,420 chars, **0 dropped**, every seed opening with `## PRIORITY: REVENUE FIRST` sized to survive the execution-prompt window. Backup: `docs/superpowers/handoffs/2026-07-31-seeds-pre-retune-backup.json`.
- **Doctrine rewritten for all 9 agents** via `fleetProposalCreate` → `approveProposal` (lineage preserved in `doctrineHistory`). New core questions + the shared trigger *"Revenue arrived that we cannot attribute"* are tabulated in memory `project_revenue_first_retune`.
- Fixed a stale **$49** full-report price inside Echo's "use as template" model post (real price is **$29**).
- Verified: registry updated 18:17:28Z; the heartbeat starting 18:17:46Z ran on both new seeds and new doctrine — 9 actions, 0 errors.

---

## 3. Hazards that will bite you (all learned the hard way today)

- **`POST /api/company-state` is FULL REPLACE, no server-side merge.** A partial write to `systemConfig` destroyed `heartbeatModel` and the offers array. Always GET → modify → POST the complete object, and print the original first so recovery is possible. The key goes in the **body** (`{"key":...,"value":...}`), not the query string.
- **`approveProposal` takes `id`, NOT `proposalId`.** Wrong name returns 400 and leaves proposals pending in the queue.
- **`doctrine` is replaced wholesale on approve** — supply every field (`strategicBias`, `riskTolerance`, `timeHorizon`, `coreQuestion`, `escalationTriggers`) or it is lost.
- **`escalationTriggers` must stay a non-empty array** — `prompt-builders.js` does an unguarded `.join(', ')`; a bad value kills that agent's cycle.
- **Editing `constants.js` does nothing to a live fleet** — `_applyRegistry` wipes and repopulates `AGENT_ROLES` from `agentRegistry` state every heartbeat.
- **The Memory Stack page is READ-ONLY**, and its L2 "Operating Doctrine" reads `company-agents.json → operatingDoctrine`, a field that **never reaches any prompt**. Editing what that page shows is a no-op. Live doctrine is `agentRegistry.agents[].doctrine`.
- Seed budgets are silent: `_global` **2000** heartbeat / **600** execution; per-agent **1500** / **400**. Nothing warns you when content is dropped.

---

## 4. NEXT TASK: the Seasons dashboard

**Goal:** one page that answers "is this economy measuring anything real?" — not a vanity leaderboard.

**Template:** copy `modules/company/agent-progress.html` + `modules/company/js/agent-progress.js` (+ its `.test.js`). That page is the direct predecessor (agent XP) and follows the pure-functions-with-node-tests discipline the engine uses. `modules/company/revenue.html` is the smaller single-file alternative if no test-worthy logic is needed.

**Data:** everything from **one call** — `GET /api/agentRewards` (no params, `x-company-secret` header). It carries `perAgent[].seasonXp / seasonRevenueXp / parMisses / ladderStatus / seasonHistory / revenueRecent / counters`, plus root `season`, `seasonMeta{par,startedAt,previousChampion,monthsSkipped}`, `privileges{enabled,season,tiers}`, `budgetPlan{perAgent,poolDollars,trailing}`, `laddersActive`. Revenue context: `GET /api/revenueDigest`, `GET /api/as-funnel`. Note `agentRewards` is **not** a `company-state` VALID_KEY — it has its own endpoint.

**Nav:** one object in the `NAV` array in `modules/company/js/sidebar.js` (e.g. under System → Agents). No route config needed.

**Four panels, in reading order:**
1. **Season header** — season, days left, par, champion, and an explicit **"unscored season"** state (July is partial; must not imply anyone is on probation).
2. **Standings** — rank, season XP, **revenue XP vs churn XP split**, par progress bar, ladder pill, privilege tier, budget cap vs spend. Daily glance.
3. **Effort vs outcome** — actions produced vs revenue XP earned, per agent. *Build this first if only one panel ships* — it is the panel that would have surfaced the 62-actions/0-leads problem weeks ago.
4. **Attribution trace** — each revenue event and which agents it paid, with a prominent unattributed counter (**100%** today).

**Gotchas:**
- `budgetPlan.perAgent` may **not sum to `poolDollars`** (spend floors can push it over) — never render as a 100% stacked bar.
- Season ranking is `seasonXp` with a **lifetime-XP tie-break**; the existing Fleet leaderboard sorts by **career XP** — do not reuse `renderLeaderboard`. The two currently contradict each other (Scribe leads career at 703, Echo leads the season at 168); consider relabelling or switching the Fleet one.
- Zero-spread / null-par seasons deliberately produce all-`line` tiers — render that honestly.
- CDN scripts ARE allowed (Chart.js already loads on `dashboard.html` / `agent-intelligence.html`), but hand-rolled div sparklines are the dominant pattern on these pages — prefer them.
- Page CSS lives inline in each HTML file with a page-prefix (`ap-`, `fl-`, `rev-`). Shared components: `.sys-section`, `.dash-panel`, `.dash-stat-card`, `.dash-badge`, `.dash-empty`.

---

## 5. Open items after the dashboard
- **Track C — retirement knowledge inheritance.** The prompt already tells agents *"your successor would inherit your memories."* That is not yet true. Build it before the first retirement draft can fire (earliest 2026-10-01).
- **Track D — outbound gig agents** doing small paid jobs outside the company. The only track that creates *new* demand rather than competing over existing work.
- Per-tier image-budget share (spec §8), deferred to this dashboard's fast-follow.
- **Retune from evidence after season 1 (August):** par is clearable by churn (~14 days at 3 XP/day) while the revenue lane needs traffic that barely exists. Levers: `SEASON_PAR_CEILING`, `MERIT_MIN_SIGNAL`, `SEASON_PAR_GROWTH`.
- Accepted minor follow-ups (in the `agent-rewards` skill): rate-limit auto-memory text still cites the base cap of 3; a public scan pays 1 XP not the advertised 3 (always unattributed → halved → trimmed); `company.counters.revenueCents` derives from `runtimeMemory.revenueDigest` while agent XP derives from `revenueLedger`; `processedEventIds` 3000-FIFO horizon fills faster now that events fan out per recipient.

---

## 6. Live state at handoff
- All work committed and pushed; working tree clean.
- Revenue Seasons fully ON: `laddersActive: true`, `budgetPlan` live, merit budget re-enabled, all 9 agents GREEN.
- `systemConfig.rewards = { meritBudget: { enabled: true } }`; `heartbeatModel: gemini-pro`; GENESIS offer present and inactive.
- Season `2026-07`, `par: null` (unscored — correct). First scored season is August; first possible retirement draft is 2026-10-01, CEO-gated.
- Approval queue: 2 unrelated pending items (1 content package, 1 campaign proposal).
