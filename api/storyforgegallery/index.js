const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'storyforge';
const GALLERY_BLOB = 'public-adventures.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CF-Auth-Principal',
  'Content-Type': 'application/json'
};

function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      const clientPrincipal = JSON.parse(decoded);
      const userId = clientPrincipal.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      context.log.warn(`Failed to parse client principal: ${err.message}`);
    }
  }
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, isAuthenticated: true };
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) return { userId: devUserId, isAuthenticated: true };
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

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

// Load gallery blob
async function loadGallery(containerClient) {
  const blobClient = containerClient.getBlockBlobClient(GALLERY_BLOB);
  try {
    const exists = await blobClient.exists();
    if (!exists) return { adventures: [], lastUpdated: null };
    const downloadResponse = await blobClient.download();
    const content = await streamToText(downloadResponse.readableStreamBody);
    const parsed = JSON.parse(content);
    return {
      adventures: Array.isArray(parsed.adventures) ? parsed.adventures : [],
      lastUpdated: parsed.lastUpdated || null
    };
  } catch (err) {
    return { adventures: [], lastUpdated: null };
  }
}

// Save gallery blob
async function saveGallery(containerClient, galleryData) {
  const blobClient = containerClient.getBlockBlobClient(GALLERY_BLOB);
  galleryData.lastUpdated = new Date().toISOString();
  const data = JSON.stringify(galleryData);
  const buffer = Buffer.from(data, 'utf8');
  await blobClient.upload(buffer, buffer.byteLength, {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

// --- GET: Browse gallery (anonymous) ---
async function handleGet(context, req) {
  const blobServiceClient = await createBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  const gallery = await loadGallery(containerClient);
  let filtered = gallery.adventures;

  // Genre filter
  const genre = req.query && req.query.genre;
  if (genre) {
    filtered = filtered.filter(a => a.genre === genre);
  }

  // Sort newest first
  filtered.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

  // Pagination
  const page = Math.max(1, parseInt(req.query && req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query && req.query.limit) || 20));
  const total = filtered.length;
  const start = (page - 1) * limit;
  const paged = filtered.slice(start, start + limit);

  // Strip firstSceneImage from listing to reduce payload size
  const lightweight = paged.map(a => {
    const copy = Object.assign({}, a);
    if (copy.firstSceneImage && copy.firstSceneImage.length > 200) {
      copy.hasImage = true;
      delete copy.firstSceneImage;
    }
    return copy;
  });

  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: {
      adventures: lightweight,
      total: total,
      page: page,
      limit: limit,
      hasMore: start + limit < total
    }
  };
}

// --- POST: Publish adventure (authenticated) ---
async function handlePost(context, req) {
  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
    return;
  }

  const { adventureId } = req.body || {};
  if (!adventureId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'adventureId required' } };
    return;
  }

  context.log(`[storyforgegallery] Publishing adventure ${adventureId} by user ${userId}`);

  const blobServiceClient = await createBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  // Load user's adventures
  const userBlobPath = `user/${userId}/adventures.json`;
  const userBlobClient = containerClient.getBlockBlobClient(userBlobPath);

  let userAdventures = { adventures: [] };
  try {
    const exists = await userBlobClient.exists();
    if (exists) {
      const downloadResponse = await userBlobClient.download();
      const content = await streamToText(downloadResponse.readableStreamBody);
      userAdventures = JSON.parse(content);
    }
  } catch (err) {
    context.log.warn(`Could not load user adventures: ${err.message}`);
  }

  const adventure = (userAdventures.adventures || []).find(a => a.adventureId === adventureId);
  if (!adventure) {
    context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Adventure not found in your saves' } };
    return;
  }

  if (adventure.status !== 'completed') {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Only completed adventures can be published' } };
    return;
  }

  // Build lightweight gallery entry
  const seedId = adventure.genre + '-' + adventureId.replace(/^sf_/, '').substring(0, 5);
  const galleryEntry = {
    adventureId: adventure.adventureId,
    genre: adventure.genre,
    playerName: adventure.playerName || 'Unknown',
    turnCount: adventure.turnCount || 0,
    maxTurns: adventure.maxTurns || 25,
    endingType: adventure.ending ? adventure.ending.type : 'unknown',
    endingText: (adventure.ending ? adventure.ending.text : '').substring(0, 500),
    firstSceneImage: adventure.firstSceneImage || null,
    stats: {
      hp: adventure.stats ? adventure.stats.hp : 0,
      maxHp: adventure.stats ? adventure.stats.maxHp : 100,
      gold: adventure.stats ? adventure.stats.gold : 0,
      reputation: adventure.stats ? adventure.stats.reputation : 0
    },
    eventLog: (adventure.eventLog || []).slice(-10),
    publishedBy: userId,
    publishedAt: new Date().toISOString(),
    seedId: seedId
  };

  // Load gallery and upsert
  const gallery = await loadGallery(containerClient);
  const existingIdx = gallery.adventures.findIndex(
    a => a.adventureId === adventureId && a.publishedBy === userId
  );
  if (existingIdx >= 0) {
    gallery.adventures[existingIdx] = galleryEntry;
    context.log(`[storyforgegallery] Updated existing gallery entry`);
  } else {
    gallery.adventures.push(galleryEntry);
    context.log(`[storyforgegallery] Added new gallery entry`);
  }

  await saveGallery(containerClient, gallery);

  // Mark as published in user blob
  const advIdx = userAdventures.adventures.findIndex(a => a.adventureId === adventureId);
  if (advIdx >= 0) {
    userAdventures.adventures[advIdx].published = true;
    userAdventures.adventures[advIdx].seedId = seedId;
    userAdventures.lastUpdated = new Date().toISOString();
    const data = JSON.stringify(userAdventures);
    const buffer = Buffer.from(data, 'utf8');
    await userBlobClient.upload(buffer, buffer.byteLength, {
      blobHTTPHeaders: { blobContentType: 'application/json' }
    });
  }

  const shareUrl = `/api/storyforgeshare?adventure=${encodeURIComponent(adventureId)}`;

  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: {
      success: true,
      adventureId: adventureId,
      seedId: seedId,
      shareUrl: shareUrl,
      totalPublished: gallery.adventures.length
    }
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    if (req.method === 'GET') {
      await handleGet(context, req);
    } else if (req.method === 'POST') {
      await handlePost(context, req);
    } else {
      context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method not allowed' } };
    }
  } catch (error) {
    context.log.error(`[storyforgegallery] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Gallery operation failed: ${error.message}` }
    };
  }
};
