# Editable Campaign & Objective Proposals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the CEO rename/edit the substantive fields of a pending campaign or objective proposal in the Actions drawer, persist via a validated endpoint, then approve the edited proposal.

**Architecture:** A new `POST /api/proposalEdit` endpoint (sibling to `proposalDecide`) validates a patch through a pure `validate.js` module and merges it into the matching pending `approvalQueue` entry. The Actions-page proposal drawers (`openProposalDrawer`, `openObjProposalDrawer`) render substantive fields as inputs plus a "Save changes" button that calls the endpoint; Approve/Reject are unchanged and act on the saved values.

**Tech Stack:** Azure Functions (Node.js, CommonJS), vanilla JS dashboard (`modules/company/actions.html`), Azure Blob state via `_utils/companyStorage`. Tests are plain `node script.js` files (assert), matching `api/companyHeartbeat/proposal-generator.test.js`.

**Spec:** `docs/superpowers/specs/2026-07-02-proposal-drawer-editing-design.md`

---

## File Structure

- `api/proposalEdit/validate.js` — **new**, pure. `validatePatch(type, patch) → {clean, error}`. No IO. The only place field rules live.
- `api/proposalEdit/validate.test.js` — **new**, `node`-runnable unit tests for the validator.
- `api/proposalEdit/index.js` — **new**, Azure Function. Auth, load queue, find pending entry, call `validatePatch`, merge, reconcile flag, persist, governance log.
- `api/proposalEdit/function.json` — **new**, HTTP trigger binding (POST/OPTIONS).
- `api/companyHeartbeat/helpers.js` — **modify**, add `'proposal-edited'` to `_GOVERNANCE_TYPES`.
- `modules/company/actions.html` — **modify**, editable inputs + Save button in `openProposalDrawer` and `openObjProposalDrawer`, new `saveProposalEdit()` + input-reader helpers.

---

## Task 1: Pure validator with tests

**Files:**
- Create: `api/proposalEdit/validate.js`
- Test: `api/proposalEdit/validate.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/proposalEdit/validate.test.js`:

