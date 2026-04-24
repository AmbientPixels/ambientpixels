/* forge-left-panel.js — renders Identity + Stages + Pick Card Style sections.
 * Per redesign-handoff.md §6.2.
 *
 * Phase 3: renders with a static default state (no interactivity, no persistence).
 * Phase 4 Task 4.2 wires stage-click navigation + style-chip state updates.
 * STAGES + STYLES are inlined here so the module works from file:// protocol
 * without needing fetch(); `data/forge-stages.json` is the canonical
 * external copy but is not loaded at runtime in Phase 3.
 */

(function () {
  'use strict';

  var STAGES = [
    { id: 'identity',    num: '01', label: 'Identity' },
    { id: 'card-design', num: '02', label: 'Card Design' },
    { id: 'vitals',      num: '03', label: 'Vitals' },
    { id: 'overlays',    num: '04', label: 'Overlays' },
    { id: 'lore',        num: '05', label: 'Lore' },
    { id: 'preview',     num: '06', label: 'Preview' },
    { id: 'mint',        num: '07', label: 'Mint' }
  ];

  // Card styles per dir10-obsidian-cards.jsx. Voice sub-tag = first word of byline.
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

  function renderIdentity(state) {
    return '' +
      '<div class="forge-section">' +
        '<div class="forge-section-label">◈ IDENTITY</div>' +
        '<div style="margin-bottom: 10px;">' +
          '<div class="forge-input-label">NAME</div>' +
          '<input class="forge-panel-input" type="text" value="' + escapeHtml(state.name) + '" placeholder="Name your hero..." />' +
        '</div>' +
        '<div>' +
          '<div class="forge-input-label">CLASS</div>' +
          '<div class="forge-panel-select" role="button" tabindex="0">' +
            '<span>' + escapeHtml(state.classLabel || 'Fantasy Ranger') + '</span>' +
            '<i class="fa-solid fa-chevron-down"></i>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderStages(state) {
    var activeIdx = STAGES.findIndex(function (s) { return s.id === state.activeStage; });
    if (activeIdx < 0) activeIdx = 0;

    var rows = STAGES.map(function (s, i) {
      var isActive = i === activeIdx;
      var isDone = i < activeIdx;
      var cls = 'forge-stage-row' + (isActive ? ' is-active' : '') + (isDone ? ' is-done' : '');
      var indicatorContent = isDone ? '<i class="fa-solid fa-check" style="font-size: 7px;"></i>' : s.num;

      return '' +
        '<div class="' + cls + '" data-stage-id="' + s.id + '" role="button" tabindex="0">' +
          '<div class="forge-stage-indicator">' + indicatorContent + '</div>' +
          '<span class="forge-stage-label">' + escapeHtml(s.label) + '</span>' +
        '</div>';
    }).join('');

    return '' +
      '<div class="forge-section">' +
        '<div class="forge-section-label">◈ STAGES</div>' +
        '<div class="forge-stages">' + rows + '</div>' +
      '</div>';
  }

  function renderStylePicker(state) {
    var selectedStyle = STYLES.find(function (s) { return s.id === state.styleId; }) || STYLES[1]; // default ember

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
        '<div class="forge-section-label">◈ PICK CARD STYLE</div>' +
        '<div class="forge-style-grid">' + chips + '</div>' +
        '<div class="forge-style-voice">' + escapeHtml(selectedStyle.voice) + '</div>' +
      '</div>';
  }

  function render(root, state) {
    if (!root) return;
    root.innerHTML =
      renderIdentity(state) +
      renderStages(state) +
      renderStylePicker(state);
  }

  window.ForgeLeftPanel = {
    STAGES: STAGES,
    STYLES: STYLES,
    render: render
  };

  document.addEventListener('DOMContentLoaded', function () {
    var defaultState = (window.ForgeState && typeof window.ForgeState.get === 'function')
      ? window.ForgeState.get()
      : {
          name: '',
          classLabel: 'Fantasy Ranger',
          activeStage: 'card-design',
          styleId: 'ember'
        };
    render(document.getElementById('forge-left-panel'), defaultState);
  });
})();
