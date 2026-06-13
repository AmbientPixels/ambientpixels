'use strict';

/**
 * revenue-intel.js — the income half of the company's financial picture.
 *
 * PURE module (zero requires) — mirrors strategy-intel.js discipline so it is
 * fully offline-testable. Reads the revenueLedger (built by Stripe webhooks via
 * _lib/stripe/revenueLedger.js) and produces a digest consumed by:
 *   - finance-intel.js  (Cipher sees income vs spend, net burn)
 *   - world-state-intel.js (all agents see revenue / MRR / paying customers)
 *   - strategy-intel.js (paying_customers north-star auto-resolves)
 *   - /api/revenueDigest (CEO dashboard)
 *
 * MRR is derived from the ledger itself: subscription_initial creates an active
 * sub, subscription_canceled removes it. This is robust to the missing
 * invoice.payment_succeeded renewal webhooks AND avoids any Stripe API call or
 * entitlements-blob enumeration in the hourly heartbeat.
 */

var POSITIVE_TYPES = ['one_time', 'subscription_initial', 'subscription_renewal'];

function _isPositiveType(t) { return POSITIVE_TYPES.indexOf(t) !== -1; }

function _monthPrefix(ms) {
  return new Date(ms).toISOString().substring(0, 7); // 'YYYY-MM' (UTC)
}

function _priorMonthPrefix(ms) {
  var d = new Date(ms);
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth(); // 0-11
  var pm = m - 1;
  var py = y;
  if (pm < 0) { pm = 11; py -= 1; }
  return py + '-' + String(pm + 1).padStart(2, '0');
}

function _entryMonth(e) {
  return (e && typeof e.occurredAt === 'string') ? e.occurredAt.substring(0, 7) : '';
}

// Monthly-normalized contribution of a subscription's recorded amount.
function _monthlyNormalized(e) {
  var amt = Number(e && e.amountCents) || 0;
  if (e && e.interval === 'year') return Math.round(amt / 12);
  return amt; // 'month' or unknown -> treat as monthly
}

function _round2(n) { return Math.round(n * 100) / 100; }

/**
 * @param {object} ledger    { entries: [...] } from revenueLedger
 * @param {number} spendCents month-to-date LLM spend in CENTS (from financeDigest.budget.monthly.actual * 100)
 * @param {number} nowMs
 * @returns {object} revenueDigest (cents canonical; a few *Dollars convenience fields)
 */