```js
// Run with: node api/proposalEdit/validate.test.js
const assert = require('assert');
const { validatePatch } = require('./validate');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// ── allowlist ──
test('drops unknown keys (no error)', () => {
  const { clean, error } = validatePatch('campaign_proposal', { name: 'X', bogus: 1, id: 'hax', status: 'approved' });
  assert.strictEqual(error, null);
  assert.strictEqual(clean.name, 'X');
  assert.ok(!('bogus' in clean) && !('id' in clean) && !('status' in clean));
});

// ── required field ──
test('empty name is a hard error (campaign)', () => {
  const { error } = validatePatch('campaign_proposal', { name: '   ' });
  assert.ok(/name is required/i.test(error || ''));
});
test('empty title is a hard error (objective)', () => {
  const { error } = validatePatch('objective_proposal', { title: '' });
  assert.ok(/title is required/i.test(error || ''));
});
test('omitting name entirely is NOT an error (partial patch)', () => {
  const { clean, error } = validatePatch('campaign_proposal', { description: 'hi' });
  assert.strictEqual(error, null);
  assert.strictEqual(clean.description, 'hi');
  assert.ok(!('name' in clean));
});

// ── string clamps ──
test('name clamps to 100 chars', () => {
  const { clean } = validatePatch('campaign_proposal', { name: 'a'.repeat(200) });
  assert.strictEqual(clean.name.length, 100);
});
test('successCriteria clamps to 300', () => {
  const { clean } = validatePatch('objective_proposal', { successCriteria: 'b'.repeat(500) });
  assert.strictEqual(clean.successCriteria.length, 300);
});

// ── platforms ──
test('platforms filtered to valid social task types', () => {
  const { clean } = validatePatch('campaign_proposal', { platforms: ['social_x', 'social_facebook', 'garbage', 'social_bluesky'] });
  assert.deepStrictEqual(clean.platforms, ['social_x', 'social_bluesky']);
});
test('platforms that filter to empty are omitted (not blanked)', () => {
  const { clean } = validatePatch('campaign_proposal', { platforms: ['garbage'] });
  assert.ok(!('platforms' in clean));
});

// ── frequency / cadence ──
test('frequency clamps to [1,14] and coerces int', () => {
  assert.strictEqual(validatePatch('campaign_proposal', { frequency: 0 }).clean.frequency, 1);
  assert.strictEqual(validatePatch('campaign_proposal', { frequency: 99 }).clean.frequency, 14);
  assert.strictEqual(validatePatch('campaign_proposal', { frequency: '3' }).clean.frequency, 3);
});
test('bad frequency is omitted', () => {
  assert.ok(!('frequency' in validatePatch('campaign_proposal', { frequency: 'abc' }).clean));
});
test('cadence must be in the enum else omitted', () => {
  assert.strictEqual(validatePatch('campaign_proposal', { cadence: 'weekly' }).clean.cadence, 'weekly');
  assert.ok(!('cadence' in validatePatch('campaign_proposal', { cadence: 'hourly' }).clean));
});

// ── metric ──
test('metricTarget coerces number, rejects negatives/NaN', () => {
  assert.strictEqual(validatePatch('objective_proposal', { metricTarget: '101' }).clean.metricTarget, 101);
  assert.strictEqual(validatePatch('objective_proposal', { metricTarget: null }).clean.metricTarget, null);
  assert.ok(!('metricTarget' in validatePatch('objective_proposal', { metricTarget: -5 }).clean));
  assert.ok(!('metricTarget' in validatePatch('objective_proposal', { metricTarget: 'x' }).clean));
});
test('metricDeadline must be YYYY-MM-DD or null else omitted', () => {
  assert.strictEqual(validatePatch('objective_proposal', { metricDeadline: '2026-08-31' }).clean.metricDeadline, '2026-08-31');
  assert.strictEqual(validatePatch('objective_proposal', { metricDeadline: null }).clean.metricDeadline, null);
  assert.ok(!('metricDeadline' in validatePatch('objective_proposal', { metricDeadline: 'Aug 31' }).clean));
});
test('northStarMetric empty string becomes null', () => {
  assert.strictEqual(validatePatch('objective_proposal', { northStarMetric: '' }).clean.northStarMetric, null);
});

// ── unknown type ──
test('unknown proposal type returns error', () => {
  const { error } = validatePatch('budget_request', { name: 'x' });
  assert.ok(/not an editable proposal type/i.test(error || ''));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node api/proposalEdit/validate.test.js`
Expected: FAIL — `Cannot find module './validate'`.

- [ ] **Step 3: Write the validator**

Create `api/proposalEdit/validate.js`:

