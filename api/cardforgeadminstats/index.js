const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";
const PUBLISHED_BLOB_PATH = "published-cards.json";
const RATINGS_BLOB_PATH = "card-ratings.json";
const USER_PREFIX = "user/";
const FAVORITES_BLOB_NAME = "favorites.json";

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, X-User-ID'
};

const ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];

const CACHE_TTL_MS = 5 * 60 * 1000;
const FAV_FETCH_CONCURRENCY = 50;

let _cache = null;

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
  // Some callers (custom CardForge auth path) forward the principal as a JSON
  // string in X-CF-Auth-Principal — accept that too so admin tokens flow.
  const cfAuth = req.headers['x-cf-auth-principal'];
  if (cfAuth) {
    try {
      const principal = JSON.parse(cfAuth);
      if (principal && principal.userId && principal.userId !== 'anonymous') {
        return { userId: principal.userId, isAuthenticated: true };
      }
    } catch (err) {
      context.log.warn(`Failed to parse X-CF-Auth-Principal: ${err.message}`);
    }
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

async function readJsonBlob(containerClient, path, context) {
  const blobClient = containerClient.getBlockBlobClient(path);
  const exists = await withRetry(() => blobClient.exists(), `check ${path}`, context);
  if (!exists) return null;
  const dl = await withRetry(() => blobClient.download(), `download ${path}`, context);
  const text = await streamToText(dl.readableStreamBody);
  try { return JSON.parse(text); } catch (e) {
    context.log.warn(`Parse failed for ${path}: ${e.message}`);
    return null;
  }
}

async function countPublishedCards(containerClient, context) {
  const parsed = await readJsonBlob(containerClient, PUBLISHED_BLOB_PATH, context);
  if (parsed && Array.isArray(parsed.publishedCards)) return parsed.publishedCards.length;
  return 0;
}

async function sumHearts(containerClient, context) {
  const parsed = await readJsonBlob(containerClient, RATINGS_BLOB_PATH, context);
  if (!parsed || !parsed.ratings || typeof parsed.ratings !== 'object') return 0;
  let total = 0;
  Object.keys(parsed.ratings).forEach(id => {
    const r = parsed.ratings[id];
    if (r && typeof r.count === 'number' && r.count > 0) total += r.count;
  });
  return total;
}

// Single enumeration pass over user/ — yields distinct userIds (Users tile)
// and the list of favorites blob paths to fetch (Favorites tile).
async function enumerateUserPrefixes(containerClient, context) {
  const userIds = new Set();
  const favoritesPaths = [];
  const iterator = containerClient.listBlobsByHierarchy('/', { prefix: USER_PREFIX });
  for await (const item of iterator) {
    if (item.kind === 'prefix' && item.name) {
      // item.name like "user/<userId>/"
      const trimmed = item.name.endsWith('/') ? item.name.slice(0, -1) : item.name;
      const parts = trimmed.split('/');
      if (parts.length >= 2 && parts[1]) {
        const userId = parts[1];
        if (!userIds.has(userId)) {
          userIds.add(userId);
          favoritesPaths.push(`${USER_PREFIX}${userId}/${FAVORITES_BLOB_NAME}`);
        }
      }
    }
  }
  context.log(`cardforgeadminstats: enumerated ${userIds.size} user prefixes`);
  return { userIds, favoritesPaths };
}

async function readFavoritesCount(containerClient, path, context) {
  try {
    const blobClient = containerClient.getBlockBlobClient(path);
    const exists = await blobClient.exists();
    if (!exists) return 0;
    const dl = await blobClient.download();
    const text = await streamToText(dl.readableStreamBody);
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.cardIds)) return parsed.cardIds.length;
    return 0;
  } catch (e) {
    context.log.warn(`favorites read failed for ${path}: ${e.message}`);
    return 0;
  }
}

async function sumFavorites(containerClient, favoritesPaths, context) {
  let total = 0;
  for (let i = 0; i < favoritesPaths.length; i += FAV_FETCH_CONCURRENCY) {
    const batch = favoritesPaths.slice(i, i + FAV_FETCH_CONCURRENCY);
    const counts = await Promise.all(batch.map(p => readFavoritesCount(containerClient, p, context)));
    for (let j = 0; j < counts.length; j++) total += counts[j];
  }
  return total;
}

async function computeStats(context) {
  const blobServiceClient = await createBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  const enumPromise = enumerateUserPrefixes(containerClient, context);
  const cardsPromise = countPublishedCards(containerClient, context);
  const heartsPromise = sumHearts(containerClient, context);

  const [enumeration, cardsPublished, hearts] = await Promise.all([
    enumPromise, cardsPromise, heartsPromise
  ]);
  const favorites = await sumFavorites(containerClient, enumeration.favoritesPaths, context);

  return {
    cardsPublished,
    users: enumeration.userIds.size,
    hearts,
    favorites,
    computedAt: new Date().toISOString()
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
    return;
  }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated || !ADMIN_USER_IDS.includes(userId)) {
    context.log(`cardforgeadminstats: forbidden GET from userId=${userId}`);
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Admin access required' } };
    return;
  }

  try {
    const now = Date.now();
    if (_cache && (now - _cache.computedAtMs) < CACHE_TTL_MS) {
      const ageSec = Math.floor((now - _cache.computedAtMs) / 1000);
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: Object.assign({}, _cache.stats, { cacheAgeSeconds: ageSec })
      };
      return;
    }

    const stats = await computeStats(context);
    _cache = { stats, computedAtMs: Date.now() };

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: Object.assign({}, stats, { cacheAgeSeconds: 0 })
    };
  } catch (error) {
    context.log.error(`cardforgeadminstats error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
