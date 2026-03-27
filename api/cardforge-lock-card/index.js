const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const MAX_LOCKED_CARDS = 3;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
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

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

async function downloadJsonBlob(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;
  const download = await blobClient.download(0);
  const chunks = [];
  for await (const chunk of download.readableStreamBody) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function uploadJsonBlob(containerClient, blobName, data) {
  const content = JSON.stringify(data, null, 2);
  const blobClient = containerClient.getBlockBlobClient(blobName);
  await blobClient.upload(content, Buffer.byteLength(content), {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { status: 'ok', message: 'CardForge Lock Card service is online' }
    };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
    return;
  }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Sign in to lock cards' } };
    return;
  }

  const cardId = req.body && req.body.cardId;
  const action = req.body && req.body.action; // 'lock' or 'unlock'

  if (!cardId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Missing cardId' } };
    return;
  }
  if (action !== 'lock' && action !== 'unlock') {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'action must be "lock" or "unlock"' } };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // Verify the card exists in user's collection
    const cardsPath = `user/${userId}/cards.json`;
    const userCardsData = await downloadJsonBlob(containerClient, cardsPath);
    let cards = [];
    if (Array.isArray(userCardsData)) {
      cards = userCardsData;
    } else if (userCardsData && Array.isArray(userCardsData.cards)) {
      cards = userCardsData.cards;
    }
    const card = cards.find(c => c.id === cardId);
    if (!card) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found in your collection' } };
      return;
    }

    // Load Blindspot profile
    const profilePath = `blindspot/profiles/${userId}.json`;
    let profile = await downloadJsonBlob(containerClient, profilePath);
    if (!profile) {
      profile = { userId, lockedCards: [] };
    }
    if (!Array.isArray(profile.lockedCards)) {
      profile.lockedCards = [];
    }

    if (action === 'lock') {
      // Already locked?
      if (profile.lockedCards.includes(cardId)) {
        context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, lockedCards: profile.lockedCards, message: 'Card is already locked' } };
        return;
      }
      // Max lock limit
      if (profile.lockedCards.length >= MAX_LOCKED_CARDS) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot lock more than ' + MAX_LOCKED_CARDS + ' cards. Unlock one first.' } };
        return;
      }
      // Cannot lock a card in an active wager
      if (card.inActiveWager) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot lock a card that is in an active wager' } };
        return;
      }

      profile.lockedCards.push(cardId);
    } else {
      // Unlock
      profile.lockedCards = profile.lockedCards.filter(id => id !== cardId);
    }

    await uploadJsonBlob(containerClient, profilePath, profile);

    context.log(`[LockCard] User ${userId} ${action}ed card ${cardId}. Locked: [${profile.lockedCards.join(', ')}]`);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        success: true,
        action,
        cardId,
        lockedCards: profile.lockedCards
      }
    };
  } catch (err) {
    context.log.error(`[LockCard] Error: ${err.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: err.message } };
  }
};
