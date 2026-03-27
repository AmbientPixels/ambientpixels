/**
 * cardforge-challenger — Tier 2 Challenger Mode (copy transfer)
 *
 * Actions: post, accept, decline, rematch
 * Single endpoint, action-routed (matches blindspotasyncbattle pattern).
 */

const { BlobServiceClient } = require('@azure/storage-blob');
const { isWithinRankRange } = require('../_utils/pvpRanks');
const { resolveWagerMatch } = require('../_utils/wagerResolve');

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
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', message: 'CardForge Challenger service is online' } };
    return;
  }
  if (req.method !== 'POST') { context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } }; return; }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) { context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Sign in to use Challenger mode' } }; return; }

  const body = req.body || {};
  const { action } = body;
  const blobServiceClient = await createBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  try {
    if (action === 'post') {
      await handlePost(context, containerClient, userId, body);
    } else if (action === 'accept') {
      await handleAccept(context, containerClient, userId, body);
    } else if (action === 'decline') {
      await handleDecline(context, containerClient, userId, body);
    } else if (action === 'rematch') {
      await handleRematch(context, containerClient, userId, body);
    } else {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Unknown action: ' + action } };
    }
  } catch (err) {
    context.log.error(`[Challenger] Error: ${err.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: err.message } };
  }
};

// ── POST: Create a direct Challenger challenge ──

async function handlePost(context, containerClient, userId, body) {
  const { cardId, targetUserId } = body;
  if (!cardId || !targetUserId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'cardId and targetUserId are required' } };
    return;
  }
  if (targetUserId === userId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot challenge yourself' } };
    return;
  }

  // Load both profiles for rank check
  const myProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`) || { peakRank: 'Iron', activeWagers: [] };
  const targetProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${targetUserId}.json`);
  if (!targetProfile) {
    context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Target player not found' } };
    return;
  }

  // Rank gate
  if (!isWithinRankRange(myProfile.peakRank || 'Iron', targetProfile.peakRank || 'Iron')) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Rank mismatch — Challenger requires matched opponents (±1 rank)' } };
    return;
  }

  // Concurrent wager limit
  const activeWagers = Array.isArray(myProfile.activeWagers) ? myProfile.activeWagers : [];
  if (activeWagers.length >= MAX_ACTIVE_WAGERS) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Too many active wagers. Complete or cancel one first.' } };
    return;
  }

  // Validate card
  const cardsData = await downloadJsonBlob(containerClient, `user/${userId}/cards.json`);
  const cards = loadCards(cardsData);
  const card = cards.find(c => c.id === cardId);
  if (!card) {
    context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found in your collection' } };
    return;
  }
  if (card.inActiveWager) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Card is already in an active wager' } };
    return;
  }
  const lockedCards = Array.isArray(myProfile.lockedCards) ? myProfile.lockedCards : [];
  if (lockedCards.includes(cardId)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot wager a locked card' } };
    return;
  }

  // Set inActiveWager flag on card
  card.inActiveWager = true;
  await uploadJsonBlob(containerClient, `user/${userId}/cards.json`, { cards, lastUpdated: new Date().toISOString() });

  // Create wager record
  const wagerId = 'wager-' + Date.now() + '-' + Math.random().toString(36).substr(2, 8);
  const now = new Date().toISOString();
  const wager = {
    wagerId,
    tier: 'challenger',
    matchmakingRank: myProfile.peakRank || 'Iron',
    playerA: { userId, cardId, snapshot: JSON.parse(JSON.stringify(card)) },
    playerB: { userId: targetUserId, cardId: null, snapshot: null },
    seriesRecord: [null],
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    lastActivityAt: now,
    winnerId: null,
    transferComplete: false,
    isRematch: false,
    transferLog: [{ event: 'challenge_posted', by: userId, ts: now }]
  };
  await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

  // Add to poster's activeWagers
  if (!Array.isArray(myProfile.activeWagers)) myProfile.activeWagers = [];
  myProfile.activeWagers.push(wagerId);
  await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, myProfile);

  // Inbox-notify target
  const inboxPath = `blindspot/asyncResults/${targetUserId}.json`;
  let inbox = await downloadJsonBlob(containerClient, inboxPath);
  if (!Array.isArray(inbox)) inbox = [];
  inbox.unshift({
    id: 'ci-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
    type: 'challenger_invite',
    wagerId,
    challengerName: card.name || 'Unknown',
    challengerUserId: userId,
    cardPreview: { name: card.name, rarity: card.rarity, class: card.class || card.characterClass },
    read: false,
    timestamp: now
  });
  if (inbox.length > 50) inbox = inbox.slice(0, 50);
  await uploadJsonBlob(containerClient, inboxPath, inbox);

  context.log(`[Challenger] Challenge posted: ${wagerId} by ${userId} targeting ${targetUserId}`);
  context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, wagerId } };
}

// ── ACCEPT: Accept a Challenger challenge ──

async function handleAccept(context, containerClient, userId, body) {
  const { wagerId, cardId } = body;
  if (!wagerId || !cardId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'wagerId and cardId are required' } };
    return;
  }

  const wager = await downloadJsonBlob(containerClient, `wagers/${wagerId}.json`);
  if (!wager) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Wager not found' } }; return; }
  if (wager.status !== 'pending') { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Wager is not pending' } }; return; }
  if (wager.playerB.userId !== userId) { context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This challenge is not for you' } }; return; }

  // Check expiry
  if (new Date(wager.expiresAt).getTime() < Date.now()) {
    // Auto-expire
    wager.status = 'expired';
    await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);
    // Clear poster's card flag
    await clearCardWagerFlag(containerClient, wager.playerA.userId, wager.playerA.cardId);
    await removeActiveWager(containerClient, wager.playerA.userId, wagerId);
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Challenge has expired' } };
    return;
  }

  // Rank gate
  const myProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`) || { peakRank: 'Iron', activeWagers: [] };
  if (!isWithinRankRange(myProfile.peakRank || 'Iron', wager.matchmakingRank)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Rank mismatch — you are out of range for this challenge' } };
    return;
  }

  // Concurrent wager limit on accept
  const activeWagers = Array.isArray(myProfile.activeWagers) ? myProfile.activeWagers : [];
  if (activeWagers.length >= MAX_ACTIVE_WAGERS) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Too many active wagers. Complete or cancel one first.' } };
    return;
  }

  // Validate acceptor's card
  const cardsData = await downloadJsonBlob(containerClient, `user/${userId}/cards.json`);
  const cards = loadCards(cardsData);
  const card = cards.find(c => c.id === cardId);
  if (!card) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found' } }; return; }
  if (card.inActiveWager) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Card is already in a wager' } }; return; }
  const lockedCards = Array.isArray(myProfile.lockedCards) ? myProfile.lockedCards : [];
  if (lockedCards.includes(cardId)) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot wager a locked card' } }; return; }

  // Set inActiveWager on acceptor's card
  card.inActiveWager = true;
  await uploadJsonBlob(containerClient, `user/${userId}/cards.json`, { cards, lastUpdated: new Date().toISOString() });

  // Update wager
  const now = new Date().toISOString();
  wager.playerB.cardId = cardId;
  wager.playerB.snapshot = JSON.parse(JSON.stringify(card));
  wager.status = 'active';
  wager.lastActivityAt = now;
  wager.transferLog.push({ event: 'accepted', by: userId, ts: now });

  // Create async battle — challenger (playerA) is always attacker for Bo1
  const battleId = 'bs-async-' + Date.now() + '-' + Math.random().toString(36).substr(2, 8);
  wager.currentBattleId = battleId;

  await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

  // Add to acceptor's activeWagers
  if (!Array.isArray(myProfile.activeWagers)) myProfile.activeWagers = [];
  myProfile.activeWagers.push(wagerId);
  await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, myProfile);

  context.log(`[Challenger] Challenge accepted: ${wagerId} by ${userId} with card ${cardId}`);
  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: {
      success: true,
      wagerId,
      battleId,
      wager: {
        tier: wager.tier,
        playerA: { userId: wager.playerA.userId, cardName: wager.playerA.snapshot.name },
        playerB: { userId: wager.playerB.userId, cardName: wager.playerB.snapshot.name },
        status: 'active'
      }
    }
  };
}

