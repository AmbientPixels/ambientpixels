# reflectionWriterCron — Guaranteed Reflection Cadence (Design)

**Date:** 2026-07-16
**Status:** Approved design, pre-implementation
**Author:** CEO + Claude (design session)

## Problem

The Self-Awareness / Reflection System (Heartbeat System 10) expects every agent to
write a `type: 'reflection'` memory every 3 days. In practice the fleet is stuck at
**9/9 agents reflection-overdue**, and only **7 reflections exist in all of history**
— all on two days (2026-06-28 ×1, 2026-07-09 ×6), then 8+ days of silence. Three
agents (nova, echo, vale) have **never** written one.

### Root cause (verified, not assumed)

Every guard on the write path is open — this is not a gate bug:

- The dashboard counts correctly (`lastReflectionAt` matches the newest `reflection`
  memory per agent).
- The cadence nudge (`reflectionCadenceSection`, `prompt-builders.js:1542`) fires for
  every overdue agent every cycle.
- `reflection` is in `L4_STRUCTURAL_TYPES` (`constants.js:119`), so it is **exempt**
  from the `evidence.runId` requirement — the historical blocker, already fixed.
- `governanceLog` has **zero** memory-block events — nothing is written-and-rejected.

The reflection write is a **soft, voluntary `remember` action** the LLM must choose to
emit, competing inside the **3-actions-per-cycle cap**, with **no deterministic
backstop**. Under the current fleet model (`gemini-pro`), which this codebase's own
tuning notes document as deprioritizing buried meta-cognitive instructions, agents
almost never emit it. The two busiest agents (nova, echo) have zero reflections
precisely because they never have a spare action slot. This mirrors the known split:
`memoryConsolidate` (a deterministic cron) works fine; reflection (LLM-voluntary) is
dormant.

## Goals

- Guarantee that every overdue agent gets a grounded reflection written, independent
  of which model runs the fleet or how busy the agent is.
- Keep the reflection a genuine synthesis ("what my data shows" + "what I'm changing"),
  not boilerplate.
- Be fully transparent about authorship: system-written reflections are labeled and
  visibly distinguished from agent-volunteered ones.
- **Zero changes to the high-blast-radius heartbeat engine.**

## Non-goals

- Not fixing the voluntary in-heartbeat reflection path (that would touch
  `agent-runner.js` / `index.js`). The voluntary path remains and takes precedence
  when it fires.
- Not changing the fleet model or the 3-action cap.
- Not raising the 300-char truncation on voluntary reflections (high blast radius).

## Architecture

A new standalone Azure Function, mirroring the proven `memoryConsolidate` pattern.
Azure auto-discovers folders containing `function.json`, so there is **no central
registration and no heartbeat change**.

```
api/reflectionWriterCron/
  function.json   → timerTrigger, schedule "0 30 15 * * *"  (15:30 UTC daily,
                    right after memoryConsolidate at 15:00)
  index.js        → the writer
```

### Data flow

```
runtimeMemory.reflectionDigest        (already built hourly by the heartbeat)
        │
        ▼
for each agentId where perAgent[agentId].reflectionOverdue === true:
        │
        ├─ idempotency guard: re-read the agent's actual latest 'reflection'
        │  memory from agentMemories. If its timestamp is within the last 24h,
        │  SKIP (voluntary path already reflected, or cron already ran).
        │
        ├─ generate text:
        │    primary  → single-purpose gemini-pro call. Input = that agent's
        │               digest slice (coreQuestion, decisionPatterns,
        │               strategyFatigue, roleAdherence, repeatedFailures).
        │               Output = 100–300 word reflection: what the data shows +
        │               what the agent is changing. This call does NOTHING else,
        │               so it cannot be crowded out the way the heartbeat nudge is.
        │    fallback → deterministic template assembled from the same digest
        │               fields, used whenever the LLM returns empty/invalid.
        │
        └─ write memory to agentMemories[agentId]:
             { id, type:'reflection', text (≤1000 chars),
               source:'auto:reflection', timestamp: now,
               expiresAt: now + 30d, evidence:{ basis:'digest', model } }
             then enforce MAX_MEMORIES_PER_AGENT (50) FIFO cap.

storage.setState('agentMemories', memories)   (single write at end)
```

