const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

// Azure Storage configuration
const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";

// Helper to extract authenticated user information from Static Web Apps EasyAuth header
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
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, isAuthenticated: true };
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) {
      context.log(`[DEV AUTH] Using X-User-ID: ${devUserId}`);
      return { userId: devUserId, isAuthenticated: true };
    }
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

function getUserCardsPath(userId) {
  return `user/${userId}/cards.json`;
}

async function downloadJsonBlobWithRetry(containerClient, blobName, context) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return [];
  const download = await blobClient.download(0);
  const chunks = [];
  for await (const chunk of download.readableStreamBody) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    context.log.error(`JSON parse error for blob ${blobName}: ${e.message}`);
    throw e;
  }
}

async function uploadJsonBlob(containerClient, blobName, data) {
  const content = JSON.stringify(data, null, 2);
  const blockClient = containerClient.getBlockBlobClient(blobName);
  await blockClient.upload(content, Buffer.byteLength(content));
}

module.exports = async function (context, req) {
  context.log('Processing cardforgedeletecard request');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
      },
      body: ''
    };
    return;
  }

  // Health-check for DELETE API
  /* updated by Cascade 2025-07-19 */
  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
      },
      body: { status: 'ok', message: 'CardForge Delete Card service is online' }
    };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method Not Allowed' };
    return;
  }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 401, body: 'Unauthorized' };
    return;
  }

  const cardId = req.body && req.body.id;
  if (!cardId) {
    context.res = { status: 400, body: 'Missing card id' };
    return;
  }

  const accountUrl = `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;
  const credential = new DefaultAzureCredential();
  const blobServiceClient = new BlobServiceClient(accountUrl, credential);
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  try {
    const path = getUserCardsPath(userId);
    let cards = await downloadJsonBlobWithRetry(containerClient, path, context);
    const filtered = cards.filter(c => c.id !== cardId);
    await uploadJsonBlob(containerClient, path, filtered);
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: filtered
    };
  } catch (e) {
    context.log.error(`Delete card error: ${e.message}`);
    context.res = { status: 500, body: 'Server error' };
  }
};
