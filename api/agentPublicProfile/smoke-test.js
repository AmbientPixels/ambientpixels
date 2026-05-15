#!/usr/bin/env node
// Self-test for /api/agentPublicProfile — stubs companyStorage, asserts response shape.
// Run from c:\Dev\Ambientpixels\ambientpixels: node api/agentPublicProfile/smoke-test.js

const path = require('path');
const assert = require('assert');

// Mock companyStorage before requiring the endpoint.
const mockState = {
  allocationDigest: {
    system: { spent: 13.85, budget: 20, status: 'GREEN', pct: 69 }
  },
  agentMemories: {
    cipher: [
      { id: 'm1', type: 'feedback', source: 'cycle-123', text: 'I keep flagging Pixel waste at 38%.', timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString() },
      { id: 'm2', type: 'consolidated_belief', source: 'auto:consolidation', text: 'auto memory should not be returned', timestamp: new Date().toISOString() }
    ],
    nova: []
  },
  tasks: [
    { id: 't1', assignee: 'nova', status: 'todo' },
    { id: 't2', assignee: 'nova', status: 'in-progress' },
    { id: 't3', assignee: 'nova', status: 'done' }
  ],
  heartbeatRuns: [
    { runId: 'r1', status: 'ok', startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }
  ],
  blogPosts: [],
  blueskyCandidates: [],
  socialAccountStats: { platforms: {} }
};

require.cache[require.resolve('../_utils/companyStorage')] = {
  exports: {
    getState: async (key) => mockState[key] || null,
    validateSecret: () => true
  }
};

const handler = require('./index.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

async function call(query) {
  const ctx = { log: () => {}, res: {} };
  await handler(ctx, { method: 'GET', query, headers: {} });
  return ctx.res;
}

function clearCache() {
  // Force fresh build per test to avoid the 60s in-memory cache.
  const epcache = require('./index.js');
  // Cache is module-local — easiest way is to re-require, but require cache makes that hard.
  // Workaround: each test uses a different IP-like header OR we just trust the 60s window.
  // For this test we run all assertions inside a short window AND each id is distinct enough
  // that the 60s cache doesn't cross-pollute (the cache key is the id).
}

(async () => {
  console.log('Running endpoint smoke tests...');

  await test('200 for valid single-agent id', async () => {
    const res = await call({ id: 'cipher' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, 'cipher');
    assert.strictEqual(res.body.status, 'GREEN');
    assert.strictEqual(res.body.stat.label, 'MTD spend');
    assert(res.body.stat.value.includes('13.85'));
  });

  await test('latestMemory excludes auto:* sources', async () => {
    const res = await call({ id: 'cipher' });
    assert(res.body.latestMemory);
    assert(!res.body.latestMemory.text.includes('auto memory'));
    assert(res.body.latestMemory.text.includes('Pixel waste'));
  });

  await test('latestMemory is null when only auto memories exist', async () => {
    const res = await call({ id: 'nova' });
    assert.strictEqual(res.body.latestMemory, null);
  });

  await test('nova active-tasks stat counts correctly', async () => {
    const res = await call({ id: 'nova' });
    assert.strictEqual(res.body.stat.label, 'Active tasks');
    assert.strictEqual(res.body.stat.value, '2');
  });

  await test('404 for unknown agent id', async () => {
    const res = await call({ id: 'garbage' });
    assert.strictEqual(res.status, 404);
  });

  await test('400 for missing id', async () => {
    const res = await call({});
    assert.strictEqual(res.status, 400);
  });

  await test('batch mode returns all 8 agents', async () => {
    const res = await call({ id: 'all' });
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.agents));
    assert.strictEqual(res.body.agents.length, 8);
    const ids = res.body.agents.map(a => a.id).sort();
    assert.deepStrictEqual(ids, ['cipher', 'echo', 'forge', 'nova', 'pixel', 'quill', 'scout', 'scribe']);
  });

  await test('memory text is truncated to 200 chars', async () => {
    mockState.agentMemories.scout = [
      { id: 'm-long', type: 'feedback', source: 'cycle-x', text: 'A'.repeat(500), timestamp: new Date().toISOString() }
    ];
    const res = await call({ id: 'scout' });
    assert(res.body.latestMemory);
    assert(res.body.latestMemory.text.length <= 201, `text length ${res.body.latestMemory.text.length} > 201`);
    assert(res.body.latestMemory.text.endsWith('…'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
