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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

// --- Shared helpers (same pattern as other cardforge APIs) ---

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
  const configPath = path.resolve(__dirname, 'arena-config.json');
  _configCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return _configCache;
}

let _bossCache = null;
function loadBossData() {
  if (_bossCache) return _bossCache;
  const bossPath = path.resolve(__dirname, 'arena-bosses.json');
  _bossCache = JSON.parse(fs.readFileSync(bossPath, 'utf8'));
  return _bossCache;
}

// ═══════════════════════════════════════════════════════════════════════════
// BATTLE ENGINE — Combat Math Reference
// ═══════════════════════════════════════════════════════════════════════════
//
// CORE STATS (all clamped 1–100):
//   STR — Strike damage, Power Strike ability
//   AGI — Speed check, Shadow Strike ability, charge rate bonus at 50+
//   INT — Arcane Blast ability
//   END — Heal amount, Fortify ability, HP pool
//   LCK — Wild Card ability
//
// HP FORMULA:  maxHp = 50 + (END × 0.8) + (STR × 0.2)
//   Range: ~74 HP (all 40s default) to ~130 HP (END 100, STR 100)
//
// DAMAGE FORMULAS:
//   Strike:       STR × 0.4  + rand(0 … STR × 0.1)     → ~16–50 dmg
//   Crit strike:  1.5× damage, 5% base chance + badge bonuses
//   Heal:         END × 0.3  + rand(0 … END × 0.1)     → ~12–40 heal
//
// ABILITY FORMULAS (cost: 2 charges, gain 1/round + bonuses):
//   Power Strike:  STR × 0.6  + rand(STR × 0.15)  — 1.4× vs Guard (net 0.98×)
//   Arcane Blast:  INT × 0.55 + rand(INT × 0.15)  — applies Vulnerable (+15% dmg taken)
//   Shadow Strike: AGI × 0.5  + rand(AGI × 0.2)   — always acts first
//   Fortify:       END × 0.25 + rand(END × 0.1)   — heals + Fortified (-20% dmg taken)
//   Wild Card:     random_stat × 0.5 + rand(× 0.2) — 25% crit (2×), 10% fizzle (0 dmg)
//
// MATCHUP MATRIX (applies to abilities AND interactions):
//   Ability vs Strike: 1.3× damage (overpowers)
//   Ability vs Guard:  0.7× damage (partially blocked) + Stun on target
//   Ability vs Heal:   1.2× damage (punishes)
//   Guard vs Strike:   blocks 60% of strike damage
//   Heal vs Strike:    heal reduced 50% (disrupted)
//   Heal vs Ability:   heal = 0 (interrupted)
//   Counter vs Strike: reflects 50% of incoming damage, blocks all
//   Counter vs Guard:  nothing happens
//   Counter vs Ability/Heal: counter fails, takes full damage
//
// STATUS EFFECTS:
//   Burn (2 rounds):  8% of target maxHp per round, triggered by crit strike
//   Stun (1 round):   skip turn, triggered by ability hitting guard
//   Blind (1 round):  40% miss chance on strikes, triggered by Shadow Strike crit
//   Vulnerable (1 round): +15% damage taken, triggered by Arcane Blast
//   Fortified (1 round):  -20% damage taken, triggered by Fortify ability
//
// SPEED:  AGI + rand(0–10), higher goes first. Shadow Strike overrides to always first.
//
// CHARGE SYSTEM:
//   Start: 0 charges. Gain chargeRate per round. Ability costs 2 charges.
//   chargeRate = 1 base + 0.5 if AGI ≥ 50 + 0.5 if rank ≥ Gold
//   Max charges: 4
//
// LAST STAND:  Below 20% HP → +10 flat damage bonus on attacks
// CROWD BOOST: Hype meter fills from crits/streaks/events → +15% damage when full
//
// XP AWARDS:
//   PvE win: 25 + (bossLevel × 5)    PvE loss: 5
//   PvP win: 50                        PvP loss: 10     Draw: 20
//
// RANKS: Bronze (0) → Silver (500) → Gold (1500) → Platinum (3500) → Diamond (7000)
//
// BADGE PASSIVES: qty capped by rank (Bronze=1, Silver=2, Gold=3, Plat=4, Diamond=5)
//   Each badge category maps to an effect with valuePerQty and maxValue (see arena-config.json)
// ═══════════════════════════════════════════════════════════════════════════

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

