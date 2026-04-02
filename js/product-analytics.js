// product-analytics.js — Unified product analytics SDK for AmbientPixels
// Dual-write: App Insights (real-time) + blob ingest (durable).
// Non-blocking, silent-fail throughout — products never break because analytics failed.
(function () {
  'use strict';

  var INGEST_URL = '/api/productAnalyticsIngest';
  var FLUSH_INTERVAL_MS = 10000;
  var MAX_BUFFER = 100;

  var _product = '';
  var _sessionId = '';
  var _userId = '';
  var _isAuth = false;
  var _buffer = [];
  var _flushTimer = null;

  // ── Helpers ──

  function _genId(prefix) {
    return (prefix || 'evt') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function _getOrCreateSessionId() {
    try {
      var existing = sessionStorage.getItem('pa_session_id');
      if (existing) return existing;
      var id = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('pa_session_id', id);
      return id;
    } catch (e) {
      return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
  }

  function _detectUserId() {
    // Try auth module (AmbientPixels standard)
    try {
      if (window.authModule && typeof window.authModule.getCurrentUser === 'function') {
        var user = window.authModule.getCurrentUser();
        if (user && user.id) {
          _userId = user.id;
          _isAuth = true;
          return;
        }
      }
    } catch (e) { /* silent */ }

    // Try /.auth/me cached in sessionStorage
    try {
      var cached = sessionStorage.getItem('isAuthenticated');
      if (cached === 'true') {
        _isAuth = true;
        // userId may be set later via identify()
      }
    } catch (e) { /* silent */ }

    // Anonymous fingerprint (stable per browser, not PII)
    if (!_userId) {
      try {
        var stored = localStorage.getItem('pa_anon_id');
        if (stored) { _userId = stored; return; }
        var anon = 'anon_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('pa_anon_id', anon);
        _userId = anon;
      } catch (e) {
        _userId = 'anon_' + Math.random().toString(36).slice(2, 10);
      }
    }
  }

  function _buildEvent(event, category, props) {
    return {
      id: _genId('evt'),
      product: _product,
      event: event,
      category: category || 'engagement',
      ts: new Date().toISOString(),
      sessionId: _sessionId,
      userId: _userId,
      isAuth: _isAuth,
      page: location.pathname,
      props: props || {}
    };
  }

  function _sendToAppInsights(event, props) {
    try {
      if (window.__aiClient && typeof window.__aiClient.trackEvent === 'function') {
        var aiProps = { product: _product, category: props._category || 'engagement' };
        var p = props || {};
        for (var k in p) {
          if (k !== '_category' && p.hasOwnProperty(k)) {
            aiProps[k] = typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k]);
          }
        }
        window.__aiClient.trackEvent({ name: event, properties: aiProps });
      }
    } catch (e) { /* silent */ }
  }

  function _addToBuffer(evt) {
    _buffer.push(evt);
    if (_buffer.length >= MAX_BUFFER) {
      _flush();
    }
  }

  function _flush() {
    if (_buffer.length === 0) return;
    var batch = _buffer.splice(0);
    var payload = JSON.stringify({ events: batch });
    try {
      // Prefer sendBeacon for reliability (especially on pagehide)
      if (navigator.sendBeacon) {
        navigator.sendBeacon(INGEST_URL, new Blob([payload], { type: 'application/json' }));
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', INGEST_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
      }
    } catch (e) { /* silent — analytics must never break the product */ }
  }

  function _startFlushTimer() {
    if (_flushTimer) return;
    _flushTimer = setInterval(_flush, FLUSH_INTERVAL_MS);
  }

  function _setupPageLifecycle() {
    // Flush on page hide / unload
    var flushed = false;
    function flushOnce() {
      if (flushed) return;
      flushed = true;
      _flush();
    }
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushOnce();
      });
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', flushOnce);
      window.addEventListener('beforeunload', flushOnce);
    }
  }

  // ── Public API ──

  window.ProductAnalytics = {
    /**
     * Initialize analytics for a product. Call once per page.
     * @param {string} product — product identifier (e.g. 'blindspot', 'ambientscore')
     */
    init: function (product) {
      if (!product || typeof product !== 'string') return;
      _product = product;
      _sessionId = _getOrCreateSessionId();
      _detectUserId();
      _startFlushTimer();
      _setupPageLifecycle();

      // Auto-track page view
      this.track('page_view', {});
    },

    /**
     * Track a product event.
     * @param {string} event — event name (e.g. 'battle_end', 'scan_started')
     * @param {object} [props] — freeform properties
     */
    track: function (event, props) {
      if (!_product || !event) return;
      props = props || {};
      var category = props._category || 'engagement';
      _sendToAppInsights(_product + '_' + event, props);
      _addToBuffer(_buildEvent(event, category, props));
    },

    /**
     * Track a funnel step (convenience — sets category to 'funnel').
     * @param {string} step — funnel step name
     * @param {object} [props]
     */
    trackFunnel: function (step, props) {
      props = props || {};
      props._category = 'funnel';
      this.track(step, props);
    },

    /**
     * Track a conversion event (convenience — sets category to 'conversion').
     * @param {string} event — conversion event name
     * @param {object} [props]
     */
    trackConversion: function (event, props) {
      props = props || {};
      props._category = 'conversion';
      this.track(event, props);
    },

    /**
     * Track an error event (convenience — sets category to 'error').
     * @param {string} event — error event name
     * @param {object} [props]
     */
    trackError: function (event, props) {
      props = props || {};
      props._category = 'error';
      this.track(event, props);
    },

    /**
     * Set authenticated user ID. Call when auth state is confirmed.
     * @param {string} userId
     */
    identify: function (userId) {
      if (userId && typeof userId === 'string') {
        _userId = userId;
        _isAuth = true;
      }
    },

    /**
     * Force-flush the event buffer immediately.
     */
    flush: function () {
      _flush();
    }
  };
})();
