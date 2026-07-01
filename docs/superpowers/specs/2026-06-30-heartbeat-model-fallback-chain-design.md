# Heartbeat Model: gemini-2.5-pro + Cross-Provider Fallback Chain

**Date:** 2026-06-30
**Status:** Design approved, pending spec review
**Author:** CEO + Claude

## Background

The heartbeat drives all 8 agents through a single model wrapper
(`api/companyHeartbeat/gemini.js`). The active model is switchable at runtime via
`systemConfig.heartbeatModel` (5-min cache). Two provider paths exist today:
Anthropic (`_callClaude`) and Google (`_callGeminiRaw`).

### The incident that motivated this

The fleet was left on `claude-haiku` (an outage fallback that was never reverted).
Haiku could not reliably emit the structured action envelope, so ~2 days of
hourly heartbeats executed **0 actions** — 71 `output_envelope`
(`invalid_json_or_non_object`) violations across all agents. The heartbeat ran
fine mechanically; the agents just produced nothing. Emergence Monitoring raised
a `throughput-collapse` RED signal, but nothing acted on it and no human was
watching, so the company sat dead.

Two structural gaps this design closes:
1. **No stronger-but-cheap Gemini option** — only `gemini-2.5-flash` (which
   ignores multi-section prompts) or expensive Claude Sonnet.
2. **No resilience** — when the active model returns `null` (error, quota cap,
   weak output), the wrapper returns `null` and the fleet does nothing. A single
   failing model = total silent outage.

## Goals

1. Add `gemini-2.5-pro` as a selectable heartbeat model (a real quality step up
   from Flash, still far cheaper than Sonnet).
2. Add a **cross-provider fallback chain** so a failing primary model (or a whole
   provider being down) never silently zeroes the fleet.
3. **Surface every fallback** to the governance audit trail so a failing primary
   is visible on the first cycle instead of dying quietly.

## Non-Goals

- **Forced-JSON structured output on the Claude path.** The Claude path has no
  schema enforcement (the original Haiku root cause). Sonnet follows the envelope
  contract reliably, so the fallback is safe in practice. Hardening the Claude
  path with forced tool-use / JSON mode is an explicit **follow-up**, out of scope
  here.
- **Per-agent model routing.** One global model for all 8 agents remains. Noted as
  a possible future enhancement.
- **New providers** (OpenAI, OpenRouter). Considered and deferred.

## Design

### 1. Model registry refactor (`gemini.js`)

Today `_callGeminiRaw` hardcodes the Flash URL and the usage-log model ID.
Parameterize the Gemini path by model ID:

- Replace the constant `GEMINI_URL` string with a builder:
  `geminiUrl(modelId) => 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':generateContent?key='`
- `_callGeminiRaw(prompt, agentId, maxTokens, temperature, caller, structured, modelId)`
  gains a `modelId` param (default `'gemini-2.5-flash'`), used for both the URL
  and the `logGeminiUsage` model field.

Extend the `MODELS` map:

```js
var MODELS = {
  'claude':        'claude-sonnet-4-6',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-haiku':  'claude-haiku-4-5-20251001',
  'gemini':        'gemini-2.5-flash',
  'gemini-flash':  'gemini-2.5-flash',
  'gemini-pro':    'gemini-2.5-pro'
};
```

Provider routing switches from the hardcoded string check to a prefix test on the
**resolved model ID**, so future variants on either provider are a one-line map
add:

```js
function _providerOf(modelKey) {
  var id = MODELS[modelKey] || '';
  return id.indexOf('claude') === 0 ? 'claude' : 'gemini';
}
```

`_isClaudeModel` is kept (still exported/used) but reimplemented in terms of
`_providerOf`.

### 2. Fallback chain (`_callWithFallback` helper in `gemini.js`)

New internal helper that both `callGemini` and `callGeminiExecute` delegate to.

**Attempt list** = `[configuredModel, ...FALLBACK_TAIL]`, **deduped by resolved
model ID** (not by key — otherwise `gemini` and `gemini-flash`, which both resolve
to `gemini-2.5-flash`, would double-attempt Flash), preserving order:

```js
var FALLBACK_TAIL = ['gemini-flash', 'claude-sonnet']; // fixed cross-provider tail
```

Resulting chains:
- `gemini-pro`    → `gemini-pro → gemini-flash → claude-sonnet`
- `gemini` / `gemini-flash` → `gemini-flash → claude-sonnet`
- `claude-sonnet`→ `claude-sonnet → gemini-flash`
- `claude-haiku` → `claude-haiku → gemini-flash → claude-sonnet`

Because the tail always contains one Gemini and one Claude model, every chain
reaches **both providers** (unless the primary already is one of them, in which
case the other provider is still tried). A whole provider outage never zeroes the
fleet.

**Algorithm:**

```
_callWithFallback(prompt, agentId, maxTokens, structured, caller):
  chain = dedupeByModelId([resolveModel(), ...FALLBACK_TAIL])
  for i, modelKey in chain:
    text = provider(modelKey) == 'claude'
             ? _callClaude(prompt, agentId, maxTokens, modelKey)
             : _callGeminiRaw(prompt, agentId, maxTokens, temp, caller, structured, MODELS[modelKey])
    if text != null:
      if i > 0:   // a non-primary answered → a fallback fired
        logFallback(chain[0], modelKey, agentId, caller)
      return text
  // whole chain failed
  logFallback(chain[0], null, agentId, caller)  // usedModel=null => total failure
  return null
```