The cron **reads** the digest the heartbeat already computes; it never recomputes
overdue state. A bad/empty gemini response can never leave an agent overdue because the
template fallback always yields a valid reflection.

### Guards & idempotency (mirrors memoryConsolidate discipline)

- Writes only for agents with `reflectionOverdue === true`.
- Re-checks the agent's real latest reflection timestamp; skips if < 24h old. The
  agent's own voluntary reflections always win.
- At most one reflection per agent per run.
- Fails safe: on `reflectionDigest` load error or missing digest, log and exit without
  writing (never fabricate against absent data).

### Content length

The cron writes directly (not through the heartbeat memory handler that truncates to
300 chars), so it may write the fuller **~1000 chars (~180 words)** needed for a real
synthesis. Voluntary reflections stay short; that gap is accepted (see Non-goals).

### Model call

Reuse the existing resolved-model call path already used by the heartbeat /
`companyMorningReport` (resolves `systemConfig.heartbeatModel` = `gemini-pro`, via
`GEMINI_API_KEY`). The exact shared helper to import is confirmed in the implementation
plan.

## Transparency (labeling + dashboard)

System-written reflections are labeled `source: 'auto:reflection'` and visibly
distinguished from agent-volunteered ones.

- **`api/companyHeartbeat/reflection-intel.js`** — where it already derives
  `lastReflectionAt` from the latest reflection memory (lines ~300–309), also expose
  `lastReflectionAuto: (latestReflection.source === 'auto:reflection')` on
  `perAgent[aid]`. Read-only intel module; not the heartbeat pump.
- **`modules/company/awareness.html`** `renderCadence` (line ~256) — append a subtle
  `(auto)` marker to the "last: YYYY-MM-DD" line when `lastReflectionAuto` is true.

## Files touched / blast radius

| File | Change | Risk |
|------|--------|------|
| `api/reflectionWriterCron/function.json` | new | none (isolated) |
| `api/reflectionWriterCron/index.js` | new | none (isolated) |
| `api/companyHeartbeat/reflection-intel.js` | +1 exposed field (`lastReflectionAuto`) | low — intel module, read-only against state |
| `modules/company/awareness.html` | +1 display marker | low — frontend only |

No edits to `index.js`, `agent-runner.js`, `company-state`, `staticwebapp.config.json`,
`company-actions.json`, or any other high-blast-radius file.

## Configuration constants (in the cron)

- Schedule: `0 30 15 * * *` (15:30 UTC daily).
- `REFLECTION_TEXT_MAX_CHARS = 1000`.
- `RECENT_REFLECTION_SKIP_HOURS = 24` (idempotency window).
- Reflection TTL: 30 days (matches existing `L4_TTL_BY_TYPE.reflection`).
- Source label: `auto:reflection`.

## Testing / verification

1. Local: run `index.js` against a fixture `reflectionDigest` with a mix of overdue /
   not-overdue / recently-reflected agents; assert only the right agents get a write,
   text is non-empty, and the FIFO cap holds.
2. Fallback: force an empty LLM response; assert the template reflection is written.
3. Post-deploy: manually trigger the function (or wait for 15:30 UTC), then confirm via
   `/api/awarenessDigest` that `globals.reflectionsOverdue` drops toward 0 and each
   written agent shows `lastReflectionAt` = today with `lastReflectionAuto: true`.
   Eyeball the actual reflection text for quality.

## Rollback

Delete the `api/reflectionWriterCron/` folder (removes the function on next deploy).
The `reflection-intel.js` field and `awareness.html` marker are additive and harmless
if left. No data migration; written reflections simply age out via their 30-day TTL.

## Open decisions (resolved this session)

- Placement: **standalone cron** (not in-heartbeat, not folded into memoryConsolidate).
- Content: **gemini-pro single-purpose call + deterministic template fallback**.
- Transparency: **`auto:reflection` label + `(auto)` marker on awareness.html**.
- Text length: cron writes up to **~1000 chars** (longer than the voluntary 300-char path).
- Cadence: **daily** cron (sufficient for a 3-day reflection target).
