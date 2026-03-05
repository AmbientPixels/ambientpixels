const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { loadEntitlements, hasFlag } = require('../_lib/stripe/entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'storyforge';
const ENTITLEMENTS_CONTAINER = 'cardforge';
const FREE_MAX_SAVES = 1;
const PRO_MAX_SAVES = 999;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  // Health check
  if (req.method === 'GET') {
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', service: 'storyforgesave' } };
    return;
  }

  try {
    if (!req.body) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Request body required' } };
      return;
    }

    const { userId, isAuthenticated } = extractUserInfo(req, context);
    if (!isAuthenticated) {
      context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
      return;
    }

    const adventure = req.body;
    if (!adventure.adventureId) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'adventureId required' } };
      return;
    }

    context.log(`[storyforgesave] Saving adventure ${adventure.adventureId} for user ${userId}`);

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // Create container if it doesn't exist
    await containerClient.createIfNotExists();

    const blobPath = `user/${userId}/adventures.json`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);

    // Load existing adventures
    let allAdventures = { adventures: [], lastUpdated: null };
    try {
      const exists = await blobClient.exists();
      if (exists) {
        const downloadResponse = await blobClient.download();
        const content = await streamToText(downloadResponse.readableStreamBody);
        const parsed = JSON.parse(content);
        if (parsed && Array.isArray(parsed.adventures)) {
          allAdventures = parsed;
        }
      }
    } catch (err) {
      context.log.warn(`Could not load existing adventures: ${err.message}`);
    }

    // Upsert the adventure
    const existingIdx = allAdventures.adventures.findIndex(a => a.adventureId === adventure.adventureId);
    if (existingIdx >= 0) {
      allAdventures.adventures[existingIdx] = adventure;
      context.log(`[storyforgesave] Updated existing adventure ${adventure.adventureId}`);
    } else {
      // Save slot enforcement for NEW adventures
      const inProgressCount = allAdventures.adventures.filter(
        a => a.status !== 'completed' && a.status !== 'abandoned'
      ).length;

      let maxSaves = FREE_MAX_SAVES;
      try {
        const entContainerClient = blobServiceClient.getContainerClient(ENTITLEMENTS_CONTAINER);
        const entRecord = await loadEntitlements(entContainerClient, userId);
        if (hasFlag(entRecord, 'sfExtraSaves')) {
          maxSaves = PRO_MAX_SAVES;
        }
      } catch (e) {
        context.log.warn(`[storyforgesave] Could not load entitlements: ${e.message}`);
      }

      if (inProgressCount >= maxSaves) {
        context.res = {
          status: 403,
          headers: CORS_HEADERS,
          body: { error: 'Save slot limit reached (' + maxSaves + '). Upgrade to Pro for unlimited saves.', code: 'SAVE_LIMIT' }
        };
        return;
      }

      allAdventures.adventures.push(adventure);
      context.log(`[storyforgesave] Added new adventure ${adventure.adventureId}`);
    }

    allAdventures.lastUpdated = new Date().toISOString();

    // Strip large image data from non-current scenes to keep blob size manageable
    const toSave = JSON.parse(JSON.stringify(allAdventures));
    toSave.adventures.forEach(adv => {
      // Keep firstSceneImage for gallery thumbnails, strip currentScene image if > 100KB
      if (adv.currentScene && adv.currentScene.imageData && adv.currentScene.imageData.length > 100000) {
        delete adv.currentScene.imageData;
      }
    });

    const data = JSON.stringify(toSave);
    const buffer = Buffer.from(data, 'utf8');
    await blobClient.upload(buffer, buffer.byteLength, {
      blobHTTPHeaders: { blobContentType: 'application/json' }
    });

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        success: true,
        adventureId: adventure.adventureId,
        totalAdventures: allAdventures.adventures.length
      }
    };
  } catch (error) {
    context.log.error(`[storyforgesave] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Save failed: ${error.message}` }
    };
  }
};