// ── DECLINE: Decline a Challenger challenge ──

async function handleDecline(context, containerClient, userId, body) {
  const { wagerId } = body;
  if (!wagerId) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'wagerId is required' } }; return; }

  const wager = await downloadJsonBlob(containerClient, `wagers/${wagerId}.json`);
  if (!wager) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Wager not found' } }; return; }
  if (wager.playerB.userId !== userId) { context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This challenge is not for you' } }; return; }
  if (wager.status !== 'pending') { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Wager is not pending' } }; return; }

  // Rematch guard: cannot decline rematch challenges
  if (wager.isRematch) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Rematch challenges cannot be declined' } };
    return;
  }

  // Clear poster's card wager flag
  await clearCardWagerFlag(containerClient, wager.playerA.userId, wager.playerA.cardId);
  await removeActiveWager(containerClient, wager.playerA.userId, wagerId);

  wager.status = 'expired';
  wager.transferLog.push({ event: 'declined', by: userId, ts: new Date().toISOString() });
  await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

  // Notify poster
  const inboxPath = `blindspot/asyncResults/${wager.playerA.userId}.json`;
  let inbox = await downloadJsonBlob(containerClient, inboxPath);
  if (!Array.isArray(inbox)) inbox = [];
  inbox.unshift({
    id: 'cd-' + Date.now(),
    type: 'challenger_declined',
    wagerId,
    declinedBy: userId,
    read: false,
    timestamp: new Date().toISOString()
  });
  if (inbox.length > 50) inbox = inbox.slice(0, 50);
  await uploadJsonBlob(containerClient, inboxPath, inbox);

  context.log(`[Challenger] Challenge declined: ${wagerId} by ${userId}`);
  context.res = { status: 200, headers: CORS_HEADERS, body: { success: true } };
}

