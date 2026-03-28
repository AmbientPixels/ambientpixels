// ═══════════════════════════════════════════════════════════════════════════
// BLINDSPOT LIVE PVP — Real-time player-vs-player battles
// ═══════════════════════════════════════════════════════════════════════════
//
// Both players submit moves independently via HTTP POST. Server stores
// pending moves in battle blob. When both arrive, resolveRound() runs.
// Clients poll every 2-3s for state updates.
//
// Combat engine functions copied from blindspotbattle/index.js —
// deliberate duplication pending consolidation into shared _utils/combatEngine.js
//
// Battle ID prefix: bs-live-  (auto-routed by client ArenaAPI)
// Other prefixes: bs-battle- = PvE, bs-async- = async PvP
// ═══════════════════════════════════════════════════════════════════════════

const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const path = require('path');
const fs = require('fs');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const QUEUE_BLOB = 'blindspot/pvp/matchmakingQueue.json';
const ROUND_TIMEOUT_MS = 45 * 1000;
const MAX_DISCONNECT_ROUNDS = 3;
const MAX_IDLE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const QUEUE_ENTRY_TTL_MS = 120 * 1000;  // 2 minutes
const ELO_K = 32;
const ELO_DEFAULT = 1000;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

// ── Shared helpers ──

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
        context.log.warn('Failed to parse client principal: ' + err.message);
      }
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
  return new BlobServiceClient('https://' + STORAGE_ACCOUNT_NAME + '.blob.core.windows.net', credential);
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

// Download blob with ETag for conditional writes
async function downloadBlobWithETag(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return { data: null, etag: null };
  const props = await blobClient.getProperties();
  const downloadResponse = await blobClient.download(0, undefined, { abortSignal: getAbortSignal(10000) });
  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) { chunks.push(chunk); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return { data, etag: props.etag };
}

// Conditional upload — fails with 412 if etag doesn't match
async function uploadBlobConditional(containerClient, blobName, data, etag) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const content = JSON.stringify(data, null, 2);
  await blobClient.upload(content, Buffer.byteLength(content), {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' },
    conditions: etag ? { ifMatch: etag } : undefined
  });
}

