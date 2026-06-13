#!/usr/bin/env node
'use strict';

/**
 * backfill-revenue-ledger.cjs — one-time seed of the revenueLedger from existing
 * paid records so the first revenue number isn't a false zero.
 *
 * Sources (read-only):
 *   1. AmbientScore paid reports  — `company-state` container, blobs cc_report_*
 *      with unlocked && paidAt. Amount is deterministic from priceType
 *      (single $29 / pack $89). No Stripe call needed.
 *   2. Active subscriptions       — `cardforge` container, billing/entitlements/*
 *      where tier==='pro' && subscriptionStatus==='active'. Plan/interval derived
 *      from the latest pro purchase's productId; monthly price from SUB_MONTHLY_CENTS.
 *
 * SAFE BY DESIGN:
 *   - DRY-RUN by default. Pass --apply to actually write.
 *   - Idempotent: synthetic ids (backfill:as:<reportId>, backfill:sub:<subId>) +
 *     a sourceId pre-check, so it can NEVER double-count a sale a webhook already
 *     recorded, and re-running is harmless.
 *   - Reads only; the single mutation is appending to revenueLedger.
 *
 * Run against prod (needs AZURE_STORAGE_CONNECTION_STRING or managed identity):
 *   node scripts/backfill-revenue-ledger.cjs            # dry run
 *   node scripts/backfill-revenue-ledger.cjs --apply    # write
 *
 * NOTE: subscription amounts are APPROXIMATE (monthly price from the map below;
 * yearly = monthly×12). For exact historical figures, a Stripe-API backfill is the
 * gold standard. The dry-run prints everything before you commit.
 */

const path = require('path');

// $ amounts, in cents.
const AS_AMOUNT = { single: 2900, pack: 8900 };

// Monthly subscription price per plan family, in cents. VERIFY before --apply.
// cf-pro $4.99/mo, sf-pro $9.99/mo are the documented prices; pa-pro is unset —
// fill it in (or any active pa-pro sub is skipped with a warning).
const SUB_MONTHLY_CENTS = {
  'cf-pro': 499,
  'sf-pro': 999,
  'pa-pro': null
};

function _planFamily(productId) {
  if (!productId) return null;
  return String(productId).replace(/-(monthly|yearly|annual)$/i, '');
}
function _interval(productId) { return /year|annual/i.test(productId || '') ? 'year' : 'month'; }
function _productFromPlan(family) {
  if (!family) return 'unknown';
  if (family.indexOf('cf-') === 0) return 'cardforge';
  if (family.indexOf('sf-') === 0) return 'storyforge';
  if (family.indexOf('pa-') === 0) return 'pixelagents';
  return 'unknown';
}
function _isProActive(rec) {
  return !!(rec && rec.tier === 'pro' && rec.subscriptionStatus === 'active');
}

/**
 * PURE: build candidate ledger entries from paid records. Offline-testable.
 * @param {object} args { reports: [], activeSubs: [], priceMap?: {} }
 * @returns {object} { entries: [], warnings: [] }
 */
function buildBackfillEntries(args) {
  const reports = (args && args.reports) || [];
  const activeSubs = (args && args.activeSubs) || [];
  const priceMap = (args && args.priceMap) || SUB_MONTHLY_CENTS;
  const entries = [];
  const warnings = [];

  // AmbientScore one-time purchases.
  reports.forEach(function (r) {
    const reportId = r.id || r.reportId;
    if (!reportId) return;
    if (!r.unlocked || !r.paidAt) return;
    if (r.redeemedViaCredit) return; // credit redemptions aren't a new payment
    const priceType = (r.priceType === 'pack') ? 'pack' : 'single';
    entries.push({
      id: 'backfill:as:' + reportId,
      product: 'ambientscore',
      type: 'one_time',
      plan: priceType,
      amountCents: AS_AMOUNT[priceType],
      currency: 'usd',
      customerEmail: r.customerEmail || null,
      customerId: r.stripeCustomerId || null,
      subscriptionId: null,
      sourceId: r.stripeSessionId || null,
      occurredAt: r.paidAt
    });
  });

  // Active subscriptions (one subscription_initial per active sub).
  activeSubs.forEach(function (rec) {
    if (!_isProActive(rec)) return;
    const subId = rec.subscriptionId;
    if (!subId) return;
    const purchases = Array.isArray(rec.purchases) ? rec.purchases : [];
    let productId = null;
    let occurredAt = rec.updatedAt || rec.createdAt || null;
    for (let i = purchases.length - 1; i >= 0; i--) {
      const pid = purchases[i] && purchases[i].productId;
      if (pid && /pro/i.test(pid)) { productId = pid; occurredAt = purchases[i].grantedAt || occurredAt; break; }
    }
    const family = _planFamily(productId);
    const monthly = (family && priceMap[family] != null) ? priceMap[family] : null;
    if (monthly == null) {
      warnings.push('No price for plan "' + (family || productId || '?') + '" (sub ' + subId + ', customer ' + (rec.stripeCustomerId || '?') + ') — SKIPPED. Add it to SUB_MONTHLY_CENTS and re-run.');
      return;
    }
    const interval = _interval(productId);
    const amount = interval === 'year' ? monthly * 12 : monthly; // yearly ≈ monthly×12 (MRR ÷12 recovers monthly)
    entries.push({
      id: 'backfill:sub:' + subId,
      product: _productFromPlan(family),
      type: 'subscription_initial',
      plan: productId || family,
      interval: interval,
      amountCents: amount,
      currency: 'usd',
      customerEmail: null,
      customerId: rec.stripeCustomerId || null,
      subscriptionId: subId,
      sourceId: subId,
      occurredAt: occurredAt
    });
  });

  return { entries: entries, warnings: warnings };
}

