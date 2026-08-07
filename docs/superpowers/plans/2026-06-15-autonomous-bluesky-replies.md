# Autonomous Bluesky Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-select 1–2 high-quality Bluesky threads/day worth replying to, auto-draft replies through the existing Scribe pipeline, and learn from CEO approve/edit/reject decisions and posted-reply engagement — while the CEO keeps the final approval gate.

**Architecture:** Trigger-replacement. After Scout's existing discovery writes `blueskyCandidates`, a new `reply-selection` step runs a deterministic pre-filter then an LLM fit/value/risk judge (Haiku, Gemini fallback) on the top candidates. Passing candidates become standard `bluesky_reply` tasks — identical to what the CEO's "Draft Reply" button creates — so Scribe → quality gate → approval queue → AT Protocol executor are all untouched. A feedback loop stamps selection features on decisions and outcome snapshots.

**Tech Stack:** Node.js (CommonJS) Azure Functions. No test framework — tests are standalone `node scripts/*.cjs` scripts using `node:assert` (matching `scripts/backtest-quality-gate.cjs`). Azure Blob state via `_utils/companyStorage` (`getState`/`setState`). LLM via `companyHeartbeat/gemini.js`.

**Spec:** `docs/superpowers/specs/2026-06-15-autonomous-bluesky-replies-design.md`

---

## File Structure

| File | New/Modify | Responsibility |
|---|---|---|
| `api/companyHeartbeat/reply-selection.js` | **New** | Pure functions (config resolve, pre-filter, verdict parse/pass, daily-cap, breaker, build task) + judge orchestration + `runReplySelection` orchestrator. Pure exports take no I/O so they're require-able offline; impure functions receive `storage` / `callWithFallback` as injected params (same pattern as `_utils/decisionLog.js`). |
| `api/companyHeartbeat/gemini.js` | Modify | Add exported `callWithFallback(prompt, agentId, opts)` — primary model then fallback model. |
| `api/companyHeartbeat/agent-runner.js` | Modify (~line 462) | After Scout's `setState('blueskyCandidates', ...)`, invoke `runReplySelection`. |
| `api/companyHeartbeat/reply-feedback.js` | **New** | Pure builders for the judge "recent decisions" block + Scribe "approved/edited examples" block; `recordReplyDecision` capture helper. |
| `api/actionsExecute/executors/_utils/outcomeBaseline.js` | Modify (~line 53-70) | Attach `selectionFeatures` to the reply's outcome snapshot. |
| `scripts/test-reply-selection.cjs` | **New** | Offline unit tests for the pure functions. |
| `scripts/test-callWithFallback.cjs` | **New** | Unit test for the fallback chain (stubbed callers). |

Phases: **Phase 1 (Tasks 1–6)** ships the working auto-draft loop end-to-end. **Phase 2 (Tasks 7–9)** adds the dual feedback loop + observability. Phase 1 is independently shippable and testable.

---

## PHASE 1 — Core auto-draft selection loop

### Task 1: LLM fallback helper in gemini.js

**Files:**
- Modify: `api/companyHeartbeat/gemini.js`
- Test: `scripts/test-callWithFallback.cjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-callWithFallback.cjs`. This test injects stub callers to verify ordering and fail-closed behavior. Since the real `callWithFallback` is wired to live APIs, we test a pure extraction `_fallbackChain(primary, fallback, callers)` that the exported function delegates to.

```js
'use strict';
const assert = require('assert');
const { _fallbackChain } = require('../api/companyHeartbeat/gemini');

(async () => {
  // primary succeeds -> fallback never called
  let calls = [];
  let r = await _fallbackChain('claude-haiku', 'gemini', {
    claude: async () => { calls.push('claude'); return 'PRIMARY_OK'; },
    gemini: async () => { calls.push('gemini'); return 'FALLBACK'; }
  });
  assert.strictEqual(r, 'PRIMARY_OK');
  assert.deepStrictEqual(calls, ['claude']);

  // primary fails (null) -> fallback used
  calls = [];
  r = await _fallbackChain('claude-haiku', 'gemini', {
    claude: async () => { calls.push('claude'); return null; },
    gemini: async () => { calls.push('gemini'); return 'FALLBACK_OK'; }
  });
  assert.strictEqual(r, 'FALLBACK_OK');
  assert.deepStrictEqual(calls, ['claude', 'gemini']);

  // both fail -> null (fail-closed)
  r = await _fallbackChain('claude-haiku', 'gemini', {
    claude: async () => null, gemini: async () => null
  });
  assert.strictEqual(r, null);

  // primary === fallback -> fallback skipped
  calls = [];
  r = await _fallbackChain('gemini', 'gemini', {
    claude: async () => 'X', gemini: async () => { calls.push('gemini'); return null; }
  });
  assert.strictEqual(r, null);
  assert.deepStrictEqual(calls, ['gemini']);

  console.log('test-callWithFallback: ALL PASS');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-callWithFallback.cjs`
Expected: throws `TypeError: _fallbackChain is not a function` (not yet exported).

- [ ] **Step 3: Implement `_fallbackChain` + `callWithFallback` in gemini.js**

In `api/companyHeartbeat/gemini.js`, add before `module.exports`:

```js
// ── LLM call with model fallback (reply-judge + future judges) ──
// Tries primary model; on null (any failure) tries fallback; null if both fail (fail-closed).
// `callers` lets tests inject stubs: { claude(modelKey), gemini() }.
async function _fallbackChain(primary, fallback, callers) {
  primary = (primary || 'claude-haiku').toLowerCase();
  fallback = (fallback || 'gemini').toLowerCase();
  var runPrimary = _isClaudeModel(primary) ? function () { return callers.claude(primary); } : callers.gemini;
  var out = await runPrimary();
  if (out !== null && out !== undefined) return out;
  if (fallback && fallback !== primary) {
    var runFallback = _isClaudeModel(fallback) ? function () { return callers.claude(fallback); } : callers.gemini;
    out = await runFallback();
  }
  return (out === undefined) ? null : out;
}

async function callWithFallback(prompt, agentId, opts) {
  opts = opts || {};
  var maxTokens = opts.maxTokens || 800;
  var temp = (typeof opts.temperature === 'number') ? opts.temperature : 0.4;
  return _fallbackChain(opts.model || 'claude-haiku', opts.fallbackModel || 'gemini', {
    claude: function (modelKey) { return _callClaude(prompt, agentId, maxTokens, modelKey); },
    gemini: function () { return _callGeminiRaw(prompt, agentId, maxTokens, temp, 'reply-judge', false); }
  });
}
```

