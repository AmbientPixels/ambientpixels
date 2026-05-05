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

const LEVEL_XP_PER_LEVEL = 50;
const LEVEL_TIERS = [
  { id: 'initiate',   minLevel: 1   },
  { id: 'apprentice', minLevel: 6   },
  { id: 'veteran',    minLevel: 16  },
  { id: 'champion',   minLevel: 31  },
  { id: 'legend',     minLevel: 51  },
  { id: 'mythic',     minLevel: 100 }
];

function deriveLevelFields(xp) {
  const n = Math.max(0, Number(xp) || 0);
  const level = Math.floor(n / LEVEL_XP_PER_LEVEL) + 1;
  let tier = LEVEL_TIERS[0];
  for (const t of LEVEL_TIERS) {
    if (level >= t.minLevel) tier = t;
  }
  const xpToNext = (level * LEVEL_XP_PER_LEVEL) - n;
  return { level, tier: tier.id, xpToNext };
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
    xp: 0,
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
    // Player profile image (URL). Optional. When empty, the topbar
    // and Fighter Profile page fall back to the equipped card's
    // avatar. Set by the profile image generator (Phase D).
    profileImage: '',
    // Crop transform for the profile image (Phase E). Lets the
    // player drag + zoom inside the round frame. scale 1.0 + 50/50
    // matches the previous object-fit:cover default. Stored as plain
    // numbers so the client can serialize directly.
    profileImageTransform: { scale: 1, posX: 50, posY: 50 },
    // Welcome gift, every new authed profile starts with one Ember
    // crate so they have something to open immediately. Premium loot
    // table (25/35/28/12) gives a satisfying first-impression payout.
    crates: [{ type: 'ember', earned: Date.now() }],
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
    lastPlayedAt: null,
    // Wager system fields
    peakRank: 'Iron',
    lockedCards: [],
    trophyKills: 0,
    scars: 0,
    badges: [],
    rematchTokens: [],
    activeWagers: []
  };
}

