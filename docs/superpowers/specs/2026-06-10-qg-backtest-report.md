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
```

Canonical run results: 75 posts, 0 API errors after retry pass, 1 parse error (fails open, same as production). Cost ≈ $0.30/run (Haiku).
