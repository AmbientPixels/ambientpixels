// Run with: node api/productAnalyticsQuery/resumeroast-funnel.test.js
//
// The resumeroast funnel is load-bearing: a pre-committed kill gate reads it on
// 2026-09-07 and switches a channel off if the numbers are low. So an
// under-reporting funnel does not just look wrong, it makes a wrong decision.
// Two ways it under-reported before:
//
//   1. page_view was ONE step, but THREE pages init as 'resumeroast' — the
//      landing page, the shared run page, and the paid delivery page. Pooling
//      them inflates step 1, so every later step reads as a collapse that never
//      happened.
//   2. The purchase was emitted as product 'pixelagents' with no userId, and
//      computeFunnels counts distinct userIds — so sales counted as zero.

const assert = require('assert');

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

// Stub the analytics store the handler reads through.
const paPath = require.resolve('../_utils/productAnalytics');
let EVENTS = [];
const realPa = require('../_utils/productAnalytics');
require.cache[paPath].exports = Object.assign({}, realPa, {
  readEventRange: async () => EVENTS
});

delete require.cache[require.resolve('./index')];
const handler = require('./index');

function ev(event, userId, page, product) {
  return { product: product || 'resumeroast', event, userId, page: page || '', ts: new Date().toISOString() };
}

function ctx() {
  const c = { res: null };
  c.log = Object.assign(function () {}, { error: function () {}, warn: function () {} });
  return c;
}

// The cache is keyed on range+product+metric, so vary range per test to avoid
// one test reading another's cached result.
let rangeSeq = 0;
async function funnel(events) {
  EVENTS = events;
  const c = ctx();
  await handler(c, { method: 'GET', query: { product: 'resumeroast', metric: 'funnels', range: (++rangeSeq) + 'd' } });
  assert.strictEqual(c.res.status, 200, JSON.stringify(c.res.body));
  const steps = (c.res.body.data || c.res.body).resumeroast;
  assert.ok(Array.isArray(steps), 'no resumeroast funnel in ' + JSON.stringify(c.res.body));
  return steps.reduce((acc, s) => { acc[s.step] = s.users; return acc; }, {});
}

test('the full funnel reports every stage, purchase and delivery included', async () => {
  const f = await funnel([
    ev('page_view', 'anon1', '/resume-roast/'),
    ev('cta_click', 'anon1', '/resume-roast/'),
    ev('page_view', 'anon1', '/pixel-agents/run.html'),
    ev('agent_run_started', 'anon1', '/pixel-agents/run.html'),
    ev('agent_run_completed', 'anon1', '/pixel-agents/run.html'),
    ev('rewrite_upsell_view', 'anon1', '/pixel-agents/run.html'),
    ev('rewrite_upsell_click', 'anon1', '/pixel-agents/run.html'),
    ev('rewrite_purchase', 'rr_order_1', ''),               // server-side, keyed on orderId
    ev('rewrite_delivery_view', 'rr_order_1', '/resume-roast/rewrite.html'),
    ev('rewrite_delivered', 'rr_order_1', '/resume-roast/rewrite.html')
  ]);
  assert.deepStrictEqual(f, {
    landing_view: 1, cta_click: 1, run_page_view: 1,
    agent_run_started: 1, agent_run_completed: 1,
    rewrite_upsell_view: 1, rewrite_upsell_click: 1,
    rewrite_purchase: 1, rewrite_delivery_view: 1, rewrite_delivered: 1
  });
});

test('the three page_view sources do not pool into one inflated first step', async () => {
  // One visitor who lands, runs, and buys emits page_view on all three pages.
  // Unscoped, step 1 would read 3 and everything after would look like a cliff.
  const f = await funnel([
    ev('page_view', 'u1', '/resume-roast/'),
    ev('page_view', 'u1', '/pixel-agents/run.html'),
    ev('page_view', 'u1', '/resume-roast/rewrite.html')
  ]);
  assert.strictEqual(f.landing_view, 1, 'landing step pooled other pages');
  assert.strictEqual(f.run_page_view, 1, 'run page step wrong');
  // The delivery page_view must count toward NEITHER — it is post-purchase.
  assert.strictEqual(f.landing_view + f.run_page_view, 2);
});

