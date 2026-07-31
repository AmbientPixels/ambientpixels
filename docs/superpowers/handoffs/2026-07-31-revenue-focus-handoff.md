# Handoff — Revenue Seasons shipped; memory retune + Seasons dashboard next

**Date:** 2026-07-31 · **Status of prior work:** COMPLETE and deployed.

Read first: skill `agent-rewards`, memories `project_revenue_seasons`, `project_seed_memory_truncation`, `feedback_systemconfig_read_modify_write`.

---

## 1. What shipped today (done, verified, do not redo)

**Revenue Seasons** — the agent XP economy is now revenue-first with real stakes. Spec `docs/superpowers/specs/2026-07-30-revenue-seasons-design.md` (Status block lists every deviation), plan `docs/superpowers/plans/2026-07-30-revenue-seasons.md` (header marks it complete). 73 engine tests + 25 smoke green, all pushed, live and verified against production.

Mechanics live in the `agent-rewards` skill. The load-bearing invariants (each learned from a real defect):
- Each source event pays **exactly once ever** — `paidBases` from `processedEventIds`.
- An **unscored season** (par null) confers no par misses AND no privilege tiers.
- The budget floor follows the CEO's **hand-tuned registry caps**, never an even split.
- A mid-month reallocation **floors each cap at spend × 1.5** so past spending can never become a violation.

**FIRST REVENUE: $398** — two $199 AmbientScore Teardowns, 1 paying customer, both **unattributed** (no UTM, no lead, no campaign). The economy paid Echo 168 / Scribe 148 revenue XP via the conversion-campaign fallback.

---

## 2. The finding that should drive the next session

The fleet's funnel is producing nothing while money arrives from somewhere untracked:

| Last 7 days | |
|---|---|
| Fleet output | 24 social replies, 24 scheduled posts, 8 research approvals, 6 documents = **62 actions** |
| Public scans | **0** |
| Leads | **0** |
| Attributed revenue | **$0** |
| Actual revenue | **$398**, source unknown |

And the reason the fleet isn't chasing revenue is **not** disobedience — see below.

---

## 3. NEXT: memory retune (highest leverage, partly diagnosed)

### 3a. The seed-memory truncation bug — fix this first
Full detail in memory `project_seed_memory_truncation`. Summary: **54% of `agentSeedMemories` is silently truncated** before reaching any prompt. The CEO's `## Current Phase — REVENUE FIRST (CEO directive, 2026-07-31)` section sits at the bottom of a 7,598-char `_global` where only 2,000 chars survive — **no agent has ever seen it**. Same for scribe's `## Revenue Phase` and echo's `## Current Priority`.

Budgets: `_global` 2000 heartbeat / **600 execution**; per-agent 1500 / **400 execution**.

**The fix:** restructure so priorities lead and everything fits.
1. `_global`: REVENUE FIRST directive in the first ~500 chars (survives into execution prompts), then non-negotiables (no fabricated claims/numbers/offers; quality gates and CEO approval stay), then whatever background fits.
2. Cut the product catalog from `_global` — `api/_data/product-facts.json` is already injected as its own `productFactsBlock` in the same prompt. Duplicated spend of a scarce budget. Also cut/compress the org chart.
3. Per agent: priority first (inside 350 chars), role specifics after, total under 1500.

**Backup taken** before any edit — full pre-change seed JSON is in the session scratchpad; re-fetch with `GET /api/company-state?key=agentSeedMemories` and keep a copy before writing.

