const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const SITE_ORIGIN = 'https://ambientpixels.ai';

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

async function streamToText(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => chunks.push(data.toString()));
    readableStream.on('end', () => resolve(chunks.join('')));
    readableStream.on('error', reject);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
    return;
  }

  const cardId = req.query.card;
  if (!cardId) {
    context.res = { status: 302, headers: { Location: `${SITE_ORIGIN}/cardforge/` }, body: '' };
    return;
  }

  // Redirect URL — where the user lands after social preview.
  // Must be gallery.html (not the splash) because that's where
  // cardforge-lightbox.js's checkDeepLink() runs and finds the
  // #gallery-cards-grid it needs to open the shared card.
  const viewUrl = `${SITE_ORIGIN}/cardforge/gallery.html?card=${encodeURIComponent(cardId)}`;

  let card = null;
  // Hoisted so the og:image HEAD probe below can reuse the same client.
  let containerClient = null;
  try {
    const blobServiceClient = await createBlobServiceClient();
    containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const publishedBlobClient = containerClient.getBlockBlobClient('published-cards.json');

    const exists = await publishedBlobClient.exists();
    if (exists) {
      const downloadResponse = await publishedBlobClient.download();
      const content = await streamToText(downloadResponse.readableStreamBody);
      const data = JSON.parse(content);
      const cards = Array.isArray(data.publishedCards) ? data.publishedCards : [];
      card = cards.find(c => c.id === cardId);
    }
  } catch (err) {
    context.log.warn(`cardshare: failed to load card ${cardId}: ${err.message}`);
  }

  // Card metadata with safe fallbacks
  const title = escapeHtml((card && (card.name || card.title)) || 'CardForge Card');
  const description = escapeHtml(
    (card && (card.description || card.quote)) ||
    'A custom card created with CardForge — a modular visual card design system.'
  );
  const cardClass = escapeHtml((card && card.class) || '');
  const cardType = escapeHtml((card && card.type) || '');
  const subtitle = [cardClass, cardType].filter(Boolean).join(' · ');

  // og:image precedence:
  //   1. Per-card composition PNG at og-cards/{cardId}.png (rendered at
  //      publish-time via cardforge-og-composition.js, captured by
  //      modern-screenshot, uploaded by cardforgesaveogimage). HEAD-probe
  //      the blob so we don't 404 social crawlers.
  //   2. Static CardForge brand OG (cardforge/images/cardforge-og.png).
  //   3. Card's HTTP avatar URL — kept as a soft fallback for very old
  //      cards predating the composition pipeline. Skipped for data URIs
  //      (they can't be served as og:image URLs).
  const STATIC_BRAND_OG = `${SITE_ORIGIN}/cardforge/images/cardforge-og.png`;
  const PER_CARD_BLOB_PATH = `og-cards/${cardId}.png`;
  let ogImage = STATIC_BRAND_OG;
  try {
    if (containerClient) {
      const ogBlobClient = containerClient.getBlockBlobClient(PER_CARD_BLOB_PATH);
      const ogExists = await ogBlobClient.exists();
      if (ogExists) {
        const cacheBust = (card && (card.updatedAt || card.publishedAt)) || cardId;
        ogImage = `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER_NAME}/${PER_CARD_BLOB_PATH}?v=${encodeURIComponent(cacheBust)}`;
      } else if (card && card.avatar && typeof card.avatar === 'string' &&
                 (card.avatar.startsWith('http://') || card.avatar.startsWith('https://'))) {
        // Legacy fallback for old cards with HTTP avatars and no per-card OG yet
        ogImage = card.avatar;
      }
    }
  } catch (err) {
    context.log.warn(`cardshare: og blob probe failed for ${cardId}: ${err.message}`);
    // Fall through to static brand OG
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}${subtitle ? ' — ' + subtitle : ''} | CardForge</title>

  <!-- Open Graph (Facebook, Discord, LinkedIn) -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}${subtitle ? ' — ' + subtitle : ''}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${escapeHtml(viewUrl)}">
  <meta property="og:site_name" content="CardForge by Ambient Pixels">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}${subtitle ? ' — ' + subtitle : ''}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">

  <!-- Redirect humans to the card viewer -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(viewUrl)}">
  <style>
    body { font-family: -apple-system, sans-serif; background: #0a0e1a; color: #e1e1ff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    a { color: #7B8FE0; }
  </style>
</head>
<body>
  <p>Loading card... <a href="${escapeHtml(viewUrl)}">Click here</a> if you are not redirected.</p>
  <script>window.location.replace(${JSON.stringify(viewUrl)});</script>
</body>
</html>`;

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    },
    body: html
  };
};
