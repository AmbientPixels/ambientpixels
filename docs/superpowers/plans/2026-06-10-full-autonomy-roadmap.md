# Full Autonomy Roadmap — AmbientOS

> **For agentic workers:** This is a multi-session ROADMAP, not a single implementation plan. Each phase gets its own bite-sized implementation plan (via superpowers:writing-plans) at the session where it starts. Phase A item A1 has enough detail in the kickoff handoff to start immediately.

> **⚡ 2026-06-10 EVALUATION UPDATE — SLIMMED EXECUTION PLAN SUPERSEDES THE PHASE SIZING BELOW.**
> Full audit: [`../specs/2026-06-10-full-system-audit.md`](../specs/2026-06-10-full-system-audit.md) (rating 6.5/10). A1 backtest: [`../specs/2026-06-10-qg-backtest-report.md`](../specs/2026-06-10-qg-backtest-report.md) — QG recall 17.1% solo / 48.8% composite vs ≥90% target = **Phase A exit FAILED**, false-flag 14.3% (≤15% pass).
> CEO judged the full 5-phase ceremony oversized for current stakes (~125 followers, $15/mo, breaker bounds worst case at 2 bad posts). The path compresses to **3 working sessions**:
> 1. **A2+A3 together** — one QG verdict object composing: refusal/meta-leak/placeholder regexes, semantic_dup, daily_cap, and a NEW **repeat-promo URL check** (same UTM-stripped URL + platform within 7d — the A1 backtest's biggest gap: 11/12 missed dups are differently-worded daily repeat-promos) + claim-grounding. Re-run `scripts/backtest-quality-gate.cjs`; exit at composite ≥90% / false-flag ≤15% (aspire <5%).
> 2. **B1 only** — Echo re-injection root fix. A4 model swap only if step 1's re-run still misses. **B2 demoted** (CEO pruned objectives 11→4 on 06-10; revisit only if staleness recurs). **B3 moot** (agentExperiments empty).
> 3. **Phase C entry** — grace window + breaker + digest as specced in C1–C3 below. CEO posture confirm at entry. The 14-day soak is just the system running; **no formal Phase E** — 14 clean days → shrink grace per C4. Phase D and monthly D3 audits become opportunistic.
> Detailed C1–C4 specs, exit criteria, and the stays-human-forever list below remain authoritative.

**Goal:** Take AmbientOS from 6.0/10 (operationally self-sufficient, outcome-gated on the CEO) to full autonomy: the CEO is an exception-handler reading a daily digest, not a gatekeeper in the publish path.

**Architecture:** Graduated, revocable autonomy. Every unlock is (1) preceded by a measured trust prerequisite, (2) guarded by deterministic rails (not prompt hope), (3) wrapped in an auto-revert breaker, (4) reusing existing rails (actionsScheduler, approval.status, systemConfig runtime flags, governanceLog).

**Status quo (2026-06-10):** Rating 5.5 → 6.0 after Phase 1 quality hardening (semantic dedup `fbff432d`, daily post cap `90540127`, sentence-case `8e68122f` — all deployed). The two remaining gaps: the approval queue is a hard human gate (autonomy/shipping 3/10), and the system doesn't self-direct strategy (strategic progress 4/10).

---

## Definition: what "full autonomy" means here

The system runs indefinitely with the CEO touching ONLY:
- **Critical blast-radius decisions** (stay human BY DESIGN, forever): product launch/pivot/retire, fleet hire/retire, budget >$2, campaign/objective cancellations — everything `EMERGENCE_BLAST_RADIUS` critical/high.
- **A daily digest** (read-only awareness of what shipped).
- **Breaker escalations** (when an auto-revert trips, the system asks for help).

Everything else — advisory social posts, blog publishes, campaign creation, experiment lifecycle, objective progress — ships and advances autonomously.

**Acceptance bar (Phase E):** a 14-day fully unsupervised run where content ships on cadence, strategy measurably advances, zero quality incidents, and the only pending approvals are critical-class. Target rating ≥8.5/10 overall, autonomy/shipping ≥8.

## Design principles (proven this session — keep them)

1. **Quality before gate-loosening.** Phase 1 proved the QG was missing dups + hallucinations; auto-publish before fixing that would have shipped garbage faster.
2. **Deterministic rails over prompt instructions.** `capitalizeSentences()` pattern: tell the LLM in doctrine AND enforce in code. Prompts drift; code doesn't.
3. **Measure before trusting.** Nothing gates autonomously until backtested against labeled history.
4. **Graduated + revocable.** Each unlock has entry metrics, a soak period, and an automatic revert breaker.
5. **Pure helpers + minimal call sites.** All heartbeat changes follow the Phase-1 pattern: pure function in `helpers.js`, one-line call sites in both paths, offline verification against live data before deploy.
6. **Kill-switches always:** `execution_mode: frozen` (global) + per-feature `systemConfig` flags (no deploy needed to disable).

---

## Phase A — Trustworthy quality gate (prerequisite for ALL unlocks)

The Haiku QG has proven false-negatives at 92–95% confidence (passed ~11 dups at 95–99%, passed the hallucinated 72/18/10-metrics blog, misses preamble-leak/refusal-as-payload). No autonomous publishing until the QG is measured and fixed.

**Labeled data already exists:** 75 historical social actions with CEO decisions — `approved: 28, rejected: 44, ceo-rejected: 2, cancelled: 1` (probed 2026-06-10). `approval.decision_note` carries rejection reasons on many.

- **A1 — Backtest harness.** Script `ambientpixels/scripts/backtest-quality-gate.cjs`: replay `_validateContentQuality` (agent-runner.js:35, needs `ANTHROPIC_API_KEY` locally) against all 75 labeled actions. First classify each CEO reject from `decision_note` as quality-class (factual error, dup, broken copy, voice violation) vs strategic-class (timing, topic choice — QG can't catch these and shouldn't be penalized). Output: recall on quality-class rejects, false-flag rate on approves, per-failure-mode breakdown. **This is the next session's task — detailed in the kickoff handoff.**
- **A2 — Unify deterministic pre-checks into the QG verdict.** Refusal-detect + preamble-strip (index.js auto-post block), semantic dedup + daily cap (Phase 1) currently run OUTSIDE the QG. Compose them into one verdict object `{pass, confidence, issues, deterministicFlags}` so the AQ badge reflects the full picture and auto-publish (Phase C) has ONE gate to consult.
- **A3 — Claim-grounding check.** Numbers/metrics in copy must appear in the task description, deliverable chain, or `product-facts.json`; else flag "ungrounded claim" (catches the fabricated-metrics class). Deterministic extraction + comparison, LLM only as fallback.
- **A4 — Model decision.** If A1 shows Haiku recall <90% on quality-class rejects, switch QG to Sonnet via config and re-run A1. Cost delta is trivial (QG runs on short texts a few times/day; ~$0.01–0.05/day).

**Exit criteria:** ≥90% recall on quality-class rejects · ≤15% false-flag rate on approves · backtest report committed to `docs/superpowers/`.

## Phase B — Root-cause + self-direction (parallel-safe with A)

- **B1 — Echo re-injection root fix.** The bug that GENERATED the 14×-in-24h flood: done-task social injection (agent-runner.js ~1138–1182) re-fires every cycle on already-actioned tasks. Add `_social_action_attempts` counter on the task; skip after 2 attempts; a CEO reject earns exactly ONE respawn, not hourly retries. (The daily cap throttles the symptom; this cures the cause.)
- **B2 — Stalled-objective driver.** 11 objectives averaging 16%, 4 at 0%. Server-side: detect objectives with no linked-campaign task activity in 14d → inject a `STALLED OBJECTIVES` block into Nova's prompt (same pattern as the `PRODUCT LIFECYCLE` block in prompt-builders.js) requiring propose-campaign linked to that objective OR propose-archive with rationale. Rate-limit 1 objective/cycle.
- **B3 — Experiment max-age.** Echo's 3 experiments active since Feb, 0 concluded (insufficient samples for the 4-gate auto-conclude). Add: active >30d below sample threshold → auto-conclude `inconclusive` + `auto:experiment-verdict` memory. Extends the existing auto-conclude hook in index.js after `evaluateExperiments`.
- **B4 (optional) — Agent diversity.** 6/8 agents completed 0 tasks in the unsupervised week. Diagnose before treating (may be correct behavior for observers like Cipher/Forge post-weekly-cron). Not autonomy-blocking.

**Exit criteria:** re-injection attempts capped (observable in logs) · ≥50% of stalled objectives get a Nova action within 3 cycles · 0 experiments >30d stale.

## Phase C — Graduated auto-publish (advisory social) — THE GATE OPENS

**Entry gate: A + B exit criteria met, AND CEO confirms posture** (deferred from 2026-06-10: "not sure we are ready" — that instinct was right; A/B make it safe). Recommended posture: **48h grace window**, not immediate-on-QG.

- **C1 — Grace-window mechanism.** `systemConfig.autoPublish = { enabled: false, graceHours: 48, maxPerDay: 2, platforms: ['bluesky','x','linkedin'] }` (runtime-switchable, pattern: `heartbeatModel`). New small cron `autoPublishGrace` (hourly, pattern: `companyWeeklyReport`): scan `actions` where `classification === 'advisory'` && `approval.status === 'pending'` && QG pass && older than graceHours && under maxPerDay → set `approval.status = 'approved'`, `approved_by: 'system:grace-window'`, decision_note, governance event `auto-publish-grace`. The existing `actionsScheduler` then posts it — **zero changes to the publish rails.**
- **C2 — Auto-revert breaker.** If the CEO rejects/flags ≥2 auto-published posts within 7d → set `enabled: false`, push an AQ escalation, log governance. The system asks for help instead of doubling down.
- **C3 — Daily digest.** Morning report line: "auto-published N posts yesterday: [links]". CEO awareness without CEO action.
- **C4 — Grace shrink schedule.** 48h → 24h after 14 clean days AND ≥5 auto-publishes; 24h → 12h after another clean 14. Manual config flips, criteria documented in the governance log.

**Exit criteria:** 14 consecutive days · ≥10 auto-published posts · 0 breaker trips.

## Phase D — Strategic autonomy

- **D1 — Campaign proposal auto-approve.** Conditions: linked to an active objective + passes Cipher's budget gate + proposer under monthly cap + <5 active campaigns. Else stays in AQ as today. Governance-logged.
- **D2 — Blog grace window.** 72h, higher bar (QG + A3 claim-grounding both pass). Only after C is stable — blog is higher reputational blast radius than social.
- **D3 — Monthly self-test ritual.** Repeat the 7-day unsupervised test monthly with the 8-dimension rubric; store ratings as governance docs so the trend is auditable.

**Exit criteria:** ≥30% of objectives show 14d movement · campaigns replenish without CEO touch · blog cadence sustained ≥2/month autonomously.

## Phase E — Full-autonomy acceptance

14-day fully unsupervised run. **Pass requires ALL of:**
- 0 heartbeat errors; posts ship ≥1/day average across platforms
- 0 quality incidents (gate firings are fine — incidents = something shipped that should not have)
- ≥50% of active objectives show movement; ≥1 experiment concluded
- Finance ≤ YELLOW throughout; AQ contains only critical-class items at end
- CEO interventions required: 0 (digest reading only)

Then re-run the rating. **Target ≥8.5/10 overall, autonomy/shipping ≥8.** Document what remains human (the critical-class list above) as a deliberate constitution, not tech debt.

---

## Sequencing & sizing

| Phase | Sessions | Calendar (incl. soak) | Blocks on |
|---|---|---|---|
| A | 1–2 | ~1 week | — |
| B | 1–2 | ~1 week | — (parallel with A) |
| C | 1 + soak | ~3–4 weeks (two 14d soaks) | A+B exit, CEO posture confirm |
| D | 2 + soak | ~3 weeks | C exit |
| E | test only | 2 weeks | D exit |

Total: ~6–8 working sessions over ~8–10 calendar weeks (soak-dominated).

## Risks & mitigations

- **Reputational (auto-published garbage):** grace window + QG exit-criteria + platform whitelist + maxPerDay + breaker + digest. Worst case bounded at 2 bad posts before auto-disable.
- **Heartbeat fragility:** all changes follow the Phase-1 pattern (pure helpers, minimal call sites, offline verify vs live data, read-before-edit). Heartbeat files remain do-not-touch without session-scoped CEO go-ahead.
- **Function App stale-cache (known issue):** verify behavior post-deploy via governanceLog markers, not assumption.
- **Quiet-system blind spot:** Phase-1 gates verified offline only (0 production firings as of 2026-06-11 03:00Z — system was drained). Confirm production firings as activity resumes before counting them in Phase A exit evidence.
- **CEO absence during soak:** that's the point — soaks ARE unsupervised periods. Breakers + digest carry the safety load.

## Decision log

| Date | Decision | Status |
|---|---|---|
| 2026-06-10 | Quality before gate (Phase 1 first) | DONE — shipped + verified |
| 2026-06-10 | Auto-publish posture (grace vs immediate vs manual) | **DEFERRED to Phase C entry.** Recommended: 48h grace, graduated. CEO said "not ready yet" — honored by sequencing A+B first. |
| 2026-06-10 | Sentence-case enforcement scope | Social + bluesky-reply deterministic; blog prompt-only |
| open | A4 QG model (Haiku vs Sonnet) | Decided by A1 backtest data |
