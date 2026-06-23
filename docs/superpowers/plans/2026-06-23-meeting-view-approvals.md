# Meeting-View Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the CEO approve/reject a meeting's strategic output (campaign/objective/task proposals) directly from the Meetings dashboard, backed by a new reusable server endpoint that materializes the real entity.

**Architecture:** A new `POST /api/proposalDecide` endpoint with a pure, unit-tested `materializeFromProposal` helper (campaign→campaigns, objective→objectives, task→tasks) and a pure `isLiveDuplicate` dedup guard. The agentic-meeting orchestrator stamps `proposalId` onto each routed strategic candidate so the UI can target the exact queue entry. The Meetings page render block expands each convened meeting to its passed candidates with approve/reject/decided states.

**Tech Stack:** Node.js (Azure Functions, CommonJS), existing `_utils/companyStorage`, plain `node` + `assert` tests (mirrors `proposal-generator.test.js`). Reuses the `approveProposal` decisionLog-mirror pattern and the Actions-page campaign/objective field mapping.

**Reference spec:** `docs/superpowers/specs/2026-06-23-meeting-view-approvals-design.md`

---

## File Structure

- Create: `api/proposalDecide/materialize.js` — pure helpers `materializeFromProposal(proposal, nowIso)` + `isLiveDuplicate(stateKey, title, existing)`.
- Create: `api/proposalDecide/materialize.test.js` — node `assert` tests for both helpers.
- Create: `api/proposalDecide/index.js` + `function.json` — `POST /api/proposalDecide` handler (I/O glue around the pure helpers).
- Modify: `api/companyMeeting/meeting-core.js` — stamp `candidate.proposalId` when routing a strategic proposal.
- Modify: `api/companyMeeting/meeting-core.test.js` — assert the stamp.
- Modify: `modules/company/meetings.html` — expand the render block: per-candidate approve/reject/decided; add the decide handler.

**Auth:** `x-company-secret` (or `x-ms-client-principal`), same as `approveProposal`.
**Reads:** `approvalQueue` is a `company-state` VALID_KEY (the Actions page already reads it client-side).

---

## Task 1: Pure materialize + dedup helpers

**Files:**
- Create: `api/proposalDecide/materialize.js`
- Test: `api/proposalDecide/materialize.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/proposalDecide/materialize.test.js`:

```js
// Run with: node api/proposalDecide/materialize.test.js
const assert = require('assert');
const { materializeFromProposal, isLiveDuplicate } = require('./materialize');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const NOW = '2026-06-23T12:00:00.000Z';

// ── materializeFromProposal ──
test('campaign_proposal → campaigns entity', () => {
  const m = materializeFromProposal({ id: 'mprop_1', type: 'campaign_proposal', name: 'Beacon Launch', description: 'd', proposedBy: 'echo' }, NOW);
  assert.strictEqual(m.stateKey, 'campaigns');
  assert.ok(/^camp-/.test(m.entity.id));
  assert.strictEqual(m.entity.title, 'Beacon Launch');
  assert.strictEqual(m.entity.status, 'active');
  assert.strictEqual(m.entity.source, 'meeting');
  assert.strictEqual(m.entity.proposalId, 'mprop_1');
});
test('objective_proposal → objectives entity', () => {
  const m = materializeFromProposal({ id: 'mprop_2', type: 'objective_proposal', title: 'Grow Bluesky', description: 'd' }, NOW);
  assert.strictEqual(m.stateKey, 'objectives');
  assert.ok(/^obj-/.test(m.entity.id));
  assert.strictEqual(m.entity.status, 'active');
  assert.strictEqual(m.entity.progress, 0);
  assert.strictEqual(m.entity.proposalId, 'mprop_2');
});
test('task_proposal → tasks entity', () => {
  const m = materializeFromProposal({ id: 'mprop_3', type: 'task_proposal', title: 'Audit blockers', proposedBy: 'cipher', meetingId: 'amtg-9' }, NOW);
  assert.strictEqual(m.stateKey, 'tasks');
  assert.ok(/^task-/.test(m.entity.id));
  assert.strictEqual(m.entity.status, 'todo');
  assert.strictEqual(m.entity.assignee, 'cipher');
  assert.strictEqual(m.entity.meetingId, 'amtg-9');
  assert.strictEqual(m.entity.source, 'meeting');
});
test('task_proposal assignee falls back to nova', () => {
  const m = materializeFromProposal({ id: 'x', type: 'task_proposal', title: 't' }, NOW);
  assert.strictEqual(m.entity.assignee, 'nova');
});
test('unknown type → null (status-flip only)', () => {
  assert.strictEqual(materializeFromProposal({ id: 'x', type: 'social_proposal', title: 't' }, NOW), null);
  assert.strictEqual(materializeFromProposal({ id: 'x', type: 'product_proposal', title: 't' }, NOW), null);
});

// ── isLiveDuplicate ──
test('campaign dup by normalized title against a live campaign', () => {
  const existing = [{ title: 'Beacon Launch', status: 'active' }];
  assert.strictEqual(isLiveDuplicate('campaigns', 'beacon   launch', existing), true);
});
test('campaign not a dup against an archived campaign', () => {
  const existing = [{ title: 'Beacon Launch', status: 'archived' }];
  assert.strictEqual(isLiveDuplicate('campaigns', 'Beacon Launch', existing), false);
});
test('objective dup honors objective live statuses', () => {
  assert.strictEqual(isLiveDuplicate('objectives', 'Grow X', [{ title: 'Grow X', status: 'at_risk' }]), true);
  assert.strictEqual(isLiveDuplicate('objectives', 'Grow X', [{ title: 'Grow X', status: 'complete' }]), false);
});
test('tasks never dedup', () => {
  assert.strictEqual(isLiveDuplicate('tasks', 'Audit blockers', [{ title: 'Audit blockers', status: 'todo' }]), false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/proposalDecide/materialize.test.js`
