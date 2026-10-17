// Run with: node api/_utils/valeStorage.test.js
const assert = require('assert');
const vs = require('./valeStorage');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const MAIL_SENSITIVE = ['valeConversations', 'valeMailState', 'valeMailBriefs', 'valeMailRules', 'valeMailToken', 'valeConnectPending', 'valeMailAudit', 'valeBriefLog', 'valeDraftRate'];

(async () => {
  await test('_key prefixes every personal key with vale/', () => {
    assert.strictEqual(vs._key('valeMemory'), 'vale/valeMemory');
    assert.strictEqual(vs._key('ceoActionList'), 'vale/ceoActionList');
  });
  // Deliberately exact: adding a key must be a conscious decision about its class.
  await test('ALLOWED_KEYS covers exactly the fourteen personal keys', () => {
    const keys = Object.keys(vs.ALLOWED_KEYS).sort();
    assert.deepStrictEqual(keys, ['ceoActionList', 'ceoProfile', 'valeBriefLog', 'valeBriefs', 'valeConnectPending', 'valeConversations', 'valeDraftRate',
      'valeMailAudit', 'valeMailBriefs', 'valeMailRules', 'valeMailState', 'valeMailToken', 'valeMemory', 'valeSeed']);
  });
  await test('every key has a class', () => Object.keys(vs.ALLOWED_KEYS).forEach((k) => assert.ok(vs.keyClass(k), k)));
  await test('secrets and logs are never exposed, to anyone', () => {
    ['valeMailToken', 'valeConnectPending', 'valeMailAudit', 'valeBriefLog', 'valeDraftRate'].forEach((k) => {
      assert.strictEqual(vs.keyClass(k), 'never', k);
      ['read', 'write'].forEach((m) => ['bearer', 'principal', null].forEach((via) => assert.strictEqual(vs.accessFor(k, m, via), 'deny', k + ' ' + m + ' ' + via)));
    });
  });
  await test('mail-derived keys and chat history: bearer can read, nobody writes through vale-state', () => {
    ['valeConversations', 'valeMailState', 'valeMailBriefs'].forEach((k) => {
      assert.strictEqual(vs.accessFor(k, 'read', 'bearer'), 'allow', k);
      assert.strictEqual(vs.accessFor(k, 'write', 'bearer'), 'deny', k);
    });
  });
  // The rollback case: strict auth turned back off → callers arrive via the old principal.
  await test('rollback: the old principal can reach no mail-sensitive key', () => {
    MAIL_SENSITIVE.forEach((k) => ['read', 'write'].forEach((m) => assert.strictEqual(vs.accessFor(k, m, 'principal'), 'deny', k + ' ' + m)));
  });
  await test('rules are only reachable through their own ops', () => ['read', 'write'].forEach((m) => assert.strictEqual(vs.accessFor('valeMailRules', m, 'bearer'), 'deny')));
  await test('gate keys work with either path, as before', () => {
    ['valeSeed', 'valeMemory', 'valeBriefs', 'ceoActionList', 'ceoProfile'].forEach((k) => {
      assert.strictEqual(vs.accessFor(k, 'read', 'principal'), 'allow', k);
      assert.strictEqual(vs.accessFor(k, 'write', 'bearer'), 'allow', k);
      assert.strictEqual(vs.accessFor(k, 'read', null), 'deny', k);
    });
  });
  await test('unknown keys are denied', () => assert.strictEqual(vs.accessFor('tasks', 'read', 'bearer'), 'deny'));
  await test('getVale rejects a non-allowlisted key', () => vs.getVale('tasks').then(
    () => { throw new Error('should have rejected'); },
    (err) => assert.ok(/not allowed/.test(err.message))
  ));
  await test('mutateVale and getValeWithMeta reject a non-allowlisted key', async () => {
    await assert.rejects(vs.mutateVale('tasks', (v) => v), /not allowed/);
    await assert.rejects(vs.getValeWithMeta('tasks'), /not allowed/);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
