// productCatalog.js — CardForge purchasable products
// Maps product IDs to Stripe Price IDs and entitlements granted.
// Future products (effect packs, boosters) just add entries here.

const PRODUCTS = {
  // === Subscriptions ===
  'cf-pro-monthly': {
    stripePrice: process.env.CF_STRIPE_PRICE_PRO_MONTHLY,
    mode: 'subscription',
    name: 'CardForge Pro (Monthly)',
    description: 'HD exports, premium effects, extra card slots',
    entitlements: {
      tier: 'pro',
      flags: ['hdExport', 'premiumEffects', 'extraCardSlots']
    }
  },
  'cf-pro-yearly': {
    stripePrice: process.env.CF_STRIPE_PRICE_PRO_YEARLY,
    mode: 'subscription',
    name: 'CardForge Pro (Yearly)',
    description: 'HD exports, premium effects, extra card slots — save 20%',
    entitlements: {
      tier: 'pro',
      flags: ['hdExport', 'premiumEffects', 'extraCardSlots']
    }
  }
  // Future one-time products:
  // 'cf-effect-pack-celestial': { mode: 'payment', stripePrice: process.env.CF_STRIPE_PRICE_CELESTIAL, ... }
  // 'cf-xp-booster-24h':       { mode: 'payment', stripePrice: process.env.CF_STRIPE_PRICE_XP_BOOST, ttlHours: 24, ... }
};

function getProduct(productId) {
  return PRODUCTS[productId] || null;
}

function getAllProducts() {
  return Object.entries(PRODUCTS).map(([id, p]) => ({ id, ...p }));
}

module.exports = { PRODUCTS, getProduct, getAllProducts };
