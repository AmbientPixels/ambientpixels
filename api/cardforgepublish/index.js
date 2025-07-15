const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const fetch = require('node-fetch');

/* updated by Cascade */

// Configuration constants
const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

// Helper to extract authenticated user information from Static Web Apps EasyAuth header
function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'];
  if (!principalHeader) {
    // Development fallback: use X-User-ID header to simulate auth
    if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
      const devUserId = req.headers['x-user-id'];
      if (devUserId) {
        context.log(`[DEV AUTH] Falling back to X-User-ID: ${devUserId}`);
        return { userId: devUserId, isAuthenticated: true };
      }
    }
    return { userId: 'anonymous', isAuthenticated: false };
  }
  try {
    const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
    const clientPrincipal = JSON.parse(decoded);
    const userId = clientPrincipal.userId || 'anonymous';
    return { userId, isAuthenticated: userId !== 'anonymous' };
  } catch (err) {
    if (context && context.log && typeof context.log.warn === 'function') {
      context.log.warn(`Failed to parse client principal: ${err.message}`);
    }
    return { userId: 'anonymous', isAuthenticated: false };
  }
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

/**
 * Creates an authenticated BlobServiceClient using managed identity
 * @returns {BlobServiceClient} - Authenticated blob service client
 */
async function createBlobServiceClient() {
  // Use DefaultAzureCredential which supports managed identities
  // This works in Azure Functions, Azure App Service, and other Azure services
  const credential = new DefaultAzureCredential();
  
  // Create blob service client with credential
  const blobServiceClient = new BlobServiceClient(
    `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    credential
  );
  
  return blobServiceClient;
}

/**
 * Performs a blob operation with retry logic
 * @param {Function} operation - The operation to perform
 * @param {string} operationName - Name of the operation for logging
 * @param {object} context - Azure Function context for logging
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<any>} - Result of the operation
 */
async function withRetry(operation, operationName, context, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        context.log(`Retry attempt ${attempt + 1}/${maxRetries} for ${operationName}`);
      }
      
      return await operation();
    } catch (error) {
      lastError = error;
      const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE', 'REQUEST_SEND_ERROR'];
      
      // Check if this is a retryable error
      const isRetryable = 
        error.code && retryableErrors.includes(error.code) ||
        error.statusCode && (error.statusCode === 429 || (error.statusCode >= 500 && error.statusCode < 600));
      
      if (!isRetryable) {
        context.log.error(`Non-retryable error in ${operationName}: ${error.message}`);
        throw error;
      }
      
      // Use exponential backoff with jitter
      const delay = Math.min(Math.pow(2, attempt) * 100 + Math.random() * 100, 3000);
      context.log.warn(`Retryable error in ${operationName}: ${error.message}. Retrying in ${delay}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  context.log.error(`Operation ${operationName} failed after ${maxRetries} attempts`);
  throw lastError;
}

module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgepublish');

  try {
    context.log('========== CARDFORGEPUBLISH DEBUG START ==========');
    context.log(`Request method: ${req.method}`);
    context.log(`Request headers: ${JSON.stringify(req.headers)}`);
    
    // Handle GET requests for API status checks
    // Updated by Cascade 2025-07-14
    if (req.method === 'GET') {
      context.res = {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
        },
        body: { status: 'ok', message: 'CardForge publish service is online' }
      };
      return;
    }
    
    context.log(`Request body: ${JSON.stringify(req.body)}`);
    
    // Check if the POST request has a body
    if (!req.body || !req.body.cardId) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
        },
        body: { error: 'Card ID is required' }
      };
      return;
    }

    // Extract user information from EasyAuth header
    const { userId, isAuthenticated } = extractUserInfo(req, context);
    context.log(`Extracted user info: userId=${userId}, isAuthenticated=${isAuthenticated}`);
    
    // Check if user is authenticated
    if (!isAuthenticated) {
      context.res = {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
        },
        body: { error: 'Authentication required to publish cards' }
      };
      return;
    }

    // Get the card ID from the request body
    const { cardId } = req.body;
    context.log(`Publishing card ID: ${cardId} for user: ${userId}`);
    
    // Create authenticated blob service client with managed identity
    const blobServiceClient = await createBlobServiceClient();
    context.log(`Connected to Blob Storage account: ${STORAGE_ACCOUNT_NAME}`);
    
    // Get container client
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    context.log(`Using container: ${CONTAINER_NAME}`);
    
    // Path to user's cards file
    const userBlobPath = `user/${userId}/cards.json`;
    const userBlobClient = containerClient.getBlockBlobClient(userBlobPath);
    context.log(`User blob path: ${userBlobPath}`);
    
    // Check if the user's cards file exists with retry logic
    const userBlobExists = await withRetry(
      () => userBlobClient.exists(),
      `check if user blob exists (${userBlobPath})`,
      context
    );
    
    if (!userBlobExists) {
      context.res = {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
        },
        body: { error: 'No cards found for this user' }
      };
      return;
    }
    
    // Read user's cards from blob storage
    try {
      // Get the user's cards with retry logic
      const downloadResponse = await withRetry(
        () => userBlobClient.download(),
        `download user blob (${userBlobPath})`,
        context
      );
      const userBlobContents = await streamToText(downloadResponse.readableStreamBody);
      
      // Parse JSON with validation
      let userCards;
      try {
        userCards = JSON.parse(userBlobContents);
        // Validate basic structure
        if (!userCards || !Array.isArray(userCards.cards)) {
          throw new Error('Invalid user cards format: missing cards array');
        }
      } catch (parseError) {
        context.log.error(`Error parsing user cards JSON: ${parseError.message}`);
        throw new Error(`Invalid user cards data format: ${parseError.message}`);
      }
      
      // Find the card to publish
      const cardToPublish = userCards.cards.find(c => c.id === cardId);
      
      if (!cardToPublish) {
        context.res = {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
          },
          body: { error: `Card with ID ${cardId} not found` }
        };
        return;
      }
      
      context.log(`Found card to publish: ${cardToPublish.title || cardToPublish.name}`);
    
      // Get published cards blob
      const publishedBlobPath = 'published-cards.json';
      const publishedBlobClient = containerClient.getBlockBlobClient(publishedBlobPath);
      context.log(`Published blob path: ${publishedBlobPath}`);
      
      // Check if published cards blob exists with retry logic
      let publishedCards = { publishedCards: [] };
      const publishedBlobExists = await withRetry(
        () => publishedBlobClient.exists(),
        `check if published blob exists (${publishedBlobPath})`,
        context
      );
      
      if (publishedBlobExists) {
        // Download published cards with retry logic
        const publishedDownloadResponse = await withRetry(
          () => publishedBlobClient.download(),
          `download published blob (${publishedBlobPath})`,
          context
        );
        
        const publishedBlobContents = await streamToText(publishedDownloadResponse.readableStreamBody);
        
        // Parse JSON with validation
        try {
          publishedCards = JSON.parse(publishedBlobContents);
          // Validate basic structure
          if (!publishedCards) {
            throw new Error('Invalid published cards format: null or undefined');
          }
          // Ensure publishedCards array exists
          if (!publishedCards.publishedCards) {
            context.log.warn('Published cards missing publishedCards array, initializing empty array');
            publishedCards.publishedCards = [];
          }
          context.log(`Found existing published cards: ${publishedCards.publishedCards.length}`);
        } catch (parseError) {
          context.log.error(`Error parsing published cards JSON: ${parseError.message}`);
          context.log.warn('Creating new published cards structure due to parsing error');
          publishedCards = { publishedCards: [] };
        }
      } else {
        // Create new published cards blob if it doesn't exist
        context.log('No published cards blob found, will create a new one');
      }
    
      // Check if the card is already published
      const existingPublishedIndex = publishedCards.publishedCards.findIndex(c => c.id === cardId);
      
      // Add the card to published cards with additional metadata
      const publishedCard = {
        ...cardToPublish,
        publishedBy: userId,
        publishDate: new Date().toISOString()
      };
      
      // Add or replace the card in published cards array
      const existingIndex = publishedCards.publishedCards ? 
        publishedCards.publishedCards.findIndex(c => c.id === cardId) : -1;
        
      if (!publishedCards.publishedCards) {
        publishedCards.publishedCards = [];
      }
      
      if (existingIndex >= 0) {
        publishedCards.publishedCards[existingIndex] = publishedCard;
        context.log(`Updated existing published card at index ${existingIndex}`);
      } else {
        publishedCards.publishedCards.push(publishedCard);
        context.log(`Added new published card to gallery`);
      }
      
      // Update the published cards blob with retry logic
      const publishedData = JSON.stringify(publishedCards);
      await withRetry(
        () => publishedBlobClient.upload(publishedData, publishedData.length, {
          blobHTTPHeaders: { blobContentType: 'application/json' }
        }),
        `upload published cards (${publishedBlobPath})`,
        context
      );
      
      // Update the card in user's cards to mark it as published
      const userCardIndex = userCards.cards.findIndex(c => c.id === cardId);
      if (userCardIndex >= 0) {
        userCards.cards[userCardIndex].published = true;
        userCards.cards[userCardIndex].publishDate = publishedCard.publishDate;
        
        // Update user's cards blob with the published status using retry logic
        const userData = JSON.stringify(userCards);
        await withRetry(
          () => userBlobClient.upload(userData, userData.length, {
            blobHTTPHeaders: { blobContentType: 'application/json' }
          }),
          `update user cards with published status (${userBlobPath})`,
          context
        );
        
        context.log(`Successfully updated user card ${cardId} as published`);
      }
      
      // Return success response
      context.res = {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
        },
        body: {
          success: true,
          message: `Card ${cardId} published successfully`,
          data: {
            cardId: cardId,
            publishedAt: publishedCard.publishDate
          }
        }
      };
      
    } catch (error) {
      context.log.error(`Error processing user cards: ${error.message}`);
      throw error; // Rethrow to be caught by the outer try/catch
    }
    
  } catch (error) {
    context.log.error(`Error publishing card: ${error.message}`);
    context.log.error(`Error stack: ${error.stack}`);
    
    if (error.code) context.log.error(`Error code: ${error.code}`);
    if (error.details) context.log.error(`Error details: ${JSON.stringify(error.details)}`);
    
    context.log('========== CARDFORGEPUBLISH DEBUG END ==========');
    
    // Return error response
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
      },
      body: {
        error: `Failed to publish card: ${error.message}`,
        errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    };
  }
  
  if (!context.res) {
    context.log('========== CARDFORGEPUBLISH DEBUG END ==========');
  }
};

/**
 * Convert a readable stream to text
 * @param {ReadableStream} readableStream - The stream to convert
 * @returns {Promise<string>} The stream content as text
 */
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
