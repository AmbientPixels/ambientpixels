// modules/company/fleet-evolve.test.js
const test = require('node:test');
const assert = require('node:assert');
const FE = require('./fleet-evolve.js');

test('module exposes constants', () => {
  assert.strictEqual(FE.CAP_CEILING, 5.00);
  assert.deepStrictEqual(FE.ALLOWED_FIELDS, ['focus', 'monthlyCap', 'doctrine', 'expectedActionMix']);
  assert.ok(FE.PROTECTED_FIELDS.includes('reportsTo'));
});
