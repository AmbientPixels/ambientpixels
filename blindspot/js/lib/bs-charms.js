/**
 * Blindspot Charms + Adventure Items — Battle Consumables
 *
 * Manages charm selection, charm effects, and adventure item buttons in battle.
 * Both are single-use consumables that appear as extra buttons during combat.
 *
 * API: window.BsCharms
 */
window.BsCharms = (function () {
  'use strict';

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function progress() { return window.BsState ? window.BsState.progress : {}; }
  function sync() { if (window.BsState) window.BsState.sync(); }

  // Asset registry. Each top-level key is a category that maps to a directory
  // under /blindspot/img/{category}/{id}.webp. Pre-listing IDs is safe -- the
  // assetArtHtml onerror handler swaps a missing image back to the FA icon at
  // render time, so we can list IDs before the art lands without risking
  // broken-image placeholders.
  // Single source of truth for the whole game; consumed by bs-charms.js
  // (prefight + battle), bs-cosmetics.js, and bs-sparks-shop.js via the
  // BsCharms.assetArtHtml / BsCharms.itemArtHtml exports.
  var ASSET_REGISTRY = {
    items: {
      // Shipped art (batches 1-5)
      charm_heal_potion: true,
      smoke_bomb: true,
      lucky_coin: true,
      focus_elixir: true,
      prism_shard: true,
      war_cry: true,
      iron_skin: true,
      healing_salve: true,
      stamina_potion: true,
      element_ward: true,
      charm_power_surge: true,
      charm_shield_wall: true,
      charm_lucky_strike: true,
      charm_charge_boost: true,
      charm_resist_fire: true,
      charm_resist_earth: true,
      charm_resist_arcane: true,
      charm_resist_shadow: true,
      element_burst: true,
      element_shift: true,
      endurance_tonic: true,
      second_wind: true,
      charm_smoke_bomb: true,
      charm_iron_skin: true,
      charm_combo_primer: true,
      charm_adrenaline_spike: true,
      battle_surge: true
    },
    titles: {
      title_the_lucky: true,
      title_the_brave: true,
      title_crate_hunter: true,
      title_shadow_walker: true,
      title_loot_goblin: true,
      title_arena_champion: true,
      title_the_unstoppable: true,
      title_fortune_favored: true
    },
    stats: { str: true, agi: true, int: true, end: true, lck: true },
    elements: { fire: true, earth: true, arcane: true, shadow: true, chaos: true },
    classes: {
      fighter: true, enforcer: true, berserker: true, guardian: true,
      caster: true, scholar: true, hacker: true, scout: true,
      rogue: true, trickster: true, medic: true, pilot: true
    },
    crates: { battle: true, boss: true, weekly: true, ember: true, ascension: true },
    ranks: { initiate: true, apprentice: true, veteran: true, champion: true, legend: true, mythic: true },
    'pvp-ranks': { iron: true, bronze: true, silver: true, gold: true, platinum: true, diamond: true }
  };

  // Backward-compat alias for the existing items lookups.
  var ITEM_IMAGES = ASSET_REGISTRY.items;

  function assetArtHtml(category, id, fallbackFaIcon, alt) {
    var registry = ASSET_REGISTRY[category];
    if (id && registry && registry[id]) {
      var fbIcon = fallbackFaIcon || 'fa-box';
      // If the WebP 404s (ID listed before art has shipped), swap the <img>
      // for the FA icon at error time. Inner quotes are HTML-escaped as
      // &quot; so the browser hands clean JS to onerror.
      var fbHtml = '<i class=&quot;fas ' + fbIcon + '&quot; aria-hidden=&quot;true&quot;></i>';
      return '<img class="bs-item-art" src="/blindspot/img/' + category + '/' + id + '.webp"'
        + ' alt="' + escHtml(alt || '') + '" loading="lazy" decoding="async"'
        + " onerror=\"this.outerHTML='" + fbHtml + "'\">";
    }
    return '<i class="fas ' + (fallbackFaIcon || 'fa-box') + '" aria-hidden="true"></i>';
  }

  // Items are the most common asset, keep the short helper.
  function itemArtHtml(id, fallbackFaIcon, alt) {
    return assetArtHtml('items', id, fallbackFaIcon, alt);
  }

  // PvP rank chips render inline in many HTML strings (lobby Elo chip,
  // defense queue card row, etc.). The PVP_RANKS entries use TitleCase
  // `name` (Iron / Bronze / ...), but the asset registry keys are
  // lowercase. Centralise the lookup so call sites stay one-line.
  function pvpRankIconHtml(pvpRank) {
    if (!pvpRank) return '';
    var key = pvpRank.name ? String(pvpRank.name).toLowerCase() : null;
    if (key) {
      var raw = assetArtHtml('pvp-ranks', key, pvpRank.icon, pvpRank.name);
      if (raw.indexOf('<img') === 0) return raw;
    }
    return '<i class="fas ' + (pvpRank.icon || 'fa-shield-halved') + '" style="color:' + (pvpRank.color || '') + ';"></i>';
  }

  // Injected callbacks (set by monolith after load)
  var _callbacks = {};

  // ── Charm State ──

  var _equippedCharm = null;
  var _charmUsedThisBattle = false;

  // ── Adventure Item State ──

  var _adventureItems = [];
  var _adventureItemsUsed = {};

  // ── Inventory Item Selection (prefight picker, up to 3) ──

  var _selectedInventoryItems = [];
  var MAX_INVENTORY_ITEMS = 3;

  // ── Charm Data Access ──

  function getOwnedCharms() { return progress().charms || []; }

  function removeCharm(charmId) {
    var charms = progress().charms;
    if (!charms) return;
    var idx = charms.indexOf(charmId);
    if (idx >= 0) charms.splice(idx, 1);
  }

  function getCharmDef(charmId, config) {
    var cfg = config || _callbacks.getConfig && _callbacks.getConfig();
    if (!cfg || !cfg.crates || !cfg.crates.dropPools) return null;
    // Search all consumable pools
    var pools = ['battle_charms', 'stamina_items', 'elemental_items', 'element_resist_charms', 'battle_surge'];
    for (var i = 0; i < pools.length; i++) {
      var pool = cfg.crates.dropPools[pools[i]];
      if (pool && pool.items) {
        var found = pool.items.find(function(c) { return c.id === charmId; });
        if (found) return found;
      }
    }
    return null;
  }

  // ── Charm Selector UI (prefight overlay) ──

  function renderCharmSelector() {
    var container = document.getElementById('bs-charm-selector');
    if (!container) return;
    var metaEl = document.getElementById('bs-charm-meta');
    var emptyEl = document.getElementById('bs-charm-empty');
    var allOwned = getOwnedCharms();
    if (allOwned.length === 0) {
      container.style.display = 'none';
      if (metaEl) metaEl.textContent = '';
      if (emptyEl) emptyEl.style.display = '';
      _equippedCharm = null;
      _selectedInventoryItems = [];
      return;
    }

    // Unified consumable list — no charm/item split. All go into pick-up-to-3.
    var itemCounts = {};
    allOwned.forEach(function(id) {
      var def = getCharmDef(id);
      if (!def) return;
      itemCounts[id] = (itemCounts[id] || 0) + 1;
    });
    var itemIds = Object.keys(itemCounts);

    if (itemIds.length === 0) {
      container.style.display = 'none';
      if (metaEl) metaEl.textContent = '';
      if (emptyEl) emptyEl.style.display = '';
      _equippedCharm = null;
      _selectedInventoryItems = [];
      return;
    }

    container.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';

    // Count selections
    var selCounts = {};
    _selectedInventoryItems.forEach(function(id) { selCounts[id] = (selCounts[id] || 0) + 1; });
    var totalSelected = _selectedInventoryItems.length;

    // Meta count goes into the section label (#bs-charm-meta) — the JS no
    // longer emits its own inline header. Falls back to inline emit when
    // the container is rendered without the prefight section wrapper
    // (e.g. legacy contexts).
    if (metaEl) {
      metaEl.innerHTML = totalSelected > 0
        ? totalSelected + ' / ' + MAX_INVENTORY_ITEMS + ' selected'
        : 'Pick up to ' + MAX_INVENTORY_ITEMS;
    }

    var fallbackHeader = metaEl
      ? ''
      : '<p class="bs-charm-selector__legacy-header"><i class="fas fa-box-open"></i> Bring items (up to ' + MAX_INVENTORY_ITEMS + '):'
        + (totalSelected > 0 ? ' <span class="bs-charm-selector__legacy-count">' + totalSelected + '/' + MAX_INVENTORY_ITEMS + ' selected</span>' : '')
        + '</p>';

    var html = fallbackHeader
      + '<div class="bs-charm-options">'
      + itemIds.map(function(id) {
          var def = getCharmDef(id);
          if (!def) return '';
          var owned = itemCounts[id];
          var picked = selCounts[id] || 0;
          var active = picked > 0;
          return '<button class="bs-charm-option' + (active ? ' bs-charm-option--selected' : '') + '"'
            + ' data-item="' + escHtml(id) + '"'
            + ' title="' + escHtml(def.description || def.name) + '"'
            + ' aria-label="' + escHtml(def.name) + ' (' + picked + '/' + owned + ')">'
            + itemArtHtml(id, def.icon, def.name)
            + '<span>' + escHtml(def.name) + '</span>'
            + '<span class="bs-charm-count">' + (active ? picked + '/' : '') + 'x' + owned + '</span>'
            + '</button>';
        }).join('')
      + '</div>';

    container.innerHTML = html;

    // ── Click handlers (toggle: click to add, click again to remove) ──
    container.querySelectorAll('[data-item]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.dataset.item;
        var pickedCount = _selectedInventoryItems.filter(function(x) { return x === id; }).length;
        var ownedCount = itemCounts[id] || 0;
        if (pickedCount > 0) {
          var idx = _selectedInventoryItems.indexOf(id);
          if (idx >= 0) _selectedInventoryItems.splice(idx, 1);
        } else if (_selectedInventoryItems.length < MAX_INVENTORY_ITEMS && pickedCount < ownedCount) {
          _selectedInventoryItems.push(id);
        }
        renderCharmSelector();
      });
    });
  }

  // ── Charm Battle Button ──

  function addCharmButtonToBattle() {
    if (!_equippedCharm) return;
    var def = getCharmDef(_equippedCharm);
    if (!def) return;
    _charmUsedThisBattle = false;
    var tray = document.getElementById('arena-player-item-tray');
    var movesEl = tray || document.getElementById('arena-items-row') || document.getElementById('arena-moves');
    if (!movesEl) return;
    if (movesEl.querySelector('[data-move="charm"]')) return;
    var compact = !!tray;
    var btn = document.createElement('button');
    btn.className = 'arena-move-btn arena-move-btn--charm';
    btn.dataset.move = 'charm';
    btn.title = def.name + (def.description ? ' — ' + def.description : '');
    btn.setAttribute('aria-label', def.name + ' — ' + def.description);
    if (compact) {
      btn.innerHTML = itemArtHtml(_equippedCharm, def.icon || 'fa-flask', def.name);
    } else {
      btn.innerHTML = '<div class="arena-move-btn__glow" aria-hidden="true"></div>'
        + itemArtHtml(_equippedCharm, def.icon || 'fa-flask', def.name)
        + '<span class="arena-move-btn__label">' + escHtml(def.name) + '</span>'
        + '<span class="arena-move-btn__stat">1 use</span>'
        + '<span class="arena-move-btn__desc">' + escHtml(def.description || '') + '</span>';
    }
    movesEl.appendChild(btn);

    var charmIdAtFire = _equippedCharm;
    btn.addEventListener('click', function() {
      if (_charmUsedThisBattle) return;
      _charmUsedThisBattle = true;
      btn.disabled = true;
      btn.classList.add('arena-move-btn--used');
      applyCharmEffect(def);
      removeCharm(_equippedCharm);
      _equippedCharm = null;
      addPlayerItemChip(charmIdAtFire, def.name, def.icon || 'fa-gem');
      if (_callbacks.toast) _callbacks.toast(def.name + ' activated!');
      if (_callbacks.sfx) _callbacks.sfx('loot');
    }, { once: true });
  }

  // ── Charm Visual Effects (client-side only) ──

  function applyCharmEffect(def) {
    if (!def || !def.effect) return;
    var logEl = document.getElementById('arena-battle-log');
    function addLogEntry(msg) {
      if (!logEl) return;
      var entry = document.createElement('div');
      entry.className = 'arena-log-entry';
      entry.textContent = msg;
      logEl.appendChild(entry);
      logEl.scrollTop = logEl.scrollHeight;
    }
    function addBuffChip(label, icon) {
      var buffs = document.getElementById('arena-player-buffs');
      if (!buffs) return;
      var chip = document.createElement('span');
      chip.className = 'arena-buff-chip bs-charm-buff';
      chip.innerHTML = '<i class="fas ' + icon + '" aria-hidden="true"></i> ' + escHtml(label);
      buffs.appendChild(chip);
    }

    if (def.effect === 'heal_percent') {
      var hpText = document.getElementById('arena-player-hp-text');
      var hpFill = document.getElementById('arena-player-hp-fill');
      if (hpText) {
        var parts = hpText.textContent.split('/').map(function(s) { return parseInt(s.trim(), 10); });
        var curHp = parts[0] || 0;
        var maxHp = parts[1] || 100;
        var heal = Math.round(maxHp * (def.value / 100));
        var newHp = Math.min(maxHp, curHp + heal);
        hpText.textContent = newHp + ' / ' + maxHp;
        if (hpFill) hpFill.style.width = Math.round((newHp / maxHp) * 100) + '%';
        addLogEntry('\u2728 ' + def.name + ': Healed ' + (newHp - curHp) + ' HP!');
      }
    } else if (def.effect === 'damage_boost') {
      addBuffChip('+' + def.value + '% DMG', def.icon || 'fa-explosion');
      addLogEntry('\u2728 ' + def.name + ': +' + def.value + '% damage this round!');
    } else if (def.effect === 'full_block') {
      addBuffChip('Shield Wall', def.icon || 'fa-shield');
      addLogEntry('\u2728 ' + def.name + ': Blocking all damage this round!');
    } else if (def.effect === 'guaranteed_crit') {
      addBuffChip('Crit!', def.icon || 'fa-clover');
      addLogEntry('\u2728 ' + def.name + ': Next attack is a guaranteed critical!');
    } else if (def.effect === 'full_charges') {
      addBuffChip('Charged', def.icon || 'fa-battery-full');
      addLogEntry('\u2728 ' + def.name + ': Ability fully charged!');
      var abilityBtn = document.querySelector('.arena-move-btn--ability');
      if (abilityBtn) {
        abilityBtn.disabled = false;
        abilityBtn.classList.remove('arena-move-btn--disabled');
      }
    }
  }

  // ── Adventure Item Buttons in Battle ──

  function addItemButtonsToBattle() {
    // Merge adventure items + inventory items for battle display
    var invItems = _selectedInventoryItems.map(function(id) {
      var def = getCharmDef(id);
      return def ? { id: id, name: def.name, icon: def.icon || 'fa-box', description: def.description || '' } : null;
    }).filter(Boolean);
    var allBattleItems = _adventureItems.concat(invItems);
    if (allBattleItems.length === 0) return;
    var tray = document.getElementById('arena-player-item-tray');
    var movesEl = tray || document.getElementById('arena-items-row') || document.getElementById('arena-moves');
    if (!movesEl) return;
    var compact = !!tray;

    allBattleItems.forEach(function(item, idx) {
      if (movesEl.querySelector('[data-item-idx="' + idx + '"]')) return;
      var btn = document.createElement('button');
      btn.className = 'arena-move-btn arena-move-btn--item';
      btn.dataset.itemIdx = idx;
      btn.dataset.itemId = item.id;
      btn.title = item.name + (item.description ? ' \u2014 ' + item.description : '');
      btn.setAttribute('aria-label', item.name + ' \u2014 ' + (item.description || ''));
      if (compact) {
        btn.innerHTML = itemArtHtml(item.id, item.icon || 'fa-box', item.name);
      } else {
        btn.innerHTML = '<div class="arena-move-btn__glow" aria-hidden="true"></div>'
          + itemArtHtml(item.id, item.icon || 'fa-box', item.name)
          + '<span class="arena-move-btn__label">' + escHtml(item.name) + '</span>'
          + '<span class="arena-move-btn__stat">1 use</span>'
          + '<span class="arena-move-btn__desc">' + escHtml(item.description || '') + '</span>';
      }
      movesEl.appendChild(btn);

      btn.addEventListener('click', function() {
        if (_adventureItemsUsed[idx]) return;
        _adventureItemsUsed[idx] = true;
        btn.disabled = true;
        btn.classList.add('arena-move-btn--used');
        window._pendingItemUse = item.id;
        // Show item chip on player card when activated
        addPlayerItemChip(item.id, item.name, item.icon || 'fa-box');
        if (_callbacks.toast) _callbacks.toast(item.name + ' ready \u2014 pick your move!');
        if (_callbacks.sfx) _callbacks.sfx('click');
      }, { once: true });
    });
  }

  // ── Player Card Item Display ──

  function addPlayerItemChip(id, name, icon) {
    var el = document.getElementById('arena-player-items');
    if (!el) return;
    var chip = document.createElement('span');
    chip.className = 'arena-item-chip';
    chip.title = name;
    chip.innerHTML = itemArtHtml(id, icon || 'fa-box', name);
    el.appendChild(chip);
  }

  // ── State Management ──

  function setAdventureItems(items) { _adventureItems = items || []; }
  function getAdventureItems() { return _adventureItems; }

  function resetBattleState() {
    _equippedCharm = null;
    _charmUsedThisBattle = false;
    _adventureItems = [];
    _adventureItemsUsed = {};
    _selectedInventoryItems = [];
    window._pendingItemUse = null;
    // Clear item/charm buttons from DOM
    var itemsRow = document.getElementById('arena-items-row');
    if (itemsRow) itemsRow.innerHTML = '';
    var itemTray = document.getElementById('arena-player-item-tray');
    if (itemTray) itemTray.innerHTML = '';
    var playerItems = document.getElementById('arena-player-items');
    if (playerItems) playerItems.innerHTML = '';
  }

  function getSelectedInventoryItems() {
    // Return as array of { id, name, icon, description } for the server
    return _selectedInventoryItems.map(function(id) {
      var def = getCharmDef(id);
      return { id: id, name: def ? def.name : id, icon: def ? def.icon : 'fa-box', description: def ? def.description : '' };
    });
  }

  function consumeSelectedItems() {
    // Remove selected items from inventory after battle starts
    _selectedInventoryItems.forEach(function(id) { removeCharm(id); });
    _selectedInventoryItems = [];
    sync();
  }

  function getEquippedCharm() { return _equippedCharm; }
  function setEquippedCharm(id) { _equippedCharm = id; }

  // ── Public API ──

  return {
    getOwned: getOwnedCharms,
    remove: removeCharm,
    getDef: getCharmDef,
    itemArtHtml: itemArtHtml,
    assetArtHtml: assetArtHtml,
    pvpRankIconHtml: pvpRankIconHtml,
    hasItemArt: function (id) { return !!ITEM_IMAGES[id]; },
    hasAssetArt: function (category, id) {
      var r = ASSET_REGISTRY[category];
      return !!(r && r[id]);
    },
    renderSelector: renderCharmSelector,
    addCharmButton: addCharmButtonToBattle,
    addItemButtons: addItemButtonsToBattle,
    applyEffect: applyCharmEffect,
    setAdventureItems: setAdventureItems,
    getAdventureItems: getAdventureItems,
    resetBattleState: resetBattleState,
    getEquipped: getEquippedCharm,
    setEquipped: setEquippedCharm,
    getSelectedItems: getSelectedInventoryItems,
    consumeSelectedItems: consumeSelectedItems,
    setCallbacks: function (cbs) { _callbacks = cbs; }
  };
})();
