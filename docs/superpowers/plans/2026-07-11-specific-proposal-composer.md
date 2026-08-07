# Specific Proposal Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic proposal generator's templated, count-padded proposals with LLM-authored proposals that reason over real company state, grounded by deterministic validation, with a deterministic fallback and silence when there's no real gap.

**Architecture:** Approach B — three focused units. `proposal-generator.js` keeps *pure detection* (`detectSignals`, no count triggers) plus the existing builders as *fallback*. A new `proposal-composer.js` owns the LLM prompt, call, and anti-hallucination validation. `runProposalGenerator` orchestrates: detect → compose → validate → fallback-or-skip → queue, reusing all existing dedup/expiry/logging.

**Tech Stack:** Node.js (CommonJS), Azure Functions, plain `node`+`assert` tests (no framework), `gemini.js` model wrapper (honors `systemConfig.heartbeatModel` + fallback chain).

**Spec:** `docs/superpowers/specs/2026-07-10-specific-proposal-composer-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `api/companyHeartbeat/gemini.js` | Model wrapper | **Modify** — add additive `callGeminiProposal(prompt)` export |
| `api/companyHeartbeat/proposal-generator.js` | Detection + fallback builders + orchestration | **Modify** — add `detectSignals`, remove count triggers, signal-drive `computeProposals`, wire `runProposalGenerator` to compose |
| `api/companyHeartbeat/proposal-composer.js` | LLM grounding + prompt + call + validation | **Create** |
| `api/companyHeartbeat/proposal-composer.test.js` | Composer unit tests (fake `callModel`) | **Create** |
| `api/companyHeartbeat/proposal-generator.test.js` | Pure detection/build tests | **Modify** — flip count tests, re-trigger count-dependent tests via real signals |
| `api/companyHeartbeat/proposal-generator.run.test.js` | `runProposalGenerator` orchestration (stub storage + fake model) | **Create** |
| `api/proposalGeneratorCron/index.js` | Cron entry | **Modify** — inject production `callModel` wrapper |

Run all three test files with:
```bash
node api/companyHeartbeat/proposal-generator.test.js
node api/companyHeartbeat/proposal-composer.test.js
node api/companyHeartbeat/proposal-generator.run.test.js
```

Shared shapes used across tasks:

**Signal** (from `detectSignals`):
```js
{ kind:'objective'|'campaign', trigger:'near_complete'|'stale_objective'|'declining_uncovered'|'all_stagnant',
  severity:Number, subject:{ product?, objectiveId?, objectiveTitle? }, evidence:{...} }
```

**Grounding** (from `composer.buildGrounding`):
```js
{ signal, baselines:{ bluesky_followers?, linkedin_followers?, x_followers?, paying_customers },
  productNames:[...], activeObjectives:[{title,northStarMetric,progress}],
  activeCampaigns:[{name,product,cadence}], products:[{product,verdict,deltaPct}] }
```

---

## Task 1: Add `callGeminiProposal` to the model wrapper

**Files:**
- Modify: `api/companyHeartbeat/gemini.js` (add one function + export)

This is a thin, additive wrapper mirroring `callGeminiExecute` (dynamic model resolution + fallback chain + free-form output), but with correct cost attribution (`caller:'proposal-generator'`) and a lower temperature for grounded output. No behavior change to existing exports.

- [ ] **Step 1: Add the function** after `callGeminiExecute` (currently `api/companyHeartbeat/gemini.js:215-217`)

```js
// Free-form JSON proposal composition (NOT the agent envelope). Dynamic model +
// fallback chain, lower temperature for grounded output. Returns text or null.
async function callGeminiProposal(prompt) {
  return _callWithFallback(prompt, 'nova', 1500, 0.4, 'proposal-generator', false);
}
```

- [ ] **Step 2: Export it** — update the `module.exports` line (currently `api/companyHeartbeat/gemini.js:235`)

```js
module.exports = { callGemini, callGeminiExecute, callGeminiProposal, getActiveModel, callWithModel, _isClaudeModel };
```

- [ ] **Step 3: Sanity-check it loads**

Run: `node -e "console.log(typeof require('./api/companyHeartbeat/gemini').callGeminiProposal)"`
Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add api/companyHeartbeat/gemini.js
git commit -m "feat(proposals): add callGeminiProposal model wrapper"
```

---

## Task 2: Signal detection + remove count-padding triggers

**Files:**
- Modify: `api/companyHeartbeat/proposal-generator.js` (add `detectSignals`, `_pickTopPerType`, `_deterministicFromSignal`; refactor `computeProposals`; delete count branches)
- Modify: `api/companyHeartbeat/proposal-generator.test.js` (flip count tests, add `detectSignals` tests, re-trigger count-dependent tests)

The existing `_buildObjectiveProposal` / `_buildCampaignProposal` / `_isStagnant` / `_isStale` / `_isPlaceholderObjective` / `_coveredProductSet` / `_isDeduped` / helpers stay unchanged. We add detection above them and make `computeProposals` signal-driven.

- [ ] **Step 1: Write failing detection tests.** Append to `api/companyHeartbeat/proposal-generator.test.js` **before** the final `console.log('\n' + pass...)` line (currently line 354):

```js
// ── (2026-07-11) detectSignals: pure detection, count triggers REMOVED ──
const { detectSignals } = require('./proposal-generator');

test('detectSignals returns [] for a healthy baseline', () => {
  assert.deepStrictEqual(detectSignals(baseState({}), NOW), []);
});

test('detectSignals does NOT fire on count alone (fewer than 3 campaigns)', () => {
  const sigs = detectSignals(baseState({ campaigns: [{ id: 'c1', status: 'active', product: 'Alpha' }] }), NOW);
  assert.ok(!sigs.some((s) => s.kind === 'campaign'), 'count of 1 campaign must not produce a campaign signal');
});

test('detectSignals does NOT fire on count alone (fewer than 3 objectives)', () => {
  const sigs = detectSignals(baseState({ objectives: [{ id: 'o1', status: 'active', progress: 50 }, { id: 'o2', status: 'active', progress: 50 }] }), NOW);
  assert.ok(!sigs.some((s) => s.kind === 'objective'), 'count of 2 objectives must not produce an objective signal');
});

test('detectSignals emits declining_uncovered for a real DECLINING uncovered product', () => {
  const st = baseState({});
  st.strategicDigest.perProduct.push({ product: 'Delta', verdict: 'DECLINING', traffic: { deltaPct: -90 } });
  const sig = detectSignals(st, NOW).find((s) => s.kind === 'campaign');
  assert.ok(sig, 'expected a campaign signal');
  assert.strictEqual(sig.trigger, 'declining_uncovered');
  assert.strictEqual(sig.subject.product, 'Delta');
});

test('detectSignals emits near_complete for a >=95% objective', () => {
  const st = baseState({ objectives: [{ id: 'o1', status: 'active', progress: 99, title: 'Ship X' }, { id: 'o2', status: 'active', progress: 50 }, { id: 'o3', status: 'active', progress: 50 }] });
  const sig = detectSignals(st, NOW).find((s) => s.kind === 'objective');
  assert.ok(sig, 'expected an objective signal');
  assert.strictEqual(sig.trigger, 'near_complete');
  assert.strictEqual(sig.subject.objectiveId, 'o1');
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node api/companyHeartbeat/proposal-generator.test.js`
Expected: FAIL — `detectSignals` is not a function, and the count-fire tests at lines 58 & 108 still assert the old behavior.

- [ ] **Step 3: Implement `detectSignals` + helpers + refactor `computeProposals`.** In `api/companyHeartbeat/proposal-generator.js`, **replace the entire `computeProposals` function** (currently lines 256-334) with:

```js
// ── Pure detection ─────────────────────────────────────────────────────────────
// Returns 0-N grounded signals, highest severity first. NO count-padding triggers.
function detectSignals(state, nowMs) {
  if (!state || typeof state !== 'object') return [];
  var tasks = _arr(state.tasks) || [];
  var perProduct = (state.strategicDigest && _arr(state.strategicDigest.perProduct)) || [];
  var signals = [];

  var campaigns = _arr(state.campaigns);
  if (campaigns) {
    var activeCampaigns = _activeOf(campaigns);
    var covered = _coveredProductSet(activeCampaigns, perProduct);
    var declUncovered = perProduct.filter(function (p) {
      return p && DECLINING_VERDICTS.indexOf(String(p.verdict || '').toUpperCase()) !== -1 && !covered[_lc(p.product)];
    });
    if (declUncovered.length) {
      var sorted = declUncovered.slice().sort(function (a, b) {
        return ((a.traffic && a.traffic.deltaPct) || 0) - ((b.traffic && b.traffic.deltaPct) || 0);
      });
      signals.push({
        kind: 'campaign', trigger: 'declining_uncovered', severity: 3,
        subject: { product: sorted[0].product },
        evidence: { decliningProducts: sorted.map(function (p) { return { product: p.product, deltaPct: (p.traffic && p.traffic.deltaPct) }; }) }
      });
    }
    var allStagnant = activeCampaigns.length > 0 && activeCampaigns.every(function (c) { return _isStagnant(c, tasks, nowMs); });
    if (allStagnant) {
      signals.push({
        kind: 'campaign', trigger: 'all_stagnant', severity: 2,
        subject: { product: (activeCampaigns.filter(function (c) { return c.product; })[0] || {}).product || null },
        evidence: { stagnantDays: STAGNANT_DAYS, campaignCount: activeCampaigns.length }
      });
    }
  }

  var objectives = _arr(state.objectives);
  if (objectives) {
    var activeObjectives = _activeOf(objectives);
    var nearDone = activeObjectives.filter(function (o) { return Number(o.progress) >= OBJECTIVE_COMPLETE_PCT; });
    if (nearDone.length) {
      signals.push({
        kind: 'objective', trigger: 'near_complete', severity: 3,
        subject: { objectiveId: nearDone[0].id, objectiveTitle: nearDone[0].title || '' },
        evidence: { progress: Number(nearDone[0].progress), count: nearDone.length }
      });
    }
    var stale = activeObjectives.filter(function (o) {
      return _isStale(o, campaigns || [], tasks, nowMs) && !_isPlaceholderObjective(o, campaigns || [], tasks);
    });
    if (stale.length) {
      signals.push({
        kind: 'objective', trigger: 'stale_objective', severity: 2,
        subject: { objectiveId: stale[0].id, objectiveTitle: stale[0].title || '' },
        evidence: { staleDays: STALE_DAYS, count: stale.length }
      });
    }
  }

  signals.sort(function (a, b) { return b.severity - a.severity; });
  return signals;
}

// Pick at most one campaign + one objective signal, honoring the existing 24h/pending dedup.
function _pickTopPerType(signals, queue, nowMs) {
  var picks = [];
  var haveCampaign = false, haveObjective = false;
  (signals || []).forEach(function (sig) {
    if (sig.kind === 'campaign' && !haveCampaign && !_isDeduped(queue, 'campaign_proposal', nowMs)) {
      picks.push(sig); haveCampaign = true;
    } else if (sig.kind === 'objective' && !haveObjective && !_isDeduped(queue, 'objective_proposal', nowMs)) {
      picks.push(sig); haveObjective = true;
    }
  });
  return picks;
}

// Deterministic fallback: translate a signal into args for the existing builders.
function _deterministicFromSignal(signal, state, nowMs) {
  var sas = state.socialAccountStats || {};
  if (signal.kind === 'campaign') {
    if (signal.trigger === 'declining_uncovered') {
      var dps = signal.evidence.decliningProducts || [];
      var f = dps[0];
      var delta = f && Number.isFinite(f.deltaPct) ? (' ' + f.deltaPct + '% traffic') : '';
      var reasons = [dps.length + ' product(s) declining with no active campaign (e.g. ' + (f ? f.product : '') + delta + ')'];
      var targets = dps.map(function (p) { return { product: p.product }; });
      return _buildCampaignProposal(reasons, targets, sas, nowMs);
    }
    var stagReasons = ['all active campaigns stagnant (no completed work in ' + STAGNANT_DAYS + 'd)'];
    var stagTargets = signal.subject.product ? [{ product: signal.subject.product }] : [];
    return _buildCampaignProposal(stagReasons, stagTargets, sas, nowMs);
  }
  var primary = signal.trigger === 'near_complete' ? 'complete' : 'stale';
  var oReasons = signal.trigger === 'near_complete'
    ? [signal.evidence.count + ' active objective(s) >= ' + OBJECTIVE_COMPLETE_PCT + '% complete (successor needed)']
    : [signal.evidence.count + ' active objective(s) stale (no campaign/task activity in ' + STALE_DAYS + 'd)'];
  return _buildObjectiveProposal(oReasons, primary, sas, nowMs);
}

// ── Pure core (deterministic path) ──────────────────────────────────────────────
// Signal-driven: detect → pick top per type → deterministic build. Returns 0-2.
function computeProposals(state, nowMs) {
  if (!state || typeof state !== 'object') return [];
  var queue = _arr(state.approvalQueue) || [];
  var picks = _pickTopPerType(detectSignals(state, nowMs), queue, nowMs);
  return picks.map(function (sig) { return _deterministicFromSignal(sig, state, nowMs); });
}
```

- [ ] **Step 4: Export `detectSignals` + `_pickTopPerType` + `_deterministicFromSignal`.** Update `module.exports` at the bottom of `proposal-generator.js` (currently lines 423-428):

```js
module.exports = {
  computeProposals: computeProposals,
  detectSignals: detectSignals,
  runProposalGenerator: runProposalGenerator,
  _expireStaleGeneratorProposals: _expireStaleGeneratorProposals,
  _isPlaceholderObjective: _isPlaceholderObjective,
  _pickTopPerType: _pickTopPerType,
  _deterministicFromSignal: _deterministicFromSignal
};
```

- [ ] **Step 5: Flip the two count-fire tests.** In `proposal-generator.test.js`, **replace** the test at lines 58-61 (`'campaign fires when fewer than 3 active campaigns'`) with:

```js
test('campaign does NOT fire on count alone (fewer than 3 active campaigns)', () => {
  const r = computeProposals(baseState({ campaigns: [{ id: 'c1', status: 'active', product: 'Alpha' }] }), NOW);
  assert.ok(!camp(r), 'count padding removed — 1 healthy campaign must not propose');
});
```

And **replace** the test at lines 108-111 (`'objective fires when fewer than 3 active objectives'`) with:

```js
test('objective does NOT fire on count alone (fewer than 3 active objectives)', () => {
  const r = computeProposals(baseState({ objectives: [{ id: 'o1', status: 'active', progress: 50 }, { id: 'o2', status: 'active', progress: 50 }] }), NOW);
  assert.ok(!obj(r), 'count padding removed — 2 healthy objectives must not propose');
});
```

- [ ] **Step 6: Re-trigger the count-dependent tests via real signals.** These tests used `count < 3` only as a convenient trigger. Replace each as follows.

Replace lines 90-105 (both campaign dedup tests) with:

```js
// ── CAMPAIGN: dedup (triggered via a real declining product) ──
function declTrigger(overrides) {
  const st = baseState(overrides || {});
  st.strategicDigest.perProduct.push({ product: 'Delta', verdict: 'DECLINING', traffic: { deltaPct: -90 } });
  return st;
}
test('campaign suppressed when a pending campaign_proposal already exists', () => {
  const st = declTrigger({ approvalQueue: [{ type: 'campaign_proposal', status: 'pending', createdAt: daysAgo(3) }] });
  assert.ok(!camp(computeProposals(st, NOW)), 'pending proposal should block a new one');
});
test('campaign suppressed when generator created one in the last 24h', () => {
  const st = declTrigger({ approvalQueue: [{ type: 'campaign_proposal', status: 'rejected', source: 'auto:proposal-generator', createdAt: daysAgo(0.5) }] });
  assert.ok(!camp(computeProposals(st, NOW)), '24h dedup should block a new one');
});
```