function buildRevenueDigest(ledger, spendCents, nowMs, actionToCampaign) {
  var now = (typeof nowMs === 'number') ? nowMs : Date.now();
  var entries = (ledger && Array.isArray(ledger.entries)) ? ledger.entries : [];
  var monthPrefix = _monthPrefix(now);
  var priorPrefix = _priorMonthPrefix(now);
  var spend = Number.isFinite(spendCents) ? Math.round(spendCents) : 0;
  // Gap 2: map a purchase's utmContent (originating post action id) to its campaign id.
  var a2c = actionToCampaign || {};

  var mtdNetCents = 0;        // signed, this month
  var mtdGrossCents = 0;      // positive money only, this month
  var mtdOneTimeCents = 0;
  var mtdRecurringCents = 0;
  var priorNetCents = 0;
  var lifetimeNetCents = 0;
  var lifetimeGrossCents = 0;

  var byProduct = {};        // product -> { netCents, grossCents, count }
  var byCustomerNet = {};    // customerKey -> net lifetime cents
  var canceledSubs = {};     // subscriptionId -> true
  var subInitials = [];      // subscription_initial entries (for active-set)
  var byCampaign = {};       // campaignId -> { netCents, grossCents, count, customers, _custSet }
  var attributedRevenueCents = 0;
  var unattributedRevenueCents = 0;

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i] || {};
    var amt = Number(e.amountCents) || 0;
    var mo = _entryMonth(e);
    var positive = _isPositiveType(e.type) && amt > 0;

    lifetimeNetCents += amt;
    if (positive) lifetimeGrossCents += amt;

    // by product (lifetime)
    var pkey = e.product || 'unknown';
    if (!byProduct[pkey]) byProduct[pkey] = { netCents: 0, grossCents: 0, count: 0 };
    byProduct[pkey].netCents += amt;
    if (positive) { byProduct[pkey].grossCents += amt; byProduct[pkey].count += 1; }

    // by customer (lifetime net) — distinct key prefers Stripe customer id
    var ckey = e.customerId || e.customerEmail || ('entry:' + e.id);
    byCustomerNet[ckey] = (byCustomerNet[ckey] || 0) + amt;

    // month buckets
    if (mo === monthPrefix) {
      mtdNetCents += amt;
      if (positive) {
        mtdGrossCents += amt;
        if (e.type === 'one_time') mtdOneTimeCents += amt;
        else mtdRecurringCents += amt; // subscription_initial | subscription_renewal
      }
    } else if (mo === priorPrefix) {
      priorNetCents += amt;
    }

    // subscription tracking
    if (e.type === 'subscription_canceled' && e.subscriptionId) {
      canceledSubs[e.subscriptionId] = true;
    } else if (e.type === 'subscription_initial') {
      subInitials.push(e);
    }

    // campaign attribution: resolve utmContent (post action id) -> campaign id
    var campId = e.utmContent ? a2c[e.utmContent] : null;
    if (campId) {
      if (!byCampaign[campId]) byCampaign[campId] = { netCents: 0, grossCents: 0, count: 0, customers: 0, _custSet: {} };
      var bc = byCampaign[campId];
      bc.netCents += amt;
      if (positive) {
        bc.grossCents += amt;
        bc.count += 1;
        if (!bc._custSet[ckey]) { bc._custSet[ckey] = true; bc.customers += 1; }
      }
      attributedRevenueCents += amt;
    } else if (amt !== 0) {
      unattributedRevenueCents += amt;
    }
  }
  Object.keys(byCampaign).forEach(function (k) { delete byCampaign[k]._custSet; });

  // Active subscription set: first initial per subscription, not later canceled.
  var seenSub = {};
  var activeSubs = [];
  for (var j = 0; j < subInitials.length; j++) {
    var s = subInitials[j];
    var skey = s.subscriptionId || ('init:' + s.id);
    if (seenSub[skey]) continue;
    seenSub[skey] = true;
    if (s.subscriptionId && canceledSubs[s.subscriptionId]) continue; // canceled
    activeSubs.push(s);
  }
  var mrrCents = 0;
  for (var k = 0; k < activeSubs.length; k++) mrrCents += _monthlyNormalized(activeSubs[k]);

  // Paying customers (LIFETIME distinct, non-refunded == net > 0).
  var payingCustomers = 0;
  var custKeys = Object.keys(byCustomerNet);
  for (var c = 0; c < custKeys.length; c++) {
    if (byCustomerNet[custKeys[c]] > 0) payingCustomers += 1;
  }

  // Net (this month): revenue earned minus LLM spend.
  var netCents = mtdNetCents - spend;

  // Trend vs prior month.
  var trendDeltaPct = null;
  var trendDirection = 'flat';
  if (priorNetCents > 0) {
    trendDeltaPct = Math.round(((mtdNetCents - priorNetCents) / priorNetCents) * 100);
    trendDirection = trendDeltaPct > 2 ? 'rising' : (trendDeltaPct < -2 ? 'falling' : 'flat');
  } else if (mtdNetCents > 0) {
    trendDirection = 'rising'; // first revenue
  }

  return {
    generatedAt: new Date(now).toISOString(),
    month: monthPrefix,
    // canonical cents
    mtdRevenueCents: mtdNetCents,
    mtdGrossCents: mtdGrossCents,
    oneTimeVsRecurring: { oneTimeCents: mtdOneTimeCents, recurringCents: mtdRecurringCents },
    mrrCents: mrrCents,
    activeSubs: activeSubs.length,
    payingCustomers: payingCustomers,
    netCents: netCents,
    spendCents: spend,
    lifetimeRevenueCents: lifetimeNetCents,
    lifetimeGrossCents: lifetimeGrossCents,
    byProduct: byProduct,
    byCampaign: byCampaign,
    attributedRevenueCents: attributedRevenueCents,
    unattributedRevenueCents: unattributedRevenueCents,
    priorMonthRevenueCents: priorNetCents,
    trend: { deltaPct: trendDeltaPct, direction: trendDirection },
    totalEntries: entries.length,
    // dollar convenience (for dashboards/world-state)
    mtdRevenueDollars: _round2(mtdNetCents / 100),
    mrrDollars: _round2(mrrCents / 100),
    netDollars: _round2(netCents / 100),
    lifetimeRevenueDollars: _round2(lifetimeNetCents / 100)
  };
}

function _fmt(cents) { return '$' + (Math.round(cents) / 100).toFixed(2); }

/**
 * Cipher-facing REVENUE prompt block. Terse. Appended to the finance block.
 * Returns '' when there is no revenue digest.
 */
function _buildRevenuePromptBlock(digest) {
  if (!digest) return '';
  var lines = [];
  lines.push('\nREVENUE (this month):');
  lines.push('- MTD income: ' + _fmt(digest.mtdRevenueCents) + ' (gross ' + _fmt(digest.mtdGrossCents) +
    ') | one-time ' + _fmt(digest.oneTimeVsRecurring.oneTimeCents) + ' · recurring ' + _fmt(digest.oneTimeVsRecurring.recurringCents));
  lines.push('- MRR: ' + _fmt(digest.mrrCents) + ' (' + digest.activeSubs + ' active sub' + (digest.activeSubs === 1 ? '' : 's') + ')');
  lines.push('- Paying customers (lifetime): ' + digest.payingCustomers);
  lines.push('- Net (income − LLM spend): ' + _fmt(digest.netCents) + (digest.netCents >= 0 ? ' (profitable this month)' : ' (burning)'));
  if (digest.trend && digest.trend.deltaPct !== null) {
    lines.push('- Trend vs last month: ' + (digest.trend.deltaPct >= 0 ? '+' : '') + digest.trend.deltaPct + '%');
  }
  return lines.join('\n');
}

module.exports = {
  buildRevenueDigest: buildRevenueDigest,
  _buildRevenuePromptBlock: _buildRevenuePromptBlock,
  POSITIVE_TYPES: POSITIVE_TYPES
};
