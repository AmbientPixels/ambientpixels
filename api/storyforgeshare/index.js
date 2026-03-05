const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'storyforge';
const GALLERY_BLOB = 'public-adventures.json';
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

const GENRE_NAMES = {
  fantasy: 'Fantasy', horror: 'Horror', scifi: 'Sci-Fi',
  detective: 'Detective', postapoc: 'Post-Apocalyptic', pirate: 'Pirate'
};

const ENDING_LABELS = {
  victory: 'Victory', death: 'Defeated', escape: 'Escaped'
};

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

  const adventureId = req.query && req.query.adventure;
  if (!adventureId) {
    context.res = { status: 302, headers: { Location: `${SITE_ORIGIN}/storyforge/gallery.html` }, body: '' };
    return;
  }

  const viewUrl = `${SITE_ORIGIN}/storyforge/gallery.html?adventure=${encodeURIComponent(adventureId)}`;

  let adventure = null;
  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobClient = containerClient.getBlockBlobClient(GALLERY_BLOB);

    const exists = await blobClient.exists();
    if (exists) {
      const downloadResponse = await blobClient.download();
      const content = await streamToText(downloadResponse.readableStreamBody);
      const data = JSON.parse(content);
      const adventures = Array.isArray(data.adventures) ? data.adventures : [];
      adventure = adventures.find(a => a.adventureId === adventureId);
    }
  } catch (err) {
    context.log.warn(`storyforgeshare: failed to load adventure ${adventureId}: ${err.message}`);
  }

  const genreName = adventure ? (GENRE_NAMES[adventure.genre] || adventure.genre) : 'Unknown';
  const playerName = escapeHtml((adventure && adventure.playerName) || 'A brave adventurer');
  const endingType = adventure ? (ENDING_LABELS[adventure.endingType] || 'mystery') : 'mystery';
  const turnCount = adventure ? adventure.turnCount : '?';

  const title = `${playerName}'s ${genreName} Adventure`;
  const description = adventure
    ? `A ${turnCount}-turn ${genreName} adventure ending in ${endingType}. ${escapeHtml((adventure.endingText || '').substring(0, 150))}`
    : 'An AI-powered choose-your-own-adventure from StoryForge.';

  // Social platforms reject data: URIs — always use site logo
  const ogImage = `${SITE_ORIGIN}/images/ambient-pixel-logo-rainbow.png`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)} | StoryForge</title>

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:url" content="${escapeHtml(viewUrl)}">
  <meta property="og:site_name" content="StoryForge by Ambient Pixels">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">

  <!-- Redirect -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(viewUrl)}">
  <style>
    body { font-family: -apple-system, sans-serif; background: #071019; color: #d8e0e5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    a { color: #7B8FE0; }
  </style>
</head>
<body>
  <p>Loading adventure... <a href="${escapeHtml(viewUrl)}">Click here</a> if you are not redirected.</p>
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