Expected: FAIL — `Cannot find module './materialize'`.

- [ ] **Step 3: Write the implementation**

Create `api/proposalDecide/materialize.js`:

```js
'use strict';

// Live-entity statuses that block a duplicate (mirrors the Actions-page guards).
const LIVE_STATUSES = {
  campaigns: ['active', 'paused', 'complete', 'completed'],
  objectives: ['active', 'on_track', 'at_risk', 'behind']
};

function _norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function _ts(nowIso) { const t = Date.parse(nowIso); return Number.isFinite(t) ? t : 0; }
function _id(prefix, nowIso) { return prefix + _ts(nowIso).toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

// Build the real entity a CEO-approved proposal should create. Returns
// { stateKey, entity } or null for types we don't materialize (status-flip only).
function materializeFromProposal(proposal, nowIso) {
  const p = proposal || {};
  const title = p.title || p.name || '';
  if (p.type === 'campaign_proposal') {
    const weeks = parseInt(p.duration, 10) || 0;
    const endDate = weeks > 0 ? new Date(_ts(nowIso) + weeks * 7 * 86400000).toISOString().slice(0, 10) : null;
    return { stateKey: 'campaigns', entity: {
      id: _id('camp-', nowIso),
      title: title,
      description: p.description || '',
      status: 'active',
      startDate: String(nowIso).slice(0, 10),
      endDate: endDate,
      allowedTaskTypes: p.platforms || [],
      frequency: p.frequency || 2,
      cadence: p.cadence || 'weekly',
      northStarMetric: p.northStarMetric || null,
      objective_id: p.objective_id || p.objectiveId || p.suggestedObjectiveId || null,
      source: 'meeting',
      proposalId: p.id,
      createdAt: nowIso
    } };
  }
  if (p.type === 'objective_proposal') {
    const hasCriteria = p.northStarMetric && isFinite(Number(p.metricTarget)) && Number(p.metricTarget) > 0 && p.metricDeadline;
    return { stateKey: 'objectives', entity: {
      id: _id('obj-', nowIso),
      title: title,
      description: p.description || '',
      status: 'active',
      progress: 0,
      successCriteria: p.successCriteria || '',
      timeHorizon: p.timeHorizon || '',
      northStarMetric: p.northStarMetric || null,
      criteria: hasCriteria ? { metric: p.northStarMetric, target: Number(p.metricTarget), by: p.metricDeadline, baseline: null } : null,
      source: 'meeting',
      proposalId: p.id,
      createdAt: nowIso
    } };
  }
  if (p.type === 'task_proposal') {
    return { stateKey: 'tasks', entity: {
      id: _id('task-', nowIso),
      title: title,
      description: p.description || '',
      taskType: 'general',
      status: 'todo',
      priority: 'medium',
      assignee: p.proposedBy || 'nova',
      objective_id: null,
      source: 'meeting',
      meetingId: p.meetingId || null,
      created_by: p.proposedBy || 'nova',
      createdAt: nowIso,
      updatedAt: nowIso
    } };
  }
  return null;
}

// True if a live entity with the same normalized title already exists in `existing`.
// Tasks are never deduped (stateKey not in LIVE_STATUSES).
function isLiveDuplicate(stateKey, title, existing) {
  const live = LIVE_STATUSES[stateKey];
  if (!live) return false;
  const n = _norm(title);
  return (existing || []).some(function (e) {
    return e && live.indexOf(e.status) !== -1 && _norm(e.title || e.name) === n;
  });
}

module.exports = { materializeFromProposal, isLiveDuplicate, LIVE_STATUSES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/proposalDecide/materialize.test.js`
Expected: PASS (10 passed, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add api/proposalDecide/materialize.js api/proposalDecide/materialize.test.js
git commit -m "feat(meetings): materialize + dedup helpers for proposal approval"
```

---

## Task 2: `proposalDecide` endpoint

**Files:**
- Create: `api/proposalDecide/function.json`
- Create: `api/proposalDecide/index.js`

The handler is thin I/O glue around the Task 1 pure helpers; it is validated by a load check here and the post-deploy smoke in Task 5 (the pure logic is already unit-tested).

- [ ] **Step 1: Create `function.json`**

```json
{
  "bindings": [
    { "authLevel": "anonymous", "type": "httpTrigger", "direction": "in", "name": "req", "methods": ["post", "options"], "route": "proposalDecide" },
    { "type": "http", "direction": "out", "name": "res" }
  ]
}
```

- [ ] **Step 2: Create `index.js`**

```js
// proposalDecide — POST /api/proposalDecide.
// Approve/reject a queued meeting proposal. On approve, materializes the real
// entity (campaign/objective/task) and flips the approvalQueue entry. On reject,
// flips status + records a decisionLog mirror (same shape approveProposal writes).
const storage = require('../_utils/companyStorage');
const { materializeFromProposal, isLiveDuplicate } = require('./materialize');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: corsHeaders, body: { error: 'Unauthorized' } };
    return;
  }

  const body = req.body || {};
  const id = String(body.id || '').trim();
  const decision = body.decision;
  const ceoNote = String(body.ceoNote || '').trim().slice(0, 500);
  if (!id) { context.res = { status: 400, headers: corsHeaders, body: { error: 'id required' } }; return; }
  if (decision !== 'approved' && decision !== 'rejected') {
    context.res = { status: 400, headers: corsHeaders, body: { error: 'decision must be approved or rejected' } };
    return;
  }

  try {
    const aq = (await storage.getState('approvalQueue')) || [];
    const target = aq.find(function (q) { return q && q.id === id && q.status === 'pending'; });
    if (!target) { context.res = { status: 404, headers: corsHeaders, body: { error: 'proposal not found or not pending' } }; return; }

    const nowIso = new Date().toISOString();
    let created = null;

    if (decision === 'approved') {
      const mat = materializeFromProposal(target, nowIso);
      if (mat && mat.stateKey) {
        let existing = (await storage.getState(mat.stateKey)) || [];
        if (!Array.isArray(existing)) existing = [];
        if (!isLiveDuplicate(mat.stateKey, mat.entity.title, existing)) {
          existing.push(mat.entity);
          await storage.setState(mat.stateKey, existing);
          created = mat.entity;
        }
      }
      target.status = 'approved';
      target.approvedAt = nowIso;
      target.resolvedBy = 'ceo';
      if (ceoNote) target.ceoNote = ceoNote;
      await storage.setState('approvalQueue', aq);
    } else {
      target.status = 'rejected';
      target.rejectedAt = nowIso;
      target.resolvedBy = 'ceo';
      if (ceoNote) target.rejectionNote = ceoNote;
      await storage.setState('approvalQueue', aq);
      // Mirror rejection into capitalAllocation.decisionLog (non-fatal).
      try {
        const alloc = (await storage.getState('capitalAllocation')) || {};
        const logArr = Array.isArray(alloc.decisionLog) ? alloc.decisionLog : [];
        logArr.push({
          id: 'dlog_' + Date.now() + '_pr_' + Math.random().toString(36).slice(2, 6),
          agentId: target.proposedBy || 'nova',
          decisionBy: 'ceo', action: 'rejected',
          estimatedCost: Number.isFinite(target.estimatedCost) ? target.estimatedCost : null,
          reason: ceoNote, at: nowIso, proposalId: target.id, proposalType: target.type
        });
        alloc.decisionLog = logArr.slice(-100);
        alloc.updatedAt = nowIso;
        await storage.setState('capitalAllocation', alloc);
      } catch (_e) { /* non-fatal */ }
    }

    context.res = { status: 200, headers: corsHeaders, body: { ok: true, entry: target, created: created } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 300) } };
  }
};
```

- [ ] **Step 3: Verify it loads**

Run: `node -e "require('./api/proposalDecide'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add api/proposalDecide/index.js api/proposalDecide/function.json
git commit -m "feat(meetings): proposalDecide endpoint (materialize + flip)"
```

---

## Task 3: Stamp `proposalId` on routed strategic candidates

**Files:**
- Modify: `api/companyMeeting/meeting-core.js`
- Test: `api/companyMeeting/meeting-core.test.js`

- [ ] **Step 1: Add the failing assertion**

In `api/companyMeeting/meeting-core.test.js`, inside the existing `testA('runAgenticMeeting routes internal→tasks and strategic→approvalQueue', …)` block, add these assertions right before its closing `});`:

```js
  // strategic candidate carries the proposalId of its queued approvalQueue entry
  const strat = rec.candidates.find(function (c) { return c.passed && c.blastRadius === 'strategic'; });
  assert.ok(strat && strat.proposalId, 'strategic candidate should carry proposalId');
  assert.ok(storage._state.approvalQueue.some(function (q) { return q.id === strat.proposalId; }), 'proposalId should match a queued entry');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — `strategic candidate should carry proposalId`.

