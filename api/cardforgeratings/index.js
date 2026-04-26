const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = "cardforgeblobdata";
const CONTAINER_NAME = "cardforge";
const RATINGS_BLOB_PATH = "card-ratings.json";

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  // 30s public cache so a freshly hearted count propagates quickly to other
  // viewers without making every page load hammer blob storage.
  'Cache-Control': 'public, max-age=30'
};

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function flattenCounts(ratingsObj) {
  // Aggregate blob stores { cardId: { count, updatedAt } }; flatten to
  // { cardId: count } for the public client — clients don't need per-card
  // updatedAt today, and a smaller payload caches better.
  const out = {};
  if (!ratingsObj || typeof ratingsObj !== 'object') return out;
  Object.keys(ratingsObj).forEach(id => {
    const v = ratingsObj[id];
    if (v && typeof v.count === 'number' && v.count > 0) out[id] = v.count;
  });
  return out;
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

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobClient = containerClient.getBlockBlobClient(RATINGS_BLOB_PATH);

    const exists = await blobClient.exists();
    if (!exists) {
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { ratings: {}, updatedAt: null }
      };
      return;
    }

    const dl = await blobClient.download();
    const text = await streamToText(dl.readableStreamBody);
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {
      context.log.warn(`card-ratings parse failed: ${e.message}`);
    }

    const ratings = flattenCounts(parsed && parsed.ratings);
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        ratings,
        updatedAt: (parsed && parsed.updatedAt) || null
      }
    };
  } catch (error) {
    context.log.error(`cardforgeratings error: ${error.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: error.message } };
  }
};
