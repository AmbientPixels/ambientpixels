// agentforge-drafts — Per-user draft storage for Agent Forge
// GET    /api/agentforge-drafts — load user's drafts
// POST   /api/agentforge-drafts { draft } — save/update draft
// DELETE /api/agentforge-drafts { draftId } — delete draft

const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-cf-auth-principal, x-user-id, x-company-secret'
};

function extractUserId(req) {
  // Azure SWA auth principal
  var principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
  if (principalHeader) {
    try {
      var decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      var principal = JSON.parse(decoded);
      if (principal.userId && principal.userId !== 'anonymous') return principal.userId;
    } catch (e) { /* fall through */ }
  }
  // Dev fallback
  var devId = req.headers['x-user-id'];
  if (devId) return devId;
  // Company secret fallback (CEO)
  if (req.headers['x-company-secret'] === 'pixelpusher') return 'ceo';
  return null;
}

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  var credential = new DefaultAzureCredential();
  return new BlobServiceClient('https://' + STORAGE_ACCOUNT_NAME + '.blob.core.windows.net', credential);
}

function blobPath(userId) {
  return 'user/' + userId + '/agentforge_drafts.json';
}

async function loadDrafts(containerClient, userId) {
  var blobClient = containerClient.getBlockBlobClient(blobPath(userId));
  var exists = await blobClient.exists();
  if (!exists) return [];
  var response = await blobClient.download(0);
  var chunks = [];
  for await (var chunk of response.readableStreamBody) { chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function saveDrafts(containerClient, userId, drafts) {
  var blobClient = containerClient.getBlockBlobClient(blobPath(userId));
  var content = JSON.stringify(drafts, null, 2);
  await blobClient.upload(content, Buffer.byteLength(content), {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  var userId = extractUserId(req);
  if (!userId) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
    return;
  }

  try {
    var blobServiceClient = await createBlobServiceClient();
    var containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    if (req.method === 'GET') {
      var drafts = await loadDrafts(containerClient, userId);
      context.res = { status: 200, headers: CORS_HEADERS, body: { drafts: drafts } };
      return;
    }

    if (req.method === 'POST') {
      var body = req.body || {};
      var draft = body.draft;
      if (!draft || !draft.id) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'draft with id required' } };
        return;
      }

      var drafts = await loadDrafts(containerClient, userId);

      // Upsert: replace existing or append
      var idx = drafts.findIndex(function(d) { return d.id === draft.id; });
      if (idx >= 0) {
        drafts[idx] = draft;
      } else {
        drafts.push(draft);
      }

      // Cap at 50 drafts
      if (drafts.length > 50) drafts = drafts.slice(-50);

      await saveDrafts(containerClient, userId, drafts);
      context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, totalDrafts: drafts.length } };
      return;
    }

    if (req.method === 'DELETE') {
      var body = req.body || {};
      var draftId = body.draftId;
      if (!draftId) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'draftId required' } };
        return;
      }

      var drafts = await loadDrafts(containerClient, userId);
      drafts = drafts.filter(function(d) { return d.id !== draftId; });
      await saveDrafts(containerClient, userId, drafts);
      context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, totalDrafts: drafts.length } };
      return;
    }

    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method not allowed' } };
  } catch (err) {
    context.log.error('[AgentForgeDrafts] Error:', err.message);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Draft operation failed: ' + err.message } };
  }
};
