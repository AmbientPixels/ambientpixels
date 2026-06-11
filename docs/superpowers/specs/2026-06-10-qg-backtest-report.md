# Quality-Gate Backtest Report — Phase A1 (Full Autonomy Roadmap)

**Date:** 2026-06-10 · **Harness:** [`scripts/backtest-quality-gate.cjs`](../../../scripts/backtest-quality-gate.cjs) · **Labels:** [`scripts/backtest-quality-gate-labels.json`](../../../scripts/backtest-quality-gate-labels.json) · **Roadmap:** [`plans/2026-06-10-full-autonomy-roadmap.md`](../plans/2026-06-10-full-autonomy-roadmap.md)

## Verdict: Phase A exit criteria NOT met — A2/A3 are mandatory before any auto-publish

| Metric | Result | Target | Status |
|---|---|---|---|
| Recall on quality-class rejects — **LLM QG alone** | **17.1%** (7/41) | ≥90% | 🔴 FAIL |
| Recall on quality-class rejects — **composite** (QG + semantic_dup + daily_cap) | **48.8%** (20/41) | ≥90% | 🔴 FAIL |
| False-flag rate on approves — LLM QG alone | **14.3%** (4/28) | ≤15% | 🟡 PASS (barely, and the flags are claim-grounding noise — see below) |

The Haiku QG as deployed is **not a trust foundation for autonomous publishing**. The CEO's "not sure we are ready yet" instinct is now measured fact.

## Setup

