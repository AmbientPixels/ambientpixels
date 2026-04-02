/**
 * CardForge Configuration
 * Central configuration file for all CardForge settings
 * Updated 2025-07-19: Added production API endpoints and improved environment detection
 */

window._config = {
  // Environment settings
  environment: (window.location.hostname === 'ambientpixels.ai' || window.location.hostname.endsWith('.azurestaticapps.net')) ? 'production' : 'development',
  
  // API Configuration
  apiEndpoints: {
    base: 'https://ambientpixels-nova-api.azurewebsites.net/api',
    loadCards: 'cardforgeloadcards',
    saveCard: 'cardforgesavecards',
    deleteCard: 'cardforgedeletecard',
    publish: 'cardforgepublish',
    deckPublish: 'cardforgedeckpublish',
    deckLoad: 'cardforgedeckload',
    deckDelete: 'cardforgedeckdelete',
    template: 'cardforgetemplate',
    cardShare: 'cardshare',
    deckShare: 'deckshare',
    entitlements: 'cardforge-entitlements',
    checkout: 'cardforge-checkout',
    billingPortal: 'cardforge-billing-portal',
    blindspotProfile: 'blindspotprofile'
  },
  
  // Application Insights - Disabled in production until 400 errors are resolved
  appInsightsConnectionString: '',
  enableAppInsights: false,
  
  // Admin userIds — users who can remove any card from the gallery
  adminUserIds: ['5bb115c5-9077-4049-8af0-ce5085a9c315'],

  // Debug settings - Always off in production
  debug: false,
  version: 'v2.2',
  
  // Feature flags - Optimized for production
  features: {
    useMockData: false,  // Always use real API in production
    enableOfflineMode: false  // Disable offline mode in production
  }
};

/**
 * Builds a properly formatted API URL
 * @param {string} endpoint - The API endpoint name (e.g., 'loadCards', 'saveCard')
 * @param {Object} [params={}] - Query parameters as key-value pairs
 * @returns {string} Full API URL with parameters
 */
window.buildApiPath = function(endpoint, params = {}) {
  const baseUrl = window._config.apiEndpoints.base;
  const path = window._config.apiEndpoints[endpoint];
  
  if (!path) {
    console.error(`[Config] Unknown endpoint: ${endpoint}`);
    return '';
  }
  
  // Build query string from params
  const queryString = Object.entries(params)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  
  return `${baseUrl}/${path}${queryString ? '?' + queryString : ''}`;
};

// Auth helper — fetches principal from /.auth/me for API calls
// (Replaces ArenaAPI.getPrincipalHeader which was in the removed arena-api.js)
window._cfGetAuthHeaders = (function () {
  var _cached = null;
  return async function () {
    if (_cached) return _cached;
    try {
      var resp = await fetch('/.auth/me');
      if (!resp.ok) return {};
      var data = await resp.json();
      var principal = data.clientPrincipal;
      if (principal && principal.userId) {
        _cached = { 'X-CF-Auth-Principal': JSON.stringify(principal) };
        return _cached;
      }
    } catch (e) { /* silent */ }
    return {};
  };
})();

// EffectTiers shim — all effects unlocked (arena removed, no rank gating)
// Covers every method the editor calls on window.EffectTiers
window.EffectTiers = {
  // Slot caps — return max
  getSlotCap: function () { return 4; },
  getMaxBuffQty: function () { return 3; },
  // Unlock checks — always true
  isEffectUnlocked: function () { return true; },
  isBuffUnlocked: function () { return true; },
  // Return all effects/buffs as unlocked
  getUnlockedBuffs: function () { return this.BUFF_DEFS; },
  getUnlockedEffects: function (cat) {
    var all = this.EFFECT_TIERS || {};
    var result = ['none', 'clean'];
    for (var rank in all) { var effs = all[rank][cat]; if (effs) result = result.concat(effs); }
    return result;
  },
  // Tier/rank helpers — no locking
  getEffectTier: function () { return 'bronze'; },
  getRankLabel: function () { return ''; },
  getNextBuffUnlockDescription: function () { return null; },
  getQtyTooltip: function () { return ''; },
  // Rank data
  RANK_ORDER: ['bronze', 'silver', 'gold', 'platinum', 'diamond'],
  EFFECT_TIERS: {
    bronze: { bg: ['gradient', 'radial', 'split'], border: ['thin', 'thick', 'double'], glow: ['soft', 'pulse'], imageFilter: ['grayscale', 'sepia'], overlay: ['noise', 'scanlines'] },
    silver: { bg: ['mesh', 'diagonal'], border: ['ornate', 'rounded'], glow: ['neon', 'rainbow'], imageFilter: ['contrast', 'hue-rotate'], overlay: ['vignette'] },
    gold: { bg: ['aurora', 'fire'], border: ['animated', 'holographic'], glow: ['fire', 'electric'], imageFilter: ['invert', 'saturate'], overlay: ['bloom', 'dust'] },
    platinum: { bg: ['void', 'cosmic'], border: ['crystal', 'shadow'], glow: ['cosmic', 'shadow'], imageFilter: ['pixelate', 'halftone'], overlay: ['glitch', 'matrix'] },
    diamond: { bg: ['prismatic'], border: ['divine'], glow: ['divine'], imageFilter: ['duotone'], overlay: ['holographic'] }
  },
  // Buff definitions
  BUFF_DEFS: [
    { key: 'attack_boost', label: 'Attack Boost', icon: 'sword', description: '+10% attack power' },
    { key: 'defense_boost', label: 'Defense Boost', icon: 'shield', description: '+10% defense' },
    { key: 'speed_boost', label: 'Speed Boost', icon: 'bolt', description: '+10% speed' },
    { key: 'heal_boost', label: 'Heal Boost', icon: 'heart', description: '+10% healing' },
    { key: 'crit_boost', label: 'Critical Boost', icon: 'crosshairs', description: '+10% crit chance' },
    { key: 'luck_boost', label: 'Luck Boost', icon: 'clover', description: '+10% luck' },
    { key: 'shield_wall', label: 'Shield Wall', icon: 'shield-halved', description: 'Block incoming damage' },
    { key: 'berserker', label: 'Berserker', icon: 'fire', description: 'Deal more damage at low HP' },
    { key: 'regeneration', label: 'Regeneration', icon: 'heart-pulse', description: 'Heal over time' },
    { key: 'evasion', label: 'Evasion', icon: 'feather', description: 'Chance to dodge attacks' }
  ]
};

// Environment info available via window._config.environment and window._config.debug
