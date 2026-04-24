/* style-ember.js — obsidian-native default card style.
 * Per redesign-handoff.md §7.1 + dir10-obsidian-cards.jsx CardEmber.
 * DOM: portrait-wrap (with gradient vignette + rarity pill + name overlay)
 *      → stat strip (5 cells, flex). Font: Unbounded (name) + JetBrains Mono.
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
      return '<div class="ember-stat">' +
               '<div class="ember-stat-label">' + k + '</div>' +
               '<div class="ember-stat-value">' + v + '</div>' +
             '</div>';
    }).join('');

    var html = '' +
      '<div class="ember-outer">' +
        '<div class="ember-portrait-wrap">' +
          '<div class="ember-portrait"></div>' + // slot for SVG
          '<div class="ember-portrait-fade"></div>' +
          '<div class="ember-rarity-pill">' + esc(rarity).toUpperCase() + '</div>' +
          '<div class="ember-overlay">' +
            '<div class="ember-class">' + esc(className).toUpperCase() + '</div>' +
            '<div class="ember-name">' + esc(name).toUpperCase() + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ember-stats">' + statsHtml + '</div>' +
      '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    var portraitSlot = temp.querySelector('.ember-portrait');
    var frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    return { frag: frag, portraitSlot: portraitSlot };
  }

  window.ForgeStyleEmber = {
    id: 'ember',
    name: 'Ember',
    byline: 'dark · glow · industrial',
    voice: 'Obsidian-native. Rim glow, ember accents, mono readout of stats.',
    build: build
  };
})();
