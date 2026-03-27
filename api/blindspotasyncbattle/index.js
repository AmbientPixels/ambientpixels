const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const path = require('path');
const fs = require('fs');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const QUEUE_BLOB = 'blindspot/defenseQueue.json';
const CHALLENGE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2hr cooldown per defender
const INBOX_CAP = 50;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// ── Load arena config from sibling battle API ──

let _configCache = null;
function loadArenaConfig() {
  if (_configCache) return _configCache;
  const configPath = path.resolve(__dirname, '..', 'blindspotbattle', 'arena-config.json');
  _configCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return _configCache;
}

// ═══════════════════════════════════════════════════════════════
// COMBAT ENGINE — Imported from blindspotbattle (shared logic)
// ═══════════════════════════════════════════════════════════════

function mapCardToCombatStats(card) {
  const config = loadArenaConfig();
  const combat = { ...config.statDefaults };
  if (card.combatStats && typeof card.combatStats === 'object') {
    for (const key of Object.keys(combat)) {
      if (card.combatStats[key] !== undefined) {
        combat[key] = Math.min(100, Math.max(1, Math.round(card.combatStats[key])));
      }
    }
    return combat;
  }
  if (!card.stats || card.stats.length === 0) return combat;
  const maxVal = Math.max(...card.stats.map(s => s.value || 0));
  const scaleFactor = maxVal <= 10 ? 10 : 1;
  for (const [combatKey, aliases] of Object.entries(config.statAliases)) {
    const match = card.stats.find(s => aliases.includes((s.name || '').toLowerCase().trim()));
    if (match) combat[combatKey] = Math.min(100, Math.max(1, Math.round((match.value || 0) * scaleFactor)));
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
    passives.push({ source: `badge:${badge.category}`, effect: passiveDef.effect, value });
  }
  return passives;
}

function computeStatThresholdPassives(combatStats) {
  if (!combatStats) return [];
  const passives = [];
  const cs = combatStats;
  if ((cs.str || 0) >= 60) passives.push({ source: 'stat:str60', effect: 'guard_pierce', value: 20 });
  if ((cs.str || 0) >= 80) passives.push({ source: 'stat:str80', effect: 'crit_damage', value: 25 });
  if ((cs.agi || 0) >= 60) passives.push({ source: 'stat:agi60', effect: 'speed_priority', value: 1 });
  if ((cs.agi || 0) >= 80) passives.push({ source: 'stat:agi80', effect: 'dodge', value: 15 });
  if ((cs.int || 0) >= 60) passives.push({ source: 'stat:int60', effect: 'ability_discount', value: 1 });
  if ((cs.int || 0) >= 80) passives.push({ source: 'stat:int80', effect: 'ability_power', value: 30 });
  if ((cs.end || 0) >= 60) passives.push({ source: 'stat:end60', effect: 'heal_dr', value: 10 });
  if ((cs.end || 0) >= 80) passives.push({ source: 'stat:end80', effect: 'hp_regen', value: 5 });
  if ((cs.lck || 0) >= 50) passives.push({ source: 'stat:lck50', effect: 'crit_chance', value: 10 });
  if ((cs.lck || 0) >= 70) passives.push({ source: 'stat:lck70', effect: 'crit_damage', value: 50 });
  return passives;
}

function getPassiveValue(passives, effectName) {
  return passives.filter(p => p.effect === effectName).reduce((sum, p) => sum + p.value, 0);
}

function applyStatPassives(combatStats, passives) {
  const endBonus = getPassiveValue(passives, 'end_bonus');
  if (endBonus > 0) combatStats.end = Math.min(100, combatStats.end + endBonus);
  const allStats = getPassiveValue(passives, 'all_stats');
  if (allStats > 0) {
    combatStats.str = Math.min(100, combatStats.str + allStats);
    combatStats.agi = Math.min(100, combatStats.agi + allStats);
    combatStats.int = Math.min(100, combatStats.int + allStats);
    combatStats.end = Math.min(100, combatStats.end + allStats);
    combatStats.lck = Math.min(100, combatStats.lck + allStats);
  }
}

function computeMaxHp(combatStats) {
  return Math.round(80 + (combatStats.end * 1.5) + (combatStats.str * 0.3));
}

function getAbilityByDominantStat(combatStats, config) {
  const statMap = { str: 'powerStrike', int: 'arcaneBlast', agi: 'shadowStrike', end: 'fortify', lck: 'wildCard' };
  let best = 'str'; let bestVal = 0;
  for (const s of ['str', 'int', 'agi', 'end', 'lck']) {
    if ((combatStats[s] || 0) > bestVal) { bestVal = combatStats[s]; best = s; }
  }
  return statMap[best] || 'powerStrike';
}

function getClassAbility(className, config) {
  if (className && config.classAbilities && config.classAbilities[className]) return config.classAbilities[className];
  return null;
}

