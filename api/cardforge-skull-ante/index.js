/**
 * cardforge-skull-ante — Tier 3 Skull Ante Mode (permanent card transfer)
 *
 * Actions: post, accept, decline
 * Battle resolution handled via wagerId hook in blindspotasyncbattle → wagerResolve.
 */

const { BlobServiceClient } = require('@azure/storage-blob');
const { isWithinRankRange } = require('../_utils/pvpRanks');
const { checkWagerStaleness } = require('../_utils/wagerResolve');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const MAX_ACTIVE_WAGERS = 3;

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
      if (context && context.log) context.log.warn(`Failed to parse client principal: ${err.message}`);
    }
  }
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') return { userId: principalId, isAuthenticated: true };
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) { context.log(`[DEV AUTH] Using X-User-ID: ${devUserId}`); return { userId: devUserId, isAuthenticated: true }; }
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const { DefaultAzureCredential } = require('@azure/identity');
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, new DefaultAzureCredential());
}

async function downloadJsonBlob(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;
  const download = await blobClient.download(0);
  const chunks = [];
  for await (const chunk of download.readableStreamBody) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function uploadJsonBlob(containerClient, blobName, data) {
  const content = JSON.stringify(data, null, 2);
  const blobClient = containerClient.getBlockBlobClient(blobName);
  await blobClient.upload(content, Buffer.byteLength(content), { overwrite: true, blobHTTPHeaders: { blobContentType: 'application/json' } });
}

async function deleteBlob(containerClient, blobName) {
  try {
    const blobClient = containerClient.getBlockBlobClient(blobName);
    await blobClient.deleteIfExists();
  } catch (e) { /* non-critical */ }
}

function loadCards(cardsData) {
  if (Array.isArray(cardsData)) return cardsData;
  if (cardsData && Array.isArray(cardsData.cards)) return cardsData.cards;
  return [];
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS_HEADERS, body: '' }; return; }
  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  if (req.method === 'GET') {
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', message: 'CardForge Skull Ante service is online' } };
    return;
  }
  if (req.method !== 'POST') { context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } }; return; }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) { context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Sign in to use Skull Ante' } }; return; }

  const body = req.body || {};
  const { action } = body;
  const blobServiceClient = await createBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  // Lazy staleness check on every call
  try { await checkWagerStaleness(userId, containerClient, context); } catch (e) { context.log.warn(`[SkullAnte] Staleness check error: ${e.message}`); }

  try {
    if (action === 'post') {
      await handlePost(context, containerClient, userId, body);
    } else if (action === 'accept') {
      await handleAccept(context, containerClient, userId, body);
    } else if (action === 'decline') {
      await handleDecline(context, containerClient, userId, body);
    } else {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Unknown action: ' + action } };
    }
  } catch (err) {
    context.log.error(`[SkullAnte] Error: ${err.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: err.message } };
  }
};

// ── POST: Post open or direct Skull Ante challenge ──

async function handlePost(context, containerClient, userId, body) {
  const { cardId, challengeType, targetUserId } = body;
  if (!cardId) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'cardId is required' } }; return; }
  if (challengeType !== 'open' && challengeType !== 'direct') {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'challengeType must be "open" or "direct"' } };
    return;
  }
  if (challengeType === 'direct' && !targetUserId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'targetUserId required for direct challenges' } };
    return;
  }
  if (targetUserId === userId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot challenge yourself' } };
    return;
  }

  const myProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`) || { peakRank: 'Iron', activeWagers: [] };

  // Concurrent limit
  const activeWagers = Array.isArray(myProfile.activeWagers) ? myProfile.activeWagers : [];
  if (activeWagers.length >= MAX_ACTIVE_WAGERS) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Too many active wagers' } };
    return;
  }

  // Direct challenge: rank gate
  if (challengeType === 'direct') {
    const targetProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${targetUserId}.json`);
    if (!targetProfile) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Target player not found' } }; return; }
    if (!isWithinRankRange(myProfile.peakRank || 'Iron', targetProfile.peakRank || 'Iron')) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Rank mismatch — Skull Ante requires matched opponents (±1 rank)' } };
      return;
    }
  }

  // Validate card
  const cardsData = await downloadJsonBlob(containerClient, `user/${userId}/cards.json`);
  const cards = loadCards(cardsData);
  const card = cards.find(c => c.id === cardId);
  if (!card) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found' } }; return; }
  if (card.inActiveWager) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Card is already in a wager' } }; return; }
  const lockedCards = Array.isArray(myProfile.lockedCards) ? myProfile.lockedCards : [];
  if (lockedCards.includes(cardId)) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot wager a locked card' } }; return; }

  // Set inActiveWager
  card.inActiveWager = true;
  await uploadJsonBlob(containerClient, `user/${userId}/cards.json`, { cards, lastUpdated: new Date().toISOString() });

  // Create wager
  const wagerId = 'wager-' + Date.now() + '-' + Math.random().toString(36).substr(2, 8);
  const challengeId = 'skull-' + Date.now() + '-' + Math.random().toString(36).substr(2, 8);
  const now = new Date().toISOString();
  const expiryHours = challengeType === 'open' ? 48 : 24;
  const wager = {
    wagerId,
    challengeId,
    tier: 'skull',
    matchmakingRank: myProfile.peakRank || 'Iron',
    playerA: { userId, cardId, snapshot: JSON.parse(JSON.stringify(card)) },
    playerB: { userId: targetUserId || null, cardId: null, snapshot: null },
    seriesRecord: [null, null, null],
    attackerOrder: ['playerA', 'playerB', null], // Match 3 attacker set after Match 1
    currentMatchIndex: 0,
    currentBattleId: null,
    status: 'pending',
    challengeType,
    createdAt: now,
    expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
    lastActivityAt: now,
    winnerId: null,
    transferComplete: false,
    transferLog: [{ event: 'challenge_posted', by: userId, type: challengeType, ts: now }]
  };
  await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

  // Update poster's profile
  if (!Array.isArray(myProfile.activeWagers)) myProfile.activeWagers = [];
  myProfile.activeWagers.push(wagerId);
  await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, myProfile);

  if (challengeType === 'open') {
    // Write individual challenge blob (no contention)
    await uploadJsonBlob(containerClient, `skull-board/${challengeId}.json`, {
      challengeId,
      wagerId,
      challengerId: userId,
      peakRank: myProfile.peakRank || 'Iron',
      cardPreview: { name: card.name, rarity: card.rarity, class: card.class || card.characterClass, avatar: card.avatar },
      postedAt: now,
      expiresAt: wager.expiresAt
    });
  } else {
    // Direct: inbox-notify target
    const inboxPath = `blindspot/asyncResults/${targetUserId}.json`;
    let inbox = await downloadJsonBlob(containerClient, inboxPath);
    if (!Array.isArray(inbox)) inbox = [];
    inbox.unshift({
      id: 'sa-' + Date.now(),
      type: 'skull_ante_invite',
      wagerId,
      challengerName: card.name || 'Unknown',
      challengerUserId: userId,
      cardPreview: { name: card.name, rarity: card.rarity, class: card.class || card.characterClass },
      read: false,
      timestamp: now
    });
    if (inbox.length > 50) inbox = inbox.slice(0, 50);
    await uploadJsonBlob(containerClient, inboxPath, inbox);
  }

  context.log(`[SkullAnte] Challenge posted: ${wagerId} (${challengeType}) by ${userId}`);
  context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, wagerId, challengeId } };
}

// ── ACCEPT: Accept a Skull Ante challenge ──

async function handleAccept(context, containerClient, userId, body) {
  const { wagerId, cardId } = body;
  if (!wagerId || !cardId) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'wagerId and cardId required' } }; return; }

  const wager = await downloadJsonBlob(containerClient, `wagers/${wagerId}.json`);
  if (!wager) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Wager not found' } }; return; }
  if (wager.status !== 'pending') { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Challenge is not pending' } }; return; }
  if (wager.playerA.userId === userId) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot accept your own challenge' } }; return; }

  // For direct challenges, verify target
  if (wager.challengeType === 'direct' && wager.playerB.userId !== userId) {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This challenge is not for you' } };
    return;
  }

  // Check expiry
  if (new Date(wager.expiresAt).getTime() < Date.now()) {
    wager.status = 'expired';
    await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);
    await clearCardWagerFlag(containerClient, wager.playerA.userId, wager.playerA.cardId);
    await removeActiveWager(containerClient, wager.playerA.userId, wagerId);
    if (wager.challengeId) await deleteBlob(containerClient, `skull-board/${wager.challengeId}.json`);
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Challenge has expired' } };
    return;
  }

  // Rank gate
  const myProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`) || { peakRank: 'Iron', activeWagers: [] };
  if (!isWithinRankRange(myProfile.peakRank || 'Iron', wager.matchmakingRank)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Rank mismatch — you are out of range' } };
    return;
  }

  // Concurrent limit on accept
  const activeWagers = Array.isArray(myProfile.activeWagers) ? myProfile.activeWagers : [];
  if (activeWagers.length >= MAX_ACTIVE_WAGERS) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Too many active wagers' } };
    return;
  }

  // Validate card
  const cardsData = await downloadJsonBlob(containerClient, `user/${userId}/cards.json`);
  const cards = loadCards(cardsData);
  const card = cards.find(c => c.id === cardId);
  if (!card) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found' } }; return; }
  if (card.inActiveWager) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Card is in a wager' } }; return; }
  const lockedCards = Array.isArray(myProfile.lockedCards) ? myProfile.lockedCards : [];
  if (lockedCards.includes(cardId)) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot wager a locked card' } }; return; }

  // Set inActiveWager
  card.inActiveWager = true;
  await uploadJsonBlob(containerClient, `user/${userId}/cards.json`, { cards, lastUpdated: new Date().toISOString() });

  // Snapshot both cards
  const now = new Date().toISOString();
  wager.playerB.userId = userId;
  wager.playerB.cardId = cardId;
  wager.playerB.snapshot = JSON.parse(JSON.stringify(card));
  wager.status = 'active';
  wager.lastActivityAt = now;
  wager.transferLog.push({ event: 'accepted', by: userId, ts: now });

  // First battle: playerA (challenger) is attacker
  const battleId = 'bs-async-' + Date.now() + '-' + Math.random().toString(36).substr(2, 8);
  wager.currentBattleId = battleId;
  wager.currentMatchIndex = 0;

  await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

  // Remove from open challenge board if applicable
  if (wager.challengeId) {
    await deleteBlob(containerClient, `skull-board/${wager.challengeId}.json`);
  }

  // Add to acceptor's activeWagers
  if (!Array.isArray(myProfile.activeWagers)) myProfile.activeWagers = [];
  myProfile.activeWagers.push(wagerId);
  await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, myProfile);

  context.log(`[SkullAnte] Challenge accepted: ${wagerId} by ${userId}, series begins`);
  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: {
      success: true,
      wagerId,
      battleId,
      wager: {
        tier: 'skull',
        playerA: { userId: wager.playerA.userId, cardName: wager.playerA.snapshot.name },
        playerB: { userId: wager.playerB.userId, cardName: wager.playerB.snapshot.name },
        seriesRecord: wager.seriesRecord,
        status: 'active'
      }
    }
  };
}

