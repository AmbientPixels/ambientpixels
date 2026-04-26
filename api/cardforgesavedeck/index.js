const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";
const MAX_DECKS_PER_USER = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, X-CF-Auth-Principal'
};

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
  if (principalHeader) {
    try {
      // SWA-injected header is base64; X-CF-Auth-Principal is plain JSON
      let decoded;
      try { decoded = Buffer.from(principalHeader, 'base64').toString('utf8'); }
      catch (_) { decoded = principalHeader; }
      let parsed;
      try { parsed = JSON.parse(decoded); }
      catch (_) { parsed = JSON.parse(principalHeader); }
      const userId = parsed.userId || 'anonymous';
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

function sanitizeDeck(input) {
  if (!input || typeof input !== 'object') return null;
  if (!input.id || !ID_PATTERN.test(input.id)) return null;
  const cardIds = Array.isArray(input.cardIds)
    ? input.cardIds.filter(id => typeof id === 'string' && ID_PATTERN.test(id)).slice(0, 500)
    : [];
  const tags = Array.isArray(input.tags)
    ? input.tags.filter(t => typeof t === 'string').map(t => String(t).slice(0, 64)).slice(0, 20)
    : [];
  return {
    id: input.id,
    name: typeof input.name === 'string' ? input.name.slice(0, 200) : 'Untitled Deck',
    icon: typeof input.icon === 'string' ? input.icon.slice(0, 64) : 'fas fa-layer-group',
    description: typeof input.description === 'string' ? input.description.slice(0, 2000) : '',
    deckImage: typeof input.deckImage === 'string' ? input.deckImage.slice(0, 8192) : '',
    cardIds: cardIds,
    tags: tags,
    shareId: typeof input.shareId === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(input.shareId) ? input.shareId : undefined,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    lastModified: new Date().toISOString()
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  if (req.method === 'GET') {
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', message: 'CardForge Save Deck service is online' } };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
    return;
  }

  let { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated && req.body && req.body.userId && req.body.userId !== 'anonymous') {
    userId = req.body.userId;
    isAuthenticated = true;
    context.log(`Using userId from request body: ${userId}`);
  }

  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
    return;
  }

  const incoming = sanitizeDeck(req.body && req.body.deck);
  if (!incoming) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid deck payload' } };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobPath = `user/${userId}/decks.json`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);

    let payload = { decks: [], version: 1, updatedAt: null };
    const exists = await withRetry(() => blobClient.exists(), 'check user decks blob', context);
    if (exists) {
      const dl = await withRetry(() => blobClient.download(), 'download user decks', context);
      const text = await streamToText(dl.readableStreamBody);
      try {
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.decks)) payload = parsed;
      } catch (e) {
        context.log.warn(`Corrupt user decks blob for ${userId}, resetting: ${e.message}`);
      }
    }

    const decks = Array.isArray(payload.decks) ? payload.decks : [];
    const idx = decks.findIndex(d => d && d.id === incoming.id);
    if (idx === -1) {
      if (decks.length >= MAX_DECKS_PER_USER) {
        context.res = { status: 413, headers: CORS_HEADERS, body: { error: 'Deck limit reached', limit: MAX_DECKS_PER_USER } };
        return;
      }
      // Preserve createdAt from incoming if provided, else stamp now
      decks.unshift(incoming);
    } else {
      // Preserve original createdAt
      const orig = decks[idx];
      const merged = Object.assign({}, incoming);
      if (orig && orig.createdAt) merged.createdAt = orig.createdAt;
      decks[idx] = merged;
    }

    const next = { decks, version: 1, updatedAt: new Date().toISOString() };
    const content = JSON.stringify(next);
    await withRetry(
      () => blobClient.upload(Buffer.from(content), Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        overwrite: true
      }),
      'upload user decks', context
    );

    const saved = decks.find(d => d && d.id === incoming.id) || incoming;
    context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, deck: saved, total: decks.length } };

  } catch (error) {
    context.log.error(`Save deck error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
