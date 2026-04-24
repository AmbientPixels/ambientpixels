/* style-arcade.js — TCG-foil card style.
 * Per redesign-handoff.md §7.1 + dir10-obsidian-cards.jsx CardArcadeN10.
 * Per-character accent color on frame + glow. Background is a STATIC gradient
 * (per JSX audit 0.6 conflict table — NOT color-mix expressions). Rarity pips,
 * ability line, stat badges. Font: Space Grotesk + Cinzel (name) + JetBrains Mono.
 */
(function () {
  'use strict';

  var STAT_KEYS = ['STR', 'AGI', 'INT', 'END', 'LCK'];
  var RARITY_PIP_COUNT = { 'Common': 1, 'Rare': 2, 'Epic': 3, 'Legendary': 4, 'Mythic': 5 };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function build(state) {
    var char = (window.ForgePortrait && window.ForgePortrait.get(state.portraitId))
              || (window.ForgePortrait && window.ForgePortrait.CHARACTERS && window.ForgePortrait.CHARACTERS[5])
              || { name: 'Captain Nova', class: 'Legendary Hero', accent: '#38bdf8' };
    var stats = state.stats || {};
    var name = (state.name && state.name.trim()) || char.name || 'Unknown';
    var className = state.classLabel || char.class || '';
    var rarity = state.rarity || char.rarity || 'Rare';
    var accent = char.accent || '#4fd1c5';

    // 5 rarity pips — filled matches current rarity tier
    var filledCount = RARITY_PIP_COUNT[rarity] || 2;
    var pips = '';
    for (var i = 0; i < 5; i++) {
      pips += '<span class="arcade-pip' + (i < filledCount ? ' is-filled' : '') + '"></span>';
    }

    var statsHtml = STAT_KEYS.map(function (k) {
      var v = Math.max(0, Math.min(100, Number(stats[k]) || 0));
      return '<div class="arcade-stat-badge">' +
               '<span class="arcade-stat-label">' + k + '</span>' +
               '<span class="arcade-stat-value">' + v + '</span>' +
             '</div>';
    }).join('');

    // Synthesize an ability line (Phase 5 placeholder — Phase 5 Lore stage feeds abilityLine later).
    var ability = state.abilityLine && state.abilityLine.trim()
      ? state.abilityLine
      : 'When played, gain +2 morale and draw a card.';

    var html = '' +
      '<div class="arcade-outer" style="--accent: ' + esc(accent) + ';">' +
        '<div class="arcade-header">' +
          '<div class="arcade-name">' + esc(name).toUpperCase() + '</div>' +
          '<div class="arcade-pips">' + pips + '</div>' +
        '</div>' +
        '<div class="arcade-portrait-wrap">' +
          '<div class="arcade-portrait"></div>' +
          '<div class="arcade-atk-def">ATK 92 / DEF 77</div>' +
        '</div>' +
        '<div class="arcade-ability">' + esc(className) + ' · ' + esc(ability) + '</div>' +
        '<div class="arcade-footer">' +
          '<div class="arcade-footer-icons">' +
            '<i class="fa-solid fa-bolt"></i>' +
            '<i class="fa-solid fa-shield-halved"></i>' +
            '<i class="fa-solid fa-fire"></i>' +
          '</div>' +
          '<div class="arcade-rarity">◆ ' + esc(rarity).toUpperCase() + ' ◆</div>' +
        '</div>' +
        '<div class="arcade-stats">' + statsHtml + '</div>' +
      '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    var portraitSlot = temp.querySelector('.arcade-portrait');
    var frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    return { frag: frag, portraitSlot: portraitSlot };
  }

  window.ForgeStyleArcade = {
    id: 'arcade',
    name: 'Arcade',
    byline: 'foil frame · TCG stats',
    voice: 'Game-card energy. Rarity pips, ability line, foil gradient.',
    build: build
  };
})();
