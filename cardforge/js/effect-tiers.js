/**
 * Effect Tier Unlock System
 * Gates card effects behind arena rank progression.
 * Exposed on window.EffectTiers for use by card-forge-editor.js
 */
(function () {
  'use strict';

  const RANK_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

  // Maps each tier to the effects it unlocks (cumulative — higher tiers include all lower)
  const EFFECT_TIERS = {
    bronze: {
      bg:          ['none', 'grain', 'vignette'],
      border:      ['none', 'border', 'thick'],
      glow:        ['none', 'glow', 'soft-ambient'],
      imageFilter: ['none', 'sepia', 'grayscale'],
      overlay:     []
    },
    silver: {
      bg:          ['scanlines', 'frosted', 'linen', 'parchment'],
      border:      ['double', 'dashed', 'inset'],
      glow:        ['inner-glow', 'inner-shadow', 'drop-shadow'],
      imageFilter: ['vintage', 'noir', 'warm', 'cool', 'faded'],
      overlay:     []
    },
    gold: {
      bg:          ['foil', 'brushed-metal'],
      border:      ['ridge', 'beveled', 'corners'],
      glow:        ['neon-glow', 'halo'],
      imageFilter: ['high-contrast', 'duotone', 'bleach-bypass', 'vignette'],
      overlay:     []
    },
    platinum: {
      bg:          ['holographic', 'sparkle', 'aurora'],
      border:      ['animated-border'],
      glow:        ['pulse-glow'],
      imageFilter: ['cyberpunk', 'cross-process', 'infrared', 'midnight', 'emerald', 'sunset'],
      overlay:     []
    },
    diamond: {
      bg:          ['pulse', 'particles'],
      border:      [],
      glow:        ['color-shift'],
      imageFilter: [],
      overlay:     ['color-wash', 'gradient-fade', 'spotlight', 'haze']
    }
  };

  /**
   * Get the rank tier required to use a specific effect.
   * @param {string} category - bg, border, glow, imageFilter, or overlay
   * @param {string} value - the effect value (e.g. 'foil', 'neon-glow')
   * @returns {string|null} rank string or null if not found (treat as free)
   */
  function getEffectTier(category, value) {
    if (!value || value === 'none') return 'bronze';
    for (var i = 0; i < RANK_ORDER.length; i++) {
      var rank = RANK_ORDER[i];
      var tierEffects = EFFECT_TIERS[rank][category];
      if (tierEffects && tierEffects.indexOf(value) !== -1) {
        return rank;
      }
    }
    return null; // unknown effect — treat as unlocked
  }

  /**
   * Check if an effect is unlocked for the current user's rank.
   * @param {string} category - bg, border, glow, imageFilter, or overlay
   * @param {string} value - the effect value
   * @returns {boolean}
   */
  function isEffectUnlocked(category, value) {
    if (!value || value === 'none') return true;

    var requiredTier = getEffectTier(category, value);
    if (!requiredTier) return true; // unknown effect — allow

    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var userIdx = RANK_ORDER.indexOf(userRank);
    var requiredIdx = RANK_ORDER.indexOf(requiredTier);

    if (userIdx === -1) userIdx = 0; // fallback to bronze
    if (userIdx >= requiredIdx) return true;

    // Pro subscription unlocks all effects regardless of rank
    if (window.Entitlements && window.Entitlements.hasFlag('premiumEffects')) {
      return true;
    }

    return false;
  }

  /**
   * Get all unlocked effect values for a category at the current rank.
   * @param {string} category - bg, border, glow, imageFilter, or overlay
   * @returns {string[]}
   */
  function getUnlockedEffects(category) {
    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var userIdx = RANK_ORDER.indexOf(userRank);
    if (userIdx === -1) userIdx = 0;

    var unlocked = [];
    for (var i = 0; i <= userIdx; i++) {
      var tierEffects = EFFECT_TIERS[RANK_ORDER[i]][category];
      if (tierEffects) {
        unlocked = unlocked.concat(tierEffects);
      }
    }
    return unlocked;
  }

  /**
   * Get the display label for a rank.
   * @param {string} rank
   * @returns {string}
   */
  function getRankLabel(rank) {
    if (!rank) return 'Bronze';
    return rank.charAt(0).toUpperCase() + rank.slice(1);
  }

  // Rank metadata — single source of truth for icons, colors, XP thresholds
  var RANK_CONFIG = {
    bronze:   { xpRequired: 0,    icon: 'fa-shield-halved', color: '#CD7F32', label: 'Bronze' },
    silver:   { xpRequired: 500,  icon: 'fa-shield',        color: '#C0C0C0', label: 'Silver' },
    gold:     { xpRequired: 1500, icon: 'fa-crown',         color: '#FFD700', label: 'Gold' },
    platinum: { xpRequired: 3500, icon: 'fa-gem',           color: '#E5E4E2', label: 'Platinum' },
    diamond:  { xpRequired: 7000, icon: 'fa-diamond',       color: '#B9F2FF', label: 'Diamond' }
  };

  // Rank-based slot caps — buffs & attributes unlock more slots as players progress
  // Guest tier = signed-out users (1 slot to incentivize sign-in)
  var SLOT_CAPS = {
    guest:    { buffs: 1, attributes: 1 },
    bronze:   { buffs: 2, attributes: 2 },
    silver:   { buffs: 3, attributes: 3 },
    gold:     { buffs: 4, attributes: 4 },
    platinum: { buffs: 4, attributes: 4 },
    diamond:  { buffs: 4, attributes: 4 }
  };

  // Rank-based max quantity per buff — higher ranks stack stronger passives
  var QTY_CAPS = {
    guest:    1,
    bronze:   1,
    silver:   2,
    gold:     3,
    platinum: 4,
    diamond:  5
  };

  /**
   * Check whether the current user is authenticated.
   * Used to distinguish guest (signed-out) from bronze (signed-in, rank 0).
   */
  function isAuthenticated() {
    if (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return true;
    return sessionStorage.getItem('isAuthenticated') === 'true' ||
           (document.body && document.body.getAttribute('data-auth-state') === 'signed-in');
  }

  /**
   * Get the max buff/attribute slots for the current user's rank.
   * @param {string} slotType — 'buffs' or 'attributes'
   * @returns {number}
   */
  function getSlotCap(slotType) {
    // Pro subscription unlocks max slots
    if (window.Entitlements && window.Entitlements.isPro && window.Entitlements.isPro()) {
      return 4;
    }
    // Signed-out users get guest tier (1 slot) to incentivize sign-in
    if (!isAuthenticated()) {
      return SLOT_CAPS.guest[slotType] || 1;
    }
    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var caps = SLOT_CAPS[userRank] || SLOT_CAPS.bronze;
    return caps[slotType] || 2;
  }

  /**
   * Get the max quantity per buff for the current user's rank.
   * @returns {number} 1-5
   */
  function getMaxBuffQty() {
    // Pro subscription unlocks max qty
    if (window.Entitlements && window.Entitlements.isPro && window.Entitlements.isPro()) {
      return 5;
    }
    // Signed-out users locked to ×1
    if (!isAuthenticated()) {
      return 1;
    }
    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    return QTY_CAPS[userRank] || 1;
  }

  var CATEGORY_LABELS = {
    bg: 'Backgrounds',
    border: 'Borders',
    glow: 'Glows',
    imageFilter: 'Filters',
    overlay: 'Overlays'
  };

  var CATEGORIES = ['bg', 'border', 'glow', 'imageFilter', 'overlay'];

  /**
   * Get the next rank after currentRank, or null if at max.
   */
  function getNextRank(currentRank) {
    var idx = RANK_ORDER.indexOf(currentRank);
    if (idx < 0 || idx >= RANK_ORDER.length - 1) return null;
    return RANK_ORDER[idx + 1];
  }

  /**
   * Get effects unlocked at a specific rank, grouped by display label.
   * Returns { 'Backgrounds': ['foil', ...], 'Filters': [...] } — only non-empty.
   */
  function getNewUnlocksForRank(rank) {
    var tierEffects = EFFECT_TIERS[rank];
    if (!tierEffects) return {};
    var result = {};
    for (var i = 0; i < CATEGORIES.length; i++) {
      var cat = CATEGORIES[i];
      var names = tierEffects[cat];
      if (names && names.length > 0) {
        // Filter out 'none' from display
        var display = names.filter(function (n) { return n !== 'none'; });
        if (display.length > 0) result[CATEGORY_LABELS[cat]] = display;
      }
    }
    return result;
  }

  /**
   * Render the Rank Rewards panel into a container.
   */
  function renderRankRewardsPanel(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var userIdx = RANK_ORDER.indexOf(userRank);
    if (userIdx === -1) userIdx = 0;

    var html = '';
    for (var i = 0; i < RANK_ORDER.length; i++) {
      var rank = RANK_ORDER[i];
      var cfg = RANK_CONFIG[rank];
      var effects = EFFECT_TIERS[rank];
      var isUnlocked = i <= userIdx;
      var isCurrent = i === userIdx;

      // Build grouped effect list
      var effectList = '';
      for (var c = 0; c < CATEGORIES.length; c++) {
        var cat = CATEGORIES[c];
        var names = effects[cat];
        if (names && names.length > 0) {
          var display = names.filter(function (n) { return n !== 'none'; });
          if (display.length > 0) {
            effectList += '<div class="arena-rewards__category">' +
              '<span class="arena-rewards__cat-label">' + CATEGORY_LABELS[cat] + ':</span> ' +
              '<span class="arena-rewards__cat-effects">' + display.join(', ') + '</span>' +
              '</div>';
          }
        }
      }

      // Buff progression info — slots, qty cap, newly unlocked buffs
      var slotCap = SLOT_CAPS[rank] || SLOT_CAPS.bronze;
      var qtyCap = QTY_CAPS[rank] || 1;
      effectList += '<div class="arena-rewards__category arena-rewards__category--buffs">' +
        '<span class="arena-rewards__cat-label">Buff Slots:</span> ' +
        '<span class="arena-rewards__cat-effects">' + slotCap.buffs + ' slots, &times;' + qtyCap + ' max qty</span>' +
        '</div>';

      // Show which buffs unlock at this rank
      var rankBuffs = BUFF_DEFS.filter(function (b) { return b.rank === rank; });
      if (rankBuffs.length > 0) {
        var buffNames = rankBuffs.map(function (b) { return b.label; }).join(', ');
        effectList += '<div class="arena-rewards__category arena-rewards__category--buffs">' +
          '<span class="arena-rewards__cat-label">New Buffs:</span> ' +
          '<span class="arena-rewards__cat-effects">' + buffNames + '</span>' +
          '</div>';
      }

      if (!effectList) continue; // skip empty tiers

      var stateClass = isUnlocked ? 'arena-rewards__tier--unlocked' : 'arena-rewards__tier--locked';
      if (isCurrent) stateClass += ' arena-rewards__tier--current';
      var stateIcon = isUnlocked ? 'fa-check-circle' : 'fa-lock';

      html += '<div class="arena-rewards__tier ' + stateClass + '">' +
        '<div class="arena-rewards__tier-header">' +
          '<span class="arena-rewards__tier-icon"><i class="fas ' + cfg.icon + '" style="color:' + cfg.color + '"></i></span>' +
          '<span class="arena-rewards__tier-label">' + cfg.label + '</span>' +
          '<span class="arena-rewards__tier-xp">' + cfg.xpRequired + ' XP</span>' +
          '<span class="arena-rewards__tier-state"><i class="fas ' + stateIcon + '"></i></span>' +
        '</div>' +
        '<div class="arena-rewards__tier-body">' + effectList + '</div>' +
      '</div>';
    }

    container.innerHTML = html;
  }

  /**
   * Render the "Next at [Rank]" preview widget into a container.
   */
  function renderNextRankPreview(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var nextRank = getNextRank(userRank);

    if (!nextRank) {
      container.innerHTML =
        '<div class="arena-next-rank arena-next-rank--max">' +
          '<i class="fas fa-diamond" style="color:#B9F2FF"></i> ' +
          '<span>All effects &amp; buffs unlocked!</span>' +
        '</div>';
      return;
    }

    var cfg = RANK_CONFIG[nextRank];
    var effects = EFFECT_TIERS[nextRank];

    // Collect all non-none effect names from this tier
    var allEffects = [];
    for (var i = 0; i < CATEGORIES.length; i++) {
      var names = effects[CATEGORIES[i]];
      if (names) {
        for (var j = 0; j < names.length; j++) {
          if (names[j] !== 'none') allEffects.push(names[j]);
        }
      }
    }

    // Add buff progression info
    var curSlots = SLOT_CAPS[userRank] ? SLOT_CAPS[userRank].buffs : 2;
    var nextSlots = SLOT_CAPS[nextRank] ? SLOT_CAPS[nextRank].buffs : 2;
    var curQty = QTY_CAPS[userRank] || 1;
    var nextQty = QTY_CAPS[nextRank] || 1;
    var buffUpgrades = [];
    if (nextSlots > curSlots) buffUpgrades.push(nextSlots + ' buff slots');
    if (nextQty > curQty) buffUpgrades.push('&times;' + nextQty + ' max qty');
    var nextBuffs = BUFF_DEFS.filter(function (b) { return b.rank === nextRank; });
    if (nextBuffs.length > 0) {
      buffUpgrades.push(nextBuffs.map(function (b) { return b.label; }).join(', '));
    }

    var preview = allEffects.slice(0, 4).join(', ');
    if (allEffects.length > 4) preview += ', +' + (allEffects.length - 4) + ' more';
    if (buffUpgrades.length > 0) {
      preview += (preview ? ' | ' : '') + buffUpgrades.join(', ');
    }

    container.innerHTML =
      '<div class="arena-next-rank">' +
        '<i class="fas ' + cfg.icon + '" style="color:' + cfg.color + '"></i> ' +
        '<span class="arena-next-rank__label">Next at <strong>' + cfg.label + '</strong>:</span> ' +
        '<span class="arena-next-rank__effects">' + preview + '</span>' +
      '</div>';
  }

  // ── Buff & Trait Tier System ─────────────────────────────────────
  // Single source of truth for all buff/trait definitions + rank gating.
  // Each buff has a unique key, display label, icon, description, and required rank.

  var BUFF_DEFS = [
    // Bronze — basic combat buffs (available to all)
    { key: 'fury',      label: 'Fury',      icon: 'fire',     description: '+25% melee damage for 3 turns',   rank: 'bronze' },
    { key: 'aegis',     label: 'Aegis',     icon: 'shield',   description: 'Blocks the next incoming attack', rank: 'bronze' },
    { key: 'fortitude', label: 'Fortitude', icon: 'medal',    description: '+20% max HP this round',          rank: 'bronze' },
    { key: 'regen',     label: 'Regen',     icon: 'heart',    description: 'Restore 10 HP per turn',          rank: 'bronze' },

    // Silver — tactical buffs
    { key: 'rally',     label: 'Rally',     icon: 'crown',    description: '+15% team damage when leading',   rank: 'silver' },
    { key: 'focus',     label: 'Focus',     icon: 'bullseye', description: '+40% critical hit chance',        rank: 'silver' },
    { key: 'overload',  label: 'Overload',  icon: 'bolt',     description: 'Double energy regen for 2 turns', rank: 'silver' },

    // Gold — advanced buffs
    { key: 'arcane',    label: 'Arcane',    icon: 'gem',      description: '+30% spell potency',              rank: 'gold' },
    { key: 'triumph',   label: 'Triumph',   icon: 'trophy',   description: 'Bonus XP on next victory',       rank: 'gold' },

    // Platinum+ — elite buffs
    { key: 'legendary', label: 'Legendary', icon: 'star',     description: 'All stats boosted by 10%',       rank: 'platinum' }
  ];

  /**
   * Get the rank required for a specific buff.
   * @param {string} key — buff key (e.g. 'fury', 'arcane')
   * @returns {string|null} rank or null if unknown
   */
  function getBuffTier(key) {
    if (!key) return null;
    var def = BUFF_DEFS.find(function (d) { return d.key === key.toLowerCase(); });
    return def ? def.rank : null;
  }

  /**
   * Check if a buff is unlocked for the current user's rank.
   * @param {string} key — buff key
   * @returns {boolean}
   */
  function isBuffUnlocked(key) {
    if (!key) return true;
    var requiredRank = getBuffTier(key);
    if (!requiredRank) return true; // unknown buff — allow

    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var userIdx = RANK_ORDER.indexOf(userRank);
    var requiredIdx = RANK_ORDER.indexOf(requiredRank);

    if (userIdx === -1) userIdx = 0;
    if (userIdx >= requiredIdx) return true;

    // Pro subscription unlocks all buffs
    if (window.Entitlements && window.Entitlements.hasFlag('premiumEffects')) {
      return true;
    }

    return false;
  }

  /**
   * Get all unlocked buff definitions for the current rank.
   * @returns {Array} array of buff def objects
   */
  function getUnlockedBuffs() {
    return BUFF_DEFS.filter(function (d) { return isBuffUnlocked(d.key); });
  }

  /**
   * Get the tooltip text for the ×N multiplier display.
   * Explains progression to next qty tier.
   */
  function getQtyTooltip() {
    var maxQty = getMaxBuffQty();
    if (!isAuthenticated()) {
      return 'Sign in and play Arena to unlock multiplier stacking';
    }
    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var nextRank = getNextRank(userRank);
    if (!nextRank) return 'Max multiplier reached (\u00d7' + maxQty + ')';
    var nextQty = QTY_CAPS[nextRank] || maxQty;
    if (nextQty <= maxQty) return 'Current max: \u00d7' + maxQty;
    return 'Current max: \u00d7' + maxQty + ' \u2014 reach ' + getRankLabel(nextRank) + ' for \u00d7' + nextQty;
  }

  /**
   * Describe what the next rank unlocks for buffs (slots, qty, new buff names).
   * Returns null if at max rank or Pro.
   */
  function getNextBuffUnlockDescription() {
    if (!isAuthenticated()) {
      return 'Sign in to unlock more buff slots, higher multipliers, and new buff types.';
    }
    if (window.Entitlements && window.Entitlements.isPro && window.Entitlements.isPro()) return null;
    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var nextRank = getNextRank(userRank);
    if (!nextRank) return null;

    var parts = [];
    var currentSlots = (SLOT_CAPS[userRank] || SLOT_CAPS.bronze).buffs;
    var nextSlots = (SLOT_CAPS[nextRank] || SLOT_CAPS.bronze).buffs;
    if (nextSlots > currentSlots) parts.push(nextSlots + ' buff slots');

    var currentQty = QTY_CAPS[userRank] || 1;
    var nextQty = QTY_CAPS[nextRank] || 1;
    if (nextQty > currentQty) parts.push('\u00d7' + nextQty + ' stacking');

    var newBuffs = BUFF_DEFS.filter(function (d) { return d.rank === nextRank; });
    if (newBuffs.length > 0) {
      parts.push(newBuffs.map(function (b) { return b.label; }).join(', '));
    }

    var xpNeeded = RANK_CONFIG[nextRank].xpRequired - ((profile && profile.xp) || 0);
    if (xpNeeded < 0) xpNeeded = 0;
    return xpNeeded + ' XP to ' + getRankLabel(nextRank) + ' \u2014 unlocks ' + parts.join(', ') + '.';
  }

  /**
   * Get the effective rank label for display (includes 'Guest' for signed-out).
   */
  function getEffectiveRankLabel() {
    if (!isAuthenticated()) return 'Guest';
    var profile = window._arenaProfile;
    var userRank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    return getRankLabel(userRank);
  }

  // Expose API
  window.EffectTiers = {
    EFFECT_TIERS: EFFECT_TIERS,
    RANK_ORDER: RANK_ORDER,
    RANK_CONFIG: RANK_CONFIG,
    CATEGORY_LABELS: CATEGORY_LABELS,
    getEffectTier: getEffectTier,
    isEffectUnlocked: isEffectUnlocked,
    getUnlockedEffects: getUnlockedEffects,
    getRankLabel: getRankLabel,
    getNextRank: getNextRank,
    getNewUnlocksForRank: getNewUnlocksForRank,
    renderRankRewardsPanel: renderRankRewardsPanel,
    renderNextRankPreview: renderNextRankPreview,
    BUFF_DEFS: BUFF_DEFS,
    SLOT_CAPS: SLOT_CAPS,
    getBuffTier: getBuffTier,
    isBuffUnlocked: isBuffUnlocked,
    getUnlockedBuffs: getUnlockedBuffs,
    getSlotCap: getSlotCap,
    QTY_CAPS: QTY_CAPS,
    getMaxBuffQty: getMaxBuffQty,
    isAuthenticated: isAuthenticated,
    getQtyTooltip: getQtyTooltip,
    getNextBuffUnlockDescription: getNextBuffUnlockDescription,
    getEffectiveRankLabel: getEffectiveRankLabel
  };
})();

