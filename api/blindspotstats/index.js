const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const PLAYER_CONTAINER = 'cardforge';
const STATE_CONTAINER = 'company-state';

const PROFILE_PREFIX = 'blindspot/profiles/';
const USER_PREFIX = 'user/';
const PUBLISHED_PATH = 'published-cards.json';
const COUNTER_PATH = 'content-engine/total-count.json';
const BASELINE_PATH = 'blindspot/stats-baseline.json';

const ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let _cache = null; // { asOf: Date, public: {...}, admin: {...} }

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal',
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

function isAdmin(req, context) {
  const principalHeader = req.headers && req.headers['x-ms-client-principal'];
  if (!principalHeader) return false;
  try {
    const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
    const principal = JSON.parse(decoded);
    return ADMIN_USER_IDS.indexOf(principal.userId) !== -1;
  } catch (e) {
    if (context) context.log.warn('Failed to parse client principal: ' + e.message);
    return false;
  }
}

function todayUtcKey(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function isoWeekKey(d) {
  // Cheap week key: YYYY-Www where w = floor(dayOfYear/7). Good enough for delta bucketing.
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const diff = (d - start) / (1000 * 60 * 60 * 24);
  const week = Math.floor(diff / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

async function aggregate(context) {
  const svc = await createBlobServiceClient();
  const playerContainer = svc.getContainerClient(PLAYER_CONTAINER);
  const stateContainer = svc.getContainerClient(STATE_CONTAINER);

  // 1. List profile blobs + download each. Sum highestBoss + totalWins + pvpRecord.
  let players = 0;
  let bossesDefeated = 0;
  let battlesFought = 0;
  let lastActivityAt = null;
  const allProfiles = [];
  for await (const item of playerContainer.listBlobsFlat({ prefix: PROFILE_PREFIX })) {
    if (!item.name.endsWith('.json')) continue;
    try {
      const dl = await playerContainer.getBlockBlobClient(item.name).download();
      const body = await streamToText(dl.readableStreamBody);
      const p = JSON.parse(body);
      players++; // count only profiles we successfully read
      bossesDefeated += (typeof p.highestBoss === 'number') ? p.highestBoss : 0;
      const wins = (typeof p.totalWins === 'number') ? p.totalWins : 0;
      const pvpW = (p.pvpRecord && typeof p.pvpRecord.w === 'number') ? p.pvpRecord.w : 0;
      const pvpL = (p.pvpRecord && typeof p.pvpRecord.l === 'number') ? p.pvpRecord.l : 0;
      battlesFought += wins + pvpW + pvpL;
      if (p.lastPlayedAt) {
        const t = Date.parse(p.lastPlayedAt);
        if (!isNaN(t) && (lastActivityAt === null || t > lastActivityAt)) lastActivityAt = t;
      }
      allProfiles.push({
        userIdShort: String(p.userId || 'unknown').slice(0, 8),
        totalWins: wins
      });
    } catch (e) {
      if (context) context.log.warn('Skip profile ' + item.name + ': ' + e.message);
    }
  }

  // 2. List user/ prefix for cards.json. Sum array lengths.
  let cardsForged = 0;
  for await (const item of playerContainer.listBlobsFlat({ prefix: USER_PREFIX })) {
    if (!item.name.endsWith('/cards.json')) continue;
    try {
      const dl = await playerContainer.getBlockBlobClient(item.name).download();
      const body = await streamToText(dl.readableStreamBody);
      const arr = JSON.parse(body);
      if (Array.isArray(arr)) cardsForged += arr.length;
    } catch (e) {
      if (context) context.log.warn('Skip user blob ' + item.name + ': ' + e.message);
    }
  }

  // 3. published-cards.json — single read.
  let cardsPublished = 0;
  try {
    const dl = await playerContainer.getBlockBlobClient(PUBLISHED_PATH).download();
    const body = await streamToText(dl.readableStreamBody);
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) cardsPublished = parsed.length;
    else if (parsed && Array.isArray(parsed.cards)) cardsPublished = parsed.cards.length;
  } catch (e) {
    if (context) context.log.warn('published-cards.json read failed: ' + e.message);
  }

  // 4. AI generations counter — single read from company-state.
  let aiGenerations = 0;
  let counterMissing = false;
  try {
    const dl = await stateContainer.getBlockBlobClient(COUNTER_PATH).download();
    const body = await streamToText(dl.readableStreamBody);
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.count === 'number') aiGenerations = parsed.count;
  } catch (e) {
    counterMissing = true; // backfill not yet run
  }

  // 5. Compute deltas vs baseline
  const stats = { players, cardsForged, cardsPublished, bossesDefeated, battlesFought, aiGenerations };
  const now = new Date();
  const baseline = await loadBaseline(stateContainer, context);
  const dailyBase = (baseline && baseline.dayStart) || { stats };
  const weeklyBase = (baseline && baseline.weekStart) || { stats };

  const todayDelta = subtractStats(stats, dailyBase.stats);
  const weekDelta = subtractStats(stats, weeklyBase.stats);

  // Roll baselines forward if the day or week changed
  const baselineWrites = await maybeRollBaseline(stateContainer, baseline, stats, now, context);

  const topPlayersByWins = allProfiles
    .sort(function (a, b) { return b.totalWins - a.totalWins; })
    .slice(0, 5);

  return {
    asOf: now.toISOString(),
    public: { stats: stats, _meta: { counterMissing: counterMissing } },
    admin: {
      todayDelta: todayDelta,
      weekDelta: weekDelta,
      lastActivityAt: lastActivityAt ? new Date(lastActivityAt).toISOString() : null,
      topPlayersByWins: topPlayersByWins,
      _baselineWrites: baselineWrites
    }
  };
}

function subtractStats(a, b) {
  const out = {};
  ['players', 'cardsForged', 'cardsPublished', 'bossesDefeated', 'battlesFought', 'aiGenerations'].forEach(function (k) {
    out[k] = (a[k] || 0) - (b[k] || 0);
  });
  return out;
}

async function loadBaseline(container, context) {
  try {
    const dl = await container.getBlockBlobClient(BASELINE_PATH).download();
    const body = await streamToText(dl.readableStreamBody);
    return JSON.parse(body);
  } catch (e) {
    return null; // bootstrap on first run
  }
}

async function maybeRollBaseline(container, prev, stats, now, context) {
  const wrote = { day: false, week: false };
  const today = todayUtcKey(now);
  const thisWeek = isoWeekKey(now);

  let dayStart = (prev && prev.dayStart) || null;
  let weekStart = (prev && prev.weekStart) || null;

  if (!dayStart || todayUtcKey(new Date(dayStart.asOf)) !== today) {
    dayStart = { asOf: now.toISOString(), stats: stats };
    wrote.day = true;
  }
  if (!weekStart || isoWeekKey(new Date(weekStart.asOf)) !== thisWeek) {
    weekStart = { asOf: now.toISOString(), stats: stats };
    wrote.week = true;
  }

  if (wrote.day || wrote.week) {
    try {
      const payload = JSON.stringify({ dayStart: dayStart, weekStart: weekStart }, null, 2);
      await container.getBlockBlobClient(BASELINE_PATH).upload(
        Buffer.from(payload),
        Buffer.byteLength(payload),
        { blobHTTPHeaders: { blobContentType: 'application/json' } }
      );
    } catch (e) {
      if (context) context.log.warn('Baseline write failed (non-fatal): ' + e.message);
    }
  }
  return wrote;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    const wantAdmin = (req.query && req.query.detail === 'admin') && isAdmin(req, context);

    let payload;
    if (_cache && (Date.now() - _cache.asOfMs) < CACHE_TTL_MS) {
      payload = _cache.payload;
    } else {
      const result = await aggregate(context);
      payload = result;
      _cache = { asOfMs: Date.now(), payload: result };
    }

    const body = {
      ok: true,
      asOf: payload.asOf,
      stats: payload.public.stats
    };
    if (payload.public._meta && payload.public._meta.counterMissing) {
      body._warning = 'aiGenerations counter not initialized — run scripts/backfill-content-total-count.js';
    }
    if (wantAdmin) {
      body.adminExtras = {
        todayDelta: payload.admin.todayDelta,
        weekDelta: payload.admin.weekDelta,
        lastActivityAt: payload.admin.lastActivityAt,
        topPlayersByWins: payload.admin.topPlayersByWins
      };
    }

    context.res = { status: 200, headers: CORS_HEADERS, body: JSON.stringify(body) };
  } catch (err) {
    context.log.error('[blindspotstats] error: ' + (err.message || String(err)));
    // Serve stale cache if available — preserve _warning so operator
    // doesn't lose the "run backfill" hint while serving stale data.
    if (_cache) {
      const staleBody = {
        ok: true,
        asOf: _cache.payload.asOf,
        stats: _cache.payload.public.stats,
        _stale: true
      };
      if (_cache.payload.public._meta && _cache.payload.public._meta.counterMissing) {
        staleBody._warning = 'aiGenerations counter not initialized — run scripts/backfill-content-total-count.js';
      }
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(staleBody)
      };
      return;
    }
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Stats unavailable' })
    };
  }
};
