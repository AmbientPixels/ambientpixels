# Heartbeat Engine

**Location:** `ambientpixels/api/companyHeartbeat/` · **Schedule:** `0 0 * * * *` (hourly, `function.json`) · **Manual trigger:** `POST /api/company-heartbeat-trigger`

The central pump. 24 modules, ~19,500 lines (verified 2026-06-11). Every cycle: lock → load state → build digests → run 8 agents → apply gated mutations → post-loop sweeps → persist → unlock.

## Module inventory (verified line counts)

| Module | Lines | Purpose |
|--------|-------|---------|
| `index.js` | 4,070 | Orchestrator: lock, state loading, campaign lifecycle, revision safety nets, digest building, agent dispatch (with parallel Gemini prefetch for cipher/pixel/forge/scout), auto-post block, escalation pruning, persistence |
| `agent-runner.js` | 5,527 | Per-agent execution: prompt → LLM → normalize → enforce gates → apply. All action handlers (social, proposals, budget, fleet, product lifecycle, bluesky discovery/reply), quality-gate invocation, decision logging |
| `prompt-builders.js` | 2,335 | 6-layer prompt assembly: world state, identity/doctrine, memories, intelligence blocks, task queue, cadence nudges. Per-agent contracts (470+ lines of personality branches) |
| `performance-intel.js` | 851 | Agent quality scores, stalled-agent detection, experiment evaluation, hook classification |
| `helpers.js` | 559 | `logEvent` buffered run logging, `capitalizeSentences()`, `findNearDuplicateSocialPost()` (semantic dedup ≥0.6), `campaignDailyPostCapStatus()`, escalation evaluation |
| `social-intel.js` | 458 | WoW analytics, campaign velocity/pace (`_computeCampaignPace`), weekly snapshots |
| `constants.js` | 437 | AGENT_IDS/AGENT_ROLES (bootstrap-fallback from `agentRegistry` state — System 14), guardrails, caps, thresholds, blast-radius map |
| `reflection-intel.js` | 419 | Self-awareness digest: role drift vs `expectedActionMix`, strategy fatigue, repeated failures, 3-day reflection cadence |
| `emergence-intel.js` | 397 | 5 compound signals (proposal rate, reject rate, fleet churn, capital RED streak, AQ depth). Pure observation |
| `task-mutations.js` | 339 | Mutation dispatcher + the task-lifecycle gates; auto-complete paths; `reviewed_copy` propagation |
| `smoke-test.js` | 357 | Structural self-checks |
| `ops-intel.js` | 325 | Forge's dashboard: heartbeat health, cost monitor, stalled agents, threshold alerts |
| `world-state-intel.js` | 316 | System 11 aggregator — ~1KB canonical snapshot, hard 1500-char cap (throws on overflow) |
| `strategic-intel.js` | 304 | Cross-product P&L rollup (Nova) |
| `content-intel.js` | 297 | Scribe's content performance digest |
| `execution-engine.js` | 276 | Execute/review task prompt harness |
| `quality-gate.js` | 270 | Composed verdict `{pass, confidence, issues, deterministicFlags}`: leak detectors (refusal text, revision commentary, placeholders, agent persona, LinkedIn >1500 chars), repeat-promo URL serialization (1 pending per link/platform, ~6h defer), claim grounding, `SOCIAL_ATTEMPTS_CAP=2`. Pure functions — backtestable offline |
| `research-intel.js` | 260 | Scout's demand dashboard |
| `finance-intel.js` | 237 | Budget status, burn trend, runway |
| `campaign-lifecycle.js` | 220 | Auto-complete/pause/reactivate/replenish campaigns |
| `outcome-intel.js` | 213 | Per-agent/experiment/hook/campaign engagement rollups + `AUTO_CONCLUDE` 4-gate check |
| `site-intelligence.js` | 210 | Telemetry, deploy status |
| `allocation-intel.js` | 209 | System 12: per-agent monthly caps, squeeze mode, month rollover |
| `normalization.js` | 192 | Dual-envelope parser (legacy + new agent output formats) |
| `strategy-intel.js` | 187 | CEO north-star KPI tree (`companyStrategy`), null-safe when unseeded |
| `gemini.js` | 160 | LLM wrapper — `systemConfig.heartbeatModel` (5-min cache) → `HEARTBEAT_MODEL` env fallback. Values: `claude-sonnet`, `claude-haiku`, `gemini` |
| `workspace-context.js` | 108 | Role-based file context |