function getAbilityKey(className, combatStats, config) {
  return getClassAbility(className, config) || getAbilityByDominantStat(combatStats, config);
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

function computeRank(xp) {
  const config = loadArenaConfig();
  const rankOrder = config.rankOrder || ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
  let rank = rankOrder[0];
  for (const r of rankOrder) {
    if (xp >= (config.ranks[r]?.xpRequired || 0)) rank = r;
  }
  return rank;
}

// ── resolveClassAbility (mirrored from blindspotbattle) ──

function resolveClassAbility(abilityKey, combatStats, opponentMove, config, events, side) {
  const def = config.abilityDefs[abilityKey];
  if (!def) return { damage: 0, heal: 0, tempEffect: null, alwaysFirst: false };
  const prefix = side === 'player' ? 'Your' : "Enemy's";
  const target = side === 'player' ? 'their' : 'your';
  let damage = 0, heal = 0, tempEffect = null, alwaysFirst = false;

  if (abilityKey === 'fortify') {
    const end = combatStats.end;
    heal = end * def.healMult + Math.random() * (end * def.healRand);
    if (opponentMove === 'strike') { heal *= 0.75; events.push(`${prefix} fortify was disrupted by ${target} strike! (25% reduced)`); }
    else if (opponentMove === 'ability') { heal *= 0.4; events.push(`${prefix} fortify was disrupted by ${target} ability! (60% reduced)`); }
    heal = Math.round(heal);
    if (heal > 0) { events.push(`${prefix} ${def.label} restored ${heal} HP and raised defenses!`); tempEffect = { effect: 'fortified', value: 20, roundsLeft: 1 }; }
  } else if (abilityKey === 'wildCard') {
    const statKeys = ['str', 'agi', 'int', 'end', 'lck'];
    const chosenStat = statKeys[Math.floor(Math.random() * statKeys.length)];
    const statVal = combatStats[chosenStat] || 30;
    const roll = Math.random();
    if (roll < 0.15) { events.push(`${prefix} Wild Card fizzled!`); }
    else if (roll < 0.85) { damage = Math.round(statVal * 0.4 + Math.random() * (statVal * 0.15)); events.push(`${prefix} Wild Card hit for ${damage}!`); }
    else { damage = Math.round(statVal * 0.6 + Math.random() * (statVal * 0.2)); events.push(`${prefix} Wild Card crit for ${damage}!`); }
  } else if (abilityKey === 'shadowStrike') {
    const agi = combatStats.agi;
    damage = Math.round(agi * (def.agiMult || 0.35) + Math.random() * (agi * (def.agiRand || 0.1)));
    if (opponentMove === 'guard') { damage = Math.round(damage * 0.5); events.push(`${prefix} Shadow Strike was partially blocked!`); }
    else { events.push(`${prefix} Shadow Strike from the shadows for ${damage}!`); }
    alwaysFirst = true;
    if (Math.random() < 0.2) { tempEffect = { effect: 'blind', value: 1, roundsLeft: 1 }; events.push(`${prefix} Shadow Strike blinds the enemy!`); }
  } else {
    // powerStrike / arcaneBlast / generic damage abilities
    const stat = abilityKey === 'arcaneBlast' ? combatStats.int : combatStats.str;
    const mult = def.strMult || def.intMult || 0.5;
    const rand = def.strRand || def.intRand || 0.15;
    damage = Math.round(stat * mult + Math.random() * (stat * rand));
    if (opponentMove === 'guard') {
      if (damage > 0) { tempEffect = { effect: 'stun', value: 1, roundsLeft: 1 }; events.push(`${prefix} ${def.label} broke through ${target} guard! STUNNED!`); }
      damage = Math.round(damage * 0.6);
    }
    events.push(`${prefix} ${def.label} deals ${damage} damage!`);
  }
  return { damage, heal, tempEffect, alwaysFirst };
}

// ── resolveRound (mirrored from blindspotbattle) ──

function resolveRound(player, opponent, playerMove, opponentMove, battleTempEffects) {
  const config = loadArenaConfig();
  const events = [];
  const moveLabels = { strike: 'Strike', guard: 'Guard', ability: 'Ability', heal: 'Heal', counter: 'Counter' };
  events.push(`⚔️ You chose ${moveLabels[playerMove] || playerMove} — Enemy chose ${moveLabels[opponentMove] || opponentMove}`);

  let playerSpeed = player.combatStats.agi + Math.random() * 10;
  let opponentSpeed = opponent.combatStats.agi + Math.random() * 10;
  let speedWinner = playerSpeed >= opponentSpeed ? 'player' : 'opponent';
  if (getPassiveValue(player.passives, 'speed_priority') > 0 && getPassiveValue(opponent.passives, 'speed_priority') === 0) speedWinner = 'player';
  if (getPassiveValue(opponent.passives, 'speed_priority') > 0 && getPassiveValue(player.passives, 'speed_priority') === 0) speedWinner = 'opponent';
  if (playerMove === 'ability' && player.abilityKey === 'shadowStrike') speedWinner = 'player';
  if (opponentMove === 'ability' && opponent.abilityKey === 'shadowStrike') speedWinner = 'opponent';

  let playerDamageTaken = 0, opponentDamageTaken = 0, playerHeal = 0, opponentHeal = 0;
  const newTempEffects = { player: [], opponent: [] };

  const playerCritChance = 5 + getPassiveValue(player.passives, 'crit_chance');
  const playerAbilityBonus = getPassiveValue(player.passives, 'ability_power');
  const opponentCritChance = 5 + getPassiveValue(opponent.passives, 'crit_chance');
  const opponentAbilityBonus = getPassiveValue(opponent.passives, 'ability_power');

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

  let playerCounterReflect = false, opponentCounterReflect = false;

  // HP regen passive
  const playerRegen = getPassiveValue(player.passives, 'hp_regen');
  if (playerRegen > 0) { playerHeal += playerRegen; events.push(`💚 Auto-heal: +${playerRegen} HP`); }
  const opponentRegen = getPassiveValue(opponent.passives, 'hp_regen');
  if (opponentRegen > 0) { opponentHeal += opponentRegen; }

  // Burn damage
  if (playerBurn > 0) { const burnDmg = Math.round(player.maxHp * playerBurn / 100); playerDamageTaken += burnDmg; events.push(`🔥 Burn: -${burnDmg} HP`); }
  if (opponentBurn > 0) { const burnDmg = Math.round(opponent.maxHp * opponentBurn / 100); opponentDamageTaken += burnDmg; }

  // Stun override
  if (playerStunned) { events.push('⚡ You are STUNNED! Cannot act!'); }
  if (opponentStunned) { events.push('⚡ Enemy is STUNNED! Cannot act!'); }

  const effectivePlayerMove = playerStunned ? 'stunned' : playerMove;
  const effectiveOpponentMove = opponentStunned ? 'stunned' : opponentMove;

  // Resolve player action
  if (effectivePlayerMove === 'strike') {
    if (playerBlind && Math.random() < 0.4) {
      events.push('😵 Blinded! Your strike misses!');
    } else {
      let dmg = Math.round(player.combatStats.str * 0.3 + Math.random() * (player.combatStats.str * 0.1));
      const isCrit = Math.random() * 100 < playerCritChance;
      if (isCrit) {
        const critMult = 1.5 + getPassiveValue(player.passives, 'crit_damage') / 100;
        dmg = Math.round(dmg * critMult);
        events.push(`💥 Critical hit! ${dmg} damage!`);
        if (Math.random() < 0.3) { newTempEffects.opponent.push({ effect: 'burn', value: 8, roundsLeft: 2 }); events.push('🔥 Critical strike ignites!'); }
      }
      if (effectiveOpponentMove === 'guard') {
        const guardBlock = 60 - getPassiveValue(player.passives, 'guard_pierce');
        dmg = Math.round(dmg * (1 - guardBlock / 100));
        events.push(`🛡️ Enemy guarded! Reduced to ${dmg} damage.`);
      }
      if (effectiveOpponentMove === 'heal') { events.push('⚔️ Strike disrupts enemy heal!'); }
      const dodge = getPassiveValue(opponent.passives, 'dodge');
      if (dodge > 0 && Math.random() * 100 < dodge) { dmg = 0; events.push('👻 Enemy dodged!'); }
      opponentDamageTaken += dmg;
    }
  } else if (effectivePlayerMove === 'guard') {
    events.push('🛡️ You raise your guard.');
    const healDr = getPassiveValue(player.passives, 'heal_dr');
    if (healDr > 0) newTempEffects.player.push({ effect: 'fortified', value: healDr, roundsLeft: 1 });
  } else if (effectivePlayerMove === 'heal') {
    let h = Math.round(player.combatStats.end * 0.5 + Math.random() * (player.combatStats.end * 0.12));
    if (effectiveOpponentMove === 'strike') { h = Math.round(h * 0.5); events.push('⚔️ Heal disrupted by enemy strike!'); }
    if (effectiveOpponentMove === 'ability') { h = Math.round(h * 0.3); events.push('💫 Heal disrupted by enemy ability!'); }
    playerHeal += h;
    events.push(`💚 Healed for ${h} HP.`);
    const healDr = getPassiveValue(player.passives, 'heal_dr');
    if (healDr > 0) newTempEffects.player.push({ effect: 'fortified', value: healDr, roundsLeft: 1 });
  } else if (effectivePlayerMove === 'counter') {
    if (effectiveOpponentMove === 'strike') {
      const reflect = Math.round(player.combatStats.str * 0.25 + Math.random() * (player.combatStats.str * 0.1));
      opponentDamageTaken += reflect;
      playerCounterReflect = true;
      events.push(`⚔️ Counter reflects ${reflect} damage!`);
    } else {
      events.push('⚔️ Counter failed — enemy didn\'t strike.');
    }
  } else if (effectivePlayerMove === 'ability') {
    const abilityResult = resolveClassAbility(player.abilityKey, player.combatStats, effectiveOpponentMove, config, events, 'player');
    let dmg = abilityResult.damage;
    if (playerAbilityBonus > 0 && dmg > 0) dmg = Math.round(dmg * (1 + playerAbilityBonus / 100));
    opponentDamageTaken += dmg;
    playerHeal += abilityResult.heal;
    if (abilityResult.tempEffect) newTempEffects.opponent.push(abilityResult.tempEffect);
  }

  // Resolve opponent action
  if (effectiveOpponentMove === 'strike') {
    if (opponentBlind && Math.random() < 0.4) {
      events.push('😵 Enemy blinded! Their strike misses!');
    } else {
      let dmg = Math.round(opponent.combatStats.str * 0.3 + Math.random() * (opponent.combatStats.str * 0.1));
      const isCrit = Math.random() * 100 < opponentCritChance;
      if (isCrit) {
        const critMult = 1.5 + getPassiveValue(opponent.passives, 'crit_damage') / 100;
        dmg = Math.round(dmg * critMult);
        events.push(`💥 Enemy critical hit! ${dmg} damage!`);
      }
      if (effectivePlayerMove === 'guard') {
        const guardBlock = 60 - getPassiveValue(opponent.passives, 'guard_pierce');
        dmg = Math.round(dmg * (1 - guardBlock / 100));
        events.push(`🛡️ You guarded! Reduced to ${dmg} damage.`);
      }
      const dodge = getPassiveValue(player.passives, 'dodge');
      if (dodge > 0 && Math.random() * 100 < dodge) { dmg = 0; events.push('👻 You dodged!'); }
      // Player fortified DR
      if (playerFortified > 0) { dmg = Math.round(dmg * (1 - playerFortified / 100)); }
      playerDamageTaken += dmg;
    }
  } else if (effectiveOpponentMove === 'guard') {
    // Already handled in player strike
  } else if (effectiveOpponentMove === 'heal') {
    let h = Math.round(opponent.combatStats.end * 0.5 + Math.random() * (opponent.combatStats.end * 0.12));
    if (effectivePlayerMove === 'strike') h = Math.round(h * 0.5);
    if (effectivePlayerMove === 'ability') h = Math.round(h * 0.3);
    opponentHeal += h;
  } else if (effectiveOpponentMove === 'counter') {
    if (effectivePlayerMove === 'strike') {
      const reflect = Math.round(opponent.combatStats.str * 0.25 + Math.random() * (opponent.combatStats.str * 0.1));
      playerDamageTaken += reflect;
      opponentCounterReflect = true;
      events.push(`⚔️ Enemy counter reflects ${reflect} damage!`);
    }
  } else if (effectiveOpponentMove === 'ability') {
    const abilityResult = resolveClassAbility(opponent.abilityKey, opponent.combatStats, effectivePlayerMove, config, events, 'opponent');
    let dmg = abilityResult.damage;
    if (opponentAbilityBonus > 0 && dmg > 0) dmg = Math.round(dmg * (1 + opponentAbilityBonus / 100));
    playerDamageTaken += dmg;
    opponentHeal += abilityResult.heal;
    if (abilityResult.tempEffect) newTempEffects.player.push(abilityResult.tempEffect);
  }

  // Vulnerability amplification
  if (playerVulnerable > 0 && playerDamageTaken > 0) playerDamageTaken = Math.round(playerDamageTaken * (1 + playerVulnerable / 100));
  if (opponentVulnerable > 0 && opponentDamageTaken > 0) opponentDamageTaken = Math.round(opponentDamageTaken * (1 + opponentVulnerable / 100));

  // Merge persisted effects
  newTempEffects.player.push(...persistedEffects.player);
  newTempEffects.opponent.push(...persistedEffects.opponent);

  return { speedWinner, playerDamageTaken, opponentDamageTaken, playerHeal, opponentHeal, events, newTempEffects, playerCounterReflect, opponentCounterReflect };
}

// ═══════════════════════════════════════════════════════════════
// DEFENDER AI — Class-personality move generation
// ═══════════════════════════════════════════════════════════════

function generateDefenderMove(defender, round, currentHp, maxHp, charges, moveHistory) {
  const config = loadArenaConfig();
  const cc = config.chargeConfig || {};
  const abilityCost = Math.max(1, (cc.abilityCost || 2) - getPassiveValue(defender.passives || [], 'ability_discount'));

  // Base weights by card class personality
  const classWeights = {
    Fighter:   { strike: 40, guard: 20, ability: 20, heal: 10, counter: 10 },
    Enforcer:  { strike: 35, guard: 25, ability: 20, heal: 10, counter: 10 },
    Berserker: { strike: 50, guard: 10, ability: 25, heal: 5,  counter: 10 },
    Guardian:  { strike: 15, guard: 35, ability: 10, heal: 30, counter: 10 },
    Caster:    { strike: 15, guard: 20, ability: 35, heal: 15, counter: 15 },
    Scholar:   { strike: 15, guard: 15, ability: 30, heal: 25, counter: 15 },
    Hacker:    { strike: 20, guard: 15, ability: 30, heal: 10, counter: 25 },
    Scout:     { strike: 30, guard: 10, ability: 15, heal: 10, counter: 35 },
    Rogue:     { strike: 30, guard: 10, ability: 20, heal: 10, counter: 30 },
    Trickster: { strike: 20, guard: 15, ability: 30, heal: 10, counter: 25 },
    Medic:     { strike: 15, guard: 25, ability: 15, heal: 35, counter: 10 },
    Pilot:     { strike: 25, guard: 15, ability: 30, heal: 15, counter: 15 }
  };

  let weights = { ...(classWeights[defender.cardClass] || classWeights.Fighter) };

  // Reactive adjustments
  const hpPct = currentHp / maxHp;

  // Low HP: boost heal and guard
  if (hpPct < 0.3) {
    weights.heal += 25;
    weights.guard += 15;
    weights.strike -= 10;
  } else if (hpPct < 0.5) {
    weights.heal += 10;
    weights.guard += 5;
  }

  // Not enough charges: redistribute ability weight
  if (charges < abilityCost) {
    weights.strike += weights.ability;
    weights.ability = 0;
  }

  // Pattern reading: if attacker struck last 2 rounds, boost counter
  if (moveHistory && moveHistory.length >= 2) {
    const last2 = moveHistory.slice(-2);
    if (last2.every(m => m === 'strike')) {
      weights.counter += 20;
      weights.guard += 10;
    }
    // If attacker healed last round, punish with strike/ability
    if (last2[last2.length - 1] === 'heal') {
      weights.strike += 15;
      weights.ability += 10;
    }
  }

  // Ensure no negative weights
  for (const k of Object.keys(weights)) weights[k] = Math.max(0, weights[k]);

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;

  for (const [move, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return move;
  }
  return 'strike';
}

// ═══════════════════════════════════════════════════════════════
// ELO CALCULATION
// ═══════════════════════════════════════════════════════════════

const ELO_K_ATTACKER = 32;
const ELO_K_DEFENDER = 16; // Halved — defenders didn't choose the fight

function calcEloChange(playerElo, opponentElo, won, kFactor) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  const score = won ? 1 : 0;
  return Math.round(kFactor * (score - expected));
}

// Sparks payout table
function calcSparksPayout(won, eloGap, isRevenge) {
  let base = won ? 20 : 5; // Win: 15-30 depending on gap, Loss: 5 consolation
  if (won && eloGap > 0) base += Math.min(15, Math.floor(eloGap / 50)); // Bonus for fighting stronger opponents
  if (isRevenge && won) base = Math.round(base * 1.5); // +50% revenge bonus
  return base;
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

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
      context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Sign in to play async PvP' } };
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
    context.log.error(`[AsyncBattle] Error: ${error.message}`);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: `Async battle error: ${error.message}` }
    };
  }
};

