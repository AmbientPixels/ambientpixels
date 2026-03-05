const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { extractUserInfo } = require('../_utils/cfAuth');
const { createPortalSession, SITE_URL } = require('../_lib/stripe/stripeClient');
const { loadEntitlements } = require('../_lib/stripe/entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  try {
    const { userId, isAuthenticated } = extractUserInfo(req, context);

    if (!isAuthenticated) {
      context.res = {
        status: 401,
        headers: CORS_HEADERS,
        body: { error: 'Authentication required' }
      };
      return;
    }

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    const record = await loadEntitlements(containerClient, userId);
    if (!record || !record.stripeCustomerId) {
      context.res = {
        status: 400,
        headers: CORS_HEADERS,
        body: { error: 'No billing account found. Subscribe first.' }
      };
      return;
    }

    const session = await createPortalSession({
      customerId: record.stripeCustomerId,
      returnUrl: SITE_URL + '/cardforge/'
    });

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { portalUrl: session.url }
    };
  } catch (error) {
    context.log.error('[CardForge Billing Portal] Error: ' + error.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Billing portal error: ' + error.message }
    };
  }
};
