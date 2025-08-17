const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

/**
 * CardForge Load Cards API
 * Loads cards based on user authentication status
 * For authenticated users: Returns their personal cards + gallery cards
 * For anonymous users: Returns default cards + gallery cards
 */

// Azure Storage configuration
const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";
const DEFAULT_CARDS_PATH = "default-cards.json";
const PUBLISHED_CARDS_PATH = "published-cards.json";

// Safe timeout signal helper for Node < 18 compatibility
function getAbortSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  // Fallback: manual AbortController timeout
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// Helper to create BlobServiceClient with connection-string fallback
async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  const accountUrl = `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;
  return new BlobServiceClient(accountUrl, credential);
}

// Helper to extract authenticated user information from Static Web Apps EasyAuth header
function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'];
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      const clientPrincipal = JSON.parse(decoded);
      const userId = clientPrincipal.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      if (context && context.log && typeof context.log.warn === 'function') {
        context.log.warn(`Failed to parse client principal: ${err.message}`);
      }
      // fall through to fallback logic
    }
  }
  // Fallback to client principal ID header
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, isAuthenticated: true };
  }
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

// Helper function to get user-specific blob path
function getUserCardsPath(userId) {
  return `user/${userId}/cards.json`;
}

// Helper function to safely download JSON blob with retry logic
async function downloadJsonBlobWithRetry(containerClient, blobName, context, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        context.log(`Retry attempt ${attempt + 1}/${maxRetries} for blob ${blobName}`);
      }
      
      // Get a reference to the blob
      const blobClient = containerClient.getBlockBlobClient(blobName);
      
      // Check if the blob exists
      const exists = await blobClient.exists();
      if (!exists) {
        // Do not create blobs on read; return empty data
        return [];
      }
      
      // Download the blob content with timeout
      const downloadResponse = await blobClient.download(0, undefined, {
        abortSignal: getAbortSignal(10000)
      });
      
      // Read the blob content as text
      const chunks = [];
      const stream = await downloadResponse.readableStreamBody;
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      
      const text = Buffer.concat(chunks).toString('utf8');
      
      try {
        return JSON.parse(text);
      } catch (parseError) {
        context.log.error(`JSON parse error for blob ${blobName}: ${parseError.message}`);
        context.log.error(`Invalid JSON content (first 200 chars): ${text.substring(0, 200)}`);
        throw new Error(`Invalid JSON content: ${parseError.message}`);
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
        context.log.error(`Non-retryable error fetching blob ${blobName}: ${error.message}`);
        throw error;
      }
      
      // Use exponential backoff with jitter
      const delay = Math.min(Math.pow(2, attempt) * 100 + Math.random() * 100, 3000);
      context.log.warn(`Retrying in ${delay}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  context.log.error(`Failed to fetch blob ${blobName} after ${maxRetries} attempts`);
  throw lastError;
}

