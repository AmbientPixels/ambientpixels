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
  },
  // Future one-time products:
  // 'cf-effect-pack-celestial': { mode: 'payment', stripePrice: process.env.CF_STRIPE_PRICE_CELESTIAL, ... }
  // 'cf-xp-booster-24h':       { mode: 'payment', stripePrice: process.env.CF_STRIPE_PRICE_XP_BOOST, ttlHours: 24, ... }

  // === StoryForge Subscriptions ===
  'sf-pro-monthly': {
    stripePrice: process.env.SF_STRIPE_PRICE_PRO_MONTHLY,
    mode: 'subscription',
    name: 'StoryForge Pro (Monthly)',
    description: 'All genres, unlimited adventures, images every scene, extra saves',
    entitlements: {
      tier: 'pro',
      flags: ['sfAllGenres', 'sfUnlimitedAdventures', 'sfAllImages', 'sfExtraSaves']
    }
  },
  'sf-pro-yearly': {
    stripePrice: process.env.SF_STRIPE_PRICE_PRO_YEARLY,
    mode: 'subscription',
    name: 'StoryForge Pro (Yearly)',
    description: 'All genres, unlimited adventures, images every scene, extra saves — save 20%',
    entitlements: {
      tier: 'pro',
      flags: ['sfAllGenres', 'sfUnlimitedAdventures', 'sfAllImages', 'sfExtraSaves']
    }
  },

  // === Pixel Agents ===
  'pa-pro-monthly': {
    stripePrice: process.env.PA_STRIPE_PRICE_PRO_MONTHLY,
    mode: 'subscription',
    name: 'Pixel Agents Pro (Monthly)',
    description: 'Unlimited daily runs, priority queue, early access to new agents',
    entitlements: {
      tier: 'pro',
      flags: ['paUnlimitedRuns', 'paPriorityQueue', 'paEarlyAccess']
    }
  },
  'pa-pro-yearly': {
    stripePrice: process.env.PA_STRIPE_PRICE_PRO_YEARLY,
    mode: 'subscription',
    name: 'Pixel Agents Pro (Yearly)',
    description: 'Unlimited daily runs, priority queue, early access — save 20%',
    entitlements: {
      tier: 'pro',
      flags: ['paUnlimitedRuns', 'paPriorityQueue', 'paEarlyAccess']
    }
  },
  'pa-credit-10': {
    stripePrice: process.env.PA_STRIPE_PRICE_CREDIT_10,
    mode: 'payment',
    name: '10 Agent Runs',
    description: '10 agent runs — use any agent, no expiration',
    entitlements: {
      credits: 10
    }
  },
  'pa-credit-50': {
    stripePrice: process.env.PA_STRIPE_PRICE_CREDIT_50,
    mode: 'payment',
    name: '50 Agent Runs',
    description: '50 agent runs — use any agent, no expiration — save 20%',
    entitlements: {
      credits: 50
    }
  }
};

function getProduct(productId) {
  return PRODUCTS[productId] || null;
}

function getAllProducts() {
  return Object.entries(PRODUCTS).map(([id, p]) => ({ id, ...p }));
}

module.exports = { PRODUCTS, getProduct, getAllProducts };
