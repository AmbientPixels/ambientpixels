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
    var pools = ['battle_charms', 'stamina_items', 'elemental_items', 'element_resist_charms'];
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
    var allOwned = getOwnedCharms();
    if (allOwned.length === 0) {
      container.style.display = 'none';
      _equippedCharm = null;
      _selectedInventoryItems = [];
      return;
    }

    // Split owned items into charms (slot: charm) vs items (slot: item) by looking up defs
    var charmCounts = {};
    var itemCounts = {};
    allOwned.forEach(function(id) {
      var def = getCharmDef(id);
      if (!def) return;
      if (def.slot === 'item') {
        itemCounts[id] = (itemCounts[id] || 0) + 1;
      } else {
        charmCounts[id] = (charmCounts[id] || 0) + 1;
      }
    });
    var charmIds = Object.keys(charmCounts);
    var itemIds = Object.keys(itemCounts);

    if (charmIds.length === 0 && itemIds.length === 0) {
      container.style.display = 'none';
      _equippedCharm = null;
      _selectedInventoryItems = [];
      return;
    }

    container.style.display = '';
    var html = '';

    // ── Charm section (pick 1) ──
    if (charmIds.length > 0) {
      html += '<p style="font-size:0.7rem; color:var(--bs-text-muted); margin-bottom:0.4rem;"><i class="fas fa-flask"></i> Equip a charm (optional):</p>'
        + '<div class="bs-charm-options">'
        + charmIds.map(function(id) {
            var def = getCharmDef(id);
            if (!def) return '';
            var selected = _equippedCharm === id;
            return '<button class="bs-charm-option' + (selected ? ' bs-charm-option--selected' : '') + '"'
              + ' data-charm="' + escHtml(id) + '"'
              + ' title="' + escHtml(def.description || def.name) + '"'
              + ' aria-label="' + escHtml(def.name) + ' x' + charmCounts[id] + '">'
              + '<i class="fas ' + (def.icon || 'fa-flask') + '"></i>'
              + '<span>' + escHtml(def.name) + '</span>'
              + '<span class="bs-charm-count">x' + charmCounts[id] + '</span>'
              + '</button>';
          }).join('')
        + '<button class="bs-charm-option' + (!_equippedCharm ? ' bs-charm-option--selected' : '') + '" data-charm="none" aria-label="No charm">'
        + '<i class="fas fa-ban"></i><span>None</span></button>'
        + '</div>';
    }

    // ── Item section (pick up to 3) ──
    if (itemIds.length > 0) {
      // Count how many of each are selected
      var selCounts = {};
      _selectedInventoryItems.forEach(function(id) { selCounts[id] = (selCounts[id] || 0) + 1; });
      var totalSelected = _selectedInventoryItems.length;

      html += '<p style="font-size:0.7rem; color:var(--bs-text-muted); margin-bottom:0.4rem; margin-top:0.6rem;">'
        + '<i class="fas fa-box-open"></i> Bring items (up to ' + MAX_INVENTORY_ITEMS + '):'
        + (totalSelected > 0 ? ' <span style="color:var(--bs-accent);">' + totalSelected + '/' + MAX_INVENTORY_ITEMS + ' selected</span>' : '')
        + '</p>'
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
              + '<i class="fas ' + (def.icon || 'fa-box') + '"></i>'
              + '<span>' + escHtml(def.name) + '</span>'
              + '<span class="bs-charm-count">' + (active ? picked + '/' : '') + 'x' + owned + '</span>'
              + '</button>';
          }).join('')
        + '</div>';
    }

    container.innerHTML = html;

    // ── Charm click handlers ──
    container.querySelectorAll('[data-charm]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.dataset.charm;
        _equippedCharm = id === 'none' ? null : id;
        renderCharmSelector();
      });
    });

    // ── Item click handlers (toggle: click to add, click again to remove) ──
    container.querySelectorAll('[data-item]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.dataset.item;
        var pickedCount = _selectedInventoryItems.filter(function(x) { return x === id; }).length;
        var ownedCount = itemCounts[id] || 0;
        if (pickedCount > 0) {
          // Remove one instance
          var idx = _selectedInventoryItems.indexOf(id);
          if (idx >= 0) _selectedInventoryItems.splice(idx, 1);
        } else if (_selectedInventoryItems.length < MAX_INVENTORY_ITEMS && pickedCount < ownedCount) {
          // Add one instance
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
    var movesEl = document.getElementById('arena-moves');
    if (!movesEl) return;
    if (movesEl.querySelector('[data-move="charm"]')) return;
    var btn = document.createElement('button');
    btn.className = 'arena-move-btn arena-move-btn--charm';
    btn.dataset.move = 'charm';
    btn.setAttribute('aria-label', def.name + ' — ' + def.description);
    btn.innerHTML = '<div class="arena-move-btn__glow" aria-hidden="true"></div>'
      + '<i class="fas ' + (def.icon || 'fa-flask') + '" aria-hidden="true"></i>'
      + '<span class="arena-move-btn__label">' + escHtml(def.name) + '</span>'
      + '<span class="arena-move-btn__stat">1 use</span>'
      + '<span class="arena-move-btn__desc">' + escHtml(def.description || '') + '</span>';
    movesEl.appendChild(btn);

    btn.addEventListener('click', function() {
      if (_charmUsedThisBattle) return;
      _charmUsedThisBattle = true;
      btn.disabled = true;
      btn.classList.add('arena-move-btn--used');
      applyCharmEffect(def);
      removeCharm(_equippedCharm);
      _equippedCharm = null;
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
    if (_adventureItems.length === 0) return;
    var movesEl = document.getElementById('arena-moves');
    if (!movesEl) return;

    _adventureItems.forEach(function(item, idx) {
      if (movesEl.querySelector('[data-item-idx="' + idx + '"]')) return;
      var btn = document.createElement('button');
      btn.className = 'arena-move-btn arena-move-btn--item';
      btn.dataset.itemIdx = idx;
      btn.dataset.itemId = item.id;
      btn.setAttribute('aria-label', item.name + ' \u2014 ' + item.description);
      btn.innerHTML = '<div class="arena-move-btn__glow" aria-hidden="true"></div>'
        + '<i class="fas ' + (item.icon || 'fa-box') + '" aria-hidden="true"></i>'
        + '<span class="arena-move-btn__label">' + escHtml(item.name) + '</span>'
        + '<span class="arena-move-btn__stat">1 use</span>'
        + '<span class="arena-move-btn__desc">' + escHtml(item.description || '') + '</span>';
      movesEl.appendChild(btn);

      btn.addEventListener('click', function() {
        if (_adventureItemsUsed[idx]) return;
        _adventureItemsUsed[idx] = true;
        btn.disabled = true;
        btn.classList.add('arena-move-btn--used');
        window._pendingItemUse = item.id;
        if (_callbacks.toast) _callbacks.toast(item.name + ' ready \u2014 pick your move!');
        if (_callbacks.sfx) _callbacks.sfx('click');
      }, { once: true });
    });
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
