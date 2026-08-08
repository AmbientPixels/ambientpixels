// Run with: node api/discord-interactions/bot.test.js
//
// Drives the real handler through the whole Discord lifecycle: the signature
// probe, PING, /roast, modal submit, the deferred ack, and the followup edit.
// The parts most worth guarding are the ones that cost money or leak data —
// the quota claim and what actually reaches the channel.

const assert = require('assert');
const crypto = require('crypto');

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
process.env.DISCORD_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');
process.env.DISCORD_APPLICATION_ID = 'test-app';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';

// ── stub storage (with a working mutateState) ──
const storagePath = require.resolve('../_utils/companyStorage');
let STATE = {};
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true, exports: {
    getState: async k => STATE[k] || null,
    setState: async (k, v) => { STATE[k] = v; },
    mutateState: async (k, mutator) => {
      const next = await mutator(STATE[k] || null, { attempt: 1, exists: STATE[k] !== undefined });
      if (next === undefined) return { ok: true, written: false };
      STATE[k] = next;
      return { ok: true, written: true };
    },
    logClaudeUsage: async () => {}, logGeminiUsage: async () => {}
  }
};

// ── stub fetch: captures Discord followups, serves the model ──
const fetchPath = require.resolve('node-fetch');
let followups = [];
let modelReply = JSON.stringify({ ats_score: 41, verdict: 'All roadmap, zero delivery.', roast_points: ['Vague bullets'], keyword_gap: ['payments'] });
let modelFails = false;
let modelCalls = 0;
require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true,
  exports: async function (url, init) {
    if (String(url).includes('discord.com')) {
      followups.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => '{}' };
    }
    modelCalls++;
    if (modelFails) return { ok: false, status: 500, text: async () => 'down' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ text: modelReply }], usage: { input_tokens: 10, output_tokens: 10 } }) };
  }
};

delete require.cache[require.resolve('./index')];
const handler = require('./index');

function ctx() {
  const c = { res: null };
  c.log = Object.assign(function () {}, { error: function () {}, warn: function () {} });
  return c;
}
function signed(payload, opts) {
  const body = JSON.stringify(payload);
  const ts = String((opts && opts.ts) || 1786000000);
  const sig = (opts && opts.badSig) ? 'ab'.repeat(64)
    : crypto.sign(null, Buffer.from(ts + body), privateKey).toString('hex');
  return { method: 'POST', rawBody: body, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } };
}
function modalSubmit(resume, job, uid) {
  return {
    type: 5, token: 'tok-123',
    member: { user: { id: uid || 'user-1' } },
    data: { components: [
      { type: 1, components: [{ type: 4, custom_id: 'resume', value: resume }] },
      { type: 1, components: [{ type: 4, custom_id: 'job', value: job || '' }] }
    ] }
  };
}
const RESUME = 'JORDAN REYES\nProduct Manager\n' + 'Built and shipped product roadmaps for payments teams. '.repeat(6);
function reset() { STATE = {}; followups = []; modelCalls = 0; modelFails = false; }
const settle = () => new Promise(r => setTimeout(r, 30));

// ── the setup handshake ──

test('an invalid signature gets 401 — Discord probes this and refuses the endpoint otherwise', async () => {
  reset();
  const c = ctx();
  await handler(c, signed({ type: 1 }, { badSig: true }));
  assert.strictEqual(c.res.status, 401);
});

test('a signed PING gets PONG', async () => {
  reset();
  const c = ctx();
  await handler(c, signed({ type: 1 }));
  assert.strictEqual(c.res.body.type, 1);
});

test('/roast opens the modal and spends nothing', async () => {
  reset();
  const c = ctx();
  await handler(c, signed({ type: 2, data: { name: 'roast' }, member: { user: { id: 'u' } } }));
  assert.strictEqual(c.res.body.type, 9, 'expected a MODAL response');
  assert.strictEqual(modelCalls, 0, 'opening the modal must not call the model');
});

// ── the roast ──

test('a modal submit acks within the 3s window, then edits in the result', async () => {
  reset();
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME)));
  assert.strictEqual(c.res.body.type, 5, 'must DEFER — the roast takes ~25s and Discord hangs up at 3');
  await settle();
  assert.strictEqual(followups.length, 1, 'no followup was sent');
  const e = followups[0].body.embeds[0];
  assert.ok(e.title.includes('41/100'), e.title);
  assert.ok(followups[0].url.includes('/messages/@original'));
});