// ── DECLINE: Decline a direct Skull Ante challenge ──

async function handleDecline(context, containerClient, userId, body) {
  const { wagerId } = body;
  if (!wagerId) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'wagerId required' } }; return; }

  const wager = await downloadJsonBlob(containerClient, `wagers/${wagerId}.json`);
  if (!wager) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Wager not found' } }; return; }
  if (wager.status !== 'pending') { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Challenge is not pending' } }; return; }

  // For direct challenges, only target can decline
  if (wager.challengeType === 'direct' && wager.playerB.userId !== userId) {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This challenge is not for you' } };
    return;
  }
  // For open challenges, only poster can cancel
  if (wager.challengeType === 'open' && wager.playerA.userId !== userId) {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Only the poster can cancel an open challenge' } };
    return;
  }

  // Clear poster's card
  await clearCardWagerFlag(containerClient, wager.playerA.userId, wager.playerA.cardId);
  await removeActiveWager(containerClient, wager.playerA.userId, wagerId);

  // Remove from board if open
  if (wager.challengeId) {
    await deleteBlob(containerClient, `skull-board/${wager.challengeId}.json`);
  }

  wager.status = 'expired';
  wager.transferLog.push({ event: 'declined', by: userId, ts: new Date().toISOString() });
  await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

  // Notify poster if declined by target
  if (userId !== wager.playerA.userId) {
    const inboxPath = `blindspot/asyncResults/${wager.playerA.userId}.json`;
    let inbox = await downloadJsonBlob(containerClient, inboxPath);
    if (!Array.isArray(inbox)) inbox = [];
    inbox.unshift({
      id: 'sd-' + Date.now(),
      type: 'skull_ante_declined',
      wagerId,
      declinedBy: userId,
      read: false,
      timestamp: new Date().toISOString()
    });
    if (inbox.length > 50) inbox = inbox.slice(0, 50);
    await uploadJsonBlob(containerClient, inboxPath, inbox);
  }

  context.log(`[SkullAnte] Challenge ${wagerId} declined/cancelled by ${userId}`);
  context.res = { status: 200, headers: CORS_HEADERS, body: { success: true } };
}

// ── Helpers ──

async function clearCardWagerFlag(containerClient, userId, cardId) {
  if (!userId || !cardId) return;
  try {
    const path = `user/${userId}/cards.json`;
    const data = await downloadJsonBlob(containerClient, path);
    const cards = loadCards(data);
    const card = cards.find(c => c.id === cardId);
    if (card && card.inActiveWager) {
      delete card.inActiveWager;
      await uploadJsonBlob(containerClient, path, { cards, lastUpdated: new Date().toISOString() });
    }
  } catch (e) { /* non-critical */ }
}

async function removeActiveWager(containerClient, userId, wagerId) {
  try {
    const profilePath = `blindspot/profiles/${userId}.json`;
    const profile = await downloadJsonBlob(containerClient, profilePath);
    if (profile && Array.isArray(profile.activeWagers)) {
      profile.activeWagers = profile.activeWagers.filter(id => id !== wagerId);
      await uploadJsonBlob(containerClient, profilePath, profile);
    }
  } catch (e) { /* non-critical */ }
}
