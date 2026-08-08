// Run with: node api/_lib/llm/llm.test.js
//
// The behaviour under test is what happens when Anthropic says no. Before this
// module, every public product answered a 429 / 529 / credit-exhaustion the
// same way: HTTP 502, "encountered a system fault". These tests exist so that
// the fallback cannot silently regress into that.

const assert = require('assert');

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

// ── fetch stub: a queue of scripted responses, and a record of the requests ──
const fetchPath = require.resolve('node-fetch');
let responses = [];
let requests = [];
require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true,
  exports: async function (url, init) {
    requests.push({ url, body: JSON.parse(init.body), signal: init.signal });
    const next = responses.shift();
    if (!next) throw new Error('no scripted response for ' + url);
    if (typeof next === 'function') return next();
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => next.body };
  }
};

// ── storage stub ──
const storagePath = require.resolve('../../_utils/companyStorage');
let claudeLogged = [], geminiLogged = [], stateWrites = {};
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true, exports: {
    logClaudeUsage: async e => { claudeLogged.push(e); },
    logGeminiUsage: async e => { geminiLogged.push(e); },
    getState: async () => [],
    setState: async (k, v) => { stateWrites[k] = v; }
  }
};

process.env.ANTHROPIC_API_KEY = 'test-anthropic';
process.env.GEMINI_API_KEY = 'test-gemini';

delete require.cache[require.resolve('./index')];
const { callModel, LlmUnavailableError, _classify } = require('./index');

function reset() { responses = []; requests = []; claudeLogged = []; geminiLogged = []; stateWrites = {}; }

const claudeOk = (text, inTok, outTok) => ({
  status: 200,
  body: JSON.stringify({ content: [{ text }], usage: { input_tokens: inTok || 100, output_tokens: outTok || 50 } })
});
const geminiOk = (text, inTok, outTok) => ({
  status: 200,
  body: JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: inTok || 120, candidatesTokenCount: outTok || 60, totalTokenCount: (inTok || 120) + (outTok || 60) }
  })
});
// The exact shape Anthropic returns when credits run out — a 400, not a 402.
const creditError = {
  status: 400,
  body: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } })
};

// ── the case this module exists for ──

test('credit exhaustion falls back to Gemini instead of failing the customer', async () => {
  reset();
  responses = [creditError, geminiOk('{"ats_score":41}')];
  const out = await callModel({ prompt: 'roast this', system: 'you are Resume Roast', caller: 'pixel-agent-run', json: true });
  assert.strictEqual(out.text, '{"ats_score":41}');
  assert.strictEqual(out.provider, 'gemini');
  assert.strictEqual(out.fellBackFrom, 'claude-sonnet', 'fallback must be visible to the caller');
  assert.strictEqual(out.attempts[0].reason, 'credits', 'credit error misclassified as ' + out.attempts[0].reason);
});

test('a 529 overload falls back', async () => {
  reset();
  responses = [{ status: 529, body: '{"error":{"type":"overloaded_error"}}' }, geminiOk('ok')];
  const out = await callModel({ prompt: 'x', caller: 't' });
  assert.strictEqual(out.provider, 'gemini');
  assert.strictEqual(out.attempts[0].reason, 'capacity');
});

test('a 429 rate limit falls back', async () => {
  reset();
  responses = [{ status: 429, body: 'rate_limit_error' }, geminiOk('ok')];
  assert.strictEqual((await callModel({ prompt: 'x', caller: 't' })).provider, 'gemini');
});

test('the happy path does not fall back and does not call Gemini', async () => {
  reset();
  responses = [claudeOk('all good')];
  const out = await callModel({ prompt: 'x', caller: 't' });
  assert.strictEqual(out.text, 'all good');
  assert.strictEqual(out.provider, 'claude');
  assert.strictEqual(out.fellBackFrom, null);
  assert.strictEqual(requests.length, 1, 'must not call a second provider on success');
});

