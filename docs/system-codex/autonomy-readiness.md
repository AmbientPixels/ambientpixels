# Autonomy Readiness Rating

**Question:** How close is AmbientOS to running as a fully autonomous company under light human governance?
**Assessed:** 2026-06-11, from full code sweep + live production state.

## Headline

# 7.2 / 10 — "Supervised autonomy, one trust step from light-touch"

The **machinery** for autonomy is largely built and is unusually well-governed: 21 deterministic gates, a 90.2%-recall quality gate, a grace-window auto-publish path with a circuit breaker, capital allocation with agent-level budget authority, a mutable fleet with protected roles, and an immune system that watches for compound failure patterns. What's missing is mostly **trust mileage** (the new autonomy paths are live but barely exercised) and a handful of broken/weak feedback loops — plus one operational footgun that currently has throughput near zero.

## Dimension scores

| Dimension | Score | Evidence |
|-----------|-------|----------|
| **Safety & governance rails** | 9.5/10 | Kill switch (`execution_mode: frozen`), 21 gates all writing structured audit entries, blast-radius tiers, protected agents, fleet min/max, breaker on auto-publish, human-only-forever list. Best-in-class for a system this size. Deduct: secret auth no-op (env var unset), ~200-entry governance log retention. |
| **Execution reliability** | 8/10 | Live: 100/100 retained runs, last 10 all `ok`, locks + buffered logging + idempotent side effects. Keepalive killed cold starts. Deduct: aggressive Azure code caching (stop/start required), single-region consumption plan. |
| **Content autonomy (the pipeline)** | 8/10 | Full chain works unattended: campaign auto-replenish → Echo brief → Scribe copy → peer review → QG → AQ. Composed QG: 90.2% backtest recall vs CEO quality rejects at 14.3% false-flag. Flood controls (semantic dedup, daily caps, attempts cap=2, repeat-promo serialization) fixed the historical 14×/24h failure mode. Deduct: auto-publish grace path has fired **zero times** in production — the trust milestone is enabled but unproven. |
| **Self-correction & learning loops** | 6/10 | Strong: revision safety nets self-complete, QG feedback memories, stall detection → mandatory directives, experiment auto-conclude, memory consolidation works (39 consolidated beliefs). Broken: **reflection system produces ~nothing** (1 reflection fleet-wide despite 3-day cadence; fix shipped 06-10, still not producing). Outcome attribution exists but LinkedIn (the main professional channel) can't be measured. |
| **Strategic autonomy** | 7/10 | Systems 12–14 are real and exercised: Cipher gates spend (live: 3 agents YELLOW, GREEN system at $10.50/$35), Nova can propose product launch/pivot/retire, fleet hire/retire proven end-to-end (`testbot` archived in live registry). Strategy Engine SE-1/SE-2 shipped (companyStrategy seeded, metric-computed objectives). Deduct: SE-3 (monthly strategy brief) not built; only 1 active objective right now; product proposals have never resulted in a real launch. |
| **Self-monitoring / observability** | 8.5/10 | Emergence monitor (currently 0 signals — calm), world state injected every cycle, weekly reports cron, awareness/attribution/allocation dashboards, keepalive pill. Deduct: reflections-dashboard shows a broken loop; no alerting channel (failures surface only in dashboards/Actions tab). |
| **Operational autonomy (model & infra)** | 5/10 | **Live footgun: heartbeat is set to `gemini`** (`systemConfig.heartbeatModel`), the documented low-compliance model — last cycle produced 2 agent actions total, ~0 for 6 of 8 agents. The system runs but the company is effectively idling. No automated detection ties "model = gemini" to "throughput collapsed" (stall detection watches agents, not config). Single human knows how to operate Azure quirks. |
| **Revenue autonomy** | 4/10 | Agents can market autonomously but cannot run the business end of revenue: no agent visibility into Stripe revenue, conversion, churn, or per-product funnel ROI in money terms; Cipher's "finance" is LLM-spend only. See [monetization-readiness.md](monetization-readiness.md). |

## What "light human governance" looks like today vs. target

**Today (working):** CEO reviews AQ a few minutes a day, approves/rejects social + proposals, watches dashboards weekly. Everything internal runs itself. That is genuinely light governance for *operations*.

**Gap to target (the 2.8 points):**
1. **Trust mileage on auto-publish** — let the grace window actually ship posts for 2–4 weeks, watch the breaker; then drop graceHours 48→24 (planned C4).
2. **Fix the reflection loop** (deadline 06-13) — without it, the learning flywheel runs on consolidation alone.
3. **Resolve the model setting** — either switch back to `claude-sonnet` or add a guardrail: "if model=gemini AND fleet actions/cycle < N for 3 cycles → emergence YELLOW." Right now full autonomy is moot because the agents barely act.
4. **Revenue feedback into the loop** — pipe Stripe/product revenue into `financeDigest`/world state so agents optimize for money, not engagement proxies.
5. **Conditional approvals** — rules like "trusted-pipeline posts under N chars auto-approve immediately" would cut the remaining human load further without raising risk.

## Bottom line

The platform has crossed from "human-driven with AI helpers" to "AI-driven with human checkpoints." The governance architecture would credibly support full autonomy on content/marketing **today** if the auto-publish path accrues clean mileage and the heartbeat is put back on a model that actually acts. Strategic and revenue autonomy are a tier behind: structurally present, informationally starved.
