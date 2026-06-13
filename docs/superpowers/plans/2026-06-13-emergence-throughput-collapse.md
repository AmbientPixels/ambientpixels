# Plan — Emergence Signal 6: Fleet Throughput Collapse

**Date:** 2026-06-13
**Motivation:** The System Codex (autonomy 7.2/10) and two live incidents flagged the same hole: the heartbeat can stop producing work and **no alarm fires**.
- **Incident 1 (gemini-idle):** `heartbeatModel` left on Gemini; fleet output collapsed to ~2 actions/cycle; the audit caught it, nothing automated did.
- **Incident 2 (claude outage, 2026-06-12/13):** model flipped to `claude-sonnet`; the 4-agent parallel prefetch ate the Anthropic per-minute token bucket, then credits exhausted. Half the fleet then the whole fleet went silent for ~24h. Forge's own reflections misdiagnosed it as "task-volume lag"; emergence showed 0 signals; runs reported `ok`/`warn` with null errors because `gemini.js` swallows LLM failures.

The journal's stated fix: "a guardrail that ties model config to throughput, so silence like that raises a flag on its own."

## Design decision: where it lives

**Emergence Monitoring (System 15), as a 6th signal.** Rationale:
- Emergence is the pure **observation layer** — it computes signals and writes only `emergenceDigest` + `governanceLog`, never mutates state. Exactly the right home for a "raise a flag" guardrail.
- It is **cause-agnostic**: it watches the *symptom* (throughput), so it catches misconfig, credit exhaustion, and rate-limiting alike — all three failure modes we've now hit.
- It is **deterministic** (no LLM). During a total LLM outage the emergence cron STILL runs and STILL writes the signal — the immune system works when the brain is down.
- It requires **no high-blast-radius edits**: `index.js`, `gemini.js`, `company-state` are untouched. The cron and on-demand endpoint already load `heartbeatRuns` and pass it into `buildEmergenceDigest`.

**Known limitation (documented, accepted for v1):** emergence runs daily (16:00 UTC), so onset→detection latency is up to 24h. Mitigant: once the daily cron writes the signal, Forge's hourly prompt block surfaces it every cycle until it clears, and the CEO dashboard/governanceLog show it immediately. A faster hourly hook would require touching `index.js` (high blast radius) — deferred to a separate, explicitly-approved change.

## The signal: `throughput-collapse` (subject: `system`)

Two prongs, either can fire. Window = last N runs that actually ran the agent loop (non-empty `perAgent`); skip frozen/observe/errored-early runs. Require a minimum run count so a fresh history can't false-fire.

1. **Aggregate collapse** — mean `agentActions.executed` over the window ≤ threshold. Targets the gemini-idle case (sustained low total output).
2. **Persistent fleet silence** — count agents present in `perAgent` across the whole window with `actionsExecuted === 0` in every run AND median `avgLatencyMs` below a latency floor. The latency floor is the discriminator: a healthy agent that *chose* to do nothing still spends 3–15s thinking; a failed/empty LLM call returns in <500ms. Targets the outage case (dead agents at ~150ms with null reasoning). Excludes `*_closing` pseudo-agents and agents skipped for `no_assigned_tasks_or_mentions` (they aren't in `perAgent`).

### Thresholds (new `EMERGENCE_THRESHOLDS.throughputCollapse`)
```
windowRuns: 6, minRunsRequired: 4, latencyFloorMs: 1000,
avgExecuted: { yellow: 2,  red: 1 },
silentAgents:{ yellow: 3,  red: 5 }
```
Level = worst of the two prongs. All tunable in one place.

### Recommendation text (encodes the operational knowledge from both incidents)
> Fleet throughput collapsed (avg X exec/run over K runs; N agents silent at sub-second latency). Most common causes: `systemConfig.heartbeatModel` misconfigured (Gemini ignores the multi-section prompt) or Anthropic credit/rate-limit failure (swallowed in gemini.js). Check the model setting + Anthropic billing. Healthy Claude runs are 3–15s/agent; sub-500ms + null reasoning = failed LLM call, not an idle choice.

## Dedup behaviour (free, from existing cron)
Cron dedups by `signalType|subject|level`. `throughput-collapse|system|RED` logs once on onset (no daily spam) and again only on a YELLOW→RED upgrade. Matches every other signal.

## Files
1. `api/companyHeartbeat/constants.js` — add `throughputCollapse` to `EMERGENCE_THRESHOLDS`.
2. `api/companyHeartbeat/emergence-intel.js` — `_computeThroughputCollapse(heartbeatRuns, nowMs)`; concat into `buildEmergenceDigest` signals + `metrics.throughputCollapse`.
3. `c:/tmp/test-emergence-throughput.cjs` — offline tests (pure module, no mocks).

**No changes** to: emergenceCheckCron, emergenceMonitor, emergence.html (renders signals generically), prompt-builders (Forge block filters by level), or any high-blast-radius file.

## Test cases (TDD — write first)
- Healthy window (mean exec 3–5, ≤1 silent) → **no signal**.
- Gemini-idle (6 runs, exec ~2, most agents 0/low-latency) → **RED**.
- Full outage (6 runs, exec ~1, all agents sub-500ms/0-exec) → **RED** both prongs.
- Partial outage (2–3 agents persistently silent at low latency, others busy) → **YELLOW** silence prong; aggregate may stay clean (documented).
- Idle-but-healthy agent (0 exec across window but normal latency) → **not** counted silent (latency floor).
- Frozen/observe runs + empty perAgent → excluded from window.
- Fresh history (<4 qualifying runs) → **no signal**.
- Validate against the real last-30 `heartbeatRuns` → must NOT false-fire on the healthy stretches.
