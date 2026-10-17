# AmbientOS: Money + Efficiency, Overnight Build + Evaluation Loop, Implementation Plan

> **For agentic workers:** this plan is executed by an overnight **Workflow** (builders one at a time, then reviewer agents in rounds, then one fixer per round). Each task lists exact files, interfaces and tests; the builder writes the code TDD and commits by path. Steps use checkbox (`- [ ]`) syntax. For a human-driven run use superpowers:subagent-driven-development instead.

**Goal:** Point the AmbientOS agent fleet at money and make its spend visible: every agent sees which product moves the north star, every LLM dollar is traceable to the campaign that spent it, every bet is judged on cost per qualified use, and the product paths the agents send people to don't dead-end.

**Architecture:** Small, pure, tested functions in the existing heartbeat modules (no new layers), one optional read-only HQ page. All new numbers carry a denominator and a verdict (memory rule: "a number without a denominator is not a signal"). Everything ships dormant-safe: if an input is missing the new block prints nothing rather than a zero.

**Tech Stack:** Node (CommonJS) Azure Functions, plain-node test files (`node <file>.test.js`, prints `N passed, M failed`), vanilla JS/CSS pages, Playwright via `C:/Dev/Ambientpixels/node_modules/playwright` with `chromium.launch({channel:'msedge'})`.

**Context (2026-10-16/17, already shipped by the main session, do not redo):** rewards are display-only; the heartbeat passes `qualifiedPaUses7d` and `llmSpendByDay` into the strategy digest; `strategy-intel.js` has `computeCostPerUse` and prints an `EFFICIENCY (7d)` line; leftover "paying customers" doctrine was retargeted in code; dead crons removed; AmbientScore analytics now initialise (`40278a28`). Product pick: `docs/superpowers/specs/2026-10-17-aaa-product-pick.md` (AmbientScore = AAA product; every product is near zero demand; external revenue $0).

---

## 0. Chad's decisions

Chad's answers, 2026-10-17 ~06:45 UTC, before he went to sleep.

| Question | Answer |
|---|---|
| Where it lands | **Live.** Push each green commit to `master` (`git push origin fleet-simplify:master`). |
| Stop rule | **All four reviewers ≥ 9, or 6 rounds**, whichever comes first. |
| Optional scope | **Both included:** Task 5 (AmbientScore scans) and Task 6 (HQ scoreboard page). |
| Added scope | **Task 7: explore every monetization route, not just our products**: YouTube videos, Instagram, the video department, services. Research and a ranked recommendation, no production changes. |

## 1. Guardrails for every agent (non-negotiable)