// Jittered exponential backoff sleep
function backoffDelay(attempt) {
  const base = 50;
  const delay = Math.min(base * Math.pow(2, attempt) + Math.random() * 50, 2000);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// ── Load arena config from sibling battle API ──

let _configCache = null;
function loadArenaConfig() {
  if (_configCache) return _configCache;
  const configPath = path.resolve(__dirname, '..', 'blindspotbattle', 'arena-config.json');
  _configCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return _configCache;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBAT ENGINE — Copied from blindspotbattle/index.js
// Deliberate duplication pending shared module extraction
// ═══════════════════════════════════════════════════════════════════════════

function mapCardToCombatStats(card) {
  const config = loadArenaConfig();
  const combat = { ...config.statDefaults };
  if (card.combatStats && typeof card.combatStats === 'object') {
    var needsMigration = !card.statVersion || card.statVersion < 2;
    for (const key of Object.keys(combat)) {
      if (card.combatStats[key] !== undefined) {
        var val = card.combatStats[key];
        if (needsMigration && val > 20) val = Math.round(val / 5);
        combat[key] = Math.min(20, Math.max(1, Math.round(val)));
      }
    }
    return combat;
  }
  if (!card.stats || card.stats.length === 0) return combat;
  const maxVal = Math.max(...card.stats.map(s => s.value || 0));
  const scaleFactor = maxVal <= 4 ? 5 : 1;
  for (const [combatKey, aliases] of Object.entries(config.statAliases)) {
    const match = card.stats.find(s => aliases.includes((s.name || '').toLowerCase().trim()));
    if (match) combat[combatKey] = Math.min(20, Math.max(1, Math.round((match.value || 0) * scaleFactor)));
  }
  return combat;
}

function computePassives(card, rank) {
  const config = loadArenaConfig();
  const passives = [];
  if (!card.badges || card.badges.length === 0) return passives;
  const qtyCaps = config.buffQtyCaps || {};
  const maxQty = qtyCaps[(rank || 'bronze').toLowerCase()] || 1;
  for (const badge of card.badges) {
    const category = (badge.category || '').toLowerCase().trim();
    const passiveDef = config.badgePassives[category];
    if (!passiveDef) continue;
    const rawQty = badge.quantity || 1;
    const qty = Math.min(rawQty, maxQty);
    const value = Math.min(passiveDef.valuePerQty * qty, passiveDef.maxValue);
    passives.push({ source: 'badge:' + badge.category, effect: passiveDef.effect, value });
  }
  return passives;
}

function computeStatThresholdPassives(combatStats) {
  if (!combatStats) return [];
  const passives = [];
  const cs = combatStats;
  if ((cs.str || 0) >= 12) passives.push({ source: 'stat:str12', effect: 'guard_pierce', value: 20 });
  if ((cs.str || 0) >= 16) passives.push({ source: 'stat:str16', effect: 'crit_damage', value: 25 });
  if ((cs.agi || 0) >= 12) passives.push({ source: 'stat:agi12', effect: 'speed_priority', value: 1 });
  if ((cs.agi || 0) >= 16) passives.push({ source: 'stat:agi16', effect: 'dodge', value: 15 });
  if ((cs.int || 0) >= 12) passives.push({ source: 'stat:int12', effect: 'ability_discount', value: 1 });
  if ((cs.int || 0) >= 12) passives.push({ source: 'stat:int12', effect: 'ability_stamina_discount', value: 1 });
  if ((cs.int || 0) >= 16) passives.push({ source: 'stat:int16', effect: 'ability_power', value: 30 });
  if ((cs.end || 0) >= 12) passives.push({ source: 'stat:end12', effect: 'heal_dr', value: 10 });
  if ((cs.end || 0) >= 16) passives.push({ source: 'stat:end16', effect: 'hp_regen', value: 5 });
  if ((cs.lck || 0) >= 10) passives.push({ source: 'stat:lck10', effect: 'crit_chance', value: 10 });
  if ((cs.lck || 0) >= 14) passives.push({ source: 'stat:lck14', effect: 'crit_damage', value: 50 });
  return passives;
}

function getPassiveValue(passives, effectName) {
  return passives.filter(p => p.effect === effectName).reduce((sum, p) => sum + p.value, 0);
}

function applyStatPassives(combatStats, passives) {
  const endBonus = getPassiveValue(passives, 'end_bonus');
  if (endBonus > 0) combatStats.end = Math.min(20, combatStats.end + endBonus);
  const allStats = getPassiveValue(passives, 'all_stats');
  if (allStats > 0) {
    combatStats.str = Math.min(20, combatStats.str + allStats);
    combatStats.agi = Math.min(20, combatStats.agi + allStats);
    combatStats.int = Math.min(20, combatStats.int + allStats);
    combatStats.end = Math.min(20, combatStats.end + allStats);
    combatStats.lck = Math.min(20, combatStats.lck + allStats);
  }
}

function computeMaxHp(combatStats) {
  return Math.round(80 + (combatStats.end * 7.5) + (combatStats.str * 1.5));
}

function getClassAbility(className, config) {
  if (className && config.classAbilities && config.classAbilities[className]) return config.classAbilities[className];
  return null;
}

function getAbilityByDominantStat(combatStats, config) {
  const statMap = { str: 'powerStrike', int: 'arcaneBlast', agi: 'shadowStrike', end: 'fortify', lck: 'wildCard' };
  let best = 'str', bestVal = 0;
  for (const s of ['str', 'int', 'agi', 'end', 'lck']) {
    if ((combatStats[s] || 0) > bestVal) { bestVal = combatStats[s]; best = s; }
  }
  return statMap[best] || 'powerStrike';
}

function getAbilityKey(className, combatStats, config) {
  return getClassAbility(className, config) || getAbilityByDominantStat(combatStats, config);
}

function computeRank(xp) {
  const config = loadArenaConfig();
  const order = config.rankOrder || ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
  let rank = order[0];
  for (const r of order) {
    if (xp >= (config.ranks[r]?.xpRequired || 0)) rank = r;
    else break;
  }
  return rank;
}

function computeChargeRate(combatStats, arenaXp, config) {
  const cc = config.chargeConfig || {};
  let rate = cc.baseRate || 1;
  if (combatStats.agi >= (cc.agiThreshold || 50)) rate += (cc.agiBonus || 0.5);
  const rank = computeRank(arenaXp || 0);
  const rankOrder = config.rankOrder || [];
  const minRankIdx = rankOrder.indexOf(cc.rankBonusMinRank || 'gold');
  if (minRankIdx >= 0 && rankOrder.indexOf(rank) >= minRankIdx) rate += (cc.rankBonus || 0.5);
  return rate;
}

function getStaminaCost(move, passives, config) {
  const sc = config.staminaConfig || {};
  const costs = sc.costs || { strike: 3, guard: 1, heal: 2, counter: 3, ability: 4 };
  let cost = costs[move] || 2;
  if (move === 'ability' && getPassiveValue(passives, 'ability_stamina_discount') > 0) {
    cost = Math.max(1, cost - 1);
  }
  return cost;
}

function resolveClassAbility(abilityKey, combatStats, opponentMove, config, events, side) {
  const def = config.abilityDefs[abilityKey];
  if (!def) return { damage: 0, heal: 0, tempEffect: null, alwaysFirst: false };
  const prefix = side === 'player' ? 'Your' : "Enemy's";
  const target = side === 'player' ? 'their' : 'your';
  let damage = 0, heal = 0, tempEffect = null, alwaysFirst = false;

  if (abilityKey === 'fortify') {
    const end = combatStats.end;
    heal = end * def.healMult + Math.random() * (end * def.healRand);
    if (opponentMove === 'strike') { heal *= 0.75; events.push(prefix + ' fortify was disrupted by ' + target + ' strike! (25% reduced)'); }
    else if (opponentMove === 'ability') { heal *= 0.4; events.push(prefix + ' fortify was disrupted by ' + target + ' ability! (60% reduced)'); }
    heal = Math.round(heal);
    if (heal > 0) {
      events.push(prefix + ' ' + def.label + ' restored ' + heal + ' HP and raised defenses!');
      tempEffect = { effect: 'fortified', value: 20, roundsLeft: 1 };
    }
  } else if (abilityKey === 'wildCard') {
    const statKeys = ['str', 'agi', 'int', 'end', 'lck'];
    const chosenStat = statKeys[Math.floor(Math.random() * statKeys.length)];
    const statVal = combatStats[chosenStat] || 30;
    damage = statVal * def.mult + Math.random() * (statVal * def.randMult);
    if (Math.random() < 0.1) {
      damage = 0;
      events.push(prefix + ' ' + def.label + ' fizzled!');
    } else {
      if (Math.random() < 0.25) {
        damage *= 2;
        events.push(prefix + ' ' + def.label + ' scored a wild critical hit!');
      }
      if (opponentMove === 'strike') { damage *= 1.3; events.push(prefix + ' ' + def.label + ' overpowered ' + target + ' strike!'); }
      if (opponentMove === 'guard') { damage *= 0.7; events.push('\uD83D\uDEE1\uFE0F ' + (side === 'player' ? 'Enemy' : 'You') + ' partially blocked the ' + def.label + '.'); }
      if (opponentMove === 'heal') { damage *= 1.2; events.push(prefix + ' ' + def.label + ' punished ' + target + ' healing!'); }
    }
    damage = Math.max(0, Math.floor(damage));
  } else {
    const statVal = combatStats[def.stat] || 40;
    damage = statVal * def.mult + Math.random() * (statVal * def.randMult);
    if (abilityKey === 'shadowStrike') alwaysFirst = true;
    if (opponentMove === 'strike') { damage *= 1.3; events.push(prefix + ' ' + def.label + ' overpowered ' + target + ' strike!'); }
    if (opponentMove === 'guard') {
      let guardMult = 0.7;
      if (abilityKey === 'powerStrike') guardMult = 1.4 * 0.7;
      damage *= guardMult;
      if (abilityKey === 'powerStrike') events.push(prefix + ' ' + def.label + ' smashed through ' + target + ' guard!');
      else events.push('\uD83D\uDEE1\uFE0F ' + (side === 'player' ? 'Enemy' : 'You') + ' partially blocked the ' + def.label + '.');
    }
    if (opponentMove === 'heal') { damage *= 1.2; events.push(prefix + ' ' + def.label + ' punished ' + target + ' healing!'); }
    if (abilityKey === 'arcaneBlast' && damage > 0) {
      tempEffect = { effect: 'vulnerable', value: 15, roundsLeft: 1 };
      events.push(prefix + ' ' + def.label + ' left the target vulnerable!');
    }
    damage = Math.max(1, Math.floor(damage));
  }
  return { damage, heal, tempEffect, alwaysFirst };
}

// Full resolveRound — includes stamina, stances, elements, counters, burn, stun, blind
function resolveRound(player, opponent, playerMove, opponentMove, battleTempEffects, staminaState, stanceState, elements, battle) {
  const config = loadArenaConfig();
  const events = [];
  const playerStance = (stanceState && stanceState.player) || 'balanced';
  const opponentStance = (stanceState && stanceState.opponent) || 'balanced';

  const sc = config.staminaConfig || {};
  const exhaustionThreshold = sc.exhaustionThreshold || 3;
  const exhaustionBurnPct = sc.exhaustionBurnPct || 0.03;
  const playerExhausted = staminaState && staminaState.player < exhaustionThreshold;
  const opponentExhausted = staminaState && staminaState.opponent < exhaustionThreshold;

  const moveLabels = { strike: 'Strike', guard: 'Guard', ability: 'Ability', heal: 'Heal', counter: 'Counter' };
  events.push('\u2694\uFE0F You chose ' + (moveLabels[playerMove] || playerMove) + ' \u2014 Enemy chose ' + (moveLabels[opponentMove] || opponentMove));

  const playerSpeed = player.combatStats.agi + Math.random() * 10;
  const opponentSpeed = opponent.combatStats.agi + Math.random() * 10;
  let speedWinner = playerSpeed >= opponentSpeed ? 'player' : 'opponent';
  if (getPassiveValue(player.passives, 'speed_priority') > 0 && getPassiveValue(opponent.passives, 'speed_priority') === 0) speedWinner = 'player';
  if (getPassiveValue(opponent.passives, 'speed_priority') > 0 && getPassiveValue(player.passives, 'speed_priority') === 0) speedWinner = 'opponent';
  if (playerMove === 'ability' && player.abilityKey === 'shadowStrike') speedWinner = 'player';
  if (opponentMove === 'ability' && opponent.abilityKey === 'shadowStrike') speedWinner = 'opponent';

  let playerDamageTaken = 0, opponentDamageTaken = 0, playerHeal = 0, opponentHeal = 0;
  const newTempEffects = { player: [], opponent: [] };

  const playerCritChance = 5 + getPassiveValue(player.passives, 'crit_chance');
  const playerAbilityBonus = getPassiveValue(player.passives, 'ability_power');
  const playerStrBonus = getPassiveValue(player.passives, 'str_bonus');
  const opponentDmgReduction = getPassiveValue(opponent.passives, 'damage_reduction');

  const opponentCritChance = 5 + getPassiveValue(opponent.passives, 'crit_chance');
  const opponentAbilityBonus = getPassiveValue(opponent.passives, 'ability_power');
  const opponentStrBonus = getPassiveValue(opponent.passives, 'str_bonus');
  const playerDmgReduction = getPassiveValue(player.passives, 'damage_reduction');

  const te = battleTempEffects || { player: [], opponent: [] };
  let playerVulnerable = 0, opponentVulnerable = 0;
  let playerFortified = 0, opponentFortified = 0;
  let playerBurn = 0, opponentBurn = 0;
  let playerStunned = false, opponentStunned = false;
  let playerBlind = false, opponentBlind = false;
  const persistedEffects = { player: [], opponent: [] };

  for (const eff of (te.player || [])) {
    if (eff.effect === 'vulnerable') playerVulnerable += eff.value;
    if (eff.effect === 'fortified') playerFortified += eff.value;
    if (eff.effect === 'burn') { playerBurn = eff.value; if ((eff.roundsLeft || 1) > 1) persistedEffects.player.push({ ...eff, roundsLeft: eff.roundsLeft - 1 }); }
    if (eff.effect === 'stun') playerStunned = true;
    if (eff.effect === 'blind') playerBlind = true;
  }
  for (const eff of (te.opponent || [])) {
    if (eff.effect === 'vulnerable') opponentVulnerable += eff.value;
    if (eff.effect === 'fortified') opponentFortified += eff.value;
    if (eff.effect === 'burn') { opponentBurn = eff.value; if ((eff.roundsLeft || 1) > 1) persistedEffects.opponent.push({ ...eff, roundsLeft: eff.roundsLeft - 1 }); }
    if (eff.effect === 'stun') opponentStunned = true;
    if (eff.effect === 'blind') opponentBlind = true;
  }

  // --- Player attacks opponent ---
  let playerOutDmg = 0;
  if (playerStunned) {
    events.push('\uD83D\uDCA5 You are stunned and cannot act this round!');
  } else if (playerMove === 'strike') {
    const str = player.combatStats.str + playerStrBonus;
    playerOutDmg = str * 0.3 + Math.random() * (str * 0.1);
    const isCrit = Math.random() * 100 < playerCritChance;
    if (isCrit) {
      const critDmgBonus = getPassiveValue(player.passives, 'crit_damage');
      const critMultiplier = 1.5 + (critDmgBonus / 100) + (playerStance === 'aggressive' ? 0.15 : 0);
      playerOutDmg *= critMultiplier;
      events.push('\u2728 Your strike landed a critical hit! (' + Math.round(critMultiplier * 100) + '% damage)');
      newTempEffects.opponent.push({ effect: 'burn', value: Math.round(opponent.maxHp * 0.08), roundsLeft: 2 });
      events.push('\uD83D\uDD25 The critical strike ignites the enemy! (Burn x2 rounds)');
    }
    if (playerBlind && Math.random() < 0.40) { events.push('\uD83D\uDE35 Blinded! Your strike swings wide and misses!'); playerOutDmg = 0; }
    const oppDodge = getPassiveValue(opponent.passives, 'dodge');
    if (oppDodge > 0 && Math.random() * 100 < oppDodge && playerOutDmg > 0) { events.push('\uD83D\uDCA8 Enemy dodged your strike!'); playerOutDmg = 0; }
    if (opponentMove === 'guard' && playerOutDmg > 0) {
      const guardPierce = getPassiveValue(player.passives, 'guard_pierce');
      const baseBlock = opponentStance === 'defensive' ? 0.8 : 0.6;
      const guardBlock = Math.max(0.2, baseBlock - (guardPierce / 100));
      const preGuard = Math.floor(playerOutDmg);
      playerOutDmg *= (1 - guardBlock);
      events.push('\uD83D\uDEE1\uFE0F Enemy guarded, blocked ' + Math.round(guardBlock * 100) + '% of your strike (' + preGuard + ' \u2192 ' + Math.floor(playerOutDmg) + ').');
    }
    if (playerOutDmg > 0) {
      playerOutDmg = Math.max(1, Math.floor(playerOutDmg * (1 - opponentDmgReduction / 100)));
      opponentDamageTaken += playerOutDmg;
      events.push('\u2694\uFE0F You struck for ' + playerOutDmg + ' damage!');
    }
  } else if (playerMove === 'ability') {
    const abilityResult = resolveClassAbility(player.abilityKey || 'arcaneBlast', player.combatStats, opponentMove, config, events, 'player');
    playerOutDmg = abilityResult.damage + playerAbilityBonus;
    if (playerOutDmg > 0) { playerOutDmg = Math.max(1, Math.floor(playerOutDmg)); opponentDamageTaken += playerOutDmg; events.push('\u2728 Your ability dealt ' + playerOutDmg + ' damage!'); }
    if (abilityResult.heal > 0) playerHeal += abilityResult.heal;
    if (abilityResult.tempEffect) newTempEffects.opponent.push(abilityResult.tempEffect);
    if (abilityResult.alwaysFirst) speedWinner = 'player';
    if (opponentMove === 'guard') { newTempEffects.opponent.push({ effect: 'stun', roundsLeft: 1 }); events.push('\uD83D\uDCA5 Your ability breaks through their guard \u2014 enemy stunned!'); }
    if (player.abilityKey === 'shadowStrike' && abilityResult.damage > 0 && Math.random() * 100 < playerCritChance) {
      newTempEffects.opponent.push({ effect: 'blind', roundsLeft: 1 }); events.push('\uD83C\uDF11 Shadow Strike blinds the enemy!');
    }
  } else if (playerMove === 'guard') {
    events.push('\uD83D\uDEE1\uFE0F You raised your guard, bracing for impact.');
  } else if (playerMove === 'heal') {
    const end = player.combatStats.end;
    let healAmt = end * 0.5 + Math.random() * (end * 0.12);
    if (opponentMove === 'strike') { healAmt *= 0.75; events.push('\u26A0\uFE0F Your healing was disrupted by the enemy strike! (25% reduced)'); }
    else if (opponentMove === 'ability') { healAmt *= 0.4; events.push('\u26A0\uFE0F Your healing was disrupted by the enemy ability! (60% reduced)'); }
    healAmt = Math.round(healAmt);
    playerHeal += healAmt;
    if (healAmt > 0) {
      events.push('\uD83D\uDC9A You focused and recovered ' + healAmt + ' HP.');
      const healDr = getPassiveValue(player.passives, 'heal_dr');
      if (healDr > 0) { newTempEffects.player.push({ effect: 'fortified', value: healDr, roundsLeft: 1 }); events.push('\uD83D\uDEE1\uFE0F Fortified Heal grants ' + healDr + '% damage reduction for 1 round!'); }
    }
  } else if (playerMove === 'counter') {
    events.push('\uD83D\uDD04 You took a counter stance, ready to reflect.');
  }

  // --- Opponent attacks player ---
  let opponentOutDmg = 0;
  if (opponentStunned) {
    events.push('\uD83D\uDCA5 Enemy is stunned and cannot act this round!');
  } else if (opponentMove === 'strike') {
    const str = opponent.combatStats.str + opponentStrBonus;
    opponentOutDmg = str * 0.3 + Math.random() * (str * 0.1);
    const isCrit = Math.random() * 100 < opponentCritChance;
    if (isCrit) {
      const critDmgBonus = getPassiveValue(opponent.passives, 'crit_damage');
      const critMultiplier = 1.5 + (critDmgBonus / 100) + (opponentStance === 'aggressive' ? 0.15 : 0);
      opponentOutDmg *= critMultiplier;
      events.push('\u2728 Enemy landed a critical hit! (' + Math.round(critMultiplier * 100) + '% damage)');
      newTempEffects.player.push({ effect: 'burn', value: Math.round(player.maxHp * 0.08), roundsLeft: 2 });
      events.push('\uD83D\uDD25 The critical strike ignites you! (Burn x2 rounds)');
    }
    if (opponentBlind && Math.random() < 0.40) { events.push('\uD83D\uDE35 Blinded! Enemy strike swings wide and misses!'); opponentOutDmg = 0; }
    const plDodge = getPassiveValue(player.passives, 'dodge');
    if (plDodge > 0 && Math.random() * 100 < plDodge && opponentOutDmg > 0) { events.push('\uD83D\uDCA8 You dodged the enemy strike!'); opponentOutDmg = 0; }
    if (playerMove === 'guard' && opponentOutDmg > 0) {
      const oppGuardPierce = getPassiveValue(opponent.passives, 'guard_pierce');
      const pBaseBlock = playerStance === 'defensive' ? 0.8 : 0.6;
      const guardBlock = Math.max(0.2, pBaseBlock - (oppGuardPierce / 100));
      const preGuard = Math.floor(opponentOutDmg);
      opponentOutDmg *= (1 - guardBlock);
      events.push('\uD83D\uDEE1\uFE0F You guarded, blocked ' + Math.round(guardBlock * 100) + '% of their strike (' + preGuard + ' \u2192 ' + Math.floor(opponentOutDmg) + ').');
    }
    if (opponentOutDmg > 0) {
      opponentOutDmg = Math.max(1, Math.floor(opponentOutDmg * (1 - playerDmgReduction / 100)));
      playerDamageTaken += opponentOutDmg;
      events.push('\u2694\uFE0F Enemy struck you for ' + opponentOutDmg + ' damage!');
    }
  } else if (opponentMove === 'ability') {
    const abilityResult = resolveClassAbility(opponent.abilityKey || 'arcaneBlast', opponent.combatStats, playerMove, config, events, 'opponent');
    opponentOutDmg = abilityResult.damage + opponentAbilityBonus;
    if (opponentOutDmg > 0) { opponentOutDmg = Math.max(1, Math.floor(opponentOutDmg)); playerDamageTaken += opponentOutDmg; events.push('\u2728 Enemy ability dealt ' + opponentOutDmg + ' damage to you!'); }
    if (abilityResult.heal > 0) opponentHeal += abilityResult.heal;
    if (abilityResult.tempEffect) newTempEffects.player.push(abilityResult.tempEffect);
    if (abilityResult.alwaysFirst) speedWinner = 'opponent';
    if (playerMove === 'guard') { newTempEffects.player.push({ effect: 'stun', roundsLeft: 1 }); events.push('\uD83D\uDCA5 Enemy ability breaks through your guard \u2014 you are stunned!'); }
    if (opponent.abilityKey === 'shadowStrike' && abilityResult.damage > 0 && Math.random() * 100 < opponentCritChance) {
      newTempEffects.player.push({ effect: 'blind', roundsLeft: 1 }); events.push('\uD83C\uDF11 Shadow Strike blinds you!');
    }
  } else if (opponentMove === 'guard') {
    events.push('\uD83D\uDEE1\uFE0F Enemy raised their guard, bracing for impact.');
  } else if (opponentMove === 'heal') {
    const end = opponent.combatStats.end;
    let healAmt = end * 0.5 + Math.random() * (end * 0.12);
    if (playerMove === 'strike') { healAmt *= 0.75; events.push('\u26A0\uFE0F Enemy healing was disrupted by your strike! (25% reduced)'); }
    else if (playerMove === 'ability') { healAmt *= 0.4; events.push('\u26A0\uFE0F Enemy healing was disrupted by your ability! (60% reduced)'); }
    healAmt = Math.round(healAmt);
    opponentHeal += healAmt;
    if (healAmt > 0) {
      events.push('\uD83D\uDC9A Enemy focused and recovered ' + healAmt + ' HP.');
      const oppHealDr = getPassiveValue(opponent.passives, 'heal_dr');
      if (oppHealDr > 0) { newTempEffects.opponent.push({ effect: 'fortified', value: oppHealDr, roundsLeft: 1 }); events.push('\uD83D\uDEE1\uFE0F Enemy\'s Fortified Heal grants ' + oppHealDr + '% damage reduction!'); }
    }
  } else if (opponentMove === 'counter') {
    events.push('\uD83D\uDD04 Enemy took a counter stance, ready to reflect.');
  }

  // Vulnerable / Fortified
  if (playerVulnerable > 0 && playerDamageTaken > 0) { const bonus = Math.round(playerDamageTaken * playerVulnerable / 100); playerDamageTaken += bonus; if (bonus > 0) events.push('\uD83D\uDC80 Vulnerable! You took ' + bonus + ' extra damage.'); }
  if (playerFortified > 0 && playerDamageTaken > 0) { const reduction = Math.round(playerDamageTaken * playerFortified / 100); playerDamageTaken = Math.max(1, playerDamageTaken - reduction); if (reduction > 0) events.push('\uD83D\uDEE1\uFE0F Fortified! You resisted ' + reduction + ' damage.'); }
  if (opponentVulnerable > 0 && opponentDamageTaken > 0) { const bonus = Math.round(opponentDamageTaken * opponentVulnerable / 100); opponentDamageTaken += bonus; if (bonus > 0) events.push('\uD83D\uDC80 Enemy is vulnerable! They took ' + bonus + ' extra damage.'); }
  if (opponentFortified > 0 && opponentDamageTaken > 0) { const reduction = Math.round(opponentDamageTaken * opponentFortified / 100); opponentDamageTaken = Math.max(1, opponentDamageTaken - reduction); if (reduction > 0) events.push('\uD83D\uDEE1\uFE0F Enemy fortification resisted ' + reduction + ' damage.'); }

  // Class advantage
  const playerClassAdv = getPassiveValue(player.passives, 'class_advantage_bonus');
  if (playerClassAdv > 0 && opponentDamageTaken > 0) { const extra = Math.round(opponentDamageTaken * playerClassAdv / 100); opponentDamageTaken += extra; if (extra > 0) events.push('\u2694\uFE0F Class advantage! +' + extra + ' bonus damage!'); }
  const oppClassAdv = getPassiveValue(opponent.passives, 'class_advantage_bonus');
  if (oppClassAdv > 0 && playerDamageTaken > 0) { const extra = Math.round(playerDamageTaken * oppClassAdv / 100); playerDamageTaken += extra; if (extra > 0) events.push('\u2694\uFE0F Enemy has class advantage! +' + extra + ' extra damage!'); }

  // Elemental system
  battle = battle || {};
  const ec = config.elementConfig || {};
  const elChart = ec.chart || {};
  const playerEl = (elements && elements.player) || 'chaos';
  const opponentEl = (elements && elements.opponent) || 'chaos';
  const ELEMENT_LABELS = { fire: 'Fire', earth: 'Earth', arcane: 'Arcane', shadow: 'Shadow', chaos: 'Chaos' };

  var resolvedPlayerEl = playerEl;
  var resolvedOpponentEl = opponentEl;
  if (playerEl === 'chaos' && !(battle.prismActive && battle.prismActive.player)) {
    var fluxOptions = ['fire', 'earth', 'arcane', 'shadow'];
    resolvedPlayerEl = fluxOptions[Math.floor(Math.random() * 4)];
    events.push('\u26A1 Chaos Flux! Your element shifts to ' + ELEMENT_LABELS[resolvedPlayerEl] + ' this round!');
  }
  if (opponentEl === 'chaos' && !(battle.prismActive && battle.prismActive.opponent)) {
    var fluxOptionsOpp = ['fire', 'earth', 'arcane', 'shadow'];
    resolvedOpponentEl = fluxOptionsOpp[Math.floor(Math.random() * 4)];
    events.push('\u26A1 Chaos Flux! Enemy element shifts to ' + ELEMENT_LABELS[resolvedOpponentEl] + ' this round!');
  }

  // Fire Ignite
  if (resolvedPlayerEl === 'fire' && playerMove !== 'strike' && playerMove !== 'heal' && playerMove !== 'guard') {
    var playerCritted = events.some(function(e) { return e.indexOf('critical') > -1 && e.indexOf('Your') > -1; });
    if (playerCritted && opponentDamageTaken > 0) {
      var burnPct = ((ec.passives || {}).fire || {}).burnPct || 0.08;
      var burnRounds = ((ec.passives || {}).fire || {}).burnRounds || 2;
      newTempEffects.opponent.push({ effect: 'burn', value: Math.round(opponent.maxHp * burnPct), roundsLeft: burnRounds });
      events.push('\uD83D\uDD25 Fire Ignite! Your critical hit sets the enemy ablaze! (Burn x' + burnRounds + ' rounds)');
    }
  }
  if (resolvedOpponentEl === 'fire' && opponentMove !== 'strike' && opponentMove !== 'heal' && opponentMove !== 'guard') {
    var opponentCritted = events.some(function(e) { return e.indexOf('critical') > -1 && e.indexOf('Enemy') > -1; });
    if (opponentCritted && playerDamageTaken > 0) {
      var burnPctOpp = ((ec.passives || {}).fire || {}).burnPct || 0.08;
      var burnRoundsOpp = ((ec.passives || {}).fire || {}).burnRounds || 2;
      newTempEffects.player.push({ effect: 'burn', value: Math.round(player.maxHp * burnPctOpp), roundsLeft: burnRoundsOpp });
      events.push('\uD83D\uDD25 Fire Ignite! Enemy critical hit ignites you! (Burn x' + burnRoundsOpp + ' rounds)');
    }
  }

  // Elemental damage multipliers
  if (playerMove !== 'heal' && opponentDamageTaken > 0) {
    const pc = elChart[resolvedPlayerEl];
    if (pc && pc.strong === resolvedOpponentEl) {
      const elBonus = Math.round(opponentDamageTaken * ((ec.strongMult || 1.25) - 1));
      opponentDamageTaken += elBonus;
      if (elBonus > 0) events.push('\u2728 ' + ELEMENT_LABELS[resolvedPlayerEl] + ' is strong vs ' + ELEMENT_LABELS[resolvedOpponentEl] + '! (+' + elBonus + ' damage)');
    } else if (pc && pc.weak === resolvedOpponentEl) {
      const elReduction = Math.round(opponentDamageTaken * (1 - (ec.weakMult || 0.75)));
      opponentDamageTaken = Math.max(1, opponentDamageTaken - elReduction);
      if (elReduction > 0) events.push('\uD83D\uDCA8 ' + ELEMENT_LABELS[resolvedPlayerEl] + ' is weak vs ' + ELEMENT_LABELS[resolvedOpponentEl] + '. (-' + elReduction + ' damage)');
    }
  }
  if (opponentMove !== 'heal' && playerDamageTaken > 0) {
    const oc = elChart[resolvedOpponentEl];
    if (oc && oc.strong === resolvedPlayerEl) {
      const elBonus = Math.round(playerDamageTaken * ((ec.strongMult || 1.25) - 1));
      playerDamageTaken += elBonus;
      if (elBonus > 0) events.push('\u2728 Enemy ' + ELEMENT_LABELS[resolvedOpponentEl] + ' is strong vs your ' + ELEMENT_LABELS[resolvedPlayerEl] + '! (+' + elBonus + ' damage to you)');
    } else if (oc && oc.weak === resolvedPlayerEl) {
      const elReduction = Math.round(playerDamageTaken * (1 - (ec.weakMult || 0.75)));
      playerDamageTaken = Math.max(1, playerDamageTaken - elReduction);
      if (elReduction > 0) events.push('\uD83D\uDCA8 Enemy ' + ELEMENT_LABELS[resolvedOpponentEl] + ' is weak vs your ' + ELEMENT_LABELS[resolvedPlayerEl] + '. (-' + elReduction + ' damage to you)');
    }
  }

  // Counter resolution
  let playerCounterReflect = false, opponentCounterReflect = false;
  if (playerMove === 'counter' && opponentMove === 'counter') {
    playerDamageTaken = 0; opponentDamageTaken = 0;
    events.push('\uD83D\uDD04 Counter standoff! Both fighters mirror each other \u2014 no damage dealt.');
  } else if (playerMove === 'counter') {
    if (opponentMove === 'strike') {
      const reflected = Math.max(1, Math.round(playerDamageTaken * 0.5));
      opponentDamageTaken += reflected; playerDamageTaken = 0; playerCounterReflect = true;
      events.push('\uD83D\uDD04 Counter! You deflected the strike and reflected ' + reflected + ' damage back!');
    } else if (opponentMove === 'guard') { playerDamageTaken = 0; events.push('\uD83D\uDD04 Counter fizzled \u2014 enemy guarded.'); }
    else events.push('\u274C Your counter failed! Enemy did not strike.');
  } else if (opponentMove === 'counter') {
    if (playerMove === 'strike') {
      const reflected = Math.max(1, Math.round(opponentDamageTaken * 0.5));
      playerDamageTaken += reflected; opponentDamageTaken = 0; opponentCounterReflect = true;
      events.push('\uD83D\uDD04 Counter! Enemy deflected your strike and reflected ' + reflected + ' damage back!');
    } else if (playerMove === 'guard') { opponentDamageTaken = 0; events.push('\uD83D\uDD04 Counter fizzled \u2014 you guarded.'); }
    else events.push('\u274C Enemy counter failed! You did not strike.');
  }

  // Burn DoT
  if (playerBurn > 0) { playerDamageTaken += playerBurn; events.push('\uD83D\uDD25 Burn deals ' + playerBurn + ' damage to you!'); }
  if (opponentBurn > 0) { opponentDamageTaken += opponentBurn; events.push('\uD83D\uDD25 Burn deals ' + opponentBurn + ' damage to enemy!'); }

  newTempEffects.player = [...persistedEffects.player, ...newTempEffects.player];
  newTempEffects.opponent = [...persistedEffects.opponent, ...newTempEffects.opponent];

  // HP regen
  const playerRegenBonus = getPassiveValue(player.passives, 'hp_regen');
  if (playerRegenBonus > 0) { playerHeal += playerRegenBonus; events.push('\uD83D\uDC9A Regen restored ' + playerRegenBonus + ' HP.'); }
  const opponentRegenBonus = getPassiveValue(opponent.passives, 'hp_regen');
  if (opponentRegenBonus > 0) { opponentHeal += opponentRegenBonus; }

  // Stamina exhaustion
  if (playerExhausted) { var pBurnPct = playerStance === 'defensive' ? exhaustionBurnPct * 0.5 : exhaustionBurnPct; const burn = Math.max(3, Math.round(player.maxHp * pBurnPct)); playerDamageTaken += burn; events.push('\u26A1 Exhaustion burns ' + burn + ' HP!'); }
  if (opponentExhausted) { var oBurnPct = opponentStance === 'defensive' ? exhaustionBurnPct * 0.5 : exhaustionBurnPct; const burn = Math.max(3, Math.round(opponent.maxHp * oBurnPct)); opponentDamageTaken += burn; events.push('\u26A1 Enemy exhaustion burns ' + burn + ' HP!'); }

  // Stance multipliers
  if (playerStance === 'aggressive') opponentDamageTaken = Math.floor(opponentDamageTaken * 1.25);
  if (playerStance === 'defensive') opponentDamageTaken = Math.floor(opponentDamageTaken * 0.8);
  if (opponentStance === 'aggressive') playerDamageTaken = Math.floor(playerDamageTaken * 1.25);
  if (opponentStance === 'defensive') playerDamageTaken = Math.floor(playerDamageTaken * 0.8);
  if (playerStance === 'aggressive') playerDamageTaken = Math.floor(playerDamageTaken * 1.2);
  if (opponentStance === 'aggressive') opponentDamageTaken = Math.floor(opponentDamageTaken * 1.2);
  if (playerStance === 'defensive' && playerHeal > 0) playerHeal = Math.floor(playerHeal * 1.3);
  if (opponentStance === 'defensive' && opponentHeal > 0) opponentHeal = Math.floor(opponentHeal * 1.3);

  const parts = [];
  if (opponentDamageTaken > 0) parts.push('dealt ' + opponentDamageTaken + ' dmg');
  if (playerHeal > 0) parts.push('healed ' + playerHeal + ' HP');
  if (playerDamageTaken > 0) parts.push('took ' + playerDamageTaken + ' dmg');
  if (parts.length > 0) events.push('\uD83D\uDCCA Net: You ' + parts.join(', ') + '.');

  return { speedWinner, playerDamageTaken, opponentDamageTaken, playerHeal, opponentHeal, events, newTempEffects, playerCounterReflect, opponentCounterReflect };
}

// ═══════════════════════════════════════════════════════════════════════════
// ELO & SPARKS
// ═══════════════════════════════════════════════════════════════════════════

function calcEloChange(playerElo, opponentElo, won) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  const score = won ? 1 : 0;
  return Math.round(ELO_K * (score - expected));
}

function calcSparksPayout(won, eloGap) {
  let base = won ? 20 : 5;
  if (won && eloGap > 0) base += Math.min(15, Math.floor(eloGap / 50));
  return base;
}

// ═══════════════════════════════════════════════════════════════════════════
// MATCHMAKING
// ═══════════════════════════════════════════════════════════════════════════

async function handleQueue(context, containerClient, userId, body) {
  const { cardId, cardData, eloRange } = body;
  if (!cardId || !cardData) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'cardId and cardData are required' } };
    return;
  }

  const config = loadArenaConfig();
  const range = Math.min(500, Math.max(50, eloRange || 100));

  // Load player profile for Elo
  const profile = await downloadJsonBlob(containerClient, 'blindspot/profiles/' + userId + '.json');
  const playerElo = (profile && profile.pvpElo) || ELO_DEFAULT;
  const playerRank = computeRank((profile && profile.xp) || 0);

  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data: rawQueue, etag } = await downloadBlobWithETag(containerClient, QUEUE_BLOB);
    let queue = Array.isArray(rawQueue) ? rawQueue : [];

    // Stale GC — remove entries older than 120s
    const now = Date.now();
    queue = queue.filter(function(e) { return (now - new Date(e.joinedAt).getTime()) < QUEUE_ENTRY_TTL_MS; });

    // Check if player is already in queue
    const existing = queue.find(function(e) { return e.userId === userId; });
    if (existing) {
      // Update eloRange if re-queuing
      existing.eloRange = range;
      try {
        await uploadBlobConditional(containerClient, QUEUE_BLOB, queue, etag);
        context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'queued', message: 'Already in queue, range updated' } };
        return;
      } catch (err) {
        if (err.statusCode === 412) { await backoffDelay(attempt); continue; }
        throw err;
      }
    }

    // Scan for a compatible match
    let matchIdx = -1;
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      if (entry.userId === userId) continue;
      const eloDiff = Math.abs(playerElo - entry.elo);
      if (eloDiff <= Math.min(range, entry.eloRange)) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx >= 0) {
      // Match found — create battle
      const opponent = queue[matchIdx];
      queue.splice(matchIdx, 1);

      try {
        await uploadBlobConditional(containerClient, QUEUE_BLOB, queue, etag);
      } catch (err) {
        if (err.statusCode === 412) { await backoffDelay(attempt); continue; }
        throw err;
      }

      // Create battle blob
      const battle = createLiveBattle(userId, cardData, playerElo, playerRank, opponent, config);
      await uploadJsonBlob(containerClient, 'arena/battles/' + battle.battleId + '.json', battle);

      // Set activeLiveBattle on both profiles
      await setActiveBattle(containerClient, userId, battle.battleId);
      await setActiveBattle(containerClient, opponent.userId, battle.battleId);

      context.log('[LivePvP] Match created: ' + battle.battleId + ' (' + userId + ' vs ' + opponent.userId + ')');
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'matched', battleId: battle.battleId } };
      return;
    }

    // No match — add to queue
    queue.push({
      userId: userId,
      cardId: cardId,
      cardSnapshot: { name: cardData.name, class: cardData.class, avatar: cardData.avatar, rarity: cardData.rarity },
      cardData: cardData,
      elo: playerElo,
      rank: playerRank,
      eloRange: range,
      joinedAt: new Date().toISOString()
    });

    try {
      await uploadBlobConditional(containerClient, QUEUE_BLOB, queue, etag);
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'queued', message: 'Searching for opponent...' } };
      return;
    } catch (err) {
      if (err.statusCode === 412) { await backoffDelay(attempt); continue; }
      throw err;
    }
  }

  context.res = { status: 503, headers: CORS_HEADERS, body: { error: 'Matchmaking busy, try again' } };
}

