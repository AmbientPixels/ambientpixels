const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With',
  'Cache-Control': 'no-store'
};

const ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];

const VALID_MODES = ['recent', 'random', 'curated', 'highest-rated'];
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_HIDDEN = 500;

const KEY_BLOBS = {
  moderation: 'admin/blindspot-moderation.json',
  hero:       'admin/blindspot-hero-config.json',
  hall:       'admin/blindspot-hall-config.json',
  gallery:    'admin/blindspot-gallery-config.json'
};

const KEY_MAX_CURATED = { hero: 10, hall: 25, gallery: 50 };

const DEFAULT_MOD_CONFIG = { hiddenIds: [], updatedAt: null, updatedBy: null };
const DEFAULT_SURFACE_CONFIG = { mode: 'recent', curatedIds: [], updatedAt: null, updatedBy: null };

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
    if (devUserId) return { userId: devUserId, isAuthenticated: true };
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

function defaultFor(key) {
  return key === 'moderation'
    ? Object.assign({}, DEFAULT_MOD_CONFIG)
    : Object.assign({}, DEFAULT_SURFACE_CONFIG);
}

function validateBody(key, body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  if (key === 'moderation') {
    const ids = body.hiddenIds == null ? [] : body.hiddenIds;
    if (!Array.isArray(ids)) return { ok: false, error: 'hiddenIds must be an array' };
    if (ids.length > MAX_HIDDEN) return { ok: false, error: `hiddenIds may have at most ${MAX_HIDDEN} entries` };
    for (let i = 0; i < ids.length; i++) {
      if (typeof ids[i] !== 'string' || !ID_PATTERN.test(ids[i])) {
        return { ok: false, error: `hiddenIds[${i}] must match ${ID_PATTERN}` };
      }
    }
    return { ok: true, value: { hiddenIds: ids } };
  }
  // surface configs (hero/hall/gallery)
  const mode = body.mode;
  if (!VALID_MODES.includes(mode)) return { ok: false, error: `Invalid mode. Allowed: ${VALID_MODES.join(', ')}` };
  const ids = body.curatedIds == null ? [] : body.curatedIds;
  if (!Array.isArray(ids)) return { ok: false, error: 'curatedIds must be an array' };
  const max = KEY_MAX_CURATED[key];
  if (ids.length > max) return { ok: false, error: `curatedIds may have at most ${max} entries for ${key}` };
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== 'string' || !ID_PATTERN.test(ids[i])) {
      return { ok: false, error: `curatedIds[${i}] must match ${ID_PATTERN}` };
    }
  }
  return { ok: true, value: { mode, curatedIds: ids } };
}

async function readConfig(containerClient, blobPath, fallback, context) {
  const blobClient = containerClient.getBlockBlobClient(blobPath);
  const exists = await withRetry(() => blobClient.exists(), `check ${blobPath}`, context);
  if (!exists) return Object.assign({}, fallback);
  const dl = await withRetry(() => blobClient.download(), `download ${blobPath}`, context);
  const text = await streamToText(dl.readableStreamBody);
  try { return JSON.parse(text); } catch (e) {
    context.log.warn(`${blobPath} parse failed, returning default: ${e.message}`);
    return Object.assign({}, fallback);
  }
}

async function writeConfig(containerClient, blobPath, config, context) {
  const blobClient = containerClient.getBlockBlobClient(blobPath);
  const content = JSON.stringify(config, null, 2);
  await withRetry(
    () => blobClient.upload(Buffer.from(content), Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true
    }),
    `upload ${blobPath}`, context
  );
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  const blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  const key = String((req.query && req.query.key) || '').toLowerCase();
  if (!KEY_BLOBS[key]) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: `Invalid key. Allowed: ${Object.keys(KEY_BLOBS).join(', ')}` } };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobPath = KEY_BLOBS[key];
    const fallback = defaultFor(key);

    if (req.method === 'GET') {
      const config = await readConfig(containerClient, blobPath, fallback, context);
      context.res = { status: 200, headers: CORS_HEADERS, body: config };
      return;
    }

    if (req.method !== 'POST') {
      context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
      return;
    }

    let { userId, isAuthenticated } = extractUserInfo(req, context);
    if (!isAuthenticated && req.body && req.body.userId && req.body.userId !== 'anonymous') {
      userId = req.body.userId;
      isAuthenticated = true;
      context.log(`blindspotadminconfig: using userId from request body: ${userId}`);
    }
    if (!isAuthenticated || !ADMIN_USER_IDS.includes(userId)) {
      context.log(`blindspotadminconfig: forbidden POST from userId=${userId}`);
      context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Forbidden' } };
      return;
    }

    const validation = validateBody(key, req.body);
    if (!validation.ok) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: validation.error } };
      return;
    }

    const next = Object.assign({}, validation.value, {
      updatedAt: new Date().toISOString(),
      updatedBy: userId
    });

    await writeConfig(containerClient, blobPath, next, context);
    context.log(`blindspotadminconfig: updated key=${key} by=${userId}`);
    context.res = { status: 200, headers: CORS_HEADERS, body: next };
  } catch (error) {
    context.log.error(`blindspotadminconfig error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
