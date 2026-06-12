# Handoff — SE-3 Monthly Strategy Brief (2026-06-12)

**Context:** SE-1 + SE-2 + SE-2.5 shipped and live-verified tonight (commits `e390b374..eaea2d95`, 10 total). CEO chose **soak-first**: let the strategy layer run through the June-13 checkpoint, then build SE-3 next session. Plan executed: `docs/superpowers/plans/2026-06-11-strategic-engine-se1-se2.md` (all tasks complete + SE-2.5 follow-up).

Branch: `master` · all pushed · latest commit `eaea2d95`.

---

## 1. What is LIVE as of tonight

| Piece | State |
|---|---|
| `companyStrategy` key | Seeded, CEO-confirmed: era `real-company-v1`, revenue-first. paying_customers 0→1 by 08-31 (PRIMARY, manual) · bluesky_followers 72→500 by 09-30 (auto) · blog_views_week 16→100 by 09-30 (auto) · weekly_active_users →25 by 09-30 (manual). Monthly cadence, $35/mo. Edit via `scripts/seed-company-strategy.cjs` |
| COMPANY STRATEGY block | In every agent prompt directly under WORLD STATE (~800 chars, 1200 hard cap). Live-resolved values each cycle |
| `strategy-intel.js` | Pure module: METRIC_RESOLVERS (add new metrics here), buildStrategyDigest, _buildStrategyPromptBlock, evaluateObjectives. Tests: `c:/tmp/test-strategy-intel.cjs` (34 assertions) |
| SE-2 measurable objectives | `criteria: {metric, target, by, baseline}` → metric-computed progress, auto-complete at target (`objective_auto_complete` gov event), one-shot deadline-miss flag. Terminal statuses (complete/canceled/**archived**) skipped. Legacy task-rollup untouched for non-criteria objectives |
| SE-2.5 approval loop | propose-objective schema has `metricTarget`+`metricDeadline` (both-or-neither); Action Center approval mints `criteria` with `baseline: null`; heartbeat stamps baseline with live value on FIRST eval; AQ drawers show north-star line + amber "serves no north star" badge; approved campaigns carry `northStarMetric` |
| Retrofit | obj-founder-voice / obj-pulse-promo / obj-the-floor → complete (`retrofit:se2`, 3 gov entries). Only active objective: obj-pa-redesign-launch (legacy) |
| Proposal gating | `northStarMetric` required by schema; missing/invalid → `strategyFlag: 'no-north-star-metric'` (FLAG not block; no flag when strategy unseeded) |

## 2. SOAK CHECKLIST — run at next session start (same drill as tonight's sec-1 check)

1. **Proposals since 06-12:** AQ + governanceLog — do `objective_proposal`/`campaign_proposal` entries carry `northStarMetric`? Flags should fade after the first few cycles; if still flagged ~06-15+, tweak the STRATEGIC AUTHORITY prompt text (prompt-builders.js ~1995).
2. **First measurable objective:** if CEO approved any proposal with a target — verify `criteria.baseline` got stamped next cycle (`baselineStampedAt`) and Goals page shows computed progress.
3. **Reflections (deadline 06-13):** count `type='reflection'` in agentMemories newer than 06-10. Still 0 → debug nudge→response→write path (machinery verified armed: constants.js:112 L4_STRUCTURAL_TYPES + prompt-builders.js:1477 nudge fires for null lastReflectionAt).
4. **Grace window:** first `auto-publish-grace` gov event when CEO leaves a QG-pass post alone 48h. Note 06-12: first candidate (act_..8y2lin) was CEO-approved manually 2h in — path still untested in prod. C4 (48→24h, ~Jun 24) needs ≥5 auto-publishes + 14 clean days.
5. **No `Strategy digest failed`** lines / heartbeat errors; prompt avg ~80.2k chars (was 79.8k).

## 3. SE-3 BUILD SPEC (one session — decisions already locked with CEO)

**Locked decisions:** ALL 7 dept heads pitch (echo, scout, scribe, pixel, cipher, forge, quill — nova synthesizes) · monthly cadence · revenue-first framing · Brief itself stays human-approved forever (v1).

Build, on existing rails (do NOT duplicate):
1. **Cron** `strategyBrief` — monthly, pattern: `companyWeeklyReport` (offset from heartbeat + grace cron; those run :00 and :30).
2. **Pitch nudge** — on the heartbeat(s) preceding brief day, each dept head's prompt gets a PITCH section: ONE initiative, must name northStarMetric + expected movement + rough cost. Store pitches (suggest: `runtimeMemory.strategyPitches` or reuse agentMessages pattern — decide in plan).
3. **Nova synthesis** — world state + outcomeDigest + research intel + strategyDigest + the 7 pitches → ONE brief: situation → 2–3 objectives **with SE-2 criteria (metricTarget/metricDeadline)** → campaigns per objective → budget split (Capital Allocation) → kill-list (what to STOP).
4. **New AQ kind `strategy_proposal`** — single entry, CEO approves a month's direction in one read. Approval auto-creates objectives (via the SE-2.5 criteria-minting path — already built and tested) + campaigns (with northStarMetric).
5. **Verify discipline:** pure helper module (`strategy-brief-intel.js`?) + offline .cjs tests + plan-before-code, same as tonight.

**After SE-3 (separate tracks):** SE-4 strategy-class 72h grace (only after ~a month of clean briefs) · telemetry wiring (Stripe→paying_customers, WAU source — makes PRIMARY north star self-measuring) · Nova Voice (spec approved 06-10, untouched).

## 4. Operational notes (unchanged from prior handoff, still true)

- Offline-verify: Write → `c:/tmp/*.cjs` → `node c:/tmp/x.cjs`; strategy-intel is pure (no mocks needed); graceWindow mock pattern in `c:/tmp/test-grace-window.cjs`
- `systemConfig` edits MUST merge · company-state reads return `{value}` wrapper · heartbeat files read-before-edit
- Pre-commit skills-sync hook verified firing tonight (every commit shows `[syncSkills]`)
- Known pre-existing quirks (NOT fixed, don't trip on them): index.js:898 activeObjectives filter passes `archived` status (filtered elsewhere); sequential agent-loop fallback ctx (index.js ~1928) lacks outcomeDigest/reflectionDigest/worldState that parallel has

## 5. Kickoff prompt (next session, verbatim)

```
Read ambientpixels/docs/superpowers/handoffs/2026-06-12-se3-strategy-brief-handoff.md.
First run the soak checklist (sec 2): proposal northStarMetric adoption, reflections
count (deadline was 06-13 — debug if still 0), grace-window status, strategy-digest
health. Report findings. Then build SE-3 per sec 3: monthly Strategy Brief cron,
7-head pitch nudges, Nova synthesis with SE-2 criteria, strategy_proposal AQ kind +
approval auto-creation. Plan before coding. SE-4 stays unbuilt until a month of
clean briefs.
```

---
*Generated 2026-06-12. Predecessor: `2026-06-11-strategic-engine-handoff.md` (SE-1/SE-2 — DONE). Plan executed: `../plans/2026-06-11-strategic-engine-se1-se2.md`.*
