/**
 * GET /api/blindspotprofileview?userId={id}
 *
 * Public, read-only profile view. Returns sanitized profile + featured card +
 * computed milestones + level/tier. Distinct from /api/blindspotprofile (which
 * is auth-scoped to the caller and exposes consumables, equipped slots, etc.) —
 * this endpoint exists so we can render shareable /blindspot/profile.html?u=
 * pages without ever leaking auth-only fields. If you find yourself adding a
 * new field to the response, ask whether it's safe to expose to anyone with
 * the URL.
 */
const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const PROFILE_PREFIX = 'blindspot/profiles/';
const PUBLISHED_PATH = 'published-cards.json';
const USER_CARDS_PREFIX = 'user/';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per userId
const _cache = new Map(); // userId -> { asOf, payload }

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=60'
};

// Mirror BsConst for milestone definitions. Keep in sync with
// blindspot/js/lib/bs-constants.js → CARD_TITLE_MILESTONES.
const MILESTONES = [
  { id: 'first_blood',   field: 'totalWins',     threshold: 1,   title: 'Blooded' },
  { id: 'proven',        field: 'totalWins',     threshold: 10,  title: 'Proven' },
  { id: 'veteran',       field: 'totalWins',     threshold: 25,  title: 'Veteran' },
  { id: 'champion',      field: 'totalWins',     threshold: 50,  title: 'Champion' },
  { id: 'legend',        field: 'totalWins',     threshold: 100, title: 'Legend' },
  { id: 'streak5',       field: 'bestStreak',    threshold: 5,   title: 'Hot Streak' },
  { id: 'streak10',      field: 'bestStreak',    threshold: 10,  title: 'Unstoppable' },
  { id: 'boss_slayer',   field: 'highestBoss',   threshold: 5,   title: 'Boss Slayer' },
  { id: 'conqueror',     field: 'highestBoss',   threshold: 10,  title: 'Conqueror' }
];

const LEVEL_XP_PER_LEVEL = 50;
const LEVEL_TIERS = [
  { id: 'initiate',   minLevel: 1,   label: 'Initiate' },
  { id: 'apprentice', minLevel: 6,   label: 'Apprentice' },
  { id: 'veteran',    minLevel: 16,  label: 'Veteran' },
  { id: 'champion',   minLevel: 31,  label: 'Champion' },
  { id: 'legend',     minLevel: 51,  label: 'Legend' },
  { id: 'mythic',     minLevel: 100, label: 'Mythic' }
];

function deriveLevel(xp) {
  const n = Math.max(0, Number(xp) || 0);
  const level = Math.floor(n / LEVEL_XP_PER_LEVEL) + 1;
  let tier = LEVEL_TIERS[0];
  for (const t of LEVEL_TIERS) if (level >= t.minLevel) tier = t;
  return { level, tier: tier.id, tierLabel: tier.label, xpToNext: (level * LEVEL_XP_PER_LEVEL) - n };
}

function computeMilestones(profile) {
  return MILESTONES.map(m => ({
    id: m.id,
    title: m.title,
    threshold: m.threshold,
    earned: (Number(profile[m.field]) || 0) >= m.threshold
  }));
}

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

