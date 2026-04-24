/* style-press.js — risograph red press card style.
 * Per redesign-handoff.md §7.1 + dir10-obsidian-cards.jsx CardPress.
 * Font: Archivo Black (name). Rarity chip #ffe000 per JSX audit 0.6 conflict
 * table (NOT #ffd500 as in prose). Name ends with a trailing period per JSX.
 * Portrait uses mix-blend-mode: multiply against the red.
 */
(function () {
  'use strict';

  var STAT_KEYS = ['STR', 'AGI', 'INT', 'END', 'LCK'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function build(state) {
    var char = (window.ForgePortrait && window.ForgePortrait.get(state.portraitId))
              || (window.ForgePortrait && window.ForgePortrait.CHARACTERS && window.ForgePortrait.CHARACTERS[5])
              || { name: 'Captain Nova', class: 'Legendary Hero' };
    var stats = state.stats || {};
    var name = (state.name && state.name.trim()) || char.name || 'Unknown';
    var className = state.classLabel || char.class || '';
    var rarity = state.rarity || char.rarity || 'Rare';

    var statsHtml = STAT_KEYS.map(function (k) {
      var v = Math.max(0, Math.min(100, Number(stats[k]) || 0));
      return '<div class="press-stat">' +
               '<div class="press-stat-label">' + k + '</div>' +
               '<div class="press-stat-value">' + v + '</div>' +
             '</div>';
    }).join('');

    var html = '' +
      '<div class="press-outer">' +
        '<div class="press-portrait-wrap">' +
          '<div class="press-portrait"></div>' +
          '<div class="press-chip-row">' +
            '<span class="press-rarity-chip">' + esc(rarity).toUpperCase() + '</span>' +
            '<span class="press-number-chip">047</span>' +
          '</div>' +
        '</div>' +
        '<div class="press-footer">' +
          '<div class="press-class">' + esc(className).toUpperCase() + '</div>' +
          '<div class="press-name">' + esc(name).toUpperCase() + '.</div>' +
          '<div class="press-stats">' + statsHtml + '</div>' +
        '</div>' +
      '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    var portraitSlot = temp.querySelector('.press-portrait');
    var frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    return { frag: frag, portraitSlot: portraitSlot };
  }

  window.ForgeStylePress = {
    id: 'press',
    name: 'Press',
    byline: 'archivo black · risograph',
    voice: 'Poster energy. Flat color, massive display, hard shadow.',
    build: build
  };
})();
