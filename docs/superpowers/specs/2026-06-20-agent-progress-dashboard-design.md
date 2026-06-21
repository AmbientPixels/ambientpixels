# Agent Progress Dashboard — Design

**Date:** 2026-06-20
**Status:** Approved (CEO), ready to build

## Purpose

A dedicated internal dashboard that gives the CEO/operators a single **all-up view of
how the agent fleet is doing and growing** — the "single pane of glass" that today is
scattered across four pages (Fleet, Agent Performance, Awareness, the public leaderboard).
It fuses the new reward progression with activity and a health signal.

**Clear separation of concerns (avoid duplicating existing pages):**
- **Agent Progress (this page)** = *watch them grow* — read-only scoreboard + health.
- **Fleet** (`fleet.html`) = *manage* — evolve / retire / proposals (where actions live).
- **Agent Performance** = *attention/health triage*.
- **Awareness** = *reflection*.

This page links out to Fleet for actions; it performs no writes.

## Placement & access

- New page `modules/company/agent-progress.html`.
- Sidebar entry in the **COMMAND** category (near Dashboard/Standup), `minMode: 'executive'`
  (visible to executive/operator/admin), icon `fa-chart-line`. Added in
  `modules/company/js/sidebar.js`.

## Layout (three sections, standard company-module chrome)

1. **Fleet Pulse** — hero stat chips: total XP, average level, top agent (with portrait),
   achievements unlocked (fleet-wide), composite fleet health (🟢/🟡/🔴).
2. **Agent Progress** — a roster sorted by XP. Each row: **portrait** + name, level/rank,
   XP-to-next bar, XP / Renown / streak, and a health dot. **Click-to-expand** a row for
   the per-agent detail: larger portrait, full achievement list, counters, recent outcomes
   (`agentRewards.recent`), and the health breakdown.
3. **Achievements** — fleet-wide: recent-unlocks feed + a badge gallery (who holds what).

Portraits use the existing public assets `/ambientos/img/<id>.webp` (`loading="lazy"`,
graceful fallback if missing), in the row, the Top-Agent chip, and the expanded detail.

## Data (client-side fusion — NO new API)

Reuses the exact authenticated fetch set `fleet.html` already uses, plus the rewards ledger:
- `/api/agentRewards` — progression: level, rank, class, xp, renown, streakDays,
  achievements, **recent** (= what they shipped), counters.
- `/api/company-state?key=agentRegistry` — names, roles, tiers, active status.
- `/api/allocationDigest` — per-agent budget status (health input).
- `/api/company-state?key=runtimeMemory` — `reflectionDigest` (role drift) + `financeDigest`
  (agentEfficiency.executed === 0 → stale) (health inputs).

**Health dot (composite, computed client-side from the above):**
- 🔴 if budget status RED.
- 🟡 if budget YELLOW, OR role drift (≠ on-role), OR stale (0 actions 7d).
- 🟢 otherwise.

No new endpoint — same client-side fusion pattern `fleet.html` uses.

## Components & isolation

- `modules/company/agent-progress.html` — chrome (sidebar + `sys-section` blocks) + the
  three section containers + page-scoped `<style>` (reuse the `--color-*`/company tokens;
  portrait/row/health styles named `ap-prog-*` to avoid clashing with the public `lb-*`
  and Fleet `fl-*` classes) + `<script src="js/agent-progress.js">`.
- `modules/company/js/agent-progress.js` — fetch + fuse + render + init. **Pure helpers are
  exported via a node guard so they're unit-testable** (same approach as `fleet-evolve.js`):
  - `computeFleetPulse(rewards)` → `{ totalXp, avgLevel, topAgentId, achievementsUnlocked }`.
  - `healthFlag(agentId, ctx)` → `'green' | 'yellow' | 'red'` from budget/drift/stale.
  - `sortByXp(rewards)` → ordered agent id list.
  - `xpBarPct(level, xp)` → 0–100 (same level curve as the engine).
  DOM render + fetch/init are guarded by `typeof document !== 'undefined'`.
- `modules/company/js/agent-progress.test.js` — node:assert tests for the pure helpers.
- `modules/company/js/sidebar.js` — one new COMMAND entry.

## Testing

Unit-test the pure helpers (`computeFleetPulse`, `healthFlag`, `sortByXp`, `xpBarPct`)
against mock ledger + digest data: totals/avg/top, each health tier, sort order, bar math,
empty-state no-op. Render verified by syntax check + a mock-data smoke (same as prior stages).

## Out of scope (YAGNI)

- Time-series / historical charts (no snapshot data captured yet).
- Any write actions (evolve/retire stay on Fleet; this page links there).
- Touching the Fleet leaderboard panel (possible future slim-down once this is the canonical
  progress view — not in this build).