Update the exports line:

```js
module.exports = { callGemini, callGeminiExecute, getActiveModel, callWithFallback, _fallbackChain };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-callWithFallback.cjs`
Expected: `test-callWithFallback: ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/gemini.js scripts/test-callWithFallback.cjs
git commit -m "feat(heartbeat): add callWithFallback LLM helper (Haiku->Gemini, fail-closed)"
```

---

### Task 2: reply-selection pure functions

**Files:**
- Create: `api/companyHeartbeat/reply-selection.js`
- Test: `scripts/test-reply-selection.cjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-reply-selection.cjs`:

```js
'use strict';
const assert = require('assert');
const RS = require('../api/companyHeartbeat/reply-selection');

const NOW = Date.parse('2026-06-15T12:00:00Z');
const freshIso = new Date(NOW - 30 * 60000).toISOString(); // 30 min old

function cand(over) {
  return Object.assign({
    id: 'bsc-1', uri: 'at://did:plc:x/app.bsky.feed.post/abc', cid: 'cid1',
    author: 'someone.bsky.social', text: 'Building AI agents and failure modes.',
    indexedAt: freshIso, replyCount: 3, likeCount: 10, score: 70, status: 'new',
    matchedKeyword: 'AI agents'
  }, over || {});
}

// resolveConfig: defaults + override merge
const cfg = RS.resolveConfig({ autoReply: { heatThreshold: 60, maxPerDay: 1 } });
assert.strictEqual(cfg.heatThreshold, 60);
assert.strictEqual(cfg.maxPerDay, 1);
assert.strictEqual(cfg.fitThreshold, 60);        // default kept
assert.strictEqual(cfg.fallbackModel, 'gemini'); // default kept

// prefilterCandidate: eligible
let r = RS.prefilterCandidate(cand(), { cfg: RS.resolveConfig({}), now: NOW, existingReplyUris: new Set(), repliedAuthors: {}, selfHandles: [] });
assert.strictEqual(r.eligible, true, JSON.stringify(r.reasons));

// below heat
r = RS.prefilterCandidate(cand({ score: 40 }), { cfg: RS.resolveConfig({}), now: NOW, existingReplyUris: new Set(), repliedAuthors: {}, selfHandles: [] });
assert.deepStrictEqual(r.reasons, ['below-heat']);

// too old
r = RS.prefilterCandidate(cand({ indexedAt: new Date(NOW - 48 * 3600000).toISOString() }), { cfg: RS.resolveConfig({}), now: NOW, existingReplyUris: new Set(), repliedAuthors: {}, selfHandles: [] });
assert.deepStrictEqual(r.reasons, ['too-old']);

// too crowded
r = RS.prefilterCandidate(cand({ replyCount: 99 }), { cfg: RS.resolveConfig({}), now: NOW, existingReplyUris: new Set(), repliedAuthors: {}, selfHandles: [] });
assert.deepStrictEqual(r.reasons, ['too-crowded']);

// already drafted (uri in set)
r = RS.prefilterCandidate(cand(), { cfg: RS.resolveConfig({}), now: NOW, existingReplyUris: new Set(['at://did:plc:x/app.bsky.feed.post/abc']), repliedAuthors: {}, selfHandles: [] });
assert.deepStrictEqual(r.reasons, ['already-drafted']);

// author cooldown
r = RS.prefilterCandidate(cand(), { cfg: RS.resolveConfig({}), now: NOW, existingReplyUris: new Set(), repliedAuthors: { 'someone.bsky.social': NOW - 2 * 86400000 }, selfHandles: [] });
assert.deepStrictEqual(r.reasons, ['author-cooldown']);

// self account
r = RS.prefilterCandidate(cand(), { cfg: RS.resolveConfig({}), now: NOW, existingReplyUris: new Set(), repliedAuthors: {}, selfHandles: ['someone.bsky.social'] });
assert.deepStrictEqual(r.reasons, ['self-account']);

// parseJudgeVerdict: valid JSON with surrounding prose
let v = RS.parseJudgeVerdict('Sure: {"reply_worthy": true, "fit_score": 80, "value_score": 75, "risk": "low", "angle": "share our QG lesson", "reason": "on-topic"}');
assert.strictEqual(v.reply_worthy, true);
assert.strictEqual(v.fit_score, 80);
assert.strictEqual(v.risk, 'low');

// parseJudgeVerdict: malformed -> null
assert.strictEqual(RS.parseJudgeVerdict('no json here'), null);
// parseJudgeVerdict: unknown risk -> defaults to 'high' (safe)
assert.strictEqual(RS.parseJudgeVerdict('{"reply_worthy":true,"fit_score":90,"value_score":90,"risk":"banana"}').risk, 'high');

// verdictPasses
const dcfg = RS.resolveConfig({});
assert.strictEqual(RS.verdictPasses({ reply_worthy: true, fit_score: 60, value_score: 60, risk: 'low' }, dcfg), true);
assert.strictEqual(RS.verdictPasses({ reply_worthy: true, fit_score: 59, value_score: 60, risk: 'low' }, dcfg), false);
assert.strictEqual(RS.verdictPasses({ reply_worthy: true, fit_score: 90, value_score: 90, risk: 'high' }, dcfg), false);
assert.strictEqual(RS.verdictPasses({ reply_worthy: false, fit_score: 90, value_score: 90, risk: 'low' }, dcfg), false);

// countTodayAutoDrafts
const tasks = [
  { tags: ['bluesky-reply', 'auto-selected'], createdAt: new Date(NOW - 1 * 3600000).toISOString() }, // today
  { tags: ['bluesky-reply', 'auto-selected'], createdAt: new Date(NOW - 48 * 3600000).toISOString() }, // yesterday-ish
  { tags: ['bluesky-reply'], createdAt: new Date(NOW).toISOString() } // manual (no auto-selected)
];
assert.strictEqual(RS.countTodayAutoDrafts(tasks, NOW), 1);

// rejectBreakerTripped
const decisions = [
  { decisionType: 'reply-selection', after: { ceoDecision: 'rejected' }, timestamp: new Date(NOW - 1 * 86400000).toISOString() },
  { decisionType: 'reply-selection', after: { ceoDecision: 'rejected' }, timestamp: new Date(NOW - 2 * 86400000).toISOString() },
  { decisionType: 'reply-selection', after: { ceoDecision: 'rejected' }, timestamp: new Date(NOW - 3 * 86400000).toISOString() }
];
assert.strictEqual(RS.rejectBreakerTripped(decisions, dcfg, NOW), true);
assert.strictEqual(RS.rejectBreakerTripped(decisions.slice(0, 2), dcfg, NOW), false);

// buildReplyTask
const task = RS.buildReplyTask(cand(), { angle: 'share QG lesson', fit_score: 80, value_score: 75, risk: 'low' }, NOW);
assert.strictEqual(task.taskType, 'bluesky_reply');
assert.strictEqual(task.assignee, 'scribe');
assert.ok(task.tags.indexOf('bluesky-reply') !== -1 && task.tags.indexOf('auto-selected') !== -1);
assert.strictEqual(task.threadContext.uri, cand().uri);
assert.strictEqual(task.threadContext.originalText, cand().text);
assert.strictEqual(task.requires_ceo_approval, true);
assert.ok(task.description.indexOf('share QG lesson') !== -1);

console.log('test-reply-selection: ALL PASS');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-reply-selection.cjs`
Expected: `Cannot find module '../api/companyHeartbeat/reply-selection'`

