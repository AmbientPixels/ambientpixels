// Run with: node api/_lib/vale/jwt.test.js
const assert = require('assert');
const crypto = require('crypto');
const { verifyAccessToken } = require('./jwt');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const TENANT = '96bfe658-4094-4192-88f8-5b0874471c7e';
const CLIENT = '11111111-2222-3333-4444-555555555555';
const CEO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOW = 1800000000;

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', use: 'sig' });
const JWKS = { keys: [jwk] };
const OPTS = { jwks: JWKS, tenantId: TENANT, clientId: CLIENT, ceoOid: CEO, nowSec: NOW };

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function makeToken(over, header) {
  const h = Object.assign({ alg: 'RS256', typ: 'JWT', kid: 'k1' }, header || {});
  const p = Object.assign({
    iss: 'https://login.microsoftonline.com/' + TENANT + '/v2.0', tid: TENANT, aud: CLIENT, azp: CLIENT,
    scp: 'access_as_user', oid: CEO, exp: NOW + 3600, nbf: NOW - 60, iat: NOW - 60
  }, over || {});
  const input = b64u(JSON.stringify(h)) + '.' + b64u(JSON.stringify(p));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), privateKey);
  return input + '.' + b64u(sig);
}

(async () => {
  await test('a valid CEO token passes', () => {
    const r = verifyAccessToken(makeToken(), OPTS);
    assert.strictEqual(r.ok, true, r.reason);
    assert.strictEqual(r.claims.oid, CEO);
  });
  await test('another user in the tenant is not the CEO', () => assert.strictEqual(verifyAccessToken(makeToken({ oid: 'someone-else' }), OPTS).reason, 'not_ceo'));
  await test('wrong audience is rejected', () => assert.strictEqual(verifyAccessToken(makeToken({ aud: 'other-app' }), OPTS).reason, 'bad_aud'));
  await test('wrong tenant id is rejected', () => assert.strictEqual(verifyAccessToken(makeToken({ tid: 'other-tenant' }), OPTS).reason, 'bad_tid'));
  await test('wrong authorized party is rejected', () => assert.strictEqual(verifyAccessToken(makeToken({ azp: 'other-app' }), OPTS).reason, 'bad_azp'));
  await test('wrong issuer is rejected', () => assert.strictEqual(verifyAccessToken(makeToken({ iss: 'https://sts.windows.net/' + TENANT + '/' }), OPTS).reason, 'bad_iss'));
  await test('an expired token is rejected (beyond 5 min skew)', () => assert.strictEqual(verifyAccessToken(makeToken({ exp: NOW - 301 }), OPTS).reason, 'expired'));
  await test('a token just inside the skew still passes', () => assert.strictEqual(verifyAccessToken(makeToken({ exp: NOW - 200 }), OPTS).ok, true));
  await test('a not-yet-valid token is rejected', () => assert.strictEqual(verifyAccessToken(makeToken({ nbf: NOW + 1000 }), OPTS).reason, 'not_yet_valid'));
  await test('alg none is rejected before any key lookup', () => assert.strictEqual(verifyAccessToken(makeToken({}, { alg: 'none' }), OPTS).reason, 'bad_alg'));
  await test('a tampered payload fails the signature', () => {
    const t = makeToken().split('.');
    const forged = JSON.parse(Buffer.from(t[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    forged.oid = CEO; forged.scp = 'access_as_user Mail.Send';
    t[1] = b64u(JSON.stringify(forged));
    assert.strictEqual(verifyAccessToken(t.join('.'), OPTS).reason, 'bad_signature');
  });
  await test('a token signed by another key fails the signature', () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const t = makeToken().split('.');
    t[2] = b64u(crypto.sign('RSA-SHA256', Buffer.from(t[0] + '.' + t[1]), other));
    assert.strictEqual(verifyAccessToken(t.join('.'), OPTS).reason, 'bad_signature');
  });
  await test('an unknown key id is reported so the caller can refetch JWKS', () => assert.strictEqual(verifyAccessToken(makeToken({}, { kid: 'k2' }), OPTS).reason, 'unknown_kid'));
  await test('a token without the access_as_user scope is rejected', () => assert.strictEqual(verifyAccessToken(makeToken({ scp: 'User.Read' }), OPTS).reason, 'bad_scope'));
  await test('roles are never consulted — an app-only style token without scp fails', () => assert.strictEqual(verifyAccessToken(makeToken({ scp: undefined, roles: ['access_as_user'] }), OPTS).reason, 'bad_scope'));
  await test('garbage is malformed', () => assert.strictEqual(verifyAccessToken('not.a.jwt', OPTS).reason, 'malformed'));
  await test('missing ceoOid config never passes', () => assert.strictEqual(verifyAccessToken(makeToken(), Object.assign({}, OPTS, { ceoOid: '' })).reason, 'not_ceo'));

  // Vale Mail (2026-10-17): a second SPA asks for Vale's API — same audience, different azp.
  const VALE_MAIL_CLIENT = '99999999-8888-7777-6666-555555555555';
  const ALLOW = Object.assign({}, OPTS, { allowedClients: [CLIENT, VALE_MAIL_CLIENT] });
  await test('allow-list: azp = Vale passes', () => assert.strictEqual(verifyAccessToken(makeToken(), ALLOW).ok, true));
  await test('allow-list: azp = Vale Mail passes', () => {
    const r = verifyAccessToken(makeToken({ azp: VALE_MAIL_CLIENT }), ALLOW);
    assert.strictEqual(r.ok, true, r.reason); assert.strictEqual(r.claims.azp, VALE_MAIL_CLIENT);
  });
  await test('allow-list: an unknown azp is bad_azp', () => assert.strictEqual(verifyAccessToken(makeToken({ azp: 'other-app' }), ALLOW).reason, 'bad_azp'));
  await test('allow-list: a missing azp is bad_azp', () => assert.strictEqual(verifyAccessToken(makeToken({ azp: undefined }), ALLOW).reason, 'bad_azp'));
  await test('allow-list never widens the audience', () => assert.strictEqual(verifyAccessToken(makeToken({ aud: VALE_MAIL_CLIENT, azp: VALE_MAIL_CLIENT }), ALLOW).reason, 'bad_aud'));
  await test('no allowedClients → only clientId is accepted (back-compat)', () => {
    assert.strictEqual(verifyAccessToken(makeToken({ azp: VALE_MAIL_CLIENT }), OPTS).reason, 'bad_azp');
    assert.strictEqual(verifyAccessToken(makeToken(), OPTS).ok, true);
  });
  await test('an empty allowedClients falls back to clientId', () => {
    assert.strictEqual(verifyAccessToken(makeToken(), Object.assign({}, OPTS, { allowedClients: [] })).ok, true);
    assert.strictEqual(verifyAccessToken(makeToken({ azp: VALE_MAIL_CLIENT }), Object.assign({}, OPTS, { allowedClients: [] })).reason, 'bad_azp');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
