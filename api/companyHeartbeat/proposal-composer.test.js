// Run with: node api/companyHeartbeat/proposal-composer.test.js
const assert = require('assert');
const C = require('./proposal-composer');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const stateWith = (over) => Object.assign({
  objectives: [{ id: 'o1', status: 'active', title: 'Build in Public', northStarMetric: 'bluesky_followers', progress: 40 }],
  campaigns: [{ id: 'c1', status: 'active', name: 'Daily Pulse', product: 'AmbientOS', cadence: 'daily' }],
  strategicDigest: { perProduct: [{ product: 'StoryForge', verdict: 'DECLINING', traffic: { deltaPct: -32 } }] },
  socialAccountStats: { platforms: { bluesky: { followers: 80 }, x: { followers: 50 } } },
  revenueLedger: [],
  productNames: ['AmbientOS', 'StoryForge', 'AmbientScore']
}, over || {});

// ── extractJson ──
test('extractJson parses a bare JSON object', () => {
  assert.deepStrictEqual(C.extractJson('{"a":1}'), { a: 1 });
});
test('extractJson strips ```json fences', () => {
  assert.deepStrictEqual(C.extractJson('```json\n{"a":2}\n```'), { a: 2 });
});
test('extractJson finds an object amid prose', () => {
  assert.deepStrictEqual(C.extractJson('Sure! {"a":3} hope that helps'), { a: 3 });
});
test('extractJson returns null on garbage', () => {
  assert.strictEqual(C.extractJson('not json at all'), null);
  assert.strictEqual(C.extractJson(''), null);
  assert.strictEqual(C.extractJson(null), null);
});

// ── buildGrounding ──
test('buildGrounding computes follower + paying_customers baselines', () => {
  const g = C.buildGrounding({ kind: 'objective', trigger: 'near_complete', subject: {} }, stateWith({
    revenueLedger: [{ customerId: 'a', amountCents: 2900 }, { customerId: 'a', amountCents: 2900 }, { customerId: 'b', amountCents: 8900 }]
  }));
  assert.strictEqual(g.baselines.bluesky_followers, 80);
  assert.strictEqual(g.baselines.x_followers, 50);
  assert.strictEqual(g.baselines.paying_customers, 2, 'unique paying customers');
  assert.ok(g.productNames.indexOf('StoryForge') !== -1);
  assert.strictEqual(g.activeObjectives[0].northStarMetric, 'bluesky_followers');
});
test('buildGrounding paying_customers defaults to 0 with empty ledger', () => {
  const g = C.buildGrounding({ kind: 'objective', trigger: 'near_complete', subject: {} }, stateWith({}));
  assert.strictEqual(g.baselines.paying_customers, 0);
});
test('buildGrounding unwraps the REAL { entries } ledger blob shape', () => {
  const g = C.buildGrounding({ kind: 'objective', trigger: 'near_complete', subject: {} }, stateWith({
    revenueLedger: { entries: [{ customerId: 'a', amountCents: 2900 }, { customerId: 'a', amountCents: 2900 }, { customerId: 'b', amountCents: 8900 }], updatedAt: '2026-07-11' }
  }));
  assert.strictEqual(g.baselines.paying_customers, 2, 'unique customers from {entries}');
});
test('buildGrounding paying_customers handles mixed fields, missing keys, and refunds', () => {
  const g = C.buildGrounding({ kind: 'objective', trigger: 'near_complete', subject: {} }, stateWith({
    revenueLedger: { entries: [
      { customerId: 'a', amountCents: 2900 },        // counts (a)
      { customerEmail: 'b@x.com', amount: 89 },       // counts (b) via amount + customerEmail
      { amountCents: 2900 },                          // no id/email key → skipped
      { customerId: 'c', amountCents: -2900 },        // refund / non-positive → excluded
      { customerId: 'a', amount: 29 }                 // dup of a
    ] }
  }));
  assert.strictEqual(g.baselines.paying_customers, 2, 'a + b only; keyless + refund excluded, dup collapsed');
});
test('buildGrounding omits an absent platform from baselines', () => {
  const g = C.buildGrounding({ kind: 'objective', trigger: 'near_complete', subject: {} }, stateWith({
    socialAccountStats: { platforms: { bluesky: { followers: 80 } } }
  }));
  assert.strictEqual(g.baselines.bluesky_followers, 80);
  assert.strictEqual(g.baselines.linkedin_followers, undefined, 'absent platform omitted');
  assert.strictEqual(g.baselines.paying_customers, 0);
});

// ── _matchesProduct: exact normalized match, generic substrings rejected ──
test('_matchesProduct rejects generic substrings and accepts real names', () => {
  const names = ['AmbientOS', 'StoryForge', 'AmbientScore', 'PixelAgents'];
  assert.strictEqual(C._matchesProduct('Forge', names), false, 'generic "Forge" must not match');
  assert.strictEqual(C._matchesProduct('Ambient', names), false, 'generic "Ambient" must not match');
  assert.strictEqual(C._matchesProduct('StoryForge', names), true, 'exact real name matches');
  assert.strictEqual(C._matchesProduct('Pixel Agents', names), true, 'spacing-insensitive real name matches');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
