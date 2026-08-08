// pixel-agent-run — server-side run truth (2026-08-09).
//
// Run with: node api/pixel-agent-run/run-events.test.js
//
// Why this exists: the funnel's only evidence that a roast finished came from
// the browser (agent_run_completed), which fires only if the tab is still open
// when the answer renders. Production read 25 starts against 5 completions and
// there was no way to tell a rate limit from a capacity outage from someone
// walking away. The API now says what IT did, and these assert the three
// properties that make that useful:
//
//   1. the event lands under the SAME identity the browser used, or the two
//      halves of the funnel describe different people and cannot be compared;
//   2. it carries the device's internal flag, or our own testing becomes the
//      one thing server-side truth still counts as demand;
//   3. it is persisted BEFORE the handler returns — Azure ends the invocation
//      at that point and does not guarantee pending IO (the same timing bug
//      that made the free-run cap not hold).

const assert = require('assert');

// ── stubs, installed before the handler is required ──
const storagePath = require.resolve('../_utils/companyStorage');
let store = {};
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: {
    async getState(key) { return store[key] === undefined ? null : store[key]; },
    async setState(key, value) { store[key] = value; return true; },
    async mutateState(key, mutator) {
      // A real blob round trip is not instant, and the delay is what makes a
      // missing await observable rather than a race the test happens to win.
      await new Promise(r => setTimeout(r, 10));
      const next = await mutator(store[key] === undefined ? null : store[key]);
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

const llmPath = require.resolve('../_lib/llm');
class LlmUnavailableError extends Error {
  constructor(reason) { super('all models failed'); this.reason = reason; }
}
let llmMode = 'ok';
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: {
    async callModel() {
      await new Promise(r => setTimeout(r, 5));
      if (llmMode === 'down') throw new LlmUnavailableError('capacity');
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
    LlmUnavailableError
  }
};

const gatePath = require.resolve('./entitlementGate');
require.cache[gatePath] = {
  id: gatePath, filename: gatePath, loaded: true,
  exports: {
    async loadPaEntitlements() { return { tier: 'free', paCredits: 0 }; },
    async consumePaCredits() { return 0; },
    hasFlag() { return false; },
    isAdminUser() { return false; }
  }
};

const cfAuthPath = require.resolve('../_utils/cfAuth');
require.cache[cfAuthPath] = {
  id: cfAuthPath, filename: cfAuthPath, loaded: true,
  exports: { extractUserInfo() { return { userId: null, email: null, isAuthenticated: false, principal: null }; } }
};

process.env.ANTHROPIC_API_KEY = 'test-key-not-used';

const handler = require('./index');

const RESUME = 'Senior backend engineer with a decade of Node and Azure work. '.repeat(6);
const BROWSER = { product: 'resumeroast', userId: 'anon_abc123', sessionId: 's_1', internal: false };

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

async function run(body, headers) {
  const c = ctx();
  await handler(c, {
    method: 'POST',
    headers: Object.assign({ 'x-forwarded-for': '198.51.100.42' }, headers || {}),
    body: Object.assign({ agentId: 'resume-roast', input: RESUME, _pa: BROWSER }, body || {})
  });
  return c.res;
}

// The events land in today's product-analytics shard, written through the same
// emitter every other server-side event uses.
function events() {
  const key = 'pa/events-' + new Date().toISOString().substring(0, 10);
  return store[key] || [];
}
function firstEvent(name) {
  return events().filter(e => e.event === name)[0];
}

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

test('a delivered run is recorded by the server, not only by the browser', async () => {
  store = {}; llmMode = 'ok';
  const res = await run();
  assert.strictEqual(res.status, 200, JSON.stringify(res.body).slice(0, 200));

  // Inspected with no extra ticks: in production the invocation ends here, so
  // an un-awaited emit would simply never land.
  const e = firstEvent('run_delivered');
  assert.ok(e, 'no run_delivered was persisted by the time the handler returned');
  assert.strictEqual(e.source, 'server');
  assert.strictEqual(e.product, 'resumeroast');
  assert.strictEqual(e.props.runId, res.body.runId, 'the event must name the run it delivered');
  assert.ok(typeof e.props.duration_ms === 'number', 'no wait time recorded — abandonment asks that first');
});

test('the server files the event under the browser\'s identity, not its own', async () => {
  store = {}; llmMode = 'ok';
  await run();
  const e = firstEvent('run_delivered');
  assert.strictEqual(e.userId, 'anon_abc123',
    'a different id makes delivered and started describe different people');
  assert.strictEqual(e.props.identity_source, 'client');
  assert.strictEqual(e.sessionId, 's_1');
  assert.strictEqual(e.isAuth, false, 'an anonymous browser id is an identity, not a login');
});

test('a run from one of our own devices is flagged internal and excluded from demand', async () => {
  store = {}; llmMode = 'ok';
  await run({ _pa: Object.assign({}, BROWSER, { internal: true }) });
  const e = firstEvent('run_delivered');
  assert.strictEqual(e.internal, true,
    'only the device knows it is ours — if the server drops the flag, our testing reads as demand');

  // And the kill-gate counter must honour it.
  const { countRunsInEvents } = require('../companyHeartbeat/pa-metrics');
  assert.strictEqual(countRunsInEvents(events()), 0);
});

test('a rate-limited visitor is a failure, not a silent disappearance', async () => {
  store = {}; llmMode = 'ok';
  // Spend the anonymous allowance (5/day per IP hash), then ask once more.
  for (let i = 0; i < 5; i++) await run();
  const before = events().filter(e => e.event === 'run_delivered').length;

  const res = await run();
  assert.strictEqual(res.status, 429, 'expected the free cap to bite');
  const f = firstEvent('run_failed');
  assert.ok(f, 'a 429 left no trace — indistinguishable from a closed tab');
  assert.strictEqual(f.props.reason, 'rate_limited');
  assert.strictEqual(f.props.http, 429);
  assert.strictEqual(f.category, 'error');
  assert.strictEqual(events().filter(e => e.event === 'run_delivered').length, before,
    'a refused run must never count as delivered');
});

test('a capacity outage is reported as ours, with the reason attached', async () => {
  store = {}; llmMode = 'down';
  const res = await run();
  assert.strictEqual(res.status, 503);
  const f = firstEvent('run_failed');
  assert.ok(f, 'the model chain failed and analytics said nothing');
  assert.strictEqual(f.props.reason, 'llm_unavailable');
  assert.strictEqual(f.props.llm_reason, 'capacity');
  assert.ok(!firstEvent('run_delivered'), 'nothing was delivered');
});

test('over-length input is a distinct reason, not lumped in with outages', async () => {
  store = {}; llmMode = 'ok';
  const res = await run({ input: 'x'.repeat(20001) });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(firstEvent('run_failed').props.reason, 'input_too_long');
});

test('a browser running stale JS still reports, and says so', async () => {
  // No _pa in the body — the page has not picked up the new bundle yet. The
  // event must still land (an event without a userId is dropped by the funnel
  // entirely), and identity_source has to make the gap countable rather than
  // look like a crowd of anonymous strangers.
  store = {}; llmMode = 'ok';
  await run({ _pa: undefined });
  const e = firstEvent('run_delivered');
  assert.ok(e, 'no event at all from a client that did not send its identity');
  assert.strictEqual(e.props.identity_source, 'ip');
  assert.ok(/^ip_/.test(e.userId));
  assert.strictEqual(e.internal, undefined, 'an unknown device is external, never assumed ours');
});

test('a non-roast agent files under pixelagents, not resumeroast', async () => {
  store = {}; llmMode = 'ok';
  await run({ agentId: 'name-storm', input: 'a startup that delivers oat milk by drone', _pa: undefined });
  const e = firstEvent('run_delivered');
  assert.ok(e, 'no event for a non-roast agent');
  assert.strictEqual(e.product, 'pixelagents');
});

test('analytics failure never costs the user their roast', async () => {
  store = {}; llmMode = 'ok';
  const real = require.cache[storagePath].exports.mutateState;
  require.cache[storagePath].exports.mutateState = async (key, mutator) => {
    if (String(key).indexOf('pa/events-') === 0) throw new Error('blob down');
    return real(key, mutator);
  };
  try {
    const res = await run();
    assert.strictEqual(res.status, 200, 'a broken analytics store must not fail the run');
    assert.ok(res.body.result, 'the roast is still in the response');
  } finally {
    require.cache[storagePath].exports.mutateState = real;
  }
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\npixel-agent-run run-events: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
