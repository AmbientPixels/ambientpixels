// stripeConnect.js — Stripe Connect Express integration for creator payouts
// Uses same raw axios pattern as stripeClient.js

const { stripeRequest, SITE_URL } = require('./stripeClient');

// ── Create Connect Express Account ────────────────────────────

async function createConnectAccount({ email, userId }) {
  return stripeRequest('POST', '/accounts', {
    type: 'express',
    email: email,
    'metadata[userId]': userId,
    'metadata[platform]': 'pixel-agents',
    'capabilities[transfers][requested]': 'true'
  });
}

// ── Create Account Link (Onboarding URL) ──────────────────────

async function createAccountLink({ accountId, refreshUrl, returnUrl }) {
  return stripeRequest('POST', '/account_links', {
    account: accountId,
    type: 'account_onboarding',
    refresh_url: refreshUrl || SITE_URL + '/pixel-agents/analytics.html?stripe=refresh',
    return_url: returnUrl || SITE_URL + '/pixel-agents/analytics.html?stripe=return'
  });
}

// ── Retrieve Connect Account ──────────────────────────────────

async function retrieveConnectAccount(accountId) {
  try {
    return await stripeRequest('GET', '/accounts/' + accountId);
  } catch {
    return null;
  }
}

// ── Create Transfer (Payout to Creator) ───────────────────────

async function createTransfer({ amount, destination, metadata }) {
  return stripeRequest('POST', '/transfers', {
    amount: String(amount), // amount in cents
    currency: 'usd',
    destination: destination, // acct_xxx
    ...(metadata ? Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => ['metadata[' + k + ']', v])
    ) : {})
  });
}

// ── Get Platform Balance ──────────────────────────────────────

async function getPlatformBalance() {
  try {
    return await stripeRequest('GET', '/balance');
  } catch {
    return null;
  }
}

module.exports = {
  createConnectAccount,
  createAccountLink,
  retrieveConnectAccount,
  createTransfer,
  getPlatformBalance
};
