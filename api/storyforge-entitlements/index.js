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

// StoryForge-specific computed values
const FREE_DEFAULTS = {
  tier: 'free',
  hasActiveSubscription: false,
  sfAllGenres: false,
  sfUnlimitedAdventures: false,
  sfAllImages: false,
  sfExtraSaves: false,
  dailyLimit: 3,
  imageFrequency: 2,    // every 2 turns
  maxSaveSlots: 1
};

const PRO_VALUES = {
  dailyLimit: 999,
  imageFrequency: 1,    // every turn
  maxSaveSlots: 999
};

function toStoryForgeResponse(record) {
  if (!record) return FREE_DEFAULTS;

  const base = toClientSafe(record);
  const isPro = base.hasActiveSubscription;

  return {
    tier: base.tier,
    hasActiveSubscription: isPro,
    sfAllGenres: hasFlag(record, 'sfAllGenres'),
    sfUnlimitedAdventures: hasFlag(record, 'sfUnlimitedAdventures'),
    sfAllImages: hasFlag(record, 'sfAllImages'),
    sfExtraSaves: hasFlag(record, 'sfExtraSaves'),
    dailyLimit: isPro ? PRO_VALUES.dailyLimit : FREE_DEFAULTS.dailyLimit,
    imageFrequency: isPro ? PRO_VALUES.imageFrequency : FREE_DEFAULTS.imageFrequency,
    maxSaveSlots: isPro ? PRO_VALUES.maxSaveSlots : FREE_DEFAULTS.maxSaveSlots
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

    // Admin override — always return Pro for admin users
    if (isAdminUser(userId)) {
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          tier: 'pro', hasActiveSubscription: true,
          sfAllGenres: true, sfUnlimitedAdventures: true, sfAllImages: true, sfExtraSaves: true,
          dailyLimit: PRO_VALUES.dailyLimit, imageFrequency: PRO_VALUES.imageFrequency, maxSaveSlots: PRO_VALUES.maxSaveSlots
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
      body: toStoryForgeResponse(record)
    };
  } catch (error) {
    context.log.error('[SF Entitlements] Error: ' + error.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Entitlements error: ' + error.message }
    };
  }
};