**Write path:** `POST /api/company-state` body `{"key":"agentSeedMemories","value":{...}}` — **full replace, no server-side merge.** GET → modify → POST the complete object. (I destroyed `systemConfig.heartbeatModel` + the offers array this way today; recovered only because I'd printed it earlier.)

### 3b. Doctrine rewrite — second-order but real
**Eight of nine agents have no revenue orientation in doctrine**, which sits *above* the progression block in the prompt and frames their strategic lens. Only Echo is revenue-written (use it as the model). Current core questions: nova "Does this increase AmbientPixels leverage?", cipher "What is the ROI and downside risk?", scribe "Is this unambiguous?", scout "Where is leverage hiding?", pixel "Is this intentional design?", quill "Can this be 20% clearer?".

Drafted replacements (CEO had not yet approved these):
- nova → *"Does this move a paying customer closer, or is it motion?"*
- cipher → *"What did we earn this week, what did it cost to earn, and whose work produced it?"*
- scribe → *"Does this give a reason to click, and does that click reach a checkout?"*
- scout → *"Who is the buyer, and what would make them pay this week?"*
- pixel → *"Does this remove friction from the path to purchase?"*
- quill → *"Does this land the offer, or just read well?"*
- forge → owns instrumentation: *"Can we prove what caused our last dollar?"*
- vale → keep (CEO-facing role is correct), add a revenue-surfacing trigger.
- Shared new escalation trigger for all: **"Revenue arrived that we cannot attribute."**

**Hazards:**
- `agent.focus` is the **first line of every prompt, untruncated, unweighted** — the strongest single lever. One registry field.
- The live doctrine is `agentRegistry.agents[].doctrine`. **Editing `constants.js` does nothing to a live fleet** (`_applyRegistry` wipes and repopulates `AGENT_ROLES` from registry state every heartbeat).
- The Memory Stack page's **L2 "Operating Doctrine" reads `company-agents.json → operatingDoctrine`, which never reaches any prompt.** Editing what that page displays is a no-op.
- `escalationTriggers.join(', ')` is unguarded — a non-array kills that agent's cycle.
- Preferred write path: `POST /api/fleetProposalCreate` (type `agent_evolution_proposal`) → `POST /api/approveProposal` — preserves `doctrineHistory` lineage. Fleet Command's "⚡ Evolve now" button chains both. Allowed fields: `focus`, `monthlyCap` (≤$5 ceiling), `doctrine`, `expectedActionMix`.

### 3c. Note: the memory-stack page is READ-ONLY
`modules/company/memory-stack.html` is diagnostics only (GET-only API, no save). Real edit surfaces: `modules/company/memories.html` (seeds L3, runtime-memory delete), `modules/company/workspace.html` (CEO notes L5, agent configs L8), Fleet Command evolve (doctrine).

---

## 4. THEN: Seasons dashboard

Template: copy `modules/company/agent-progress.html` + `modules/company/js/agent-progress.js` (separate JS with node-testable pure functions + a `.test.js` — matches how the engine was built). All data from **one call**: `GET /api/agentRewards` (no params; carries `perAgent[].seasonXp/seasonRevenueXp/parMisses/ladderStatus/seasonHistory/revenueRecent`, `season`, `seasonMeta`, `privileges.tiers`, `budgetPlan`, `laddersActive`). Revenue context from `/api/revenueDigest` and `/api/as-funnel`.

Nav = one line in `modules/company/js/sidebar.js` NAV array. No route config needed.

Four panels:
1. **Season header** — season, days left, par, champion, and an honest **"unscored season"** state (July is partial; must not imply probation).
2. **Standings** — rank, season XP, **revenue XP vs churn split**, par progress bar, ladder pill, privilege tier, budget cap vs spend.
3. **Effort vs outcome** — actions produced vs revenue XP earned. Would have surfaced the 62-actions/0-leads problem weeks ago. Build this first if only one panel ships.
4. **Attribution trace** — each revenue event and who it paid, with the unattributed counter (**100%** today).

Gotchas: `budgetPlan.perAgent` may **not sum to the pool** (spend floors can push it over) — don't render as a 100% stacked bar. Season ranking (seasonXp, lifetime-XP tie-break) differs from the existing Fleet leaderboard sort (career XP) — **don't reuse `renderLeaderboard`**; the Fleet leaderboard currently contradicts the season race (Scribe leads career 703, Echo leads season 168) and should be relabelled or switched. CDN scripts ARE allowed (Chart.js is already loaded on dashboard/agent-intelligence), but hand-rolled div sparklines are the dominant pattern on these pages.

---

## 5. Open items carried forward
- **Track C** — retirement knowledge inheritance. The prompt already tells agents "your successor would inherit your memories"; that is not yet true.
- **Track D** — outbound gig agents earning revenue outside the company.
- Per-tier image-budget share (spec §8), deferred to the dashboard fast-follow.
- Accepted minor follow-ups (logged in the `agent-rewards` skill): rate-limit auto-memory text still cites the base cap of 3; a public scan pays 1 XP not the advertised 3 (always unattributed → halved → trimmed); `company.counters.revenueCents` derives from `runtimeMemory.revenueDigest` while agent XP derives from `revenueLedger`; `processedEventIds` 3000-FIFO horizon fills faster now that events fan out per recipient.
- Par is clearable by churn (~14 days at 3 XP/day) while the revenue lane needs traffic that barely exists. Watch season 1 (August) and retune `SEASON_PAR_CEILING` / `MERIT_MIN_SIGNAL` from evidence.
