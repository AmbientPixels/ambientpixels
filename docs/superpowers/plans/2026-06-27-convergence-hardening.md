# Convergence Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop low-stakes design/internal tasks from drawing unbounded revision pile-ons and locking forever — auto-accept internal tasks at threshold, grace-cancel public tasks after 48h, and kill the duplicate-comment spam.

**Architecture:** A new pure module `convergence.js` holds the threshold constants + the `classifyConvergence` decision function (unit-tested in isolation, mirroring the `proposal-generator.js` pure-core precedent — `agent-runner.js` is 5949 lines and too heavy to import in a test). `agent-runner.js` imports it, replaces 4 hardcoded `5`s with `convergenceThresholdFor`, dispatches the two convergence-triage blocks on `classifyConvergence`, and adds a structural `_convergenceState` flag that replaces the brittle substring dedup. `execution-engine.js` gets a lane-disciplined reviewer prompt.

**Tech Stack:** Node.js (Azure Functions), CommonJS, `assert`-based tests run via `node <file>.test.js` (no test framework, no `npm test`).

> **Note (refinement of spec):** the spec placed the constants in `constants.js` and `classifyConvergence` in `agent-runner.js`. This plan instead puts both in a dedicated `convergence.js` for isolation/testability — same behavior, cleaner boundary, and tests don't have to load the giant heartbeat file. Functionally identical to the approved design.

---

### Task 1: Create the pure `convergence.js` module (TDD)

**Files:**
- Create: `api/companyHeartbeat/convergence.js`
- Test: `api/companyHeartbeat/convergence.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/companyHeartbeat/convergence.test.js`:

```js
// Run with: node api/companyHeartbeat/convergence.test.js
// Pure-function tests for convergence threshold + decision logic.
const assert = require('assert');
const { convergenceThresholdFor, classifyConvergence, CONVERGENCE_GRACE_HOURS } = require('./convergence');

const NOW = Date.UTC(2026, 5, 27, 12, 0, 0); // 2026-06-27T12:00:00Z
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const dels = (n) => Array.from({ length: n }, () => ({ type: 'deliverable' }));
const task = (o) => Object.assign({ taskType: 'general', comments: [] }, o || {});

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// ── convergenceThresholdFor ──
test('design_asset threshold is 3', () => assert.strictEqual(convergenceThresholdFor('design_asset'), 3));
test('unknown type falls back to default 5', () => assert.strictEqual(convergenceThresholdFor('social_x'), 5));
test('absent type falls back to default 5', () => assert.strictEqual(convergenceThresholdFor(undefined), 5));

// ── classifyConvergence ──
test('below threshold -> none', () => {
  const r = classifyConvergence(task({ taskType: 'design_asset', comments: dels(2) }), NOW);
  assert.strictEqual(r.action, 'none');
});
test('design_asset at 3 deliverables -> auto-accept', () => {
  const r = classifyConvergence(task({ taskType: 'design_asset', comments: dels(3) }), NOW);
  assert.strictEqual(r.action, 'auto-accept');
});
test('internal_doc at 5 -> auto-accept', () => {
  const r = classifyConvergence(task({ taskType: 'internal_doc', comments: dels(5) }), NOW);
  assert.strictEqual(r.action, 'auto-accept');
});
test('social_x at 5, not escalated -> escalate', () => {
  const r = classifyConvergence(task({ taskType: 'social_x', comments: dels(5) }), NOW);
  assert.strictEqual(r.action, 'escalate');
});
test('social_x at 4 -> none (below default threshold)', () => {
  const r = classifyConvergence(task({ taskType: 'social_x', comments: dels(4) }), NOW);
  assert.strictEqual(r.action, 'none');
});
test('escalated public task within grace -> none', () => {
  const r = classifyConvergence(task({ taskType: 'social_x', comments: dels(5), _convergenceState: { notified: true, escalatedAt: hoursAgo(10) } }), NOW);
  assert.strictEqual(r.action, 'none');
});
test('escalated public task past grace -> grace-close', () => {
  const r = classifyConvergence(task({ taskType: 'social_x', comments: dels(5), _convergenceState: { notified: true, escalatedAt: hoursAgo(CONVERGENCE_GRACE_HOURS + 1) } }), NOW);
  assert.strictEqual(r.action, 'grace-close');
});
test('internal task wins over stale escalation -> auto-accept', () => {
  const r = classifyConvergence(task({ taskType: 'design_asset', comments: dels(3), _convergenceState: { escalatedAt: hoursAgo(100) } }), NOW);
  assert.strictEqual(r.action, 'auto-accept');
});
test('null/empty task is safe -> none', () => {
  assert.strictEqual(classifyConvergence(null, NOW).action, 'none');
  assert.strictEqual(classifyConvergence({}, NOW).action, 'none');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyHeartbeat/convergence.test.js`
