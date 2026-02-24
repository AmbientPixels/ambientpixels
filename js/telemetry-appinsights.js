// telemetry-appinsights.js — Lightweight Application Insights pageview telemetry
// Loads the AI browser SDK, initializes with connection string, tracks page views.
// Fails gracefully if no connection string or SDK unavailable.
(function () {
  'use strict';

  var CONNECTION_STRING = window.__AI_CONNECTION_STRING || '';

  // Bail silently if no connection string configured
  if (!CONNECTION_STRING) return;

  var SDK_URL = 'https://js.monitor.azure.com/scripts/b/ai.3.gbl.min.js';
  var SDK_TIMEOUT_MS = 8000;

  function _moduleName() {
    var path = location.pathname || '/';
    if (path === '/' || path === '/index.html') return 'home';
    var segs = path.replace(/^\/|\/$/g, '').split('/');
    return segs[segs.length - 1].replace(/\.html$/, '') || segs[0] || 'unknown';
  }

  function _stripPII(url) {
    try {
      var u = new URL(url, location.origin);
      var clean = new URLSearchParams();
      var keep = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref'];
      keep.forEach(function (k) {
        var v = u.searchParams.get(k);
        if (v) clean.set(k, v);
      });
      return u.pathname + (clean.toString() ? '?' + clean.toString() : '');
    } catch (e) {
      return location.pathname;
    }
  }

  function _initSDK() {
    if (typeof Microsoft === 'undefined' || !Microsoft.ApplicationInsights) {
      console.warn('[Telemetry] Application Insights SDK not available after load.');
      return;
    }

    try {
      var snippet = new Microsoft.ApplicationInsights.ApplicationInsights({
        config: {
          connectionString: CONNECTION_STRING,
          enableAutoRouteTracking: true,
          disableFetchTracking: false,
          enableCorsCorrelation: false,
          enableRequestHeaderTracking: false,
          enableResponseHeaderTracking: false,
          autoTrackPageVisitTime: true,
          disableAjaxTracking: true
        }
      });
      snippet.loadAppInsights();

      // Set custom context
      snippet.addTelemetryInitializer(function (envelope) {
        envelope.data = envelope.data || {};
        envelope.data.site = 'ambientpixels';
        envelope.data.module = _moduleName();
        // Strip PII from page view URLs
        if (envelope.baseType === 'PageviewData' && envelope.baseData) {
          envelope.baseData.uri = _stripPII(envelope.baseData.uri || location.href);
        }
      });

      // Track initial page view
      snippet.trackPageView({
        name: document.title,
        uri: _stripPII(location.href)
      });

      window.__aiClient = snippet;
    } catch (err) {
      console.warn('[Telemetry] Failed to initialize Application Insights:', err.message);
    }
  }

  // Load SDK dynamically
  var script = document.createElement('script');
  script.src = SDK_URL;
  script.crossOrigin = 'anonymous';
  script.async = true;

  var loaded = false;
  script.onload = function () {
    if (loaded) return;
    loaded = true;
    _initSDK();
  };
  script.onerror = function () {
    console.warn('[Telemetry] Failed to load Application Insights SDK.');
  };

  // Timeout guard
  setTimeout(function () {
    if (!loaded && !window.__aiClient) {
      console.warn('[Telemetry] SDK load timed out.');
    }
  }, SDK_TIMEOUT_MS);

  document.head.appendChild(script);
})();
