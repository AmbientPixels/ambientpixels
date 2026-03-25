/**
 * Blindspot Configuration
 * Forked from CardForge config.js — Blindspot-specific endpoints only
 */

window._config = window._config || {};

// Merge Blindspot endpoints (don't overwrite if already set by game-config.json)
window._config.apiEndpoints = {
  base: 'https://ambientpixels-nova-api.azurewebsites.net/api',
  // Blindspot-specific battle/bosses endpoints
  arenaBattle: 'blindspotbattle',
  arenaBosses: 'blindspotbosses',
  // Shared endpoints (product-agnostic)
  loadCards: 'cardforgeloadcards',
  saveCard: 'cardforgesavecards',
  arenaProfile: 'cardforgearenaprofile',
  arenaHistory: 'cardforgearenahistory',
  arenaLeaderboard: 'cardforgearenaleaderboard',
  blindspotProfile: 'blindspotprofile',
  // Async PvP endpoints
  defenseQueue: 'blindspotdefensequeue',
  asyncBattle: 'blindspotasyncbattle',
  resultsInbox: 'blindspotresultsinbox',
  // AI generation (shared)
  geminiProxy: 'geminiproxy'
};

window._config.environment = (window.location.hostname === 'ambientpixels.ai' || window.location.hostname.endsWith('.azurestaticapps.net')) ? 'production' : 'development';
window._config.debug = false;
window._config.version = 'v1.0';

/**
 * Builds a properly formatted API URL
 */
window.buildApiPath = function(endpoint, params) {
  params = params || {};
  var base = window._config.apiEndpoints.base;
  var path = window._config.apiEndpoints[endpoint];

  if (!path) {
    console.error('[BS-Config] Unknown endpoint: ' + endpoint);
    return '';
  }

  var parts = [];
  for (var key in params) {
    if (params.hasOwnProperty(key) && params[key] !== undefined && params[key] !== null) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    }
  }
  var qs = parts.length > 0 ? '?' + parts.join('&') : '';
  return base + '/' + path + qs;
};
