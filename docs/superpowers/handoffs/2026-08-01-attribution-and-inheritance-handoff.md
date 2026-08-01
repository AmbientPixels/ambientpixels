# Handoff — outbound attribution fixed, Track C Phase 1 shipped, Season 1 live

> **⛔ CORRECTION added after this handoff was first written.** The "$398 first revenue" was **the CEO's own test purchases** — external revenue is **$0**. The `revenueLedger` blob shows both entries as `customerEmail: thechadmartin@gmail.com`, `sourceId: cs_live_...`, $199 each at 02:38:00 and 02:40:12 on 2026-07-30 — 11 and 13 minutes after the Teardown shipped (`691d0cba`, 02:26:50Z) and ~17 minutes *before* the commits that stopped `/ambientscore/*` rewriting teardown.html to index and fixed its 404ing API route. No public visitor could have completed that flow at 02:38.
>
> Live mode, so real money moved and Stripe took ~$66 in fees. It paid echo 168 / scribe 148 revenue XP (~95% of all July season XP) and made echo Season-1 `previousChampion`; a refund pays nothing but does **not** claw back awarded XP.
>
> **Consequence for §1 below:** the utm finding (0/24 on replies) is independently verified and the fix stands, but the framing "money arrived from an untracked channel" is **wrong** — it arrived from no channel. Read §1 with that correction in mind.
>
> Read the ledger with: `MSYS_NO_PATHCONV=1 az storage blob download --account-name cardforgeblobdata --container-name company-state --name revenueLedger.json --account-key <key>` — it is storage-direct, not a `company-state` VALID_KEY, so no endpoint exposes per-entry rows.

**Date:** 2026-08-01 (session ran through the month boundary) · All work committed, pushed and deployed. Working tree clean.

**Read first:** memories `project_prospect_reply_attribution`, `project_retirement_inheritance`, `project_revenue_seasons`; skill `agent-rewards`.

---

## 1. The headline: we found why revenue was unattributable

**Prospect replies carried no UTM. At all.** Coverage across the 62 fleet actions of the prior week:

| Action type | `utm_content` |
|---|---|
| `social_post.schedule` | 23/24 |
| **`social_post.reply`** | **0/24** |

Attribution keys on `utm_content` = originating action id (`rewards-engine.js:390`). The replies — the *only* channel talking to buyers — carried a personalised `?id=ccr_...` report link and nothing else. So an outbound-originated sale was **structurally** unattributable and fell to the 50%-to-campaign-assignees fallback, which is what paid Echo 168 / Scribe 148 by guesswork.

100% unattributed was never a rewards-engine bug. It was the sales channel being untracked.

**FIXED** (`eb013d83`). New `api/_utils/socialUtm.js` (pure, 14 tests) + a stamp on the reply path. The reply action id is now minted **before** the text is finalised, so the tag in `payload.text` and the action's own id are the same value — that identity is the entire mechanism.

**The $398 stays permanently unexplained.** This only makes the *next* sale traceable.

## 2. Duplicate outreach — also fixed

3 of 21 `sent` prospects were messaged twice with the same finding reworded. The guard from the 07-24 fruitfop incident (`0a9eb9ec`) matched only `approval.status === 'pending'`; once the first reply was **approved and executed** it stopped matching, so the next cycle drafted another. zimpirate was double-messaged on 07-28 — four days after that guard shipped.

**FIXED** (`672138be`). Pure `findBlockingReply` in `prospect-pipeline.js` (8 tests) blocks on anything **not rejected**. A rejected reply deliberately does not block — it never reached anyone, and redraft-after-rejection is how copy improves. An absent status blocks, since we cannot prove it was never sent.

## 3. Two things worth copying as method

- **Verify the key before changing the filter.** All three duplicate pairs shared the same `_parentTaskId`, proving the guard's key was right and only its status test was wrong. Had they come from different tasks, widening the status filter would have shipped a fix that changed nothing.
- **Replay real incidents, don't just unit-test.** All three historical second-drafts (fruitfop, vocalai, zimpirate) were replayed against the new predicate and blocked. Closest thing to live verification without waiting for a prospect.

## 4. Hazards found the hard way (do not re-learn these)