// CORS support added by Cascade 2025-07-12
module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgeloadcards');
  // Debug: log incoming request details
  context.log(`[DEBUG] method=${req.method} query=${JSON.stringify(req.query)} headers=${JSON.stringify(req.headers)}`);
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
    return;
  }
  
  /* updated by Cascade 2025-07-14 - added health check for GET requests */
  // Handle GET requests for API status checks (matches pattern of working endpoints)
  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
      },
      body: { status: 'ok', message: 'CardForge load cards service is online' }
    };
    return;
  }
  try {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    context.log(`[${requestId}] CardForge LoadCards API request received`);
    
    // Log request details in development/staging
    if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
      context.log(`[${requestId}] Request headers: ${JSON.stringify(req.headers)}`);
      context.log(`[${requestId}] Request query: ${JSON.stringify(req.query)}`);
    }
    
    context.log('JavaScript HTTP trigger function processed a request for cardforgeloadcards');
    
    // Extract user information from EasyAuth header
    const { userId, isAuthenticated } = extractUserInfo(req, context);
    context.log(`[${requestId}] User ID: ${userId}, Authenticated: ${isAuthenticated}`);
    
    // If authenticated, log auth headers (for debugging only)
    if (isAuthenticated) {
      const authHeader = req.headers['authorization'];
      const csrfToken = req.headers['x-csrf-token'];
      context.log(`[${requestId}] Auth header present: ${!!authHeader}, CSRF token present: ${!!csrfToken}`);
    }
    // Always allow anonymous users to load cards (default/gallery); never block or return 401/403

    
    // Initialize Azure storage client with MI or connection string
    let blobServiceClient;
    try {
      // Log available environment variables for debugging (no secrets)
      context.log(`[${requestId}] Environment: ${process.env.AZURE_FUNCTIONS_ENVIRONMENT || 'unknown'}`); 
      context.log(`[${requestId}] Region: ${process.env.REGION_NAME || 'unknown'}`); 
      
      const usingConnStr = !!process.env.AZURE_STORAGE_CONNECTION_STRING;
      context.log(`[${requestId}] Creating BlobServiceClient using ${usingConnStr ? 'connection string' : 'DefaultAzureCredential'} for ${STORAGE_ACCOUNT_NAME}`);
      blobServiceClient = await createBlobServiceClient();
      context.log(`[${requestId}] Successfully created BlobServiceClient`);
    } catch (error) {
      context.log.error(`Failed to create BlobServiceClient: ${error.message}`);
      throw new Error(`Storage authentication failed: ${error.message}`);
    }

    // Get container client
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    
    let userCards = [];
    let galleryCards = [];

    // Load gallery cards
    try {
      context.log(`[${requestId}] Attempting to load gallery cards from blob path: ${PUBLISHED_CARDS_PATH}`);
      const blobClient = containerClient.getBlobClient(PUBLISHED_CARDS_PATH);
      context.log(`[${requestId}] Full blob URL: ${blobClient.url}`);
      
      const galleryData = await downloadJsonBlobWithRetry(containerClient, PUBLISHED_CARDS_PATH, context);
      
      if (!galleryData) {
        context.log.warn(`[${requestId}] Gallery data is null or undefined`);
        galleryCards = [];
      } else if (!galleryData.publishedCards) {
        context.log.warn(`[${requestId}] Gallery data does not contain publishedCards property: ${JSON.stringify(Object.keys(galleryData))}`);
        galleryCards = [];
      } else {
        galleryCards = galleryData.publishedCards;
        context.log(`[${requestId}] Successfully loaded ${galleryCards.length} gallery cards`);
      }
    } catch (error) {
      if (error.code === 'BlobNotFound') {
        context.log.warn(`[${requestId}] Published cards blob not found: ${PUBLISHED_CARDS_PATH}`);
        context.log.warn(`[${requestId}] This is expected for new deployments or if gallery is empty`);
      } else if (error.code === 'AuthorizationPermissionMismatch') {
        context.log.error(`[${requestId}] Authorization error: The managed identity does not have permission to read the blob`);
        context.log.error(`[${requestId}] Ensure the managed identity has the 'Storage Blob Data Reader' role`);
      } else {
        context.log.error(`[${requestId}] Error loading published cards: ${error.message}`);
        context.log.error(`[${requestId}] Error code: ${error.code}, Error details:`, error);
      }
      galleryCards = [];
    }

    /* updated by Cascade 2025-07-14 - fixed duplicate code for loading default cards */
    if (isAuthenticated) {
      // For authenticated users, load their personal cards
      const userCardsPath = getUserCardsPath(userId);
      
      try {
        const userData = await downloadJsonBlobWithRetry(containerClient, userCardsPath, context);
        userCards = userData.cards || [];
        context.log(`[${requestId}] Loaded ${userCards.length} user cards for user ${userId}`);
      } catch (error) {
        // Handle 404 specially (user doesn't have cards yet)
        if (error.code === 'BlobNotFound') {
          context.log(`[${requestId}] No cards found for user ${userId}`);
          userCards = [];
        } else {
          context.log.error(`[${requestId}] Error loading user cards for ${userId}: ${error.message}`);
          userCards = [];
        }
      }
    } else {
      // For anonymous users, load default cards
      try {
        const defaultData = await downloadJsonBlobWithRetry(containerClient, DEFAULT_CARDS_PATH, context);
        userCards = defaultData.defaultCards || [];
        context.log(`[${requestId}] Loaded ${userCards.length} default cards`);
      } catch (error) {
        if (error.code === 'BlobNotFound') {
          context.log.warn(`[${requestId}] Default cards blob not found: ${DEFAULT_CARDS_PATH}`);
        } else {
          context.log.error(`[${requestId}] Error loading default cards: ${error.message}`);
        }
        userCards = [];
      }
    }
    
    // Get default cards for display in the gallery section
    let defaultCards = [];
    // Only load default cards for gallery if we're authenticated (anonymous users already have default cards as their userCards)
    if (isAuthenticated) {
      try {
        context.log(`[${requestId}] Attempting to load default cards for gallery display`);
        const defaultCardsData = await downloadJsonBlobWithRetry(containerClient, DEFAULT_CARDS_PATH, context);
        defaultCards = defaultCardsData.defaultCards || [];
        context.log(`[${requestId}] Loaded ${defaultCards.length} default cards for gallery display`);
      } catch (error) {
        context.log.warn(`[${requestId}] Could not load default cards for gallery: ${error.message}`);
        // Continue with empty defaultCards array
      }
    }

    // Add diagnostic information in development
    const diagnostics = {
      requestId,
      timestamp: new Date().toISOString(),
      authenticated: isAuthenticated,
      userCardsCount: userCards.length,
      galleryCardsCount: galleryCards.length,
      defaultCardsCount: defaultCards.length,
      environment: process.env.AZURE_FUNCTIONS_ENVIRONMENT || 'unknown',
      storageAccount: STORAGE_ACCOUNT_NAME,
      containerName: CONTAINER_NAME,
      defaultCardsPath: DEFAULT_CARDS_PATH,
      publishedCardsPath: PUBLISHED_CARDS_PATH,
      userCardsPath: isAuthenticated ? getUserCardsPath(userId) : null
    };
    
    context.log(`[${requestId}] Successfully completed request. User cards: ${userCards.length}, Gallery cards: ${galleryCards.length}, Default cards: ${defaultCards.length}`);
    
    // Return all card arrays in the response
    // Ensure the response body is explicitly a non-array object with named card arrays
    const responseBody = {
      userCards: userCards || [],
      galleryCards: galleryCards || [],
      defaultCards: defaultCards || [], // Added defaultCards to match frontend expectations
      diagnostics: diagnostics || {}
    };
    
    // Force serialize to ensure object format is preserved
    const serializedBody = JSON.stringify(responseBody);
    
    context.log(`[${requestId}] Response structure: ${serializedBody.substring(0, 200)}...`);
    
    /* updated by Cascade 2025-07-14 - fixed response format */
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
      },
      body: responseBody // Using the object directly, not serialized
    };
  } catch (error) {
    // Generate a consistent error ID for tracking
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    context.log.error(`[${errorId}] Error in cardforgeloadcards: ${error.message}`);
    context.log.error(`[${errorId}] Stack trace: ${error.stack}`);
    
    // Add more detailed error diagnostics
    let errorType = 'unknown';
    if (error.name === 'AuthenticationRequiredError') errorType = 'auth';
    else if (error.code === 'BlobNotFound') errorType = 'not_found';
    else if (error.code && error.code.includes('ETIMEDOUT')) errorType = 'timeout';
    else if (error.name === 'AbortError') errorType = 'timeout';
    
    context.log.error(`[${errorId}] Error type: ${errorType}`); 
    
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: {
        error: `Failed to load cards: ${error.message}`,
        errorId: errorId,
        errorType: errorType,
        timestamp: new Date().toISOString()
      }
    };
  }
};