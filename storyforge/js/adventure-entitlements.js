/**
 * adventure-entitlements.js — StoryForge client-side entitlements loader
 * Fetches user entitlements from /api/storyforge-entitlements and exposes on window.AdventureEntitlements.
 * Defaults to free tier on any failure (graceful degradation).
 */
window.AdventureEntitlements = (function () {
  var DEBUG = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  'use strict';

  // DEV_BYPASS: true = everyone gets PRO (for testing). false = auth-based tiers.
  var DEV_BYPASS = false;

  // When DEV_BYPASS is off: signed in = PRO, signed out = FREE_DEFAULTS.
  function isAuthBypassed() {
    return DEV_BYPASS || sessionStorage.getItem('isAuthenticated') === 'true';
  }

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

    if (isAuthBypassed()) {
      DEBUG && console.info('[SF Entitlements] Authenticated user — PRO features unlocked');
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
      DEBUG && console.warn('[SF Entitlements] Failed to load, defaulting to free:', err.message);
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

    // Redirect to login if not signed in
    if (sessionStorage.getItem('isAuthenticated') !== 'true' &&
        !(document.body && document.body.getAttribute('data-auth-state') === 'signed-in')) {
      window.location.href = '/.auth/login/aad?post_login_redirect_uri=/storyforge/';
      return;
    }

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
          '<button class="adv-btn adv-btn--primary adv-upgrade-btn" data-product="sf-pro-monthly">$9.99 / month</button>' +
          '<button class="adv-btn adv-btn--primary adv-upgrade-btn" data-product="sf-pro-yearly" style="background:linear-gradient(135deg,#c471ed,#f64f59)">$7.99/mo (yearly)</button>' +
          '<button class="adv-btn adv-upgrade-dismiss">Maybe Later</button>' +
        '</div>' +
        '<p style="color:rgba(255,255,255,0.3);font-size:0.7rem;margin-top:0.5rem;text-align:center">Yearly plan billed at $95.88/year. Cancel anytime.</p>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('.adv-upgrade-close').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('.adv-upgrade-dismiss').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelectorAll('.adv-upgrade-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pid = this.getAttribute('data-product');
        overlay.remove();
        startCheckout(pid);
      });
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