async function handleCancel(context, containerClient, userId) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data: rawQueue, etag } = await downloadBlobWithETag(containerClient, QUEUE_BLOB);
    let queue = Array.isArray(rawQueue) ? rawQueue : [];
    const before = queue.length;
    queue = queue.filter(function(e) { return e.userId !== userId; });
    if (queue.length === before) {
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', message: 'Not in queue' } };
      return;
    }
    try {
      await uploadBlobConditional(containerClient, QUEUE_BLOB, queue, etag);
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok', message: 'Removed from queue' } };
      return;
    } catch (err) {
      if (err.statusCode === 412) { await backoffDelay(attempt); continue; }
      throw err;
    }
  }
  context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'ok' } };
}

async function handleQueueStatus(context, containerClient, userId, query) {
  // Check if player has an active battle (was matched)
  const profile = await downloadJsonBlob(containerClient, 'blindspot/profiles/' + userId + '.json');
  if (profile && profile.activeLiveBattle) {
    const battlePath = 'arena/battles/' + profile.activeLiveBattle + '.json';
    const battle = await downloadJsonBlob(containerClient, battlePath);
    if (battle && battle.status === 'active') {
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'matched', battleId: profile.activeLiveBattle } };
      return;
    }
    // Battle no longer active — clear stale reference
    profile.activeLiveBattle = null;
    await uploadJsonBlob(containerClient, 'blindspot/profiles/' + userId + '.json', profile);
  }

  // Check if still in queue
  const queue = await downloadJsonBlob(containerClient, QUEUE_BLOB) || [];
  const inQueue = queue.find(function(e) { return e.userId === userId; });

  // Update eloRange from client if provided
  if (inQueue && query.eloRange) {
    inQueue.eloRange = Math.min(500, Math.max(50, parseInt(query.eloRange) || 100));
    // Best-effort update — don't retry on conflict for a poll
    try { await uploadJsonBlob(containerClient, QUEUE_BLOB, queue); } catch (e) { /* silent */ }

    // Re-check for match with expanded range
    const playerElo = inQueue.elo;
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      if (entry.userId === userId) continue;
      const eloDiff = Math.abs(playerElo - entry.elo);
      if (eloDiff <= Math.min(inQueue.eloRange, entry.eloRange)) {
        // Match found on poll — trigger match
        const config = loadArenaConfig();
        const opponent = entry;
        const playerRank = inQueue.rank || 'bronze';

        // Remove both from queue
        const filtered = queue.filter(function(e) { return e.userId !== userId && e.userId !== opponent.userId; });
        try { await uploadJsonBlob(containerClient, QUEUE_BLOB, filtered); } catch (e) { /* best effort */ }

        const battle = createLiveBattle(userId, inQueue.cardData, playerElo, playerRank, opponent, config);
        await uploadJsonBlob(containerClient, 'arena/battles/' + battle.battleId + '.json', battle);
        await setActiveBattle(containerClient, userId, battle.battleId);
        await setActiveBattle(containerClient, opponent.userId, battle.battleId);

        context.log('[LivePvP] Match on poll: ' + battle.battleId);
        context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'matched', battleId: battle.battleId } };
        return;
      }
    }
  }

  if (inQueue) {
    const waitTime = Date.now() - new Date(inQueue.joinedAt).getTime();
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'queued', waitTime: waitTime, eloRange: inQueue.eloRange } };
  } else {
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'idle' } };
  }
}