Replace lines 136-151 (both objective dedup tests) with:

```js
// ── OBJECTIVE: dedup (triggered via a real near-complete objective) ──
function nearDoneTrigger(overrides) {
  return baseState(Object.assign({
    objectives: [{ id: 'o1', status: 'active', progress: 99, title: 'Ship X' }, { id: 'o2', status: 'active', progress: 50 }, { id: 'o3', status: 'active', progress: 50 }]
  }, overrides || {}));
}
test('objective suppressed when a pending objective_proposal already exists', () => {
  const st = nearDoneTrigger({ approvalQueue: [{ type: 'objective_proposal', status: 'pending', createdAt: daysAgo(3) }] });
  assert.ok(!obj(computeProposals(st, NOW)), 'pending proposal should block a new one');
});
test('objective suppressed when generator created one in the last 24h', () => {
  const st = nearDoneTrigger({ approvalQueue: [{ type: 'objective_proposal', status: 'approved', source: 'auto:proposal-generator', createdAt: daysAgo(0.5) }] });
  assert.ok(!obj(computeProposals(st, NOW)), '24h dedup should block a new one');
});
```

Replace lines 166-179 (`'campaign entry has the required shape'`) with:

```js
test('campaign entry has the required shape', () => {
  const e = camp(computeProposals(declTrigger({}), NOW));
  assert.strictEqual(e.type, 'campaign_proposal');
  assert.strictEqual(e.status, 'pending');
  assert.strictEqual(e.proposedBy, 'nova');
  assert.strictEqual(e.source, 'auto:proposal-generator');
  assert.ok(typeof e.name === 'string' && e.name.length > 0, 'name');
  assert.ok(typeof e.rationale === 'string' && e.rationale.length > 0, 'rationale');
  assert.ok(Array.isArray(e.platforms), 'platforms array');
  assert.ok(Number.isFinite(e.frequency), 'frequency');
  assert.ok(['daily', 'weekly', 'biweekly'].indexOf(e.cadence) !== -1, 'cadence');
  assert.ok(typeof e.id === 'string' && e.id.indexOf('cprop_') === 0, 'id prefix');
  assert.strictEqual(e.createdAt, new Date(NOW).toISOString());
});
```

Replace lines 181-194 (`'objective entry has the required shape'`) with:

```js
test('objective entry has the required shape', () => {
  const e = obj(computeProposals(nearDoneTrigger({}), NOW));
  assert.strictEqual(e.type, 'objective_proposal');
  assert.strictEqual(e.status, 'pending');
  assert.strictEqual(e.proposedBy, 'nova');
  assert.strictEqual(e.source, 'auto:proposal-generator');
  assert.ok(typeof e.title === 'string' && e.title.length > 0, 'title');
  assert.ok(typeof e.description === 'string' && e.description.length > 0, 'description');
  assert.ok(typeof e.rationale === 'string' && e.rationale.length > 0, 'rationale');
  assert.ok(typeof e.successCriteria === 'string' && e.successCriteria.length > 0, 'successCriteria');
  assert.ok(typeof e.timeHorizon === 'string' && e.timeHorizon.length > 0, 'timeHorizon');
  assert.ok(typeof e.id === 'string' && e.id.indexOf('oprop_') === 0, 'id prefix');
  assert.strictEqual(e.createdAt, new Date(NOW).toISOString());
});
```

Replace lines 196-205 (`'emits at most one campaign and one objective per run'`) with:

```js
test('emits at most one campaign and one objective per run', () => {
  const st = declTrigger({
    objectives: [{ id: 'o1', status: 'active', progress: 99, title: 'Ship X' }, { id: 'o2', status: 'active', progress: 50 }, { id: 'o3', status: 'active', progress: 50 }]
  });
  const r = computeProposals(st, NOW);
  assert.strictEqual(r.filter((p) => p.type === 'campaign_proposal').length, 1);
  assert.strictEqual(r.filter((p) => p.type === 'objective_proposal').length, 1);
  assert.strictEqual(r.length, 2);
});
```

Replace lines 207-224 (both agent-pending dedup tests) with:

```js
// ── Cron defers to a pending AGENT-sourced proposal (real triggers) ──
test('campaign suppressed when a pending agent campaign_proposal exists', () => {
  const st = declTrigger({ approvalQueue: [{ type: 'campaign_proposal', status: 'pending', proposedBy: 'echo', source: 'agent', createdAt: daysAgo(0) }] });
  assert.ok(!camp(computeProposals(st, NOW)), 'cron should defer to the pending agent campaign proposal');
});
test('objective suppressed when a pending agent objective_proposal exists', () => {
  const st = nearDoneTrigger({ approvalQueue: [{ type: 'objective_proposal', status: 'pending', proposedBy: 'cipher', source: 'agent', createdAt: daysAgo(0) }] });
  assert.ok(!obj(computeProposals(st, NOW)), 'cron should defer to the pending agent objective proposal');
});
```

Replace lines 285-303 (both metric pre-fill tests) with:

```js
// ── measurable objectives: metric pre-filled from follower data (real trigger) ──
test('objective proposal pre-fills bluesky_followers metric when follower data exists', () => {
  const e = obj(computeProposals(nearDoneTrigger({}), NOW));
  assert.strictEqual(e.northStarMetric, 'bluesky_followers', 'northStarMetric set');
  assert.ok(Number.isFinite(e.metricTarget) && e.metricTarget > 300, 'metricTarget is followers+15% (>300)');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.metricDeadline), 'metricDeadline is a date');
  assert.strictEqual(e.strategyFlag, null, 'no flag when metric present');
});
test('objective proposal flags missing metric when no follower data', () => {
  const e = obj(computeProposals(nearDoneTrigger({ socialAccountStats: {} }), NOW));
  assert.strictEqual(e.northStarMetric, null, 'no metric without follower data');
  assert.strictEqual(e.metricTarget, null);
  assert.strictEqual(e.metricDeadline, null);
  assert.strictEqual(e.strategyFlag, 'no-north-star-metric', 'flagged for CEO to add a metric');
});
```

Replace lines 305-323 (`'objective + campaign resolve real data from the production .platforms shape'`) with:

```js
// ── production socialAccountStats shape: followers under `.platforms` (real triggers) ──
test('objective + campaign resolve real data from the production `.platforms` shape', () => {
  const st = baseState({
    objectives: [{ id: 'o1', status: 'active', progress: 99, title: 'Ship X' }, { id: 'o2', status: 'active', progress: 50 }, { id: 'o3', status: 'active', progress: 50 }],
    socialAccountStats: { platforms: { bluesky: { followers: 76 }, x: { followers: 50 }, linkedin: { followers: 0 } } }
  });
  st.strategicDigest.perProduct.push({ product: 'Delta', verdict: 'DECLINING', traffic: { deltaPct: -90 } });
  const r = computeProposals(st, NOW);
  const o = obj(r), c = camp(r);
  assert.strictEqual(o.northStarMetric, 'bluesky_followers', 'metric resolved from .platforms.bluesky');
  assert.strictEqual(o.metricTarget, 76 + 25, 'target = 76 + max(25, 15%)');
  assert.strictEqual(o.strategyFlag, null, 'no missing-metric flag');
  assert.ok(c.platforms.indexOf('social_x') !== -1 && c.platforms.indexOf('social_bluesky') !== -1,
    'campaign platforms include the real connected platforms, not just the fallback');
});
```

- [ ] **Step 7: Run — expect PASS**

Run: `node api/companyHeartbeat/proposal-generator.test.js`
Expected: PASS (all tests, including the new `detectSignals` cases and the flipped count cases). If any count-dependent test still fails, it wasn't re-triggered — fix its setup to use `declTrigger`/`nearDoneTrigger`.

- [ ] **Step 8: Commit**

```bash
git add api/companyHeartbeat/proposal-generator.js api/companyHeartbeat/proposal-generator.test.js
git commit -m "feat(proposals): signal-based detection, remove count-padding triggers"
```

