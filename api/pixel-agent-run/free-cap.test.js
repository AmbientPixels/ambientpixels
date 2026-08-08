// pixel-agent-run — regression test for the free-run cap (2026-08-08).
//
// What was wrong: the daily-allowance counter was written with an un-awaited
// `storage.mutateState(...).catch(...)`. Azure Functions ends the invocation
// when the handler returns and does not guarantee pending IO afterwards, so the
// write was a coin flip and in production it essentially never landed — three
// consecutive free roasts from one IP each came back `remaining: 4`.
//
// The comment above that call was already right that a lost count "is a cost
// leak that scales precisely with the traffic we are chasing", and the
// mutateState change it describes was the correct fix for a DIFFERENT bug
// (a stale read across the model call). Not awaiting it undid both.
//
// The bug is invisible to a pure-function test, because nothing about the
// mutator is wrong. What has to be asserted is a timing property: by the time
// the handler returns, the count must ALREADY be persisted. So these drive the
// real handler and inspect the store the instant `await handler(...)` resolves,
// with no extra ticks - exactly what the Azure host does or does not give us.

const assert = require('assert');

// ── stubs, installed before the handler is required ──
const storagePath = require.resolve('../_utils/companyStorage');
let store = {};
let mutateDelayMs = 0;
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: {
    async getState(key) { return store[key] === undefined ? null : store[key]; },
    async setState(key, value) { store[key] = value; return true; },
    async mutateState(key, mutator) {
      // A real blob round trip is not instant. The delay is what makes the
      // missing await observable: without it, even a fire-and-forget write can
      // sneak in before the assertion on a fast machine, and the test would
      // pass against the broken code.
      if (mutateDelayMs) await new Promise(r => setTimeout(r, mutateDelayMs));
      const next = mutator(store[key] === undefined ? null : store[key]);
      if (next === undefined) return { ok: true, written: false, value: store[key] };
      store[key] = next;
      return { ok: true, written: true, value: next };
    },
    async getStateWithMeta(key) {
      const v = store[key];
      return { value: v === undefined ? null : v, exists: v !== undefined, failed: false, etag: null };
    },
    validateSecret() { return false; },
    async logClaudeUsage() {}, async logGeminiUsage() {}
  }
};

// The model call — never hit the network in a test, and make the run take a
// beat so the accounting genuinely happens after a delay, as in production.
const llmPath = require.resolve('../_lib/llm');
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: {
    async callModel() {
      await new Promise(r => setTimeout(r, 5));
      return {
        text: JSON.stringify({
          ats_score: 52,
          verdict: 'A verdict long enough to look like a real one.',
          strengths: ['a', 'b'],
          roast_points: ['c', 'd'],
          rewrite_tips: 'Rewrite tips as prose, which is what this agent declares.',
          pro_tip: 'A pro tip.'
        }),
        modelKey: 'claude-sonnet', modelId: 'claude-sonnet-4-6', provider: 'claude',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        truncated: false, fellBackFrom: null, attempts: []
      };
    },
    LlmUnavailableError: class LlmUnavailableError extends Error {}
  }
};

const gatePath = require.resolve('./entitlementGate');
require.cache[gatePath] = {
  id: gatePath, filename: gatePath, loaded: true,
  exports: {
    async getPaEntitlements() { return { tier: 'free', credits: 0 }; },
    async consumePaCredits() { return 0; }
  }
};

const cfAuthPath = require.resolve('../_utils/cfAuth');
require.cache[cfAuthPath] = {
  id: cfAuthPath, filename: cfAuthPath, loaded: true,
  // Anonymous — the launch-traffic case. Matches the real module's shape for a
  // request with no principal header; returning null here would only test that
  // the handler crashes.
  exports: { extractUserInfo() { return { userId: null, email: null, isAuthenticated: false, principal: null }; } }
};

// The handler refuses to run at all without this; the stubbed callModel above
// means no request is ever actually made with it.
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';

const handler = require('./index');

const RESUME = 'Senior backend engineer with a decade of Node and Azure work. '.repeat(6);

// The handler catches everything and answers a generic 500, so a stub that is
// subtly wrong looks identical to a real regression. DBG=1 surfaces the actual
// error instead of leaving you guessing at "Something went wrong".
function ctx() {
  return {
    res: null,
    log: Object.assign(function () {}, {
      warn() {},
      error(...a) { if (process.env.DBG) console.log('    [handler error]', ...a); },
      info() {}
    })
  };
}

async function runOnce(ip) {
  const c = ctx();
  await handler(c, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip || '198.51.100.42' },
    body: { agentId: 'resume-roast', input: RESUME }
  });
  return c.res;
}

function countedRuns() {
  const rl = store['pixelAgentRateLimits'] || {};
  return Object.values(rl).reduce((s, n) => s + (Number(n) || 0), 0);
}

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

