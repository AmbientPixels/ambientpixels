# Heartbeat Model Fallback Chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `gemini-2.5-pro` as a selectable heartbeat model and a cross-provider fallback chain so a failing model never silently zeroes the fleet.

**Architecture:** Extract the pure model logic (registry, provider routing, chain build/walk) into a new `model-registry.js` so it's testable with no network/storage. `gemini.js` becomes the thin I/O layer that wires the chain to the two provider callers and logs fallbacks via the existing `logEvent` run buffer. The Dev View gains a "Gemini Pro" pill.

**Tech Stack:** Node.js (CommonJS, ES5-style `var` to match `gemini.js`), Azure Functions, vanilla-JS dashboard. Tests are standalone Node `assert` scripts under `scripts/` (the repo has no test framework; this matches `scripts/backtest-quality-gate.cjs`).

**Note on spec deviation:** The approved spec placed all logic "in gemini.js". This plan splits the *pure* core into a new `model-registry.js` for hermetic testability. Behavior is identical; it's an additive new file. Everything else matches the spec.

---

### Task 1: helpers.js — `model-fallback` governance type + `currentCycleId()`

**Files:**
- Modify: `api/companyHeartbeat/helpers.js` (`_GOVERNANCE_TYPES` ~line 249, add function near line 262, exports ~line 706)
- Test: `scripts/test-model-fallback.cjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-model-fallback.cjs`:

```js
'use strict';
const assert = require('assert');

// ── helpers.currentCycleId ──
const h = require('../api/companyHeartbeat/helpers');
assert.strictEqual(typeof h.currentCycleId, 'function', 'currentCycleId should be exported');
assert.strictEqual(h.currentCycleId(), null, 'no active run → null');
h.beginRunLogging('cyc-abc');
assert.strictEqual(h.currentCycleId(), 'cyc-abc', 'active run → its cycleId');
h.flushRunLog();

console.log('OK: helpers.currentCycleId');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-model-fallback.cjs`
Expected: FAIL — `AssertionError: currentCycleId should be exported` (or `TypeError`).

- [ ] **Step 3: Add the governance type**

In `helpers.js`, add `'model-fallback'` to the `_GOVERNANCE_TYPES` set (~line 249):

```js
const _GOVERNANCE_TYPES = new Set([
  'policy-violation',
  'stall-alert',
  'campaign-pace-alert',
  'system-directive-created',
  'experiment-auto-concluded',
  'emergence-signal',
  'agent-retired', 'agent-hired', 'agent-evolved',
  'model-fallback'
]);
```

- [ ] **Step 4: Add `currentCycleId()`**

In `helpers.js`, immediately after `beginRunLogging` (~line 264):

```js
// Returns the cycleId of the active heartbeat run buffer, or null if no run is
// active. Lets low-level modules (gemini.js) address the run buffer for logEvent
// without threading cycleId through every call site.
function currentCycleId() {
  return _runBuffer ? _runBuffer.cycleId : null;
}
```

- [ ] **Step 5: Export it**

In the `module.exports` block (~line 706), add `currentCycleId` after `beginRunLogging`:

```js
  logEvent,
  beginRunLogging,
  currentCycleId,
  flushRunLog,
  spawnQgRespawnCopyTask
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node scripts/test-model-fallback.cjs`
Expected: PASS — prints `OK: helpers.currentCycleId`.

- [ ] **Step 7: Commit**

```bash
git add api/companyHeartbeat/helpers.js scripts/test-model-fallback.cjs
git commit -m "feat(heartbeat): add model-fallback governance type + currentCycleId helper"
```

---

### Task 2: model-registry.js — pure model map, provider routing, chain builder

**Files:**
- Create: `api/companyHeartbeat/model-registry.js`
- Test: `scripts/test-model-fallback.cjs` (append)

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-model-fallback.cjs`:

```js
// ── model-registry ──
const R = require('../api/companyHeartbeat/model-registry');

// MODELS map has the new keys
assert.strictEqual(R.MODELS['gemini-pro'], 'gemini-2.5-pro');
assert.strictEqual(R.MODELS['gemini-flash'], 'gemini-2.5-flash');
assert.strictEqual(R.MODELS['gemini'], 'gemini-2.5-flash');
assert.strictEqual(R.MODELS['claude-sonnet'], 'claude-sonnet-4-6');