---

## Task 3: Composer — constants, grounding, JSON extraction

**Files:**
- Create: `api/companyHeartbeat/proposal-composer.js`
- Create: `api/companyHeartbeat/proposal-composer.test.js`

- [ ] **Step 1: Write the failing tests.** Create `api/companyHeartbeat/proposal-composer.test.js`:

```js
// Run with: node api/companyHeartbeat/proposal-composer.test.js
const assert = require('assert');
const C = require('./proposal-composer');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const stateWith = (over) => Object.assign({
  objectives: [{ id: 'o1', status: 'active', title: 'Build in Public', northStarMetric: 'bluesky_followers', progress: 40 }],
  campaigns: [{ id: 'c1', status: 'active', name: 'Daily Pulse', product: 'AmbientOS', cadence: 'daily' }],
  strategicDigest: { perProduct: [{ product: 'StoryForge', verdict: 'DECLINING', traffic: { deltaPct: -32 } }] },
  socialAccountStats: { platforms: { bluesky: { followers: 80 }, x: { followers: 50 } } },
  revenueLedger: [],
  productNames: ['AmbientOS', 'StoryForge', 'AmbientScore']
}, over || {});

// ── extractJson ──
test('extractJson parses a bare JSON object', () => {
  assert.deepStrictEqual(C.extractJson('{"a":1}'), { a: 1 });
});
test('extractJson strips ```json fences', () => {
  assert.deepStrictEqual(C.extractJson('```json\n{"a":2}\n```'), { a: 2 });
});
test('extractJson finds an object amid prose', () => {
  assert.deepStrictEqual(C.extractJson('Sure! {"a":3} hope that helps'), { a: 3 });
});
test('extractJson returns null on garbage', () => {
  assert.strictEqual(C.extractJson('not json at all'), null);
  assert.strictEqual(C.extractJson(''), null);
  assert.strictEqual(C.extractJson(null), null);
});

