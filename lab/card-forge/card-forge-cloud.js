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
      if (authState !== 'signed-in') {
        return null;
      }
      
      // Get user info from session storage
      const userInfoStr = sessionStorage.getItem('userInfo');
      if (!userInfoStr) {
        return null;
      }
      
      const userInfo = JSON.parse(userInfoStr);
      
      // Try to get user ID from various properties
      const userId = userInfo.localAccountId || 
                    userInfo.oid || 
                    userInfo.sub ||
                    userInfo.username;
                    
      if (!userId) {
        debugLog('No user ID found in user info');
        return null;
      }
      
      return userId;
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
      // Create storage key with user ID to isolate user data
      const storageKey = `ambient-pixels-cards-${userId}`;
      
      // Add metadata to the cards
      const cardsWithMetadata = cards.map(card => ({
        ...card,
        lastModified: new Date().toISOString(),
        userId: userId
      }));
      
      // For now, we'll use localStorage as a placeholder
      // In production, this would connect to Ambient Pixels cloud API
      localStorage.setItem(storageKey, JSON.stringify(cardsWithMetadata));
      
      // Update card counts
      updateCardCounts(cardsWithMetadata);
      
      debugLog(`Saved ${cards.length} cards to cloud for user ${userId}`);
      return Promise.resolve({
        success: true,
        message: `Saved ${cards.length} cards to your Ambient Pixels account`,
        count: cards.length
      });
    } catch (e) {
      debugLog('Error saving cards: ' + e);
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
      // Get storage key with user ID
      const storageKey = `ambient-pixels-cards-${userId}`;
      
      // For now, we'll use localStorage as a placeholder
      // In production, this would connect to Ambient Pixels cloud API
      const cardsJson = localStorage.getItem(storageKey);
      
      if (!cardsJson) {
        debugLog('No cards found for user ' + userId);
        return Promise.resolve([]);
      }
      
      const cards = JSON.parse(cardsJson);
      
      // Update card counts
      updateCardCounts(cards);
      
      debugLog(`Loaded ${cards.length} cards from cloud for user ${userId}`);
      return Promise.resolve(cards);
    } catch (e) {
      debugLog('Error loading cards: ' + e);
      return Promise.reject(new Error('Failed to load cards: ' + e.message));
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