```js
'use strict';

// Pure validator for proposalEdit patches. No IO. Returns { clean, error }.
// `clean` contains only allow-listed, coerced fields (safe to Object.assign onto
// the queue entry). `error` is a non-null string only for a hard failure
// (unknown type, or a required field made empty); every other bad value is
// silently coerced or omitted so a typo never rejects the whole save.

var VALID_SOCIAL_TASK_TYPES = ['social_x', 'social_linkedin', 'social_bluesky'];
var VALID_CADENCE = ['daily', 'weekly', 'biweekly'];

function _str(v) { return v == null ? '' : String(v); }
function _clampStr(v, max) { return _str(v).slice(0, max); }

function _campaign(patch, clean) {
  if ('name' in patch) {
    var name = _str(patch.name).trim();
    if (!name) return 'name is required';
    clean.name = name.slice(0, 100);
  }
  if ('description' in patch) clean.description = _clampStr(patch.description, 1000);
  if ('duration' in patch) clean.duration = _clampStr(patch.duration, 50);
  if ('product' in patch) clean.product = _clampStr(patch.product, 50);
  if ('kpiTarget' in patch) clean.kpiTarget = _clampStr(patch.kpiTarget, 200);
  if ('northStarMetric' in patch) {
    var ns = _str(patch.northStarMetric).trim();
    clean.northStarMetric = ns ? ns.slice(0, 50) : null;
  }
  if ('platforms' in patch && Array.isArray(patch.platforms)) {
    var plats = patch.platforms.filter(function (p) { return VALID_SOCIAL_TASK_TYPES.indexOf(p) !== -1; });
    if (plats.length) clean.platforms = plats;
  }
  if ('frequency' in patch) {
    var f = Math.floor(Number(patch.frequency));
    if (Number.isFinite(f)) clean.frequency = Math.max(1, Math.min(14, f));
  }
  if ('cadence' in patch && VALID_CADENCE.indexOf(patch.cadence) !== -1) clean.cadence = patch.cadence;
  return null;
}

function _objective(patch, clean) {
  if ('title' in patch) {
    var title = _str(patch.title).trim();
    if (!title) return 'title is required';
    clean.title = title.slice(0, 100);
  }
  if ('description' in patch) clean.description = _clampStr(patch.description, 1000);
  if ('successCriteria' in patch) clean.successCriteria = _clampStr(patch.successCriteria, 300);
  if ('timeHorizon' in patch) clean.timeHorizon = _clampStr(patch.timeHorizon, 50);
  if ('northStarMetric' in patch) {
    var ns = _str(patch.northStarMetric).trim();
    clean.northStarMetric = ns ? ns.slice(0, 50) : null;
  }
  if ('metricTarget' in patch) {
    if (patch.metricTarget === null) clean.metricTarget = null;
    else {
      var n = Number(patch.metricTarget);
      if (Number.isFinite(n) && n >= 0) clean.metricTarget = n;
    }
  }
  if ('metricDeadline' in patch) {
    if (patch.metricDeadline === null) clean.metricDeadline = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(_str(patch.metricDeadline))) clean.metricDeadline = _str(patch.metricDeadline);
  }
  return null;
}

function validatePatch(type, patch) {
  var clean = {};
  patch = (patch && typeof patch === 'object') ? patch : {};
  var error = null;
  if (type === 'campaign_proposal') error = _campaign(patch, clean);
  else if (type === 'objective_proposal') error = _objective(patch, clean);
  else error = 'not an editable proposal type';
  if (error) return { clean: {}, error: error };
  return { clean: clean, error: null };
}

module.exports = { validatePatch: validatePatch, VALID_SOCIAL_TASK_TYPES: VALID_SOCIAL_TASK_TYPES, VALID_CADENCE: VALID_CADENCE };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/proposalEdit/validate.test.js`
Expected: PASS — `NN passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/proposalEdit/validate.js api/proposalEdit/validate.test.js
git commit -m "feat(proposalEdit): pure patch validator + unit tests"
```

---

## Task 2: The `proposalEdit` endpoint

**Files:**
- Create: `api/proposalEdit/function.json`
- Create: `api/proposalEdit/index.js`

Reference pattern: `api/proposalDecide/index.js` (auth, corsHeaders, queue read/write, governanceLog append).

- [ ] **Step 1: Create the function binding**

Create `api/proposalEdit/function.json`:

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post", "options"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

- [ ] **Step 2: Write the endpoint**

Create `api/proposalEdit/index.js`:

```js
// proposalEdit — POST /api/proposalEdit.
// Edit the substantive fields of a PENDING campaign/objective proposal in the
// approvalQueue. Validation is delegated to the pure ./validate module; this file
// is only auth + IO + governance logging. Never materializes — Approve still does
// that via the existing proposalDecide / client path.
const storage = require('../_utils/companyStorage');
const { validatePatch } = require('./validate');

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
  const patch = body.patch;
  if (!id) { context.res = { status: 400, headers: corsHeaders, body: { error: 'id required' } }; return; }
  if (!patch || typeof patch !== 'object') { context.res = { status: 400, headers: corsHeaders, body: { error: 'patch object required' } }; return; }

  try {
    const aq = (await storage.getState('approvalQueue')) || [];
    const target = aq.find(function (q) { return q && q.id === id; });
    if (!target) { context.res = { status: 404, headers: corsHeaders, body: { error: 'proposal not found' } }; return; }
    if (target.status !== 'pending') { context.res = { status: 409, headers: corsHeaders, body: { error: 'proposal not pending' } }; return; }
    if (target.type !== 'campaign_proposal' && target.type !== 'objective_proposal') {
      context.res = { status: 400, headers: corsHeaders, body: { error: 'not an editable proposal type' } };
      return;
    }

    const { clean, error } = validatePatch(target.type, patch);
    if (error) { context.res = { status: 400, headers: corsHeaders, body: { error: error } }; return; }

    const nowIso = new Date().toISOString();
    Object.assign(target, clean);
    target.editedAt = nowIso;
    target.editedBy = 'ceo';
    target._edited = true;

    // Metric-flag consistency (objective only): a filled north-star clears the
    // "serves no north star" flag; clearing it re-flags.
    if (target.type === 'objective_proposal') {
      target.strategyFlag = (target.northStarMetric && target.metricTarget != null) ? null : 'no-north-star-metric';
    }

    await storage.setState('approvalQueue', aq);

    // Observability (non-fatal): record the edit in the CEO-facing audit trail.
    try {
      const gl = (await storage.getState('governanceLog')) || [];
      gl.push({
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        type: 'proposal-edited',
        agentId: target.proposedBy || null,
        summary: 'CEO edited ' + target.type + ': ' + (target.title || target.name || target.id),
        timestamp: nowIso,
        details: { proposalId: target.id, proposalType: target.type, fields: Object.keys(clean) }
      });
      await storage.setState('governanceLog', gl.length > 5000 ? gl.slice(-5000) : gl);
    } catch (_glErr) { /* non-fatal */ }

    context.res = { status: 200, headers: corsHeaders, body: { ok: true, entry: target } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 300) } };
  }
};
```

- [ ] **Step 3: Verify the module loads (no syntax/require errors)**

Run: `node -e "require('./api/proposalEdit/index.js'); console.log('loads OK')"`
Expected: `loads OK`.

- [ ] **Step 4: Commit**

```bash
git add api/proposalEdit/function.json api/proposalEdit/index.js
git commit -m "feat(proposalEdit): POST endpoint to edit pending proposals"
```

---

## Task 3: Register `proposal-edited` as a governance type

**Files:**
- Modify: `api/companyHeartbeat/helpers.js` (the `_GOVERNANCE_TYPES` Set, ~line 249-259)

- [ ] **Step 1: Add the type**

In the `_GOVERNANCE_TYPES` Set, change the last line from:

```js
  'proposal-created', 'proposal-deferred', 'proposal-decided'
]);
```

to:

```js
  'proposal-created', 'proposal-deferred', 'proposal-decided', 'proposal-edited'
]);
```

- [ ] **Step 2: Verify helpers still loads**

Run: `node -e "require('./api/companyHeartbeat/helpers.js'); console.log('helpers OK')"`
Expected: `helpers OK`.

- [ ] **Step 3: Commit**

```bash
git add api/companyHeartbeat/helpers.js
git commit -m "feat(governance): route proposal-edited events to governanceLog"
```

---

## Task 4: Editable campaign drawer + Save

**Files:**
- Modify: `modules/company/actions.html` — `openProposalDrawer` (~line 1321-1352); add `saveProposalEdit` + input helpers nearby.

The drawer currently renders static text. Replace the field markup with inputs and add a Save button. Use `esc()` for pre-filled attribute values (already defined in the file).

- [ ] **Step 1: Add shared helpers (place directly above `openProposalDrawer`, ~line 1320)**