- [ ] **Step 3: Implement the pure functions**

Create `api/companyHeartbeat/reply-selection.js`:

```js
'use strict';
// reply-selection.js — autonomous Bluesky reply selection (auto-draft, CEO approves).
// Spec: docs/superpowers/specs/2026-06-15-autonomous-bluesky-replies-design.md
//
// Pure functions take no I/O and are require-able offline (tested by
// scripts/test-reply-selection.cjs). Impure helpers (judgeCandidate, runReplySelection)
// receive `storage` / `callWithFallback` as injected params — same pattern as
// _utils/decisionLog.js — so they never pull node-fetch into the test surface.

var DEFAULTS = {
  enabled: false,
  maxPerDay: 2,
  heatThreshold: 55,
  fitThreshold: 60,
  valueThreshold: 60,
  perAuthorCooldownDays: 14,
  maxAgeHours: 24,
  maxReplyCount: 50,
  rejectBreakerCount: 3,
  rejectBreakerWindowDays: 7,
  model: 'claude-haiku',
  fallbackModel: 'gemini'
};

// Our own accounts — never reply to ourselves. Extend as needed.
var SELF_HANDLES = ['ambientpixels.bsky.social'];

function resolveConfig(systemConfig) {
  var c = (systemConfig && systemConfig.autoReply) || {};
  var out = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    out[k] = (c[k] !== undefined && c[k] !== null) ? c[k] : DEFAULTS[k];
  });
  return out;
}

function prefilterCandidate(candidate, opts) {
  opts = opts || {};
  var cfg = opts.cfg || DEFAULTS;
  var now = opts.now || Date.now();
  var reasons = [];
  if (!candidate || !candidate.uri || !candidate.cid || !candidate.text) { reasons.push('missing-fields'); return { eligible: false, reasons: reasons }; }
  if (candidate.status !== 'new') reasons.push('not-new');
  if (typeof candidate.score === 'number' && candidate.score < cfg.heatThreshold) reasons.push('below-heat');
  var idx = candidate.indexedAt ? new Date(candidate.indexedAt).getTime() : 0;
  if (!idx || (now - idx) > cfg.maxAgeHours * 3600000) reasons.push('too-old');
  if (typeof candidate.replyCount === 'number' && candidate.replyCount >= cfg.maxReplyCount) reasons.push('too-crowded');
  if (opts.existingReplyUris && opts.existingReplyUris.has(candidate.uri)) reasons.push('already-drafted');
  var author = candidate.author;
  if (author && opts.repliedAuthors && opts.repliedAuthors[author] &&
      (now - opts.repliedAuthors[author]) < cfg.perAuthorCooldownDays * 86400000) reasons.push('author-cooldown');
  if (author && opts.selfHandles && opts.selfHandles.indexOf(author) !== -1) reasons.push('self-account');
  return { eligible: reasons.length === 0, reasons: reasons };
}

function parseJudgeVerdict(text) {
  if (!text) return null;
  var m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  var v;
  try { v = JSON.parse(m[0]); } catch (_e) { return null; }
  if (!v || typeof v !== 'object') return null;
  return {
    reply_worthy: v.reply_worthy === true,
    fit_score: Number(v.fit_score) || 0,
    value_score: Number(v.value_score) || 0,
    risk: (['none', 'low', 'med', 'high'].indexOf(v.risk) !== -1) ? v.risk : 'high',
    angle: (v.angle || '').toString().slice(0, 200),
    reason: (v.reason || '').toString().slice(0, 300)
  };
}

function verdictPasses(verdict, cfg) {
  if (!verdict) return false;
  cfg = cfg || DEFAULTS;
  return verdict.reply_worthy === true &&
    verdict.fit_score >= cfg.fitThreshold &&
    verdict.value_score >= cfg.valueThreshold &&
    (verdict.risk === 'none' || verdict.risk === 'low');
}

function countTodayAutoDrafts(tasks, now) {
  now = now || Date.now();
  var sod = new Date(now); sod.setUTCHours(0, 0, 0, 0);
  var sodMs = sod.getTime();
  if (!Array.isArray(tasks)) return 0;
  return tasks.filter(function (t) {
    if (!t || !Array.isArray(t.tags)) return false;
    if (t.tags.indexOf('bluesky-reply') === -1 || t.tags.indexOf('auto-selected') === -1) return false;
    var c = t.createdAt ? new Date(t.createdAt).getTime() : 0;
    return c >= sodMs;
  }).length;
}

function rejectBreakerTripped(decisions, cfg, now) {
  cfg = cfg || DEFAULTS; now = now || Date.now();
  if (!Array.isArray(decisions)) return false;
  var cutoff = now - cfg.rejectBreakerWindowDays * 86400000;
  var n = 0;
  for (var i = 0; i < decisions.length; i++) {
    var d = decisions[i];
    if (!d || d.decisionType !== 'reply-selection') continue;
    if (!d.after || d.after.ceoDecision !== 'rejected') continue;
    var ts = Date.parse(d.timestamp || 0);
    if (Number.isFinite(ts) && ts >= cutoff) n++;
  }
  return n >= cfg.rejectBreakerCount;
}

function buildReplyTask(candidate, verdict, now) {
  now = now || Date.now();
  var iso = new Date(now).toISOString();
  return {
    id: 'task-' + now + '-' + Math.random().toString(36).substr(2, 4),
    title: 'Bluesky reply to @' + candidate.author,
    description: 'Auto-selected reply candidate. Suggested angle: ' + (verdict.angle || '(none)') +
      '\n\nOriginal post: "' + (candidate.text || '').slice(0, 280) + '"',
    taskType: 'bluesky_reply',
    status: 'todo',
    priority: 'medium',
    assignee: 'scribe',
    division: null,
    tags: ['bluesky-reply', 'auto-selected'],
    threadContext: { uri: candidate.uri, cid: candidate.cid, author: candidate.author, originalText: candidate.text },
    dueDate: null,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null,
    comments: [],
    source: 'auto-reply-selection',
    created_by: 'scout',
    parent_task_id: null,
    requires_ceo_approval: true,
    risk_level: 'low',
    budget_impact: 0,
    brand_impact: 'low',
    escalated: true,
    classification: 'advisory',
    campaign_id: null,
    objective_id: null,
    _candidateId: candidate.id,
    _selectionFeatures: {
      score: candidate.score, fit: verdict.fit_score, value: verdict.value_score,
      risk: verdict.risk, angle: verdict.angle, matchedKeyword: candidate.matchedKeyword || null
    }
  };
}

module.exports = {
  DEFAULTS: DEFAULTS,
  SELF_HANDLES: SELF_HANDLES,
  resolveConfig: resolveConfig,
  prefilterCandidate: prefilterCandidate,
  parseJudgeVerdict: parseJudgeVerdict,
  verdictPasses: verdictPasses,
  countTodayAutoDrafts: countTodayAutoDrafts,
  rejectBreakerTripped: rejectBreakerTripped,
  buildReplyTask: buildReplyTask
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-reply-selection.cjs`
Expected: `test-reply-selection: ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/reply-selection.js scripts/test-reply-selection.cjs
git commit -m "feat(reply-selection): pure functions (prefilter, verdict, cap, breaker, buildTask)"
```

