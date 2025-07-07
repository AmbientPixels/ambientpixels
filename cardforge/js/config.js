/**
 * CardForge Configuration
 * Central configuration file for all CardForge settings
 * Extracted from index.html per Windsurf Rule #1: No inline scripts
 */

window._config = {
  // API base path for all endpoint calls
  apiBasePath: '/api',
  
  // Environment settings
  environment: (window.location.hostname === 'ambientpixels.ai' || window.location.hostname.endsWith('.azurestaticapps.net')) ? 'production' : 'development',
  
  // Application Insights
  appInsightsConnectionString: 'InstrumentationKey=0339ebd7-6d1c-424f-a495-8ddb052a57b0;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/',
  enableAppInsights: window.location.hostname === 'ambientpixels.ai' || window.location.hostname.endsWith('.azurestaticapps.net'),
  
  // Debug settings
  debug: !(window.location.hostname === 'ambientpixels.ai' || window.location.hostname.endsWith('.azurestaticapps.net')),
  version: 'v2.1'
};
