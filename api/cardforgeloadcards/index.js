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

// Helper function to convert stream to text
async function streamToText(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => {
      chunks.push(data.toString());
    });
    readableStream.on('end', () => {
      resolve(chunks.join(''));
    });
    readableStream.on('error', reject);
  });
}

/* updated by Cascade */
// Helper function to safely fetch JSON from a URL with improved retry logic
async function fetchJsonWithRetry(url, context, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        context.log(`Retry attempt ${attempt + 1}/${maxRetries} for ${url}`);
      }
      
      const response = await fetch(url, { 
        // Add timeout to avoid hanging requests
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
      const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE', 'REQUEST_SEND_ERROR'];
      const isRetryable = 
        (error.code && retryableErrors.includes(error.code)) ||
        (error.message && error.message.includes('network')) ||
        (error.type === 'system' && error.code === 'ETIMEDOUT') ||
        (error.name === 'AbortError');
      
      if (!isRetryable && attempt === maxRetries - 1) {
        context.log.error(`Non-retryable error fetching ${url}: ${error.message}`);
        throw error;
      }
      
      // Use exponential backoff with jitter
      const delay = Math.min(Math.pow(2, attempt) * 100 + Math.random() * 100, 3000);
      context.log.warn(`Retryable error fetching ${url}: ${error.message}. Retrying in ${delay}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  context.log.error(`Failed to fetch ${url} after ${maxRetries} attempts: ${lastError.message}`);
  throw lastError;
}

module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgeloadcards');

  try {
    // Log request details for debugging
    context.log('========== CARDFORGELOADCARDS DEBUG START ==========');
    context.log(`Request headers: ${JSON.stringify(req.headers)}`);
    context.log(`Request method: ${req.method}`);
    context.log(`Request URL: ${req.url}`);
    
    // Get user information from the request
    const userId = req.headers['x-user-id'] || 'anonymous';
    const isAuthenticated = userId !== 'anonymous';
    context.log(`User ID: ${userId}, Authenticated: ${isAuthenticated}`);
    
    context.log(`Default cards URL: ${DEFAULT_CARDS_URL}`);
    context.log(`Published cards URL: ${PUBLISHED_CARDS_URL}`);

    let userCards = [];
    let galleryCards = [];

    // Load gallery cards from the published cards URL with enhanced retry logic
    try {
      context.log(`Fetching published cards from ${PUBLISHED_CARDS_URL}`);
      const galleryData = await fetchJsonWithRetry(PUBLISHED_CARDS_URL, context);
      galleryCards = galleryData.publishedCards || [];
      context.log(`Loaded ${galleryCards.length} cards from public gallery`);
    } catch (error) {
      context.log.error(`Error loading published cards: ${error.message}`);
      galleryCards = [];
    }

    if (isAuthenticated) {
      // For authenticated users, load their personal cards
      const userCardsUrl = getUserCardsUrl(userId);
      context.log(`Fetching user cards from ${userCardsUrl}`);
      
      try {
        // Use improved retry logic for fetching user cards
        context.log(`Fetching user cards with retry logic from ${userCardsUrl}`);
        const userData = await fetchJsonWithRetry(userCardsUrl, context);
        userCards = userData.cards || [];
        context.log(`Loaded ${userCards.length} cards for user ${userId}`);
      } catch (error) {
        // Handle 404 case specially (user doesn't have cards yet)
        if (error.message && error.message.includes('HTTP error 404')) {
          context.log(`No cards found for user ${userId}, returning empty array`);
          userCards = [];
          // Note: Creating an empty cards file would require a POST request,
          // which we're not implementing here to keep it simple
        } else {
          context.log.error(`Error loading user cards: ${error.message}`);
          userCards = [];
        }
      }
    } else {
      // For anonymous users, load default cards
      try {
        context.log(`Fetching default cards from ${DEFAULT_CARDS_URL}`);
        const defaultData = await fetchJsonWithRetry(DEFAULT_CARDS_URL, context);
        userCards = defaultData.defaultCards || [];
        context.log(`Loaded ${userCards.length} default cards for anonymous user`);
      } catch (error) {
        context.log.error(`Error loading default cards: ${error.message}`);
        context.log.warn('Returning empty default cards array due to fetch error');
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
    context.log.error(`Error stack: ${error.stack}`);
    
    // Log detailed error information
    if (error.code) context.log.error(`Error code: ${error.code}`);
    if (error.statusCode) context.log.error(`Error status code: ${error.statusCode}`);
    if (error.details) context.log.error(`Error details: ${JSON.stringify(error.details)}`);
    
    context.log('========== CARDFORGELOADCARDS DEBUG END ==========');
    
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID'
      },
      body: {
        error: `Failed to load cards: ${error.message}`,
        errorDetails: {
          message: error.message,
          code: error.code || 'unknown',
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      }
    };
  }
  
  // Log completion
  if (!context.res) {
    context.log('========== CARDFORGELOADCARDS DEBUG END ==========');
  }
};