// providerOf routes by resolved model id prefix
assert.strictEqual(R.providerOf('gemini-pro'), 'gemini');
assert.strictEqual(R.providerOf('claude-haiku'), 'claude');
assert.strictEqual(R.providerOf('claude'), 'claude');
assert.strictEqual(R.providerOf('nonsense'), 'gemini', 'unknown key defaults to gemini');

// buildChain: deduped BY RESOLVED MODEL ID, order preserved
assert.deepStrictEqual(R.buildChain('gemini-pro'), ['gemini-pro', 'gemini-flash', 'claude-sonnet']);
assert.deepStrictEqual(R.buildChain('claude-sonnet'), ['claude-sonnet', 'gemini-flash']);
assert.deepStrictEqual(R.buildChain('claude-haiku'), ['claude-haiku', 'gemini-flash', 'claude-sonnet']);
// 'gemini' resolves to the same id as 'gemini-flash' → must NOT double-attempt flash
assert.deepStrictEqual(R.buildChain('gemini'), ['gemini', 'claude-sonnet']);

console.log('OK: model-registry');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-model-fallback.cjs`
Expected: FAIL — `Cannot find module '../api/companyHeartbeat/model-registry'`.

- [ ] **Step 3: Create model-registry.js**

Create `api/companyHeartbeat/model-registry.js`:

```js
// model-registry.js — pure model routing + fallback-chain logic.
// No network, no storage: safe to require in tests. gemini.js wires these to
// the actual provider callers.

// Model IDs. Provider is inferred from the resolved id prefix (claude-* vs gemini-*).
var MODELS = {
  'claude':        'claude-sonnet-4-6',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-haiku':  'claude-haiku-4-5-20251001',
  'gemini':        'gemini-2.5-flash',
  'gemini-flash':  'gemini-2.5-flash',
  'gemini-pro':    'gemini-2.5-pro'
};

// Fixed cross-provider tail appended to every chain. Contains one Gemini and one
// Claude model so every chain reaches BOTH providers — a whole-provider outage
// never zeroes the fleet.
var FALLBACK_TAIL = ['gemini-flash', 'claude-sonnet'];

function providerOf(modelKey) {
  var id = MODELS[modelKey] || '';
  return id.indexOf('claude') === 0 ? 'claude' : 'gemini';
}

function isClaudeModel(modelKey) {
  return providerOf(modelKey) === 'claude';
}

// [configuredKey, ...FALLBACK_TAIL] deduped BY RESOLVED MODEL ID (not by key —
// 'gemini' and 'gemini-flash' both resolve to gemini-2.5-flash and must not be
// attempted twice). Unknown keys are dropped. Order preserved.
function buildChain(configuredKey) {
  var order = [configuredKey].concat(FALLBACK_TAIL);
  var seen = {};
  var chain = [];
  for (var i = 0; i < order.length; i++) {
    var key = order[i];
    var id = MODELS[key];
    if (!id) continue;
    if (seen[id]) continue;
    seen[id] = true;
    chain.push(key);
  }
  return chain;
}

// Walk the chain calling attemptFn(modelKey) => Promise<text|null>. Returns the
// first non-null text. When a non-primary answers, calls onFallback(primaryKey,
// usedKey). When the whole chain fails, calls onFallback(primaryKey, null).
async function runChain(chain, attemptFn, onFallback) {
  for (var i = 0; i < chain.length; i++) {
    var text = await attemptFn(chain[i]);
    if (text !== null && text !== undefined) {
      if (i > 0 && typeof onFallback === 'function') onFallback(chain[0], chain[i]);
      return text;
    }
  }
  if (typeof onFallback === 'function') onFallback(chain[0] || null, null);
  return null;
}

module.exports = { MODELS: MODELS, FALLBACK_TAIL: FALLBACK_TAIL, providerOf: providerOf, isClaudeModel: isClaudeModel, buildChain: buildChain, runChain: runChain };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-model-fallback.cjs`
Expected: PASS — prints `OK: model-registry` (and the earlier `OK` line).

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/model-registry.js scripts/test-model-fallback.cjs
git commit -m "feat(heartbeat): add pure model-registry (map, provider routing, chain builder)"
```

---

### Task 3: runChain fallback behavior test + wire gemini.js to the registry

