// Run with: node api/vale-draft/draft-endpoint.test.js
const assert = require('assert');
const endpoint = require('./index');
const { LlmUnavailableError } = require('../_lib/llm');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const NOW = Date.parse('2026-10-17T09:15:00Z');
const CANARY = 'CANARY-7f3e-do-not-log';
const SEED = { rulesOnlyDomains: ['clientco.example'] };

function memStore(initial) {
  const data = Object.assign({}, initial || {});
  const s = {
    data,
    failReads: new Set(),
    failMutate: false,
    async getWithMeta(k) { if (s.failReads.has(k)) return { value: null, failed: true }; return { value: data[k] === undefined ? null : data[k], failed: false }; },
    async mutate(k, fn) {
      if (s.failMutate) throw new Error('[CompanyStorage] read failed for "' + k + '"');
      const next = await fn(data[k] === undefined ? null : data[k]);
      if (next !== undefined) data[k] = next;
      return { ok: true, written: next !== undefined };
    }
  };
  return s;
}

// Captures every log call, so the canary check sees all of them.
function ctx() {
  const lines = [];
  const rec = (...a) => lines.push(a.map(String).join(' '));
  const log = Object.assign(rec, { error: rec, warn: rec, info: rec, verbose: rec });
  return { log, lines, res: null };
}

const okAuth = async () => ({ ok: true, via: 'bearer', claims: { azp: 'vale-mail' } });
function fakeModel(text) {
  const calls = [];
  const f = async (opts) => { calls.push(opts); return { text: text === undefined ? 'Hi Dana,\n\nTuesday works.\n\nChad' : text }; };
  f.calls = calls;
  return f;
}
function deps(over) {
  return Object.assign({ auth: okAuth, store: memStore(), callModel: fakeModel(), seedRules: SEED, voice: { signOff: 'Chad' }, now: () => NOW }, over || {});
}
const body = (over) => Object.assign({ from: 'dana@vendor.example', fromName: 'Dana', subject: 'Kickoff', latest: 'Can we meet Tuesday?' }, over || {});
async function post(d, b, method) {
  const c = ctx();
  await endpoint.handle(c, { method: method || 'POST', headers: {}, body: b }, d);
  return c;
}

