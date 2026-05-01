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
  const ts = card.publishedAt || card.createdAt || card.updatedAt || null;
  return {
    name: card.name || 'Featured Card',
    avatar,
    createdAt: ts
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  let count = parseInt((req.query && req.query.count) || DEFAULT_COUNT, 10);
  if (!Number.isFinite(count) || count <= 0) count = DEFAULT_COUNT;
  if (count > MAX_COUNT) count = MAX_COUNT;

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const data = await downloadJsonBlob(containerClient, PUBLISHED_CARDS_PATH);

    const cards = (data && Array.isArray(data.publishedCards)) ? data.publishedCards : [];
    const slides = cards
      .map(toSlim)
      .filter(Boolean)
      .sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
      })
      .slice(0, count);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { slides, count: slides.length }
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
