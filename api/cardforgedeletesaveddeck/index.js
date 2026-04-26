const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";
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

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  if (req.method === 'GET') {
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', message: 'CardForge Delete Saved Deck service is online' } };
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
  }
  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
    return;
  }

  const deckId = req.body && req.body.deckId;
  if (!deckId || !ID_PATTERN.test(deckId)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid deckId' } };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobPath = `user/${userId}/decks.json`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);

    const exists = await withRetry(() => blobClient.exists(), 'check user decks blob', context);
    if (!exists) {
      // Idempotent: nothing to delete
      context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, deckId, total: 0 } };
      return;
    }

    const dl = await withRetry(() => blobClient.download(), 'download user decks', context);
    const text = await streamToText(dl.readableStreamBody);

    let payload;
    try { payload = JSON.parse(text); }
    catch (_) { payload = { decks: [] }; }

    const before = Array.isArray(payload.decks) ? payload.decks.length : 0;
    const next = {
      decks: (Array.isArray(payload.decks) ? payload.decks : []).filter(d => d && d.id !== deckId),
      version: 1,
      updatedAt: new Date().toISOString()
    };

    const content = JSON.stringify(next);
    await withRetry(
      () => blobClient.upload(Buffer.from(content), Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        overwrite: true
      }),
      'upload user decks', context
    );

    context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, deckId, removed: before - next.decks.length, total: next.decks.length } };
  } catch (error) {
    context.log.error(`Delete saved deck error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
