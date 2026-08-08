#!/usr/bin/env node
// smoke-test.js — Smoke tests for pixel-agent-run endpoint
// Run: node api/pixel-agent-run/smoke-test.js
// No external dependencies — mocks Claude API + storage, exercises real code paths

const path = require('path');
const assert = require('assert');

// ── Mock infrastructure ──
var _mockStorage = {};

// Mock storage before requiring modules
const storageModule = require('../_utils/companyStorage');
storageModule.getState = async (key) => _mockStorage[key] || null;
storageModule.setState = async (key, value) => { _mockStorage[key] = value; return true; };
storageModule.logClaudeUsage = async () => {};
// Mirrors the real mutateState contract: read → mutate → write, with the
// mutator seeing FRESH state. The rate-limit counter goes through this so a
// concurrent run cannot overwrite another's count with a stale read.
storageModule.mutateState = async (key, mutator) => {
  const next = await mutator(_mockStorage[key] || null, { attempt: 1, exists: _mockStorage[key] !== undefined });
  if (next === undefined) return { ok: true, written: false };
  _mockStorage[key] = next;
  return { ok: true, written: true };
};

// Mock node-fetch (Claude API responses)
var _mockFetchResponse = {
  ok: true,
  status: 200,
  json: async () => ({
    content: [{ text: '{"score": 75, "verdict": "Not bad", "analysis": "Decent work"}' }],
    usage: { input_tokens: 100, output_tokens: 200 }
  })
};
var _mockFetchCalls = [];
// When non-empty, responses are shifted off this queue instead of using the
// single _mockFetchResponse — needed to exercise the fallback chain, where the
// first provider must fail and the second must answer.
var _mockFetchQueue = [];

// Replace node-fetch globally
require.cache[require.resolve('node-fetch')] = {
  id: require.resolve('node-fetch'),
  filename: require.resolve('node-fetch'),
  loaded: true,
  exports: async function mockFetch(url, opts) {
    _mockFetchCalls.push({ url, method: opts?.method, body: opts?.body });
    var r = _mockFetchQueue.length ? _mockFetchQueue.shift() : _mockFetchResponse;
    // A real node-fetch Response exposes BOTH json() and text(). _lib/llm reads
    // text() so it can classify an error body (a credit exhaustion arrives as a
    // 400 whose *message* is the only signal). Synthesize it here so the
    // per-test mocks below can stay terse.
    if (r && typeof r.text !== 'function' && typeof r.json === 'function') {
      return Object.assign({}, r, { text: async function () { return JSON.stringify(await r.json()); } });
    }
    return r;
  }
};