test('when the whole chain fails it throws LlmUnavailableError, not a generic one', async () => {
  reset();
  responses = [creditError, { status: 500, body: 'gemini down' }];
  await assert.rejects(
    () => callModel({ prompt: 'x', caller: 't' }),
    err => {
      assert.ok(err instanceof LlmUnavailableError, 'wrong error type: ' + err.name);
      assert.strictEqual(err.reason, 'credits', 'credits must win over capacity — it is not retryable');
      assert.strictEqual(err.attempts.length, 2);
      return true;
    });
});

test('an all-capacity failure reports capacity, so the copy can honestly say "try again"', async () => {
  reset();
  responses = [{ status: 529, body: 'overloaded' }, { status: 503, body: 'unavailable' }];
  await assert.rejects(() => callModel({ prompt: 'x', caller: 't' }),
    err => err.reason === 'capacity');
});

// ── the parameters the fleet helper drops, which public agents depend on ──

test('the system prompt reaches Claude as `system`', async () => {
  reset();
  responses = [claudeOk('ok')];
  await callModel({ prompt: 'p', system: 'YOU ARE RESUME ROAST', caller: 't' });
  assert.strictEqual(requests[0].body.system, 'YOU ARE RESUME ROAST');
});

test('the system prompt reaches Gemini as systemInstruction', async () => {
  reset();
  responses = [creditError, geminiOk('ok')];
  await callModel({ prompt: 'p', system: 'YOU ARE RESUME ROAST', caller: 't' });
  assert.strictEqual(requests[1].body.systemInstruction.parts[0].text, 'YOU ARE RESUME ROAST');
});

test('temperature reaches BOTH providers — the fleet helper drops it on Claude', async () => {
  reset();
  responses = [claudeOk('ok')];
  await callModel({ prompt: 'p', temperature: 0.9, caller: 't' });
  assert.strictEqual(requests[0].body.temperature, 0.9);

  reset();
  responses = [creditError, geminiOk('ok')];
  await callModel({ prompt: 'p', temperature: 0.9, caller: 't' });
  assert.strictEqual(requests[1].body.generationConfig.temperature, 0.9);
});

test('temperature 0 is honoured, not replaced by the default', async () => {
  reset();
  responses = [claudeOk('ok')];
  await callModel({ prompt: 'p', temperature: 0, caller: 't' });
  assert.strictEqual(requests[0].body.temperature, 0, 'falsy-but-valid temperature was overwritten');
});

test('json:true makes Gemini return raw JSON rather than prose-wrapped JSON', async () => {
  reset();
  responses = [creditError, geminiOk('{}')];
  await callModel({ prompt: 'p', json: true, caller: 't' });
  assert.strictEqual(requests[1].body.generationConfig.responseMimeType, 'application/json');
});

test('maxTokens maps to each provider\'s own field name', async () => {
  reset();
  responses = [claudeOk('ok')];
  await callModel({ prompt: 'p', maxTokens: 2000, caller: 't' });
  assert.strictEqual(requests[0].body.max_tokens, 2000);

  reset();
  responses = [creditError, geminiOk('ok')];
  await callModel({ prompt: 'p', maxTokens: 2000, caller: 't' });
  assert.strictEqual(requests[1].body.generationConfig.maxOutputTokens, 2000);
});

test('gemini-flash gets thinkingBudget 0 — otherwise thinking tokens truncate the JSON', async () => {
  reset();
  responses = [creditError, geminiOk('ok')];
  await callModel({ prompt: 'p', caller: 't' });
  assert.strictEqual(requests[1].body.generationConfig.thinkingConfig.thinkingBudget, 0);
});

test('gemini-pro gets thinkingBudget -1 — it returns 400 on a 0 budget', async () => {
  reset();
  responses = [geminiOk('ok')];
  await callModel({ prompt: 'p', model: 'gemini-pro', caller: 't' });
  assert.strictEqual(requests[0].body.generationConfig.thinkingConfig.thinkingBudget, -1);
  assert.ok(requests[0].body.generationConfig.maxOutputTokens >= 8192, 'Pro needs headroom for thinking tokens');
});

// ── spend attribution ──

