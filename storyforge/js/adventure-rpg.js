/**
 * adventure-rpg.js — HP, inventory, companions, skill checks, dice
 */
window.AdventureRPG = (function () {
  'use strict';

  var MAX_INVENTORY = 8;
  var MAX_COMPANIONS = 2;

  // --- Create fresh game state from genre config ---
  function createState(genre, playerName, characterAppearance, customStats) {
    var s = genre.startingStats;
    var str = (customStats && customStats.strength != null) ? customStats.strength : s.strength;
    var dex = (customStats && customStats.dexterity != null) ? customStats.dexterity : s.dexterity;
    var int = (customStats && customStats.intelligence != null) ? customStats.intelligence : s.intelligence;
    var cha = (customStats && customStats.charisma != null) ? customStats.charisma : s.charisma;
    return {
      playerName: playerName || generateName(),
      genre: genre.id,
      character: characterAppearance || null,
      stats: {
        hp: s.hp,
        maxHp: s.maxHp,
        gold: s.gold,
        reputation: s.reputation,
        strength: str,
        dexterity: dex,
        intelligence: int,
        charisma: cha
      },
      inventory: (genre.startingInventory || []).map(function (item) {
        return Object.assign({}, item, { quantity: item.quantity || 1 });
      }),
      equipped: { weapon: null, armor: null },
      companions: [],
      eventLog: [],
      turnCount: 0,
      maxTurns: 25
    };
  }

  // --- Skill check (d20 + modifier + companion bonus + equipment bonus vs DC) ---
  var EQUIP_BONUS_MAP = { weapon: 'strength', armor: 'dexterity' };

  function rollSkillCheck(stats, companions, stat, difficulty, equipped) {
    var roll = Math.floor(Math.random() * 20) + 1;
    var statVal = stats[stat] || 10;
    var modifier = Math.floor((statVal - 10) / 2);
    var companionBonus = getCompanionBonus(companions, stat);
    var equipmentBonus = getEquipmentBonus(equipped, stat);
    var total = roll + modifier + companionBonus + equipmentBonus;
    var success = total >= difficulty;
    var critical = roll === 20 ? 'critical_success' : (roll === 1 ? 'critical_failure' : null);

    return {
      roll: roll,
      modifier: modifier,
      companionBonus: companionBonus,
      equipmentBonus: equipmentBonus,
      total: total,
      difficulty: difficulty,
      stat: stat,
      success: success,
      critical: critical
    };
  }

  function getEquipmentBonus(equipped, stat) {
    if (!equipped) return 0;
    for (var slot in EQUIP_BONUS_MAP) {
      if (EQUIP_BONUS_MAP[slot] === stat && equipped[slot]) return 1;
    }
    return 0;
  }

  function getCompanionBonus(companions, stat) {
    for (var i = 0; i < companions.length; i++) {
      if (companions[i].bonus === stat) return 2;
    }
    return 0;
  }

  // --- Apply state changes from AI response ---
  function applyStateChanges(state, changes) {
    if (!changes) return state;

    // HP
    if (changes.hpDelta) {
      state.stats.hp = Math.max(0, Math.min(state.stats.maxHp, state.stats.hp + changes.hpDelta));
    }

    // Gold
    if (changes.goldDelta) {
      state.stats.gold = Math.max(0, state.stats.gold + changes.goldDelta);
    }

    // Reputation
    if (changes.reputationDelta) {
      state.stats.reputation = Math.max(-50, Math.min(50, state.stats.reputation + changes.reputationDelta));
    }

    // Add items
    if (changes.addItems && changes.addItems.length) {
      changes.addItems.forEach(function (item) {
        if (!item.name) return;
        if (state.inventory.length < MAX_INVENTORY) {
          state.inventory.push({
            id: item.id || ('item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
            name: item.name,
            type: item.type || 'tool',
            description: item.description || '',
            quantity: item.quantity || 1
          });
        }
      });
    }

    // Remove items (auto-unequip if equipped)
    if (changes.removeItems && changes.removeItems.length) {
      changes.removeItems.forEach(function (itemName) {
        var idx = state.inventory.findIndex(function (inv) {
          return inv.name.toLowerCase() === itemName.toLowerCase() || inv.id === itemName;
        });
        if (idx !== -1) {
          var removed = state.inventory[idx];
          if (state.equipped && state.equipped.weapon === removed.id) state.equipped.weapon = null;
          if (state.equipped && state.equipped.armor === removed.id) state.equipped.armor = null;
          state.inventory.splice(idx, 1);
        }
      });
    }

    // Add companion
    if (changes.addCompanion && state.companions.length < MAX_COMPANIONS) {
      state.companions.push({
        id: changes.addCompanion.id || ('comp_' + Date.now()),
        name: changes.addCompanion.name,
        type: changes.addCompanion.type || 'Ally',
        description: changes.addCompanion.description || '',
        bonus: changes.addCompanion.bonus || 'strength'
      });
    }

    // Remove companion
    if (changes.removeCompanion) {
      var compName = changes.removeCompanion;
      state.companions = state.companions.filter(function (c) {
        return c.name.toLowerCase() !== compName.toLowerCase() && c.id !== compName;
      });
    }

    // Event tag
    if (changes.eventTag) {
      state.eventLog.push(changes.eventTag);
      if (state.eventLog.length > 15) {
        state.eventLog = state.eventLog.slice(-15);
      }
    }

    return state;
  }

  // --- Use consumable item ---
  function useConsumable(state, itemId) {
    var idx = state.inventory.findIndex(function (item) { return item.id === itemId; });
    if (idx === -1) return null;

    var item = state.inventory[idx];
    if (item.type !== 'consumable') return null;

    // Basic consumable effects
    var effect = null;
    var nameLower = item.name.toLowerCase();
    if (nameLower.indexOf('health') !== -1 || nameLower.indexOf('heal') !== -1 || nameLower.indexOf('potion') !== -1) {
      var heal = 20 + Math.floor(Math.random() * 11); // 20-30
      state.stats.hp = Math.min(state.stats.maxHp, state.stats.hp + heal);
      effect = { type: 'heal', value: heal };
    } else {
      // Generic consumable — small heal
      var smallHeal = 10;
      state.stats.hp = Math.min(state.stats.maxHp, state.stats.hp + smallHeal);
      effect = { type: 'heal', value: smallHeal };
    }

    // Remove or decrement
    if (item.quantity > 1) {
      item.quantity--;
    } else {
      state.inventory.splice(idx, 1);
    }

    return effect;
  }

  // --- Random name generator ---
  function generateName() {
    var prefixes = ['Alder', 'Bran', 'Cael', 'Dorn', 'Eira', 'Finn', 'Gael', 'Hale', 'Iris', 'Jace',
      'Kael', 'Luna', 'Mira', 'Nyx', 'Orin', 'Pike', 'Quinn', 'Ren', 'Sage', 'Thane',
      'Uma', 'Vale', 'Wren', 'Xael', 'Yara', 'Zane'];
    var suffixes = ['ic', 'en', 'is', 'or', 'a', 'us', 'ia', 'on', 'an', 'ar', '', 'ius', 'ra'];
    return prefixes[Math.floor(Math.random() * prefixes.length)] +
           suffixes[Math.floor(Math.random() * suffixes.length)];
  }

  // --- Stat display helpers ---
  var STAT_ICONS = {
    strength: 'fa-fist-raised',
    dexterity: 'fa-running',
    intelligence: 'fa-brain',
    charisma: 'fa-comments',
    gold: 'fa-coins',
    reputation: 'fa-star'
  };

  var STAT_LABELS = {
    strength: 'STR',
    dexterity: 'DEX',
    intelligence: 'INT',
    charisma: 'CHA',
    gold: 'Gold',
    reputation: 'Rep'
  };

  var ITEM_ICONS = {
    weapon: 'fa-sword',
    armor: 'fa-shield-halved',
    consumable: 'fa-flask',
    tool: 'fa-wrench',
    quest_item: 'fa-scroll'
  };

  // --- Equipment management ---
  function equipItem(state, itemId) {
    var item = state.inventory.find(function (i) { return i.id === itemId; });
    if (!item) return false;
    var slot = (item.type === 'weapon') ? 'weapon' : (item.type === 'armor') ? 'armor' : null;
    if (!slot) return false;
    if (!state.equipped) state.equipped = { weapon: null, armor: null };
    state.equipped[slot] = itemId;
    return true;
  }

  function unequipItem(state, slot) {
    if (!state.equipped) return;
    state.equipped[slot] = null;
  }

  function dropItem(state, itemId) {
    var idx = state.inventory.findIndex(function (i) { return i.id === itemId; });
    if (idx === -1) return false;
    var item = state.inventory[idx];
    if (item.type === 'quest_item') return false;
    // Auto-unequip
    if (state.equipped) {
      if (state.equipped.weapon === itemId) state.equipped.weapon = null;
      if (state.equipped.armor === itemId) state.equipped.armor = null;
    }
    state.inventory.splice(idx, 1);
    return true;
  }

  function getEquippedItem(state, slot) {
    if (!state.equipped || !state.equipped[slot]) return null;
    return state.inventory.find(function (i) { return i.id === state.equipped[slot]; }) || null;
  }

  var ITEM_TYPE_COLORS = {
    weapon: '#F87171',
    armor: '#60A5FA',
    consumable: '#34D399',
    tool: '#94A3B8',
    quest_item: '#FBBF24'
  };

  function isAlive(state) {
    return state.stats.hp > 0;
  }

  return {
    createState: createState,
    rollSkillCheck: rollSkillCheck,
    applyStateChanges: applyStateChanges,
    useConsumable: useConsumable,
    equipItem: equipItem,
    unequipItem: unequipItem,
    dropItem: dropItem,
    getEquippedItem: getEquippedItem,
    generateName: generateName,
    isAlive: isAlive,
    STAT_ICONS: STAT_ICONS,
    STAT_LABELS: STAT_LABELS,
    ITEM_ICONS: ITEM_ICONS,
    ITEM_TYPE_COLORS: ITEM_TYPE_COLORS,
    EQUIP_BONUS_MAP: EQUIP_BONUS_MAP,
    MAX_INVENTORY: MAX_INVENTORY,
    MAX_COMPANIONS: MAX_COMPANIONS
  };
})();