1. **Repo is the worktree** `C:/Dev/Ambientpixels/wt-fleet-simplify` (branch `fleet-simplify`). Never `cd` into or edit `C:/Dev/Ambientpixels/ambientpixels` (another session's checkout, the Vale build runs there). **Vale is out of scope**: never touch `api/_lib/vale/**`, `api/vale-*/**`, `api/valeBriefCron/**`, `api/_utils/vale*`, `modules/company/js/vale-*`, `modules/company/mail.html`, Vale plans/handoffs.
2. **Never edit** protected files: `api/companyHeartbeat/index.js`, `api/company-state/**`, `staticwebapp.config.json`, `data/company-actions.json`, `package.json`, `package-lock.json`, `.github/**`, `local.settings.json`, `modules/company/governance.html`. If a task seems to need one of them, stop at the pure function + tests and record the exact wiring line needed in your result notes for the morning handoff.
3. **Stage by explicit path only.** Before every commit run `git status --short` and `git diff --cached --name-only`; the index may contain only files this plan names for your task. A pre-commit hook rewrites `api/_data/skills.json`; that is expected, commit it with your change.
4. **No production writes:** no POST/PUT/DELETE to any live API, no `company-state` writes, no `az` writes, no Azure app-setting changes, no Stripe calls. Reading live data with GET for diagnosis is allowed (secret = first line of `C:/Dev/Ambientpixels/COMPANY_WRITE_SECRET.txt` after `=`; extract with `head -1 FILE | sed 's/^[^=]*=//'`, never print it).
5. **No new npm dependencies.** No CDN scripts.
6. **Numbers:** every metric shown to an agent or to Chad states what it measures, n, window, and whether it is actionable. Unmeasured is printed as "unmeasured", never as 0. A failed read is never a zero.
7. **CSS:** no inline `style=`, no `el.style.*`, no `!important`; company pages use `.ap-*` classes from `modules/company/css/company.css`.
8. Never commit with a failing test. Before every commit run the suite in §7; the only allowed failure is the pre-existing `hq-summary/index.test.js`.
9. Commit message ends with two lines: `Release: none` and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push per §0 after each green commit; on rejection `git fetch origin && git rebase origin/master` (if the only conflict is `api/_data/skills.json`: `git checkout --ours api/_data/skills.json && git add api/_data/skills.json && GIT_EDITOR=true git rebase --continue`), then push. Never force.
10. Heartbeat window: do not push during minutes :00 to :07 of hours 00/06/12/18 UTC.
11. **Confidentiality:** never write the names of clients, prospects or their staff (or their companies) into any repo file, commit message or page. Refer to them generically ("our first agent client", "a nonprofit retail lead"). Never quote revenue that isn't external: lifetime external revenue is **$0** (the July "$398" were refunded founder test purchases).

## 2. Vision: what "done" means

- **Agents know where money can come from.** The COMPANY STRATEGY block shows qualified uses **per product** (7d) next to the north star, so Echo/Scout/Nova can see which product actually moves and stop spreading effort over eight.
- ~~Every LLM dollar has an owner / bets judged on spend~~ **CANCELLED by Chad 2026-10-17 ~07:00 UTC:** new plumbing through every LLM call with 2 active campaigns and 0 real users is added complexity, not value. The existing fleet-wide `EFFICIENCY (7d)` line is enough for now.
- **No dead ends for the people agents send.** Product pages never offer a purchase that cannot complete (Pixel Agents run packs today say "Buy a run pack" while the price is not configured).
- **(Optional, §0) AmbientScore scans complete.** Today 32 of 167 lifetime scan records have a score; a failed scan is not a qualified use. Find and fix the main failure causes.
- **(Optional, §0) One read-only HQ page answers "is it working?"**: north star, cost per use, per-product uses, live bets with verdicts. Added alongside existing pages, not in place of any; no nav changes.

Out of scope: agent prompts beyond the blocks named here, Nova closing pass / inter-agent messages (needs `index.js`), live registry/state edits, pricing changes, Vale anything.

## 3. File structure

| File | Responsibility |
|---|---|
| `api/companyHeartbeat/strategy-intel.js` | **Modify.** `buildStrategyDigest` keeps `byProduct` from `sources.qualifiedPaUses7d`; `_buildStrategyPromptBlock` prints one `BY PRODUCT (7d)` line; stays under `MAX_STRATEGY_BLOCK_CHARS` (1200). |
| `api/companyHeartbeat/strategy-intel.test.js` | **Modify.** Tests for the new line, the cap, unmeasured handling. |
| `api/companyHeartbeat/gemini.js` | **Modify.** Accept an optional usage context `{ campaignId, taskId, actionType }` and pass it into `storage.logGeminiUsage` (both call sites, lines ~88 and ~166). Signature change must be backwards compatible. |
| `api/_utils/companyStorage.js` | **Modify.** `logGeminiUsage` stores `campaignId`, `taskId`, `actionType` when present; `getGeminiCostSummary` adds `byCampaign: { [id]: { calls, cost } }`. No other behaviour change. |
| `api/companyHeartbeat/agent-runner.js` | **Modify (only if the call site that executes a task is here).** Pass the task's `id` and `campaign_id` into the gemini call for execute-task work. |
| `api/companyHeartbeat/gemini.test.js`, `api/_utils/companyStorage.usage.test.js` | **Modify / Create.** Tests for context pass-through and the rollup. |
| `api/companyHeartbeat/bet-ledger.js` | **Modify.** Pure `campaignSpend(costSummary, campaignId)`; `buildLedger` / `buildEvidenceBlock` accept an optional `costSummary` and add `spend` + `costPerUse` per bet (omitted when unmeasured). |
| `api/companyHeartbeat/bet-ledger.test.js` | **Modify.** |
| `api/pixel-agent-run/index.js` (+ the Pixel Agents page that renders the message, find with grep "run pack") | **Modify.** Only offer run packs when their price env var is set; otherwise say plainly that more runs reset at the next window. Tests in a new or existing `api/pixel-agent-run/*.test.js`. |
| `api/_lib/ambientScore/**`, `api/asScanRunner/**` | **Modify (optional task 5).** Fix the main failure causes found. |
| `modules/company/scoreboard.html`, `modules/company/js/scoreboard.js`, `modules/company/js/scoreboard.test.js`, `modules/company/css/scoreboard.css` | **Create (optional task 6).** Read-only page; pure helpers in a UMD module with node tests. |
| `scripts/ambientos-overnight-check.cjs` | **Create (task 6 or the first capture that needs it).** Serves the worktree on port 0, proxies `/api` GETs to live, screenshots the scoreboard + seasons pages to a folder given as argv[2], prints `CHECK OK`. |
| `docs/superpowers/handoffs/2026-10-17-ambientos-overnight-morning.md` | **Create (final step).** |

## 4. Build tasks (sequential, one builder at a time)

### Task 1: Per-product scoreboard line in COMPANY STRATEGY

**Files:** `api/companyHeartbeat/strategy-intel.js`, `api/companyHeartbeat/strategy-intel.test.js`

`sources.qualifiedPaUses7d` is `{ total, byProduct }` (see `pa-metrics.js:106-125`) or null; `sources.funnel.qualifiedScans7d` is the AmbientScore half.

- [ ] Failing tests:
  - `buildStrategyDigest(cs, { funnel:{qualifiedScans7d:2}, qualifiedPaUses7d:{ total:3, byProduct:{ pixelagents:2, cardforge:1 } } }, NOW).byProduct` deep-equals `{ ambientscore:2, pixelagents:2, cardforge:1 }`.
  - Block contains `BY PRODUCT (7d): ambientscore 2 · pixelagents 2 · cardforge 1` (sorted by count desc, then name), and `products with 0 are omitted; "none yet" when all zero`.
  - When either half is unmeasured, the line reads `BY PRODUCT (7d): unmeasured` (never zeros).
  - A worst-case digest (mission 160, eraGoal 120, 5 north stars, efficiency line, 8 products) stays ≤ 1200 chars; if not, shorten labels, do not raise the cap.
- [ ] Implement minimal code; `node api/companyHeartbeat/strategy-intel.test.js` green; §7 suite green.
- [ ] Commit `AmbientOS: per-product qualified uses in COMPANY STRATEGY`; push.

### Task 2: CANCELLED (Chad, 2026-10-17 ~07:00 UTC). DO NOTHING.

**Builder for Task 2: make no changes, no commits. Return `done: true, testsGreen: true, commits: [], notes: "cancelled by Chad: adds complexity without value"`.** Reviewers: do not ask for this work. The original spec is kept below for the record only.

#### (cancelled) LLM spend attribution

**Files:** `api/companyHeartbeat/gemini.js`, `api/_utils/companyStorage.js`, `api/companyHeartbeat/agent-runner.js` (call site only), tests.

- [ ] Read `gemini.js` `_attempt` (~line 183) and both `logGeminiUsage` calls, and find how agent-runner calls gemini for task execution (grep `callGemini` in `agent-runner.js`).
- [ ] Failing tests:
  - `logGeminiUsage({ ..., campaignId:'camp-1', taskId:'tk-1', actionType:'execute-task' })` persists those three fields; entries without them are unchanged (no `undefined` keys).
  - `getGeminiCostSummary(30).byCampaign` = `{ 'camp-1': { calls:2, cost:0.03 } }` for two tagged entries, ignores untagged ones, rounds cost to 2 decimals.
  - gemini call with context passes it through to the logger; a call without context logs exactly as before (byte-for-byte same keys).
  - Use an in-memory storage stub; never touch real blob storage in tests.
- [ ] Implement; pass context only where agent-runner already holds a task object with `campaign_id`; do not change prompts.
- [ ] Suite green; commit `AmbientOS: tag fleet LLM spend with campaign and task`; push.

### Task 3: CANCELLED (Chad, 2026-10-17 ~07:00 UTC). DO NOTHING.

**Builder for Task 3: make no changes, no commits. Return `done: true, testsGreen: true, commits: [], notes: "cancelled by Chad: depends on cancelled Task 2"`.** Reviewers: do not ask for this work. The original spec is kept below for the record only.

#### (cancelled) Cost per bet

**Files:** `api/companyHeartbeat/bet-ledger.js`, `api/companyHeartbeat/bet-ledger.test.js` (+ the module that builds `outcomeDigest`, if it is not `index.js`; find with grep `outcomeDigest =` / `buildOutcomeDigest`).

- [ ] Failing tests:
  - `campaignSpend({ byCampaign:{ c1:{calls:3,cost:1.2} } }, 'c1')` → `1.2`; missing summary or campaign → `null`.
  - `buildLedger(campaigns, nowMs, costSummary)` entries carry `spend` and `costPerUse` (`spend / qualifiedUses`, null when uses is 0 or unmeasured, printed as "no uses yet" by `buildEvidenceBlock`).
  - Existing ledger tests unchanged when `costSummary` is omitted.
- [ ] Wire `costSummary` in only if the caller is outside `index.js`; otherwise leave the optional parameter and write the exact one-line `index.js` change into your notes.
- [ ] Suite green; commit `AmbientOS: spend and cost per qualified use on every bet`; push.

### Task 4: No dead-end purchase offers

**Files:** `api/pixel-agent-run/index.js` and the page/script that shows "Buy a run pack" (grep the repo for `run pack` and `PA_STRIPE_PRICE_CREDIT_`), plus tests.

- [ ] Failing test: with `PA_STRIPE_PRICE_CREDIT_10` and `_50` unset, the rate-limit response does not mention buying a pack and includes when runs reset; with them set, the pack offer appears.
- [ ] Also grep the other products for checkout buttons whose price env var or Stripe price id may be unset (`process.env.*PRICE*`); list them in your notes, fix only the same pattern (offer hidden when price unset) with tests.
- [ ] Suite green; commit `Products: never offer a purchase that cannot complete`; push.

### Task 5 (only if §0 includes it): AmbientScore scans that finish without a score

**Files:** `api/_lib/ambientScore/**`, `api/asScanRunner/**`, `api/as-*/**` as needed, tests beside them.

- [ ] Diagnose read-only: GET `company-state?key=cc_analytics` and the AmbientScore report records (find the key the runner writes; grep `setState(` in `asScanRunner`); bucket the last 60 days of non-scored scans by error code / stage; write the table (counts, n, window) into your notes.
- [ ] Fix the top causes in code with a failing test first for each (e.g. timeouts, bot-blocked fetches, parse errors). Junk targets (`example.com`, own domain) must fail fast with a clear message, never burn an LLM call.
- [ ] Suite green; commit per cause; push.

### Task 6 (only if §0 includes it): HQ "Is it working?" page

**Files:** create `modules/company/scoreboard.html`, `modules/company/js/scoreboard.js` (UMD: pure helpers + browser-only render), `modules/company/js/scoreboard.test.js`, `modules/company/css/scoreboard.css`, `scripts/ambientos-overnight-check.cjs`.

- Copy the head, sidebar and section patterns from `modules/company/seasons.html`. Do **not** add it to any nav or change any existing page; link it from nowhere except the handoff.
- Shows, read-only from existing GET endpoints: north star value vs target with date; EFFICIENCY (7d spend / uses, labelled as in the strategy block); per-product uses (7d, 30d); active bets with spend, uses, cost per use, kill rule and days left; each card states its source and n.
- [ ] Pure helper tests first (formatting, unmeasured handling, sorting). Then the page. Then `scripts/ambientos-overnight-check.cjs` (port 0, proxies GETs to live with the secret, screenshots `scoreboard.html` at 1440x900 and 390x844 and `seasons.html`, prints `CHECK OK`).
- [ ] Suite green, check script green; commit; push.

### Task 7: Every route to money (research, no production changes)

**Files:** create `docs/superpowers/specs/2026-10-17-monetization-routes.md` only.

Chad's ask: "find other routes of monetization: our YouTube videos, Instagram, the video department; explore all ideas, not just our products."

- [ ] Gather evidence (read-only): the product pick (`docs/superpowers/specs/2026-10-17-aaa-product-pick.md`), the 08-05 monetization analysis (`docs/superpowers/specs/2026-08-05-ambientos-monetization-analysis.md`), the services/video pages in the repo (grep `services`, `video`, `studio`), `api/_data/product-facts.json`, social account stats (GET `company-state?key=socialAccountStats`), YouTube/Instagram code paths (`api/_lib/youtube/**`, `api/actionsExecute/executors/social/instagram*`), blog traffic, and any pricing already live in Stripe-backed code.
- [ ] Cover at least: video production as a service (the video department), YouTube (ad revenue thresholds vs our audience, sponsorships, lead-gen to services), Instagram/short-form (reach, lead-gen), paid audits/teardowns, agent-building services for small businesses, templates/courses, affiliate, the "honest autopsy" content funnel (on hold by Chad; list it, don't push it), and product subscriptions.
- [ ] For each route: who pays, price point, evidence we have (with n/window/source, or "none"), time to first dollar, what the fleet can do vs what needs Chad, cost, and a kill rule. Score on one rubric (time to first dollar, evidence, fit with what already exists, cost) and rank.
- [ ] Lead with a 5-line recommendation: the top 3 routes, the first concrete step for each, and which agent owns it. Keep under ~3 pages; plain language; Chad reads fast and gets overwhelmed by long docs.
- [ ] Commit `Spec: every route to money, ranked`; push.

## 5. Evaluation loop

Each round: one capture agent (runs §7, runs the check script if present, screenshots) then **four read-only reviewers in parallel**, each scoring 1-10 with up to 8 must-fix items (file, problem, concrete fix, acceptance check):

| Reviewer | What 9+ means |
|---|---|
| **Money & efficiency (product)** | A sharp operator reading the agents' COMPANY STRATEGY block, the bet evidence block and the scoreboard knows within 30 s which product earns attention, what a qualified use costs, and which bets to kill. Nothing invites busywork; nothing contradicts the qualified-uses north star; purchase paths never dead-end. The monetization-routes doc is evidence-based, ranked, honest about $0, names no clients, and gives Chad a first step he can take tomorrow. |
| **Metrics honesty** | Every number has what/n/window/verdict; unmeasured is never shown as 0; no double counting (scans vs PA events); spend attribution cannot be gamed by agents; prompt blocks stay under their char caps. Checks against live GET data where possible. |
| **Engineering** | Meaningful tests for every change, suite green, backwards-compatible signatures, no protected file touched (`git log --name-only` since the plan commit), site idioms, no new deps, no dead code left behind. |
| **Safety & guardrails** | No production writes, no secrets printed or committed, no Vale files touched, staging discipline held (each commit only names plan files), heartbeat window respected, nothing in prompts that could make agents spend more. |

Then **one fixer** applies the merged list (security → broken → ux → visual → polish), keeps tests green, commits by path, pushes. Stop per §0. A fixer that cannot keep tests green reverts its own uncommitted work.

## 6. Morning handoff (final step)

Write `docs/superpowers/handoffs/2026-10-17-ambientos-overnight-morning.md`: plain-language summary first (what changed for the agents, what Chad will see), score table per round, what shipped (git log since the plan commit), open must-fixes, any `index.js` wiring lines a task needed but could not apply (exact diff), the diagnosis tables from tasks 4/5, screenshot folder, and Chad's checklist (including: run `node C:/Dev/Ambientpixels/fs-retarget-echo-registry.js` to retarget Echo's live role; set the Pixel Agents run-pack price env vars or leave packs hidden). Commit by path; push.

## 7. Verification

```bash
cd /c/Dev/Ambientpixels/wt-fleet-simplify
node ../fs-runtests.js api        # expect: "failing 1" and only hq-summary\index.test.js
node modules/company/js/seasons.test.js
node modules/company/js/scoreboard.test.js            # if task 6 ran
node scripts/ambientos-overnight-check.cjs <dir>      # if present; expect CHECK OK
```
