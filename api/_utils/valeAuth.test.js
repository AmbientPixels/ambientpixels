// Run with: node api/_utils/valeAuth.test.js
const assert = require('assert');
const crypto = require('crypto');
const auth = require('./valeAuth');
const valeState = require('../vale-state/index');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const TENANT = '96bfe658-4094-4192-88f8-5b0874471c7e';
const CLIENT = '11111111-2222-3333-4444-555555555555';
const CEO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOW_MS = 1800000000 * 1000;

process.env.CEO_EMAILS = 'ceo@example.com';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk1 = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1' });
const rotated = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk2 = Object.assign(rotated.publicKey.export({ format: 'jwk' }), { kid: 'k2' });

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function token(over, kid, key) {
  const h = { alg: 'RS256', typ: 'JWT', kid: kid || 'k1' };
  const p = Object.assign({ iss: 'https://login.microsoftonline.com/' + TENANT + '/v2.0', tid: TENANT, aud: CLIENT, azp: CLIENT,
    scp: 'access_as_user', oid: CEO, exp: NOW_MS / 1000 + 3600, nbf: NOW_MS / 1000 - 60 }, over || {});
  const input = b64u(JSON.stringify(h)) + '.' + b64u(JSON.stringify(p));
  return input + '.' + b64u(crypto.sign('RSA-SHA256', Buffer.from(input), key || privateKey));
}
const principal = (email) => Buffer.from(JSON.stringify({ userId: 'u1', userDetails: email, claims: [] })).toString('base64');

function deps(over) {
  let calls = 0;
  const keysets = (over && over.keysets) || [{ keys: [jwk1] }];
  const d = Object.assign({
    cfg: { tenantId: TENANT, clientId: CLIENT, ceoOid: CEO, strict: false, mailEnabled: false },
    now: () => NOW_MS,
    fetch: async () => { const ks = keysets[Math.min(calls, keysets.length - 1)]; calls++; return { ok: true, json: async () => ks }; }
  }, over || {});
  d.calls = () => calls;
  return d;
}
const req = (headers) => ({ headers: headers || {} });

