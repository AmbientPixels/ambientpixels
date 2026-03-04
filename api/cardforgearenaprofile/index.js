const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
      context.log(`[DEV AUTH] Falling back to X-User-ID: ${devUserId}`);
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

async function uploadJsonBlob(containerClient, blobName, data) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const content = JSON.stringify(data, null, 2);
  await blobClient.upload(content, Buffer.byteLength(content), {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

function createDefaultProfile(userId) {
  return {
    userId,
    rank: 'bronze',
    xp: 0,
    level: 1,
    record: { wins: 0, losses: 0, draws: 0 },
    pveProgress: { highestBossDefeated: 0, bossAttempts: {} },
    selectedCardId: null,
    createdAt: new Date().toISOString(),
    lastBattleAt: null
  };
}

module.exports = async function (context, req) {
  // CORS preflight
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
        body: { error: 'Authentication required to access arena profile' }
      };
      return;
    }

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const profilePath = `arena/profiles/${userId}.json`;

    if (req.method === 'GET') {
      let profile = await downloadJsonBlob(containerClient, profilePath, context);
      let isNew = false;

      if (!profile) {
        profile = createDefaultProfile(userId);
        await uploadJsonBlob(containerClient, profilePath, profile);
        isNew = true;
        context.log(`[Arena] Created new profile for user ${userId}`);
      }

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { profile, isNew }
      };
    } else if (req.method === 'POST') {
      const body = req.body || {};
      const { action } = body;

      if (action === 'selectCard') {
        const { cardId } = body;
        if (!cardId) {
          context.res = {
            status: 400,
            headers: CORS_HEADERS,
            body: { error: 'cardId is required' }
          };
          return;
        }

        let profile = await downloadJsonBlob(containerClient, profilePath, context);
        if (!profile) {
          profile = createDefaultProfile(userId);
        }
        profile.selectedCardId = cardId;
        await uploadJsonBlob(containerClient, profilePath, profile);

        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, selectedCardId: cardId }
        };
      } else {
        context.res = {
          status: 400,
          headers: CORS_HEADERS,
          body: { error: `Unknown action: ${action}` }
        };
      }
    }
  } catch (error) {
    context.log.error(`[Arena Profile] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Arena profile error: ${error.message}` }
    };
  }
};