// ── buildGrounding ──
test('buildGrounding computes follower + paying_customers baselines', () => {
  const g = C.buildGrounding({ kind: 'objective', trigger: 'near_complete', subject: {} }, stateWith({
    revenueLedger: [{ customerId: 'a', amountCents: 2900 }, { customerId: 'a', amountCents: 2900 }, { customerId: 'b', amountCents: 8900 }]
  }));
  assert.strictEqual(g.baselines.bluesky_followers, 80);
  assert.strictEqual(g.baselines.x_followers, 50);
  assert.strictEqual(g.baselines.paying_customers, 2, 'unique paying customers');
  assert.ok(g.productNames.indexOf('StoryForge') !== -1);
  assert.strictEqual(g.activeObjectives[0].northStarMetric, 'bluesky_followers');
});
test('buildGrounding paying_customers defaults to 0 with empty ledger', () => {
  const g = C.buildGrounding({ kind: 'objective', trigger: 'near_complete', subject: {} }, stateWith({}));
  assert.strictEqual(g.baselines.paying_customers, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node api/companyHeartbeat/proposal-composer.test.js`
Expected: FAIL — `Cannot find module './proposal-composer'`.

- [ ] **Step 3: Create the module with constants + helpers + `buildGrounding` + `extractJson`.** Create `api/companyHeartbeat/proposal-composer.js`:

```js
'use strict';

// proposal-composer.js — the LLM side of the proposal generator, fully isolated.
// Given a detected signal + grounding packet + an injected callModel, composes a
// specific, data-grounded campaign/objective proposal and validates it hard against
// hallucination. Pure given inputs (no storage/network of its own); the model call
// is injected so the module is unit-testable with a fake callModel.

const METRIC_ALLOWLIST = new Set([
  'bluesky_followers', 'linkedin_followers', 'x_followers',
  'paying_customers', 'scans_per_week', 'blog_views'
]);
// v1 note: baselines are computed for followers + paying_customers only. Metrics in
// the allowlist without a computed baseline (scans_per_week, blog_views) fail the
// no-baseline check → compose returns skip → deterministic fallback. Wire their
// baseline sources here to enable them.

const LOW_BASELINE_FLOOR = 10;      // below this, use the absolute cap not the multiplier
const GROWTH_MULTIPLIER_CAP = 5;    // target <= 5x baseline for baselines >= floor
const LOW_BASELINE_ABS_CAP = 25;    // target <= 25 for near-zero baselines (e.g. paying_customers 0)
const MIN_DEADLINE_DAYS = 14;
const MAX_DEADLINE_DAYS = 180;
const CAPS = { title: 100, description: 1000, rationale: 500, success: 300 };

// Valid campaign task types (mirrors materialize.js VALID_TASK_TYPES).
const VALID_CAMPAIGN_PLATFORMS = ['blog_post', 'social_linkedin', 'social_bluesky', 'social_x', 'design_asset', 'internal_doc', 'research'];

function _arr(v) { return Array.isArray(v) ? v : null; }
function _norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function _normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function _platforms(sas) { return (sas && sas.platforms) || sas || {}; }
function _followers(sas, key) {
  var p = _platforms(sas)[key];
  var n = p && Number(p.followers);
  return Number.isFinite(n) ? n : null;
}

// Count unique customers with a positive charge in the revenue ledger. Default 0.
function _payingCustomers(state) {
  var ledger = _arr(state.revenueLedger) || [];
  var set = {};
  ledger.forEach(function (e) {
    if (!e) return;
    var amt = Number(e.amountCents != null ? e.amountCents : e.amount);
    if (!(amt > 0)) return;
    var k = e.customerId || e.email || e.customer || e.id;
    if (k) set[String(k)] = true;
  });
  return Object.keys(set).length;
}

function _metricBaselines(state) {
  var sas = state.socialAccountStats || {};
  var out = {};
  var bf = _followers(sas, 'bluesky'); if (bf != null) out.bluesky_followers = bf;
  var lf = _followers(sas, 'linkedin'); if (lf != null) out.linkedin_followers = lf;
  var xf = _followers(sas, 'x'); if (xf != null) out.x_followers = xf;
  out.paying_customers = _payingCustomers(state); // always defined
  return out;
}

// A model-named product must resolve to a real product-facts name (substring either way).
function _matchesProduct(name, names) {
  var n = _normName(name);
  if (n.length < 3) return false;
  return (names || []).some(function (pn) {
    var x = _normName(pn);
    return x && (x.indexOf(n) !== -1 || n.indexOf(x) !== -1);
  });
}

function _validPlatforms(arr) {
  var v = (Array.isArray(arr) ? arr : []).filter(function (t) { return VALID_CAMPAIGN_PLATFORMS.indexOf(t) !== -1; });
  return v.length ? v.slice(0, 5) : ['social_bluesky'];
}

// Build the focused grounding packet the model reasons over.
function buildGrounding(signal, state) {
  state = state || {};
  var objectives = _arr(state.objectives) || [];
  var campaigns = _arr(state.campaigns) || [];
  var perProduct = (state.strategicDigest && _arr(state.strategicDigest.perProduct)) || [];
  return {
    signal: signal,
    baselines: _metricBaselines(state),
    productNames: _arr(state.productNames) || [],
    activeObjectives: objectives.filter(function (o) { return o && o.status === 'active'; })
      .map(function (o) { return { title: o.title || '', northStarMetric: o.northStarMetric || null, progress: Number(o.progress) || 0 }; }),
    activeCampaigns: campaigns.filter(function (c) { return c && c.status === 'active'; })
      .map(function (c) { return { name: c.name || c.title || '', product: c.product || null, cadence: c.cadence || null }; }),
    products: perProduct.map(function (p) { return { product: p.product, verdict: p.verdict, deltaPct: (p.traffic && p.traffic.deltaPct) }; })
  };
}

// Defensively pull a JSON object out of model text (bare, fenced, or amid prose).
function extractJson(text) {
  if (typeof text !== 'string') return null;
  var t = text.trim();
  var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  var s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s === -1 || e === -1 || e < s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch (_) { return null; }
}

module.exports = {
  METRIC_ALLOWLIST: METRIC_ALLOWLIST,
  buildGrounding: buildGrounding,
  extractJson: extractJson,
  // buildPrompt / validate / compose added in Task 4
  _matchesProduct: _matchesProduct,
  _validPlatforms: _validPlatforms,
  _metricBaselines: _metricBaselines,
  LOW_BASELINE_FLOOR: LOW_BASELINE_FLOOR,
  GROWTH_MULTIPLIER_CAP: GROWTH_MULTIPLIER_CAP,
  LOW_BASELINE_ABS_CAP: LOW_BASELINE_ABS_CAP,
  MIN_DEADLINE_DAYS: MIN_DEADLINE_DAYS,
  MAX_DEADLINE_DAYS: MAX_DEADLINE_DAYS,
  CAPS: CAPS
};
```

- [ ] **Step 4: Run — expect PASS**

Run: `node api/companyHeartbeat/proposal-composer.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/proposal-composer.js api/companyHeartbeat/proposal-composer.test.js
git commit -m "feat(proposals): composer grounding packet + JSON extraction"
```

---

## Task 4: Composer — prompt, validation gauntlet, compose

**Files:**
- Modify: `api/companyHeartbeat/proposal-composer.js` (add `buildPrompt`, `validate`, `compose`)
- Modify: `api/companyHeartbeat/proposal-composer.test.js` (add validation + compose tests)

- [ ] **Step 1: Write failing tests.** In `proposal-composer.test.js`, insert **before** the final `console.log('\n' + pass...)` line:

```js
// ── validate + compose ──
const NOW = Date.UTC(2026, 6, 11, 12, 0, 0); // 2026-07-11T12:00:00Z
const deadline = (days) => new Date(NOW + days * 86400000).toISOString().slice(0, 10);

const objSignal = { kind: 'objective', trigger: 'near_complete', subject: { objectiveId: 'o1', objectiveTitle: 'Build in Public' }, evidence: { progress: 99, count: 1 } };
const campSignal = { kind: 'campaign', trigger: 'declining_uncovered', subject: { product: 'StoryForge' }, evidence: { decliningProducts: [{ product: 'StoryForge', deltaPct: -32 }] } };
const grounding = () => C.buildGrounding(objSignal, stateWith({ revenueLedger: [] }));

const goodObj = () => ({
  propose: true, kind: 'objective', title: 'Land AmbientScore first paying customers',
  description: 'Convert scan traffic into paid reports.', rationale: 'StoryForge declining; revenue is the north star.',
  successCriteria: 'Reach 3 paying customers', northStarMetric: 'paying_customers',
  metricBaseline: 0, metricTarget: 3, metricDeadline: deadline(45), suggestedCampaigns: ['outbound-scans']
});

test('validate accepts a clean objective and maps to materializer shape', () => {
  const v = C.validate(goodObj(), objSignal, grounding(), NOW);
  assert.ok(v.ok, 'should be valid: ' + v.reason);
  assert.strictEqual(v.proposal.type, 'objective_proposal');
  assert.strictEqual(v.proposal.northStarMetric, 'paying_customers');
  assert.strictEqual(v.proposal.metricTarget, 3);
  assert.strictEqual(v.proposal.source, 'auto:proposal-generator');
  assert.ok(v.proposal.id.indexOf('oprop_') === 0);
});

test('validate rejects propose:false', () => {
  assert.strictEqual(C.validate({ propose: false }, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects a kind mismatch', () => {
  const p = goodObj(); p.kind = 'campaign';
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects a missing field', () => {
  const p = goodObj(); p.rationale = '';
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects an unknown metric', () => {
  const p = goodObj(); p.northStarMetric = 'moon_phase';
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects an out-of-band target for a real baseline', () => {
  const p = goodObj(); p.northStarMetric = 'bluesky_followers'; p.metricTarget = 8000; // baseline 80, 5x = 400
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects an out-of-band target for a zero baseline', () => {
  const p = goodObj(); p.metricTarget = 5000; // paying_customers baseline 0, abs cap 25
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate accepts a modest zero-baseline target (0 -> 3)', () => {
  assert.ok(C.validate(goodObj(), objSignal, grounding(), NOW).ok);
});
test('validate rejects a non-directional target', () => {
  const p = goodObj(); p.northStarMetric = 'bluesky_followers'; p.metricTarget = 80; // == baseline
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects a deadline outside the 14-180 day window', () => {
  const p = goodObj(); p.metricDeadline = deadline(5);
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects a campaign naming a fake product', () => {
  const gc = C.buildGrounding(campSignal, stateWith({}));
  const p = { propose: true, kind: 'campaign', title: 'Push Nonexistinator', description: 'x', rationale: 'y',
    successCriteria: '+40 followers', product: 'Nonexistinator', northStarMetric: 'bluesky_followers',
    metricBaseline: 80, metricTarget: 120, metricDeadline: deadline(30), platforms: ['social_bluesky'] };
  assert.strictEqual(C.validate(p, campSignal, gc, NOW).ok, false);
});
test('validate accepts a campaign naming a real product', () => {
  const gc = C.buildGrounding(campSignal, stateWith({}));
  const p = { propose: true, kind: 'campaign', title: 'Re-engage StoryForge', description: 'x', rationale: 'y',
    successCriteria: '+40 followers', product: 'StoryForge', northStarMetric: 'bluesky_followers',
    metricBaseline: 80, metricTarget: 120, metricDeadline: deadline(30), platforms: ['social_bluesky', 'bogus'] };
  const v = C.validate(p, campSignal, gc, NOW);
  assert.ok(v.ok, 'should be valid: ' + v.reason);
  assert.strictEqual(v.proposal.type, 'campaign_proposal');
  assert.deepStrictEqual(v.proposal.platforms, ['social_bluesky'], 'invalid platform filtered out');
});

// ── compose (fake callModel) ──
test('compose returns a proposal from a good model response', async () => {
  const fake = () => Promise.resolve('```json\n' + JSON.stringify(goodObj()) + '\n```');
  const r = await C.compose(objSignal, grounding(), fake, NOW);
  assert.ok(r.proposal, 'expected a proposal');
  assert.strictEqual(r.proposal.type, 'objective_proposal');
});
test('compose skips when the model throws', async () => {
  const fake = () => Promise.reject(new Error('timeout'));
  const r = await C.compose(objSignal, grounding(), fake, NOW);
  assert.ok(r.skip, 'expected skip');
});
test('compose skips on unparseable output', async () => {
  const r = await C.compose(objSignal, grounding(), () => Promise.resolve('no json here'), NOW);
  assert.ok(r.skip);
});
test('compose skips when the model declines', async () => {
  const r = await C.compose(objSignal, grounding(), () => Promise.resolve('{"propose":false}'), NOW);
  assert.ok(r.skip);
});
```

Also change the test runner to support async tests — **replace** the `test` function near the top of `proposal-composer.test.js` with:

```js
let pass = 0, fail = 0;
const _pending = [];
function test(name, fn) {
  const p = Promise.resolve().then(fn).then(
    () => { pass++; console.log('  PASS ', name); },
    (e) => { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
  );
  _pending.push(p);
}
```

And **replace** the final two lines (`console.log('\n' + pass...)` and `process.exit(...)`) with:

```js
Promise.all(_pending).then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node api/companyHeartbeat/proposal-composer.test.js`
Expected: FAIL — `C.validate`/`C.compose` are not functions.

- [ ] **Step 3: Implement `buildPrompt`, `validate`, `compose`.** In `proposal-composer.js`, add these functions **above** `module.exports`:

```js
function buildPrompt(signal, grounding) {
  var g = grounding;
  var lines = [];
  lines.push('You are Nova, prime operator of the AmbientPixels autonomous fleet.');
  lines.push('A deterministic scan found a real strategic gap. Propose the single most valuable ' + signal.kind + ' to close it.');
  lines.push('');
  lines.push('DETECTED GAP (' + signal.trigger + '): subject ' + JSON.stringify(signal.subject) + ', evidence ' + JSON.stringify(signal.evidence));
  lines.push('');
  lines.push('CURRENT STATE — ground every claim in this; invent nothing:');
  lines.push('- Active objectives: ' + JSON.stringify(g.activeObjectives));
  lines.push('- Active campaigns: ' + JSON.stringify(g.activeCampaigns));
  lines.push('- Product verdicts: ' + JSON.stringify(g.products));
  lines.push('- Metrics you may anchor on (metric: current baseline): ' + JSON.stringify(g.baselines));
  lines.push('- Real product names (only these may be named): ' + JSON.stringify(g.productNames));
  lines.push('');
  lines.push('The company north star is paying customers. Prefer a move that advances revenue when the data supports it.');
  lines.push('');
  lines.push('Return ONLY minified JSON, no prose. Shape:');
  if (signal.kind === 'objective') {
    lines.push('{"propose":true,"kind":"objective","title":"...","description":"...","rationale":"...","successCriteria":"...","northStarMetric":"<a metric key above>","metricBaseline":<number>,"metricTarget":<number>,"metricDeadline":"YYYY-MM-DD","suggestedCampaigns":["..."]}');
  } else {
    lines.push('{"propose":true,"kind":"campaign","title":"...","description":"...","rationale":"...","successCriteria":"...","product":"<a real product name or empty>","northStarMetric":"<a metric key above>","metricBaseline":<number>,"metricTarget":<number>,"metricDeadline":"YYYY-MM-DD","platforms":["social_bluesky"]}');
  }
  lines.push('Rules: metricTarget beats baseline but stays realistic (<= ~5x; for a 0 baseline propose a small count <= 25). metricDeadline 14-180 days out. If nothing here is genuinely worth proposing, return {"propose":false}.');
  return lines.join('\n');
}

// Deterministic anti-hallucination gauntlet. Returns { ok:true, proposal } or { ok:false, reason }.
function validate(parsed, signal, grounding, nowMs) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'not-object' };
  if (parsed.propose !== true) return { ok: false, reason: 'model-declined' };
  if (parsed.kind !== signal.kind) return { ok: false, reason: 'kind-mismatch' };

  var title = String(parsed.title || '').trim();
  var description = String(parsed.description || '').trim();
  var rationale = String(parsed.rationale || '').trim();
  var successCriteria = String(parsed.successCriteria || '').trim();
  if (!title || !description || !rationale || !successCriteria) return { ok: false, reason: 'missing-fields' };

  var metric = String(parsed.northStarMetric || '').trim();
  var existingMetrics = (grounding.activeObjectives || []).map(function (o) { return o.northStarMetric; }).filter(Boolean);
  if (!METRIC_ALLOWLIST.has(metric) && existingMetrics.indexOf(metric) === -1) return { ok: false, reason: 'metric-not-allowed' };

  var baseline = grounding.baselines[metric];
  if (baseline == null) return { ok: false, reason: 'no-baseline-for-metric' };
  var target = Number(parsed.metricTarget);
  if (!Number.isFinite(target)) return { ok: false, reason: 'target-not-finite' };
  if (!(target > baseline)) return { ok: false, reason: 'target-not-directional' };
  if (baseline >= LOW_BASELINE_FLOOR) {
    if (target > baseline * GROWTH_MULTIPLIER_CAP) return { ok: false, reason: 'target-out-of-band' };
  } else if (target > LOW_BASELINE_ABS_CAP) {
    return { ok: false, reason: 'target-out-of-band' };
  }

  var dl = String(parsed.metricDeadline || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dl)) return { ok: false, reason: 'deadline-format' };
  var dMs = Date.parse(dl + 'T00:00:00Z');
  if (!Number.isFinite(dMs)) return { ok: false, reason: 'deadline-invalid' };
  var days = (dMs - nowMs) / 86400000;
  if (days < MIN_DEADLINE_DAYS || days > MAX_DEADLINE_DAYS) return { ok: false, reason: 'deadline-out-of-window' };

  var product = String(parsed.product || signal.subject.product || '').trim();
  if (product && !_matchesProduct(product, grounding.productNames)) return { ok: false, reason: 'unknown-product' };

  var iso = new Date(nowMs).toISOString();
  if (signal.kind === 'objective') {
    return { ok: true, proposal: {
      id: 'oprop_' + nowMs + '_auto', type: 'objective_proposal', status: 'pending',
      proposedBy: 'nova', source: 'auto:proposal-generator',
      title: title.substring(0, CAPS.title), description: description.substring(0, CAPS.description),
      rationale: rationale.substring(0, CAPS.rationale), successCriteria: successCriteria.substring(0, CAPS.success),
      timeHorizon: Math.round(days) + ' days',
      suggestedCampaigns: Array.isArray(parsed.suggestedCampaigns) ? parsed.suggestedCampaigns.slice(0, 5) : [],
      northStarMetric: metric, metricTarget: target, metricDeadline: dl,
      strategyFlag: null, createdAt: iso
    } };
  }
  return { ok: true, proposal: {
    id: 'cprop_' + nowMs + '_auto', type: 'campaign_proposal', status: 'pending',
    proposedBy: 'nova', source: 'auto:proposal-generator',
    name: title.substring(0, CAPS.title), description: description.substring(0, CAPS.description),
    rationale: rationale.substring(0, CAPS.rationale),
    platforms: _validPlatforms(parsed.platforms), frequency: 3, cadence: 'weekly', duration: '30 days',
    product: product.substring(0, 50), kpiTarget: successCriteria.substring(0, 200),
    northStarMetric: metric, strategyFlag: null, createdAt: iso
  } };
}

// Orchestrate one composition. Returns { proposal } or { skip, reason }. Never throws.
async function compose(signal, grounding, callModel, nowMs) {
  nowMs = nowMs || Date.now();
  var text;
  try { text = await callModel(buildPrompt(signal, grounding)); }
  catch (e) { return { skip: true, reason: 'model-error:' + (e && e.message ? e.message : 'unknown') }; }
  if (!text) return { skip: true, reason: 'empty-response' };
  var parsed = extractJson(text);
  if (!parsed) return { skip: true, reason: 'unparseable' };
  var v = validate(parsed, signal, grounding, nowMs);
  if (!v.ok) return { skip: true, reason: v.reason };
  return { proposal: v.proposal };
}
```

- [ ] **Step 4: Export the new functions.** Update `module.exports` in `proposal-composer.js` to add `buildPrompt`, `validate`, `compose`:

```js
module.exports = {
  METRIC_ALLOWLIST: METRIC_ALLOWLIST,
  buildGrounding: buildGrounding,
  buildPrompt: buildPrompt,
  extractJson: extractJson,
  validate: validate,
  compose: compose,
  _matchesProduct: _matchesProduct,
  _validPlatforms: _validPlatforms,
  _metricBaselines: _metricBaselines,
  LOW_BASELINE_FLOOR: LOW_BASELINE_FLOOR,
  GROWTH_MULTIPLIER_CAP: GROWTH_MULTIPLIER_CAP,
  LOW_BASELINE_ABS_CAP: LOW_BASELINE_ABS_CAP,
  MIN_DEADLINE_DAYS: MIN_DEADLINE_DAYS,
  MAX_DEADLINE_DAYS: MAX_DEADLINE_DAYS,
  CAPS: CAPS
};
```

- [ ] **Step 5: Run — expect PASS**

Run: `node api/companyHeartbeat/proposal-composer.test.js`
Expected: PASS (all validation + compose tests).

- [ ] **Step 6: Commit**

```bash
git add api/companyHeartbeat/proposal-composer.js api/companyHeartbeat/proposal-composer.test.js
git commit -m "feat(proposals): composer prompt, validation gauntlet, compose"
```

---

## Task 5: Wire `runProposalGenerator` to compose (detect → compose → fallback → queue)

**Files:**
- Modify: `api/companyHeartbeat/proposal-generator.js` (`runProposalGenerator` + `_logProposalCreated`)
- Create: `api/companyHeartbeat/proposal-generator.run.test.js`

- [ ] **Step 1: Write the failing orchestration tests.** Create `api/companyHeartbeat/proposal-generator.run.test.js`:

```js
// Run with: node api/companyHeartbeat/proposal-generator.run.test.js
const assert = require('assert');
const { runProposalGenerator } = require('./proposal-generator');

const NOW = Date.UTC(2026, 6, 11, 12, 0, 0);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

// Minimal in-memory storage stub matching the companyStorage interface used here.
function makeStorage(initial) {
  const state = Object.assign({}, initial);
  return {
    getState: (k) => Promise.resolve(state[k]),
    setState: (k, v) => { state[k] = v; return Promise.resolve(); },
    _state: state
  };
}

// Healthy state → no signals.
function healthy() {
  return {
    campaigns: [
      { id: 'c1', status: 'active', product: 'AmbientOS' },
      { id: 'c2', status: 'active', product: 'CardForge' },
      { id: 'c3', status: 'active', product: 'StoryForge' }
    ],
    objectives: [
      { id: 'o1', status: 'active', progress: 50 },
      { id: 'o2', status: 'active', progress: 50 }
    ],
    tasks: [
      { id: 't1', campaign_id: 'c1', status: 'done', updatedAt: daysAgo(1) },
      { id: 't2', campaign_id: 'c2', status: 'done', updatedAt: daysAgo(1) },
      { id: 't3', campaign_id: 'c3', status: 'done', updatedAt: daysAgo(1) },
      { id: 't4', objective_id: 'o1', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't5', objective_id: 'o2', status: 'in-progress', updatedAt: daysAgo(1) }
    ],
    approvalQueue: [],
    runtimeMemory: { strategicDigest: { perProduct: [] } },
    socialAccountStats: { platforms: { bluesky: { followers: 80 } } },
    revenueLedger: []
  };
}

// State with a near-complete objective → one objective signal.
function nearComplete() {
  const s = healthy();
  s.objectives = [
    { id: 'o1', status: 'active', progress: 99, title: 'Build in Public' },
    { id: 'o2', status: 'active', progress: 50 }
  ];
  return s;
}

const goodObjText = JSON.stringify({
  propose: true, kind: 'objective', title: 'Land first AmbientScore customers',
  description: 'Convert scans to paid.', rationale: 'Revenue is the north star.',
  successCriteria: 'Reach 3 paying customers', northStarMetric: 'paying_customers',
  metricBaseline: 0, metricTarget: 3, metricDeadline: new Date(NOW + 45 * 86400000).toISOString().slice(0, 10),
  suggestedCampaigns: []
});

let pass = 0, fail = 0;
const _pending = [];
function test(name, fn) {
  _pending.push(Promise.resolve().then(fn).then(
    () => { pass++; console.log('  PASS ', name); },
    (e) => { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
  ));
}

test('silence: healthy state creates nothing', async () => {
  const storage = makeStorage(healthy());
  const r = await runProposalGenerator({ storage, nowMs: NOW, callModel: () => Promise.resolve(goodObjText) });
  assert.strictEqual(r.created, 0, 'no proposals on healthy state');
  assert.strictEqual((storage._state.approvalQueue || []).length, 0);
});

test('llm path: near-complete objective yields an LLM proposal', async () => {
  const storage = makeStorage(nearComplete());
  const r = await runProposalGenerator({ storage, nowMs: NOW, callModel: () => Promise.resolve(goodObjText) });
  assert.strictEqual(r.created, 1);
  const q = storage._state.approvalQueue;
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].type, 'objective_proposal');
  assert.strictEqual(q[0].northStarMetric, 'paying_customers');
  assert.strictEqual(q[0].composedBy, 'llm');
});

test('fallback path: model throws -> deterministic proposal', async () => {
  const storage = makeStorage(nearComplete());
  const r = await runProposalGenerator({ storage, nowMs: NOW, callModel: () => Promise.reject(new Error('boom')) });
  assert.strictEqual(r.created, 1);
  const q = storage._state.approvalQueue;
  assert.strictEqual(q[0].type, 'objective_proposal');
  assert.strictEqual(q[0].composedBy, 'deterministic');
});

test('no callModel injected -> deterministic proposal', async () => {
  const storage = makeStorage(nearComplete());
  const r = await runProposalGenerator({ storage, nowMs: NOW });
  assert.strictEqual(r.created, 1);
  assert.strictEqual(storage._state.approvalQueue[0].composedBy, 'deterministic');
});

test('dedup respected: pending objective_proposal blocks a new one', async () => {
  const s = nearComplete();
  s.approvalQueue = [{ type: 'objective_proposal', status: 'pending', createdAt: daysAgo(1) }];
  const storage = makeStorage(s);
  const r = await runProposalGenerator({ storage, nowMs: NOW, callModel: () => Promise.resolve(goodObjText) });
  assert.strictEqual(r.created, 0, 'pending proposal blocks a new one');
});

Promise.all(_pending).then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node api/companyHeartbeat/proposal-generator.run.test.js`
Expected: FAIL — current `runProposalGenerator` ignores `callModel`, never sets `composedBy`, and still emits count-padded proposals on `healthy()` (2 objectives), so the silence and composedBy assertions fail.

- [ ] **Step 3: Rewrite `runProposalGenerator`.** In `proposal-generator.js`, **replace** the whole `runProposalGenerator` function (currently lines 363-421) with:

```js
// ── IO orchestration ────────────────────────────────────────────────────────
// storage is injected (../_utils/companyStorage in prod). opts.callModel (optional)
// enables LLM-authored proposals; without it (or on failure) the deterministic
// builder is used. Detect → pick top per type → compose-or-fallback → queue.
async function runProposalGenerator(opts) {
  opts = opts || {};
  var storage = opts.storage;
  var nowMs = opts.nowMs || Date.now();
  var log = opts.log || function () {};
  var callModel = typeof opts.callModel === 'function' ? opts.callModel : null;
  var composer = require('./proposal-composer');
  try {
    var loaded = await Promise.all([
      storage.getState('campaigns').then(function (v) { return v || []; }),
      storage.getState('objectives').then(function (v) { return v || []; }),
      storage.getState('tasks').then(function (v) { return v || []; }),
      storage.getState('approvalQueue').then(function (v) { return v || []; }),
      storage.getState('runtimeMemory').then(function (v) { return v || {}; }),
      storage.getState('socialAccountStats').then(function (v) { return v || {}; }),
      storage.getState('revenueLedger').then(function (v) { return v || []; })
    ]);
    var productNames = [];
    try { productNames = Object.keys(require('../_data/product-facts.json').products || {}); }
    catch (_pfErr) { /* names optional — grounding falls back to empty */ }

    var state = {
      campaigns: loaded[0],
      objectives: loaded[1],
      tasks: loaded[2],
      approvalQueue: loaded[3],
      strategicDigest: (loaded[4] && loaded[4].strategicDigest) || null,
      socialAccountStats: loaded[5],
      revenueLedger: loaded[6],
      productNames: productNames
    };

    var _sysCfg = (await storage.getState('systemConfig')) || {};
    var _genEnabled = !(_sysCfg.proposalGenerator && _sysCfg.proposalGenerator.enabled === false);

    var proposals = [];
    if (_genEnabled) {
      var picks = _pickTopPerType(detectSignals(state, nowMs), state.approvalQueue, nowMs);
      for (var i = 0; i < picks.length; i++) {
        var sig = picks[i];
        var proposal = null;
        var composedBy = 'deterministic';
        if (callModel) {
          var grounding = composer.buildGrounding(sig, state);
          var composed = await composer.compose(sig, grounding, callModel, nowMs);
          if (composed && composed.proposal) { proposal = composed.proposal; composedBy = 'llm'; }
          else { log('[proposalGenerator] compose skipped (' + (composed && composed.reason) + ') — using deterministic fallback for ' + sig.kind); }
        }
        if (!proposal) { proposal = _deterministicFromSignal(sig, state, nowMs); composedBy = 'deterministic'; }
        proposal.composedBy = composedBy;
        proposals.push(proposal);
      }
    } else {
      log('[proposalGenerator] Disabled via systemConfig.proposalGenerator.enabled=false — running expiry only.');
    }

    var queue = (await storage.getState('approvalQueue')) || [];
    var expired = _expireStaleGeneratorProposals(queue, nowMs);
    proposals.forEach(function (p) { queue.push(p); });

    if (!proposals.length && !expired) {
      log('[proposalGenerator] No propose-worthy conditions; nothing created or expired.');
      return { ok: true, created: 0, expired: 0, types: [] };
    }

    await storage.setState('approvalQueue', queue);

    if (proposals.length) {
      try { await _logProposalCreated(storage, proposals, nowMs); }
      catch (_logErr) { log('[proposalGenerator] proposal-created log failed (non-fatal): ' + (_logErr && _logErr.message ? _logErr.message : String(_logErr))); }
    }

    var types = proposals.map(function (p) { return p.type; });
    log('[proposalGenerator] Created ' + proposals.length + ' proposal(s): ' + (types.join(', ') || 'none') +
      (expired ? ('; expired ' + expired + ' stale suggestion(s)') : ''));
    return { ok: true, created: proposals.length, expired: expired, types: types, proposals: proposals };
  } catch (err) {
    log('[proposalGenerator] Fatal (no-op): ' + (err && err.message ? err.message : String(err)));
    return { ok: false, created: 0, error: err && err.message ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Record `composedBy` in the governance funnel.** In `_logProposalCreated` (currently lines 343-359), **replace** the `log.push({...})` object's `details` line so it carries `composedBy`. Change:

```js
      details: { type: p.type, source: p.source || SOURCE, proposalId: p.id }
```
to:
```js
      details: { type: p.type, source: p.source || SOURCE, proposalId: p.id, composedBy: p.composedBy || 'deterministic' }
```

- [ ] **Step 5: Run the orchestration tests — expect PASS**

Run: `node api/companyHeartbeat/proposal-generator.run.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the pure tests again to confirm no regression**

Run: `node api/companyHeartbeat/proposal-generator.test.js`
Expected: PASS (unchanged from Task 2).

- [ ] **Step 7: Commit**

```bash
git add api/companyHeartbeat/proposal-generator.js api/companyHeartbeat/proposal-generator.run.test.js
git commit -m "feat(proposals): orchestrate detect->compose->fallback in runProposalGenerator"
```

---

## Task 6: Inject the production model wrapper into the cron

**Files:**
- Modify: `api/proposalGeneratorCron/index.js`

- [ ] **Step 1: Pass `callModel`.** In `api/proposalGeneratorCron/index.js`, **replace** the `require` block and the `runProposalGenerator({...})` call (currently lines 14-23) with:

```js
const storage = require('../_utils/companyStorage');
const { runProposalGenerator } = require('../companyHeartbeat/proposal-generator');
const { callGeminiProposal } = require('../companyHeartbeat/gemini');

module.exports = async function (context, timer) {
  context.log('[proposalGeneratorCron] Starting proposal scan');
  const result = await runProposalGenerator({
    storage: storage,
    nowMs: Date.now(),
    callModel: (prompt) => callGeminiProposal(prompt),
    log: function () { context.log.apply(context, arguments); }
  });
  context.log('[proposalGeneratorCron] Complete:', JSON.stringify({ ok: result.ok, created: result.created, types: result.types }));
  return result;
};
```

- [ ] **Step 2: Sanity-check the cron module loads**

Run: `node -e "require('./api/proposalGeneratorCron/index.js'); console.log('cron loads ok')"`
Expected: `cron loads ok`

- [ ] **Step 3: Commit**

```bash
git add api/proposalGeneratorCron/index.js
git commit -m "feat(proposals): cron injects callGeminiProposal for LLM-authored proposals"
```

---

## Task 7: Full test sweep, deploy, live verification

**Files:** none (verification only)

- [ ] **Step 1: Run all three suites together**

```bash
node api/companyHeartbeat/proposal-generator.test.js && \
node api/companyHeartbeat/proposal-composer.test.js && \
node api/companyHeartbeat/proposal-generator.run.test.js
```
Expected: all PASS, exit 0.

- [ ] **Step 2: Deploy**

```bash
git push origin master
```
Expected: GitHub Actions deploy succeeds (registers the changed cron + composer).

- [ ] **Step 3: Live smoke — trigger the generator**

```bash
curl -sX POST "https://ambientpixels-nova-api.azurewebsites.net/api/proposal-generator-trigger" \
  -H "x-company-secret: pixelpusher" | cat
```
Expected: a JSON result `{ ok:true, created: 0 or 1..2, ... }`. Given the current healthy state (no declining/near-complete/stale/stagnant), `created:0` is the correct, expected outcome (silence).

- [ ] **Step 4: Confirm no templated proposal was minted**

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=approvalQueue" \
  -H "x-company-secret: pixelpusher" | cat
```
Expected: no NEW `objective_proposal` titled "Establish a measurable growth objective". Any newly-created proposal (if state warranted one) should carry a real `northStarMetric` + `metricTarget` + `metricDeadline` and a specific title.

- [ ] **Step 5: Confirm the funnel records `composedBy`** (only if a proposal was created)

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=governanceLog" \
  -H "x-company-secret: pixelpusher" | cat
```
Expected: the latest `proposal-created` event's `details.composedBy` is `'llm'` (or `'deterministic'` if the model failed validation).

- [ ] **Step 6 (operational, CEO-directed — do NOT run unprompted): clear the pre-existing templated artifacts.** Only after CEO confirmation, remove the stale templated objective (`oprop_1783576800044_auto`) and the stale `content.package` (`aq-pkg_1783623622793_d24d50`) from `approvalQueue` (reject via `proposalDecide`, or filter them out with a `company-state` write). This is documented in the spec's "Operational" note; it is not part of the code change.

---

## Self-Review

**1. Spec coverage:**
- LLM-authored, reasons over real state → Tasks 3–5 (composer + wiring). ✓
- Deterministic detection, count triggers removed → Task 2 (`detectSignals`, flipped count tests). ✓
- Reuse `gemini.js` → Task 1 (`callGeminiProposal`) + Task 6 (cron injection). ✓
- Silence when no gap → Task 5 (`silence` test), Task 7 Step 3. ✓
- Deterministic fallback → Task 5 (`fallback path`, `no callModel` tests). ✓
- Materializer-valid numbers → Task 4 (`validate` maps metric/target/deadline). ✓
- Anti-hallucination gauntlet (real product, metric allowlist, sane band incl. zero-baseline cap, deadline window) → Task 4 tests. ✓
- `composedBy` observability → Task 5 Step 4. ✓
- Existing dedup / 7-day expiry preserved → Task 5 (`dedup respected` test; `_expireStaleGeneratorProposals` unchanged). ✓
- Operational cleanup of the current templated proposal → Task 7 Step 6 (gated). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows assertions. ✓

**3. Type/name consistency:** `detectSignals`, `_pickTopPerType`, `_deterministicFromSignal` defined in Task 2 and consumed in Task 5. `buildGrounding`/`compose`/`validate`/`extractJson`/`buildPrompt` defined in Tasks 3–4 and consumed in Task 5. `callGeminiProposal` defined in Task 1, consumed in Task 6. Signal shape (`kind`/`trigger`/`severity`/`subject`/`evidence`) consistent across detection, composer prompt, and validation. Proposal shapes match `materialize.js` (`northStarMetric`+`metricTarget`+`metricDeadline` → `criteria`; campaign `platforms`/`frequency`/`cadence`/`duration`/`product`). ✓

**Known v1 limitation (documented):** `scans_per_week` and `blog_views` are in `METRIC_ALLOWLIST` but have no computed baseline, so a proposal anchored on them fails `no-baseline-for-metric` → deterministic fallback. Wiring their baseline sources is a follow-up.
