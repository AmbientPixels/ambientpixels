# Handoff — The Strategic Engine (2026-06-11)

**Context:** The experiment era is over. In two days (2026-06-10/11) the platform went 5.5 → operationally trustworthy: composed quality gate at 90.2% backtested recall, flood root-cause fixed, **48h grace auto-publish LIVE** (CEO-confirmed posture). The CEO has declared the next phase: **operate like a real, successful company** — agents that *conceive* campaigns and goals, not just execute them. This handoff scopes that work.

Branch: `master` · all committed + pushed · latest commit `638e9bea`.

---

## 1. Where the system stands (foundation = done)

| Layer | State |
|---|---|
| Reliability | 100+ cycles, 0 errors; keep-alive pinger; hourly heartbeat |
| Quality gate | Composed verdict (`api/companyHeartbeat/quality-gate.js`): LLM + leak/persona/length detectors + repeat-promo serialization + claim grounding. 90.2% recall / 14.3% FF vs labeled history. Day-1 production leak ("Got it. Here's the Bluesky post…") found + patched same day (`638e9bea`) |
| Flood control | `social_attempts_cap` (2/task, CEO revision resets) — fired 3× in production day 1, working |
| **Auto-publish** | **LIVE.** `autoPublishGrace` hourly cron, 48h grace, maxPerDay 2, bluesky/x/linkedin, breaker (2 rejects/7d → self-disable + escalation), morning-report digest. Config: `systemConfig.autoPublish` (MERGE when editing — key also holds heartbeatModel + blueskyKeywords) |
| Rating | 6.5/10 — every remaining point lives in strategic/outcome autonomy |

**Soak watch (carry into any session):**
- First grace auto-publish expected ~2026-06-13T23:00Z (`act_1781218815118_8y2lin`, bluesky, pass@95 — links bare homepage not /pixel-agents/, CEO may revise first)
- Reflections due ~06-13 (3-day cadence post evidence-gate fix). If still 0 → debug
- C4: grace 48h→24h after 14 clean days + ≥5 auto-publishes (~June 24, manual config flip)
- A4 trigger: only if production false-flag rate >15% (then digest-grounding + Sonnet QG re-measure)

## 2. THE GAP — why agents don't conceive strategy