---

### Task 3: The judge prompt + judgeCandidate

**Files:**
- Modify: `api/companyHeartbeat/reply-selection.js`

- [ ] **Step 1: Add `buildJudgePrompt` (pure) and a test for it**

Append to `scripts/test-reply-selection.cjs` before the final `console.log`:

```js
// buildJudgePrompt includes the post text, the never-reply rules, and asks for JSON
const jp = RS.buildJudgePrompt(cand(), 'AmbientOS facts here', ['no em dashes', 'lowercase casual']);
assert.ok(jp.indexOf('Building AI agents') !== -1, 'prompt includes post text');
assert.ok(/never reply/i.test(jp), 'prompt includes never-reply rules');
assert.ok(/reply_worthy/.test(jp) && /fit_score/.test(jp), 'prompt asks for the verdict schema');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-reply-selection.cjs`
Expected: FAIL — `RS.buildJudgePrompt is not a function`

- [ ] **Step 3: Implement `buildJudgePrompt` + `judgeCandidate`**

Add to `reply-selection.js` (before `module.exports`):

```js
function buildJudgePrompt(candidate, groundingText, voicePrinciples) {
  var voice = Array.isArray(voicePrinciples) ? voicePrinciples.join('; ') : '';
  return [
    'You are the reply-selection judge for AmbientPixels (an AI-agent company building in public).',
    'Decide whether the founder brand should reply to ONE Bluesky post. Quality over quantity — we reply 1-2x/day.',
    '',
    'NEVER recommend a reply (set reply_worthy=false, risk="high") if the post is:',
    '- political, controversial, or a negativity/drama pile-on',
    '- a competitor promoting their product',
    '- engagement-bait, spam, or low-effort',
    '- a place where we would only say "great post!" (no value to add)',
    '',
    'A good reply target is on-topic for us (AI agents, building in public, solo-founder/indie-hacker tooling)',
    'AND a place where we can add a genuinely useful, specific, builder-to-builder point.',
    '',
    'OUR CONTEXT (for grounding — do not invent facts beyond this):',
    String(groundingText || '').slice(0, 4000),
    '',
    voice ? ('OUR VOICE: ' + voice) : '',
    '',
    'THE POST:',
    '@' + (candidate.author || 'unknown') + ': "' + (candidate.text || '').slice(0, 500) + '"',
    '(replies so far: ' + (candidate.replyCount || 0) + ', likes: ' + (candidate.likeCount || 0) + ')',
    '',
    'Respond with ONLY this JSON (no prose):',
    '{"reply_worthy": <bool>, "fit_score": <0-100>, "value_score": <0-100>, "risk": "none|low|med|high", "angle": "<one-line reply angle for our writer>", "reason": "<short why>"}'
  ].join('\n');
}

// Impure: deps = { callWithFallback, cfg, groundingText, voicePrinciples }
async function judgeCandidate(candidate, deps) {
  var prompt = buildJudgePrompt(candidate, deps.groundingText, deps.voicePrinciples);
  var text = await deps.callWithFallback(prompt, 'scout-reply-judge', {
    model: deps.cfg.model, fallbackModel: deps.cfg.fallbackModel, maxTokens: 400, temperature: 0.3
  });
  if (text === null || text === undefined) return null; // both models failed -> fail-closed (skip)
  return parseJudgeVerdict(text);
}
```

