# Revenue Seasons — Design Spec

**Date:** 2026-07-30
**Status:** Approved direction (CEO brainstorm 07-30); spec pending CEO review
**Tracks:** A (revenue-first economy) + B (competition with real stakes). Track C (retirement knowledge inheritance) and Track D (outbound gig agents) are follow-up specs.

## 1. Problem

The fleet's north star is paying customers, but the XP economy pays for internal task churn: Scribe leads the ledger at L5/543 XP on 532 one-point `task_done` events while company revenue is $0.00 and no agent has ever earned XP from money. The revenue lane exists only as never-fired company achievements. Competition has no stakes — no season resets, no consequence for finishing last, and XP changes nothing operational. Result: the gamified system is a scoreboard simulation sitting next to the work instead of the mechanism that allocates it.

CEO requirement (verbatim intent): real consequences and real motivation, not a simulation; agents compete, the bar rises each phase, revenue is the point.

## 2. Design principle — XP must purchase operational power

An LLM agent is influenced by exactly three things: what is in its prompt, what resources it actually has (budget, action slots, model quality), and whether it continues to exist. Every mechanism in this spec flows into one of those three channels. Anything that doesn't is cut.

The Cardinal Rule is preserved: every point derives deterministically from durable logged outcomes. Nothing here rewards activity that didn't land.

## 3. Decisions made (CEO, 2026-07-30)

1. Build order: Tracks A+B first; C then D follow.
2. Attribution: **causal chain split** — trace conversions back through the utm/action/task chain and split XP across every contributing agent.
3. Seasons: **monthly, soft reset, scaling par** — season XP resets, career XP/levels/achievements persist, par rises from last season's results.
4. Stakes: **escalating ladder** — watch → budget squeeze → CEO-gated retirement proposal.
5. Aggression: **all three upgrades** — continuous budget meritocracy, rank-gated operational privileges, explicit existential pressure in prompts.

## 4. Economy rework

### 4.1 New revenue-lane events (extractEvents)

| Event | Source (durable state) | Stable id | XP | Daily cap |
|---|---|---|---|---|
| `revenue_sale` | `revenueLedger` entries | `sale_<ledgerEntryId>` | **100 + 1 per whole $** (`100 + floor(cents/100)`) | **Exempt** — a sale is never haircut |
| `funnel_lead` | `as_leads` entries | `lead_<ts>_<emailHash>` | 15 | Exempt |
| `funnel_scan` | funnel scan records (public scans only) | `scan_<ts>_<urlHash>` | 3 | Counts toward daily cap |

Implementation note: exact id fields for leads/scans to be confirmed against the raw source shapes at plan time (`funnelDigest.js` documents the read shapes); if a source lacks a unique id, derive one from `ts + stable field` and document it. `revenueLedger` is currently empty, `as_leads` near-empty, lifetime scans ≈ 14 — backfill on first run is negligible by construction, but first-run behavior must still be covered by a test.

### 4.2 Existing-lane changes

- `task_done` stays at 1 XP but gains a **per-lane daily cap of 3 XP/agent/day**. Overflow above the lane cap does NOT convert to Renown (unlike the global cap) — churn shouldn't mint currency either.
- All other existing lanes unchanged (proposal 8, blog 6, social ship 2, doc 3, engagement +1/25, assist 2, review 1).
- Global daily soft cap (12 → Renown overflow) still applies to non-exempt lanes.
- Scale check: one $29 sale ≈ 129 XP ≈ six weeks of maxed task churn. The leaderboard becomes a revenue chart with a funnel-progress undercard.

### 4.3 Attribution — causal chain split

For `revenue_sale` and `funnel_lead` events carrying `utmContent` (Stripe checkout metadata and `as_leads` entries already store it; `utm_content` = the originating social **action id**):

