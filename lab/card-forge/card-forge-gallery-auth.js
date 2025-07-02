/**
 * Card Forge Gallery Authentication
 * Manages authentication state changes for the gallery interface
 * and updates UI elements accordingly
 */

(function() {
  'use strict';
  
  // Debug mode flag
  const DEBUG = true;
  
  // Debug logger
  function debugLog(message) {
    if (DEBUG) {
      console.log(`[Card Forge Gallery Auth] ${message}`);
    }
  }
  
  // Store DOM elements
  let galleryContainer = null;
  let galleryLoginButtons = [];
  let publishCardButtons = [];
  
  /**
   * Initialize gallery authentication handlers
   */
  function initGalleryAuth() {
    debugLog('Initializing gallery authentication handlers');
    
    // Cache DOM elements
    galleryContainer = document.getElementById('card-forge-gallery');
    galleryLoginButtons = document.querySelectorAll('#gallery-login-btn');
    
    // Set up sign-in buttons
    galleryLoginButtons.forEach(button => {
      button.addEventListener('click', handleGalleryLogin);
    });
    
    // Subscribe to auth state changes
    document.addEventListener('cardforge-auth-changed', handleAuthStateChanged);
    
    // Initial state setup based on current auth
    const authState = document.body.getAttribute('data-auth-state') || 'signed-out';
    handleAuthStateChanged({ detail: { state: authState } });
  }
  
  /**
   * Handle auth state changes and update UI accordingly
   * @param {CustomEvent} event - Auth state change event
   */
  function handleAuthStateChanged(event) {
    const authState = event.detail?.state || 'signed-out';
    debugLog(`Auth state changed to: ${authState}`);
    
    if (!galleryContainer) return;
    
    // Update container classes
    galleryContainer.classList.remove('auth-signed-in', 'auth-signed-out');
    galleryContainer.classList.add(`auth-${authState}`);
    
    if (authState === 'signed-in') {
      // Signed in: load personal library
      debugLog('Loading personal card library');
      if (window.CardForgeGallery && window.CardForgeGallery.loadPersonalCards) {
        window.CardForgeGallery.loadPersonalCards();
      }
      
      // Enable publish buttons
      document.querySelectorAll('.publish-card-btn').forEach(btn => {
        btn.removeAttribute('disabled');
        btn.setAttribute('title', 'Publish this card to the gallery');
      });
      
      // Update test visibility elements
      const signedInElements = document.querySelectorAll('.signed-in-content');
      const signedOutElements = document.querySelectorAll('.signed-out-content');
      
      signedInElements.forEach(el => el.style.display = 'block');
      signedOutElements.forEach(el => el.style.display = 'none');
    } else {
      // Signed out: load public gallery
      debugLog('Loading public gallery');
      if (window.CardForgeGallery && window.CardForgeGallery.loadGalleryCards) {
        window.CardForgeGallery.loadGalleryCards();
      }
      
      // Disable publish buttons
      document.querySelectorAll('.publish-card-btn').forEach(btn => {
        btn.setAttribute('disabled', 'disabled');
        btn.setAttribute('title', 'Sign in to publish cards');
      });
      
      // Update test visibility elements
      const signedInElements = document.querySelectorAll('.signed-in-content');
      const signedOutElements = document.querySelectorAll('.signed-out-content');
      
      signedInElements.forEach(el => el.style.display = 'none');
      signedOutElements.forEach(el => el.style.display = 'block');
    }
  }
  
  /**
   * Handle gallery login button click
   */
  function handleGalleryLogin(event) {
    event.preventDefault();
    debugLog('Gallery login button clicked');
    
    // Trigger login via main auth module
    if (window.CardForgeAuth && window.CardForgeAuth.signIn) {
      window.CardForgeAuth.signIn();
    } else {
      // Fallback to direct event dispatch
      document.dispatchEvent(new CustomEvent('cardforge-request-signin'));
    }
  }
  
  /**
   * Update card publish buttons based on auth state
   * @param {boolean} isSignedIn - Whether user is signed in
   */
  function updatePublishButtons(isSignedIn) {
    const buttons = document.querySelectorAll('.publish-card-btn');
    
    buttons.forEach(button => {
      if (isSignedIn) {
        button.removeAttribute('disabled');
        button.setAttribute('title', 'Publish this card to the gallery');
      } else {
        button.setAttribute('disabled', 'disabled');
        button.setAttribute('title', 'Sign in to publish cards');
        // Add click handler to prompt sign in
        button.addEventListener('click', (e) => {
          if (!isSignedIn) {
            e.preventDefault();
            e.stopPropagation();
            
            // Show sign-in prompt modal or trigger auth flow
            if (window.CardForgeAuth && window.CardForgeAuth.signIn) {
              window.CardForgeAuth.signIn();
            }
          }
        }, { capture: true });
      }
    });
  }
  
  // Public API
  window.CardForgeGalleryAuth = {
    updatePublishButtons
  };
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGalleryAuth);
  } else {
    initGalleryAuth();
  }
  
  // Export debug functions for development
  if (DEBUG) {
    window._cardForgeGalleryAuthDebug = {
      handleAuthStateChanged
    };
  }
})();
