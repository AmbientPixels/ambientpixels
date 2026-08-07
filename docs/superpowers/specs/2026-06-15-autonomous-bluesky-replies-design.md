# Autonomous Bluesky Replies — Design

**Date:** 2026-06-15
**Status:** Design approved (CEO), ready for implementation plan
**Author:** Claude (brainstormed with CEO)

## Problem

Replying to Bluesky posts is a manual, multi-touch process. Scout already discovers
candidate threads autonomously, but the CEO must (1) curate *which* candidates get a
reply (the "Draft Reply" button on the Bluesky Discovery dashboard) and (2) approve
*each* drafted reply before it posts. We want to automate the curation step so the
system surfaces and drafts replies on its own — while keeping quality high ("quality
replies to quality posts") and keeping a human veto.

## Decisions (locked with CEO)

| Decision | Choice | Rationale |
|---|---|---|
| **Autonomy posture** | Auto-draft, CEO approves | Removes the curation gate, keeps the approval gate. Builds a training signal before anything posts itself. |
| **Selection mechanism** | Hybrid: heat pre-filter → LLM fit/value/risk judge | Cheap deterministic narrowing, then a focused Haiku judge for brand-fit. Mirrors the platform's proven "deterministic gate + LLM check" composed pattern (the quality gate). |
| **Feedback loop** | CEO-decision learning **and** posted-reply engagement attribution, both day one | Decision signal is zero-lag; engagement is richer but lagged 7d. |
| **Daily volume** | 1–2 auto-drafts/day | Tight bar, trivial review load, easy to raise once trusted. |
| **Implementation approach** | Trigger-replacement | Auto-selection does programmatically what the "Draft Reply" click does today. Entire downstream pipeline (Scribe → QG → approval queue → executor) is untouched. |

## Architecture & Data Flow

New step in **bold**; everything else already exists.

```
Scout discovers candidates           → blueskyCandidates           [EXISTS, hourly, 2h cooldown]
  → ★ Reply-Selection step ★         → picks 1–2/day worth replying [NEW]
       ├─ deterministic pre-filter   (heat ≥ threshold, fresh, not crowded, not dup, per-author cap, author sanity, daily budget)
       └─ LLM fit judge (Haiku)      (brand-fit + value-add + risk → pass/score + angle)
  → creates bluesky_reply task        (identical to the "Draft Reply" click)   [EXISTS]
  → Scribe drafts reply               [EXISTS]
  → quality gate (Haiku)              [EXISTS]
  → approval queue → CEO approves      [EXISTS — the human gate stays]
  → AT Protocol executor posts         [EXISTS]
  → outcome snapshot t0/t1/t7          [EXISTS — feeds engagement feedback]
```

### New code (small, isolated)
- **`api/companyHeartbeat/reply-selection.js`** — the selection module: deterministic
  pre-filter + LLM fit-judge prompt + "create bluesky_reply task" trigger. One file,
  one purpose, unit-testable.
- **Call site in Scout's discovery handler** (`agent-runner.js`, ~lines 132–238): after
  candidates are stored, invoke selection (~10 lines; no new logic in the big file).
- **`reply-feedback.js`** (or fold into reply-selection) — aggregates CEO
  approve/edit/reject decisions + posted-reply engagement into prompt blocks + auto-memory.

### Model robustness (CEO is staying on `heartbeatModel: gemini`)
The two quality-critical steps — the **fit judge** and the **quality gate** — run on
**Haiku**, independent of `heartbeatModel`. (The existing reply QG already runs on
`claude-haiku-4-5`.) Scribe *drafts* on the heartbeat model (Gemini), but selection and
the gate are Haiku-grade, and the CEO is the final approval gate. The pipeline is sound
without a model flip.

**LLM fallback chain:** the fit judge calls **Haiku first**; on any Haiku failure
(timeout, error, rate-limit, credit exhaustion) it **falls back to Gemini** (via the
existing `gemini.js` wrapper, which already speaks both). If **both** models fail, the
candidate is **skipped this cycle** (not drafted) and re-evaluated next heartbeat —
fail-closed, because a missed reply is harmless but an unjudged auto-draft is not. The
fallback model is configurable (`fallbackModel`, default `gemini`). This matters
especially while the heartbeat is on Gemini for budget: Haiku gives judge quality,
Gemini keeps the loop alive if Haiku is unavailable.

## Selection Judge

### Stage A — deterministic pre-filter (no LLM cost)

| Rule | Default (tunable in `systemConfig.autoReply`) | Why |
|---|---|---|
| Heat threshold | Scout score ≥ 55 | only warm threads |
| Freshness | post age ≤ 24h | reply gets seen, thread not cold |
| Not-too-crowded | replyCount < 50 | avoid a saturated pile |
| No double-reply | not already in a `bluesky_reply` task (7d lookback) | reinforce Scout dedup |
| Per-author cap | ≤ 1 reply per author / 14d | anti-spam, reads organic |
| Author sanity | handle present, not us/team, skip obvious bot patterns | hygiene |
| Daily budget | stop at `maxPerDay` | caps task creation AND judge calls |

Survivors sort by heat score; only the **top 3–5** go to the judge.

### Stage B — LLM fit judge (Haiku), structured verdict per candidate

```json
{
  "reply_worthy": true,
  "fit_score": 0,        // 0-100 brand/topic fit (AI agents, build-in-public, solo founder)
  "value_score": 0,      // 0-100 can we add something genuinely useful (NOT "great post!")
  "risk": "none|low|med|high",  // politics / drama / negativity / competitor-promo / engagement-bait
  "angle": "one-line reply angle for Scribe",
  "reason": "why pass/fail"
}
```

**Pass = `reply_worthy` AND `fit_score ≥ fitThreshold` AND `value_score ≥ valueThreshold`
AND `risk ∈ {none, low}`.** Hard-reject on `risk: high`. Starting defaults (tunable in
`systemConfig.autoReply`): `fitThreshold = 60`, `valueThreshold = 60`. These start
deliberately strict to honor the 1–2/day "quality only" bar and can be relaxed once the
feedback loop shows the bar is over-tight (high reject rate for good posts).

**Fit and value are separate on purpose:** a post can be on-topic (high fit) but a place
we'd add nothing (low value) — a saturated viral hot-take. Requiring both is the
mechanism for "quality replies to quality posts." The judge prompt is grounded in
`product-facts.json` + founder-voice principles + an explicit **"never reply to"** list
(don't argue, don't touch negativity/drama, no competitor promos, nothing salesy, no
low-effort "great post").

**On pass:** create the standard `bluesky_reply` task with the judge's `angle` as
Scribe's direction (the same slot the CEO's manual direction uses) and `threadContext`
attached (so the approval drawer shows the original post — already supported as of commit
`6bf292e9`). The selection features (heat/fit/value/risk/angle) are stamped on the
candidate/task for the feedback loop.

