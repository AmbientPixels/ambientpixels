const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'storyforge';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CF-Auth-Principal',
  'Content-Type': 'application/json'
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
      context.log.warn(`Failed to parse client principal: ${err.message}`);
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

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

async function streamToText(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => chunks.push(data.toString()));
    readableStream.on('end', () => resolve(chunks.join('')));
    readableStream.on('error', reject);
  });
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    const { userId, isAuthenticated } = extractUserInfo(req, context);
    if (!isAuthenticated) {
      context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
      return;
    }

    context.log(`[storyforgeload] Loading adventures for user ${userId}`);

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    const blobPath = `user/${userId}/adventures.json`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);

    let adventures = [];
    try {
      const exists = await blobClient.exists();
      if (exists) {
        const downloadResponse = await blobClient.download();
        const content = await streamToText(downloadResponse.readableStreamBody);
        const parsed = JSON.parse(content);
        adventures = (parsed && Array.isArray(parsed.adventures)) ? parsed.adventures : [];
      }
    } catch (err) {
      context.log.warn(`Could not load adventures: ${err.message}`);
    }

    // Optional: filter by single adventure ID
    const adventureId = req.query && req.query.id;
    if (adventureId) {
      const single = adventures.find(a => a.adventureId === adventureId);
      context.res = {
        status: single ? 200 : 404,
        headers: CORS_HEADERS,
        body: single ? { adventure: single } : { error: 'Adventure not found' }
      };
      return;
    }

    context.log(`[storyforgeload] Loaded ${adventures.length} adventures for user ${userId}`);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        adventures: adventures,
        count: adventures.length
      }
    };
  } catch (error) {
    context.log.error(`[storyforgeload] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Load failed: ${error.message}` }
    };
  }
};
