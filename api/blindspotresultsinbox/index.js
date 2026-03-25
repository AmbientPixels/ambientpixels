const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
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

function getAbortSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function downloadJsonBlob(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;
  const downloadResponse = await blobClient.download(0, undefined, { abortSignal: getAbortSignal(10000) });
  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) { chunks.push(chunk); }
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

// ═══════════════════════════════════════════════════════════════
// RESULTS INBOX — Async PvP results for defenders
// ═══════════════════════════════════════════════════════════════
//
// GET  → fetch inbox (unread count + results)
// POST { action: 'dismiss', resultId } → mark as read
// POST { action: 'dismissAll' } → mark all as read
// POST { action: 'clear' } → clear all read results
// ═══════════════════════════════════════════════════════════════

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
        status: 200,
        headers: CORS_HEADERS,
        body: { inbox: [], unreadCount: 0, isDemo: true }
      };
      return;
    }

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const inboxPath = `blindspot/asyncResults/${userId}.json`;

    if (req.method === 'GET') {
      const inbox = await downloadJsonBlob(containerClient, inboxPath) || [];
      const unreadCount = inbox.filter(r => !r.read).length;

      // Compute summary stats
      const totalSparks = inbox.reduce((sum, r) => sum + (r.sparksEarned || 0), 0);
      const defenseRecord = {
        w: inbox.filter(r => r.result === 'win').length,
        l: inbox.filter(r => r.result === 'loss').length
      };

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { inbox, unreadCount, totalSparks, defenseRecord }
      };
    } else if (req.method === 'POST') {
      const body = req.body || {};
      const { action } = body;

      if (action === 'dismiss') {
        const { resultId } = body;
        if (!resultId) {
          context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'resultId is required' } };
          return;
        }

        let inbox = await downloadJsonBlob(containerClient, inboxPath) || [];
        const entry = inbox.find(r => r.id === resultId);
        if (entry) {
          entry.read = true;
          await uploadJsonBlob(containerClient, inboxPath, inbox);
        }

        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, unreadCount: inbox.filter(r => !r.read).length }
        };
      } else if (action === 'dismissAll') {
        let inbox = await downloadJsonBlob(containerClient, inboxPath) || [];
        for (const entry of inbox) entry.read = true;
        await uploadJsonBlob(containerClient, inboxPath, inbox);

        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, unreadCount: 0 }
        };
      } else if (action === 'clear') {
        let inbox = await downloadJsonBlob(containerClient, inboxPath) || [];
        inbox = inbox.filter(r => !r.read); // Keep unread
        await uploadJsonBlob(containerClient, inboxPath, inbox);

        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, remaining: inbox.length }
        };
      } else {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: `Unknown action: ${action}` } };
      }
    }
  } catch (error) {
    context.log.error(`[Results Inbox] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Results inbox error: ${error.message}` }
    };
  }
};
