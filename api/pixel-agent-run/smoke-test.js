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

// Replace node-fetch globally
require.cache[require.resolve('node-fetch')] = {
  id: require.resolve('node-fetch'),
  filename: require.resolve('node-fetch'),
  loaded: true,
  exports: async function mockFetch(url, opts) {
    _mockFetchCalls.push({ url, method: opts?.method, body: opts?.body });
    return _mockFetchResponse;
  }
};

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
  }
];

require('fs').readFileSync = function(filePath, encoding) {
  if (filePath.includes('pixel-agents.json')) {
    return JSON.stringify(_mockAgents);
  }
  return _origReadFileSync(filePath, encoding);
};

// Set mock API key
process.env.ANTHROPIC_API_KEY = 'test-key-mock';

// Now require the module under test
// Force fresh load by clearing cache
delete require.cache[require.resolve('./index')];
const handler = require('./index');

// ── Test fixtures ──
function mockContext() {
  return {
    log: Object.assign(function() {}, {
      error: function() {},
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

  // ── Claude API Error ──
  await asyncTest('Claude API error returns 502', async function() {
    resetMocks();
    _mockFetchResponse = {
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Internal server error' } })
    };
    var ctx = mockContext();
    await handler(ctx, mockReq());
    assert.strictEqual(ctx.res.status, 502);
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
