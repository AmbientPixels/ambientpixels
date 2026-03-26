/**
 * bs-debug.js — Blindspot Debug / Cheat Console
 * Browser console: BS.help()
 *
 * IIFE on window.BsDebug. Exposes window.BS globally.
 * Depends on: BsState (_progress + sync), BsCrates (updateBadge)
 */
(function () {
  'use strict';

  var _S = window.BsState || {};
  var _progress = _S.progress;
  function syncProgressToServer() { if (_S.sync) _S.sync(); }

  // Callbacks injected by monolith
  var _cb = {};

  var BS_CHEATS = {
    help: function () {
      console.log('%c=== BLINDSPOT CHEAT CONSOLE ===', 'color:#EF9F27;font-size:14px;font-weight:bold');
      console.log('%cCurrency & Resources:', 'color:#fbbf24;font-weight:bold');
      console.log('  BS.sparks(n)        — set sparks to n');
      console.log('  BS.addSparks(n)     — add n sparks');
      console.log('  BS.forgeVisits(n)   — set forge visits to n');
      console.log('%cProgression:', 'color:#fbbf24;font-weight:bold');
      console.log('  BS.setBoss(n)       — set highest boss beaten to n (1-10)');
      console.log('  BS.setAscension(n)  — set ascension level');
      console.log('  BS.setWins(n)       — set total wins');
      console.log('  BS.setStreak(n)     — set current win streak');
      console.log('  BS.setPvpElo(n)     — set PvP Elo rating');
      console.log('%cCharms (consumables):', 'color:#fbbf24;font-weight:bold');
      console.log('  BS.addCharm(id, n)  — add n charms (default 1)');
      console.log('  BS.charms()         — list owned charms');
      console.log('  BS.clearCharms()    — remove all charms');
      console.log('  BS.charmList()      — show all available charm IDs');
      console.log('%cCrates:', 'color:#fbbf24;font-weight:bold');
      console.log('  BS.addCrate(type)   — add a crate (battle|boss|weekly|ember|ascension)');
      console.log('  BS.crates()         — list pending crates');
      console.log('%cCosmetics:', 'color:#fbbf24;font-weight:bold');
      console.log('  BS.addCosmetic(id)  — unlock a cosmetic item');
      console.log('  BS.equip(slot, id)  — equip cosmetic (frame|back|nameplate|victory|title)');
      console.log('  BS.unequip(slot)    — unequip a slot');
      console.log('  BS.cosmeticList()   — show all available cosmetic IDs');
      console.log('  BS.inventory()      — show owned cosmetics + equipped');
      console.log('%cVisual Unlocks:', 'color:#fbbf24;font-weight:bold');
      console.log('  BS.unlockPalette(p) — unlock palette (earth|ocean|neon|fire|monochrome|sunset|inferno|frost)');
      console.log('  BS.unlockContainer(c) — unlock container (masked|fullbleed|framed|hero)');
      console.log('%cUtility:', 'color:#fbbf24;font-weight:bold');
      console.log('  BS.status()         — show full progress snapshot');
      console.log('  BS.reset()          — reset ALL progress (requires confirm)');
      console.log('  BS.godMode()        — max sparks, all bosses, all cosmetics, all charms');
      console.log('  BS.forge()          — open Card Forge directly');
      console.log('  BS.adventure(n)     — launch adventure for boss n (1-10)');
      console.log('  BS.refresh()        — re-render lobby after cheat changes');
      return 'Type any command above to use it.';
    },

    // --- Currency ---
    sparks: function (n) {
      _progress.sparks = Math.max(0, parseInt(n, 10) || 0);
      syncProgressToServer();
      console.log('[BS] Sparks set to ' + _progress.sparks);
      return _progress.sparks;
    },
    addSparks: function (n) {
      _progress.sparks += Math.max(0, parseInt(n, 10) || 0);
      syncProgressToServer();
      console.log('[BS] Sparks now ' + _progress.sparks);
      return _progress.sparks;
    },
    forgeVisits: function (n) {
      _progress.forgeVisits = Math.max(0, parseInt(n, 10) || 0);
      syncProgressToServer();
      console.log('[BS] Forge visits set to ' + _progress.forgeVisits);
      return _progress.forgeVisits;
    },

    // --- Progression ---
    setBoss: function (n) {
      _progress.highestBoss = Math.max(0, Math.min(10, parseInt(n, 10) || 0));
      syncProgressToServer();
      console.log('[BS] Highest boss set to ' + _progress.highestBoss);
      return _progress.highestBoss;
    },
    setAscension: function (n) {
      _progress.ascension = Math.max(0, parseInt(n, 10) || 0);
      syncProgressToServer();
      console.log('[BS] Ascension set to ' + _progress.ascension);
      return _progress.ascension;
    },
    setWins: function (n) {
      _progress.totalWins = Math.max(0, parseInt(n, 10) || 0);
      syncProgressToServer();
      console.log('[BS] Total wins set to ' + _progress.totalWins);
      return _progress.totalWins;
    },
    setStreak: function (n) {
      _progress.winStreak = Math.max(0, parseInt(n, 10) || 0);
      syncProgressToServer();
      console.log('[BS] Win streak set to ' + _progress.winStreak);
      return _progress.winStreak;
    },
    setPvpElo: function (n) {
      _progress.pvpElo = Math.max(0, parseInt(n, 10) || 1000);
      syncProgressToServer();
      console.log('[BS] PvP Elo set to ' + _progress.pvpElo);
      return _progress.pvpElo;
    },

    // --- Charms ---
    charmList: function () {
      var config = _cb.getConfig ? _cb.getConfig() : null;
      if (!config || !config.crates) { console.log('[BS] Game config not loaded yet'); return; }
      var items = config.crates.dropPools.battle_charms.items;
      console.log('%cAvailable charms:', 'color:#fbbf24');
      items.forEach(function (c) {
        console.log('  ' + c.id + ' — ' + c.name + ' (' + c.rarity + ') — ' + c.description);
      });
      return items.map(function (c) { return c.id; });
    },
    addCharm: function (id, count) {
      count = Math.max(1, parseInt(count, 10) || 1);
      for (var i = 0; i < count; i++) _progress.charms.push(id);
      syncProgressToServer();
      console.log('[BS] Added ' + count + 'x ' + id + '. Total charms: ' + _progress.charms.length);
      return _progress.charms;
    },
    charms: function () {
      var counts = {};
      _progress.charms.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
      console.table(counts);
      return counts;
    },
    clearCharms: function () {
      _progress.charms = [];
      syncProgressToServer();
      console.log('[BS] All charms removed');
    },

    // --- Crates ---
    addCrate: function (type) {
      type = type || 'battle';
      var valid = ['battle', 'boss', 'weekly', 'ember', 'ascension'];
      if (valid.indexOf(type) === -1) {
        console.log('[BS] Invalid crate type. Use: ' + valid.join(', '));
        return;
      }
      _progress.crates.push({ type: type, earned: new Date().toISOString() });
      var _Crt = window.BsCrates || {};
      if (_Crt.updateBadge) _Crt.updateBadge();
      syncProgressToServer();
      console.log('[BS] Added ' + type + ' crate. Pending: ' + _progress.crates.length);
      return _progress.crates.length;
    },
    crates: function () {
      if (_progress.crates.length === 0) { console.log('[BS] No pending crates'); return []; }
      console.table(_progress.crates);
      return _progress.crates;
    },

    // --- Cosmetics ---
    cosmeticList: function () {
      var config = _cb.getConfig ? _cb.getConfig() : null;
      if (!config || !config.crates) { console.log('[BS] Game config not loaded yet'); return; }
      var pools = config.crates.dropPools;
      var cosmeticPools = ['card_frames', 'card_backs', 'name_plates', 'victory_animations', 'titles'];
      cosmeticPools.forEach(function (poolName) {
        var pool = pools[poolName];
        if (!pool) return;
        console.log('%c' + poolName + ' (slot: ' + (pool.slot || 'n/a') + '):', 'color:#fbbf24');
        pool.items.forEach(function (item) {
          console.log('  ' + item.id + ' — ' + item.name + ' (' + item.rarity + ')');
        });
      });
    },
    addCosmetic: function (id) {
      if (_progress.cosmetics.indexOf(id) === -1) {
        _progress.cosmetics.push(id);
        syncProgressToServer();
        console.log('[BS] Unlocked cosmetic: ' + id);
      } else {
        console.log('[BS] Already owned: ' + id);
      }
      return _progress.cosmetics;
    },
    equip: function (slot, itemId) {
      _progress.equipped[slot] = itemId;
      syncProgressToServer();
      console.log('[BS] Equipped ' + itemId + ' in slot ' + slot);
      return _progress.equipped;
    },
    unequip: function (slot) {
      delete _progress.equipped[slot];
      syncProgressToServer();
      console.log('[BS] Unequipped slot ' + slot);
      return _progress.equipped;
    },
    inventory: function () {
      console.log('%cOwned cosmetics:', 'color:#fbbf24');
      console.log(_progress.cosmetics);
      console.log('%cEquipped:', 'color:#fbbf24');
      console.table(_progress.equipped);
      return { cosmetics: _progress.cosmetics, equipped: _progress.equipped };
    },

    // --- Visual Unlocks ---
    unlockPalette: function (p) {
      var id = 'palette_' + p;
      if (_progress.visualUnlocks.indexOf(id) === -1) {
        _progress.visualUnlocks.push(id);
        syncProgressToServer();
        console.log('[BS] Unlocked palette: ' + p);
      } else {
        console.log('[BS] Already unlocked: ' + p);
      }
    },
    unlockContainer: function (c) {
      var id = 'container_' + c;
      if (_progress.visualUnlocks.indexOf(id) === -1) {
        _progress.visualUnlocks.push(id);
        syncProgressToServer();
        console.log('[BS] Unlocked container: ' + c);
      } else {
        console.log('[BS] Already unlocked: ' + c);
      }
    },

    // --- Utility ---
    status: function () {
      console.log('%c=== BLINDSPOT STATUS ===', 'color:#EF9F27;font-size:12px;font-weight:bold');
      console.log('Sparks:', _progress.sparks);
      console.log('Highest Boss:', _progress.highestBoss, '/ 10');
      console.log('Ascension:', _progress.ascension);
      console.log('Total Wins:', _progress.totalWins);
      console.log('Win Streak:', _progress.winStreak, '(best:', _progress.bestStreak + ')');
      console.log('Forge Visits:', _progress.forgeVisits);
      console.log('PvP Elo:', _progress.pvpElo, 'Record:', _progress.pvpRecord);
      console.log('Charms:', _progress.charms.length);
      console.log('Crates:', _progress.crates.length);
      console.log('Cosmetics:', _progress.cosmetics.length);
      console.log('Visual Unlocks:', _progress.visualUnlocks);
      console.log('Equipped:', _progress.equipped);
      return _progress;
    },

    refresh: function () {
      if (_cb.renderLobby) {
        _cb.renderLobby();
        console.log('[BS] Lobby re-rendered');
      } else {
        console.log('[BS] Not on lobby page — reload to see changes');
      }
    },

    godMode: function () {
      _progress.sparks = 9999;
      _progress.highestBoss = 10;
      _progress.totalWins = 100;
      _progress.ascension = 3;
      _progress.forgeVisits = 50;
      _progress.forgeWins = 50;
      _progress.winStreak = 10;
      _progress.bestStreak = 10;
      // Add all charms + stamina items (3 each)
      var config = _cb.getConfig ? _cb.getConfig() : null;
      if (config && config.crates && config.crates.dropPools) {
        _progress.charms = [];
        ['battle_charms', 'stamina_items'].forEach(function (pool) {
          if (config.crates.dropPools[pool]) {
            config.crates.dropPools[pool].items.forEach(function (c) {
              for (var i = 0; i < 3; i++) _progress.charms.push(c.id);
            });
          }
        });
      }
      // Add all cosmetics
      if (config && config.crates) {
        var pools = config.crates.dropPools;
        ['card_frames', 'card_backs', 'name_plates', 'victory_animations', 'titles'].forEach(function (poolName) {
          if (pools[poolName]) {
            pools[poolName].items.forEach(function (item) {
              if (_progress.cosmetics.indexOf(item.id) === -1) _progress.cosmetics.push(item.id);
            });
          }
        });
      }
      // Unlock all palettes and containers
      ['earth', 'ocean', 'neon', 'fire', 'monochrome', 'sunset', 'inferno', 'frost'].forEach(function (p) {
        var id = 'palette_' + p;
        if (_progress.visualUnlocks.indexOf(id) === -1) _progress.visualUnlocks.push(id);
      });
      ['masked', 'fullbleed', 'framed', 'hero'].forEach(function (c) {
        var id = 'container_' + c;
        if (_progress.visualUnlocks.indexOf(id) === -1) _progress.visualUnlocks.push(id);
      });
      // Add some crates
      ['boss', 'weekly', 'ascension', 'ember'].forEach(function (t) {
        _progress.crates.push({ type: t, earned: new Date().toISOString() });
      });
      syncProgressToServer();
      console.log('%c[BS] GOD MODE ACTIVATED', 'color:#EF9F27;font-size:16px;font-weight:bold');
      console.log('9999 Sparks, All bosses beaten, 3x every charm, all cosmetics, all palettes, 4 crates');
      return BS_CHEATS.status();
    },

    reset: function () {
      if (!confirm('Reset ALL Blindspot progress? This cannot be undone.')) return;
      var fresh = {
        sparks: 0, highestBoss: 0, totalWins: 0, totalBounties: 0,
        winStreak: 0, bestStreak: 0, ascension: 0,
        towerFloor: 0, towerBest: 0, forgeWins: 0, forgeVisits: 0,
        cardTitle: '', selectedCardId: _progress.selectedCardId,
        pvpElo: 1000, pvpRecord: { w: 0, l: 0 },
        crateWinCounter: 0, crates: [], charms: [], cosmetics: [],
        purchasedCosmetics: [], equipped: {},
        visualUnlocks: ['palette_earth', 'container_masked'],
        bossRecords: {}, masteryClaimed: {}, claimedRewards: [],
        towerClaimed: [], weeklyBoss: {}, challenges: {}, bounties: {},
        lastDaily: ''
      };
      for (var key in fresh) _progress[key] = fresh[key];
      syncProgressToServer();
      console.log('[BS] Progress reset. Reload to see changes.');
    }
  };

  // Extra commands that need monolith callbacks
  BS_CHEATS.victoryFx = function() {
    if (_cb.playVictoryAnimation) _cb.playVictoryAnimation();
    return 'Victory animation triggered!';
  };
  BS_CHEATS.forge = function() {
    if (_cb.openForgeScreen) _cb.openForgeScreen(false, true);
    return 'Card Forge opened';
  };
  BS_CHEATS.adventure = function(bossNum) {
    bossNum = parseInt(bossNum, 10) || 1;
    if (bossNum < 1 || bossNum > 10) { console.log('[BS] Boss must be 1-10'); return; }
    var bossId = 'bs-boss-' + bossNum;
    if (!window.BsAdventure) { console.log('[BS] BsAdventure not loaded'); return; }
    if (!window.BsAdventure.hasAdventure(bossId)) { console.log('[BS] No adventure for boss ' + bossNum); return; }
    var card = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
    var stats = card ? card.combatStats : { str: 50, agi: 50, int: 50, end: 50, lck: 50 };
    var cls = card ? (card.class || card.characterClass || '') : 'Fighter';
    console.log('[BS] Launching adventure for Boss ' + bossNum + '...');
    window.BsAdventure.launch(bossId, stats, {
      containerEl: document.getElementById('bs-adventure-overlay'),
      playerClass: cls,
      bossWeakness: null,
      ascension: _progress.ascension || 0
    }).then(function(result) {
      console.log('[BS] Adventure complete:', result);
    }).catch(function(err) {
      console.warn('[BS] Adventure error:', err);
    });
    return 'Adventure launching...';
  };

  window.BS = BS_CHEATS;

  window.BsDebug = {
    setCallbacks: function (cb) { _cb = cb; }
  };
})();
