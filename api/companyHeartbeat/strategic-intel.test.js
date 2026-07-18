// Run with: node api/companyHeartbeat/strategic-intel.test.js
const assert = require('assert');
const {
  _verdict, MIN_TRAFFIC_VOLUME, buildStrategicDigest,
  _pageViewsByProduct, _usageDeltaFromSnapshots, _appendUsageSnapshot
} = require('./strategic-intel');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// args: (trafficDeltaPct, usageDeltaPct, hasTrafficSignal, hasUsageSignal, trafficVolume)

test('low-volume traffic drop is DORMANT, not DECLINING (the AmbientScore bug)', () => {
  // 3 → 0 views = -100% but only 3 combined views — noise, not a trend.
  assert.strictEqual(_verdict(-100, 0, true, false, 3), 'DORMANT');
  // 10 → 1 (AmbientOS): 11 combined still under the floor.
  assert.strictEqual(_verdict(-90, 0, true, false, 11), 'DORMANT');
});
test('truly zero traffic both weeks is still NO DATA', () => {
  assert.strictEqual(_verdict(0, 0, false, false, 0), 'NO DATA');
});
test('a real-volume decline IS DECLINING', () => {
  assert.strictEqual(_verdict(-50, 0, true, false, 40), 'DECLINING');
});
test('a real-volume rise IS GROWING', () => {
  assert.strictEqual(_verdict(50, 0, true, false, 40), 'GROWING');
});
test('real-volume flat traffic is STABLE', () => {
  assert.strictEqual(_verdict(0, 0, true, false, 40), 'STABLE');
});
test('a usage signal drives the verdict even when traffic is below the floor', () => {
  // tiny blog traffic but real usage decline → DECLINING from usage, not noise.
  assert.strictEqual(_verdict(-100, -50, true, true, 3), 'DECLINING');
  assert.strictEqual(_verdict(-100, 30, true, true, 3), 'GROWING');
});
test('floor constant is exported and sane', () => {
  assert.ok(MIN_TRAFFIC_VOLUME >= 10, 'floor should be a meaningful minimum');
});

// ── _pageViewsByProduct ──

test('pageViews: maps path prefixes to products and sums views', () => {
  const out = _pageViewsByProduct([
    { path: '/cardforge/gallery.html', views: 12 },
    { path: '/cardforge/editor.html', views: 8 },
    { path: '/blindspot/', views: 5 },
    { path: '/', views: 100 },            // root — no product
    { path: '/blog/some-post', views: 30 } // non-product page ignored
  ]);
  assert.strictEqual(out.CardForge, 20);
  assert.strictEqual(out.Blindspot, 5);
  assert.strictEqual(out.AmbientScore, 0);
});

test('pageViews: strips full-URL origins (App Insights cleanUrl shape)', () => {
  const out = _pageViewsByProduct([
    { path: 'https://ambientpixels.ai/storyforge/play.html', views: 7 },
    { path: 'https://www.ambientpixels.ai/ambientscore', views: 3 }
  ]);
  assert.strictEqual(out.StoryForge, 7);
  assert.strictEqual(out.AmbientScore, 3);
});

test('pageViews: agent-forge and pixel-agents both map to PixelAgents; ambientos does not swallow ambientscore', () => {
  const out = _pageViewsByProduct([
    { path: '/pixel-agents/catalog', views: 4 },
    { path: '/agent-forge/build', views: 6 },
    { path: '/ambientscore/report', views: 9 },
    { path: '/ambientos/agents/', views: 2 }
  ]);
  assert.strictEqual(out.PixelAgents, 10);
  assert.strictEqual(out.AmbientScore, 9);
  assert.strictEqual(out.AmbientOS, 2);
});

test('pageViews: garbage input yields zeroed map', () => {
  const out = _pageViewsByProduct(null);
  assert.strictEqual(out.CardForge, 0);
});

// ── _usageDeltaFromSnapshots ──

const DAY = 86400000;
const NOW = Date.parse('2026-07-18T00:00:00Z');

test('usageDelta: compares against the snapshot ~7d back', () => {
  const snaps = [{ at: new Date(NOW - 7 * DAY).toISOString(), perProduct: { AmbientScore: 10 } }];
  assert.strictEqual(_usageDeltaFromSnapshots(snaps, 'AmbientScore', 15, NOW), 50);
  assert.strictEqual(_usageDeltaFromSnapshots(snaps, 'AmbientScore', 5, NOW), -50);
});

