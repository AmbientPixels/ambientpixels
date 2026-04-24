/* style-codex.js — parchment + ink tome style.
 * Per redesign-handoff.md §7.1 + dir10-obsidian-cards.jsx CardCodex.
 * Font: Cinzel caps (name + stats). Hard-offset shadow (0.3 opacity per JSX
 * audit 0.6 conflict table — NOT 0.9 as in prose spec). Sepia portrait filter.
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
      return '<div class="codex-stat">' +
               '<div class="codex-stat-label">' + k + '</div>' +
               '<div class="codex-stat-value">' + v + '</div>' +
             '</div>';
    }).join('');

    var html = '' +
      '<div class="codex-outer">' +
        '<div class="codex-header">' +
          '<div class="codex-name">' + esc(name).toUpperCase() + '</div>' +
          '<div class="codex-number">№ 047</div>' +
        '</div>' +
        '<div class="codex-portrait-wrap">' +
          '<div class="codex-portrait"></div>' +
        '</div>' +
        '<div class="codex-class">' + esc(className) + ' · Level XII</div>' +
        '<div class="codex-stats">' + statsHtml + '</div>' +
      '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    var portraitSlot = temp.querySelector('.codex-portrait');
    var frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    return { frag: frag, portraitSlot: portraitSlot };
  }

  window.ForgeStyleCodex = {
    id: 'codex',
    name: 'Codex',
    byline: 'parchment · ink · scribed',
    voice: 'Tome-page. Cinzel caps, ink-stamp rarity, dotted-line stats.',
    build: build
  };
})();
