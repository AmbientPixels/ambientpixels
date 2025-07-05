/**
 * Card Forge Cloud Storage Service
 * Handles saving and loading user-specific card data to Ambient Pixels cloud storage
 */

(function() {
  'use strict';
  
  // Debug mode flag
  const DEBUG = true;
  
  // API Configuration
  const API_CONFIG = {
    // Set to true to use production API endpoints, false for local development
    production: true,
    
    // Base URLs
    baseUrl: {
      development: '',  // Empty for relative paths in development
      production: 'https://ambientpixels.ai'  // Production API base URL
    },
    
    // API endpoints
    endpoints: {
      saveCards: '/api/cardforge/savecards',
      loadCards: '/api/cardforge/loadcards',
      publishCard: '/api/cardforge/cardpublish',
      gallery: '/api/cardforge/gallery',
      myCards: '/api/cardforge/mycards'
    }
  };
  
  // Debug logger
  function debugLog(message) {
    if (DEBUG) {
      console.log(`[Card Forge Cloud] ${message}`);
    }
  }
  
  /**
   * Get the base API URL based on current environment
   * @returns {string} The base URL for API requests
   */
  function getApiBaseUrl() {
    return API_CONFIG.production ? 
      API_CONFIG.baseUrl.production : 
      API_CONFIG.baseUrl.development;
  }
  
  /**
   * Get the full API URL for a specific endpoint
   * @param {string} endpoint - The API endpoint path from API_CONFIG.endpoints
   * @param {Object} params - Optional query parameters
   * @returns {string} The complete API URL
   */
  function getApiUrl(endpoint, params = {}) {
    const baseUrl = getApiBaseUrl();
    const path = API_CONFIG.endpoints[endpoint];
    
    if (!path) {
      console.error(`[Card Forge Cloud] Invalid endpoint: ${endpoint}`);
      return '';
    }
    
    // Add query parameters if provided
    let url = `${baseUrl}${path}`;
    const queryParams = new URLSearchParams();
    
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        queryParams.append(key, value);
      }
    }
    
    const queryString = queryParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
    
    return url;
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

      // PRIORITY 0: Use CardForgeAuth if available (recommended approach)
      if (window.CardForgeAuth && typeof window.CardForgeAuth.getUserId === 'function') {
        const cardForgeAuthId = window.CardForgeAuth.getUserId();
        if (cardForgeAuthId && cardForgeAuthId !== 'unknown') {
          debugLog(`Using authenticated user ID from CardForgeAuth: ${cardForgeAuthId}`);
          // Store this ID for consistent access
          localStorage.setItem('cardforge_persistent_user_id', cardForgeAuthId);
          return cardForgeAuthId;
        }
      }
      
      // PRIORITY 1: Try to get from session storage
      const userInfoStr = sessionStorage.getItem('userInfo');
      debugLog(`User info from session storage: ${userInfoStr ? 'found' : 'not found'}`);
      
      if (userInfoStr) {
        try {
          const userInfo = JSON.parse(userInfoStr);
          debugLog('User info parsed successfully');
          
          // Try to get user ID from various properties
          const possibleIdFields = ['id', 'userId', 'user_id', 'localAccountId', 'oid', 'sub', 'objectId', 'username'];
          
          for (const field of possibleIdFields) {
            if (userInfo[field]) {
              const userId = userInfo[field];
              debugLog(`Found valid user ID from session storage (${field}): ${userId}`);
              // Store this ID for consistent access
              localStorage.setItem('cardforge_persistent_user_id', userId);
              return userId;
            }
          }
        } catch (parseError) {
          debugLog('Error parsing user info: ' + parseError);
        }
      }
      
      // PRIORITY 2: Check if we already have a stored consistent user ID
      const storedUserId = localStorage.getItem('cardforge_persistent_user_id');
      if (storedUserId) {
        debugLog(`Using previously generated persistent user ID: ${storedUserId}`);
        return storedUserId;
      }
      
      // PRIORITY 3: Try additional known locations for user information (MSAL)
      const msalAccount = sessionStorage.getItem('msal.account.keys');
      if (msalAccount) {
        try {
          const accountKeys = JSON.parse(msalAccount);
          if (accountKeys && accountKeys.length > 0) {
            const accountKey = accountKeys[0];
            const accountData = sessionStorage.getItem(`msal.account.${accountKey}`);
            if (accountData) {
              const account = JSON.parse(accountData);
              if (account && account.idTokenClaims) {
                // Try multiple potential ID fields from MSAL
                const potentialIds = [
                  account.idTokenClaims.oid,
                  account.idTokenClaims.sub,
                  account.idTokenClaims.uid,
                  account.idTokenClaims.id,
                  account.localAccountId,
                  account.homeAccountId
                ];
                
                for (const potentialId of potentialIds) {
                  if (potentialId) {
                    debugLog(`Found user ID from MSAL account data: ${potentialId}`);
                    // Store for future use
                    localStorage.setItem('cardforge_persistent_user_id', potentialId);
                    return potentialId;
                  }
                }
              }
            }
          }
        } catch (e) {
          debugLog('Error parsing MSAL account data: ' + e);
        }
      }
      
      // PRIORITY 4 (LAST RESORT): Generate a browser fingerprint-based ID that's consistent
      // This ensures each browser gets its own storage even without formal authentication
      // NOTE: This should only be used if no auth-based ID is available
      debugLog('No authentication-based ID found, generating browser fingerprint ID');
      
      const browserInfo = [
        navigator.userAgent,
        navigator.language,
        window.screen.colorDepth,
        window.screen.width + 'x' + window.screen.height,
        navigator.platform || 'unknown',
        (navigator.doNotTrack ? 'DNT' : 'no-DNT')
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
      debugLog(`WARNING: Using browser-generated ID instead of authenticated ID may cause issues with publishing`);
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
    
    // Try to get the most reliable user ID possible
    const userId = getUserId();
    if (!userId) {
      return Promise.reject(new Error('User not authenticated'));
    }
    
    // Double-check with CardForgeAuth for the most accurate ID when possible
    let authUserId = userId;
    if (window.CardForgeAuth && typeof window.CardForgeAuth.getUserId === 'function') {
      const cardForgeAuthId = window.CardForgeAuth.getUserId();
      if (cardForgeAuthId && cardForgeAuthId !== 'unknown') {
        authUserId = cardForgeAuthId;
        // Update the persistent ID if it's not matching
        if (authUserId !== userId) {
          debugLog(`Updating persistent user ID from ${userId} to authenticated ID ${authUserId}`);
          localStorage.setItem('cardforge_persistent_user_id', authUserId);
        }
      }
    }
    
    try {
      // Add metadata to the cards
      const cardsWithMetadata = cards.map(card => ({
        ...card,
        lastModified: new Date().toISOString(),
        userId: userId
      }));
      
      // Connect to the Ambient Pixels API endpoint
      const apiUrl = getApiUrl('saveCards');
      debugLog(`Connecting to API endpoint ${apiUrl}`);
      debugLog(`Using user ID: ${authUserId} (from authenticated source)`); 
      debugLog(`Auth state attributes: ${document.body.getAttribute('data-auth-state')}`);
      debugLog(`API environment: ${API_CONFIG.production ? 'Production' : 'Development'}`);
      
      // Add userId to first card for debugging
      if (cards.length > 0) {
        cards[0] = { ...cards[0], userId: authUserId };
        debugLog(`Added userId to first card: ${JSON.stringify(cards[0])}`);
      }
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': authUserId
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
      
      // API failed but no fallback - cloud storage only
      debugLog('API failed, cloud storage is required');
      
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
      const apiUrl = getApiUrl('loadCards', { userId });
      debugLog(`Connecting to API endpoint ${apiUrl}`);
      debugLog(`Using user ID: ${userId} (from ${getUserId === null ? 'null' : 'valid'} source)`);
      debugLog(`API environment: ${API_CONFIG.production ? 'Production' : 'Development'}`);
      
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
      
      // API failed but no fallback to localStorage - cloud storage only
      debugLog('API failed, cloud storage is required');
      
      // Return empty array since we couldn't load from cloud
      return [];
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
  
  /**
   * Publish a card to the public gallery
   * @param {Object} card - Card object to publish
   * @returns {Promise<Object>} Promise resolving to the publish result
   */
  CardForgeCloud.publishCard = async function(card) {
    debugLog('Publishing card to gallery');
    
    // Get authenticated user ID
    const userId = getUserId();
    if (!userId) {
      return Promise.reject(new Error('Authentication required to publish cards'));
    }
    
    // Validate card object
    if (!card || !card.id) {
      return Promise.reject(new Error('Invalid card data'));
    }
    
    try {
      // Create a clean copy of the card for publishing
      const publishableCard = { ...card };
      
      // Remove sensitive data
      delete publishableCard.privateNotes;
      delete publishableCard.personalInfo;
      delete publishableCard.email;
      delete publishableCard.secretNotes;
      
      // Add metadata
      publishableCard.userId = userId;
      publishableCard.publishRequestTime = new Date().toISOString();
      
      // Connect to the API
      const apiUrl = getApiUrl('publishCard') + '/' + card.id;
      debugLog(`Connecting to publish API endpoint ${apiUrl}`);
      debugLog(`Using user ID: ${userId}`);
      debugLog(`API environment: ${API_CONFIG.production ? 'Production' : 'Development'}`);
      
      // Send request with authentication headers
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': userId
        },
        body: JSON.stringify({
          userId: userId,
          card: publishableCard
        })
      });
      
      debugLog(`API response status: ${response.status} ${response.statusText}`);
      
      // Handle non-OK responses
      if (!response.ok) {
        let errorMessage = `Error publishing to gallery: ${response.status} ${response.statusText}`;
        
        // Try to get more detailed error message
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
          debugLog('Error details:', errorData);
        } catch (parseError) {
          debugLog('Failed to parse error response');
        }
        
        throw new Error(errorMessage);
      }
      
      // Parse successful response
      const result = await response.json();
      debugLog('Publish response:', result);
      
      // Update the local card with published status
      if (window.cardForge && typeof window.cardForge.getCards === 'function') {
        const cards = window.cardForge.getCards();
        const cardIndex = cards.findIndex(c => c.id === card.id);
        
        if (cardIndex >= 0) {
          cards[cardIndex].isPublic = true;
          cards[cardIndex].isPublished = true;
          cards[cardIndex].publishedAt = result.publishedAt || new Date().toISOString();
          
          // Save the updated cards
          if (typeof window.cardForge.saveCards === 'function') {
            window.cardForge.saveCards();
            debugLog('Updated local card with published status');
          }
        }
      }
      
      return result;
    } catch (error) {
      debugLog(`Error publishing card: ${error.message}`);
      return Promise.reject(new Error(`Failed to publish card: ${error.message}`));
    }
  };
  
  /**
   * Load gallery cards (public)
   * @param {string} cardId - ID of the card to publish
   * @returns {Promise} Promise that resolves with publish result
   */
  CardForgeCloud.publishCard = async function(cardId) {
    debugLog(`Publishing card with ID: ${cardId}`);
    
    // Check if we're authenticated
    let userId = null;
    
    // PRIORITY: Use CardForgeAuth if available (most reliable)
    if (window.CardForgeAuth && typeof window.CardForgeAuth.getUserId === 'function') {
      userId = window.CardForgeAuth.getUserId();
      
      if (!userId || userId === 'unknown') {
        debugLog('CardForgeAuth.getUserId() returned empty or unknown user ID');
        
        // Fall back to other methods
        userId = getUserId();
      } else {
        debugLog(`Using authenticated user ID from CardForgeAuth: ${userId}`);
      }
    } else {
      // Fall back to general getUserId function
      userId = getUserId();
      debugLog(`CardForgeAuth not available, using general getUserId: ${userId}`);
    }
    
    if (!userId || userId === 'unknown') {
      return Promise.reject(new Error('User not authenticated. Please sign in to publish cards.'));
    }
    
    // Find the card in local storage before attempting to publish
    let foundCard = null;
    if (window.cardForge && typeof window.cardForge.getCards === 'function') {
      const localCards = window.cardForge.getCards();
      foundCard = localCards.find(card => card.id === cardId);
      
      if (foundCard) {
        debugLog(`Found card in local storage: ${foundCard.name}`);
      } else {
        debugLog(`Card with ID ${cardId} not found in local storage`);
      }
    }
    
    try {
      // Connect to the Ambient Pixels API endpoint
      const apiUrl = `${getApiUrl('publishCard')}/${cardId}`;
      debugLog(`Connecting to publish API endpoint ${apiUrl}`);
      debugLog(`Using user ID: ${userId}`);
      debugLog(`API environment: ${API_CONFIG.production ? 'Production' : 'Development'}`);
      
      // Add card data for publishing in case the backend can't find it
      const requestBody = {};
      if (foundCard) {
        requestBody.card = foundCard;
        debugLog('Including card data in publish request for reliability');
      }
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          // Send user ID in both lowercase and original case for maximum compatibility
          'x-user-id': userId,
          'X-User-ID': userId
        },
        body: Object.keys(requestBody).length > 0 ? JSON.stringify(requestBody) : null
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
        if (response.status === 401) {
          throw new Error('Authentication error: ' + (result.message || 'Please sign in again to publish cards.'));
        } else if (response.status === 404) {
          throw new Error('Card not found: ' + (result.message || 'The selected card could not be found.'));
        } else {
          throw new Error(result.message || `Error publishing card: ${response.status} ${response.statusText}`);
        }
      }
      
      debugLog(`Published card ${cardId} successfully`);
      
      // Update the local card to show it's published
      if (foundCard && window.cardForge && typeof window.cardForge.getCards === 'function') {
        const localCards = window.cardForge.getCards();
        const cardIndex = localCards.findIndex(card => card.id === cardId);
        
        if (cardIndex >= 0) {
          localCards[cardIndex].isPublic = true;
          
          // Update the UI if possible
          if (typeof window.renderCardList === 'function') {
            window.renderCardList();
          }
          
          debugLog('Updated local card to show published status');
        }
      }
      
      return result;
    } catch (e) {
      debugLog('Error publishing card:', e);
      return Promise.reject(new Error('Failed to publish card: ' + e.message));
    }
  };
  
  /**
   * Load gallery cards (public)
   * @param {Object} options - Options including filter, sort, page
   * @returns {Promise} Promise that resolves with gallery cards
   */
  CardForgeCloud.loadGalleryCards = async function(options = {}) {
    debugLog('Loading gallery cards');
    
    try {
      // Connect to the Ambient Pixels API endpoint
      const apiUrl = getApiUrl('gallery', options);
      debugLog(`Connecting to gallery API endpoint ${apiUrl}`);
      debugLog(`API environment: ${API_CONFIG.production ? 'Production' : 'Development'}`);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json'
        }
      });
      
      debugLog(`API response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        // Handle 404 errors gracefully during deployment phase
        if (response.status === 404) {
          debugLog('Gallery API returned 404, likely still deploying. Returning empty dataset.');
          return { cards: [], pagination: { total: 0, page: 1 } };
        }
        
        const errorResult = await response.json().catch(() => ({}));
        throw new Error(errorResult.message || `Error loading gallery: ${response.status} ${response.statusText}`);
      }
      
      const cards = await response.json();
      debugLog(`Loaded ${cards.length} gallery cards`);
      return cards;
    } catch (e) {
      debugLog('Error loading gallery cards:', e);
      // Return properly formatted empty result for graceful degradation
      return { cards: [], pagination: { total: 0, page: 1 } };
    }
  }; /* updated by Cascade - Added graceful error handling for deployment phase */
  
  /**
   * Load personal cards (authenticated)
   * @param {Object} options - Options including filter, sort, page
   * @returns {Promise} Promise that resolves with personal cards
   */
  CardForgeCloud.loadPersonalCards = async function(options = {}) {
    debugLog('Loading personal cards');
    
    const userId = getUserId();
    if (!userId) {
      return Promise.reject(new Error('User not authenticated'));
    }
    
    try {
      // Connect to the Ambient Pixels API endpoint
      const apiUrl = getApiUrl('myCards', { ...options, userId });
      debugLog(`Connecting to personal cards API endpoint ${apiUrl}`);
      debugLog(`Using user ID: ${userId}`);
      debugLog(`API environment: ${API_CONFIG.production ? 'Production' : 'Development'}`);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-ID': userId // Pass user ID in header for authentication
        }
      });
      
      debugLog(`API response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        // Handle 404 errors gracefully during deployment phase
        if (response.status === 404) {
          debugLog('Personal cards API returned 404, likely still deploying. Returning empty dataset.');
          return { cards: [], pagination: { total: 0, page: 1 } };
        }
        
        const errorResult = await response.json().catch(() => ({}));
        throw new Error(errorResult.message || `Error loading personal cards: ${response.status} ${response.statusText}`);
      }
      
      const cards = await response.json();
      debugLog(`Loaded ${cards.length} personal cards`);
      return cards;
    } catch (e) {
      debugLog('Error loading personal cards:', e);
      // Return properly formatted empty result for graceful degradation
      return { cards: [], pagination: { total: 0, page: 1 } };
    }
  }; /* updated by Cascade - Added graceful error handling for deployment phase */
  
  // Initialize when the script loads
  debugLog('Cloud storage service initialized');
  debugLog(`API environment: ${API_CONFIG.production ? 'Production' : 'Development'}`);
  
})();
