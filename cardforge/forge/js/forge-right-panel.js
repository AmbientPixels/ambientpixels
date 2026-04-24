/* forge-right-panel.js — vitals + overlays + live share state.
 * Post-refactor: no FORGE → NEXT button (publish moved to center footer).
 * Live state shows share URL after publish.
 *
 * Stats: direct-DOM drag during mousedown→mouseup for 1:1 tracking, commits
 * to state on mouseup (eliminates re-render-per-mousemove lag).
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
    var hash = state.hash || '------------';
    var styleId = state.styleId || 'ember';
    var autosave = state.autosavedAt ? formatAutosaveAge(state.autosavedAt) : 'not saved';
    var shareRow = '';
    if (state.shareUrl) {
      var shortUrl = state.shareUrl.replace(window.location.origin, '');
      shareRow =
        '<div class="forge-live-state-row">' +
          '<span class="forge-live-state-key">share:</span>' +
          '<span class="forge-live-state-val forge-live-state-share" title="' + escapeHtml(state.shareUrl) + '">' + escapeHtml(shortUrl) + '</span>' +
          '<button class="forge-live-state-copy" type="button" data-action="copy-share" aria-label="Copy share URL" title="Copy">' +
            '<i class="fa-solid fa-copy"></i>' +
          '</button>' +
        '</div>';
    }

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
          shareRow +
        '</div>' +
      '</div>';
  }

  function render(root, state) {
    if (!root) return;
    root.innerHTML =
      renderVitals(state) +
      renderOverlays(state) +
      renderLiveState(state);
  }

  // ---------------------------------------------------------------
  // Wire
  // ---------------------------------------------------------------
  function startStatDrag(track, startEv) {
    var key = track.dataset.statTrack;
    if (!key) return;
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

  function handleCopyShare() {
    var url = window.ForgeState.get().shareUrl;
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        var btn = document.querySelector('.forge-live-state-copy');
        if (!btn) return;
        var prev = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(function () { btn.innerHTML = prev; }, 1200);
      }).catch(function () { window.prompt('Copy this link:', url); });
    } else {
      window.prompt('Copy this link:', url);
    }
  }

  function wire(root) {
    if (!root) return;

    // Slider drag
    root.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      var track = ev.target.closest('.forge-vital-track');
      if (!track) return;
      ev.preventDefault();
      startStatDrag(track, ev);
    });

    // Clicks — overlay toggles + copy-share
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

      var actionBtn = ev.target.closest('[data-action]');
      if (actionBtn && actionBtn.dataset.action === 'copy-share') {
        handleCopyShare();
        return;
      }
    });

    // Keyboard on stat tracks — ±5 step
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
