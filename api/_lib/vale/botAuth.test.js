// Run with: node api/_lib/vale/botAuth.test.js
// Real RS256 tokens signed with a throwaway key: the inbound check, the reply allow-list, and
// the Teams bot endpoint end to end with fakes (who it answers, what it refuses).
const assert = require('assert');
const crypto = require('crypto');
const { verifyBotToken, serviceUrlAllowed } = require('./botAuth');
const { run, clean } = require('../../vale-teams-bot');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', endorsements: ['msteams'] });
const JWKS = { keys: [jwk] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload, header) {
  const h = b64(Object.assign({ alg: 'RS256', kid: 'k1', typ: 'JWT' }, header || {}));
  const p = b64(payload);
  return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url');
}
const NOW = 1792200000;
const APP = 'bot-app-id';
const SVC = 'https://smba.trafficmanager.net/amer/';
const good = { iss: 'https://api.botframework.com', aud: APP, exp: NOW + 600, nbf: NOW - 60, serviceurl: SVC };
const V = (tok, o) => verifyBotToken(tok, Object.assign({ jwks: JWKS, appId: APP, channelId: 'msteams', serviceUrl: SVC, nowSec: NOW }, o || {}));

(async () => {
  await test('a properly signed Bot Framework token passes', () => assert.ok(V(sign(good)).ok));
  await test('wrong audience, issuer, expiry, serviceUrl and channel are each refused', () => {
    assert.strictEqual(V(sign(Object.assign({}, good, { aud: 'someone-else' }))).reason, 'bad_aud');
    assert.strictEqual(V(sign(Object.assign({}, good, { iss: 'https://evil.example' }))).reason, 'bad_iss');
    assert.strictEqual(V(sign(Object.assign({}, good, { exp: NOW - 3600 }))).reason, 'expired');
    assert.strictEqual(V(sign(good), { serviceUrl: 'https://smba.trafficmanager.net/emea/' }).reason, 'bad_serviceurl');
    assert.strictEqual(V(sign(good), { channelId: 'slack' }).reason, 'not_endorsed');
  });
  await test('a forged signature or unknown key is refused', () => {
    const t = sign(good); const forged = t.slice(0, t.lastIndexOf('.') + 1) + Buffer.from('nope').toString('base64url');
    assert.strictEqual(V(forged).reason, 'bad_signature');
    assert.strictEqual(V(sign(good, { kid: 'other' })).reason, 'unknown_kid');
    assert.strictEqual(V(sign(good, { alg: 'HS256' })).reason, 'bad_alg');
  });
  await test('replies only ever go to Bot Framework hosts', () => {
    assert.ok(serviceUrlAllowed(SVC));
    assert.ok(serviceUrlAllowed('https://smba.botframework.com/x'));
    assert.ok(!serviceUrlAllowed('https://evil.example/'));
    assert.ok(!serviceUrlAllowed('http://smba.trafficmanager.net/amer/'));
  });
  await test('mention tags and markup are stripped from Teams text', () => {
    assert.strictEqual(clean('<at>Vale</at> what <b>needs</b> me?&nbsp;'), 'what needs me?');
  });

  // Endpoint, with fakes.
  const CEO = 'chad-oid', TENANT = 'tenant-1';
  function harness(over) {
    const sent = []; const store = {}; const asked = [];
    const deps = {
      cfg: { appId: APP, appSecret: 's', tenantId: TENANT, ceoOid: CEO },
      auth: { verifyInbound: async (h) => (h === 'Bearer ok' ? { ok: true } : { ok: false, reason: 'no_token' }), serviceUrlAllowed, getOutboundToken: async () => 'out-token' },
      chat: { answer: async (o) => { asked.push(o); return { reply: 'Two things need you.' }; } },
      vs: { getVale: async (k) => store[k] || null, setVale: async (k, v) => { store[k] = v; } },
      fetch: async (url, o) => { sent.push({ url, body: JSON.parse(o.body) }); return { status: 201 }; },
      now: () => NOW * 1000, log: () => {}
    };
    return { deps: Object.assign(deps, over || {}), sent, store, asked };
  }
  const msg = (over) => ({ headers: { authorization: 'Bearer ok' }, body: Object.assign({
    type: 'message', id: 'act-1', text: 'What needs me?', channelId: 'msteams', serviceUrl: SVC,
    from: { id: '29:x', aadObjectId: CEO }, recipient: { id: '28:bot' },
    conversation: { id: 'a:conv', conversationType: 'personal', tenantId: TENANT }
  }, over || {}) });

  await test('bot: dormant until set up', async () => {
    const h = harness(); h.deps.cfg = { appId: '', appSecret: '', tenantId: '', ceoOid: '' };
    assert.strictEqual((await run(h.deps, msg())).status, 503);
  });
  await test('bot: an unsigned request is refused with 401 and nothing is sent', async () => {
    const h = harness();
    assert.strictEqual((await run(h.deps, Object.assign(msg(), { headers: {} }))).status, 401);
    assert.strictEqual(h.sent.length, 0);
  });
  await test('bot: Chad gets an answer from the shared brain, with no mail, and it is remembered', async () => {
    const h = harness();
    assert.strictEqual((await run(h.deps, msg())).status, 200);
    assert.strictEqual(h.asked[0].includeMail, false);
    assert.strictEqual(h.asked[0].where, 'teams');
    const reply = h.sent.find((s) => s.body.type === 'message');
    assert.strictEqual(reply.body.text, 'Two things need you.');
    assert.ok(reply.url.indexOf('https://smba.trafficmanager.net/amer/v3/conversations/a%3Aconv/activities/act-1') === 0, reply.url);
    assert.strictEqual(h.store.valeTeamsChat.length, 2);
  });
  await test('bot: someone else, another tenant, or a group chat is ignored', async () => {
    for (const over of [{ from: { id: '29:y', aadObjectId: 'not-chad' } }, { conversation: { id: 'a:conv', conversationType: 'personal', tenantId: 'other' } }, { conversation: { id: 'g:c', conversationType: 'groupChat', tenantId: TENANT } }]) {
      const h = harness();
      assert.strictEqual((await run(h.deps, msg(over))).status, 200);
      assert.strictEqual(h.asked.length, 0); assert.strictEqual(h.sent.length, 0);
    }
  });
  await test('bot: a reply address outside Bot Framework is never used', async () => {
    const h = harness();
    await run(h.deps, msg({ serviceUrl: 'https://evil.example/' }));
    assert.strictEqual(h.sent.length, 0);
  });
  await test('bot: a model error becomes a short apology, not silence', async () => {
    const h = harness({ chat: { answer: async () => ({ error: { status: 500 } }) } });
    await run(h.deps, msg());
    assert.ok(/glitch/.test(h.sent.find((s) => s.body.type === 'message').body.text));
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
