// Application Insights integration for CardForge
// Created: 2025-07-06

/**
 * Application Insights integration for CardForge
 * Provides telemetry, error tracking, and performance monitoring
 */
const AppInsightsService = (() => {
  // Configuration
  let appInsights = null;
  let isInitialized = false;
  let config = {
    connectionString: '', // Will be set from environment
    enableDebug: false,
    disableFetchTracking: false,
    enableCorsCorrelation: true,
    enableRequestHeaderTracking: true,
    enableResponseHeaderTracking: true
  };
  
  /**
   * Initialize Application Insights
   * @param {Object} options - Configuration options
   * @returns {Boolean} - Whether initialization was successful
   */
  function initialize(options = {}) {
    // Prevent multiple initializations
    if (isInitialized) {
      console.log('[AppInsights] Already initialized');
      return true;
    }
    
    // Merge options
    config = { ...config, ...options };
    
    try {
      if (!window.Microsoft || !window.Microsoft.ApplicationInsights) {
        console.warn('[AppInsights] Microsoft Application Insights SDK not found');
        return false;
      }
      
      // Get connection string from _config if available
      if (!config.connectionString && window._config?.appInsightsConnectionString) {
        config.connectionString = window._config.appInsightsConnectionString;
      }
      
      // Check if we have a connection string
      if (!config.connectionString) {
        console.warn('[AppInsights] No connection string provided, telemetry disabled');
        return false;
      }
      
      // Initialize SDK
      const applicationInsightsSDK = window.Microsoft.ApplicationInsights;
      appInsights = applicationInsightsSDK.ApplicationInsights.initialize({
        config: {
          connectionString: config.connectionString,
          enableDebug: config.enableDebug,
          disableFetchTracking: config.disableFetchTracking,
          enableCorsCorrelation: config.enableCorsCorrelation,
          enableRequestHeaderTracking: config.enableRequestHeaderTracking,
          enableResponseHeaderTracking: config.enableResponseHeaderTracking
        }
      });
      
      // Add authentication context if available
      if (window.authModule?.getCurrentUser) {
        const user = window.authModule.getCurrentUser();
        if (user && user.id) {
          appInsights.addTelemetryInitializer((envelope) => {
            envelope.tags = envelope.tags || {};
            envelope.tags['ai.user.id'] = user.id;
            envelope.tags['ai.user.authenticatedId'] = user.id;
            
            if (envelope.baseData) {
              envelope.baseData.properties = envelope.baseData.properties || {};
              envelope.baseData.properties['userRole'] = user.roles?.join(',') || 'user';
            }
          });
        }
      }
      
      // Success
      isInitialized = true;
      console.log('[AppInsights] Successfully initialized');
      
      // Track page view
      trackPageView();
      
      return true;
    } catch (error) {
      console.error('[AppInsights] Failed to initialize:', error);
      return false;
    }
  }
  
  /**
   * Track page view
   * @param {String} name - Custom name for the page view
   * @param {Object} properties - Additional properties
   */
  function trackPageView(name, properties = {}) {
    if (!isInitialized || !appInsights) return;
    
    try {
      appInsights.trackPageView({
        name: name || document.title,
        uri: window.location.href,
        properties: properties
      });
    } catch (error) {
      console.error('[AppInsights] Failed to track page view:', error);
    }
  }
  
  /**
   * Track custom event
   * @param {String} name - Event name
   * @param {Object} properties - Additional properties
   */
  function trackEvent(name, properties = {}) {
    if (!isInitialized || !appInsights) return;
    
    try {
      appInsights.trackEvent({ name, properties });
    } catch (error) {
      console.error('[AppInsights] Failed to track event:', error);
    }
  }
  
  /**
   * Track API request performance
   * @param {String} endpoint - API endpoint
   * @param {Number} duration - Duration in milliseconds
   * @param {String} resultCode - HTTP status code
   * @param {Boolean} success - Whether the request was successful
   */
  function trackApiRequest(endpoint, duration, resultCode, success) {
    if (!isInitialized || !appInsights) return;
    
    try {
      appInsights.trackRequest({
        name: endpoint,
        url: endpoint,
        duration: duration,
        resultCode: resultCode,
        success: success,
        properties: {
          source: 'cardforge-frontend'
        }
      });
    } catch (error) {
      console.error('[AppInsights] Failed to track API request:', error);
    }
  }
  
  /**
   * Track exception
   * @param {Error} error - Error object
   * @param {Object} properties - Additional properties
   */
  function trackException(error, properties = {}) {
    if (!isInitialized || !appInsights) return;
    
    try {
      appInsights.trackException({
        exception: error,
        properties: properties
      });
    } catch (err) {
      console.error('[AppInsights] Failed to track exception:', err);
    }
  }
  
  /**
   * Flush telemetry immediately
   */
  function flush() {
    if (!isInitialized || !appInsights) return;
    
    try {
      appInsights.flush();
    } catch (error) {
      console.error('[AppInsights] Failed to flush telemetry:', error);
    }
  }
  
  // Return public API
  return {
    initialize,
    trackPageView,
    trackEvent,
    trackApiRequest,
    trackException,
    flush,
    isInitialized: () => isInitialized
  };
})();

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Check if we should initialize Application Insights
  // Don't initialize in local development unless explicitly enabled
  const shouldInitialize = window.location.hostname === 'ambientpixels.ai' || 
                           window.location.hostname === 'cardforge.azurewebsites.net' ||
                           (window._config && window._config.enableAppInsights);
  
  if (shouldInitialize && window._config?.appInsightsConnectionString) {
    console.log('[AppInsights] Initializing telemetry...');
    AppInsightsService.initialize();
  }
});

// Expose globally
window.AppInsightsService = AppInsightsService;
