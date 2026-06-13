'use strict';

/**
 * recordWebhookRevenue.js — maps verified Stripe webhook events to revenueLedger
 * entries. Centralized so all four product webhooks share one tested mapping and
 * each call site stays a single non-fatal line.
 *
 * Every function here is NON-THROWING by contract: it internally try/catches and
 * returns a result object. A revenue-recording failure must NEVER break a
 * customer's unlock/entitlement or turn a webhook into a 500.
 */

const { recordRevenue } = require('./revenueLedger');

function _amountFromSession(session, fallbackCents) {
  const a = session && Number(session.amount_total);
  if (Number.isFinite(a) && a > 0) return a;
  return Number.isFinite(fallbackCents) ? fallbackCents : 0;
}

function _isoFromEvent(event) {
  const c = event && Number(event.created);
  if (Number.isFinite(c) && c > 0) return new Date(c * 1000).toISOString();
  return new Date().toISOString();
}

function _id(maybe) {
  if (!maybe) return null;
  if (typeof maybe === 'string') return maybe;
  return maybe.id || null;
}

function _log(log, msg) {
  try { if (typeof log === 'function') log(msg); } catch (_e) { /* non-fatal */ }
}

/**
 * Record a one-time purchase or subscription-initial from checkout.session.completed.
 * args: { event, session, product, type, plan, interval, fallbackCents, log, storageOverride }
 */
async function recordCheckoutRevenue(args) {
  try {
    const event = args.event || {};
    const session = args.session || (event.data && event.data.object) || {};
    const amount = _amountFromSession(session, args.fallbackCents);
    if (!(amount > 0)) {
      _log(args.log, '[revenue] ' + (args.product || '?') + ' checkout had zero amount — skipped');
      return { recorded: false, reason: 'zero-amount' };
    }
    const res = await recordRevenue({
      id: event.id,
      product: args.product || null,
      type: args.type || 'one_time',
      plan: args.plan || (session.metadata && session.metadata.productId) || null,
      interval: args.interval || null,
      amountCents: amount,
      currency: session.currency || 'usd',
      customerEmail: (session.customer_details && session.customer_details.email) || session.customer_email || null,
      customerId: _id(session.customer),
      subscriptionId: _id(session.subscription),
      sourceId: session.id || null,
      occurredAt: _isoFromEvent(event)
    }, args.storageOverride);
    _log(args.log, '[revenue] ' + (args.product || '?') + ' ' + (args.type || 'one_time') + ' $' + (amount / 100).toFixed(2) + ' -> ' + res.reason);
    return res;
  } catch (e) {
    _log(args.log, '[revenue] checkout record failed (non-fatal): ' + (e && e.message));
    return { recorded: false, reason: 'error', error: e && e.message };
  }
}

/**
 * Record a subscription cancellation (customer.subscription.deleted OR
 * customer.subscription.updated with status 'canceled'). Removes the sub from MRR.
 * args: { event, subscription, product, log, storageOverride }
 */
async function recordSubscriptionCanceled(args) {
  try {
    const event = args.event || {};
    const sub = args.subscription || (event.data && event.data.object) || {};
    const res = await recordRevenue({
      id: event.id,
      product: args.product || null,
      type: 'subscription_canceled',
      amountCents: 0,
      currency: sub.currency || 'usd',
      customerId: _id(sub.customer),
      subscriptionId: sub.id || null,
      sourceId: sub.id || null,
      occurredAt: _isoFromEvent(event)
    }, args.storageOverride);
    _log(args.log, '[revenue] ' + (args.product || '?') + ' subscription_canceled ' + (sub.id || '') + ' -> ' + res.reason);
    return res;
  } catch (e) {
    _log(args.log, '[revenue] cancel record failed (non-fatal): ' + (e && e.message));
    return { recorded: false, reason: 'error', error: e && e.message };
  }
}

/**
 * Record a refund (charge.refunded) or dispute (charge.dispute.created) as a
 * NEGATIVE ledger entry.
 * args: { event, product, kind: 'refund'|'dispute', log, storageOverride }
 */
async function recordRefundFromEvent(args) {
  try {
    const event = args.event || {};
    const obj = (event.data && event.data.object) || {};
    const kind = args.kind === 'dispute' ? 'dispute' : 'refund';
    // charge.refunded: obj is a charge; amount_refunded = refunded cents (cumulative).
    // charge.dispute.created: obj is a dispute; obj.amount = disputed cents, obj.charge = charge id.
    let cents;
    if (kind === 'dispute') cents = Number(obj.amount) || 0;
    else cents = Number(obj.amount_refunded) || Number(obj.amount) || 0;
    if (!(cents > 0)) {
      _log(args.log, '[revenue] ' + (args.product || '?') + ' ' + kind + ' had zero amount — skipped');
      return { recorded: false, reason: 'zero-amount' };
    }
    const res = await recordRevenue({
      id: event.id,
      product: args.product || null,
      type: kind,
      amountCents: -Math.abs(cents),
      currency: obj.currency || 'usd',
      customerEmail: (obj.billing_details && obj.billing_details.email) || obj.receipt_email || null,
      customerId: _id(obj.customer),
      sourceId: obj.charge || obj.id || null,
      occurredAt: _isoFromEvent(event)
    }, args.storageOverride);
    _log(args.log, '[revenue] ' + (args.product || '?') + ' ' + kind + ' -$' + (cents / 100).toFixed(2) + ' -> ' + res.reason);
    return res;
  } catch (e) {
    _log(args.log, '[revenue] refund record failed (non-fatal): ' + (e && e.message));
    return { recorded: false, reason: 'error', error: e && e.message };
  }
}

module.exports = {
  recordCheckoutRevenue: recordCheckoutRevenue,
  recordSubscriptionCanceled: recordSubscriptionCanceled,
  recordRefundFromEvent: recordRefundFromEvent
};
