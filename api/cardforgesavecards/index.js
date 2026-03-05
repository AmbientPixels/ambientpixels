const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

/* updated by Cascade */

// Configuration constants
const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

// Helper to extract authenticated user information from Static Web Apps EasyAuth header
function extractUserInfo(req, context) {
  // Check SWA-injected header first, then custom forwarded header
  const principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
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

/**
 * Creates an authenticated BlobServiceClient using managed identity
 * @returns {BlobServiceClient} - Authenticated blob service client
 */
async function createBlobServiceClient() {
  // Prefer connection string when available (local or explicit config)
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  // Fallback to Managed Identity via DefaultAzureCredential
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
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

/* updated by Cascade 2025-07-15 */
module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgesavecards');
  context.log('HEADERS:', JSON.stringify(req.headers)); // Debug: output all incoming request headers
  context.log(`Request headers: ${JSON.stringify(req.headers)}`);

  // Add CORS headers to all responses
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CSRF-Token, X-User-ID, X-CF-Auth-Principal, x-functions-key",
    "Content-Type": "application/json"
  };

  // TEMP: Return all headers for debug purposes (disabled)
  // context.res = {
  //   status: 200,
  //   headers: corsHeaders,
  //   body: {
  //     debugHeaders: req.headers,
  //     message: 'TEMP: Debugging request headers for authentication.'
  //   }
  // };
  // return;

  // CORS preflight
  if (req.method === "OPTIONS") {
    context.res = {
      status: 204,
      headers: corsHeaders,
      body: ''
    };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  // Handle GET requests for API status checks
  /* updated by Cascade 2025-07-15 */
  if (req.method === "GET") {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: "ok", message: "CardForge Save Cards service is online" }
    };
    return;
  }

  try {
    // Check if the request has a body
    if (!req.body) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-User-ID, X-CF-Auth-Principal'
        },
        body: { error: 'Request body is required' }
      };
      return;
    }

    // Extract user information from EasyAuth header
    const { userId, isAuthenticated } = extractUserInfo(req, context);
  context.log(`Extracted user info: userId=${userId}, isAuthenticated=${isAuthenticated}`);
    
    // Allow anonymous access: set userId to 'anonymous' if not authenticated
    // (No blocking, no 401 response)
    // userId is already set by extractUserInfo; proceed with save

    // Get the card data from the request body
    const card = req.body;
    
    // Validate card data
    const validationErrors = validateCard(card);
    if (validationErrors.length > 0) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-User-ID, X-CF-Auth-Principal'
        },
        body: { error: 'Invalid card data', validationErrors }
      };
      return;
    }

    // Create authenticated blob service client with managed identity
    context.log('Creating authenticated blob service client with managed identity');
    const blobServiceClient = await createBlobServiceClient();
    context.log(`Connected to Blob Storage account: ${STORAGE_ACCOUNT_NAME}`);
    
    // Get container client
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    context.log(`Using container: ${CONTAINER_NAME}`);
    
    // Verify container exists (with retry logic)
    try {
      const containerExists = await withRetry(
        () => containerClient.exists(),
        `check if container exists (${CONTAINER_NAME})`,
        context
      );
      
      if (!containerExists) {
        throw new Error(`Container ${CONTAINER_NAME} does not exist`);
      }
      
      context.log(`Container '${CONTAINER_NAME}' verified.`);
    } catch (error) {
      context.log.error(`Error verifying container: ${error.message}`);
      throw new Error(`Failed to access container: ${error.message}`);
    }

    // Path to user's cards file
    const userBlobPath = `user/${userId}/cards.json`;
    // Use BlockBlobClient for all operations to be consistent
    const userBlobClient = containerClient.getBlockBlobClient(userBlobPath);
    let userCards = { cards: [] };
    let userBlobExists = false;
    
    try {
      // Check if blob exists with retry
      userBlobExists = await withRetry(
        () => userBlobClient.exists(),
        `check if user blob exists (${userBlobPath})`,
        context
      );
      
      if (userBlobExists) {
        // Download the existing cards with retry
        const downloadResponse = await withRetry(
          () => userBlobClient.download(),
          `download user blob (${userBlobPath})`,
          context
        );
        
        const blobContents = await streamToText(downloadResponse.readableStreamBody);
        
        try {
          // Parse and validate the JSON structure
          userCards = JSON.parse(blobContents);
          
          // Validate the structure
          if (!userCards || !userCards.cards || !Array.isArray(userCards.cards)) {
            context.log.warn(`Invalid user cards format for ${userId}, resetting to empty array`);
            userCards = { cards: [] };
          }
          
          context.log(`Downloaded existing cards for user ${userId}, found ${userCards.cards.length} cards.`);
        } catch (parseError) {
          context.log.error(`Error parsing user cards JSON: ${parseError.message}`);
          context.log.warn(`Creating new cards structure for user ${userId} due to parsing error`);
          userCards = { cards: [] };
        }
      } else {
        context.log(`No existing cards for user ${userId}, will create new cards file.`);
      }
    } catch (error) {
      context.log.error(`Error checking or downloading user cards: ${error.message}`);
      // Continue with empty cards array
      userCards = { cards: [] };
    }

    // Check if the card already exists (update) or is new (add)
    const existingCardIndex = userCards.cards.findIndex(c => c.id === card.id);
    
    if (existingCardIndex >= 0) {
      // Update existing card - preserve published status from existing card
      const existingCard = userCards.cards[existingCardIndex];
      userCards.cards[existingCardIndex] = {
        ...card,
        // Preserve published status if it exists on the existing card
        published: card.published || existingCard.published || false,
        publishDate: card.publishDate || existingCard.publishDate || null,
        lastModified: new Date().toISOString()
      };
      context.log(`Updated existing card with ID: ${card.id}, published: ${userCards.cards[existingCardIndex].published}`);
    } else {
      // Add new card with metadata
      userCards.cards.push({
        ...card,
        id: card.id || `card-${Date.now()}`,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        userId: userId
      });
      context.log(`Added new card with ID: ${card.id || 'card-' + Date.now()}`);
    }
    
    // Update the lastUpdated timestamp
    userCards.lastUpdated = new Date().toISOString();
    
    // Upload the updated cards file with optimistic concurrency control using ETags
    let data = JSON.stringify(userCards);
    
    // Maximum number of attempts for optimistic concurrency
    const maxConcurrencyAttempts = 5;
    let attempt = 0;
    let success = false;
    let lastError = null;
    let eTag = null;
    
    // If we downloaded an existing blob, get its ETag for optimistic concurrency
    if (userBlobExists) {
      try {
        const properties = await withRetry(
          () => userBlobClient.getProperties(),
          `get blob properties (${userBlobPath})`,
          context
        );
        eTag = properties.etag;
        context.log(`Retrieved ETag ${eTag} for optimistic concurrency control`);
      } catch (error) {
        context.log.warn(`Could not retrieve ETag, will proceed without optimistic concurrency: ${error.message}`);
      }
    }
    
    // Attempt upload with optimistic concurrency
    while (!success && attempt < maxConcurrencyAttempts) {
      try {
        attempt++;
        if (attempt > 1) {
          context.log(`Optimistic concurrency attempt ${attempt}/${maxConcurrencyAttempts}`);
          
          // On retry, re-download the latest version and merge our changes
          try {
            const latestProperties = await withRetry(
              () => userBlobClient.getProperties(),
              `get latest blob properties (${userBlobPath})`,
              context
            );
            
            // Download the latest version
            const downloadResponse = await withRetry(
              () => userBlobClient.download(),
              `download latest user blob (${userBlobPath})`,
              context
            );
            
            const latestBlobContents = await streamToText(downloadResponse.readableStreamBody);
            const latestUserCards = JSON.parse(latestBlobContents);
            
            // Update our ETag for the next attempt
            eTag = latestProperties.etag;
            
            // Merge our changes with the latest version
            // Strategy: Keep our updated/new card but preserve all other cards
            const ourCardId = existingCardIndex >= 0 ? card.id : userCards.cards[userCards.cards.length - 1].id;
            const ourCardData = userCards.cards.find(c => c.id === ourCardId);
            
            // Find if our card exists in the latest version
            const latestCardIndex = latestUserCards.cards.findIndex(c => c.id === ourCardId);
            
            if (latestCardIndex >= 0) {
              // Update existing card in the latest version
              latestUserCards.cards[latestCardIndex] = ourCardData;
            } else {
              // Add our new card to the latest version
              latestUserCards.cards.push(ourCardData);
            }
            
            // Use the merged data for the next upload attempt
            userCards = latestUserCards;
            userCards.lastUpdated = new Date().toISOString();
            data = JSON.stringify(userCards);
            
            context.log(`Merged our changes with the latest version for retry attempt`);
          } catch (mergeError) {
            context.log.error(`Error merging changes: ${mergeError.message}`);
            // Continue with our original data if merge fails
          }
        }
        
        // Upload with conditional request using ETag if available
        const uploadOptions = {
          blobHTTPHeaders: { blobContentType: 'application/json' }
        };
        
        // Only add conditions if we have an ETag
        if (eTag) {
          uploadOptions.conditions = { ifMatch: eTag };
          context.log(`Using ETag ${eTag} for conditional upload`);
        }
        
        await withRetry(
          () => {
            // Use Buffer to ensure byte-accurate length for multibyte content
            const buffer = Buffer.from(data, 'utf8');
            return userBlobClient.upload(buffer, buffer.byteLength, uploadOptions);
          },
          `upload user cards with optimistic concurrency (${userBlobPath})`,
          context
        );
        
        success = true;
        context.log(`Successfully saved card data for user ${userId} on attempt ${attempt}`);
      } catch (error) {
        lastError = error;
        
        // Check if this is a concurrency conflict (412 Precondition Failed)
        if (error.statusCode === 412) {
          context.log.warn(`Optimistic concurrency conflict detected on attempt ${attempt}`);
          // Will retry with updated ETag
        } else {
          // For other errors, don't retry the concurrency loop
          context.log.error(`Non-concurrency error during upload: ${error.message}`);
          break;
        }
      }
    }
    
    // If all attempts failed, throw the last error
    if (!success) {
      if (lastError) {
        throw new Error(`Failed to save card after ${attempt} attempts: ${lastError.message}`);
      } else {
        throw new Error(`Failed to save card after ${attempt} attempts`);
      }
    }
    
    // Return success response
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-User-ID, X-CF-Auth-Principal'
      },
      body: {
        success: true,
        message: existingCardIndex >= 0 ? 'Card updated successfully' : 'Card saved successfully',
        cardId: existingCardIndex >= 0 ? card.id : userCards.cards[userCards.cards.length - 1].id
      }
    };
  } catch (error) {
    context.log.error(`Error in cardforgesavecards: ${error.message}`);
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-User-ID, X-CF-Auth-Principal'
      },
      body: { error: error.message }
    };
  }
};

