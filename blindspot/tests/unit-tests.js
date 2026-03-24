/**
 * Blindspot Unit Tests — Pure Function Regression Safety Net
 *
 * Tests game math and logic functions extracted from the monolith.
 * These functions have zero DOM/API dependencies and can run in Node.
 * Run: node ambientpixels/blindspot/tests/unit-tests.js
 *
 * Purpose: catch regressions during the blindspot-flow.js module split.
 */

let passed = 0;
let failed = 0;

function pass(msg) { console.log('\x1b[32m  PASS\x1b[0m', msg); passed++; }
function fail(msg, detail) { console.log('\x1b[31m  FAIL\x1b[0m', msg, detail || ''); failed++; }
function assert(cond, msg, detail) { cond ? pass(msg) : fail(msg, detail); }
function assertEq(a, b, msg) { a === b ? pass(msg) : fail(msg, 'expected ' + b + ', got ' + a); }
function assertClose(a, b, tolerance, msg) { Math.abs(a - b) <= tolerance ? pass(msg) : fail(msg, 'expected ~' + b + ', got ' + a); }

// ============================================================
// EXTRACTED CONSTANTS (copied from blindspot-flow.js)
// Keep these in sync when the monolith is split.
// ============================================================

const ELO_K = 32;
const PVP_RANKS = [
  { name: 'Iron',     min: 0,    icon: 'fa-shield-halved', color: '#8a8a8a' },
  { name: 'Bronze',   min: 900,  icon: 'fa-shield-halved', color: '#CD7F32' },
  { name: 'Silver',   min: 1100, icon: 'fa-shield',        color: '#C0C0C0' },
  { name: 'Gold',     min: 1300, icon: 'fa-crown',          color: '#FFD700' },
  { name: 'Platinum', min: 1500, icon: 'fa-gem',            color: '#E5E4E2' },
  { name: 'Diamond',  min: 1700, icon: 'fa-diamond',        color: '#B9F2FF' }
];

const CARD_RARITIES = [
  { id: 'common',    name: 'Common',    forges: 0,  critBonus: 0, statBonus: 0 },
  { id: 'uncommon',  name: 'Uncommon',  forges: 3,  critBonus: 2, statBonus: 0 },
  { id: 'rare',      name: 'Rare',      forges: 8,  critBonus: 5, statBonus: 0 },
  { id: 'epic',      name: 'Epic',      forges: 15, critBonus: 5, statBonus: 3 },
  { id: 'legendary', name: 'Legendary', forges: 25, critBonus: 5, statBonus: 5 }
];

const STAT_PASSIVES = {
  str: [
    { threshold: 60, name: 'Heavy Hitter' },
    { threshold: 80, name: 'Brutal' }
  ],
  agi: [
    { threshold: 60, name: 'Quick Draw' },
    { threshold: 80, name: 'Elusive' }
  ],
  int: [
    { threshold: 60, name: 'Focused' },
    { threshold: 80, name: 'Arcane Mastery' }
  ],
  end: [
    { threshold: 60, name: 'Resilient' },
    { threshold: 80, name: 'Unbreakable' }
  ],
  lck: [
    { threshold: 50, name: 'Fortune' },
    { threshold: 70, name: 'Wild Card' }
  ]
};

const ARCHETYPES = [
  { id: 'berserker', name: 'Berserker', primary: 'str', secondary: 'lck' },
  { id: 'tank',      name: 'Tank',      primary: 'end', secondary: 'agi' },
  { id: 'mage',      name: 'Mage',      primary: 'int', secondary: 'agi' },
  { id: 'assassin',  name: 'Assassin',  primary: 'agi', secondary: 'str' },
  { id: 'gambler',   name: 'Gambler',   primary: 'lck', secondary: 'int' },
  { id: 'balanced',  name: 'Generalist', primary: null,  secondary: null }
];

const LOOT_TABLE = [
  { weight: 30, type: 'stat_shard', stat: 'str', amount: 3, rarity: 'common' },
  { weight: 30, type: 'stat_shard', stat: 'agi', amount: 3, rarity: 'common' },
  { weight: 30, type: 'stat_shard', stat: 'int', amount: 3, rarity: 'common' },
  { weight: 30, type: 'stat_shard', stat: 'end', amount: 3, rarity: 'common' },
  { weight: 30, type: 'stat_shard', stat: 'lck', amount: 3, rarity: 'common' },
  { weight: 15, type: 'stat_shard', stat: 'str', amount: 5, rarity: 'uncommon' },
  { weight: 15, type: 'stat_shard', stat: 'agi', amount: 5, rarity: 'uncommon' },
  { weight: 15, type: 'stat_shard', stat: 'int', amount: 5, rarity: 'uncommon' },
  { weight: 15, type: 'stat_shard', stat: 'end', amount: 5, rarity: 'uncommon' },
  { weight: 15, type: 'stat_shard', stat: 'lck', amount: 5, rarity: 'uncommon' },
  { weight: 5,  type: 'stat_shard', stat: 'str', amount: 8, rarity: 'rare' },
  { weight: 5,  type: 'stat_shard', stat: 'end', amount: 8, rarity: 'rare' },
  { weight: 3,  type: 'stat_shard', stat: 'str', amount: 12, rarity: 'epic' },
  { weight: 2,  type: 'stat_shard', stat: 'int', amount: 12, rarity: 'epic' }
];