**Files:**
- Modify: `api/companyHeartbeat/gemini.js`
- Test: `scripts/test-model-fallback.cjs` (append)

- [ ] **Step 1: Write the failing test (runChain behavior)**

Append to `scripts/test-model-fallback.cjs`:

```js
// ── runChain fallback behavior ──
(async function () {
  // primary succeeds → no fallback logged
  let cb = [];
  let r1 = await R.runChain(['gemini-pro', 'gemini-flash', 'claude-sonnet'],
    async (k) => (k === 'gemini-pro' ? 'PRIMARY_OK' : null),
    (from, to) => cb.push([from, to]));
  assert.strictEqual(r1, 'PRIMARY_OK');
  assert.strictEqual(cb.length, 0, 'primary success logs no fallback');

  // primary fails, second succeeds → fallback logged (primary → used)
  cb = [];
  let r2 = await R.runChain(['gemini-pro', 'gemini-flash', 'claude-sonnet'],
    async (k) => (k === 'gemini-flash' ? 'BACKUP_OK' : null),
    (from, to) => cb.push([from, to]));
  assert.strictEqual(r2, 'BACKUP_OK');
  assert.deepStrictEqual(cb, [['gemini-pro', 'gemini-flash']]);

  // whole chain fails → returns null, logs (primary → null)
  cb = [];
  let r3 = await R.runChain(['gemini-pro', 'gemini-flash', 'claude-sonnet'],
    async () => null,
    (from, to) => cb.push([from, to]));
  assert.strictEqual(r3, null);
  assert.deepStrictEqual(cb, [['gemini-pro', null]]);

  console.log('OK: runChain fallback behavior');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it passes (registry already supports this)**

Run: `node scripts/test-model-fallback.cjs`
Expected: PASS — prints `OK: runChain fallback behavior`. (This test validates Task 2's `runChain`; it should already pass. If it fails, fix `runChain` before proceeding.)

- [ ] **Step 3: Rewire gemini.js — imports + registry-backed helpers**

In `gemini.js`, replace the hardcoded model block and provider helpers.

Replace lines 12-13 (the two URL constants) and the `MODELS` map (lines 15-21) with:

```js
var registry = require('./model-registry');
var MODELS = registry.MODELS;
var CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

function _geminiUrl(modelId) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':generateContent?key=';
}
```

Replace `_isClaudeModel` (lines 49-51) and `_getClaudeModelId` (lines 53-55) with:

```js
function _isClaudeModel(model) {
  return registry.isClaudeModel(model);
}