test('Claude usage is logged with caller, agentId and runId', async () => {
  reset();
  responses = [claudeOk('ok', 1500, 800)];
  const out = await callModel({ prompt: 'p', caller: 'pixel-agent-run', agentId: 'resume-roast', runId: 'run-123' });
  assert.strictEqual(claudeLogged.length, 1);
  assert.deepStrictEqual(
    { c: claudeLogged[0].caller, a: claudeLogged[0].agentId, r: claudeLogged[0].runId,
      p: claudeLogged[0].promptTokens, o: claudeLogged[0].completionTokens },
    { c: 'pixel-agent-run', a: 'resume-roast', r: 'run-123', p: 1500, o: 800 });
  assert.strictEqual(out.usage.promptTokens, 1500, 'usage must be returned to the caller too');
});

test('Gemini spend lands on the Gemini rail, not the Claude one', async () => {
  reset();
  responses = [creditError, geminiOk('ok', 900, 400)];
  await callModel({ prompt: 'p', caller: 'pixel-agent-run' });
  assert.strictEqual(geminiLogged.length, 1);
  assert.strictEqual(claudeLogged.length, 0, 'a failed Claude call must not be logged as spend');
});

test('a fallback is recorded to llmFallbackLog — this is how we learn credits ran dry', async () => {
  reset();
  responses = [creditError, geminiOk('ok')];
  await callModel({ prompt: 'p', caller: 'pixel-agent-run' });
  await new Promise(r => setImmediate(r));
  const log = stateWrites.llmFallbackLog;
  assert.ok(Array.isArray(log) && log.length === 1, 'nothing recorded');
  assert.strictEqual(log[0].from, 'claude-sonnet');
  assert.strictEqual(log[0].to, 'gemini-flash');
  assert.strictEqual(log[0].reason, 'credits');
});

test('a total outage is recorded with to:null', async () => {
  reset();
  responses = [creditError, { status: 500, body: 'x' }];
  await callModel({ prompt: 'p', caller: 't' }).catch(() => {});
  await new Promise(r => setImmediate(r));
  assert.strictEqual(stateWrites.llmFallbackLog[0].to, null);
});

test('a storage failure never breaks a paid request', async () => {
  reset();
  const s = require.cache[storagePath].exports;
  const realLog = s.logClaudeUsage;
  s.logClaudeUsage = async () => { throw new Error('blob down'); };
  responses = [claudeOk('still fine')];
  const out = await callModel({ prompt: 'p', caller: 't' });
  assert.strictEqual(out.text, 'still fine');
  s.logClaudeUsage = realLog;
});

// ── failure modes that must not be mistaken for success ──

test('an empty completion is a failure, and falls back', async () => {
  reset();
  responses = [{ status: 200, body: JSON.stringify({ content: [{ text: '   ' }], usage: {} }) }, geminiOk('real answer')];
  const out = await callModel({ prompt: 'p', caller: 't' });
  assert.strictEqual(out.text, 'real answer');
});

test('an unparseable 200 falls back rather than returning junk', async () => {
  reset();
  responses = [{ status: 200, body: '<html>gateway</html>' }, geminiOk('real answer')];
  assert.strictEqual((await callModel({ prompt: 'p', caller: 't' })).text, 'real answer');
});

test('a transport throw advances the chain instead of escaping', async () => {
  reset();
  responses = [() => { throw new Error('ECONNRESET'); }, geminiOk('recovered')];
  assert.strictEqual((await callModel({ prompt: 'p', caller: 't' })).text, 'recovered');
});

test('an aborted attempt is classified as capacity, not a generic error', async () => {
  reset();
  responses = [() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, geminiOk('ok')];
  const out = await callModel({ prompt: 'p', caller: 't' });
  assert.strictEqual(out.attempts[0].reason, 'capacity');
});

test('every attempt carries an abort signal, so one hung socket cannot eat the chain', async () => {
  reset();
  responses = [claudeOk('ok')];
  await callModel({ prompt: 'p', caller: 't' });
  assert.ok(requests[0].signal, 'no AbortSignal passed to fetch');
});