Add `buildJudgePrompt: buildJudgePrompt,` and `judgeCandidate: judgeCandidate,` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-reply-selection.cjs`
Expected: `test-reply-selection: ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/reply-selection.js scripts/test-reply-selection.cjs
git commit -m "feat(reply-selection): LLM fit/value/risk judge prompt + judgeCandidate"
```

---

### Task 4: runReplySelection orchestrator

**Files:**
- Modify: `api/companyHeartbeat/reply-selection.js`

- [ ] **Step 1: Implement `runReplySelection` (impure orchestrator)**

This ties the pure functions together. It receives `storage`, `callWithFallback`, and a logger so it stays free of direct requires that would complicate testing. Add to `reply-selection.js`:

```js
// Orchestrator. deps = { storage, callWithFallback, log, productFacts, voicePrinciples, now }
// Returns a summary object for logging/observability. Never throws — selection failure
// must not break the heartbeat.
async function runReplySelection(deps) {
  var log = deps.log || function () {};
  var now = deps.now || Date.now();
  var summary = { considered: 0, eligible: 0, judged: 0, passed: 0, drafted: 0, skippedReason: null };
  try {
    var systemConfig = (await deps.storage.getState('systemConfig')) || {};
    var cfg = resolveConfig(systemConfig);
    if (!cfg.enabled) { summary.skippedReason = 'disabled'; return summary; }

    var execMode = (await deps.storage.getState('execution_mode')) || 'active';
    if (execMode !== 'active') { summary.skippedReason = 'execution_mode:' + execMode; return summary; }

    var candidates = (await deps.storage.getState('blueskyCandidates')) || [];
    var tasks = (await deps.storage.getState('tasks')) || [];
    var decisions = (await deps.storage.getState('agentDecisions')) || [];
    if (!Array.isArray(candidates) || !Array.isArray(tasks)) { summary.skippedReason = 'state-shape'; return summary; }

    if (rejectBreakerTripped(decisions, cfg, now)) {
      summary.skippedReason = 'reject-breaker';
      // self-disable + AQ note (idempotent: only if still enabled)
      try {
        systemConfig.autoReply = Object.assign({}, systemConfig.autoReply, { enabled: false, disabledBy: 'reject-breaker', disabledAt: new Date(now).toISOString() });
        await deps.storage.setState('systemConfig', systemConfig);
        var aq = (await deps.storage.getState('approvalQueue')) || [];
        if (Array.isArray(aq)) {
          aq.push({ id: 'aq-autoreply-breaker-' + now, kind: 'system_note', status: 'pending', submittedAt: new Date(now).toISOString(),
            preview: 'Auto-reply selection self-disabled: ' + cfg.rejectBreakerCount + '+ auto-drafted replies rejected in ' + cfg.rejectBreakerWindowDays + 'd. Selection bar needs tuning before re-enabling.' });
          await deps.storage.setState('approvalQueue', aq);
        }
      } catch (_e) {}
      return summary;
    }

    var alreadyToday = countTodayAutoDrafts(tasks, now);
    var budget = cfg.maxPerDay - alreadyToday;
    if (budget <= 0) { summary.skippedReason = 'daily-cap'; return summary; }

    // Build pre-filter context from current tasks
    var existingReplyUris = new Set();
    var repliedAuthors = {};
    tasks.forEach(function (t) {
      if (t && t.threadContext && t.threadContext.uri) existingReplyUris.add(t.threadContext.uri);
      if (t && Array.isArray(t.tags) && t.tags.indexOf('bluesky-reply') !== -1 && t.threadContext && t.threadContext.author) {
        var ts = t.createdAt ? new Date(t.createdAt).getTime() : 0;
        if (!repliedAuthors[t.threadContext.author] || ts > repliedAuthors[t.threadContext.author]) repliedAuthors[t.threadContext.author] = ts;
      }
    });

    // Pre-filter, then sort eligible by heat score desc, take top 5 for judging
    var eligible = [];
    candidates.forEach(function (c) {
      summary.considered++;
      var pf = prefilterCandidate(c, { cfg: cfg, now: now, existingReplyUris: existingReplyUris, repliedAuthors: repliedAuthors, selfHandles: SELF_HANDLES });
      if (pf.eligible) eligible.push(c);
    });
    summary.eligible = eligible.length;
    eligible.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var topN = eligible.slice(0, 5);

    var groundingText = '';
    try { groundingText = JSON.stringify(deps.productFacts || {}); } catch (_e) {}

    for (var i = 0; i < topN.length && summary.drafted < budget; i++) {
      var c = topN[i];
      summary.judged++;
      var verdict = await judgeCandidate(c, { callWithFallback: deps.callWithFallback, cfg: cfg, groundingText: groundingText, voicePrinciples: deps.voicePrinciples });
      if (!verdictPasses(verdict, cfg)) { log('[reply-selection] skip ' + c.id + ' verdict=' + JSON.stringify(verdict)); continue; }
      summary.passed++;
      var task = buildReplyTask(c, verdict, now);
      tasks.push(task);
      // mark candidate so Scout discovery dedup + the dashboard see it as engaged
      c.status = 'replied';
      summary.drafted++;
      log('[reply-selection] drafted reply task ' + task.id + ' for @' + c.author + ' (fit=' + verdict.fit_score + ' value=' + verdict.value_score + ')');
    }

    if (summary.drafted > 0) {
      await deps.storage.setState('tasks', tasks);
      await deps.storage.setState('blueskyCandidates', candidates);
    }
  } catch (e) {
    summary.skippedReason = 'error:' + (e && e.message);
    log('[reply-selection] error: ' + (e && e.message));
  }
  return summary;
}
```

Add `runReplySelection: runReplySelection,` to `module.exports`.

- [ ] **Step 2: Smoke-test the orchestrator with an in-memory storage stub**

Create `scripts/test-reply-selection-run.cjs`:

```js
'use strict';
const assert = require('assert');
const RS = require('../api/companyHeartbeat/reply-selection');
const NOW = Date.parse('2026-06-15T12:00:00Z');

function makeStorage(state) {
  return {
    getState: async (k) => state[k],
    setState: async (k, v) => { state[k] = v; }
  };
}
const fresh = new Date(NOW - 20 * 60000).toISOString();

