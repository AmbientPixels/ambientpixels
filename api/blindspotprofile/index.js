const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

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
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      if (context && context.log && typeof context.log.warn === 'function') {
        context.log.warn(`Failed to parse client principal: ${err.message}`);
      }
    }
  }
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, isAuthenticated: true };
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) {
      context.log(`[DEV AUTH] Falling back to X-User-ID: ${devUserId}`);
      return { userId: devUserId, isAuthenticated: true };
    }
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

function getAbortSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function downloadJsonBlob(containerClient, blobName, context) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;

  const downloadResponse = await blobClient.download(0, undefined, {
    abortSignal: getAbortSignal(10000)
  });
  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) {
    chunks.push(chunk);
  }
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

function createDefaultProfile(userId) {
  return {
    userId,
    sparks: 0,
    highestBoss: 0,
    totalWins: 0,
    totalBounties: 0,
    winStreak: 0,
    bestStreak: 0,
    ascension: 0,
    towerFloor: 0,
    towerBest: 0,
    forgeWins: 0,
    forgeVisits: 0,
    cardTitle: '',
    selectedCardId: null,
    pvpElo: 1000,
    pvpRecord: { w: 0, l: 0 },
    crateWinCounter: 0,
    crates: [],
    charms: [],
    cosmetics: [],
    purchasedCosmetics: [],
    equipped: {},
    visualUnlocks: ['palette_earth', 'container_masked'],
    bossRecords: {},
    masteryClaimed: {},
    claimedRewards: [],
    towerClaimed: [],
    weeklyBoss: {},
    challenges: {},
    bounties: {},
    lastDaily: '',
    createdAt: new Date().toISOString(),
    lastPlayedAt: null
  };
}

