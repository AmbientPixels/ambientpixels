const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With'
};

// Admin userIds who can delete any deck
const ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

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

function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

async function withRetry(fn, label, context, retries) {
  retries = retries || 3;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      context.log.warn(`${label} attempt ${i + 1} failed: ${e.message}`);
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // Health check
  if (req.method === 'GET') {
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', message: 'CardForge Deck Delete service is online' } };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
    return;
  }

  // Extract userId from EasyAuth headers or fall back to request body
  let { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated && req.body && req.body.userId && req.body.userId !== 'anonymous') {
    userId = req.body.userId;
    isAuthenticated = true;
    context.log(`Using userId from request body: ${userId}`);
  }

  const shareId = req.body && req.body.shareId;
  if (!shareId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Missing shareId' } };
    return;
  }

  if (!/^[A-Za-z0-9_-]{1,16}$/.test(shareId)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid shareId format' } };
    return;
  }

  const isAdmin = ADMIN_USER_IDS.includes(userId);
  context.log(`cardforgedeckdelete: shareId=${shareId}, userId=${userId}, isAdmin=${isAdmin}`);

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // ----- Load and update the published decks index -----
    const indexPath = 'published-decks-index.json';
    const indexBlobClient = containerClient.getBlockBlobClient(indexPath);
    const indexExists = await withRetry(() => indexBlobClient.exists(), 'check index', context);

    if (!indexExists) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'No published decks index found' } };
      return;
    }

    const dl = await withRetry(() => indexBlobClient.download(), 'download index', context);
    const indexText = await streamToText(dl.readableStreamBody);
    let index;
    try {
      index = JSON.parse(indexText);
    } catch (e) {
      context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Corrupt index data' } };
      return;
    }

    const decks = Array.isArray(index.publishedDecks) ? index.publishedDecks : [];
    const deckIdx = decks.findIndex(d => d.shareId === shareId);

    if (deckIdx === -1) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Deck not found in index' } };
      return;
    }

    const deckEntry = decks[deckIdx];

    // Authorization: only owner or admin can delete
    if (!isAdmin && deckEntry.userId !== userId) {
      context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Not authorized to delete this deck' } };
      return;
    }

    // Remove from index
    decks.splice(deckIdx, 1);
    index.publishedDecks = decks;

    const indexContent = JSON.stringify(index, null, 2);
    await withRetry(
      () => indexBlobClient.upload(Buffer.from(indexContent), Buffer.byteLength(indexContent), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        overwrite: true
      }),
      'upload updated index', context
    );
    context.log(`Removed deck ${shareId} from index`);

    // ----- Delete the deck blob -----
    const deckBlobPath = `published-decks/${shareId}.json`;
    const deckBlobClient = containerClient.getBlockBlobClient(deckBlobPath);
    const deckExists = await withRetry(() => deckBlobClient.exists(), 'check deck blob', context);
    if (deckExists) {
      await withRetry(() => deckBlobClient.delete(), 'delete deck blob', context);
      context.log(`Deleted deck blob: ${deckBlobPath}`);
    }

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { success: true, shareId, deletedBy: userId, isAdmin }
    };

  } catch (error) {
    context.log.error(`Deck delete error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
