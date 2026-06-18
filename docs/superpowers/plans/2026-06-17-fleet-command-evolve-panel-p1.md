# Fleet Command — Evolve Panel, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `window.prompt()` evolve flow in `fleet.html` with a guided, prefilled Evolve modal (segmented pickers, slider, action-mix matrix, chip editor, live diff) and two apply paths, plus expand the roster card toward the approved "character sheet" direction.

**Architecture:** Frontend-only. Pure logic + HTML builders live in a new, node-testable module `modules/company/fleet-evolve.js` (UMD: `window.FleetEvolve` in the browser, `module.exports` under Node). `fleet.html` mounts the modal, wires events, and calls the existing `/api/fleetProposalCreate` and `/api/approveProposal` endpoints. No backend changes.

**Tech Stack:** Vanilla JS (ES5-compatible, matching `fleet.html`), Node's built-in `node:test`/`node:assert` for unit tests (Node 24, zero dependencies). Company dashboard design system (`--color-*` tokens, dark theme, amber accent).

**Spec:** `docs/superpowers/specs/2026-06-17-fleet-command-evolve-panel-design.md`

**Scope note:** This is Phase 1 (core modal + card). Phase 2 (alignment/budget/XP stats) and Phase 3 (lineage drawer + archetype refinement) ship as their own plans afterward. P1 is independently shippable: it fully replaces the broken prompt flow.

---

## Backend contract (do not change — frontend conforms to this)

`POST /api/fleetProposalCreate` body:
```json
{ "type": "agent_evolution_proposal", "proposedBy": "ceo",
  "evolution": { "targetAgent": "scribe", "changes": { /* only changed fields */ },
                 "rationale": "…", "estimatedCostDelta": 0.5 } }
```
- `changes` allowed keys: `focus` (string), `monthlyCap` (number, `0 < cap ≤ 5.00`), `doctrine` (`{strategicBias,riskTolerance,timeHorizon,coreQuestion,escalationTriggers[]}`), `expectedActionMix` (`{action: 'high'|'medium'|'low'|'none'}`). At least one required.
- Protected keys (server rejects if present): `id,name,tier,status,hiredAt,retiredAt,reportsTo`.
- `doctrine` and `expectedActionMix` are replaced wholesale on apply — so when either changes, send the **complete merged object**, never a partial.
- Response: `{ ok, id, ... }` where `id` is the new proposal id.

`POST /api/approveProposal` body: `{ "id": "<proposalId>", "decision": "approved", "ceoNote": "…" }` → applies the evolution, writes a `doctrineHistory` snapshot.

Agent object shape (from `agentRegistry`, already loaded by `loadAll()`): `{ id, name, role, tier, status, reportsTo, focus, monthlyCap, doctrine:{…}, expectedActionMix:{…}, doctrineHistory:[] }`.

---

## File Structure

- **Create** `modules/company/fleet-evolve.js` — pure logic + HTML builders + config. UMD export. One responsibility: everything about *constructing and validating an evolution*, with zero DOM/network side effects (except `readEvolveModalState`, which only reads DOM).
- **Create** `modules/company/fleet-evolve.test.js` — `node:test` unit tests for the pure functions.
- **Modify** `modules/company/fleet.html` — include the new script; expand the roster card; mount/wire the modal; add submit handlers; delete `openEvolveFlow` prompt chain.

---

## Task 1: Scaffold `fleet-evolve.js` + test harness

**Files:**
- Create: `modules/company/fleet-evolve.js`
- Create: `modules/company/fleet-evolve.test.js`

- [ ] **Step 1: Create the module skeleton with constants (UMD export)**

```javascript
// modules/company/fleet-evolve.js
// Pure logic + HTML builders for the Fleet Command evolve modal.
// No DOM or network side effects except readEvolveModalState (DOM read only).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetEvolve = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CAP_CEILING = 5.00; // mirror of FLEET_PROPOSAL_COST_CEILINGS['propose-role-evolution']
  var ALLOWED_FIELDS = ['focus', 'monthlyCap', 'doctrine', 'expectedActionMix'];
  var PROTECTED_FIELDS = ['id', 'name', 'tier', 'status', 'hiredAt', 'retiredAt', 'reportsTo'];
  var ACTION_LEVELS = ['none', 'low', 'medium', 'high'];
  var RISK_PRESETS = ['Low', 'Low-Medium', 'Medium', 'Medium-High', 'High'];
  var HORIZON_PRESETS = ['Immediate', 'Days-Weeks', 'Weekly-Quarterly', '12-36 months', '3-10 years'];

  // Archetype bundles pre-fill the form; values merge over current doctrine/mix.
  var ARCHETYPES = {
    aggressive:   { label: '⚔ More aggressive',  doctrine: { riskTolerance: 'High' } },
    conservative: { label: '🛡 More conservative', doctrine: { riskTolerance: 'Low' } },
    output:       { label: '📣 Output-focused',    expectedActionMix: { 'execute-task': 'high', 'create-doc': 'high' } },
    reset:        { label: '↺ Reset to default',   _reset: true }
  };

  return {
    CAP_CEILING: CAP_CEILING,
    ALLOWED_FIELDS: ALLOWED_FIELDS,
    PROTECTED_FIELDS: PROTECTED_FIELDS,
    ACTION_LEVELS: ACTION_LEVELS,
    RISK_PRESETS: RISK_PRESETS,
    HORIZON_PRESETS: HORIZON_PRESETS,
    ARCHETYPES: ARCHETYPES
  };
});
```

