/**
 * Blindspot Crates — Inventory, Loot Roll, Opening Ceremony
 *
 * Manages crate earning, opening animation, loot rolling.
 * Calls back into game systems via injected callbacks for cross-cutting concerns.
 *
 * API: window.BsCrates
 */
window.BsCrates = (function () {
  'use strict';

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function progress() { return window.BsState ? window.BsState.progress : {}; }
  function sync() { if (window.BsState) window.BsState.sync(); }
  function sfx(name) { if (window.BsSfx) window.BsSfx.play(name); }
  function toast(msg) { if (window.BsToast) window.BsToast.success(msg); }

  var _C = window.BsConst || {};
  var CRATE_RARITY_COLORS = _C.CRATE_RARITY_COLORS || {};

  // Injected callbacks — set by monolith after load
  var _callbacks = {};

  // ── Inventory ──

  function getCrates() { return progress().crates || []; }
  function addCrate(type) {
    var p = progress();
    if (!p.crates) p.crates = [];
    p.crates.push({ type: type, earned: Date.now() });
    return p.crates.length;
  }
  function removeCrate(index) {
    var crates = progress().crates;
    if (crates && index >= 0 && index < crates.length) crates.splice(index, 1);
  }
  function getCrateCount() { return (progress().crates || []).length; }

  function getCrateWinCounter() { return progress().crateWinCounter || 0; }
  function incCrateWinCounter() {
    var p = progress();
    p.crateWinCounter = (p.crateWinCounter || 0) + 1;
    return p.crateWinCounter;
  }

  function awardCrate(type, config) {
    var crateTypes = config && config.crates && config.crates.types;
    var crateDef = crateTypes ? crateTypes[type] : null;
    var name = crateDef ? crateDef.name : (type + ' Crate');
    addCrate(type);
    toast('Crate earned: ' + name + '!');
    sfx('loot');
    updateCrateBadge();
  }

  function checkBattleCrate(config) {
    var count = incCrateWinCounter();
    if (count >= 5) {
      progress().crateWinCounter = 0;
      awardCrate('battle', config);
    }
  }

  function updateCrateBadge() {
    var indicator = document.getElementById('bs-crate-indicator');
    var badge = document.getElementById('bs-crate-badge');
    var plural = document.getElementById('bs-crate-plural');
    var count = getCrateCount();
    if (indicator) indicator.style.display = count > 0 ? '' : 'none';
    if (badge) badge.textContent = String(count);
    if (plural) plural.textContent = count === 1 ? '' : 's';
    if (_callbacks.updateSparksShop) _callbacks.updateSparksShop();
  }

  // ── Loot Rolling ──

  function weightedRandom(weights) {
    var total = 0; for (var k in weights) total += weights[k];
    var roll = Math.random() * total;
    for (var k in weights) { roll -= weights[k]; if (roll <= 0) return k; }
    return Object.keys(weights)[0];
  }

  function rollCrateLoot(crateType, config) {
    var crateDef = config && config.crates && config.crates.types[crateType];
    if (!crateDef) return { id: 'fallback', name: '10 Sparks', rarity: 'common', icon: 'fa-fire', category: 'currency', amount: 10 };
    var table = config.crates.lootTables[crateDef.lootTable];
    if (!table) return { id: 'fallback', name: '10 Sparks', rarity: 'common', icon: 'fa-fire', category: 'currency', amount: 10 };
    var rarity = weightedRandom(table.rarityWeights);
    var eligible = [];
    (table.pools || []).forEach(function(poolName) {
      var pool = config.crates.dropPools[poolName];
      if (!pool) return;
      (pool.items || []).forEach(function(item) {
        if (item.rarity === rarity) eligible.push(Object.assign({ category: pool.category, slot: pool.slot }, item));
      });
    });
    if (eligible.length === 0) return { id: 'fallback_' + rarity, name: '10 Sparks', rarity: rarity, icon: 'fa-fire', category: 'currency', amount: 10 };
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  function getRandomReelItems(count, config) {
    var allItems = [];
    if (config && config.crates && config.crates.dropPools) {
      for (var poolName in config.crates.dropPools) {
        var pool = config.crates.dropPools[poolName];
        (pool.items || []).forEach(function(item) { allItems.push(item); });
      }
    }
    if (allItems.length === 0) return [];
    var result = [];
    for (var i = 0; i < count; i++) result.push(allItems[Math.floor(Math.random() * allItems.length)]);
    return result;
  }

  // ── Opening Ceremony ──

  function openCrateOverlay(crateIndex, config) {
    if (document.querySelector('.bs-crate-overlay')) return;
    var crates = getCrates();
    if (crateIndex < 0 || crateIndex >= crates.length) return;
    var crate = crates[crateIndex];
    var crateDef = config && config.crates && config.crates.types[crate.type];
    if (!crateDef) crateDef = { name: 'Crate', icon: 'fa-box', color: 'var(--bs-accent)' };

    var wonItem = rollCrateLoot(crate.type, config);
    var reelItems = getRandomReelItems(18, config);
    reelItems.splice(14, 0, wonItem);

    var _phase = 'ready';
    var overlay = document.createElement('div');
    overlay.className = 'bs-crate-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Opening ' + crateDef.name);

    var rarityColor = CRATE_RARITY_COLORS[wonItem.rarity] || 'var(--bs-text)';

    overlay.innerHTML = '<div class="bs-crate-stage">'
      + '<div class="bs-crate-box" id="bs-crate-box" role="button" aria-label="Tap to open" tabindex="0">'
      + '<i class="fas ' + escHtml(crateDef.icon) + '" style="color:' + crateDef.color + ';"></i>'
      + '</div>'
      + '<p class="bs-crate-prompt" id="bs-crate-prompt" style="font-family:\'Cinzel\',serif; color:var(--bs-text-muted); font-size:0.85rem; margin-top:1rem;">' + escHtml(crateDef.name) + '</p>'
      + '<p class="bs-crate-tap" id="bs-crate-tap" style="font-size:0.7rem; color:var(--bs-accent-dim); margin-top:0.5rem;">Tap to open</p>'
      + '<div class="bs-crate-reel" id="bs-crate-reel" style="display:none;">'
      + '<div class="bs-crate-strip" id="bs-crate-strip">'
      + reelItems.map(function(item) {
          var rc = CRATE_RARITY_COLORS[item.rarity] || 'var(--bs-text)';
          return '<div class="bs-crate-tile" style="border-color:' + rc + ';">'
            + '<i class="fas ' + escHtml(item.icon || 'fa-gift') + '" style="color:' + rc + ';"></i>'
            + '<span>' + escHtml(item.name || '???') + '</span>'
            + '</div>';
        }).join('')
      + '</div>'
      + '<div class="bs-crate-reel-pointer"></div>'
      + '</div>'
      + '<div class="bs-crate-reveal" id="bs-crate-reveal" style="display:none;">'
      + '<div class="bs-crate-reveal__glow" style="background:' + rarityColor + ';"></div>'
      + '<i class="fas ' + escHtml(wonItem.icon || 'fa-gift') + '" style="font-size:2.5rem; color:' + rarityColor + '; position:relative;"></i>'
      + '<h3 style="font-family:\'Cinzel\',serif; color:var(--bs-text); margin:0.75rem 0 0.25rem; font-size:1rem;">' + escHtml(wonItem.name) + '</h3>'
      + (wonItem.description ? '<p style="font-size:0.7rem; color:var(--bs-text-muted); margin:0 0 0.5rem;">' + escHtml(wonItem.description) + '</p>' : '')
      + '<span class="bs-rarity-badge bs-rarity-badge--' + wonItem.rarity + '" style="margin-bottom:1rem;"><i class="fas fa-circle" style="font-size:0.4rem;"></i> ' + wonItem.rarity.charAt(0).toUpperCase() + wonItem.rarity.slice(1) + '</span>'
      + '<button class="bs-btn bs-btn--primary" id="bs-crate-collect" style="padding:0.6rem 2rem; font-size:0.85rem;"><i class="fas fa-check"></i> Collect</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('bs-crate-overlay--visible'); });

    var boxEl = document.getElementById('bs-crate-box');
    var tapEl = document.getElementById('bs-crate-tap');
    var promptEl = document.getElementById('bs-crate-prompt');
    var reelEl = document.getElementById('bs-crate-reel');
    var stripEl = document.getElementById('bs-crate-strip');
    var revealEl = document.getElementById('bs-crate-reveal');
    var collectBtn = document.getElementById('bs-crate-collect');

    function startOpening() {
      if (_phase !== 'ready') return;
      _phase = 'shaking';
      if (tapEl) tapEl.style.display = 'none';
      if (promptEl) promptEl.textContent = 'Opening...';
      boxEl.classList.add('bs-crate-box--shaking');

      setTimeout(function() {
        _phase = 'spinning';
        boxEl.style.display = 'none';
        if (promptEl) promptEl.style.display = 'none';
        if (reelEl) reelEl.style.display = '';
        sfx('crateRatchet');
        requestAnimationFrame(function() {
          if (stripEl) stripEl.style.transform = 'translateX(-' + (14 * 90 - 130) + 'px)';
        });

        setTimeout(function() {
          _phase = 'revealed';
          sfx('crateReveal');
          if (reelEl) reelEl.style.display = 'none';
          if (revealEl) { revealEl.style.display = ''; revealEl.classList.add('bs-crate-reveal--active'); }
        }, 2800);
      }, 1000);
    }

    if (boxEl) {
      boxEl.addEventListener('click', startOpening, { once: true });
      boxEl.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') startOpening(); }, { once: true });
    }

    if (collectBtn) collectBtn.addEventListener('click', function() {
      removeCrate(crateIndex);
      if (_callbacks.applyCrateLoot) _callbacks.applyCrateLoot(wonItem);
      updateCrateBadge();
      sync();
      toast(wonItem.name + ' added!');
      overlay.classList.remove('bs-crate-overlay--visible');
      setTimeout(function() { overlay.remove(); if (_callbacks.renderLobby) _callbacks.renderLobby(); }, 300);
    }, { once: true });
  }

  // ── Public API ──

  return {
    getCrates: getCrates,
    addCrate: addCrate,
    removeCrate: removeCrate,
    getCrateCount: getCrateCount,
    getCrateWinCounter: getCrateWinCounter,
    incCrateWinCounter: incCrateWinCounter,
    awardCrate: awardCrate,
    checkBattleCrate: checkBattleCrate,
    updateBadge: updateCrateBadge,
    rollLoot: rollCrateLoot,
    openOverlay: openCrateOverlay,
    setCallbacks: function (cbs) { _callbacks = cbs; }
  };
})();
