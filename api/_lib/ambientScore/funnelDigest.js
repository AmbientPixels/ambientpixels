'use strict';

/**
 * AmbientScore funnel digest — the read-model for the scan -> lead -> sale funnel.
 *
 * Pure function: takes the three raw sources and a timestamp, returns a digest.
 * No storage, no network, no clock (nowMs is injected) so it is trivially testable.
 *
 * Sources (all written elsewhere; this module only reads what it is handed):
 *  - scans   cc_analytics array. Per-entry: { reportId, url, tier, score, timestamp, requestedBy? }.
 *            tier ∈ { 'free', 'agent', 'paid-single', 'paid-pack' }.
 *            NOTE: 'paid-*' is logged when a Stripe checkout is CREATED, not when it is paid,
 *            and only for checkouts with no prior free scan — so it is a PARTIAL intent signal,
 *            never a revenue signal. Real money comes from the ledger below.
 *  - leads   as_leads array. Per-entry: { email, reportId, url, score, utmContent, utmSource, source, ts }.
 *  - ledger  revenueLedger { entries: [...] } from _lib/stripe/revenueLedger. Real Stripe money.
 *            Positive types: one_time / subscription_initial / subscription_renewal.
 *
 * "Public scans" = human-initiated (tier !== 'agent'). "Agent scans" = Scout outbound prospecting.
 * The conversion funnel is built on PUBLIC scans, because that is real inbound demand.
 */

// Single definition of "is this our own money" — see revenueLedger.isInternalEntry.
const _isInternalEntry = require('../stripe/revenueLedger').isInternalEntry;

const POSITIVE_TYPES = ['one_time', 'subscription_initial', 'subscription_renewal'];

function _toMs(v) {
  if (!v) return NaN;
  var t = Date.parse(v);
  return Number.isNaN(t) ? NaN : t;
}

function _dayKey(ms) {
  return new Date(ms).toISOString().substring(0, 10);
}

function _round(n, dp) {
  var f = Math.pow(10, dp || 0);
  return Math.round(n * f) / f;
}

function _pct(num, den) {
  if (!den) return null;
  return _round((num / den) * 100, 1);
}

/**
 * @param {object} input
 * @param {Array}  input.scans   cc_analytics array (or null)
 * @param {Array}  input.leads   as_leads array (or null)
 * @param {object} input.ledger  { entries: [] } (or null)
 * @param {number} input.nowMs   reference "now" in ms
 * @returns {object} funnel digest
 */
