// Run with: node api/companyHeartbeat/proposal-generator.test.js
// Pure-function tests for the deterministic proposal generator (computeProposals).
const assert = require('assert');
const { computeProposals, _expireStaleGeneratorProposals } = require('./proposal-generator');

const NOW = Date.UTC(2026, 5, 20, 12, 0, 0); // 2026-06-20T12:00:00Z
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

// Healthy baseline: 3 active campaigns (each covers a non-declining product, each
// has a recent completed task → not stagnant), 3 active objectives (each has a
// recent linked task → not stale, progress 50), no declining-uncovered products,
// empty queue. This baseline must produce ZERO proposals.
function baseState(overrides) {
  const s = {
    campaigns: [
      { id: 'c1', status: 'active', product: 'Alpha' },
      { id: 'c2', status: 'active', product: 'Beta' },
      { id: 'c3', status: 'active', product: 'Gamma' }
    ],
    objectives: [
      { id: 'o1', status: 'active', progress: 50 },
      { id: 'o2', status: 'active', progress: 50 },
      { id: 'o3', status: 'active', progress: 50 }
    ],
    tasks: [
      { id: 't1', campaign_id: 'c1', status: 'done', updatedAt: daysAgo(1) },
      { id: 't2', campaign_id: 'c2', status: 'done', updatedAt: daysAgo(1) },
      { id: 't3', campaign_id: 'c3', status: 'done', updatedAt: daysAgo(1) },
      { id: 't4', objective_id: 'o1', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't5', objective_id: 'o2', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't6', objective_id: 'o3', status: 'in-progress', updatedAt: daysAgo(1) }
    ],
    strategicDigest: {
      perProduct: [
        { product: 'Alpha', verdict: 'GROWING', traffic: { deltaPct: 10 } },
        { product: 'Beta', verdict: 'STABLE', traffic: { deltaPct: 0 } },
        { product: 'Gamma', verdict: 'GROWING', traffic: { deltaPct: 5 } }
      ]
    },
    // Production shape: followers live under `.platforms.<name>`, not top-level.
    socialAccountStats: { platforms: { bluesky: { followers: 300 }, x: { followers: 40 } } },
    approvalQueue: []
  };
  return Object.assign(s, overrides || {});
}

const camp = (r) => r.find((p) => p.type === 'campaign_proposal');
const obj = (r) => r.find((p) => p.type === 'objective_proposal');

// ── Test runner ──
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// ── CAMPAIGN: trigger conditions ──
test('campaign does NOT fire on count alone (fewer than 3 active campaigns)', () => {
  const r = computeProposals(baseState({ campaigns: [{ id: 'c1', status: 'active', product: 'Alpha' }] }), NOW);
  assert.ok(!camp(r), 'count padding removed — 1 healthy campaign must not propose');
});

test('campaign fires when a DECLINING product has no covering campaign', () => {
  const st = baseState({});
  st.strategicDigest.perProduct.push({ product: 'Delta', verdict: 'DECLINING', traffic: { deltaPct: -90 } });
  const r = computeProposals(st, NOW);
  assert.ok(camp(r), 'expected a campaign_proposal for the declining uncovered product');
});

test('campaign fires when all active campaigns are stagnant (no done task in 14d)', () => {
  const st = baseState({
    tasks: [
      { id: 't1', campaign_id: 'c1', status: 'done', updatedAt: daysAgo(30) },
      { id: 't2', campaign_id: 'c2', status: 'done', updatedAt: daysAgo(30) },
      { id: 't3', campaign_id: 'c3', status: 'done', updatedAt: daysAgo(30) },
      { id: 't4', objective_id: 'o1', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't5', objective_id: 'o2', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't6', objective_id: 'o3', status: 'in-progress', updatedAt: daysAgo(1) }
    ]
  });
  const r = computeProposals(st, NOW);
  const e = camp(r);
  assert.ok(e, 'expected a campaign_proposal');
  // All THREE active campaigns are stagnant → the fallback must carry every product,
  // not just the first (regression guard: single-anchor targets drop Beta/Gamma).
  assert.ok(e.description.indexOf('Alpha') !== -1 && e.description.indexOf('Beta') !== -1,
    'stagnant fallback description must include more than one product');
});

