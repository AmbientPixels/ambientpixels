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

  // Redirect URL — where the user lands after social preview
  const viewUrl = `${SITE_ORIGIN}/cardforge/?card=${encodeURIComponent(cardId)}`;

  let card = null;
  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
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

  // og:image — use card avatar if it's an HTTP URL, otherwise fallback to site logo
  let ogImage = `${SITE_ORIGIN}/images/ambient-pixel-logo-rainbow.png`;
  if (card && card.avatar && typeof card.avatar === 'string') {
    if (card.avatar.startsWith('http://') || card.avatar.startsWith('https://')) {
      ogImage = card.avatar;
    } else if (card.avatar.startsWith('data:image/')) {
      // data URIs don't work for og:image — keep fallback
    }
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
