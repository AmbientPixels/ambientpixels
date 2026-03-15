const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { extractUserInfo } = require('../_utils/cfAuth');
const { loadEntitlements, toClientSafe, hasFlag, isAdminUser } = require('../_lib/stripe/entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

// Pixel Agents free tier defaults
const FREE_DEFAULTS = {
  tier: 'free',
  hasActiveSubscription: false,
  paUnlimitedRuns: false,
  paPriorityQueue: false,
  paEarlyAccess: false,
  dailyLimit: 3,
  credits: 0
};

const PRO_VALUES = {
  dailyLimit: 999
};

function toPixelAgentsResponse(record) {
  if (!record) return FREE_DEFAULTS;

  const base = toClientSafe(record);
  const isPro = base.hasActiveSubscription;

  return {
    tier: base.tier,
    hasActiveSubscription: isPro,
    paUnlimitedRuns: hasFlag(record, 'paUnlimitedRuns'),
    paPriorityQueue: hasFlag(record, 'paPriorityQueue'),
    paEarlyAccess: hasFlag(record, 'paEarlyAccess'),
    dailyLimit: isPro ? PRO_VALUES.dailyLimit : FREE_DEFAULTS.dailyLimit,
    credits: record.paCredits || 0
  };
}

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

    if (!isAuthenticated) {
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: FREE_DEFAULTS
      };
      return;
    }

    // Admin override — always return Pro
    if (isAdminUser(userId)) {
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          tier: 'pro', hasActiveSubscription: true,
          paUnlimitedRuns: true, paPriorityQueue: true, paEarlyAccess: true,
          dailyLimit: PRO_VALUES.dailyLimit, credits: 999
        }
      };
      return;
    }

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    const record = await loadEntitlements(containerClient, userId);
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: toPixelAgentsResponse(record)
    };
  } catch (error) {
    context.log.error('[PA Entitlements] Error: ' + error.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Entitlements error: ' + error.message }
    };
  }
};
