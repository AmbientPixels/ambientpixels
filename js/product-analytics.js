// product-analytics.js — Unified product analytics SDK for AmbientPixels
// Dual-write: App Insights (real-time) + blob ingest (durable).
// Non-blocking, silent-fail throughout — products never break because analytics failed.
(function () {
  'use strict';

  // Direct Function App URL — the SWA /api/* rewrite answers 405 to POST, which
  // silently dropped every beacon (0 events ingested across all products).
  var INGEST_URL = (location.hostname === 'localhost' ? '' : 'https://ambientpixels-nova-api.azurewebsites.net') + '/api/productAnalyticsIngest';
  var FLUSH_INTERVAL_MS = 10000;
  var MAX_BUFFER = 100;

  var _product = '';
  var _sessionId = '';
  var _userId = '';
  var _isAuth = false;
  var _buffer = [];
  var _flushTimer = null;

  // Internal-traffic flag: visit any page once with ?pa_internal=1 to mark
  // THIS device as ours (0 to unmark). Flagged devices' events carry
  // internal:true and are excluded from analytics by default, so our own
  // testing can never read as demand.
  var _internal = false;
  try {
    var _paiParam = new URLSearchParams(location.search).get('pa_internal');
    if (_paiParam === '1') localStorage.setItem('pa_internal', '1');
    else if (_paiParam === '0') localStorage.removeItem('pa_internal');
    _internal = localStorage.getItem('pa_internal') === '1';
  } catch (e) { /* private mode — never break tracking */ }

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

  // First-touch campaign attribution (revenue-visibility Gap 2): persist utm_content
  // (= originating post action id) + utm_source from the landing URL so they survive
  // navigation to the checkout page. First-touch wins — never overwrite.
  function _captureAttribution() {
    try {
      var p = new URLSearchParams(location.search);
      var c = p.get('utm_content'), s = p.get('utm_source');
      if (c && !localStorage.getItem('ap_utm_content')) {
        localStorage.setItem('ap_utm_content', String(c).slice(0, 120));
        if (s) localStorage.setItem('ap_utm_source', String(s).slice(0, 50));
      }
    } catch (e) { /* silent */ }
  }

  function _buildEvent(event, category, props) {
    // Stamp first-touch attribution onto EVERY event.
    //
    // Previously utm only reached events whose call site remembered to call
    // getAttribution() and pass it through — so checkout_started and email_captured
    // were attributable, but paywall_shown (the actual "they clicked the link"
    // signal) was not. Outbound clicks were therefore invisible: we could see a
    // purchase but never the visit that led to it. Injecting centrally kills that
    // whole class of bug and makes every future event attributable by default.
    //
    // Goes in props, not at the top level: productAnalyticsIngest sanitises to an
    // explicit field list and would drop unknown top-level fields, but passes props
    // through untouched.
    var p = {};
    var k;
    for (k in (props || {})) { if (Object.prototype.hasOwnProperty.call(props, k)) p[k] = props[k]; }
    try {
      if (!p.utm_content) {
        var c = localStorage.getItem('ap_utm_content');
        if (c) {
          p.utm_content = c;
          var s = localStorage.getItem('ap_utm_source');
          if (s && !p.utm_source) p.utm_source = s;
        }
      }
    } catch (e) { /* private mode / blocked storage — attribution is best-effort, never break tracking */ }
    return {
      id: _genId('evt'),
      product: _product,
      event: event,
      category: category || 'engagement',
      ts: new Date().toISOString(),
      sessionId: _sessionId,
      userId: _userId,
      isAuth: _isAuth,
      internal: _internal || undefined,
      page: location.pathname,
      props: p
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
      // fetch keepalive survives pagehide AND works cross-origin with a JSON
      // body; sendBeacon cannot (its JSON Blob needs a CORS preflight it never sends).
      if (window.fetch) {
        fetch(INGEST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function () { /* silent */ });
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
      _captureAttribution();
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
    },

    /**
     * First-touch campaign attribution captured from the landing URL.
     * Attach to a checkout POST body so revenue can be traced to the campaign.
     * @returns {{utm_content: string, utm_source: string}}
     */
    getAttribution: function () {
      try {
        return {
          utm_content: localStorage.getItem('ap_utm_content') || '',
          utm_source: localStorage.getItem('ap_utm_source') || ''
        };
      } catch (e) { return { utm_content: '', utm_source: '' }; }
    }
  };

  // Capture first-touch attribution on script load, even on pages that never call init().
  _captureAttribution();
})();