// ── Battle creation helper ──

function createLiveBattle(userId, playerCardData, playerElo, playerRank, opponentEntry, config) {
  const battleId = 'bs-live-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
  const now = new Date().toISOString();

  const playerCombat = mapCardToCombatStats(playerCardData);
  const opponentCombat = mapCardToCombatStats(opponentEntry.cardData);

  const playerPassives = computePassives(playerCardData, playerRank);
  const opponentPassives = computePassives(opponentEntry.cardData, opponentEntry.rank || 'bronze');
  playerPassives.push(...computeStatThresholdPassives(playerCombat));
  opponentPassives.push(...computeStatThresholdPassives(opponentCombat));
  applyStatPassives(playerCombat, playerPassives);
  applyStatPassives(opponentCombat, opponentPassives);

  const playerMaxHp = computeMaxHp(playerCombat);
  const opponentMaxHp = computeMaxHp(opponentCombat);

  const playerAbilityKey = getAbilityKey(playerCardData.class, playerCombat, config);
  const opponentAbilityKey = getAbilityKey(opponentEntry.cardData.class, opponentCombat, config);

  const cc = config.chargeConfig || {};
  const playerChargeRate = computeChargeRate(playerCombat, 0, config);
  const opponentChargeRate = computeChargeRate(opponentCombat, 0, config);

  const stc = config.staminaConfig || {};
  const playerMaxStamina = (stc.basePool || 15) + Math.floor((playerCombat.end || 0) / (stc.endPoolBonus || 10));
  const opponentMaxStamina = (stc.basePool || 15) + Math.floor((opponentCombat.end || 0) / (stc.endPoolBonus || 10));
  const playerStaminaRegen = (stc.baseRegen || 2) + Math.floor((playerCombat.end || 0) / (stc.endRegenDiv || 40));
  const opponentStaminaRegen = (stc.baseRegen || 2) + Math.floor((opponentCombat.end || 0) / (stc.endRegenDiv || 40));

  // Elements
  const ecDefs = config.elementConfig || {};
  const playerElement = playerCardData.element || (ecDefs.classDefaults || {})[playerCardData.class] || 'chaos';
  const opponentElement = opponentEntry.cardData.element || (ecDefs.classDefaults || {})[opponentEntry.cardData.class] || 'chaos';

  // Element passives
  const elPassives = ecDefs.passives || {};
  if (playerElement === 'earth' && elPassives.earth) playerPassives.push({ source: 'element:earth', effect: 'dmg_reduction', value: elPassives.earth.drValue || 5 });
  if (playerElement === 'shadow' && elPassives.shadow) playerPassives.push({ source: 'element:shadow', effect: 'dodge', value: elPassives.shadow.dodgeValue || 5 });
  if (opponentElement === 'earth' && elPassives.earth) opponentPassives.push({ source: 'element:earth', effect: 'dmg_reduction', value: elPassives.earth.drValue || 5 });
  if (opponentElement === 'shadow' && elPassives.shadow) opponentPassives.push({ source: 'element:shadow', effect: 'dodge', value: elPassives.shadow.dodgeValue || 5 });

  // Class advantage
  const classAdvTable = config.classAdvantages || {};
  const classAdvBonus = config.classAdvantageBonus || 20;
  const pClass = playerCardData.class || '';
  const oClass = opponentEntry.cardData.class || '';
  if (classAdvTable[pClass] && classAdvTable[pClass].includes(oClass)) playerPassives.push({ source: 'class_advantage', effect: 'class_advantage_bonus', value: classAdvBonus });
  if (classAdvTable[oClass] && classAdvTable[oClass].includes(pClass)) opponentPassives.push({ source: 'class_advantage', effect: 'class_advantage_bonus', value: classAdvBonus });

  const roundDeadline = new Date(Date.now() + ROUND_TIMEOUT_MS).toISOString();

  const battleState = {
    battleId: battleId,
    type: 'live_pvp',
    status: 'active',
    currentRound: 1,
    totalRounds: config.totalRounds,
    player1: {
      userId: userId,
      cardId: playerCardData.id || playerCardData.cardId,
      cardSnapshot: { name: playerCardData.name, class: playerCardData.class, avatar: playerCardData.avatar, rarity: playerCardData.rarity },
      combatStats: playerCombat,
      maxHp: playerMaxHp,
      hp: playerMaxHp,
      passives: playerPassives,
      abilityKey: playerAbilityKey,
      elo: playerElo
    },
    player2: {
      userId: opponentEntry.userId,
      cardId: opponentEntry.cardId,
      cardSnapshot: opponentEntry.cardSnapshot,
      combatStats: opponentCombat,
      maxHp: opponentMaxHp,
      hp: opponentMaxHp,
      passives: opponentPassives,
      abilityKey: opponentAbilityKey,
      elo: opponentEntry.elo || ELO_DEFAULT
    },
    charges: { player1: cc.startCharges || 0, player2: cc.startCharges || 0 },
    chargeRate: { player1: playerChargeRate, player2: opponentChargeRate },
    stamina: { player1: playerMaxStamina, player2: opponentMaxStamina },
    maxStamina: { player1: playerMaxStamina, player2: opponentMaxStamina },
    staminaRegen: { player1: playerStaminaRegen, player2: opponentStaminaRegen },
    cooldowns: { player1: {}, player2: {} },
    stances: { player1: 'balanced', player2: 'balanced' },
    elements: { player1: playerElement, player2: opponentElement },
    tempEffects: { player1: [], player2: [] },
    pendingMoves: { player1: null, player2: null },
    roundDeadline: roundDeadline,
    lastActivity: { player1: now, player2: now },
    disconnectRounds: { player1: 0, player2: 0 },
    roundLog: [],
    winner: null,
    createdAt: now
  };

  // Arcane element: +1 starting charge
  if (playerElement === 'arcane' && elPassives.arcane) battleState.charges.player1 = Math.min(cc.maxCharges || 4, battleState.charges.player1 + (elPassives.arcane.extraCharges || 1));
  if (opponentElement === 'arcane' && elPassives.arcane) battleState.charges.player2 = Math.min(cc.maxCharges || 4, battleState.charges.player2 + (elPassives.arcane.extraCharges || 1));

  return battleState;
}