- [ ] **Step 3: Stamp the id during routing**

In `api/companyMeeting/meeting-core.js`, find this block (in `runAgenticMeeting`, the strategic routing loop):

```js
    passed.filter(function (c) { return c.blastRadius === 'strategic'; }).forEach(function (c) {
      const p = _routeStrategicProposal(c, meetingStub, nowIso); aq.push(p); proposalsQueued.push(p.id);
    });
```

Replace it with (adds the `c.proposalId = p.id;` stamp):

```js
    passed.filter(function (c) { return c.blastRadius === 'strategic'; }).forEach(function (c) {
      const p = _routeStrategicProposal(c, meetingStub, nowIso); aq.push(p); proposalsQueued.push(p.id);
      c.proposalId = p.id;
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS (27 passed, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): stamp proposalId onto routed strategic candidates"
```

---

## Task 4: Meeting-view — expand passed candidates with approve/reject/decided

**Files:**
- Modify: `modules/company/meetings.html`

The render block already exists (the `<script>` after `<!-- Agentic Meeting: button …`). This task replaces the `renderMeetings` function with one that also fetches `approvalQueue`, expands each convened meeting's passed candidates, and adds a delegated approve/reject handler.

- [ ] **Step 1: Replace the `renderMeetings` function**

In `modules/company/meetings.html`, find the existing `function renderMeetings() { … }` (inside the Agentic Meeting IIFE) and replace the WHOLE function with:

