const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { extractUserInfo } = require('../_utils/cfAuth');
const { loadEntitlements, toClientSafe, isAdminUser, PRO_FLAGS } = require('../_lib/stripe/entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    const { userId, isAuthenticated } = extractUserInfo(req, context);

    // Anonymous users get free defaults
    if (!isAuthenticated) {
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: toClientSafe(null)
      };
      return;
    }

    // Admin override — always return Pro for admin users
    if (isAdminUser(userId)) {
      const adminFlags = {};
      for (const f of PRO_FLAGS) adminFlags[f] = true;
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { tier: 'pro', flags: adminFlags, subscriptionStatus: 'active', hasActiveSubscription: true }
      };
      return;
    }

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    const record = await loadEntitlements(containerClient, userId);
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: toClientSafe(record)
    };
  } catch (error) {
    context.log.error('[CardForge Entitlements] Error: ' + error.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Entitlements error: ' + error.message }
    };
  }
};