The audit verdict: strategic progress was **CEO-driven** (you pruned 11 stale objectives to 4; the system didn't). Root cause is not capability — it's that **nothing defines success**. Agents see world state (facts) but no targets (direction). `propose-campaign`/`propose-objective` exist as mechanics, but a proposal without a north star is plausible-sounding busywork — which is exactly what the 11-objectives-averaging-16% graveyard was.

Existing rails to BUILD ON (do not duplicate): World State (System 11), Goal Generation (System 13, product lifecycle), Capital Allocation (System 12), Outcome Attribution (System 9), `propose-objective`/`propose-campaign` handlers, `graceWindow.js` (reusable grace pattern), `companyWeeklyReport` (reusable cron pattern).

## 3. THE PLAN — Strategic Engine, 4 pieces in priority order

### SE-1: North-star KPI tree (highest leverage, smallest build)
New `companyStrategy` state key, CEO-authored once, agent-readable always:
```json
{
  "mission": "...",
  "era": "real-company-v1",
  "northStar": [
    { "metric": "bluesky_followers", "current": "auto", "target": 500, "by": "2026-09-30" },
    { "metric": "paying_customers", "current": "auto", "target": 1, "by": "2026-08-31" }
  ],
  "riskPosture": "...", "monthlyBudget": 35
}
```
Inject a compact `COMPANY STRATEGY` block into every prompt directly under WORLD STATE (same pattern, hard char cap). Every proposal gate gains one question: *which north-star metric does this serve?* — proposals that can't answer get flagged.
**Requires CEO input at session start: the actual metrics + targets (see §5).**

### SE-2: Measurable objectives (kills the stale-objective class)
Objectives gain machine-checkable success criteria: `{ metric, target, by }` resolved against world-state sources (socialAccountStats, blogPostViews, product usage, Stripe). Heartbeat computes `progress` from metrics — not task counts, not vibes. Auto-complete at target (governance-logged); auto-flag at deadline-miss. Retrofit the 4 active objectives (3 are at 90–99% and need completion flips anyway).

### SE-3: Monthly Strategy Brief (the conceiving ritual)
New cron (pattern: `companyWeeklyReport`, monthly): 
1. Each dept head pitches ONE initiative on the prior heartbeat (prompt nudge, like the weekly-report cadence): Echo growth experiment, Scout market gap, Scribe content series, Pixel design-led, Cipher efficiency play.
2. Nova synthesizes world state + outcomeDigest + research intel + the pitches into ONE Strategy Brief: situation → 2–3 objectives w/ SE-2 criteria → campaigns per objective → budget split (Capital Allocation) → kill-list (what to STOP).
3. Lands in AQ as a single `strategy_proposal`. CEO approves a month's direction in one read → objectives + campaigns auto-created on approval.
This gives "conceive" breadth (5 brains pitch) with coherence (1 brain synthesizes) and keeps the CEO at the altitude a real board operates at.

### SE-4: Strategy-class grace window (roadmap D1, reuse graceWindow pattern)
Campaign proposals auto-approve after **72h** when: linked to an active objective + passes Cipher's budget gate + proposer under monthly cap + <5 active campaigns. Same architecture as `_utils/graceWindow.js` (could generalize it). Same breaker philosophy. **Stays human forever (unchanged):** product launch/pivot/retire, fleet changes, budget >$2, campaign/objective cancellations, and the monthly Strategy Brief itself (v1).

**Sizing:** SE-1+SE-2 = one session (state key + prompt block + objective progress computation). SE-3 = one session (cron + pitch nudges + synthesis prompt + AQ kind). SE-4 = half a session (generalize graceWindow). Suggested order: SE-1+SE-2 first — they make everything downstream measurable.

## 4. Design principles (carried from the autonomy work — they earned it)
1. Deterministic rails over prompt hope (progress = computed, not claimed)
2. Measure before trusting (SE-4 only after SE-1..3 produce a month of clean proposals)
3. Graduated + revocable (grace + breaker, never immediate-on-pass)
4. Pure helpers + minimal call sites; offline-verify against live data before deploy
5. One verdict/one gate per decision class (the composed-QG lesson)
6. CEO altitude: board-level reads (one Strategy Brief), not queue-level toil

## 5. Open decisions — ASK CEO AT SESSION START
1. **North-star metrics + targets** (SE-1 blocks on this). Candidates: bluesky/total followers · paying customers / MRR (AmbientScore has Stripe live; Pixel Agents billing is groundwork-only) · weekly active product users · blog views/week. Pick 2–3 MAX with target + date.
2. **Revenue posture:** is "first paying customer" THE goal of this era, or is audience growth still the priority?
3. **Planning cadence:** monthly (recommended at current speed) vs quarterly.
4. **Pitch scope:** all 7 dept heads or start with Echo/Scout/Scribe (the three with outcome data)?

## 6. Operational reference
- Offline-verify pattern: Write tool → `C:\tmp\*.cjs` → `node c:/tmp/x.cjs`; mock `companyStorage` via `require.cache` (see `c:/tmp/test-grace-window.cjs` — 16-assertion example from Phase C)
- Backtest harness: `node scripts/backtest-quality-gate.cjs --skip-llm --reuse <prior.json>` for stable A/B; full LLM run needs `ANTHROPIC_API_KEY` (Azure Function App settings)
- `systemConfig` edits MUST merge, never overwrite
- company-state reads: handle both `{value: [...]}` and bare arrays
- Skill sync: `.claude/skills/*/SKILL.md` → pre-commit hook → `api/_data/skills.json` (hook reinstalled 2026-06-10 — verify it fires; was silently missing for a month)
- Heartbeat files remain read-before-edit; `quality-gate.js` is pure and safe to extend

## 7. Kickoff prompt (next session, verbatim)

```
Read ambientpixels/docs/superpowers/handoffs/2026-06-11-strategic-engine-handoff.md.
First check the soak items (sec 1): grace auto-publish of act_..8y2lin, reflections count,
breaker status. Then ask me the section-5 questions (north-star metrics, revenue posture,
cadence) and build SE-1 (companyStrategy key + COMPANY STRATEGY prompt block) and SE-2
(measurable objectives with metric-computed progress + auto-complete). Plan before coding.
Do not build SE-3/SE-4 until SE-1/SE-2 are deployed and verified.
```

---
*Generated 2026-06-11. Predecessors: `2026-06-10-full-autonomy-kickoff-handoff.md` (phases A–C, all shipped), `2026-06-10-self-sufficiency-tightening-handoff.md`. Audit: `../specs/2026-06-10-full-system-audit.md`. QG report: `../specs/2026-06-10-qg-backtest-report.md`.*
