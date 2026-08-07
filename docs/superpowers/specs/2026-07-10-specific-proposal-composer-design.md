# Specific Proposal Composer — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorm) → ready for implementation plan
**Supersedes behavior in:** `2026-06-20-deterministic-proposal-generator-design.md` (the deterministic generator remains, repurposed as fallback)

## Problem

The deterministic proposal generator (`api/companyHeartbeat/proposal-generator.js`, run by `proposalGeneratorCron` every 6h) mints **templated, boilerplate proposals**. Its worst offender is a count-padding trigger: when there are fewer than 3 active objectives (or campaigns), it emits a generic proposal purely to reach the count — e.g. the objective **"Establish a measurable growth objective"**, title pulled straight from a hardcoded `titleByReason` map, with a generic bluesky-followers target stapled on.

Observed live (2026-07-09→11): with 2 active objectives, the `<3` trigger produced exactly that placeholder, which then sat pending for ~2 days. The CEO's directive: **"we shouldn't be getting templated proposals."**

## Goal

Replace templated generation with proposals that **reason about the right strategic move** from real company state (including the revenue pivot toward paying customers) — proposals that read like Nova wrote them, grounded in real numbers, or **no proposal at all** when there is no genuine gap.

## Decisions (from brainstorm)

1. **LLM-authored, reasoning-based.** A model composes the proposal from real state; it is not a template fill.
2. **Deterministic gap-detection feeds the model.** Grounded triggers only. **The `<3` count-padding triggers are removed** for both objectives and campaigns.
3. **Reuse `gemini.js`** — honors the runtime model toggle (`systemConfig.heartbeatModel`, currently `gemini-pro`) and its cross-provider fallback chain.
4. **Silence is valid.** No genuine gap → no proposal that run. This is the common case given the fleet is currently well-fed (2 objectives, 3 active campaigns).
5. **Deterministic fallback** when the model errors or its output fails grounding — because detection now only fires on real gaps, the fallback describes an actual situation, never padding.
6. **Materializer contract is unchanged.** Output must still carry a real `northStarMetric` + `metricTarget` + `metricDeadline` so an approved objective gets a working `criteria` block (`api/proposalDecide/materialize.js`).

## Architecture — Approach B (three focused units)

### `proposal-generator.js` (edit) — pure detection + deterministic fallback
- New pure **`detectSignals(state, nowMs)`** → 0–N grounded signal objects. No IO, unit-testable.
  - Remaining triggers (all evidence-backed; **count triggers deleted**):
    - objective: `near_complete` (progress ≥ 95%, successor needed), `stale_objective` (substantive stalled objective — excludes childless placeholders via existing `_isPlaceholderObjective`)
    - campaign: `declining_uncovered` (real `DECLINING` product with no active campaign), `all_stagnant` (every active campaign stagnant ≥ 14d)
  - Signal shape: `{ kind:'objective'|'campaign', trigger, severity, subject, evidence }`
    - e.g. `{ kind:'campaign', trigger:'declining_uncovered', severity, subject:{product:'StoryForge'}, evidence:{verdict:'DECLINING', deltaPct:-32} }`
- Existing `_buildObjectiveProposal` / `_buildCampaignProposal` are **kept as the deterministic fallback builders** (no longer the primary path). Because detection no longer count-pads, they can only ever describe a real gap.
- `computeProposals(state, nowMs)` stays exported as a thin wrapper (`detectSignals` → deterministic build) so existing callers/tests keep working.

### `proposal-composer.js` (new) — the LLM side, isolated
- **`compose(signal, grounding, callModel)`** → `{ proposal }` or `{ skip, reason }`.
  - Builds the grounding packet, calls the injected `callModel`, parses, runs the validation gauntlet, maps a passing result into the materializer-ready proposal shape.
  - Returns `skip` on: model error/timeout, malformed output, failed grounding, or explicit `{ propose:false }`.
- Injected `callModel` (wrapping `gemini.js`) keeps the module testable with a fake model.

### `runProposalGenerator` (edit) — orchestration
```
load state (+ product-facts names, revenue/funnel snapshot, strategicDigest, socialAccountStats)
signals = detectSignals(state, now)
if signals empty → run expiry only, return           # silence
rank signals; pick top ≤1 objective + ≤1 campaign (respect existing _isDeduped)
for each pick:
    composed = await composer.compose(signal, grounding, callModel)
    valid → queue LLM proposal          (composedBy:'llm')
    skip  → fall back to deterministic builder for that signal   (composedBy:'deterministic')
append to approvalQueue → run 7-day expiry → log proposal-created (+ composedBy + evidence)
```
Downstream is unchanged: cron entry (`proposalGeneratorCron/index.js`), dedup/expiry/logging, `systemConfig.proposalGenerator.enabled` toggle, and the materializer contract.

## The composer in detail

