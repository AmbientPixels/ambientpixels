/* forge-telemetry.js — silent-fail App Insights wrapper.
 * Per redesign-handoff.md Phase 3.6 + audit 0.3 strategy (C) "defer".
 *
 * CardForge's App Insights is disabled in production right now (config flag
 * + empty connection string, per audit 0.3). This wrapper:
 *   1. Falls through to console.debug in dev / when AI isn't bootstrapped.
 *   2. Auto-activates when prod flips `enableAppInsights` + populates the
 *      connection string — no call-site changes needed.
 *
 * Call sites across Phase 2/4/7 use `if (window.ForgeTelemetry) { ... }`
 * guards so pages load cleanly even if this script 404s.
 *
 * EXPORT API — this wrapper calls `window.AppInsightsService.trackEvent`,
 * NOT `window.appInsights` (audit 0.3 confirmed the existing global name).
 * Load this FIRST among forge scripts so every later module can emit events.
 */

(function () {
  'use strict';

  function hasRealService() {
    var svc = window.AppInsightsService;
    if (!svc || typeof svc.trackEvent !== 'function') return false;
    // isInitialized() returns false when the config flag is off — guards
    // against sending to a dead endpoint.
    if (typeof svc.isInitialized === 'function' && !svc.isInitialized()) return false;
    return true;
  }

  function track(name, props) {
    try {
      if (hasRealService()) {
        window.AppInsightsService.trackEvent({
          name: 'forge.' + name,
          properties: props || {}
        });
        return;
      }
      if (window.console && typeof console.debug === 'function') {
        console.debug('[forge-telemetry]', name, props || {});
      }
    } catch (e) {
      // Telemetry must never break the UI. Swallow everything.
    }
  }

  window.ForgeTelemetry = {
    track: track,
    // Expose the probe for dashboards / debug pages that want to inspect
    // whether real telemetry is flowing.
    _isActive: hasRealService
  };
})();