// Response shapes, by provider.
function claudeOk(text) {
  return { ok: true, status: 200, json: async () => ({ content: [{ text: text }], usage: { input_tokens: 100, output_tokens: 200 } }) };
}
function geminiOk(text) {
  return { ok: true, status: 200, json: async () => ({
    candidates: [{ content: { parts: [{ text: text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 }
  }) };
}
function providerFail(status, message) {
  return { ok: false, status: status, json: async () => ({ error: { message: message || 'upstream error' } }) };
}

// Mock fs.readFileSync for agent registry
const _origReadFileSync = require('fs').readFileSync;
const _mockAgents = [
  {
    id: 'test-agent',
    name: 'Test Agent',
    active: true,
    inputType: 'textarea',
    inputValidation: 'text',
    systemPrompt: 'You are a test agent. Return JSON: {"score": 75, "verdict": "OK"}',
    userPromptTemplate: 'Analyze: {{input}}',
    outputFormat: 'structured',
    outputSections: [{ key: 'score', label: 'Score', type: 'score' }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 },
    tier: 'common',
    icon: 'fas fa-flask',
    rateLimitCost: 1
  },
  {
    id: 'url-agent',
    name: 'URL Agent',
    active: true,
    inputType: 'url',
    inputValidation: 'url',
    systemPrompt: 'Analyze this URL.',
    userPromptTemplate: 'Check: {{input}}',
    outputFormat: 'structured',
    outputSections: [{ key: 'result', label: 'Result', type: 'text' }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 1000 },
    tier: 'rare',
    icon: 'fas fa-link',
    rateLimitCost: 1
  },
  {
    id: 'inactive-agent',
    name: 'Inactive Agent',
    active: false,
    systemPrompt: 'Should not be accessible',
    userPromptTemplate: '{{input}}'
  },
  {
    id: 'expensive-agent',
    name: 'Expensive Agent',
    active: true,
    inputType: 'textarea',
    inputValidation: 'text',
    systemPrompt: 'You cost 2 runs.',
    userPromptTemplate: 'Do: {{input}}',
    outputFormat: 'structured',
    outputSections: [{ key: 'result', label: 'Result', type: 'text' }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 },
    tier: 'epic',
    icon: 'fas fa-gem',
    rateLimitCost: 2
  }
];

require('fs').readFileSync = function(filePath, encoding) {
  if (filePath.includes('pixel-agents.json')) {
    return JSON.stringify(_mockAgents);
  }
  return _origReadFileSync(filePath, encoding);
};

// Mock entitlement gate (billing) — default: no record (free tier).
// index.js holds the same module object, so property overrides take effect.
const gateModule = require('./entitlementGate');
var _mockEntitlements = {};
var _consumeCalls = [];
function mockGateDefaults() {
  gateModule.loadPaEntitlements = async (userId) => _mockEntitlements[userId] || null;
  gateModule.consumePaCredits = async (userId, cost) => {
    _consumeCalls.push({ userId, cost });
    const r = _mockEntitlements[userId];
    if (!r) return 0;
    r.paCredits = Math.max(0, (r.paCredits || 0) - cost);
    return r.paCredits;
  };
}
mockGateDefaults();

// Set mock API key
process.env.ANTHROPIC_API_KEY = 'test-key-mock';
// The fallback leg needs a key present or _lib/llm skips Gemini as unconfigured
// and the chain-exhaustion tests would pass for the wrong reason.
process.env.GEMINI_API_KEY = 'test-gemini-mock';

// Now require the module under test
// Force fresh load by clearing cache
delete require.cache[require.resolve('./index')];
const handler = require('./index');

// ── Test fixtures ──
function mockContext() {
  return {
    log: Object.assign(function() {}, {
      error: process.env.SMOKE_DEBUG ? console.log : function() {},
      warn: function() {},
      info: function() {}
    }),
    res: null
  };
}

function mockReq(overrides) {
  return Object.assign({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: { agentId: 'test-agent', input: 'test input' }
  }, overrides);
}

// ── Test runner ──
var _passed = 0;
var _failed = 0;
var _errors = [];

function test(name, fn) {
  try {
    fn();
    _passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (e) {
    _failed++;
    _errors.push({ name, error: e.message });
    console.log('  \x1b[31m✗\x1b[0m ' + name + ' — ' + e.message);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    _passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (e) {
    _failed++;
    _errors.push({ name, error: e.message });
    console.log('  \x1b[31m✗\x1b[0m ' + name + ' — ' + e.message);
  }
}

function resetMocks() {
  _mockStorage = {};
  _mockFetchCalls = [];
  _mockFetchQueue = [];
  _mockEntitlements = {};
  _consumeCalls = [];
  mockGateDefaults();
  _mockFetchResponse = {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ text: '{"score": 75, "verdict": "Not bad", "analysis": "Decent work"}' }],
      usage: { input_tokens: 100, output_tokens: 200 }
    })
  };
}

// ── Tests ──
async function runSmokeTests() {
  console.log('\n\x1b[1mPixel Agent Run — Smoke Tests\x1b[0m\n');

  // ── CORS ──
  await asyncTest('OPTIONS returns 204 with CORS headers', async function() {
    var ctx = mockContext();
    await handler(ctx, mockReq({ method: 'OPTIONS' }));
    assert.strictEqual(ctx.res.status, 204);
    assert.strictEqual(ctx.res.headers['Access-Control-Allow-Origin'], '*');
  });

  // ── Agent Lookup ──
  await asyncTest('Known active agent resolves', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.agentId, 'test-agent');
    assert.strictEqual(ctx.res.body.success, true);
  });

  await asyncTest('Unknown agent returns 400 with available list', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({ body: { agentId: 'nonexistent', input: 'test' } }));
    assert.strictEqual(ctx.res.status, 400);
    assert.ok(ctx.res.body.error.includes('nonexistent'));
    assert.ok(Array.isArray(ctx.res.body.availableAgents));
  });

  await asyncTest('Inactive agent returns 400', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({ body: { agentId: 'inactive-agent', input: 'test' } }));
    assert.strictEqual(ctx.res.status, 400);
  });

  await asyncTest('Scaffold meta-agent resolves', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({ body: { agentId: '_scaffold', input: 'build a joke rater' } }));
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.agentId, '_scaffold');
  });

  await asyncTest('Custom test agent resolves', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({
      body: {
        agentId: '_test',
        input: 'hello',
        _customAgent: {
          systemPrompt: 'You are a test.',
          userPromptTemplate: '{{input}}',
          generationConfig: {}
        }
      }
    }));
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.agentId, '_test');
  });

  await asyncTest('Community agent fallback resolves', async function() {
    resetMocks();
    _mockStorage.pixelAgentCommunity = [
      { id: 'community-test', name: 'Community Test', active: true, systemPrompt: 'test', userPromptTemplate: '{{input}}', generationConfig: {} }
    ];
    var ctx = mockContext();
    await handler(ctx, mockReq({ body: { agentId: 'community-test', input: 'test' } }));
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.agentId, 'community-test');
  });

  // ── Input Validation ──
  await asyncTest('Empty input returns 400', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({ body: { agentId: 'test-agent', input: '' } }));
    assert.strictEqual(ctx.res.status, 400);
    assert.ok(ctx.res.body.error.includes('input'));
  });

  await asyncTest('Missing input returns 400', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({ body: { agentId: 'test-agent' } }));
    assert.strictEqual(ctx.res.status, 400);
  });

  await asyncTest('Invalid URL for url-type agent returns 400', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({ body: { agentId: 'url-agent', input: 'not a url' } }));
    assert.strictEqual(ctx.res.status, 400);
    assert.ok(ctx.res.body.error.includes('URL'));
  });

  await asyncTest('Valid URL for url-type agent passes validation', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({ body: { agentId: 'url-agent', input: 'https://example.com' } }));
    assert.strictEqual(ctx.res.status, 200);
  });

  // ── Rate Limiting ──
  await asyncTest('Anonymous: first 5 runs succeed', async function() {
    resetMocks();
    for (var i = 0; i < 5; i++) {
      var ctx = mockContext();
      await handler(ctx, mockReq());
      assert.strictEqual(ctx.res.status, 200, 'Run ' + (i + 1) + ' should succeed');
    }
  });

  await asyncTest('Anonymous: 6th run returns 429', async function() {
    // Storage already has 3 runs from previous test
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 429);
    assert.strictEqual(ctx.res.body.remaining, 0);
  });

  await asyncTest('CEO header bypasses rate limit', async function() {
    // Storage still has 3+ runs
    var ctx = mockContext();
    await handler(ctx, mockReq({
      headers: { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher', 'x-forwarded-for': '1.2.3.4' }
    }));
    assert.strictEqual(ctx.res.status, 200);
  });

  await asyncTest('Different IP gets fresh rate limit', async function() {
    var ctx = mockContext();
    await handler(ctx, mockReq({
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '5.6.7.8' }
    }));
    assert.strictEqual(ctx.res.status, 200);
  });

  // ── Billing Enforcement ──
  function authHeaders(userId) {
    const principal = Buffer.from(JSON.stringify({ userId: userId, claims: [] })).toString('base64');
    return { 'Content-Type': 'application/json', 'x-cf-auth-principal': principal, 'x-forwarded-for': '9.9.9.9' };
  }
  const _today = new Date().toISOString().split('T')[0];

  await asyncTest('Authed free tier: run succeeds with tier/credits fields', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq({ headers: authHeaders('user-free') }));
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.tier, 'free');
    assert.strictEqual(ctx.res.body.credits, 0);
    assert.strictEqual(ctx.res.body.remaining, 9);
  });

  await asyncTest('Authed free tier: 429 at 10-run limit with upsell fields', async function() {
    resetMocks();
    _mockStorage.pixelAgentRateLimits = {};
    _mockStorage.pixelAgentRateLimits['user-free_' + _today] = 10;
    var ctx = mockContext();
    await handler(ctx, mockReq({ headers: authHeaders('user-free') }));
    assert.strictEqual(ctx.res.status, 429);
    assert.strictEqual(ctx.res.body.credits, 0);
    assert.strictEqual(ctx.res.body.tier, 'free');
    assert.ok(ctx.res.body.upgradeUrl.includes('upgrade'));
    assert.ok(ctx.res.body.message.includes('Pro'));
  });

  await asyncTest('Credits extend past the free allowance and are consumed on success', async function() {
    resetMocks();
    _mockStorage.pixelAgentRateLimits = {};
    _mockStorage.pixelAgentRateLimits['user-credit_' + _today] = 10;
    _mockEntitlements['user-credit'] = { userId: 'user-credit', tier: 'free', subscriptionStatus: null, flags: {}, purchases: [], paCredits: 3 };
    var ctx = mockContext();
    await handler(ctx, mockReq({ headers: authHeaders('user-credit') }));
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.remaining, 0);
    assert.strictEqual(ctx.res.body.credits, 2);
    assert.strictEqual(_consumeCalls.length, 1);
    assert.strictEqual(_consumeCalls[0].cost, 1);
    // free-allowance counter untouched while running on credits
    assert.strictEqual(_mockStorage.pixelAgentRateLimits['user-credit_' + _today], 10);
  });

  await asyncTest('Insufficient credits for a cost-2 agent returns 429', async function() {
    resetMocks();
    _mockStorage.pixelAgentRateLimits = {};
    _mockStorage.pixelAgentRateLimits['user-short_' + _today] = 10;
    _mockEntitlements['user-short'] = { userId: 'user-short', tier: 'free', subscriptionStatus: null, flags: {}, purchases: [], paCredits: 1 };
    var ctx = mockContext();
    await handler(ctx, mockReq({ headers: authHeaders('user-short'), body: { agentId: 'expensive-agent', input: 'test' } }));
    assert.strictEqual(ctx.res.status, 429);
    assert.ok(ctx.res.body.message.includes('costs 2 runs'));
    assert.strictEqual(_consumeCalls.length, 0);
  });

  await asyncTest('Pro subscriber runs past the daily limit without rate-limit writes', async function() {
    resetMocks();
    _mockStorage.pixelAgentRateLimits = {};
    _mockStorage.pixelAgentRateLimits['user-pro_' + _today] = 50;
    _mockEntitlements['user-pro'] = { userId: 'user-pro', tier: 'pro', subscriptionStatus: 'active', flags: {}, purchases: [] };
    var ctx = mockContext();
    await handler(ctx, mockReq({ headers: authHeaders('user-pro') }));
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.tier, 'pro');
    assert.strictEqual(ctx.res.body.remaining, 999);
    assert.strictEqual(_mockStorage.pixelAgentRateLimits['user-pro_' + _today], 50);
    assert.strictEqual(_consumeCalls.length, 0);
  });

  await asyncTest('Entitlements lookup failure fails open to free tier', async function() {
    resetMocks();
    gateModule.loadPaEntitlements = async function() { throw new Error('blob down'); };
    var ctx = mockContext();
    await handler(ctx, mockReq({ headers: authHeaders('user-outage') }));
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.tier, 'free');
    assert.strictEqual(ctx.res.body.remaining, 9);
  });

  // ── Response Shape ──
  await asyncTest('200 response has required fields', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq());
    var body = ctx.res.body;
    assert.strictEqual(body.success, true);
    assert.ok(body.agentId);
    assert.ok(body.agentName);
    assert.ok(body.result);
    assert.ok(body.runId);
    assert.ok(body.timestamp);
    assert.ok(typeof body.remaining === 'number');
    assert.ok(body.shareUrl.includes(body.runId));
  });

  await asyncTest('Result is parsed JSON object', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.body.result.score, 75);
    assert.strictEqual(ctx.res.body.result.verdict, 'Not bad');
  });

  // ── Run Record ──
  await asyncTest('Run record stored in pixelAgentRuns', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq());
    var runs = _mockStorage.pixelAgentRuns;
    assert.ok(Array.isArray(runs));
    assert.strictEqual(runs.length, 1);
    var record = runs[0];
    assert.ok(record.runId);
    assert.strictEqual(record.agentId, 'test-agent');
    assert.strictEqual(record.agentName, 'Test Agent');
    assert.ok(record.timestamp);
    assert.ok(record.input);
    assert.ok(record.result);
  });

  // ── Stats ──
  await asyncTest('pixelAgentStats incremented', async function() {
    resetMocks();
    var ctx = mockContext();
    await handler(ctx, mockReq());
    var stats = _mockStorage.pixelAgentStats;
    assert.strictEqual(stats['test-agent'], 1);
    assert.strictEqual(stats._totalRuns, 1);

    // Second run
    await handler(mockContext(), mockReq());
    stats = _mockStorage.pixelAgentStats;
    assert.strictEqual(stats['test-agent'], 2);
    assert.strictEqual(stats._totalRuns, 2);
  });

  // ── JSON Parse Fallback ──
  await asyncTest('Malformed Claude response creates raw result', async function() {
    resetMocks();
    _mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ text: 'This is not JSON at all' }],
        usage: { input_tokens: 50, output_tokens: 100 }
      })
    };
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 200);
    assert.ok(ctx.res.body.result.raw);
    assert.ok(ctx.res.body.result.raw.includes('not JSON'));
  });

  // ── Model fallback ──
  // Before 2026-08-07 this endpoint made one unconditional call to Anthropic,
  // so a 429/529/credit-exhaustion returned 502 to every user of all 24 agents
  // at once. These four tests are the guard on that never coming back.

  await asyncTest('Claude failure falls back to Gemini and still serves the user', async function() {
    resetMocks();
    _mockFetchQueue = [providerFail(529, 'overloaded'), geminiOk('{"score": 64, "verdict": "Served by the backup"}')];
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.result.score, 64);
    assert.strictEqual(_mockFetchCalls.length, 2, 'expected a second provider to be tried');
    assert.ok(_mockFetchCalls[1].url.indexOf('generativelanguage.googleapis.com') !== -1, 'fallback did not reach Gemini');
  });

  await asyncTest('exhausted Anthropic credits do not take the product down', async function() {
    // Anthropic reports this as a 400 whose MESSAGE is the only signal, so a
    // status-code-only check would misread it as a bad request and give up.
    resetMocks();
    _mockFetchQueue = [
      providerFail(400, 'Your credit balance is too low to access the Anthropic API.'),
      geminiOk('{"score": 51, "verdict": "Still open for business"}')
    ];
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.result.score, 51);
  });

  await asyncTest('every model failing returns a retryable 503, not a generic fault', async function() {
    resetMocks();
    _mockFetchQueue = [providerFail(500, 'anthropic down'), providerFail(500, 'gemini down')];
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 503);
    assert.strictEqual(ctx.res.body.retryable, true);
    assert.strictEqual(ctx.res.headers['Retry-After'], '60');
    // The old copy said "encountered a system fault", which reads as user error.
    assert.ok(!/system fault/i.test(ctx.res.body.error), 'copy still blames the user: ' + ctx.res.body.error);
  });

  await asyncTest('a total outage still costs the user nothing', async function() {
    // Billing accounting must stay after the model call: a failed run may not
    // consume a free run or a paid credit.
    resetMocks();
    _mockFetchQueue = [providerFail(500, 'down'), providerFail(500, 'down')];
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 503);
    var limits = _mockStorage.pixelAgentRateLimits;
    assert.ok(!limits || Object.keys(limits).length === 0, 'a failed run consumed the free allowance');
  });

  // ── Rate-limit accounting under concurrency ──

  await asyncTest('a concurrent run cannot erase another run\'s count', async function() {
    // The old code read the whole blob BEFORE the ~26s model call and wrote it
    // back after, so two overlapping runs both wrote a count based on the same
    // stale read and one simply vanished — a free run handed out twice.
    // Simulate the interleaving: another request bumps the counter while this
    // one is mid-flight, i.e. after its initial read but before its write.
    resetMocks();
    var realMutate = storageModule.mutateState;
    storageModule.mutateState = async function (key, mutator) {
      var otherKey = 'other-user_' + new Date().toISOString().split('T')[0];
      _mockStorage[key] = {};
      _mockStorage[key][otherKey] = 3;
      return realMutate(key, mutator);
    };
    var ctx = mockContext();
    await handler(ctx, mockReq());
    storageModule.mutateState = realMutate;

    assert.strictEqual(ctx.res.status, 200);
    var today = new Date().toISOString().split('T')[0];
    var limits = _mockStorage.pixelAgentRateLimits;
    assert.strictEqual(limits['other-user_' + today], 3, 'the concurrent write was clobbered');
    var mine = Object.keys(limits).filter(function (k) { return k !== 'other-user_' + today; });
    assert.strictEqual(limits[mine[0]], 1, 'this run did not record its own count');
  });

  await asyncTest('repeat runs increment rather than overwrite', async function() {
    resetMocks();
    for (var i = 0; i < 3; i++) await handler(mockContext(), mockReq());
    var limits = _mockStorage.pixelAgentRateLimits;
    var total = Object.keys(limits).reduce(function (t, k) { return t + limits[k]; }, 0);
    assert.strictEqual(total, 3, 'expected 3 runs counted, got ' + total);
  });

  // ── Input ceilings ──
  // The free path used to accept a 50k paste and then the $9 button rejected
  // it with a raw browser alert. Both limits now match the paid path.

  await asyncTest('an over-length resume is rejected with the limit named, not truncated', async function() {
    resetMocks();
    var req = mockReq();
    req.body.input = 'x'.repeat(20001);
    var ctx = mockContext();
    await handler(ctx, req);
    assert.strictEqual(ctx.res.status, 400);
    assert.strictEqual(ctx.res.body.limit, 20000);
    assert.strictEqual(ctx.res.body.actual, 20001);
    assert.strictEqual(_mockFetchCalls.length, 0, 'an over-length input must not reach a paid model call');
  });

  await asyncTest('a resume exactly at the limit is accepted', async function() {
    resetMocks();
    var req = mockReq();
    req.body.input = 'x'.repeat(20000);
    var ctx = mockContext();
    await handler(ctx, req);
    assert.strictEqual(ctx.res.status, 200);
  });

  // ── Markdown fence stripping ──
  await asyncTest('JSON wrapped in markdown fences is parsed correctly', async function() {
    resetMocks();
    _mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ text: '```json\n{"score": 90, "verdict": "Great"}\n```' }],
        usage: { input_tokens: 50, output_tokens: 100 }
      })
    };
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.result.score, 90);
  });

  // ── Summary ──
  console.log('\n\x1b[1mResults: ' + _passed + ' passed, ' + _failed + ' failed\x1b[0m');
  if (_errors.length > 0) {
    console.log('\nFailed tests:');
    _errors.forEach(function(e) { console.log('  - ' + e.name + ': ' + e.error); });
  }
  console.log('');
  process.exit(_failed > 0 ? 1 : 0);
}

runSmokeTests();
