const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";
const CONFIG_BLOB_PATH = "admin/hero-config.json";

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With'
};

// Admin userIds who can edit the hero config
const ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];

const VALID_MODES = ['recent', 'random', 'curated'];
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CURATED_IDS = 5;

const DEFAULT_CONFIG = {
  mode: 'recent',
  curatedIds: [],
  updatedAt: null,
  updatedBy: null
};

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

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

function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

async function withRetry(fn, label, context, retries) {
  retries = retries || 3;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      context.log.warn(`${label} attempt ${i + 1} failed: ${e.message}`);
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

function validateBody(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const mode = body.mode;
  if (!VALID_MODES.includes(mode)) {
    return { ok: false, error: `Invalid mode. Allowed: ${VALID_MODES.join(', ')}` };
  }
  let curatedIds = body.curatedIds == null ? [] : body.curatedIds;
  if (!Array.isArray(curatedIds)) {
    return { ok: false, error: 'curatedIds must be an array' };
  }
  if (curatedIds.length > MAX_CURATED_IDS) {
    return { ok: false, error: `curatedIds may have at most ${MAX_CURATED_IDS} entries` };
  }
  for (let i = 0; i < curatedIds.length; i++) {
    if (typeof curatedIds[i] !== 'string' || !ID_PATTERN.test(curatedIds[i])) {
      return { ok: false, error: `curatedIds[${i}] must match ${ID_PATTERN}` };
    }
  }
  return { ok: true, value: { mode, curatedIds } };
}

async function readConfig(containerClient, context) {
  const blobClient = containerClient.getBlockBlobClient(CONFIG_BLOB_PATH);
  const exists = await withRetry(() => blobClient.exists(), 'check hero-config blob', context);
  if (!exists) return Object.assign({}, DEFAULT_CONFIG);
  const dl = await withRetry(() => blobClient.download(), 'download hero-config', context);
  const text = await streamToText(dl.readableStreamBody);
  try {
    const parsed = JSON.parse(text);
    return {
      mode: VALID_MODES.includes(parsed.mode) ? parsed.mode : DEFAULT_CONFIG.mode,
      curatedIds: Array.isArray(parsed.curatedIds) ? parsed.curatedIds : [],
      updatedAt: parsed.updatedAt || null,
      updatedBy: parsed.updatedBy || null
    };
  } catch (e) {
    context.log.warn(`Hero config parse failed, returning default: ${e.message}`);
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

async function writeConfig(containerClient, config, context) {
  const blobClient = containerClient.getBlockBlobClient(CONFIG_BLOB_PATH);
  const content = JSON.stringify(config, null, 2);
  await withRetry(
    () => blobClient.upload(Buffer.from(content), Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true
    }),
    'upload hero-config', context
  );
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  const blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    if (req.method === 'GET') {
      const config = await readConfig(containerClient, context);
      context.res = { status: 200, headers: CORS_HEADERS, body: config };
      return;
    }

    if (req.method !== 'POST') {
      context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
      return;
    }

    // POST — admin only
    const { userId, isAuthenticated } = extractUserInfo(req, context);
    if (!isAuthenticated || !ADMIN_USER_IDS.includes(userId)) {
      context.log(`cardforgeheroconfig: forbidden POST from userId=${userId}`);
      context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Forbidden' } };
      return;
    }

    const validation = validateBody(req.body);
    if (!validation.ok) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: validation.error } };
      return;
    }

    const next = {
      mode: validation.value.mode,
      curatedIds: validation.value.curatedIds,
      updatedAt: new Date().toISOString(),
      updatedBy: userId
    };

    await writeConfig(containerClient, next, context);
    context.log(`cardforgeheroconfig: updated mode=${next.mode} curatedIds=${next.curatedIds.length} by=${userId}`);

    context.res = { status: 200, headers: CORS_HEADERS, body: next };
  } catch (error) {
    context.log.error(`Hero config error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
