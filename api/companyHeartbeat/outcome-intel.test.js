// Run with: node api/companyHeartbeat/outcome-intel.test.js
// Tests the Phase 2.4 revenue-attribution helpers: action map (live + archived
// fallback), ledger attribution, and merge into the outcome digest.
const assert = require('assert');
const {
  buildActionAttributionMap,
  attributeRevenue,
  applyRevenueToOutcomeDigest,
  buildOutcomeDigest
} = require('./outcome-intel');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// ── buildActionAttributionMap ──
test('map: live action resolves agent + campaign via parent task', () => {
  const m = buildActionAttributionMap(
    [{ id: 'act1', created_by: 'echo', _parentTaskId: 't1' }],
    [{ id: 't1', campaign_id: 'camp-A' }],
    null
  );
  assert.deepStrictEqual(m.act1, { agent: 'echo', campaignId: 'camp-A' });
});
test('map: archived index used as fallback for actions no longer live', () => {
  const archived = { map: { actOld: { agent: 'scout', campaignId: 'camp-Z' } } };
  const m = buildActionAttributionMap([], [], archived);
  assert.deepStrictEqual(m.actOld, { agent: 'scout', campaignId: 'camp-Z' });
});
test('map: live action overrides archived index for same id', () => {
  const archived = { map: { act1: { agent: 'stale', campaignId: 'stale-camp' } } };
  const m = buildActionAttributionMap(
    [{ id: 'act1', created_by: 'echo', campaign_id: 'camp-A' }],
    [],
    archived
  );
  assert.deepStrictEqual(m.act1, { agent: 'echo', campaignId: 'camp-A' });
});
test('map: tolerates flat archived shape (no .map wrapper)', () => {
  const m = buildActionAttributionMap([], [], { actX: { agent: 'nova', campaignId: null } });
  assert.deepStrictEqual(m.actX, { agent: 'nova', campaignId: null });
});

// ── attributeRevenue ──
const ledger = [
  { id: 'e1', type: 'one_time', amountCents: 2900, utmContent: 'act1' },       // → echo / camp-A
  { id: 'e2', type: 'one_time', amountCents: 2900, utmContent: 'actOld' },     // → scout / camp-Z (archived)
  { id: 'e3', type: 'one_time', amountCents: 2900, utmContent: 'unknown' },    // unattributed (no map)
  { id: 'e4', type: 'one_time', amountCents: 2900, utmContent: null },         // unattributed (no utm)
  { id: 'e5', type: 'refund', amountCents: -2900, utmContent: 'act1' }         // ignored (not positive)
];
const attrMap = {
  act1: { agent: 'echo', campaignId: 'camp-A' },
  actOld: { agent: 'scout', campaignId: 'camp-Z' }
};

test('attribute: positive entries roll up per agent + campaign', () => {
  const r = attributeRevenue(ledger, attrMap);
  assert.strictEqual(r.byAgent.echo, 2900);
  assert.strictEqual(r.byAgent.scout, 2900);
  assert.strictEqual(r.byCampaign['camp-A'], 2900);
  assert.strictEqual(r.byCampaign['camp-Z'], 2900);
});
test('attribute: refund/dispute negatives are ignored', () => {
  const r = attributeRevenue(ledger, attrMap);
  assert.strictEqual(r.byAgent.echo, 2900, 'refund did not subtract from echo');
});
test('attribute: unmatched + utm-less entries counted unattributed', () => {
  const r = attributeRevenue(ledger, attrMap);
  assert.strictEqual(r.attributedCents, 5800, 'e1 + e2');
  assert.strictEqual(r.unattributedCents, 5800, 'e3 + e4');
});
test('attribute: decay scenario — purchase on archived action still attributes', () => {
  // act2 is NOT in live actions; only reachable via the archived index fallback.
  const map = buildActionAttributionMap([], [], { map: { act2: { agent: 'quill', campaignId: 'camp-Q' } } });
  const r = attributeRevenue([{ id: 'x', type: 'one_time', amountCents: 8900, utmContent: 'act2' }], map);
  assert.strictEqual(r.byAgent.quill, 8900);
  assert.strictEqual(r.byCampaign['camp-Q'], 8900);
  assert.strictEqual(r.unattributedCents, 0);
});

