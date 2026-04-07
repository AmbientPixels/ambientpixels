/**
 * Blindspot Constants
 *
 * All game-wide constant data: archetypes, passives, rarities, ranks, loot tables, etc.
 * No mutable state. No DOM dependencies. Loaded before everything else.
 *
 * API: window.BsConst
 */
window.BsConst = (function () {
  'use strict';

  // ── Ranks & Elo ──

  var RANKS = {
    bronze:   { xp: 0,    icon: 'fa-shield-halved', color: '#CD7F32', label: 'Bronze' },
    silver:   { xp: 500,  icon: 'fa-shield',        color: '#C0C0C0', label: 'Silver' },
    gold:     { xp: 1500, icon: 'fa-crown',          color: '#FFD700', label: 'Gold' },
    platinum: { xp: 3500, icon: 'fa-gem',            color: '#E5E4E2', label: 'Platinum' },
    diamond:  { xp: 7000, icon: 'fa-diamond',        color: '#B9F2FF', label: 'Diamond' }
  };
  var RANK_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

  var ELO_DEFAULT = 1000;
  var ELO_K = 32;
  var PVP_RANKS = [
    { name: 'Iron',     min: 0,    icon: 'fa-shield-halved', color: '#8a8a8a' },
    { name: 'Bronze',   min: 900,  icon: 'fa-shield-halved', color: '#CD7F32' },
    { name: 'Silver',   min: 1100, icon: 'fa-shield',        color: '#C0C0C0' },
    { name: 'Gold',     min: 1300, icon: 'fa-crown',          color: '#FFD700' },
    { name: 'Platinum', min: 1500, icon: 'fa-gem',            color: '#E5E4E2' },
    { name: 'Diamond',  min: 1700, icon: 'fa-diamond',        color: '#B9F2FF' }
  ];

  // ── Boss & Class ──

  var BOSS_ICONS = {
    Enforcer: 'fa-gavel', Fighter: 'fa-hand-fist', Scout: 'fa-binoculars',
    Hacker: 'fa-terminal', Berserker: 'fa-fire', Scholar: 'fa-book',
    Guardian: 'fa-shield-halved', Trickster: 'fa-dice', Caster: 'fa-wand-magic-sparkles',
    Rogue: 'fa-user-ninja', Medic: 'fa-heart-pulse', Pilot: 'fa-rocket'
  };

  var CLASS_PATTERNS = {
    Enforcer: 'Strikes + Guards', Fighter: 'Strikes + Guards',
    Scout: 'Strikes + Counters', Hacker: 'Abilities + Counters',
    Berserker: 'All-out Strikes', Scholar: 'Abilities + Heals',
    Guardian: 'Guards + Heals', Trickster: 'Abilities + Counters',
    Caster: 'Abilities + Guards', Rogue: 'Strikes + Counters',
    Medic: 'Heals + Guards', Pilot: 'Abilities + Strikes'
  };

  var CLASS_SIGNATURE_MOVES = {
    'Fighter':   { name: 'Power Slam',    icon: 'fa-hand-fist' },
    'Enforcer':  { name: 'Power Strike',  icon: 'fa-hand-fist' },
    'Berserker': { name: 'Rage Strike',   icon: 'fa-hand-fist' },
    'Caster':    { name: 'Arcane Blast',  icon: 'fa-bolt' },
    'Hacker':    { name: 'Cyber Pulse',   icon: 'fa-bolt' },
    'Scholar':   { name: 'Mind Spike',    icon: 'fa-bolt' },
    'Scout':     { name: 'Shadow Strike', icon: 'fa-feather-pointed' },
    'Rogue':     { name: 'Shadow Strike', icon: 'fa-feather-pointed' },
    'Guardian':  { name: 'Fortify',       icon: 'fa-shield-halved' },
    'Trickster': { name: 'Wild Card',     icon: 'fa-clover' }
  };

  // Class-specific ability art filenames (served from /blindspot/img/moves/).
  // Falls back to the generic ability.webp in HTML if class isn't listed.
  var CLASS_ABILITY_ART = {
    'Fighter':   'ability-fighter.webp',
    'Enforcer':  'ability-enforcer.webp',
    'Berserker': 'ability-berserker.webp',
    'Guardian':  'ability-guardian.webp',
    'Caster':    'ability-caster.webp',
    'Scholar':   'ability-scholar.webp',
    'Hacker':    'ability-hacker.webp',
    'Scout':     'ability-scout.webp',
    'Rogue':     'ability-rogue.webp',
    'Trickster': 'ability-trickster.webp',
    'Medic':     'ability-medic.webp',
    'Pilot':     'ability-pilot.webp'
  };

  // ── Combat ──

  var STAT_PASSIVES = {
    str: [
      { threshold: 12, name: 'Heavy Hitter', desc: 'Strike ignores 20% of Guard', icon: 'fa-hand-fist' },
      { threshold: 16, name: 'Brutal', desc: '+25% crit damage', icon: 'fa-skull-crossbones' }
    ],
    agi: [
      { threshold: 12, name: 'Quick Draw', desc: 'Always act first', icon: 'fa-forward' },
      { threshold: 16, name: 'Elusive', desc: '15% dodge chance', icon: 'fa-ghost' }
    ],
    int: [
      { threshold: 12, name: 'Focused', desc: 'Ability costs 1 charge (not 2)', icon: 'fa-bullseye' },
      { threshold: 16, name: 'Arcane Mastery', desc: '+30% ability damage', icon: 'fa-hat-wizard' }
    ],
    end: [
      { threshold: 12, name: 'Resilient', desc: 'Heal also grants 10% DR for 1 round', icon: 'fa-shield-heart' },
      { threshold: 16, name: 'Unbreakable', desc: 'Auto-heal 5 HP per round', icon: 'fa-heart-circle-plus' }
    ],
    lck: [
      { threshold: 10, name: 'Fortune', desc: '+10% crit chance', icon: 'fa-clover' },
      { threshold: 14, name: 'Wild Card', desc: 'Crits deal 2x (not 1.5x)', icon: 'fa-dice' }
    ]
  };

  var MOVE_UPGRADES = {
    strike: { stat: 'str', threshold: 12, name: 'Heavy Strike', desc: 'Pierces 20% guard' },
    heal:   { stat: 'end', threshold: 12, name: 'Fortified Heal', desc: '+10% DR for 1 round' },
    ability:{ stat: 'int', threshold: 12, name: 'Focused Ability', desc: 'Costs 1 charge' },
    counter:{ stat: 'agi', threshold: 12, name: 'Flash Counter', desc: 'Acts first' },
    guard:  { stat: 'end', threshold: 14, name: 'Iron Guard', desc: 'Blocks 75% (not 60%)' }
  };

  var ARCHETYPES = [
    { id: 'berserker', name: 'Berserker', primary: 'str', secondary: 'lck', desc: 'Crit-focused damage dealer', icon: 'fa-fire', color: '#ff5252' },
    { id: 'tank',      name: 'Tank',      primary: 'end', secondary: 'agi', desc: 'Outlast everything', icon: 'fa-shield-halved', color: '#3498db' },
    { id: 'mage',      name: 'Mage',      primary: 'int', secondary: 'agi', desc: 'Fast ability spam', icon: 'fa-hat-wizard', color: '#7b2fff' },
    { id: 'assassin',  name: 'Assassin',  primary: 'agi', secondary: 'str', desc: 'Strike first, strike hard', icon: 'fa-user-ninja', color: '#00e676' },
    { id: 'gambler',   name: 'Gambler',   primary: 'lck', secondary: 'int', desc: 'Chaos and crits', icon: 'fa-dice', color: '#ffd740' },
    { id: 'balanced',  name: 'Generalist', primary: null,  secondary: null, desc: 'Jack of all trades', icon: 'fa-circle-nodes', color: 'var(--bs-text-muted)' }
  ];

  // Element system — type chart with damage multipliers
  var ELEMENT_DEFS = {
    fire:   { label: 'Fire',   icon: 'fa-fire',      color: '#ef4444' },
    earth:  { label: 'Earth',  icon: 'fa-mountain',   color: '#84cc16' },
    arcane: { label: 'Arcane', icon: 'fa-hat-wizard', color: '#a855f7' },
    shadow: { label: 'Shadow', icon: 'fa-ghost',      color: '#6366f1' },
    chaos:  { label: 'Chaos',  icon: 'fa-burst',      color: '#f59e0b' }
  };
  var ELEMENT_CHART = {
    fire:   { strong: 'earth',  weak: 'shadow' },
    earth:  { strong: 'arcane', weak: 'fire'   },
    arcane: { strong: 'shadow', weak: 'earth'  },
    shadow: { strong: 'fire',   weak: 'arcane' },
    chaos:  { strong: null,     weak: null      }
  };
  var CLASS_DEFAULT_ELEMENT = {
    Fighter: 'fire', Enforcer: 'fire', Berserker: 'fire',
    Caster: 'arcane', Hacker: 'arcane', Scholar: 'arcane',
    Rogue: 'shadow', Scout: 'shadow', Pilot: 'shadow',
    Guardian: 'earth', Medic: 'earth',
    Trickster: 'chaos', Wildcard: 'chaos'
  };

  var WEAKNESS_LABELS = { str: 'STR', agi: 'AGI', int: 'INT', end: 'END', lck: 'LCK' };
  var WEAKNESS_COLORS = { str: '#ff5252', agi: '#00e676', int: '#7b2fff', end: '#ff9100', lck: '#ffd740' };

  // Card border evolution tiers (based on per-card wins)
  var BORDER_TIERS = [
    { id: 'plain',    minWins: 0,  label: 'Untempered', color: 'var(--bs-border)' },
    { id: 'bronze',   minWins: 5,  label: 'Bronze',     color: '#CD7F32' },
    { id: 'silver',   minWins: 15, label: 'Silver',     color: '#C0C0C0' },
    { id: 'gold',     minWins: 30, label: 'Gold',       color: '#FFD700' },
    { id: 'platinum', minWins: 50, label: 'Platinum',   color: '#E5E4E2' },
    { id: 'radiant',  minWins: 100,label: 'Radiant',    color: '#B9F2FF' }
  ];

  // Card title milestones — earned per card based on card history
  var CARD_TITLE_MILESTONES = [
    { id: 'first_blood',   wins: 1,   title: 'Blooded',           desc: 'Win your first battle' },
    { id: 'proven',        wins: 10,  title: 'Proven',            desc: 'Win 10 battles' },
    { id: 'veteran',       wins: 25,  title: 'Veteran',           desc: 'Win 25 battles' },
    { id: 'champion',      wins: 50,  title: 'Champion',          desc: 'Win 50 battles' },
    { id: 'legend',        wins: 100, title: 'Legend',             desc: 'Win 100 battles' },
    { id: 'streak5',       bestStreak: 5,  title: 'Hot Streak',   desc: '5-win streak' },
    { id: 'streak10',      bestStreak: 10, title: 'Unstoppable',  desc: '10-win streak' },
    { id: 'boss_slayer',   bossesBeaten: 5,  title: 'Boss Slayer',  desc: 'Defeat 5 bosses' },
    { id: 'conqueror',     bossesBeaten: 10, title: 'Conqueror',    desc: 'Defeat all 10 bosses' }
  ];

  var MOVE_BEATS = {
    strike:  ['heal', 'ability'],
    guard:   ['strike'],
    ability: ['guard', 'counter'],
    heal:    [],
    counter: ['strike']
  };

  var STAMINA_COSTS = { strike: 4, guard: 1, heal: 2, counter: 4, ability: 5 };
  var STAMINA_EXHAUSTION_THRESHOLD = 3;
  var COOLDOWN_ROUNDS = { strike: 0, guard: 0, heal: 1, counter: 1, ability: 2 };
  var STANCE_DEFS = {
    aggressive: { label: 'Aggressive', icon: 'fa-fire', color: '#ef4444' },
    defensive: { label: 'Defensive', icon: 'fa-shield-halved', color: '#3b82f6' },
    balanced: { label: 'Balanced', icon: 'fa-circle-nodes', color: 'var(--bs-text-muted)' }
  };

  var BATTLE_HINTS = {
    round1: 'Strike is safe round 1 — bosses rarely guard first.',
    lowHp: 'HP critical! Heal or Guard to survive.',
    bossGuarding: 'Boss may guard — use Ability to stun through it.',
    abilityReady: 'Ability charged! Abilities stun guarding enemies.',
    highStreak: 'On a streak! Keep the pressure up.',
    bossLowHp: 'Boss is weakened — go for the kill with Strike.',
    counterTip: 'Counter reflects strikes back. Risky vs abilities.',
    healDisrupt: 'Healing is halved if the boss strikes you.'
  };

  // ── Card Rarity ──

  var CARD_RARITIES = [
    { id: 'common',    name: 'Common',    forges: 0,  color: 'var(--bs-text-muted)', icon: 'fa-circle',        critBonus: 0,   statBonus: 0, title: null },
    { id: 'uncommon',  name: 'Uncommon',  forges: 3,  color: '#1eff8e',              icon: 'fa-circle-half-stroke', critBonus: 2,   statBonus: 0, title: null },
    { id: 'rare',      name: 'Rare',      forges: 8,  color: '#3a9fff',              icon: 'fa-gem',           critBonus: 5,   statBonus: 0, title: null },
    { id: 'epic',      name: 'Epic',      forges: 15, color: '#a855f7',              icon: 'fa-crown',         critBonus: 5,   statBonus: 3, title: null },
    { id: 'legendary', name: 'Legendary', forges: 25, color: '#fbbf24',              icon: 'fa-trophy',        critBonus: 5,   statBonus: 5, title: 'The Forgeborn' }
  ];

  // ── Progression ──

  var MASTERY_TIERS = [
    { wins: 3,  tier: 'bronze', icon: 'fa-star', color: 'var(--bs-accent-dim)', label: 'Bronze', statBonus: 1 },
    { wins: 5,  tier: 'silver', icon: 'fa-star', color: 'var(--bs-text)',        label: 'Silver', statBonus: 0, titleSuffix: "'s Bane" },
    { wins: 10, tier: 'gold',   icon: 'fa-star', color: 'var(--bs-accent-glow)', label: 'Gold',   sparks: 25 }
  ];

  var PALETTE_UNLOCK_BOSSES = [
    { bossNum: 2, palette: 'Ocean' },
    { bossNum: 4, palette: 'Neon' },
    { bossNum: 8, palette: 'Fire' }
  ];

  var STREAK_MILESTONES = [
    { threshold: 3, label: '+10% spark bonus' },
    { threshold: 5, label: '+1 Forge Win' },
    { threshold: 10, label: '+50 Sparks' },
    { threshold: 15, label: 'Title: "The Relentless" + 100 Sparks' }
  ];

  // ── Loot ──

  var LOOT_TABLE = [
    { weight: 30, type: 'stat_shard', stat: 'str', amount: 1, label: '+1 STR', rarity: 'common' },
    { weight: 30, type: 'stat_shard', stat: 'agi', amount: 1, label: '+1 AGI', rarity: 'common' },
    { weight: 30, type: 'stat_shard', stat: 'int', amount: 1, label: '+1 INT', rarity: 'common' },
    { weight: 30, type: 'stat_shard', stat: 'end', amount: 1, label: '+1 END', rarity: 'common' },
    { weight: 30, type: 'stat_shard', stat: 'lck', amount: 1, label: '+1 LCK', rarity: 'common' },
    { weight: 15, type: 'stat_shard', stat: 'str', amount: 2, label: '+2 STR', rarity: 'uncommon' },
    { weight: 15, type: 'stat_shard', stat: 'agi', amount: 2, label: '+2 AGI', rarity: 'uncommon' },
    { weight: 15, type: 'stat_shard', stat: 'int', amount: 2, label: '+2 INT', rarity: 'uncommon' },
    { weight: 15, type: 'stat_shard', stat: 'end', amount: 2, label: '+2 END', rarity: 'uncommon' },
    { weight: 15, type: 'stat_shard', stat: 'lck', amount: 2, label: '+2 LCK', rarity: 'uncommon' },
    { weight: 5,  type: 'stat_shard', stat: 'str', amount: 3, label: '+3 STR', rarity: 'rare' },
    { weight: 5,  type: 'stat_shard', stat: 'end', amount: 3, label: '+3 END', rarity: 'rare' },
    { weight: 3,  type: 'stat_shard', stat: 'str', amount: 4, label: '+4 STR', rarity: 'epic' },
    { weight: 2,  type: 'stat_shard', stat: 'int', amount: 4, label: '+4 INT', rarity: 'epic' }
  ];

  var CRATE_RARITY_COLORS = {
    common: 'var(--bs-text)', uncommon: '#4ade80', rare: '#60a5fa', epic: '#a855f7'
  };

  // ── Card Renderer ──

  var RC_STAT_DEFS = [
    { key: 'str', label: 'STR', color: '#ff5252' },
    { key: 'agi', label: 'AGI', color: '#00e676' },
    { key: 'int', label: 'INT', color: '#7b2fff' },
    { key: 'end', label: 'END', color: '#ff9100' },
    { key: 'lck', label: 'LCK', color: '#ffd740' }
  ];

  // ── Tutorial ──

  var TUTORIAL_MAX_BATTLES = 3;
  var TUTORIAL_ROUND1_HINTS = [
    'Strike deals damage. Guard blocks it. Try Strike!',
    'Counter reflects strikes back — risky but rewarding!',
    'Heal restores HP. Use it when you\u2019re below half.'
  ];
  var TUTORIAL_COUNTER_HINTS = {
    guard: 'The boss guarded — Ability stuns guards!',
    strike: 'The boss struck — Guard or Counter blocks strikes!',
    ability: 'The boss used an ability — Strike while they recover!',
    heal: 'The boss healed — Strike to disrupt healing!',
    counter: 'The boss countered — Ability bypasses counters!'
  };

  // ── Async PvP ──

  var ASYNC_PVP = {
    ELO_K_ATTACKER: 32,
    ELO_K_DEFENDER: 16,         // Halved — defenders didn't choose the fight
    CHALLENGE_COOLDOWN_MS: 2 * 60 * 60 * 1000, // 2hr per defender
    INBOX_CAP: 50,
    PASSIVE_SPARKS: 2,          // Earned per defense battle (win or lose)
    REVENGE_BONUS: 1.5,         // 50% sparks bonus on revenge wins
    SPARKS_WIN_BASE: 20,
    SPARKS_LOSS_BASE: 5,
    STALE_DAYS: 7               // Auto-withdraw after 7 days inactive
  };

  var TUTORIAL_HINTS = [
    { move: 'strike',  text: 'Strike \u2014 basic attack. Deals STR damage. Disrupts enemy heals.' },
    { move: 'guard',   text: 'Guard \u2014 blocks 60% of strikes. Use when they attack.' },
    { move: 'heal',    text: 'Heal \u2014 recover HP. Strikes and abilities reduce healing.' },
    { move: 'counter', text: 'Counter \u2014 reflects enemy strikes back at them. Fails vs abilities.' },
    { move: 'ability', text: 'Ability \u2014 your class power. Costs 2 charges. Earned by fighting.' }
  ];

  // ── Tutorial Steps (speech bubble system) ──

  var TUTORIAL_STEPS = [
    // Phase 1 — HUD Intro (tap "Got it" to advance)
    { id: 'hp-intro',      target: '#arena-player-side .arena-hp-bar', position: 'below', icon: 'fa-heart',       label: 'Health',     text: 'Hit zero and it\u2019s over. Guard it well.',                advance: 'tap',  move: null,     disableOthers: false },
    { id: 'stamina-intro', target: '#arena-player-stamina-bar',        position: 'below', icon: 'fa-bolt',        label: 'Stamina',    text: 'Fuels your moves. Spend wisely.',                           advance: 'tap',  move: null,     disableOthers: false },
    { id: 'enemy-intro',   target: '.arena-combatant--opponent .arena-combatant__nameplate', position: 'below', icon: 'fa-crosshairs', label: 'Your Enemy', text: 'Watch their moves for patterns.', advance: 'tap',  move: null,     disableOthers: false },
    { id: 'hype-intro',    target: '#arena-hype-bar',            position: 'above', icon: 'fa-fire',        label: 'Hype',       text: 'Land big hits to fill it. Full hype = bonus damage.',   advance: 'tap',  move: null,     disableOthers: false },
    { id: 'stance-intro',  target: '#arena-stance-row',          position: 'above', icon: 'fa-circle-nodes', label: 'Stances',    text: 'Switch fighting style mid-battle. Aggressive hits harder, Defensive tanks better.', advance: 'tap', move: null, disableOthers: false },
    // Phase 2 — First Moves (click highlighted button to advance)
    { id: 'strike-intro',  target: '[data-move="strike"]',  position: 'above', icon: 'fa-hand-fist',    label: 'Strike', text: 'Your bread and butter. Disrupts enemy heals.', advance: 'move', move: 'strike',  disableOthers: true },
    { id: 'guard-intro',   target: '[data-move="guard"]',   position: 'above', icon: 'fa-shield-halved', label: 'Guard',  text: 'Absorbs strikes. Timing is everything.',       advance: 'move', move: 'guard',   disableOthers: true },
    { id: 'heal-intro',    target: '[data-move="heal"]',    position: 'above', icon: 'fa-heart-pulse',  label: 'Heal',   text: 'Recover HP. Vulnerable to strikes though.',     advance: 'move', move: 'heal',    disableOthers: true },
    { id: 'counter-intro', target: '[data-move="counter"]', position: 'above', icon: 'fa-shield',       label: 'Counter', text: 'Reflects strikes back. Fails vs abilities.',   advance: 'move', move: 'counter', disableOthers: true },
    { id: 'ability-intro', target: '[data-move="ability"]', position: 'above', icon: 'fa-bolt',         label: 'Ability', text: 'Your class power. Costs charges \u2014 earn them by fighting.', advance: 'move', move: 'ability', disableOthers: true }
  ];

  // Contextual hints — triggered by game state after tutorial, one per round, priority order
  var TUTORIAL_CONTEXTUAL = [
    { id: 'hp-low',        target: '#arena-player-side .arena-hp-bar', position: 'below', icon: 'fa-heart-crack',  label: 'Low Health',      text: 'You\u2019re hurting. Heal or guard to buy time.',             condition: function(s) { return s.playerHp / s.playerMaxHp < 0.4; } },
    { id: 'hype-high',     target: '#arena-hype-bar',                  position: 'above', icon: 'fa-fire',         label: 'Hype Rising',     text: 'Big hits fill it for a damage boost.',                condition: function(s) { return s.hype > 40; } }
  ];

  // ── Public API ──

  return {
    RANKS: RANKS, RANK_ORDER: RANK_ORDER,
    ELO_DEFAULT: ELO_DEFAULT, ELO_K: ELO_K, PVP_RANKS: PVP_RANKS,
    BOSS_ICONS: BOSS_ICONS, CLASS_PATTERNS: CLASS_PATTERNS, CLASS_SIGNATURE_MOVES: CLASS_SIGNATURE_MOVES, CLASS_ABILITY_ART: CLASS_ABILITY_ART,
    STAT_PASSIVES: STAT_PASSIVES, MOVE_UPGRADES: MOVE_UPGRADES, ARCHETYPES: ARCHETYPES,
    ELEMENT_DEFS: ELEMENT_DEFS, ELEMENT_CHART: ELEMENT_CHART, CLASS_DEFAULT_ELEMENT: CLASS_DEFAULT_ELEMENT,
    WEAKNESS_LABELS: WEAKNESS_LABELS, WEAKNESS_COLORS: WEAKNESS_COLORS,
    MOVE_BEATS: MOVE_BEATS, BATTLE_HINTS: BATTLE_HINTS, STAMINA_COSTS: STAMINA_COSTS, STAMINA_EXHAUSTION_THRESHOLD: STAMINA_EXHAUSTION_THRESHOLD, COOLDOWN_ROUNDS: COOLDOWN_ROUNDS, STANCE_DEFS: STANCE_DEFS,
    CARD_RARITIES: CARD_RARITIES, BORDER_TIERS: BORDER_TIERS, CARD_TITLE_MILESTONES: CARD_TITLE_MILESTONES,
    MASTERY_TIERS: MASTERY_TIERS, PALETTE_UNLOCK_BOSSES: PALETTE_UNLOCK_BOSSES, STREAK_MILESTONES: STREAK_MILESTONES,
    LOOT_TABLE: LOOT_TABLE, CRATE_RARITY_COLORS: CRATE_RARITY_COLORS,
    RC_STAT_DEFS: RC_STAT_DEFS,
    TUTORIAL_MAX_BATTLES: TUTORIAL_MAX_BATTLES, TUTORIAL_ROUND1_HINTS: TUTORIAL_ROUND1_HINTS, TUTORIAL_COUNTER_HINTS: TUTORIAL_COUNTER_HINTS,
    TUTORIAL_HINTS: TUTORIAL_HINTS,
    TUTORIAL_STEPS: TUTORIAL_STEPS, TUTORIAL_CONTEXTUAL: TUTORIAL_CONTEXTUAL,
    ASYNC_PVP: ASYNC_PVP
  };
})();
