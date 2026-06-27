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