Data dependencies from `api/_data/`: `product-facts.json`, `skills.json` (synced from `.claude/skills/` by pre-commit hook), `founder-voice-examples.json`, `pixel-agents.json`, `bluesky-discovery-keywords.json`.

## Execution flow

1. **Init:** demo guard → cycle ID → buffered run logging → concurrency lock (`heartbeatLock`, skip if held).
2. **Registry load:** `loadAgentRegistry(storage)` mutates `AGENT_IDS`/`AGENT_ROLES` in place (hired agents run immediately; `_EXEC_GROUPS` fallback appends unassigned actives).
3. **Safety-net sweeps (pre-agent):** campaign lifecycle; inter-agent message expiry (60-min TTL, max 2/agent/cycle); CEO-revision respawns (social + publish_document); needs-attention pruning; proactive publish of ready docs (hero image + 14d freshness + 200 chars); orphan AQ recovery; LinkedIn token refresh (<7d expiry); goal→campaign cancel cascade; auto-archive (done +7d, canceled links); stale draft dedup-archive; CEO task auto-triage; same-cycle review cooldown.
4. **Digests:** performance → outcome → reflection → finance → research → content → strategic → world-state → strategy → allocation → emergence (read-only cache, daily cron writes it).
5. **Agent loop** (nova | cipher+pixel+forge+scout parallel-prefetch | scribe, quill | echo | hired): per agent — config/Tier-4 gates → Gemini-call cap (15/cycle) → run → merge guardrail counters → apply mutations (unless observe/manual mode) → feedback memories (`auto:*`) → 3+ violations puts the agent in proposals-only cooldown for the rest of the run.
6. **Post-loop:** experiment auto-conclude (samples≥10, per-arm≥5, |effect|≥0.15, verdict ∈ {promote, discard}); campaign pace escalation (7-day dedup); **auto-post block** (the funnel below); memory write counters; bulk state persistence; `flushRunLog`; lock release.

## The auto-post funnel (gates in firing order)

For done tasks with `reviewed_copy` and no social action yet:

1. Defer-window check (`_social_post_deferred_until`)
2. **Semantic dedup** — ≥0.6 word overlap vs 14d same-platform/campaign posts → defer ~3h, flag `_social_action_suppressed_dup`
3. **Campaign daily cap** — `frequency+1` (daily campaigns) else 2/platform/24h, counts ALL attempts incl. rejected → defer ~3h
4. **Repeat-promo URL** — one pending-approval post per deep link per platform → defer ~6h
5. **Composed quality gate** — ≥70% confidence fail → reset parent + system comment with issues (90.2% backtest recall vs CEO quality rejects)
6. **Social attempts cap** — 2 lifetime auto-attempts per task; CEO revision resets for exactly one respawn
7. **QG circuit breaker** — 5+ consecutive failures → escalate to CEO, stop auto-retry

On pass: create action + AQ entry, UTM injection (`utm_source`/`utm_content`) on ambientpixels.ai URLs.

## Full gate census (~21, not "8")

The canonical "8 blocking gates" (orphan, exact dup, fuzzy dup, task ceiling 50, research ceiling 5, social promo, campaign freeze, objective) are the **task-lifecycle** gates. The complete set adds: objective_status, objective/campaign_canceled_freeze, rate_cap (3 creates/3 moves/3 updates/5 proposals per agent per run), field_allowlist, mode_gate (observe/manual), proposal_schema, agent_cooldown, semantic_dup, campaign_daily_cap, repeat_promo_url, quality_gate, social_attempts_cap, qg_circuit_breaker. All write structured `policy-violation` entries with `details.gate`.

## Undocumented-but-real subsystems (found in code, absent from skill docs pre-codex)

- Revision safety nets self-complete (spawn replacement Scribe copy tasks with CEO feedback embedded)
- Proactive publish + document cleanup (stale draft archiving by title similarity)
- Inter-agent messaging (60-min TTL, rate-limited)
- CEO task auto-triage; same-cycle review cooldown
- Parallel Gemini prefetch for the cipher/pixel/forge/scout group
- Agent cooldown (proposals-only after 3 violations in one run)
- LinkedIn proactive token refresh

## Model configuration (live caveat)

`systemConfig.heartbeatModel` overrides the env var and is switchable from the Dev View dashboard. **As of 2026-06-11 it is set to `gemini`** — the documented low-compliance model ("ignores complex multi-section prompts"). Live runs confirm near-zero agent actions per cycle on this setting. If agent throughput looks dead, check this first.
