// ═══════════════════════════════════════════════════════════
// Pixel Agents — Primary palette customization
// 6 curated presets, localStorage-first, optional account sync.
//
// Applies to --pa-primary* tokens at runtime. The rest of the design
// (tokens, components, themes) is untouched — every UI element that
// uses var(--pa-primary) adapts automatically.
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Curated palettes — each pre-tuned with hover / dim / border / glow / soft ──
  const PALETTES = {
    signal: {
      name: 'Signal Red',
      primary: '#E3442C', hover: '#C93823',
      dim:    'rgba(227, 68, 44, 0.12)',
      border: 'rgba(227, 68, 44, 0.30)',
      glow:   'rgba(227, 68, 44, 0.22)',
      soft:   'rgba(227, 68, 44, 0.14)'
    },
    cobalt: {
      name: 'Cobalt Blue',
      primary: '#2563EB', hover: '#1D4ED8',
      dim:    'rgba(37, 99, 235, 0.12)',
      border: 'rgba(37, 99, 235, 0.30)',
      glow:   'rgba(37, 99, 235, 0.22)',
      soft:   'rgba(37, 99, 235, 0.14)'
    },
    emerald: {
      name: 'Emerald',
      primary: '#10B981', hover: '#059669',
      dim:    'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.30)',
      glow:   'rgba(16, 185, 129, 0.22)',
      soft:   'rgba(16, 185, 129, 0.14)'
    },
    violet: {
      name: 'Violet',
      primary: '#7C3AED', hover: '#6D28D9',
      dim:    'rgba(124, 58, 237, 0.12)',
      border: 'rgba(124, 58, 237, 0.30)',
      glow:   'rgba(124, 58, 237, 0.22)',
      soft:   'rgba(124, 58, 237, 0.14)'
    },
    amber: {
      name: 'Amber Gold',
      primary: '#E8A33A', hover: '#D28F2A',
      dim:    'rgba(232, 163, 58, 0.12)',
      border: 'rgba(232, 163, 58, 0.30)',
      glow:   'rgba(232, 163, 58, 0.22)',
      soft:   'rgba(232, 163, 58, 0.14)'
    },
    graphite: {
      name: 'Graphite',
      primary: '#3F3F46', hover: '#27272A',
      dim:    'rgba(63, 63, 70, 0.12)',
      border: 'rgba(63, 63, 70, 0.30)',
      glow:   'rgba(63, 63, 70, 0.22)',
      soft:   'rgba(63, 63, 70, 0.14)'
    }
  };

  const STORAGE_KEY = 'pa-primary-palette';
  const DEFAULT_ID  = 'signal';

  // ── Apply a palette to :root by setting custom properties ──
  function apply(id) {
    const p = PALETTES[id] || PALETTES[DEFAULT_ID];
    const root = document.documentElement;
    root.style.setProperty('--pa-primary',        p.primary);
    root.style.setProperty('--pa-primary-hover',  p.hover);
    root.style.setProperty('--pa-primary-dim',    p.dim);
    root.style.setProperty('--pa-primary-border', p.border);
    root.style.setProperty('--pa-primary-glow',   p.glow);
    root.style.setProperty('--pa-accent-soft',    p.soft);
    root.setAttribute('data-pa-palette', id);
  }

  // ── Read from localStorage, fallback to default ──
  function currentId() {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_ID;
    } catch (_) { return DEFAULT_ID; }
  }

  // ── Persist + apply ──
  function save(id) {
    if (!PALETTES[id]) return;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
    apply(id);
    syncToProfile(id);
    updateActiveSwatch(id);
  }

  // ── Account sync (fire-and-forget) ──
  // Only attempts if user appears signed in. Failures are silent — localStorage
  // is the source of truth; server sync is a convenience for cross-device.
  function syncToProfile(id) {
    if (!window.fetch) return;
    // Heuristic: the creator-profile API requires auth via cookies/headers
    // the existing auth flow provides. Just POST and let the server 401 if
    // not logged in; we don't care.
    try {
      fetch('/api/pixel-agent-creator-profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uiPrimary: id })
      }).catch(function () { /* silent — localStorage wins */ });
    } catch (_) {}
  }

  // ── Pull remote profile on page load (non-blocking). If it differs from
  // localStorage, reconcile by preferring the remote value and re-applying. ──
  function pullRemote() {
    if (!window.fetch) return;
    try {
      fetch('/api/pixel-agent-creator-profile', { credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.uiPrimary) return;
          if (!PALETTES[data.uiPrimary]) return;
          if (data.uiPrimary === currentId()) return;
          try { localStorage.setItem(STORAGE_KEY, data.uiPrimary); } catch (_) {}
          apply(data.uiPrimary);
          updateActiveSwatch(data.uiPrimary);
        })
        .catch(function () { /* silent */ });
    } catch (_) {}
  }

  // ── Inject swatch UI into the existing avatar dropdown ──
  function injectSwatches() {
    const menu = document.getElementById('pa-avatar-menu');
    if (!menu || menu.querySelector('.pa-avatar-palette')) return;

    const wrap = document.createElement('div');
    wrap.className = 'pa-avatar-palette';
    wrap.innerHTML =
      '<span class="pa-avatar-palette-label">Primary Color</span>' +
      '<div class="pa-avatar-palette-swatches">' +
        Object.keys(PALETTES).map(function (id) {
          const p = PALETTES[id];
          return '<button type="button" class="pa-palette-swatch" ' +
            'data-palette="' + id + '" title="' + p.name + '" ' +
            'aria-label="' + p.name + '" ' +
            'style="background:' + p.primary + '"></button>';
        }).join('') +
      '</div>';

    menu.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-palette]');
      if (!btn) return;
      save(btn.getAttribute('data-palette'));
    });

    updateActiveSwatch(currentId());
  }

  function updateActiveSwatch(id) {
    document.querySelectorAll('.pa-palette-swatch').forEach(function (s) {
      s.classList.toggle('is-active', s.getAttribute('data-palette') === id);
    });
  }

  // ── Boot ──
  // 1. Apply palette synchronously (runs before DOM paint, no color flash)
  apply(currentId());

  // 2. Inject UI once the dropdown exists + try to pull remote preference
  function boot() {
    injectSwatches();
    pullRemote();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose for manual control / debugging
  window.PaPalette = { apply: save, current: currentId, palettes: PALETTES };
})();
