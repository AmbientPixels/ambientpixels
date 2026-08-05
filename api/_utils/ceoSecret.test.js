// Run with: node api/_utils/ceoSecret.test.js
// Covers isValidCeoSecret, the shared gate for the 18 endpoints that used to
// compare x-company-secret against a hardcoded 'pixelpusher' literal. The repo
// is public, so that literal was never a credential — anyone reading the source
// could mint promo codes, trigger payout runs, or approve community agents.
//
// The load-bearing case is `failopen: anonymous is not granted CEO`. Deleting the
// COMPANY_WRITE_SECRET app setting is the documented rollback, and it makes
// storage.validateSecret() return true for everything — including a request with
// no credential at all. Without the presence check, rollback would silently
// promote every anonymous caller to CEO on money-adjacent endpoints.
const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// The secret is captured at require-time in companyStorage, so both modules must
// be evicted from the cache to test a different environment.
const HELPER = require.resolve('./ceoSecret');
const STORAGE = require.resolve('./companyStorage');
function loadWith(secret) {
  delete require.cache[HELPER];
  delete require.cache[STORAGE];
  if (secret === undefined) delete process.env.COMPANY_WRITE_SECRET;
  else process.env.COMPANY_WRITE_SECRET = secret;
  return require('./ceoSecret').isValidCeoSecret;
}

const originalEnv = process.env.COMPANY_WRITE_SECRET;

console.log('enforced (COMPANY_WRITE_SECRET set):');
{
  const isValid = loadWith('s3cret-value-for-tests');
  t('accepts the configured secret', () => assert.strictEqual(isValid('s3cret-value-for-tests'), true));
  t('rejects the old public literal', () => assert.strictEqual(isValid('pixelpusher'), false));
  t('rejects a wrong secret', () => assert.strictEqual(isValid('nope'), false));
  t('rejects a missing header', () => assert.strictEqual(isValid(undefined), false));
  t('rejects an empty header', () => assert.strictEqual(isValid(''), false));
}

console.log('fail-open (COMPANY_WRITE_SECRET unset — the rollback path):');
{
  const isValid = loadWith(undefined);
  t('does NOT grant CEO to a caller sending no credential', () => assert.strictEqual(isValid(undefined), false));
  t('does NOT grant CEO on an empty header', () => assert.strictEqual(isValid(''), false));
  t('still accepts a present credential (rollback restores prior access)', () => assert.strictEqual(isValid('anything'), true));
}

if (originalEnv === undefined) delete process.env.COMPANY_WRITE_SECRET;
else process.env.COMPANY_WRITE_SECRET = originalEnv;

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
