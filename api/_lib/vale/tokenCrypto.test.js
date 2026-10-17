// Run with: node api/_lib/vale/tokenCrypto.test.js
const assert = require('assert');
const crypto = require('crypto');
const tc = require('./tokenCrypto');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const KEY = crypto.randomBytes(32).toString('base64');
const SECRET = '0.AXoAWOa_lpRAkkGI-FsIdEcc_rt-refresh-token-example';

(async () => {
  await test('round-trip returns the original token', () => assert.strictEqual(tc.decrypt(tc.encrypt(SECRET, KEY), KEY), SECRET));
  await test('the box never contains the plaintext', () => {
    const box = tc.encrypt(SECRET, KEY);
    assert.ok(JSON.stringify(box).indexOf('refresh-token-example') === -1);
    assert.deepStrictEqual(Object.keys(box).sort(), ['ct', 'iv', 'tag', 'v']);
  });
  await test('two encryptions differ (random IV)', () => assert.notStrictEqual(tc.encrypt(SECRET, KEY).ct, tc.encrypt(SECRET, KEY).ct));
  await test('a tampered ciphertext fails to open', () => {
    const box = tc.encrypt(SECRET, KEY);
    const ct = Buffer.from(box.ct, 'base64'); ct[0] ^= 1; box.ct = ct.toString('base64');
    assert.throws(() => tc.decrypt(box, KEY));
  });
  await test('the wrong key fails to open', () => assert.throws(() => tc.decrypt(tc.encrypt(SECRET, KEY), crypto.randomBytes(32).toString('base64'))));
  await test('a 16-byte key is rejected', () => {
    assert.throws(() => tc.encrypt(SECRET, crypto.randomBytes(16).toString('base64')), /32 bytes/);
    assert.strictEqual(tc.isValidKey(crypto.randomBytes(16).toString('base64')), false);
    assert.strictEqual(tc.isValidKey(KEY), true);
    assert.strictEqual(tc.isValidKey(''), false);
  });
  await test('an unknown box shape is rejected', () => assert.throws(() => tc.decrypt({ v: 2 }, KEY), /unsupported/));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
