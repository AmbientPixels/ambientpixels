/**
 * CardForge Entitlements — Client-side billing entitlements loader
 * Fetches user entitlements from the API and exposes them on window.Entitlements.
 * Defaults to free tier on any failure (graceful degradation).
 */
(function () {
  'use strict';

  var FREE_DEFAULTS = {
    tier: 'free',
    flags: {},
    subscriptionStatus: null,
    hasActiveSubscription: false
  };

  // Stored entitlements data
  var _data = null;
  var _loaded = false;

  /**
   * Load entitlements from the API. Sets window._userEntitlements.
   */
  async function load() {
    try {
      var endpoint = window.buildApiPath ? window.buildApiPath('entitlements') : '/api/cardforge-entitlements';
      if (!endpoint) endpoint = '/api/cardforge-entitlements';

      var headers = { 'Content-Type': 'application/json' };

      // Forward auth principal if available
      var principal = sessionStorage.getItem('cf_auth_principal') || localStorage.getItem('cf_auth_principal');
      if (principal) {
        headers['X-CF-Auth-Principal'] = principal;
      }

      var resp = await fetch(endpoint, { headers: headers, credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      _data = await resp.json();
      _loaded = true;
    } catch (err) {
      console.warn('[Entitlements] Failed to load, defaulting to free:', err.message);
      _data = FREE_DEFAULTS;
      _loaded = true;
    }

    window._userEntitlements = _data;
    return _data;
  }

  /**
   * Check if user has an active Pro subscription.
   */
  function isPro() {
    if (!_data) return false;
    return _data.tier === 'pro' && _data.hasActiveSubscription === true;
  }

  /**
   * Check if user has a specific entitlement flag.
   * Pro users get all standard flags automatically.
   */
  function hasFlag(flag) {
    if (!_data) return false;
    if (isPro()) return true;
    return !!(_data.flags && _data.flags[flag]);
  }

  /**
   * Get current tier ('free' or 'pro').
   */
  function getTier() {
    return (_data && _data.tier) || 'free';
  }

  /**
   * Start a Stripe checkout session for a product.
   * Redirects the user to Stripe Checkout.
   */
  function isSignedIn() {
    return sessionStorage.getItem('isAuthenticated') === 'true' ||
           (document.body && document.body.getAttribute('data-auth-state') === 'signed-in');
  }

  async function startCheckout(productId) {
    // Redirect to login if not signed in
    if (!isSignedIn()) {
      window.location.href = '/.auth/login/aad?post_login_redirect_uri=/cardforge/';
      return;
    }

    try {
      var endpoint = window.buildApiPath ? window.buildApiPath('checkout') : '/api/cardforge-checkout';
      if (!endpoint) endpoint = '/api/cardforge-checkout';

      var headers = { 'Content-Type': 'application/json' };
      var principal = sessionStorage.getItem('cf_auth_principal') || localStorage.getItem('cf_auth_principal');
      if (principal) {
        headers['X-CF-Auth-Principal'] = principal;
      }

      var resp = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({ productId: productId })
      });

      if (!resp.ok) {
        var errData = await resp.json().catch(function () { return {}; });
        throw new Error(errData.error || 'Checkout failed');
      }

      var data = await resp.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      console.error('[Entitlements] Checkout error:', err.message);
      showUpgradeError('Could not start checkout. Please try again.');
    }
  }

  /**
   * Open the Stripe Billing Portal for subscription management.
   */
  async function openBillingPortal() {
    try {
      var endpoint = window.buildApiPath ? window.buildApiPath('billingPortal') : '/api/cardforge-billing-portal';
      if (!endpoint) endpoint = '/api/cardforge-billing-portal';

      var headers = { 'Content-Type': 'application/json' };
      var principal = sessionStorage.getItem('cf_auth_principal') || localStorage.getItem('cf_auth_principal');
      if (principal) {
        headers['X-CF-Auth-Principal'] = principal;
      }

      var resp = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        credentials: 'include'
      });

      if (!resp.ok) {
        var errData = await resp.json().catch(function () { return {}; });
        throw new Error(errData.error || 'Portal failed');
      }

      var data = await resp.json();
      if (data.portalUrl) {
        window.location.href = data.portalUrl;
      }
    } catch (err) {
      console.error('[Entitlements] Billing portal error:', err.message);
      showUpgradeError('Could not open billing portal. Please try again.');
    }
  }

  /**
   * Show an upgrade prompt for a gated feature.
   * @param {string} featureName — what the user tried to access (e.g., 'HD Export')
   * @param {string} [productId='cf-pro-monthly'] — default product to offer
   */
  function showUpgradePrompt(featureName, productId) {
    productId = productId || 'cf-pro-monthly';

    // Remove any existing prompt
    var existing = document.getElementById('cf-upgrade-prompt');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'cf-upgrade-prompt';
    overlay.className = 'cf-upgrade-overlay';
    overlay.innerHTML =
      '<div class="cf-upgrade-modal">' +
        '<button class="cf-upgrade-close" aria-label="Close">&times;</button>' +
        '<div class="cf-upgrade-icon"><i class="fas fa-crown" style="color:#FFD700;font-size:2rem"></i></div>' +
        '<h3 class="cf-upgrade-title">Upgrade to Pro</h3>' +
        '<p class="cf-upgrade-text">' + escapeHtml(featureName) + ' requires CardForge Pro.</p>' +
        '<p class="cf-upgrade-features">HD exports, premium effects, extra card slots</p>' +
        '<button class="cf-upgrade-btn" data-product="' + escapeHtml(productId) + '">Upgrade Now</button>' +
        '<button class="cf-upgrade-dismiss">Maybe Later</button>' +
      '</div>';

    document.body.appendChild(overlay);

    // Event handlers
    overlay.querySelector('.cf-upgrade-close').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('.cf-upgrade-dismiss').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('.cf-upgrade-btn').addEventListener('click', function () {
      var pid = this.getAttribute('data-product');
      overlay.remove();
      startCheckout(pid);
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
  }

  /**
   * Show a simple error toast.
   */
  function showUpgradeError(msg) {
    var toast = document.createElement('div');
    toast.className = 'cf-upgrade-toast cf-upgrade-toast--error';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('cf-upgrade-toast--removing');
      setTimeout(function () { toast.remove(); }, 300);
    }, 4000);
  }

  /**
   * Show a general-purpose toast notification.
   * @param {string} msg — message text
   * @param {'success'|'info'|'error'} [type='info']
   */
  function showToast(msg, type) {
    var toast = document.createElement('div');
    toast.className = 'cf-upgrade-toast cf-upgrade-toast--' + (type || 'info');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('cf-upgrade-toast--removing');
      setTimeout(function () { toast.remove(); }, 300);
    }, 5000);
  }

  // Use shared escapeHtml from UIUtils (loaded before entitlements.js)
  function escapeHtml(str) {
    return (window.UIUtils && window.UIUtils.escapeHtml)
      ? window.UIUtils.escapeHtml(str)
      : (function() { var d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; })();
  }

  // Expose API
  window.Entitlements = {
    load: load,
    isPro: isPro,
    hasFlag: hasFlag,
    getTier: getTier,
    startCheckout: startCheckout,
    openBillingPortal: openBillingPortal,
    showUpgradePrompt: showUpgradePrompt,
    showToast: showToast
  };
})();
