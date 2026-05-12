/**
 * GET /api/blindspotcardview?id={cardId}
 *
 * Public, read-only card view. Returns sanitized card record sourced from
 * published-cards.json. Mirrors blindspotprofileview sanitization pattern —
 * allowlist single source of truth. If owner profile isPrivate, returns
 * { ok: true, isPrivate: true } with no card data leaked.
 */
const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const PROFILE_PREFIX = 'blindspot/profiles/';
const PUBLISHED_PATH = 'published-cards.json';

const CACHE_TTL_MS = 5 * 60 * 1000;
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

async function downloadJsonOrNull(container, blobName) {
  try {
    const dl = await container.getBlockBlobClient(blobName).download();
    const body = await streamToText(dl.readableStreamBody);
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

function findCardInPublished(pubs, cardId) {
  if (!pubs) return null;
  let arr = [];
  if (Array.isArray(pubs)) arr = pubs;
  else if (Array.isArray(pubs.publishedCards)) arr = pubs.publishedCards;
  else if (Array.isArray(pubs.cards)) arr = pubs.cards;
  for (const c of arr) {
    if (c && c.id === cardId) return c;
  }
  return null;
}

// Sanitization: allowlist only. Mirrors blindspotprofileview pattern.
// Task 0 discovery (2026-05-11): existing entries store `rarity` inside
// `cardData.rarity` and `class` at top level. `combatStats` and `element`
// are NOT stored — derived client-side via BsCardRenderer.ensureCombatStats.
function sanitizeCard(c) {
  const cd = c.cardData || {};
  return {
    id: c.id,
    name: c.name || cd.name || 'Unnamed',
    class: c.class || cd.characterClass || '',
    rarity: cd.rarity || c.rarity || 'common',
    quote: c.quote || cd.quote || '',
    avatar: c.avatar || cd.avatar || '',
    combatStats: c.combatStats || null,
    design: c.design || cd.design || null,
    imageContainer: c.imageContainer || (cd.design && cd.design.imageContainer) || null,
    element: c.element || cd.element || null,
    publishedBy: c.publishedBy || null,
    publishedByName: c.publishedByName || null,
    publishedAt: c.publishedAt || c.publishDate || null,
    lastBattleAt: c.lastBattleAt || null,
    ogImageUrl: c.ogImageUrl || null,
    history: c.history || { battles: 0, wins: 0, bossKills: [], titles: [], nemesis: null }
  };
}

async function aggregate(cardId) {
  const svc = await createBlobServiceClient();
  const container = svc.getContainerClient(CONTAINER_NAME);
  const pubs = await downloadJsonOrNull(container, PUBLISHED_PATH);
  const card = findCardInPublished(pubs, cardId);
  if (!card) return { notFound: true };

  // Privacy inheritance: if owner profile is isPrivate, return private state.
  if (card.publishedBy) {
    const profile = await downloadJsonOrNull(container, `${PROFILE_PREFIX}${card.publishedBy}.json`);
    if (profile && profile.isPrivate === true) {
      return {
        notFound: false,
        isPrivate: true,
        card: { id: card.id, publishedByName: card.publishedByName || null }
      };
    }
  }

  return { notFound: false, isPrivate: false, card: sanitizeCard(card) };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS };
    return;
  }

  const cardId = (req.query && req.query.id) ? String(req.query.id).trim() : '';
  if (!cardId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'id query param required' } };
    return;
  }

  const cached = _cache.get(cardId);
  if (cached && (Date.now() - cached.asOf < CACHE_TTL_MS)) {
    context.res = { status: 200, headers: CORS_HEADERS, body: cached.payload };
    return;
  }

  try {
    const result = await aggregate(cardId);
    if (result.notFound) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'card not found' } };
      return;
    }
    const payload = { ok: true, isPrivate: !!result.isPrivate, card: result.card };
    _cache.set(cardId, { asOf: Date.now(), payload });
    context.res = { status: 200, headers: CORS_HEADERS, body: payload };
  } catch (err) {
    context.log.error('[blindspotcardview] error', err);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'internal error' } };
  }
};