test('a free run is counted BEFORE the handler returns', async () => {
  store = {}; mutateDelayMs = 20;
  const res = await runOnce();
  assert.strictEqual(res.status, 200, JSON.stringify(res.body).slice(0, 200));
  // Inspected with no extra ticks. An un-awaited write has not landed here, and
  // in production the invocation ends at exactly this point.
  assert.strictEqual(countedRuns(), 1,
    'the run was not counted by the time the handler returned - the write is not awaited, so the cap does not hold');
});

test('the cap actually decrements across sequential runs', async () => {
  store = {}; mutateDelayMs = 20;
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push((await runOnce()).body.remaining);
  assert.deepStrictEqual(seen, [4, 3, 2],
    'reported remaining went ' + JSON.stringify(seen) + '; production returned [4,4,4] with the un-awaited write');
  assert.strictEqual(countedRuns(), 3);
});

test('remaining reflects what PERSISTED, not the value read before the model call', async () => {
  store = {}; mutateDelayMs = 0;
  // Establish the bucket, then simulate a second device on the same network
  // running while ours is still in the model. Our pre-call read cannot see it,
  // so quoting that number tells the user they have more free runs than they do.
  await runOnce();
  const bucket = Object.keys(store['pixelAgentRateLimits'])[0];
  store['pixelAgentRateLimits'][bucket] += 1;          // the concurrent run

  const res = await runOnce();
  const persisted = store['pixelAgentRateLimits'][bucket];
  assert.strictEqual(persisted, 3, 'expected 1 + 1 concurrent + 1 = 3 counted runs');
  assert.strictEqual(res.body.remaining, 5 - persisted,
    'remaining must be derived from the persisted count, not a stale pre-call read');
});

test('the free allowance is eventually exhausted and answers 429', async () => {
  store = {}; mutateDelayMs = 0;
  let last;
  for (let i = 0; i < 6; i++) last = await runOnce();
  assert.strictEqual(last.status, 429,
    'a sixth free run returned ' + last.status + ' - an uncapped free tier is uncapped model spend');
  assert.strictEqual(last.body.remaining, 0);
  assert.match(last.body.message, /network/i, 'anonymous copy must say the limit is per-network, not accuse them personally');
});

test('a new connection from the same client does NOT mint a fresh allowance', async () => {
  // The production failure, exactly. Azure puts the caller's ephemeral port in
  // x-forwarded-for and it changes per TCP connection, so bucketing on the raw
  // value gave every request its own allowance: 13 consecutive runs produced 13
  // buckets each holding 1, while the API reported 4 free runs left every time.
  store = {}; mutateDelayMs = 0;
  const seen = [];
  for (const port of [41001, 52774, 33150]) {
    const c = ctx();
    await handler(c, {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.5:' + port },
      body: { agentId: 'resume-roast', input: RESUME }
    });
    seen.push(c.res.body.remaining);
  }
  assert.strictEqual(Object.keys(store['pixelAgentRateLimits']).length, 1,
    'one client produced ' + Object.keys(store['pixelAgentRateLimits']).length + ' buckets - the cap cannot bind');
  assert.deepStrictEqual(seen, [4, 3, 2], 'got ' + JSON.stringify(seen) + '; production returned [4,4,4]');
});

test('a caller cannot reset their own limit by prepending x-forwarded-for', async () => {
  // App Service appends rather than replaces, so the first entry is whatever
  // the caller sent. Reading it made the cap opt-out.
  store = {}; mutateDelayMs = 0;
  for (let i = 0; i < 6; i++) {
    const c = ctx();
    await handler(c, {
      method: 'POST',
      headers: { 'x-forwarded-for': 'spoofed-' + i + ', 203.0.113.5:' + (40000 + i) },
      body: { agentId: 'resume-roast', input: RESUME }
    });
    if (i === 5) assert.strictEqual(c.res.status, 429,
      'varying the prefix bought a sixth free run - the cap is bypassable by anyone who reads the repo');
  }
});

test('IPv6 callers are not all collapsed into one bucket', async () => {
  // The opposite failure, and a worse one: a naive split(':')[0] buckets every
  // IPv6 visitor as "2001" and locks strangers out of each other's free runs.
  store = {}; mutateDelayMs = 0;
  const a = ctx(), b = ctx();
  await handler(a, { method: 'POST', headers: { 'x-forwarded-for': '[2001:db8::1]:41001' }, body: { agentId: 'resume-roast', input: RESUME } });
  await handler(b, { method: 'POST', headers: { 'x-forwarded-for': '[2001:db8::2]:41002' }, body: { agentId: 'resume-roast', input: RESUME } });
  assert.strictEqual(Object.keys(store['pixelAgentRateLimits']).length, 2,
    'two distinct IPv6 visitors must not share an allowance');
  assert.strictEqual(b.res.body.remaining, 4, 'the second visitor was charged for the first visitor\'s run');
});

test('separate networks get separate allowances', async () => {
  store = {}; mutateDelayMs = 0;
  for (let i = 0; i < 5; i++) await runOnce('198.51.100.42');
  const other = await runOnce('203.0.113.99');
  assert.strictEqual(other.status, 200, 'one exhausted network must not lock out everyone else');
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\npixel-agent-run free-cap tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
