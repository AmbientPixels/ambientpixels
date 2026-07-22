// as-offer-create — CEO-ONLY: create a real discount offer end-to-end.
// POST /api/as-offer-create  { name, code, percentOff, maxRedemptions, expiresAt }
//
// Creates the Stripe coupon + promotion code (the checkout already passes
// allow_promotion_codes, so the code works immediately), then registers the
// offer in the runtime registry (systemConfig.offers) that the quality gate's
// offer-claim detector reads — from that moment, content claiming the offer
// passes the gate because the offer actually exists.
//
// Governance: pricing is human-only. No agent action type routes here; the
// only callers are the CEO (or a session acting on the CEO's explicit terms)
// via the x-company-secret header. Mirrors rewards-engine-trigger auth/CORS.

const storage = require('../_utils/companyStorage');
const { createOffer } = require('../_lib/ambientScore/stripeClient');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid write secret' } };
    return;
  }

  const body = req.body || {};
  const name = String(body.name || '').slice(0, 60);
  const code = String(body.code || '').toUpperCase();
  if (!name || !code) {
    context.res = { status: 400, headers: corsHeaders, body: { error: 'name and code are required' } };
    return;
  }

  try {
    // 1. The real pricing artifact in Stripe. If this throws, nothing is registered.
    const stripe = await createOffer({
      name: name,
      code: code,
      percentOff: body.percentOff,
      maxRedemptions: body.maxRedemptions,
      expiresAt: body.expiresAt
    });

    // 2. Runtime offer registry — the quality gate's source of truth for live
    //    offers (layered over product-facts.json `offers`). Dedup by code:
    //    re-creating an existing code replaces its entry.
    const systemConfig = (await storage.getState('systemConfig')) || {};
    const offers = (Array.isArray(systemConfig.offers) ? systemConfig.offers : [])
      .filter(function (o) { return o && o.code !== stripe.code; });
    const entry = {
      name: name,
      code: stripe.code,
      discountPct: stripe.percentOff,
      appliesTo: String(body.appliesTo || 'AmbientScore single audit ($29)').slice(0, 120),
      active: true,
      expires: stripe.expiresAt,
      maxRedemptions: stripe.maxRedemptions,
      stripeCouponId: stripe.couponId,
      stripePromotionCodeId: stripe.promotionCodeId,
      createdAt: new Date().toISOString(),
      createdBy: 'ceo'
    };
    offers.push(entry);
    systemConfig.offers = offers;
    await storage.setState('systemConfig', systemConfig);

    // 3. Governance record — an offer going live is a CEO-tier business event.
    try {
      const gov = (await storage.getState('governanceLog')) || [];
      gov.push({
        id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        type: 'offer-created',
        agentId: 'ceo',
        summary: 'Offer live: ' + name + ' (' + stripe.code + ', ' + stripe.percentOff + '% off' +
          (stripe.maxRedemptions ? ', max ' + stripe.maxRedemptions : '') +
          (stripe.expiresAt ? ', expires ' + stripe.expiresAt.slice(0, 10) : '') + ')',
        data: { code: stripe.code, discountPct: stripe.percentOff, couponId: stripe.couponId },
        timestamp: new Date().toISOString()
      });
      await storage.setState('governanceLog', gov.slice(-500));
    } catch (_govErr) { context.log('[as-offer-create] governance log failed (non-fatal):', String(_govErr).slice(0, 120)); }

    context.log('[as-offer-create] offer live:', stripe.code, stripe.percentOff + '% off');
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', offer: entry } };
  } catch (err) {
    const msg = (err && err.response && err.response.data && err.response.data.error && err.response.data.error.message) ||
      (err && err.message) || String(err);
    context.res = { status: 500, headers: corsHeaders, body: { error: String(msg).substring(0, 300) } };
  }
};
