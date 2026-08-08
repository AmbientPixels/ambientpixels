// Run with: node api/companyHeartbeat/strategy-intel.test.js
// Covers the metric resolvers, with emphasis on qualified_visitors_week —
// the leading demand north star that replaced bluesky_followers on
// obj-build-public. Its whole value is that it CANNOT count our own traffic.
const assert = require('assert');
const { METRIC_RESOLVERS, evaluateObjectives } = require('./strategy-intel');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const qvw = METRIC_RESOLVERS.qualified_visitors_week;

console.log('qualified_visitors_week');

t('reads publicScans7d', function () {
  assert.strictEqual(qvw({}, { funnel: { publicScans7d: 7, scans7d: 43 } }), 7);
});

t('IGNORES scans7d — agent-minted scans must never read as demand', function () {
  // The live shape on the day this shipped: 43 total, 42 of them tier==='agent'.
  const v = qvw({}, { funnel: { scans7d: 43, publicScans7d: 1 } });
  assert.strictEqual(v, 1, 'resolved ' + v + ' — must be 1, not 43');
});

t('missing funnel resolves unmeasured (null), not 0', function () {
  assert.strictEqual(qvw({}, {}), null);
  assert.strictEqual(qvw({}, { funnel: null }), null);
});

t('missing publicScans7d resolves null, not 0', function () {
  assert.strictEqual(qvw({}, { funnel: { scans7d: 43 } }), null);
});

t('a genuine zero still resolves as 0', function () {
  assert.strictEqual(qvw({}, { funnel: { publicScans7d: 0 } }), 0);
});

t('non-numeric resolves null', function () {
  assert.strictEqual(qvw({}, { funnel: { publicScans7d: 'lots' } }), null);
});

console.log('\nobjective evaluation on the new metric');

function objFixture(criteria) {
  return [{
    id: 'obj-build-public',
    title: 'Build in Public',
    status: 'active',
    criteria: criteria
  }];
}

t('progress computes from baseline toward target', function () {
  const objs = objFixture({ metric: 'qualified_visitors_week', target: 100, by: '2026-10-31', baseline: 1 });
  evaluateObjectives(objs, { funnel: { publicScans7d: 51, scans7d: 900 } }, Date.parse('2026-08-10T00:00:00Z'));
  // (51 - 1) / (100 - 1) = 50.5% -> 51
  assert.strictEqual(objs[0].measuredValue, 51);
  assert.ok(objs[0].progress >= 49 && objs[0].progress <= 52, 'progress was ' + objs[0].progress);
});

t('unmeasured source does not fabricate progress', function () {
  const objs = objFixture({ metric: 'qualified_visitors_week', target: 100, by: '2026-10-31', baseline: 1 });
  const before = objs[0].progress;
  evaluateObjectives(objs, {}, Date.parse('2026-08-10T00:00:00Z'));
  assert.strictEqual(objs[0].measuredValue, undefined, 'measuredValue should stay unset when unresolved');
  assert.strictEqual(objs[0].progress, before);
});

console.log('\nresume_roast_runs_14d');

const rrr = METRIC_RESOLVERS.resume_roast_runs_14d;

t('reads the pre-counted number from sources', function () {
  assert.strictEqual(rrr({}, { resumeRoastRuns14d: 5 }), 5);
  assert.strictEqual(rrr({}, { resumeRoastRuns14d: 0 }), 0, 'a real measured zero is a valid value');
});

t('missing pipe resolves unmeasured (null), not 0 — the kill gate must never fire on a phantom zero', function () {
  // This metric was the objective's north star for a WEEK while no resolver
  // existed; current read 0 the whole time. obj-resume-roast-demand kills the
  // lane below 15 on 2026-08-22 — a false zero here shuts down a working lane.
  assert.strictEqual(rrr({}, {}), null);
  assert.strictEqual(rrr({}, { resumeRoastRuns14d: null }), null);
  assert.strictEqual(rrr({}, { resumeRoastRuns14d: 'not-a-number' }), null);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
