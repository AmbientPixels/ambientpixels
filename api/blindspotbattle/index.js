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
// BLINDSPOT BATTLE ENGINE — Forked from CardForge Arena Battle
// ═══════════════════════════════════════════════════════════════════════════
//
// Blindspot-only battle API. Uses the same combat engine as CardForge but:
// - Only serves Blindspot bosses (bossLevel 101-110) and weekly bosses (201+)
// - Progression tracked via blindspotHighestDefeated (shared profile blob)
// - No CardForge boss logic (bossLevel 1-10)
// - Demo users see only first Blindspot boss (bossLevel 101)
// - All Blindspot features: stat-threshold passives, weakness exploit, etc.
//
// See CardForge arena-battle index.js for full combat math reference.
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

// Compute stat-threshold passives (Blindspot strategy system)
// These are earned by having high enough stats — no badges needed
function computeStatThresholdPassives(combatStats) {
  if (!combatStats) return [];
  const passives = [];
  const cs = combatStats;

  // STR passives
  if ((cs.str || 0) >= 60) passives.push({ source: 'stat:str60', effect: 'guard_pierce', value: 20 }); // Strike ignores 20% of Guard
  if ((cs.str || 0) >= 80) passives.push({ source: 'stat:str80', effect: 'crit_damage', value: 25 }); // +25% crit damage

  // AGI passives
  if ((cs.agi || 0) >= 60) passives.push({ source: 'stat:agi60', effect: 'speed_priority', value: 1 }); // Always act first
  if ((cs.agi || 0) >= 80) passives.push({ source: 'stat:agi80', effect: 'dodge', value: 15 }); // 15% dodge chance

  // INT passives
  if ((cs.int || 0) >= 60) passives.push({ source: 'stat:int60', effect: 'ability_discount', value: 1 }); // Ability costs 1 charge
  if ((cs.int || 0) >= 60) passives.push({ source: 'stat:int60', effect: 'ability_stamina_discount', value: 1 }); // Ability costs 1 less stamina
  if ((cs.int || 0) >= 80) passives.push({ source: 'stat:int80', effect: 'ability_power', value: 30 }); // +30% ability damage

  // END passives
  if ((cs.end || 0) >= 60) passives.push({ source: 'stat:end60', effect: 'heal_dr', value: 10 }); // Heal grants 10% DR for 1 round
  if ((cs.end || 0) >= 80) passives.push({ source: 'stat:end80', effect: 'hp_regen', value: 5 }); // Auto-heal 5 HP per round

  // LCK passives
  if ((cs.lck || 0) >= 50) passives.push({ source: 'stat:lck50', effect: 'crit_chance', value: 10 }); // +10% crit chance
  if ((cs.lck || 0) >= 70) passives.push({ source: 'stat:lck70', effect: 'crit_damage', value: 50 }); // Crits deal 2x (extra 50% on top of 1.5x)

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

// HP = 80 base + END contribution (150%) + STR contribution (30%)
function computeMaxHp(combatStats) {
  return Math.round(80 + (combatStats.end * 1.5) + (combatStats.str * 0.3));
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

  const prefix = side === 'player' ? 'Your' : "Enemy's";
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
      heal *= 0.75;
      events.push(`${prefix} fortify was disrupted by ${target} strike! (25% reduced)`);
    } else if (opponentMove === 'ability') {
      heal *= 0.4;
      events.push(`${prefix} fortify was disrupted by ${target} ability! (60% reduced)`);
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
      if (opponentMove === 'guard') { damage *= 0.7; events.push(`\uD83D\uDEE1\uFE0F ${side === 'player' ? 'Enemy' : 'You'} partially blocked the ${def.label}.`); }
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
        events.push(`\uD83D\uDEE1\uFE0F ${side === 'player' ? 'Enemy' : 'You'} partially blocked the ${def.label}.`);
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

function generateBossMove(boss, round, currentHp, maxHp, opponentCharges, bossStamina, bossMaxStamina, bossCooldowns, bossStance) {
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

  // Stamina awareness: reduce weight for moves boss can't afford, boost Guard when low
  if (bossStamina !== undefined) {
    const sc = config.staminaConfig || {};
    const costs = sc.costs || {};
    ['strike', 'guard', 'ability', 'heal', 'counter'].forEach(function(m) {
      const cost = costs[m] || 2;
      if (bossStamina < cost) {
        weights[m] = Math.max(0, (weights[m] || 0) * 0.2);
      }
    });
    if (bossMaxStamina && bossStamina < bossMaxStamina * 0.25) {
      weights.guard = (weights.guard || 0) + 15;
    }
  }

  // Cooldown awareness: zero out weight for moves on cooldown
  if (bossCooldowns) {
    Object.keys(bossCooldowns).forEach(function(m) {
      if (bossCooldowns[m] > 0) weights[m] = 0;
    });
  }

  // Stance awareness: Defensive boosts guard/heal, Aggressive boosts strike/ability
  if (bossStance === 'defensive') {
    weights.guard = (weights.guard || 0) + 10;
    weights.heal = (weights.heal || 0) + 10;
  } else if (bossStance === 'aggressive') {
    weights.strike = (weights.strike || 0) + 10;
    weights.ability = (weights.ability || 0) + 5;
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

function resolveRound(player, opponent, playerMove, opponentMove, battleTempEffects, staminaState, stanceState, elements, battle) {
  const config = loadArenaConfig();
  const events = [];
  const playerStance = (stanceState && stanceState.player) || 'balanced';
  const opponentStance = (stanceState && stanceState.opponent) || 'balanced';

  // Stamina exhaustion: HP burn when below threshold (fighting costs life force)
  const sc = config.staminaConfig || {};
  const exhaustionThreshold = sc.exhaustionThreshold || 3;
  const exhaustionBurnPct = sc.exhaustionBurnPct || 0.03;
  const playerExhausted = staminaState && staminaState.player < exhaustionThreshold;
  const opponentExhausted = staminaState && staminaState.opponent < exhaustionThreshold;

  // Move label map for round header
  const moveLabels = { strike: 'Strike', guard: 'Guard', ability: 'Ability', heal: 'Heal', counter: 'Counter' };
  events.push(`\u2694\uFE0F You chose ${moveLabels[playerMove] || playerMove} \u2014 Enemy chose ${moveLabels[opponentMove] || opponentMove}`);

  // Speed check: AGI + random 0–10 jitter determines who attacks first
  const playerSpeed = player.combatStats.agi + Math.random() * 10;
  const opponentSpeed = opponent.combatStats.agi + Math.random() * 10;
  let speedWinner = playerSpeed >= opponentSpeed ? 'player' : 'opponent';

  // Speed priority passive (AGI 60+): always act first
  if (getPassiveValue(player.passives, 'speed_priority') > 0 && getPassiveValue(opponent.passives, 'speed_priority') === 0) speedWinner = 'player';
  if (getPassiveValue(opponent.passives, 'speed_priority') > 0 && getPassiveValue(player.passives, 'speed_priority') === 0) speedWinner = 'opponent';

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
  const playerWeaknessBonus = 1 + (getPassiveValue(player.passives, 'weakness_exploit') / 100); // Boss weakness damage bonus

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
    events.push('\uD83D\uDCA5 You are stunned and cannot act this round!');
  } else if (playerMove === 'strike') {
    // Strike: 40% of STR as base + up to 10% STR as random variance
    const str = player.combatStats.str + playerStrBonus;
    playerOutDmg = str * 0.3 + Math.random() * (str * 0.1);
    const isCrit = Math.random() * 100 < playerCritChance;
    if (isCrit) {
      const critDmgBonus = getPassiveValue(player.passives, 'crit_damage');
      const critMultiplier = 1.5 + (critDmgBonus / 100) + (playerStance === 'aggressive' ? 0.15 : 0);
      playerOutDmg *= critMultiplier;
      events.push(`\u2728 Your strike landed a critical hit! (${Math.round(critMultiplier * 100)}% damage)`);
      // B2: Burn on crit strike
      newTempEffects.opponent.push({ effect: 'burn', value: Math.round(opponent.maxHp * 0.08), roundsLeft: 2 });
      events.push('\uD83D\uDD25 The critical strike ignites the enemy! (Burn x2 rounds)');
    }
    // B2: Blind miss chance
    if (playerBlind && Math.random() < 0.40) {
      events.push('\uD83D\uDE35 Blinded! Your strike swings wide and misses!');
      playerOutDmg = 0;
    }
    // Dodge check (AGI 80+ passive)
    const oppDodge = getPassiveValue(opponent.passives, 'dodge');
    if (oppDodge > 0 && Math.random() * 100 < oppDodge && playerOutDmg > 0) {
      events.push('\uD83D\uDCA8 Enemy dodged your strike!');
      playerOutDmg = 0;
    }
    // Guard reduces strike — guard_pierce reduces guard effectiveness
    if (opponentMove === 'guard' && playerOutDmg > 0) {
      const guardPierce = getPassiveValue(player.passives, 'guard_pierce');
      const baseBlock = opponentStance === 'defensive' ? 0.8 : 0.6; // Defensive stance: 80% block
      const guardBlock = Math.max(0.2, baseBlock - (guardPierce / 100));
      const preGuard = Math.floor(playerOutDmg);
      playerOutDmg *= (1 - guardBlock);
      events.push(`\uD83D\uDEE1\uFE0F Enemy guarded, blocked ${Math.round(guardBlock * 100)}% of your strike (${preGuard} \u2192 ${Math.floor(playerOutDmg)}).`);
    }
    if (playerOutDmg > 0) {
      playerOutDmg = Math.max(1, Math.floor(playerOutDmg * (1 - opponentDmgReduction / 100)));
      opponentDamageTaken += playerOutDmg;
      events.push(`\u2694\uFE0F You struck for ${playerOutDmg} damage!`);
    }
  } else if (playerMove === 'ability') {
    const abilityResult = resolveClassAbility(player.abilityKey || 'arcaneBlast', player.combatStats, opponentMove, config, events, 'player');
    playerOutDmg = abilityResult.damage + playerAbilityBonus;
    if (playerOutDmg > 0) {
      playerOutDmg = Math.max(1, Math.floor(playerOutDmg));
      opponentDamageTaken += playerOutDmg;
      events.push(`\u2728 Your ability dealt ${playerOutDmg} damage!`);
    }
    if (abilityResult.heal > 0) playerHeal += abilityResult.heal;
    if (abilityResult.tempEffect) newTempEffects.opponent.push(abilityResult.tempEffect);
    if (abilityResult.alwaysFirst) speedWinner = 'player';
    // B2: Stun when ability hits a guarding opponent
    if (opponentMove === 'guard') {
      newTempEffects.opponent.push({ effect: 'stun', roundsLeft: 1 });
      events.push('\uD83D\uDCA5 Your ability breaks through their guard \u2014 enemy stunned! (Stun x1)');
    }
    // B2: Shadow Strike crit -> Blind
    if (player.abilityKey === 'shadowStrike' && abilityResult.damage > 0) {
      if (Math.random() * 100 < playerCritChance) {
        newTempEffects.opponent.push({ effect: 'blind', roundsLeft: 1 });
        events.push('\uD83C\uDF11 Shadow Strike blinds the enemy! (Blind x1)');
      }
    }
  } else if (playerMove === 'guard') {
    events.push('\uD83D\uDEE1\uFE0F You raised your guard, bracing for impact.');
  } else if (playerMove === 'heal') {
    // Heal: 30% of END as base + up to 10% END as random variance
    const end = player.combatStats.end;
    let healAmt = end * 0.5 + Math.random() * (end * 0.12);
    if (opponentMove === 'strike') {
      healAmt *= 0.75;
      events.push('\u26A0\uFE0F Your healing was disrupted by the enemy strike! (25% reduced)');
    } else if (opponentMove === 'ability') {
      healAmt *= 0.4;
      events.push('\u26A0\uFE0F Your healing was disrupted by the enemy ability! (60% reduced)');
    }
    healAmt = Math.round(healAmt);
    playerHeal += healAmt;
    if (healAmt > 0) {
      events.push(`\uD83D\uDC9A You focused and recovered ${healAmt} HP.`);
      // heal_dr passive (END 60+): healing also grants damage reduction for 1 round
      const healDr = getPassiveValue(player.passives, 'heal_dr');
      if (healDr > 0) {
        newTempEffects.player.push({ effect: 'fortified', value: healDr, roundsLeft: 1 });
        events.push(`\uD83D\uDEE1\uFE0F Fortified Heal grants ${healDr}% damage reduction for 1 round!`);
      }
    }
  } else if (playerMove === 'counter') {
    // Resolved after opponent's attack is computed — see counter resolution block
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
      events.push(`\u2728 Enemy landed a critical hit! (${Math.round(critMultiplier * 100)}% damage)`);
      // B2: Burn on crit strike
      newTempEffects.player.push({ effect: 'burn', value: Math.round(player.maxHp * 0.08), roundsLeft: 2 });
      events.push('\uD83D\uDD25 The critical strike ignites you! (Burn x2 rounds)');
    }
    // B2: Blind miss chance
    if (opponentBlind && Math.random() < 0.40) {
      events.push('\uD83D\uDE35 Blinded! Enemy strike swings wide and misses!');
      opponentOutDmg = 0;
    }
    // Dodge check (AGI 80+ passive)
    const plDodge = getPassiveValue(player.passives, 'dodge');
    if (plDodge > 0 && Math.random() * 100 < plDodge && opponentOutDmg > 0) {
      events.push('\uD83D\uDCA8 You dodged the enemy strike!');
      opponentOutDmg = 0;
    }
    // Guard — guard_pierce reduces guard effectiveness
    if (playerMove === 'guard' && opponentOutDmg > 0) {
      const oppGuardPierce = getPassiveValue(opponent.passives, 'guard_pierce');
      const pBaseBlock = playerStance === 'defensive' ? 0.8 : 0.6; // Defensive stance: 80% block
      const guardBlock = Math.max(0.2, pBaseBlock - (oppGuardPierce / 100));
      const preGuard = Math.floor(opponentOutDmg);
      opponentOutDmg *= (1 - guardBlock);
      events.push(`\uD83D\uDEE1\uFE0F You guarded, blocked ${Math.round(guardBlock * 100)}% of their strike (${preGuard} \u2192 ${Math.floor(opponentOutDmg)}).`);
    }
    if (opponentOutDmg > 0) {
      opponentOutDmg = Math.max(1, Math.floor(opponentOutDmg * (1 - playerDmgReduction / 100)));
      playerDamageTaken += opponentOutDmg;
      events.push(`\u2694\uFE0F Enemy struck you for ${opponentOutDmg} damage!`);
    }
  } else if (opponentMove === 'ability') {
    const abilityResult = resolveClassAbility(opponent.abilityKey || 'arcaneBlast', opponent.combatStats, playerMove, config, events, 'opponent');
    opponentOutDmg = abilityResult.damage + opponentAbilityBonus;
    if (opponentOutDmg > 0) {
      opponentOutDmg = Math.max(1, Math.floor(opponentOutDmg));
      playerDamageTaken += opponentOutDmg;
      events.push(`\u2728 Enemy ability dealt ${opponentOutDmg} damage to you!`);
    }
    if (abilityResult.heal > 0) opponentHeal += abilityResult.heal;
    if (abilityResult.tempEffect) newTempEffects.player.push(abilityResult.tempEffect);
    if (abilityResult.alwaysFirst) speedWinner = 'opponent';
    // B2: Stun when ability hits a guarding player
    if (playerMove === 'guard') {
      newTempEffects.player.push({ effect: 'stun', roundsLeft: 1 });
      events.push('\uD83D\uDCA5 Enemy ability breaks through your guard \u2014 you are stunned! (Stun x1)');
    }
    // B2: Shadow Strike crit -> Blind
    if (opponent.abilityKey === 'shadowStrike' && abilityResult.damage > 0) {
      if (Math.random() * 100 < opponentCritChance) {
        newTempEffects.player.push({ effect: 'blind', roundsLeft: 1 });
        events.push('\uD83C\uDF11 Shadow Strike blinds you! (Blind x1)');
      }
    }
  } else if (opponentMove === 'guard') {
    events.push('\uD83D\uDEE1\uFE0F Enemy raised their guard, bracing for impact.');
  } else if (opponentMove === 'heal') {
    const end = opponent.combatStats.end;
    let healAmt = end * 0.5 + Math.random() * (end * 0.12);
    if (playerMove === 'strike') {
      healAmt *= 0.75;
      events.push('\u26A0\uFE0F Enemy healing was disrupted by your strike! (25% reduced)');
    } else if (playerMove === 'ability') {
      healAmt *= 0.4;
      events.push('\u26A0\uFE0F Enemy healing was disrupted by your ability! (60% reduced)');
    }
    healAmt = Math.round(healAmt);
    opponentHeal += healAmt;
    if (healAmt > 0) {
      events.push(`\uD83D\uDC9A Enemy focused and recovered ${healAmt} HP.`);
      const oppHealDr = getPassiveValue(opponent.passives, 'heal_dr');
      if (oppHealDr > 0) {
        newTempEffects.opponent.push({ effect: 'fortified', value: oppHealDr, roundsLeft: 1 });
        events.push(`\uD83D\uDEE1\uFE0F Enemy's Fortified Heal grants ${oppHealDr}% damage reduction!`);
      }
    }
  } else if (opponentMove === 'counter') {
    // Resolved after player's attack is computed — see counter resolution block
    events.push('\uD83D\uDD04 Enemy took a counter stance, ready to reflect.');
  }

  // Apply temp effects: vulnerable increases damage taken, fortified reduces it
  if (playerVulnerable > 0 && playerDamageTaken > 0) {
    const bonus = Math.round(playerDamageTaken * playerVulnerable / 100);
    playerDamageTaken += bonus;
    if (bonus > 0) events.push(`\uD83D\uDC80 Vulnerable! You took ${bonus} extra damage.`);
  }
  if (playerFortified > 0 && playerDamageTaken > 0) {
    const reduction = Math.round(playerDamageTaken * playerFortified / 100);
    playerDamageTaken = Math.max(1, playerDamageTaken - reduction);
    if (reduction > 0) events.push(`\uD83D\uDEE1\uFE0F Fortified! You resisted ${reduction} damage.`);
  }
  if (opponentVulnerable > 0 && opponentDamageTaken > 0) {
    const bonus = Math.round(opponentDamageTaken * opponentVulnerable / 100);
    opponentDamageTaken += bonus;
    if (bonus > 0) events.push(`\uD83D\uDC80 Enemy is vulnerable! They took ${bonus} extra damage.`);
  }
  if (opponentFortified > 0 && opponentDamageTaken > 0) {
    const reduction = Math.round(opponentDamageTaken * opponentFortified / 100);
    opponentDamageTaken = Math.max(1, opponentDamageTaken - reduction);
    if (reduction > 0) events.push(`\uD83D\uDEE1\uFE0F Enemy fortification resisted ${reduction} damage.`);
  }

  // Boss weakness exploit bonus — player deals bonus damage to boss weak spot
  if (playerWeaknessBonus > 1 && opponentDamageTaken > 0) {
    const preBonus = opponentDamageTaken;
    opponentDamageTaken = Math.round(opponentDamageTaken * playerWeaknessBonus);
    const extra = opponentDamageTaken - preBonus;
    if (extra > 0) events.push(`\uD83C\uDFAF Weakness exploit! +${extra} bonus damage!`);
  }

  // Boss resistance/weakness modifiers (move-type based)
  const bossRes = opponent.bossResistances || {};
  const bossWeak = opponent.bossWeaknesses || {};
  if (opponentDamageTaken > 0 && playerMove) {
    const resist = bossRes[playerMove] || 0;
    const weak = bossWeak[playerMove] || 0;
    if (resist > 0) {
      const reduction = Math.round(opponentDamageTaken * resist / 100);
      opponentDamageTaken = Math.max(1, opponentDamageTaken - reduction);
      events.push(`\uD83D\uDEE1\uFE0F Boss resists ${playerMove}! (-${reduction} damage)`);
    }
    if (weak > 0) {
      const bonus = Math.round(opponentDamageTaken * weak / 100);
      opponentDamageTaken += bonus;
      events.push(`\uD83D\uDCA5 Boss is weak to ${playerMove}! (+${bonus} damage)`);
    }
  }

  // Class advantage bonus
  const playerClassAdv = getPassiveValue(player.passives, 'class_advantage_bonus');
  if (playerClassAdv > 0 && opponentDamageTaken > 0) {
    const extra = Math.round(opponentDamageTaken * playerClassAdv / 100);
    opponentDamageTaken += extra;
    if (extra > 0) events.push(`\u2694\uFE0F Class advantage! +${extra} bonus damage!`);
  }
  const oppClassAdv = getPassiveValue(opponent.passives, 'class_advantage_bonus');
  if (oppClassAdv > 0 && playerDamageTaken > 0) {
    const extra = Math.round(playerDamageTaken * oppClassAdv / 100);
    playerDamageTaken += extra;
    if (extra > 0) events.push(`\u2694\uFE0F Enemy has class advantage! +${extra} extra damage!`);
  }

  // ── Elemental damage multiplier ──
  battle = battle || {};
  const ec = config.elementConfig || {};
  const elChart = ec.chart || {};
  const playerEl = (elements && elements.player) || 'chaos';
  const opponentEl = (elements && elements.opponent) || 'chaos';
  const ELEMENT_LABELS = { fire: 'Fire', earth: 'Earth', arcane: 'Arcane', shadow: 'Shadow', chaos: 'Chaos' };

  // Chaos Flux: roll random element each round (Prism Shard suppresses flux — stays neutral)
  var resolvedPlayerEl = playerEl;
  var resolvedOpponentEl = opponentEl;
  if (playerEl === 'chaos' && !(battle.prismActive && battle.prismActive.player)) {
    var fluxOptions = ['fire', 'earth', 'arcane', 'shadow'];
    resolvedPlayerEl = fluxOptions[Math.floor(Math.random() * 4)];
    events.push('⚡ Chaos Flux! Your element shifts to ' + ELEMENT_LABELS[resolvedPlayerEl] + ' this round!');
  }
  if (opponentEl === 'chaos' && !(battle.prismActive && battle.prismActive.opponent)) {
    var fluxOptionsOpp = ['fire', 'earth', 'arcane', 'shadow'];
    resolvedOpponentEl = fluxOptionsOpp[Math.floor(Math.random() * 4)];
    events.push('⚡ Chaos Flux! Enemy element shifts to ' + ELEMENT_LABELS[resolvedOpponentEl] + ' this round!');
  }

  // Fire Ignite: extend burn to ALL crits (not just strike crits)
  // Strike crits already apply burn above. This catches ability crits for Fire element.
  if (resolvedPlayerEl === 'fire' && playerMove !== 'strike' && playerMove !== 'heal' && playerMove !== 'guard') {
    // Check if there was a crit this round for player (search events for crit message)
    var playerCritted = events.some(function(e) { return e.indexOf('critical') > -1 && e.indexOf('Your') > -1; });
    if (playerCritted && opponentDamageTaken > 0) {
      var burnPct = ((config.elementConfig || {}).passives || {}).fire ? ((config.elementConfig.passives.fire.burnPct || 0.08)) : 0.08;
      var burnRounds = ((config.elementConfig || {}).passives || {}).fire ? ((config.elementConfig.passives.fire.burnRounds || 2)) : 2;
      newTempEffects.opponent.push({ effect: 'burn', value: Math.round(opponent.maxHp * burnPct), roundsLeft: burnRounds });
      events.push('🔥 Fire Ignite! Your critical hit sets the enemy ablaze! (Burn x' + burnRounds + ' rounds)');
    }
  }
  if (resolvedOpponentEl === 'fire' && opponentMove !== 'strike' && opponentMove !== 'heal' && opponentMove !== 'guard') {
    var opponentCritted = events.some(function(e) { return e.indexOf('critical') > -1 && e.indexOf('Enemy') > -1; });
    if (opponentCritted && playerDamageTaken > 0) {
      var burnPctOpp = ((config.elementConfig || {}).passives || {}).fire ? ((config.elementConfig.passives.fire.burnPct || 0.08)) : 0.08;
      var burnRoundsOpp = ((config.elementConfig || {}).passives || {}).fire ? ((config.elementConfig.passives.fire.burnRounds || 2)) : 2;
      newTempEffects.player.push({ effect: 'burn', value: Math.round(player.maxHp * burnPctOpp), roundsLeft: burnRoundsOpp });
      events.push('🔥 Fire Ignite! Enemy critical hit ignites you! (Burn x' + burnRoundsOpp + ' rounds)');
    }
  }

  // Player → Opponent (with Element Ward + Element Burst)
  if (playerMove !== 'heal' && opponentDamageTaken > 0) {
    const pc = elChart[resolvedPlayerEl];
    if (pc && pc.strong === resolvedOpponentEl) {
      const elBonus = Math.round(opponentDamageTaken * ((ec.strongMult || 1.25) - 1));
      opponentDamageTaken += elBonus;
      if (elBonus > 0) events.push(`✨ ${ELEMENT_LABELS[resolvedPlayerEl]} is strong vs ${ELEMENT_LABELS[resolvedOpponentEl]}! (+${elBonus} damage)`);
    } else if (pc && pc.weak === resolvedOpponentEl) {
      // Element Ward: skip weak penalty if ward is active
      if (battle.elementWard && battle.elementWard.player > 0) {
        battle.elementWard.player--;
        events.push(`🛡️ Element Ward absorbs the weakness! (${battle.elementWard.player} rounds remaining)`);
      } else {
        const elReduction = Math.round(opponentDamageTaken * (1 - (ec.weakMult || 0.75)));
        opponentDamageTaken = Math.max(1, opponentDamageTaken - elReduction);
        if (elReduction > 0) events.push(`💨 ${ELEMENT_LABELS[resolvedPlayerEl]} is weak vs ${ELEMENT_LABELS[resolvedOpponentEl]}. (-${elReduction} damage)`);
      }
    }
    // Element Burst: amplify strong bonus or grant +50% on neutral
    if (battle.elementBurst && battle.elementBurst.player) {
      if (pc && pc.strong === resolvedOpponentEl) {
        var burstAmp = Math.round(opponentDamageTaken * 0.50);
        opponentDamageTaken += burstAmp;
        battle.elementBurst.player = false;
        events.push(`💥 Elemental Burst! Amplified elemental damage! (+${burstAmp})`);
      } else if (!pc || (pc.strong !== resolvedOpponentEl && pc.weak !== resolvedOpponentEl)) {
        var burstBonus = Math.round(opponentDamageTaken * 0.50);
        opponentDamageTaken += burstBonus;
        battle.elementBurst.player = false;
        events.push(`💥 Elemental Burst! Raw elemental force! (+${burstBonus} damage)`);
      }
      // Weak matchup: burst doesn't fire
    }
  }
  // Opponent → Player (with Element Ward + Element Resist Charm)
  if (opponentMove !== 'heal' && playerDamageTaken > 0) {
    const oc = elChart[resolvedOpponentEl];
    if (oc && oc.strong === resolvedPlayerEl) {
      // Element Resist Charm: reduce strong bonus if charm matches opponent element
      var resistPassive = (player.passives || []).find(function(p) { return p.effect === 'element_resist'; });
      if (resistPassive && resistPassive.element === resolvedOpponentEl) {
        var reducedMult = (ec.strongMult || 1.25) - (resistPassive.value / 100); // 1.25 - 0.15 = 1.10
        var elBonusResist = Math.round(playerDamageTaken * (reducedMult - 1));
        playerDamageTaken += Math.max(0, elBonusResist);
        events.push(`🛡️ Your ${ELEMENT_LABELS[resistPassive.element]} Ward Charm reduces elemental damage!`);
      } else {
        // Element Ward (opponent side): skip strong bonus if player has ward
        if (battle.elementWard && battle.elementWard.player > 0) {
          battle.elementWard.player--;
          events.push(`🛡️ Element Ward blocks enemy elemental bonus! (${battle.elementWard.player} rounds remaining)`);
        } else {
          const elBonus = Math.round(playerDamageTaken * ((ec.strongMult || 1.25) - 1));
          playerDamageTaken += elBonus;
          if (elBonus > 0) events.push(`✨ Enemy ${ELEMENT_LABELS[resolvedOpponentEl]} is strong vs your ${ELEMENT_LABELS[resolvedPlayerEl]}! (+${elBonus} damage to you)`);
        }
      }
    } else if (oc && oc.weak === resolvedPlayerEl) {
      const elReduction = Math.round(playerDamageTaken * (1 - (ec.weakMult || 0.75)));
      playerDamageTaken = Math.max(1, playerDamageTaken - elReduction);
      if (elReduction > 0) events.push(`💨 Enemy ${ELEMENT_LABELS[resolvedOpponentEl]} is weak vs your ${ELEMENT_LABELS[resolvedPlayerEl]}. (-${elReduction} damage to you)`);
    }
  }

  // B3: Counter resolution — must run after temp effects so reflect uses final damage values
  let playerCounterReflect = false;
  let opponentCounterReflect = false;

  if (playerMove === 'counter' && opponentMove === 'counter') {
    playerDamageTaken = 0;
    opponentDamageTaken = 0;
    events.push('\uD83D\uDD04 Counter standoff! Both fighters mirror each other \u2014 no damage dealt.');
  } else if (playerMove === 'counter') {
    if (opponentMove === 'strike') {
      const reflected = Math.max(1, Math.round(playerDamageTaken * 0.5));
      opponentDamageTaken += reflected;
      playerDamageTaken = 0;
      playerCounterReflect = true;
      events.push(`\uD83D\uDD04 Counter! You deflected the strike and reflected ${reflected} damage back!`);
    } else if (opponentMove === 'guard') {
      playerDamageTaken = 0;
      events.push('\uD83D\uDD04 Counter fizzled \u2014 enemy guarded. Nothing to reflect.');
    } else {
      // ability or heal — counter fails, player takes full damage
      events.push('\u274C Your counter failed! Enemy did not strike.');
    }
  } else if (opponentMove === 'counter') {
    if (playerMove === 'strike') {
      const reflected = Math.max(1, Math.round(opponentDamageTaken * 0.5));
      playerDamageTaken += reflected;
      opponentDamageTaken = 0;
      opponentCounterReflect = true;
      events.push(`\uD83D\uDD04 Counter! Enemy deflected your strike and reflected ${reflected} damage back!`);
    } else if (playerMove === 'guard') {
      opponentDamageTaken = 0;
      events.push('\uD83D\uDD04 Counter fizzled \u2014 you guarded. Nothing to reflect.');
    } else {
      // ability or heal — opponent counter fails
      events.push('\u274C Enemy counter failed! You did not strike.');
    }
  }

  // B2: Burn DoT — applied after counter resolution
  if (playerBurn > 0) {
    playerDamageTaken += playerBurn;
    events.push(`\uD83D\uDD25 Burn deals ${playerBurn} damage to you!`);
  }
  if (opponentBurn > 0) {
    opponentDamageTaken += opponentBurn;
    events.push(`\uD83D\uDD25 Burn deals ${opponentBurn} damage to enemy!`);
  }

  // B2: Merge persisted multi-round effects with newly applied effects
  newTempEffects.player   = [...persistedEffects.player,   ...newTempEffects.player];
  newTempEffects.opponent = [...persistedEffects.opponent, ...newTempEffects.opponent];

  // Passive HP regen (applies every round regardless of action)
  const playerRegenBonus = getPassiveValue(player.passives, 'hp_regen');
  if (playerRegenBonus > 0) {
    playerHeal += playerRegenBonus;
    events.push(`\uD83D\uDC9A Regen restored ${playerRegenBonus} HP.`);
  }
  const opponentRegenBonus = getPassiveValue(opponent.passives, 'hp_regen');
  if (opponentRegenBonus > 0) {
    opponentHeal += opponentRegenBonus;
  }

  // Stamina exhaustion: HP burn — fighting while exhausted costs life force
  // Defensive stance halves the burn rate
  if (playerExhausted) {
    var pBurnPct = playerStance === 'defensive' ? exhaustionBurnPct * 0.5 : exhaustionBurnPct;
    const burn = Math.max(3, Math.round(player.maxHp * pBurnPct));
    playerDamageTaken += burn;
    events.push('\u26A1 Exhaustion burns ' + burn + ' HP!');
  }
  if (opponentExhausted) {
    var oBurnPct = opponentStance === 'defensive' ? exhaustionBurnPct * 0.5 : exhaustionBurnPct;
    const burn = Math.max(3, Math.round(opponent.maxHp * oBurnPct));
    opponentDamageTaken += burn;
    events.push('\u26A1 Enemy exhaustion burns ' + burn + ' HP!');
  }

  // Stance multipliers: outgoing damage (dmgMult)
  if (playerStance === 'aggressive') opponentDamageTaken = Math.floor(opponentDamageTaken * 1.25);
  if (playerStance === 'defensive') opponentDamageTaken = Math.floor(opponentDamageTaken * 0.8);
  if (opponentStance === 'aggressive') playerDamageTaken = Math.floor(playerDamageTaken * 1.25);
  if (opponentStance === 'defensive') playerDamageTaken = Math.floor(playerDamageTaken * 0.8);

  // Stance multipliers: incoming damage (defMult — Aggressive takes 20% more)
  if (playerStance === 'aggressive') playerDamageTaken = Math.floor(playerDamageTaken * 1.2);
  if (opponentStance === 'aggressive') opponentDamageTaken = Math.floor(opponentDamageTaken * 1.2);

  // Stance multipliers: Defensive heal bonus (+30%)
  if (playerStance === 'defensive' && playerHeal > 0) playerHeal = Math.floor(playerHeal * 1.3);
  if (opponentStance === 'defensive' && opponentHeal > 0) opponentHeal = Math.floor(opponentHeal * 1.3);

  // Round summary line
  const parts = [];
  if (opponentDamageTaken > 0) parts.push(`dealt ${opponentDamageTaken} dmg`);
  if (playerHeal > 0) parts.push(`healed ${playerHeal} HP`);
  if (playerDamageTaken > 0) parts.push(`took ${playerDamageTaken} dmg`);
  if (parts.length > 0) events.push(`\uD83D\uDCCA Net: You ${parts.join(', ')}.`);

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
    context.log.error(`[Blindspot Battle] Error: ${error.message}\n${error.stack}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: `Blindspot battle error: ${error.message}` } };
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

  // Load player's card — prefer cardData from client (always freshest after forge edits)
  let playerCard;
  if (body.cardData) {
    playerCard = body.cardData;
    if (!playerCard.id) playerCard.id = cardId;
  } else if (isDemo || cardId === 'stranger-card') {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'cardData required for demo/stranger battles' } };
    return;
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

    // Blindspot bosses: levels 101-110, weekly bosses: 201+
    const isBlindspotBoss = bossLevel >= 101 && bossLevel <= 110;
    const isWeeklyBoss = bossLevel >= 201;

    if (isDemo) {
      // Demo: only first Blindspot boss (101), no weekly
      if (bossLevel !== 101) {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Sign in to unlock more bosses' } };
        return;
      }
    } else if (!isWeeklyBoss) {
      // Authenticated: check blindspotHighestDefeated progression
      const profile = await downloadJsonBlob(containerClient, `arena/profiles/${userId}.json`);
      const bsHighest = profile?.pveProgress?.blindspotHighestDefeated || 100;
      if (bossLevel > bsHighest + 1) {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'This boss is still locked. Defeat the previous boss first.' } };
        return;
      }
    }
    // Weekly bosses (201+) skip progression check — always available for signed-in users
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

  // Apply temporary adventure buffs (CYOA pre-boss system)
  if (type === 'pve' && body.tempBuffs && typeof body.tempBuffs === 'object') {
    const VALID_STATS = ['str', 'agi', 'int', 'end', 'lck'];
    const BUFF_CLAMP = 15;   // max ±15 per stat
    const TOTAL_CLAMP = 30;  // max 30 total absolute points
    let totalApplied = 0;
    for (const stat of VALID_STATS) {
      if (body.tempBuffs[stat] !== undefined) {
        const raw = Number(body.tempBuffs[stat]);
        if (isNaN(raw)) continue;
        const clamped = Math.max(-BUFF_CLAMP, Math.min(BUFF_CLAMP, Math.round(raw)));
        if (totalApplied + Math.abs(clamped) > TOTAL_CLAMP) continue;
        playerCombat[stat] = Math.max(1, Math.min(100, playerCombat[stat] + clamped));
        totalApplied += Math.abs(clamped);
      }
    }
    if (totalApplied > 0) {
      context.log('[Blindspot] Adventure buffs applied: ' + JSON.stringify(body.tempBuffs) + ' total=' + totalApplied);
    }
  }

  // Boss adaptive scaling — scale boss stats to match player power
  let bossScaleFactor = 1.0;
  if (type === 'pve') {
    const statKeys = ['str', 'agi', 'int', 'end', 'lck'];
    const playerPower = statKeys.reduce((sum, k) => sum + (playerCombat[k] || 0), 0);
    const bossPower = statKeys.reduce((sum, k) => sum + (opponentCombat[k] || 0), 0);
    if (bossPower > 0 && playerPower > bossPower * 1.1) {
      // Scale boss to 85-95% of player power (boss keeps its stat distribution)
      const targetPower = playerPower * 0.9;
      bossScaleFactor = Math.min(2.5, targetPower / bossPower);
      for (const k of statKeys) {
        opponentCombat[k] = Math.min(100, Math.round(opponentCombat[k] * bossScaleFactor));
      }
      context.log(`[Blindspot] Boss adaptive scaling: player=${playerPower} boss=${bossPower} scale=${bossScaleFactor.toFixed(2)} target=${Math.round(targetPower)}`);
    }
  }

  const playerPassives = computePassives(playerCard, playerRank);
  const opponentPassives = computePassives(opponentCard, 'diamond'); // AI/opponents use uncapped

  // Merge stat-threshold passives (Blindspot strategy system)
  playerPassives.push(...computeStatThresholdPassives(playerCombat));
  opponentPassives.push(...computeStatThresholdPassives(opponentCombat));

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

  // Stamina pool: basePool + floor(END / endPoolBonus), regen: baseRegen + floor(END / endRegenDiv)
  const stc = config.staminaConfig || {};
  const playerMaxStamina = (stc.basePool || 15) + Math.floor((playerCombat.end || 0) / (stc.endPoolBonus || 10));
  const opponentMaxStamina = (stc.basePool || 15) + Math.floor((opponentCombat.end || 0) / (stc.endPoolBonus || 10));
  const playerStaminaRegen = (stc.baseRegen || 2) + Math.floor((playerCombat.end || 0) / (stc.endRegenDiv || 40));
  const opponentStaminaRegen = (stc.baseRegen || 2) + Math.floor((opponentCombat.end || 0) / (stc.endRegenDiv || 40));

  // Boss weakness: if boss has a weakness stat, player gets +20% damage when using that stat
  const bossWeakness = opponentCard.weakness || null;
  if (bossWeakness && type === 'pve') {
    const playerWeaknessStat = playerCombat[bossWeakness] || 0;
    if (playerWeaknessStat >= 40) {
      // Add a weakness_exploit passive that boosts damage
      const weaknessBonus = Math.min(25, Math.floor(playerWeaknessStat / 4)); // 10-25% bonus based on stat
      playerPassives.push({ source: `weakness:${bossWeakness}`, effect: 'weakness_exploit', value: weaknessBonus });
    }
  }

  // Class advantage bonus — rock-paper-scissors between card classes
  const classAdvTable = config.classAdvantages || {};
  const classAdvBonus = config.classAdvantageBonus || 20;
  const playerClass = playerCard.class || '';
  const bossClass = opponentCard.class || '';
  if (type === 'pve' && classAdvTable[playerClass] && classAdvTable[playerClass].includes(bossClass)) {
    playerPassives.push({ source: 'class_advantage', effect: 'class_advantage_bonus', value: classAdvBonus });
  }
  if (type === 'pve' && classAdvTable[bossClass] && classAdvTable[bossClass].includes(playerClass)) {
    opponentPassives.push({ source: 'class_advantage', effect: 'class_advantage_bonus', value: classAdvBonus });
  }

  // Element system: read from card or derive from class
  const ecDefs = config.elementConfig || {};
  const playerElement = playerCard.element
    || (ecDefs.classDefaults || {})[playerCard.class]
    || 'chaos';
  const opponentElement = opponentCard.element
    || (ecDefs.classDefaults || {})[opponentCard.class]
    || 'chaos';

  // Element passives: Earth (+5% DR), Shadow (+5% dodge)
  const elPassives = (ecDefs.passives || {});
  if (playerElement === 'earth' && elPassives.earth) {
    playerPassives.push({ source: 'element:earth', effect: 'dmg_reduction', value: elPassives.earth.drValue || 5 });
  }
  if (playerElement === 'shadow' && elPassives.shadow) {
    playerPassives.push({ source: 'element:shadow', effect: 'dodge', value: elPassives.shadow.dodgeValue || 5 });
  }
  // Opponent element passives (so bosses benefit too)
  if (opponentElement === 'earth' && elPassives.earth) {
    opponentPassives.push({ source: 'element:earth', effect: 'dmg_reduction', value: elPassives.earth.drValue || 5 });
  }
  if (opponentElement === 'shadow' && elPassives.shadow) {
    opponentPassives.push({ source: 'element:shadow', effect: 'dodge', value: elPassives.shadow.dodgeValue || 5 });
  }

  // Element Resist Charm: read from body and add passive
  const equippedElCharm = body.equippedElementCharm;
  if (equippedElCharm && ['fire', 'earth', 'arcane', 'shadow'].includes(equippedElCharm)) {
    playerPassives.push({ source: 'charm:element_resist', effect: 'element_resist', value: 15, element: equippedElCharm });
  }

  const battleId = `bs-battle-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
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
      abilityKey: opponentAbilityKey,
      bossResistances: (type === 'pve' && opponentCard.resistances) ? opponentCard.resistances : {},
      bossWeaknesses: (type === 'pve' && opponentCard.weaknesses) ? opponentCard.weaknesses : {},
      signaturePassive: (type === 'pve' && opponentCard.signaturePassive) ? opponentCard.signaturePassive : null
    },
    charges: { player: cc.startCharges || 0, opponent: cc.startCharges || 0 },
    chargeRate: { player: playerChargeRate, opponent: opponentChargeRate },
    stamina: { player: playerMaxStamina, opponent: opponentMaxStamina },
    maxStamina: { player: playerMaxStamina, opponent: opponentMaxStamina },
    staminaRegen: { player: playerStaminaRegen, opponent: opponentStaminaRegen },
    cooldowns: { player: {}, opponent: {} },
    stances: { player: 'balanced', opponent: 'balanced' },
    elements: { player: playerElement, opponent: opponentElement },
    tempEffects: { player: [], opponent: [] },
    adventureItems: [],
    roundLog: [],
    winner: null,
    isDemo: isDemo,
    createdAt: new Date().toISOString()
  };

  // Arcane element passive: +1 starting charge
  if (playerElement === 'arcane' && elPassives.arcane) {
    battleState.charges.player = Math.min(cc.maxCharges || 4, battleState.charges.player + (elPassives.arcane.extraCharges || 1));
  }
  if (opponentElement === 'arcane' && elPassives.arcane) {
    battleState.charges.opponent = Math.min(cc.maxCharges || 4, battleState.charges.opponent + (elPassives.arcane.extraCharges || 1));
  }

  // Store adventure items in battle state (validated)
  const VALID_ITEMS = ['smoke_bomb', 'war_cry', 'focus_elixir', 'iron_skin', 'lucky_coin', 'healing_salve', 'stamina_potion', 'endurance_tonic', 'second_wind', 'element_ward', 'element_burst', 'element_shift', 'prism_shard', 'combo_primer', 'adrenaline_spike', 'charm_smoke_bomb', 'charm_iron_skin', 'charm_combo_primer', 'charm_adrenaline_spike'];
  if (type === 'pve' && Array.isArray(body.adventureItems)) {
    battleState.adventureItems = body.adventureItems
      .filter(it => it && VALID_ITEMS.includes(it.id))
      .slice(0, 3)
      .map(it => ({ id: it.id, used: false }));
    if (battleState.adventureItems.length > 0) {
      context.log('[Blindspot] Adventure items stored: ' + battleState.adventureItems.map(i => i.id).join(', '));
    }
  }

  // Telegraph: Pre-generate boss's first move so client can show intent
  let bossIntent = null;
  if (type === 'pve') {
    const firstBossMove = generateBossMove(
      { arenaOverrides: opponentCard.arenaOverrides || { aiPattern: 'balanced' }, combatStats: opponentCombat },
      1, opponentMaxHp, opponentMaxHp, battleState.charges.opponent,
      battleState.stamina.opponent, battleState.maxStamina.opponent,
      battleState.cooldowns.opponent, battleState.stances.opponent
    );
    battleState.pendingBossMove = firstBossMove;
    // Build intent with flavor text from boss telegraph data
    const telegraphStrings = opponentCard.telegraph || {};
    bossIntent = {
      move: firstBossMove,
      flavor: telegraphStrings[firstBossMove] || (opponentCard.name + ' prepares to ' + firstBossMove + '...')
    };
  }

  await uploadJsonBlob(containerClient, `arena/battles/${battleId}.json`, battleState);
  context.log(`[Blindspot] Battle started: ${battleId} (${type}) - ${playerCard.name} vs ${opponentCard.name}`);

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
        element: playerElement,
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
        abilityKey: opponentAbilityKey,
        resistances: (type === 'pve' && opponentCard.resistances) || undefined,
        weaknesses: (type === 'pve' && opponentCard.weaknesses) || undefined,
        signaturePassive: (type === 'pve' && opponentCard.signaturePassive) ? { name: opponentCard.signaturePassive.name, desc: opponentCard.signaturePassive.desc } : undefined,
        element: opponentElement,
        classAdvantage: (classAdvTable[playerClass] && classAdvTable[playerClass].includes(bossClass)) ? 'player' : (classAdvTable[bossClass] && classAdvTable[bossClass].includes(playerClass)) ? 'boss' : null
      },
      charges: { player: battleState.charges.player, opponent: battleState.charges.opponent },
      chargeRate: playerChargeRate,
      abilityCost: Math.max(1, (cc.abilityCost || 2) - getPassiveValue(playerPassives, 'ability_discount')),
      maxCharges: cc.maxCharges || 4,
      stamina: { player: playerMaxStamina, opponent: opponentMaxStamina },
      maxStamina: { player: playerMaxStamina, opponent: opponentMaxStamina },
      staminaRegen: { player: playerStaminaRegen, opponent: opponentStaminaRegen },
      cooldowns: { player: {}, opponent: {} },
    stances: { player: 'balanced', opponent: 'balanced' },
      elements: { player: playerElement, opponent: opponentElement },
      currentRound: 1,
      totalRounds: config.totalRounds,
      status: 'active',
      bossIntent: bossIntent || undefined
    }
  };
}

