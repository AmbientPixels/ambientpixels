const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const path = require('path');
const fs = require('fs');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
};

// --- Shared helpers (same pattern as other cardforge APIs) ---

function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'];
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

async function deleteBlob(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (exists) await blobClient.delete();
}

// --- Load config files ---

let _configCache = null;
function loadArenaConfig() {
  if (_configCache) return _configCache;
  const configPath = path.resolve(__dirname, '../../cardforge/data/arena-config.json');
  _configCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return _configCache;
}

let _bossCache = null;
function loadBossData() {
  if (_bossCache) return _bossCache;
  const bossPath = path.resolve(__dirname, '../../cardforge/data/arena-bosses.json');
  _bossCache = JSON.parse(fs.readFileSync(bossPath, 'utf8'));
  return _bossCache;
}

// --- Battle engine ---

function mapCardToCombatStats(card) {
  const config = loadArenaConfig();
  const combat = { ...config.statDefaults };

  // New cards: use combatStats object directly
  if (card.combatStats && typeof card.combatStats === 'object') {
    for (const key of Object.keys(combat)) {
      if (card.combatStats[key] !== undefined) {
        combat[key] = Math.min(100, Math.max(1, Math.round(card.combatStats[key])));
      }
    }
    return combat;
  }

  // Legacy fallback: alias matching from stats array
  if (!card.stats || card.stats.length === 0) return combat;

  const maxVal = Math.max(...card.stats.map(s => s.value || 0));
  const scaleFactor = maxVal <= 10 ? 10 : 1;

  for (const [combatKey, aliases] of Object.entries(config.statAliases)) {
    const match = card.stats.find(s =>
      aliases.includes((s.name || '').toLowerCase().trim())
    );
    if (match) {
      combat[combatKey] = Math.min(100, Math.max(1, Math.round((match.value || 0) * scaleFactor)));
    }
  }

  return combat;
}

function computePassives(card) {
  const config = loadArenaConfig();
  const passives = [];

  if (!card.badges || card.badges.length === 0) return passives;

  for (const badge of card.badges) {
    const category = (badge.category || '').toLowerCase().trim();
    const passiveDef = config.badgePassives[category];
    if (!passiveDef) continue;

    const qty = badge.quantity || 1;
    const value = Math.min(passiveDef.valuePerQty * qty, passiveDef.maxValue);
    passives.push({
      source: `badge:${badge.category}`,
      effect: passiveDef.effect,
      value
    });
  }

  return passives;
}

function getPassiveValue(passives, effectName) {
  return passives
    .filter(p => p.effect === effectName)
    .reduce((sum, p) => sum + p.value, 0);
}

function computeMaxHp(combatStats) {
  return Math.round(50 + (combatStats.end * 0.8) + (combatStats.str * 0.2));
}

function generateBossMove(boss, round, currentHp, maxHp) {
  const config = loadArenaConfig();
  const pattern = config.aiPatterns[boss.arenaOverrides?.aiPattern || 'balanced'];
  let weights = { ...pattern };

  // Low HP override: boost guard
  if (currentHp / maxHp < config.aiLowHpThreshold) {
    weights.guard += config.aiLowHpGuardBoost;
  }

  const total = weights.strike + weights.guard + weights.ability;
  const roll = Math.random() * total;

  if (roll < weights.strike) return 'strike';
  if (roll < weights.strike + weights.guard) return 'guard';
  return 'ability';
}

