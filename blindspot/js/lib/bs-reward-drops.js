/* ============================================================
   bs-reward-drops.js — Loot rolls + boss reward drop animation
   IIFE → window.BsRewardDrops
   ============================================================ */
(function () {
  'use strict';

  var LOOT_TABLE = (window.BsConst || {}).LOOT_TABLE || [];

  var _cb = {};

  function setCallbacks(obj) { _cb = obj || {}; }

  function rollLoot() {
    var totalWeight = 0;
    for (var i = 0; i < LOOT_TABLE.length; i++) totalWeight += LOOT_TABLE[i].weight;
    var roll = Math.random() * totalWeight;
    for (var j = 0; j < LOOT_TABLE.length; j++) {
      roll -= LOOT_TABLE[j].weight;
      if (roll <= 0) return LOOT_TABLE[j];
    }
    return LOOT_TABLE[0];
  }

  function applyLootDrop(loot) {
    var card = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
    if (!card || !card.combatStats || loot.type !== 'stat_shard') return Promise.resolve();

    var oldVal = card.combatStats[loot.stat] || 0;
    card.combatStats[loot.stat] = Math.min(100, oldVal + loot.amount);

    // Save with retry — revert on failure to prevent drift
    var cardToSave = {};
    for (var k in card) { if (card.hasOwnProperty(k)) cardToSave[k] = card[k]; }
    cardToSave.stats = [
      { name: 'Strength', value: cardToSave.combatStats.str },
      { name: 'Agility', value: cardToSave.combatStats.agi },
      { name: 'Intelligence', value: cardToSave.combatStats.int },
      { name: 'Endurance', value: cardToSave.combatStats.end },
      { name: 'Luck', value: cardToSave.combatStats.lck }
    ];
    var url = window.buildApiPath('saveCard');
    var headers = { 'Content-Type': 'application/json' };

    return window.ArenaAPI.getPrincipalHeader().then(function (authHeaders) {
      for (var h in authHeaders) { if (authHeaders.hasOwnProperty(h)) headers[h] = authHeaders[h]; }
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta && csrfMeta.content) headers['X-CSRF-Token'] = csrfMeta.content;
      return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(cardToSave) });
    }).then(function (resp) {
      if (!resp.ok) throw new Error('Save failed');
    }).catch(function (e) {
      // Revert stat change on save failure
      card.combatStats[loot.stat] = oldVal;
      console.warn('[Blindspot] Loot save failed, reverted:', e);
    });
  }

  function showRewardDrop(reward, source) {
    var existing = document.querySelector('.bs-reward-drop');
    if (existing) existing.remove();

    var escHtml = _cb.escHtml || function (s) { return String(s); };

    var rarityColors = {
      common: 'var(--bs-text-muted)',
      uncommon: 'var(--bs-accent)',
      rare: '#7b2fff',
      epic: '#ff5252'
    };

    var iconMap = {
      stat_shard: 'fa-gem',
      stat_bonus: 'fa-arrow-up',
      title: 'fa-crown',
      forge_bonus: 'fa-fire'
    };

    var color = rarityColors[reward.rarity] || 'var(--bs-accent)';
    var rarityLabel = reward.rarity ? reward.rarity.charAt(0).toUpperCase() + reward.rarity.slice(1) : '';

    var drop = document.createElement('div');
    drop.className = 'bs-reward-drop';
    drop.innerHTML =
      '<div class="bs-reward-drop__content" style="border-color:' + color + ';">'
      + '<div class="bs-reward-drop__icon" style="color:' + color + ';"><i class="fas ' + (iconMap[reward.type] || 'fa-gift') + '"></i></div>'
      + '<div class="bs-reward-drop__text">'
      + '<span class="bs-reward-drop__title" style="color:' + color + ';">' + rarityLabel + ' Drop</span>'
      + '<span class="bs-reward-drop__label">' + escHtml(reward.label) + '</span>'
      + (source ? '<span class="bs-reward-drop__from">' + escHtml(typeof source === 'string' ? source : source.name) + '</span>' : '')
      + '</div></div>';
    document.body.appendChild(drop);

    requestAnimationFrame(function () { drop.classList.add('bs-reward-drop--visible'); });

    setTimeout(function () {
      drop.classList.remove('bs-reward-drop--visible');
      setTimeout(function () { drop.remove(); }, 500);
    }, 4000);
  }

  window.BsRewardDrops = {
    setCallbacks: setCallbacks,
    rollLoot: rollLoot,
    applyLootDrop: applyLootDrop,
    showRewardDrop: showRewardDrop
  };
})();
