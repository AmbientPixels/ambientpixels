/* forge-right-panel.js — renders Vitals + Overlays + Live state + FORGE → NEXT.
 * Per redesign-handoff.md §6.4.
 *
 * Phase 3: renders with a static default state. No drag, no toggle interaction.
 * Phase 4 Task 4.2 wires stat-thumb drag, overlay toggles, and the forge-next button.
 *
 * Stat keys are the existing CardForge schema — STR/AGI/INT/END/LCK (locked per
 * project_cardforge_forge_redesign.md). Do not rename to spec's STR/DEX/INT/CON/LUK.
 */

(function () {
  'use strict';

  // Order matters — this is the vertical order of vital rows.
  var STAT_KEYS = ['STR', 'AGI', 'INT', 'END', 'LCK'];

  // 4 overlays per spec §6.4
  var OVERLAYS = [
    { id: 'rim',       label: 'Rim glow' },
    { id: 'grain',     label: 'Film grain' },
    { id: 'foil',      label: 'Foil sheen' },
    { id: 'signature', label: 'Signature' }
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderVitals(state) {
    var stats = state.stats || {};
    var rows = STAT_KEYS.map(function (key) {
      var val = Math.max(0, Math.min(100, Number(stats[key]) || 0));
      return '' +
        '<div class="forge-vital-row" data-stat="' + key + '">' +
          '<div class="forge-vital-header">' +
            '<span class="forge-vital-label">' + key + '</span>' +
            '<span class="forge-vital-value">' + val + '</span>' +
          '</div>' +
          '<div class="forge-vital-track">' +
            '<div class="forge-vital-fill" style="width: ' + val + '%;"></div>' +
            '<div class="forge-vital-thumb" style="left: ' + val + '%;"></div>' +
          '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<div class="forge-section">' +
        '<div class="forge-section-label">◈ VITALS</div>' +
        '<div class="forge-vitals">' + rows + '</div>' +
      '</div>';
  }

  function renderOverlays(state) {
    var overlayState = state.overlays || {};
    var rows = OVERLAYS.map(function (o) {
      var isOn = !!overlayState[o.id];
      return '' +
        '<div class="forge-overlay-row">' +
          '<span class="forge-overlay-label">' + escapeHtml(o.label) + '</span>' +
          '<button class="forge-overlay-toggle' + (isOn ? ' is-on' : '') + '" ' +
                  'type="button" data-overlay-id="' + o.id + '" ' +
                  'aria-label="' + escapeHtml(o.label) + ' toggle" ' +
                  'aria-pressed="' + isOn + '"></button>' +
        '</div>';
    }).join('');

    return '' +
      '<div class="forge-section">' +
        '<div class="forge-section-label">◈ OVERLAYS</div>' +
        '<div class="forge-overlays">' + rows + '</div>' +
      '</div>';
  }

  function formatAutosaveAge(ms) {
    if (!ms) return 'not saved';
    var delta = Math.max(0, Date.now() - ms);
    var sec = Math.round(delta / 1000);
    if (sec < 60) return sec + 's ago';
    var min = Math.floor(sec / 60);
    return min + 'm ' + (sec % 60).toString().padStart(2, '0') + 's ago';
  }

  function renderLiveState(state) {
    var hash = state.hash || 'a3f9c2b8';
    var styleId = state.styleId || 'ember';
    var autosave = state.autosavedAt ? formatAutosaveAge(state.autosavedAt) : '0:03 ago';

    return '' +
      '<div class="forge-section">' +
        '<div class="forge-live-state">' +
          '<div class="forge-live-state-row">' +
            '<span class="forge-live-state-dot"></span>' +
            '<span class="forge-live-state-val">LIVE</span>' +
          '</div>' +
          '<div class="forge-live-state-row">' +
            '<span class="forge-live-state-key">hash:</span>' +
            '<span class="forge-live-state-val">' + escapeHtml(hash) + '</span>' +
          '</div>' +
          '<div class="forge-live-state-row">' +
            '<span class="forge-live-state-key">style:</span>' +
            '<span class="forge-live-state-val">' + escapeHtml(styleId) + '</span>' +
          '</div>' +
          '<div class="forge-live-state-row">' +
            '<span class="forge-live-state-key">autosaved</span>' +
            '<span class="forge-live-state-val">' + escapeHtml(autosave) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderForgeNext() {
    return '<button class="forge-next-btn" type="button">⚒ FORGE → NEXT</button>';
  }

  function render(root, state) {
    if (!root) return;
    root.innerHTML =
      renderVitals(state) +
      renderOverlays(state) +
      renderLiveState(state) +
      renderForgeNext();
  }

  window.ForgeRightPanel = {
    STAT_KEYS: STAT_KEYS,
    OVERLAYS: OVERLAYS,
    render: render
  };

  document.addEventListener('DOMContentLoaded', function () {
    var defaultState = (window.ForgeState && typeof window.ForgeState.get === 'function')
      ? window.ForgeState.get()
      : {
          stats: { STR: 72, AGI: 64, INT: 88, END: 58, LCK: 45 },
          overlays: { rim: true, grain: false, foil: true, signature: false },
          styleId: 'ember',
          hash: 'a3f9c2b8'
        };
    render(document.getElementById('forge-right-panel'), defaultState);
  });
})();