(async () => {
  // disabled by default
  let state = { systemConfig: {}, execution_mode: 'active', blueskyCandidates: [], tasks: [], agentDecisions: [] };
  let s = await RS.runReplySelection({ storage: makeStorage(state), callWithFallback: async () => null, now: NOW });
  assert.strictEqual(s.skippedReason, 'disabled');

  // enabled, one good candidate, judge passes -> 1 draft
  state = {
    systemConfig: { autoReply: { enabled: true, maxPerDay: 2 } },
    execution_mode: 'active',
    blueskyCandidates: [{ id: 'bsc-1', uri: 'at://x/p/1', cid: 'c1', author: 'a.bsky.social', text: 'AI agents and failure modes', indexedAt: fresh, replyCount: 2, likeCount: 5, score: 80, status: 'new', matchedKeyword: 'AI agents' }],
    tasks: [], agentDecisions: []
  };
  s = await RS.runReplySelection({
    storage: makeStorage(state), now: NOW,
    callWithFallback: async () => '{"reply_worthy":true,"fit_score":85,"value_score":80,"risk":"low","angle":"share our QG lesson","reason":"on-topic"}'
  });
  assert.strictEqual(s.drafted, 1, JSON.stringify(s));
  assert.strictEqual(state.tasks.length, 1);
  assert.strictEqual(state.tasks[0].taskType, 'bluesky_reply');
  assert.strictEqual(state.blueskyCandidates[0].status, 'replied');

  // both LLMs fail -> fail-closed, 0 drafts
  state.tasks = []; state.blueskyCandidates[0].status = 'new';
  s = await RS.runReplySelection({ storage: makeStorage(state), now: NOW, callWithFallback: async () => null });
  assert.strictEqual(s.drafted, 0);

  // execution_mode frozen -> skip
  state = { systemConfig: { autoReply: { enabled: true } }, execution_mode: 'frozen', blueskyCandidates: [], tasks: [], agentDecisions: [] };
  s = await RS.runReplySelection({ storage: makeStorage(state), now: NOW, callWithFallback: async () => null });
  assert.strictEqual(s.skippedReason, 'execution_mode:frozen');

  console.log('test-reply-selection-run: ALL PASS');
})();
```

- [ ] **Step 3: Run it**

Run: `node scripts/test-reply-selection-run.cjs`
Expected: `test-reply-selection-run: ALL PASS`

- [ ] **Step 4: Commit**

```bash
git add api/companyHeartbeat/reply-selection.js scripts/test-reply-selection-run.cjs
git commit -m "feat(reply-selection): runReplySelection orchestrator (enabled/mode/breaker/cap gates)"
```

---

### Task 5: Wire runReplySelection into Scout's discovery handler

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (immediately after the Scout `setState('blueskyCandidates', ...)` near line 462)

- [ ] **Step 1: Locate the insertion point**

In `agent-runner.js`, find (≈line 462):

```js
      await storage.setState('blueskyCandidates', _bsCandidates);
      context.log('[Heartbeat] scout: bluesky discovery complete.', _bsNewCount, 'new candidates added,', _bsCandidates.length, 'total stored');
```

- [ ] **Step 2: Add the require at the top of agent-runner.js**

Find the existing requires near the top of the file (where `_blueskyDiscovery` is required) and add alongside them:

```js
var _replySelection = require('./reply-selection');
var _gemini = require('./gemini');
var _productFacts = (function () { try { return require('../_data/product-facts.json'); } catch (_e) { return {}; } })();
var _founderVoice = (function () { try { return require('../_data/founder-voice-examples.json'); } catch (_e) { return { principles: [] }; } })();
```

(If `./gemini` is already required under another name in this file, reuse that name instead of adding `_gemini`.)

- [ ] **Step 3: Invoke selection after candidates are stored**

Immediately after the two lines from Step 1, add:

```js
      // ── Autonomous reply selection (auto-draft, CEO approves) ──
      // Ships dark: no-ops unless systemConfig.autoReply.enabled === true.
      try {
        var _rsSummary = await _replySelection.runReplySelection({
          storage: storage,
          callWithFallback: _gemini.callWithFallback,
          log: context.log,
          productFacts: _productFacts,
          voicePrinciples: (_founderVoice && _founderVoice.principles) || []
        });
        context.log('[Heartbeat] scout: reply-selection', JSON.stringify(_rsSummary));
      } catch (_rsErr) {
        context.log('[Heartbeat] scout: reply-selection failed (non-fatal):', _rsErr && _rsErr.message);
      }
```

- [ ] **Step 4: Verify the module loads (no syntax errors)**

Run: `node -e "require('./api/companyHeartbeat/agent-runner.js'); console.log('agent-runner loads OK')"`
Expected: `agent-runner loads OK` (or a known unrelated warning — but NO SyntaxError and NO "Cannot find module './reply-selection'").

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "feat(heartbeat): invoke reply-selection after Scout bluesky discovery"
```

---

### Task 6: Phase 1 live verification (ships dark; turn on to test)

**Files:** none (operational verification)

- [ ] **Step 1: Confirm it no-ops while disabled**

After deploy (`git push origin master`), trigger a heartbeat and confirm selection ran but did nothing:

```bash
curl -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-heartbeat-trigger" \
  -H "Content-Type: application/json" -H "x-company-secret: pixelpusher"
```
Expected in the run's Scout log line: `reply-selection {"considered":...,"skippedReason":"disabled"...}`

- [ ] **Step 2: Enable with a tight config**

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=systemConfig" \
  -H "x-company-secret: pixelpusher" -o /tmp/sc.json
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("/tmp/sc.json"));const v=j.value||j;v.autoReply={enabled:true,maxPerDay:1,heatThreshold:55,fitThreshold:60,valueThreshold:60,perAuthorCooldownDays:14,model:"claude-haiku",fallbackModel:"gemini"};fs.writeFileSync("/tmp/scb.json",JSON.stringify({key:"systemConfig",value:v}));'
curl -sX POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-state" \
  -H "x-company-secret: pixelpusher" -H "Content-Type: application/json" --data @/tmp/scb.json
```

- [ ] **Step 3: Trigger + verify a draft appears**

Trigger the heartbeat again. Confirm a `bluesky_reply` task with tags `['bluesky-reply','auto-selected']` was created and a `bluesky_reply` entry shows in the approval queue with the original post in the drawer. Expected Scout log: `reply-selection {"drafted":1,...}`.

- [ ] **Step 4: Commit (no code; note the live result in the plan checkbox)**

No commit. Record the verification outcome in the PR/handoff.

---

## PHASE 2 — Dual feedback loop + observability

### Task 7: Signal 1 — capture CEO decisions on auto-drafted replies

**Files:**
- Create: `api/companyHeartbeat/reply-feedback.js`
- Modify: `api/companyHeartbeat/agent-runner.js` (Scout block, after `runReplySelection`)

The capture runs each cycle as a reconciler: scan `social_post.reply` actions linked to an `auto-selected` task whose approval status is now decided but not yet logged, and append a `reply-selection` decision (with the edited text diff when present). Reuses `_utils/decisionLog.appendDecision`.

- [ ] **Step 1: Implement `recordReplyDecisions` (pure-ish, storage injected)**

Create `api/companyHeartbeat/reply-feedback.js`:

```js
'use strict';
// reply-feedback.js — Signal 1 (CEO decisions) + prompt-block builders for the
// autonomous reply learning loop. Spec: 2026-06-15-autonomous-bluesky-replies-design.md
var decisionLog = require('./_utils/decisionLog');

