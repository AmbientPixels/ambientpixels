/**
 * Blindspot Stubs — minimal shims for CardForge modules not actively used
 * EffectTiers and Entitlements are loaded by some shared code paths
 * but Blindspot doesn't use their features directly.
 */

window.EffectTiers = {
  getNewUnlocksForRank: function () { return {}; },
  isEffectUnlocked: function () { return true; },
  getSlotCap: function () { return 5; },
  getMaxBuffQty: function () { return 5; },
  isAuthenticated: function () { return false; }
};

window.Entitlements = {
  isPro: function () { return false; },
  hasFlag: function () { return false; },
  getTier: function () { return 'free'; },
  load: async function () {},
  showUpgradePrompt: function () {},
  showToast: function (msg) { console.log('[Blindspot]', msg); }
};