test('a visitor who arrives straight on the run page is not lost', async () => {
  // Social/search traffic can deep-link past the landing page. That must show
  // up as a run, not vanish because they never saw /resume-roast.
  const f = await funnel([
    ev('page_view', 'deep', '/pixel-agents/run.html'),
    ev('agent_run_started', 'deep', '/pixel-agents/run.html')
  ]);
  assert.strictEqual(f.landing_view, 0);
  assert.strictEqual(f.run_page_view, 1);
  assert.strictEqual(f.agent_run_started, 1);
});

test('all three landing-path spellings count', async () => {
  const f = await funnel([
    ev('page_view', 'a', '/resume-roast'),
    ev('page_view', 'b', '/resume-roast/'),
    ev('page_view', 'c', '/resume-roast/index.html')
  ]);
  assert.strictEqual(f.landing_view, 3, 'a path spelling was dropped');
});

test('a purchase without a userId would vanish — the old bug', async () => {
  // computeFunnels counts DISTINCT userIds, so an unattributed purchase is
  // invisible. This asserts the shape that used to be emitted still reads zero,
  // which is exactly why as-webhook now sends userId.
  const f = await funnel([{ product: 'resumeroast', event: 'rewrite_purchase', page: '', ts: new Date().toISOString() }]);
  assert.strictEqual(f.rewrite_purchase, 0);
});

test('a purchase still filed under pixelagents does not reach this funnel', async () => {
  const f = await funnel([ev('rewrite_purchase', 'rr_1', '', 'pixelagents')]);
  assert.strictEqual(f.rewrite_purchase, 0, 'cross-product leak');
});

test('purchase and delivery share an identity, so the step compares like for like', async () => {
  // as-webhook uses orderId as userId; rewrite.html calls identify(orderId).
  // If those ever diverge, paid -> delivered silently reads 0% and looks like a
  // delivery outage.
  const f = await funnel([
    ev('rewrite_purchase', 'rr_order_9', ''),
    ev('rewrite_delivered', 'rr_order_9', '/resume-roast/rewrite.html')
  ]);
  assert.strictEqual(f.rewrite_purchase, 1);
  assert.strictEqual(f.rewrite_delivered, 1);
});

test('distinct users are counted once each, repeats do not inflate', async () => {
  const f = await funnel([
    ev('agent_run_started', 'u1', '/pixel-agents/run.html'),
    ev('agent_run_started', 'u1', '/pixel-agents/run.html'),
    ev('agent_run_started', 'u2', '/pixel-agents/run.html')
  ]);
  assert.strictEqual(f.agent_run_started, 2);
});

test('metric=funnel (singular) works — the kill gate documents that spelling', async () => {
  EVENTS = [ev('agent_run_started', 'u1', '/pixel-agents/run.html')];
  const c = ctx();
  await handler(c, { method: 'GET', query: { product: 'resumeroast', metric: 'funnel', range: (++rangeSeq) + 'd' } });
  assert.strictEqual(c.res.status, 200, 'singular spelling 400d: ' + JSON.stringify(c.res.body));
  assert.ok((c.res.body.data || c.res.body).resumeroast, 'no funnel returned for metric=funnel');
});

test('other products keep plain string steps working', async () => {
  EVENTS = [
    { product: 'ambientscore', event: 'page_view', userId: 'x', page: '/ambientscore/', ts: new Date().toISOString() },
    { product: 'ambientscore', event: 'scan_started', userId: 'x', page: '/ambientscore/', ts: new Date().toISOString() }
  ];
  const c = ctx();
  await handler(c, { method: 'GET', query: { product: 'ambientscore', metric: 'funnels', range: (++rangeSeq) + 'd' } });
  assert.strictEqual(c.res.status, 200);
  const f = (c.res.body.data || c.res.body).ambientscore.reduce((a, s) => { a[s.step] = s.users; return a; }, {});
  assert.strictEqual(f.page_view, 1);
  assert.strictEqual(f.scan_started, 1);
  assert.strictEqual(f.scan_completed, 0);
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  PASS ', name); }
    catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