```js
      function _aqMap() {
        return fetch(apiBase + '/company-state?key=approvalQueue', { headers: hdrs() })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            var q = (d && (d.value || d)) || [];
            if (!Array.isArray(q)) q = [];
            var map = {};
            q.forEach(function (e) { if (e && e.id) map[e.id] = e.status || 'pending'; });
            return map;
          }).catch(function () { return {}; });
      }

      function _candidateRow(c, aq) {
        var title = esc((c.title || '').slice(0, 80));
        if (c.blastRadius !== 'strategic') {
          return '<div class="am-cand"><span class="am-cand-title">' + title + '</span>'
            + '<span class="am-tag am-tag--done">✓ auto-created task</span></div>';
        }
        var status = c.proposalId ? (aq[c.proposalId] || 'pending') : 'pending';
        var actions;
        if (status === 'approved') actions = '<span class="am-tag am-tag--ok">Approved</span>';
        else if (status === 'rejected') actions = '<span class="am-tag am-tag--no">Rejected</span>';
        else if (!c.proposalId) actions = '<span class="am-tag">queued</span>';
        else actions = '<button class="am-btn am-approve" data-id="' + esc(c.proposalId) + '">Approve</button>'
          + '<button class="am-btn am-reject" data-id="' + esc(c.proposalId) + '">Reject</button>';
        return '<div class="am-cand"><span class="am-cand-title">' + title + '</span>'
          + '<span class="am-cand-kind">' + esc(c.kind) + '</span>' + actions + '</div>';
      }

      function renderMeetings() {
        Promise.all([
          fetch(apiBase + '/meetingsRead', { headers: hdrs() }).then(function (r) { return r.json(); }).catch(function () { return null; }),
          _aqMap()
        ]).then(function (res) {
          var list = (res[0] && res[0].meetings) || [];
          var aq = res[1] || {};
          if (!list.length) { listEl.innerHTML = '<p style="opacity:.6;font-size:.85rem;">No agentic meetings yet.</p>'; return; }
          listEl.innerHTML = list.slice(0, 10).map(function (m) {
            var when = esc((m.createdAt || '').slice(0, 16).replace('T', ' '));
            if (!m.convened) {
              return '<div class="am-meeting am-meeting--skip"><strong>No meeting needed</strong> <span class="am-meta">· ' + when + ' · ' + esc(m.reason || '') + '</span></div>';
            }
            var cands = m.candidates || [];
            var passedList = cands.filter(function (c) { return c.passed; });
            var rejected = cands.length - passedList.length;
            var topics = (m.agenda || []).map(function (a) { return esc(a.topic); }).join(', ') || '(agenda)';
            var rows = passedList.map(function (c) { return _candidateRow(c, aq); }).join('');
            return '<div class="am-meeting"><div class="am-meeting-head"><strong>' + topics + '</strong>'
              + '<div class="am-meta">' + when + ' · ' + cands.length + ' proposed · ' + passedList.length + ' passed'
              + (rejected > 0 ? (' · ' + rejected + ' rejected by vote') : '') + '</div></div>'
              + (rows || '<div class="am-meta" style="padding:.25rem .1rem;">No items passed.</div>') + '</div>';
          }).join('');
        });
      }

      function _decide(id, decision, note) {
        var b = { id: id, decision: decision };
        if (note) b.ceoNote = note;
        statusEl.textContent = (decision === 'approved' ? 'Approving…' : 'Rejecting…');
        return fetch(apiBase + '/proposalDecide', { method: 'POST', headers: hdrs(), body: JSON.stringify(b) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            statusEl.textContent = d && d.ok ? (decision === 'approved' ? 'Approved.' : 'Rejected.') : ('Error: ' + ((d && d.error) || 'unknown'));
            renderMeetings();
          })
          .catch(function (e) { statusEl.textContent = 'Request failed: ' + e.message; });
      }

      listEl.addEventListener('click', function (e) {
        var ap = e.target.closest('.am-approve');
        var rj = e.target.closest('.am-reject');
        if (ap) { _decide(ap.getAttribute('data-id'), 'approved'); }
        else if (rj) { var note = window.prompt('Rejection note (optional):') || ''; _decide(rj.getAttribute('data-id'), 'rejected', note); }
      });
```

