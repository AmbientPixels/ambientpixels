// Card Forge + Ambient Pixels Integration
// Handles authentication state and user-specific features

(function() {
  // Debug logging
  function debugLog(...args) {
    if (window.DEBUG_AUTH || localStorage.getItem('DEBUG_AUTH') === 'true') console.log("[CARD-FORGE-AUTH]", ...args);
  }

  // DOM elements
  const authCardsSection = document.getElementById('auth-cards-section');
  const signedOutSection = authCardsSection?.querySelector('.auth-signed-out');
  const signedInSection = authCardsSection?.querySelector('.auth-signed-in');
  const userNameDisplay = document.getElementById('user-name-display');
  const cardForgeLoginBtn = document.getElementById('card-forge-login-btn');
  const loadMyCardsBtn = document.getElementById('load-my-cards-btn');
  const saveToMyAccountBtn = document.getElementById('save-to-my-account-btn');
  const saveToAzureBtn = document.getElementById('save-to-azure-btn'); // Existing button
  
  // Stats elements
  const myCardsCount = document.getElementById('my-cards-count');
  const sharedCardsCount = document.getElementById('shared-cards-count');

  // Check if auth elements exist
  if (!authCardsSection) {
    debugLog('Auth cards section not found');
    return;
  }

  // Initialize auth state
  function updateAuthUI() {
    debugLog('Updating Card Forge auth UI');
    
    // Check if we're authenticated
    const isSignedIn = document.body.getAttribute('data-auth-state') === 'signed-in' || 
                       sessionStorage.getItem('ambientPixels_isAuthenticated') === 'true';
    
    debugLog('Auth state:', isSignedIn ? 'signed in' : 'signed out');
    
    // Update UI based on auth state
    if (signedOutSection) signedOutSection.style.display = isSignedIn ? 'none' : 'block';
    if (signedInSection) signedInSection.style.display = isSignedIn ? 'block' : 'none';
    
    // If signed in, update user info
    if (isSignedIn && window.msalInstance) {
      try {
        const accounts = window.msalInstance.getAllAccounts();
        const account = accounts && accounts[0];
        
        if (account) {
          // Get display name (similar logic to authUI.js)
          let displayName = account.name;
          
          // Fallback if name is not useful
          if (!displayName || displayName.trim().toLowerCase() === 'unknown' || displayName.trim() === '') {
            displayName = account.username;
          }
          
          // If the name is an email, extract the part before the @
          if (displayName && displayName.includes('@')) {
            displayName = displayName.split('@')[0];
          }
          
          // Final fallback
          displayName = displayName || 'Card Creator';
          
          // Update UI with user info
          if (userNameDisplay) userNameDisplay.textContent = `(${displayName})`;
          
          // Store user ID for cloud operations
          window.cardForgeUserId = account.localAccountId || account.username;
          debugLog('User ID for cloud operations:', window.cardForgeUserId);
        }
      } catch (e) {
        debugLog('Error getting account info:', e);
      }
    }
    
    // Update cloud save buttons
    if (saveToAzureBtn) {
      // If we have the original "Save to Azure" button, update its text when signed in
      if (isSignedIn) {
        saveToAzureBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save to My Account';
      } else {
        saveToAzureBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save to Azure';
      }
    }
  }

  // Bind events
  function bindAuthEvents() {
    // Login button
    if (cardForgeLoginBtn) {
      cardForgeLoginBtn.addEventListener('click', function() {
        debugLog('Login button clicked');
        // Call the login function from authUI.js if available
        if (window.login) {
          window.login();
        } else {
          debugLog('Login function not available');
        }
      });
    }
    
    // Load my cards button
    if (loadMyCardsBtn) {
      loadMyCardsBtn.addEventListener('click', function() {
        debugLog('Load my cards button clicked');
        // This will be implemented in the next phase
        alert('Loading your cards... (Coming soon)');
      });
    }
    
    // Save to my account button
    if (saveToMyAccountBtn) {
      saveToMyAccountBtn.addEventListener('click', function() {
        debugLog('Save to my account button clicked');
        // This will be implemented in the next phase
        alert('Saving to your account... (Coming soon)');
      });
    }
    
    // Override existing save to Azure button if needed
    if (saveToAzureBtn) {
      // We'll keep the original functionality for now
      // but could override it in the future to include user ID
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