(async () => {
  // Legacy sync gate (restored from the pre-2026-10-17 file).
  await test('parseCeoAllowlist splits/trims/lowercases', () => {
    assert.deepStrictEqual(auth.parseCeoAllowlist(' Chad@Example.com , second@x.io '), ['chad@example.com', 'second@x.io']);
    assert.deepStrictEqual(auth.parseCeoAllowlist(''), []);
    assert.deepStrictEqual(auth.parseCeoAllowlist(undefined), []);
  });
  await test('isCeo true for allowlisted email (case-insensitive)', () => {
    assert.strictEqual(auth.isCeo({ isAuthenticated: true, email: 'Chad@Example.com', principal: {} }, ['chad@example.com']), true);
  });
  await test('isCeo false for anonymous or non-listed', () => {
    assert.strictEqual(auth.isCeo({ isAuthenticated: false }, ['chad@example.com']), false);
    assert.strictEqual(auth.isCeo({ isAuthenticated: true, email: 'x@y.com', principal: {} }, ['chad@example.com']), false);
  });
  await test('isCeo true for ceo/admin role even without email match', () => {
    assert.strictEqual(auth.isCeo({ isAuthenticated: true, email: null, principal: { userRoles: ['authenticated', 'ceo'] } }, []), true);
  });

  await test('valid bearer → via bearer', async () => {
    auth._resetJwksCache();
    const r = await auth.requireCeoAsync(req({ authorization: 'Bearer ' + token() }), null, {}, deps());
    assert.strictEqual(r.ok, true, r.reason); assert.strictEqual(r.via, 'bearer');
  });
  await test('no bearer, strict off → legacy principal still works for non-mail paths', async () => {
    const r = await auth.requireCeoAsync(req({ 'x-ms-client-principal': principal('ceo@example.com') }), null, {}, deps());
    assert.strictEqual(r.ok, true); assert.strictEqual(r.via, 'principal');
  });
  await test('no bearer, strict on → denied even with a CEO principal', async () => {
    const d = deps(); d.cfg.strict = true;
    const r = await auth.requireCeoAsync(req({ 'x-ms-client-principal': principal('ceo@example.com') }), null, {}, d);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'bearer_required');
  });
  await test('mail paths (bearerOnly) refuse the principal even with strict off', async () => {
    const r = await auth.requireCeoAsync(req({ 'x-ms-client-principal': principal('ceo@example.com') }), null, { bearerOnly: true }, deps());
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'bearer_required');
  });
  await test('a bad bearer never falls back to a valid principal', async () => {
    auth._resetJwksCache();
    const r = await auth.requireCeoAsync(req({ authorization: 'Bearer ' + token({ oid: 'intruder' }), 'x-ms-client-principal': principal('ceo@example.com') }), null, {}, deps());
    assert.strictEqual(r.ok, false); assert.strictEqual(r.via, 'bearer'); assert.strictEqual(r.reason, 'not_ceo');
  });
  await test('a forged principal for another email is denied', async () => {
    const r = await auth.requireCeoAsync(req({ 'x-ms-client-principal': principal('someone@else.com') }), null, {}, deps());
    assert.strictEqual(r.ok, false);
  });
  await test('key rotation: unknown kid triggers one JWKS refetch, then passes', async () => {
    auth._resetJwksCache();
    const d = deps({ keysets: [{ keys: [jwk1] }, { keys: [jwk1, jwk2] }] });
    const r = await auth.requireCeoAsync(req({ authorization: 'Bearer ' + token({}, 'k2', rotated.privateKey) }), null, {}, d);
    assert.strictEqual(r.ok, true, r.reason); assert.strictEqual(d.calls(), 2);
  });
  await test('unknown kid refetch is throttled to once per 5 minutes', async () => {
    auth._resetJwksCache();
    const d = deps({ keysets: [{ keys: [jwk1] }] });
    const bad = 'Bearer ' + token({}, 'k9', rotated.privateKey);
    await auth.requireCeoAsync(req({ authorization: bad }), null, {}, d);
    await auth.requireCeoAsync(req({ authorization: bad }), null, {}, d);
    assert.strictEqual(d.calls(), 2, 'initial fetch + one refetch only');
  });
  await test('JWKS unreachable → denied, not opened', async () => {
    auth._resetJwksCache();
    const d = deps({ fetch: async () => ({ ok: false, status: 503 }) });
    const r = await auth.requireCeoAsync(req({ authorization: 'Bearer ' + token() }), null, {}, d);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'jwks_unavailable');
  });
  await test('not configured → bearer denied', async () => {
    auth._resetJwksCache();
    const d = deps(); d.cfg.ceoOid = '';
    const r = await auth.requireCeoAsync(req({ authorization: 'Bearer ' + token() }), null, {}, d);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'not_configured');
  });
  await test('bearerFrom parses only a well-formed Bearer header', () => {
    assert.strictEqual(auth.bearerFrom(req({ authorization: 'Bearer abc.def.ghi' })), 'abc.def.ghi');
    assert.strictEqual(auth.bearerFrom(req({ authorization: 'Basic abc' })), null);
    assert.strictEqual(auth.bearerFrom(req({})), null);
  });
  await test('valeConfig reads flags as exactly "1"', () => {
    assert.deepStrictEqual(auth.valeConfig({ VALE_STRICT_AUTH: '1', VALE_MAIL_ENABLED: 'true' }).mailEnabled, false);
    assert.strictEqual(auth.valeConfig({ VALE_STRICT_AUTH: '1' }).strict, true);
  });

  // vale-state end to end on the deny paths (no storage is touched before the checks).
  const ctx = () => ({ log: Object.assign(() => {}, { error: () => {}, warn: () => {} }), res: null });
  await test('vale-state: the old principal cannot read mail-derived keys or the token (rollback case)', async () => {
    for (const key of ['valeConversations', 'valeMailState', 'valeMailBriefs', 'valeMailToken', 'valeMailRules', 'valeBriefLog']) {
      const c = ctx();
      await valeState(c, { method: 'GET', query: { key }, headers: { 'x-ms-client-principal': principal('ceo@example.com') } });
      assert.strictEqual(c.res.status, 400, key);
    }
  });
  await test('vale-state: the old principal cannot use rules ops', async () => {
    const c = ctx();
    await valeState(c, { method: 'POST', body: { op: 'rules.get' }, headers: { 'x-ms-client-principal': principal('ceo@example.com') } });
    assert.strictEqual(c.res.status, 403);
  });
  await test('vale-state: set cannot write mail keys even via the old path', async () => {
    const c = ctx();
    await valeState(c, { method: 'POST', body: { op: 'set', key: 'valeMailToken', value: { evil: 1 } }, headers: { 'x-ms-client-principal': principal('ceo@example.com') } });
    assert.strictEqual(c.res.status, 400);
  });
  await test('vale-state: CORS allows the Authorization header', async () => {
    const c = ctx();
    await valeState(c, { method: 'OPTIONS', headers: {} });
    assert.ok(/Authorization/.test(c.res.headers['Access-Control-Allow-Headers']));
  });
  await test('cleanRules accepts a valid rules object and lowercases/dedups', () => {
    const r = valeState.cleanRules({ vips: ['Dana@Client.example', 'dana@client.example'], muted: [], receipts: ['stripe.com'], rulesOnlyDomains: [], projects: { AP: { domains: [], keywords: ['ambientscore'] } } });
    assert.deepStrictEqual(r.vips, ['dana@client.example']);
    assert.deepStrictEqual(r.projects.AP.keywords, ['ambientscore']);
  });
  await test('cleanRules rejects non-string entries and oversized lists', () => {
    assert.strictEqual(valeState.cleanRules({ vips: [{ x: 1 }] }), null);
    assert.strictEqual(valeState.cleanRules({ vips: new Array(201).fill('a@b.c') }), null);
    assert.strictEqual(valeState.cleanRules(null), null);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
