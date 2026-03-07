// creditUtils.js — AmbientScore pack credit ledger
// Shared between as-webhook, as-analyze, and as-credits endpoints

const crypto = require('crypto');
const storage = require('../../_utils/companyStorage');

function emailToCreditsKey(email) {
  var normalized = (email || '').trim().toLowerCase();
  var hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return 'cc_credits_' + hash;
}

/**
 * Idempotently grant 3 pack credits. Auto-redeems 1 for the triggering report.
 * Safe to call from both webhook and redirect (checks history for stripeSessionId).
 * Returns updated credit record, or null if already recorded.
 */
async function grantPackCredits({ email, stripeSessionId, reportId }) {
  if (!email) return null;
  var normalEmail = email.trim().toLowerCase();
  var creditsKey = emailToCreditsKey(normalEmail);
  var record = (await storage.getState(creditsKey)) || {
    email: normalEmail,
    credits: 0,
    totalPurchased: 0,
    totalRedeemed: 0,
    history: [],
    createdAt: new Date().toISOString()
  };

  // Idempotency: skip if this Stripe session already processed
  if (record.history.some(function (h) { return h.stripeSessionId === stripeSessionId; })) {
    return null;
  }

  var now = new Date().toISOString();
  record.credits += 3;
  record.totalPurchased += 3;
  record.credits -= 1;          // Auto-redeem for the triggering report
  record.totalRedeemed += 1;
  record.history.push(
    { type: 'purchase', credits: 3, stripeSessionId: stripeSessionId, reportId: reportId, timestamp: now },
    { type: 'auto_redeem', credits: -1, reportId: reportId, timestamp: now }
  );
  if (record.history.length > 100) record.history = record.history.slice(-100);
  record.updatedAt = now;
  await storage.setState(creditsKey, record);
  return record;
}

module.exports = { emailToCreditsKey, grantPackCredits };
