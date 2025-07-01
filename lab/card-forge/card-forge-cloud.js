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
      
      // Check if we already have a stored consistent user ID
      const storedUserId = localStorage.getItem('cardforge_persistent_user_id');
      if (storedUserId) {
        debugLog(`Using previously generated persistent user ID: ${storedUserId}`);
        return storedUserId;
      }
      
      // Try additional known locations for user information
      const msalAccount = sessionStorage.getItem('msal.account.keys');
      if (msalAccount) {
        try {
          const accountKeys = JSON.parse(msalAccount);
          if (accountKeys && accountKeys.length > 0) {
            const accountKey = accountKeys[0];
            const accountData = sessionStorage.getItem(`msal.account.${accountKey}`);
            if (accountData) {
              const account = JSON.parse(accountData);
              if (account && account.idTokenClaims && account.idTokenClaims.oid) {
                const userId = account.idTokenClaims.oid;
                debugLog(`Found user ID from MSAL account data: ${userId}`);
                
                // Store for future use
                localStorage.setItem('cardforge_persistent_user_id', userId);
                return userId;
              }
            }
          }
        } catch (e) {
          debugLog('Error parsing MSAL account data: ' + e);
        }
      }
      
      // Generate a browser fingerprint-based ID that's consistent
      // This ensures each browser gets its own storage even without formal authentication
      const browserInfo = [
        navigator.userAgent,
        navigator.language,
        window.screen.colorDepth,
        window.screen.width + 'x' + window.screen.height
      ].join('|');
      
      // Create a simple hash of the browser info
      let hash = 0;
      for (let i = 0; i < browserInfo.length; i++) {
        hash = ((hash << 5) - hash) + browserInfo.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
      }
      
      // Format as a user ID with browser prefix
      const generatedUserId = 'browser-' + Math.abs(hash).toString(16);
      
      // Store for future use
      localStorage.setItem('cardforge_persistent_user_id', generatedUserId);
      
      debugLog(`Generated and stored persistent user ID: ${generatedUserId}`);
      return generatedUserId;
    } catch (e) {
      debugLog('Error getting user ID: ' + e);
      return 'fallback-user-' + new Date().toISOString().split('T')[0];
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
      const apiUrl = '/api/saveCardData';
      debugLog(`Connecting to API endpoint ${apiUrl}`);
      debugLog(`Using user ID: ${userId} (from ${getUserId === null ? 'null' : 'valid'} source)`);
      debugLog(`Auth state attributes: ${document.body.getAttribute('data-auth-state')}`);
      
      // Ensure the first card has the userId property
      if (cards.length > 0) {
        cards[0].userId = userId;
        debugLog(`Added userId to first card: ${JSON.stringify(cards[0])}`);
      }
      
      const response = await fetch(apiUrl, {
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
      const apiUrl = `/api/loadCardData?userId=${userId}`;
      debugLog(`Connecting to API endpoint ${apiUrl}`);
      debugLog(`Using user ID: ${userId} (from ${getUserId === null ? 'null' : 'valid'} source)`);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 
          'X-User-ID': userId, // Pass user ID in header for authentication
          'Content-Type': 'application/json'
        }
      });
      
      debugLog(`API response status: ${response.status} ${response.statusText}`);
      // Log response headers for debugging
      const headers = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      debugLog(`Response headers: ${JSON.stringify(headers)}`);
      
      
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
