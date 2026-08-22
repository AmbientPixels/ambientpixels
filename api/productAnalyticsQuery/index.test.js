// Run with: node api/productAnalyticsQuery/index.test.js
//
// computeSources — attribution of product usage back to the post that earned it.
//
// The counting rule is the whole point: PEOPLE, not events. The 22x KPI inflation
// this company already lived through came from summing event volume, and a visitor
// who retries a run three times is one person who found us, not three.
const assert = require('assert');
const { _computeSources: computeSources } = require('./index.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

const ev = (userId, event, props, product) => ({
  product: product || 'resumeroast', event, userId, props: props || {}
});
const BSKY = { utm_source: 'bluesky', utm_content: 'act_reply_A' };

test('one person retrying is counted once, not once per event', () => {
  const r = computeSources([
    ev('u1', 'page_view', BSKY),
    ev('u1', 'agent_run_started', BSKY),
    ev('u1', 'agent_run_started', BSKY),
    ev('u1', 'agent_run_started', BSKY),
    ev('u1', 'agent_run_completed', BSKY)
  ], 'resumeroast');
  const s = r.bySource.find(x => x.source === 'bluesky');
  assert.strictEqual(s.people, 1);
  assert.strictEqual(s.started, 1, 'three starts by one person is one person who started');
  assert.strictEqual(s.completed, 1);
});

test('unattributed visitors are reported, not hidden', () => {
  // Most real traffic carries no UTM. Reporting only the attributed slice would
  // overstate how much of the funnel distribution explains.
  const r = computeSources([
    ev('u1', 'page_view', BSKY),
    ev('u2', 'page_view', {}),
    ev('u3', 'page_view', {})
  ], 'resumeroast');
  assert.strictEqual(r.totalPeople, 3);
  assert.strictEqual(r.attributedPeople, 1);
  assert.strictEqual(r.unattributedPeople, 2);
});

test('sources are kept separate', () => {
  const r = computeSources([
    ev('u1', 'page_view', { utm_source: 'bluesky', utm_content: 'act_A' }),
    ev('u2', 'page_view', { utm_source: 'x', utm_content: 'act_B' }),
    ev('u3', 'page_view', { utm_source: 'x', utm_content: 'act_B' })
  ], 'resumeroast');
  assert.strictEqual(r.bySource.length, 2);
  assert.strictEqual(r.bySource.find(s => s.source === 'x').people, 2);
  assert.strictEqual(r.bySource.find(s => s.source === 'bluesky').people, 1);
});

test('byAction resolves each visitor to the originating action id', () => {
  const r = computeSources([
    ev('u1', 'page_view', { utm_source: 'bluesky', utm_content: 'act_reply_A' }),
    ev('u1', 'agent_run_completed', { utm_source: 'bluesky', utm_content: 'act_reply_A' }),
    ev('u2', 'page_view', { utm_source: 'bluesky', utm_content: 'act_reply_B' })
  ], 'resumeroast');
  const a = r.byAction.find(x => x.actionId === 'act_reply_A');
  assert.strictEqual(a.people, 1);
  assert.strictEqual(a.completed, 1);
  assert.strictEqual(r.byAction.find(x => x.actionId === 'act_reply_B').completed, 0);
});

test('a source that sent people but zero completions is visible as such', () => {
  // This is the distinction the report exists to make: real humans arrived and
  // bounced, which is a landing-page problem, not a distribution one.
  const r = computeSources([
    ev('u1', 'page_view', BSKY),
    ev('u2', 'page_view', BSKY)
  ], 'resumeroast');
  const s = r.bySource[0];
  assert.strictEqual(s.people, 2);
  assert.strictEqual(s.completed, 0);
});

test('events from other products are excluded', () => {
  const r = computeSources([
    ev('u1', 'page_view', BSKY, 'resumeroast'),
    ev('u2', 'page_view', BSKY, 'ambientscore')
  ], 'resumeroast');
  assert.strictEqual(r.totalPeople, 1);
});

test('utm_source with no utm_content still attributes', () => {
  const r = computeSources([ev('u1', 'page_view', { utm_source: 'bluesky' })], 'resumeroast');
  assert.strictEqual(r.attributedPeople, 1);
  assert.strictEqual(r.byAction[0].actionId, '(no action id)');
});

test('an empty window returns zeros rather than throwing', () => {
  const r = computeSources([], 'resumeroast');
  assert.strictEqual(r.totalPeople, 0);
  assert.strictEqual(r.bySource.length, 0);
  assert.strictEqual(r.byAction.length, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
