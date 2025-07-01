/**
 * Card Forge + Ambient Pixels Authentication Integration
 * Handles authentication state detection and UI updates for Card Forge
 */

(function() {
  'use strict';
  
  // Debug mode flag
  const DEBUG = true;
  
  // Debug logger
  function debugLog(message) {
    if (DEBUG) {
      console.log(`[Card Forge Auth] ${message}`);
    }
  }
  
  // Get auth state from body attribute (set by authUI.js)
  function isAuthenticated() {
    const authState = document.body.getAttribute('data-auth-state');
    return authState === 'signed-in';
  }
  
  // Get user info from sessionStorage (set by authUI.js)
  function getUserInfo() {
    try {
      const userInfoStr = sessionStorage.getItem('userInfo');
      if (userInfoStr) {
        return JSON.parse(userInfoStr);
      }
    } catch (e) {
      debugLog('Error parsing user info: ' + e);
    }
    return null;
  }
  
  // Get user's display name
  function getUserDisplayName() {
    const userInfo = getUserInfo();
    if (userInfo) {
      // Try to get name from various properties
      return userInfo.name || 
             userInfo.displayName || 
             userInfo.givenName || 
             userInfo.username ||
             'User';
    }
    return 'User';
  }
  
  // Update UI based on authentication state
  function updateAuthUI() {
    debugLog('Updating auth UI');
    
    const authenticated = isAuthenticated();
    debugLog('Auth state: ' + (authenticated ? 'signed in' : 'signed out'));
    
    // Show/hide elements based on auth state
    const signedInElements = document.querySelectorAll('.auth-signed-in');
    const signedOutElements = document.querySelectorAll('.auth-signed-out');
    
    signedInElements.forEach(el => {
      el.style.display = authenticated ? '' : 'none';
    });
    
    signedOutElements.forEach(el => {
      el.style.display = authenticated ? 'none' : '';
    });
    
    // Update user name if authenticated
    if (authenticated) {
      const userNameDisplay = document.getElementById('user-name-display');
      if (userNameDisplay) {
        userNameDisplay.textContent = `(${getUserDisplayName()})`;
      }
      
      // Update card counts (placeholder for now)
      const myCardsCount = document.getElementById('my-cards-count');
      const sharedCardsCount = document.getElementById('shared-cards-count');
      
      if (myCardsCount) myCardsCount.textContent = '0';
      if (sharedCardsCount) sharedCardsCount.textContent = '0';
    }
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
        // This will be implemented in the next phase
        alert('Loading your cards... (Coming soon)');
      });
    }
    
    // Save to my account button
    const saveToMyAccountBtn = document.getElementById('save-to-my-account-btn');
    if (saveToMyAccountBtn) {
      saveToMyAccountBtn.addEventListener('click', function() {
        debugLog('Save to my account button clicked');
        // This will be implemented in the next phase
        alert('Saving to your account... (Coming soon)');
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

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
