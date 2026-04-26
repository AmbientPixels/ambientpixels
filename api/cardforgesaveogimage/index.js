// Save endpoint for per-card OG images.
//
// Accepts a raw PNG body (max 500KB) with cardId in query string. Auth
// required (anonymous = 401) — only signed-in users can write OG blobs,
// preventing strangers from overwriting any card's OG image. Validates
// PNG magic bytes + size cap + cardId pattern before writing.
//
// Storage path: cardforge/og-cards/{cardId}.png
//
// Pattern copied from api/cardforgeheroconfig/index.js for the auth
// extraction and BlobServiceClient wiring.

const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const MAX_BYTES = 500 * 1024; // 500KB hard cap
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, X-CF-Auth-Principal, X-User-ID'
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
  const swaPrincipal = req.headers['x-ms-client-principal'];
  if (swaPrincipal) {
    try {
      const decoded = Buffer.from(swaPrincipal, 'base64').toString('utf8');
      const cp = JSON.parse(decoded);
      const userId = cp.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      context.log.warn(`Failed to parse SWA principal: ${err.message}`);
    }
  }
  const cfPrincipal = req.headers['x-cf-auth-principal'];
  if (cfPrincipal) {
    try {
      const cp = JSON.parse(cfPrincipal);
      const userId = cp.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      context.log.warn(`Failed to parse X-CF-Auth-Principal: ${err.message}`);
    }
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) return { userId: devUserId, isAuthenticated: true };
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'auth_required' }) };
    return;
  }

  const cardId = (req.query && req.query.cardId) || '';
  if (!CARD_ID_PATTERN.test(cardId)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'invalid_card_id' }) };
    return;
  }

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    context.res = { status: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'empty_body' }) };
    return;
  }

  if (body.length > MAX_BYTES) {
    context.res = { status: 413, headers: CORS_HEADERS, body: JSON.stringify({ error: 'too_large', maxBytes: MAX_BYTES }) };
    return;
  }

  if (body.length < 8 || !body.subarray(0, 8).equals(PNG_MAGIC)) {
    context.res = { status: 415, headers: CORS_HEADERS, body: JSON.stringify({ error: 'not_a_png' }) };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobPath = `og-cards/${cardId}.png`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);
    await blobClient.uploadData(body, {
      blobHTTPHeaders: {
        blobContentType: 'image/png',
        blobCacheControl: 'public, max-age=2592000' // 30 days
      }
    });
    context.log(`[saveogimage] user=${userId} cardId=${cardId} bytes=${body.length}`);
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        cardId,
        path: blobPath,
        url: `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER_NAME}/${blobPath}`,
        bytes: body.length
      })
    };
  } catch (err) {
    context.log.error(`[saveogimage] blob write failed: ${err.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'storage_error' }) };
  }
};
