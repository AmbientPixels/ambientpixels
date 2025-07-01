/**
 * Card Forge Cloud Storage Service
 * Handles saving and loading user-specific card data to Ambient Pixels cloud storage
 */

(function() {
  'use strict';
  
  // Debug mode flag
  const DEBUG = true;
  
  // Debug logger
  function debugLog(message) {
    if (DEBUG) {
      console.log(`[Card Forge Cloud] ${message}`);
    }
  }
  
  // Cloud storage namespace
  window.CardForgeCloud = {};
  
  /**
   * Get the current user ID from authentication
   * @returns {string|null} User ID or null if not authenticated
   */
  function getUserId() {
    try {
      // Check if authenticated
      const authState = document.body.getAttribute('data-auth-state');
      debugLog(`Auth state from body attribute: ${authState}`);
      
      if (authState !== 'signed-in') {
        debugLog('Not signed in according to data-auth-state attribute');
        return null;
      }
      
      // Since we're authenticated but user info might not be in session storage,
      // generate a consistent user ID from the authentication state
      // This is a fallback solution until the proper user info storage is fixed
      
      // Try to get from session storage first (ideal case)
      const userInfoStr = sessionStorage.getItem('userInfo');
      debugLog(`User info from session storage: ${userInfoStr ? 'found' : 'not found'}`);
      
      if (userInfoStr) {
        try {
          const userInfo = JSON.parse(userInfoStr);
          debugLog('User info parsed successfully');
          
          // Try to get user ID from various properties
          const userId = userInfo.localAccountId || 
                        userInfo.oid || 
                        userInfo.sub ||
                        userInfo.username;
          
          if (userId) {
            debugLog(`Found valid user ID from session storage: ${userId}`);
            return userId;
          }
        } catch (parseError) {
          debugLog('Error parsing user info: ' + parseError);
        }
      }
      
      // Fallback: Check if we have an authenticated flag in session storage
      const isAuthenticated = sessionStorage.getItem('ambientPixels_isAuthenticated');
      if (isAuthenticated === 'true') {
        // Generate a consistent user ID from the session ID
        const sessionId = sessionStorage.getItem('ambientPixels_sessionId') || 
                         sessionStorage.getItem('msal.client.info') || 
                         'authenticated-user';
        
        debugLog(`Using fallback user ID from session: ${sessionId}`);
        return sessionId;
      }
      
      // Last resort fallback - use a generic authenticated user ID
      // This ensures cloud storage works even if session storage is incomplete
      debugLog('Using generic authenticated user ID');
      return 'authenticated-user-' + new Date().toISOString().split('T')[0];
    } catch (e) {
      debugLog('Error getting user ID: ' + e);
      return null;
    }
  }
  
  /**
   * Save cards to cloud storage
   * @param {Array} cards - Array of card objects to save
   * @returns {Promise} Promise that resolves when save is complete
   */
  CardForgeCloud.saveCards = async function(cards) {
    debugLog('Saving cards to cloud');
    
    const userId = getUserId();
    if (!userId) {
      return Promise.reject(new Error('User not authenticated'));
    }
    
    try {
      // Add metadata to the cards
      const cardsWithMetadata = cards.map(card => ({
        ...card,
        lastModified: new Date().toISOString(),
        userId: userId
      }));
      
      // Connect to the Ambient Pixels API endpoint
      debugLog('Connecting to API endpoint /api/saveCardData');
      const response = await fetch('/api/saveCardData', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-ID': userId // Pass user ID in header for authentication
        },
        body: JSON.stringify(cardsWithMetadata)
      });
      
      debugLog(`API response status: ${response.status} ${response.statusText}`);
      
      // Try to parse the response as JSON
      let result;
      try {
        result = await response.json();
        debugLog('API response body:', result);
      } catch (jsonError) {
        debugLog('Failed to parse response as JSON:', jsonError);
        throw new Error(`API returned non-JSON response: ${response.statusText}`);
      }
      
      if (!response.ok) {
        throw new Error(result.message || `Error saving to Ambient Pixels cloud: ${response.status} ${response.statusText}`);
      }
      
      // Update card counts
      updateCardCounts(cardsWithMetadata);
      
      debugLog(`Saved ${cards.length} cards to cloud for user ${userId}`);
      return result;
    } catch (e) {
      debugLog('Error saving cards: ' + e);
      
      // Fallback to localStorage if API fails
      debugLog('API failed, falling back to localStorage');
      const storageKey = `ambient-pixels-cards-${userId}`;
      localStorage.setItem(storageKey, JSON.stringify(cards.map(card => ({
        ...card,
        lastModified: new Date().toISOString(),
        userId: userId
      }))));
      
      return Promise.reject(new Error('Failed to save cards: ' + e.message));
    }
  };
  
  /**
   * Load cards from cloud storage
   * @returns {Promise} Promise that resolves with loaded cards
   */
  CardForgeCloud.loadCards = async function() {
    debugLog('Loading cards from cloud');
    
    const userId = getUserId();
    if (!userId) {
      return Promise.reject(new Error('User not authenticated'));
    }
    
    try {
      // Connect to the Ambient Pixels API endpoint
      debugLog('Connecting to API endpoint /api/loadCardData');
      const response = await fetch(`/api/loadCardData?userId=${userId}`, {
        method: 'GET',
        headers: { 
          'X-User-ID': userId // Pass user ID in header for authentication
        }
      });
      
      debugLog(`API response status: ${response.status} ${response.statusText}`);
      
      // Try to parse the response as JSON
      let cards;
      try {
        if (!response.ok) {
          const errorResult = await response.json();
          debugLog('Error response body:', errorResult);
          throw new Error(errorResult.message || `Error loading from Ambient Pixels cloud: ${response.status} ${response.statusText}`);
        }
        
        cards = await response.json();
        debugLog('API response body:', cards);
      } catch (jsonError) {
        debugLog('Failed to parse response as JSON:', jsonError);
        throw new Error(`API returned non-JSON response: ${response.statusText}`);
      }
      
      // Update card counts
      updateCardCounts(cards);
      
      debugLog(`Loaded ${cards.length} cards from cloud for user ${userId}`);
      return cards;
    } catch (e) {
      debugLog('Error loading cards: ' + e);
      
      // Fallback to localStorage if API fails
      debugLog('API failed, falling back to localStorage');
      const storageKey = `ambient-pixels-cards-${userId}`;
      const cardsJson = localStorage.getItem(storageKey);
      
      if (!cardsJson) {
        debugLog('No cards found for user ' + userId);
        return [];
      }
      
      const cards = JSON.parse(cardsJson);
      
      // Update card counts
      updateCardCounts(cards);
      
      debugLog(`Loaded ${cards.length} cards from localStorage for user ${userId}`);
      return cards;
    }
  };
  
  /**
   * Update card counts in the UI
   * @param {Array} cards - Array of card objects
   */
  function updateCardCounts(cards) {
    const myCardsCount = document.getElementById('my-cards-count');
    const sharedCardsCount = document.getElementById('shared-cards-count');
    
    if (myCardsCount) {
      myCardsCount.textContent = cards.length;
    }
    
    if (sharedCardsCount) {
      // Count shared cards (placeholder logic)
      const sharedCards = cards.filter(card => card.shared === true);
      sharedCardsCount.textContent = sharedCards.length;
    }
  }
  
  /**
   * Check if cloud storage is available
   * @returns {boolean} True if cloud storage is available
   */
  CardForgeCloud.isAvailable = function() {
    return getUserId() !== null;
  };
  
  // Initialize when the script loads
  debugLog('Cloud storage service initialized');
  
})();
