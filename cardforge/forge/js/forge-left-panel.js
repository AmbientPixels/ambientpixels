/* forge-left-panel.js — single-page editor controls (simplified).
 * Post-refactor: stages rail dropped. Left panel now always shows:
 *   ◈ IDENTITY  — name, class, rarity chips
 *   ◈ CHARACTER — 12-tile portrait grid (was: stage-01 center-stage form)
 *   ◈ CARD STYLE — 6 style chips + voice note
 *
 * Subscribes to ForgeState for re-renders. Preserves focus on active inputs
 * across re-renders (name field + caret position).
 */

(function () {
  'use strict';

  var RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];

  var STYLES = [
    { id: 'monograph', name: 'Monograph', tag: 'serif',     voice: 'Treats the hero like a profile piece. Serif display, cream paper, pull quote.' },
    { id: 'ember',     name: 'Ember',     tag: 'dark',      voice: 'Obsidian-native. Rim glow, ember accents, mono readout of stats.' },
    { id: 'codex',     name: 'Codex',     tag: 'parchment', voice: 'Tome-page. Cinzel caps, ink-stamp rarity, dotted-line stats.' },
    { id: 'press',     name: 'Press',     tag: 'archivo',   voice: 'Poster energy. Flat color, massive display, hard shadow.' },
    { id: 'arcade',    name: 'Arcade',    tag: 'foil',      voice: 'Game-card energy. Rarity pips, ability line, foil gradient.' },
    { id: 'terminal',  name: 'Terminal',  tag: 'mono',      voice: 'Card-as-config. YAML framing, ascii stat bars, hash footer.' }
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getClassOptions() {
    if (window.ForgePortrait && Array.isArray(window.ForgePortrait.CHARACTERS)) {
      var seen = {};
      var list = [];
      window.ForgePortrait.CHARACTERS.forEach(function (c) {
        if (c && c.class && !seen[c.class]) { seen[c.class] = true; list.push(c.class); }
      });
      if (list.length) return list;
    }
    return ['Fantasy Ranger', 'Cyberpunk Runner', 'Arcane Scholar', 'Space Marine',
            'Corporate Ronin', 'Legendary Hero', 'Titan Guardian', 'Shadow Operative',
            'Celestial Warden', 'Flame Oracle'];
  }

  function renderIdentity(state) {
    var classOptions = getClassOptions();
    var current = state.classLabel || classOptions[0];
    if (classOptions.indexOf(current) < 0) classOptions = [current].concat(classOptions);

    var options = classOptions.map(function (c) {
      var sel = c === current ? ' selected' : '';
      return '<option value="' + escapeHtml(c) + '"' + sel + '>' + escapeHtml(c) + '</option>';
    }).join('');

    var rarityChips = RARITIES.map(function (r) {
      var sel = state.rarity === r;
      return '<button class="forge-rarity-chip' + (sel ? ' is-selected' : '') + '" ' +
             'type="button" data-rarity="' + r + '">' + r + '</button>';
    }).join('');

    return '' +
      '<div class="forge-section">' +
        '<div class="forge-section-label">◈ IDENTITY</div>' +
        '<div style="margin-bottom: 10px;">' +
          '<div class="forge-input-label">NAME</div>' +
          '<input class="forge-panel-input" type="text" id="forge-left-name" value="' + escapeHtml(state.name) + '" placeholder="Name your hero..." />' +
        '</div>' +
        '<div style="margin-bottom: 10px;">' +
          '<div class="forge-input-label">CLASS</div>' +
          '<div class="forge-select-wrap">' +
            '<select class="forge-panel-select" id="forge-left-class">' + options + '</select>' +
            '<i class="fa-solid fa-chevron-down forge-select-chevron"></i>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="forge-input-label">RARITY</div>' +
          '<div class="forge-rarity-chips forge-rarity-chips--compact">' + rarityChips + '</div>' +
        '</div>' +
      '</div>';
  }

  function renderPortraits(state) {
    var chars = (window.ForgePortrait && window.ForgePortrait.CHARACTERS) || [];
    var tiles = chars.map(function (c) {
      var sel = state.portraitId === c.id;
      var portrait = window.ForgePortrait ? window.ForgePortrait.buildHtml(c) : '';
      return '<button class="forge-portrait-tile forge-portrait-tile--compact' + (sel ? ' is-selected' : '') + '" ' +
             'type="button" data-portrait-id="' + c.id + '" ' +
             'title="' + escapeHtml(c.name + ' — ' + c.class) + '">' +
               '<div class="forge-portrait-tile-svg">' + portrait + '</div>' +
             '</button>';
    }).join('');

    return '' +
      '<div class="forge-section">' +
        '<div class="forge-section-label">◈ CHARACTER</div>' +
        '<div class="forge-portrait-grid forge-portrait-grid--compact">' + tiles + '</div>' +
      '</div>';
  }

  function renderStylePicker(state) {
    var selectedStyle = STYLES.find(function (s) { return s.id === state.styleId; }) || STYLES[1];
    var chips = STYLES.map(function (s) {
      var cls = 'forge-style-chip' + (s.id === state.styleId ? ' is-selected' : '');
      return '' +
        '<button class="' + cls + '" data-style-id="' + s.id + '" type="button">' +
          '<div class="forge-style-chip-name">' + escapeHtml(s.name) + '</div>' +
          '<div class="forge-style-chip-tag">' + escapeHtml(s.tag) + '</div>' +
        '</button>';
    }).join('');

    return '' +
      '<div class="forge-section">' +
        '<div class="forge-section-label">◈ CARD STYLE</div>' +
        '<div class="forge-style-grid">' + chips + '</div>' +
        '<div class="forge-style-voice">' + escapeHtml(selectedStyle.voice) + '</div>' +
      '</div>';
  }

  function render(root, state) {
    if (!root) return;
    root.innerHTML =
      renderIdentity(state) +
      renderPortraits(state) +
      renderStylePicker(state);
  }

  function wire(root) {
    if (!root) return;

    root.addEventListener('click', function (ev) {
      // Style chip
      var styleChip = ev.target.closest('.forge-style-chip');
      if (styleChip && styleChip.dataset.styleId) {
        var prev = window.ForgeState.get().styleId;
        var next = styleChip.dataset.styleId;
        if (prev === next) return;
        if (window.ForgeTelemetry && typeof window.ForgeTelemetry.track === 'function') {
          window.ForgeTelemetry.track('style.pick', { from: prev, to: next });
        }
        window.ForgeState.set({ styleId: next });
        return;
      }

      // Rarity chip
      var rarityChip = ev.target.closest('.forge-rarity-chip');
      if (rarityChip && rarityChip.dataset.rarity) {
        window.ForgeState.set({ rarity: rarityChip.dataset.rarity });
        return;
      }

      // Portrait tile
      var portraitTile = ev.target.closest('.forge-portrait-tile');
      if (portraitTile && portraitTile.dataset.portraitId) {
        var c = window.ForgePortrait ? window.ForgePortrait.get(portraitTile.dataset.portraitId) : null;
        if (c) {
          var curState = window.ForgeState.get();
          window.ForgeState.set({
            portraitId: c.id,
            // Only auto-fill class/rarity if user hasn't customized them yet
            classLabel: curState.classLabel && curState.classLabel.trim() ? curState.classLabel : c.class,
            rarity: curState.rarity || c.rarity
          });
        }
        return;
      }
    });

    // Arrow-key roving in style chip grid (3 cols now instead of 2)
    root.addEventListener('keydown', function (ev) {
      var chipEl = ev.target.closest('.forge-style-chip');
      if (!chipEl) return;
      var chips = Array.from(root.querySelectorAll('.forge-style-chip'));
      var cidx = chips.indexOf(chipEl);
      var target = -1;
      if (ev.key === 'ArrowRight') target = cidx + 1;
      else if (ev.key === 'ArrowLeft') target = cidx - 1;
      else if (ev.key === 'ArrowDown') target = cidx + 3;
      else if (ev.key === 'ArrowUp') target = cidx - 3;
      if (target >= 0 && target < chips.length) {
        ev.preventDefault();
        chips[target].focus();
      }
    });

    // Live inputs
    root.addEventListener('input', function (ev) {
      if (ev.target && ev.target.id === 'forge-left-name') {
        window.ForgeState.set({ name: ev.target.value });
      }
    });

    root.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'forge-left-class') {
        window.ForgeState.set({ classLabel: ev.target.value });
      }
    });
  }

  window.ForgeLeftPanel = {
    STYLES: STYLES,
    RARITIES: RARITIES,
    render: render
  };

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('forge-left-panel');
    if (!root || !window.ForgeState) return;
    render(root, window.ForgeState.get());
    wire(root);
    window.ForgeState.subscribe(function (state) {
      var active = document.activeElement;
      var isNameFocused = active && active.id === 'forge-left-name';
      var caret = isNameFocused ? active.selectionStart : null;
      render(root, state);
      if (isNameFocused) {
        var nameEl = document.getElementById('forge-left-name');
        if (nameEl) { nameEl.focus(); if (caret != null) nameEl.setSelectionRange(caret, caret); }
      }
    });
  });
})();
