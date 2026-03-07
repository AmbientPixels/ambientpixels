// stripeClient.js — AmbientScore Stripe integration
// Raw axios calls to Stripe API (no SDK, consistent with codebase pattern)

const axios = require('axios');
const crypto = require('crypto');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_SINGLE = process.env.STRIPE_PRICE_SINGLE;   // $49 price ID
const STRIPE_PRICE_PACK = process.env.STRIPE_PRICE_PACK;       // $149 3-pack price ID
const STRIPE_BASE = 'https://api.stripe.com/v1';

const SITE_URL = process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai';

// ── Create Checkout Session ──────────────────────────────────────

async function createCheckoutSession({ reportId, url, email, priceType }) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');

  const priceId = priceType === 'pack' ? STRIPE_PRICE_PACK : STRIPE_PRICE_SINGLE;
  if (!priceId) throw new Error('Stripe price not configured for type: ' + priceType);

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', SITE_URL + '/ambientscore/report.html?id=' + reportId + '&session_id={CHECKOUT_SESSION_ID}');
  params.append('cancel_url', SITE_URL + '/ambientscore/?cancelled=1');
  params.append('metadata[reportId]', reportId);
  params.append('metadata[url]', url);
  params.append('metadata[priceType]', priceType);
  if (email) params.append('customer_email', email);

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

// ── Verify Checkout Session ──────────────────────────────────────

async function verifySession(sessionId) {
  if (!STRIPE_SECRET_KEY) return { valid: false };

  try {
    const res = await axios.get(STRIPE_BASE + '/checkout/sessions/' + sessionId, {
      headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY },
      timeout: 10000
    });

    return {
      valid: res.data.payment_status === 'paid',
      customerEmail: res.data.customer_details?.email || null,
      metadata: res.data.metadata || {}
    };
  } catch {
    return { valid: false };
  }
}

// ── Verify Webhook Signature ─────────────────────────────────────

function verifyWebhookSignature(payload, signature) {
  if (!STRIPE_WEBHOOK_SECRET || !signature) return false;

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
      .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
      .update(signedPayload, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(v1Sig, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

module.exports = { createCheckoutSession, verifySession, verifyWebhookSignature };