// Merge client profile into server profile — server wins on conflicts for numbers,
// union for arrays, deep merge for objects
function mergeProfiles(server, client) {
  const merged = { ...server };

  // Numeric fields — keep higher value
  const numericKeys = [
    'sparks', 'highestBoss', 'totalWins', 'totalBounties',
    'bestStreak', 'ascension', 'towerBest', 'forgeVisits'
  ];
  for (const key of numericKeys) {
    if (typeof client[key] === 'number') {
      merged[key] = Math.max(merged[key] || 0, client[key]);
    }
  }

  // Numeric fields — take client value (current state, not high-watermark)
  const currentStateKeys = [
    'winStreak', 'towerFloor', 'forgeWins', 'pvpElo', 'crateWinCounter'
  ];
  for (const key of currentStateKeys) {
    if (typeof client[key] === 'number') {
      merged[key] = client[key];
    }
  }

  // String fields — take client if non-empty
  if (client.cardTitle) merged.cardTitle = client.cardTitle;
  if (client.selectedCardId) merged.selectedCardId = client.selectedCardId;
  if (client.lastDaily) merged.lastDaily = client.lastDaily;

  // PvP record — take client (current state)
  if (client.pvpRecord && typeof client.pvpRecord === 'object') {
    merged.pvpRecord = client.pvpRecord;
  }

  // Array fields — union (deduplicate)
  const arrayKeys = [
    'crates', 'charms', 'cosmetics', 'purchasedCosmetics',
    'visualUnlocks', 'claimedRewards', 'towerClaimed'
  ];
  for (const key of arrayKeys) {
    if (Array.isArray(client[key])) {
      const serverArr = Array.isArray(merged[key]) ? merged[key] : [];
      // For primitive arrays (strings), dedupe by value
      // For object arrays (crates, charms), concat client extras
      if (key === 'crates' || key === 'charms') {
        // Object arrays — take client state (they're consumable/mutable)
        merged[key] = client[key];
      } else {
        // Primitive arrays — union
        const set = new Set([...serverArr, ...client[key]]);
        merged[key] = [...set];
      }
    }
  }

  // Object fields — deep merge keeping higher sub-values
  if (client.equipped && typeof client.equipped === 'object') {
    merged.equipped = { ...merged.equipped, ...client.equipped };
  }

  // Boss records — merge per-boss, keep higher wins/losses
  if (client.bossRecords && typeof client.bossRecords === 'object') {
    merged.bossRecords = merged.bossRecords || {};
    for (const bossId of Object.keys(client.bossRecords)) {
      const serverBoss = merged.bossRecords[bossId] || { wins: 0, losses: 0 };
      const clientBoss = client.bossRecords[bossId] || { wins: 0, losses: 0 };
      merged.bossRecords[bossId] = {
        wins: Math.max(serverBoss.wins || 0, clientBoss.wins || 0),
        losses: Math.max(serverBoss.losses || 0, clientBoss.losses || 0)
      };
    }
  }

  // Mastery claimed — merge, keep higher tier
  if (client.masteryClaimed && typeof client.masteryClaimed === 'object') {
    merged.masteryClaimed = merged.masteryClaimed || {};
    for (const key of Object.keys(client.masteryClaimed)) {
      merged.masteryClaimed[key] = Math.max(
        merged.masteryClaimed[key] || 0,
        client.masteryClaimed[key] || 0
      );
    }
  }

  // Challenges — merge, keep higher tier
  if (client.challenges && typeof client.challenges === 'object') {
    merged.challenges = merged.challenges || {};
    for (const key of Object.keys(client.challenges)) {
      merged.challenges[key] = Math.max(
        merged.challenges[key] || 0,
        client.challenges[key] || 0
      );
    }
  }

  // Bounties and weekly boss — take client (current state, resets daily/weekly)
  if (client.bounties && typeof client.bounties === 'object') {
    merged.bounties = client.bounties;
  }
  if (client.weeklyBoss && typeof client.weeklyBoss === 'object') {
    merged.weeklyBoss = client.weeklyBoss;
  }

  merged.lastPlayedAt = new Date().toISOString();
  return merged;
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  try {
    const { userId, isAuthenticated } = extractUserInfo(req, context);

    // Demo mode for anonymous users
    if (!isAuthenticated) {
      if (req.method === 'GET') {
        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { profile: createDefaultProfile('demo-guest'), isDemo: true }
        };
      } else {
        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, isDemo: true }
        };
      }
      return;
    }

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const profilePath = `blindspot/profiles/${userId}.json`;

    if (req.method === 'GET') {
      let profile = await downloadJsonBlob(containerClient, profilePath, context);
      let isNew = false;

      if (!profile) {
        profile = createDefaultProfile(userId);
        await uploadJsonBlob(containerClient, profilePath, profile);
        isNew = true;
        context.log(`[Blindspot] Created new profile for user ${userId}`);
      }

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { profile, isNew }
      };
    } else if (req.method === 'POST') {
      const body = req.body || {};
      const { action } = body;

      if (action === 'sync') {
        const clientProfile = body.profile;
        if (!clientProfile || typeof clientProfile !== 'object') {
          context.res = {
            status: 400,
            headers: CORS_HEADERS,
            body: { error: 'profile object is required for sync' }
          };
          return;
        }

        let serverProfile = await downloadJsonBlob(containerClient, profilePath, context);
        if (!serverProfile) {
          serverProfile = createDefaultProfile(userId);
        }

        const merged = mergeProfiles(serverProfile, clientProfile);
        merged.userId = userId; // Ensure userId is never overwritten
        await uploadJsonBlob(containerClient, profilePath, merged);

        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, profile: merged }
        };
      } else if (action === 'reset') {
        const fresh = createDefaultProfile(userId);
        await uploadJsonBlob(containerClient, profilePath, fresh);
        context.log(`[Blindspot] Reset profile for user ${userId}`);
        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, profile: fresh }
        };
      } else {
        context.res = {
          status: 400,
          headers: CORS_HEADERS,
          body: { error: `Unknown action: ${action}` }
        };
      }
    }
  } catch (error) {
    context.log.error(`[Blindspot Profile] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Blindspot profile error: ${error.message}` }
    };
  }
};
