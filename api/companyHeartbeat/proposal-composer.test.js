// Run with: node api/companyHeartbeat/proposal-composer.test.js
const assert = require('assert');
const C = require('./proposal-composer');

let pass = 0, fail = 0;
const _pending = [];
function test(name, fn) {
  const p = Promise.resolve().then(fn).then(
    () => { pass++; console.log('  PASS ', name); },
    (e) => { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
  );
  _pending.push(p);
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

// ── validate + compose ──
const NOW = Date.UTC(2026, 6, 11, 12, 0, 0); // 2026-07-11T12:00:00Z
const deadline = (days) => new Date(NOW + days * 86400000).toISOString().slice(0, 10);

const objSignal = { kind: 'objective', trigger: 'near_complete', subject: { objectiveId: 'o1', objectiveTitle: 'Build in Public' }, evidence: { progress: 99, count: 1 } };
const campSignal = { kind: 'campaign', trigger: 'declining_uncovered', subject: { product: 'StoryForge' }, evidence: { decliningProducts: [{ product: 'StoryForge', deltaPct: -32 }] } };
const grounding = () => C.buildGrounding(objSignal, stateWith({ revenueLedger: [] }));

const goodObj = () => ({
  propose: true, kind: 'objective', title: 'Land AmbientScore first paying customers',
  description: 'Convert scan traffic into paid reports.', rationale: 'StoryForge declining; revenue is the north star.',
  successCriteria: 'Reach 3 paying customers', northStarMetric: 'paying_customers',
  metricBaseline: 0, metricTarget: 3, metricDeadline: deadline(45), suggestedCampaigns: ['outbound-scans']
});

test('validate accepts a clean objective and maps to materializer shape', () => {
  const v = C.validate(goodObj(), objSignal, grounding(), NOW);
  assert.ok(v.ok, 'should be valid: ' + v.reason);
  assert.strictEqual(v.proposal.type, 'objective_proposal');
  assert.strictEqual(v.proposal.northStarMetric, 'paying_customers');
  assert.strictEqual(v.proposal.metricTarget, 3);
  assert.strictEqual(v.proposal.source, 'auto:proposal-generator');
  assert.ok(v.proposal.id.indexOf('oprop_') === 0);
});

test('validate rejects propose:false', () => {
  assert.strictEqual(C.validate({ propose: false }, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects a kind mismatch', () => {
  const p = goodObj(); p.kind = 'campaign';
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects a missing field', () => {
  const p = goodObj(); p.rationale = '';
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects an unknown metric', () => {
  const p = goodObj(); p.northStarMetric = 'moon_phase';
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects an out-of-band target for a real baseline', () => {
  const p = goodObj(); p.northStarMetric = 'bluesky_followers'; p.metricTarget = 8000; // baseline 80, 5x = 400
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects an out-of-band target for a zero baseline', () => {
  const p = goodObj(); p.metricTarget = 5000; // paying_customers baseline 0, abs cap 25
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate accepts a modest zero-baseline target (0 -> 3)', () => {
  assert.ok(C.validate(goodObj(), objSignal, grounding(), NOW).ok);
});
test('validate rejects a non-directional target', () => {
  const p = goodObj(); p.northStarMetric = 'bluesky_followers'; p.metricTarget = 80; // == baseline
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects a deadline outside the 14-180 day window', () => {
  const p = goodObj(); p.metricDeadline = deadline(5);
  assert.strictEqual(C.validate(p, objSignal, grounding(), NOW).ok, false);
});
test('validate rejects a campaign naming a fake product', () => {
  const gc = C.buildGrounding(campSignal, stateWith({}));
  const p = { propose: true, kind: 'campaign', title: 'Push Nonexistinator', description: 'x', rationale: 'y',
    successCriteria: '+40 followers', product: 'Nonexistinator', northStarMetric: 'bluesky_followers',
    metricBaseline: 80, metricTarget: 120, metricDeadline: deadline(30), platforms: ['social_bluesky'] };
  assert.strictEqual(C.validate(p, campSignal, gc, NOW).ok, false);
});
test('validate accepts a campaign naming a real product', () => {
  const gc = C.buildGrounding(campSignal, stateWith({}));
  const p = { propose: true, kind: 'campaign', title: 'Re-engage StoryForge', description: 'x', rationale: 'y',
    successCriteria: '+40 followers', product: 'StoryForge', northStarMetric: 'bluesky_followers',
    metricBaseline: 80, metricTarget: 120, metricDeadline: deadline(30), platforms: ['social_bluesky', 'bogus'] };
  const v = C.validate(p, campSignal, gc, NOW);
  assert.ok(v.ok, 'should be valid: ' + v.reason);
  assert.strictEqual(v.proposal.type, 'campaign_proposal');
  assert.deepStrictEqual(v.proposal.platforms, ['social_bluesky'], 'invalid platform filtered out');
});

// ── compose (fake callModel) ──
test('compose returns a proposal from a good model response', async () => {
  const fake = () => Promise.resolve('```json\n' + JSON.stringify(goodObj()) + '\n```');
  const r = await C.compose(objSignal, grounding(), fake, NOW);
  assert.ok(r.proposal, 'expected a proposal');
  assert.strictEqual(r.proposal.type, 'objective_proposal');
});
test('compose skips when the model throws', async () => {
  const fake = () => Promise.reject(new Error('timeout'));
  const r = await C.compose(objSignal, grounding(), fake, NOW);
  assert.ok(r.skip, 'expected skip');
});
test('compose skips on unparseable output', async () => {
  const r = await C.compose(objSignal, grounding(), () => Promise.resolve('no json here'), NOW);
  assert.ok(r.skip);
});
test('compose skips when the model declines', async () => {
  const r = await C.compose(objSignal, grounding(), () => Promise.resolve('{"propose":false}'), NOW);
  assert.ok(r.skip);
});

Promise.all(_pending).then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
});