- [ ] **Step 2: Create the test file importing the module**

```javascript
// modules/company/fleet-evolve.test.js
const test = require('node:test');
const assert = require('node:assert');
const FE = require('./fleet-evolve.js');

test('module exposes constants', () => {
  assert.strictEqual(FE.CAP_CEILING, 5.00);
  assert.deepStrictEqual(FE.ALLOWED_FIELDS, ['focus', 'monthlyCap', 'doctrine', 'expectedActionMix']);
  assert.ok(FE.PROTECTED_FIELDS.includes('reportsTo'));
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --test modules/company/fleet-evolve.test.js`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add modules/company/fleet-evolve.js modules/company/fleet-evolve.test.js
git commit -m "feat(fleet): scaffold fleet-evolve module + node:test harness"
```

---

## Task 2: `buildChanges(current, edited)` — diff to a payload-ready changes object

Emits only changed fields. `focus`/`monthlyCap` are scalar. `doctrine`/`expectedActionMix` are sent as the **complete merged object** when any sub-part changed (they're replaced wholesale server-side).

**Files:**
- Modify: `modules/company/fleet-evolve.js`
- Modify: `modules/company/fleet-evolve.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
test('buildChanges: no changes → empty object', () => {
  const cur = { focus: 'a', monthlyCap: 4, doctrine: { riskTolerance: 'Low' }, expectedActionMix: { 'execute-task': 'high' } };
  assert.deepStrictEqual(FE.buildChanges(cur, JSON.parse(JSON.stringify(cur))), {});
});
test('buildChanges: scalar focus + cap', () => {
  const cur = { focus: 'a', monthlyCap: 4, doctrine: {}, expectedActionMix: {} };
  const ed  = { focus: 'b', monthlyCap: 4.5, doctrine: {}, expectedActionMix: {} };
  assert.deepStrictEqual(FE.buildChanges(cur, ed), { focus: 'b', monthlyCap: 4.5 });
});
test('buildChanges: changed doctrine sub-field sends FULL doctrine', () => {
  const cur = { focus: 'a', monthlyCap: 4, doctrine: { riskTolerance: 'Low', timeHorizon: 'Immediate' }, expectedActionMix: {} };
  const ed  = { focus: 'a', monthlyCap: 4, doctrine: { riskTolerance: 'High', timeHorizon: 'Immediate' }, expectedActionMix: {} };
  assert.deepStrictEqual(FE.buildChanges(cur, ed), { doctrine: { riskTolerance: 'High', timeHorizon: 'Immediate' } });
});
test('buildChanges: changed action-mix sends FULL map', () => {
  const cur = { focus: 'a', monthlyCap: 4, doctrine: {}, expectedActionMix: { 'execute-task': 'high', 'remember': 'low' } };
  const ed  = { focus: 'a', monthlyCap: 4, doctrine: {}, expectedActionMix: { 'execute-task': 'high', 'remember': 'medium' } };
  assert.deepStrictEqual(FE.buildChanges(cur, ed), { expectedActionMix: { 'execute-task': 'high', 'remember': 'medium' } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test modules/company/fleet-evolve.test.js`
Expected: FAIL ("FE.buildChanges is not a function").

- [ ] **Step 3: Implement `buildChanges` and add to the returned api**

```javascript
  function _shallowEqual(a, b) {
    a = a || {}; b = b || {};
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      var k = ka[i];
      if (Array.isArray(a[k]) || Array.isArray(b[k])) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
      } else if (a[k] !== b[k]) return false;
    }
    return true;
  }

  function buildChanges(current, edited) {
    var changes = {};
    if (String(edited.focus) !== String(current.focus)) changes.focus = edited.focus;
    if (Number(edited.monthlyCap) !== Number(current.monthlyCap)) changes.monthlyCap = Number(edited.monthlyCap);
    if (!_shallowEqual(current.doctrine, edited.doctrine)) changes.doctrine = edited.doctrine;
    if (!_shallowEqual(current.expectedActionMix, edited.expectedActionMix)) changes.expectedActionMix = edited.expectedActionMix;
    return changes;
  }
```
Add `buildChanges: buildChanges` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test modules/company/fleet-evolve.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/company/fleet-evolve.js modules/company/fleet-evolve.test.js
git commit -m "feat(fleet): buildChanges diff (whole-object doctrine/mix)"
```

---

## Task 3: `computeCostDelta(current, edited)` — fix the full-cap bug

**Files:** Modify `fleet-evolve.js`, `fleet-evolve.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
test('computeCostDelta: cap change → delta', () => {
  assert.strictEqual(FE.computeCostDelta({ monthlyCap: 4 }, { monthlyCap: 4.5 }), 0.5);
});
test('computeCostDelta: cap decrease → negative delta', () => {
  assert.strictEqual(FE.computeCostDelta({ monthlyCap: 4 }, { monthlyCap: 3 }), -1);
});
test('computeCostDelta: no cap change → 0 (regression: old code sent full cap)', () => {
  assert.strictEqual(FE.computeCostDelta({ monthlyCap: 4 }, { monthlyCap: 4 }), 0);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test modules/company/fleet-evolve.test.js`
Expected: FAIL ("FE.computeCostDelta is not a function").

- [ ] **Step 3: Implement**

```javascript
  function computeCostDelta(current, edited) {
    return Math.round((Number(edited.monthlyCap) - Number(current.monthlyCap)) * 100) / 100;
  }
```
Add `computeCostDelta: computeCostDelta` to the api.

- [ ] **Step 4: Run to verify pass**

Run: `node --test modules/company/fleet-evolve.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/company/fleet-evolve.js modules/company/fleet-evolve.test.js
git commit -m "feat(fleet): computeCostDelta (fixes full-cap-as-delta bug)"
```

---

## Task 4: `validateEvolution(changes, opts)` — mirror server rules client-side

**Files:** Modify `fleet-evolve.js`, `fleet-evolve.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
test('validateEvolution: ok', () => {
  const r = FE.validateEvolution({ monthlyCap: 4.5 }, { rationale: 'this is a sufficiently long reason' });
  assert.deepStrictEqual(r, { ok: true, errors: [] });
});
test('validateEvolution: no fields', () => {
  const r = FE.validateEvolution({}, { rationale: 'a long enough rationale here yes' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /at least one/i.test(e)));
});
test('validateEvolution: cap out of range', () => {
  const r = FE.validateEvolution({ monthlyCap: 9 }, { rationale: 'a long enough rationale here yes' });
  assert.ok(r.errors.some(e => /cap/i.test(e)));
});
test('validateEvolution: short rationale', () => {
  const r = FE.validateEvolution({ focus: 'x' }, { rationale: 'too short' });
  assert.ok(r.errors.some(e => /rationale/i.test(e)));
});
test('validateEvolution: protected field rejected', () => {
  const r = FE.validateEvolution({ tier: 2, focus: 'x' }, { rationale: 'a long enough rationale here yes' });
  assert.ok(r.errors.some(e => /protected/i.test(e)));
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test modules/company/fleet-evolve.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

```javascript
  function validateEvolution(changes, opts) {
    opts = opts || {};
    var errors = [];
    var keys = Object.keys(changes || {});
    var hasAllowed = keys.some(function (k) { return ALLOWED_FIELDS.indexOf(k) !== -1; });
    if (!hasAllowed) errors.push('Change at least one field (focus, cap, doctrine, or loadout).');
    var protectedHit = keys.filter(function (k) { return PROTECTED_FIELDS.indexOf(k) !== -1; });
    if (protectedHit.length) errors.push('Cannot change protected field(s): ' + protectedHit.join(', '));
    if ('monthlyCap' in changes) {
      var cap = Number(changes.monthlyCap);
      if (!(cap > 0 && cap <= CAP_CEILING)) errors.push('Monthly cap must be between $0 and $' + CAP_CEILING.toFixed(2) + '.');
    }
    if (String(opts.rationale || '').trim().length < 20) errors.push('Rationale is required (min 20 characters).');
    return { ok: errors.length === 0, errors: errors };
  }
```
Add `validateEvolution: validateEvolution` to the api.

- [ ] **Step 4: Run to verify pass**

Run: `node --test modules/company/fleet-evolve.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/company/fleet-evolve.js modules/company/fleet-evolve.test.js
git commit -m "feat(fleet): client-side validateEvolution mirroring server rules"
```

---

## Task 5: `diffSummary(current, edited)` — human-readable change list for the live-diff rail

Per-subfield granularity (e.g. `Risk: Low → High`) even though `buildChanges` sends the whole doctrine object.

**Files:** Modify `fleet-evolve.js`, `fleet-evolve.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
test('diffSummary: cap + doctrine subfield', () => {
  const cur = { focus: 'a', monthlyCap: 4, doctrine: { riskTolerance: 'Low' }, expectedActionMix: {} };
  const ed  = { focus: 'a', monthlyCap: 4.5, doctrine: { riskTolerance: 'High' }, expectedActionMix: {} };
  assert.deepStrictEqual(FE.diffSummary(cur, ed), [
    { label: 'Monthly cap', was: '$4.00', now: '$4.50' },
    { label: 'Risk tolerance', was: 'Low', now: 'High' }
  ]);
});
test('diffSummary: action-mix change', () => {
  const cur = { focus: 'a', monthlyCap: 4, doctrine: {}, expectedActionMix: { 'remember': 'low' } };
  const ed  = { focus: 'a', monthlyCap: 4, doctrine: {}, expectedActionMix: { 'remember': 'high' } };
  assert.deepStrictEqual(FE.diffSummary(cur, ed), [{ label: 'remember', was: 'low', now: 'high' }]);
});
```

- [ ] **Step 2: Run to verify fail** — Run: `node --test modules/company/fleet-evolve.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement**

```javascript
  var DOCTRINE_LABELS = { strategicBias: 'Strategic bias', riskTolerance: 'Risk tolerance', timeHorizon: 'Time horizon', coreQuestion: 'Core question', escalationTriggers: 'Escalation triggers' };

  function diffSummary(current, edited) {
    var out = [];
    if (String(edited.focus) !== String(current.focus)) out.push({ label: 'Focus', was: String(current.focus || ''), now: String(edited.focus || '') });
    if (Number(edited.monthlyCap) !== Number(current.monthlyCap)) out.push({ label: 'Monthly cap', was: '$' + Number(current.monthlyCap).toFixed(2), now: '$' + Number(edited.monthlyCap).toFixed(2) });
    var cd = current.doctrine || {}, edd = edited.doctrine || {};
    Object.keys(DOCTRINE_LABELS).forEach(function (k) {
      var a = Array.isArray(cd[k]) ? cd[k].join(', ') : (cd[k] || '');
      var b = Array.isArray(edd[k]) ? edd[k].join(', ') : (edd[k] || '');
      if (a !== b) out.push({ label: DOCTRINE_LABELS[k], was: a, now: b });
    });
    var cm = current.expectedActionMix || {}, em = edited.expectedActionMix || {};
    Object.keys(em).forEach(function (act) {
      if ((cm[act] || 'none') !== em[act]) out.push({ label: act, was: cm[act] || 'none', now: em[act] });
    });
    return out;
  }
```
Add `diffSummary: diffSummary` to the api.

- [ ] **Step 4: Run to verify pass** — Run: `node --test modules/company/fleet-evolve.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/company/fleet-evolve.js modules/company/fleet-evolve.test.js
git commit -m "feat(fleet): diffSummary for live-diff rail"
```

---

## Task 6: `buildEvolveModalHtml(agent)` — prefilled modal markup

Returns an HTML string for the modal body, prefilled from the agent's current values. No protected fields are rendered as editable. Uses the company dark theme inline (matches the mockup).

**Files:** Modify `fleet-evolve.js`, `fleet-evolve.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
const AGENT = { id: 'scribe', name: 'Scribe', role: 'Content Director', tier: 3,
  focus: 'Strategic content.', monthlyCap: 4,
  doctrine: { strategicBias: 'Clarity', riskTolerance: 'Low', timeHorizon: 'Immediate', coreQuestion: 'Is this unambiguous?', escalationTriggers: ['Vague directives'] },
  expectedActionMix: { 'execute-task': 'high', 'remember': 'medium' } };

test('buildEvolveModalHtml: prefills current values', () => {
  const html = FE.buildEvolveModalHtml(AGENT);
  assert.ok(html.includes('Strategic content.'));     // focus prefilled
  assert.ok(html.includes('Scribe'));                  // header
  assert.ok(/data-field="monthlyCap"[^>]*value="4"/.test(html) || html.includes('value="4"')); // cap prefilled
});
test('buildEvolveModalHtml: marks current risk + action levels selected', () => {
  const html = FE.buildEvolveModalHtml(AGENT);
  assert.ok(/data-doctrine="riskTolerance"[^>]*data-val="Low"[^>]*class="[^"]*\bon\b/.test(html));
  assert.ok(/data-action="execute-task"[^>]*data-val="high"[^>]*class="[^"]*\bon\b/.test(html));
});
test('buildEvolveModalHtml: never renders protected fields as inputs', () => {
  const html = FE.buildEvolveModalHtml(AGENT);
  assert.ok(!/data-field="(id|name|tier|status|reportsTo)"/.test(html));
});
```

- [ ] **Step 2: Run to verify fail** — Run: `node --test modules/company/fleet-evolve.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** (append to `fleet-evolve.js` before the `return`)

```javascript
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function _segDoctrine(field, presets, current) {
    return presets.map(function (p) {
      var on = (String(current) === p) ? ' on' : '';
      return '<b class="fe-seg-b' + on + '" data-doctrine="' + field + '" data-val="' + _esc(p) + '">' + _esc(p) + '</b>';
    }).join('');
  }
  function _segAction(action, current) {
    return ACTION_LEVELS.map(function (lvl) {
      var on = (String(current || 'none') === lvl) ? ' on' : '';
      return '<b class="fe-seg-b' + on + '" data-action="' + action + '" data-val="' + lvl + '">' + lvl + '</b>';
    }).join('');
  }

  function buildEvolveModalHtml(agent) {
    var d = agent.doctrine || {}, mix = agent.expectedActionMix || {};
    var ver = (Array.isArray(agent.doctrineHistory) ? agent.doctrineHistory.length : 0) + 1;
    var presetBtns = Object.keys(ARCHETYPES).map(function (k) {
      return '<b class="fe-preset" data-preset="' + k + '">' + _esc(ARCHETYPES[k].label) + '</b>';
    }).join('');
    var triggers = (Array.isArray(d.escalationTriggers) ? d.escalationTriggers : []).map(function (t) {
      return '<span class="fe-chip" data-trigger="' + _esc(t) + '">' + _esc(t) + '<i class="fe-x">×</i></span>';
    }).join('');
    var mixRows = Object.keys(mix).map(function (act) {
      return '<div class="fe-row"><span>' + _esc(act) + '</span><div class="fe-seg">' + _segAction(act, mix[act]) + '</div></div>';
    }).join('');

    return '' +
    '<div class="fe-modal" data-agent="' + _esc(agent.id) + '">' +
      '<div class="fe-head"><div class="fe-title">Evolve ' + _esc(agent.name || agent.id) + '</div>' +
        '<div class="fe-sub">' + _esc(agent.role || '') + ' · Tier ' + _esc(agent.tier) + ' · v' + (ver - 1) + ' → v' + ver + '</div></div>' +
      '<div class="fe-presets">' + presetBtns + '</div>' +
      '<div class="fe-sec"><div class="fe-lbl">Focus</div>' +
        '<textarea class="fe-ta" data-field="focus" rows="2">' + _esc(agent.focus || '') + '</textarea></div>' +
      '<div class="fe-sec"><div class="fe-lbl">Monthly cap (max $' + CAP_CEILING.toFixed(2) + ')</div>' +
        '<input class="fe-range" type="range" min="0.5" max="' + CAP_CEILING + '" step="0.25" data-field="monthlyCap" value="' + Number(agent.monthlyCap || 0) + '">' +
        '<span class="fe-capval">$' + Number(agent.monthlyCap || 0).toFixed(2) + '</span></div>' +
      '<div class="fe-sec"><div class="fe-lbl">Doctrine</div>' +
        '<div class="fe-row"><span>Risk tolerance</span><div class="fe-seg">' + _segDoctrine('riskTolerance', RISK_PRESETS, d.riskTolerance) + '</div></div>' +
        '<div class="fe-row"><span>Time horizon</span><div class="fe-seg">' + _segDoctrine('timeHorizon', HORIZON_PRESETS, d.timeHorizon) + '</div></div>' +
        '<div class="fe-row"><span>Strategic bias</span><input class="fe-ta" data-doctrine="strategicBias" value="' + _esc(d.strategicBias || '') + '"></div>' +
        '<div class="fe-row"><span>Core question</span><input class="fe-ta" data-doctrine="coreQuestion" value="' + _esc(d.coreQuestion || '') + '"></div>' +
        '<div class="fe-row"><span>Escalation triggers</span><div class="fe-chips" data-triggers>' + triggers + '<span class="fe-chip fe-add">+ add</span></div></div></div>' +
      '<div class="fe-sec"><div class="fe-lbl">Loadout — expected action mix</div>' + mixRows + '</div>' +
      '<div class="fe-sec"><div class="fe-lbl">Rationale <span class="fe-req">*required</span></div>' +
        '<textarea class="fe-ta" data-field="rationale" rows="2" placeholder="Why this evolution? (min 20 chars — saved to lineage)"></textarea></div>' +
      '<div class="fe-diff" data-diff></div>' +
      '<div class="fe-foot"><span class="fe-note">If rejected: 14-day cooldown.</span>' +
        '<span class="fe-spacer"></span>' +
        '<button class="fe-btn fe-ghost" data-fe="cancel">Cancel</button>' +
        '<button class="fe-btn fe-sec" data-fe="propose">Propose for review</button>' +
        '<button class="fe-btn fe-amber" data-fe="now">⚡ Evolve now</button></div>' +
    '</div>';
  }
```
Add `buildEvolveModalHtml: buildEvolveModalHtml` to the api.

- [ ] **Step 4: Run to verify pass** — Run: `node --test modules/company/fleet-evolve.test.js` — Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add modules/company/fleet-evolve.js modules/company/fleet-evolve.test.js
git commit -m "feat(fleet): buildEvolveModalHtml prefilled markup builder"
```

---

## Task 7: Character-sheet card + include the module in `fleet.html`

Expand the existing roster card (the `active.map(...)` block ending at `fleet.html:241`) into the approved "character sheet" with doctrine chips and a loadout strip, using data already loaded. Add the script include.

**Files:**
- Modify: `modules/company/fleet.html` (script include near other `<script>` tags; card markup at the `active.map` block ~`fleet.html:223-241`)

- [ ] **Step 1: Add the script include**

Just before the closing `</body>` (or alongside the existing `<script>` block), add:
```html
<script src="/modules/company/fleet-evolve.js"></script>
```
Ensure it loads **before** the inline IIFE that references `FleetEvolve` (place it above the existing `<script>` at `fleet.html:162`).

- [ ] **Step 2: Replace the card markup** inside the `active.map(function (a) { … })` (currently `fleet.html:223-241`) with the character-sheet version. Add doctrine chips + loadout strip; keep the existing cap/drift logic (`alloc`, `drift`, `capText`):

```javascript
        var d = a.doctrine || {}, mix = a.expectedActionMix || {};
        var ver = (Array.isArray(a.doctrineHistory) ? a.doctrineHistory.length : 0) + 1;
        var traits = [d.riskTolerance ? 'Risk: ' + d.riskTolerance : '', d.timeHorizon ? 'Horizon: ' + d.timeHorizon : '']
          .filter(Boolean).map(function (t) { return '<span class="fl-trait">' + esc(t) + '</span>'; }).join('');
        var loadout = Object.keys(mix).slice(0, 4).map(function (act) {
          return '<div class="fl-mix-row"><span>' + esc(act) + '</span><span class="fl-mix-' + esc(mix[act]) + '">' + esc(mix[act]) + '</span></div>';
        }).join('');

        return '<div class="fl-agent-card' + (isProtected ? ' protected' : '') + '">' +
          '<div class="fl-agent-head"><span class="fl-agent-name">' + esc(a.name || a.id) +
            ' <span class="fl-lv">v' + ver + '</span>' + driftBadge + '</span><span class="fl-agent-tier">T' + (a.tier||'?') + '</span></div>' +
          '<div class="fl-agent-role">' + esc(a.role || '') + '</div>' +
          '<div class="fl-traits">' + traits + '</div>' +
          '<div class="fl-agent-meta"><strong>Cap:</strong> <span class="' + capClass + '">' + esc(capText) + '</span><br>' +
            '<strong>Focus:</strong> ' + esc(String(a.focus||'').substring(0,140)) + (String(a.focus||'').length > 140 ? '…' : '') + '</div>' +
          '<div class="fl-loadout">' + loadout + '</div>' +
          '<div class="fl-agent-actions">' +
            '<button class="fl-btn fl-btn-primary" data-action="evolve" data-agent="' + esc(a.id) + '">Evolve</button>' +
            '<button class="fl-btn fl-btn-warn" data-action="retire" data-agent="' + esc(a.id) + '"' + (isProtected ? ' disabled title="PROTECTED"' : '') + '>Retire</button>' +
          '</div></div>';
```

- [ ] **Step 3: Add card + modal CSS** to the `<style>` block in `fleet.html` (after the existing `.fl-*` rules). Include `.fl-trait`, `.fl-lv`, `.fl-loadout`, `.fl-mix-row`, `.fl-mix-high/medium/low/none`, and the `.fe-*` modal classes referenced by `buildEvolveModalHtml` (segmented `.fe-seg-b.on`, `.fe-chip`, `.fe-range`, `.fe-btn.fe-amber`, `.fe-modal` overlay, `.fe-diff`). Match the dark theme + amber accent from the approved mockup (`#0e1218` card bg, `#fbbf24` accent, `#34d399` positive). Keep selectors prefixed (`fl-`/`fe-`) per the CSS-architecture rule.

- [ ] **Step 4: Verify render** (no unit test — this is DOM):

Run locally: `swa start . --app-location .` then open `http://localhost:4280/modules/company/fleet.html`.
Expected: each agent shows the character-sheet card (name + version, traits chips, cap, focus, loadout strip, Evolve/Retire). Capture a screenshot and compare to mockup direction B. (Per the verify-rendered-output rule — do not claim done without seeing it render.)

- [ ] **Step 5: Commit**

```bash
git add modules/company/fleet.html
git commit -m "feat(fleet): character-sheet roster card + include fleet-evolve.js"
```

---

## Task 8: Mount the modal, wire controls, replace `openEvolveFlow`, add submit paths

**Files:** Modify `modules/company/fleet.html` (the inline IIFE: replace `openEvolveFlow` ~`fleet.html:268-294`; `submitProposal` exists ~`fleet.html:297`)

- [ ] **Step 1: Replace `openEvolveFlow(agentId)` with modal-mount logic**

```javascript
    var _feCurrentAgent = null;

    function openEvolveFlow(agentId) {
      var agent = (window._fleetData && window._fleetData.registry.agents || []).filter(function (a) { return a.id === agentId; })[0];
      if (!agent) { alert('Agent not found: ' + agentId); return; }
      _feCurrentAgent = agent;
      var overlay = document.createElement('div');
      overlay.className = 'fe-overlay';
      overlay.id = 'fe-overlay';
      overlay.innerHTML = FleetEvolve.buildEvolveModalHtml(agent);
      document.body.appendChild(overlay);
      wireEvolveModal(overlay, agent);
      updateEvolveDiff(overlay, agent);
    }
```
Note: store the loaded data so the modal can read current values. In the `.then` of `loadAll()` where `renderAll(d)` runs, add `window._fleetData = d;` (find where `loadAll().then` resolves — add the assignment there).

- [ ] **Step 2: Add `readEvolveModalState(overlay, agent)`** — reads the DOM back into an `edited` object shaped like the agent:

```javascript
    function readEvolveModalState(overlay, agent) {
      var q = function (s) { return overlay.querySelector(s); };
      var edited = {
        focus: (q('[data-field="focus"]') || {}).value || '',
        monthlyCap: Number((q('[data-field="monthlyCap"]') || {}).value || agent.monthlyCap),
        doctrine: {}, expectedActionMix: {}
      };
      // doctrine scalar inputs
      ['strategicBias', 'coreQuestion'].forEach(function (k) {
        var el = q('[data-doctrine="' + k + '"]'); if (el) edited.doctrine[k] = el.value;
      });
      // doctrine segmented (riskTolerance, timeHorizon)
      ['riskTolerance', 'timeHorizon'].forEach(function (k) {
        var on = q('.fe-seg-b.on[data-doctrine="' + k + '"]');
        edited.doctrine[k] = on ? on.getAttribute('data-val') : (agent.doctrine || {})[k];
      });
      // escalation triggers chips
      edited.doctrine.escalationTriggers = Array.prototype.map.call(
        overlay.querySelectorAll('[data-triggers] .fe-chip[data-trigger]'),
        function (c) { return c.getAttribute('data-trigger'); });
      // action mix
      Object.keys(agent.expectedActionMix || {}).forEach(function (act) {
        var on = q('.fe-seg-b.on[data-action="' + act + '"]');
        edited.expectedActionMix[act] = on ? on.getAttribute('data-val') : agent.expectedActionMix[act];
      });
      return edited;
    }
```

- [ ] **Step 3: Add `wireEvolveModal(overlay, agent)`** — segmented toggles, slider readout, presets, chip add/remove, footer buttons:

```javascript
    function wireEvolveModal(overlay, agent) {
      // segmented pickers (doctrine + action mix): clicking selects within its group
      overlay.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.fe-seg-b');
        if (b) {
          var group = b.getAttribute('data-doctrine') ? '[data-doctrine="' + b.getAttribute('data-doctrine') + '"]'
                                                       : '[data-action="' + b.getAttribute('data-action') + '"]';
          overlay.querySelectorAll('.fe-seg-b' + group).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          updateEvolveDiff(overlay, agent);
        }
        var chipX = e.target.closest && e.target.closest('.fe-x');
        if (chipX) { chipX.parentNode.remove(); updateEvolveDiff(overlay, agent); }
        var addChip = e.target.classList && e.target.classList.contains('fe-add');
        if (addChip) {
          var v = window.prompt('New escalation trigger:'); // small inline add; full chip-input is P3 polish
          if (v && v.trim()) {
            var span = document.createElement('span');
            span.className = 'fe-chip'; span.setAttribute('data-trigger', v.trim());
            span.innerHTML = esc(v.trim()) + '<i class="fe-x">×</i>';
            e.target.parentNode.insertBefore(span, e.target);
            updateEvolveDiff(overlay, agent);
          }
        }
        var preset = e.target.getAttribute && e.target.getAttribute('data-preset');
        if (preset) { applyArchetype(overlay, agent, preset); }
        var fe = e.target.getAttribute && e.target.getAttribute('data-fe');
        if (fe === 'cancel') closeEvolveModal();
        if (fe === 'propose') submitEvolution(overlay, agent, 'propose');
        if (fe === 'now') submitEvolution(overlay, agent, 'now');
      });
      // slider readout + live diff on any input
      overlay.addEventListener('input', function (e) {
        if (e.target.getAttribute('data-field') === 'monthlyCap') {
          var out = overlay.querySelector('.fe-capval'); if (out) out.textContent = '$' + Number(e.target.value).toFixed(2);
        }
        updateEvolveDiff(overlay, agent);
      });
    }

    function applyArchetype(overlay, agent, key) {
      var arc = FleetEvolve.ARCHETYPES[key]; if (!arc) return;
      if (arc._reset) { closeEvolveModal(); openEvolveFlow(agent.id); return; } // reset = re-render from current
      if (arc.doctrine) Object.keys(arc.doctrine).forEach(function (k) {
        var sel = overlay.querySelector('.fe-seg-b[data-doctrine="' + k + '"][data-val="' + arc.doctrine[k] + '"]');
        if (sel) { overlay.querySelectorAll('.fe-seg-b[data-doctrine="' + k + '"]').forEach(function (x){x.classList.remove('on');}); sel.classList.add('on'); }
      });
      if (arc.expectedActionMix) Object.keys(arc.expectedActionMix).forEach(function (act) {
        var sel = overlay.querySelector('.fe-seg-b[data-action="' + act + '"][data-val="' + arc.expectedActionMix[act] + '"]');
        if (sel) { overlay.querySelectorAll('.fe-seg-b[data-action="' + act + '"]').forEach(function (x){x.classList.remove('on');}); sel.classList.add('on'); }
      });
      updateEvolveDiff(overlay, agent);
    }

    function updateEvolveDiff(overlay, agent) {
      var edited = readEvolveModalState(overlay, agent);
      var rows = FleetEvolve.diffSummary(agent, edited);
      var el = overlay.querySelector('[data-diff]');
      if (!el) return;
      el.innerHTML = rows.length
        ? '<div class="fe-lbl">Changes (' + rows.length + ')</div>' + rows.map(function (r) {
            return '<div class="fe-diff-row">' + esc(r.label) + ': <span class="was">' + esc(r.was) + '</span> → <span class="now">' + esc(r.now) + '</span></div>';
          }).join('')
        : '<div class="fe-note">No changes yet.</div>';
    }

    function closeEvolveModal() { var o = document.getElementById('fe-overlay'); if (o) o.remove(); _feCurrentAgent = null; }
```

- [ ] **Step 4: Add `submitEvolution(overlay, agent, mode)`** — build changes, validate, then propose or evolve-now:

```javascript
    function submitEvolution(overlay, agent, mode) {
      var edited = readEvolveModalState(overlay, agent);
      var changes = FleetEvolve.buildChanges(agent, edited);
      var rationale = ((overlay.querySelector('[data-field="rationale"]') || {}).value || '').trim();
      var v = FleetEvolve.validateEvolution(changes, { rationale: rationale });
      if (!v.ok) { alert(v.errors.join('\n')); return; }
      var payload = {
        type: 'agent_evolution_proposal', proposedBy: 'ceo',
        evolution: { targetAgent: agent.id, changes: changes, rationale: rationale,
                     estimatedCostDelta: FleetEvolve.computeCostDelta(agent, edited) }
      };
      overlay.querySelectorAll('.fe-btn').forEach(function (b){ b.disabled = true; });
      fetch(API + '/fleetProposalCreate', {
        method: 'POST', headers: { 'x-company-secret': SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (!res || (!res.id && !res.ok)) throw new Error((res && res.error) || 'Create failed');
        if (mode === 'propose') { closeEvolveModal(); alert('Proposal created — review it in the queue.'); return refreshAll(); }
        // evolve-now: chain approve
        return fetch(API + '/approveProposal', {
          method: 'POST', headers: { 'x-company-secret': SECRET, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: res.id, decision: 'approved', ceoNote: 'Evolved via Fleet Command' })
        }).then(function (r2) { return r2.json(); }).then(function (ar) {
          closeEvolveModal();
          if (ar && ar.sideEffect) alert('Evolved ' + agent.id + '. Changed: ' + ((ar.sideEffect.changedFields||[]).join(', ') || 'fields') + '. Takes effect next heartbeat.');
          else alert('Evolution applied (proposal ' + res.id + ').');
          return refreshAll();
        });
      }).catch(function (err) {
        overlay.querySelectorAll('.fe-btn').forEach(function (b){ b.disabled = false; });
        alert('Evolution failed: ' + (err && err.message ? err.message : err) + '\nIf a proposal was created it is left pending in the queue.');
      });
    }
```
Note: `refreshAll()` = the existing function that re-runs `loadAll().then(renderAll)` (use whatever the file already calls after `decide()` succeeds — reuse it; do not create a duplicate loader).

- [ ] **Step 5: Verify render + flow** (DOM):

`swa start . --app-location .` → open the Fleet page. Click **Evolve** on an agent. Confirm: modal opens prefilled; segmented pickers toggle; slider updates the $ readout; live diff updates; **Propose for review** creates a queue entry; **⚡ Evolve now** applies and the card reflects it after refresh. Screenshot the open modal and compare to the approved mockup.

Also re-run the logic tests to confirm nothing regressed: `node --test modules/company/fleet-evolve.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/company/fleet.html
git commit -m "feat(fleet): guided Evolve modal replaces window.prompt flow (propose + evolve-now)"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** character-sheet card (Task 7), prefilled modal with all control types (Tasks 6,8), both apply paths (Task 8), live diff (Tasks 5,8), cost-delta fix (Task 3), client validation mirroring server (Task 4), no backend change. Lineage drawer + XP/alignment stats are explicitly Phase 2/3 (out of scope here, per spec phasing).
- **Placeholder scan:** none — all steps carry concrete code or exact commands. The escalation-trigger "+ add" uses a minimal `window.prompt` in P1 (a full chip-input is P3 polish; called out inline, not a hidden TODO).
- **Type consistency:** `buildChanges`, `computeCostDelta`, `validateEvolution`, `diffSummary`, `buildEvolveModalHtml` names match across tasks; `readEvolveModalState` produces the agent-shaped `edited` object consumed by all of them; data attributes (`data-field`, `data-doctrine`, `data-action`, `data-val`, `data-fe`, `data-preset`, `data-triggers`) are consistent between `buildEvolveModalHtml` (Task 6) and the wiring (Task 8).