Expected: FAIL — `Cannot find module './convergence'`.

- [ ] **Step 3: Write the implementation**

Create `api/companyHeartbeat/convergence.js`:

```js
'use strict';
// Pure convergence decision logic for heartbeat task revision loops.
// No IO — unit-tested in convergence.test.js. agent-runner.js performs the writes.

const CONVERGENCE_THRESHOLD = 5;                          // default deliverable cap before convergence acts
const CONVERGENCE_THRESHOLD_BY_TYPE = { design_asset: 3 };
const CONVERGENCE_AUTO_ACCEPT_TYPES = new Set(['design_asset', 'internal_doc', 'research', 'general']);
const CONVERGENCE_GRACE_HOURS = 48;                       // public task auto-cancels this long after escalation

function convergenceThresholdFor(taskType) {
  const key = String(taskType || '').toLowerCase();
  return CONVERGENCE_THRESHOLD_BY_TYPE[key] || CONVERGENCE_THRESHOLD;
}

function _deliverableCount(task) {
  return (((task && task.comments) || []).filter(function (c) { return c && c.type === 'deliverable'; })).length;
}

// Decide what to do with a task that may be in a revision loop.
// Returns { action, reason, threshold, deliverableCount }.
//   action: 'none' | 'auto-accept' | 'escalate' | 'grace-close'
function classifyConvergence(task, nowMs) {
  const t = task || {};
  const threshold = convergenceThresholdFor(t.taskType);
  const count = _deliverableCount(t);
  const internal = CONVERGENCE_AUTO_ACCEPT_TYPES.has(String(t.taskType || '').toLowerCase());
  const state = t._convergenceState || null;

  // Internal, low-stakes task at/over threshold: accept the latest draft. Wins even over a
  // prior escalation — accepting beats cancelling already-produced internal work.
  if (count >= threshold && internal) {
    return { action: 'auto-accept', reason: 'internal task at threshold — accept latest draft', threshold: threshold, deliverableCount: count };
  }
  // Public task already escalated: close it once the grace window lapses; otherwise wait.
  if (state && state.escalatedAt) {
    const escMs = Date.parse(state.escalatedAt);
    if (Number.isFinite(escMs) && (nowMs - escMs) >= CONVERGENCE_GRACE_HOURS * 3600000) {
      return { action: 'grace-close', reason: 'escalated > ' + CONVERGENCE_GRACE_HOURS + 'h without CEO action', threshold: threshold, deliverableCount: count };
    }
    return { action: 'none', reason: 'escalated, within grace window', threshold: threshold, deliverableCount: count };
  }
  if (count < threshold) {
    return { action: 'none', reason: 'below threshold', threshold: threshold, deliverableCount: count };
  }
  // Public task at threshold, first time.
  return { action: 'escalate', reason: 'public task at threshold — escalate to CEO', threshold: threshold, deliverableCount: count };
}

module.exports = {
  CONVERGENCE_THRESHOLD: CONVERGENCE_THRESHOLD,
  CONVERGENCE_THRESHOLD_BY_TYPE: CONVERGENCE_THRESHOLD_BY_TYPE,
  CONVERGENCE_AUTO_ACCEPT_TYPES: CONVERGENCE_AUTO_ACCEPT_TYPES,
  CONVERGENCE_GRACE_HOURS: CONVERGENCE_GRACE_HOURS,
  convergenceThresholdFor: convergenceThresholdFor,
  classifyConvergence: classifyConvergence,
  _deliverableCount: _deliverableCount
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyHeartbeat/convergence.test.js`
Expected: PASS — `13 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/convergence.js api/companyHeartbeat/convergence.test.js
git commit -m "feat(heartbeat): pure convergence decision module + tests"
```

---

### Task 2: Replace the 4 hardcoded `5` thresholds with `convergenceThresholdFor`

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (require at top of file; sites at ~901, ~905, ~1045, ~1094, ~1757, ~3580)

- [ ] **Step 1: Add the require near the other heartbeat-module requires at the top of `agent-runner.js`**

