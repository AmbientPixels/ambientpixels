/* forge-left-panel.js — renders Identity + Stages + Pick Card Style.
 * Per redesign-handoff.md §6.2 + Phase 4 Task 4.2.
 *
 * Subscribes to window.ForgeState for re-renders. Click handlers dispatch via
 * window.ForgeStageFlow (stages) and window.ForgeState.set (style picks + name input).
 *
 * STAGES + STYLES inlined so the module works from file:// without fetch.
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
    // Fallback if portrait module didn't load
    return [
      'Fantasy Ranger', 'Cyberpunk Runner', 'Arcane Scholar', 'Space Marine',
      'Corporate Ronin', 'Legendary Hero', 'Titan Guardian', 'Shadow Operative',
      'Celestial Warden', 'Flame Oracle', 'Deep Current Oracle', 'Void Mystic'
    ];
  }

  function renderIdentity(state) {
    var classOptions = getClassOptions();
    var current = state.classLabel || classOptions[0];
    // Ensure current is in the list (edge case: state has a class not in options)
    if (classOptions.indexOf(current) < 0) classOptions = [current].concat(classOptions);

    var options = classOptions.map(function (c) {
      var sel = c === current ? ' selected' : '';
      return '<option value="' + escapeHtml(c) + '"' + sel + '>' + escapeHtml(c) + '</option>';
    }).join('');

    return '' +
      '<div class="forge-section">' +
        '<div class="forge-section-label">◈ IDENTITY</div>' +
        '<div style="margin-bottom: 10px;">' +
          '<div class="forge-input-label">NAME</div>' +
          '<input class="forge-panel-input" type="text" id="forge-left-name" value="' + escapeHtml(state.name) + '" placeholder="Name your hero..." />' +
        '</div>' +
        '<div>' +
          '<div class="forge-input-label">CLASS</div>' +
          '<div class="forge-select-wrap">' +
            '<select class="forge-panel-select" id="forge-left-class">' + options + '</select>' +
            '<i class="fa-solid fa-chevron-down forge-select-chevron"></i>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderStages(state) {
    var order = (window.ForgeStageFlow && window.ForgeStageFlow.STAGE_ORDER) || STAGES.map(function (s) { return s.id; });
    var activeIdx = order.indexOf(state.activeStage);
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

  // ---------------------------------------------------------------
  // Event wiring — delegate on the panel root so re-renders don't
  // need to re-bind listeners.
  // ---------------------------------------------------------------
  function wire(root) {
    if (!root) return;

    // Stage row click → StageFlow.goTo
    root.addEventListener('click', function (ev) {
      var stageEl = ev.target.closest('.forge-stage-row');
      if (stageEl && stageEl.dataset.stageId) {
        if (window.ForgeStageFlow) window.ForgeStageFlow.goTo(stageEl.dataset.stageId);
        return;
      }

      var styleChip = ev.target.closest('.forge-style-chip');
      if (styleChip && styleChip.dataset.styleId) {
        var prev = window.ForgeState.get().styleId;
        var next = styleChip.dataset.styleId;
        if (prev === next) return;

        if (window.ForgeTelemetry && typeof window.ForgeTelemetry.track === 'function') {
          window.ForgeTelemetry.track('style.pick', {
            from: prev,
            to: next,
            atStage: window.ForgeState.get().activeStage
          });
        }
        window.ForgeState.set({ styleId: next });
      }
    });

    // Keyboard parity — Enter/Space on stage rows
    root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var stageEl = ev.target.closest('.forge-stage-row');
      if (stageEl && stageEl.dataset.stageId) {
        ev.preventDefault();
        if (window.ForgeStageFlow) window.ForgeStageFlow.goTo(stageEl.dataset.stageId);
      }
    });

    // Name input — live sync to state (debounced via ForgeState's own 300ms save)
    root.addEventListener('input', function (ev) {
      if (ev.target && ev.target.id === 'forge-left-name') {
        window.ForgeState.set({ name: ev.target.value });
      }
    });

    // Class <select> — change event fires on option select
    root.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'forge-left-class') {
        window.ForgeState.set({ classLabel: ev.target.value });
      }
    });
  }

  window.ForgeLeftPanel = {
    STAGES: STAGES,
    STYLES: STYLES,
    render: render
  };

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('forge-left-panel');
    if (!root || !window.ForgeState) return;
    render(root, window.ForgeState.get());
    wire(root);
    window.ForgeState.subscribe(function (state) {
      // Preserve focus + caret position across re-renders of the name input
      var active = document.activeElement;
      var isNameFocused = active && active.id === 'forge-left-name';
      var caret = isNameFocused ? active.selectionStart : null;
      render(root, state);
      if (isNameFocused) {
        var nameEl = document.getElementById('forge-left-name');
        if (nameEl) {
          nameEl.focus();
          if (caret != null) nameEl.setSelectionRange(caret, caret);
        }
      }
    });
  });
})();
