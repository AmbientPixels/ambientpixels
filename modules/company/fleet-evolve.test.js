// modules/company/fleet-evolve.test.js
const test = require('node:test');
const assert = require('node:assert');
const FE = require('./fleet-evolve.js');

test('module exposes constants', () => {
  assert.strictEqual(FE.CAP_CEILING, 5.00);
  assert.deepStrictEqual(FE.ALLOWED_FIELDS, ['focus', 'monthlyCap', 'doctrine', 'expectedActionMix']);
  assert.ok(FE.PROTECTED_FIELDS.includes('reportsTo'));
});

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

test('computeCostDelta: cap change → delta', () => {
  assert.strictEqual(FE.computeCostDelta({ monthlyCap: 4 }, { monthlyCap: 4.5 }), 0.5);
});
test('computeCostDelta: cap decrease → negative delta', () => {
  assert.strictEqual(FE.computeCostDelta({ monthlyCap: 4 }, { monthlyCap: 3 }), -1);
});
test('computeCostDelta: no cap change → 0 (regression: old code sent full cap)', () => {
  assert.strictEqual(FE.computeCostDelta({ monthlyCap: 4 }, { monthlyCap: 4 }), 0);
});

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