Find the existing top-of-file requires (e.g. `const ... = require('./constants');`) and add:

```js
const { classifyConvergence, convergenceThresholdFor } = require('./convergence');
```

- [ ] **Step 2: Replace the `_convergenceBlocked` / `_executableIdle` filters (~901–907)**

Replace:

```js
      const _convergenceBlocked = _triagedIdle.filter(t => {
        const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
        return _delCount >= 5;
      });
      let _executableIdle = _triagedIdle.filter(t => {
        const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
        return _delCount < 5;
      });
```

with:

```js
      const _convergenceBlocked = _triagedIdle.filter(t => {
        const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
        return _delCount >= convergenceThresholdFor(t.taskType);
      });
      let _executableIdle = _triagedIdle.filter(t => {
        const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
        return _delCount < convergenceThresholdFor(t.taskType);
      });
```

- [ ] **Step 3: Replace the peer-review-injection exclusion (~1045)**

Replace:

```js
          const _peerReviewCandidates = allActiveTasks.filter(t =>
            t.status === 'review' && t.assignee !== agentId &&
            t.comments && t.comments.some(c => c.type === 'deliverable') &&
            (t.comments || []).filter(c => c.type === 'deliverable').length < 5
          );
```

with:

```js
          const _peerReviewCandidates = allActiveTasks.filter(t =>
            t.status === 'review' && t.assignee !== agentId &&
            t.comments && t.comments.some(c => c.type === 'deliverable') &&
            (t.comments || []).filter(c => c.type === 'deliverable').length < convergenceThresholdFor(t.taskType)
          );
```

- [ ] **Step 4: Replace the review-stuck scan threshold (~1094)**

Replace:

```js
    var _reviewStuck = (agentTasks || []).filter(function (t) {
      if (t.status !== 'review') return false;
      var _rsCount = (t.comments || []).filter(function (c) { return c.type === 'deliverable'; }).length;
      return _rsCount >= 5;
    });
```

with:

```js
    var _reviewStuck = (agentTasks || []).filter(function (t) {
      if (t.status !== 'review') return false;
      var _rsCount = (t.comments || []).filter(function (c) { return c.type === 'deliverable'; }).length;
      return _rsCount >= convergenceThresholdFor(t.taskType);
    });
```

- [ ] **Step 5: Replace the execute-task guard threshold (~1756–1757)**

Replace:

```js
          const _deliverableCount = (_exTask.comments || []).filter(c => c.type === 'deliverable').length;
          if (_deliverableCount >= 5) {
```

with:

```js
          const _deliverableCount = (_exTask.comments || []).filter(c => c.type === 'deliverable').length;
          if (_deliverableCount >= convergenceThresholdFor(_exTask.taskType)) {
```

- [ ] **Step 6: Replace the review-task guard threshold (~3579–3580)**

Replace:

```js
        const _rvDelCount = (task.comments || []).filter(c => c.type === 'deliverable').length;
        if (_rvDelCount >= 5) {
```

with:

```js
        const _rvDelCount = (task.comments || []).filter(c => c.type === 'deliverable').length;
        if (_rvDelCount >= convergenceThresholdFor(task.taskType)) {
```

- [ ] **Step 7: Syntax check**

Run: `node --check api/companyHeartbeat/agent-runner.js`
Expected: no output (exit 0).

- [ ] **Step 8: Confirm no stray hardcoded convergence `5`s remain**

Run: `grep -n "type === 'deliverable').length\b" api/companyHeartbeat/agent-runner.js | grep -n ">= 5\|< 5"`
Expected: no matches (all converted).

