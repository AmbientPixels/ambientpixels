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

test('mixed batch: campaign falls back deterministic while objective composes via LLM', async () => {
  // A near-complete objective (near_complete signal) AND a declining uncovered product
  // (declining_uncovered campaign signal) in the same run. The fake callModel returns an
  // objective-shaped response: it validates for the objective (composedBy llm) but fails
  // the campaign validate with a kind-mismatch → campaign falls back deterministic.
  // Use AmbientScore (a real product NOT covered by the c1/c2/c3 campaigns) so the
  // declining_uncovered signal actually fires (StoryForge would be covered by c3).
  const s = nearComplete();
  s.runtimeMemory.strategicDigest.perProduct.push({ product: 'AmbientScore', verdict: 'DECLINING', traffic: { deltaPct: -32 } });
  const storage = makeStorage(s);
  const r = await runProposalGenerator({ storage, nowMs: NOW, callModel: () => Promise.resolve(goodObjText) });
  assert.strictEqual(r.created, 2, 'both a campaign and an objective proposal');
  const q = storage._state.approvalQueue;
  const camp = q.find((p) => p.type === 'campaign_proposal');
  const obj = q.find((p) => p.type === 'objective_proposal');
  assert.ok(camp, 'expected a campaign_proposal');
  assert.ok(obj, 'expected an objective_proposal');
  assert.strictEqual(camp.composedBy, 'deterministic', 'campaign falls back (objective-shaped model response fails campaign validate)');
  assert.strictEqual(obj.composedBy, 'llm', 'objective composes via LLM');
});

Promise.all(_pending).then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
});