- [ ] **Step 2: Add the panel styles**

`meetings.html` has no inline `<style>` block — add a new scoped one. Find the line:

```html
  <!-- Agentic Meeting: button → trigger, toggle → systemConfig, render from meetingsRead -->
```

and insert this `<style>` block on the line immediately BEFORE it:

```html
  <style id="agentic-meeting-styles">
.am-meeting { padding:.55rem .7rem; margin-bottom:.5rem; border-left:3px solid var(--glow-teal,#2dd4bf); background:rgba(255,255,255,.03); border-radius:4px; }
.am-meeting--skip { border-left-color:var(--mood-border,#3a3a4a); }
.am-meeting-head { margin-bottom:.35rem; }
.am-meta { opacity:.7; font-size:.78rem; }
.am-cand { display:flex; align-items:center; gap:.5rem; padding:.3rem 0; border-top:1px solid rgba(255,255,255,.06); }
.am-cand-title { flex:1; font-size:.85rem; }
.am-cand-kind { font-size:.7rem; opacity:.6; text-transform:uppercase; letter-spacing:.04em; }
.am-tag { font-size:.72rem; padding:.1rem .45rem; border-radius:10px; background:rgba(255,255,255,.08); opacity:.85; }
.am-tag--done { color:#9ca3af; }
.am-tag--ok { background:rgba(34,197,94,.18); color:#4ade80; }
.am-tag--no { background:rgba(239,68,68,.18); color:#f87171; }
.am-btn { font-size:.72rem; padding:.18rem .6rem; border-radius:5px; border:none; cursor:pointer; }
.am-approve { background:rgba(34,197,94,.2); color:#4ade80; }
.am-reject { background:rgba(239,68,68,.2); color:#f87171; }
  </style>
```