// --- Stamina cost helper ---
function getStaminaCost(move, passives, config) {
  const sc = config.staminaConfig || {};
  const costs = sc.costs || { strike: 3, guard: 1, heal: 2, counter: 3, ability: 4 };
  let cost = costs[move] || 2;
  // INT 60+ Focused: Ability costs 1 less stamina
  if (move === 'ability' && getPassiveValue(passives, 'ability_stamina_discount') > 0) {
    cost = Math.max(1, cost - 1);
  }
  return cost;
}

// --- Action: move ---

async function handleMove(context, containerClient, userId, body) {
  const { battleId, round, move, crowdBoost, useItem } = body;

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
  // ability_discount passive (INT 60+) reduces cost by 1
  const hasCharges = battle.charges && battle.charges.player !== undefined;
  const playerAbilityDiscount = getPassiveValue(player.passives || [], 'ability_discount');
  const playerAbilityCost = Math.max(1, (cc.abilityCost || 2) - playerAbilityDiscount);
  if (move === 'ability' && hasCharges) {
    if (battle.charges.player < playerAbilityCost) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Not enough charges to use ability' } };
      return;
    }
  }

  // Stamina validation: hard-block Ability if can't afford (other moves use soft exhaustion penalty)
  if (move === 'ability' && battle.stamina) {
    const playerStaminaCost = getStaminaCost(move, player.passives || [], config);
    if (battle.stamina.player < playerStaminaCost) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Not enough stamina for Ability' } };
      return;
    }
  }

  // Cooldown check — hard-block if move is on cooldown
  if (battle.cooldowns && battle.cooldowns.player[move] > 0) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: move + ' is on cooldown (' + battle.cooldowns.player[move] + ' rounds)' } };
    return;
  }

  // Stance switch (optional — null/undefined means keep current)
  if (body.stance && body.stance !== battle.stances.player) {
    if (!['aggressive', 'defensive', 'balanced'].includes(body.stance)) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid stance' } };
      return;
    }
    var stCfg = config.stanceConfig || {};
    var switchCost = body.stance === 'balanced' ? 0 : (stCfg.switchCost || 2);
    if (battle.stamina && battle.stamina.player < switchCost) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Not enough stamina to switch stance' } };
      return;
    }
    // Deducts switch cost immediately. Player may hit 0 before their move resolves —
    // this is intentional: switching to Aggressive when low on stamina is a risky all-in play.
    if (battle.stamina) battle.stamina.player -= switchCost;
    battle.stances.player = body.stance;
  }

  // Boss stance shifts at HP thresholds
  if (battle.stances) {
    var bStCfg = config.stanceConfig || {};
    var bossHpPct = opponent.hp / opponent.maxHp;
    var thresholds = bStCfg.bossThresholds || {};
    if (bossHpPct > (thresholds.aggressive || 0.6)) {
      battle.stances.opponent = 'aggressive';
    } else if (bossHpPct > (thresholds.defensive || 0.3)) {
      battle.stances.opponent = 'defensive';
    } else {
      battle.stances.opponent = 'aggressive'; // Desperate
    }
  }

  // Telegraph system: Use pre-generated boss move (committed last round / at battle start)
  let opponentMove;
  if (battle._mirrorNextMove) {
    // Mirror passive — boss copies player's last move (overrides telegraph)
    opponentMove = battle._mirrorNextMove;
    delete battle._mirrorNextMove;
  } else if (battle.pendingBossMove) {
    // Use the pre-generated (telegraphed) move — boss committed to this
    opponentMove = battle.pendingBossMove;
    delete battle.pendingBossMove;
  } else if (hasCharges) {
    // Fallback: generate on-the-fly (PvP or legacy battles without telegraph)
    opponentMove = generateBossMove(
      battle.type === 'pve' ? { arenaOverrides: opponent.arenaOverrides || { aiPattern: 'balanced' }, combatStats: opponent.combatStats } : { arenaOverrides: { aiPattern: 'balanced' } },
      round, opponent.hp, opponent.maxHp, battle.charges.opponent,
      battle.stamina ? battle.stamina.opponent : undefined,
      battle.maxStamina ? battle.maxStamina.opponent : undefined,
      battle.cooldowns ? battle.cooldowns.opponent : undefined,
      battle.stances ? battle.stances.opponent : undefined
    );
  } else {
    opponentMove = opponent.moves[round - 1] || 'strike';
  }

  // Resolve the round with ability keys, temp effects, and boss strategy data
  const result = resolveRound(
    { combatStats: player.combatStats, passives: player.passives, maxHp: player.maxHp, abilityKey: player.abilityKey },
    { combatStats: opponent.combatStats, passives: opponent.passives, maxHp: opponent.maxHp, abilityKey: opponent.abilityKey,
      bossResistances: opponent.bossResistances || {}, bossWeaknesses: opponent.bossWeaknesses || {} },
    move, opponentMove, battle.tempEffects,
    battle.stamina ? { player: battle.stamina.player, opponent: battle.stamina.opponent } : null,
    battle.stances || null,
    battle.elements || null,
    battle
  );

  // B4: Crowd Boost — hype meter filled by crits/streaks/stuns, +15% dmg when spent
  if (crowdBoost === true && result.opponentDamageTaken > 0) {
    const boost = Math.round(result.opponentDamageTaken * 0.15);
    result.opponentDamageTaken += boost;
    result.events.push(`\uD83D\uDD25 CROWD ERUPTS! Crowd energy fuels your attack! (+${boost} damage)`);
  }

  // B1: Last Stand — below 20% HP -> +10 flat damage on any attack (desperation bonus)
  const playerInLastStand = player.hp > 0 && player.hp < player.maxHp * 0.20;
  const opponentInLastStand = opponent.hp > 0 && opponent.hp < opponent.maxHp * 0.20;
  if (playerInLastStand && result.opponentDamageTaken > 0) {
    result.opponentDamageTaken += 10;
    result.events.push('\u26A1 Last Stand! You fight with desperate fury! (+10 damage)');
  }
  if (opponentInLastStand && result.playerDamageTaken > 0) {
    result.playerDamageTaken += 10;
    result.events.push('\u26A1 Last Stand! Enemy fights with desperate fury! (+10 damage)');
  }

  // Signature passive resolution
  const sigPassive = battle.player2.signaturePassive;
  if (sigPassive && battle.type === 'pve') {
    const pid = sigPassive.id;
    const params = sigPassive.params || {};

    if (pid === 'rage') {
      const threshold = params.threshold || 0.30;
      const bonus = params.bonus || 0.40;
      if (opponent.hp > 0 && opponent.hp < opponent.maxHp * threshold && result.playerDamageTaken > 0) {
        const extra = Math.round(result.playerDamageTaken * bonus);
        result.playerDamageTaken += extra;
        result.events.push(`\uD83D\uDD25 RAGE! Boss fury intensifies! (+${extra} damage)`);
      }
    }

    if (pid === 'phase') {
      const interval = params.interval || 3;
      if (round % interval === 0) {
        result.opponentDamageTaken = 0;
        result.events.push('\uD83D\uDC7B PHASE! The boss phases out \u2014 your attack passes through!');
      }
    }

    if (pid === 'hack') {
      const steal = params.steal || 1;
      if (result.playerDamageTaken > 0 && battle.charges) {
        const stolen = Math.min(steal, battle.charges.player);
        if (stolen > 0) {
          battle.charges.player -= stolen;
          battle.charges.opponent = Math.min((cc.maxCharges || 4), battle.charges.opponent + stolen);
          result.events.push(`\u26A1 HACK! Boss stole ${stolen} charge(s)!`);
        }
      }
    }

    if (pid === 'fortified_start') {
      const startDR = params.startDR || 20;
      const fade = params.fadePerRound || 5;
      const currentDR = Math.max(0, startDR - (fade * (round - 1)));
      if (currentDR > 0 && result.opponentDamageTaken > 0) {
        const reduction = Math.round(result.opponentDamageTaken * currentDR / 100);
        result.opponentDamageTaken = Math.max(1, result.opponentDamageTaken - reduction);
        result.events.push(`\uD83D\uDEE1\uFE0F Fortified! Boss armor absorbs ${reduction} damage (${currentDR}% DR)`);
      }
    }

    if (pid === 'vengeance') {
      const bonus = params.bonus || 0.20;
      const wasCrit = result.events.some(e => e.includes('critical hit'));
      if (wasCrit && result.playerDamageTaken > 0) {
        const extra = Math.round(result.playerDamageTaken * bonus);
        result.playerDamageTaken += extra;
        result.events.push(`\uD83D\uDCA2 VENGEANCE! Crit enrages the boss! (+${extra} damage)`);
      }
    }

    if (pid === 'mirror') {
      const chance = params.chance || 0.25;
      if (Math.random() < chance) {
        battle._mirrorNextMove = move;
        result.events.push('\uD83E\uDE9E MIRROR! The boss mimics your technique...');
      }
    }

    if (pid === 'leech') {
      const pct = params.healPct || 0.15;
      if (result.playerDamageTaken > 0) {
        const heal = Math.round(result.playerDamageTaken * pct);
        opponent.hp = Math.min(opponent.maxHp, opponent.hp + heal);
        result.events.push(`\uD83E\uDE78 LEECH! Boss drains ${heal} HP from you!`);
      }
    }

    if (pid === 'enrage') {
      const pctPerRound = params.pctPerRound || 0.05;
      const bonus = pctPerRound * (round - 1);
      if (bonus > 0 && result.playerDamageTaken > 0) {
        const extra = Math.round(result.playerDamageTaken * bonus);
        result.playerDamageTaken += extra;
        result.events.push(`\uD83D\uDE24 ENRAGE! Boss power grows! (+${Math.round(bonus * 100)}% = +${extra} damage)`);
      }
    }
  }

  // Adventure item usage (server-integrated)
  let itemUsed = null;
  if (useItem && battle.adventureItems) {
    const itemEntry = battle.adventureItems.find(it => it.id === useItem && !it.used);
    if (itemEntry) {
      itemEntry.used = true;
      itemUsed = useItem;
      if (useItem === 'smoke_bomb') {
        result.playerDamageTaken = 0;
        result.events.push('\uD83D\uDCA8 SMOKE BOMB! Opponent\'s attack misses completely!');
      } else if (useItem === 'war_cry') {
        const boost = Math.round(result.opponentDamageTaken * 0.30);
        result.opponentDamageTaken += boost;
        result.events.push('\uD83D\uDDE3\uFE0F WAR CRY! Your strike hits with fury! (+' + boost + ' damage)');
      } else if (useItem === 'focus_elixir') {
        if (battle.charges) battle.charges.player = (cc.maxCharges || 4);
        result.events.push('\uD83E\uDDEA FOCUS ELIXIR! Ability charges fully restored!');
      } else if (useItem === 'iron_skin') {
        const blocked = Math.round(result.playerDamageTaken * 0.50);
        result.playerDamageTaken = Math.max(0, result.playerDamageTaken - blocked);
        result.events.push('\uD83D\uDEE1\uFE0F IRON SKIN! Blocked ' + blocked + ' damage!');
      } else if (useItem === 'lucky_coin') {
        const bonus = Math.round(result.opponentDamageTaken * 0.50);
        result.opponentDamageTaken += bonus;
        result.events.push('\uD83E\uDE99 LUCKY COIN! Critical strike! (+' + bonus + ' damage)');
      } else if (useItem === 'healing_salve') {
        const heal = Math.round(player.maxHp * 0.25);
        result.playerHeal = (result.playerHeal || 0) + heal;
        result.events.push('\uD83D\uDC9A HEALING SALVE! Restored ' + heal + ' HP!');
      } else if (useItem === 'stamina_potion') {
        if (battle.stamina) {
          var restore = Math.min(5, battle.maxStamina.player - battle.stamina.player);
          battle.stamina.player = Math.min(battle.maxStamina.player, battle.stamina.player + 5);
          result.events.push('\u26A1 STAMINA POTION! Restored ' + restore + ' stamina!');
        }
      } else if (useItem === 'endurance_tonic') {
        if (battle.stamina && battle.maxStamina) {
          battle.maxStamina.player += 3;
          battle.stamina.player += 3;
          result.events.push('\uD83D\uDCAA ENDURANCE TONIC! Max stamina increased by 3!');
        }
      } else if (useItem === 'second_wind') {
        // Passive: stored as flag, triggers automatically when exhaustion hits
        if (battle.stamina) {
          battle._secondWindReady = true;
          result.events.push('\uD83C\uDF2C\uFE0F SECOND WIND prepared! Will restore stamina at exhaustion.');
        }
      } else if (useItem === 'element_ward') {
        if (!battle.elementWard) battle.elementWard = {};
        battle.elementWard.player = 3;
        result.events.push('\uD83D\uDEE1\uFE0F ELEMENT WARD! Elemental weakness negated for 3 rounds!');
      } else if (useItem === 'element_burst') {
        if (!battle.elementBurst) battle.elementBurst = {};
        battle.elementBurst.player = true;
        result.events.push('\uD83D\uDCA5 ELEMENTAL BURST! Next elemental hit deals +50% bonus!');
      } else if (useItem === 'element_shift') {
        var oppEl = (battle.elements && battle.elements.opponent) || 'chaos';
        var shiftChart = (config.elementConfig || {}).chart || {};
        // Find the element that's strong vs opponent
        var strongEl = Object.entries(shiftChart).find(function(entry) { return entry[1].strong === oppEl; });
        if (strongEl) {
          battle.elements.player = strongEl[0];
          result.events.push('\uD83D\uDD04 ELEMENT SHIFT! Your element changes to ' + strongEl[0] + '!');
        } else {
          result.events.push('\uD83D\uDD04 ELEMENT SHIFT fizzles \u2014 no advantage found!');
        }
      } else if (useItem === 'prism_shard') {
        battle.elements.player = 'chaos';
        battle.prismActive = battle.prismActive || {};
        battle.prismActive.player = true;
        result.events.push('\uD83D\uDC8E PRISM SHARD! Your attacks become element-neutral!');
      } else if (useItem === 'charm_smoke_bomb') {
        // Same as smoke_bomb — 50% miss chance on opponent's attack
        result.playerDamageTaken = 0;
        result.events.push('\uD83D\uDCA8 SMOKE BOMB! Opponent\'s attack misses completely!');
      } else if (useItem === 'charm_iron_skin') {
        // -30% damage taken for 3 rounds (store counter in battle state)
        if (!battle.ironSkin) battle.ironSkin = {};
        battle.ironSkin.player = 3;
        var blocked = Math.round(result.playerDamageTaken * 0.30);
        result.playerDamageTaken = Math.max(0, result.playerDamageTaken - blocked);
        result.events.push('\uD83D\uDEE1\uFE0F IRON SKIN! Damage reduced by 30% for 3 rounds! (-' + blocked + ')');
      } else if (useItem === 'charm_combo_primer') {
        // Next combo deals +50% bonus — store flag in battle state
        if (!battle.comboPrimer) battle.comboPrimer = {};
        battle.comboPrimer.player = true;
        result.events.push('\uD83C\uDFAF COMBO PRIMER! Your next combo will deal +50% bonus damage!');
      } else if (useItem === 'charm_adrenaline_spike') {
        // Next 2 turns cost 0 stamina
        if (!battle.adrenalineSpike) battle.adrenalineSpike = {};
        battle.adrenalineSpike.player = 2;
        result.events.push('\u26A1 ADRENALINE SPIKE! Next 2 moves cost zero stamina!');
      }
      context.log('[Blindspot] Adventure item used: ' + useItem);
    }
  }

  // Iron Skin ongoing: -30% damage taken while active
  if (battle.ironSkin && battle.ironSkin.player > 0 && result.playerDamageTaken > 0 && !itemUsed) {
    // Only apply on rounds after the initial activation (itemUsed handles the first round)
    var isBlocked = Math.round(result.playerDamageTaken * 0.30);
    result.playerDamageTaken = Math.max(0, result.playerDamageTaken - isBlocked);
    battle.ironSkin.player--;
    if (battle.ironSkin.player <= 0) {
      result.events.push('\uD83D\uDEE1\uFE0F Iron Skin wears off.');
    }
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
    // Deduct if ability was used (ability_discount passive reduces cost)
    if (move === 'ability') battle.charges.player -= playerAbilityCost;
    const oppAbilityDiscount = getPassiveValue(opponent.passives || [], 'ability_discount');
    const oppAbilityCost = Math.max(1, (cc.abilityCost || 2) - oppAbilityDiscount);
    if (opponentMove === 'ability') battle.charges.opponent -= oppAbilityCost;
    battle.charges.player = Math.max(0, battle.charges.player);
    battle.charges.opponent = Math.max(0, battle.charges.opponent);
  }

  // Update stamina: regen first, then deduct costs
  if (battle.stamina) {
    // AGI 60+ (speed_priority) = first move costs 1 less stamina
    let pCost = getStaminaCost(move, player.passives || [], config);
    let oCost = getStaminaCost(opponentMove, opponent.passives || [], config);
    if (getPassiveValue(player.passives || [], 'speed_priority') > 0) pCost = Math.max(1, pCost - 1);
    if (getPassiveValue(opponent.passives || [], 'speed_priority') > 0) oCost = Math.max(1, oCost - 1);
    // Stance stamina cost adjustment: Aggressive +1, Defensive -1
    var stCfgR = config.stanceConfig || {};
    var pStanceAdj = (stCfgR[battle.stances.player] || {}).staminaCostAdj || 0;
    var oStanceAdj = (stCfgR[battle.stances.opponent] || {}).staminaCostAdj || 0;
    pCost = Math.max(1, pCost + pStanceAdj);
    oCost = Math.max(1, oCost + oStanceAdj);

    // Adrenaline Spike: zero stamina cost for N turns
    if (battle.adrenalineSpike && battle.adrenalineSpike.player > 0) {
      pCost = 0;
      battle.adrenalineSpike.player--;
      if (battle.adrenalineSpike.player <= 0) {
        result.events.push('\u26A1 Adrenaline Spike wears off.');
      }
    }

    // Regen
    battle.stamina.player = Math.min(battle.maxStamina.player, battle.stamina.player + battle.staminaRegen.player);
    battle.stamina.opponent = Math.min(battle.maxStamina.opponent, battle.stamina.opponent + battle.staminaRegen.opponent);

    // Deduct
    battle.stamina.player = Math.max(0, battle.stamina.player - pCost);
    battle.stamina.opponent = Math.max(0, battle.stamina.opponent - oCost);

    // LCK crit refund — both sides
    if (result.events.some(function(e) { return e.includes('Your') && e.includes('critical hit'); })) {
      battle.stamina.player = Math.min(battle.maxStamina.player, battle.stamina.player + 1);
    }
    if (result.events.some(function(e) { return e.includes('Enemy') && e.includes('critical hit'); })) {
      battle.stamina.opponent = Math.min(battle.maxStamina.opponent, battle.stamina.opponent + 1);
    }

    // Second Wind: auto-restore full stamina on first exhaustion
    var stcExh = config.staminaConfig || {};
    if (battle._secondWindReady && battle.stamina.player < (stcExh.exhaustionThreshold || 3)) {
      battle.stamina.player = battle.maxStamina.player;
      battle._secondWindReady = false;
      result.events.push('\uD83C\uDF2C\uFE0F SECOND WIND! Stamina fully restored!');
    }
  }

  // Update cooldowns: decrement existing, then set new ones for moves just used
  if (battle.cooldowns) {
    var cdCfg = config.cooldownConfig || {};
    // Decrement existing (runs on keys BEFORE new move is added —
    // so the just-used move won't be decremented this round. Correct.)
    ['player', 'opponent'].forEach(function(side) {
      Object.keys(battle.cooldowns[side]).forEach(function(m) {
        battle.cooldowns[side][m]--;
        if (battle.cooldowns[side][m] <= 0) delete battle.cooldowns[side][m];
      });
    });
    // Set cooldown for moves just used
    if (cdCfg[move] > 0) battle.cooldowns.player[move] = cdCfg[move];
    if (cdCfg[opponentMove] > 0) battle.cooldowns.opponent[opponentMove] = cdCfg[opponentMove];
  }

  // Update temp effects: replace with new ones from this round
  if (battle.tempEffects) {
    battle.tempEffects = result.newTempEffects || { player: [], opponent: [] };
  }

  // Combo detection — check move history including current move
  let comboTriggered = null;
  const prevMoves = player.moves; // moves BEFORE this round (push happens after)
  const moveSeq = prevMoves.slice(-2).concat(move); // last 2 + current = 3 moves

  if (moveSeq.length >= 3 && moveSeq[0] === 'strike' && moveSeq[1] === 'strike' && moveSeq[2] === 'strike') {
    // Flurry: Strike x3 = +30% damage on 3rd strike
    if (result.opponentDamageTaken > 0) {
      const bonus = Math.round(result.opponentDamageTaken * 0.30);
      result.opponentDamageTaken += bonus;
      result.events.push(`\uD83C\uDF2A\uFE0F FLURRY! Triple strike combo! (+${bonus} damage)`);
      comboTriggered = 'flurry';
    }
  } else if (moveSeq.length >= 2 && moveSeq[moveSeq.length - 2] === 'guard' && move === 'counter') {
    // Riposte: Guard → Counter = guaranteed reflect (counter always works as if opponent struck)
    if (opponentMove !== 'strike' && !result.playerCounterReflect) {
      // Force a reflect even if opponent didn't strike
      const reflectDmg = Math.max(5, Math.round(player.combatStats.str * 0.25));
      result.opponentDamageTaken += reflectDmg;
      result.events.push(`\u2694\uFE0F RIPOSTE! Guard into Counter forces a reflect! (+${reflectDmg} damage)`);
      comboTriggered = 'riposte';
    } else if (result.playerCounterReflect) {
      // Counter already reflected — add bonus damage
      const bonus = Math.round(result.opponentDamageTaken * 0.25);
      result.opponentDamageTaken += bonus;
      result.events.push(`\u2694\uFE0F RIPOSTE! Perfect counter technique! (+${bonus} bonus reflect damage)`);
      comboTriggered = 'riposte';
    }
  } else if (moveSeq.length >= 2 && moveSeq[moveSeq.length - 2] === 'heal' && move === 'ability') {
    // Empowered: Heal → Ability = +50% ability damage
    if (result.opponentDamageTaken > 0) {
      const bonus = Math.round(result.opponentDamageTaken * 0.50);
      result.opponentDamageTaken += bonus;
      result.events.push(`\u2728 EMPOWERED! Heal channeled into ability! (+${bonus} damage)`);
      comboTriggered = 'empowered';
    }
  }

  // Combo Primer: +50% bonus when any combo triggers
  if (battle.comboPrimer && battle.comboPrimer.player && comboTriggered) {
    var cpBonus = Math.round(result.opponentDamageTaken * 0.50);
    result.opponentDamageTaken += cpBonus;
    // Also apply the extra combo primer damage to opponent HP
    opponent.hp = Math.max(0, opponent.hp - cpBonus);
    battle.comboPrimer.player = false;
    result.events.push('\uD83C\uDFAF COMBO PRIMER amplifies ' + comboTriggered + '! (+' + cpBonus + ' bonus damage!)');
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
    opponentCounterReflect: result.opponentCounterReflect,
    itemUsed: itemUsed,
    comboTriggered: comboTriggered,
    stamina: battle.stamina ? {
      player: battle.stamina.player,
      opponent: battle.stamina.opponent,
      playerMax: battle.maxStamina.player,
      opponentMax: battle.maxStamina.opponent
    } : undefined,
    cooldowns: battle.cooldowns || undefined,
    stances: battle.stances || undefined,
    elementState: {
      ward: battle.elementWard || null,
      burst: battle.elementBurst || null,
      elements: battle.elements,
      prismActive: battle.prismActive || null
    }
  };

  // Telegraph: Pre-generate NEXT boss move for the next round
  let nextBossIntent = null;
  if (battle.type === 'pve' && player.hp > 0 && opponent.hp > 0) {
    const bossData = loadBossData();
    const bossEntry = bossData.bosses.find(b => b.id === opponent.cardId || b.id === battle.player2.userId);
    const nextBossMove = generateBossMove(
      { arenaOverrides: opponent.arenaOverrides || { aiPattern: 'balanced' }, combatStats: opponent.combatStats },
      round + 1, opponent.hp, opponent.maxHp,
      battle.charges ? battle.charges.opponent : 0,
      battle.stamina ? battle.stamina.opponent : undefined,
      battle.maxStamina ? battle.maxStamina.opponent : undefined,
      battle.cooldowns ? battle.cooldowns.opponent : undefined,
      battle.stances ? battle.stances.opponent : undefined
    );
    battle.pendingBossMove = nextBossMove;
    const telegraphStrings = (bossEntry && bossEntry.telegraph) || {};
    nextBossIntent = {
      move: nextBossMove,
      flavor: telegraphStrings[nextBossMove] || (opponent.cardSnapshot.name + ' prepares to ' + nextBossMove + '...')
    };
  }

  roundResult.nextBossIntent = nextBossIntent || undefined;
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
    context.log(`[Blindspot] Demo battle ${battle.battleId} complete: ${result}, +${totalXp} XP (not saved)`);
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
      pveProgress: { blindspotHighestDefeated: 100, bossAttempts: {} },
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

  // PvE progress — Blindspot uses blindspotHighestDefeated only
  if (type === 'pve' && result === 'win') {
    const isBsBoss = bossLevel >= 101 && bossLevel <= 110;
    if (isBsBoss) {
      if (bossLevel > (profile.pveProgress.blindspotHighestDefeated || 100)) {
        profile.pveProgress.blindspotHighestDefeated = bossLevel;
      }
    }
    // Weekly bosses (201+) don't affect progression tracking
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

  // Per-card battle history tracking
  const playerCardId = battle.player1.cardId;
  if (playerCardId) {
    if (!profile.cardHistory) profile.cardHistory = {};
    if (!profile.cardHistory[playerCardId]) {
      profile.cardHistory[playerCardId] = { wins: 0, losses: 0, bossesBeaten: [], bestStreak: 0, currentStreak: 0, nemesis: null, nemesisLosses: {} };
    }
    const ch = profile.cardHistory[playerCardId];
    if (result === 'win') {
      ch.wins++;
      ch.currentStreak++;
      if (ch.currentStreak > ch.bestStreak) ch.bestStreak = ch.currentStreak;
    } else if (result === 'loss') {
      ch.losses++;
      ch.currentStreak = 0;
      // Track nemesis (boss/opponent lost to most)
      const nemKey = battle.player2.cardSnapshot.name || 'Unknown';
      if (!ch.nemesisLosses) ch.nemesisLosses = {};
      ch.nemesisLosses[nemKey] = (ch.nemesisLosses[nemKey] || 0) + 1;
      // Update nemesis to whoever has the most losses
      let maxLosses = 0; let topNemesis = null;
      for (const k in ch.nemesisLosses) {
        if (ch.nemesisLosses[k] > maxLosses) { maxLosses = ch.nemesisLosses[k]; topNemesis = k; }
      }
      ch.nemesis = topNemesis;
    }
    // Track bosses beaten by this card
    if (type === 'pve' && result === 'win') {
      const bossName = battle.player2.cardSnapshot.name;
      if (bossName && ch.bossesBeaten.indexOf(bossName) === -1) {
        ch.bossesBeaten.push(bossName);
      }
    }
    // Re-upload profile with cardHistory (profile was already uploaded above, re-upload)
    await uploadJsonBlob(containerClient, profilePath, profile);
  }

  // Append to match history
  const historyPath = `arena/history/${userId}.json`;
  let history = await downloadJsonBlob(containerClient, historyPath) || [];
  history.unshift({
    battleId: battle.battleId,
    type,
    playerCardId: playerCardId || null,
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

  context.log(`[Blindspot] Battle ${battle.battleId} complete: ${result}, +${totalXp} XP, rank: ${oldRank} -> ${newRank}`);

  return {
    winner: result === 'win' ? 'player' : result === 'loss' ? 'opponent' : 'draw',
    xpEarned: totalXp,
    newXp: profile.xp,
    newLevel: profile.level,
    newRank,
    rankUp,
    record: profile.record,
    cardHistory: playerCardId && profile.cardHistory ? profile.cardHistory[playerCardId] : null
  };
}
