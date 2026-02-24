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
  // Default connection string for ambientpixels-nova-api App Insights
  window.__AI_CONNECTION_STRING = 'InstrumentationKey=f650ea01-7514-47d5-b825-c6c95b2d6a07;IngestionEndpoint=https://westus2-2.in.applicationinsights.azure.com/;LiveEndpoint=https://westus2.livediagnostics.monitor.azure.com/;ApplicationId=a99b7174-9be0-4845-aa1f-097ed739752a';
})();
