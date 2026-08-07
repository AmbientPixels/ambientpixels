// Run with: node api/pixel-agent-share/share-og.test.js
//
// This endpoint produces the OG tags a social platform reads when someone
// shares their roast. Verified live on 2026-08-07 that the description came
// back as the verdict quote ALONE — no score — because the score was read as
// `result.score`, a key only roast-my-site uses. "I got 41/100" is the whole
// reason a roast gets shared, so the unfurl was throwing away its hook.

const assert = require('assert');

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

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

function run(overrides) {
  return Object.assign({
    runId: 'run-test-001',
    agentId: 'resume-roast',
    agentName: 'Resume Roast',
    result: { ats_score: 41, verdict: 'All roadmap, zero delivery.' }
  }, overrides || {});
}

function ogDescription(html) {
  const m = html.match(/<meta property="og:description" content="([^"]*)"/);
  return m ? m[1] : null;
}

test('the score lands in the OG description — the live bug', async () => {
  RUNS = [run()];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'run-test-001' }, headers: {} });
  assert.strictEqual(c.res.status, 200);
  const desc = ogDescription(c.res.body);
  assert.ok(desc.startsWith('Score: 41/100'), 'expected a score-led description, got: ' + desc);
  assert.ok(desc.includes('All roadmap'), 'verdict missing from: ' + desc);
});

test('twitter:description carries the score too', async () => {
  RUNS = [run()];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'run-test-001' }, headers: {} });
  assert.ok(/<meta name="twitter:description" content="Score: 41\/100/.test(c.res.body));
});

test('score 0 is reported, not swallowed', async () => {
  RUNS = [run({ runId: 'z', result: { ats_score: 0, verdict: 'Nothing here.' } })];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'z' }, headers: {} });
  assert.ok(ogDescription(c.res.body).startsWith('Score: 0/100'), ogDescription(c.res.body));
});

test('each scoring agent gets its own score into the unfurl', async () => {
  const cases = [
    ['roast-my-site', { score: 72, verdict: 'Busy.' }, '72'],
    ['code-roast', { quality_score: 33, verdict: 'Nested.' }, '33'],
    ['pitch-doctor', { persuasion_score: 61 }, '61'],
    ['meeting-killer', { productivity_score: 18, email_verdict: 'Could have been an email.' }, '18']
  ];
  for (const [agentId, result, expected] of cases) {
    RUNS = [run({ runId: 'r-' + agentId, agentId, agentName: agentId, result })];
    const c = ctx();
    await handler(c, { method: 'GET', query: { run: 'r-' + agentId }, headers: {} });
    const desc = ogDescription(c.res.body);
    assert.ok(desc.includes('Score: ' + expected + '/100'), agentId + ' → ' + desc);
  }
});

test('the five odd verdict keys surface instead of a generic line', async () => {
  // cause_of_death, rating, send_confidence, shock_factor, goal_summary —
  // none of which any /verdict$/ pattern would ever match.
  const cases = [
    ['startup-obituary', { cause_of_death: 'Died of a roadmap.' }, 'Died of a roadmap.'],
    ['legal-eagle', { rating: 'Mostly harmless.' }, 'Mostly harmless.'],
    ['plot-twist', { shock_factor: 'Nobody saw it coming.' }, 'Nobody saw it coming.']
  ];
  for (const [agentId, result, expected] of cases) {
    RUNS = [run({ runId: 'v-' + agentId, agentId, agentName: agentId, result })];
    const c = ctx();
    await handler(c, { method: 'GET', query: { run: 'v-' + agentId }, headers: {} });
    const desc = ogDescription(c.res.body);
    assert.ok(desc.includes(expected), agentId + ' fell back to a generic description: ' + desc);
  }
});

test('og:image points at the share-card endpoint for this run', async () => {
  RUNS = [run()];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'run-test-001' }, headers: {} });
  assert.ok(c.res.body.includes('pixel-agent-share-card?run=run-test-001'));
});

test('a quote-bearing verdict cannot break out of the meta attribute', async () => {
  RUNS = [run({ runId: 'x', result: { ats_score: 41, verdict: 'He said "no" & left <b>fast</b>' } })];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'x' }, headers: {} });
  const desc = ogDescription(c.res.body);
  assert.ok(!desc.includes('<b>'), 'unescaped markup in meta: ' + desc);
  assert.ok(desc.includes('&quot;no&quot;'), 'quotes not escaped: ' + desc);
});

test('an agent with no score or verdict still gets a sane description', async () => {
  RUNS = [run({ runId: 'n', agentId: 'prompt-forge', result: {} })];
  const c = ctx();
  await handler(c, { method: 'GET', query: { run: 'n' }, headers: {} });
  assert.strictEqual(ogDescription(c.res.body), 'AI agent result from Pixel Agents');
});

test('missing or unknown run redirects rather than erroring', async () => {
  const a = ctx();
  await handler(a, { method: 'GET', query: {}, headers: {} });
  assert.strictEqual(a.res.status, 302);
  RUNS = [];
  const b = ctx();
  await handler(b, { method: 'GET', query: { run: 'nope' }, headers: {} });
  assert.strictEqual(b.res.status, 302);
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  PASS ', name); }
    catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