async function setActiveBattle(containerClient, usrId, battleId) {
  const profilePath = 'blindspot/profiles/' + usrId + '.json';
  const profile = await downloadJsonBlob(containerClient, profilePath);
  if (profile) {
    profile.activeLiveBattle = battleId;
    await uploadJsonBlob(containerClient, profilePath, profile);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BATTLE ACTIONS — move, poll, forfeit
// ═══════════════════════════════════════════════════════════════════════════

async function handleMove(context, containerClient, userId, body) {
  const { battleId, round } = body;
  const VALID_MOVES = ['strike', 'guard', 'ability', 'heal', 'counter'];

  let playerMoves;
  if (Array.isArray(body.moves) && body.moves.length === 2) {
    playerMoves = body.moves;
  } else if (body.move && VALID_MOVES.includes(body.move)) {
    playerMoves = [body.move, 'guard'];
  } else {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'moves (array of 2) required' } };
    return;
  }
  if (!battleId || !round) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'battleId and round required' } };
    return;
  }
  if (!playerMoves.every(function(m) { return VALID_MOVES.includes(m); })) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid move' } };
    return;
  }
  var cdMoves = playerMoves.filter(function(m) { return m === 'heal' || m === 'counter' || m === 'ability'; });
  if (cdMoves.length !== new Set(cdMoves).size) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'CD moves can only appear once per turn' } };
    return;
  }

  const battlePath = 'arena/battles/' + battleId + '.json';
  const maxRetries = 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data: battle, etag } = await downloadBlobWithETag(containerClient, battlePath);
    if (!battle) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Battle not found' } }; return; }
    if (battle.status !== 'active') { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Battle is complete' } }; return; }

    // Check idle TTL
    const maxActivity = Math.max(new Date(battle.lastActivity.player1).getTime(), new Date(battle.lastActivity.player2).getTime());
    if (Date.now() - maxActivity > MAX_IDLE_TTL_MS) {
      await finalizeBattle(containerClient, battle, null, 'idle', context);
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'expired', message: 'Battle expired due to inactivity' } };
      return;
    }

    // Determine which slot this user is
    const slot = battle.player1.userId === userId ? 'player1' : battle.player2.userId === userId ? 'player2' : null;
    if (!slot) { context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Not your battle' } }; return; }

    if (round !== battle.currentRound) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Expected round ' + battle.currentRound } };
      return;
    }

    // Already submitted this round
    if (battle.pendingMoves[slot]) {
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'waiting', message: 'Already submitted, waiting for opponent' } };
      return;
    }

    const config = loadArenaConfig();
    const player = battle[slot];
    const cc = config.chargeConfig || {};

    // Validate charges
    const abilityDiscount = getPassiveValue(player.passives || [], 'ability_discount');
    const abilityCost = Math.max(1, (cc.abilityCost || 2) - abilityDiscount);
    if (playerMoves.includes('ability') && battle.charges[slot] < abilityCost) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Not enough charges' } };
      return;
    }

    // Validate stamina for ability
    if (playerMoves.includes('ability') && battle.stamina) {
      const staCost = getStaminaCost('ability', player.passives || [], config);
      if (battle.stamina[slot] < staCost) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Not enough stamina for Ability' } };
        return;
      }
    }

    // Validate cooldowns
    for (var mi = 0; mi < playerMoves.length; mi++) {
      var pm = playerMoves[mi];
      if (battle.cooldowns[slot] && battle.cooldowns[slot][pm] > 0) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: pm + ' is on cooldown (' + battle.cooldowns[slot][pm] + ' rounds)' } };
        return;
      }
    }

    // Store pending moves
    battle.pendingMoves[slot] = { moves: playerMoves, stance: body.stance || battle.stances[slot] };
    battle.lastActivity[slot] = new Date().toISOString();
    battle.disconnectRounds[slot] = 0;

    // Handle stance switch
    if (body.stance && ['aggressive', 'defensive', 'balanced'].includes(body.stance)) {
      const stCfg = config.stanceConfig || {};
      const switchCost = body.stance === 'balanced' ? 0 : (stCfg.switchCost || 2);
      if (!battle.stamina || battle.stamina[slot] >= switchCost) {
        if (battle.stamina && switchCost > 0) battle.stamina[slot] -= switchCost;
        battle.stances[slot] = body.stance;
      }
    }

    // Check timeout on the OTHER player
    const otherSlot = slot === 'player1' ? 'player2' : 'player1';
    const now = Date.now();
    if (!battle.pendingMoves[otherSlot] && new Date(battle.roundDeadline).getTime() < now) {
      // Other player timed out — auto-submit guard/guard defensive
      battle.pendingMoves[otherSlot] = { moves: ['guard', 'guard'], stance: 'defensive' };
      battle.stances[otherSlot] = 'defensive';
      battle.disconnectRounds[otherSlot] = (battle.disconnectRounds[otherSlot] || 0) + 1;
      context.log('[LivePvP] Timeout auto-guard for ' + otherSlot + ' (round ' + battle.currentRound + ')');
    }

    // Check if both moves are in
    if (battle.pendingMoves.player1 && battle.pendingMoves.player2) {
      const roundResult = executeLiveRound(battle, config);

      // Check for auto-forfeit due to consecutive disconnects
      if (battle.disconnectRounds.player1 >= MAX_DISCONNECT_ROUNDS) {
        battle.winner = 'player2';
        battle.status = 'complete';
        battle.finishReason = 'disconnect';
      } else if (battle.disconnectRounds.player2 >= MAX_DISCONNECT_ROUNDS) {
        battle.winner = 'player1';
        battle.status = 'complete';
        battle.finishReason = 'disconnect';
      }

      // Check KO
      if (battle.status === 'active') {
        if (battle.player1.hp <= 0 && battle.player2.hp <= 0) {
          battle.winner = null; // Draw
          battle.status = 'complete';
          battle.finishReason = 'double_ko';
        } else if (battle.player1.hp <= 0) {
          battle.winner = 'player2';
          battle.status = 'complete';
          battle.finishReason = 'ko';
        } else if (battle.player2.hp <= 0) {
          battle.winner = 'player1';
          battle.status = 'complete';
          battle.finishReason = 'ko';
        }
      }

      try {
        await uploadBlobConditional(containerClient, battlePath, battle, etag);
      } catch (err) {
        if (err.statusCode === 412) { await backoffDelay(attempt); continue; }
        throw err;
      }

      if (battle.status === 'complete') {
        await finalizeBattle(containerClient, battle, battle.winner, battle.finishReason, context);
      }

      const perspectiveResult = perspectiveShift(roundResult, slot);
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'resolved', roundResult: perspectiveResult, battleStatus: battle.status, winner: battle.winner === slot ? 'you' : battle.winner ? 'opponent' : null } };
      return;
    }

    // Only one player submitted — upload and return waiting
    try {
      await uploadBlobConditional(containerClient, battlePath, battle, etag);
      context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'waiting', message: 'Move locked in. Waiting for opponent...' } };
      return;
    } catch (err) {
      if (err.statusCode === 412) { await backoffDelay(attempt); continue; }
      throw err;
    }
  }

  context.res = { status: 503, headers: CORS_HEADERS, body: { error: 'Concurrency conflict, try again' } };
}