/**
 * Validate card data
 * @param {object} card - The card data to validate
 * @returns {Array} Array of validation errors, empty if valid
 */
function validateCard(card) {
  const errors = [];
  
  // Check required fields
  if (!card.name || card.name.trim().length < 2 || card.name.trim().length > 30) {
    errors.push('Name must be between 2 and 30 characters');
  }
  
  if (!card.class || card.class.trim().length < 2 || card.class.trim().length > 20) {
    errors.push('Class/Type must be between 2 and 20 characters');
  }
  
  if (!card.avatar || !isValidUrl(card.avatar)) {
    if (typeof card.avatar === 'string' && card.avatar.trim().toLowerCase().startsWith('blob:')) {
      // Be explicit: blob: URLs are not persistable across sessions
      errors.push("Avatar/Image cannot be a 'blob:' URL. Convert to a data:image/... URL or upload to a reachable https path.");
    } else {
      errors.push('Avatar/Image must be a valid URL (absolute https, root-relative, or data:image/...)');
    }
  }
  
  // Check optional fields
  if (card.quote && card.quote.trim().length > 100) {
    errors.push('Quote/Description must be less than 100 characters');
  }
  
  if (card.achievement && card.achievement.trim().length > 50) {
    errors.push('Achievement must be less than 50 characters');
  }
  
  return errors;
}

/**
 * Check if a string is a valid URL
 * @param {string} url - The URL to validate
 * @returns {boolean} True if valid URL, false otherwise
 */
function isValidUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  const v = url.trim();
  // Allow root-relative paths (served from same host)
  if (v.startsWith('/')) return true;
  // Allow data URLs (embedded images)
  if (v.startsWith('data:image/')) return true;
  // Absolute URLs
  try { new URL(v); return true; } catch (_) { return false; }
}

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
