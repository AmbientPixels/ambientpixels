const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CF-Auth-Principal'
};

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
  try {
    const blobClient = containerClient.getBlockBlobClient(blobName);
    const response = await blobClient.download(0, undefined, { abortSignal: getAbortSignal(8000) });
    const body = await streamToString(response.readableStreamBody);
    return JSON.parse(body);
  } catch (err) {
    if (err.statusCode === 404) return null;
    if (context) context.log.warn(`Failed to download ${blobName}: ${err.message}`);
    return null;
  }
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extractUserInfo(req) {
  const principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      const clientPrincipal = JSON.parse(decoded);
      return clientPrincipal.userId || 'anonymous';
    } catch (err) { /* fall through */ }
  }
  return req.headers['x-ms-client-principal-id'] || 'anonymous';
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS };
    return;
  }

  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const requestingUserId = extractUserInfo(req);
    const sort = (req.query.sort || 'xp').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    // Try cached leaderboard first
    const cacheBlob = `arena/leaderboard-cache.json`;
    const cached = await downloadJsonBlob(containerClient, cacheBlob, context);

    if (cached && cached.cachedAt && (Date.now() - new Date(cached.cachedAt).getTime()) < CACHE_TTL_MS) {
      context.log(`[Leaderboard] Serving cached data (${cached.leaderboard.length} entries)`);
      const sorted = sortLeaderboard(cached.leaderboard, sort).slice(0, limit);
      const playerPosition = findPlayerPosition(sorted, requestingUserId);
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ leaderboard: sorted, playerPosition, cachedAt: cached.cachedAt })
      };
      return;
    }

    // Rebuild leaderboard from profiles
    context.log('[Leaderboard] Rebuilding from profiles...');
    const entries = [];
    const prefix = 'arena/profiles/';

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      if (!blob.name.endsWith('.json')) continue;
      const profile = await downloadJsonBlob(containerClient, blob.name, context);
      if (!profile) continue;

      const userId = blob.name.replace(prefix, '').replace('.json', '');
      const wins = profile.wins || 0;
      const losses = profile.losses || 0;
      const total = wins + losses;

      entries.push({
        userId,
        displayName: profile.displayName || profile.cardName || 'Unknown',
        tier: profile.rank || 'Bronze',
        xp: profile.xp || 0,
        level: profile.level || 1,
        wins,
        losses,
        draws: profile.draws || 0,
        winRate: total > 0 ? Math.round((wins / total) * 100) + '%' : '0%'
      });
    }

    // Cache the full list
    const cacheData = { leaderboard: entries, cachedAt: new Date().toISOString() };
    try {
      const cacheBlobClient = containerClient.getBlockBlobClient(cacheBlob);
      await cacheBlobClient.upload(JSON.stringify(cacheData), JSON.stringify(cacheData).length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        overwrite: true
      });
    } catch (cacheErr) {
      context.log.warn(`[Leaderboard] Failed to cache: ${cacheErr.message}`);
    }

    const sorted = sortLeaderboard(entries, sort).slice(0, limit);
    const playerPosition = findPlayerPosition(sorted, requestingUserId);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ leaderboard: sorted, playerPosition, cachedAt: cacheData.cachedAt })
    };

  } catch (err) {
    context.log.error(`[Leaderboard] Error: ${err.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to load leaderboard' })
    };
  }
};

function sortLeaderboard(entries, sort) {
  const sorted = [...entries];
  switch (sort) {
    case 'wins':
      sorted.sort((a, b) => b.wins - a.wins || b.xp - a.xp);
      break;
    case 'winrate':
      sorted.sort((a, b) => {
        const aRate = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
        const bRate = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
        return bRate - aRate || b.wins - a.wins;
      });
      break;
    default: // xp
      sorted.sort((a, b) => b.xp - a.xp || b.wins - a.wins);
  }
  return sorted.map((entry, i) => ({ rank: i + 1, ...entry }));
}

function findPlayerPosition(sorted, userId) {
  if (userId === 'anonymous') return null;
  const idx = sorted.findIndex(e => e.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}