### Grounding packet (what the model sees — focused, not the whole world)
- The **detected signal** with its evidence (specific product/objective + real numbers).
- **Active objectives** (title, `northStarMetric`, progress) and **active campaigns** (name, product, cadence) — avoid duplication/contradiction.
- **`strategicDigest.perProduct`** — verdicts + traffic deltas.
- **Follower baselines** from `socialAccountStats.platforms`.
- **Revenue posture** — `paying_customers` / funnel snapshot (so proposals can reason toward revenue, per the pivot).
- **`product-facts.json` product names** — the allowlist for anti-hallucination.

### Prompt intent
"Given this real gap and this state, propose the single most valuable next {objective|campaign} to close it, tied to a real metric. Ground every claim in the data provided. If nothing here is genuinely worth proposing, return `{ "propose": false }`."

### Structured output (model must return)
```json
{ "propose": true,
  "kind": "objective",
  "title": "...", "description": "...", "rationale": "...",
  "successCriteria": "...",
  "northStarMetric": "paying_customers",
  "metricBaseline": 0, "metricTarget": 3, "metricDeadline": "2026-08-09",
  "suggestedCampaigns": ["..."],
  "platforms": ["social_bluesky"] }
```
(`suggestedCampaigns` objective-only; `platforms` campaign-only.)

### Validation gauntlet (deterministic — the safety core). All must pass or `skip`:
1. `propose === true` and `kind` matches the signal's kind.
2. `title` / `description` / `rationale` / `successCriteria` non-empty and within existing caps (100 / 1000 / 500 / 300).
3. **Real subject:** any named product resolves to a `product-facts` name (normalized), or the proposal clearly references the signal's existing objective/campaign (token overlap). Invented products → reject.
4. **Metric allowlist:** `northStarMetric` ∈ `{ bluesky_followers, linkedin_followers, x_followers, paying_customers, scans_per_week, blog_views }` (extensible) or equals an existing objective's metric.
5. **Sane numbers:** `metricTarget` finite and directionally correct vs `metricBaseline`; within a plausible band. Band rule handles low baselines: **for baselines ≥ a small floor (e.g. 10), `metricTarget` ≤ 5× baseline** (guards a "80 → 8000 followers" hallucination); **for near-zero baselines (e.g. `paying_customers` at 0), apply an absolute cap instead** (e.g. `metricTarget` ≤ 25) so a `0 → 3` target is valid while `0 → 5000` is not. `metricBaseline` is **overwritten with the real value** we passed in rather than trusting the model's echo.
6. **Real deadline:** ISO date, in the future, within a 14–180 day window.
7. **Campaigns:** `platforms` resolve to valid task types via the existing allowlist.

On pass, map to the proposal shape the materializer expects (`northStarMetric` + `metricTarget` + `metricDeadline` → the `criteria` block for real auto-progress).

## Silence & fallback

- **No signal** → no model call; expiry-only; return. (Common case now.)
- **Signal fired, model declines (`{propose:false}`) or fails validation** → fall back to the deterministic-grounded builder for that signal, tagged `composedBy:'deterministic'`. A real gap still surfaces even if the model hiccups.
- Two silence layers: detection (no gap) and composition (model declines).

## Error handling
- `callModel` wrapped in try/catch + timeout; JSON parsing defensive; any throw resolves to `skip`.
- Cron is already no-op-on-error; nothing here can break a heartbeat or corrupt the queue.
- Existing safety preserved: purely additive, never auto-executes, ≤ 1 per type per 24h, CEO approves everything, `enabled=false` toggle still fully disables generation (expiry still runs).

## Testing
- **`detectSignals`** (pure): one test per remaining trigger; explicit regression tests that `objectives.length < 3` and `campaigns.length < 3` **no longer** produce a signal.
- **`proposal-composer`** (fake `callModel`): clean output passes; hallucinated product, out-of-band target, bad/unknown metric, missing field, malformed JSON, and `{propose:false}` each return `skip`; baseline-echo mismatch is corrected not trusted.
- **`runProposalGenerator`** (injected storage + fake model): silence when no signal; LLM proposal when valid; deterministic fallback when the model throws; dedup + 7-day expiry honored.
- Adapt existing `proposal-generator.test.js` count-trigger cases; keep the rest green.

## Rollout & verification
- Ship via `git push` (CI/CD). No high-blast-radius files touched — only the generator/composer modules, the cron wiring, and tests.
- Verify: `POST /api/proposal-generator-trigger`, then read `approvalQueue` — expect either a specific grounded proposal (real metric, `composedBy:'llm'`) or a clean no-op; confirm the `proposal-created` governance event carries `composedBy` + evidence.
- **Operational (separate, on CEO say-so):** clear the current pending templated objective (`oprop_1783576800044_auto`) and the stale `content.package` (`aq-pkg_1783623622793_d24d50`) from `approvalQueue`.

## Out of scope
- Making the agent-emitted proposal path (heartbeat) reason better — this reworks the deterministic cron only.
- New detection triggers beyond the existing grounded set (e.g. a standalone "revenue gap" trigger) — the revenue objective already exists; revenue reasoning happens in composition, not detection.
- Changes to the materializer or the Actions-page approval UI.
```
