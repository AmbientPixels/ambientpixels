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
          '<span>All effects unlocked!</span>' +
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

    var preview = allEffects.slice(0, 5).join(', ');
    if (allEffects.length > 5) preview += ', +' + (allEffects.length - 5) + ' more';

    container.innerHTML =
      '<div class="arena-next-rank">' +
        '<i class="fas ' + cfg.icon + '" style="color:' + cfg.color + '"></i> ' +
        '<span class="arena-next-rank__label">Next at <strong>' + cfg.label + '</strong>:</span> ' +
        '<span class="arena-next-rank__effects">' + preview + '</span>' +
      '</div>';
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
    renderNextRankPreview: renderNextRankPreview
  };
})();

