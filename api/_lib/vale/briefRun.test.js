// Run with: node api/_lib/vale/briefRun.test.js
const assert = require('assert');
const crypto = require('crypto');
const { runBrief } = require('./briefRun');
const tokenStore = require('./tokenStore');
const fx = require('./fixtures');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const NOW = Date.parse('2026-10-16T13:30:00Z'); // Fri 06:30 PDT
const KEY = crypto.randomBytes(32).toString('base64');
const CFG = { strict: true, mailEnabled: true, ceoAddress: 'chad@ambientpixels.ai', tenantId: 't', clientId: 'c', clientSecret: 's', tokenKey: KEY };
const RULES = { vips: ['dana@clientco.example'], muted: [], receipts: ['payco.example'], rulesOnlyDomains: ['hanson-client.example'], projects: {} };

function memStore(initial) {
  const data = Object.assign({}, initial || {});
  const s = {
    data, failReads: new Set(), ops: [],
    async getWithMeta(k) { s.ops.push('get:' + k); if (s.failReads.has(k)) return { value: null, failed: true }; return { value: data[k] === undefined ? null : data[k], failed: false }; },
    async set(k, v) { s.ops.push('set:' + k); data[k] = v; return true; },
    async mutate(k, fn) { s.ops.push('mutate:' + k); const n = await fn(data[k] === undefined ? null : data[k]); if (n !== undefined) data[k] = n; return { ok: true }; }
  };
  return s;
}
const connectedStore = (extra) => memStore(Object.assign({
  valeMailToken: tokenStore.connectionRecord({ refresh_token: 'RT' }, {}, KEY, '2026-10-15T00:00:00Z'),
  valeMailRules: RULES,
  ceoProfile: { workHours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' } }
}, extra || {}));

function fakeMicrosoft(opts) {
  opts = opts || {};
  const calls = [];
  const res = (status, body) => ({ status, ok: status < 300, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
  const f = async (url) => {
    calls.push(url);
    if (url.indexOf('/oauth2/v2.0/token') !== -1) return opts.tokenError ? res(400, { error: opts.tokenError }) : res(200, { access_token: 'AT', refresh_token: 'RT2' });
    if (url.indexOf('/mailFolders/inbox/') !== -1) return opts.inboxFail ? res(500, {}) : res(200, { value: fx.inbox });
    if (url.indexOf('/mailFolders/sentitems/') !== -1) return res(200, { value: fx.sent });
    if (url.indexOf('/calendarView') !== -1) return res(200, { value: fx.calendar });
    return res(404, {});
  };
  f.calls = calls;
  return f;
}
const fakeModel = async (o) => o.caller === 'vale-take'
  ? { text: '{"take":["Two external meetings land inside your Microsoft hours today."]}' }
  : { text: '{"items":[{"ref":"m2","label":"needs_you","why":"Asks if the Thursday demo is on"}]}' };

function deps(over) {
  const sent = [];
  const d = Object.assign({
    cfg: CFG, now: () => NOW, store: connectedStore(), fetch: fakeMicrosoft(), sleep: async () => {},
    callModel: fakeModel, seedRules: {}, sendBrief: async (m) => { sent.push(m); }, notify: null
  }, over || {});
  d.sent = sent;
  return d;
}

(async () => {
  await test('flags off → returns before any storage or network I/O', async () => {
    const d = deps({ cfg: Object.assign({}, CFG, { mailEnabled: false }) });
    assert.strictEqual((await runBrief(d)).reason, 'disabled');
    assert.deepStrictEqual(d.store.ops, []); assert.strictEqual(d.fetch.calls.length, 0);
  });
  await test('strict off → also dormant', async () => {
    const d = deps({ cfg: Object.assign({}, CFG, { strict: false }) });
    assert.strictEqual((await runBrief(d)).reason, 'disabled'); assert.deepStrictEqual(d.store.ops, []);
  });
  await test('a full morning: sends once from the brief, logs, keeps derived state only', async () => {
    const d = deps();
    const r = await runBrief(d);
    assert.strictEqual(r.sent, true, r.error);
    assert.strictEqual(d.sent.length, 1);
    assert.strictEqual(d.sent[0].to, 'chad@ambientpixels.ai');
    assert.ok(/^Vale brief — Fri, Oct 16: 4 need you · 3 meetings$/.test(d.sent[0].subject), d.sent[0].subject);
    assert.ok(d.sent[0].html.indexOf('Microsoft hours') !== -1);
    assert.ok(d.sent[0].html.indexOf('Two external meetings') !== -1, 'Vale\'s take included');
    const log = d.store.data.valeBriefLog;
    assert.strictEqual(log.days['2026-10-16'].status, 'sent'); assert.strictEqual(log.watermark, '2026-10-16T13:30:00.000Z');
    assert.strictEqual(log.lastSent.date, '2026-10-16');
    const state = JSON.stringify(d.store.data.valeMailState);
    assert.ok(state.indexOf('could you send three slots') === -1, 'no body text stored');
    assert.strictEqual(d.store.data.valeMailBriefs[0].needsYouIds.length, 4);
    assert.strictEqual(d.store.data.valeMailAudit.slice(-1)[0].ok, true);
    assert.ok(JSON.stringify(d.store.data.valeMailAudit).indexOf('Dana') === -1, 'audit holds no content');
  });
  await test('the second run the same morning does not send again', async () => {
    const d = deps(); await runBrief(d);
    d.now = () => NOW + 3600000;
    const r = await runBrief(d);
    assert.strictEqual(r.reason, 'already_sent'); assert.strictEqual(d.sent.length, 1);
  });
  await test('client (rules-only) mail never reaches the model, in triage or the take', async () => {
    const prompts = [];
    const d = deps({ callModel: async (o) => { prompts.push(o.prompt); return fakeModel(o); } });
    await runBrief(d);
    const all = prompts.join('\n');
    assert.ok(all.indexOf('Q4 portal roadmap') === -1 && all.indexOf('pat@hanson-client.example') === -1);
  });
  await test('lost access → the reconnect brief, no Graph calls', async () => {
    const d = deps({ fetch: fakeMicrosoft({ tokenError: 'invalid_grant' }) });
    const r = await runBrief(d);
    assert.strictEqual(r.sent, true);
    assert.ok(/reconnect me/.test(d.sent[0].subject));
    assert.ok(!d.fetch.calls.some((u) => u.indexOf('graph.microsoft.com') !== -1));
    assert.strictEqual(d.store.data.valeMailToken.needsReconnect, true);
  });
  await test('inbox down → brief still goes, and says the inbox could not load', async () => {
    const d = deps({ fetch: fakeMicrosoft({ inboxFail: true }) });
    const r = await runBrief(d);
    assert.strictEqual(r.sent, true);
    assert.ok(d.sent[0].html.indexOf("Couldn't load your inbox") !== -1);
    assert.ok(!d.store.data.valeBriefLog.watermark, 'no watermark when the inbox was not read');
  });
  await test('send failure → marked failed, kept on the Office page, retried next run', async () => {
    const notices = [];
    const d = deps({ sendBrief: async () => { throw new Error('sendMail 403'); }, notify: async (t) => notices.push(t) });
    const r = await runBrief(d);
    assert.strictEqual(r.sent, false);
    assert.strictEqual(d.store.data.valeBriefLog.days['2026-10-16'].status, 'failed');
    assert.strictEqual(d.store.data.valeMailBriefs[0].delivery, 'failed');
    assert.ok(notices.length === 1 && notices[0].indexOf('Dana') === -1, 'notice must carry no mail content');
    d.sendBrief = async (m) => d.sent.push(m);
    d.now = () => NOW + 3600000;
    assert.strictEqual((await runBrief(d)).sent, true);
  });
  await test('an unreadable brief log stops the run (never a duplicate or a blind send)', async () => {
    const d = deps(); d.store.failReads.add('valeBriefLog');
    assert.strictEqual((await runBrief(d)).reason, 'log_unreadable'); assert.strictEqual(d.sent.length, 0);
  });
  await test('outside 06:30–09:00 Pacific nothing happens', async () => {
    const d = deps({ now: () => Date.parse('2026-10-16T18:00:00Z') });
    assert.strictEqual((await runBrief(d)).reason, 'outside_window'); assert.strictEqual(d.sent.length, 0);
  });
  await test('watermark: the next day only re-triages mail since the last brief', async () => {
    const prompts = [];
    const d = deps({ callModel: async (o) => { prompts.push(o); return fakeModel(o); },
      store: connectedStore({ valeBriefLog: { days: {}, watermark: '2026-10-16T12:00:00Z' } }) });
    await runBrief(d);
    const triagePrompt = prompts.find((p) => p.caller === 'vale-triage');
    assert.ok(!triagePrompt || triagePrompt.prompt.indexOf('jordan@partner.example') === -1, 'older mail must not be re-triaged');
    const ids = d.store.data.valeMailState.triaged.map((i) => i.id);
    assert.ok(ids.indexOf('m-person') === -1 && ids.indexOf('m-vip') !== -1, ids.join(','));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