// ── Blob I/O (live; run against prod) ─────────────────────────────────────────

async function _makeBlobService() {
  const { BlobServiceClient } = require('@azure/storage-blob');
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  return new BlobServiceClient('https://cardforgeblobdata.blob.core.windows.net', new DefaultAzureCredential());
}

async function _readJsonBlob(containerClient, name) {
  try {
    const blob = containerClient.getBlockBlobClient(name);
    const dl = await blob.download(0);
    const chunks = [];
    for await (const ch of dl.readableStreamBody) chunks.push(typeof ch === 'string' ? Buffer.from(ch) : ch);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_e) { return null; }
}

async function _enumerate(containerClient, prefix, filter) {
  const out = [];
  try {
    for await (const blob of containerClient.listBlobsFlat({ prefix: prefix })) {
      const rec = await _readJsonBlob(containerClient, blob.name);
      if (rec && (!filter || filter(rec))) out.push(rec);
    }
  } catch (e) {
    console.error('[backfill] enumerate failed for prefix ' + prefix + ': ' + e.message);
  }
  return out;
}

async function main() {
  const apply = process.argv.indexOf('--apply') !== -1;
  console.log('[backfill] revenue ledger backfill — ' + (apply ? 'APPLY (will write)' : 'DRY RUN (no writes)'));

  const { getBlobPrefix } = require(path.join(__dirname, '..', 'api', '_utils', 'demoGuard'));
  const ledgerLib = require(path.join(__dirname, '..', 'api', '_lib', 'stripe', 'revenueLedger'));

  let service;
  try { service = await _makeBlobService(); }
  catch (e) { console.error('[backfill] blob storage unavailable (' + e.message + '). Set AZURE_STORAGE_CONNECTION_STRING or run on the function app. Nothing to backfill.'); return; }

  const prefix = getBlobPrefix();
  const reportPrefix = (prefix ? prefix + '/' : '') + 'cc_report_';

  const stateContainer = service.getContainerClient('company-state');
  const cfContainer = service.getContainerClient('cardforge');

  console.log('[backfill] scanning AmbientScore reports (' + reportPrefix + '*) ...');
  const reports = await _enumerate(stateContainer, reportPrefix, function (r) { return r && r.unlocked && r.paidAt; });
  console.log('[backfill] scanning active subscription entitlements (billing/entitlements/*) ...');
  const activeSubs = await _enumerate(cfContainer, 'billing/entitlements/', _isProActive);

  const built = buildBackfillEntries({ reports: reports, activeSubs: activeSubs });
  built.warnings.forEach(function (w) { console.warn('[backfill] WARN ' + w); });

  console.log('[backfill] candidate entries: ' + built.entries.length + ' (from ' + reports.length + ' paid reports + ' + activeSubs.length + ' active subs)');

  // Dedup against any sale a webhook already recorded (by sourceId).
  const existing = await ledgerLib.getLedger();
  const seenSource = new Set((existing.entries || []).map(function (e) { return e.sourceId; }).filter(Boolean));
  const toApply = built.entries.filter(function (e) {
    if (e.sourceId && seenSource.has(e.sourceId)) { console.log('[backfill] skip (sourceId already in ledger): ' + e.id); return false; }
    return true;
  });

  let total = 0;
  built.entries.forEach(function (e) { total += (Number(e.amountCents) || 0); });
  console.log('[backfill] would record ' + toApply.length + ' new entries, total $' + (total / 100).toFixed(2) + '.');
  toApply.forEach(function (e) {
    console.log('  - ' + e.id + ' | ' + e.product + ' ' + e.type + ' ' + (e.plan || '') + ' $' + ((e.amountCents || 0) / 100).toFixed(2) + ' @ ' + (e.occurredAt || '?'));
  });

  if (!apply) { console.log('[backfill] DRY RUN complete. Re-run with --apply to write. Verify the price map + amounts first.'); return; }

  let recorded = 0, dup = 0;
  for (const e of toApply) {
    const res = await ledgerLib.recordRevenue(e);
    if (res.recorded) recorded++; else if (res.reason === 'duplicate') dup++;
  }
  console.log('[backfill] APPLIED. recorded=' + recorded + ' duplicate=' + dup + '. Done.');
}

module.exports = { buildBackfillEntries: buildBackfillEntries, SUB_MONTHLY_CENTS: SUB_MONTHLY_CENTS };

if (require.main === module) {
  main().catch(function (e) { console.error('[backfill] fatal:', e); process.exit(1); });
}