// ============================================================
// EXTRACTED FUNCTIONS (copied from blindspot-flow.js)
// ============================================================

function calcEloChange(playerElo, opponentElo, won) {
  var expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  var score = won ? 1 : 0;
  return Math.round(ELO_K * (score - expected));
}

function getPvPRank(elo) {
  for (var i = PVP_RANKS.length - 1; i >= 0; i--) {
    if (elo >= PVP_RANKS[i].min) return PVP_RANKS[i];
  }
  return PVP_RANKS[0];
}

function estimateOpponentElo(card) {
  var power = getCardPower(card);
  return Math.min(1600, Math.max(800, Math.round(power * 4 + 600)));
}

function getCardPower(card) {
  if (!card) return 0;
  if (card.combatStats) {
    const s = card.combatStats;
    return (s.str || 0) + (s.agi || 0) + (s.int || 0) + (s.end || 0) + (s.lck || 0);
  }
  if (card.stats && Array.isArray(card.stats)) {
    return card.stats.reduce((sum, s) => sum + (s.value || 0), 0);
  }
  return 0;
}

function getCardRarity(forgeVisits) {
  var rarity = CARD_RARITIES[0];
  for (var i = CARD_RARITIES.length - 1; i >= 0; i--) {
    if (forgeVisits >= CARD_RARITIES[i].forges) {
      rarity = CARD_RARITIES[i];
      break;
    }
  }
  return rarity;
}

function getNextRarity(forgeVisits) {
  for (var i = 0; i < CARD_RARITIES.length; i++) {
    if (forgeVisits < CARD_RARITIES[i].forges) {
      return { rarity: CARD_RARITIES[i], forgesNeeded: CARD_RARITIES[i].forges - forgeVisits };
    }
  }
  return null;
}

function detectArchetype(stats) {
  if (!stats) return ARCHETYPES.find(a => a.id === 'balanced');
  const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);
  const top = sorted[0][0];
  const second = sorted[1][0];
  for (const arch of ARCHETYPES) {
    if (arch.primary === top && arch.secondary === second) return arch;
    if (arch.primary === top) return arch;
  }
  return ARCHETYPES.find(a => a.id === 'balanced');
}

function getActivePassives(stats) {
  if (!stats) return [];
  const active = [];
  for (const [stat, tiers] of Object.entries(STAT_PASSIVES)) {
    for (const tier of tiers) {
      if ((stats[stat] || 0) >= tier.threshold) {
        active.push({ ...tier, stat });
      }
    }
  }
  return active;
}

function getNextPassive(stats) {
  if (!stats) return null;
  let closest = null;
  let closestGap = Infinity;
  for (const [stat, tiers] of Object.entries(STAT_PASSIVES)) {
    for (const tier of tiers) {
      const gap = tier.threshold - (stats[stat] || 0);
      if (gap > 0 && gap < closestGap) {
        closestGap = gap;
        closest = { ...tier, stat, gap };
      }
    }
  }
  return closest;
}

function getCardLevel(xp) {
  return Math.min(50, Math.floor(Math.sqrt((xp || 0) / 50)) + 1);
}

function computeAdaptiveDC(baseDC, totalPower, ascensionLevel) {
  var dcOffset = Math.floor((totalPower - 250) / 75);
  dcOffset = Math.max(-2, Math.min(3, dcOffset));
  var ascOffset = ascensionLevel || 0;
  return Math.max(1, baseDC + dcOffset + ascOffset);
}

function weightedRandom(weights, rng) {
  var total = 0; for (var k in weights) total += weights[k];
  var roll = (rng !== undefined ? rng : Math.random()) * total;
  for (var k in weights) { roll -= weights[k]; if (roll <= 0) return k; }
  return Object.keys(weights)[0];
}