```js
    // Shared edit helpers for proposal drawers. _pinput builds a labeled input;
    // _pval reads a drawer field value by id. esc() is defined earlier in this file.
    function _pinput(id, label, value, opts) {
      opts = opts || {};
      var v = value == null ? '' : String(value);
      var ctl;
      if (opts.textarea) ctl = '<textarea id="' + id + '" rows="' + (opts.rows || 2) + '" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:6px;padding:0.4rem;font-size:var(--c-text-sm);">' + esc(v) + '</textarea>';
      else if (opts.select) {
        ctl = '<select id="' + id + '" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:6px;padding:0.4rem;">';
        opts.select.forEach(function (o) { ctl += '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; });
        ctl += '</select>';
      } else ctl = '<input id="' + id + '" type="' + (opts.type || 'text') + '" value="' + esc(v) + '" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:6px;padding:0.4rem;font-size:var(--c-text-sm);" />';
      return '<div style="margin-bottom:0.6rem;"><label style="display:block;font-size:var(--c-text-xs);color:rgba(255,255,255,0.5);margin-bottom:0.2rem;">' + esc(label) + '</label>' + ctl + '</div>';
    }
    function _pval(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function _pcheckboxes(id, label, options, selected) {
      selected = selected || [];
      var html = '<div style="margin-bottom:0.6rem;"><label style="display:block;font-size:var(--c-text-xs);color:rgba(255,255,255,0.5);margin-bottom:0.2rem;">' + esc(label) + '</label><div style="display:flex;gap:0.8rem;flex-wrap:wrap;">';
      options.forEach(function (o, i) {
        html += '<label style="font-size:var(--c-text-xs);color:#fff;display:flex;gap:0.25rem;align-items:center;"><input type="checkbox" id="' + id + '_' + i + '" value="' + esc(o) + '"' + (selected.indexOf(o) !== -1 ? ' checked' : '') + '/> ' + esc(o) + '</label>';
      });
      return html + '</div></div>';
    }
    function _pcheckboxVals(id, options) {
      var out = [];
      options.forEach(function (o, i) { var el = document.getElementById(id + '_' + i); if (el && el.checked) out.push(el.value); });
      return out;
    }
```

- [ ] **Step 2: Replace the campaign drawer body (from the `if (p.description)` block through the Details block, ~lines 1332-1345) with editable inputs**

Replace lines 1332-1345 (the description/rationale/Details render) with:

```js
      // Rationale + provenance stay read-only.
      if (p.rationale) {
        html += '<div class="act-drawer-section"><h4>Rationale</h4><p style="white-space:pre-wrap;font-size:var(--c-text-base);color:#a78bfa;">' + esc(p.rationale) + '</p></div>';
      }
      html += '<div class="act-drawer-section"><h4>Edit</h4>';
      html += _pinput('pe_name', 'Name', p.name);
      html += _pinput('pe_description', 'Description', p.description, { textarea: true, rows: 3 });
      html += _pcheckboxes('pe_platforms', 'Platforms', ['social_x', 'social_linkedin', 'social_bluesky'], p.platforms || []);
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">';
      html += _pinput('pe_frequency', 'Frequency (per period)', p.frequency, { type: 'number' });
      html += _pinput('pe_cadence', 'Cadence', p.cadence || 'weekly', { select: ['daily', 'weekly', 'biweekly'] });
      html += _pinput('pe_duration', 'Duration', p.duration);
      html += _pinput('pe_product', 'Product', p.product);
      html += '</div>';
      html += _pinput('pe_kpiTarget', 'KPI target', p.kpiTarget);
      html += _pinput('pe_northStarMetric', 'North-star metric', p.northStarMetric);
      html += '<div id="pe_msg" style="min-height:1rem;font-size:var(--c-text-xs);margin-top:0.3rem;"></div>';
      html += '</div>';
```

- [ ] **Step 3: Replace the campaign actions row (~lines 1346-1349) to add Save**

Replace with:

```js
      html += '<div class="act-drawer-actions" style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap;">';
      html += '<button class="act-btn act-btn--details" onclick="saveProposalEdit(\'' + p.id + '\',\'campaign_proposal\')"><i class="fas fa-save"></i> Save changes</button>';
      html += '<button class="act-btn act-btn--approve" onclick="approveCampaignProposal(\'' + p.id + '\')"><i class="fas fa-check"></i> Approve</button>';
      html += '<button class="act-btn act-btn--reject" onclick="rejectCampaignProposal(\'' + p.id + '\')"><i class="fas fa-times"></i> Reject</button>';
      html += '</div>';
```

- [ ] **Step 4: Add `saveProposalEdit` (place directly below `openProposalDrawer`, before the enrichment comment ~line 1354)**

