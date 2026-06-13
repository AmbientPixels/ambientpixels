// test-revenue-attribution.cjs — revenue→campaign attribution (Gap 2, 2026-06-13).
//
// A purchase that originated from a campaign post link carries utm_content (= the
// post's action id) through Stripe checkout metadata into the ledger. The heartbeat
// maps action id → campaign id and rolls revenue up per campaign so Cipher's ROI
// reads real dollars, not just an engagement proxy.
//
// Pure pieces tested here (no API key, no network):
//   L1 revenueLedger.recordRevenue          — persists utmContent / utmSource
//   L2 recordWebhookRevenue.recordCheckout… — reads session.metadata.utm_* → entry
//   L3 revenue-intel.buildRevenueDigest      — byCampaign rollup via action→campaign map
//   L4 finance-intel.applyCampaignRevenue    — overlays real $ onto campaignROI rows
//
// Run: node scripts/test-revenue-attribution.cjs   (exit 0 = all pass)

const path = require('path');
const P = (...p) => path.join(__dirname, '..', 'api', ...p);
const ledgerLib = require(P('_lib', 'stripe', 'revenueLedger.js'));
const recorder  = require(P('_lib', 'stripe', 'recordWebhookRevenue.js'));
const revIntel  = require(P('companyHeartbeat', 'revenue-intel.js'));
const finIntel  = require(P('companyHeartbeat', 'finance-intel.js'));

// in-memory storage double for the ledger
function fakeStorage() {
  let state = {};
  return {
    getState: async (k) => state[k] || null,
    setState: async (k, v) => { state[k] = v; return true; },
    _dump: () => state
  };
}

let pass = 0, fail = 0;
function check(name, fn) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r === true; if (!ok) detail = JSON.stringify(r); }
  catch (e) { ok = false; detail = 'threw: ' + (e && e.message ? e.message : e); }
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}
async function acheck(name, fn) {
  let ok = false, detail = '';
  try { const r = await fn(); ok = r === true; if (!ok) detail = JSON.stringify(r); }
  catch (e) { ok = false; detail = 'threw: ' + (e && e.message ? e.message : e); }
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  console.log('\n== L1 recordRevenue persists utm attribution ==');
  {
    const s = fakeStorage();
    const r = await ledgerLib.recordRevenue({
      id: 'evt_1', product: 'ambientscore', type: 'one_time', amountCents: 2900,
      utmContent: 'act_A', utmSource: 'x'
    }, s);
    await acheck('recordRevenue returns recorded', async () => r.recorded === true);
    const e = (await ledgerLib.getLedger(s)).entries[0];
    check('entry persists utmContent', () => e.utmContent === 'act_A');
    check('entry persists utmSource', () => e.utmSource === 'x');
    const s2 = fakeStorage();
    await ledgerLib.recordRevenue({ id: 'evt_2', product: 'cardforge', type: 'subscription_initial', amountCents: 499 }, s2);
    const e2 = (await ledgerLib.getLedger(s2)).entries[0];
    check('utmContent defaults null when absent', () => e2.utmContent === null);
  }

  console.log('\n== L2 webhook recorder reads session.metadata.utm_* ==');
  {
    const s = fakeStorage();
    await recorder.recordCheckoutRevenue({
      event: { id: 'evt_co', created: 1781300000 },
      session: { amount_total: 2900, currency: 'usd', id: 'cs_1',
        metadata: { reportId: 'r1', priceType: 'single', utm_content: 'act_Z', utm_source: 'bluesky' } },
      product: 'ambientscore', type: 'one_time', storageOverride: s
    });
    const e = (await ledgerLib.getLedger(s)).entries[0];
    check('checkout entry carries utmContent from metadata', () => e.utmContent === 'act_Z');
    check('checkout entry carries utmSource from metadata', () => e.utmSource === 'bluesky');
  }

  console.log('\n== L3 buildRevenueDigest byCampaign rollup ==');
  {
    const ledger = { entries: [
      { id: 'e1', product: 'ambientscore', type: 'one_time', amountCents: 2900, customerId: 'cus_1', utmContent: 'act_A', occurredAt: '2026-06-05T00:00:00Z' },
      { id: 'e2', product: 'cardforge', type: 'subscription_initial', interval: 'month', amountCents: 499, customerId: 'cus_2', utmContent: 'act_B', subscriptionId: 'sub_2', occurredAt: '2026-06-06T00:00:00Z' },
      { id: 'e3', product: 'ambientscore', type: 'one_time', amountCents: 2900, customerId: 'cus_3', utmContent: 'act_A', occurredAt: '2026-06-07T00:00:00Z' },
      { id: 'e4', product: 'ambientscore', type: 'one_time', amountCents: 2900, customerId: 'cus_4', occurredAt: '2026-06-08T00:00:00Z' } // no utm
    ]};
    const actionToCampaign = { act_A: 'camp_1', act_B: 'camp_2' };
    const now = Date.parse('2026-06-13T00:00:00Z');
    const d = revIntel.buildRevenueDigest(ledger, 0, now, actionToCampaign);
    check('byCampaign exists', () => !!d.byCampaign);
    check('camp_1 sums both act_A purchases', () => d.byCampaign.camp_1 && d.byCampaign.camp_1.netCents === 5800);
    check('camp_1 counts 2 distinct customers', () => d.byCampaign.camp_1.customers === 2);
    check('camp_2 from act_B', () => d.byCampaign.camp_2 && d.byCampaign.camp_2.netCents === 499);
    check('unattributed revenue tracked (e4)', () => d.unattributedRevenueCents === 2900);
    check('attributed total = 6299', () => d.attributedRevenueCents === 6299);
  }

  console.log('\n== L4 applyCampaignRevenue overlays real $ on ROI rows ==');
  {
    const roi = [
      { id: 'camp_1', title: 'C1', estimatedCost: 0.50, engagement: 100, signal: 'NEUTRAL', source: 'task-proxy' },
      { id: 'camp_x', title: 'Cx', estimatedCost: 0.50, engagement: 80, signal: 'NEUTRAL', source: 'task-proxy' }
    ];
    const byCampaign = { camp_1: { netCents: 5800, grossCents: 5800, count: 2, customers: 2 } };
    let out = null; try { out = finIntel.applyCampaignRevenue(roi, byCampaign); } catch (_e) { out = null; }
    const c1 = (out || []).find(r => r.id === 'camp_1') || {};
    const cx = (out || []).find(r => r.id === 'camp_x') || {};
    check('camp_1 gets revenueCents', () => c1.revenueCents === 5800);
    check('camp_1 source = actual-revenue', () => c1.source === 'actual-revenue');
    check('camp_1 signal POSITIVE (real revenue)', () => c1.signal === 'POSITIVE');
    check('camp_1 revenuePerDollar = 116 (58/0.50)', () => c1.revenuePerDollar === 116);
    check('camp_x (no revenue) unchanged', () => cx.source === 'task-proxy' && cx.revenueCents === undefined);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail === 0 ? 0 : 1);
})();
