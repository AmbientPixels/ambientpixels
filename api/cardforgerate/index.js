const { BlobServiceClient } = require('@azure/storage-blob');
const crypto = require('crypto');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";
const RATINGS_BLOB_PATH = "card-ratings.json";
const PUBLISHED_INDEX_PATH = "published-cards.json";

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, X-CF-Auth-Principal'
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_ACTIONS = ['add', 'remove'];
const FAVORITES_HARD_CAP = 2000;
const ETAG_RETRY_MAX = 5;

// Per-IP rate limit for anonymous abuse protection. Lives in module
// scope and resets on Azure Function cold start (workers recycle every
// ~20 min idle on Consumption plan). For a hobby gallery this is
// sufficient — a determined attacker rotating IPs gets nothing of
// value, and the cold-start reset means short bursts go unnoticed.
const RATE_BUCKETS = new Map(); // ipHash → number[] of timestamp ms
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_MAX_PER_WINDOW = 30;

function checkRateLimit(req, context) {
  const fwd = (req.headers['x-forwarded-for'] || '').toString();
  const ip = fwd.split(',')[0].trim() || req.headers['x-azure-clientip'] || 'unknown';
  const ipHash = crypto.createHash('sha1').update(ip).digest('hex').slice(0, 16);
  const now = Date.now();
  const prev = RATE_BUCKETS.get(ipHash) || [];
  const bucket = prev.filter(t => now - t < RATE_WINDOW_MS);
  if (bucket.length >= RATE_MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - bucket[0])) / 1000);
    context.log(`cardforgerate rate-limited ipHash=${ipHash} count=${bucket.length}`);
    return { ok: false, retryAfter };
  }
  bucket.push(now);
  RATE_BUCKETS.set(ipHash, bucket);
  return { ok: true };
}

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
  // Browser-forwarded principal (set by window._cfGetAuthHeaders from
  // /.auth/me). SWA's rewrite-route proxy doesn't inject the standard
  // x-ms-client-principal header on POSTs to external Function Apps, so
  // this is the cross-origin auth path.
  const cfHeader = req.headers['x-cf-auth-principal'];
  if (cfHeader) {
    try {
      const parsed = JSON.parse(cfHeader);
      const userId = parsed.userId || 'anonymous';
      if (userId !== 'anonymous') return { userId, isAuthenticated: true };
    } catch (err) {
      context.log.warn(`Failed to parse X-CF-Auth-Principal: ${err.message}`);
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

async function downloadJson(blobClient, label, context) {
  const dl = await withRetry(() => blobClient.download(), label, context);
  const text = await streamToText(dl.readableStreamBody);
  try { return JSON.parse(text); } catch (e) {
    context.log.warn(`${label} parse failed: ${e.message}`);
    return null;
  }
}

async function uploadJson(blobClient, payload, label, context, conditions) {
  const content = JSON.stringify(payload, null, 2);
  const opts = {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    overwrite: true
  };
  if (conditions) opts.conditions = conditions;
  return blobClient.upload(Buffer.from(content), Buffer.byteLength(content), opts);
}

async function verifyCardExists(containerClient, cardId, context) {
  const blobClient = containerClient.getBlockBlobClient(PUBLISHED_INDEX_PATH);
  const exists = await withRetry(() => blobClient.exists(), 'check published-cards index', context);
  if (!exists) return false;
  const data = await downloadJson(blobClient, 'download published-cards index', context);
  if (!data || !Array.isArray(data.publishedCards)) return false;
  return data.publishedCards.some(c => c && c.id === cardId);
}

async function readUserFavorites(containerClient, userId, context) {
  const path = `user/${userId}/favorites.json`;
  const blobClient = containerClient.getBlockBlobClient(path);
  const exists = await withRetry(() => blobClient.exists(), 'check user favorites', context);
  if (!exists) return { cardIds: [], version: 1, updatedAt: null };
  const data = await downloadJson(blobClient, 'download user favorites', context);
  if (!data || !Array.isArray(data.cardIds)) return { cardIds: [], version: 1, updatedAt: null };
  return {
    cardIds: data.cardIds,
    version: data.version || 1,
    updatedAt: data.updatedAt || null
  };
}

async function writeUserFavorites(containerClient, userId, payload, context) {
  const path = `user/${userId}/favorites.json`;
  const blobClient = containerClient.getBlockBlobClient(path);
  await withRetry(
    () => uploadJson(blobClient, payload, 'upload user favorites', context),
    'upload user favorites', context
  );
}

// Read-modify-write the aggregate ratings blob with ETag/IfMatch concurrency.
// On 412 Precondition Failed, retry up to ETAG_RETRY_MAX with jitter so two
// users hearting the same card simultaneously don't lose updates.
async function applyRatingDelta(containerClient, cardId, delta, context) {
  const blobClient = containerClient.getBlockBlobClient(RATINGS_BLOB_PATH);
  for (let attempt = 0; attempt < ETAG_RETRY_MAX; attempt++) {
    let payload = { ratings: {}, version: 1, updatedAt: null };
    let etag = null;
    const exists = await blobClient.exists();
    if (exists) {
      const props = await blobClient.getProperties();
      etag = props.etag;
      const data = await downloadJson(blobClient, 'download card-ratings', context);
      if (data && typeof data.ratings === 'object' && data.ratings) {
        payload = {
          ratings: data.ratings,
          version: data.version || 1,
          updatedAt: data.updatedAt || null
        };
      }
    }
    const now = new Date().toISOString();
    const existing = payload.ratings[cardId] || { count: 0, updatedAt: null };
    const nextCount = Math.max(0, (existing.count || 0) + delta);
    if (nextCount === 0) {
      delete payload.ratings[cardId];
    } else {
      payload.ratings[cardId] = { count: nextCount, updatedAt: now };
    }
    payload.updatedAt = now;
    const conditions = etag ? { ifMatch: etag } : { ifNoneMatch: '*' };
    try {
      await uploadJson(blobClient, payload, 'upload card-ratings', context, conditions);
      return nextCount;
    } catch (err) {
      const isConditionFailure = err.statusCode === 412 || err.statusCode === 409 ||
        (err.code === 'ConditionNotMet') || (err.code === 'BlobAlreadyExists');
      if (!isConditionFailure || attempt === ETAG_RETRY_MAX - 1) throw err;
      const jitter = 50 + Math.random() * 50;
      context.log(`card-ratings ETag conflict on attempt ${attempt + 1}, retrying after ${Math.round(jitter)}ms`);
      await new Promise(r => setTimeout(r, jitter));
    }
  }
  throw new Error('card-ratings ETag retry exhausted');
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  const blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  if (req.method === 'GET') {
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', message: 'CardForge Rate service is online' } };
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
    context.log(`cardforgerate: using userId from request body: ${userId}`);
  }

  const cardId = req.body && req.body.cardId;
  const action = req.body && req.body.action;

  if (!cardId || !ID_PATTERN.test(cardId)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid cardId' } };
    return;
  }
  if (!VALID_ACTIONS.includes(action)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: `Invalid action. Allowed: ${VALID_ACTIONS.join(', ')}` } };
    return;
  }

  // Per-IP rate limit applies to BOTH anonymous and authenticated paths.
  // Authenticated users have their own server-side idempotency guard, so
  // they should rarely hit this — but a misbehaving client shouldn't be
  // exempt either. Anonymous users have no other dedup, so this is the
  // primary anti-abuse layer for that path.
  const rate = checkRateLimit(req, context);
  if (!rate.ok) {
    context.res = {
      status: 429,
      headers: Object.assign({}, CORS_HEADERS, { 'Retry-After': String(rate.retryAfter) }),
      body: { error: 'Too many heart actions. Please slow down.', retryAfter: rate.retryAfter }
    };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    const cardOk = await verifyCardExists(containerClient, cardId, context);
    if (!cardOk) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found in published index' } };
      return;
    }

    // ---------------- Anonymous path ----------------
    // No user blob, no idempotency dedup — the client tracks its own
    // hearted state in localStorage and only sends the action it
    // intends. Aggregate count moves by the requested delta. Per-IP
    // rate limit above is the primary anti-abuse gate.
    if (!isAuthenticated) {
      const delta = action === 'add' ? 1 : -1;
      const count = await applyRatingDelta(containerClient, cardId, delta, context);
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { cardId, count, hearted: action === 'add', anonymous: true }
      };
      return;
    }

    // ---------------- Authenticated path (existing) ----------------
    const fav = await readUserFavorites(containerClient, userId, context);
    const had = fav.cardIds.indexOf(cardId) !== -1;

    // Idempotency — if the requested action matches current state, no-op.
    // We still report the live aggregate count so the client UI can sync.
    if ((action === 'add' && had) || (action === 'remove' && !had)) {
      const blobClient = containerClient.getBlockBlobClient(RATINGS_BLOB_PATH);
      const exists = await blobClient.exists();
      let count = 0;
      if (exists) {
        const data = await downloadJson(blobClient, 'download card-ratings (idempotent read)', context);
        if (data && data.ratings && data.ratings[cardId]) count = data.ratings[cardId].count || 0;
      }
      context.res = { status: 200, headers: CORS_HEADERS, body: { cardId, count, hearted: had, idempotent: true } };
      return;
    }

    if (action === 'add' && fav.cardIds.length >= FAVORITES_HARD_CAP) {
      context.res = { status: 409, headers: CORS_HEADERS, body: { error: `Favorites cap reached (${FAVORITES_HARD_CAP})` } };
      return;
    }

    let nextIds;
    if (action === 'add') {
      nextIds = fav.cardIds.concat([cardId]);
    } else {
      nextIds = fav.cardIds.filter(id => id !== cardId);
    }

    const nowIso = new Date().toISOString();
    await writeUserFavorites(containerClient, userId, {
      cardIds: nextIds,
      version: 1,
      updatedAt: nowIso
    }, context);

    const delta = action === 'add' ? 1 : -1;
    const count = await applyRatingDelta(containerClient, cardId, delta, context);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { cardId, count, hearted: action === 'add' }
    };
  } catch (error) {
    context.log.error(`cardforgerate error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
