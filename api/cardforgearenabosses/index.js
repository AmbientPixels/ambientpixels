const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const path = require('path');
const fs = require('fs');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
};

function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'];
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      const clientPrincipal = JSON.parse(decoded);
      const userId = clientPrincipal.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      if (context && context.log && typeof context.log.warn === 'function') {
        context.log.warn(`Failed to parse client principal: ${err.message}`);
      }
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

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

function getAbortSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function downloadJsonBlob(containerClient, blobName, context) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;

  const downloadResponse = await blobClient.download(0, undefined, {
    abortSignal: getAbortSignal(10000)
  });
  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Load boss data from static JSON file bundled with the function
let _bossCache = null;
function loadBossData() {
  if (_bossCache) return _bossCache;
  const bossPath = path.resolve(__dirname, 'arena-bosses.json');
  _bossCache = JSON.parse(fs.readFileSync(bossPath, 'utf8'));
  return _bossCache;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    const bossData = loadBossData();
    const { userId, isAuthenticated } = extractUserInfo(req, context);

    let highestBossDefeated = 0;

    // If authenticated, load their arena profile to check PvE progress
    if (isAuthenticated) {
      try {
        const blobServiceClient = await createBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
        const profile = await downloadJsonBlob(containerClient, `arena/profiles/${userId}.json`, context);
        if (profile && profile.pveProgress) {
          highestBossDefeated = profile.pveProgress.highestBossDefeated || 0;
        }
      } catch (err) {
        context.log.warn(`[Arena Bosses] Could not load profile for ${userId}: ${err.message}`);
      }
    }

    // Demo users get first 3 bosses unlocked; authenticated users use their progress
    const isDemo = !isAuthenticated;
    const bosses = bossData.bosses.map(boss => ({
      id: boss.id,
      bossLevel: boss.bossLevel,
      name: boss.name,
      class: boss.class,
      quote: boss.quote,
      avatar: boss.avatar,
      bio: boss.bio,
      stats: boss.stats,
      badges: boss.badges,
      locked: isDemo ? boss.bossLevel > 3 : boss.bossLevel > highestBossDefeated + 1
    }));

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { bosses }
    };
  } catch (error) {
    context.log.error(`[Arena Bosses] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Arena bosses error: ${error.message}` }
    };
  }
};
