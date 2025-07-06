// CardForge API Debugging Utilities
// Created: 2025-07-05
// Purpose: Help debug API connectivity and authentication issues

/**
 * CardForge Debug Utilities 
 * Provides tools to diagnose API connectivity, authentication, and path issues
 */
const CardForgeDebug = (() => {
  const VERSION = '1.0.0';
  const logPrefix = '[CardForge Debug]';
  
  // Default paths to test
  const DEFAULT_PATHS = [
    '/api/cardforgetemplate',
    '/api/cardforgegallery',
    '/api/cardforgecards',
    '/api/cardforgemycards',
    '/api/cardforgeloadcards',
    '/api/cardforgesavecards',
    '/api/cardforgepublish'
  ];
  
  // Alternative API path structures to test
  const API_PATH_OPTIONS = [
    '', // default (relative)
    '/api',
    '/cardforge',
    '/functions/api'
  ];
  
  // Output container for debug results
  let outputContainer = null;
  
  /**
   * Initialize the debugging panel
   */
  function init() {
    console.log(`${logPrefix} Initializing debug tools v${VERSION}`);
    
    // Create debug panel if it doesn't exist
    if (!document.getElementById('cardforge-debug-panel')) {
      createDebugPanel();
    }
    
    // Add global access
    window.CardForgeDebug = {
      testAllEndpoints,
      checkAuth,
      showConfig,
      testEndpoint
    };
    
    console.log(`${logPrefix} Debug tools ready. Access via window.CardForgeDebug in console`);
  }
  
  /**
   * Create the debug panel UI
   */
  function createDebugPanel() {
    // Create panel
    const panel = document.createElement('div');
    panel.id = 'cardforge-debug-panel';
    panel.className = 'cardforge-debug-panel';
    
    // Style the panel
    panel.style.position = 'fixed';
    panel.style.bottom = '10px';
    panel.style.right = '10px';
    panel.style.width = '400px';
    panel.style.maxHeight = '600px';
    panel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    panel.style.color = '#00ff00';
    panel.style.padding = '10px';
    panel.style.borderRadius = '5px';
    panel.style.fontFamily = 'monospace';
    panel.style.fontSize = '12px';
    panel.style.zIndex = '10000';
    panel.style.overflowY = 'auto';
    panel.style.display = 'none'; // Hidden by default
    
    // Add header
    const header = document.createElement('div');
    header.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h3 style="margin: 0; color: #64d3ff;">CardForge Debug v${VERSION}</h3>
        <button id="debug-close-btn" style="background: none; border: none; color: #ff6464; cursor: pointer;">×</button>
      </div>
      <div style="display: flex; gap: 5px; margin-bottom: 10px;">
        <button class="debug-btn" id="debug-auth-btn">Check Auth</button>
        <button class="debug-btn" id="debug-api-btn">Test APIs</button>
        <button class="debug-btn" id="debug-config-btn">Show Config</button>
      </div>
    `;
    panel.appendChild(header);
    
    // Add output container
    outputContainer = document.createElement('div');
    outputContainer.id = 'debug-output';
    outputContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    outputContainer.style.padding = '10px';
    outputContainer.style.borderRadius = '3px';
    outputContainer.style.maxHeight = '400px';
    outputContainer.style.overflowY = 'auto';
    panel.appendChild(outputContainer);
    
    // Add style for buttons
    const style = document.createElement('style');
    style.textContent = `
      .debug-btn {
        background-color: #2a2a2a;
        color: #64d3ff;
        border: 1px solid #444;
        border-radius: 3px;
        padding: 5px 10px;
        cursor: pointer;
      }
      .debug-btn:hover {
        background-color: #3a3a3a;
      }
      .debug-result {
        margin-bottom: 8px;
        border-bottom: 1px solid #333;
        padding-bottom: 8px;
      }
      .debug-success { color: #00ff00; }
      .debug-error { color: #ff6464; }
      .debug-info { color: #64d3ff; }
      .debug-warning { color: #ffcc00; }
    `;
    document.head.appendChild(style);
    
    // Add to document
    document.body.appendChild(panel);
    
    // Add toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'debug-toggle-btn';
    toggleBtn.innerText = 'Debug';
    toggleBtn.style.position = 'fixed';
    toggleBtn.style.bottom = '10px';
    toggleBtn.style.right = '10px';
    toggleBtn.style.backgroundColor = '#64d3ff';
    toggleBtn.style.color = '#000';
    toggleBtn.style.border = 'none';
    toggleBtn.style.borderRadius = '3px';
    toggleBtn.style.padding = '5px 10px';
    toggleBtn.style.zIndex = '10001';
    toggleBtn.style.cursor = 'pointer';
    document.body.appendChild(toggleBtn);
    
    // Add event listeners
    toggleBtn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      toggleBtn.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
    
    document.getElementById('debug-close-btn').addEventListener('click', () => {
      panel.style.display = 'none';
      toggleBtn.style.display = 'block';
    });
    
    document.getElementById('debug-auth-btn').addEventListener('click', checkAuth);
    document.getElementById('debug-api-btn').addEventListener('click', testAllEndpoints);
    document.getElementById('debug-config-btn').addEventListener('click', showConfig);
  }
  
  /**
   * Log a message to the debug panel
   */
  function logToPanel(message, type = 'info') {
    if (!outputContainer) return;
    
    const entry = document.createElement('div');
    entry.className = `debug-result debug-${type}`;
    entry.innerHTML = message;
    outputContainer.appendChild(entry);
    outputContainer.scrollTop = outputContainer.scrollHeight;
    
    // Also log to console
    console.log(`${logPrefix} ${message}`);
  }
  
  /**
   * Clear the debug panel
   */
  function clearPanel() {
    if (outputContainer) {
      outputContainer.innerHTML = '';
    }
  }
  
  /**
   * Check authentication status
   */
  async function checkAuth() {
    clearPanel();
    logToPanel('Checking authentication status...', 'info');
    
    // Try to get user from authModule
    const account = window.authModule?.getCurrentUser();
    
    if (account) {
      logToPanel(`Authenticated as: ${account.name} (${account.id})`, 'success');
      
      // Display token info if available
      if (account.token) {
        try {
          // Parse the token without verification
          const tokenParts = account.token.split('.');
          if (tokenParts.length === 3) {
            const payload = JSON.parse(atob(tokenParts[1]));
            logToPanel('Token information:', 'info');
            logToPanel(`<pre>${JSON.stringify(payload, null, 2)}</pre>`, 'info');
            
            // Check expiration
            const exp = payload.exp * 1000; // Convert to milliseconds
            const now = Date.now();
            if (exp < now) {
              logToPanel(`Token EXPIRED (${new Date(exp).toLocaleString()})`, 'error');
            } else {
              logToPanel(`Token valid until: ${new Date(exp).toLocaleString()}`, 'success');
            }
          }
        } catch (e) {
          logToPanel('Error parsing token: ' + e.message, 'error');
        }
      }
    } else {
      logToPanel('Not authenticated or authModule not loaded', 'warning');
    }
    
    // Check cookie status
    const cookies = document.cookie.split(';').map(c => c.trim());
    logToPanel(`Found ${cookies.length} cookies`, 'info');
    
    // Check for auth-related cookies (without exposing values)
    const authCookies = cookies.filter(c => 
      c.startsWith('AppServiceAuthSession=') || 
      c.startsWith('ARRAffinity=') ||
      c.startsWith('.AspNetCore.')
    );
    
    if (authCookies.length > 0) {
      logToPanel(`Found ${authCookies.length} authentication-related cookies`, 'success');
    } else {
      logToPanel('No authentication cookies found', 'warning');
    }
  }
  
  /**
   * Test all API endpoints with different base paths
   */
  async function testAllEndpoints() {
    clearPanel();
    logToPanel('Testing all API endpoints with different base paths...', 'info');
    
    // Current config
    const currentBase = window._config?.apiBasePath || '';
    logToPanel(`Current API base path: "${currentBase}"`, 'info');
    
    // Test each API path option
    for (const basePath of API_PATH_OPTIONS) {
      logToPanel(`Testing with base path: "${basePath}"`, 'info');
      
      // Only test GET endpoints to avoid data mutations
      for (const endpoint of DEFAULT_PATHS.filter(p => !p.includes('savecards') && !p.includes('cardpublish'))) {
        await testEndpoint(`${basePath}${endpoint}`);
      }
      
      logToPanel('---', 'info');
    }
    
    logToPanel('API endpoint testing complete', 'info');
  }
  
  /**
   * Test a specific API endpoint
   */
  async function testEndpoint(endpoint) {
    try {
      logToPanel(`Testing endpoint: ${endpoint}`, 'info');
      
      const startTime = performance.now();
      const res = await fetch(endpoint, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });
      const endTime = performance.now();
      const responseTime = Math.round(endTime - startTime);
      
      if (res.ok) {
        logToPanel(`✅ ${endpoint} - ${res.status} ${res.statusText} (${responseTime}ms)`, 'success');
        
        // Try to get the data
        try {
          const data = await res.json();
          logToPanel(`Received ${Array.isArray(data) ? data.length + ' items' : 'data'}`, 'success');
        } catch (e) {
          logToPanel('Response is not JSON: ' + e.message, 'warning');
        }
      } else {
        logToPanel(`❌ ${endpoint} - ${res.status} ${res.statusText} (${responseTime}ms)`, 'error');
        
        // Try to get error details
        try {
          const errorText = await res.text();
          if (errorText) {
            logToPanel(`Error details: ${errorText.substring(0, 100)}${errorText.length > 100 ? '...' : ''}`, 'error');
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      logToPanel(`❌ ${endpoint} - Network error: ${e.message}`, 'error');
    }
  }
  
  /**
   * Show current configuration
   */
  function showConfig() {
    clearPanel();
    logToPanel('CardForge Configuration:', 'info');
    
    // Window config
    if (window._config) {
      logToPanel('<pre>' + JSON.stringify(window._config, null, 2) + '</pre>', 'info');
    } else {
      logToPanel('No window._config found', 'warning');
    }
    
    // Environment
    const env = {
      hostname: window.location.hostname,
      protocol: window.location.protocol,
      pathname: window.location.pathname,
      isLocalhost: ['localhost', '127.0.0.1'].includes(window.location.hostname)
    };
    
    logToPanel('Environment:', 'info');
    logToPanel('<pre>' + JSON.stringify(env, null, 2) + '</pre>', 'info');
    
    // Auth module
    if (window.authModule) {
      logToPanel('Auth module is loaded', 'success');
    } else {
      logToPanel('Auth module is not loaded', 'warning');
    }
    
    // CSRF token
    if (window.csrfToken) {
      logToPanel('CSRF token is set', 'success');
    } else {
      logToPanel('CSRF token is not set', 'warning');
    }
  }
  
  /**
   * Test Azure SWA specific auth endpoints
   */
  async function testSwaAuthEndpoints() {
    clearPanel();
    logToPanel('Testing Azure Static Web Apps auth endpoints...', 'info');
    
    // Test endpoints
    const endpoints = [
      '/.auth/me',
      '/.auth/login/aad',
      '/.auth/login/github'
    ];
    
    for (const endpoint of endpoints) {
      try {
        logToPanel(`Testing endpoint: ${endpoint}`, 'info');
        
        const res = await fetch(endpoint, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (res.ok) {
          logToPanel(`✅ ${endpoint} - ${res.status} ${res.statusText}`, 'success');
          
          // For .auth/me, show the response
          if (endpoint === '/.auth/me') {
            try {
              const data = await res.json();
              if (data.clientPrincipal) {
                logToPanel(`Authenticated as: ${data.clientPrincipal.userDetails} (${data.clientPrincipal.userId})`, 'success');
                logToPanel(`User roles: ${data.clientPrincipal.userRoles.join(', ')}`, 'info');
                logToPanel(`Identity provider: ${data.clientPrincipal.identityProvider}`, 'info');
              } else {
                logToPanel('Not authenticated', 'warning');
              }
            } catch (e) {
              logToPanel('Error parsing auth data: ' + e.message, 'error');
            }
          }
        } else {
          logToPanel(`❌ ${endpoint} - ${res.status} ${res.statusText}`, 'error');
        }
      } catch (e) {
        logToPanel(`❌ ${endpoint} - Network error: ${e.message}`, 'error');
      }
    }
    
    // Also check if we're in an iframe, which can cause auth issues
    if (window !== window.parent) {
      logToPanel('⚠️ Page is loaded in an iframe, which can cause auth issues with SWA', 'warning');
    }
  }

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Public API
  return {
    VERSION
  };
})();

// Initialize when loaded
console.log('[CardForge Debug] Debug utilities loaded');