function resolveRound(player, opponent, playerMove, opponentMove) {
  const events = [];

  // Speed check
  const playerSpeed = player.combatStats.agi + Math.random() * 10;
  const opponentSpeed = opponent.combatStats.agi + Math.random() * 10;
  const speedWinner = playerSpeed >= opponentSpeed ? 'player' : 'opponent';

  let playerDamageTaken = 0;
  let opponentDamageTaken = 0;
  let playerHeal = 0;
  let opponentHeal = 0;

  // Calculate player's action damage
  const playerCritChance = 5 + getPassiveValue(player.passives, 'crit_chance');
  const playerAbilityBonus = getPassiveValue(player.passives, 'ability_power');
  const playerStrBonus = getPassiveValue(player.passives, 'str_bonus');
  const playerIntBonus = getPassiveValue(player.passives, 'int_bonus');
  const opponentDmgReduction = getPassiveValue(opponent.passives, 'damage_reduction');

  const opponentCritChance = 5 + getPassiveValue(opponent.passives, 'crit_chance');
  const opponentAbilityBonus = getPassiveValue(opponent.passives, 'ability_power');
  const opponentStrBonus = getPassiveValue(opponent.passives, 'str_bonus');
  const opponentIntBonus = getPassiveValue(opponent.passives, 'int_bonus');
  const playerDmgReduction = getPassiveValue(player.passives, 'damage_reduction');

  // --- Player attacks opponent ---
  let playerOutDmg = 0;
  if (playerMove === 'strike') {
    const str = player.combatStats.str + playerStrBonus;
    playerOutDmg = str * 0.4 + Math.random() * (str * 0.1);
    const isCrit = Math.random() * 100 < playerCritChance;
    if (isCrit) {
      playerOutDmg *= 1.5;
      events.push('Your strike landed a critical hit!');
    }
    // Guard reduces strike by 60%
    if (opponentMove === 'guard') {
      playerOutDmg *= 0.4;
      events.push('Opponent braced for your strike.');
    }
    playerOutDmg = Math.max(1, Math.floor(playerOutDmg * (1 - opponentDmgReduction / 100)));
    opponentDamageTaken += playerOutDmg;
  } else if (playerMove === 'ability') {
    const int = player.combatStats.int + playerIntBonus;
    playerOutDmg = int * 0.5 + Math.random() * (int * 0.15) + playerAbilityBonus;
    // Ability beats strike (+30%)
    if (opponentMove === 'strike') {
      playerOutDmg *= 1.3;
      events.push('Your ability overpowered their strike!');
    }
    // Guard partially blocks ability (30%)
    if (opponentMove === 'guard') {
      playerOutDmg *= 0.7;
      events.push('Opponent partially blocked your ability.');
    }
    playerOutDmg = Math.max(1, Math.floor(playerOutDmg));
    opponentDamageTaken += playerOutDmg;
  } else if (playerMove === 'guard') {
    playerHeal = Math.round(player.maxHp * 0.05);
    events.push(`You guarded and recovered ${playerHeal} HP.`);
  }

  // --- Opponent attacks player ---
  let opponentOutDmg = 0;
  if (opponentMove === 'strike') {
    const str = opponent.combatStats.str + opponentStrBonus;
    opponentOutDmg = str * 0.4 + Math.random() * (str * 0.1);
    const isCrit = Math.random() * 100 < opponentCritChance;
    if (isCrit) {
      opponentOutDmg *= 1.5;
      events.push('Opponent landed a critical hit!');
    }
    if (playerMove === 'guard') {
      opponentOutDmg *= 0.4;
      events.push('You braced for their strike.');
    }
    opponentOutDmg = Math.max(1, Math.floor(opponentOutDmg * (1 - playerDmgReduction / 100)));
    playerDamageTaken += opponentOutDmg;
  } else if (opponentMove === 'ability') {
    const int = opponent.combatStats.int + opponentIntBonus;
    opponentOutDmg = int * 0.5 + Math.random() * (int * 0.15) + opponentAbilityBonus;
    if (playerMove === 'strike') {
      opponentOutDmg *= 1.3;
      events.push('Opponent\'s ability overpowered your strike!');
    }
    if (playerMove === 'guard') {
      opponentOutDmg *= 0.7;
      events.push('You partially blocked their ability.');
    }
    opponentOutDmg = Math.max(1, Math.floor(opponentOutDmg));
    playerDamageTaken += opponentOutDmg;
  } else if (opponentMove === 'guard') {
    opponentHeal = Math.round(opponent.maxHp * 0.05);
    events.push(`Opponent guarded and recovered ${opponentHeal} HP.`);
  }

  return {
    speedWinner,
    playerDamageTaken,
    opponentDamageTaken,
    playerHeal,
    opponentHeal,
    events
  };
}

function computeRank(xp) {
  const config = loadArenaConfig();
  const order = config.rankOrder;
  let rank = order[0];
  for (const r of order) {
    if (xp >= config.ranks[r].xpRequired) rank = r;
    else break;
  }
  return rank;
}