function rollLoot(rng) {
  const totalWeight = LOOT_TABLE.reduce((sum, item) => sum + item.weight, 0);
  let roll = (rng !== undefined ? rng : Math.random()) * totalWeight;
  for (const item of LOOT_TABLE) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return LOOT_TABLE[0];
}

// ============================================================
// TESTS
// ============================================================

console.log('\n── Elo System ──');
{
  // Equal Elo, win → gain ~16
  const gain = calcEloChange(1000, 1000, true);
  assertEq(gain, 16, 'Equal Elo win = +16');

  // Equal Elo, loss → lose ~16
  const loss = calcEloChange(1000, 1000, false);
  assertEq(loss, -16, 'Equal Elo loss = -16');

  // Underdog win (beat higher rated) → big gain
  const underdogGain = calcEloChange(800, 1200, true);
  assert(underdogGain > 20, 'Underdog win yields big gain', 'got ' + underdogGain);

  // Favorite loss (lose to lower rated) → big loss
  const favoriteLoss = calcEloChange(1200, 800, false);
  assert(favoriteLoss < -20, 'Favorite loss yields big loss', 'got ' + favoriteLoss);

  // Win + loss against same opponent should roughly net zero
  const w = calcEloChange(1000, 1000, true);
  const l = calcEloChange(1000, 1000, false);
  assertEq(w + l, 0, 'Win + loss vs same Elo nets zero');

  // Elo change magnitude decreases with larger lead
  const smallLead = calcEloChange(1100, 1000, true);
  const bigLead = calcEloChange(1400, 1000, true);
  assert(smallLead > bigLead, 'Smaller lead = larger gain on win', smallLead + ' vs ' + bigLead);
}

console.log('\n── PvP Ranks ──');
{
  assertEq(getPvPRank(0).name, 'Iron', 'Elo 0 = Iron');
  assertEq(getPvPRank(899).name, 'Iron', 'Elo 899 = Iron');
  assertEq(getPvPRank(900).name, 'Bronze', 'Elo 900 = Bronze');
  assertEq(getPvPRank(1100).name, 'Silver', 'Elo 1100 = Silver');
  assertEq(getPvPRank(1300).name, 'Gold', 'Elo 1300 = Gold');
  assertEq(getPvPRank(1500).name, 'Platinum', 'Elo 1500 = Platinum');
  assertEq(getPvPRank(1700).name, 'Diamond', 'Elo 1700 = Diamond');
  assertEq(getPvPRank(9999).name, 'Diamond', 'Elo 9999 = Diamond');
}

console.log('\n── Card Power ──');
{
  assertEq(getCardPower(null), 0, 'Null card = 0 power');
  assertEq(getCardPower({}), 0, 'Empty card = 0 power');
  assertEq(getCardPower({ combatStats: { str: 50, agi: 40, int: 30, end: 60, lck: 20 } }), 200, 'CombatStats power = 200');
  assertEq(getCardPower({ stats: [{ value: 10 }, { value: 20 }, { value: 30 }] }), 60, 'Legacy stats power = 60');
  // combatStats takes priority over legacy
  assertEq(getCardPower({ combatStats: { str: 100 }, stats: [{ value: 999 }] }), 100, 'CombatStats takes priority over legacy');
}

console.log('\n── Opponent Elo Estimation ──');
{
  // Power 50 → Elo 800 (clamped)
  assertEq(estimateOpponentElo({ combatStats: { str: 50 } }), 800, 'Low power card = 800 Elo');
  // Power 200 → Elo 1400
  assertEq(estimateOpponentElo({ combatStats: { str: 40, agi: 40, int: 40, end: 40, lck: 40 } }), 1400, '200 power = 1400 Elo');
  // Power 250 → Elo 1600 (clamped)
  assertEq(estimateOpponentElo({ combatStats: { str: 50, agi: 50, int: 50, end: 50, lck: 50 } }), 1600, '250 power = 1600 Elo (clamped)');
  // Power 300 → still 1600 (clamped)
  assertEq(estimateOpponentElo({ combatStats: { str: 60, agi: 60, int: 60, end: 60, lck: 60 } }), 1600, '300 power = 1600 Elo (clamped)');
}

console.log('\n── Card Rarity ──');
{
  assertEq(getCardRarity(0).id, 'common', '0 forges = common');
  assertEq(getCardRarity(2).id, 'common', '2 forges = common');
  assertEq(getCardRarity(3).id, 'uncommon', '3 forges = uncommon');
  assertEq(getCardRarity(7).id, 'uncommon', '7 forges = uncommon');
  assertEq(getCardRarity(8).id, 'rare', '8 forges = rare');
  assertEq(getCardRarity(14).id, 'rare', '14 forges = rare');
  assertEq(getCardRarity(15).id, 'epic', '15 forges = epic');
  assertEq(getCardRarity(24).id, 'epic', '24 forges = epic');
  assertEq(getCardRarity(25).id, 'legendary', '25 forges = legendary');
  assertEq(getCardRarity(999).id, 'legendary', '999 forges = legendary');
}

