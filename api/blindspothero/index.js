const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

// Slim hero feed for the Blindspot splash slot machine. Returns just
// {name, avatar, createdAt} per published card so the splash carousel
// doesn't have to download the multi-megabyte cardforgeloadcards
// payload (which carries full stat blobs, traits, ownership, etc.).

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const PUBLISHED_CARDS_PATH = 'published-cards.json';
const MAX_COUNT = 50;
const DEFAULT_COUNT = 10;

// Surface-specific admin configs live alongside the moderation blocklist.
// All gracefully default if the blob is missing — the splash carousel must
// never break because of an admin-config issue.
const MODERATION_BLOB = 'admin/blindspot-moderation.json';
const SURFACE_BLOB = {
  hero: 'admin/blindspot-hero-config.json',
  hall: 'admin/blindspot-hall-config.json'
};
const VALID_SURFACES = ['hero', 'hall'];

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

async function downloadJsonBlob(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;
  const resp = await blobClient.download(0, undefined, { abortSignal: getAbortSignal(15000) });
  const chunks = [];
  for await (const chunk of resp.readableStreamBody) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function tryReadJsonBlob(containerClient, blobName, context) {
  try {
    return await downloadJsonBlob(containerClient, blobName);
  } catch (err) {
    if (context && context.log && context.log.warn) {
      context.log.warn(`[blindspothero] could not read ${blobName}: ${err.message}`);
    }
    return null;
  }
}

// Walk the schema variants — avatar URL has drifted across editor versions.
function extractAvatar(card) {
  if (!card) return '';
  return card.avatar
    || (card.cardData && card.cardData.cardContent
      && card.cardData.cardContent.frontFace
      && card.cardData.cardContent.frontFace.characterImage
      && card.cardData.cardContent.frontFace.characterImage.url)
    || card.image
    || card.imageUrl
    || '';
}

function toSlim(card) {
  const avatar = extractAvatar(card);
  if (!avatar) return null;
  const ts = card.publishDate || card.publishedAt || card.createdAt || card.updatedAt || null;
  return {
    name: card.name || 'Featured Card',
    avatar,
    createdAt: ts,
    creator: card.publishedByName || null
  };
}

function toFull(card) {
  const slim = toSlim(card);
  if (!slim) return null;
  slim.card = card;
  return slim;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  let count = parseInt((req.query && req.query.count) || DEFAULT_COUNT, 10);
  if (!Number.isFinite(count) || count <= 0) count = DEFAULT_COUNT;
  if (count > MAX_COUNT) count = MAX_COUNT;

  const detail = String((req.query && req.query.detail) || 'slim').toLowerCase();
  const mapper = detail === 'full' ? toFull : toSlim;

  const surfaceParam = String((req.query && req.query.surface) || 'hero').toLowerCase();
  const surface = VALID_SURFACES.indexOf(surfaceParam) >= 0 ? surfaceParam : 'hero';

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // Fetch published cards + admin configs in parallel; configs soft-fail
    // (returning null) so an admin-config issue can't break the splash.
    const [data, modConfig, surfaceConfig] = await Promise.all([
      downloadJsonBlob(containerClient, PUBLISHED_CARDS_PATH),
      tryReadJsonBlob(containerClient, MODERATION_BLOB, context),
      tryReadJsonBlob(containerClient, SURFACE_BLOB[surface], context)
    ]);

    const cards = (data && Array.isArray(data.publishedCards)) ? data.publishedCards : [];
    const hiddenIds = new Set((modConfig && Array.isArray(modConfig.hiddenIds)) ? modConfig.hiddenIds : []);
    const mode = (surfaceConfig && surfaceConfig.mode) || 'recent';
    const curatedIds = (surfaceConfig && Array.isArray(surfaceConfig.curatedIds)) ? surfaceConfig.curatedIds : [];

    // 1. Apply moderation (drop hidden cards by id)
    let filtered = cards.filter(c => c && !hiddenIds.has(c.id));

    // 2. Apply mode
    if (mode === 'curated' && curatedIds.length > 0) {
      const byId = new Map();
      for (const c of filtered) byId.set(c.id, c);
      filtered = curatedIds.map(id => byId.get(id)).filter(Boolean);
    } else if (mode === 'random') {
      filtered = filtered.slice();
      for (let i = filtered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = filtered[i]; filtered[i] = filtered[j]; filtered[j] = t;
      }
    } else {
      // 'recent' (default) and 'highest-rated' fallback when no rating data here.
      filtered = filtered.slice().sort((a, b) => {
        const ta = a.publishDate || a.publishedAt || a.createdAt || a.updatedAt || 0;
        const tb = b.publishDate || b.publishedAt || b.createdAt || b.updatedAt || 0;
        const da = ta ? Date.parse(ta) : 0;
        const db = tb ? Date.parse(tb) : 0;
        return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
      });
    }

    const slides = filtered.map(mapper).filter(Boolean).slice(0, count);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { slides, count: slides.length, surface, mode }
    };
  } catch (err) {
    context.log.error(`[blindspothero] ${err.message}`);
    context.res = {
      status: 200, // soft-fail — splash should still load
      headers: CORS_HEADERS,
      body: { slides: [], count: 0, error: 'gallery unavailable' }
    };
  }
};
