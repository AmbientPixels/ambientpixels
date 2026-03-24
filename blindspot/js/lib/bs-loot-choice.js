/**
 * bs-loot-choice.js — Loot pick-one-of-three overlay + apply loot
 * Extracted from blindspot-flow.js (Round 7)
 *
 * API: window.BsLootChoice
 *   .show(options)      — render 3 loot cards, let player pick one
 *   .setCallbacks(cbs)  — inject cross-cutting deps
 */
(function () {
  'use strict';

  var _cb = {};

  var RARITY_COLORS = {
    common: 'var(--bs-text-muted)',
    uncommon: 'var(--bs-accent)',
    rare: '#7b2fff',
    epic: '#ff5252'
  };

  var STAT_NAMES = { str: 'Strength', agi: 'Agility', int: 'Intelligence', end: 'Endurance', lck: 'Luck' };
  var STAT_ICONS = { str: 'fa-hand-fist', agi: 'fa-feather-pointed', int: 'fa-bolt', end: 'fa-heart', lck: 'fa-clover' };

  function escHtml(s) { return window.BsUtils && window.BsUtils.escapeHtml ? window.BsUtils.escapeHtml(String(s)) : String(s); }

  function show(options) {
    var container = document.getElementById('bs-loot-options');
    if (!container) {
      // Fallback: auto-apply first option
      if (_cb.applyLootDrop) _cb.applyLootDrop(options[0]);
      if (_cb.showRewardDrop) _cb.showRewardDrop(options[0], 'Victory Reward');
      return;
    }

    container.innerHTML = options.map(function (loot, i) {
      var color = RARITY_COLORS[loot.rarity] || 'var(--bs-accent)';
      var icon = loot.stat ? (STAT_ICONS[loot.stat] || 'fa-gem') : 'fa-gem';
      var statLabel = loot.stat ? (STAT_NAMES[loot.stat] || loot.stat.toUpperCase()) : '';
      var rarityLabel = loot.rarity ? loot.rarity.charAt(0).toUpperCase() + loot.rarity.slice(1) : '';
      return '<button class="bs-loot-card" data-loot-idx="' + i + '" style="border-color:' + color + ';">' +
        '<span class="bs-loot-card__rarity" style="color:' + color + ';">' + rarityLabel + '</span>' +
        '<i class="fas ' + icon + '" style="color:' + color + '; font-size:1.5rem;"></i>' +
        '<span class="bs-loot-card__label">' + escHtml(loot.label) + '</span>' +
        '<span class="bs-loot-card__stat">' + escHtml(statLabel) + '</span>' +
        '</button>';
    }).join('');

    // Show sparks earned
    var sparksLine = document.getElementById('bs-loot-sparks');
    var sparks = _cb.getSparks ? _cb.getSparks() : 0;
    if (sparksLine) sparksLine.innerHTML = '<i class="fas fa-fire"></i> +' + (sparks > 0 ? 'Sparks earned! Total: ' + sparks : '0') + '';

    if (_cb.showOverlay) _cb.showOverlay('bs-loot-choice');
    if (_cb.playSfx) _cb.playSfx('loot');

    container.querySelectorAll('.bs-loot-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.lootIdx, 10);
        var chosen = options[idx];
        if (_cb.hideOverlay) _cb.hideOverlay('bs-loot-choice');
        if (_cb.applyLootDrop) _cb.applyLootDrop(chosen);
        if (_cb.showRewardDrop) _cb.showRewardDrop(chosen, 'Victory Reward');

        // Show forge trigger AFTER loot is picked (not during)
        var pendingForge = _cb.getPendingForge ? _cb.getPendingForge() : false;
        if (pendingForge) {
          if (_cb.setPendingForge) _cb.setPendingForge(false);
          setTimeout(function () {
            var resultsOv = document.getElementById('arena-results-overlay');
            if (resultsOv) resultsOv.style.display = 'none';
            if (_cb.showOverlay) _cb.showOverlay('bs-forge-trigger');
          }, 1500);
        }
      }, { once: true });
    });
  }

  function setCallbacks(cbs) { _cb = cbs; }

  window.BsLootChoice = {
    show: show,
    setCallbacks: setCallbacks
  };
})();