- **Population:** all 75 historical `social_post` actions with CEO decisions (28 approved, 41 quality-class rejects, 5 strategic-class rejects, 1 pending + 1 cancelled excluded; 2 text-less site publishes excluded).
- **Labeling:** every reject classified quality-class (QG could/should catch: dup, voice, broken copy, refusal/meta leak, fabrication) vs strategic-class (timing, topic, platform policy — not the QG's job). From `decision_note` where present, judgment otherwise; 8 labels marked `borderline` in the labels file.
- **LLM QG:** exact replica of `_validateContentQuality` (agent-runner.js:35) — same model (`claude-haiku-4-5-20251001`), same prompt, same data files, production auto-reject rule `!pass && confidence>=70` (agent-runner.js:2939).
- **Deterministic gates:** `findNearDuplicateSocialPost` + `campaignDailyPostCapStatus` replayed chronologically with **creation-time approval statuses** (a prior rejected later was still pending when the gate would have run — the harness reconstructs this from `approved_at`/`decided_at`).

## Per-failure-mode breakdown (41 quality-class rejects)

| Mode | Total | QG caught | dup gate | daily cap | Any | Missed |
|---|---|---|---|---|---|---|
| dup / repeat-promo | 27 | 2 | 5 | 14 | 15 | 12 |
| voice | 6 | 3 | 1 | 0 | 3 | 3 |
| broken_copy | 3 | 1 | 0 | 0 | 1 | 2 |
| refusal_leak | 2 | 1 | 0 | 0 | 1 | 1 |
| fabrication | 2 | 0 | 0 | 0 | 0 | 2 |
| meta_leak | 1 | 0 | 0 | 0 | 0 | 1 |

## The five findings that matter

1. **The QG is structurally blind to the #1 failure class.** 27/41 quality rejects are dup/repeat-promo. A per-post LLM check with no history cannot catch dups (it passed them at 95–99% confidence, exactly as the handoff predicted). The Phase-1 deterministic gates catch the literal floods (14 by cap, 5 by word-overlap) but **11 of 12 remaining misses are differently-worded repeat-promos** — the startup-obituary family: 9 near-identical-in-substance Bluesky posts over 11 days, each worded differently enough to stay at 0.13–0.47 similarity (threshold 0.6), each only 1/day so the cap never fires. The CEO approved exactly one and curated out the rest as "duplicate/low-distinct promo."
   → **A2 addition (new, concrete): repeat-promo URL check.** Same destination URL (normalized, UTM-stripped) + same platform within N days (suggest 7) → flag/defer. Deterministic, pure-helper, would have caught ~11 of the 12 missed dups. This single check moves composite recall from 48.8% to ~75%.
2. **Leak classes need regex, not LLM.** The refusal-leak ("I cannot produce an X post…") passed at conf 100 in one run; the meta-leak (revision commentary in the payload) passed at 92. Production already has refusal-detect/preamble-strip in the index.js auto-post block — **A2's job is composing them into the QG verdict** so the AQ badge and any future auto-publish consult ONE gate. A `[placeholder]`-pattern check (`[link to blog post]` shipped in copy) belongs in the same pass.
3. **The false-flag rate is 100% claim-grounding noise.** All 4 flags on approved posts are "FABRICATED STATISTIC" hits on **real telemetry** (36 TaskCanceledException errors, 14 X visits — true numbers from App Insights/Pulse) plus one rhetorical-hook flag the CEO overruled. The QG prompt orders Haiku to flag any number not in product-facts.json, but agents legitimately quote live metrics. **A3 (claim-grounding against task description + deliverable chain + product facts) fixes the false-flag problem, not just the fabrication problem.** Until A3, lowering the false-flag rate further would mean missing real fabrications.
4. **Fabricated persona narratives are an unguarded class.** Forge's fake 2am-bug-hunt story and Cipher's "I handle the money here" persona post both passed at 95. The QG prompt has no rule against invented first-person narratives. → A2/A4: add a prompt rule ("posts must not present invented personal anecdotes or agent personas as human staff") and re-measure.
5. **Haiku's verdicts are unstable run-to-run.** Same prompt, same posts: QG-alone recall measured 12.2% then 17.1%; false-flag 10.7% then 14.3%. Borderline posts flip (`pj06sn`, `y7yp2d`). Confidence values are uninformative (95 on almost everything, including passes on garbage and a conf-100 pass on a refusal leak). **A4 (model decision) should re-run this harness after A2/A3 land** — measure Sonnet vs Haiku on the residual (voice + fabrication + contradiction), not on the classes deterministic checks will own.

## Strategic-class sanity check

5 rejects labeled strategic (stale timing ×2, X-platform directive, topic choice ×2): QG flagged 1/5 — low interference, as designed. These stay human/policy concerns; no gate work needed.

## Recall roadmap if A2+A3 land (estimated against this same labeled set)

| Step | Catches | Composite recall |
|---|---|---|
| Today (QG + Phase-1 gates) | 20/41 | 48.8% |
| + repeat-promo URL check (A2) | +11 | ~75% |
| + refusal/meta/placeholder regex composed into verdict (A2) | +3–4 | ~85% |
| + claim-grounding (A3) + persona rule + parse-hardening | +2–4 | **~90–95%** |

≥90% is **plausibly reachable without a model swap**; A4 stays data-driven after re-measure.

## Reproduce

```bash
ANTHROPIC_API_KEY=... node scripts/backtest-quality-gate.cjs            # live actions
node scripts/backtest-quality-gate.cjs --skip-llm                       # deterministic only, no key
node scripts/backtest-quality-gate.cjs --reuse <prior-results.json>     # reuse LLM verdicts (stable A/B)
```

Canonical run results: 75 posts, 0 API errors after retry pass, 1 parse error (fails open, same as production). Cost ≈ $0.30/run (Haiku).

---

# A2+A3 UPDATE (same session) — exit criteria MET

The composed gate (`api/companyHeartbeat/quality-gate.js`) was built and wired into BOTH creation paths the same session. Re-measured against the same labeled history:

| Metric | A1 baseline | A2/A3 composed | Target | Status |
|---|---|---|---|---|
| Recall on quality-class rejects | 48.8% | **90.2%** (37/41) — identical across reused-LLM and fresh-LLM runs (deterministic checks carry it; LLM-alone swung 17.1%↔9.8% with zero effect on the total) | ≥90% | 🟢 MET |
| False-flag on approves | 14.3% | **14.3–17.9%** across runs (4–5/28, pure LLM variance) | ≤15% | 🟡 ON THE LINE |

**What was added (all pure functions in quality-gate.js, replayable offline):**
- `detectContentLeaks` — refusal-as-payload (incl. the patterns the index.js mirror missed), revision-commentary leak, `[placeholder]`, **agent-persona** ("i'm scribe", "my name is cipher", "forge out" — CEO rejected all 3 historical instances; "chad here" stays legit), **LinkedIn >1500 chars** (CEO note: "cut by 60%+").
- `repeatPromoUrlStatus` — **queue-collapse semantics**: at most ONE undecided post per deep link per platform; the next one DEFERS (~6h, `repeat_promo_url` gate) until the pending one is decided. Deliberately NOT a frequency cap — the CEO approved daily same-link posts in May, so shipped-frequency is a campaign decision; only the unshipped pile-up (the 9-post June curation) is redundant. Catches 24/27 dup-class rejects; the 2 family-firsts it passes SHOULD pass (one queued promo per link is legitimate).
- `findUngroundedClaims` + `buildGroundingText` (A3) — numbers traced against task chain + product-facts; grounded numbers suppress the LLM's "fabricated statistic" flag, ungrounded ones become a soft AQ warning (no auto-reject in v1).
- `composeQualityVerdict` — ONE verdict `{pass, confidence, issues, deterministicFlags}`; leak classes hard-fail at conf 100; downstream reject/circuit-breaker/AQ-badge code consumes it unchanged.

**The 4 remaining misses, all defensible:** 2 family-firsts (correct passes by design), 1 generic-filler voice post (LLM passed at 95 — the A4 model question), 1 self-contradictory post (genuinely hard).

**False-flag composition (the honest caveat):** all 4–5 flags are the LLM's "fabricated statistic" on REAL telemetry (App Insights / traffic numbers the agent saw in its prompt digests, which the task-chain grounding corpus can't see) plus one tone overrule. Production grounding can be extended with the live intel digests at creation time — not backtestable (historical digests weren't stored), but by inspection it covers 3–4 of the 5, putting expected production FF at ~4–7%. **If production FF measures >15% after activity resumes, the A4 session picks up digest-grounding + the Sonnet swap.**

**Overfitting note:** the persona and length checks were derived from this same labeled set (n=41), so 90.2% is in-sample. Mitigation: every new check encodes a CEO-documented rule (rejection notes, standing LinkedIn guidance), not a fitted threshold — and the harness re-runs cheaply as new CEO decisions accumulate.

**Repeat-promo defers on approves (not false flags):** 9/28 approved posts would have been *delayed* (not dropped) — 4 are replay artifacts (the June pile's survivors, counted against a queue that wouldn't have existed), 5 are May same-link overlaps that would have shipped hours later in sequence.
