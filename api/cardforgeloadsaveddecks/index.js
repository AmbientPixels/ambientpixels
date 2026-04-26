const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
    return;
  }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 200, headers: CORS_HEADERS, body: { decks: [], anonymous: true } };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobPath = `user/${userId}/decks.json`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);

    const exists = await withRetry(() => blobClient.exists(), 'check user decks blob', context);
    if (!exists) {
      context.res = { status: 200, headers: CORS_HEADERS, body: { decks: [], updatedAt: null } };
      return;
    }

    const dl = await withRetry(() => blobClient.download(), 'download user decks', context);
    const text = await streamToText(dl.readableStreamBody);

    let payload = { decks: [], updatedAt: null };
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.decks)) {
        payload = { decks: parsed.decks, updatedAt: parsed.updatedAt || null };
      }
    } catch (e) {
      context.log.warn(`Corrupt user decks blob for ${userId}: ${e.message}`);
    }

    context.res = { status: 200, headers: CORS_HEADERS, body: payload };
  } catch (error) {
    context.log.error(`Load saved decks error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
