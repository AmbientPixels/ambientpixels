/**
 * wagerResolve.js — Shared wager resolution logic
 *
 * Called from:
 *   - blindspotasyncbattle finalize (when battle has wagerId)
 *   - lazy expiry checks (inactivity/7-day cap)
 *
 * Handles both Challenger (copy transfer) and Skull Ante (real transfer).
 */

const { getPvpRankName } = require('./pvpRanks');

/**
 * Resolve a wager match result.
 *
 * @param {string} wagerId
 * @param {string|null} winnerId - userId of winner, null only for draws
 * @param {object} containerClient - Azure Blob container client
 * @param {object} context - Azure Function context (for logging)
 * @param {string} reason - 'match_complete' | 'inactivity_forfeit' | '7day_cap' | 'draw'
 * @returns {object} resolution result
 */
async function resolveWagerMatch(wagerId, winnerId, containerClient, context, reason) {
  const wager = await downloadJsonBlob(containerClient, `wagers/${wagerId}.json`);
  if (!wager) {
    context.log.warn(`[WagerResolve] Wager ${wagerId} not found`);
    return { resolved: false, error: 'Wager not found' };
  }

  if (wager.status === 'complete' || wager.status === 'draw' || wager.status === 'expired') {
    context.log.warn(`[WagerResolve] Wager ${wagerId} already resolved (${wager.status})`);
    return { resolved: false, error: 'Already resolved' };
  }

  // Add to transfer log
  if (!wager.transferLog) wager.transferLog = [];
  wager.transferLog.push({ event: reason, winnerId, ts: new Date().toISOString() });

  // ── Draw: return both cards, no transfer ──
  if (reason === 'draw' || winnerId === null) {
    await clearWagerFlags(containerClient, wager, context);
    wager.status = 'draw';
    wager.transferLog.push({ event: 'draw_resolved', ts: new Date().toISOString() });
    await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

    // Inbox both players
    await writeInboxResult(containerClient, wager.playerA.userId, {
      type: 'wager_draw',
      tier: wager.tier,
      wagerId,
      opponentName: wager.playerB.snapshot ? wager.playerB.snapshot.name : 'Unknown',
      message: 'Series ended in a draw. Your card has been returned.',
      timestamp: new Date().toISOString()
    });
    await writeInboxResult(containerClient, wager.playerB.userId, {
      type: 'wager_draw',
      tier: wager.tier,
      wagerId,
      opponentName: wager.playerA.snapshot ? wager.playerA.snapshot.name : 'Unknown',
      message: 'Series ended in a draw. Your card has been returned.',
      timestamp: new Date().toISOString()
    });

    context.log(`[WagerResolve] Wager ${wagerId} resolved as draw`);
    return { resolved: true, outcome: 'draw' };
  }

  // ── Determine winner/loser ──
  const loserId = winnerId === wager.playerA.userId ? wager.playerB.userId : wager.playerA.userId;
  const winnerSide = winnerId === wager.playerA.userId ? 'playerA' : 'playerB';
  const loserSide = winnerSide === 'playerA' ? 'playerB' : 'playerA';
  const loserCardId = wager[loserSide].cardId;
  const winnerCardId = wager[winnerSide].cardId;

  if (wager.tier === 'challenger') {
    // ── Challenger: copy transfer ──
    await handleChallengerTransfer(containerClient, wager, winnerId, loserId, loserSide, context);
  } else if (wager.tier === 'skull') {
    // ── Skull Ante: real permanent transfer ──
    await handleSkullTransfer(containerClient, wager, winnerId, loserId, loserSide, winnerSide, context);
  }

  // ── Clear wager flags ──
  await clearWagerFlags(containerClient, wager, context);

  // ── Update wager record ──
  wager.status = 'complete';
  wager.winnerId = winnerId;
  wager.transferComplete = true;
  wager.transferLog.push({ event: 'transfer_complete', from: loserId, to: winnerId, ts: new Date().toISOString() });
  await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

  context.log(`[WagerResolve] Wager ${wagerId} (${wager.tier}) resolved — winner: ${winnerId}, reason: ${reason}`);
  return { resolved: true, outcome: 'win', winnerId, loserId, tier: wager.tier };
}