1. Look up the action in `actions` / archived actions.
2. Contributors = distinct set of: action `createdBy` (copy writer), the parent task's `assignee` and `reviewer` (via `_parentTaskId`), and the campaign's `proposedBy`/`createdBy` (via the task's `campaign_id`).
3. Filter to `FLEET_AGENTS` (drop `system`, `ceo`, unknown).
4. Split the event XP **equally** among contributors, `max(1, floor(xp/n))` each. Each contributor's share is a separate ledger entry with the same source id suffixed by agent (`sale_<id>__<agent>`) so dedup holds per-recipient.

**Unattributed fallback** (no utm, action not found, or zero eligible contributors): 50% of the XP split equally across the distinct assignees of tasks linked to currently-active conversion campaigns in the last 30 days; if that set is empty, the event pays company counters only. Deterministic in all branches.

`funnel_scan` events are usually organic and unattributed → they mostly flow through the fallback; that is acceptable (scans are the smallest carrot).

### 4.4 Company level

Company counters/achievements unchanged; `revenue_sale` events additionally tick `company.counters.revenueCents` exactly as today (no double-award — the existing `applyCompany` revenue delta logic becomes derived from the same ledger read; plan must ensure one source of truth).

## 5. Seasons

### 5.1 State shape additions (`agentRewards`)

```js
perAgent.<id>: {
  // existing fields unchanged (xp = career XP, level, rank, achievements…)
  seasonXp, seasonRevenueXp,          // reset each season
  trailing14dRevenueXp,               // engine-computed each run (see §7)
  parMisses,                          // consecutive below-par seasons
  ladderStatus,                       // 'safe' | 'watch' | 'squeezed' | 'retirement_pending'
  seasonHistory: [ { season, seasonXp, seasonRevenueXp, rank, par, belowPar } ]  // rolling 12
}
root: {
  season: 'YYYY-MM',                  // existing
  seasonMeta: { par, startedAt, previousChampion }
}
```

### 5.2 Rollover (first engine run in a new UTC month)

1. For each fleet agent: record `seasonHistory` entry with final rank and par outcome; `belowPar = seasonXp < par`.
2. `parMisses = belowPar ? parMisses + 1 : 0`; derive `ladderStatus` (0 safe / 1 watch / 2 squeezed / ≥3 retirement_pending).
3. Reset `seasonXp`, `seasonRevenueXp` to 0. Career XP/level/achievements/Renown untouched.
4. Compute next par: `par = max(40, round(1.10 × median(prior season seasonXp across FLEET_AGENTS)))`. Bootstrap: the first season under this system (2026-08) uses the floor, par = 40.
5. `previousChampion` = rank-1 agent (used for freed-budget redistribution and a champion badge).

Season events during the month increment both `xp` (career) and `seasonXp`; the rank/leaderboard for competition purposes is **season rank by seasonXp**.

## 6. The escalating ladder (real consequences)

| parMisses | Status | Concrete effect |
|---|---|---|
| 0 | `safe` | — |
| 1 | `watch` | Flagged in prompt block + dashboard. |
| 2 | `squeezed` | Heartbeat applies ×0.7 to the agent's monthly per-agent budget cap; the freed 30% is added to the previous champion's cap. Prompt states the squeeze and the way out. |
| ≥3 | `retirement_pending` | The cron IO layer (not the pure core) drafts ONE `agent_retire_proposal` into the approval queue (critical, CEO-gated), dedup id `retire_<agent>_<season>`. Prompt states this plainly. CEO decision is final; approval flow is the existing propose-retire-agent machinery. |

Recovery: finishing a season at/above par resets `parMisses` to 0 and clears the status. A pending retirement proposal is NOT auto-withdrawn — the CEO decides (they may reject it citing the recovery).

Safety line (non-negotiable): quality gates and CEO approval gates never relax for winners or tighten as punishment. Stakes apply to resources and existence, never to content safety rails.

## 7. Continuous budget meritocracy (consequences land weekly, not quarterly)

Each engine run computes `trailing14dRevenueXp` per agent (sum of revenue-lane ledger entries — sale/lead/scan shares — in the trailing 14 days) and stores it in the ledger.

At heartbeat start, the existing `applyBudgetOverrides()` path (already runtime-tunable via `systemConfig.finance`) is extended to read `agentRewards` and compute per-agent monthly caps:

```
pool  = FINANCE_BUDGET_MONTHLY (systemConfig-overridable, currently $110)
floor = 40% of pool split evenly across active fleet agents   (survival floor)
merit = 60% of pool split proportional to trailing14dRevenueXp
        (if all agents are at 0 — e.g. pre-first-revenue — merit splits evenly, ≡ current behavior)
cap(agent) = floorShare + meritShare, then ×0.7 if ladderStatus == 'squeezed'
             (squeeze savings added to previousChampion's cap)
```

Properties: pre-revenue the system behaves exactly like today's even split (no cold-start starvation); the first agent to touch the funnel visibly grows within days; CEO can retune `floorPct`/`meritPct` or disable via `systemConfig.rewards` (merge semantics, kill switch `systemConfig.rewards.meritBudget.enabled`).

Blast radius: this is a **read-side hook** — the rewards engine still writes only `agentRewards` (plus the single retirement draft at ≥3 misses); the heartbeat reads the ledger and applies caps through machinery that already exists. CEO explicitly approved touching this protected path for this feature.

## 8. Rank-gated operational privileges

Engine derives `privilegeTier` per agent from **last completed season's rank** (bootstrap: everyone `line` until the first season under this system completes):

| Tier | Who | Real effects (read by heartbeat/agent-runner) |
|---|---|---|
| `vanguard` | season ranks 1–2 | +1 action slot per cycle; primary model tier (e.g. gemini-pro); campaign/objective proposal rights; larger image budget share |
| `line` | middle ranks | current defaults |
| `probation` | bottom 2 ranks | −1 action slot (min 1); economy model tier (flash); campaign/objective proposals blocked (task-level work unaffected); minimal image budget |

All privilege reads honor per-agent overrides in `agentRegistry` state (which overrides constants — established pattern). `systemConfig.rewards.privileges.enabled` is the kill switch. Quality gates and approval gates are explicitly out of scope for privileges.

## 9. Prompt block — SEASON STANDINGS (the motivation channel)

Extend the Stage-5 YOUR PROGRESSION block in `prompt-builders.js` to include, tightly:

- Season rank + top-3 standings with seasonXp.
- Par progress: `Par is <par> season XP. You have <seasonXp>. <days> days remain.`
- Ladder status with the concrete consequence, stated verbatim for the two hot states:
  - squeezed: `Your budget is cut 30% this season. Finishing at or above par restores it.`
  - retirement_pending: `You are one CEO decision from retirement. A retirement proposal has been drafted. Revenue-lane outcomes are the only thing that resets this. Your successor would inherit your memories.`
- A one-line earning guide: `Revenue lane pays most: sale 100+, lead 15, scan 3 — attributed to every agent in the chain that produced it.`
- Privilege tier and what it currently grants/denies.

Keep it within the existing block's token budget discipline (gated, compact, no prose).

## 10. What this does NOT do

- No change to quality gates, CEO approval gates, or content safety rails, in either direction.
- No agent self-reporting; every event remains durable-state-derived with stable-id dedup.
- No automatic retirement — ≥3 misses drafts a proposal; the CEO decides.
- No knowledge-inheritance/lineage system yet (Track C spec next) and no outbound gig agents (Track D).
- No dashboard/public-page season UI in the first ship — engine + prompts first; UI is a fast-follow so display work doesn't block the mechanism.

## 11. Files touched

| File | Change |
|---|---|
| `api/companyHeartbeat/rewards-engine.js` | Constants (revenue lane, lane caps, par, tiers), extractEvents (3 new sources + attribution resolver), applyEvents (lane cap, cap exemptions), new pure fns: `rolloverSeason`, `computePar`, `deriveLadderStatus`, `derivePrivilegeTiers`, `computeTrailing14dRevenueXp` |
| `api/companyHeartbeat/rewards-engine.test.js` | TDD tests for every new pure behavior (see §12) |
| `api/rewardsEngineCron` + `rewards-engine-trigger` IO layer | Retirement-proposal draft on transition (dedup-guarded); passes new sources into the engine |
| `api/companyHeartbeat/prompt-builders.js` | SEASON STANDINGS block extension |
| Heartbeat budget-override path (where `applyBudgetOverrides` lives) | Merit-budget computation reading `agentRewards`; squeeze multiplier; champion redistribution |
| `api/companyHeartbeat/agent-runner.js` (and/or constants read path) | Privilege-tier reads: action slots, model tier, proposal-rights gate |
| `.claude/skills/agent-rewards/SKILL.md` | Recent Changes entry post-ship |

High-blast-radius acknowledgment: `prompt-builders.js`, `agent-runner.js`, and the heartbeat budget path are protected files; CEO approved these specific changes in this design. Every heartbeat-side change is a read of `agentRewards` plus a bounded application — no new writers.

## 12. Testing

TDD throughout (failing test first, per repo discipline). New tests, all against the pure functions:

1. `revenue_sale` extraction from a revenueLedger entry, XP formula, cap exemption.
2. `funnel_lead` / `funnel_scan` extraction with stable ids; re-run produces zero duplicate events.
3. Attribution: full chain (writer+assignee+reviewer+campaign-owner) equal split; min-1 floor; ceo/system filtered.
4. Unattributed fallback: conversion-campaign assignees split; empty-set → company-only.
5. `task_done` lane cap: 4th task of the day pays 0, no Renown minted from lane overflow.
6. Rollover: archives history, resets season fields, career fields untouched; parMisses increments/resets correctly; statuses derived correctly.
7. `computePar`: floor 40, 110%-of-median scaling, bootstrap season.
8. `trailing14dRevenueXp` windowing.
9. Privilege tiers: bootstrap all-line; rank mapping after a completed season.
10. Merit budget math: pre-revenue ≡ even split; proportional split; squeeze ×0.7 + champion redistribution; floor guarantees.
11. Retirement draft: fires once per agent-season (dedup), only on transition to ≥3.
12. First-run/backfill: historical scans/leads pay bounded, sane amounts.

Existing 19 rewards tests must stay green. Post-deploy verification: manual `rewards-engine-trigger` run, ledger inspection, one full heartbeat cycle confirming prompt block renders and caps apply.

## 13. Rollout & controls

- Ship engine + prompt block + heartbeat hooks together; season 1 under the new rules = **2026-08** (rollover on the first engine run of August), par 40, everyone starts `safe`/`line` with parMisses 0.
- `systemConfig.rewards` (merge semantics): `{ enabled, meritBudget: {enabled, floorPct, meritPct}, privileges: {enabled}, parFloor, squeezeMult }` — every subsystem independently killable at runtime without deploy.
- Repo auto-commits+pushes: changes go live within minutes of edit; implement in test-green increments.