- [ ] **Step 9: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "refactor(heartbeat): per-type convergence threshold via convergenceThresholdFor"
```

---

### Task 3: Structural `_convergenceState` dedup flag (kills the repeat-comment spam)

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (review-task guard ~3581–3590; execute-task guard ~1761–1770; review-stuck escalation ~1100–1110)

The current dedup reads the last system comment's text. The review-task guard checks for `"Review loop"` but posts `"Review blocked"` — they never match, so it spams every cycle. Replace all three text-based checks with the structural `task._convergenceState.notified` flag.

- [ ] **Step 1: Fix the review-task guard (~3581–3590)**

Replace:

```js
        if (_rvDelCount >= convergenceThresholdFor(task.taskType)) {
          const _lastRvSys = (task.comments || []).slice().reverse().find(c => c.author === 'system' || c.agentId === 'system');
          const _rvAlreadyWarned = _lastRvSys && _lastRvSys.text && _lastRvSys.text.indexOf('Review loop') !== -1;
          if (!_rvAlreadyWarned) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: '[SYSTEM] Review blocked: task is convergence-locked (' + _rvDelCount + ' deliverables). CEO must approve or close this task before further review can proceed.',
              agentId: 'system'
            });
          }
          context.log('[Heartbeat]', agentId, 'CONVERGENCE BLOCKED review-task on', action.taskId, '—', _rvDelCount, 'deliverables already.');
        } else {
```

with:

```js
        if (_rvDelCount >= convergenceThresholdFor(task.taskType)) {
          const _rvAlreadyWarned = !!(task._convergenceState && task._convergenceState.notified);
          if (!_rvAlreadyWarned) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: '[SYSTEM] Review blocked: task is convergence-locked (' + _rvDelCount + ' deliverables). CEO must approve or close this task before further review can proceed.',
              agentId: 'system'
            });
            task._convergenceState = Object.assign({}, task._convergenceState, { notified: true, deliverableCount: _rvDelCount });
          }
          context.log('[Heartbeat]', agentId, 'CONVERGENCE BLOCKED review-task on', action.taskId, '—', _rvDelCount, 'deliverables already.');
        } else {
```

- [ ] **Step 2: Fix the execute-task guard (~1761–1770)**

Replace:

```js
            const _lastSysCmt = (_exTask.comments || []).slice().reverse().find(c => c.author === 'system' || c.agentId === 'system');
            const _alreadyLoopWarned = _lastSysCmt && _lastSysCmt.text && _lastSysCmt.text.indexOf('Revision loop detected') !== -1;
            if (!_alreadyLoopWarned) {
              result.taskUpdates.push({
                action: 'comment',
                taskId: action.taskId,
                comment: '[SYSTEM] Revision loop detected: ' + _deliverableCount + ' deliverables on this task without convergence. Task needs CEO review to break the cycle — either approve the latest draft, provide specific direction, or close the task.',
                agentId: 'system'
              });
            }
```

with:

```js
            const _alreadyLoopWarned = !!(_exTask._convergenceState && _exTask._convergenceState.notified);
            if (!_alreadyLoopWarned) {
              result.taskUpdates.push({
                action: 'comment',
                taskId: action.taskId,
                comment: '[SYSTEM] Revision loop detected: ' + _deliverableCount + ' deliverables on this task without convergence. Task needs CEO review to break the cycle — either approve the latest draft, provide specific direction, or close the task.',
                agentId: 'system'
              });
              _exTask._convergenceState = Object.assign({}, _exTask._convergenceState, { notified: true, deliverableCount: _deliverableCount });
            }
```

- [ ] **Step 3: Fix the review-stuck escalation dedup (~1100–1110)**

Replace:

```js
      var _rsAlreadyEscalated = _rsTask.comments.some(function (c) {
        return (c.text || '').indexOf('Review loop detected') !== -1 && c.type === 'system';
      });
      if (!_rsAlreadyEscalated) {
        _rsTask.comments.push({
          id: 'cmt-revloopesc-' + Date.now() + '-' + _rsi,
          author: 'system',
          type: 'system',
          createdAt: new Date().toISOString(),
          text: '[SYSTEM] Review loop detected: ' + _rsDels.length + ' deliverables stuck in review without convergence. Peer reviewers are no longer eligible to inject (>=5 deliverables). CEO must approve the latest draft, provide direction, or close this task.'
        });
        _rsTask.updatedAt = new Date().toISOString();
```

with:

```js
      var _rsAlreadyEscalated = !!(_rsTask._convergenceState && _rsTask._convergenceState.notified);
      if (!_rsAlreadyEscalated) {
        _rsTask.comments.push({
          id: 'cmt-revloopesc-' + Date.now() + '-' + _rsi,
          author: 'system',
          type: 'system',
          createdAt: new Date().toISOString(),
          text: '[SYSTEM] Review loop detected: ' + _rsDels.length + ' deliverables stuck in review without convergence. Peer reviewers are no longer eligible to inject. CEO must approve the latest draft, provide direction, or close this task.'
        });
        _rsTask._convergenceState = Object.assign({}, _rsTask._convergenceState, { notified: true, deliverableCount: _rsDels.length });
        _rsTask.updatedAt = new Date().toISOString();
```

- [ ] **Step 4: Syntax check**

Run: `node --check api/companyHeartbeat/agent-runner.js`
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "fix(heartbeat): structural _convergenceState dedup flag (stop convergence comment spam)"
```

---

### Task 4: Auto-accept internal tasks in the todo/in-progress convergence block

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (CONVERGENCE ESCALATION loop ~909–968)

Dispatch each convergence-blocked todo/in-progress task on `classifyConvergence`: internal types auto-accept (mark done), public types escalate (set `_convergenceState.escalatedAt`) or grace-close.

- [ ] **Step 1: Replace the loop body header (~911–924) to dispatch on the action**

Find the loop starting at `for (var _cri = 0; _cri < _convergenceBlocked.length; _cri++) {` and replace from that line through the end of the `if (!_crAlreadyEscalated) { ... }` block that posts the escalation comment + approvalQueue entry (i.e. through the `}` that closes `if (!_crAlreadyEscalated)` at ~948) with:

```js
      for (var _cri = 0; _cri < _convergenceBlocked.length; _cri++) {
        var _crTask = _convergenceBlocked[_cri];
        var _crDels = (_crTask.comments || []).filter(function(c) { return c.type === 'deliverable'; });
        if (!_crTask.comments) _crTask.comments = [];
        var _crVerdict = classifyConvergence(_crTask, Date.now());

        // INTERNAL low-stakes task at threshold → accept the latest draft, done. No lock.
        if (_crVerdict.action === 'auto-accept') {
          if (!(_crTask._convergenceState && _crTask._convergenceState.resolved)) {
            _crTask.status = 'done';
            _crTask.updatedAt = new Date().toISOString();
            _crTask._convergenceState = Object.assign({}, _crTask._convergenceState, { notified: true, resolved: 'auto-accept', deliverableCount: _crDels.length });
            _crTask.comments.push({ id: 'cmt-convaccept-' + Date.now() + '-' + _cri, author: 'system', type: 'system', createdAt: new Date().toISOString(),
              text: '[SYSTEM] Converged: auto-accepted latest of ' + _crDels.length + ' drafts (internal task, no external gate).' });
            context.log('[Heartbeat] CONVERGENCE AUTO-ACCEPT:', _crTask.id, '—', _crDels.length, 'drafts, marked done');
            try {
              var _caAQ = (await storage.getState('approvalQueue')) || [];
              var _caChanged = false;
              _caAQ.forEach(function(q) { if (q && q.type === 'convergence_escalation' && q.taskId === _crTask.id && q.status === 'pending') { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); q.resolution = 'auto-accept'; _caChanged = true; } });
              if (_caChanged) await storage.setState('approvalQueue', _caAQ);
            } catch (_caErr) { context.log('[Heartbeat] CONVERGENCE AUTO-ACCEPT: AQ resolve failed (non-fatal):', String(_caErr).substring(0, 200)); }
            try {
              var _caGov = (await storage.getState('governanceLog')) || [];
              _caGov.push({ at: new Date().toISOString(), type: 'convergence-auto-accept', taskId: _crTask.id, taskTitle: _crTask.title || _crTask.id, drafts: _crDels.length });
              await storage.setState('governanceLog', _caGov.slice(-500));
            } catch (_cgErr) { /* non-fatal */ }
          }
          continue;
        }

        // PUBLIC task already escalated past the grace window → cancel (never auto-ship unreviewed).
        if (_crVerdict.action === 'grace-close') {
          if (!(_crTask._convergenceState && _crTask._convergenceState.resolved)) {
            _crTask.status = 'canceled';
            _crTask.updatedAt = new Date().toISOString();
            _crTask._convergenceState = Object.assign({}, _crTask._convergenceState, { resolved: 'grace-close', deliverableCount: _crDels.length });
            _crTask.comments.push({ id: 'cmt-convgrace-' + Date.now() + '-' + _cri, author: 'system', type: 'system', createdAt: new Date().toISOString(),
              text: '[SYSTEM] Convergence grace window elapsed (no CEO action in 48h). Canceling un-converged public task — re-create if still needed.' });
            context.log('[Heartbeat] CONVERGENCE GRACE-CLOSE:', _crTask.id, '— canceled after grace window');
            try {
              var _gcAQ = (await storage.getState('approvalQueue')) || [];
              var _gcChanged = false;
              _gcAQ.forEach(function(q) { if (q && q.type === 'convergence_escalation' && q.taskId === _crTask.id && q.status === 'pending') { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); q.resolution = 'grace-close'; _gcChanged = true; } });
              if (_gcChanged) await storage.setState('approvalQueue', _gcAQ);
            } catch (_gcErr) { context.log('[Heartbeat] CONVERGENCE GRACE-CLOSE: AQ resolve failed (non-fatal):', String(_gcErr).substring(0, 200)); }
            try {
              var _gcGov = (await storage.getState('governanceLog')) || [];
              _gcGov.push({ at: new Date().toISOString(), type: 'convergence-grace-close', taskId: _crTask.id, taskTitle: _crTask.title || _crTask.id, drafts: _crDels.length });
              await storage.setState('governanceLog', _gcGov.slice(-500));
            } catch (_ggErr) { /* non-fatal */ }
          }
          continue;
        }

        // PUBLIC task at threshold (first time) or within grace → escalate to CEO (existing behavior).
        if (_crTask.status !== 'review') {
          _crTask.status = 'review';
          _crTask.updatedAt = new Date().toISOString();
        }
        var _crAlreadyEscalated = !!(_crTask._convergenceState && _crTask._convergenceState.notified);
        if (!_crAlreadyEscalated) {
          _crTask._convergenceState = Object.assign({}, _crTask._convergenceState, { notified: true, escalatedAt: new Date().toISOString(), deliverableCount: _crDels.length });
          _crTask.comments.push({ id: 'cmt-convesc-' + Date.now() + '-' + _cri, author: 'system', type: 'system', createdAt: new Date().toISOString(),
            text: '[SYSTEM] Revision loop detected: ' + _crDels.length + ' deliverables without convergence. CEO must approve the latest draft, provide direction, or close this task.' });
          context.log('[Heartbeat] CONVERGENCE ESCALATION:', _crTask.id, '—', _crDels.length, 'deliverables, moved to review for CEO');
          // Push convergence_escalation to approvalQueue so it appears in Needs Attention panel
          try {
            var _ceAQ = (await storage.getState('approvalQueue')) || [];
            var _ceAlreadyInQueue = _ceAQ.some(function(q) { return q.type === 'convergence_escalation' && q.taskId === _crTask.id && q.status === 'pending'; });
            if (!_ceAlreadyInQueue) {
              _ceAQ.push({
                id: 'aq-convesc-' + _crTask.id + '-' + Date.now(),
                type: 'convergence_escalation',
                taskId: _crTask.id,
                taskTitle: _crTask.title || _crTask.id,
                originAgent: _crTask.assignee || agentId,
                attempts: _crDels.length,
                status: 'pending',
                createdAt: new Date().toISOString()
              });
              if (_ceAQ.length > 100) _ceAQ.splice(0, _ceAQ.length - 100);
              await storage.setState('approvalQueue', _ceAQ);
              context.log('[Heartbeat] CONVERGENCE ESCALATION: added to approvalQueue for task', _crTask.id);
            }
          } catch (_ceErr) {
            context.log('[Heartbeat] CONVERGENCE ESCALATION: approvalQueue write failed (non-fatal):', String(_ceErr).substring(0, 200));
          }
        }
```

Leave the existing auto-submit-for-publish sub-block (the `var _convDocEsc = documents.find(...)` section through the end of the `for` loop at ~967) unchanged — it stays after the escalation branch and continues to run for public docs.

- [ ] **Step 2: Syntax check**

Run: `node --check api/companyHeartbeat/agent-runner.js`
Expected: no output (exit 0).

- [ ] **Step 3: Re-run the convergence unit tests (unaffected, must still pass)**

Run: `node api/companyHeartbeat/convergence.test.js`
Expected: PASS — `13 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "feat(heartbeat): auto-accept internal + grace-close public convergence (todo/in-progress block)"
```

---

### Task 5: Auto-accept / grace-close in the review-stuck block

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (REVIEW LOOP CONVERGENCE ESCALATION ~1085–1135)

A task sitting in `review` at threshold also needs the same dispatch: internal → auto-accept (done), public → escalate then grace-close. Currently this block only ever escalates.

- [ ] **Step 1: Insert the dispatch at the top of the per-task loop body**

Find `for (var _rsi = 0; _rsi < _reviewStuck.length; _rsi++) {` and its body. Immediately after the existing lines:

```js
      var _rsTask = _reviewStuck[_rsi];
      var _rsDels = (_rsTask.comments || []).filter(function (c) { return c.type === 'deliverable'; });
      if (!_rsTask.comments) _rsTask.comments = [];
```

insert:

```js
      var _rsVerdict = classifyConvergence(_rsTask, Date.now());
      if (_rsVerdict.action === 'auto-accept' && !(_rsTask._convergenceState && _rsTask._convergenceState.resolved)) {
        _rsTask.status = 'done';
        _rsTask.updatedAt = new Date().toISOString();
        _rsTask._convergenceState = Object.assign({}, _rsTask._convergenceState, { notified: true, resolved: 'auto-accept', deliverableCount: _rsDels.length });
        _rsTask.comments.push({ id: 'cmt-convaccept-rs-' + Date.now() + '-' + _rsi, author: 'system', type: 'system', createdAt: new Date().toISOString(),
          text: '[SYSTEM] Converged: auto-accepted latest of ' + _rsDels.length + ' drafts (internal task, no external gate).' });
        context.log('[Heartbeat] CONVERGENCE AUTO-ACCEPT (review-stuck):', _rsTask.id, '— marked done');
        try {
          var _rsCaAQ = (await storage.getState('approvalQueue')) || [];
          var _rsCaChanged = false;
          _rsCaAQ.forEach(function (q) { if (q && q.type === 'convergence_escalation' && q.taskId === _rsTask.id && q.status === 'pending') { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); q.resolution = 'auto-accept'; _rsCaChanged = true; } });
          if (_rsCaChanged) await storage.setState('approvalQueue', _rsCaAQ);
        } catch (_rsCaErr) { context.log('[Heartbeat] CONVERGENCE AUTO-ACCEPT (review-stuck): AQ resolve failed (non-fatal):', String(_rsCaErr).substring(0, 200)); }
        try {
          var _rsCaGov = (await storage.getState('governanceLog')) || [];
          _rsCaGov.push({ at: new Date().toISOString(), type: 'convergence-auto-accept', taskId: _rsTask.id, taskTitle: _rsTask.title || _rsTask.id, drafts: _rsDels.length });
          await storage.setState('governanceLog', _rsCaGov.slice(-500));
        } catch (_rsCgErr) { /* non-fatal */ }
        continue;
      }
      if (_rsVerdict.action === 'grace-close' && !(_rsTask._convergenceState && _rsTask._convergenceState.resolved)) {
        _rsTask.status = 'canceled';
        _rsTask.updatedAt = new Date().toISOString();
        _rsTask._convergenceState = Object.assign({}, _rsTask._convergenceState, { resolved: 'grace-close', deliverableCount: _rsDels.length });
        _rsTask.comments.push({ id: 'cmt-convgrace-rs-' + Date.now() + '-' + _rsi, author: 'system', type: 'system', createdAt: new Date().toISOString(),
          text: '[SYSTEM] Convergence grace window elapsed (no CEO action in 48h). Canceling un-converged public task — re-create if still needed.' });
        context.log('[Heartbeat] CONVERGENCE GRACE-CLOSE (review-stuck):', _rsTask.id, '— canceled');
        try {
          var _rsGcAQ = (await storage.getState('approvalQueue')) || [];
          var _rsGcChanged = false;
          _rsGcAQ.forEach(function (q) { if (q && q.type === 'convergence_escalation' && q.taskId === _rsTask.id && q.status === 'pending') { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); q.resolution = 'grace-close'; _rsGcChanged = true; } });
          if (_rsGcChanged) await storage.setState('approvalQueue', _rsGcAQ);
        } catch (_rsGcErr) { context.log('[Heartbeat] CONVERGENCE GRACE-CLOSE (review-stuck): AQ resolve failed (non-fatal):', String(_rsGcErr).substring(0, 200)); }
        try {
          var _rsGcGov = (await storage.getState('governanceLog')) || [];
          _rsGcGov.push({ at: new Date().toISOString(), type: 'convergence-grace-close', taskId: _rsTask.id, taskTitle: _rsTask.title || _rsTask.id, drafts: _rsDels.length });
          await storage.setState('governanceLog', _rsGcGov.slice(-500));
        } catch (_rsGgErr) { /* non-fatal */ }
        continue;
      }
```

The existing escalation code below (the `var _rsAlreadyEscalated = ...` block from Task 3 Step 3) then runs for public tasks at threshold (first escalation). To start the grace clock on that path, in that block where it sets `_rsTask._convergenceState = Object.assign(..., { notified: true, deliverableCount: _rsDels.length });` also add `escalatedAt`:

Replace (the line edited in Task 3 Step 3):

```js
        _rsTask._convergenceState = Object.assign({}, _rsTask._convergenceState, { notified: true, deliverableCount: _rsDels.length });
```

with:

```js
        _rsTask._convergenceState = Object.assign({}, _rsTask._convergenceState, { notified: true, escalatedAt: (_rsTask._convergenceState && _rsTask._convergenceState.escalatedAt) || new Date().toISOString(), deliverableCount: _rsDels.length });
```

- [ ] **Step 2: Syntax check**

Run: `node --check api/companyHeartbeat/agent-runner.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "feat(heartbeat): convergence auto-accept/grace-close in review-stuck block"
```

---

### Task 6: Lane-disciplined review prompt

**Files:**
- Modify: `api/companyHeartbeat/execution-engine.js` (reviewTask prompt ~289–301)

Tell reviewers to stay in their domain so out-of-scope critiques (e.g. Forge demanding ops metadata on a design asset) stop forcing redrafts.

- [ ] **Step 1: Add the lane-discipline guidance to the review prompt**

Find the review instruction block that contains:

```js
- Do NOT request "Appendix A", external documents, or fictional dependencies that were not provided. Judge the deliverable based on what was actually produced.
- Do NOT loop — if the deliverable is reasonably complete, approve it. Perfection is not the goal; actionable output is.`;
```

Replace it with:

```js
- Do NOT request "Appendix A", external documents, or fictional dependencies that were not provided. Judge the deliverable based on what was actually produced.
- Do NOT loop — if the deliverable is reasonably complete, approve it. Perfection is not the goal; actionable output is.
- STAY IN YOUR LANE: judge ONLY within your domain. A design asset is graded on visual/brand quality, a doc on clarity/accuracy — NOT on ops, finance, or SEO concerns outside your role. Concerns outside the deliverable's purpose are NOT grounds for rejection.
- If the deliverable is adequate for its stated purpose, APPROVE. Do not demand additions beyond the task's scope.`;
```

- [ ] **Step 2: Syntax check**

Run: `node --check api/companyHeartbeat/execution-engine.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add api/companyHeartbeat/execution-engine.js
git commit -m "feat(heartbeat): lane-disciplined reviewer prompt to reduce redraft pile-ons"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run all heartbeat unit tests**

Run: `node api/companyHeartbeat/convergence.test.js && node api/companyHeartbeat/proposal-generator.test.js`
Expected: both report `… passed, 0 failed`.

- [ ] **Step 2: Syntax-check every modified file**

Run: `node --check api/companyHeartbeat/convergence.js && node --check api/companyHeartbeat/agent-runner.js && node --check api/companyHeartbeat/execution-engine.js`
Expected: no output (exit 0).

- [ ] **Step 3: Manual integration check (post-deploy)**

After `git push origin master` deploys via GitHub Actions, trigger one heartbeat and confirm no convergence regressions:

```bash
curl -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-heartbeat-trigger" \
  -H "Content-Type: application/json" -H "x-company-secret: pixelpusher"
```

Then check the latest run + governance for the new event types:

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=governanceLog" \
  -H "x-company-secret: pixelpusher" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const g=JSON.parse(d);const v=g.value||g;console.log(v.filter(x=>/convergence-(auto-accept|grace-close)/.test(x.type)).slice(-5));})"
```

Expected: heartbeat returns 200; if any internal task was convergence-blocked, it now shows as `done` with a `convergence-auto-accept` governance entry rather than a re-posted "Review blocked" comment.

---

## Notes for the implementer

- **The Function App caches code aggressively** (Consumption plan). After deploy, if behavior looks stale, stop+start the app (not just restart) per the project's known-issues doc.
- **Only `convergence.js` is unit-testable** — the `agent-runner.js` changes are IO-bound inside the heartbeat loop and verified by `node --check` + the post-deploy manual trigger. Do not attempt to import `agent-runner.js` in a test; it pulls the whole heartbeat.
- **Do not touch** `index.js`, `company-state/index.js`, `staticwebapp.config.json`, `company-actions.json`, or the CI workflow — none are needed for this change.
- The pre-commit hook regenerates `api/_data/skills.json`; let it ride into each commit.
