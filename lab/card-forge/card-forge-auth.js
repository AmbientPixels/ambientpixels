/**
 * Card Forge + Ambient Pixels Authentication Integration
 * Handles authentication state detection and UI updates for Card Forge
 * Version 2.0 - Fully rebuilt for improved reliability and publishing support
 */

(function() {
  'use strict';
  
  // Configuration
  const CONFIG = {
    debug: true,                // Enable debug logging
    checkInterval: 5000,        // Auth state polling interval (ms)
    sessionInfoKey: 'userInfo', // Session storage key for user info
    persistentIdKey: 'cardforge_user_id', // Local storage key for persistent ID
    authStateAttribute: 'data-auth-state' // Body attribute that tracks auth state
  };
  
  // Debug logger with timestamps and context
  function debugLog(...args) {
    if (CONFIG.debug) {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
      console.log(`[Card Forge Auth][${timestamp}]`, ...args);
    }
  }
  
  // Error logger with stack traces when available
  function debugError(message, error) {
    if (CONFIG.debug) {
      console.error(`[Card Forge Auth] ${message}`, error?.stack || error || '');
    }
  }
  
  /**
   * Check if the user is authenticated
   * @returns {boolean} True if authenticated, false otherwise
   */
  function isAuthenticated() {
    // Primary check: body attribute set by authUI.js
    const authState = document.body.getAttribute(CONFIG.authStateAttribute);
    const isAuthFromState = authState === 'signed-in';
    
    // Secondary check: session storage user info
    const hasUserInfo = !!getUserInfo();
    
    // Additional check: ambientPixels_isAuthenticated in sessionStorage (set by authUI.js)
    const ambientPixelsAuthState = sessionStorage.getItem('ambientPixels_isAuthenticated') === 'true';
    
    // Log authentication state for debugging
    debugLog(`Auth state check: ${isAuthFromState ? 'Authenticated' : 'Not authenticated'} (by attribute)`); 
    debugLog(`User info check: ${hasUserInfo ? 'Present' : 'Missing'} (from session storage)`);
    debugLog(`AmbientPixels auth check: ${ambientPixelsAuthState ? 'Authenticated' : 'Not authenticated'} (from ambientPixels_isAuthenticated)`);
    
    // Return combined check (any of the methods indicate auth is valid)
    return (isAuthFromState && hasUserInfo) || ambientPixelsAuthState;
  }
  
  /**
   * Get user info from sessionStorage
   * @returns {Object|null} User info object or null if not available
   */
  function getUserInfo() {
    try {
      // Get from session storage (primary source)
      const userInfoStr = sessionStorage.getItem(CONFIG.sessionInfoKey);
      if (userInfoStr) {
        const userInfo = JSON.parse(userInfoStr);
        // Validate we have something useful
        if (userInfo && typeof userInfo === 'object') {
          return userInfo;
        }
      }
    } catch (error) {
      debugError('Error retrieving or parsing user info', error);
    }
    return null;
  }
  
  /**
   * Get the authenticated user's ID from various possible sources
   * @returns {string|null} User ID or null if not authenticated
   */
  function getUserId() {
    // First check authentication
    if (!isAuthenticated()) {
      debugLog('getUserId: Not authenticated');
      return null;
    }
    
    // Try to get from user info
    const userInfo = getUserInfo();
    if (!userInfo) {
      debugLog('getUserId: No user info found');
      return null;
    }
    
    // Check all possible ID properties in order of preference
    const possibleIdFields = ['id', 'userId', 'user_id', 'objectId', 'oid', 'sub', 'localAccountId'];
    
    for (const field of possibleIdFields) {
      if (userInfo[field]) {
        const userId = userInfo[field];
        debugLog(`getUserId: Found ID in ${field} property: ${userId}`);
        
        // Cache for consistency
        localStorage.setItem(CONFIG.persistentIdKey, userId);
        
        return userId;
      }
    }
    
    // Fallback to previously stored ID (for session consistency)
    const storedId = localStorage.getItem(CONFIG.persistentIdKey);
    if (storedId) {
      debugLog(`getUserId: Using cached ID: ${storedId}`);
      return storedId;
    }
    
    debugLog('getUserId: Could not find user ID in any property', userInfo);
    return null;
  }
  
  /**
   * Get user's display name for UI
   * @returns {string} User's display name or fallback
   */
  function getUserDisplayName() {
    const userInfo = getUserInfo();
    if (userInfo) {
      // Try multiple possible name properties in order of preference
      return userInfo.name || 
             userInfo.displayName || 
             userInfo.givenName || 
             userInfo.preferredUsername ||
             userInfo.username ||
             'Card Designer'; // Friendly default
    }
    return 'Card Designer'; // Fallback
  }
  
  // Update UI based on authentication state
  function updateAuthUI() {
    debugLog('Updating auth UI');
    
    const authenticated = isAuthenticated();
    const userId = authenticated ? getUserId() : null;
    const userName = authenticated ? getUserDisplayName() : 'Guest';
    
    debugLog(`Updating UI for auth state: ${authenticated ? 'Authenticated' : 'Not Authenticated'}`);
    debugLog(`User ID for UI: ${userId || 'None'}`);
    debugLog(`Display name for UI: ${userName}`);
    
    // Update elements that require authentication to be visible
    document.querySelectorAll('.needs-auth, [data-needs-auth="true"]').forEach(el => {
      el.style.display = authenticated ? '' : 'none';
    });
    
    // Update elements that should only be visible when not authenticated
    document.querySelectorAll('.needs-no-auth, [data-needs-auth="false"]').forEach(el => {
      el.style.display = authenticated ? 'none' : '';
    });
    
    // Update user name display in various locations
    document.querySelectorAll('.user-display-name, [data-user-name]').forEach(el => {
      el.textContent = userName;
    });
    
    // Update any user ID displays
    document.querySelectorAll('[data-user-id]').forEach(el => {
      el.textContent = userId || 'Not signed in';
    });
    
    // Update publish buttons based on auth state
    document.querySelectorAll('.publish-btn, [data-action="publish"]').forEach(el => {
      if (authenticated) {
        el.removeAttribute('disabled');
        el.title = 'Publish card to gallery';
      } else {
        el.setAttribute('disabled', 'disabled');
        el.title = 'Sign in to publish cards';
      }
    });
    
    // Set data attributes for styling
    document.body.setAttribute('data-is-authenticated', authenticated ? 'true' : 'false');
  }
    
  // Update card counts in the UI
  function updateCardCounts() {
    debugLog('Updating card counts');
    const myCardsCount = document.getElementById('my-cards-count');
    const sharedCardsCount = document.getElementById('shared-cards-count');
    
    // Get actual card counts from cardForge if available
    if (window.cardForge && typeof window.cardForge.getCards === 'function') {
      const cards = window.cardForge.getCards();
      if (myCardsCount && Array.isArray(cards)) {
        myCardsCount.textContent = cards.length.toString();
      }
      
      // Count shared/published cards
      if (sharedCardsCount && Array.isArray(cards)) {
        const sharedCards = cards.filter(card => card.isPublic === true);
        sharedCardsCount.textContent = sharedCards.length.toString();
      }
    } else {
      // Fallback if cardForge is not available
      if (myCardsCount) myCardsCount.textContent = '0';
      if (sharedCardsCount) sharedCardsCount.textContent = '0';
    }
    
    debugLog('Updated card counts');
  }
  
  // Bind event handlers to auth-related buttons
  function bindAuthEvents() {
    debugLog('Binding auth events');
    
    // Login button
    const loginBtn = document.getElementById('card-forge-login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', function() {
        debugLog('Login button clicked');
        // Try to use the global login function from authUI.js
        if (window.login) {
          window.login();
        } else {
          debugLog('Login function not available');
        }
      });
    }
    
    // Load my cards button
    const loadMyCardsBtn = document.getElementById('load-my-cards-btn');
    if (loadMyCardsBtn) {
      loadMyCardsBtn.addEventListener('click', function() {
        debugLog('Load my cards button clicked');
        
        // Check if cloud service is available
        if (!window.CardForgeCloud || !window.CardForgeCloud.isAvailable()) {
          alert('Cloud storage is not available. Please sign in first.');
          return;
        }
        
        // Show loading indicator
        loadMyCardsBtn.disabled = true;
        loadMyCardsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        
        // Load cards from cloud
        window.CardForgeCloud.loadCards()
          .then(cards => {
            debugLog(`Loaded ${cards.length} cards from cloud`);
            
            // Check if we have a global card manager to update
            if (window.cardForge && window.cardForge.loadCards) {
              window.cardForge.loadCards(cards);
              alert(`Successfully loaded ${cards.length} cards from your Ambient Pixels account`);
            } else {
              alert(`Loaded ${cards.length} cards, but couldn't update the UI. Please refresh the page.`);
            }
          })
          .catch(error => {
            debugLog('Error loading cards: ' + error);
            alert('Error loading cards: ' + error.message);
          })
          .finally(() => {
            // Reset button
            loadMyCardsBtn.disabled = false;
            loadMyCardsBtn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Load My Cards';
          });
      });
    }
    
    // Save to my account button
    const saveToMyAccountBtn = document.getElementById('save-to-my-account-btn');
    if (saveToMyAccountBtn) {
      saveToMyAccountBtn.addEventListener('click', function() {
        debugLog('Save to my account button clicked');
        
        // Check if cloud service is available
        if (!window.CardForgeCloud || !window.CardForgeCloud.isAvailable()) {
          alert('Cloud storage is not available. Please sign in first.');
          return;
        }
        
        // Get cards from the card manager
        let cards = [];
        if (window.cardForge && window.cardForge.getCards) {
          cards = window.cardForge.getCards();
        } else {
          alert('Could not access cards. Please refresh the page.');
          return;
        }
        
        if (!cards || cards.length === 0) {
          alert('No cards to save. Create some cards first!');
          return;
        }
        
        // Show loading indicator
        saveToMyAccountBtn.disabled = true;
        saveToMyAccountBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        
        // Save cards to cloud
        window.CardForgeCloud.saveCards(cards)
          .then(result => {
            debugLog('Save result:', result);
            alert(result.message || `Saved ${result.count} cards to your Ambient Pixels account`);
          })
          .catch(error => {
            debugLog('Error saving cards: ' + error);
            alert('Error saving cards: ' + error.message);
          })
          .finally(() => {
            // Reset button
            saveToMyAccountBtn.disabled = false;
            saveToMyAccountBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save to My Account';
          });
      });
    }
  }

  // Initialize
  function init() {
    debugLog('Initializing Card Forge auth integration');
    updateAuthUI();
    bindAuthEvents();
    
    // Listen for auth state changes (custom event from authUI.js)
    document.addEventListener('authStateChanged', function() {
      debugLog('Auth state changed event received');
      updateAuthUI();
    });
    
    // Also check periodically (as a fallback)
    setInterval(updateAuthUI, 5000);
  }

  // Expose the global CardForgeAuth object with public API methods
  window.CardForgeAuth = {
    // Core authentication functions
    isAuthenticated,
    getUserInfo,
    getUserId,
    getUserDisplayName,
    
    // UI management functions
    updateUIForAuthState: updateAuthUI,
    updateCardCounts,
    
    // Helper functions for card publish workflow
    canPublishCards() {
      return isAuthenticated() && !!getUserId();
    },
    
    getAuthHeaders() {
      const userId = getUserId();
      if (!userId) return {};
      
      return {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'x-user-id': userId // Lowercase version for compatibility
      };
    },
    
    addAuthToRequest(requestOptions = {}) {
      const userId = getUserId();
      if (!userId) return requestOptions;
      
      // Clone the request options to avoid modifying the original
      const options = { ...requestOptions };
      
      // Initialize headers if not present
      if (!options.headers) {
        options.headers = {};
      }
      
      // Add auth headers
      options.headers['X-User-ID'] = userId;
      options.headers['x-user-id'] = userId; // Lowercase version for compatibility
      
      return options;
    }
  };
  
  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  debugLog('CardForgeAuth module initialized and exported');
})();
