// stripeClient.js — AmbientScore Stripe integration
// Raw axios calls to Stripe API (no SDK, consistent with codebase pattern)

const axios = require('axios');
const crypto = require('crypto');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_SINGLE = process.env.STRIPE_PRICE_SINGLE;   // $29 price ID
const STRIPE_PRICE_PACK = process.env.STRIPE_PRICE_PACK;       // $89 3-pack price ID
const STRIPE_BASE = 'https://api.stripe.com/v1';

const SITE_URL = process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai';

// ── Create Checkout Session ──────────────────────────────────────

async function createCheckoutSession({ reportId, url, email, priceType, utmContent, utmSource }) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');

  const priceId = priceType === 'pack' ? STRIPE_PRICE_PACK : STRIPE_PRICE_SINGLE;
  if (!priceId) throw new Error('Stripe price not configured for type: ' + priceType);

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('allow_promotion_codes', 'true');
  // Card + Link only. With dashboard-automatic payment methods, BNPL types
  // (which carry minimum-amount floors) make Stripe reject customer-ENTERED
  // promo codes ("This code is invalid") when the discount would drop the
  // total below their floor — hit live 2026-07-30 with a valid 100%-off code
  // (and it tainted GENESIS's redemption numbers). Server-side pre-applied
  // discounts dodge this; entered codes don't. BNPL adds nothing at this
  // price point, so pin the methods instead.
  params.append('payment_method_types[0]', 'card');
  params.append('payment_method_types[1]', 'link');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', SITE_URL + '/ambientscore/report.html?id=' + reportId + '&session_id={CHECKOUT_SESSION_ID}');
  params.append('cancel_url', SITE_URL + '/ambientscore/?cancelled=1');
  params.append('metadata[reportId]', reportId);
  params.append('metadata[url]', url);
  params.append('metadata[priceType]', priceType);
  // Campaign attribution (revenue-visibility Gap 2): carry the originating post's
  // utm_content (action id) + utm_source into the session metadata so the webhook
  // can stamp the campaign on the ledger entry.
  if (utmContent) params.append('metadata[utm_content]', String(utmContent).slice(0, 120));
  if (utmSource) params.append('metadata[utm_source]', String(utmSource).slice(0, 50));
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

// ── Create Teardown Checkout ($199 done-for-you) ─────────────────
// Inline price_data: no pre-created Stripe Price or env var needed. Metadata
// carries the full intake (url + goal) so the webhook can queue the order
// without any post-payment form.

const TEARDOWN_PRICE_CENTS = 19900;

async function createTeardownCheckout({ url, email, goal, utmContent, utmSource }) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  if (!url) throw new Error('url required');

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('allow_promotion_codes', 'true');
  // Same card+link pinning as createCheckoutSession — see comment there.
  params.append('payment_method_types[0]', 'card');
  params.append('payment_method_types[1]', 'link');
  params.append('line_items[0][price_data][currency]', 'usd');
  params.append('line_items[0][price_data][unit_amount]', String(TEARDOWN_PRICE_CENTS));
  params.append('line_items[0][price_data][product_data][name]', 'AmbientScore Conversion Teardown');
  params.append('line_items[0][price_data][product_data][description]', 'Done-for-you conversion audit with rewrites. Delivered within 48 hours.');
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', SITE_URL + '/ambientscore/teardown-thanks.html?session_id={CHECKOUT_SESSION_ID}');
  params.append('cancel_url', SITE_URL + '/ambientscore/?cancelled=1');
  params.append('metadata[teardown]', '1');
  params.append('metadata[url]', String(url).slice(0, 450));
  if (goal) params.append('metadata[goal]', String(goal).slice(0, 450));
  if (email) {
    params.append('metadata[email]', String(email).slice(0, 200));
    params.append('customer_email', email);
  }
  if (utmContent) params.append('metadata[utm_content]', String(utmContent).slice(0, 120));
  if (utmSource) params.append('metadata[utm_source]', String(utmSource).slice(0, 50));

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

// ── Create Rewrite Checkout ($9 Deep Roast Rewrite) ──────────────
// Inline price_data like the teardown. The order already exists server-side
// (resume text is too large for metadata) so metadata carries only the id.

