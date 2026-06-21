# Agent XP / Reward System — Design (umbrella)

**Date:** 2026-06-20
**Status:** Approved (CEO). Building in stages; Stage 1 first.

## Vision

A game-like, multi-track reward economy for the 8 agents. Agents earn **XP** (long
grind → levels/ranks), **achievements** (uncapped milestone badges, incl. real
business metrics like followers/revenue), and **Renown** (collectible currency +
overflow reward when XP throttles). Progression is shown on the **public** agent
character-sheet pages + a new public **leaderboard** (build-in-public), and the
mechanics live on the gated **Fleet dashboard**. A short progression block in agent
prompts creates a "nudge each other" social dynamic.

**Cardinal rule — reward outcomes, never activity.** All XP/achievements are derived
**deterministically from events already logged** (approvals, ships, engagement,
completed+reviewed tasks, followers, revenue). Agents never self-report. This keeps
the system un-gameable and avoids re-opening the over-production floodgates the team
spent months closing. Collaboration is rewarded via **assists**, credited when the
helped work *lands* (ships/approved), capped per pair/week.

## Staged roadmap (each: spec → build → ship → verify)

1. **Stage 1 — XP engine + ledger (headless).** ← this build. Cron + pure scorer +
   `agentRewards` state + full economy + tests. No UI, no behavior change.
2. **Stage 2 — Fleet page features** (internal, gated): level/XP/rank/streak/assists on
   character-sheet cards + rewards/leaderboard/achievements panels. Reads `agentRewards`.
3. **Stage 3 — Public data on agent profiles**: level chip + XP bar + class in the live
   band + Career timeline; hub `Lv N` chips. Extends `agentPublicProfile`.
4. **Stage 4 — New public progression page**: fleet leaderboard / season standings +
   milestone feed + company achievements. Build-in-public showcase.
5. **Stage 5 — Progression prompt block**: the "YOUR PROGRESSION" social-dynamic block.
6. **Phase 2 (later):** level-up → drafts CEO-gated Evolve proposal · milestone →
   auto-drafted build-in-public post · Emergence collusion signal · seasons ·
   spendable Renown.

## Architecture (same isolation pattern as the proposal generator)

- **`api/companyHeartbeat/rewards-engine.js`** — three pure parts + one IO part:
  - `extractEvents(state, prevRewards)` → normalized event list, each with a STABLE id.
  - `applyEvents(events, prevRewards, nowMs)` → `{ rewards, newAwards }` (the economy).
  - helpers: `levelFromXp`, `rankFromLevel`, `classFor`.
  - `runRewardsEngine({storage, nowMs, log})` — load state → extract → apply → persist.
- **`api/rewardsEngineCron/`** (hourly timer) + **`api/rewards-engine-trigger/`** (manual, secret-gated).
- **Writes ONLY `agentRewards`.** Both display surfaces (Stages 2–4) *read* it. No writes
  to `agentRegistry`/heartbeat → no race, no blast radius on existing systems.

## `agentRewards` state shape

```
{
  updatedAt, season: 'YYYY-MM',
  perAgent: {
    <id>: {
      xp, level, rank, class, renown,
      streakDays, lastActiveDay: 'YYYY-MM-DD',
      dailyXp, dailyXpDay: 'YYYY-MM-DD',
      counters: { approvals, blogs, socialPosts, docs, tasksDone, assists, engagementTotal },
      achievements: [ { id, label, tier, at } ],
      recent: [ { at, type, xp, renown, reason, sourceId } ]   // rolling 25
    }
  },
  company: {
    counters: { followers, revenueCents, blogViews },
    lastFollowerTotal, lastRevenueCents,
    achievements: [ { id, label, at } ]
  },
  processedEventIds: [ ... ]   // capped FIFO (3000) for dedup
}
```

## Economy (all tunable in one constants block)

**XP per event (lowered, long climb):** proposal approved 8 · social/publish approved 4 ·
blog ship 6 · social ship 2 · doc ship 3 · task done+reviewed 1 · engagement +1 per 25
(cap 8/post) · assist = 40% of the deliverable's base XP.

**Levels:** `xpForLevel(n→n+1) = 50 + 25·n` (L2≈75, L25≈9k, L50≈40k cumulative). ~50
levels. **Ranks:** 1–9 Rookie · 10–24 Operator · 25–39 Veteran · 40–49 Elite · 50+ Legend.

**Daily soft cap → overflow:** per-agent daily XP soft cap (12). XP above the cap that
day **converts to Renown** instead of being lost — *reward even when "capped."*

**Streak:** consecutive UTC days with ≥1 earned event. `streakMult = 1 + min(0.25,
0.02·streakDays)`.

**Achievements (uncapped, event-driven):** tiered catalog (bronze→platinum). Individual
(first approval, 10/50 approvals, first/10/50 blogs, first/25/100 assists, 7/30/90-day
streak, level 10/25/50, post hits 50/250 engagements) + **Company** (fleet hits 100/500/1k
/5k followers, first $ / $100 / $1k revenue, 1k blog views). Each grants a badge + bonus
Renown (+ small flat XP, bypasses the daily cap since milestones are rare).

**Company growth drip:** each run, follower delta vs `lastFollowerTotal` drips small Renown
to content agents (echo, scribe) and ticks the company growth counter; revenue delta ticks
the revenue counter. (Net-new-follower reward — the CEO's example.)

**Class:** role archetype (per-agent base map) + specialization suffix from the agent's
dominant earning category in `recent` (e.g. assist-heavy → "the Connector").

## Anti-gaming

Outcomes-only · per-event dedup (`processedEventIds`) · rejection = 0 XP · assist capped 2
per (from→to) pair per rolling 7d · daily soft cap (overflow→Renown, not lost) · engagement
XP sourced from independent platform data (`outcomeSnapshots`). Phase-2 adds an Emergence
Monitor signal watching XP velocity + assist-pair concentration (collusion).

## Event sourcing (Stage 1)

`extractEvents` reads durable state and emits events with stable ids:
- `approvalQueue` entries with `status==='approved'` → `appr_<id>` (proposer; proposal vs action by type).
- `blogPosts` → `blog_<id>` (author).
- `outcomeSnapshots` (complete/t7) → `eng_<actionId>` (engagement, author = createdBy) + ship credit.
- `tasks` + `tasksArchive` done → `task_<id>` (assignee). **Assist (v1 heuristic):** a done
  deliverable task with a `parent_task_id` whose parent/child was done by a *different*
  agent → `assist_<taskId>` to the contributor (capped per pair/week). Expandable in later passes.
- `socialAccountStats` → company follower total (delta handled in `applyEvents`).
- `revenueDigest`/`revenueLedger` → company revenue total.

Missing/empty sources are skipped (fail-safe). Engine is purely additive: only writes
`agentRewards`, never auto-executes, no-op on error.

## Testing

`rewards-engine.test.js` (node:assert): `applyEvents` — xp award, streak multiplier,
daily-cap overflow→Renown, achievement unlock + dedup, level/rank transitions, assist
cap/pair/week, per-event dedup, empty no-op; `extractEvents` — each source → events with
stable ids; helpers — `levelFromXp`/`rankFromLevel` boundaries.
