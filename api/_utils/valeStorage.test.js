// Run with: node api/_utils/valeStorage.test.js
const assert = require('assert');
const vs = require('./valeStorage');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

(async () => {
  await test('_key prefixes every personal key with vale/', () => {
    assert.strictEqual(vs._key('valeMemory'), 'vale/valeMemory');
    assert.strictEqual(vs._key('ceoActionList'), 'vale/ceoActionList');
  });
  await test('ALLOWED_KEYS covers exactly the six personal keys', () => {
    const keys = Object.keys(vs.ALLOWED_KEYS).sort();
    assert.deepStrictEqual(keys, ['ceoActionList', 'ceoProfile', 'valeBriefs', 'valeConversations', 'valeMemory', 'valeSeed']);
  });
  await test('getVale rejects a non-allowlisted key', () => vs.getVale('tasks').then(
    () => { throw new Error('should have rejected'); },
    (err) => assert.ok(/not allowed/.test(err.message))
  ));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