- **`_trimSocialToLimit` (`agent-runner.js:3029`) only protects a trailing link preceded by a NEWLINE.** Prospect replies put the link inline after a colon. Reusing that trim would have hard-cut the report link off every reply — trading untracked replies for replies with no link at all. `trimPreservingTrailingUrl` handles both shapes.
- **UTM length maths:** suffix ≈ 63 chars (a 31-char `act_<13>_bsreply_<5>` id) against a 280 cap / 300 Bluesky limit. A realistic reply lands at 266.
- **The stamp runs BEFORE the quality gate and that is safe — but not for the obvious reason.** `detectFabricatedUrl` does not compare against the `[SCAN RESULT]` link; it validates the path against `_OWN_URL_ALLOWLIST` (`quality-gate.js:156-171`), and the report-link regex has **no end anchor**, so a trailing `&utm_...` still matches. Verified `fabricated:false` + a clean `composeQualityVerdict`. An earlier draft of the spec asserted the opposite ordering; it has been corrected in place.
- **`memoryConsolidate` iterates EVERY key in `agentMemories` with no active-agent filter** (`memoryConsolidate/index.js:75`) — it keeps collapsing *archived* agents' memories forever. This is what set Track C's deadline.

## 5. Track C — Phase 1 shipped, Phase 2 deliberately deferred

The ladder promises a retiring agent *"your successor would inherit your memories"* and that was false. Spec `specs/2026-07-31-retirement-knowledge-inheritance-design.md`, plan `plans/2026-07-31-retirement-inheritance-phase1.md`.

**Shipped** (`c3d9e27e`, `2193584f`, `89032992`): new `agentInheritance` state key; pure `api/_utils/inheritanceEscrow.js` (9 tests); a non-fatal capture step in the retire branch that freezes `agentMemories` + `weeklyReports` between the registry archive and the governance log. `agentMemories` is read-only there — never written, never deleted — so a failed capture stays recoverable. Governance entries now carry `inheritanceCaptured` + `inheritanceCounts`. Worst-case escrow measured at ~24 KB.

**Phase 1 makes the promise keepable, not kept.** Nothing reads an escrow yet.

**Phase 2 deferred** — distillation, `successorTo` matching at hire, the prompt block, ageing, alerting. Due before the first **successor hire**, strictly later than the first retirement approval (earliest 2026-10-01). Its two open forks are recorded in §6 of the spec:
1. Hire-only delivery may never fire — you retire an agent *because* it isn't earning, and a same-role replacement spends that saving straight back.
2. LLM cron vs deterministic selection — the escrow retains `raw`, so either can be built without migration.

## 6. Seasons dashboard — visual check done

`70d2615e`. Rendered against live data (production is auth-gated; verified via a local render, so the SWA auth wrapper itself is unverified). Four fixes; the substantive one: the Ladder column showed **nine green "Safe" pills under an UNSCORED SEASON banner**. Absent `ladderStatus` means *never judged*, not *judged and cleared* — it now reads "not yet judged", while real ladder history still shows once a season is scored.

## 7. Season 1 went live during this session

The rollover fired **2026-08-01T00:30:00Z**:

- `season: 2026-08`, `par: 40` (the floor — July's median seasonXp was 0)
- `previousChampion: echo` (176 in July)
- **`parMisses: 0` for every agent; all tiers `line`**

July was unscored, so it conferred no par misses and no privilege tiers — the load-bearing invariant held on the first real rollover. Note the dashboard now flips to its scored branch: real "Safe" pills and real par bars against 40.

## 8. Open, in priority order

1. **Watch the two fixes land** — neither is verifiable from the CLI. Confirm new replies carry `utm_content` in `payload.text`, and that `revenueDigest.attributedRevenueCents` goes non-zero on the next sale.
2. **Duplicate UTM logic in two places** — the scheduled path still has an equivalent injection inline at `agent-runner.js:3313-3328`. It works and is production-verified, so it was left alone; consolidate onto `socialUtm.js` next time that path is touched or the two will drift.
3. **`memoryConsolidate` scoping** — one active-agent filter, but it changes a live cron.
4. **Shared sidebar overflows to 571px at phone widths** across every `/modules/company/` page (`agent-progress.html` too, not just Seasons).
5. **Content quality** — many scheduled posts were navel-gazing (a Bluesky post about the *"$35 monthly budget / operation: budget compliance"* linking to the bare homepage). Predates the 07-31 doctrine retune whose new Scribe core question targets exactly this. Needs a few days of data, not a code change.
6. **Season 1 is the first scored season** — par 40 is clearable by churn (~14 days at 3 XP/day) while the revenue lane needs traffic that barely exists. Retune levers: `SEASON_PAR_CEILING`, `MERIT_MIN_SIGNAL`, `SEASON_PAR_GROWTH`.

## 9. Session verification

All suites green at handoff: prospect-pipeline **58/58**, socialUtm **14/14**, inheritanceEscrow **9/9**, rewards-engine **73/73**, heartbeat smoke **25/25**, seasons dashboard **14/14**.

Nine commits, `ba333123..672138be`, all pushed. The auto-push was **not** running this session — commits sat local until pushed explicitly; worth checking whether that is expected. `gh` is not authenticated, so deploys were verified by polling the API rather than reading the Actions run.
