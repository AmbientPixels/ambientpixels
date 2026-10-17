// Run with: node api/vale-connect/connect.test.js
const assert = require('assert');
const crypto = require('crypto');
const connect = require('./index');
const oauth = require('../_lib/vale/oauth');
const tokenStore = require('../_lib/vale/tokenStore');
const tokenCrypto = require('../_lib/vale/tokenCrypto');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const TENANT = '96bfe658-4094-4192-88f8-5b0874471c7e';
const CEO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOW = Date.parse('2026-10-18T05:00:00Z');
const CFG = {
  tenantId: TENANT, clientId: 'client-1', clientSecret: 'shh', ceoOid: CEO,
  tokenKey: crypto.randomBytes(32).toString('base64'), loginHint: 'chad@ambientpixels.ai',
  redirectUri: 'https://api.example/api/vale-connect/callback', officeUrl: 'https://site.example/office.html'
};

function memStore(initial) {
  const data = Object.assign({}, initial || {});
  const s = {
    data,
    failReads: new Set(),
    async getWithMeta(k) { if (s.failReads.has(k)) return { value: null, failed: true }; return { value: data[k] === undefined ? null : data[k], failed: false, exists: data[k] != null }; },
    async set(k, v) { data[k] = v; return true; },
    async mutate(k, fn) { const next = await fn(data[k] === undefined ? null : data[k]); if (next !== undefined) data[k] = next; return { ok: true }; }
  };
  return s;
}
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (claims) => b64u({ alg: 'RS256' }) + '.' + b64u(claims) + '.sig';

function fakeMicrosoft(responder) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: init && init.body }); const r = responder(url, init); return { status: r.status || 200, json: async () => r.body }; };
  f.calls = calls;
  return f;
}
const ctx = () => ({ log: Object.assign(() => {}, { error: () => {} }), res: null });
const okAuth = async () => ({ ok: true, via: 'bearer' });
const noAuth = async () => ({ ok: false, reason: 'bearer_required' });

function deps(over) {
  return Object.assign({ cfg: CFG, auth: okAuth, store: memStore(), fetch: fakeMicrosoft(() => ({ body: {} })), now: () => NOW }, over || {});
}

