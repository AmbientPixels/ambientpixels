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

  const shareId = req.query.deck;
  if (!shareId) {
    context.res = { status: 302, headers: { Location: `${SITE_ORIGIN}/cardforge/` }, body: '' };
    return;
  }

  // Redirect URL — where the user lands after social preview
  const viewUrl = `${SITE_ORIGIN}/cardforge/deck.html?deck=${encodeURIComponent(shareId)}`;

  let deck = null;
  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const deckBlobClient = containerClient.getBlockBlobClient(`published-decks/${shareId}.json`);

    const exists = await deckBlobClient.exists();
    if (exists) {
      const downloadResponse = await deckBlobClient.download();
      const content = await streamToText(downloadResponse.readableStreamBody);
      deck = JSON.parse(content);
    }
  } catch (err) {
    context.log.warn(`deckshare: failed to load deck ${shareId}: ${err.message}`);
  }

  // Deck metadata with safe fallbacks
  const title = escapeHtml((deck && deck.name) || 'CardForge Deck');
  const description = escapeHtml(
    (deck && deck.description) ||
    'A custom deck created with CardForge — a modular visual card design system.'
  );
  const cardCount = (deck && deck.cards) ? deck.cards.length : (deck && deck.cardCount) || 0;
  const tags = (deck && Array.isArray(deck.tags) && deck.tags.length) ? deck.tags.join(', ') : '';
  const subtitle = [cardCount + ' card' + (cardCount !== 1 ? 's' : ''), tags].filter(Boolean).join(' · ');

  // og:image — use deckImage if it's an HTTP URL, otherwise fallback to site logo
  let ogImage = `${SITE_ORIGIN}/images/ambient-pixel-logo-rainbow.png`;
  if (deck && deck.deckImage && typeof deck.deckImage === 'string') {
    if (deck.deckImage.startsWith('http://') || deck.deckImage.startsWith('https://')) {
      ogImage = deck.deckImage;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} | CardForge Deck</title>

  <!-- Open Graph (Facebook, Discord, LinkedIn) -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${escapeHtml(subtitle + (description ? ' — ' + description : ''))}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:url" content="${escapeHtml(viewUrl)}">
  <meta property="og:site_name" content="CardForge by Ambient Pixels">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${escapeHtml(subtitle + (description ? ' — ' + description : ''))}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">

  <!-- Redirect humans to the deck viewer -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(viewUrl)}">
  <style>
    body { font-family: -apple-system, sans-serif; background: #0a0e1a; color: #e1e1ff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    a { color: #7B8FE0; }
  </style>
</head>
<body>
  <p>Loading deck... <a href="${escapeHtml(viewUrl)}">Click here</a> if you are not redirected.</p>
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
