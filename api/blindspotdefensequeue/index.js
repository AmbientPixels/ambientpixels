const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const QUEUE_BLOB = 'blindspot/defenseQueue.json';
const MAX_QUEUE_SIZE = 500;
const STALE_DAYS = 7;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      const clientPrincipal = JSON.parse(decoded);
      const userId = clientPrincipal.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous', displayName: clientPrincipal.userDetails || '' };
    } catch (err) {
      if (context && context.log && typeof context.log.warn === 'function') {
        context.log.warn(`Failed to parse client principal: ${err.message}`);
      }
    }
  }
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, isAuthenticated: true, displayName: '' };
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) return { userId: devUserId, isAuthenticated: true, displayName: 'Dev User' };
  }
  return { userId: 'anonymous', isAuthenticated: false, displayName: '' };
}

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
  const downloadResponse = await blobClient.download(0, undefined, { abortSignal: getAbortSignal(10000) });
  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) { chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function uploadJsonBlob(containerClient, blobName, data) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const content = JSON.stringify(data, null, 2);
  await blobClient.upload(content, Buffer.byteLength(content), {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

// ═══════════════════════════════════════════════════════════════
// DEFENSE QUEUE — Global pool of cards available for async PvP
// ═══════════════════════════════════════════════════════════════
//
// GET  → list queue (excludes own card, sorted by Elo proximity)
// POST { action: 'register', cardId, cardData } → add card to queue (1 per user)
// POST { action: 'withdraw' } → remove card from queue
// ═══════════════════════════════════════════════════════════════

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  try {
    const { userId, isAuthenticated, displayName } = extractUserInfo(req, context);

    if (!isAuthenticated) {
      if (req.method === 'GET') {
        // Anonymous can browse the queue
        const blobServiceClient = await createBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
        const queue = await downloadJsonBlob(containerClient, QUEUE_BLOB) || [];
        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { queue: pruneStaleEntries(queue), total: queue.length, isDemo: true }
        };
      } else {
        context.res = { status: 200, headers: CORS_HEADERS, body: { success: false, isDemo: true, error: 'Sign in to register for defense' } };
      }
      return;
    }

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    if (req.method === 'GET') {
      let queue = await downloadJsonBlob(containerClient, QUEUE_BLOB) || [];

      // Prune stale entries (no login in 7 days)
      const before = queue.length;
      queue = pruneStaleEntries(queue);
      if (queue.length !== before) {
        await uploadJsonBlob(containerClient, QUEUE_BLOB, queue);
      }

      // Load requester's Blindspot profile for Elo proximity sorting
      const profile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`);
      const myElo = (profile && profile.pvpElo) || 1000;

      // Exclude own card, sort by Elo proximity
      const filtered = queue
        .filter(entry => entry.userId !== userId)
        .sort((a, b) => Math.abs(a.pvpElo - myElo) - Math.abs(b.pvpElo - myElo));

      // Find own entry for status display
      const myEntry = queue.find(entry => entry.userId === userId) || null;

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { queue: filtered, total: queue.length, myEntry }
      };
    } else if (req.method === 'POST') {
      const body = req.body || {};
      const { action } = body;

      if (action === 'register') {
        const { cardId, cardData } = body;
        if (!cardId || !cardData) {
          context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'cardId and cardData are required' } };
          return;
        }

        // Validate card has combat stats
        const cs = cardData.combatStats;
        if (!cs || typeof cs !== 'object') {
          context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Card must have combatStats' } };
          return;
        }

        let queue = await downloadJsonBlob(containerClient, QUEUE_BLOB) || [];
        queue = pruneStaleEntries(queue);

        // Remove existing entry for this user (1 card per user)
        queue = queue.filter(entry => entry.userId !== userId);

        if (queue.length >= MAX_QUEUE_SIZE) {
          context.res = { status: 409, headers: CORS_HEADERS, body: { error: 'Defense queue is full. Try again later.' } };
          return;
        }

        // Load player's Blindspot profile for Elo
        const profile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`);
        const pvpElo = (profile && profile.pvpElo) || 1000;

        // Snapshot the card into the queue
        const entry = {
          cardId,
          userId,
          displayName: displayName || 'Challenger',
          cardName: cardData.name || 'Unnamed',
          cardClass: cardData.class || '',
          rarity: cardData.rarity || 'common',
          combatStats: {
            str: Math.min(100, Math.max(1, Math.round(cs.str || 40))),
            agi: Math.min(100, Math.max(1, Math.round(cs.agi || 40))),
            int: Math.min(100, Math.max(1, Math.round(cs.int || 40))),
            end: Math.min(100, Math.max(1, Math.round(cs.end || 40))),
            lck: Math.min(100, Math.max(1, Math.round(cs.lck || 30)))
          },
          badges: Array.isArray(cardData.badges) ? cardData.badges.slice(0, 10) : [],
          avatar: cardData.avatar || '',
          pvpElo,
          registeredAt: new Date().toISOString(),
          record: { w: 0, l: 0 },
          lastChallengedAt: null
        };

        queue.push(entry);
        await uploadJsonBlob(containerClient, QUEUE_BLOB, queue);

        // Store defenseCardId in Blindspot profile
        if (profile) {
          profile.defenseCardId = cardId;
          await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, profile);
        }

        context.log(`[AsyncPvP] ${userId} registered card "${entry.cardName}" for defense (Elo: ${pvpElo})`);

        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, entry }
        };
      } else if (action === 'withdraw') {
        let queue = await downloadJsonBlob(containerClient, QUEUE_BLOB) || [];
        const before = queue.length;
        queue = queue.filter(entry => entry.userId !== userId);

        if (queue.length === before) {
          context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'You have no card in the defense queue' } };
          return;
        }

        await uploadJsonBlob(containerClient, QUEUE_BLOB, queue);

        // Clear defenseCardId from profile
        const profile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`);
        if (profile) {
          profile.defenseCardId = null;
          await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, profile);
        }

        context.log(`[AsyncPvP] ${userId} withdrew card from defense queue`);

        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true }
        };
      } else {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: `Unknown action: ${action}` } };
      }
    }
  } catch (error) {
    context.log.error(`[Defense Queue] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Defense queue error: ${error.message}` }
    };
  }
};

function pruneStaleEntries(queue) {
  const cutoff = Date.now() - (STALE_DAYS * 24 * 60 * 60 * 1000);
  return queue.filter(entry => new Date(entry.registeredAt).getTime() > cutoff);
}
