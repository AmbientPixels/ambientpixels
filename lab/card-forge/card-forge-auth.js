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

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Expose the global CardForgeAuth object
  window.CardForgeAuth = {
    isSignedIn: isAuthenticated,
    getUserId: function() {
      const userInfo = getUserInfo();
      return userInfo ? (userInfo.id || userInfo.userId || userInfo.user_id || 'unknown') : 'unknown';
    },
    getUserName: getUserDisplayName,
    getUserInfo: getUserInfo
  };
  
  debugLog('CardForgeAuth global object created and exposed');
})();