## Dual Feedback Loop

Both signals are wired day one; each feeds the same two consumers — the **selection
judge prompt** and **Scribe's drafting prompt**.

### Signal 1 — CEO decisions (zero lag)
Captured on each approval-queue action on an auto-drafted reply:
- **approved as-is** — selection + draft were right
- **edited-then-approved** — capture the diff; the CEO edit becomes the style guide
  (the established founder-voice pattern)
- **rejected** — with reason if given

Stored by reusing the existing `agentDecisions` log (Outcome Attribution, System 9) with
`decisionType: 'reply-selection'`, stamped with selection features + draft + original
post + outcome. 30d retention + 10K cap already handled. Feeds:
1. **Selection judge prompt** — compact "replies you approved vs rejected" block.
2. **Scribe drafting prompt** — recent approved + edited examples.
3. **`auto:reply-feedback` memory** on rejection → surfaces in the agent's reflection
   callout next cycle (reuses the `auto:*` self-correction rail).

### Signal 2 — posted-reply engagement (7-day lag)
Approved replies already get a `t0` snapshot via the Outcome Attribution hook; Bluesky is
supported at t1/t7/t30 and `outcomeRefresh` already pulls it. **New:** carry the
selection features onto the reply's outcome snapshot so after t7 we can answer "did
high-fit/high-value selections actually earn likes / replies-back / follows?" Rolls up
per fit/value/risk band and per angle, feeding the same two consumers. No new cron —
extends `outcomeSnapshots` + `outcomeRefresh`.

