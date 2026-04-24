/* forge-right-panel.js — renders Vitals + Overlays + Live state + FORGE → NEXT.
 * Per redesign-handoff.md §6.4 + Phase 4 Task 4.2.
 *
 * Wires: stat-track click (sets value 0-100 from click X), overlay toggles,
 * forge-next button. Subscribes to window.ForgeState for re-renders.
 *
 * Stat keys locked as STR/AGI/INT/END/LCK per project_cardforge_forge_redesign.md.
 */

(function () {
  'use strict';

  var STAT_KEYS = ['STR', 'AGI', 'INT', 'END', 'LCK'];
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

  function clamp(n) { return Math.max(0, Math.min(100, n)); }

  function renderVitals(state) {
    var stats = state.stats || {};
    var rows = STAT_KEYS.map(function (key) {
      var val = clamp(Number(stats[key]) || 0);
      return '' +
        '<div class="forge-vital-row" data-stat="' + key + '">' +
          '<div class="forge-vital-header">' +
            '<span class="forge-vital-label">' + key + '</span>' +
            '<span class="forge-vital-value">' + val + '</span>' +
          '</div>' +
          '<div class="forge-vital-track" data-stat-track="' + key + '" role="slider" aria-label="' + key + ' stat" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + val + '" tabindex="0">' +
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
    var hash = state.hash || '--------';
    var styleId = state.styleId || 'ember';
    var autosave = state.autosavedAt ? formatAutosaveAge(state.autosavedAt) : 'not saved';

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

  function renderForgeNext(state) {
    var atTerminal = state.activeStage === 'mint';
    return '<button class="forge-next-btn" type="button" id="forge-next-btn"' + (atTerminal ? ' disabled' : '') + '>⚒ FORGE → NEXT</button>';
  }

  function render(root, state) {
    if (!root) return;
    root.innerHTML =
      renderVitals(state) +
      renderOverlays(state) +
      renderLiveState(state) +
      renderForgeNext(state);
  }

  // ---------------------------------------------------------------
  // Wire interactions — delegate on root
  // ---------------------------------------------------------------
  function startStatDrag(track, startEv) {
    var key = track.dataset.statTrack;
    if (!key) return;

    // Cache rect + DOM handles once at drag start. During drag we write
    // directly to these nodes (no state.set → subscribe → re-render loop).
    // This gives 1:1 mouse tracking instead of the state-round-trip lag.
    // Final value commits to state on mouseup.
    var rect = track.getBoundingClientRect();
    var row = track.closest('.forge-vital-row');
    var fill = track.querySelector('.forge-vital-fill');
    var thumb = track.querySelector('.forge-vital-thumb');
    var valueEl = row ? row.querySelector('.forge-vital-value') : null;

    document.body.classList.add('forge-dragging');
    var lastVal = null;

    function paint(clientX) {
      var rel = (clientX - rect.left) / rect.width;
      var val = Math.round(clamp(rel * 100));
      if (val === lastVal) return;
      lastVal = val;
      if (fill)   fill.style.width = val + '%';
      if (thumb)  thumb.style.left = val + '%';
      if (valueEl) valueEl.textContent = val;
      track.setAttribute('aria-valuenow', val);
    }

    paint(startEv.clientX);

    function onMove(ev) { ev.preventDefault(); paint(ev.clientX); }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('forge-dragging');
      // Commit once at drag end — triggers the only re-render of the drag.
      if (lastVal != null) {
        var stats = Object.assign({}, window.ForgeState.get().stats);
        if (stats[key] !== lastVal) {
          stats[key] = lastVal;
          window.ForgeState.set({ stats: stats });
        }
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function wire(root) {
    if (!root) return;

    // Slider drag — mousedown on track (or its expanded hit area) starts drag.
    // mousedown fires before click, so we handle both single-click and drag here.
    root.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      var track = ev.target.closest('.forge-vital-track');
      if (!track) return;
      ev.preventDefault();
      startStatDrag(track, ev);
    });

    // Click handling — overlay toggles, forge-next (tracks handled via mousedown above)
    root.addEventListener('click', function (ev) {
      var toggle = ev.target.closest('.forge-overlay-toggle');
      if (toggle && toggle.dataset.overlayId) {
        var id = toggle.dataset.overlayId;
        var prev = window.ForgeState.get().overlays || {};
        var next = Object.assign({}, prev);
        next[id] = !prev[id];
        window.ForgeState.set({ overlays: next });
        return;
      }

      var nextBtn = ev.target.closest('#forge-next-btn');
      if (nextBtn && window.ForgeStageFlow) {
        window.ForgeStageFlow.next();
        return;
      }
    });

    // Keyboard parity — arrow keys on stat tracks adjust by ±5
    root.addEventListener('keydown', function (ev) {
      var track = ev.target.closest('.forge-vital-track');
      if (!track) return;
      var key = track.dataset.statTrack;
      if (!key) return;

      var step = 0;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') step = 5;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') step = -5;
      else if (ev.key === 'Home') step = -100;
      else if (ev.key === 'End') step = 100;
      else return;

      ev.preventDefault();
      var stats = Object.assign({}, window.ForgeState.get().stats);
      stats[key] = clamp((Number(stats[key]) || 0) + step);
      window.ForgeState.set({ stats: stats });
    });
  }

  window.ForgeRightPanel = {
    STAT_KEYS: STAT_KEYS,
    OVERLAYS: OVERLAYS,
    render: render
  };

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('forge-right-panel');
    if (!root || !window.ForgeState) return;
    render(root, window.ForgeState.get());
    wire(root);
    window.ForgeState.subscribe(function (state) { render(root, state); });
  });
})();
