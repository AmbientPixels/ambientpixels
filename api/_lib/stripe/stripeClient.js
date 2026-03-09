// stripeClient.js — Shared Stripe integration for AmbientPixels
// Raw axios calls to Stripe API (consistent with existing CC pattern)

const axios = require('axios');
const crypto = require('crypto');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_BASE = 'https://api.stripe.com/v1';
const SITE_URL = process.env.SITE_URL || 'https://ambientpixels.ai';

// ── Generic Stripe API call ────────────────────────────────────

async function stripeRequest(method, path, params) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');

  const config = {
    method,
    url: STRIPE_BASE + path,
    headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY },
    timeout: 15000
  };

  if (params) {
    if (method === 'GET') {
      config.params = params;
    } else {
      config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      config.data = new URLSearchParams(params).toString();
    }
  }

  const res = await axios(config);
  return res.data;
}

// ── Create Checkout Session ────────────────────────────────────

async function createCheckoutSession({ mode, priceId, successUrl, cancelUrl, metadata, customerEmail, customerId }) {
  const params = new URLSearchParams();
  params.append('mode', mode || 'payment');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', successUrl);
  params.append('cancel_url', cancelUrl);
  params.append('allow_promotion_codes', 'true');

  if (metadata) {
    for (const [key, val] of Object.entries(metadata)) {
      params.append('metadata[' + key + ']', val);
    }
  }
  if (customerId) {
    params.append('customer', customerId);
  } else if (customerEmail) {
    params.append('customer_email', customerEmail);
  }

  const res = await axios.post(STRIPE_BASE + '/checkout/sessions', params.toString(), {
    headers: {
      'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    timeout: 15000
  });

  return {
    checkoutUrl: res.data.url,
    sessionId: res.data.id
  };
}

// ── Retrieve Checkout Session ──────────────────────────────────

async function retrieveSession(sessionId) {
  try {
    return await stripeRequest('GET', '/checkout/sessions/' + sessionId);
  } catch {
    return null;
  }
}

// ── Retrieve Subscription ──────────────────────────────────────

async function retrieveSubscription(subscriptionId) {
  try {
    return await stripeRequest('GET', '/subscriptions/' + subscriptionId);
  } catch {
    return null;
  }
}

// ── Customer Management ────────────────────────────────────────

async function findCustomerByEmail(email) {
  try {
    const data = await stripeRequest('GET', '/customers', { email: email, limit: 1 });
    return data.data && data.data.length > 0 ? data.data[0] : null;
  } catch {
    return null;
  }
}

async function createCustomer({ email, metadata }) {
  const params = {};
  if (email) params.email = email;
  if (metadata) {
    for (const [key, val] of Object.entries(metadata)) {
      params['metadata[' + key + ']'] = val;
    }
  }
  return stripeRequest('POST', '/customers', params);
}

// ── Billing Portal ─────────────────────────────────────────────

async function createPortalSession({ customerId, returnUrl }) {
  return stripeRequest('POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl || SITE_URL + '/cardforge/'
  });
}

// ── Verify Webhook Signature ───────────────────────────────────

function verifyWebhookSignature(payload, signature, secret) {
  if (!secret || !signature) return false;

  try {
    const elements = signature.split(',');
    const tsEl = elements.find(e => e.startsWith('t='));
    const sigEl = elements.find(e => e.startsWith('v1='));
    if (!tsEl || !sigEl) return false;

    const timestamp = tsEl.slice(2);
    const v1Sig = sigEl.slice(3);

    // Check timestamp is within 5 minutes
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (age > 300) return false;

    const signedPayload = timestamp + '.' + payload;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(v1Sig, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

module.exports = {
  stripeRequest,
  createCheckoutSession,
  createPortalSession,
  retrieveSession,
  retrieveSubscription,
  findCustomerByEmail,
  createCustomer,
  verifyWebhookSignature,
  SITE_URL
};
