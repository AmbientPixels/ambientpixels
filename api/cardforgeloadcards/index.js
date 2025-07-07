const fetch = require('node-fetch');

/**
 * CardForge Load Cards API
 * Loads cards based on user authentication status
 * For authenticated users: Returns their personal cards + gallery cards
 * For anonymous users: Returns default cards + gallery cards
 */

// Direct URLs to Blob Storage files
const BLOB_BASE_URL = "https://cardforgeblobdata.blob.core.windows.net/cardforge";
const DEFAULT_CARDS_URL = `${BLOB_BASE_URL}/default-cards.json`;
const PUBLISHED_CARDS_URL = `${BLOB_BASE_URL}/published-cards.json`;

// Helper function to get user-specific blob URL
function getUserCardsUrl(userId) {
  return `${BLOB_BASE_URL}/user/${userId}/cards.json`;
}

// Helper function to safely fetch JSON from a URL with retry logic
async function fetchJsonWithRetry(url, context, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        context.log(`Retry attempt ${attempt + 1}/${maxRetries} for ${url}`);
      }
      
      const response = await fetch(url, { 
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        const responseText = await response.text();
        context.log.warn(`HTTP error ${response.status} for ${url}: ${responseText.substring(0, 200)}`);
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (parseError) {
        context.log.error(`JSON parse error for ${url}: ${parseError.message}`);
        context.log.error(`Invalid JSON response (first 200 chars): ${text.substring(0, 200)}`);
        throw new Error(`Invalid JSON response: ${parseError.message}`);
      }
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error
      const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE'];
      const isRetryable = 
        (error.code && retryableErrors.includes(error.code)) ||
        (error.message && error.message.includes('network')) ||
        (error.name === 'AbortError');
      
      if (!isRetryable && attempt === maxRetries - 1) {
        context.log.error(`Non-retryable error fetching ${url}: ${error.message}`);
        throw error;
      }
      
      // Use exponential backoff with jitter
      const delay = Math.min(Math.pow(2, attempt) * 100 + Math.random() * 100, 3000);
      context.log.warn(`Retrying in ${delay}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  context.log.error(`Failed to fetch ${url} after ${maxRetries} attempts`);
  throw lastError;
}

module.exports = async function (context, req) {
  try {
    context.log('JavaScript HTTP trigger function processed a request for cardforgeloadcards');
    
    // Get user information from the request
    const userId = req.headers['x-user-id'] || 'anonymous';
    const isAuthenticated = userId !== 'anonymous';
    context.log(`User ID: ${userId}, Authenticated: ${isAuthenticated}`);
    
    let userCards = [];
    let galleryCards = [];

    // Load gallery cards
    try {
      const galleryData = await fetchJsonWithRetry(PUBLISHED_CARDS_URL, context);
      galleryCards = galleryData.publishedCards || [];
      context.log(`Loaded ${galleryCards.length} gallery cards`);
    } catch (error) {
      context.log.error(`Error loading published cards: ${error.message}`);
      galleryCards = [];
    }

    if (isAuthenticated) {
      // For authenticated users, load their personal cards
      const userCardsUrl = getUserCardsUrl(userId);
      
      try {
        const userData = await fetchJsonWithRetry(userCardsUrl, context);
        userCards = userData.cards || [];
        context.log(`Loaded ${userCards.length} user cards`);
      } catch (error) {
        // Handle 404 specially (user doesn't have cards yet)
        if (error.message && error.message.includes('HTTP error 404')) {
          context.log(`No cards found for user ${userId}`);
          userCards = [];
        } else {
          context.log.error(`Error loading user cards: ${error.message}`);
          userCards = [];
        }
      }
    } else {
      // For anonymous users, load default cards
      try {
        const defaultData = await fetchJsonWithRetry(DEFAULT_CARDS_URL, context);
        userCards = defaultData.defaultCards || [];
        context.log(`Loaded ${userCards.length} default cards`);
      } catch (error) {
        context.log.error(`Error loading default cards: ${error.message}`);
        userCards = [];
      }
    }
    
    // Return both user cards and gallery cards
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID'
      },
      body: {
        userCards,
        galleryCards
      }
    };
  } catch (error) {
    context.log.error(`Error in cardforgeloadcards: ${error.message}`);
    
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID'
      },
      body: {
        error: `Failed to load cards: ${error.message}`
      }
    };
  }
};