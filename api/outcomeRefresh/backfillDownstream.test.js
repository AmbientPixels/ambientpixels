// Run with: node api/outcomeRefresh/backfillDownstream.test.js
const assert = require('assert');
const backfill = require('./index')._backfillDownstream;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const REPLY_ID = 'act_1785499344777_bsreply_my8ao';
const POST_ID = 'act_1785477821876_9pxbwm';

function store() {
  return {
    a: { actionId: REPLY_ID },
    b: { actionId: POST_ID }
  };
}
// ProductAnalytics events as they arrive from the ingest: attribution lives in props.
const ev = (event, utm) => ({ event: event, props: utm ? { utm_content: utm } : {} });

test('report views attribute to the reply action that produced the click', () => {
  // This is the whole point: a prospect clicking a reply link is now visible.
  const s = store();
  backfill(s, [], [], [ev('paywall_shown', REPLY_ID), ev('paywall_shown', REPLY_ID)]);
  assert.strictEqual(s.a.downstream.reportViews, 2);
  assert.strictEqual(s.b.downstream.reportViews, 0, 'must not leak to other actions');
});

test('funnel stages are counted separately — clicked-and-bounced vs nearly-bought', () => {
  const s = store();
  backfill(s, [], [], [
    ev('paywall_shown', REPLY_ID),
    ev('checkout_started', REPLY_ID),
    ev('report_unlocked', REPLY_ID)
  ]);
  assert.strictEqual(s.a.downstream.reportViews, 1);
  assert.strictEqual(s.a.downstream.checkoutStarted, 1);
  assert.strictEqual(s.a.downstream.reportUnlocked, 1);
});

test('events with no utm_content are ignored, not mis-attributed', () => {
  const s = store();
  backfill(s, [], [], [ev('paywall_shown', null), ev('paywall_shown', '')]);
  assert.strictEqual(s.a.downstream.reportViews, 0);
  assert.strictEqual(s.b.downstream.reportViews, 0);
});

test('unrelated event names do not inflate the counts', () => {
  const s = store();
  backfill(s, [], [], [ev('some_other_event', REPLY_ID)]);
  assert.strictEqual(s.a.downstream.reportViews, 0);
  assert.strictEqual(s.a.downstream.checkoutStarted, 0);
});

test('the existing blogViews and formSubmits behaviour is unchanged', () => {
  const s = store();
  backfill(
    s,
    [{ utmContent: POST_ID }, { utmContent: POST_ID }],
    [{ utm: { content: POST_ID }, type: 'strategy' }],
    []
  );
  assert.strictEqual(s.b.downstream.blogViews, 2);
  assert.strictEqual(s.b.downstream.formSubmits, 1);
  assert.deepStrictEqual(s.b.downstream.submissionTypes, { strategy: 1 });
});

test('omitting the analytics argument entirely is safe (old call signature)', () => {
  const s = store();
  backfill(s, [], []);
  assert.strictEqual(s.a.downstream.reportViews, 0);
  assert.strictEqual(s.a.downstream.blogViews, 0);
});

test('a snapshot with no matching events still gets a well-formed downstream block', () => {
  const s = store();
  backfill(s, [], [], []);
  assert.deepStrictEqual(s.a.downstream, {
    blogViews: 0, formSubmits: 0, submissionTypes: {},
    reportViews: 0, checkoutStarted: 0, reportUnlocked: 0, emailCaptured: 0
  });
});

test('garbage events do not throw', () => {
  const s = store();
  backfill(s, null, null, [null, undefined, {}, { props: null }]);
  assert.strictEqual(s.a.downstream.reportViews, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