test('usageDelta: no baseline in the 6-9d window → 0 (never invents a trend)', () => {
  const tooRecent = [{ at: new Date(NOW - 2 * DAY).toISOString(), perProduct: { AmbientScore: 10 } }];
  const tooOld = [{ at: new Date(NOW - 12 * DAY).toISOString(), perProduct: { AmbientScore: 10 } }];
  assert.strictEqual(_usageDeltaFromSnapshots(tooRecent, 'AmbientScore', 20, NOW), 0);
  assert.strictEqual(_usageDeltaFromSnapshots(tooOld, 'AmbientScore', 20, NOW), 0);
  assert.strictEqual(_usageDeltaFromSnapshots([], 'AmbientScore', 20, NOW), 0);
});

test('usageDelta: zero-baseline growth reads +100, null current reads 0', () => {
  const snaps = [{ at: new Date(NOW - 7 * DAY).toISOString(), perProduct: { Blindspot: 0 } }];
  assert.strictEqual(_usageDeltaFromSnapshots(snaps, 'Blindspot', 4, NOW), 100);
  assert.strictEqual(_usageDeltaFromSnapshots(snaps, 'Blindspot', null, NOW), 0);
});

// ── _appendUsageSnapshot ──

test('snapshot ring: appends once per day and caps at 15', () => {
  const perProduct = [{ product: 'CardForge', usage: { signal: 9 } }, { product: 'Blindspot', usage: { signal: null } }];
  let ring = _appendUsageSnapshot([], perProduct, NOW);
  assert.strictEqual(ring.length, 1);
  assert.strictEqual(ring[0].perProduct.CardForge, 9);
  assert.ok(!('Blindspot' in ring[0].perProduct)); // null signals not recorded
  // same-day second call: no duplicate
  ring = _appendUsageSnapshot(ring, perProduct, NOW + 3600000);
  assert.strictEqual(ring.length, 1);
  // 20 prior days → capped at 15
  const old = [];
  for (let i = 20; i > 0; i--) old.push({ at: new Date(NOW - i * DAY).toISOString(), perProduct: { CardForge: i } });
  ring = _appendUsageSnapshot(old, perProduct, NOW);
  assert.strictEqual(ring.length, 15);
});

// ── integration: real page traffic lights up verdicts ──

test('digest: product with page views but no usage feed is no longer NO DATA', () => {
  const digest = buildStrategicDigest({
    campaigns: [], actions: [], researchIntelStore: [], blogPostViews: [], blogPosts: [],
    engagementSnapshots: [], costIntel: null, productFacts: { products: {} },
    siteTopPages: [{ path: '/blindspot/arena', views: 25 }]
  }, null, NOW);
  const bs = digest.perProduct.find(p => p.product === 'Blindspot');
  assert.strictEqual(bs.usage.signal, 25);
  assert.strictEqual(bs.usage.hasData, true);
  assert.notStrictEqual(bs.verdict, 'NO DATA');
  assert.strictEqual(bs.traffic.pageViews7d, 25);
  assert.ok(Array.isArray(digest.usageSnapshots) && digest.usageSnapshots.length === 1);
});

test('digest: usage feed (scans) beats page-view fallback and flows to verdict', () => {
  const digest = buildStrategicDigest({
    campaigns: [], actions: [], researchIntelStore: [], blogPostViews: [], blogPosts: [],
    engagementSnapshots: [], productFacts: { products: {} },
    costIntel: { productUsage: { ambientScore: { totalScans: 65, scans7d: 9, paid7d: 0 } } },
    siteTopPages: []
  }, null, NOW);
  const as = digest.perProduct.find(p => p.product === 'AmbientScore');
  assert.strictEqual(as.usage.signal, 9);
  assert.notStrictEqual(as.verdict, 'NO DATA');
});

test('digest: WoW usage decline via carried snapshots turns DECLINING', () => {
  const prior = {
    asOfUtc: new Date(NOW - 7 * DAY).toISOString(),
    usageSnapshots: [{ at: new Date(NOW - 7 * DAY).toISOString(), perProduct: { AmbientScore: 40 } }]
  };
  const digest = buildStrategicDigest({
    campaigns: [], actions: [], researchIntelStore: [], blogPostViews: [], blogPosts: [],
    engagementSnapshots: [], productFacts: { products: {} },
    costIntel: { productUsage: { ambientScore: { totalScans: 65, scans7d: 9, paid7d: 0 } } },
    siteTopPages: []
  }, prior, NOW);
  const as = digest.perProduct.find(p => p.product === 'AmbientScore');
  assert.strictEqual(as.verdict, 'DECLINING'); // 40 → 9 = -78%
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
