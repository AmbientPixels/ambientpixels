// Run with: node api/pixel-agent-share-card/share-card.test.js
//
// Two bugs live here, both of which shipped silently and killed the viral loop:
//
//  1. `require('satori')` returns { default, init } in 0.10.x, not the function.
//     Calling it threw on every request, so this endpoint answered 500 for its
//     entire life — the og:image of every shared link was a broken URL.
//  2. The score was read as `result.score`, a key only 1 of the 10 scoring
//     agents uses, so even once rendering worked the card would have been blank
//     where the number goes.
//
// These tests render a REAL PNG through the real satori + resvg, because a
// mock would have happily "passed" against a module that was never callable.

const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

// ── capture the satori render tree, then call through to the real thing ──
const satoriPath = require.resolve('satori');
const realSatori = require('satori').default;
let lastMarkup = null;
require.cache[satoriPath].exports = function (markup, opts) {
  lastMarkup = markup;
  return realSatori(markup, opts);
};

// ── stub storage ──
const storagePath = require.resolve('../_utils/companyStorage');
let RUNS = [];
let communityAgents = [];
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true, exports: {
    getState: async key => {
      if (key === 'pixelAgentRuns') return RUNS;
      if (key === 'pixelAgentCommunity') return communityAgents;
      return [];
    }
  }
};

delete require.cache[require.resolve('./index')];
const handler = require('./index');

function ctx() {
  const c = { res: null };
  c.log = Object.assign(function () {}, { error: function () {}, warn: function () {} });
  return c;
}

function roastRun(overrides) {
  return Object.assign({
    runId: 'run-test-001',
    agentId: 'resume-roast',
    agentName: 'Resume Roast',
    agentTier: 'rare',
    result: { ats_score: 41, verdict: 'All roadmap, zero delivery.' },
    timestamp: new Date().toISOString()
  }, overrides || {});
}

// Walk the satori tree collecting every string child, so we can assert on what
// would actually be drawn.
function renderedText(node, out) {
  out = out || [];
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach(n => renderedText(n, out)); return out; }
  if (node.props && node.props.children !== undefined) renderedText(node.props.children, out);
  return out;
}

// ── the regression that matters most ──

test('renders a real PNG instead of 500 — the satori interop bug', async () => {
  RUNS = [roastRun()];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'run-test-001' }, headers: {} });
  assert.strictEqual(c.res.status, 200, 'body: ' + JSON.stringify(c.res.body));
  assert.strictEqual(c.res.headers['Content-Type'], 'image/png');
  assert.ok(Buffer.isBuffer(c.res.body), 'body must be a Buffer');
  assert.ok(c.res.body.length > 5000, 'PNG suspiciously small: ' + c.res.body.length);
  assert.strictEqual(c.res.body.slice(1, 4).toString(), 'PNG', 'not a PNG magic number');
});

test('the ATS score reaches the card — the key-mismatch bug', async () => {
  RUNS = [roastRun()];
  await handler(ctx(), { method: 'GET', query: { run: 'run-test-001' }, headers: {} });
  const text = renderedText(lastMarkup).join(' | ');
  assert.ok(text.includes('41'), 'score 41 missing from card. Rendered: ' + text);
  assert.ok(text.includes('out of 100'), 'score block not rendered. Rendered: ' + text);
  assert.ok(text.includes('All roadmap'), 'verdict missing. Rendered: ' + text);
});

test('a score of 0 still renders — the falsy trap', async () => {
  RUNS = [roastRun({ runId: 'run-zero', result: { ats_score: 0, verdict: 'Nothing here.' } })];
  await handler(ctx(), { method: 'GET', query: { run: 'run-zero' }, headers: {} });
  const text = renderedText(lastMarkup).join(' | ');
  assert.ok(text.includes('out of 100'), 'zero was treated as no-score. Rendered: ' + text);
});

test('each scoring agent renders its own score key', async () => {
  const cases = [
    ['roast-my-site', { score: 72, verdict: 'Busy.' }],
    ['code-roast', { quality_score: 33, verdict: 'Nested.' }],
    ['validate-this', { viability_score: 55 }],
    ['roast-my-linkedin', { standout_score: 12, verdict: 'Buzzwords.' }],
    ['debate-me', { their_score: 30, counter_score: 90, verdict: 'Split.' }]
  ];
  for (const [agentId, result] of cases) {
    RUNS = [roastRun({ runId: 'r-' + agentId, agentId, agentName: agentId, result })];
    const c = ctx();
    await handler(c, { method: 'GET', query: { run: 'r-' + agentId }, headers: {} });
    assert.strictEqual(c.res.status, 200, agentId + ' failed to render');
    const text = renderedText(lastMarkup).join(' | ');
    const expected = String(Object.values(result).find(v => typeof v === 'number'));
    assert.ok(text.includes(expected), agentId + ' missing score ' + expected + '. Rendered: ' + text);
  }
});

test('a community agent score resolves via state', async () => {
  communityAgents = [{ id: 'forge-thing', outputSections: [{ key: 'vibe_rating', type: 'score' }] }];
  RUNS = [roastRun({ runId: 'run-comm', agentId: 'forge-thing', result: { vibe_rating: 88 } })];
  await handler(ctx(), { method: 'GET', query: { run: 'run-comm' }, headers: {} });
  const text = renderedText(lastMarkup).join(' | ');
  assert.ok(text.includes('88'), 'community score missing. Rendered: ' + text);
  communityAgents = [];
});

// ── the paths that must not regress ──

test('a scoreless agent still renders a card, using the verdict', async () => {
  RUNS = [roastRun({ runId: 'run-nv', agentId: 'hype-check', result: { verdict: 'Overhyped.' } })];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'run-nv' }, headers: {} });
  assert.strictEqual(c.res.status, 200);
  assert.ok(renderedText(lastMarkup).join(' | ').includes('Overhyped.'));
});

test('an empty result still renders rather than 500', async () => {
  RUNS = [roastRun({ runId: 'run-empty', result: {} })];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'run-empty' }, headers: {} });
  assert.strictEqual(c.res.status, 200);
});

test('missing run param → 400; unknown run → 404', async () => {
  const a = ctx();
  await handler(a, { method: 'GET', query: {}, headers: {} });
  assert.strictEqual(a.res.status, 400);

  RUNS = [];
  const b = ctx();
  await handler(b, { method: 'GET', query: { run: 'nope' }, headers: {} });
  assert.strictEqual(b.res.status, 404);
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  PASS ', name); }
    catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