function executeLiveRound(battle, config) {
  const p1Moves = battle.pendingMoves.player1;
  const p2Moves = battle.pendingMoves.player2;
  const cc = config.chargeConfig || {};

  // Deduct stamina for both players' moves
  for (const slot of ['player1', 'player2']) {
    const moves = battle.pendingMoves[slot].moves;
    const passives = battle[slot].passives || [];
    for (const m of moves) {
      const cost = getStaminaCost(m, passives, config);
      if (battle.stamina) battle.stamina[slot] = Math.max(0, (battle.stamina[slot] || 0) - cost);
    }
    // Deduct charges for ability
    if (moves.includes('ability')) {
      const discount = getPassiveValue(passives, 'ability_discount');
      const abCost = Math.max(1, (cc.abilityCost || 2) - discount);
      battle.charges[slot] = Math.max(0, (battle.charges[slot] || 0) - abCost);
    }
  }

  // Convert player1/player2 to player/opponent for resolveRound
  const p1AsPlayer = { combatStats: battle.player1.combatStats, passives: battle.player1.passives, maxHp: battle.player1.maxHp, abilityKey: battle.player1.abilityKey };
  const p2AsOpponent = { combatStats: battle.player2.combatStats, passives: battle.player2.passives, maxHp: battle.player2.maxHp, abilityKey: battle.player2.abilityKey };

  // Resolve both move slots
  const stanceState1 = { player: battle.stances.player1, opponent: battle.stances.player2 };
  const elements1 = { player: battle.elements.player1, opponent: battle.elements.player2 };
  const tempEffects1 = { player: battle.tempEffects.player1 || [], opponent: battle.tempEffects.player2 || [] };

  // Slot 1
  const result1 = resolveRound(p1AsPlayer, p2AsOpponent, p1Moves.moves[0], p2Moves.moves[0], tempEffects1, { player: battle.stamina.player1, opponent: battle.stamina.player2 }, stanceState1, elements1, battle);

  // Apply slot 1 damage
  battle.player1.hp = Math.max(0, battle.player1.hp - result1.playerDamageTaken + result1.playerHeal);
  battle.player2.hp = Math.max(0, battle.player2.hp - result1.opponentDamageTaken + result1.opponentHeal);
  battle.player1.hp = Math.min(battle.player1.hp, battle.player1.maxHp);
  battle.player2.hp = Math.min(battle.player2.hp, battle.player2.maxHp);

  // If someone is KO'd after slot 1, skip slot 2
  let result2 = null;
  if (battle.player1.hp > 0 && battle.player2.hp > 0) {
    const tempEffects2 = { player: result1.newTempEffects.player || [], opponent: result1.newTempEffects.opponent || [] };
    const stanceState2 = { player: battle.stances.player1, opponent: battle.stances.player2 };

    result2 = resolveRound(p1AsPlayer, p2AsOpponent, p1Moves.moves[1], p2Moves.moves[1], tempEffects2, { player: battle.stamina.player1, opponent: battle.stamina.player2 }, stanceState2, elements1, battle);

    battle.player1.hp = Math.max(0, battle.player1.hp - result2.playerDamageTaken + result2.playerHeal);
    battle.player2.hp = Math.max(0, battle.player2.hp - result2.opponentDamageTaken + result2.opponentHeal);
    battle.player1.hp = Math.min(battle.player1.hp, battle.player1.maxHp);
    battle.player2.hp = Math.min(battle.player2.hp, battle.player2.maxHp);

    battle.tempEffects.player1 = result2.newTempEffects.player || [];
    battle.tempEffects.player2 = result2.newTempEffects.opponent || [];
  } else {
    battle.tempEffects.player1 = result1.newTempEffects.player || [];
    battle.tempEffects.player2 = result1.newTempEffects.opponent || [];
  }

  // Update cooldowns
  const cdConfig = config.cooldownConfig || {};
  for (const slot of ['player1', 'player2']) {
    const moves = battle.pendingMoves[slot].moves;
    // Tick down existing cooldowns
    for (const m of Object.keys(battle.cooldowns[slot] || {})) {
      if (battle.cooldowns[slot][m] > 0) battle.cooldowns[slot][m]--;
      if (battle.cooldowns[slot][m] <= 0) delete battle.cooldowns[slot][m];
    }
    // Apply new cooldowns
    for (const m of moves) {
      if (cdConfig[m] > 0) battle.cooldowns[slot][m] = cdConfig[m];
    }
  }

  // Charge regen
  for (const slot of ['player1', 'player2']) {
    battle.charges[slot] = Math.min(cc.maxCharges || 4, (battle.charges[slot] || 0) + (battle.chargeRate[slot] || 1));
  }

  // Stamina regen
  for (const slot of ['player1', 'player2']) {
    if (battle.stamina) {
      battle.stamina[slot] = Math.min(battle.maxStamina[slot] || 20, (battle.stamina[slot] || 0) + (battle.staminaRegen[slot] || 2));
    }
  }

  // Build combined round result
  const roundResult = {
    round: battle.currentRound,
    player1Move: p1Moves.moves,
    player2Move: p2Moves.moves,
    player1Stance: battle.stances.player1,
    player2Stance: battle.stances.player2,
    player1Hp: battle.player1.hp,
    player2Hp: battle.player2.hp,
    player1MaxHp: battle.player1.maxHp,
    player2MaxHp: battle.player2.maxHp,
    slot1Events: result1.events,
    slot2Events: result2 ? result2.events : [],
    slot1SpeedWinner: result1.speedWinner,
    slot2SpeedWinner: result2 ? result2.speedWinner : null,
    slot1PlayerDmgTaken: result1.playerDamageTaken,
    slot1OpponentDmgTaken: result1.opponentDamageTaken,
    slot1PlayerHeal: result1.playerHeal,
    slot1OpponentHeal: result1.opponentHeal,
    slot1PlayerCounterReflect: result1.playerCounterReflect,
    slot1OpponentCounterReflect: result1.opponentCounterReflect,
    slot2PlayerDmgTaken: result2 ? result2.playerDamageTaken : 0,
    slot2OpponentDmgTaken: result2 ? result2.opponentDamageTaken : 0,
    slot2PlayerHeal: result2 ? result2.playerHeal : 0,
    slot2OpponentHeal: result2 ? result2.opponentHeal : 0,
    slot2PlayerCounterReflect: result2 ? result2.playerCounterReflect : false,
    slot2OpponentCounterReflect: result2 ? result2.opponentCounterReflect : false,
    charges: { ...battle.charges },
    stamina: { ...battle.stamina },
    cooldowns: JSON.parse(JSON.stringify(battle.cooldowns)),
    tempEffects: { player1: battle.tempEffects.player1, player2: battle.tempEffects.player2 }
  };

  // Store last round result for poll-based clients to pick up
  battle.lastRoundResult = roundResult;

  battle.roundLog.push({ round: battle.currentRound, p1: p1Moves.moves, p2: p2Moves.moves });
  battle.currentRound++;
  battle.pendingMoves = { player1: null, player2: null };
  battle.roundDeadline = new Date(Date.now() + ROUND_TIMEOUT_MS).toISOString();

  return roundResult;
}