- [ ] **Step 3: Compile-check the page scripts**

Run:
```bash
node -e "const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('modules/company/meetings.html','utf8');const re=/<script\b[^>]*>([\s\S]*?)<\/script>/gi;let m,i=0,bad=0;while((m=re.exec(h))){i++;if(!m[1].trim()||/\bsrc=/.test(m[0]))continue;try{new vm.Script(m[1]);}catch(e){bad++;console.log('ERR#'+i,e.message);}}console.log(i+' scripts, '+bad+' errors');"
```
Expected: `N scripts, 0 errors`.

- [ ] **Step 4: Commit**

```bash
git add modules/company/meetings.html
git commit -m "feat(meetings): expand meeting view with approve/reject/decided per candidate"
```

---

## Task 5: Full-suite verification + deploy + smoke

- [ ] **Step 1: Run the affected test suites**

Run:
```bash
node api/proposalDecide/materialize.test.js
node api/companyMeeting/meeting-core.test.js
```
Expected: `10 passed, 0 failed` and `27 passed, 0 failed`.

- [ ] **Step 2: Confirm endpoints load**

Run:
```bash
node -e "require('./api/proposalDecide');require('./api/companyMeeting/meeting-core');console.log('all load ok')"
```
Expected: `all load ok`.

- [ ] **Step 3: Confirm no high-blast-radius files changed**

Run: `git diff --name-only 3eb52a27..HEAD | grep -E "companyHeartbeat/index.js|company-state/index.js|staticwebapp.config.json|data/company-actions.json|approveProposal/" && echo "!! PROTECTED FILE TOUCHED" || echo "clean — no protected files touched"`
Expected: `clean — no protected files touched`.

- [ ] **Step 4: Push to deploy**

```bash
git push origin master
```

- [ ] **Step 5: Post-deploy smoke (after CI/CD finishes)**

Wait for `/api/proposalDecide` to return non-404, then approve one pending meeting proposal end-to-end:
```bash
# readiness (404 → not live yet; 400/403 → live)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/proposalDecide" -H "x-company-secret: pixelpusher" -H "Content-Type: application/json" -d '{}'
# pick a pending meeting proposal id from the approval queue, then approve it:
#   curl -sX POST ".../api/proposalDecide" -H "x-company-secret: pixelpusher" -H "Content-Type: application/json" \
#     -d '{"id":"<mprop_id>","decision":"approved"}' | head -c 400
```
Expected: a `{ "ok": true, "entry": {…,"status":"approved"}, "created": {…} }`, and the Meetings page shows that candidate flipped to a green **Approved** badge.

---

## Self-Review notes (for the implementer)

- **`materializeFromProposal` mirrors the Actions-page mapping** (`approveCampaignProposal` at `modules/company/actions.html:1354`, `approveObjectiveProposal` at `:1521`) but sets `source:'meeting'`. If the Actions page later adopts `proposalDecide`, keep the two in sync or delete the client copies.
- **Decided-state reading** depends on `approvalQueue` being a `company-state` VALID_KEY — it is (the Actions page already reads it). No new read endpoint needed.
- **Idempotency:** `proposalDecide` only acts on a `pending` entry; a double-click / re-POST returns 404 (already resolved), and the UI re-render shows the Approved/Rejected badge instead of buttons.
- **Dedup is fail-safe:** if a live campaign/objective with the same title exists, the entity isn't re-created but the proposal still flips to `approved` (matches Actions-page behavior).
