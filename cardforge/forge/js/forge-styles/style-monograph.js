/* style-monograph.js — cream-paper editorial card style.
 * Per redesign-handoff.md §7.1 + dir10-obsidian-cards.jsx CardMono.
 * Font: Fraunces (name + values) + Space Grotesk (class label). Number badge on portrait.
 * No shadow beyond the neutral drop — editorial restraint.
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

    var statsHtml = STAT_KEYS.map(function (k) {
      var v = Math.max(0, Math.min(100, Number(stats[k]) || 0));
      return '<div class="mono-stat">' +
               '<div class="mono-stat-label">' + k + '</div>' +
               '<div class="mono-stat-value">' + v + '</div>' +
             '</div>';
    }).join('');

    var html = '' +
      '<div class="mono-outer">' +
        '<div class="mono-portrait-wrap">' +
          '<div class="mono-portrait"></div>' +
          '<div class="mono-number">№ 047</div>' +
        '</div>' +
        '<div class="mono-meta">' +
          '<div class="mono-class">' + esc(className).toUpperCase() + '</div>' +
          '<div class="mono-name">' + esc(name) + '</div>' +
          '<div class="mono-divider"></div>' +
          '<div class="mono-stats">' + statsHtml + '</div>' +
        '</div>' +
      '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    var portraitSlot = temp.querySelector('.mono-portrait');
    var frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    return { frag: frag, portraitSlot: portraitSlot };
  }

  window.ForgeStyleMonograph = {
    id: 'monograph',
    name: 'Monograph',
    byline: 'serif · calm · editorial',
    voice: 'Treats the hero like a profile piece. Serif display, cream paper, pull quote.',
    build: build
  };
})();
