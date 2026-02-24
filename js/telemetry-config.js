// telemetry-config.js — Centralized App Insights connection string config
// Reads from window.__AI_CONNECTION_STRING or global config.
// Include this BEFORE telemetry-appinsights.js on any page that needs telemetry.
(function () {
  'use strict';
  if (window.__AI_CONNECTION_STRING) return;
  // Check for global config object (e.g., from ap-config.js)
  if (window._config && window._config.appInsightsConnectionString) {
    window.__AI_CONNECTION_STRING = window._config.appInsightsConnectionString;
    return;
  }
  // Default: empty string (telemetry disabled until configured)
  window.__AI_CONNECTION_STRING = '';
})();