```js
    // Persist drawer edits to the pending proposal, then update the cached entry
    // in place so Approve materializes the edited values. Sibling of proposalDecide.
    function saveProposalEdit(proposalId, type) {
      var msg = document.getElementById('pe_msg');
      var patch;
      if (type === 'campaign_proposal') {
        patch = {
          name: _pval('pe_name'),
          description: _pval('pe_description'),
          platforms: _pcheckboxVals('pe_platforms', ['social_x', 'social_linkedin', 'social_bluesky']),
          frequency: _pval('pe_frequency'),
          cadence: _pval('pe_cadence'),
          duration: _pval('pe_duration'),
          product: _pval('pe_product'),
          kpiTarget: _pval('pe_kpiTarget'),
          northStarMetric: _pval('pe_northStarMetric')
        };
      } else {
        patch = {
          title: _pval('pe_title'),
          description: _pval('pe_description'),
          successCriteria: _pval('pe_successCriteria'),
          northStarMetric: _pval('pe_northStarMetric'),
          metricTarget: _pval('pe_metricTarget') === '' ? null : _pval('pe_metricTarget'),
          metricDeadline: _pval('pe_metricDeadline') === '' ? null : _pval('pe_metricDeadline'),
          timeHorizon: _pval('pe_timeHorizon')
        };
      }
      if (msg) { msg.style.color = 'rgba(255,255,255,0.5)'; msg.textContent = 'Saving…'; }
      fetch(AE.getApiBase() + '/proposalEdit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher' },
        body: JSON.stringify({ id: proposalId, patch: patch })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) { if (msg) { msg.style.color = '#f87171'; msg.textContent = res.j.error || 'Save failed'; } return; }
          // Update the cached list entry in place.
          var lists = [window._campaignProposals, window._objectiveProposals];
          lists.forEach(function (lst) {
            if (!lst) return;
            for (var i = 0; i < lst.length; i++) { if (lst[i].id === proposalId) { lst[i] = res.j.entry; } }
          });
          if (msg) { msg.style.color = '#34d399'; msg.textContent = 'saved ✓'; }
          renderCampaignProposals();
          renderObjectiveProposals();
        })
        .catch(function (e) { if (msg) { msg.style.color = '#f87171'; msg.textContent = 'Network error: ' + e.message; } });
    }
```

- [ ] **Step 5: Verify `AE.getApiBase` exists (used for the fetch base)**

Run: `grep -n "getApiBase" js/agent-engine.js modules/company/actions.html | head`
Expected: at least one definition/usage. If `AE.getApiBase` is not exposed, use the same api-base expression the file already uses for other `fetch` calls (e.g. the `apiBase` variable used by `doApprove`/pixel-agent-approve near line 1718) — grep `apiBase` in `actions.html` and reuse that identifier instead.

- [ ] **Step 6: Manual smoke — open the page, edit a campaign proposal, Save**

Load the Actions page (production or `swa start`), open a pending campaign proposal, change the name + check a platform, click Save. Expect "saved ✓". Then:

Run: `node -e "fetch('https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=approvalQueue',{headers:{'x-company-secret':'pixelpusher'}}).then(r=>r.json()).then(q=>{const a=(q.value||q).find(x=>x._edited);console.log(a?{id:a.id,name:a.name,editedBy:a.editedBy,platforms:a.platforms}:'no edited entry yet');})"`
Expected: the edited entry with `editedBy: 'ceo'` and your new values.

- [ ] **Step 7: Commit**

```bash
git add modules/company/actions.html
git commit -m "feat(actions): editable campaign proposal drawer + saveProposalEdit"
```

---

## Task 5: Editable objective drawer

**Files:**
- Modify: `modules/company/actions.html` — `openObjProposalDrawer` (~line 1551-1580)

Reuses `_pinput`/`_pval` (Task 4 Step 1) and `saveProposalEdit` (Task 4 Step 4), which already handles the `objective_proposal` branch.

- [ ] **Step 1: Replace the objective drawer body (Details block, ~lines 1562-1573) with editable inputs**

Replace lines 1562-1573 (description/rationale/Details render) with:

