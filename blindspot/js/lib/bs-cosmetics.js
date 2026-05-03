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

  // Mini animated previews for the victory_* cosmetics. Renders the actual
  // effect at icon-slot scale, looped infinitely, contained inside the slot.
  // Same particle/animation language as the fullscreen version (.bs-vfx-*),
  // scoped under .bs-victory-preview so the styles don't escape.
  function buildVictoryPreviewHtml(victoryId) {
    if (victoryId === 'victory_confetti') {
      var colors = ['#EF9F27', '#FF5252', '#22C55E', '#3B82F6', '#A855F7', '#F5C078'];
      var html = '';
      for (var i = 0; i < 8; i++) {
        html += '<span class="bs-vfx-mini-particle" style="left:' + (8 + i * 11) + '%; background:' + colors[i % colors.length]
          + '; animation-delay:' + (i * 0.3).toFixed(2) + 's;"></span>';
      }
      return '<div class="bs-victory-preview bs-victory-preview--confetti">' + html + '</div>';
    }
    if (victoryId === 'victory_lightning') {
      var bolts = '';
      for (var i = 0; i < 3; i++) {
        bolts += '<span class="bs-vfx-mini-bolt" style="left:' + (20 + i * 28) + '%; animation-delay:' + (i * 0.55).toFixed(2) + 's;"></span>';
      }
      return '<div class="bs-victory-preview bs-victory-preview--lightning">' + bolts + '</div>';
    }
    if (victoryId === 'victory_fireworks') {
      return '<div class="bs-victory-preview bs-victory-preview--fireworks">'
        + '<span class="bs-vfx-mini-firework"></span>'
        + '</div>';
    }
    if (victoryId === 'victory_shockwave') {
      return '<div class="bs-victory-preview bs-victory-preview--shockwave">'
        + '<span class="bs-vfx-mini-ring"></span>'
        + '<span class="bs-vfx-mini-ring" style="animation-delay:0.4s;"></span>'
        + '<span class="bs-vfx-mini-ring" style="animation-delay:0.8s;"></span>'
        + '</div>';
    }
    if (victoryId === 'victory_ravens') {
      var ravens = '';
      for (var i = 0; i < 3; i++) {
        ravens += '<span class="bs-vfx-mini-raven" style="top:' + (60 + i * 8) + '%; animation-delay:' + (i * 0.9).toFixed(2) + 's;">'
          + '<i class="fas fa-crow"></i></span>';
      }
      return '<div class="bs-victory-preview bs-victory-preview--ravens">' + ravens + '</div>';
    }
    return '<i class="fas fa-burst" aria-hidden="true"></i>';
  }

  // Mini live previews for frames / backs / plates. Each cosmetic category
  // gets its own preview shape so the player sees what the cosmetic actually
  // does, not a generic icon. All looped where the underlying effect loops.
  // ID slugs from game-config use underscores (frame_gold_filigree); CSS
  // class convention uses hyphens (.bs-cos-frame--gold-filigree). Convert.
  function slugify(id, prefix) {
    return id.replace(prefix, '').replace(/_/g, '-');
  }
  function buildFramePreviewHtml(frameId) {
    var slug = slugify(frameId, 'frame_');
    return '<div class="bs-cos-preview bs-cos-preview--frame bs-cos-frame--' + slug + '">'
      + '<div class="bs-cos-frame__inner"></div>'
      + '</div>';
  }
  function buildBackPreviewHtml(backId) {
    var slug = slugify(backId, 'back_');
    return '<div class="bs-cos-preview bs-cos-preview--back bs-cos-back--' + slug + '">'
      + '<div class="bs-cos-back__art"></div>'
      + '</div>';
  }
  function buildPlatePreviewHtml(plateId) {
    var slug = slugify(plateId, 'plate_');
    // Reuse the live .bs-rc__name.bs-plate--* rules: same color, text-shadow,
    // and animations the player sees on their actual card name.
    return '<div class="bs-cos-preview bs-cos-preview--plate">'
      + '<span class="bs-rc__name bs-plate--' + slug + '">Stranger</span>'
      + '</div>';
  }

  // Single dispatcher consumed by collection (owned-only) and shop
  // (always-on, since the shop is window-browsing). Returns null if the
  // item is not a previewable cosmetic, so callers can fall back to art / icon.
  function cosmeticPreviewHtml(itemId) {
    if (!itemId) return null;
    if (itemId.indexOf('victory_') === 0) return buildVictoryPreviewHtml(itemId);
    if (itemId.indexOf('frame_') === 0)   return buildFramePreviewHtml(itemId);
    if (itemId.indexOf('back_') === 0)    return buildBackPreviewHtml(itemId);
    if (itemId.indexOf('plate_') === 0)   return buildPlatePreviewHtml(itemId);
    return null;
  }

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
  var _collectionFilter = 'all'; // 'all' | 'owned'
  try {
    var _persistedFilter = localStorage.getItem('bs-collection-filter');
    if (_persistedFilter === 'owned' || _persistedFilter === 'all') _collectionFilter = _persistedFilter;
  } catch (e) { /* ignore */ }


  function setCollectionSlot(slot) { _collectionSlot = slot; }
  function getCollectionSlot() { return _collectionSlot; }
  function setCollectionFilter(f) {
    if (f !== 'all' && f !== 'owned') return;
    _collectionFilter = f;
    var setter = (window.BsState && window.BsState.safeLSSet) ? window.BsState.safeLSSet : function(k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
    setter('bs-collection-filter', f);
  }
  function getCollectionFilter() { return _collectionFilter; }

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
    document.querySelectorAll('.bs-collection__filter-chip').forEach(function(chip) {
      var isActive = chip.dataset.filter === _collectionFilter;
      chip.classList.toggle('bs-collection__filter-chip--active', isActive);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
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
        if (_collectionFilter === 'owned' && qty === 0) continue;
        var rarityColor = RARITY_COLORS[cItem.rarity] || 'var(--bs-text-muted)';

        // Owned -> show illustrated art. Unowned -> show FA icon (preserves
        // first-time reveal moment when the player actually acquires one).
        var cArtId = qty > 0 ? cItem.id : null;
        var cIconHtml = (window.BsCharms && window.BsCharms.itemArtHtml)
          ? window.BsCharms.itemArtHtml(cArtId, cItem.icon, cItem.name)
          : '<i class="fas ' + (cItem.icon || 'fa-box') + '" aria-hidden="true"></i>';
        html += '<div class="bs-collection-item' + (qty === 0 ? ' bs-collection-item--locked' : '') + '"'
          + ' style="--bs-item-rarity:' + rarityColor + ';"'
          + ' aria-label="' + escHtml(cItem.name) + ' x' + qty + '">'
          + '<div class="bs-collection-item__icon">' + cIconHtml + '</div>'
          + '<span class="bs-collection-item__name">'
          + (qty === 0 ? '<i class="fas fa-lock bs-collection-item__name-lock" aria-hidden="true"></i> ' : '')
          + escHtml(cItem.name) + '</span>'
          + '<span class="bs-collection-item__desc">' + escHtml(cItem.description || '') + '</span>'
          + '<span class="bs-collection-item__rarity" style="color:' + rarityColor + ';">' + (cItem.rarity || '') + '</span>'
          + '<span class="bs-collection-item__qty"' + (qty > 0 ? ' style="color:var(--bs-accent);"' : '') + '>x' + qty + '</span>'
          + '</div>';
      }
    } else {
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var isOwned = owned.includes(item.id);
        if (_collectionFilter === 'owned' && !isOwned) continue;
        var isEquipped = equipped[_collectionSlot] === item.id;
        var rarityColor = RARITY_COLORS[item.rarity] || 'var(--bs-text-muted)';

        // Owned -> show illustrated art if we have it for this category;
        // unowned (or no art for this slot) -> FA icon. Category derived from
        // item ID prefix (title_* / frame_* / back_* / plate_* / victory_*).
        // Special case: victory_* shows a mini animated preview of the
        // actual effect when owned, not a static image.
        var slotCategory = (item.id.indexOf('title_') === 0) ? 'titles'
          : (item.id.indexOf('frame_') === 0) ? 'frames'
          : (item.id.indexOf('back_') === 0) ? 'backs'
          : (item.id.indexOf('plate_') === 0) ? 'plates'
          : (item.id.indexOf('victory_') === 0) ? 'victory'
          : null;

        var slotIconHtml;
        if (isOwned && slotCategory === 'victory') {
          slotIconHtml = buildVictoryPreviewHtml(item.id);
        } else if (isOwned && slotCategory === 'frames') {
          slotIconHtml = buildFramePreviewHtml(item.id);
        } else if (isOwned && slotCategory === 'backs') {
          slotIconHtml = buildBackPreviewHtml(item.id);
        } else if (isOwned && slotCategory === 'plates') {
          slotIconHtml = buildPlatePreviewHtml(item.id);
        } else {
          var slotArtId = (isOwned && slotCategory) ? item.id : null;
          slotIconHtml = (slotCategory && window.BsCharms && window.BsCharms.assetArtHtml)
            ? window.BsCharms.assetArtHtml(slotCategory, slotArtId, item.icon, item.name)
            : '<i class="fas ' + (item.icon || 'fa-star') + '" aria-hidden="true"></i>';
        }

        html += '<button class="bs-collection-item'
          + (isEquipped ? ' bs-collection-item--equipped' : '')
          + (isOwned ? '' : ' bs-collection-item--locked')
          + '"'
          + ' data-item-id="' + escHtml(item.id) + '" data-slot="' + escHtml(_collectionSlot) + '"'
          + (isOwned ? '' : ' disabled')
          + ' aria-label="' + escHtml(item.name) + (isEquipped ? ' (equipped)' : '') + (isOwned ? '' : ' (locked)') + '"'
          + ' style="--bs-item-rarity:' + rarityColor + ';">'
          + '<div class="bs-collection-item__icon">' + slotIconHtml + '</div>'
          + '<span class="bs-collection-item__name">'
          + (!isOwned ? '<i class="fas fa-lock bs-collection-item__name-lock" aria-hidden="true"></i> ' : '')
          + escHtml(item.name) + '</span>'
          + '<span class="bs-collection-item__rarity" style="color:' + rarityColor + ';">' + (item.rarity || '') + '</span>'
          + (isEquipped ? '<span class="bs-collection-item__badge"><i class="fas fa-check"></i> Equipped</span>' : '')
          + (!isOwned ? '<span class="bs-collection-item__lock"><i class="fas fa-lock"></i></span>' : '')
          + '</button>';
      }
    }

    if (html === '') {
      var emptyMsg = items.length === 0
        ? 'No items in this category.'
        : (_collectionFilter === 'owned'
            ? "Nothing owned yet — open crates or visit the Sparks Shop."
            : 'No items in this category.');
      html = '<div class="bs-collection-empty"><p style="color:var(--bs-text-muted);">' + emptyMsg + '</p></div>';
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
    setFilter: setCollectionFilter,
    getFilter: getCollectionFilter,
    render: renderCollection,
    apply: applyEquippedCosmetics,
    cosmeticPreviewHtml: cosmeticPreviewHtml,
    setCallbacks: function(cbs) { _cb = cbs || {}; }
  };
})();