// Translate round result from player1/player2 to my/opponent perspective
function perspectiveShift(roundResult, mySlot) {
  const other = mySlot === 'player1' ? 'player2' : 'player1';
  // For player1: "Player" in resolveRound = me, "Opponent" = them
  // For player2: swap — "Player" damage taken = their damage taken, "Opponent" = mine
  var myPrefix = mySlot === 'player1' ? 'Player' : 'Opponent';
  var oppPrefix = mySlot === 'player1' ? 'Opponent' : 'Player';
  return {
    round: roundResult.round,
    myMoves: roundResult[mySlot + 'Move'],
    opponentMoves: roundResult[other + 'Move'],
    myStance: roundResult[mySlot + 'Stance'],
    opponentStance: roundResult[other + 'Stance'],
    myHp: roundResult[mySlot + 'Hp'],
    opponentHp: roundResult[other + 'Hp'],
    myMaxHp: roundResult[mySlot + 'MaxHp'],
    opponentMaxHp: roundResult[other + 'MaxHp'],
    // Events are written from player1 perspective — swap if we're player2
    slot1Events: mySlot === 'player1' ? roundResult.slot1Events : swapEventPerspective(roundResult.slot1Events),
    slot2Events: mySlot === 'player1' ? roundResult.slot2Events : swapEventPerspective(roundResult.slot2Events),
    slot1SpeedWinner: flipSpeed(roundResult.slot1SpeedWinner, mySlot),
    slot2SpeedWinner: flipSpeed(roundResult.slot2SpeedWinner, mySlot),
    // Damage/heal: swap if player2 (resolveRound uses player1 as "player")
    slot1MyDmgTaken: roundResult['slot1' + myPrefix + 'DmgTaken'],
    slot1OpponentDmgTaken: roundResult['slot1' + oppPrefix + 'DmgTaken'],
    slot1MyHeal: roundResult['slot1' + myPrefix + 'Heal'],
    slot1OpponentHeal: roundResult['slot1' + oppPrefix + 'Heal'],
    slot1MyCounterReflect: roundResult['slot1' + myPrefix + 'CounterReflect'],
    slot1OpponentCounterReflect: roundResult['slot1' + oppPrefix + 'CounterReflect'],
    slot2MyDmgTaken: roundResult['slot2' + myPrefix + 'DmgTaken'],
    slot2OpponentDmgTaken: roundResult['slot2' + oppPrefix + 'DmgTaken'],
    slot2MyHeal: roundResult['slot2' + myPrefix + 'Heal'],
    slot2OpponentHeal: roundResult['slot2' + oppPrefix + 'Heal'],
    slot2MyCounterReflect: roundResult['slot2' + myPrefix + 'CounterReflect'],
    slot2OpponentCounterReflect: roundResult['slot2' + oppPrefix + 'CounterReflect'],
    charges: { my: roundResult.charges[mySlot], opponent: roundResult.charges[other] },
    stamina: { my: roundResult.stamina[mySlot], opponent: roundResult.stamina[other] },
    cooldowns: { my: roundResult.cooldowns[mySlot], opponent: roundResult.cooldowns[other] },
    tempEffects: { my: roundResult.tempEffects[mySlot], opponent: roundResult.tempEffects[other] }
  };
}