```js
      if (p.rationale) html += '<div class="act-drawer-section"><h4>Rationale</h4><p style="white-space:pre-wrap;font-size:var(--c-text-base);color:#60a5fa;">' + esc(p.rationale) + '</p></div>';
      html += '<div class="act-drawer-section"><h4>Edit</h4>';
      html += _pinput('pe_title', 'Title', p.title);
      html += _pinput('pe_description', 'Description', p.description, { textarea: true, rows: 3 });
      html += _pinput('pe_successCriteria', 'Success criteria', p.successCriteria, { textarea: true, rows: 2 });
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">';
      html += _pinput('pe_northStarMetric', 'North-star metric', p.northStarMetric);
      html += _pinput('pe_metricTarget', 'Metric target', p.metricTarget, { type: 'number' });
      html += _pinput('pe_metricDeadline', 'Metric deadline', p.metricDeadline, { type: 'date' });
      html += _pinput('pe_timeHorizon', 'Time horizon', p.timeHorizon);
      html += '</div>';
      html += '<div id="pe_msg" style="min-height:1rem;font-size:var(--c-text-xs);margin-top:0.3rem;"></div>';
      html += '</div>';
```

- [ ] **Step 2: Replace the objective actions row (~lines 1574-1577) to add Save**

Replace with:

```js
      html += '<div class="act-drawer-actions" style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap;">';
      html += '<button class="act-btn act-btn--details" onclick="saveProposalEdit(\'' + p.id + '\',\'objective_proposal\')"><i class="fas fa-save"></i> Save changes</button>';
      html += '<button class="act-btn act-btn--approve" onclick="approveObjectiveProposal(\'' + p.id + '\')"><i class="fas fa-check"></i> Approve</button>';
      html += '<button class="act-btn act-btn--reject" onclick="rejectObjectiveProposal(\'' + p.id + '\')"><i class="fas fa-times"></i> Reject</button>';
      html += '</div>';
```

- [ ] **Step 3: Manual smoke — edit an objective proposal, Save**

Open a pending objective proposal, rename it and change the metric target, click Save. Expect "saved ✓". Confirm via:

Run: `node -e "fetch('https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=approvalQueue',{headers:{'x-company-secret':'pixelpusher'}}).then(r=>r.json()).then(q=>{const a=(q.value||q).find(x=>x.type==='objective_proposal'&&x._edited);console.log(a?{id:a.id,title:a.title,metricTarget:a.metricTarget,strategyFlag:a.strategyFlag}:'no edited objective yet');})"`
Expected: the edited objective with the new title + `metricTarget`, and `strategyFlag: null` when a north-star + target are set.

- [ ] **Step 4: Commit**

```bash
git add modules/company/actions.html
git commit -m "feat(actions): editable objective proposal drawer"
```

---

## Task 6: Full verification + deploy

- [ ] **Step 1: Re-run the validator suite**

Run: `node api/proposalEdit/validate.test.js`
Expected: `NN passed, 0 failed`.

- [ ] **Step 2: Confirm all new modules load**

Run: `node -e "require('./api/proposalEdit/index.js'); require('./api/proposalEdit/validate.js'); require('./api/companyHeartbeat/helpers.js'); console.log('all load OK')"`
Expected: `all load OK`.

- [ ] **Step 3: End-to-end against a pending proposal (edit → confirm → approve)**

With a real pending proposal id, POST an edit, confirm the queue entry changed, then approve via the existing UI and confirm the materialized entity reflects the edit. (Do the approve from the dashboard so the existing client materialize path runs.)

- [ ] **Step 4: Commit any fixups, then deploy**

```bash
git push origin master
```

Deploy verification: after GitHub Actions completes, load the Actions page, open a proposal, confirm the Edit fields render and Save works end-to-end.

---

## Self-Review Notes

- **Spec coverage:** endpoint (Task 2) · pure validator (Task 1) · governance type (Task 3) · campaign drawer + Save (Task 4) · objective drawer (Task 5) · validation rules (Task 1 tests) · testing (Tasks 1, 4, 5, 6). All spec sections mapped.
- **Type consistency:** `validatePatch(type, patch) → {clean, error}` used identically in Task 1 and Task 2. `saveProposalEdit(proposalId, type)` defined in Task 4 Step 4, called with matching `('id','campaign_proposal'|'objective_proposal')` in Tasks 4 & 5. Input ids (`pe_*`) match between render (Tasks 4/5) and read (`_pval`/`_pcheckboxVals` in Task 4 Step 4).
- **Open assumption flagged in-plan:** Task 4 Step 5 verifies the api-base identifier (`AE.getApiBase` vs the file's existing `apiBase`) before relying on it — the one spot where the exact call may differ from what's shown.