(async () => {
  await test('OPTIONS → 204 without auth', async () => {
    let called = false;
    const c = await post(deps({ auth: async () => { called = true; return { ok: false }; } }), null, 'OPTIONS');
    assert.strictEqual(c.res.status, 204); assert.strictEqual(called, false);
  });
  await test('auth is asked for bearer only', async () => {
    let seen = null;
    await post(deps({ auth: async (req, context, opts) => { seen = opts; return { ok: true, via: 'bearer', claims: {} }; } }), body());
    assert.deepStrictEqual(seen, { bearerOnly: true });
  });
  await test('no bearer → 403', async () => {
    const c = await post(deps({ auth: async () => ({ ok: false, via: null, reason: 'bearer_required' }) }), body());
    assert.strictEqual(c.res.status, 403); assert.strictEqual(c.res.body.reason, 'bearer_required');
  });
  await test('a principal pass (not bearer) is still 403', async () => {
    const d = deps({ auth: async () => ({ ok: true, via: 'principal' }) });
    const c = await post(d, body());
    assert.strictEqual(c.res.status, 403); assert.strictEqual(d.callModel.calls.length, 0);
  });
  await test('GET → 405', async () => assert.strictEqual((await post(deps(), body(), 'GET')).res.status, 405));
  await test('bad body → 400 with the code, model never called', async () => {
    const d = deps();
    const c = await post(d, body({ stance: 'maybe' }));
    assert.strictEqual(c.res.status, 400); assert.strictEqual(c.res.body.code, 'bad_stance'); assert.strictEqual(d.callModel.calls.length, 0);
  });
  await test('a JSON string body is parsed; junk is 400 bad_body', async () => {
    assert.strictEqual((await post(deps(), JSON.stringify(body()))).res.status, 200);
    const c = await post(deps(), '{nope');
    assert.strictEqual(c.res.status, 400); assert.strictEqual(c.res.body.code, 'bad_body');
  });
  await test('happy path → 200 { draft }, no-store, the right model options', async () => {
    const d = deps();
    const c = await post(d, body());
    assert.strictEqual(c.res.status, 200);
    assert.strictEqual(c.res.body.draft, 'Hi Dana,\n\nTuesday works.\n\nChad');
    assert.strictEqual(c.res.headers['Cache-Control'], 'no-store');
    const o = d.callModel.calls[0];
    assert.strictEqual(o.model, 'claude-sonnet'); assert.strictEqual(o.caller, 'vale-draft');
    assert.strictEqual(o.maxTokens, 800); assert.strictEqual(o.temperature, 0.4);
    assert.strictEqual(o.noFallback, false);
    assert.ok(o.system && o.prompt.indexOf('<email>') !== -1);
  });
  await test('the rate record holds only the hour and a count', async () => {
    const d = deps();
    await post(d, body());
    assert.deepStrictEqual(d.store.data.valeDraftRate, { hour: '2026-10-17T09', count: 1 });
  });
  await test('31st call in an hour → 429, model not called', async () => {
    const d = deps();
    for (let i = 0; i < 30; i++) assert.strictEqual((await post(d, body())).res.status, 200, 'call ' + (i + 1));
    const c = await post(d, body());
    assert.strictEqual(c.res.status, 429);
    assert.strictEqual(d.callModel.calls.length, 30);
    assert.strictEqual(d.store.data.valeDraftRate.count, 30);
  });
  await test('a new hour resets the count', async () => {
    const d = deps({ store: memStore({ valeDraftRate: { hour: '2026-10-17T08', count: 30 } }) });
    const c = await post(d, body());
    assert.strictEqual(c.res.status, 200); assert.deepStrictEqual(d.store.data.valeDraftRate, { hour: '2026-10-17T09', count: 1 });
  });
  await test('rate store failure → 503, model not called', async () => {
    const store = memStore(); store.failMutate = true;
    const d = deps({ store });
    const c = await post(d, body());
    assert.strictEqual(c.res.status, 503); assert.strictEqual(d.callModel.calls.length, 0);
  });
  await test('client thread (sender) → noFallback: true', async () => {
    const d = deps();
    await post(d, body({ from: 'pat@clientco.example' }));
    assert.strictEqual(d.callModel.calls[0].noFallback, true);
  });
  await test('client thread (recipient) → noFallback: true', async () => {
    const d = deps();
    await post(d, { mode: 'compose', to: ['pat@clientco.example'], instruction: 'Ask for the SOW' });
    assert.strictEqual(d.callModel.calls[0].noFallback, true);
  });
  await test('saved rules win over the seed', async () => {
    const d = deps({ store: memStore({ valeMailRules: { rulesOnlyDomains: ['newclient.example'] } }) });
    await post(d, body({ from: 'a@newclient.example' }));
    assert.strictEqual(d.callModel.calls[0].noFallback, true);
  });
  await test('a failed rules read fails safe: Claude only', async () => {
    const store = memStore(); store.failReads.add('valeMailRules');
    const d = deps({ store });
    const c = await post(d, body());
    assert.strictEqual(c.res.status, 200); assert.strictEqual(d.callModel.calls[0].noFallback, true);
  });
  await test('model down → 502 model_unavailable', async () => {
    const d = deps({ callModel: async () => { throw new LlmUnavailableError('All models failed: claude-sonnet=capacity', 'capacity', []); } });
    const c = await post(d, body());
    assert.strictEqual(c.res.status, 502); assert.strictEqual(c.res.body.code, 'model_unavailable');
  });
  await test('an empty model answer → 502 empty_draft', async () => {
    const c = await post(deps({ callModel: fakeModel('```\n```') }), body());
    assert.strictEqual(c.res.status, 502); assert.strictEqual(c.res.body.code, 'empty_draft');
  });
  await test('the model answer is cleaned (fences, Subject: line)', async () => {
    const c = await post(deps({ callModel: fakeModel('```\nSubject: Re: Kickoff\nHi Dana,\nYes.\n```') }), body());
    assert.strictEqual(c.res.body.draft, 'Hi Dana,\nYes.');
  });

  // Privacy: a canary in every text field must never reach a log, on any path.
  await test('mail text never appears in any context.log call, success or failure', async () => {
    const b = body({ fromName: CANARY, subject: CANARY, latest: CANARY + ' latest', prior: [CANARY], instruction: CANARY });
    const paths = [
      deps(),
      deps({ callModel: async () => { throw new LlmUnavailableError('All models failed ' + CANARY, 'error', []); } }),
      deps({ callModel: async () => { throw new Error('boom ' + CANARY); } }),
      deps({ callModel: fakeModel('') }),
      (() => { const s = memStore(); s.failMutate = true; return deps({ store: s }); })()
    ];
    let logged = 0;
    for (const d of paths) {
      const c = await post(d, b);
      logged += c.lines.length;
      c.lines.forEach((l) => assert.ok(l.indexOf(CANARY) === -1, 'leaked: ' + l));
      assert.ok(JSON.stringify(c.res.body).indexOf(CANARY) === -1 || c.res.status === 200, 'error body leaked');
    }
    assert.ok(logged > 0, 'error paths should log a code');
  });
  await test('an unexpected error → 500 with a code only', async () => {
    const c = await post(deps({ callModel: async () => { throw new Error('boom ' + CANARY); } }), body());
    assert.strictEqual(c.res.status, 500); assert.strictEqual(c.res.body.code, 'fault');
    assert.ok(c.lines.some((l) => l === '[vale-draft] fault'));
  });

  // ── browser-flagged client threads (round 1) ──
  await test('client: true from the browser → noFallback: true even for an internal sender', async () => {
    const d = deps();
    const c = await post(d, body({ from: 'colleague@ambientpixels.ai', to: ['chad@ambientpixels.ai'], client: true }));
    assert.strictEqual(c.res.status, 200);
    assert.strictEqual(d.callModel.calls[0].noFallback, true);
  });
  await test('client: false cannot downgrade a client thread', async () => {
    const d = deps();
    await post(d, body({ from: 'pat@clientco.example', client: false }));
    assert.strictEqual(d.callModel.calls[0].noFallback, true);
  });
  await test('a Reply-To / recipient on the client domain → noFallback: true', async () => {
    const d = deps();
    await post(d, body({ from: 'dana@vendor.example', to: ['chad@ambientpixels.ai', 'kim@clientco.example'] }));
    assert.strictEqual(d.callModel.calls[0].noFallback, true);
  });
  await test('client must be a boolean → 400 bad_client', async () => {
    const d = deps();
    const c = await post(d, body({ client: 'yes' }));
    assert.strictEqual(c.res.status, 400); assert.strictEqual(c.res.body.code, 'bad_client');
    assert.strictEqual(d.callModel.calls.length, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
