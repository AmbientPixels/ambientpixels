/**
 * CSRF Protection Module for CardForge
 * Created: 2025-07-05
 * 
 * This module handles CSRF token generation, storage, and inclusion in API requests
 */

(function() {
  'use strict';

  /**
   * Generate a cryptographically strong random token
   * @returns {string} A random token string
   */
  function generateCSRFToken() {
    const tokenChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    
    // Create a 32-character random string
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < array.length; i++) {
      token += tokenChars[array[i] % tokenChars.length];
    }
    
    return token;
  }

  /**
   * Get the current CSRF token or generate a new one
   * @returns {string} The CSRF token
   */
  function getCSRFToken() {
    // Try to get existing token
    let token = sessionStorage.getItem('csrf_token');
    
    // Generate new token if none exists
    if (!token) {
      token = generateCSRFToken();
      sessionStorage.setItem('csrf_token', token);
    }
    
    return token;
  }

  /**
   * Initialize CSRF protection for the page
   */
  function initCSRF() {
    // Get or generate token
    const token = getCSRFToken();
    
    // Set in meta tag for easy access by scripts
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag) {
      metaTag.setAttribute('content', token);
    } else {
      console.error('[CSRF] Meta tag not found. CSRF protection may be compromised.');
    }

    // Patch the fetch API to automatically include CSRF tokens in mutating requests
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
      // Only add token to same-origin requests that modify state
      if (isSameOrigin(url) && isMutatingMethod(options?.method)) {
        // Create new options object with CSRF headers
        options = options || {};
        options.headers = options.headers || {};
        
        // Only add if not already present
        if (!options.headers['X-CSRF-Token']) {
          options.headers['X-CSRF-Token'] = token;
        }
      }
      
      // Call original fetch with (potentially) modified options
      return originalFetch(url, options);
    };

  }

  /**
   * Check if a URL is same-origin as the current page
   * @param {string|Request} url - The URL or Request to check
   * @returns {boolean} True if same origin
   */
  function isSameOrigin(url) {
    if (!url) return true; // Default to same origin
    
    // Handle Request objects
    const requestUrl = url instanceof Request ? url.url : url;
    
    // For relative URLs, return true
    if (requestUrl.startsWith('/')) return true;
    
    try {
      const currentOrigin = window.location.origin;
      const urlOrigin = new URL(requestUrl, currentOrigin).origin;
      return currentOrigin === urlOrigin;
    } catch (e) {
      console.warn('[CSRF] Error parsing URL:', e);
      return false;
    }
  }

  /**
   * Check if the HTTP method potentially mutates state
   * @param {string} method - The HTTP method to check
   * @returns {boolean} True if the method may mutate state
   */
  function isMutatingMethod(method) {
    if (!method) return false; // GET is the default
    
    const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    return mutatingMethods.includes(method.toUpperCase());
  }

  // Initialize CSRF protection when the document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCSRF);
  } else {
    initCSRF();
  }

  // Expose public API
  window.csrfProtection = {
    getToken: getCSRFToken,
    refreshToken: function() {
      const token = generateCSRFToken();
      sessionStorage.setItem('csrf_token', token);
      
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      if (metaTag) {
        metaTag.setAttribute('content', token);
      }
      
      return token;
    }
  };
})();
