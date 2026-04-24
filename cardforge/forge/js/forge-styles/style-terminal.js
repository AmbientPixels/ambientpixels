/* style-terminal.js — ASCII / YAML terminal card style.
 * Per redesign-handoff.md §7.1 + dir10-obsidian-cards.jsx CardTerminal.
 * Font: JetBrains Mono throughout. Portrait uses `grayscale(0.5) contrast(1.1)`
 * filter per JSX audit 0.6 conflict table (NOT `saturate(0.5)` as in prose).
 * JSX renders only 4 stats (STR/AGI/INT/END) not 5 — flagged for CEO decision;
 * defaulting to JSX behavior (drop LCK) until overridden.
 */
(function () {
  'use strict';

  // JSX renders .slice(0, 4) — 4 stats, not 5. Flag in audit 0.6 for CEO.
  var STAT_KEYS = ['STR', 'AGI', 'INT', 'END'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function barFor(value) {
    var filled = Math.round(Math.max(0, Math.min(100, value)) / 10); // 0-10
    var empty = 10 - filled;
    var out = '';
    for (var i = 0; i < filled; i++) out += '█';
    var pad = '';
    for (var j = 0; j < empty; j++) pad += '░';
    return { filled: out, empty: pad };
  }

  function build(state) {
    var char = (window.ForgePortrait && window.ForgePortrait.get(state.portraitId))
              || (window.ForgePortrait && window.ForgePortrait.CHARACTERS && window.ForgePortrait.CHARACTERS[5])
              || { name: 'Captain Nova', class: 'Legendary Hero' };
    var stats = state.stats || {};
    var name = (state.name && state.name.trim()) || char.name || 'Unknown';
    var className = state.classLabel || char.class || '';
    var rarity = state.rarity || char.rarity || 'Rare';
    var hash = (state.hash || 'a3f9c2').slice(0, 6);

    var statsHtml = STAT_KEYS.map(function (k) {
      var v = Math.max(0, Math.min(100, Number(stats[k]) || 0));
      var bar = barFor(v);
      return '<div class="term-stat">' +
               '<span class="term-stat-label">' + k.toLowerCase() + ':</span>' +
               '<span class="term-stat-bar">' +
                 '<span class="term-stat-filled">' + bar.filled + '</span>' +
                 '<span class="term-stat-empty">' + bar.empty + '</span>' +
               '</span>' +
               '<span class="term-stat-value">' + v + '</span>' +
             '</div>';
    }).join('');

    var html = '' +
      '<div class="term-outer">' +
        '<div class="term-decor-top">┌── card.yaml ─ hash:' + esc(hash) + ' ─┐</div>' +
        '<div class="term-portrait-wrap">' +
          '<div class="term-portrait"></div>' +
          '<div class="term-rarity">[' + esc(rarity).toUpperCase() + ' · 047]</div>' +
          '<div class="term-name-bar">' +
            '<div class="term-class">class: "' + esc(className) + '"</div>' +
            '<div class="term-name">' + esc(name) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="term-stats">' + statsHtml + '</div>' +
        '<div class="term-decor-bot">└── eof ──┘</div>' +
      '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    var portraitSlot = temp.querySelector('.term-portrait');
    var frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    return { frag: frag, portraitSlot: portraitSlot };
  }

  window.ForgeStyleTerminal = {
    id: 'terminal',
    name: 'Terminal',
    byline: 'mono · ascii · yaml',
    voice: 'Card-as-config. YAML framing, ascii stat bars, hash footer.',
    build: build
  };
})();