// ── REMATCH: Use rematch token ──

async function handleRematch(context, containerClient, userId, body) {
  const { wagerId: originalWagerId, cardId } = body;
  if (!originalWagerId || !cardId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'wagerId (original) and cardId are required' } };
    return;
  }

  // Validate rematch token
  const myProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`);
  if (!myProfile) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Profile not found' } }; return; }

  const tokens = Array.isArray(myProfile.rematchTokens) ? myProfile.rematchTokens : [];
  const tokenIndex = tokens.findIndex(t => t.wagerId === originalWagerId);
  if (tokenIndex === -1) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'No rematch token found for this wager' } };
    return;
  }
  const token = tokens[tokenIndex];
  if (new Date(token.expiresAt).getTime() < Date.now()) {
    // Remove expired token
    tokens.splice(tokenIndex, 1);
    await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, myProfile);
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Rematch token has expired' } };
    return;
  }

  const targetUserId = token.opponentId;

  // Concurrent wager limit
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

  // Consume rematch token
  tokens.splice(tokenIndex, 1);

  // Create rematch wager
  const newWagerId = 'wager-' + Date.now() + '-' + Math.random().toString(36).substr(2, 8);
  const now = new Date().toISOString();
  const wager = {
    wagerId: newWagerId,
    tier: 'challenger',
    matchmakingRank: myProfile.peakRank || 'Iron',
    playerA: { userId, cardId, snapshot: JSON.parse(JSON.stringify(card)) },
    playerB: { userId: targetUserId, cardId: null, snapshot: null },
    seriesRecord: [null],
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    lastActivityAt: now,
    winnerId: null,
    transferComplete: false,
    isRematch: true,
    originalWagerId,
    transferLog: [{ event: 'rematch_posted', by: userId, ts: now }]
  };
  await uploadJsonBlob(containerClient, `wagers/${newWagerId}.json`, wager);

  // Add to poster's activeWagers
  if (!Array.isArray(myProfile.activeWagers)) myProfile.activeWagers = [];
  myProfile.activeWagers.push(newWagerId);
  await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, myProfile);

  // Inbox-notify target (cannot decline)
  const inboxPath = `blindspot/asyncResults/${targetUserId}.json`;
  let inbox = await downloadJsonBlob(containerClient, inboxPath);
  if (!Array.isArray(inbox)) inbox = [];
  inbox.unshift({
    id: 'rm-' + Date.now(),
    type: 'challenger_invite',
    wagerId: newWagerId,
    challengerName: card.name || 'Unknown',
    challengerUserId: userId,
    isRematch: true,
    cannotDecline: true,
    read: false,
    timestamp: now
  });
  if (inbox.length > 50) inbox = inbox.slice(0, 50);
  await uploadJsonBlob(containerClient, inboxPath, inbox);

  context.log(`[Challenger] Rematch posted: ${newWagerId} by ${userId} targeting ${targetUserId}`);
  context.res = { status: 200, headers: CORS_HEADERS, body: { success: true, wagerId: newWagerId } };
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
