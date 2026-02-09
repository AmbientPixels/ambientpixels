/**
 * CardForge Configuration
 * Central configuration file for all CardForge settings
 * Updated 2025-07-19: Added production API endpoints and improved environment detection
 */

window._config = {
  // Environment settings
  environment: (window.location.hostname === 'ambientpixels.ai' || window.location.hostname.endsWith('.azurestaticapps.net')) ? 'production' : 'development',
  
  // API Configuration
  apiEndpoints: {
    base: 'https://ambientpixels-nova-api.azurewebsites.net/api',
    loadCards: 'cardforgeloadcards',
    saveCard: 'cardforgesavecards',
    deleteCard: 'cardforgedeletecard',
    publish: 'cardforgepublish',
    deckPublish: 'cardforgedeckpublish',
    deckLoad: 'cardforgedeckload',
    deckDelete: 'cardforgedeckdelete',
    template: 'cardforgetemplate',
    cardShare: 'cardshare',
    deckShare: 'deckshare'
  },
  
  // Application Insights - Disabled in production until 400 errors are resolved
  appInsightsConnectionString: '',
  enableAppInsights: false,
  
  // Admin userIds — users who can remove any card from the gallery
  adminUserIds: ['5bb115c5-9077-4049-8af0-ce5085a9c315'],

  // Debug settings - Always off in production
  debug: false,
  version: 'v2.2',
  
  // Feature flags - Optimized for production
  features: {
    useMockData: false,  // Always use real API in production
    enableOfflineMode: false  // Disable offline mode in production
  }
};

/**
 * Builds a properly formatted API URL
 * @param {string} endpoint - The API endpoint name (e.g., 'loadCards', 'saveCard')
 * @param {Object} [params={}] - Query parameters as key-value pairs
 * @returns {string} Full API URL with parameters
 */
window.buildApiPath = function(endpoint, params = {}) {
  const baseUrl = window._config.apiEndpoints.base;
  const path = window._config.apiEndpoints[endpoint];
  
  if (!path) {
    console.error(`[Config] Unknown endpoint: ${endpoint}`);
    return '';
  }
  
  // Build query string from params
  const queryString = Object.entries(params)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  
  return `${baseUrl}/${path}${queryString ? '?' + queryString : ''}`;
};

// Log environment info
console.log(`[CardForge] Environment: ${window._config.environment}`);
console.log(`[CardForge] Debug mode: ${window._config.debug ? 'ON' : 'OFF'}`);
