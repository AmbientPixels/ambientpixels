const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

// Configuration constants — mirrors cardforgepublish
const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Helper: stream to text
async function streamToText(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (d) => chunks.push(d.toString()));
    readableStream.on('end', () => resolve(chunks.join('')));
    readableStream.on('error', reject);
  });
}

// Helper: create blob service client (same pattern as other CardForge APIs)
async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

// Helper: retry wrapper
async function withRetry(operation, operationName, context, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) context.log(`Retry ${attempt + 1}/${maxRetries} for ${operationName}`);
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = ['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE', 'REQUEST_SEND_ERROR'];
      const isRetryable = (error.code && retryable.includes(error.code)) ||
        (error.statusCode && (error.statusCode === 429 || (error.statusCode >= 500 && error.statusCode < 600)));
      if (!isRetryable) throw error;
      const delay = Math.min(Math.pow(2, attempt) * 100 + Math.random() * 100, 3000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  const shareId = (req.query && req.query.shareId) || '';
  context.log(`cardforgedeckload: shareId=${shareId || '(none — returning index)'}`);

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // No shareId → return the published decks index (gallery listing)
    if (!shareId) {
      const indexPath = 'published-decks-index.json';
      const indexBlobClient = containerClient.getBlockBlobClient(indexPath);
      const indexExists = await withRetry(() => indexBlobClient.exists(), 'check index exists', context);

      if (!indexExists) {
        context.res = { status: 200, headers: CORS_HEADERS, body: { publishedDecks: [] } };
        return;
      }

      const dl = await withRetry(() => indexBlobClient.download(), 'download index', context);
      const text = await streamToText(dl.readableStreamBody);
      let index;
      try {
        index = JSON.parse(text);
      } catch (e) {
        context.log.error('Index parse error: ' + e.message);
        index = { publishedDecks: [] };
      }

      context.res = { status: 200, headers: CORS_HEADERS, body: index };
      return;
    }

    // Validate shareId format (alphanumeric + URL-safe base64 chars, max 16 chars)
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(shareId)) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid shareId format' } };
      return;
    }

    const deckBlobPath = `published-decks/${shareId}.json`;
    const deckBlobClient = containerClient.getBlockBlobClient(deckBlobPath);

    const exists = await withRetry(() => deckBlobClient.exists(), `check deck blob (${deckBlobPath})`, context);
    if (!exists) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Deck not found' } };
      return;
    }

    const dl = await withRetry(() => deckBlobClient.download(), `download deck blob (${deckBlobPath})`, context);
    const text = await streamToText(dl.readableStreamBody);

    let deckData;
    try {
      deckData = JSON.parse(text);
    } catch (e) {
      context.log.error(`JSON parse error for deck ${shareId}: ${e.message}`);
      context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Corrupt deck data' } };
      return;
    }

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: deckData
    };

  } catch (error) {
    context.log.error(`Deck load error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Failed to load deck: ${error.message}` }
    };
  }
};