- `callGemini`  → `_callWithFallback(prompt, agentId, 1500, /*structured*/ true, 'heartbeat')`
- `callGeminiExecute` → `_callWithFallback(prompt, agentId, 1200, /*structured*/ false, 'heartbeat-execute')`
  (execute uses temperature 0.8; the helper carries the per-caller temperature.)
- `callWithModel` (meetings pin) is **unchanged** — an intentional hard pin gets
  no fallback.

### 3. Surfacing fallbacks (`helpers.js` + `gemini.js`)

Reuse the existing `logEvent` machinery, which already buffers per-run
(race-free) and flushes in bulk at end of run (`helpers.js:262-309`).

`helpers.js` — two small additions:
- Add `'model-fallback'` to the `_GOVERNANCE_TYPES` set so these events route to
  `governanceLog` (the CEO-facing forensic trail), not the noisier `logs` key.
- Export a `currentCycleId()` accessor returning `_runBuffer ? _runBuffer.cycleId : null`,
  so `gemini.js` can address the active run buffer without threading `cycleId`
  through every call site.

`gemini.js` — `logFallback(failedModel, usedModel, agentId, caller)`:
- **Lazy-require** helpers inside the function
  (`var h = require('./helpers')`) to sidestep the circular require
  (`helpers.js:6` already requires `gemini.js`; lazy access at call time is safe
  because the module cache is complete by then).
- Guard defensively: `if (h && typeof h.logEvent === 'function')`.
- Emit:
  ```js
  h.logEvent('model-fallback', agentId,
    usedModel ? ('Model fallback: ' + failedModel + ' → ' + usedModel)
              : ('All models failed (primary ' + failedModel + ')'),
    (h.currentCycleId && h.currentCycleId()) || null,
    { failedModel: failedModel, usedModel: usedModel, caller: caller });
  ```

Governance event shape:
```json
{ "type": "model-fallback", "agentId": "nova",
  "summary": "Model fallback: gemini-pro → gemini-flash",
  "cycle": "<cycleId|null>", "timestamp": "…",
  "details": { "failedModel": "gemini-pro", "usedModel": "gemini-flash", "caller": "heartbeat" } }
```

### 4. Dashboard pill (Dev View → AI Model Fleet panel)

Add a **"Gemini Pro"** toggle beside the existing Sonnet / Haiku / Gemini Flash
pills, saving `heartbeatModel = 'gemini-pro'` through the same save path the other
pills use. Active-pill highlighting and the CEO status-strip model label pick up
the new value automatically if they render from `heartbeatModel`; verify and
adjust the label map if it's a hardcoded lookup.

## Error handling

- **Primary fails, fallback succeeds:** fleet keeps working on the backup;
  `model-fallback` event logged. Persistent fallback is visible in the audit
  trail (and Forge's ops dashboard, which already reads `governanceLog`).
- **Entire chain fails:** identical to today's behavior (`null` → 0 actions), but
  now a `model-fallback` event with `usedModel: null` records the total failure —
  diagnosable instead of silent.
- **Missing API key** (`GEMINI_API_KEY` / `ANTHROPIC_API_KEY` unset): that
  provider's path returns `null`; the chain naturally skips to the next provider.
- **Circular require:** avoided via lazy require + typeof guard; if helpers is
  somehow unavailable, logging is skipped but the model call itself still returns.

## Testing

1. **Unit-ish harness** (`scripts/` one-off, Node): monkeypatch/stub the two
   provider callers to force `null` on the primary and assert `_callWithFallback`
   returns the backup's text and that `logEvent` was invoked with the right
   `failedModel`/`usedModel`.
2. **Chain construction:** assert the deduped attempt list for each configured
   model matches the table in §2.
3. **Live smoke:** set `heartbeatModel = 'gemini-pro'` via company-state, trigger
   a heartbeat, confirm the run executes actions and `getActiveModel()` reports
   `gemini-pro`. (Failure/fallback paths are exercised in the harness, step 1 —
   the live check only verifies Pro works end-to-end.)
4. **Governance surfacing:** after a forced fallback in the harness, assert a
   `model-fallback` event was emitted with correct `failedModel`/`usedModel`
   details (via the stubbed `logEvent`, no live write needed).

## Files touched

| File | Change |
|------|--------|
| `api/companyHeartbeat/gemini.js` | `geminiUrl()` builder, `modelId` param on Gemini path, `MODELS` additions, `_providerOf`, `_callWithFallback`, `logFallback`, delegate `callGemini`/`callGeminiExecute` |
| `api/companyHeartbeat/helpers.js` | add `'model-fallback'` to `_GOVERNANCE_TYPES`; export `currentCycleId()` |
| Dev View AI-Model panel (dashboard HTML/JS) | add "Gemini Pro" pill + save wiring |

**Explicitly NOT touched:** `index.js`, `agent-runner.js`, `company-state`,
`constants.js` (beyond the already-imported envelope schema), `staticwebapp.config.json`.

## Rollback

Pure additive change. To revert behavior without a deploy: set
`heartbeatModel` back to any single working model — the chain still applies but
can be reasoned about per-model. To fully disable: `git revert` the commit; the
runtime model switch is unaffected.

## Follow-ups (not in this change)

1. Force structured JSON output on the Claude path (removes the original Haiku
   failure mode entirely).
2. Wire `throughput-collapse` (and/or `model-fallback` frequency) to a real alert
   (keepalive pinger / webhook) so a degraded fleet pings the CEO.
3. Per-agent model routing (strong model for Nova, cheap for Scout/Quill).
