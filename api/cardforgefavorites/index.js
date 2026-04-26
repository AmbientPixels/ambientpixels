const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CF-Auth-Principal',
  // Per-user response — never cache publicly.
  'Cache-Control': 'private, no-store'
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
  // Custom forwarded header set by window._cfGetAuthHeaders() — same trust
  // posture as the SWA-injected one (browser had to call /.auth/me to get it).
  const cfHeader = req.headers['x-cf-auth-principal'];
  if (cfHeader) {
    try {
      const parsed = JSON.parse(cfHeader);
      const userId = parsed.userId || 'anonymous';
      if (userId !== 'anonymous') return { userId, isAuthenticated: true };
    } catch (err) {
      context.log.warn(`Failed to parse X-CF-Auth-Principal: ${err.message}`);
    }
  }
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, isAuthenticated: true };
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) {
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
    // Anonymous → empty list, 200. Lets the splash/gallery boot without a
    // 401 noise log when the user isn't signed in.
    context.res = { status: 200, headers: CORS_HEADERS, body: { cardIds: [] } };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobClient = containerClient.getBlockBlobClient(`user/${userId}/favorites.json`);

    const exists = await blobClient.exists();
    if (!exists) {
      context.res = { status: 200, headers: CORS_HEADERS, body: { cardIds: [] } };
      return;
    }

    const dl = await blobClient.download();
    const text = await streamToText(dl.readableStreamBody);
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {
      context.log.warn(`favorites parse failed for ${userId}: ${e.message}`);
    }

    const cardIds = (parsed && Array.isArray(parsed.cardIds)) ? parsed.cardIds : [];
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { cardIds, updatedAt: (parsed && parsed.updatedAt) || null }
    };
  } catch (error) {
    context.log.error(`cardforgefavorites error for ${userId}: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
