const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const PLAYER_CONTAINER = 'cardforge';

const PROFILE_PREFIX = 'blindspot/profiles/';
const PUBLISHED_PATH = 'published-cards.json';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TOP_N = 50;
const VALID_SORTS = ['wins', 'bosses', 'elo', 'power'];

// Cache keyed by sortBy. Each entry: { asOf, payload }.
const _cache = new Map();

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=60'
};

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  return new BlobServiceClient(
    `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
}

function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function cardPower(card) {
  if (!card) return 0;
  const cs = card.combatStats;
  if (cs && typeof cs === 'object') {
    return (cs.str || 0) + (cs.agi || 0) + (cs.int || 0) + (cs.end || 0) + (cs.lck || 0);
  }
  if (Array.isArray(card.stats)) {
    return card.stats.reduce((s, st) => s + (st && typeof st.value === 'number' ? st.value : 0), 0);
  }
  return 0;
}

async function aggregate(context) {
  const svc = await createBlobServiceClient();
  const container = svc.getContainerClient(PLAYER_CONTAINER);

  // Read published-cards.json once → build maps for display name + featured card lookup.
  const cardById = new Map();
  const nameByUserId = new Map();
  try {
    const dl = await container.getBlockBlobClient(PUBLISHED_PATH).download();
    const body = await streamToText(dl.readableStreamBody);
    const parsed = JSON.parse(body);
    let pubs = [];
    if (Array.isArray(parsed)) pubs = parsed;
    else if (parsed && Array.isArray(parsed.publishedCards)) pubs = parsed.publishedCards;
    else if (parsed && Array.isArray(parsed.cards)) pubs = parsed.cards;
    for (const c of pubs) {
      if (!c || !c.id) continue;
      cardById.set(c.id, c);
      // First non-null publishedByName per user wins. Most recent publish
      // would be ideal but published-cards.json isn't ordered by date and
      // the name rarely changes.
      if (c.publishedBy && c.publishedByName && !nameByUserId.has(c.publishedBy)) {
        nameByUserId.set(c.publishedBy, c.publishedByName);
      }
    }
  } catch (e) {
    if (context) context.log.warn('published-cards.json read failed: ' + e.message);
  }

  // Read all profile blobs.
  const players = [];
  for await (const item of container.listBlobsFlat({ prefix: PROFILE_PREFIX })) {
    if (!item.name.endsWith('.json')) continue;
    try {
      const dl = await container.getBlockBlobClient(item.name).download();
      const body = await streamToText(dl.readableStreamBody);
      const p = JSON.parse(body);
      if (!p || !p.userId) continue;
      if (p.isDemo === true) continue; // demo profiles never appear on leaderboard
      if (p.isPrivate === true) continue; // player opted out of public ranking

      const userId = String(p.userId);
      const userIdShort = userId.slice(0, 8);
      const featured = p.selectedCardId ? cardById.get(p.selectedCardId) : null;

      // Display name fallback chain:
      //   profile.displayName (player-set override)
      //   → publishedByName auth claim (Google/B2C "name")
      //   → 'Fighter XXXXXXXX' for un-published older players
      // The override exists so players can hide the raw real-name auth
      // claim from the leaderboard without re-authing. Empty / whitespace
      // override is treated as unset.
      const overrideName = (typeof p.displayName === 'string' && p.displayName.trim()) ? p.displayName.trim() : '';
      const displayName = overrideName || nameByUserId.get(userId) || ('Fighter ' + userIdShort);

      players.push({
        userId,                           // full id (used for client "(you)" tag match)
        userIdShort,                      // for fallback display
        displayName,
        profileImage: p.profileImage || '',
        profileImageTransform: p.profileImageTransform || null,
        totalWins: Number(p.totalWins) || 0,
        bestStreak: Number(p.bestStreak) || 0,
        highestBoss: Number(p.highestBoss) || 0,
        ascension: Number(p.ascension) || 0,
        towerBest: Number(p.towerBest) || 0,
        pvpElo: Number(p.pvpElo) || 1000,
        peakRank: p.peakRank || 'Iron',
        pvpRecord: p.pvpRecord || { w: 0, l: 0 },
        xp: Number(p.xp) || 0,
        cardTitle: p.cardTitle || '',
        // Featured card slim — name + class + avatar + power. Renderer
        // only shows a chip; full card data isn't needed.
        featured: featured ? {
          id: featured.id,
          name: featured.name || 'Unnamed',
          class: featured.class || '',
          avatar: featured.avatar || '',
          power: cardPower(featured)
        } : null,
        lastPlayedAt: p.lastPlayedAt || null
      });
    } catch (e) {
      if (context) context.log.warn('Skip profile ' + item.name + ': ' + e.message);
    }
  }

  return players;
}

function rankPlayers(players, sortBy) {
  let scored = players;

  if (sortBy === 'power') {
    // Power requires a featured card; players with none get 0 and naturally drop off the top.
    scored = players.map(p => ({ ...p, _score: p.featured ? p.featured.power : 0 }));
  } else if (sortBy === 'bosses') {
    // Tie-break by ascension then totalWins so an asc-3 player above an asc-0 player.
    scored = players.map(p => ({
      ...p,
      _score: p.highestBoss * 1000 + p.ascension * 100 + Math.min(99, p.totalWins)
    }));
  } else if (sortBy === 'elo') {
    scored = players.map(p => ({ ...p, _score: p.pvpElo }));
  } else {
    // Default: wins. Tie-break by bestStreak so two players at 25 wins, one with a 10-streak ranks above one with 3.
    scored = players.map(p => ({ ...p, _score: p.totalWins * 100 + Math.min(99, p.bestStreak) }));
  }

  scored.sort((a, b) => b._score - a._score);

  // Strip noise — players with 0 wins AND 0 bosses AND 0 PvP record. They've never played; the leaderboard isn't a registry.
  scored = scored.filter(p =>
    p.totalWins > 0 ||
    p.highestBoss > 0 ||
    (p.pvpRecord && (p.pvpRecord.w > 0 || p.pvpRecord.l > 0))
  );

  return scored.slice(0, TOP_N).map((p, i) => {
    const out = { rank: i + 1, ...p };
    delete out._score;
    return out;
  });
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS };
    return;
  }

  const sortBy = (req.query && VALID_SORTS.indexOf(req.query.sortBy) !== -1) ? req.query.sortBy : 'wins';
  const cacheKey = sortBy;

  try {
    const cached = _cache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.asOf < CACHE_TTL_MS)) {
      context.res = { status: 200, headers: CORS_HEADERS, body: cached.payload };
      return;
    }

    const players = await aggregate(context);
    const ranked = rankPlayers(players, sortBy);
    const payload = {
      ok: true,
      asOf: new Date().toISOString(),
      sortBy,
      count: ranked.length,
      players: ranked
    };
    _cache.set(cacheKey, { asOf: now, payload });
    context.res = { status: 200, headers: CORS_HEADERS, body: payload };
  } catch (err) {
    context.log.error('Leaderboard aggregate failed: ' + (err && err.message));
    // Stale-cache fallback so a transient blob hiccup doesn't blank the screen.
    const cached = _cache.get(cacheKey);
    if (cached) {
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { ...cached.payload, _stale: true, _error: err.message }
      };
      return;
    }
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { ok: false, error: err && err.message ? err.message : 'aggregate_failed' }
    };
  }
};
