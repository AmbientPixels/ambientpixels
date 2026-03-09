/**
 * adventure-entitlements.js — StoryForge client-side entitlements loader
 * Fetches user entitlements from /api/storyforge-entitlements and exposes on window.AdventureEntitlements.
 * Defaults to free tier on any failure (graceful degradation).
 */
window.AdventureEntitlements = (function () {
  'use strict';

  var DEV_BYPASS = true;

  var FREE_DEFAULTS = {
    tier: 'free',
    hasActiveSubscription: false,
    sfAllGenres: false,
    sfUnlimitedAdventures: false,
    sfAllImages: false,
    sfExtraSaves: false,
    dailyLimit: 3,
    imageFrequency: 2,
    maxSaveSlots: 1
  };

  var PRO_DEFAULTS = {
    tier: 'pro',
    hasActiveSubscription: true,
    sfAllGenres: true,
    sfUnlimitedAdventures: true,
    sfAllImages: true,
    sfExtraSaves: true,
    dailyLimit: 999,
    imageFrequency: 1,
    maxSaveSlots: 999
  };

  var _data = null;
  var _loadPromise = null;

  // --- Load entitlements from API ---
  function load() {
    if (_loadPromise) return _loadPromise;

    if (DEV_BYPASS) {
      console.warn('[SF Entitlements] DEV_BYPASS active — all features unlocked');
      _data = PRO_DEFAULTS;
      _loadPromise = Promise.resolve(_data);
      return _loadPromise;
    }

    _loadPromise = fetch('/api/storyforge-entitlements', {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    })
    .then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    })
    .then(function (data) {
      _data = data;
      return _data;
    })
    .catch(function (err) {
      console.warn('[SF Entitlements] Failed to load, defaulting to free:', err.message);
      _data = FREE_DEFAULTS;
      return _data;
    });

    return _loadPromise;
  }

  // --- Queries ---
  function isPro() {
    if (!_data) return false;
    return _data.hasActiveSubscription === true;
  }

  function canAccessGenre(genreId, genreTier) {
    if (!genreTier || genreTier === 'free') return true;
    return isPro();
  }

  function getDailyLimit() {
    return (_data && _data.dailyLimit) || FREE_DEFAULTS.dailyLimit;
  }

  function getImageFrequency() {
    return (_data && _data.imageFrequency) || FREE_DEFAULTS.imageFrequency;
  }

  function getMaxSaveSlots() {
    return (_data && _data.maxSaveSlots) || FREE_DEFAULTS.maxSaveSlots;
  }

  function getData() {
    return _data || FREE_DEFAULTS;
  }

  // --- Checkout ---
  function startCheckout(productId) {
    productId = productId || 'sf-pro-monthly';

    return fetch('https://ambientpixels-nova-api.azurewebsites.net/api/storyforge-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ productId: productId })
    })
    .then(function (resp) {
      if (!resp.ok) {
        return resp.json().catch(function () { return {}; }).then(function (errData) {
          throw new Error(errData.error || 'Checkout failed');
        });
      }
      return resp.json();
    })
    .then(function (data) {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    })
    .catch(function (err) {
      console.error('[SF Entitlements] Checkout error:', err.message);
      if (window.AdventureUI && window.AdventureUI.toast) {
        window.AdventureUI.toast('Could not start checkout. Please try again.', 'error');
      }
    });
  }

  // --- Upgrade Prompt ---
  function showUpgradePrompt(featureName) {
    // Remove existing
    var existing = document.getElementById('adv-upgrade-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'adv-upgrade-overlay';
    overlay.className = 'adv-upgrade-overlay';
    overlay.innerHTML =
      '<div class="adv-upgrade-modal">' +
        '<button class="adv-upgrade-close" aria-label="Close">&times;</button>' +
        '<div class="adv-upgrade-icon"><i class="fas fa-crown"></i></div>' +
        '<h3 class="adv-upgrade-title">Upgrade to StoryForge Pro</h3>' +
        '<p class="adv-upgrade-text">' + escapeHtml(featureName) + '</p>' +
        '<ul class="adv-upgrade-features">' +
          '<li><i class="fas fa-check"></i> All 6 genres unlocked</li>' +
          '<li><i class="fas fa-check"></i> Unlimited adventures per day</li>' +
          '<li><i class="fas fa-check"></i> AI images every scene</li>' +
          '<li><i class="fas fa-check"></i> Unlimited save slots</li>' +
        '</ul>' +
        '<div class="adv-upgrade-actions">' +
          '<button class="adv-btn adv-btn--primary adv-upgrade-btn">Upgrade — $10/mo</button>' +
          '<button class="adv-btn adv-upgrade-dismiss">Maybe Later</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('.adv-upgrade-close').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('.adv-upgrade-dismiss').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('.adv-upgrade-btn').addEventListener('click', function () {
      overlay.remove();
      startCheckout('sf-pro-monthly');
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    load: load,
    isPro: isPro,
    canAccessGenre: canAccessGenre,
    getDailyLimit: getDailyLimit,
    getImageFrequency: getImageFrequency,
    getMaxSaveSlots: getMaxSaveSlots,
    getData: getData,
    startCheckout: startCheckout,
    showUpgradePrompt: showUpgradePrompt
  };
})();