function computeXpAward(type, result, bossLevel) {
  const config = loadArenaConfig();
  const awards = config.xpAwards;
  if (result === 'win') {
    if (type === 'pve') return awards.pveWinBase + (bossLevel || 1) * awards.pveWinPerLevel;
    return awards.pvpWin;
  }
  if (result === 'loss') {
    return type === 'pve' ? awards.pveLoss : awards.pvpLoss;
  }
  return awards.draw;
}

// --- Main handler ---

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  try {
    const { userId, isAuthenticated } = extractUserInfo(req, context);
    if (!isAuthenticated) {
      context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
      return;
    }

    const body = req.body || {};
    const { action } = body;
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    if (action === 'start') {
      await handleStart(context, containerClient, userId, body);
    } else if (action === 'move') {
      await handleMove(context, containerClient, userId, body);
    } else if (action === 'forfeit') {
      await handleForfeit(context, containerClient, userId, body);
    } else {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: `Unknown action: ${action}` } };
    }
  } catch (error) {
    context.log.error(`[Arena Battle] Error: ${error.message}\n${error.stack}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: `Arena battle error: ${error.message}` } };
  }
};

// --- Action: start ---

async function handleStart(context, containerClient, userId, body) {
  const { type, cardId, opponentId } = body;
  const config = loadArenaConfig();

  if (!type || !cardId || !opponentId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'type, cardId, and opponentId are required' } };
    return;
  }
  if (!['pve', 'pvp'].includes(type)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'type must be pve or pvp' } };
    return;
  }

  // Load player's card
  const userCardsData = await downloadJsonBlob(containerClient, `user/${userId}/cards.json`);
  const userCards = userCardsData?.cards || [];
  const playerCard = userCards.find(c => c.id === cardId);
  if (!playerCard) {
    context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found in your collection' } };
    return;
  }

  // Load opponent card
  let opponentCard;
  let bossLevel = 0;
  if (type === 'pve') {
    const bossData = loadBossData();
    opponentCard = bossData.bosses.find(b => b.id === opponentId);
    if (!opponentCard) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Boss not found' } };
      return;
    }
    bossLevel = opponentCard.bossLevel;

    // Check if boss is unlocked
    const profile = await downloadJsonBlob(containerClient, `arena/profiles/${userId}.json`);
    const highestDefeated = profile?.pveProgress?.highestBossDefeated || 0;
    if (bossLevel > highestDefeated + 1) {
      context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This boss is still locked. Defeat the previous boss first.' } };
      return;
    }
  } else {
    // PvP: load from published cards
    const published = await downloadJsonBlob(containerClient, 'published-cards.json');
    const gallery = published?.publishedCards || [];
    opponentCard = gallery.find(c => c.id === opponentId);
    if (!opponentCard) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Opponent card not found in gallery' } };
      return;
    }
  }

  // Compute combat stats
  const playerCombat = mapCardToCombatStats(playerCard);
  const opponentCombat = mapCardToCombatStats(opponentCard);
  const playerPassives = computePassives(playerCard);
  const opponentPassives = computePassives(opponentCard);
  const playerMaxHp = computeMaxHp(playerCombat);
  const opponentMaxHp = computeMaxHp(opponentCombat);

  // Pre-generate boss/AI moves for all rounds
  const aiMoves = [];
  let simHp = opponentMaxHp;
  for (let r = 1; r <= config.totalRounds; r++) {
    const move = generateBossMove(
      type === 'pve' ? opponentCard : { arenaOverrides: { aiPattern: 'balanced' } },
      r, simHp, opponentMaxHp
    );
    aiMoves.push(move);
    // Rough HP sim for AI adaptation (assume ~20 damage per round)
    simHp = Math.max(1, simHp - 20);
  }

  const battleId = `battle-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const battleState = {
    battleId,
    type,
    status: 'active',
    currentRound: 1,
    totalRounds: config.totalRounds,
    player1: {
      userId,
      cardId,
      cardSnapshot: { name: playerCard.name, class: playerCard.class, avatar: playerCard.avatar, quote: playerCard.quote },
      combatStats: playerCombat,
      maxHp: playerMaxHp,
      hp: playerMaxHp,
      passives: playerPassives,
      moves: []
    },
    player2: {
      userId: type === 'pve' ? opponentId : 'gallery',
      cardId: opponentCard.id,
      cardSnapshot: { name: opponentCard.name, class: opponentCard.class, avatar: opponentCard.avatar, quote: opponentCard.quote },
      combatStats: opponentCombat,
      maxHp: opponentMaxHp,
      hp: opponentMaxHp,
      passives: opponentPassives,
      moves: aiMoves,
      bossLevel
    },
    roundLog: [],
    winner: null,
    createdAt: new Date().toISOString()
  };

  await uploadJsonBlob(containerClient, `arena/battles/${battleId}.json`, battleState);
  context.log(`[Arena] Battle started: ${battleId} (${type}) - ${playerCard.name} vs ${opponentCard.name}`);

  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: {
      battleId,
      player: {
        name: playerCard.name,
        class: playerCard.class,
        avatar: playerCard.avatar,
        combatStats: playerCombat,
        maxHp: playerMaxHp,
        hp: playerMaxHp,
        passives: playerPassives
      },
      opponent: {
        name: opponentCard.name,
        class: opponentCard.class,
        avatar: opponentCard.avatar,
        combatStats: opponentCombat,
        maxHp: opponentMaxHp,
        hp: opponentMaxHp,
        bossLevel
      },
      currentRound: 1,
      totalRounds: config.totalRounds,
      status: 'active'
    }
  };
}

