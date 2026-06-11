# Handoff — Full Autonomy Kickoff (2026-06-10, part 2)

**Context:** Continuation of the self-sufficiency session (see `2026-06-10-self-sufficiency-tightening-handoff.md` for the morning's 3 commits + the 5.5/10 rating). This session completed **Phase 1 (quality hardening)** — all items shipped, verified, deployed — plus a global sentence-case fix, then scoped the **Full Autonomy Roadmap**. CEO deferred auto-publish ("not sure we are ready yet") — the roadmap honors that by sequencing trust-building phases first.

Branch: `master` · all work committed + pushed · Function App: `ambientpixels-nova-api` (rg `ambientpixelsV2`).

---

## 1. What shipped this session (3 commits, all deployed)

| Commit | What | Why / proof |
|---|---|---|
| `fbff432d` | **Semantic dedup for social posts** — pure `findNearDuplicateSocialPost()` in [helpers.js](../../api/companyHeartbeat/helpers.js) (word-overlap ≥0.6, same platform+campaign, 14d window, strips URLs/hashtags), wired into BOTH creation paths | Fuzzy guard blocked 0 all week while ~11 near-dups shipped. **Key trace:** the live path is the **index.js auto-post block** (`_social_action_pending` → `_createActionFromHeartbeat`), NOT the agent-runner handler the old handoff pointed at (that path SKIPS pending tasks). Verified offline: would have blocked 8/75 historical posts, all genuine dups, clean threshold gap (next tier 59/58/56%). |
| `90540127` | **Per-source daily post cap** — `campaignDailyPostCapStatus()`, source = `campaignId \|\| parentTaskId`, cap = daily-campaign `frequency+1` else 2, DEFERS ~3h (not drops) via `_social_post_deferred_until` | **Key finding:** worst flood was UNCAMPAIGNED — one promo task re-posted to X **14× in 24h** (13 CEO-rejected + 1 success); 43/75 posts have no campaign. So the cap is source-based and **counts rejected/failed attempts** (the flood is queue spam + CEO toil, regardless of shipping). Verified: defers 14/75 historical (the two real floods), 0 false positives — legit campaigns peak at exactly 2/24h. |
| `8e68122f` | **Proper sentence-case** — `capitalizeSentences()` (first word of each sentence + "i"→"I"; freezes URLs/domains/hashtags/@mentions; decimals/versions safe) applied in both social paths + bluesky-reply drafter; doctrine updated in [prompt-builders.js](../../api/companyHeartbeat/prompt-builders.js) (~2174) + [founder-voice-examples.json](../../api/_data/founder-voice-examples.json) principle #3 | CEO reversed the "start sentences lowercase" voice rule. Belt-and-suspenders: doctrine tells the LLM, code guarantees it. 14/14 edge-case tests; verified on real live copy. Blog/long-form = prompt-only (no deterministic markdown pass, by scope decision). Mid-sentence proper nouns ("ai"→"AI") deliberately NOT auto-fixed. |

**Gate audit trail:** both new gates log `policy-violation` with `gate: 'semantic_dup'` / `'campaign_daily_cap'`; counters land in `guardrails.fuzzyDupBlocked`. Suppression flags on tasks: `_social_action_suppressed_dup` (permanent) / `_social_post_deferred_until` (temporary).

**⚠ Production-firing check still pending:** as of last heartbeat (2026-06-11 03:00Z, healthy, 20s) both gates show **0 production firings — expected**, the system is drained (107/112 tasks done, 1 todo, AQ=1 item). Offline verification is solid (8 + 14 historical catches), but confirm real firings in `governanceLog` once social activity resumes.

## 2. Rating: 5.5 → **6.0 / 10**

Content quality 4→6 (this session's gain: dup flood, volume flood, broken capitalization all fixed+verified). Unchanged: autonomy/shipping 🔴3 (approval gate — deliberately held), strategic progress 🔴4, throughput 🟡5. Reliability 🟢9, governance 🟢8+.

**Framing:** operational autonomy ~9/10, outcome autonomy ~3/10. Phase 1's purpose was "fix quality BEFORE loosening the gate" — that prerequisite is now **done**, so the path to full autonomy is blocked only on (1) the auto-publish decision and (2) strategic self-direction.

## 3. THE PLAN — Full Autonomy Roadmap

**Read it:** [`docs/superpowers/plans/2026-06-10-full-autonomy-roadmap.md`](../plans/2026-06-10-full-autonomy-roadmap.md)

Five phases, graduated + revocable, each unlock measured first: **A** trustworthy QG (backtest → fix → re-measure) → **B** root-cause + self-direction (Echo re-injection fix, stalled-objective driver, experiment max-age) → **C** graduated auto-publish (48h grace, breaker, digest — **CEO posture confirm at entry**) → **D** strategic autonomy (campaign auto-approve, blog grace) → **E** 14-day acceptance test (target ≥8.5/10). Critical blast-radius stays human forever by design.

## 4. ▶ NEXT SESSION — Phase A, item A1: QG backtest harness

The QG (`_validateContentQuality`, [agent-runner.js:35](../../api/companyHeartbeat/agent-runner.js#L35)) has proven false-negatives (passed dups at 95–99% conf + the hallucinated 72/18/10-metrics blog). Before ANY autonomous publishing, measure it:

1. **Labeled data is already in the store:** 75 social actions with CEO decisions — `approved: 28, rejected: 44, ceo-rejected: 2, cancelled: 1`. Read `actions[i].payload.text` (FULL text — `preview` truncates at 120 chars and hides preamble/refusal leaks) + `approval.decision_note` for reasons.
2. **Classify rejects first** (quality-class: factual error / dup / broken copy / voice violation vs strategic-class: timing / topic — QG can't and shouldn't catch strategic). decision_note where present; judgment otherwise; record the labeling.
3. **Build `ambientpixels/scripts/backtest-quality-gate.cjs`** (durable script, NOT C:\tmp): replay the QG against all 75, exporting or replicating the `_validateContentQuality` prompt. Needs `ANTHROPIC_API_KEY` env var locally. Node only (no Python on this machine).
4. **Report:** recall on quality-class rejects, false-flag rate on approves, per-failure-mode breakdown. Phase A exit needs ≥90% / ≤15%.
5. Then A2 (unify deterministic pre-checks into the QG verdict) per the roadmap.

**Also at session start:** check `governanceLog` for first production `semantic_dup` / `campaign_daily_cap` firings (see §1 ⚠).

## 5. Operational reference (additions this session)

- **Offline verify pattern that worked 3×:** Write tool → `C:\tmp\*.cjs` → `node C:/tmp/x.cjs` (forward slashes); require heartbeat helpers directly (`require('c:/Dev/Ambientpixels/ambientpixels/api/companyHeartbeat/helpers.js')` — pure fns load clean). Scripts left in place: `verify-semdup.cjs`, `verify-dailycap.cjs`, `probe-burst.cjs`, `probe-status.cjs`.
- **company-state reads:** some keys return `{value: [...]}`, others bare arrays — handle both (`Array.isArray(p) ? p : p.value`).
- **Don't embed control bytes / fancy escapes via bash heredocs into source** — PowerShell/bash escaping mangles regex backslashes. Write tool → temp file → node splice was the reliable path.
- **Git here-string gotcha:** `git commit -m @'...'@` leaked a literal `@` into the subject; use multiple `-m` flags instead. Benign CRLF warnings on commit are normal.
- **Doctrine + enforcement must move together:** when changing voice/style rules, update BOTH prompt text (prompt-builders.js + founder-voice-examples.json) AND the deterministic sanitizer, or they fight.

## 6. Open decisions
1. **Auto-publish posture** — deferred to **Phase C entry** (after A+B exit criteria). Recommended: 48h grace, graduated shrink. Do NOT build Phase C before A+B are measured-done.
2. **A4 QG model** (Haiku vs Sonnet) — decided by A1 backtest data, not preference.
3. **B4 agent diversity** — diagnose-first, optional, not autonomy-blocking.

## 7. Kickoff prompt (next session, verbatim)

```
Read ambientpixels/docs/superpowers/handoffs/2026-06-10-full-autonomy-kickoff-handoff.md,
then the roadmap it links. First verify the semantic_dup and campaign_daily_cap gates have
fired in production since 2026-06-10 (governanceLog) and report. Then start Phase A, item A1:
build the quality-gate backtest harness (ambientpixels/scripts/backtest-quality-gate.cjs),
classify the 46 historical CEO rejects as quality-class vs strategic-class, and report QG
recall / false-flag rate against the Phase A exit criteria (>=90% / <=15%). Do not build
auto-publish (Phase C) — it is gated on Phase A+B exit criteria plus CEO posture confirm.
```

---
*Generated 2026-06-10 (part 2). Predecessor: `2026-06-10-self-sufficiency-tightening-handoff.md`. Roadmap: `../plans/2026-06-10-full-autonomy-roadmap.md`.*
