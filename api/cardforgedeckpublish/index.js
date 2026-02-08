const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const crypto = require('crypto');

// Configuration constants — mirrors cardforgepublish
const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With'
};

// Helper: extract user info from EasyAuth header (same as cardforgepublish)
function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'];
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      const clientPrincipal = JSON.parse(decoded);
      const userId = clientPrincipal.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      if (context && context.log) context.log.warn(`Failed to parse client principal: ${err.message}`);
    }
  }
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, isAuthenticated: true };
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) return { userId: devUserId, isAuthenticated: true };
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

// Helper: stream to text (same as cardforgepublish)
async function streamToText(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (d) => chunks.push(d.toString()));
    readableStream.on('end', () => resolve(chunks.join('')));
    readableStream.on('error', reject);
  });
}

// Helper: create blob service client (same as cardforgepublish)
async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

// Helper: retry wrapper (same as cardforgepublish)
async function withRetry(operation, operationName, context, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) context.log(`Retry ${attempt + 1}/${maxRetries} for ${operationName}`);
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = ['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE', 'REQUEST_SEND_ERROR'];
      const isRetryable = (error.code && retryable.includes(error.code)) ||
        (error.statusCode && (error.statusCode === 429 || (error.statusCode >= 500 && error.statusCode < 600)));
      if (!isRetryable) throw error;
      const delay = Math.min(Math.pow(2, attempt) * 100 + Math.random() * 100, 3000);
      context.log.warn(`Retryable error in ${operationName}: ${error.message}. Retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// Generate a short, URL-safe share ID
function generateShareId() {
  return crypto.randomBytes(6).toString('base64url'); // 8-char URL-safe string
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // GET: health check
  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { status: 'ok', message: 'CardForge deck publish service is online' }
    };
    return;
  }

  context.log('cardforgedeckpublish: Processing POST request');

  try {
    const body = req.body;
    if (!body || !body.deckId || !body.name) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'deckId and name are required' } };
      return;
    }

    // Resolve user
    let { userId, isAuthenticated } = extractUserInfo(req, context);
    if (userId === 'anonymous' && body.userId && body.userId !== 'anonymous') {
      userId = body.userId;
      isAuthenticated = true;
    }
    context.log(`User: ${userId}, authenticated: ${isAuthenticated}`);

    // Connect to blob storage
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // ----- Determine shareId (reuse if republishing) -----
    const indexPath = 'published-decks-index.json';
    const indexBlobClient = containerClient.getBlockBlobClient(indexPath);
    let index = { publishedDecks: [] };

    const indexExists = await withRetry(() => indexBlobClient.exists(), 'check index exists', context);
    if (indexExists) {
      const dl = await withRetry(() => indexBlobClient.download(), 'download index', context);
      const txt = await streamToText(dl.readableStreamBody);
      try {
        index = JSON.parse(txt);
        if (!index || !Array.isArray(index.publishedDecks)) index = { publishedDecks: [] };
      } catch (e) {
        context.log.warn('Index parse error, resetting');
        index = { publishedDecks: [] };
      }
    }

    // Find existing entry by deckId + userId (stable link on republish)
    let entry = index.publishedDecks.find(d => d.deckId === body.deckId && d.userId === userId);
    let shareId;
    const now = new Date().toISOString();

    if (entry) {
      shareId = entry.shareId;
      entry.name = body.name;
      entry.icon = body.icon || '';
      entry.deckImage = body.deckImage || '';
      entry.description = body.description || '';
      entry.tags = body.tags || [];
      entry.visibility = body.visibility || 'unlisted';
      entry.updatedAt = now;
      entry.cardCount = (body.cards || []).length;
      context.log(`Republishing deck, reusing shareId: ${shareId}`);
    } else {
      shareId = generateShareId();
      entry = {
        shareId,
        deckId: body.deckId,
        userId,
        name: body.name,
        icon: body.icon || '',
        deckImage: body.deckImage || '',
        description: body.description || '',
        tags: body.tags || [],
        visibility: body.visibility || 'unlisted',
        cardCount: (body.cards || []).length,
        createdAt: now,
        updatedAt: now
      };
      index.publishedDecks.push(entry);
      context.log(`New deck publish, shareId: ${shareId}`);
    }

    // ----- Build deck payload -----
    const deckPayload = {
      shareId,
      deckId: body.deckId,
      name: body.name,
      icon: body.icon || '',
      deckImage: body.deckImage || '',
      description: body.description || '',
      tags: body.tags || [],
      visibility: body.visibility || 'unlisted',
      publishedBy: userId,
      createdAt: body.createdAt || now,
      updatedAt: now,
      cards: (body.cards || []).map(c => ({
        cardId: c.cardId || c.id,
        name: c.name || c.title || '',
        preview: c.preview || null
      }))
    };

    // ----- Upload deck blob -----
    const deckBlobPath = `published-decks/${shareId}.json`;
    const deckBlobClient = containerClient.getBlockBlobClient(deckBlobPath);
    const deckData = JSON.stringify(deckPayload);
    const deckBuffer = Buffer.from(deckData, 'utf8');

    await withRetry(
      () => deckBlobClient.upload(deckBuffer, deckBuffer.byteLength, {
        blobHTTPHeaders: { blobContentType: 'application/json' }
      }),
      `upload deck blob (${deckBlobPath})`,
      context
    );
    context.log(`Deck blob uploaded: ${deckBlobPath}`);

    // ----- Upload updated index -----
    const indexData = JSON.stringify(index);
    const indexBuffer = Buffer.from(indexData, 'utf8');
    await withRetry(
      () => indexBlobClient.upload(indexBuffer, indexBuffer.byteLength, {
        blobHTTPHeaders: { blobContentType: 'application/json' }
      }),
      `upload index (${indexPath})`,
      context
    );
    context.log('Index updated');

    // Return success
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        success: true,
        shareId,
        name: body.name,
        cardCount: deckPayload.cards.length,
        updatedAt: now
      }
    };

  } catch (error) {
    context.log.error(`Deck publish error: ${error.message}`);
    context.log.error(`Stack: ${error.stack}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Failed to publish deck: ${error.message}` }
    };
  }
};