// Reconcile decided reply actions into agentDecisions. Idempotent: a `_replyDecisionLogged`
// flag on the action prevents double-logging across cycles.
async function recordReplyDecisions(storage, now) {
  now = now || Date.now();
  var logged = 0;
  try {
    var actions = (await storage.getState('actions')) || [];
    var tasks = (await storage.getState('tasks')) || [];
    if (!Array.isArray(actions)) return { logged: 0 };
    var taskById = {};
    tasks.forEach(function (t) { if (t && t.id) taskById[t.id] = t; });
    var dirty = false;
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (!a || a.type !== 'social_post.reply' || a._replyDecisionLogged) continue;
      var parent = a._parentTaskId && taskById[a._parentTaskId];
      if (!parent || !Array.isArray(parent.tags) || parent.tags.indexOf('auto-selected') === -1) continue;
      var decision = (a.approval && (a.approval.decision || a.approval.status)) || null;
      if (!decision || ['pending'].indexOf(decision) !== -1) continue; // not decided yet
      var ceoDecision = (decision === 'approved') ? 'approved' : (decision === 'rejected' || decision === 'ceo-rejected') ? 'rejected' : decision;
      // edited-then-approved detection: action carries edited copy distinct from the original draft
      var posted = (a.payload && a.payload.text) || '';
      var original = (a._originalDraft != null) ? a._originalDraft : posted;
      var edited = ceoDecision === 'approved' && original && posted && original.trim() !== posted.trim();
      await decisionLog.appendDecision(storage, {
        decisionType: 'reply-selection',
        agentId: 'scout',
        contextActionId: a.id,
        contextTaskId: a._parentTaskId,
        before: { features: (parent._selectionFeatures || null), draft: original, originalPost: (parent.threadContext && parent.threadContext.originalText) || '' },
        after: { ceoDecision: edited ? 'edited-approved' : ceoDecision, postedText: posted },
        reasoning: 'reply ' + ceoDecision + (edited ? ' (CEO edited the draft)' : '')
      });
      a._replyDecisionLogged = true; dirty = true; logged++;
    }
    if (dirty) await storage.setState('actions', actions);
  } catch (_e) { /* non-fatal */ }
  return { logged: logged };
}

module.exports = { recordReplyDecisions: recordReplyDecisions };
```

- [ ] **Step 2: Test it with a storage stub**

Create `scripts/test-reply-feedback.cjs`:

```js
'use strict';
const assert = require('assert');
const RF = require('../api/companyHeartbeat/reply-feedback');
function makeStorage(state){return{getState:async k=>state[k],setState:async(k,v)=>{state[k]=v;}};}

(async () => {
  const state = {
    tasks: [{ id: 'task-1', tags: ['bluesky-reply','auto-selected'], _selectionFeatures: { fit: 80 }, threadContext: { originalText: 'orig' } }],
    actions: [{ id: 'act-1', type: 'social_post.reply', _parentTaskId: 'task-1', _originalDraft: 'hello', payload: { text: 'hello edited' }, approval: { status: 'approved' } }],
    agentDecisions: []
  };
  let r = await RF.recordReplyDecisions(makeStorage(state), Date.now());
  assert.strictEqual(r.logged, 1);
  assert.strictEqual(state.agentDecisions.length, 1);
  assert.strictEqual(state.agentDecisions[0].after.ceoDecision, 'edited-approved');
  assert.strictEqual(state.actions[0]._replyDecisionLogged, true);
  // idempotent: second pass logs nothing
  r = await RF.recordReplyDecisions(makeStorage(state), Date.now());
  assert.strictEqual(r.logged, 0);
  console.log('test-reply-feedback: ALL PASS');
})();
```

- [ ] **Step 3: Run it**

Run: `node scripts/test-reply-feedback.cjs`
Expected: `test-reply-feedback: ALL PASS`

- [ ] **Step 4: Wire `recordReplyDecisions` into the Scout block**

In `agent-runner.js`, in the Scout block right before the `runReplySelection` call, add:

```js
      try { await require('./reply-feedback').recordReplyDecisions(storage, Date.now()); } catch (_e) {}
```

Also: in the Scribe `bluesky_reply` drafter (≈line 1903, where `_replyAction` is built), add `_originalDraft: _finalReply,` to the action object so edit-detection has a baseline.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/reply-feedback.js scripts/test-reply-feedback.cjs api/companyHeartbeat/agent-runner.js
git commit -m "feat(reply-feedback): capture CEO approve/edit/reject decisions on auto-drafted replies"
```

---

### Task 8: Feed decisions into the judge + Scribe prompts

**Files:**
- Modify: `api/companyHeartbeat/reply-feedback.js` (add `buildDecisionBlock`)
- Modify: `api/companyHeartbeat/reply-selection.js` (`judgeCandidate` includes the block)
- Modify: `api/companyHeartbeat/prompt-builders.js` (Scribe reply drafting — inject approved/edited examples)

- [ ] **Step 1: Add `buildDecisionBlock(decisions, limit)` to reply-feedback.js**

```js
// Compact "what the CEO approved vs rejected replies to" block for prompts.
function buildDecisionBlock(decisions, limit) {
  limit = limit || 5;
  if (!Array.isArray(decisions)) return '';
  var rel = decisions.filter(function (d) { return d && d.decisionType === 'reply-selection' && d.after; }).slice(-limit * 2);
  var approved = rel.filter(function (d) { return /approved/.test(d.after.ceoDecision || ''); }).slice(-limit);
  var rejected = rel.filter(function (d) { return d.after.ceoDecision === 'rejected'; }).slice(-limit);
  if (!approved.length && !rejected.length) return '';
  var lines = ['RECENT REPLY DECISIONS (learn from these):'];
  approved.forEach(function (d) { lines.push('  APPROVED reply to: "' + ((d.before && d.before.originalPost) || '').slice(0, 100) + '"' + ((d.after.ceoDecision === 'edited-approved') ? ' [CEO edited — see posted text]' : '')); });
  rejected.forEach(function (d) { lines.push('  REJECTED reply to: "' + ((d.before && d.before.originalPost) || '').slice(0, 100) + '"'); });
  return lines.join('\n');
}
module.exports.buildDecisionBlock = buildDecisionBlock;
```

- [ ] **Step 2: Test buildDecisionBlock**