// Merge client profile into server profile — server wins on conflicts for numbers,
// union for arrays, deep merge for objects
function mergeProfiles(server, client) {
  const merged = { ...server };

  // Numeric fields — keep higher value
  const numericKeys = [
    'sparks', 'xp', 'highestBoss', 'totalWins', 'totalBounties',
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
  if (typeof client.profileImage === 'string') merged.profileImage = client.profileImage;
  if (client.profileImageTransform && typeof client.profileImageTransform === 'object') {
    merged.profileImageTransform = client.profileImageTransform;
  }

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

  // Wager system fields
  // peakRank: high-watermark — keep whichever maps to a higher PVP rank index
  const PVP_RANK_NAMES = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
  const serverRankIdx = PVP_RANK_NAMES.indexOf(merged.peakRank || 'Iron');
  const clientRankIdx = PVP_RANK_NAMES.indexOf(client.peakRank || 'Iron');
  if (clientRankIdx > serverRankIdx) {
    merged.peakRank = client.peakRank;
  } else if (serverRankIdx < 0) {
    merged.peakRank = 'Iron';
  }

  // lockedCards, rematchTokens, activeWagers: server-authoritative (mutations happen via API)
  // Do not overwrite from client — server is source of truth for these

  // trophyKills, scars: high-watermark
  if (typeof client.trophyKills === 'number') {
    merged.trophyKills = Math.max(merged.trophyKills || 0, client.trophyKills);
  }
  if (typeof client.scars === 'number') {
    merged.scars = Math.max(merged.scars || 0, client.scars);
  }

  // badges: union by type (deduplicate)
  if (Array.isArray(client.badges) && client.badges.length > 0) {
    const serverBadges = Array.isArray(merged.badges) ? merged.badges : [];
    const badgeSet = new Set(serverBadges.map(b => typeof b === 'string' ? b : b.type));
    for (const badge of client.badges) {
      const key = typeof badge === 'string' ? badge : badge.type;
      if (!badgeSet.has(key)) {
        serverBadges.push(badge);
        badgeSet.add(key);
      }
    }
    merged.badges = serverBadges;
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

      // Backfill xp for existing players whose profile predates the field.
      // Derive a reasonable starting value from their existing progress so the
      // rank bar isn't artificially zeroed out on first load post-deploy.
      // Formula: 100 per campaign boss defeated + 25 per non-first-kill win + 25 per best streak.
      if (typeof profile.xp !== 'number') {
        const derivedXp =
          (profile.highestBoss || 0) * 100 +
          Math.max(0, (profile.totalWins || 0) - (profile.highestBoss || 0)) * 25 +
          (profile.bestStreak || 0) * 25;
        profile.xp = derivedXp;
        await uploadJsonBlob(containerClient, profilePath, profile);
        context.log(`[Blindspot] Backfilled xp to ${derivedXp} for user ${userId} (boss=${profile.highestBoss}, wins=${profile.totalWins}, streak=${profile.bestStreak})`);
      }

      // Backfill peakRank for existing players who don't have it yet
      if ((!profile.peakRank || profile.peakRank === 'Iron') && (profile.pvpElo || 0) >= 900) {
        const PVP_RANK_THRESHOLDS = [
          { name: 'Iron', min: 0 }, { name: 'Bronze', min: 900 }, { name: 'Silver', min: 1100 },
          { name: 'Gold', min: 1300 }, { name: 'Platinum', min: 1500 }, { name: 'Diamond', min: 1700 }
        ];
        let derived = 'Iron';
        for (let i = PVP_RANK_THRESHOLDS.length - 1; i >= 0; i--) {
          if (profile.pvpElo >= PVP_RANK_THRESHOLDS[i].min) {
            derived = PVP_RANK_THRESHOLDS[i].name;
            break;
          }
        }
        if (derived !== 'Iron') {
          profile.peakRank = derived;
          await uploadJsonBlob(containerClient, profilePath, profile);
          context.log(`[Blindspot] Backfilled peakRank to ${derived} for user ${userId} (Elo: ${profile.pvpElo})`);
        }
      }

      const derived = deriveLevelFields(profile.xp);
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { profile, isNew, level: derived.level, tier: derived.tier, xpToNext: derived.xpToNext }
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
      } else if (action === 'selectCard') {
        const { cardId } = body;
        if (!cardId) {
          context.res = {
            status: 400,
            headers: CORS_HEADERS,
            body: { error: 'cardId is required for selectCard' }
          };
          return;
        }
        let serverProfile = await downloadJsonBlob(containerClient, profilePath, context);
        if (!serverProfile) {
          serverProfile = createDefaultProfile(userId);
        }
        serverProfile.selectedCardId = cardId;
        serverProfile.userId = userId;
        await uploadJsonBlob(containerClient, profilePath, serverProfile);
        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, profile: serverProfile }
        };
      } else if (action === 'setProfileImage') {
        // Accepts { profileImage: '<url>', profileImageTransform: {scale,posX,posY} }.
        // Empty string is valid (clears back to card avatar fallback).
        // Transform is optional; missing = defaults persisted earlier.
        const incoming = body.profileImage;
        if (typeof incoming !== 'string') {
          context.res = {
            status: 400,
            headers: CORS_HEADERS,
            body: { error: 'profileImage must be a string' }
          };
          return;
        }
        if (incoming.length > 2048) {
          context.res = {
            status: 400,
            headers: CORS_HEADERS,
            body: { error: 'profileImage URL exceeds 2048 chars' }
          };
          return;
        }
        let serverProfile = await downloadJsonBlob(containerClient, profilePath, context);
        if (!serverProfile) {
          serverProfile = createDefaultProfile(userId);
        }
        serverProfile.profileImage = incoming.trim();
        // Validate + clamp the optional transform. Out-of-range
        // values are silently clamped rather than 400'd because the
        // client UI already enforces the same bounds; the server is
        // a defense-in-depth layer, not a validator that needs to
        // teach the client about its mistakes.
        if (body.profileImageTransform && typeof body.profileImageTransform === 'object') {
          const t = body.profileImageTransform;
          const scale = Math.max(1, Math.min(3, Number(t.scale) || 1));
          const posX = Math.max(0, Math.min(100, Number(t.posX)));
          const posY = Math.max(0, Math.min(100, Number(t.posY)));
          serverProfile.profileImageTransform = {
            scale: scale,
            posX: isFinite(posX) ? posX : 50,
            posY: isFinite(posY) ? posY : 50
          };
        }
        serverProfile.userId = userId;
        await uploadJsonBlob(containerClient, profilePath, serverProfile);
        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: { success: true, profile: serverProfile }
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