test('campaign does NOT fire on a healthy baseline', () => {
  const r = computeProposals(baseState({}), NOW);
  assert.ok(!camp(r), 'expected no campaign_proposal on healthy state');
});

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

// ── OBJECTIVE: trigger conditions ──
test('objective does NOT fire on count alone (fewer than 3 active objectives)', () => {
  const r = computeProposals(baseState({ objectives: [{ id: 'o1', status: 'active', progress: 50 }, { id: 'o2', status: 'active', progress: 50 }] }), NOW);
  assert.ok(!obj(r), 'count padding removed — 2 healthy objectives must not propose');
});

test('objective fires when an active objective is >=95% complete', () => {
  const r = computeProposals(baseState({ objectives: [{ id: 'o1', status: 'active', progress: 99 }, { id: 'o2', status: 'active', progress: 50 }, { id: 'o3', status: 'active', progress: 50 }] }), NOW);
  assert.ok(obj(r), 'expected an objective_proposal (successor needed)');
});

test('objective fires when an active objective is stale (no linked campaign/task in 14d)', () => {
  // o3 has no linked task and no campaign references it → stale. o1/o2 healthy.
  const st = baseState({
    tasks: [
      { id: 't1', campaign_id: 'c1', status: 'done', updatedAt: daysAgo(1) },
      { id: 't2', campaign_id: 'c2', status: 'done', updatedAt: daysAgo(1) },
      { id: 't3', campaign_id: 'c3', status: 'done', updatedAt: daysAgo(1) },
      { id: 't4', objective_id: 'o1', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't5', objective_id: 'o2', status: 'in-progress', updatedAt: daysAgo(1) }
    ]
  });
  assert.ok(obj(computeProposals(st, NOW)), 'expected an objective_proposal for the stale objective');
});

test('objective does NOT fire on a healthy baseline', () => {
  assert.ok(!obj(computeProposals(baseState({}), NOW)), 'expected no objective_proposal on healthy state');
});

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

// ── Fail-safe ──
test('empty/missing state is a no-op (returns [])', () => {
  assert.deepStrictEqual(computeProposals({}, NOW), []);
  assert.deepStrictEqual(computeProposals(null, NOW), []);
});

test('missing campaigns array skips campaign assessment (no crash)', () => {
  const r = computeProposals({ objectives: [{ id: 'o1', status: 'active', progress: 50 }] }, NOW);
  assert.ok(!camp(r), 'no campaign when campaigns array absent');
  assert.ok(obj(r), 'objective still assessed when its array present');
});

// ── Output shape (byte-match the existing handler entry shapes) ──
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

// ── At most 1 of each type per run ──
test('emits at most one campaign and one objective per run', () => {
  const st = declTrigger({
    objectives: [{ id: 'o1', status: 'active', progress: 99, title: 'Ship X' }, { id: 'o2', status: 'active', progress: 50 }, { id: 'o3', status: 'active', progress: 50 }]
  });
  const r = computeProposals(st, NOW);
  assert.strictEqual(r.filter((p) => p.type === 'campaign_proposal').length, 1);
  assert.strictEqual(r.filter((p) => p.type === 'objective_proposal').length, 1);
  assert.strictEqual(r.length, 2);
});

// ── Cron defers to a pending AGENT-sourced proposal (real triggers) ──
test('campaign suppressed when a pending agent campaign_proposal exists', () => {
  const st = declTrigger({ approvalQueue: [{ type: 'campaign_proposal', status: 'pending', proposedBy: 'echo', source: 'agent', createdAt: daysAgo(0) }] });
  assert.ok(!camp(computeProposals(st, NOW)), 'cron should defer to the pending agent campaign proposal');
});
test('objective suppressed when a pending agent objective_proposal exists', () => {
  const st = nearDoneTrigger({ approvalQueue: [{ type: 'objective_proposal', status: 'pending', proposedBy: 'cipher', source: 'agent', createdAt: daysAgo(0) }] });
  assert.ok(!obj(computeProposals(st, NOW)), 'cron should defer to the pending agent objective proposal');
});