Append to `scripts/test-reply-feedback.cjs` (before final log):

```js
const blk = RF.buildDecisionBlock([
  { decisionType: 'reply-selection', after: { ceoDecision: 'approved' }, before: { originalPost: 'good post about agents' } },
  { decisionType: 'reply-selection', after: { ceoDecision: 'rejected' }, before: { originalPost: 'political rant' } }
], 5);
assert.ok(/APPROVED/.test(blk) && /REJECTED/.test(blk));
assert.ok(/good post about agents/.test(blk));
```

Run: `node scripts/test-reply-feedback.cjs` → `ALL PASS`.

- [ ] **Step 3: Include the block in judgeCandidate**

In `reply-selection.js`, change `judgeCandidate` to accept `deps.decisionBlock` and append it to the prompt:

```js
async function judgeCandidate(candidate, deps) {
  var prompt = buildJudgePrompt(candidate, deps.groundingText, deps.voicePrinciples);
  if (deps.decisionBlock) prompt += '\n\n' + deps.decisionBlock;
  var text = await deps.callWithFallback(prompt, 'scout-reply-judge', {
    model: deps.cfg.model, fallbackModel: deps.cfg.fallbackModel, maxTokens: 400, temperature: 0.3
  });
  if (text === null || text === undefined) return null;
  return parseJudgeVerdict(text);
}
```

And in `runReplySelection`, build the block once and pass it: after reading `decisions`, add
```js
var _decisionBlock = require('./reply-feedback').buildDecisionBlock(decisions, 5);
```
then add `decisionBlock: _decisionBlock` to the `judgeCandidate` deps object.

- [ ] **Step 4: Inject approved/edited examples into Scribe's reply prompt**

In `prompt-builders.js`, locate where the Scribe `bluesky_reply` drafting prompt is assembled (search for `bluesky` / the reply doctrine). Inject the same `buildDecisionBlock` output (built from `agentDecisions` available in the prompt context) so Scribe sees recent approved/edited examples. Follow the existing founder-voice injection pattern in that file. Verify the module still loads:

Run: `node -e "require('./api/companyHeartbeat/prompt-builders.js'); console.log('OK')"` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/reply-feedback.js api/companyHeartbeat/reply-selection.js api/companyHeartbeat/prompt-builders.js scripts/test-reply-feedback.cjs
git commit -m "feat(reply-feedback): feed CEO decisions into judge + Scribe prompts"
```

---

### Task 9: Signal 2 — selection features on outcome snapshots + observability

**Files:**
- Modify: `api/actionsExecute/executors/_utils/outcomeBaseline.js` (≈line 53-70)
- Modify: `api/companyHeartbeat/agent-runner.js` (Scribe reply action — carry features)

- [ ] **Step 1: Carry selection features onto the reply action**

In `agent-runner.js` where `_replyAction` is built (≈line 1903), add the parent task's selection features so the executor can stamp them:

```js
  _selectionFeatures: (task._selectionFeatures || null),
```

- [ ] **Step 2: Attach features to the outcome snapshot**

In `outcomeBaseline.js`, after the `store[action.id] = { ... }` object literal (≈line 70), add:

```js
  if (action._selectionFeatures) {
    store[action.id].selectionFeatures = action._selectionFeatures;
    store[action.id].autoSelected = true;
  }
```

- [ ] **Step 3: Verify the module loads**

Run: `node -e "require('./api/actionsExecute/executors/_utils/outcomeBaseline.js'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Observability — selection stats already log per cycle**

`runReplySelection` already emits `[Heartbeat] scout: reply-selection {considered, eligible, judged, passed, drafted, skippedReason}` (Task 5). No new dashboard page — the existing Bluesky Discovery dashboard (`modules/company/bluesky-discovery.html`) shows candidates with `status: 'replied'` for engaged threads. Confirm replied candidates render distinctly there; if not, add a `replied` filter chip following the existing `new`/`dismissed` filter pattern in that file.

- [ ] **Step 5: Commit**

```bash
git add api/actionsExecute/executors/_utils/outcomeBaseline.js api/companyHeartbeat/agent-runner.js modules/company/bluesky-discovery.html
git commit -m "feat(reply-selection): stamp selection features on outcome snapshots + dashboard replied filter"
```

---

## Self-Review

**Spec coverage:**
- Posture (auto-draft, CEO approves) → Tasks 4–5 create tasks but never post; approval gate untouched. ✓
- Hybrid selection (heat pre-filter → LLM judge) → Tasks 2 (pre-filter) + 3 (judge). ✓
- 1–2/day volume → `countTodayAutoDrafts` + budget in Task 4. ✓
- Feedback Signal 1 (CEO decisions) → Tasks 7–8. ✓
- Feedback Signal 2 (engagement) → Task 9 (features on snapshot; `outcomeRefresh` already pulls Bluesky t1/t7). ✓
- Haiku→Gemini fallback → Task 1 + `judgeCandidate` fail-closed. ✓
- Ships dark / config / execution_mode / breaker / anti-spam → Tasks 2 + 4 + 6. ✓
- Observability, no silent caps → Task 4 summary log + Task 9. ✓

**Placeholder scan:** No "TBD/TODO/handle errors appropriately". Two tasks (8 Step 4, 9 Step 4) say "follow the existing pattern in that file" for prompt-builders.js and the dashboard — these reference real, located patterns (founder-voice injection; the `new`/`dismissed` filter chips) rather than inventing code blind, because the exact surrounding code there should be read at implementation time. Every new module has complete code.

**Type consistency:** `_selectionFeatures` shape `{score,fit,value,risk,angle,matchedKeyword}` is written in `buildReplyTask` (Task 2), read in Task 9. Decision `after.ceoDecision` values `approved|rejected|edited-approved` are written in Task 7 and matched by `rejectBreakerTripped` (Task 2, checks `'rejected'`) and `buildDecisionBlock` (Task 8). `callWithFallback(prompt, agentId, {model,fallbackModel,maxTokens,temperature})` signature consistent across Task 1 and `judgeCandidate`. Task field names (`taskType`, `assignee`, `tags`, `threadContext`) match the live `task-mutations.js` shape and the Scribe drafter's `task.tags`/`task.threadContext` reads.

---

## Execution Handoff

Phase 1 (Tasks 1–6) is the minimum shippable loop. Phase 2 (Tasks 7–9) adds learning. Recommended order: 1→6, verify dark + one live draft, then 7→9.