(async () => {
  await test('PKCE challenge is the S256 of the verifier', () => {
    const p = oauth.makePkce();
    const expect = crypto.createHash('sha256').update(p.verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.strictEqual(p.challenge, expect);
  });
  await test('authorize URL asks only for the read-only scopes, with PKCE and the login hint', () => {
    const u = new URL(oauth.authorizeUrl(CFG, 'st', 'ch'));
    assert.strictEqual(u.searchParams.get('scope'), 'openid profile offline_access User.Read Mail.Read Calendars.Read');
    assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(u.searchParams.get('login_hint'), 'chad@ambientpixels.ai');
    assert.ok(u.href.indexOf('Mail.Send') === -1 && u.href.indexOf('ReadWrite') === -1);
  });

  await test('not configured → 503 for API ops, error redirect for callback', async () => {
    const d = deps({ cfg: Object.assign({}, CFG, { clientSecret: '' }) });
    let c = ctx(); await connect.handle(c, { method: 'GET', params: { op: 'status' } }, d);
    assert.strictEqual(c.res.status, 503);
    c = ctx(); await connect.handle(c, { method: 'GET', params: { op: 'callback' }, query: {} }, d);
    assert.strictEqual(c.res.status, 302); assert.ok(/reason=not_configured/.test(c.res.headers.Location));
  });
  await test('a 16-byte token key counts as not configured', () => assert.strictEqual(connect.isConfigured(Object.assign({}, CFG, { tokenKey: crypto.randomBytes(16).toString('base64') })), false));
  await test('status/start/disconnect require a bearer token', async () => {
    for (const [method, op] of [['GET', 'status'], ['GET', 'start'], ['POST', 'disconnect'], ['POST', 'forget']]) {
      const c = ctx(); await connect.handle(c, { method, params: { op } }, deps({ auth: noAuth }));
      assert.strictEqual(c.res.status, 401, op);
    }
  });
  await test('start stores a pending state + verifier and returns the Microsoft URL', async () => {
    const d = deps(); const c = ctx();
    await connect.handle(c, { method: 'GET', params: { op: 'start' } }, d);
    assert.strictEqual(c.res.status, 200);
    const p = d.store.data.valeConnectPending;
    assert.ok(p.state && p.verifier);
    assert.strictEqual(new URL(c.res.body.url).searchParams.get('state'), p.state);
  });

  async function runCallback(store, query, msResponse) {
    const d = deps({ store, fetch: fakeMicrosoft(() => msResponse) });
    const c = ctx();
    await connect.handle(c, { method: 'GET', params: { op: 'callback' }, query }, d);
    return { c, d };
  }
  const goodToken = { refresh_token: 'RT-1', access_token: 'AT', scope: oauth.SCOPES, id_token: idToken({ tid: TENANT, oid: CEO, preferred_username: 'chad@ambientpixels.ai' }) };
  const pendingNow = () => ({ valeConnectPending: { state: 'S1', verifier: 'V1', createdAt: new Date(NOW - 60000).toISOString() } });

  await test('good callback saves an encrypted token, never the plaintext', async () => {
    const store = memStore(pendingNow());
    const { c, d } = await runCallback(store, { code: 'C', state: 'S1' }, { body: goodToken });
    assert.ok(/connect=ok/.test(c.res.headers.Location), c.res.headers.Location);
    const rec = store.data.valeMailToken;
    assert.ok(rec && rec.box); assert.strictEqual(rec.account, 'chad@ambientpixels.ai');
    assert.ok(JSON.stringify(store.data).indexOf('RT-1') === -1, 'plaintext refresh token stored');
    assert.strictEqual(tokenCrypto.decrypt(rec.box, CFG.tokenKey), 'RT-1');
    assert.strictEqual(store.data.valeConnectPending, null, 'state must be single-use');
    assert.ok(/code_verifier=V1/.test(d.fetch.calls[0].body));
  });
  await test('callback with the wrong state saves nothing', async () => {
    const store = memStore(pendingNow());
    const { c } = await runCallback(store, { code: 'C', state: 'FORGED' }, { body: goodToken });
    assert.ok(/reason=bad_state/.test(c.res.headers.Location)); assert.ok(!store.data.valeMailToken);
  });
  await test('a replayed callback fails (state is single-use)', async () => {
    const store = memStore(pendingNow());
    await runCallback(store, { code: 'C', state: 'S1' }, { body: goodToken });
    store.data.valeMailToken = null;
    const { c } = await runCallback(store, { code: 'C', state: 'S1' }, { body: goodToken });
    assert.ok(/reason=bad_state/.test(c.res.headers.Location)); assert.ok(!store.data.valeMailToken);
  });
  await test('an expired state saves nothing', async () => {
    const store = memStore({ valeConnectPending: { state: 'S1', verifier: 'V1', createdAt: new Date(NOW - 11 * 60000).toISOString() } });
    const { c } = await runCallback(store, { code: 'C', state: 'S1' }, { body: goodToken });
    assert.ok(/reason=expired/.test(c.res.headers.Location)); assert.ok(!store.data.valeMailToken);
  });
  await test('signing in as anyone but the CEO saves nothing', async () => {
    const store = memStore(pendingNow());
    const other = Object.assign({}, goodToken, { id_token: idToken({ tid: TENANT, oid: 'someone-else' }) });
    const { c } = await runCallback(store, { code: 'C', state: 'S1' }, { body: other });
    assert.ok(/reason=wrong_account/.test(c.res.headers.Location)); assert.ok(!store.data.valeMailToken);
  });
  await test('a failed code exchange saves nothing', async () => {
    const store = memStore(pendingNow());
    const { c } = await runCallback(store, { code: 'C', state: 'S1' }, { status: 400, body: { error: 'invalid_grant' } });
    assert.ok(/reason=exchange_failed/.test(c.res.headers.Location)); assert.ok(!store.data.valeMailToken);
  });
  await test('Microsoft-side error is passed through as a reason', async () => {
    const { c } = await runCallback(memStore(pendingNow()), { error: 'access_denied' }, { body: {} });
    assert.ok(/reason=microsoft_access_denied/.test(c.res.headers.Location));
  });

  await test('status never returns the token box', async () => {
    const store = memStore({ valeMailToken: tokenStore.connectionRecord({ refresh_token: 'RT' }, { preferred_username: 'chad@ambientpixels.ai' }, CFG.tokenKey, '2026-10-18T05:00:00Z') });
    const c = ctx(); await connect.handle(c, { method: 'GET', params: { op: 'status' } }, deps({ store }));
    assert.strictEqual(c.res.status, 200);
    assert.strictEqual(c.res.body.connection.connected, true);
    assert.ok(JSON.stringify(c.res.body).indexOf('"box"') === -1);
  });
  await test('status on a failed store read is 503, not "not connected"', async () => {
    const store = memStore(); store.failReads.add('valeMailToken');
    const c = ctx(); await connect.handle(c, { method: 'GET', params: { op: 'status' } }, deps({ store }));
    assert.strictEqual(c.res.status, 503);
  });
  await test('disconnect clears the token and audits it', async () => {
    const store = memStore({ valeMailToken: { box: { v: 1 } } });
    const c = ctx(); await connect.handle(c, { method: 'POST', params: { op: 'disconnect' } }, deps({ store }));
    assert.strictEqual(store.data.valeMailToken, null);
    assert.strictEqual(store.data.valeMailAudit.slice(-1)[0].run, 'disconnect');
  });

  await test('test-brief needs a bearer token', async () => {
    let ran = false;
    const c = ctx(); await connect.handle(c, { method: 'POST', params: { op: 'test-brief' } }, deps({ auth: noAuth, runTest: async () => { ran = true; return {}; } }));
    assert.strictEqual(c.res.status, 401); assert.strictEqual(ran, false);
  });
  await test('test-brief maps run results to clear responses', async () => {
    const cases = [[{ ran: true, sent: true, subject: '[Test] Vale brief' }, 200], [{ ran: false, reason: 'too_soon' }, 429],
      [{ ran: false, reason: 'disabled' }, 409], [{ ran: true, sent: false, error: 'sendMail 403' }, 502], [{ ran: false, reason: 'log_unreadable' }, 503]];
    for (const [result, status] of cases) {
      const c = ctx(); await connect.handle(c, { method: 'POST', params: { op: 'test-brief' } }, deps({ runTest: async () => result }));
      assert.strictEqual(c.res.status, status, JSON.stringify(result));
    }
  });

  // Token store
  const connected = () => memStore({ valeMailToken: tokenStore.connectionRecord({ refresh_token: 'RT-OLD' }, {}, CFG.tokenKey, '2026-10-17T00:00:00Z') });
  await test('refresh returns an access token and rotates the stored refresh token', async () => {
    const store = connected();
    const f = fakeMicrosoft(() => ({ body: { access_token: 'AT-NEW', refresh_token: 'RT-NEW' } }));
    const at = await tokenStore.getAccessToken({ cfg: CFG, fetch: f, store, now: () => NOW });
    assert.strictEqual(at, 'AT-NEW');
    assert.strictEqual(tokenCrypto.decrypt(store.data.valeMailToken.box, CFG.tokenKey), 'RT-NEW');
    assert.ok(/refresh_token=RT-OLD/.test(f.calls[0].body));
  });
  await test('invalid_grant marks needsReconnect and throws ReconnectError', async () => {
    const store = connected();
    const f = fakeMicrosoft(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    await assert.rejects(tokenStore.getAccessToken({ cfg: CFG, fetch: f, store, now: () => NOW }), (e) => e.name === 'ReconnectError');
    assert.strictEqual(store.data.valeMailToken.needsReconnect, true);
    assert.strictEqual(tokenStore.statusOf(store.data.valeMailToken).connected, false);
  });
  await test('not connected → ReconnectError; failed read → StoreError (never confused)', async () => {
    await assert.rejects(tokenStore.getAccessToken({ cfg: CFG, fetch: fakeMicrosoft(() => ({ body: {} })), store: memStore() }), (e) => e.name === 'ReconnectError');
    const s = memStore(); s.failReads.add('valeMailToken');
    await assert.rejects(tokenStore.getAccessToken({ cfg: CFG, fetch: fakeMicrosoft(() => ({ body: {} })), store: s }), (e) => e.name === 'StoreError');
  });
  await test('a transient refresh failure is not a reconnect', async () => {
    const store = connected();
    await assert.rejects(tokenStore.getAccessToken({ cfg: CFG, fetch: fakeMicrosoft(() => ({ status: 503, body: { error: 'temporarily_unavailable' } })), store, now: () => NOW }), (e) => e.name !== 'ReconnectError');
    assert.ok(!store.data.valeMailToken.needsReconnect);
  });
  await test('disconnect during a run is not undone by the token rotation', async () => {
    const store = connected();
    const f = fakeMicrosoft(() => { store.data.valeMailToken = null; return { body: { access_token: 'AT', refresh_token: 'RT2' } }; });
    await tokenStore.getAccessToken({ cfg: CFG, fetch: f, store, now: () => NOW });
    assert.strictEqual(store.data.valeMailToken, null);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
