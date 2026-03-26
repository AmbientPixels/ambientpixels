/**
 * bs-sparks-shop.js — Full Sparks Shop (Featured / Consumables / Cosmetics)
 *
 * Replaces the old single-button Ember Crate shop.
 * Reads catalog from game-config.json `shop` section.
 * Writes to progress.charms (consumables), progress.cosmetics (cosmetics),
 * progress.wishlist, progress.lifetimeSparksSpent.
 *
 * API: window.BsSparksShop
 */
(function () {
  'use strict';

  // ── Callbacks (injected by flow.js) ──
  var _cb = {};
  var _config = null;
  var _activeTab = 'featured';
  var _previewItem = null;
  var _delegated = false;

  function progress() { return window.BsState ? window.BsState.progress : {}; }
  function sync() { if (window.BsState) window.BsState.sync(); }
  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // ── Catalog builders ──

  function getShopConfig() {
    return _config && _config.shop ? _config.shop : {};
  }

  function getAllConsumables() {
    if (!_config || !_config.crates || !_config.crates.dropPools) return [];
    var pools = _config.crates.dropPools;
    var items = [];
    var consumablePools = ['battle_charms', 'stamina_items', 'elemental_items', 'element_resist_charms'];
    for (var p = 0; p < consumablePools.length; p++) {
      var pool = pools[consumablePools[p]];
      if (!pool || !pool.items) continue;
      for (var i = 0; i < pool.items.length; i++) {
        items.push(pool.items[i]);
      }
    }
    return items;
  }

  function getAllCosmetics() {
    if (!_config || !_config.crates || !_config.crates.dropPools) return [];
    var pools = _config.crates.dropPools;
    var items = [];
    var cosmeticPools = ['card_frames', 'card_backs', 'name_plates', 'victory_animations'];
    for (var cp = 0; cp < cosmeticPools.length; cp++) {
      var pool = pools[cosmeticPools[cp]];
      if (!pool || !pool.items) continue;
      var slot = pool.slot;
      for (var i = 0; i < pool.items.length; i++) {
        items.push(Object.assign({}, pool.items[i], { slot: slot }));
      }
    }
    return items;
  }

  function getConsumablePrice(id) {
    var shop = getShopConfig();
    return (shop.consumablePrices && shop.consumablePrices[id]) || 0;
  }

  function getCosmeticPrice(id) {
    var shop = getShopConfig();
    return (shop.cosmeticPrices && shop.cosmeticPrices[id]) || 0;
  }

  function getOwnedConsumableCounts() {
    var charms = progress().charms || [];
    var counts = {};
    for (var i = 0; i < charms.length; i++) {
      counts[charms[i]] = (counts[charms[i]] || 0) + 1;
    }
    return counts;
  }

  function isWishlisted(id) {
    var wl = progress().wishlist || [];
    return wl.indexOf(id) !== -1;
  }

  function toggleWishlist(id) {
    var p = progress();
    if (!p.wishlist) p.wishlist = [];
    var idx = p.wishlist.indexOf(id);
    if (idx !== -1) {
      p.wishlist.splice(idx, 1);
    } else {
      if (p.wishlist.length >= 5) {
        if (_cb.toast) _cb.toast('Wish list is full (max 5 items)');
        return;
      }
      p.wishlist.push(id);
    }
    sync();
  }

  // ── Rarity helpers ──

  var RARITY_COLORS = {
    common: 'var(--bs-text-muted)',
    uncommon: '#4ade80',
    rare: '#60a5fa',
    epic: '#c084fc'
  };

  var RARITY_LABELS = {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    epic: 'Epic'
  };

  function rarityColor(r) { return RARITY_COLORS[r] || 'var(--bs-text-muted)'; }

  // ── Render ──

  function render() {
    var container = document.getElementById('bs-shop-content');
    if (!container) return;

    var sparks = _cb.getSparks ? _cb.getSparks() : 0;

    // Update sparks display in header
    var sparksEl = document.getElementById('bs-shop-sparks-count');
    if (sparksEl) sparksEl.textContent = sparks;

    // Update tab states
    document.querySelectorAll('.bs-shop__tab').forEach(function (tab) {
      var isActive = tab.dataset.tab === _activeTab;
      tab.classList.toggle('bs-shop__tab--active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    var html = '';

    if (_activeTab === 'featured') {
      html = renderFeatured(sparks);
    } else if (_activeTab === 'consumables') {
      html = renderConsumables(sparks);
    } else if (_activeTab === 'cosmetics') {
      html = renderCosmetics(sparks);
    }

    // Loyalty bar
    html += renderLoyaltyBar();

    container.innerHTML = html;
    bindContainerEvents(container);
  }

  // ── Featured tab ──

  function renderFeatured(sparks) {
    var shop = getShopConfig();
    var featuredIds = shop.featured || [];
    var allConsumables = getAllConsumables();
    var allCosmetics = getAllCosmetics();
    var lookup = {};
    allConsumables.forEach(function (c) { lookup[c.id] = Object.assign({}, c, { type: 'consumable' }); });
    allCosmetics.forEach(function (c) { lookup[c.id] = Object.assign({}, c, { type: 'cosmetic' }); });

    var html = '<div class="bs-shop__section-title"><i class="fas fa-star" aria-hidden="true"></i> Recommended</div>';
    html += '<div class="bs-shop__grid">';

    var counts = getOwnedConsumableCounts();
    var ownedCosmetics = progress().cosmetics || [];

    for (var i = 0; i < featuredIds.length; i++) {
      var item = lookup[featuredIds[i]];
      if (!item) continue;
      var price = item.type === 'consumable' ? getConsumablePrice(item.id) : getCosmeticPrice(item.id);
      var isOwned = item.type === 'cosmetic' && ownedCosmetics.indexOf(item.id) !== -1;
      var qty = item.type === 'consumable' ? (counts[item.id] || 0) : -1;
      html += renderItemCard(item, price, sparks, isOwned, qty);
    }

    // Ember Crate card
    html += renderEmberCrateCard(sparks);

    html += '</div>';
    return html;
  }

  // ── Consumables tab ──

  function renderConsumables(sparks) {
    var items = getAllConsumables();
    var counts = getOwnedConsumableCounts();

    var html = '<div class="bs-shop__section-title"><i class="fas fa-flask" aria-hidden="true"></i> Consumables</div>';
    html += '<p class="bs-shop__section-desc">Single-use items consumed in battle. Stock up before your next fight.</p>';
    html += '<div class="bs-shop__grid">';

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var price = getConsumablePrice(item.id);
      if (price <= 0) continue; // Skip items without a shop price
      var qty = counts[item.id] || 0;
      html += renderItemCard(item, price, sparks, false, qty);
    }

    html += '</div>';
    return html;
  }

  // ── Cosmetics tab ──

  function renderCosmetics(sparks) {
    var items = getAllCosmetics();
    var ownedCosmetics = progress().cosmetics || [];

    // Group by slot
    var groups = { frame: [], back: [], nameplate: [], victory: [] };
    for (var i = 0; i < items.length; i++) {
      var price = getCosmeticPrice(items[i].id);
      if (price <= 0) continue;
      var slot = items[i].slot || 'frame';
      if (groups[slot]) groups[slot].push(items[i]);
    }

    var slotLabels = {
      frame: { icon: 'fa-border-all', label: 'Frames' },
      back: { icon: 'fa-rectangle-wide', label: 'Card Backs' },
      nameplate: { icon: 'fa-tag', label: 'Nameplates' },
      victory: { icon: 'fa-burst', label: 'Victory Effects' }
    };

    var html = '';
    var slotOrder = ['frame', 'back', 'nameplate', 'victory'];
    for (var s = 0; s < slotOrder.length; s++) {
      var slot = slotOrder[s];
      var group = groups[slot];
      if (!group || group.length === 0) continue;
      var info = slotLabels[slot] || { icon: 'fa-gem', label: slot };
      html += '<div class="bs-shop__section-title"><i class="fas ' + info.icon + '" aria-hidden="true"></i> ' + info.label + '</div>';
      html += '<div class="bs-shop__grid">';
      for (var j = 0; j < group.length; j++) {
        var item = group[j];
        var price = getCosmeticPrice(item.id);
        var isOwned = ownedCosmetics.indexOf(item.id) !== -1;
        html += renderItemCard(item, price, sparks, isOwned, -1);
      }
      html += '</div>';
    }

    return html;
  }

  // ── Item card renderer ──

  function renderItemCard(item, price, sparks, isOwned, qty) {
    var canAfford = sparks >= price;
    var wishlisted = isWishlisted(item.id);
    var rc = rarityColor(item.rarity);
    var rl = RARITY_LABELS[item.rarity] || '';
    var isConsumable = qty >= 0;

    var html = '<div class="bs-shop-card' + (isOwned ? ' bs-shop-card--owned' : '') + '"'
      + ' style="--bs-shop-rarity: ' + rc + ';"'
      + ' data-item-id="' + escHtml(item.id) + '"'
      + ' data-item-type="' + (isConsumable ? 'consumable' : 'cosmetic') + '"'
      + ' data-item-price="' + price + '"'
      + ' role="button" tabindex="0" aria-label="' + escHtml(item.name) + ' - ' + price + ' Sparks">'
      + '<div class="bs-shop-card__icon"><i class="fas ' + (item.icon || 'fa-box') + '" aria-hidden="true"></i></div>'
      + '<div class="bs-shop-card__name">' + escHtml(item.name) + '</div>'
      + '<div class="bs-shop-card__rarity" style="color:' + rc + ';">' + rl + '</div>';

    if (item.description) {
      html += '<div class="bs-shop-card__desc">' + escHtml(item.description) + '</div>';
    }

    if (isOwned) {
      html += '<div class="bs-shop-card__owned"><i class="fas fa-check-circle"></i> Owned</div>';
    } else {
      html += '<div class="bs-shop-card__price' + (canAfford ? '' : ' bs-shop-card__price--cant') + '">'
        + '<i class="fas fa-fire" aria-hidden="true"></i> ' + price
        + '</div>';
    }

    if (isConsumable && qty > 0) {
      html += '<div class="bs-shop-card__qty">x' + qty + '</div>';
    }

    // Wishlist heart (only for items not owned)
    if (!isOwned) {
      html += '<button class="bs-shop-card__wish' + (wishlisted ? ' bs-shop-card__wish--active' : '') + '"'
        + ' data-wish-id="' + escHtml(item.id) + '"'
        + ' aria-label="' + (wishlisted ? 'Remove from' : 'Add to') + ' wish list">'
        + '<i class="' + (wishlisted ? 'fas' : 'far') + ' fa-heart"></i>'
        + '</button>';
    }

    html += '</div>';
    return html;
  }

  // ── Ember Crate card ──

  function renderEmberCrateCard(sparks) {
    var cost = getShopConfig().emberCrateCost || 50;
    var canAfford = sparks >= cost;

    return '<div class="bs-shop-card bs-shop-card--crate"'
      + ' data-item-id="ember_crate"'
      + ' data-item-type="crate"'
      + ' data-item-price="' + cost + '"'
      + ' role="button" tabindex="0" aria-label="Ember Crate - ' + cost + ' Sparks">'
      + '<div class="bs-shop-card__icon" style="color: #ff6b35;"><i class="fas fa-fire-flame-curved" aria-hidden="true"></i></div>'
      + '<div class="bs-shop-card__name">Ember Crate</div>'
      + '<div class="bs-shop-card__rarity" style="color: #ff6b35;">Loot Crate</div>'
      + '<div class="bs-shop-card__desc">Roll for random loot: stats, cosmetics, charms, and more.</div>'
      + '<div class="bs-shop-card__price' + (canAfford ? '' : ' bs-shop-card__price--cant') + '">'
      + '<i class="fas fa-fire" aria-hidden="true"></i> ' + cost
      + '</div>'
      + '</div>';
  }

  // ── Loyalty bar ──

  function renderLoyaltyBar() {
    var spent = progress().lifetimeSparksSpent || 0;
    var milestones = (getShopConfig().loyaltyMilestones || [250, 500, 1000, 2500, 5000]);
    var nextMilestone = milestones[milestones.length - 1];
    for (var i = 0; i < milestones.length; i++) {
      if (spent < milestones[i]) { nextMilestone = milestones[i]; break; }
    }
    var pct = Math.min(100, Math.round((spent / nextMilestone) * 100));

    var html = '<div class="bs-shop__loyalty">'
      + '<div class="bs-shop__loyalty-label">'
      + '<span><i class="fas fa-gem" aria-hidden="true"></i> Loyalty</span>'
      + '<span>' + spent + ' / ' + nextMilestone + ' Sparks spent</span>'
      + '</div>'
      + '<div class="bs-shop__loyalty-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">'
      + '<div class="bs-shop__loyalty-fill" style="width:' + pct + '%;"></div>'
      + '</div>'
      + '<div class="bs-shop__loyalty-milestones">';

    for (var m = 0; m < milestones.length; m++) {
      var reached = spent >= milestones[m];
      html += '<span class="bs-shop__milestone' + (reached ? ' bs-shop__milestone--reached' : '') + '">'
        + (reached ? '<i class="fas fa-check-circle"></i> ' : '')
        + milestones[m]
        + '</span>';
    }

    html += '</div><div class="bs-shop__loyalty-hint">Rewards coming soon</div></div>';
    return html;
  }

  // ── Purchase flow ──

  function showPreview(itemId, itemType, price) {
    var overlay = document.getElementById('bs-shop-preview');
    if (!overlay) return;

    var item = findItem(itemId, itemType);
    if (!item) return;

    var sparks = _cb.getSparks ? _cb.getSparks() : 0;
    var canAfford = sparks >= price;
    var isOwned = itemType === 'cosmetic' && (progress().cosmetics || []).indexOf(itemId) !== -1;
    var rc = rarityColor(item.rarity || 'common');

    var html = '<div class="bs-shop-preview__card">'
      + '<button class="bs-shop-preview__close" id="bs-shop-preview-close" aria-label="Close"><i class="fas fa-times"></i></button>'
      + '<div class="bs-shop-preview__icon" style="color:' + rc + ';"><i class="fas ' + (item.icon || 'fa-box') + '"></i></div>'
      + '<div class="bs-shop-preview__name">' + escHtml(item.name) + '</div>'
      + '<div class="bs-shop-preview__rarity" style="color:' + rc + ';">' + (RARITY_LABELS[item.rarity] || '') + '</div>'
      + '<div class="bs-shop-preview__desc">' + escHtml(item.description || (itemType === 'crate' ? 'Roll for random loot: stats, cosmetics, charms, and more.' : '')) + '</div>';

    if (isOwned) {
      html += '<div class="bs-shop-preview__owned"><i class="fas fa-check-circle"></i> Already Owned</div>';
    } else {
      html += '<button class="bs-shop-preview__buy' + (canAfford ? '' : ' bs-shop-preview__buy--disabled') + '"'
        + ' id="bs-shop-preview-buy"'
        + ' data-buy-id="' + escHtml(itemId) + '"'
        + ' data-buy-type="' + escHtml(itemType) + '"'
        + ' data-buy-price="' + price + '"'
        + (canAfford ? '' : ' disabled')
        + '>'
        + '<i class="fas fa-fire"></i> Buy for ' + price + ' Sparks'
        + '</button>';
      if (!canAfford) {
        html += '<div class="bs-shop-preview__need">Need ' + (price - sparks) + ' more Sparks</div>';
      }
    }

    html += '<button class="bs-shop-preview__cancel" id="bs-shop-preview-cancel">Cancel</button>'
      + '</div>';

    overlay.innerHTML = html;
    overlay.classList.remove('bs-overlay--hidden');

    // Bind close/cancel/buy
    document.getElementById('bs-shop-preview-close').addEventListener('click', hidePreview);
    document.getElementById('bs-shop-preview-cancel').addEventListener('click', hidePreview);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hidePreview(); });

    var buyBtn = document.getElementById('bs-shop-preview-buy');
    if (buyBtn) {
      buyBtn.addEventListener('click', function () {
        executePurchase(itemId, itemType, price);
      });
    }
  }

  function hidePreview() {
    var overlay = document.getElementById('bs-shop-preview');
    if (overlay) overlay.classList.add('bs-overlay--hidden');
  }

  function executePurchase(itemId, itemType, price) {
    var sparks = _cb.getSparks ? _cb.getSparks() : 0;
    if (sparks < price) {
      if (_cb.toast) _cb.toast('Not enough Sparks!');
      return;
    }

    if (_cb.spendSparks) _cb.spendSparks(price);

    // Track lifetime spending
    var p = progress();
    p.lifetimeSparksSpent = (p.lifetimeSparksSpent || 0) + price;

    if (itemType === 'crate') {
      if (_cb.awardCrate) _cb.awardCrate('ember');
      if (_cb.toast) _cb.toast('Ember Crate opened!');
    } else if (itemType === 'consumable') {
      if (!p.charms) p.charms = [];
      p.charms.push(itemId);
      var itemDef = findItem(itemId, itemType);
      if (_cb.toast) _cb.toast((itemDef ? itemDef.name : 'Item') + ' purchased!');
    } else if (itemType === 'cosmetic') {
      if (!p.cosmetics) p.cosmetics = [];
      if (p.cosmetics.indexOf(itemId) === -1) {
        p.cosmetics.push(itemId);
      }
      if (!p.purchasedCosmetics) p.purchasedCosmetics = [];
      if (p.purchasedCosmetics.indexOf(itemId) === -1) {
        p.purchasedCosmetics.push(itemId);
      }
      var cosmeticDef = findItem(itemId, itemType);
      if (_cb.toast) _cb.toast((cosmeticDef ? cosmeticDef.name : 'Cosmetic') + ' unlocked!');
    }

    sync();
    hidePreview();
    render();

    // Update lobby sparks HUD
    var hudSparks = document.querySelector('.bs-hud-sparks');
    if (hudSparks) hudSparks.innerHTML = '<i class="fas fa-fire"></i> ' + (_cb.getSparks ? _cb.getSparks() : 0) + ' sparks';
  }

  function findItem(itemId, itemType) {
    if (itemType === 'consumable') {
      var consumables = getAllConsumables();
      for (var i = 0; i < consumables.length; i++) {
        if (consumables[i].id === itemId) return consumables[i];
      }
    } else if (itemType === 'cosmetic') {
      var cosmetics = getAllCosmetics();
      for (var j = 0; j < cosmetics.length; j++) {
        if (cosmetics[j].id === itemId) return cosmetics[j];
      }
    }
    return null;
  }

  // ── Event delegation ──

  function bindContainerEvents(container) {
    if (_delegated) return;
    _delegated = true;

    container.addEventListener('click', function (e) {
      // Wishlist toggle
      var wishBtn = e.target.closest('.bs-shop-card__wish');
      if (wishBtn) {
        e.stopPropagation();
        var wishId = wishBtn.dataset.wishId;
        if (wishId) {
          toggleWishlist(wishId);
          render();
        }
        return;
      }

      // Item card click → preview
      var card = e.target.closest('.bs-shop-card');
      if (card) {
        var itemId = card.dataset.itemId;
        var itemType = card.dataset.itemType;
        var price = parseInt(card.dataset.itemPrice, 10) || 0;
        if (itemId && price > 0) {
          showPreview(itemId, itemType, price);
        }
        return;
      }
    });
  }

  // ── Tab switching ──

  function setTab(tab) {
    _activeTab = tab;
    render();
  }

  // ── Public API ──

  window.BsSparksShop = {
    render: render,
    setTab: setTab,
    setCallbacks: function (cbs) { _cb = cbs || {}; },
    setConfig: function (cfg) { _config = cfg; }
  };
})();
