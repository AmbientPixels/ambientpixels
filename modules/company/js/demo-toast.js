/**
 * Demo Toast — Shows friendly notifications when write attempts
 * are blocked on the read-only demo environment.
 * Self-activates on non-prod, non-local hostnames. No-op on prod.
 */
(function () {
  'use strict';

  var host = window.location.hostname;

  // Only activate on demo SWA (not prod, not localhost)
  if (host.indexOf('ambientpixels.ai') !== -1) return;
  if (host === 'localhost' || host === '127.0.0.1') return;

  window.__DEMO_MODE = true;

  // ── Inject toast CSS ──
  var style = document.createElement('style');
  style.textContent =
    '.demo-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);' +
    'background:rgba(99,102,241,0.95);color:#fff;padding:0.6rem 1.2rem;border-radius:8px;' +
    'font-size:0.8rem;font-weight:500;z-index:99999;pointer-events:none;opacity:0;' +
    'transition:opacity 0.3s,transform 0.3s;box-shadow:0 4px 20px rgba(0,0,0,0.3);' +
    'max-width:90vw;text-align:center;}' +
    '.demo-toast--show{opacity:1;transform:translateX(-50%) translateY(0);}';
  document.head.appendChild(style);

  // ── Toast element ──
  var toast = document.createElement('div');
  toast.className = 'demo-toast';
  document.body.appendChild(toast);

  var _toastTimer = null;
  var _lastToast = 0;

  function showDemoToast(msg) {
    var now = Date.now();
    // Debounce: don't spam toasts within 3 seconds
    if (now - _lastToast < 3000) return;
    _lastToast = now;

    toast.textContent = msg || 'This is a read-only demo — changes won\u2019t be saved.';
    toast.classList.add('demo-toast--show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      toast.classList.remove('demo-toast--show');
    }, 3000);
  }

  // ── Intercept fetch for 403 DEMO_READ_ONLY ──
  var _origFetch = window.fetch;
  window.fetch = function () {
    return _origFetch.apply(this, arguments).then(function (response) {
      if (response.status === 403) {
        // Clone so the original consumer can still read the body
        var clone = response.clone();
        clone.json().then(function (body) {
          if (body && body.error === 'DEMO_READ_ONLY') {
            showDemoToast();
          }
        }).catch(function () {});
      }
      return response;
    });
  };

  // Expose for quick-chat and other components
  window.showDemoToast = showDemoToast;
})();