console.log('\n── Next Rarity ──');
{
  const next0 = getNextRarity(0);
  assertEq(next0.rarity.id, 'uncommon', 'Next after 0 = uncommon');
  assertEq(next0.forgesNeeded, 3, 'Need 3 forges for uncommon');

  const next7 = getNextRarity(7);
  assertEq(next7.rarity.id, 'rare', 'Next after 7 = rare');
  assertEq(next7.forgesNeeded, 1, 'Need 1 more forge for rare');

  const next25 = getNextRarity(25);
  assertEq(next25, null, 'No next rarity at 25 (max)');
}

console.log('\n── Archetype Detection ──');
{
  assertEq(detectArchetype(null).id, 'balanced', 'Null stats = balanced');
  assertEq(detectArchetype({ str: 80, lck: 60, agi: 40, int: 30, end: 30 }).id, 'berserker', 'STR+LCK = Berserker');
  assertEq(detectArchetype({ end: 80, agi: 60, str: 40, int: 30, lck: 30 }).id, 'tank', 'END+AGI = Tank');
  assertEq(detectArchetype({ int: 80, agi: 60, str: 40, end: 30, lck: 30 }).id, 'mage', 'INT+AGI = Mage');
  assertEq(detectArchetype({ agi: 80, str: 60, int: 40, end: 30, lck: 30 }).id, 'assassin', 'AGI+STR = Assassin');
  assertEq(detectArchetype({ lck: 80, int: 60, str: 40, agi: 30, end: 30 }).id, 'gambler', 'LCK+INT = Gambler');
  // Partial match: primary matches but secondary doesn't
  assertEq(detectArchetype({ str: 80, agi: 60, lck: 40, int: 30, end: 30 }).id, 'berserker', 'STR primary partial match = Berserker');
}

console.log('\n── Active Passives ──');
{
  const none = getActivePassives({ str: 30, agi: 30, int: 30, end: 30, lck: 30 });
  assertEq(none.length, 0, 'No passives at 30 all stats');

  const lckOnly = getActivePassives({ str: 30, agi: 30, int: 30, end: 30, lck: 50 });
  assertEq(lckOnly.length, 1, 'LCK 50 = 1 passive (Fortune)');
  assertEq(lckOnly[0].name, 'Fortune', 'LCK 50 passive name = Fortune');

  const full = getActivePassives({ str: 80, agi: 80, int: 80, end: 80, lck: 70 });
  assertEq(full.length, 10, 'All stats maxed = 10 passives (4x2 + lck 2)');

  const strTier1 = getActivePassives({ str: 60, agi: 0, int: 0, end: 0, lck: 0 });
  assertEq(strTier1.length, 1, 'STR 60 = 1 passive');
  assertEq(strTier1[0].name, 'Heavy Hitter', 'STR 60 = Heavy Hitter');

  const strBoth = getActivePassives({ str: 80, agi: 0, int: 0, end: 0, lck: 0 });
  assertEq(strBoth.length, 2, 'STR 80 = 2 passives (Heavy Hitter + Brutal)');
}

console.log('\n── Next Passive ──');
{
  // STR 55 → 5 from Heavy Hitter (60), LCK 45 → 5 from Fortune (50). Tie broken by iteration order (str first).
  const next = getNextPassive({ str: 55, agi: 30, int: 30, end: 30, lck: 45 });
  assertEq(next.gap, 5, 'Closest passive gap = 5');
  assert(next.stat === 'str' || next.stat === 'lck', 'Closest passive is STR or LCK (tie)', 'got ' + next.stat);

  const nextStr = getNextPassive({ str: 58, agi: 30, int: 30, end: 30, lck: 30 });
  assertEq(nextStr.stat, 'str', 'STR 58 → 2 away from Heavy Hitter');
  assertEq(nextStr.gap, 2, 'Gap = 2');

  const maxed = getNextPassive({ str: 80, agi: 80, int: 80, end: 80, lck: 70 });
  assertEq(maxed, null, 'All passives unlocked = null');
}