function flipSpeed(sw, mySlot) {
  if (!sw) return null;
  if (mySlot === 'player1') return sw; // player = me
  return sw === 'player' ? 'opponent' : sw === 'opponent' ? 'player' : sw;
}

function swapEventPerspective(events) {
  if (!events) return [];
  return events.map(function(e) {
    return e
      .replace(/\bYour\b/g, '##THEIR##')
      .replace(/\bYou\b/g, '##THEY##')
      .replace(/\bEnemy's\b/g, 'Your')
      .replace(/\bEnemy\b/g, 'You')
      .replace(/##THEIR##/g, "Enemy's")
      .replace(/##THEY##/g, 'Enemy');
  });
}

async function handlePoll(context, containerClient, userId, query) {
  const battleId = query.battleId;
  if (!battleId) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'battleId required' } }; return; }

  const battlePath = 'arena/battles/' + battleId + '.json';
  const battle = await downloadJsonBlob(containerClient, battlePath);
  if (!battle) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Battle not found' } }; return; }

  const slot = battle.player1.userId === userId ? 'player1' : battle.player2.userId === userId ? 'player2' : null;
  if (!slot) { context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Not your battle' } }; return; }

  const other = slot === 'player1' ? 'player2' : 'player1';
  const now = new Date();

  // Update last activity (best-effort, no ETag)
  battle.lastActivity[slot] = now.toISOString();
  try { await uploadJsonBlob(containerClient, battlePath, battle); } catch (e) { /* silent */ }

  // Check idle TTL
  const maxActivity = Math.max(new Date(battle.lastActivity.player1).getTime(), new Date(battle.lastActivity.player2).getTime());
  if (Date.now() - maxActivity > MAX_IDLE_TTL_MS && battle.status === 'active') {
    await finalizeBattle(containerClient, battle, null, 'idle', context);
    context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'expired', message: 'Battle expired due to inactivity' } };
    return;
  }

  const config = loadArenaConfig();
  const cc = config.chargeConfig || {};

  // Build perspective-shifted response
  const resp = {
    status: battle.status,
    currentRound: battle.currentRound,
    roundDeadline: battle.roundDeadline,
    serverTime: now.toISOString(),
    myHp: battle[slot].hp,
    myMaxHp: battle[slot].maxHp,
    opponentHp: battle[other].hp,
    opponentMaxHp: battle[other].maxHp,
    myCard: battle[slot].cardSnapshot,
    opponentCard: battle[other].cardSnapshot,
    myElement: battle.elements[slot],
    opponentElement: battle.elements[other],
    myAbilityKey: battle[slot].abilityKey,
    opponentAbilityKey: battle[other].abilityKey,
    myCharges: battle.charges[slot],
    opponentCharges: battle.charges[other],
    myStamina: battle.stamina[slot],
    opponentStamina: battle.stamina[other],
    myMaxStamina: battle.maxStamina[slot],
    opponentMaxStamina: battle.maxStamina[other],
    myStance: battle.stances[slot],
    opponentStance: battle.stances[other],
    myCooldowns: battle.cooldowns[slot],
    opponentCooldowns: battle.cooldowns[other],
    myTempEffects: battle.tempEffects[slot],
    opponentTempEffects: battle.tempEffects[other],
    myMoveSubmitted: !!battle.pendingMoves[slot],
    opponentMoveSubmitted: !!battle.pendingMoves[other],
    myCombatStats: battle[slot].combatStats,
    opponentCombatStats: battle[other].combatStats,
    myPassives: battle[slot].passives,
    abilityCost: Math.max(1, (cc.abilityCost || 2) - getPassiveValue(battle[slot].passives || [], 'ability_discount')),
    maxCharges: cc.maxCharges || 4,
    abilityDefs: config.abilityDefs
  };

  if (battle.status === 'complete') {
    resp.winner = battle.winner === slot ? 'you' : battle.winner === other ? 'opponent' : 'draw';
    resp.finishReason = battle.finishReason;
  }

  // Include last round result if available
  if (battle.lastRoundResult) {
    resp.lastRoundResult = perspectiveShift(battle.lastRoundResult, slot);
  }

  context.res = { status: 200, headers: CORS_HEADERS, body: resp };
}

async function handleForfeit(context, containerClient, userId, body) {
  const { battleId } = body;
  if (!battleId) { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'battleId required' } }; return; }

  const battlePath = 'arena/battles/' + battleId + '.json';
  const battle = await downloadJsonBlob(containerClient, battlePath);
  if (!battle) { context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Battle not found' } }; return; }
  if (battle.status !== 'active') { context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Battle already complete' } }; return; }

  const slot = battle.player1.userId === userId ? 'player1' : battle.player2.userId === userId ? 'player2' : null;
  if (!slot) { context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Not your battle' } }; return; }

  const winner = slot === 'player1' ? 'player2' : 'player1';
  battle.winner = winner;
  battle.status = 'complete';
  battle.finishReason = 'forfeit';
  await uploadJsonBlob(containerClient, battlePath, battle);
  await finalizeBattle(containerClient, battle, winner, 'forfeit', context);

  context.res = { status: 200, headers: CORS_HEADERS, body: { status: 'forfeited', winner: 'opponent' } };
}

// ═══════════════════════════════════════════════════════════════════════════
// FINALIZATION — Elo & Sparks
// ═══════════════════════════════════════════════════════════════════════════

async function finalizeBattle(containerClient, battle, winnerSlot, reason, context) {
  const p1Elo = battle.player1.elo || ELO_DEFAULT;
  const p2Elo = battle.player2.elo || ELO_DEFAULT;

  let p1EloChange = 0, p2EloChange = 0, p1Sparks = 0, p2Sparks = 0;

  if (reason === 'idle') {
    // Draw — no Elo or Sparks change
  } else if (winnerSlot === 'player1') {
    p1EloChange = calcEloChange(p1Elo, p2Elo, true);
    p2EloChange = calcEloChange(p2Elo, p1Elo, false);
    p1Sparks = calcSparksPayout(true, Math.max(0, p2Elo - p1Elo));
    p2Sparks = calcSparksPayout(false, 0);
  } else if (winnerSlot === 'player2') {
    p1EloChange = calcEloChange(p1Elo, p2Elo, false);
    p2EloChange = calcEloChange(p2Elo, p1Elo, true);
    p1Sparks = calcSparksPayout(false, 0);
    p2Sparks = calcSparksPayout(true, Math.max(0, p1Elo - p2Elo));
  } else {
    // Draw (double KO)
    p1Sparks = 10;
    p2Sparks = 10;
  }

  // Update both profiles
  await updateProfile(containerClient, battle.player1.userId, p1EloChange, p1Sparks, winnerSlot === 'player1');
  await updateProfile(containerClient, battle.player2.userId, p2EloChange, p2Sparks, winnerSlot === 'player2');

  // Store finalization data in battle blob for client to read
  battle.finalization = {
    player1: { eloChange: p1EloChange, sparks: p1Sparks },
    player2: { eloChange: p2EloChange, sparks: p2Sparks }
  };
  battle.completedAt = new Date().toISOString();
  const battlePath = 'arena/battles/' + battle.battleId + '.json';
  await uploadJsonBlob(containerClient, battlePath, battle);

  if (context && context.log) {
    context.log('[LivePvP] Battle finalized: ' + battle.battleId + ' winner=' + (winnerSlot || 'none') + ' reason=' + reason);
  }
}

async function updateProfile(containerClient, usrId, eloChange, sparks, won) {
  const profilePath = 'blindspot/profiles/' + usrId + '.json';
  const profile = await downloadJsonBlob(containerClient, profilePath);
  if (!profile) return;

  profile.pvpElo = Math.max(0, ((profile.pvpElo || ELO_DEFAULT) + eloChange));
  profile.sparks = (profile.sparks || 0) + sparks;
  if (!profile.pvpRecord) profile.pvpRecord = { w: 0, l: 0 };
  if (won === true) profile.pvpRecord.w = (profile.pvpRecord.w || 0) + 1;
  else if (won === false) profile.pvpRecord.l = (profile.pvpRecord.l || 0) + 1;
  profile.activeLiveBattle = null;
  profile.lastPlayedAt = new Date().toISOString();

  await uploadJsonBlob(containerClient, profilePath, profile);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    const { userId, isAuthenticated } = extractUserInfo(req, context);
    if (!isAuthenticated) {
      context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
      return;
    }

    const blobService = await createBlobServiceClient();
    const containerClient = blobService.getContainerClient(CONTAINER_NAME);

    if (req.method === 'GET') {
      const action = (req.query && req.query.action) || '';
      if (action === 'queueStatus') return handleQueueStatus(context, containerClient, userId, req.query);
      if (action === 'poll') return handlePoll(context, containerClient, userId, req.query);
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Unknown GET action: ' + action } };
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action || '';
      if (action === 'queue') return handleQueue(context, containerClient, userId, body);
      if (action === 'cancel') return handleCancel(context, containerClient, userId);
      if (action === 'move') return handleMove(context, containerClient, userId, body);
      if (action === 'forfeit') return handleForfeit(context, containerClient, userId, body);
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Unknown action: ' + action } };
      return;
    }

    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method not allowed' } };
  } catch (err) {
    context.log.error('[LivePvP] Error: ' + err.message);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Internal server error' } };
  }
};