test('a missing prompt is a programming error and throws immediately', async () => {
  await assert.rejects(() => callModel({ caller: 't' }), /prompt is required/);
});

test('no API keys at all reports reason "config", not "capacity"', async () => {
  reset();
  const a = process.env.ANTHROPIC_API_KEY, g = process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
  await assert.rejects(() => callModel({ prompt: 'p', caller: 't' }), err => err.reason === 'config');
  process.env.ANTHROPIC_API_KEY = a; process.env.GEMINI_API_KEY = g;
});

// ── deadlineAt: the absolute budget (2026-08-07) ──
// `timeoutMs` bounds ONE attempt, so a 2-model chain could spend 2x it — which
// is invisible to a caller sitting behind Azure's 230s HTTP gateway limit. The
// $9 rewrite composed inside such a request and the one real order took 354s.

test('without deadlineAt the chain is completely unchanged (regression guard)', async () => {
  reset();
  responses = [{ status: 529, body: 'overloaded_error' }, geminiOk('{"ok":1}')];
  const out = await callModel({ prompt: 'p', caller: 't' });
  assert.strictEqual(out.provider, 'gemini');
  assert.strictEqual(requests.length, 2, 'both models must still be tried when no budget is set');
});

test('a deadline that has already passed spends nothing at all', async () => {
  reset();
  responses = [claudeOk('{"ok":1}'), geminiOk('{"ok":1}')];
  await assert.rejects(
    () => callModel({ prompt: 'p', caller: 't', deadlineAt: Date.now() - 1 }),
    err => err instanceof LlmUnavailableError && err.reason === 'deadline');
  assert.strictEqual(requests.length, 0, 'made ' + requests.length + ' calls with no time left to use them');
});

test('the chain stops rather than starting a model it has no time to finish', async () => {
  reset();
  // ~15.1s of budget, and the first attempt burns 250ms of it — leaving less
  // than the 15s floor, so the Gemini leg must be skipped instead of started.
  responses = [
    async () => { await new Promise(r => setTimeout(r, 250)); return { ok: false, status: 529, text: async () => 'overloaded_error' }; },
    geminiOk('{"ok":1}')
  ];
  await assert.rejects(
    () => callModel({ prompt: 'p', caller: 't', deadlineAt: Date.now() + 15100 }),
    err => err instanceof LlmUnavailableError);
  assert.strictEqual(requests.length, 1, 'started the fallback with no budget to complete it');
});

test('a real upstream failure outranks a skipped one in the reported reason', async () => {
  reset();
  // Claude genuinely 529'd; Gemini was only skipped for lack of clock. The
  // caller must hear 'capacity' (retry me) rather than 'deadline'.
  responses = [
    async () => { await new Promise(r => setTimeout(r, 250)); return { ok: false, status: 529, text: async () => 'overloaded_error' }; },
    geminiOk('{"ok":1}')
  ];
  await assert.rejects(
    () => callModel({ prompt: 'p', caller: 't', deadlineAt: Date.now() + 15100 }),
    err => err.reason === 'capacity');
});

test('an ample deadline does not interfere with a healthy call', async () => {
  reset();
  responses = [claudeOk('{"ok":1}')];
  const out = await callModel({ prompt: 'p', caller: 't', deadlineAt: Date.now() + 195000 });
  assert.strictEqual(out.text, '{"ok":1}');
  assert.strictEqual(out.provider, 'claude');
});

// ── classification, directly ──

test('classify distinguishes credits from capacity from error', () => {
  assert.strictEqual(_classify(400, 'Your credit balance is too low'), 'credits');
  assert.strictEqual(_classify(429, 'exceeded your current quota'), 'credits');
  assert.strictEqual(_classify(429, 'rate_limit_error'), 'capacity');
  assert.strictEqual(_classify(529, 'overloaded_error'), 'capacity');
  assert.strictEqual(_classify(503, ''), 'capacity');
  assert.strictEqual(_classify(400, 'max_tokens must be positive'), 'error');
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  PASS ', name); }
    catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
