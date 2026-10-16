// Run: node company-state/index.test.js   (from api/)
// HQ phase 0.3 (2026-10-16): a failed read is never empty. A storage error answers 503, not
// { value: null } — browsers read that null as "no data" and could save [] over live state.
'use strict';
const assert = require('assert');
const path = require('path');

let passed = 0;
async function t(name, fn) { try { await fn(); passed++; } catch (err) { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; } }

// Swap the storage module for a stub before loading the function.
const storagePath = require.resolve('../_utils/companyStorage');
let readResult;
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: {
    getStateWithMeta: async () => { if (readResult instanceof Error) throw readResult; return readResult; },
    getState: async () => { throw new Error('GET must use getStateWithMeta'); },
    validateSecret: () => false
  }
};
const fn = require(path.join(__dirname, 'index.js'));
const ctx = () => { const c = { log: Object.assign(() => {}, { error: () => {} }) }; return c; };
const get = async (key) => { const c = ctx(); await fn(c, { method: 'GET', query: { key }, headers: {} }); return c.res; };

(async () => {
  await t('a storage read error is a 503, never { value: null }', async () => {
    readResult = { value: null, etag: null, exists: false, failed: true };
    const res = await get('tasks');
    assert.strictEqual(res.status, 503);
    assert.ok(!('value' in res.body));
    assert.strictEqual(res.headers['Retry-After'], '30');
  });
  await t('an absent key is still 200 with value null', async () => {
    readResult = { value: null, etag: null, exists: false, failed: false };
    const res = await get('tasks');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.value, null);
  });
  await t('a normal read returns the value', async () => {
    readResult = { value: [{ id: 't1' }], etag: 'e', exists: true, failed: false };
    const res = await get('tasks');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.value, [{ id: 't1' }]);
  });
  await t('a thrown error is still a 500 (not empty)', async () => {
    readResult = new Error('boom');
    const res = await get('tasks');
    assert.strictEqual(res.status, 500);
  });
  await t('_ping and key validation are unchanged', async () => {
    assert.strictEqual((await get('_ping')).status, 200);
    assert.strictEqual((await get('nope')).status, 400);
  });
  console.log(passed + ' passed');
})();
