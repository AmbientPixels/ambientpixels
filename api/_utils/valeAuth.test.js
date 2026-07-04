// Run with: node api/_utils/valeAuth.test.js
const assert = require('assert');
const v = require('./valeAuth');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

test('parseCeoAllowlist splits/trims/lowercases', () => {
  assert.deepStrictEqual(
    v.parseCeoAllowlist(' Chad@Example.com , second@x.io '),
    ['chad@example.com', 'second@x.io']
  );
  assert.deepStrictEqual(v.parseCeoAllowlist(''), []);
  assert.deepStrictEqual(v.parseCeoAllowlist(undefined), []);
});

test('isCeo true for allowlisted email (case-insensitive)', () => {
  const info = { isAuthenticated: true, email: 'Chad@Example.com', principal: {} };
  assert.strictEqual(v.isCeo(info, ['chad@example.com']), true);
});

test('isCeo false for anonymous or non-listed', () => {
  assert.strictEqual(v.isCeo({ isAuthenticated: false }, ['chad@example.com']), false);
  assert.strictEqual(v.isCeo({ isAuthenticated: true, email: 'x@y.com', principal: {} }, ['chad@example.com']), false);
});

test('isCeo true for ceo/admin role even without email match', () => {
  const info = { isAuthenticated: true, email: null, principal: { userRoles: ['authenticated', 'ceo'] } };
  assert.strictEqual(v.isCeo(info, []), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