test('the followup never carries the resume into the channel', async () => {
  reset();
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME)));
  await settle();
  const blob = JSON.stringify(followups[0].body);
  assert.ok(!blob.includes('JORDAN REYES'), 'the resume leaked into the public message');
  assert.ok(!blob.includes('Built and shipped'), 'resume body leaked into the public message');
});

test('the result carries a link back to the site', async () => {
  reset();
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME)));
  await settle();
  const btn = followups[0].body.components[0].components[0];
  assert.strictEqual(btn.style, 5);
  assert.ok(btn.url.includes('resume-roast'), btn.url);
});

test('a job description is passed through to the model', async () => {
  reset();
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME, 'Senior PM, Payments. Required: PCI, ledger.')));
  await settle();
  assert.strictEqual(modelCalls, 1);
});

// ── the money ──

test('a fourth roast in a day is refused, and costs nothing', async () => {
  reset();
  for (let i = 0; i < 3; i++) { await handler(ctx(), signed(modalSubmit(RESUME, '', 'heavy'))); await settle(); }
  assert.strictEqual(modelCalls, 3);
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME, '', 'heavy')));
  assert.strictEqual(c.res.body.type, 4, 'should answer immediately, not defer');
  assert.strictEqual(c.res.body.data.flags, 64, 'the refusal should be ephemeral, not public');
  assert.ok(/resume-roast/.test(c.res.body.data.content), 'refusal should still point at the site');
  assert.strictEqual(modelCalls, 3, 'a refused roast must not call the model');
});

test('one user cannot exhaust another user quota', async () => {
  reset();
  for (let i = 0; i < 3; i++) { await handler(ctx(), signed(modalSubmit(RESUME, '', 'heavy'))); await settle(); }
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME, '', 'someone-else')));
  assert.strictEqual(c.res.body.type, 5, 'a different user should still get a roast');
});

test('the global daily cap stops a big server draining the balance', async () => {
  reset();
  STATE.discordRoastLimits = { day: new Date().toISOString().split('T')[0], total: 300, users: {} };
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME, '', 'fresh-user')));
  assert.strictEqual(c.res.body.type, 4);
  assert.ok(/all servers/.test(c.res.body.data.content), c.res.body.data.content);
  assert.strictEqual(modelCalls, 0);
});

test('quota resets on a new day', async () => {
  reset();
  STATE.discordRoastLimits = { day: '2020-01-01', total: 9999, users: { 'user-1': 99 } };
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME)));
  assert.strictEqual(c.res.body.type, 5, 'yesterday quota should not block today');
});

test('too short to roast is refused before spending anything', async () => {
  reset();
  const c = ctx();
  await handler(c, signed(modalSubmit('too short')));
  assert.strictEqual(c.res.body.type, 4);
  assert.strictEqual(c.res.body.data.flags, 64);
  assert.strictEqual(modelCalls, 0);
});

// ── failure ──

test('a model outage explains itself instead of leaving a permanent "thinking…"', async () => {
  reset();
  modelFails = true;
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME)));
  assert.strictEqual(c.res.body.type, 5);
  await settle();
  assert.strictEqual(followups.length, 1, 'a failed roast must still edit the message');
  assert.ok(/capacity|broke/.test(followups[0].body.content), followups[0].body.content);
});

test('an unparseable model reply is reported, not dumped', async () => {
  reset();
  modelReply = 'this is not json at all';
  const c = ctx();
  await handler(c, signed(modalSubmit(RESUME)));
  await settle();
  assert.ok(/malformed/.test(followups[0].body.content), followups[0].body.content);
  modelReply = JSON.stringify({ ats_score: 41, verdict: 'v', roast_points: ['r'] });
});

test('a malformed JSON body is rejected without throwing', async () => {
  reset();
  const ts = '1786000000';
  const body = 'not json';
  const sig = crypto.sign(null, Buffer.from(ts + body), privateKey).toString('hex');
  const c = ctx();
  await handler(c, { method: 'POST', rawBody: body, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } });
  assert.strictEqual(c.res.status, 400);
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  PASS ', name); }
    catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