```
CEO approve/edit/reject ──┐
                          ├─► reply-feedback aggregator ─► judge prompt + Scribe prompt + auto:memory
posted-reply engagement ──┘     (decisions = fast; engagement = slow but richer)
```

**v1 caveat:** engagement needs posted replies + a 7-day lag, so for ~week one the
**decision signal carries the learning** and engagement data is thin. Both rails are live
from day one; engagement ramps. Do not tune on engagement prematurely.

## Safety, Guardrails, Config

1. **Master switch — ships dark.** `systemConfig.autoReply = { enabled:false, maxPerDay,
   heatThreshold, fitThreshold, valueThreshold, perAuthorCooldownDays, model:"claude-haiku",
   fallbackModel:"gemini" }` — mirrors the `autoPublish` config object. Runtime-tunable,
   no deploy. The judge uses `model` first and `fallbackModel` if it fails (see LLM
   fallback chain above).
2. **Respects `execution_mode`.** `observe`/`manual`/`frozen` → selection does not run.
3. **CEO approval gate is the primary safety net.** Nothing posts without the CEO. The
   risk surface is "junk in the queue," not "junk live."
4. **Two LLM quality checks before the CEO sees it:** the selection judge (on the post)
   and the existing quality gate (on the draft). A selected-but-badly-drafted reply is
   auto-rejected and never reaches the queue.
5. **Daily cap double-enforced** (pre-filter + hard count) so a heartbeat retry can't
   double-create.
6. **Anti-spam hard rules:** per-author 14d cooldown, never reply twice to a thread,
   `risk:high` hard-reject, salesy tone banned. Enforced in pre-filter + judge.
7. **Self-disable breaker:** if the CEO rejects **≥ 3 auto-drafted replies within 7d**,
   the selector auto-disables and raises an approvalQueue note (selection bar
   miscalibrated). Mirrors the auto-publish breaker philosophy.
8. **Observability, no silent caps.** Each cycle logs candidates-considered →
   passed-prefilter → passed-judge → drafted, with drop reasons (gate-style, consistent
   with `governanceLog`). Stats + decision/engagement rollup surface on the existing
   **Bluesky Discovery dashboard** (`modules/company/bluesky-discovery.html`) — no new page.
9. **Cost:** a handful of Haiku judge calls/day (top 3–5, stops after the cap); the reply
   QG already runs. Marginal cost ≈ negligible — important since the heartbeat stays on
   Gemini for budget.

## Out of Scope (v1)

- **Grace-window auto-posting of replies.** Documented graduation path: once the CEO's
  approve-rate on auto-drafts is high and edits are minor, this can graduate to the 48h
  grace-window posture (the path the post-publishing feature took, with the
  2-rejects-in-7d breaker). v1 stays "you approve."
- **Platforms other than Bluesky.** X/LinkedIn reply automation is a later extension.
- **A new dashboard page.** Reuse the Bluesky Discovery dashboard.

## Key Files (reference)

| File | Role |
|---|---|
| `api/companyHeartbeat/reply-selection.js` | **NEW** — pre-filter + judge + task trigger |
| `api/companyHeartbeat/reply-feedback.js` | **NEW** (or folded) — feedback aggregator |
| `api/companyHeartbeat/agent-runner.js` | Scout discovery handler call site; bluesky_reply drafter (exists) |
| `api/_utils/blueskyDiscovery.js` | shared search/scoring engine (exists) |
| `api/companyHeartbeat/quality-gate.js` | reply quality gate, Haiku (exists) |
| `api/companyHeartbeat/outcome-intel.js` + `api/outcomeRefresh/` | engagement attribution (exists, extend) |
| `api/_data/product-facts.json` + `api/_data/founder-voice-examples.json` | judge + draft grounding (exists) |
| `modules/company/bluesky-discovery.html` | observability surface (exists) |
| `systemConfig` state key | `autoReply` config object (new field) |
| `agentDecisions` state key | decision learning (exists, new decisionType) |