/**
 * Handle Challenger mode copy transfer
 */
async function handleChallengerTransfer(containerClient, wager, winnerId, loserId, loserSide, context) {
  const wagerId = wager.wagerId;
  const loserSnapshot = wager[loserSide].snapshot;
  if (!loserSnapshot) {
    context.log.warn(`[WagerResolve] No snapshot for loser in wager ${wagerId}`);
    return;
  }

  // Clone card with new ID
  const copiedCard = Object.assign({}, loserSnapshot, {
    id: 'copy-' + loserSnapshot.id + '-' + Date.now(),
    isCopy: true,
    copiedFrom: { userId: loserId, cardName: loserSnapshot.name || 'Unknown', wagerId }
  });
  // Ensure cardData also gets the new id
  if (copiedCard.cardData) {
    copiedCard.cardData = Object.assign({}, copiedCard.cardData);
  }

  // Add copy to winner's collection
  const winnerCardsPath = `user/${winnerId}/cards.json`;
  const winnerCardsData = await downloadJsonBlob(containerClient, winnerCardsPath);
  let winnerCards = [];
  if (Array.isArray(winnerCardsData)) {
    winnerCards = winnerCardsData;
  } else if (winnerCardsData && Array.isArray(winnerCardsData.cards)) {
    winnerCards = winnerCardsData.cards;
  }
  winnerCards.push(copiedCard);
  await uploadJsonBlob(containerClient, winnerCardsPath, { cards: winnerCards, lastUpdated: new Date().toISOString() });

  // Award challenger_win badge to winner
  await awardBadge(containerClient, winnerId, 'challenger_win', context);

  // Create rematch token on loser's profile
  const loserProfilePath = `blindspot/profiles/${loserId}.json`;
  const loserProfile = await downloadJsonBlob(containerClient, loserProfilePath);
  if (loserProfile) {
    if (!Array.isArray(loserProfile.rematchTokens)) loserProfile.rematchTokens = [];
    loserProfile.rematchTokens.push({
      wagerId,
      opponentId: winnerId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    await uploadJsonBlob(containerClient, loserProfilePath, loserProfile);
  }

  // Inbox results
  await writeInboxResult(containerClient, winnerId, {
    type: 'challenger_win',
    wagerId,
    cardWon: { id: copiedCard.id, name: copiedCard.name },
    opponentName: loserSnapshot.name || 'Unknown',
    timestamp: new Date().toISOString()
  });
  await writeInboxResult(containerClient, loserId, {
    type: 'challenger_loss',
    wagerId,
    cardCopied: { name: loserSnapshot.name || 'Unknown' },
    opponentName: wager[winnerId === wager.playerA.userId ? 'playerA' : 'playerB'].snapshot.name || 'Unknown',
    hasRematchToken: true,
    timestamp: new Date().toISOString()
  });

  context.log(`[WagerResolve] Challenger copy transfer: ${loserSnapshot.name} copied to ${winnerId}`);
}

/**
 * Handle Skull Ante permanent card transfer (As-Is Rule)
 */
async function handleSkullTransfer(containerClient, wager, winnerId, loserId, loserSide, winnerSide, context) {
  const wagerId = wager.wagerId;
  const loserCardId = wager[loserSide].cardId;

  // Remove card from loser's collection (live state = As-Is Rule)
  const loserCardsPath = `user/${loserId}/cards.json`;
  const loserCardsData = await downloadJsonBlob(containerClient, loserCardsPath);
  let loserCards = [];
  if (Array.isArray(loserCardsData)) {
    loserCards = loserCardsData;
  } else if (loserCardsData && Array.isArray(loserCardsData.cards)) {
    loserCards = loserCardsData.cards;
  }

  const cardIndex = loserCards.findIndex(c => c.id === loserCardId);
  let transferredCard = null;
  if (cardIndex !== -1) {
    transferredCard = loserCards.splice(cardIndex, 1)[0];
    // Clean wager flag before transfer
    delete transferredCard.inActiveWager;
    await uploadJsonBlob(containerClient, loserCardsPath, { cards: loserCards, lastUpdated: new Date().toISOString() });
  } else {
    // Card not found — use snapshot as fallback
    context.log.warn(`[WagerResolve] Card ${loserCardId} not found in loser collection, using snapshot`);
    transferredCard = wager[loserSide].snapshot;
  }

  // Add card to winner's collection
  if (transferredCard) {
    const winnerCardsPath = `user/${winnerId}/cards.json`;
    const winnerCardsData = await downloadJsonBlob(containerClient, winnerCardsPath);
    let winnerCards = [];
    if (Array.isArray(winnerCardsData)) {
      winnerCards = winnerCardsData;
    } else if (winnerCardsData && Array.isArray(winnerCardsData.cards)) {
      winnerCards = winnerCardsData.cards;
    }
    winnerCards.push(transferredCard);
    await uploadJsonBlob(containerClient, winnerCardsPath, { cards: winnerCards, lastUpdated: new Date().toISOString() });
  }

  // Remove from published gallery if present
  try {
    const publishedData = await downloadJsonBlob(containerClient, 'published-cards.json');
    if (publishedData && Array.isArray(publishedData.publishedCards)) {
      const before = publishedData.publishedCards.length;
      publishedData.publishedCards = publishedData.publishedCards.filter(c => c.id !== loserCardId);
      if (publishedData.publishedCards.length < before) {
        await uploadJsonBlob(containerClient, 'published-cards.json', publishedData);
      }
    }
  } catch (e) { /* non-critical */ }

  // ── Badges and stats ──
  const winnerProfilePath = `blindspot/profiles/${winnerId}.json`;
  const loserProfilePath = `blindspot/profiles/${loserId}.json`;
  const winnerProfile = await downloadJsonBlob(containerClient, winnerProfilePath);
  const loserProfile = await downloadJsonBlob(containerClient, loserProfilePath);

  // Determine series record for badge logic
  const seriesRecord = wager.seriesRecord || [];
  const winnerWins = seriesRecord.filter(r => r === winnerSide).length;
  const loserWins = seriesRecord.filter(r => r === loserSide).length;
  const isSweep = winnerWins >= 2 && loserWins === 0; // 2-0 or 3-0
  const isComeback = loserWins >= 2 && winnerWins >= 2; // came from behind — not applicable in Bo3
  // Actually in Bo3: comeback = winner lost first match but won matches 2 and 3
  const match1Winner = seriesRecord[0];
  const isRealComeback = match1Winner === loserSide && winnerWins === 2;

  if (winnerProfile) {
    winnerProfile.trophyKills = (winnerProfile.trophyKills || 0) + 1;
    if (!Array.isArray(winnerProfile.badges)) winnerProfile.badges = [];
    if (isSweep && !winnerProfile.badges.find(b => b.type === 'skull_executioner')) {
      winnerProfile.badges.push({ type: 'skull_executioner', earnedAt: new Date().toISOString() });
    }
    if (isRealComeback && !winnerProfile.badges.find(b => b.type === 'skull_resurrect')) {
      winnerProfile.badges.push({ type: 'skull_resurrect', earnedAt: new Date().toISOString() });
    }
    await uploadJsonBlob(containerClient, winnerProfilePath, winnerProfile);
  }

  if (loserProfile) {
    loserProfile.scars = (loserProfile.scars || 0) + 1;
    if (!Array.isArray(loserProfile.badges)) loserProfile.badges = [];
    if (!loserProfile.badges.find(b => b.type === 'skull_scar')) {
      loserProfile.badges.push({ type: 'skull_scar', earnedAt: new Date().toISOString() });
    }
    await uploadJsonBlob(containerClient, loserProfilePath, loserProfile);
  }

  // Inbox results
  const cardName = transferredCard ? transferredCard.name : 'Unknown';
  await writeInboxResult(containerClient, winnerId, {
    type: 'skull_win',
    wagerId,
    cardWon: { id: loserCardId, name: cardName },
    opponentName: wager[loserSide].snapshot ? wager[loserSide].snapshot.name : 'Unknown',
    seriesRecord: seriesRecord.join('-'),
    timestamp: new Date().toISOString()
  });
  await writeInboxResult(containerClient, loserId, {
    type: 'skull_loss',
    wagerId,
    cardLost: { id: loserCardId, name: cardName },
    opponentName: wager[winnerSide].snapshot ? wager[winnerSide].snapshot.name : 'Unknown',
    seriesRecord: seriesRecord.join('-'),
    timestamp: new Date().toISOString()
  });

  context.log(`[WagerResolve] Skull transfer: ${cardName} (${loserCardId}) from ${loserId} to ${winnerId}`);
}

/**
 * Process a single match result within a skull ante series.
 * Returns { seriesComplete, winner, nextBattleNeeded }
 */
async function processSkullMatchResult(wagerId, matchWinnerId, containerClient, context) {
  const wager = await downloadJsonBlob(containerClient, `wagers/${wagerId}.json`);
  if (!wager || wager.status !== 'active') {
    return { error: 'Wager not active' };
  }

  const winnerSide = matchWinnerId === wager.playerA.userId ? 'playerA' : 'playerB';
  const currentIndex = wager.currentMatchIndex || 0;

  // Record result
  wager.seriesRecord[currentIndex] = winnerSide;
  wager.lastActivityAt = new Date().toISOString();
  wager.transferLog = wager.transferLog || [];
  wager.transferLog.push({
    event: 'match' + (currentIndex + 1) + '_complete',
    winner: winnerSide,
    ts: new Date().toISOString()
  });

  // After Match 1, set Match 3 attacker = loser of Match 1 (underdog gets the wheel)
  if (currentIndex === 0 && wager.attackerOrder) {
    const match1Loser = winnerSide === 'playerA' ? 'playerB' : 'playerA';
    wager.attackerOrder[2] = match1Loser;
  }

  // Count wins
  const aWins = wager.seriesRecord.filter(r => r === 'playerA').length;
  const bWins = wager.seriesRecord.filter(r => r === 'playerB').length;

  if (aWins >= 2 || bWins >= 2) {
    // Series complete — trigger full resolution
    const seriesWinnerId = aWins >= 2 ? wager.playerA.userId : wager.playerB.userId;
    await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);
    const result = await resolveWagerMatch(wagerId, seriesWinnerId, containerClient, context, 'match_complete');
    return { seriesComplete: true, winner: seriesWinnerId, result };
  }

  // Series continues — prepare next match
  wager.currentMatchIndex = currentIndex + 1;
  await uploadJsonBlob(containerClient, `wagers/${wagerId}.json`, wager);

  return {
    seriesComplete: false,
    seriesRecord: wager.seriesRecord,
    nextMatchIndex: currentIndex + 1,
    nextAttacker: wager.attackerOrder ? wager.attackerOrder[currentIndex + 1] : null
  };
}

// ── Helpers ──

async function clearWagerFlags(containerClient, wager, context) {
  // Clear inActiveWager on both players' cards
  for (const side of ['playerA', 'playerB']) {
    if (!wager[side] || !wager[side].userId || !wager[side].cardId) continue;
    try {
      const cardsPath = `user/${wager[side].userId}/cards.json`;
      const cardsData = await downloadJsonBlob(containerClient, cardsPath);
      let cards = [];
      if (Array.isArray(cardsData)) cards = cardsData;
      else if (cardsData && Array.isArray(cardsData.cards)) cards = cardsData.cards;

      const card = cards.find(c => c.id === wager[side].cardId);
      if (card && card.inActiveWager) {
        delete card.inActiveWager;
        await uploadJsonBlob(containerClient, cardsPath, { cards, lastUpdated: new Date().toISOString() });
      }
    } catch (e) {
      context.log.warn(`[WagerResolve] Could not clear wager flag for ${side}: ${e.message}`);
    }
  }

  // Remove wagerId from both players' activeWagers
  for (const side of ['playerA', 'playerB']) {
    if (!wager[side] || !wager[side].userId) continue;
    try {
      const profilePath = `blindspot/profiles/${wager[side].userId}.json`;
      const profile = await downloadJsonBlob(containerClient, profilePath);
      if (profile && Array.isArray(profile.activeWagers)) {
        const before = profile.activeWagers.length;
        profile.activeWagers = profile.activeWagers.filter(id => id !== wager.wagerId);
        if (profile.activeWagers.length < before) {
          await uploadJsonBlob(containerClient, profilePath, profile);
        }
      }
    } catch (e) {
      context.log.warn(`[WagerResolve] Could not remove activeWager for ${side}: ${e.message}`);
    }
  }
}

async function awardBadge(containerClient, userId, badgeType, context) {
  try {
    const profilePath = `blindspot/profiles/${userId}.json`;
    const profile = await downloadJsonBlob(containerClient, profilePath);
    if (!profile) return;
    if (!Array.isArray(profile.badges)) profile.badges = [];
    if (!profile.badges.find(b => b.type === badgeType)) {
      profile.badges.push({ type: badgeType, earnedAt: new Date().toISOString() });
      await uploadJsonBlob(containerClient, profilePath, profile);
    }
  } catch (e) {
    context.log.warn(`[WagerResolve] Could not award badge ${badgeType} to ${userId}: ${e.message}`);
  }
}

async function writeInboxResult(containerClient, userId, entry) {
  const inboxPath = `blindspot/asyncResults/${userId}.json`;
  let inbox = await downloadJsonBlob(containerClient, inboxPath);
  if (!Array.isArray(inbox)) inbox = [];

  entry.id = 'wr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  entry.read = false;
  inbox.unshift(entry);
  if (inbox.length > 50) inbox = inbox.slice(0, 50);

  await uploadJsonBlob(containerClient, inboxPath, inbox);
}

/**
 * Check active wagers for staleness (48hr inactivity or 7-day cap).
 * Called lazily from skull-ante and challenge-board endpoints.
 */
async function checkWagerStaleness(userId, containerClient, context) {
  const profilePath = `blindspot/profiles/${userId}.json`;
  const profile = await downloadJsonBlob(containerClient, profilePath);
  if (!profile || !Array.isArray(profile.activeWagers) || profile.activeWagers.length === 0) return;

  const now = Date.now();
  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  for (const wagerId of profile.activeWagers.slice()) {
    try {
      const wager = await downloadJsonBlob(containerClient, `wagers/${wagerId}.json`);
      if (!wager || wager.status !== 'active') continue;

      const lastActivity = new Date(wager.lastActivityAt || wager.createdAt).getTime();
      const created = new Date(wager.createdAt).getTime();

      // 7-day hard cap
      if (now - created > SEVEN_DAYS) {
        const aWins = (wager.seriesRecord || []).filter(r => r === 'playerA').length;
        const bWins = (wager.seriesRecord || []).filter(r => r === 'playerB').length;
        if (aWins === bWins) {
          await resolveWagerMatch(wagerId, null, containerClient, context, 'draw');
        } else {
          const leaderId = aWins > bWins ? wager.playerA.userId : wager.playerB.userId;
          await resolveWagerMatch(wagerId, leaderId, containerClient, context, '7day_cap');
        }
        continue;
      }

      // 48hr inactivity
      if (now - lastActivity > FORTY_EIGHT_HOURS) {
        // Forfeit the inactive player — the other player wins
        // Determine who was supposed to act next
        const currentAttacker = wager.attackerOrder ? wager.attackerOrder[wager.currentMatchIndex || 0] : 'playerA';
        const inactivePlayer = currentAttacker === 'playerA' ? wager.playerA.userId : wager.playerB.userId;
        const activePlayer = inactivePlayer === wager.playerA.userId ? wager.playerB.userId : wager.playerA.userId;
        await resolveWagerMatch(wagerId, activePlayer, containerClient, context, 'inactivity_forfeit');
      }
    } catch (e) {
      context.log.warn(`[WagerResolve] Staleness check error for wager ${wagerId}: ${e.message}`);
    }
  }
}

// ── Blob helpers (same pattern as other APIs) ──

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
  await blobClient.upload(content, Buffer.byteLength(content), {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

module.exports = {
  resolveWagerMatch,
  processSkullMatchResult,
  checkWagerStaleness,
  // Expose helpers for testing
  downloadJsonBlob,
  uploadJsonBlob,
  writeInboxResult
};