// ── STRICT (2026-06-22): loop guard — childless placeholder objectives ──
// The generator's own generic "Re-activate stalled objective" creations are
// progress 0 with no campaign and no task. Old logic flagged them stale →
// proposed another → infinite junk loop. Placeholders must be IGNORED.
test('objective does NOT fire to reactivate a childless placeholder (progress 0, no campaign, no task)', () => {
  const st = baseState({
    objectives: [
      { id: 'o1', status: 'active', progress: 50 },
      { id: 'o2', status: 'active', progress: 50 },
      { id: 'o3', status: 'active', progress: 0, source: 'agent-proposal' } // placeholder
    ],
    tasks: [
      { id: 't1', campaign_id: 'c1', status: 'done', updatedAt: daysAgo(1) },
      { id: 't2', campaign_id: 'c2', status: 'done', updatedAt: daysAgo(1) },
      { id: 't3', campaign_id: 'c3', status: 'done', updatedAt: daysAgo(1) },
      { id: 't4', objective_id: 'o1', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't5', objective_id: 'o2', status: 'in-progress', updatedAt: daysAgo(1) }
      // o3 has no task and no campaign → placeholder, must not trigger reactivation
    ]
  });
  assert.ok(!obj(computeProposals(st, NOW)), 'placeholder objective must not trigger a reactivation proposal');
});

test('objective STILL fires for a SUBSTANTIVE objective that went stale (progress > 0)', () => {
  // o3 had real progress but no recent activity / no active campaign → genuine stall.
  const st = baseState({
    objectives: [
      { id: 'o1', status: 'active', progress: 50 },
      { id: 'o2', status: 'active', progress: 50 },
      { id: 'o3', status: 'active', progress: 40 }
    ],
    tasks: [
      { id: 't1', campaign_id: 'c1', status: 'done', updatedAt: daysAgo(1) },
      { id: 't2', campaign_id: 'c2', status: 'done', updatedAt: daysAgo(1) },
      { id: 't3', campaign_id: 'c3', status: 'done', updatedAt: daysAgo(1) },
      { id: 't4', objective_id: 'o1', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't5', objective_id: 'o2', status: 'in-progress', updatedAt: daysAgo(1) }
      // o3: progress 40, no campaign, no task — substantive stall → still fires
    ]
  });
  assert.ok(obj(computeProposals(st, NOW)), 'a substantive stalled objective should still get a reactivation proposal');
});

// ── STRICT (2026-06-22): unapproved generator suggestions expire after 7 days ──
test('expireStaleGeneratorProposals flips generator-sourced pending proposals older than 7d to expired', () => {
  const queue = [
    { id: 'a', type: 'objective_proposal', source: 'auto:proposal-generator', status: 'pending', createdAt: daysAgo(8) },
    { id: 'b', type: 'campaign_proposal', source: 'auto:proposal-generator', status: 'pending', createdAt: daysAgo(3) },
    { id: 'c', type: 'objective_proposal', source: 'agent', status: 'pending', createdAt: daysAgo(30) }, // not generator-sourced
    { id: 'd', type: 'objective_proposal', source: 'auto:proposal-generator', status: 'approved', createdAt: daysAgo(30) } // not pending
  ];
  const n = _expireStaleGeneratorProposals(queue, NOW);
  assert.strictEqual(n, 1, 'only the 8-day-old generator pending proposal expires');
  assert.strictEqual(queue.find((q) => q.id === 'a').status, 'expired');
  assert.strictEqual(queue.find((q) => q.id === 'b').status, 'pending');
  assert.strictEqual(queue.find((q) => q.id === 'c').status, 'pending');
  assert.strictEqual(queue.find((q) => q.id === 'd').status, 'approved');
});

