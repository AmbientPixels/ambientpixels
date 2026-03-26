/**
 * Blindspot Cosmetics — Inventory, Equip, Collection UI, Apply
 *
 * Manages cosmetic items (frames, backs, nameplates, victory animations, titles).
 * Reads _progress and _config from BsState and game config.
 *
 * API: window.BsCosmetics
 */
window.BsCosmetics = (function () {
  'use strict';

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // ── State accessors ──
  function progress() { return window.BsState ? window.BsState.progress : {}; }
  function sync() { if (window.BsState) window.BsState.sync(); }

  // ── Injected callbacks (for shop buy actions) ──
  var _cb = {};

  // ── Getters / Setters ──

  function getOwnedCosmetics() { return progress().cosmetics || []; }
  function getEquipped() { return progress().equipped || {}; }
  function setEquipped(eq) { progress().equipped = eq; }

  function equipCosmetic(slot, itemId) {
    var eq = getEquipped();
    if (eq[slot] === itemId) { delete eq[slot]; }
    else { eq[slot] = itemId; }
    setEquipped(eq);
  }

  // ── Cosmetic lookup caches ──

  var _cosmeticLookup = {};
  var _cosmeticsBySlot = null;
  var _config = null;

  function buildCaches(config) {
    _config = config;
    _cosmeticLookup = {};
    _cosmeticsBySlot = {};
    if (!config || !config.crates || !config.crates.dropPools) return;
    var pools = config.crates.dropPools;
    var cosmeticPools = ['card_frames', 'card_backs', 'name_plates', 'victory_animations', 'titles'];
    for (var p = 0; p < cosmeticPools.length; p++) {
      var pool = pools[cosmeticPools[p]];
      if (!pool || !pool.items) continue;
      var slot = pool.slot;
      if (!_cosmeticsBySlot[slot]) _cosmeticsBySlot[slot] = [];
      for (var i = 0; i < pool.items.length; i++) {
        var entry = Object.assign({}, pool.items[i], { slot: slot, category: pool.category });
        _cosmeticLookup[pool.items[i].id] = entry;
        _cosmeticsBySlot[slot].push(entry);
      }
    }
    // Consumable pools — virtual "consumable" slot for Items tab
    var consumablePools = ['battle_charms', 'stamina_items', 'elemental_items', 'element_resist_charms'];
    if (!_cosmeticsBySlot['consumable']) _cosmeticsBySlot['consumable'] = [];
    for (var cp = 0; cp < consumablePools.length; cp++) {
      var cPool = pools[consumablePools[cp]];
      if (!cPool || !cPool.items) continue;
      for (var ci = 0; ci < cPool.items.length; ci++) {
        var cEntry = Object.assign({}, cPool.items[ci], { slot: 'consumable', category: 'consumable' });
        _cosmeticLookup[cPool.items[ci].id] = cEntry;
        _cosmeticsBySlot['consumable'].push(cEntry);
      }
    }
  }

  function findCosmeticDef(itemId) { return _cosmeticLookup[itemId] || null; }
  function getAllCosmeticsBySlot() { return _cosmeticsBySlot || {}; }

  // ── Collection UI ──

  var RARITY_COLORS = { common: 'var(--bs-text-muted)', uncommon: '#4ade80', rare: '#60a5fa', epic: '#c084fc' };
  var _collectionSlot = 'frame';


  function setCollectionSlot(slot) { _collectionSlot = slot; }
  function getCollectionSlot() { return _collectionSlot; }

  function renderCollection() {
    var container = document.getElementById('bs-collection-grid');
    var equippedEl = document.getElementById('bs-collection-equipped');
    if (!container) return;
    var owned = getOwnedCosmetics();
    var equipped = getEquipped();
    var bySlot = getAllCosmeticsBySlot();

    document.querySelectorAll('.bs-collection__tab').forEach(function(tab) {
      var isActive = tab.dataset.slot === _collectionSlot;
      tab.classList.toggle('bs-collection__tab--active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    var slotDescs = {
      frame: 'Glow effects around your card border in the lobby.',
      back: 'Card sleeve patterns shown behind your card.',
      nameplate: 'Visual effects applied to your card\'s name text.',
      victory: 'Celebration animations that play when you win a battle.',
      title: 'Titles displayed under your card name.',
      consumable: 'Battle charms, stamina items, and elemental gear. Buy from the Sparks Shop or find in crates and adventures.'
    };
    var descEl = document.getElementById('bs-collection-desc');
    if (!descEl) {
      descEl = document.createElement('p');
      descEl.id = 'bs-collection-desc';
      descEl.style.cssText = 'text-align:center;font-size:0.7rem;color:var(--bs-text-muted);margin:0.5rem 0 0.75rem;';
      container.parentNode.insertBefore(descEl, container);
    }
    descEl.textContent = slotDescs[_collectionSlot] || '';

    var items = bySlot[_collectionSlot] || [];
    var html = '';

    if (_collectionSlot === 'consumable') {
      // Consumable tab: count owned quantities from progress.charms
      var charms = progress().charms || [];
      var counts = {};
      charms.forEach(function(id) { counts[id] = (counts[id] || 0) + 1; });

      for (var ci = 0; ci < items.length; ci++) {
        var cItem = items[ci];
        var qty = counts[cItem.id] || 0;
        var rarityColor = RARITY_COLORS[cItem.rarity] || 'var(--bs-text-muted)';

        html += '<div class="bs-collection-item' + (qty === 0 ? ' bs-collection-item--locked' : '') + '"'
          + ' style="--bs-item-rarity:' + rarityColor + ';"'
          + ' aria-label="' + escHtml(cItem.name) + ' x' + qty + '">'
          + '<div class="bs-collection-item__icon"><i class="fas ' + (cItem.icon || 'fa-box') + '" aria-hidden="true"></i></div>'
          + '<span class="bs-collection-item__name">' + escHtml(cItem.name) + '</span>'
          + '<span class="bs-collection-item__desc">' + escHtml(cItem.description || '') + '</span>'
          + '<span class="bs-collection-item__rarity" style="color:' + rarityColor + ';">' + (cItem.rarity || '') + '</span>'
          + '<span class="bs-collection-item__qty"' + (qty > 0 ? ' style="color:var(--bs-accent);"' : '') + '>x' + qty + '</span>'
          + '</div>';
      }
    } else {
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var isOwned = owned.includes(item.id);
        var isEquipped = equipped[_collectionSlot] === item.id;
        var rarityColor = RARITY_COLORS[item.rarity] || 'var(--bs-text-muted)';

        html += '<button class="bs-collection-item'
          + (isEquipped ? ' bs-collection-item--equipped' : '')
          + (isOwned ? '' : ' bs-collection-item--locked')
          + '"'
          + ' data-item-id="' + escHtml(item.id) + '" data-slot="' + escHtml(_collectionSlot) + '"'
          + (isOwned ? '' : ' disabled')
          + ' aria-label="' + escHtml(item.name) + (isEquipped ? ' (equipped)' : '') + (isOwned ? '' : ' (locked)') + '"'
          + ' style="--bs-item-rarity:' + rarityColor + ';">'
          + '<div class="bs-collection-item__icon"><i class="fas ' + (item.icon || 'fa-star') + '" aria-hidden="true"></i></div>'
          + '<span class="bs-collection-item__name">' + escHtml(item.name) + '</span>'
          + '<span class="bs-collection-item__rarity" style="color:' + rarityColor + ';">' + (item.rarity || '') + '</span>'
          + (isEquipped ? '<span class="bs-collection-item__badge"><i class="fas fa-check"></i> Equipped</span>' : '')
          + (!isOwned ? '<span class="bs-collection-item__lock"><i class="fas fa-lock"></i></span>' : '')
          + '</button>';
      }
    }

    if (items.length === 0) {
      html = '<div class="bs-collection-empty"><p style="color:var(--bs-text-muted);">No items in this category.</p></div>';
    }

    container.innerHTML = html;

    if (!container._collectionDelegated) {
      container._collectionDelegated = true;
      container.addEventListener('click', function(e) {
        // Cosmetic equip/unequip
        var btn = e.target.closest('button.bs-collection-item:not(.bs-collection-item--locked)');
        if (!btn) return;
        var itemId = btn.dataset.itemId;
        var slot = btn.dataset.slot;
        equipCosmetic(slot, itemId);
        sync();
        renderCollection();
        applyEquippedCosmetics();
      });
    }

    if (equippedEl && _collectionSlot === 'consumable') {
      equippedEl.innerHTML = '';
    } else if (equippedEl) {
      var eqSlots = ['frame', 'back', 'nameplate', 'victory', 'title'];
      var eqHtml = '<div class="bs-collection-equipped__title">Equipped</div><div class="bs-collection-equipped__items">';
      var hasAny = false;
      for (var s = 0; s < eqSlots.length; s++) {
        var sl = eqSlots[s];
        var eqId = equipped[sl];
        if (!eqId) continue;
        hasAny = true;
        var def = findCosmeticDef(eqId);
        if (!def) continue;
        var rc = RARITY_COLORS[def.rarity] || 'var(--bs-text-muted)';
        eqHtml += '<span class="bs-collection-equipped__chip" style="border-color:' + rc + ';">'
          + '<i class="fas ' + (def.icon || 'fa-star') + '" style="color:' + rc + ';" aria-hidden="true"></i> '
          + escHtml(def.name)
          + '</span>';
      }
      eqHtml += '</div>';
      equippedEl.innerHTML = hasAny ? eqHtml : '';
    }
  }

  // ── Apply cosmetics to lobby card ──

  function applyEquippedCosmetics() {
    var cardEl = document.getElementById('bs-player-card');
    if (!cardEl) return;
    var equipped = getEquipped();

    var classes = cardEl.className.split(' ').filter(function(c) {
      return !c.startsWith('bs-frame--') && !c.startsWith('bs-back--') && !c.startsWith('bs-plate--');
    });
    cardEl.className = classes.join(' ');

    if (equipped.frame) {
      var frameDef = findCosmeticDef(equipped.frame);
      if (frameDef && frameDef.cssClass) cardEl.classList.add(frameDef.cssClass);
    }

    var oldEmbers = cardEl.querySelector('.bs-ember-container');
    if (oldEmbers) oldEmbers.remove();
    if (equipped.back) {
      var backDef = findCosmeticDef(equipped.back);
      if (backDef && backDef.cssClass) cardEl.classList.add(backDef.cssClass);
      if (equipped.back === 'back_embers') {
        var artEl = cardEl.querySelector('.bs-rc__art');
        if (artEl) {
          var emberContainer = document.createElement('div');
          emberContainer.className = 'bs-ember-container';
          var emberColors = ['#EF9F27', '#ff7b00', '#ffaa33', '#ff6600', '#ffcc44'];
          for (var ei = 0; ei < 12; ei++) {
            var dot = document.createElement('div');
            dot.className = 'bs-ember-dot';
            dot.style.left = (5 + Math.random() * 90) + '%';
            dot.style.bottom = (Math.random() * 30) + '%';
            dot.style.width = (2 + Math.random() * 2) + 'px';
            dot.style.height = dot.style.width;
            dot.style.background = emberColors[Math.floor(Math.random() * emberColors.length)];
            dot.style.setProperty('--ember-dur', (3 + Math.random() * 4) + 's');
            dot.style.setProperty('--ember-delay', (Math.random() * 5) + 's');
            dot.style.setProperty('--ember-drift', ((Math.random() - 0.5) * 20) + 'px');
            emberContainer.appendChild(dot);
          }
          artEl.appendChild(emberContainer);
        }
      }
    }

    var nameEl = cardEl.querySelector('.bs-rc__name');
    if (nameEl) {
      var oldPlate = nameEl.className.split(' ').filter(function(c) { return !c.startsWith('bs-plate--'); });
      nameEl.className = oldPlate.join(' ');
      if (equipped.nameplate) {
        var plateDef = findCosmeticDef(equipped.nameplate);
        if (plateDef && plateDef.cssClass) nameEl.classList.add(plateDef.cssClass);
      }
    }

    var titleEl = document.getElementById('bs-card-title');
    if (equipped.title) {
      var titleDef = findCosmeticDef(equipped.title);
      if (titleDef && titleDef.title && titleEl) {
        titleEl.textContent = titleDef.title;
        titleEl.style.display = '';
      }
    } else if (titleEl) {
      var fallbackTitle = progress().cardTitle || '';
      titleEl.textContent = fallbackTitle;
      titleEl.style.display = fallbackTitle ? '' : 'none';
    }
  }

  // ── Public API ──

  return {
    getOwned: getOwnedCosmetics,
    getEquipped: getEquipped,
    setEquipped: setEquipped,
    equip: equipCosmetic,
    buildCaches: buildCaches,
    find: findCosmeticDef,
    getAllBySlot: getAllCosmeticsBySlot,
    setSlot: setCollectionSlot,
    getSlot: getCollectionSlot,
    render: renderCollection,
    apply: applyEquippedCosmetics,
    setCallbacks: function(cbs) { _cb = cbs || {}; }
  };
})();