async function downloadJsonOrNull(container, blobName) {
  try {
    const dl = await container.getBlockBlobClient(blobName).download();
    const body = await streamToText(dl.readableStreamBody);
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

// Sanitization: keep ONLY the fields enumerated below. Don't `delete` from a
// spread — too easy to miss a new auth-only field added to the profile schema
// later. Allowlist = single source of truth.
function sanitizeProfile(p, displayName) {
  return {
    userId: p.userId,
    userIdShort: String(p.userId || '').slice(0, 8),
    displayName,
    profileImage: p.profileImage || '',
    profileImageTransform: p.profileImageTransform || { scale: 1, posX: 50, posY: 50 },
    xp: Number(p.xp) || 0,
    totalWins: Number(p.totalWins) || 0,
    bestStreak: Number(p.bestStreak) || 0,
    highestBoss: Number(p.highestBoss) || 0,
    ascension: Number(p.ascension) || 0,
    towerBest: Number(p.towerBest) || 0,
    pvpElo: Number(p.pvpElo) || 1000,
    peakRank: p.peakRank || 'Iron',
    pvpRecord: p.pvpRecord || { w: 0, l: 0 },
    cardTitle: p.cardTitle || '',
    selectedCardId: p.selectedCardId || null,
    createdAt: p.createdAt || null,
    lastPlayedAt: p.lastPlayedAt || null
  };
}

async function aggregate(userId, context) {
  const svc = await createBlobServiceClient();
  const container = svc.getContainerClient(CONTAINER_NAME);

  const profilePath = `${PROFILE_PREFIX}${userId}.json`;
  const profile = await downloadJsonOrNull(container, profilePath);
  if (!profile) return { notFound: true };
  if (profile.isDemo === true) return { notFound: true };

  // Display name + featured card resolution from published-cards.
  // Single read shared with the leaderboard endpoint pattern. If
  // performance becomes an issue, consider a userId→name index blob.
  let displayName = 'Fighter ' + String(userId).slice(0, 8);
  let featuredCard = null;
  const pubs = await downloadJsonOrNull(container, PUBLISHED_PATH);
  if (pubs) {
    let arr = [];
    if (Array.isArray(pubs)) arr = pubs;
    else if (Array.isArray(pubs.publishedCards)) arr = pubs.publishedCards;
    else if (Array.isArray(pubs.cards)) arr = pubs.cards;
    for (const c of arr) {
      if (!c) continue;
      if (c.publishedBy === userId && c.publishedByName && displayName.startsWith('Fighter ')) {
        displayName = c.publishedByName;
      }
      if (profile.selectedCardId && c.id === profile.selectedCardId) {
        // Slim featured card payload — enough for the renderer + showcase.
        featuredCard = {
          id: c.id,
          name: c.name || 'Unnamed',
          class: c.class || '',
          quote: c.quote || '',
          rarity: c.rarity || 'common',
          avatar: c.avatar || '',
          combatStats: c.combatStats || null,
          design: c.design || null,
          imageContainer: c.imageContainer || (c.design && c.design.imageContainer) || null,
          element: c.element || null,
          publishedByName: c.publishedByName || null
        };
      }
    }
  }

  // Cards forged count — read this player's user-cards blob.
  let cardsForged = 0;
  const userCards = await downloadJsonOrNull(container, `${USER_CARDS_PREFIX}${userId}/cards.json`);
  if (userCards) {
    if (Array.isArray(userCards)) cardsForged = userCards.length;
    else if (Array.isArray(userCards.cards)) cardsForged = userCards.cards.length;
  }
  // Cards published — count this player's entries in published-cards.
  let cardsPublished = 0;
  if (pubs) {
    let arr = Array.isArray(pubs) ? pubs : (pubs.publishedCards || pubs.cards || []);
    cardsPublished = arr.filter(c => c && c.publishedBy === userId).length;
  }

  const sanitized = sanitizeProfile(profile, displayName);
  const lvl = deriveLevel(sanitized.xp);

  return {
    notFound: false,
    profile: {
      ...sanitized,
      level: lvl.level,
      tier: lvl.tier,
      tierLabel: lvl.tierLabel,
      xpToNext: lvl.xpToNext,
      cardsForged,
      cardsPublished,
      milestones: computeMilestones(sanitized),
      featuredCard
    }
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS };
    return;
  }

  const userId = req.query && req.query.userId;
  if (!userId || typeof userId !== 'string' || userId.length < 4 || userId.length > 80) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { ok: false, error: 'invalid_userId' } };
    return;
  }
  // Defensive — userIds are GUIDs in production. Reject path traversal.
  if (/[\/\\\.]/.test(userId)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { ok: false, error: 'invalid_userId' } };
    return;
  }

  const cached = _cache.get(userId);
  const now = Date.now();
  if (cached && (now - cached.asOf < CACHE_TTL_MS)) {
    context.res = { status: cached.payload.ok ? 200 : 404, headers: CORS_HEADERS, body: cached.payload };
    return;
  }

  try {
    const result = await aggregate(userId, context);
    if (result.notFound) {
      const payload = { ok: false, error: 'not_found' };
      _cache.set(userId, { asOf: now, payload });
      context.res = { status: 404, headers: CORS_HEADERS, body: payload };
      return;
    }
    const payload = { ok: true, asOf: new Date().toISOString(), profile: result.profile };
    _cache.set(userId, { asOf: now, payload });
    context.res = { status: 200, headers: CORS_HEADERS, body: payload };
  } catch (err) {
    context.log.error('profileview aggregate failed: ' + (err && err.message));
    const stale = _cache.get(userId);
    if (stale && stale.payload.ok) {
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { ...stale.payload, _stale: true, _error: err.message }
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