function computePassives(card, rank) {
  const config = loadArenaConfig();
  const passives = [];

  if (!card.badges || card.badges.length === 0) return passives;

  // Server-side qty cap enforcement — prevent inflated client data
  const qtyCaps = config.buffQtyCaps || {};
  const maxQty = qtyCaps[(rank || 'bronze').toLowerCase()] || 1;

  for (const badge of card.badges) {
    const category = (badge.category || '').toLowerCase().trim();
    const passiveDef = config.badgePassives[category];
    if (!passiveDef) continue;

    const rawQty = badge.quantity || 1;
    const qty = Math.min(rawQty, maxQty); // Clamp to rank-based max
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

// Apply persistent stat bonuses from buffs (endurance bonus, all-stats boost)
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

// HP = 50 base + END contribution (80%) + STR contribution (20%)
function computeMaxHp(combatStats) {
  return Math.round(50 + (combatStats.end * 0.8) + (combatStats.str * 0.2));
}

function getClassAbility(className, config) {
  if (className && config.classAbilities && config.classAbilities[className]) {
    return config.classAbilities[className];
  }
  return null;
}

function getAbilityByDominantStat(combatStats, config) {
  const statMap = { str: 'powerStrike', int: 'arcaneBlast', agi: 'shadowStrike', end: 'fortify', lck: 'wildCard' };
  let best = 'str';
  let bestVal = 0;
  for (const s of ['str', 'int', 'agi', 'end', 'lck']) {
    if ((combatStats[s] || 0) > bestVal) { bestVal = combatStats[s]; best = s; }
  }
  return statMap[best] || 'powerStrike';
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

function resolveClassAbility(abilityKey, combatStats, opponentMove, config, events, side) {
  const def = config.abilityDefs[abilityKey];
  if (!def) return { damage: 0, heal: 0, tempEffect: null, alwaysFirst: false };

  const prefix = side === 'player' ? 'Your' : "Opponent's";
  const target = side === 'player' ? 'their' : 'your';
  let damage = 0;
  let heal = 0;
  let tempEffect = null;
  let alwaysFirst = false;

  if (abilityKey === 'fortify') {
    // Fortify: heal + buff
    const end = combatStats.end;
    heal = end * def.healMult + Math.random() * (end * def.healRand);
    // Matchup modifiers for fortify heal
    if (opponentMove === 'strike') {
      heal *= 0.5;
      events.push(`${prefix} fortify was disrupted by ${target} strike!`);
    } else if (opponentMove === 'ability') {
      heal = 0;
      events.push(`${prefix} fortify was interrupted by ${target} ability!`);
    }
    heal = Math.round(heal);
    if (heal > 0) {
      events.push(`${prefix} ${def.label} restored ${heal} HP and raised defenses!`);
      tempEffect = { effect: 'fortified', value: 20, roundsLeft: 1 };
    }
  } else if (abilityKey === 'wildCard') {
    // Wild Card: random stat, crit/fizzle chance
    const statKeys = ['str', 'agi', 'int', 'end', 'lck'];
    const chosenStat = statKeys[Math.floor(Math.random() * statKeys.length)];
    const statVal = combatStats[chosenStat] || 30;
    damage = statVal * def.mult + Math.random() * (statVal * def.randMult);
    // Fizzle (10%)
    if (Math.random() < 0.1) {
      damage = 0;
      events.push(`${prefix} ${def.label} fizzled!`);
    } else {
      // Crit (25%)
      if (Math.random() < 0.25) {
        damage *= 2;
        events.push(`${prefix} ${def.label} scored a wild critical hit!`);
      }
      // Standard matchup modifiers
      if (opponentMove === 'strike') { damage *= 1.3; events.push(`${prefix} ${def.label} overpowered ${target} strike!`); }
      if (opponentMove === 'guard') { damage *= 0.7; events.push(`${side === 'player' ? 'Opponent' : 'You'} partially blocked the ${def.label}.`); }
      if (opponentMove === 'heal') { damage *= 1.2; events.push(`${prefix} ${def.label} punished ${target} healing!`); }
    }
    damage = Math.max(0, Math.floor(damage));
  } else {
    // Damage abilities: powerStrike, arcaneBlast, shadowStrike
    const statVal = combatStats[def.stat] || 40;
    damage = statVal * def.mult + Math.random() * (statVal * def.randMult);

    if (abilityKey === 'shadowStrike') alwaysFirst = true;

    // Standard matchup modifiers
    if (opponentMove === 'strike') { damage *= 1.3; events.push(`${prefix} ${def.label} overpowered ${target} strike!`); }
    if (opponentMove === 'guard') {
      let guardMult = 0.7;
      if (abilityKey === 'powerStrike') { guardMult = 1.4 * 0.7; } // 0.98 — nearly full damage
      damage *= guardMult;
      if (abilityKey === 'powerStrike') {
        events.push(`${prefix} ${def.label} smashed through ${target} guard!`);
      } else {
        events.push(`${side === 'player' ? 'Opponent' : 'You'} partially blocked the ${def.label}.`);
      }
    }
    if (opponentMove === 'heal') { damage *= 1.2; events.push(`${prefix} ${def.label} punished ${target} healing!`); }

    // Arcane Blast applies vulnerable debuff
    if (abilityKey === 'arcaneBlast' && damage > 0) {
      tempEffect = { effect: 'vulnerable', value: 15, roundsLeft: 1 };
      events.push(`${prefix} ${def.label} left the target vulnerable!`);
    }

    damage = Math.max(1, Math.floor(damage));
  }

  return { damage, heal, tempEffect, alwaysFirst };
}

function generateBossMove(boss, round, currentHp, maxHp, opponentCharges) {
  const config = loadArenaConfig();
  const pattern = config.aiPatterns[boss.arenaOverrides?.aiPattern || 'balanced'];
  let weights = { ...pattern };

  // Low HP override: boost guard and heal
  if (currentHp / maxHp < config.aiLowHpThreshold) {
    weights.guard += config.aiLowHpGuardBoost;
    weights.heal = (weights.heal || 0) + (config.aiLowHpHealBoost || 15);
  }

  // If boss doesn't have enough charges, remove ability from weights
  const cc = config.chargeConfig || {};
  if (opponentCharges !== undefined && opponentCharges < (cc.abilityCost || 2)) {
    weights.strike += weights.ability; // redistribute ability weight to strike
    weights.ability = 0;
  }

  const counterWeight = weights.counter || 8;
  const total = weights.strike + weights.guard + weights.ability + (weights.heal || 0) + counterWeight;
  const roll = Math.random() * total;

  if (roll < weights.strike) return 'strike';
  if (roll < weights.strike + weights.guard) return 'guard';
  if (roll < weights.strike + weights.guard + weights.ability) return 'ability';
  if (roll < weights.strike + weights.guard + weights.ability + (weights.heal || 0)) return 'heal';
  return 'counter';
}

function resolveRound(player, opponent, playerMove, opponentMove, battleTempEffects) {
  const config = loadArenaConfig();
  const events = [];

  // Speed check: AGI + random 0–10 jitter determines who attacks first
  const playerSpeed = player.combatStats.agi + Math.random() * 10;
  const opponentSpeed = opponent.combatStats.agi + Math.random() * 10;
  let speedWinner = playerSpeed >= opponentSpeed ? 'player' : 'opponent';

  // Shadow Strike overrides speed
  if (playerMove === 'ability' && player.abilityKey === 'shadowStrike') speedWinner = 'player';
  if (opponentMove === 'ability' && opponent.abilityKey === 'shadowStrike') speedWinner = 'opponent';

  let playerDamageTaken = 0;
  let opponentDamageTaken = 0;
  let playerHeal = 0;
  let opponentHeal = 0;
  const newTempEffects = { player: [], opponent: [] };

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

  // Apply active temp effects from previous round
  const te = battleTempEffects || { player: [], opponent: [] };
  let playerVulnerable = 0;
  let opponentVulnerable = 0;
  let playerFortified = 0;
  let opponentFortified = 0;
  // B2: status effects
  let playerBurn = 0, opponentBurn = 0;
  let playerStunned = false, opponentStunned = false;
  let playerBlind = false, opponentBlind = false;
  const persistedEffects = { player: [], opponent: [] };

  for (const eff of (te.player || [])) {
    if (eff.effect === 'vulnerable') playerVulnerable += eff.value;
    if (eff.effect === 'fortified')  playerFortified  += eff.value;
    if (eff.effect === 'burn')  {
      playerBurn = eff.value;
      if ((eff.roundsLeft || 1) > 1) persistedEffects.player.push({ ...eff, roundsLeft: eff.roundsLeft - 1 });
    }
    if (eff.effect === 'stun')  { playerStunned = true; }
    if (eff.effect === 'blind') { playerBlind = true; }
  }
  for (const eff of (te.opponent || [])) {
    if (eff.effect === 'vulnerable') opponentVulnerable += eff.value;
    if (eff.effect === 'fortified')  opponentFortified  += eff.value;
    if (eff.effect === 'burn')  {
      opponentBurn = eff.value;
      if ((eff.roundsLeft || 1) > 1) persistedEffects.opponent.push({ ...eff, roundsLeft: eff.roundsLeft - 1 });
    }
    if (eff.effect === 'stun')  { opponentStunned = true; }
    if (eff.effect === 'blind') { opponentBlind = true; }
  }

  // --- Player attacks opponent ---
  let playerOutDmg = 0;
  if (playerStunned) {
    events.push('You are stunned and cannot attack this round!');
  } else if (playerMove === 'strike') {
    // Strike: 40% of STR as base + up to 10% STR as random variance
    const str = player.combatStats.str + playerStrBonus;
    playerOutDmg = str * 0.4 + Math.random() * (str * 0.1);
    const isCrit = Math.random() * 100 < playerCritChance;
    if (isCrit) {
      playerOutDmg *= 1.5;
      events.push('Your strike landed a critical hit!');
      // B2: Burn on crit strike
      newTempEffects.opponent.push({ effect: 'burn', value: Math.round(opponent.maxHp * 0.08), roundsLeft: 2 });
      events.push('Your critical strike ignites the opponent! (Burn x2)');
    }
    // B2: Blind miss chance
    if (playerBlind && Math.random() < 0.40) {
      events.push('Blind! Your strike misses!');
      playerOutDmg = 0;
    }
    // Guard reduces strike by 60%
    if (opponentMove === 'guard' && playerOutDmg > 0) {
      playerOutDmg *= 0.4;
      events.push('Opponent braced for your strike.');
    }
    if (playerOutDmg > 0) {
      playerOutDmg = Math.max(1, Math.floor(playerOutDmg * (1 - opponentDmgReduction / 100)));
      opponentDamageTaken += playerOutDmg;
    }
  } else if (playerMove === 'ability') {
    const abilityResult = resolveClassAbility(player.abilityKey || 'arcaneBlast', player.combatStats, opponentMove, config, events, 'player');
    playerOutDmg = abilityResult.damage + playerAbilityBonus;
    if (playerOutDmg > 0) {
      playerOutDmg = Math.max(1, Math.floor(playerOutDmg));
      opponentDamageTaken += playerOutDmg;
    }
    if (abilityResult.heal > 0) playerHeal += abilityResult.heal;
    if (abilityResult.tempEffect) newTempEffects.opponent.push(abilityResult.tempEffect);
    if (abilityResult.alwaysFirst) speedWinner = 'player';
    // B2: Stun when ability hits a guarding opponent
    if (opponentMove === 'guard') {
      newTempEffects.opponent.push({ effect: 'stun', roundsLeft: 1 });
      events.push('Your ability stuns the guarding opponent! (Stun x1)');
    }
    // B2: Shadow Strike crit → Blind
    if (player.abilityKey === 'shadowStrike' && abilityResult.damage > 0) {
      if (Math.random() * 100 < playerCritChance) {
        newTempEffects.opponent.push({ effect: 'blind', roundsLeft: 1 });
        events.push('Shadow Strike blinds the opponent! (Blind x1)');
      }
    }
  } else if (playerMove === 'guard') {
    events.push('You raised your guard.');
  } else if (playerMove === 'heal') {
    // Heal: 30% of END as base + up to 10% END as random variance
    const end = player.combatStats.end;
    let healAmt = end * 0.3 + Math.random() * (end * 0.1);
    if (opponentMove === 'strike') {
      healAmt *= 0.5;
      events.push('Your healing was disrupted by the strike!');
    } else if (opponentMove === 'ability') {
      healAmt = 0;
      events.push('Your healing was interrupted by the ability!');
    }
    healAmt = Math.round(healAmt);
    playerHeal += healAmt;
    if (healAmt > 0) events.push(`You focused and recovered ${healAmt} HP.`);
  } else if (playerMove === 'counter') {
    // Resolved after opponent's attack is computed — see counter resolution block
    events.push('You took a counter stance.');
  }

  // --- Opponent attacks player ---
  let opponentOutDmg = 0;
  if (opponentStunned) {
    events.push('Opponent is stunned and cannot attack this round!');
  } else if (opponentMove === 'strike') {
    const str = opponent.combatStats.str + opponentStrBonus;
    opponentOutDmg = str * 0.4 + Math.random() * (str * 0.1);
    const isCrit = Math.random() * 100 < opponentCritChance;
    if (isCrit) {
      opponentOutDmg *= 1.5;
      events.push('Opponent landed a critical hit!');
      // B2: Burn on crit strike
      newTempEffects.player.push({ effect: 'burn', value: Math.round(player.maxHp * 0.08), roundsLeft: 2 });
      events.push("Opponent's critical strike ignites you! (Burn x2)");
    }
    // B2: Blind miss chance
    if (opponentBlind && Math.random() < 0.40) {
      events.push("Blind! Opponent's strike misses!");
      opponentOutDmg = 0;
    }
    if (playerMove === 'guard' && opponentOutDmg > 0) {
      opponentOutDmg *= 0.4;
      events.push('You braced for their strike.');
    }
    if (opponentOutDmg > 0) {
      opponentOutDmg = Math.max(1, Math.floor(opponentOutDmg * (1 - playerDmgReduction / 100)));
      playerDamageTaken += opponentOutDmg;
    }
  } else if (opponentMove === 'ability') {
    const abilityResult = resolveClassAbility(opponent.abilityKey || 'arcaneBlast', opponent.combatStats, playerMove, config, events, 'opponent');
    opponentOutDmg = abilityResult.damage + opponentAbilityBonus;
    if (opponentOutDmg > 0) {
      opponentOutDmg = Math.max(1, Math.floor(opponentOutDmg));
      playerDamageTaken += opponentOutDmg;
    }
    if (abilityResult.heal > 0) opponentHeal += abilityResult.heal;
    if (abilityResult.tempEffect) newTempEffects.player.push(abilityResult.tempEffect);
    if (abilityResult.alwaysFirst) speedWinner = 'opponent';
    // B2: Stun when ability hits a guarding player
    if (playerMove === 'guard') {
      newTempEffects.player.push({ effect: 'stun', roundsLeft: 1 });
      events.push('Opponent ability stuns you while guarding! (Stun x1)');
    }
    // B2: Shadow Strike crit → Blind
    if (opponent.abilityKey === 'shadowStrike' && abilityResult.damage > 0) {
      if (Math.random() * 100 < opponentCritChance) {
        newTempEffects.player.push({ effect: 'blind', roundsLeft: 1 });
        events.push('Shadow Strike blinds you! (Blind x1)');
      }
    }
  } else if (opponentMove === 'guard') {
    events.push('Opponent raised their guard.');
  } else if (opponentMove === 'heal') {
    const end = opponent.combatStats.end;
    let healAmt = end * 0.3 + Math.random() * (end * 0.1);
    if (playerMove === 'strike') {
      healAmt *= 0.5;
      events.push('Opponent\'s healing was disrupted by your strike!');
    } else if (playerMove === 'ability') {
      healAmt = 0;
      events.push('Opponent\'s healing was interrupted by your ability!');
    }
    healAmt = Math.round(healAmt);
    opponentHeal += healAmt;
    if (healAmt > 0) events.push(`Opponent focused and recovered ${healAmt} HP.`);
  } else if (opponentMove === 'counter') {
    // Resolved after player's attack is computed — see counter resolution block
    events.push('Opponent took a counter stance.');
  }

  // Apply temp effects: vulnerable increases damage taken, fortified reduces it
  if (playerVulnerable > 0 && playerDamageTaken > 0) {
    const bonus = Math.round(playerDamageTaken * playerVulnerable / 100);
    playerDamageTaken += bonus;
    if (bonus > 0) events.push(`Vulnerable! You took ${bonus} extra damage.`);
  }
  if (playerFortified > 0 && playerDamageTaken > 0) {
    const reduction = Math.round(playerDamageTaken * playerFortified / 100);
    playerDamageTaken = Math.max(1, playerDamageTaken - reduction);
    if (reduction > 0) events.push(`Fortified! You resisted ${reduction} damage.`);
  }
  if (opponentVulnerable > 0 && opponentDamageTaken > 0) {
    const bonus = Math.round(opponentDamageTaken * opponentVulnerable / 100);
    opponentDamageTaken += bonus;
    if (bonus > 0) events.push(`Opponent is vulnerable! They took ${bonus} extra damage.`);
  }
  if (opponentFortified > 0 && opponentDamageTaken > 0) {
    const reduction = Math.round(opponentDamageTaken * opponentFortified / 100);
    opponentDamageTaken = Math.max(1, opponentDamageTaken - reduction);
    if (reduction > 0) events.push(`Opponent's fortification resisted ${reduction} damage.`);
  }

  // B3: Counter resolution — must run after temp effects so reflect uses final damage values
  let playerCounterReflect = false;
  let opponentCounterReflect = false;

  if (playerMove === 'counter' && opponentMove === 'counter') {
    playerDamageTaken = 0;
    opponentDamageTaken = 0;
    events.push('Counter standoff! Both fighters mirror each other.');
  } else if (playerMove === 'counter') {
    if (opponentMove === 'strike') {
      const reflected = Math.max(1, Math.round(playerDamageTaken * 0.5));
      opponentDamageTaken += reflected;
      playerDamageTaken = 0;
      playerCounterReflect = true;
      events.push(`Counter! You deflected the strike and reflected ${reflected} damage back!`);
    } else if (opponentMove === 'guard') {
      playerDamageTaken = 0;
      events.push('Counter standoff — opponent guarded. Nothing to reflect.');
    } else {
      // ability or heal — counter fails, player takes full damage
      events.push('Your counter failed! The opponent did not strike.');
    }
  } else if (opponentMove === 'counter') {
    if (playerMove === 'strike') {
      const reflected = Math.max(1, Math.round(opponentDamageTaken * 0.5));
      playerDamageTaken += reflected;
      opponentDamageTaken = 0;
      opponentCounterReflect = true;
      events.push(`Counter! Opponent deflected your strike and reflected ${reflected} damage back!`);
    } else if (playerMove === 'guard') {
      opponentDamageTaken = 0;
      events.push('Counter standoff — you guarded. Opponent has nothing to reflect.');
    } else {
      // ability or heal — opponent counter fails
      events.push("Opponent's counter failed! You did not strike.");
    }
  }

  // B2: Burn DoT — applied after counter resolution
  if (playerBurn > 0) {
    playerDamageTaken += playerBurn;
    events.push(`\uD83D\uDD25 Burn deals ${playerBurn} damage to you!`);
  }
  if (opponentBurn > 0) {
    opponentDamageTaken += opponentBurn;
    events.push(`\uD83D\uDD25 Burn deals ${opponentBurn} damage to opponent!`);
  }

  // B2: Merge persisted multi-round effects with newly applied effects
  newTempEffects.player   = [...persistedEffects.player,   ...newTempEffects.player];
  newTempEffects.opponent = [...persistedEffects.opponent, ...newTempEffects.opponent];

  // Passive HP regen (applies every round regardless of action)
  const playerRegenBonus = getPassiveValue(player.passives, 'hp_regen');
  if (playerRegenBonus > 0) {
    playerHeal += playerRegenBonus;
    events.push(`Regen restored ${playerRegenBonus} HP.`);
  }
  const opponentRegenBonus = getPassiveValue(opponent.passives, 'hp_regen');
  if (opponentRegenBonus > 0) {
    opponentHeal += opponentRegenBonus;
  }

  return {
    speedWinner,
    playerDamageTaken,
    opponentDamageTaken,
    playerHeal,
    opponentHeal,
    events,
    newTempEffects,
    playerCounterReflect,
    opponentCounterReflect
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
    const { userId: rawUserId, isAuthenticated } = extractUserInfo(req, context);
    const isDemo = !isAuthenticated;
    const userId = isDemo ? 'demo-guest' : rawUserId;

    const body = req.body || {};
    const { action } = body;

    // Block demo users from PvP
    if (isDemo && action === 'start' && body.type === 'pvp') {
      context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Sign in to challenge other players' } };
      return;
    }

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    if (action === 'start') {
      await handleStart(context, containerClient, userId, body, isDemo);
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

async function handleStart(context, containerClient, userId, body, isDemo = false) {
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

  // Load player's card — demo users or Stranger card pass data in request body
  let playerCard;
  if (body.cardData && (isDemo || cardId === 'stranger-card')) {
    playerCard = body.cardData;
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
    // Blindspot bosses use levels 101-110 with separate progression
    const isBlindspotBoss = bossLevel >= 101 && bossLevel <= 110;
    if (isDemo) {
      // Demo: first 3 CardForge bosses OR first Blindspot boss
      const demoAllowed = isBlindspotBoss ? (bossLevel <= 101) : (bossLevel <= 3);
      if (!demoAllowed) {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Sign in to unlock more bosses' } };
        return;
      }
    } else {
      const profile = await downloadJsonBlob(containerClient, `arena/profiles/${userId}.json`);
      if (isBlindspotBoss) {
        // Blindspot: separate progression lane
        const bsHighest = profile?.pveProgress?.blindspotHighestDefeated || 100;
        if (bossLevel > bsHighest + 1) {
          context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This boss is still locked. Defeat the previous boss first.' } };
          return;
        }
      } else {
        const highestDefeated = profile?.pveProgress?.highestBossDefeated || 0;
        if (bossLevel > highestDefeated + 1) {
          context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This boss is still locked. Defeat the previous boss first.' } };
          return;
        }
      }
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

  // Load player profile for rank-based buff qty caps
  const playerProfile = await downloadJsonBlob(containerClient, `arena/profiles/${userId}.json`);
  const playerRank = (playerProfile && playerProfile.rank) ? playerProfile.rank : 'bronze';

  // Compute combat stats — passives clamped to rank-based qty cap
  const playerCombat = mapCardToCombatStats(playerCard);
  const opponentCombat = mapCardToCombatStats(opponentCard);
  const playerPassives = computePassives(playerCard, playerRank);
  const opponentPassives = computePassives(opponentCard, 'diamond'); // AI/opponents use uncapped

  // Apply persistent stat bonuses from buffs (end_bonus, all_stats)
  applyStatPassives(playerCombat, playerPassives);
  applyStatPassives(opponentCombat, opponentPassives);

  const playerMaxHp = computeMaxHp(playerCombat);
  const opponentMaxHp = computeMaxHp(opponentCombat);

  // Compute ability keys from card class (or dominant stat fallback for bosses)
  const playerAbilityKey = getAbilityKey(playerCard.class, playerCombat, config);
  const opponentAbilityKey = getAbilityKey(opponentCard.class, opponentCombat, config);

  // Compute charge rates
  const playerXp = (playerProfile && playerProfile.xp) ? playerProfile.xp : 0;
  const playerChargeRate = computeChargeRate(playerCombat, playerXp, config);
  const opponentChargeRate = computeChargeRate(opponentCombat, 1500, config); // AI assumed Gold-level

  const cc = config.chargeConfig || {};

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
      moves: [],
      abilityKey: playerAbilityKey
    },
    player2: {
      userId: type === 'pve' ? opponentId : 'gallery',
      cardId: opponentCard.id,
      cardSnapshot: { name: opponentCard.name, class: opponentCard.class, avatar: opponentCard.avatar, quote: opponentCard.quote },
      combatStats: opponentCombat,
      maxHp: opponentMaxHp,
      hp: opponentMaxHp,
      passives: opponentPassives,
      moves: [],
      bossLevel,
      abilityKey: opponentAbilityKey
    },
    charges: { player: cc.startCharges || 0, opponent: cc.startCharges || 0 },
    chargeRate: { player: playerChargeRate, opponent: opponentChargeRate },
    tempEffects: { player: [], opponent: [] },
    roundLog: [],
    winner: null,
    isDemo: isDemo,
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
        passives: playerPassives,
        abilityKey: playerAbilityKey,
        abilityDef: config.abilityDefs[playerAbilityKey]
      },
      opponent: {
        name: opponentCard.name,
        class: opponentCard.class,
        avatar: opponentCard.avatar,
        combatStats: opponentCombat,
        maxHp: opponentMaxHp,
        hp: opponentMaxHp,
        bossLevel,
        abilityKey: opponentAbilityKey
      },
      charges: { player: cc.startCharges || 0, opponent: cc.startCharges || 0 },
      chargeRate: playerChargeRate,
      abilityCost: cc.abilityCost || 2,
      maxCharges: cc.maxCharges || 4,
      currentRound: 1,
      totalRounds: config.totalRounds,
      status: 'active'
    }
  };
}

// --- Action: move ---

async function handleMove(context, containerClient, userId, body) {
  const { battleId, round, move, crowdBoost } = body;

  if (!battleId || !round || !move) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'battleId, round, and move are required' } };
    return;
  }
  if (!['strike', 'guard', 'ability', 'heal', 'counter'].includes(move)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'move must be strike, guard, ability, heal, or counter' } };
    return;
  }

  const battlePath = `arena/battles/${battleId}.json`;
  const battle = await downloadJsonBlob(containerClient, battlePath);

  if (!battle) {
    context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Battle not found' } };
    return;
  }
  // Ownership check: allow demo battles for anonymous users
  if (!battle.isDemo && battle.player1.userId !== userId) {
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

  // Charge validation: ability requires enough charges
  const hasCharges = battle.charges && battle.charges.player !== undefined;
  if (move === 'ability' && hasCharges) {
    if (battle.charges.player < (cc.abilityCost || 2)) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Not enough charges to use ability' } };
      return;
    }
  }

  // Generate opponent move on-the-fly (charge-aware) or use pre-generated for old battles
  let opponentMove;
  if (hasCharges) {
    opponentMove = generateBossMove(
      battle.type === 'pve' ? { arenaOverrides: opponent.arenaOverrides || { aiPattern: 'balanced' }, combatStats: opponent.combatStats } : { arenaOverrides: { aiPattern: 'balanced' } },
      round, opponent.hp, opponent.maxHp, battle.charges.opponent
    );
  } else {
    opponentMove = opponent.moves[round - 1] || 'strike';
  }

  // Resolve the round with ability keys and temp effects
  const result = resolveRound(
    { combatStats: player.combatStats, passives: player.passives, maxHp: player.maxHp, abilityKey: player.abilityKey },
    { combatStats: opponent.combatStats, passives: opponent.passives, maxHp: opponent.maxHp, abilityKey: opponent.abilityKey },
    move, opponentMove, battle.tempEffects
  );

  // B4: Crowd Boost — hype meter filled by crits/streaks/stuns, +15% dmg when spent
  if (crowdBoost === true && result.opponentDamageTaken > 0) {
    const boost = Math.round(result.opponentDamageTaken * 0.15);
    result.opponentDamageTaken += boost;
    result.events.push(`CROWD ERUPTS! Crowd energy fuels your attack! (+${boost} damage)`);
  }

  // B1: Last Stand — below 20% HP → +10 flat damage on any attack (desperation bonus)
  const playerInLastStand = player.hp > 0 && player.hp < player.maxHp * 0.20;
  const opponentInLastStand = opponent.hp > 0 && opponent.hp < opponent.maxHp * 0.20;
  if (playerInLastStand && result.opponentDamageTaken > 0) {
    result.opponentDamageTaken += 10;
    result.events.push('Last Stand! You fight with desperate fury! (+10 damage)');
  }
  if (opponentInLastStand && result.playerDamageTaken > 0) {
    result.playerDamageTaken += 10;
    result.events.push('Last Stand! Opponent fights with desperate fury! (+10 damage)');
  }

  // Apply damage and healing
  player.hp = Math.min(player.maxHp, Math.max(0, player.hp - result.playerDamageTaken + result.playerHeal));
  opponent.hp = Math.min(opponent.maxHp, Math.max(0, opponent.hp - result.opponentDamageTaken + result.opponentHeal));

  // Update charges
  if (hasCharges) {
    const maxCh = cc.maxCharges || 4;
    const rate = battle.chargeRate || { player: 1, opponent: 1 };
    // Gain charges
    battle.charges.player = Math.min(maxCh, battle.charges.player + (rate.player || 1));
    battle.charges.opponent = Math.min(maxCh, battle.charges.opponent + (rate.opponent || 1));
    // Deduct if ability was used
    if (move === 'ability') battle.charges.player -= (cc.abilityCost || 2);
    if (opponentMove === 'ability') battle.charges.opponent -= (cc.abilityCost || 2);
    battle.charges.player = Math.max(0, battle.charges.player);
    battle.charges.opponent = Math.max(0, battle.charges.opponent);
  }

  // Update temp effects: replace with new ones from this round
  if (battle.tempEffects) {
    battle.tempEffects = result.newTempEffects || { player: [], opponent: [] };
  }

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
    speedWinner: result.speedWinner,
    charges: hasCharges ? battle.charges : undefined,
    tempEffects: battle.tempEffects,
    playerLastStand: playerInLastStand,
    opponentLastStand: opponentInLastStand,
    playerCounterReflect: result.playerCounterReflect,
    opponentCounterReflect: result.opponentCounterReflect
  };

  battle.roundLog.push(roundResult);

  // Check for battle end — KO only (round cap is a safety net, not a win condition)
  const isKo = player.hp <= 0 || opponent.hp <= 0;

  let battleResult = null;

  if (isKo) {
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
  // Ownership check: allow demo battles for anonymous users
  if (!battle.isDemo && battle.player1.userId !== userId) {
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

  // Demo mode: skip all persistence, just clean up and return result
  if (battle.isDemo) {
    await deleteBlob(containerClient, `arena/battles/${battle.battleId}.json`);
    context.log(`[Arena] Demo battle ${battle.battleId} complete: ${result}, +${totalXp} XP (not saved)`);
    return {
      winner: result === 'win' ? 'player' : result === 'loss' ? 'opponent' : 'draw',
      xpEarned: totalXp,
      newXp: totalXp,
      newLevel: 1,
      newRank: 'bronze',
      rankUp: false,
      record: { wins: result === 'win' ? 1 : 0, losses: result === 'loss' ? 1 : 0, draws: result === 'draw' ? 1 : 0 },
      isDemo: true
    };
  }

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

  // PvE progress — separate tracking for Blindspot (levels 101-110) vs CardForge (levels 1-10)
  if (type === 'pve' && result === 'win') {
    const isBsBoss = bossLevel >= 101 && bossLevel <= 110;
    if (isBsBoss) {
      if (bossLevel > (profile.pveProgress.blindspotHighestDefeated || 100)) {
        profile.pveProgress.blindspotHighestDefeated = bossLevel;
      }
    } else if (bossLevel > (profile.pveProgress.highestBossDefeated || 0)) {
      profile.pveProgress.highestBossDefeated = bossLevel;
    }
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