// --- Action: move ---

async function handleMove(context, containerClient, userId, body) {
  const { battleId, round, move } = body;

  if (!battleId || !round || !move) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'battleId, round, and move are required' } };
    return;
  }
  if (!['strike', 'guard', 'ability'].includes(move)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'move must be strike, guard, or ability' } };
    return;
  }

  const battlePath = `arena/battles/${battleId}.json`;
  const battle = await downloadJsonBlob(containerClient, battlePath);

  if (!battle) {
    context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Battle not found' } };
    return;
  }
  if (battle.player1.userId !== userId) {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This is not your battle' } };
    return;
  }
  if (battle.status !== 'active') {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Battle is already complete' } };
    return;
  }
  if (round !== battle.currentRound) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: `Expected round ${battle.currentRound}, got ${round}` } };
    return;
  }

  const player = battle.player1;
  const opponent = battle.player2;
  const opponentMove = opponent.moves[round - 1];

  // Resolve the round
  const result = resolveRound(
    { combatStats: player.combatStats, passives: player.passives, maxHp: player.maxHp },
    { combatStats: opponent.combatStats, passives: opponent.passives, maxHp: opponent.maxHp },
    move, opponentMove
  );

  // Apply damage and healing
  player.hp = Math.min(player.maxHp, Math.max(0, player.hp - result.playerDamageTaken + result.playerHeal));
  opponent.hp = Math.min(opponent.maxHp, Math.max(0, opponent.hp - result.opponentDamageTaken + result.opponentHeal));

  player.moves.push(move);

  const roundResult = {
    round,
    playerMove: move,
    opponentMove,
    playerDamage: result.opponentDamageTaken,
    opponentDamage: result.playerDamageTaken,
    playerHp: player.hp,
    opponentHp: opponent.hp,
    playerHeal: result.playerHeal,
    opponentHeal: result.opponentHeal,
    events: result.events,
    speedWinner: result.speedWinner
  };

  battle.roundLog.push(roundResult);

  // Check for battle end
  const isKo = player.hp <= 0 || opponent.hp <= 0;
  const isFinalRound = round >= battle.totalRounds;

  let battleResult = null;

  if (isKo || isFinalRound) {
    battle.status = 'complete';

    if (player.hp > opponent.hp) {
      battle.winner = 'player';
    } else if (opponent.hp > player.hp) {
      battle.winner = 'opponent';
    } else {
      battle.winner = 'draw';
    }

    const resultStr = battle.winner === 'player' ? 'win' : battle.winner === 'opponent' ? 'loss' : 'draw';
    battleResult = await finalizeBattle(context, containerClient, userId, battle, resultStr);
  } else {
    battle.currentRound = round + 1;
    await uploadJsonBlob(containerClient, battlePath, battle);
  }

  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: {
      roundResult,
      battleStatus: battle.status,
      currentRound: battle.currentRound,
      battleResult
    }
  };
}