// ── measurable objectives: metric pre-filled from follower data (real trigger) ──
test('objective proposal pre-fills bluesky_followers metric when follower data exists', () => {
  const e = obj(computeProposals(nearDoneTrigger({}), NOW));
  assert.strictEqual(e.northStarMetric, 'bluesky_followers', 'northStarMetric set');
  assert.ok(Number.isFinite(e.metricTarget) && e.metricTarget > 300, 'metricTarget is followers+15% (>300)');
  assert.strictEqual(e.metricBaseline, 300, 'metricBaseline = real followers baseline (anchors materialize progress)');
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

// ── (2026-06-26) product-overlap coverage: multi-product campaign covers all its targets ──
test('campaign does NOT re-fire for a declining product already covered by a MULTI-product campaign', () => {
  const st = baseState({
    // one active campaign whose description targets the declining product, even though
    // c.product names only the first target (the real-world "Re-activate A + B …" shape)
    campaigns: [
      { id: 'c1', status: 'active', product: 'Alpha', title: 'Re-activate Alpha + Delta', description: 'Targets: Alpha, Delta, Echo.' },
      { id: 'c2', status: 'active', product: 'Beta' },
      { id: 'c3', status: 'active', product: 'Gamma' }
    ]
  });
  st.strategicDigest.perProduct.push({ product: 'Delta', verdict: 'DECLINING', traffic: { deltaPct: -90 } });
  assert.ok(!camp(computeProposals(st, NOW)), 'Delta is covered by c1 description → no re-proposal');
});

test('campaign STILL fires for a declining product covered by NO campaign', () => {
  const st = baseState({});
  st.strategicDigest.perProduct.push({ product: 'Zeta', verdict: 'DECLINING', traffic: { deltaPct: -90 } });
  assert.ok(camp(computeProposals(st, NOW)), 'Zeta uncovered → still proposes');
});

// ── (2026-07-02) NO DATA is "no signal", not "declining" ──
// Uninstrumented products (verdict NO DATA) must NOT trigger a reactivation campaign.
test('campaign does NOT fire for a NO DATA (uninstrumented) product', () => {
  const st = baseState({}); // 3 healthy campaigns → no count trigger, none stagnant
  st.strategicDigest.perProduct.push({ product: 'Void', verdict: 'NO DATA', traffic: { deltaPct: 0 } });
  assert.ok(!camp(computeProposals(st, NOW)), 'NO DATA is not a declining signal → no reactivation proposal');
});

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

test('detectSignals emits all_stagnant carrying every stagnant product when all campaigns are stagnant', () => {
  const st = baseState({
    tasks: [
      { id: 't1', campaign_id: 'c1', status: 'done', updatedAt: daysAgo(30) },
      { id: 't2', campaign_id: 'c2', status: 'done', updatedAt: daysAgo(30) },
      { id: 't3', campaign_id: 'c3', status: 'done', updatedAt: daysAgo(30) },
      { id: 't4', objective_id: 'o1', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't5', objective_id: 'o2', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't6', objective_id: 'o3', status: 'in-progress', updatedAt: daysAgo(1) }
    ]
  });
  const sig = detectSignals(st, NOW).find((s) => s.kind === 'campaign' && s.trigger === 'all_stagnant');
  assert.ok(sig, 'expected an all_stagnant campaign signal');
  assert.deepStrictEqual(sig.evidence.products, ['Alpha', 'Beta', 'Gamma'], 'evidence carries all stagnant products');
});

test('detectSignals emits stale_objective for a substantive stalled objective (progress > 0, no campaign/task)', () => {
  const st = baseState({
    objectives: [
      { id: 'o1', status: 'active', progress: 50 },
      { id: 'o2', status: 'active', progress: 50 },
      { id: 'o3', status: 'active', progress: 40, title: 'Stalled goal' }
    ],
    tasks: [
      { id: 't1', campaign_id: 'c1', status: 'done', updatedAt: daysAgo(1) },
      { id: 't2', campaign_id: 'c2', status: 'done', updatedAt: daysAgo(1) },
      { id: 't3', campaign_id: 'c3', status: 'done', updatedAt: daysAgo(1) },
      { id: 't4', objective_id: 'o1', status: 'in-progress', updatedAt: daysAgo(1) },
      { id: 't5', objective_id: 'o2', status: 'in-progress', updatedAt: daysAgo(1) }
      // o3: progress 40, no campaign, no task → substantive stall
    ]
  });
  const sig = detectSignals(st, NOW).find((s) => s.kind === 'objective' && s.trigger === 'stale_objective');
  assert.ok(sig, 'expected a stale_objective signal');
  assert.strictEqual(sig.subject.objectiveId, 'o3');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
