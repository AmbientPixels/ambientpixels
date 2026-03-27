const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

const RARITY_BONUS = {
  common: 0,
  uncommon: 5,
  rare: 15,
  epic: 25,
  legendary: 40
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

function computeSellValue(card) {
  const stats = card.combatStats || {};
  const str = stats.str || 0;
  const agi = stats.agi || 0;
  const int = stats.int || 0;
  const end = stats.end || 0;
  const lck = stats.lck || 0;
  const totalStats = str + agi + int + end + lck;
  const statBonus = Math.floor(totalStats / 50);

  const rarityKey = (card.rarity || 'common').toLowerCase();
  const rarityBonus = RARITY_BONUS[rarityKey] || 0;

  return 10 + statBonus + rarityBonus;
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  // Health check
  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { status: 'ok', message: 'CardForge Sell Card service is online' }
    };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
    return;
  }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Sign in to sell cards' } };
    return;
  }

  const cardId = req.body && req.body.cardId;
  if (!cardId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Missing cardId' } };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // Load user cards
    const cardsPath = `user/${userId}/cards.json`;
    const userCardsData = await downloadJsonBlob(containerClient, cardsPath);
    let cards = [];
    if (Array.isArray(userCardsData)) {
      cards = userCardsData;
    } else if (userCardsData && Array.isArray(userCardsData.cards)) {
      cards = userCardsData.cards;
    }

    const cardIndex = cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found in your collection' } };
      return;
    }

    const card = cards[cardIndex];

    // Block if card is in an active wager
    if (card.inActiveWager) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot sell a card that is in an active wager' } };
      return;
    }

    // Block if card is locked
    const profilePath = `blindspot/profiles/${userId}.json`;
    const profile = await downloadJsonBlob(containerClient, profilePath);
    const lockedCards = (profile && profile.lockedCards) || [];
    if (lockedCards.includes(cardId)) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot sell a locked card. Unlock it first.' } };
      return;
    }

    // Compute sell value
    const sparksEarned = computeSellValue(card);

    // Remove card from collection
    cards.splice(cardIndex, 1);
    const dataToSave = Array.isArray(userCardsData) ? cards : { cards, lastUpdated: new Date().toISOString() };
    await uploadJsonBlob(containerClient, cardsPath, dataToSave);

    // Credit sparks to Blindspot profile
    let newBalance = sparksEarned;
    if (profile) {
      profile.sparks = (profile.sparks || 0) + sparksEarned;
      newBalance = profile.sparks;
      await uploadJsonBlob(containerClient, profilePath, profile);
    }

    // Remove from published gallery if present
    let unpublishedFromGallery = false;
    try {
      const publishedData = await downloadJsonBlob(containerClient, 'published-cards.json');
      if (publishedData && Array.isArray(publishedData.publishedCards)) {
        const originalCount = publishedData.publishedCards.length;
        publishedData.publishedCards = publishedData.publishedCards.filter(c => c.id !== cardId);
        if (publishedData.publishedCards.length < originalCount) {
          await uploadJsonBlob(containerClient, 'published-cards.json', publishedData);
          unpublishedFromGallery = true;
        }
      }
    } catch (pubErr) {
      context.log.warn(`Could not check/update published gallery: ${pubErr.message}`);
    }

    context.log(`[SellCard] User ${userId} sold card ${cardId} (${card.name || 'unnamed'}) for ${sparksEarned} sparks. New balance: ${newBalance}`);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        success: true,
        sparksEarned,
        newBalance,
        remainingCards: cards.length,
        unpublishedFromGallery
      }
    };
  } catch (err) {
    context.log.error(`[SellCard] Error: ${err.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: err.message } };
  }
};