// --- Action: forfeit ---

async function handleForfeit(context, containerClient, userId, body) {
  const { battleId } = body;
  if (!battleId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'battleId is required' } };
    return;
  }

  const battlePath = `arena/battles/${battleId}.json`;
  const battle = await downloadJsonBlob(containerClient, battlePath);

  if (!battle) {
    context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Battle not found' } };
    return;
  }
  if (battle.player1.userId !== userId) {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This is not your battle' } };
    return;
  }
  if (battle.status !== 'active') {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Battle is already complete' } };
    return;
  }

  battle.status = 'complete';
  battle.winner = 'opponent';

  const battleResult = await finalizeBattle(context, containerClient, userId, battle, 'loss');

  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: {
      battleStatus: 'complete',
      battleResult
    }
  };
}

// --- Finalize battle: update profile, write history, clean up ---

async function finalizeBattle(context, containerClient, userId, battle, result) {
  const type = battle.type;
  const bossLevel = battle.player2.bossLevel || 0;
  const xpEarned = computeXpAward(type, result, bossLevel);

  // XP bonus from badges
  const xpBonus = getPassiveValue(battle.player1.passives, 'xp_bonus');
  const totalXp = Math.round(xpEarned * (1 + xpBonus / 100));

  // Update profile
  const profilePath = `arena/profiles/${userId}.json`;
  let profile = await downloadJsonBlob(containerClient, profilePath);
  if (!profile) {
    profile = {
      userId, rank: 'bronze', xp: 0, level: 1,
      record: { wins: 0, losses: 0, draws: 0 },
      pveProgress: { highestBossDefeated: 0, bossAttempts: {} },
      selectedCardId: null,
      createdAt: new Date().toISOString(),
      lastBattleAt: null
    };
  }

  const oldRank = profile.rank;
  profile.xp += totalXp;
  profile.lastBattleAt = new Date().toISOString();

  if (result === 'win') profile.record.wins++;
  else if (result === 'loss') profile.record.losses++;
  else profile.record.draws++;

  // PvE progress
  if (type === 'pve' && result === 'win' && bossLevel > (profile.pveProgress.highestBossDefeated || 0)) {
    profile.pveProgress.highestBossDefeated = bossLevel;
  }
  if (type === 'pve') {
    const bossKey = battle.player2.cardId;
    if (!profile.pveProgress.bossAttempts) profile.pveProgress.bossAttempts = {};
    profile.pveProgress.bossAttempts[bossKey] = (profile.pveProgress.bossAttempts[bossKey] || 0) + 1;
  }

  // Compute new rank
  const newRank = computeRank(profile.xp);
  profile.rank = newRank;
  const rankUp = newRank !== oldRank;

  // Compute level (every 100 XP = 1 level)
  profile.level = Math.floor(profile.xp / 100) + 1;

  await uploadJsonBlob(containerClient, profilePath, profile);

  // Append to match history
  const historyPath = `arena/history/${userId}.json`;
  let history = await downloadJsonBlob(containerClient, historyPath) || [];
  history.unshift({
    battleId: battle.battleId,
    type,
    opponentName: battle.player2.cardSnapshot.name,
    opponentAvatar: battle.player2.cardSnapshot.avatar,
    opponentClass: battle.player2.cardSnapshot.class,
    result,
    rounds: battle.roundLog.length,
    xpEarned: totalXp,
    timestamp: new Date().toISOString()
  });
  // Keep last 100 matches
  if (history.length > 100) history = history.slice(0, 100);
  await uploadJsonBlob(containerClient, historyPath, history);

  // Clean up battle state
  await deleteBlob(containerClient, `arena/battles/${battle.battleId}.json`);

  context.log(`[Arena] Battle ${battle.battleId} complete: ${result}, +${totalXp} XP, rank: ${oldRank} -> ${newRank}`);

  return {
    winner: result === 'win' ? 'player' : result === 'loss' ? 'opponent' : 'draw',
    xpEarned: totalXp,
    newXp: profile.xp,
    newLevel: profile.level,
    newRank,
    rankUp,
    record: profile.record
  };
}