function buildFunnelDigest(input) {
  var scans = Array.isArray(input && input.scans) ? input.scans : [];
  var leads = Array.isArray(input && input.leads) ? input.leads : [];
  var ledger = (input && input.ledger && Array.isArray(input.ledger.entries)) ? input.ledger : { entries: [] };
  var nowMs = (input && Number.isFinite(input.nowMs)) ? input.nowMs : Date.now();

  var d7 = nowMs - 7 * 86400000;
  var d30 = nowMs - 30 * 86400000;

  // ── Scans ────────────────────────────────────────────────────────────
  var isAgent = function (e) { return e && e.tier === 'agent'; };
  var scanMs = function (e) { return _toMs(e && e.timestamp); };

  var publicScans = scans.filter(function (e) { return e && !isAgent(e); });
  var agentScans = scans.filter(isAgent);

  var count7 = function (arr) { return arr.filter(function (e) { var m = scanMs(e); return m >= d7; }).length; };
  var count30 = function (arr) { return arr.filter(function (e) { var m = scanMs(e); return m >= d30; }).length; };

  // Daily series (public scans, last 30 days, ascending)
  var dailyMap = {};
  for (var i = 0; i < 30; i++) {
    dailyMap[_dayKey(nowMs - i * 86400000)] = 0;
  }
  publicScans.forEach(function (e) {
    var m = scanMs(e);
    if (Number.isNaN(m) || m < d30) return;
    var k = _dayKey(m);
    if (k in dailyMap) dailyMap[k] += 1;
  });
  var dailyPublic = Object.keys(dailyMap).sort().map(function (date) {
    return { date: date, count: dailyMap[date] };
  });

  // Score stats over public scans that carry a numeric score
  var scored = publicScans
    .map(function (e) { return (e && typeof e.score === 'number') ? e.score : null; })
    .filter(function (s) { return s !== null; });
  var scoreStats = { count: scored.length, avg: null, min: null, max: null, buckets: { '0-39': 0, '40-59': 0, '60-79': 0, '80-100': 0 } };
  if (scored.length) {
    var sum = 0, mn = Infinity, mx = -Infinity;
    scored.forEach(function (s) {
      sum += s; if (s < mn) mn = s; if (s > mx) mx = s;
      if (s < 40) scoreStats.buckets['0-39'] += 1;
      else if (s < 60) scoreStats.buckets['40-59'] += 1;
      else if (s < 80) scoreStats.buckets['60-79'] += 1;
      else scoreStats.buckets['80-100'] += 1;
    });
    scoreStats.avg = _round(sum / scored.length, 1);
    scoreStats.min = mn;
    scoreStats.max = mx;
  }

  // Top scanned URLs (all scans — shows who is showing up / who Scout targets)
  var urlAgg = {};
  scans.forEach(function (e) {
    if (!e || !e.url) return;
    var u = String(e.url);
    if (!urlAgg[u]) urlAgg[u] = { url: u, count: 0, scoreSum: 0, scoreN: 0 };
    urlAgg[u].count += 1;
    if (typeof e.score === 'number') { urlAgg[u].scoreSum += e.score; urlAgg[u].scoreN += 1; }
  });
  var topUrls = Object.keys(urlAgg).map(function (u) {
    var a = urlAgg[u];
    return { url: a.url, count: a.count, avgScore: a.scoreN ? _round(a.scoreSum / a.scoreN, 1) : null };
  }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

  var uniqueReports = (function () {
    var s = {};
    scans.forEach(function (e) { if (e && e.reportId) s[e.reportId] = 1; });
    return Object.keys(s).length;
  })();

  // Partial checkout-intent signal (undercounts — see header note)
  var checkoutInitiatedPartial = scans.filter(function (e) {
    return e && typeof e.tier === 'string' && e.tier.indexOf('paid-') === 0;
  }).length;

  // ── Leads ────────────────────────────────────────────────────────────
  var leadMs = function (e) { return _toMs(e && e.ts); };
  var leads7 = leads.filter(function (e) { return leadMs(e) >= d7; }).length;
  var leads30 = leads.filter(function (e) { return leadMs(e) >= d30; }).length;
  var recentLeads = leads.slice(-10).reverse().map(function (e) {
    return { email: (e && e.email) || null, url: (e && e.url) || null, score: (e && e.score != null) ? e.score : null, source: (e && e.source) || null, ts: (e && e.ts) || null };
  });

  // ── Revenue (AmbientScore only) ──────────────────────────────────────
  // Founder/test purchases are excluded from the funnel's revenue figures — this
  // endpoint is the CEO's "is the business working" view, and two LIVE-mode
  // self-purchases reading as "1 paying customer, $398" is exactly the wrong
  // answer. Unconfigured list excludes nothing (see revenueLedger.isInternalEntry).
  var _intEmails = Array.isArray(input.internalEmails) ? input.internalEmails : [];
  var asEntries = ledger.entries.filter(function (e) {
    return e && e.product === 'ambientscore' && !_isInternalEntry(e, _intEmails);
  });
  var positives = asEntries.filter(function (e) { return POSITIVE_TYPES.indexOf(e.type) !== -1; });
  var refunds = asEntries.filter(function (e) { return e.type === 'refund' || e.type === 'dispute'; });

  var grossCents = positives.reduce(function (s, e) { return s + (Number(e.amountCents) || 0); }, 0);
  var refundCents = refunds.reduce(function (s, e) { return s + Math.abs(Number(e.amountCents) || 0); }, 0);
  var netCents = grossCents - refundCents;

  var custSet = {};
  positives.forEach(function (e) {
    var id = e.customerId || e.customerEmail;
    if (id) custSet[id] = 1;
  });
  var payingCustomers = Object.keys(custSet).length;

  var byCampaign = {};
  positives.forEach(function (e) {
    var key = e.utmContent || e.utmSource || 'unattributed';
    if (!byCampaign[key]) byCampaign[key] = { count: 0, cents: 0 };
    byCampaign[key].count += 1;
    byCampaign[key].cents += (Number(e.amountCents) || 0);
  });

  var lastSaleAt = positives.reduce(function (acc, e) {
    var t = e.occurredAt || e.recordedAt;
    if (t && (!acc || t > acc)) return t;
    return acc;
  }, null);

  var paidUnlocks = positives.length;

  // ── Funnel + conversion (built on PUBLIC scans) ──────────────────────
  var publicTotal = publicScans.length;
  var funnel = [
    { stage: 'Public scans', count: publicTotal },
    { stage: 'Leads captured', count: leads.length },
    { stage: 'Paid unlocks', count: paidUnlocks }
  ];
  var conversion = {
    leadRatePct: _pct(leads.length, publicTotal),
    paidRateOfScansPct: _pct(paidUnlocks, publicTotal),
    paidRateOfLeadsPct: _pct(paidUnlocks, leads.length)
  };

  var notes = [];
  if (publicTotal === 0) notes.push('Zero public scans recorded — this is a traffic problem, not a report/pricing problem.');
  if (paidUnlocks === 0 && publicTotal > 0) notes.push('Scans are happening but nobody is paying — inspect report quality / paywall / price.');
  notes.push('checkoutInitiatedPartial undercounts: paid-* tier is only logged for checkouts with no prior free scan.');

  return {
    generatedAt: new Date(nowMs).toISOString(),
    scans: {
      total: scans.length,
      public: publicScans.length,
      agent: agentScans.length,
      last7d: { total: count7(scans), public: count7(publicScans), agent: count7(agentScans) },
      last30d: { total: count30(scans), public: count30(publicScans), agent: count30(agentScans) },
      dailyPublic: dailyPublic,
      scoreStats: scoreStats,
      topUrls: topUrls,
      uniqueReports: uniqueReports,
      checkoutInitiatedPartial: checkoutInitiatedPartial
    },
    leads: {
      total: leads.length,
      last7d: leads7,
      last30d: leads30,
      recent: recentLeads
    },
    revenue: {
      payingCustomers: payingCustomers,
      paidUnlocks: paidUnlocks,
      grossCents: grossCents,
      refundCents: refundCents,
      netCents: netCents,
      netDollars: _round(netCents / 100, 2),
      byCampaign: byCampaign,
      lastSaleAt: lastSaleAt
    },
    funnel: funnel,
    conversion: conversion,
    notes: notes
  };
}

module.exports = { buildFunnelDigest: buildFunnelDigest, POSITIVE_TYPES: POSITIVE_TYPES };