function _getClaudeModelId(model) {
  return MODELS[model] || MODELS['claude-sonnet'];
}
```

- [ ] **Step 4: Parameterize the Gemini caller by model id**

In `_callGeminiRaw`, change the signature (line 109) to add `modelId`:

```js
async function _callGeminiRaw(prompt, agentId, maxTokens, temperature, caller, structured, modelId) {
```

Inside it, set a resolved id near the top of the function body (after the `if (!GEMINI_API_KEY) return null;` guard):

```js
  var gId = modelId || 'gemini-2.5-flash';
```

Change the fetch URL (line 136) from `GEMINI_URL + GEMINI_API_KEY` to:

```js
    var res = await fetch(_geminiUrl(gId) + GEMINI_API_KEY, {
```

Change the usage-log model (line 152) from `model: 'gemini-2.5-flash',` to:

```js
        model: gId,
```

- [ ] **Step 5: Add the fallback core + logging to gemini.js**

Add these functions just above the exported functions (before `callGemini`, ~line 166):

```js
// ── Fallback chain ──
function _attempt(modelKey, prompt, agentId, maxTokens, temperature, caller, structured) {
  if (_isClaudeModel(modelKey)) return _callClaude(prompt, agentId, maxTokens, modelKey);
  return _callGeminiRaw(prompt, agentId, maxTokens, temperature, caller, structured, MODELS[modelKey]);
}

// Surface a fallback to governanceLog via the existing run-buffer logEvent.
// Lazy-require helpers to avoid the circular require (helpers requires gemini at
// load; by call time the module cache is complete). Logging must never break the
// model call.
function _logFallback(failedKey, usedKey, agentId, caller) {
  try {
    var h = require('./helpers');
    if (!h || typeof h.logEvent !== 'function') return;
    var failedId = MODELS[failedKey] || failedKey;
    var usedId = usedKey ? (MODELS[usedKey] || usedKey) : null;
    var summary = usedId
      ? ('Model fallback: ' + failedId + ' → ' + usedId)
      : ('All models failed (primary ' + failedId + ')');
    var cyc = (typeof h.currentCycleId === 'function') ? h.currentCycleId() : null;
    var p = h.logEvent('model-fallback', agentId || null, summary, cyc,
      { failedModel: failedId, usedModel: usedId, caller: caller || null });
    if (p && typeof p.catch === 'function') p.catch(function () {});
  } catch (e) { /* never break the model call on a logging error */ }
}

async function _callWithFallback(prompt, agentId, maxTokens, temperature, caller, structured) {
  var configured = await _resolveModel();
  if (!MODELS[configured]) configured = 'gemini'; // unknown config → safe default
  var chain = registry.buildChain(configured);
  return registry.runChain(
    chain,
    function (modelKey) { return _attempt(modelKey, prompt, agentId, maxTokens, temperature, caller, structured); },
    function (failedKey, usedKey) { _logFallback(failedKey, usedKey, agentId, caller); }
  );
}
```

- [ ] **Step 6: Delegate the exported callers to the chain**

Replace `callGemini` (lines 168-172) and `callGeminiExecute` (lines 174-178) with:

```js
async function callGemini(prompt, agentId) {
  return _callWithFallback(prompt, agentId, 1500, 0.7, 'heartbeat', true);
}

async function callGeminiExecute(prompt, agentId) {
  return _callWithFallback(prompt, agentId, 1200, 0.8, 'heartbeat-execute', false);
}
```

Leave `getActiveModel`, `callWithModel`, and `module.exports` unchanged. (`callWithModel` stays a hard pin with no fallback — intentional for meetings.)

- [ ] **Step 7: Verify the module loads and the full test suite passes**

Run: `node -e "require('./api/companyHeartbeat/gemini.js'); console.log('gemini.js loads OK')"`
Expected: prints `gemini.js loads OK` (no circular-require crash).

Run: `node scripts/test-model-fallback.cjs`
Expected: PASS — all `OK:` lines print, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add api/companyHeartbeat/gemini.js scripts/test-model-fallback.cjs
git commit -m "feat(heartbeat): wire cross-provider fallback chain + gemini-2.5-pro into gemini.js"
```

---

### Task 4: Dashboard — Gemini Pro pill

**Files:**
- Modify: `modules/company/dashboard.html` (pills ~line 580-584, `_modelIdMap`/`_modelLabelMap` ~line 2655-2656, `renderActiveModel` label ~line 2132)

- [ ] **Step 1: Add the pill button**

In the `#model-switcher` div (~line 583), add a fourth pill after the Gemini Flash button. Copy the exact style string from the sibling buttons:

```html
            <button data-model="gemini-pro" class="model-pill" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--aura-border, #444);background:transparent;color:var(--aura-text-muted, #888);cursor:pointer;font-size:0.7rem;font-weight:600;transition:all 0.2s;">Gemini Pro</button>
```

- [ ] **Step 2: Add the map entries**

Update `_modelIdMap` and `_modelLabelMap` (~line 2655-2656):

```js
      var _modelIdMap = { 'claude-sonnet': 'claude-sonnet-4-6', 'claude-haiku': 'claude-haiku-4-5-20251001', 'gemini': 'gemini-2.5-flash', 'gemini-pro': 'gemini-2.5-pro' };
      var _modelLabelMap = { 'claude-sonnet': 'Claude Sonnet', 'claude-haiku': 'Claude Haiku', 'gemini': 'Gemini Flash', 'gemini-pro': 'Gemini Pro' };
```

- [ ] **Step 3: Distinguish Pro from Flash in the status-strip label**

In `renderActiveModel` (~line 2129-2132), the label derives from the model id substring. Update so `gemini-2.5-pro` shows "Gemini Pro":

```js
          var isHaiku = model.indexOf('haiku') !== -1;
          var isClaude = model.indexOf('claude') !== -1;
          var isGeminiPro = model.indexOf('gemini') !== -1 && model.indexOf('pro') !== -1;
          var isGemini = model.indexOf('gemini') !== -1;
          var label = isHaiku ? 'Claude Haiku' : isClaude ? 'Claude Sonnet' : isGeminiPro ? 'Gemini Pro' : isGemini ? 'Gemini Flash' : model;
```

- [ ] **Step 4: Manual smoke (browser)**

Open the CEO dashboard Dev View → AI Model Fleet panel. Confirm: four pills render (Sonnet / Haiku / Gemini Flash / Gemini Pro); clicking **Gemini Pro** highlights it and persists (reload → still highlighted); the AI Model status strip reads "Gemini Pro". Confirm via API:

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=systemConfig" \
  -H "x-company-secret: pixelpusher" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('heartbeatModel:', (JSON.parse(s).value||JSON.parse(s)).heartbeatModel))"
```
Expected: `heartbeatModel: gemini-pro`

- [ ] **Step 5: Commit**

```bash
git add modules/company/dashboard.html
git commit -m "feat(dashboard): add Gemini Pro model pill"
```

---

### Task 5: Deploy + live verification

**Files:** none (deploy + observe)

- [ ] **Step 1: Push to deploy**

```bash
git push origin master
```
(Triggers the GitHub Actions deploy of static + API.)

- [ ] **Step 2: Confirm the active model resolves to Pro**

After deploy completes, confirm the wrapper reports the new key:

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=systemConfig" \
  -H "x-company-secret: pixelpusher" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log((JSON.parse(s).value||JSON.parse(s)).heartbeatModel))"
```
Expected: `gemini-pro` (set it via the dashboard pill in Task 4, or POST it).

- [ ] **Step 3: Trigger a heartbeat and verify real throughput**

```bash
curl -sX POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-heartbeat-trigger" \
  -H "Content-Type: application/json" -H "x-company-secret: pixelpusher"
```

Wait ~60s, then check the latest run executed and is clean:

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=heartbeatRuns" \
  -H "x-company-secret: pixelpusher" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let a=(JSON.parse(s).value||JSON.parse(s));let r=a[a.length-1];console.log(JSON.stringify({t:r.finishedAt||r.startedAt,status:r.status,exec:(r.agentActions&&r.agentActions.executed),errs:(r.errors&&r.errors.length)||0},null,0))})"
```
Expected: `status: "ok"`, `exec` ≥ 1 (agents acting again), `errs: 0`.

- [ ] **Step 4: Confirm no envelope regressions + check for any fallback events**

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=governanceLog" \
  -H "x-company-secret: pixelpusher" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let g=(JSON.parse(s).value||JSON.parse(s));let recent=g.slice(-30);let fb=recent.filter(e=>e.type==='model-fallback');let env=recent.filter(e=>e.details&&e.details.gate==='output_envelope');console.log('model-fallback events:',fb.length, fb.slice(-3)); console.log('output_envelope violations (recent 30):',env.length)})"
```
Expected: `output_envelope` count low/zero on Pro. Any `model-fallback` events prove the chain + logging work end-to-end (Pro momentarily failing → backup answered, now visible instead of silent).

- [ ] **Step 5: Final commit (if any verification tweaks were needed)**

If steps 2-4 required no code changes, nothing to commit. Otherwise commit fixes with a descriptive message and re-run Task 3 Step 7 + Task 5 steps.

---

## Self-Review

**Spec coverage:**
- gemini-2.5-pro selectable → Task 2 (registry key) + Task 4 (pill). ✅
- Cross-provider fallback chain, deduped by model id → Task 2 (`buildChain`) + Task 3 (`_callWithFallback`). ✅
- Chain tables (pro→flash→sonnet, etc.) → Task 2 test asserts each. ✅
- Surface fallbacks to governanceLog via run-buffer logEvent → Task 1 (`currentCycleId`, governance type) + Task 3 (`_logFallback`). ✅
- Gemini path parameterized by model id → Task 3 Step 4. ✅
- `callWithModel` stays a hard pin → Task 3 Step 6 (left unchanged). ✅
- Dashboard pill + label → Task 4. ✅
- Non-goals (forced-JSON Claude path, per-agent routing, new providers) → not implemented, as specified. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. ✅

**Type/name consistency:** `providerOf`/`isClaudeModel`/`buildChain`/`runChain` exported from `model-registry.js` and consumed identically in `gemini.js` and the test. `currentCycleId` defined+exported in Task 1 and consumed in Task 3's `_logFallback`. `_callWithFallback` signature `(prompt, agentId, maxTokens, temperature, caller, structured)` matches both call sites. ✅
