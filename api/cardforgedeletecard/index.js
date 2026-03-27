const { BlobServiceClient } = require('@azure/storage-blob');

// Azure Storage configuration
const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";

// Create blob service client using connection string (preferred) or managed identity
async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  // Fallback to managed identity
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
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
      context.log.warn(`Failed to parse client principal: ${err.message}`);
    }
  }
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, isAuthenticated: true };
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) {
      context.log(`[DEV AUTH] Using X-User-ID: ${devUserId}`);
      return { userId: devUserId, isAuthenticated: true };
    }
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

function getUserCardsPath(userId) {
  return `user/${userId}/cards.json`;
}

async function downloadJsonBlobWithRetry(containerClient, blobName, context) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return [];
  const download = await blobClient.download(0);
  const chunks = [];
  for await (const chunk of download.readableStreamBody) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    context.log.error(`JSON parse error for blob ${blobName}: ${e.message}`);
    throw e;
  }
}

async function uploadJsonBlob(containerClient, blobName, data) {
  const content = JSON.stringify(data, null, 2);
  const blockClient = containerClient.getBlockBlobClient(blobName);
  await blockClient.upload(content, Buffer.byteLength(content));
}

module.exports = async function (context, req) {
  context.log('Processing cardforgedeletecard request');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
      },
      body: ''
    };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  // Health-check for DELETE API
  /* updated by Cascade 2025-07-19 */
  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
      },
      body: { status: 'ok', message: 'CardForge Delete Card service is online' }
    };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method Not Allowed' };
    return;
  }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  // Allow anonymous access: set userId to 'anonymous' if not authenticated
  // (No blocking, no 401 response)
  // userId is already set by extractUserInfo; proceed with delete


  const cardId = req.body && req.body.id;
  if (!cardId) {
    context.res = { status: 400, body: 'Missing card id' };
    return;
  }

  const blobServiceClient = await createBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  try {
    const path = getUserCardsPath(userId);
    context.log(`Deleting card ${cardId} from path: ${path}`);
    
    let userCardsData = await downloadJsonBlobWithRetry(containerClient, path, context);
    
    // Handle the { cards: [...] } structure used by save API
    let cards = [];
    if (Array.isArray(userCardsData)) {
      cards = userCardsData;
    } else if (userCardsData && Array.isArray(userCardsData.cards)) {
      cards = userCardsData.cards;
    }
    
    // Wager/lock guard: prevent deletion of locked or wagered cards
    const targetCard = cards.find(c => c.id === cardId);
    if (targetCard) {
      if (targetCard.inActiveWager) {
        context.res = {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: { error: 'Cannot delete a card that is in an active wager' }
        };
        return;
      }
      // Check if card is locked on Blindspot profile
      try {
        const bsProfilePath = `blindspot/profiles/${userId}.json`;
        const bsProfile = await downloadJsonBlobWithRetry(containerClient, bsProfilePath, context);
        if (bsProfile && Array.isArray(bsProfile.lockedCards) && bsProfile.lockedCards.includes(cardId)) {
          context.res = {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: { error: 'Cannot delete a locked card. Unlock it first.' }
          };
          return;
        }
      } catch (profileErr) {
        context.log.warn(`Could not check lock status: ${profileErr.message}`);
        // Continue with deletion if profile check fails — fail-open for backwards compat
      }
    }

    const originalCount = cards.length;
    const filtered = cards.filter(c => c.id !== cardId);

    if (filtered.length === originalCount) {
      context.log.warn(`Card ${cardId} not found in user's cards`);
    } else {
      context.log(`Removed card ${cardId}, ${originalCount} -> ${filtered.length} cards`);
    }
    
    // Save back in the same structure
    const dataToSave = Array.isArray(userCardsData) ? filtered : { cards: filtered };
    await uploadJsonBlob(containerClient, path, dataToSave);
    
    // Also remove from published gallery if the card was published
    let unpublishedFromGallery = false;
    try {
      const publishedPath = 'published-cards.json';
      const publishedData = await downloadJsonBlobWithRetry(containerClient, publishedPath, context);
      
      if (publishedData && Array.isArray(publishedData.publishedCards)) {
        const originalPublishedCount = publishedData.publishedCards.length;
        publishedData.publishedCards = publishedData.publishedCards.filter(c => c.id !== cardId);
        
        if (publishedData.publishedCards.length < originalPublishedCount) {
          await uploadJsonBlob(containerClient, publishedPath, publishedData);
          unpublishedFromGallery = true;
          context.log(`Also removed card ${cardId} from published gallery`);
        }
      }
    } catch (pubErr) {
      context.log.warn(`Could not check/update published gallery: ${pubErr.message}`);
    }
    
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { success: true, remainingCards: filtered.length, unpublishedFromGallery }
    };
  } catch (e) {
    context.log.error(`Delete card error: ${e.message}`);
    context.res = { status: 500, body: { error: 'Server error', details: e.message } };
  }
};