// ── applyRevenueToOutcomeDigest ──
test('apply: revenue attaches to existing perAgent + perCampaign entries', () => {
  const digest = {
    perAgent: { echo: { posts7d: 3, medianTotalEngagement: 10 } },
    perCampaign: [{ campaignId: 'camp-A', title: 'Camp A', totalEngagements: 40 }]
  };
  const attr = attributeRevenue(ledger, attrMap);
  applyRevenueToOutcomeDigest(digest, attr);
  assert.strictEqual(digest.perAgent.echo.revenueAttributedCents, 2900);
  assert.strictEqual(digest.perAgent.echo.posts7d, 3, 'engagement fields untouched');
  const campA = digest.perCampaign.find(c => c.campaignId === 'camp-A');
  assert.strictEqual(campA.revenueAttributedCents, 2900);
});
test('apply: revenue-only agent (no snapshots) gets a stub entry', () => {
  const digest = { perAgent: {}, perCampaign: [] };
  applyRevenueToOutcomeDigest(digest, { byAgent: { scout: 2900 }, byCampaign: {}, attributedCents: 2900, unattributedCents: 0 });
  assert.ok(digest.perAgent.scout, 'stub created');
  assert.strictEqual(digest.perAgent.scout.revenueAttributedCents, 2900);
  assert.strictEqual(digest.perAgent.scout.posts7d, 0);
});
test('apply: revenue-only campaign appended as a minimal row', () => {
  const digest = { perAgent: {}, perCampaign: [] };
  applyRevenueToOutcomeDigest(digest, { byAgent: {}, byCampaign: { 'camp-Z': 2900 }, attributedCents: 2900, unattributedCents: 0 });
  const cz = digest.perCampaign.find(c => c.campaignId === 'camp-Z');
  assert.ok(cz, 'campaign row appended');
  assert.strictEqual(cz.revenueAttributedCents, 2900);
});
test('apply: existing perAgent with no revenue gets explicit 0', () => {
  const digest = { perAgent: { pixel: { posts7d: 1 } }, perCampaign: [] };
  applyRevenueToOutcomeDigest(digest, { byAgent: {}, byCampaign: {}, attributedCents: 0, unattributedCents: 0 });
  assert.strictEqual(digest.perAgent.pixel.revenueAttributedCents, 0);
});
test('apply: revenueTotals summary attached', () => {
  const digest = { perAgent: {}, perCampaign: [] };
  const attr = attributeRevenue(ledger, attrMap);
  applyRevenueToOutcomeDigest(digest, attr);
  assert.strictEqual(digest.revenueTotals.attributedCents, 5800);
  assert.strictEqual(digest.revenueTotals.unattributedCents, 5800);
  assert.strictEqual(digest.revenueTotals.byAgentCents.echo, 2900);
});
test('apply: null digest is a no-op (fail-open)', () => {
  assert.strictEqual(applyRevenueToOutcomeDigest(null, {}), null);
});

// ── End-to-end through the real buildOutcomeDigest ──
test('e2e: build digest then thread revenue in', () => {
  const campaigns = [{ id: 'camp-A', title: 'Launch' }];
  const digest = buildOutcomeDigest({}, [], campaigns, [], Date.UTC(2026, 6, 3));
  assert.ok(Array.isArray(digest.perCampaign));
  const map = buildActionAttributionMap([{ id: 'act1', created_by: 'echo', _parentTaskId: 't1' }], [{ id: 't1', campaign_id: 'camp-A' }], null);
  const attr = attributeRevenue([{ id: 'e1', type: 'one_time', amountCents: 2900, utmContent: 'act1' }], map);
  applyRevenueToOutcomeDigest(digest, attr);
  const campA = digest.perCampaign.find(c => c.campaignId === 'camp-A');
  assert.strictEqual(campA.revenueAttributedCents, 2900);
  assert.strictEqual(digest.perAgent.echo.revenueAttributedCents, 2900, 'echo stub carries revenue');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