console.log('\n── Card Level ──');
{
  assertEq(getCardLevel(0), 1, 'Level at 0 XP = 1');
  assertEq(getCardLevel(undefined), 1, 'Level at undefined XP = 1');
  assertEq(getCardLevel(50), 2, 'Level at 50 XP = 2');
  assertEq(getCardLevel(200), 3, 'Level at 200 XP = 3');
  assertEq(getCardLevel(450), 4, 'Level at 450 XP = 4');
  assertEq(getCardLevel(999999), 50, 'Level caps at 50');

  // Level formula: min(50, floor(sqrt(xp / 50)) + 1)
  // Level 10 requires: (10-1)^2 * 50 = 4050 XP
  assertEq(getCardLevel(4050), 10, 'Level 10 at 4050 XP');
  assertEq(getCardLevel(4049), 9, 'Level 9 at 4049 XP');
}

console.log('\n── Adaptive DC (Adventure) ──');
{
  // Base case: 250 total power, no ascension → DC unchanged
  assertEq(computeAdaptiveDC(10, 250, 0), 10, 'DC 10 at 250 power = 10 (no offset)');

  // Low power (175) → DC offset -1
  assertEq(computeAdaptiveDC(10, 175, 0), 9, 'DC 10 at 175 power = 9 (-1 offset)');

  // High power (400) → DC offset +2 (clamped at +3 max)
  assertEq(computeAdaptiveDC(10, 400, 0), 12, 'DC 10 at 400 power = 12 (+2 offset)');

  // Very high power (500) → offset clamped at +3
  assertEq(computeAdaptiveDC(10, 500, 0), 13, 'DC 10 at 500 power = 13 (+3 clamped)');

  // Very low power (100) → offset clamped at -2
  assertEq(computeAdaptiveDC(10, 100, 0), 8, 'DC 10 at 100 power = 8 (-2 clamped)');

  // Ascension adds directly
  assertEq(computeAdaptiveDC(10, 250, 3), 13, 'DC 10 + ascension 3 = 13');

  // DC can't go below 1
  assertEq(computeAdaptiveDC(1, 100, 0), 1, 'DC floors at 1');
  assertEq(computeAdaptiveDC(2, 100, 0), 1, 'DC 2 at low power floors at 1');
}

console.log('\n── Weighted Random ──');
{
  // Deterministic test with fixed RNG value
  // Weights: a=10, b=20, c=10 → total 40
  // rng=0.0 → roll=0 → should hit 'a' (10 - 0 = 10, <=0 after subtracting? no. roll=0, subtract 10 → -10 ≤ 0 → 'a')
  assertEq(weightedRandom({ a: 10, b: 20, c: 10 }, 0.0), 'a', 'RNG 0.0 → first item');

  // rng=0.3 → roll=12, subtract a(10)=2, subtract b(20)=-18 ≤ 0 → 'b'
  assertEq(weightedRandom({ a: 10, b: 20, c: 10 }, 0.3), 'b', 'RNG 0.3 → second item (weighted)');

  // rng=0.9 → roll=36, subtract a(10)=26, subtract b(20)=6, subtract c(10)=-4 ≤ 0 → 'c'
  assertEq(weightedRandom({ a: 10, b: 20, c: 10 }, 0.9), 'c', 'RNG 0.9 → last item');
}

console.log('\n── Loot Roll Distribution ──');
{
  // Verify total weight
  const totalWeight = LOOT_TABLE.reduce((sum, item) => sum + item.weight, 0);
  assertEq(totalWeight, 240, 'Total loot weight = 240');

  // Roll at 0 → first common item (STR +3)
  const first = rollLoot(0);
  assertEq(first.stat, 'str', 'Roll 0 → STR shard');
  assertEq(first.amount, 3, 'Roll 0 → +3 amount');
  assertEq(first.rarity, 'common', 'Roll 0 → common rarity');

  // Roll near end → epic item
  const last = rollLoot(0.99);
  assertEq(last.rarity, 'epic', 'Roll 0.99 → epic rarity');

  // Common weight = 150/240 = 62.5%
  const commonWeight = LOOT_TABLE.filter(i => i.rarity === 'common').reduce((s, i) => s + i.weight, 0);
  assertClose(commonWeight / totalWeight, 0.625, 0.01, 'Common drop rate ~62.5%');

  // Epic weight = 5/240 = 2.08%
  const epicWeight = LOOT_TABLE.filter(i => i.rarity === 'epic').reduce((s, i) => s + i.weight, 0);
  assertClose(epicWeight / totalWeight, 0.0208, 0.005, 'Epic drop rate ~2.1%');
}

// ── Summary ──
console.log('\n' + '─'.repeat(50));
if (failed === 0) {
  console.log('\x1b[32m  ALL ' + passed + ' CHECKS PASSED\x1b[0m');
  process.exit(0);
} else {
  console.log('\x1b[31m  ' + failed + ' FAILED\x1b[0m, ' + passed + ' passed');
  process.exit(1);
}