async function createRewriteCheckout({ orderId, token, priceCents, utmContent, utmSource }) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  if (!orderId || !token) throw new Error('orderId and token required');

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('allow_promotion_codes', 'true');
  // Same card+link pinning as createCheckoutSession — see comment there.
  params.append('payment_method_types[0]', 'card');
  params.append('payment_method_types[1]', 'link');
  params.append('line_items[0][price_data][currency]', 'usd');
  params.append('line_items[0][price_data][unit_amount]', String(priceCents || 900));
  params.append('line_items[0][price_data][product_data][name]', 'Deep Roast Resume Rewrite');
  params.append('line_items[0][price_data][product_data][description]', 'Your resume professionally rewritten and ATS-optimized, based on your roast. Ready in minutes.');
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', SITE_URL + '/resume-roast/rewrite.html?id=' + orderId + '&key=' + token);
  params.append('cancel_url', SITE_URL + '/pixel-agents/run.html?agent=resume-roast&cancelled=1');
  params.append('metadata[rewrite]', '1');
  params.append('metadata[orderId]', orderId);
  if (utmContent) params.append('metadata[utm_content]', String(utmContent).slice(0, 120));
  if (utmSource) params.append('metadata[utm_source]', String(utmSource).slice(0, 50));

  const res = await axios.post(STRIPE_BASE + '/checkout/sessions', params.toString(), {
    headers: {
      'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    timeout: 15000
  });

  return { checkoutUrl: res.data.url, sessionId: res.data.id };
}

// ── Create Offer (coupon + promotion code) ───────────────────────
// CEO-only path (as-offer-create endpoint). Creates the real pricing artifact:
// a one-time percent-off coupon plus a customer-facing promotion code with a
// redemption cap and expiry. The existing checkout already passes
// allow_promotion_codes, so the code works the moment this returns.

async function createOffer({ name, code, percentOff, maxRedemptions, expiresAt }) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  const pct = Number(percentOff);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('percentOff must be 1-100');
  if (!code || !/^[A-Z0-9_-]{3,30}$/i.test(String(code))) throw new Error('code must be 3-30 alphanumeric chars');

  const headers = {
    'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  const couponParams = new URLSearchParams();
  couponParams.append('percent_off', String(pct));
  couponParams.append('duration', 'once');
  couponParams.append('name', String(name || code).slice(0, 40));
  const couponRes = await axios.post(STRIPE_BASE + '/coupons', couponParams.toString(), { headers, timeout: 15000 });

  const promoParams = new URLSearchParams();
  // This account's Stripe API version requires the nested `promotion` object —
  // the legacy flat `coupon` param returns "Received unknown parameter: coupon"
  // (verified live 2026-07-22 creating the GENESIS code).
  promoParams.append('promotion[type]', 'coupon');
  promoParams.append('promotion[coupon]', couponRes.data.id);
  promoParams.append('code', String(code).toUpperCase());
  if (Number.isFinite(Number(maxRedemptions)) && Number(maxRedemptions) > 0) {
    promoParams.append('max_redemptions', String(Number(maxRedemptions)));
  }
  const expMs = Date.parse(expiresAt || '');
  if (Number.isFinite(expMs)) promoParams.append('expires_at', String(Math.floor(expMs / 1000)));
  const promoRes = await axios.post(STRIPE_BASE + '/promotion_codes', promoParams.toString(), { headers, timeout: 15000 });

  return {
    couponId: couponRes.data.id,
    promotionCodeId: promoRes.data.id,
    code: promoRes.data.code,
    percentOff: pct,
    maxRedemptions: promoRes.data.max_redemptions || null,
    expiresAt: promoRes.data.expires_at ? new Date(promoRes.data.expires_at * 1000).toISOString() : null
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

// ── Look Up a Session From a Refund/Dispute ──────────────────────
// Refunds and disputes arrive as charge objects, which carry no reportId — only
// the checkout session does. Walk back through the payment intent to find it so
// access can be withdrawn from the right report and only that one.

function _idOf(v) {
  if (!v) return null;
  return typeof v === 'string' ? v : (v.id || null);
}

async function retrieveCharge(chargeId) {
  const id = _idOf(chargeId);
  if (!STRIPE_SECRET_KEY || !id) return null;
  try {
    const res = await axios.get(STRIPE_BASE + '/charges/' + id, {
      headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY },
      timeout: 10000
    });
    return res.data || null;
  } catch {
    return null;
  }
}

async function findCheckoutSessionByPaymentIntent(paymentIntent) {
  const id = _idOf(paymentIntent);
  if (!STRIPE_SECRET_KEY || !id) return null;
  try {
    const res = await axios.get(STRIPE_BASE + '/checkout/sessions', {
      params: { payment_intent: id, limit: 1 },
      headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY },
      timeout: 10000
    });
    return (res.data && res.data.data && res.data.data[0]) || null;
  } catch {
    return null;
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

module.exports = { createCheckoutSession, createTeardownCheckout, createRewriteCheckout, createOffer, verifySession, verifyWebhookSignature, retrieveCharge, findCheckoutSessionByPaymentIntent };