// ── Start: attacker challenges a defender from the queue ──

async function handleStart(context, containerClient, userId, body) {
  const { cardId, cardData, defenderId } = body;
  const config = loadArenaConfig();

  if (!cardId || !defenderId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'cardId and defenderId (userId of defender) are required' } };
    return;
  }

  // Load defense queue and find defender
  const queue = await downloadJsonBlob(containerClient, QUEUE_BLOB) || [];
  const defender = queue.find(entry => entry.userId === defenderId);
  if (!defender) {
    context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Defender not found in queue' } };
    return;
  }

  // Can't fight yourself
  if (defenderId === userId) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Cannot challenge your own card' } };
    return;
  }

  // Anti-farming: 2hr cooldown per defender
  if (defender.lastChallengedBy === userId && defender.lastChallengedAt) {
    const elapsed = Date.now() - new Date(defender.lastChallengedAt).getTime();
    if (elapsed < CHALLENGE_COOLDOWN_MS) {
      const remaining = Math.ceil((CHALLENGE_COOLDOWN_MS - elapsed) / 60000);
      context.res = { status: 429, headers: CORS_HEADERS, body: { error: `Cooldown: wait ${remaining} minutes before re-challenging this defender` } };
      return;
    }
  }

  // Load attacker card
  let playerCard;
  if (cardData) {
    playerCard = cardData;
    if (!playerCard.id) playerCard.id = cardId;
  } else {
    const userCardsData = await downloadJsonBlob(containerClient, `user/${userId}/cards.json`);
    const userCards = userCardsData?.cards || [];
    playerCard = userCards.find(c => c.id === cardId);
    if (!playerCard) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Card not found in your collection' } };
      return;
    }
  }

  // Load attacker profile for rank-based buff caps
  const attackerProfile = await downloadJsonBlob(containerClient, `arena/profiles/${userId}.json`);
  const attackerRank = (attackerProfile && attackerProfile.rank) ? attackerProfile.rank : 'bronze';

  // Build combat entities
  const playerCombat = mapCardToCombatStats(playerCard);
  const opponentCombat = { ...defender.combatStats }; // Already clamped at registration

  const playerPassives = computePassives(playerCard, attackerRank);
  playerPassives.push(...computeStatThresholdPassives(playerCombat));

  const opponentPassives = computePassives(defender, 'diamond'); // Defenders use uncapped
  opponentPassives.push(...computeStatThresholdPassives(opponentCombat));

  applyStatPassives(playerCombat, playerPassives);
  applyStatPassives(opponentCombat, opponentPassives);

  const playerMaxHp = computeMaxHp(playerCombat);
  const opponentMaxHp = computeMaxHp(opponentCombat);

  const playerAbilityKey = getAbilityKey(playerCard.class, playerCombat, config);
  const opponentAbilityKey = getAbilityKey(defender.cardClass, opponentCombat, config);

  const playerXp = (attackerProfile && attackerProfile.xp) ? attackerProfile.xp : 0;
  const cc = config.chargeConfig || {};
  const playerChargeRate = computeChargeRate(playerCombat, playerXp, config);
  const opponentChargeRate = computeChargeRate(opponentCombat, 1500, config);

  const battleId = `bs-async-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const battleState = {
    battleId,
    type: 'async_pvp',
    isRevenge: body.isRevenge === true,
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
      moves: [],
      abilityKey: playerAbilityKey
    },
    player2: {
      userId: defenderId,
      cardId: defender.cardId,
      cardSnapshot: { name: defender.cardName, class: defender.cardClass, avatar: defender.avatar },
      combatStats: opponentCombat,
      maxHp: opponentMaxHp,
      hp: opponentMaxHp,
      passives: opponentPassives,
      moves: [],
      abilityKey: opponentAbilityKey,
      cardClass: defender.cardClass
    },
    charges: { player: cc.startCharges || 0, opponent: cc.startCharges || 0 },
    chargeRate: { player: playerChargeRate, opponent: opponentChargeRate },
    tempEffects: { player: [], opponent: [] },
    roundLog: [],
    winner: null,
    createdAt: new Date().toISOString()
  };

  await uploadJsonBlob(containerClient, `arena/battles/${battleId}.json`, battleState);

  // Update cooldown tracking on defender queue entry
  defender.lastChallengedBy = userId;
  defender.lastChallengedAt = new Date().toISOString();
  await uploadJsonBlob(containerClient, QUEUE_BLOB, queue);

  context.log(`[AsyncPvP] Battle started: ${battleId} — ${playerCard.name} vs ${defender.cardName} (defense)`);

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
        passives: playerPassives,
        abilityKey: playerAbilityKey,
        abilityDef: config.abilityDefs[playerAbilityKey]
      },
      opponent: {
        name: defender.cardName,
        class: defender.cardClass,
        avatar: defender.avatar,
        combatStats: opponentCombat,
        maxHp: opponentMaxHp,
        hp: opponentMaxHp,
        abilityKey: opponentAbilityKey,
        isDefenseAI: true
      },
      charges: { player: cc.startCharges || 0, opponent: cc.startCharges || 0 },
      chargeRate: playerChargeRate,
      abilityCost: Math.max(1, (cc.abilityCost || 2) - getPassiveValue(playerPassives, 'ability_discount')),
      maxCharges: cc.maxCharges || 4,
      currentRound: 1,
      totalRounds: config.totalRounds,
      status: 'active'
    }
  };
}

// ── Move: attacker submits move, defender AI responds ──

async function handleMove(context, containerClient, userId, body) {
  const { battleId, round, move } = body;

  if (!battleId || !round || !move) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'battleId, round, and move are required' } };
    return;
  }
  if (!['strike', 'guard', 'ability', 'heal', 'counter'].includes(move)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid move' } };
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
  const config = loadArenaConfig();
  const cc = config.chargeConfig || {};

  // Charge validation
  const playerAbilityDiscount = getPassiveValue(player.passives || [], 'ability_discount');
  const playerAbilityCost = Math.max(1, (cc.abilityCost || 2) - playerAbilityDiscount);
  if (move === 'ability' && battle.charges && battle.charges.player < playerAbilityCost) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Not enough charges' } };
    return;
  }

  // Generate defender AI move
  const opponentMove = generateDefenderMove(
    opponent, round, opponent.hp, opponent.maxHp, battle.charges.opponent,
    player.moves // Attacker's move history — defender reacts to patterns
  );

  // Resolve combat
  const result = resolveRound(
    { combatStats: player.combatStats, passives: player.passives, maxHp: player.maxHp, abilityKey: player.abilityKey },
    { combatStats: opponent.combatStats, passives: opponent.passives, maxHp: opponent.maxHp, abilityKey: opponent.abilityKey, bossResistances: {}, bossWeaknesses: {} },
    move, opponentMove, battle.tempEffects
  );

  // Last Stand
  const playerInLastStand = player.hp > 0 && player.hp < player.maxHp * 0.20;
  const opponentInLastStand = opponent.hp > 0 && opponent.hp < opponent.maxHp * 0.20;
  if (playerInLastStand && result.opponentDamageTaken > 0) {
    result.opponentDamageTaken += 10;
    result.events.push('⚡ Last Stand! Desperate fury! (+10 damage)');
  }
  if (opponentInLastStand && result.playerDamageTaken > 0) {
    result.playerDamageTaken += 10;
    result.events.push('⚡ Enemy Last Stand! (+10 damage)');
  }

  // Apply damage and healing
  player.hp = Math.min(player.maxHp, Math.max(0, player.hp - result.playerDamageTaken + result.playerHeal));
  opponent.hp = Math.min(opponent.maxHp, Math.max(0, opponent.hp - result.opponentDamageTaken + result.opponentHeal));

  // Update charges
  const maxCh = cc.maxCharges || 4;
  const rate = battle.chargeRate || { player: 1, opponent: 1 };
  battle.charges.player = Math.min(maxCh, battle.charges.player + (rate.player || 1));
  battle.charges.opponent = Math.min(maxCh, battle.charges.opponent + (rate.opponent || 1));
  if (move === 'ability') battle.charges.player -= playerAbilityCost;
  const oppAbilityDiscount = getPassiveValue(opponent.passives || [], 'ability_discount');
  const oppAbilityCost = Math.max(1, (cc.abilityCost || 2) - oppAbilityDiscount);
  if (opponentMove === 'ability') battle.charges.opponent -= oppAbilityCost;
  battle.charges.player = Math.max(0, battle.charges.player);
  battle.charges.opponent = Math.max(0, battle.charges.opponent);

  // Update temp effects
  battle.tempEffects = result.newTempEffects || { player: [], opponent: [] };

  // Combo detection
  let comboTriggered = null;
  const prevMoves = player.moves;
  const moveSeq = prevMoves.slice(-2).concat(move);

  if (moveSeq.length >= 3 && moveSeq[0] === 'strike' && moveSeq[1] === 'strike' && moveSeq[2] === 'strike') {
    if (result.opponentDamageTaken > 0) {
      const bonus = Math.round(result.opponentDamageTaken * 0.30);
      result.opponentDamageTaken += bonus;
      opponent.hp = Math.max(0, opponent.hp - bonus);
      result.events.push(`🌪️ FLURRY! Triple strike combo! (+${bonus} damage)`);
      comboTriggered = 'flurry';
    }
  } else if (moveSeq.length >= 2 && moveSeq[moveSeq.length - 2] === 'guard' && move === 'counter') {
    if (!result.playerCounterReflect) {
      const reflectDmg = Math.max(5, Math.round(player.combatStats.str * 0.25));
      result.opponentDamageTaken += reflectDmg;
      opponent.hp = Math.max(0, opponent.hp - reflectDmg);
      result.events.push(`⚔️ RIPOSTE! Guard into Counter! (+${reflectDmg} damage)`);
      comboTriggered = 'riposte';
    } else {
      const bonus = Math.round(result.opponentDamageTaken * 0.25);
      result.opponentDamageTaken += bonus;
      opponent.hp = Math.max(0, opponent.hp - bonus);
      result.events.push(`⚔️ RIPOSTE! Perfect counter! (+${bonus} damage)`);
      comboTriggered = 'riposte';
    }
  } else if (moveSeq.length >= 2 && moveSeq[moveSeq.length - 2] === 'heal' && move === 'ability') {
    if (result.opponentDamageTaken > 0) {
      const bonus = Math.round(result.opponentDamageTaken * 0.50);
      result.opponentDamageTaken += bonus;
      opponent.hp = Math.max(0, opponent.hp - bonus);
      result.events.push(`✨ EMPOWERED! Heal into Ability! (+${bonus} damage)`);
      comboTriggered = 'empowered';
    }
  }

  player.moves.push(move);
  opponent.moves.push(opponentMove);

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
    speedWinner: result.speedWinner,
    charges: battle.charges,
    tempEffects: battle.tempEffects,
    playerLastStand: playerInLastStand,
    opponentLastStand: opponentInLastStand,
    playerCounterReflect: result.playerCounterReflect,
    opponentCounterReflect: result.opponentCounterReflect,
    comboTriggered
  };

  battle.roundLog.push(roundResult);

  // Check for battle end
  const isKo = player.hp <= 0 || opponent.hp <= 0;
  let battleResult = null;

  if (isKo) {
    battle.status = 'complete';
    if (player.hp > opponent.hp) battle.winner = 'player';
    else if (opponent.hp > player.hp) battle.winner = 'opponent';
    else battle.winner = 'draw';

    const resultStr = battle.winner === 'player' ? 'win' : battle.winner === 'opponent' ? 'loss' : 'draw';
    battleResult = await finalizeAsyncBattle(context, containerClient, userId, battle, resultStr);
  } else {
    battle.currentRound = round + 1;
    await uploadJsonBlob(containerClient, `arena/battles/${battleId}.json`, battle);
  }

  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: { roundResult, battleStatus: battle.status, currentRound: battle.currentRound, battleResult }
  };
}

// ── Forfeit ──

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
  const battleResult = await finalizeAsyncBattle(context, containerClient, userId, battle, 'loss');

  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: { battleStatus: 'complete', battleResult }
  };
}

// ═══════════════════════════════════════════════════════════════
// FINALIZE — Update both profiles, write results inbox, update queue
// ═══════════════════════════════════════════════════════════════

async function finalizeAsyncBattle(context, containerClient, userId, battle, result) {
  const attackerWon = result === 'win';
  const defenderId = battle.player2.userId;
  const isRevenge = battle.isRevenge === true;

  // ── Elo changes ──
  const attackerProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`) || { pvpElo: 1000, pvpRecord: { w: 0, l: 0 } };
  const defenderProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${defenderId}.json`) || { pvpElo: 1000, pvpRecord: { w: 0, l: 0 } };

  const attackerElo = attackerProfile.pvpElo || 1000;
  const defenderElo = defenderProfile.pvpElo || 1000;

  const attackerEloChange = calcEloChange(attackerElo, defenderElo, attackerWon, ELO_K_ATTACKER);
  const defenderEloChange = calcEloChange(defenderElo, attackerElo, !attackerWon, ELO_K_DEFENDER);

  attackerProfile.pvpElo = Math.max(0, attackerElo + attackerEloChange);
  defenderProfile.pvpElo = Math.max(0, defenderElo + defenderEloChange);

  // Update peakRank if Elo pushes to a higher rank tier
  const { maybeUpdatePeakRank } = require('../_utils/pvpRanks');
  maybeUpdatePeakRank(attackerProfile, attackerProfile.pvpElo);
  maybeUpdatePeakRank(defenderProfile, defenderProfile.pvpElo);

  if (!attackerProfile.pvpRecord) attackerProfile.pvpRecord = { w: 0, l: 0 };
  if (!defenderProfile.pvpRecord) defenderProfile.pvpRecord = { w: 0, l: 0 };

  if (attackerWon) {
    attackerProfile.pvpRecord.w++;
    defenderProfile.pvpRecord.l++;
  } else if (result === 'loss') {
    attackerProfile.pvpRecord.l++;
    defenderProfile.pvpRecord.w++;
  }

  // ── Sparks ──
  const eloGap = defenderElo - attackerElo; // Positive means defender was stronger
  const attackerSparks = calcSparksPayout(attackerWon, Math.max(0, eloGap), isRevenge);
  const defenderSparks = calcSparksPayout(!attackerWon, Math.max(0, -eloGap), false) + 2; // +2 passive income

  attackerProfile.sparks = (attackerProfile.sparks || 0) + attackerSparks;
  defenderProfile.sparks = (defenderProfile.sparks || 0) + defenderSparks;

  // ── Card history (attacker) ──
  const attackerCardId = battle.player1.cardId;
  if (!attackerProfile.cardHistory) attackerProfile.cardHistory = {};
  if (!attackerProfile.cardHistory[attackerCardId]) {
    attackerProfile.cardHistory[attackerCardId] = { wins: 0, losses: 0, bossesBeaten: [], bestStreak: 0, currentStreak: 0, nemesis: null, nemesisLosses: {} };
  }
  const ach = attackerProfile.cardHistory[attackerCardId];
  if (attackerWon) {
    ach.wins++;
    ach.currentStreak++;
    if (ach.currentStreak > ach.bestStreak) ach.bestStreak = ach.currentStreak;
  } else {
    ach.losses++;
    ach.currentStreak = 0;
    const nemKey = battle.player2.cardSnapshot.name || 'Unknown';
    if (!ach.nemesisLosses) ach.nemesisLosses = {};
    ach.nemesisLosses[nemKey] = (ach.nemesisLosses[nemKey] || 0) + 1;
    let maxL = 0; let topN = null;
    for (const k in ach.nemesisLosses) { if (ach.nemesisLosses[k] > maxL) { maxL = ach.nemesisLosses[k]; topN = k; } }
    ach.nemesis = topN;
  }

  // Save profiles
  await uploadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`, attackerProfile);
  await uploadJsonBlob(containerClient, `blindspot/profiles/${defenderId}.json`, defenderProfile);

  // ── Update attacker's arena profile too (XP) ──
  const arenaProfile = await downloadJsonBlob(containerClient, `arena/profiles/${userId}.json`);
  if (arenaProfile) {
    const xpAward = attackerWon ? 50 : 10;
    arenaProfile.xp = (arenaProfile.xp || 0) + xpAward;
    arenaProfile.rank = computeRank(arenaProfile.xp);
    arenaProfile.level = Math.floor(arenaProfile.xp / 100) + 1;
    arenaProfile.lastBattleAt = new Date().toISOString();
    if (attackerWon) arenaProfile.record.wins++;
    else if (result === 'loss') arenaProfile.record.losses++;
    else arenaProfile.record.draws++;
    await uploadJsonBlob(containerClient, `arena/profiles/${userId}.json`, arenaProfile);
  }

  // ── Results inbox for defender ──
  const inboxPath = `blindspot/asyncResults/${defenderId}.json`;
  let inbox = await downloadJsonBlob(containerClient, inboxPath) || [];

  inbox.unshift({
    id: `result-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    type: 'defense_result',
    cardId: battle.player2.cardId,
    cardName: battle.player2.cardSnapshot.name,
    opponentName: battle.player1.cardSnapshot.name,
    opponentUserId: userId,
    opponentCardId: battle.player1.cardId,
    opponentAvatar: battle.player1.cardSnapshot.avatar,
    opponentClass: battle.player1.cardSnapshot.class,
    result: attackerWon ? 'loss' : 'win', // From defender's perspective
    rounds: battle.roundLog.length,
    sparksEarned: defenderSparks,
    eloChange: defenderEloChange,
    canRevenge: attackerWon, // Defender can revenge if they lost
    foughtAt: new Date().toISOString(),
    read: false
  });

  // Cap inbox
  if (inbox.length > INBOX_CAP) inbox = inbox.slice(0, INBOX_CAP);
  await uploadJsonBlob(containerClient, inboxPath, inbox);

  // ── Update defense queue record ──
  const queue = await downloadJsonBlob(containerClient, QUEUE_BLOB) || [];
  const defEntry = queue.find(e => e.userId === defenderId);
  if (defEntry) {
    if (!defEntry.record) defEntry.record = { w: 0, l: 0 };
    if (attackerWon) defEntry.record.l++;
    else defEntry.record.w++;
    defEntry.lastChallengedAt = new Date().toISOString();
    await uploadJsonBlob(containerClient, QUEUE_BLOB, queue);
  }

  // ── Match history for attacker ──
  const historyPath = `arena/history/${userId}.json`;
  let history = await downloadJsonBlob(containerClient, historyPath) || [];
  history.unshift({
    battleId: battle.battleId,
    type: 'async_pvp',
    playerCardId: attackerCardId,
    opponentName: battle.player2.cardSnapshot.name,
    opponentAvatar: battle.player2.cardSnapshot.avatar,
    opponentClass: battle.player2.cardSnapshot.class,
    result,
    rounds: battle.roundLog.length,
    xpEarned: attackerWon ? 50 : 10,
    eloChange: attackerEloChange,
    sparksEarned: attackerSparks,
    isRevenge,
    timestamp: new Date().toISOString()
  });
  if (history.length > 100) history = history.slice(0, 100);
  await uploadJsonBlob(containerClient, historyPath, history);

  // Clean up battle state
  await deleteBlob(containerClient, `arena/battles/${battle.battleId}.json`);

  context.log(`[AsyncPvP] Battle ${battle.battleId} complete: ${result}, attacker Elo ${attackerElo}→${attackerProfile.pvpElo}, defender Elo ${defenderElo}→${defenderProfile.pvpElo}`);

  return {
    winner: attackerWon ? 'player' : 'opponent',
    result,
    // Elo/Sparks (async PvP specific)
    eloChange: attackerEloChange,
    newElo: attackerProfile.pvpElo,
    sparksEarned: attackerSparks,
    isRevenge,
    defenderName: battle.player2.cardSnapshot.name,
    cardHistory: ach,
    pvpRecord: attackerProfile.pvpRecord,
    // Compatible with ArenaResults.showResults() expectations
    xpEarned: attackerWon ? 50 : 10,
    newXp: arenaProfile ? arenaProfile.xp : 0,
    newLevel: arenaProfile ? arenaProfile.level : 1,
    newRank: arenaProfile ? arenaProfile.rank : 'bronze',
    rankUp: false,
    record: arenaProfile ? arenaProfile.record : { wins: 0, losses: 0, draws: 0 },
    isAsyncPvP: true
  };
}
