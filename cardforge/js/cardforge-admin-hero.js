/**
 * CardForge Admin — Hero Configuration page logic.
 *
 * Responsibilities:
 *   - Verify the user is an admin (server is the source of truth on POST;
 *     client gate is UX only).
 *   - Bind the form (mode select + curated IDs textarea), POST on save,
 *     surface success/error toast.
 *   - Render a live preview of the 5 cards the splash will show given
 *     the current form state — uses the same renderedFront/frontClasses
 *     pipeline as the splash.
 */
(function () {
  'use strict';

  var API_LOAD_CARDS = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';

  function heroConfigUrl() {
    if (typeof window.buildApiPath === 'function') {
      var u = window.buildApiPath('heroConfig');
      if (u) return u;
    }
    return 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeheroconfig';
  }
  var ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  var MAX_CURATED_IDS = 5;

  var els = {};
  var state = {
    cards: [],     // full pool of cards from /api/cardforgeloadcards
    config: null,  // loaded config from server
    principal: null
  };

  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cssUrl(src) {
    return "url('" + String(src).replace(/\\/g, '\\\\').replace(/'/g, "%27") + "')";
  }

  function showToast(kind, msg) {
    if (!els.toast) return;
    els.toast.className = 'cf-admin__toast cf-admin__toast--' + kind;
    els.toast.textContent = msg;
    els.toast.hidden = false;
  }

  function hideToast() {
    if (els.toast) els.toast.hidden = true;
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg;
    els.error.hidden = false;
  }

  function clearError() {
    if (els.error) els.error.hidden = true;
  }

  function parseCuratedIds(raw) {
    if (!raw) return [];
    return String(raw)
      .split(/[\s,]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function validateCurated(ids) {
    if (ids.length > MAX_CURATED_IDS) {
      return { ok: false, error: 'At most ' + MAX_CURATED_IDS + ' curated IDs allowed (got ' + ids.length + ').' };
    }
    for (var i = 0; i < ids.length; i++) {
      if (!ID_PATTERN.test(ids[i])) {
        return { ok: false, error: 'Invalid ID at line ' + (i + 1) + ': "' + ids[i] + '". Allowed: letters, digits, underscore, hyphen (max 64 chars).' };
      }
    }
    return { ok: true };
  }

  // ---- Auth -----------------------------------------------------------

  async function fetchPrincipal() {
    try {
      var res = await fetch('/.auth/me', { credentials: 'include' });
      if (!res.ok) return null;
      var data = await res.json();
      var p = Array.isArray(data && data.clientPrincipal)
        ? data.clientPrincipal[0]
        : ((data && data.clientPrincipal) || null);
      return p || null;
    } catch (_) { return null; }
  }

  function isAdmin(principal) {
    if (!principal || !principal.userId) return false;
    var admins = (window._config && window._config.adminUserIds) || [];
    return admins.indexOf(principal.userId) !== -1;
  }

  function renderNavAuth(principal) {
    var loginBtn = $('cf-login-btn');
    var userStatus = $('cf-user-status');
    if (principal && principal.userDetails) {
      var nameEl = userStatus && userStatus.querySelector('.cf-splash-nav__user-name');
      if (nameEl) nameEl.textContent = principal.userDetails;
      if (userStatus) userStatus.hidden = false;
      if (loginBtn) loginBtn.hidden = true;
    } else {
      if (loginBtn) {
        loginBtn.hidden = false;
        loginBtn.addEventListener('click', function () {
          window.location.href = '/.auth/login/aadB2C?post_login_redirect_uri=/cardforge/admin.html';
        });
      }
      if (userStatus) userStatus.hidden = true;
    }
  }

  // ---- Cards + config fetch ------------------------------------------

  function normalizeCard(entry) {
    var cd = entry.cardData || entry;
    var id = entry.id || cd.id || cd.shareId || '';
    var name = cd.name || entry.name || '';
    var renderedFront = cd.renderedFront || null;
    var frontClasses = cd.frontClasses || null;
    var createdAt = Number(cd.createdAt || cd.publishedAt || cd.savedAt || cd.updatedAt || cd.timestamp || entry.createdAt || 0) || 0;
    return {
      id: id,
      name: name,
      renderedFront: renderedFront,
      frontClasses: frontClasses,
      createdAt: createdAt,
      avatar: cd.avatar || entry.avatar || ''
    };
  }

  async function fetchCards() {
    try {
      var headers = {};
      try {
        if (typeof window._cfGetAuthHeaders === 'function') {
          headers = await window._cfGetAuthHeaders();
        }
      } catch (_) {}
      var res = await fetch(API_LOAD_CARDS, { headers: headers, credentials: 'omit' });
      if (!res.ok) return [];
      var data = await res.json();
      var pool = [];
      if (Array.isArray(data)) pool = data;
      else if (data) {
        pool = []
          .concat(data.galleryCards || [])
          .concat(data.defaultCards || [])
          .concat(data.userCards || []);
      }
      return pool.map(normalizeCard).filter(function (c) { return c && c.renderedFront && c.frontClasses; });
    } catch (_) { return []; }
  }

  async function fetchConfig() {
    try {
      var res = await fetch(heroConfigUrl(), { credentials: 'omit' });
      if (!res.ok) return { mode: 'recent', curatedIds: [], updatedAt: null, updatedBy: null };
      return await res.json();
    } catch (_) {
      return { mode: 'recent', curatedIds: [], updatedAt: null, updatedBy: null };
    }
  }

  async function saveConfig(payload) {
    var headers = { 'Content-Type': 'application/json' };
    try {
      if (typeof window._cfGetAuthHeaders === 'function') {
        var auth = await window._cfGetAuthHeaders();
        Object.keys(auth || {}).forEach(function (k) { headers[k] = auth[k]; });
      }
    } catch (_) {}
    // POST goes direct to the Function App (cross-origin). SWA does NOT proxy
    // POSTs on rewrite routes (returns 405), and direct calls don't carry the
    // EasyAuth principal header — so we ALSO send userId in the body and the
    // function falls back to it (same pattern as cardforgedeckdelete).
    var body = Object.assign({}, payload);
    if (state.principal && state.principal.userId) body.userId = state.principal.userId;
    var res = await fetch(heroConfigUrl(), {
      method: 'POST',
      credentials: 'omit',
      headers: headers,
      body: JSON.stringify(body)
    });
    var resBody = null;
    try { resBody = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, body: resBody };
  }

  // ---- Hero mode logic (mirrors cardforge-splash.js applyHeroMode) ---

  function pickRandom(arr, n) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i]; copy[i] = copy[j]; copy[j] = t;
    }
    return copy.slice(0, n);
  }

  function applyHeroMode(cards, config) {
    var mode = (config && config.mode) || 'recent';
    if (mode === 'random') return pickRandom(cards, 5);
    var recentSorted = cards.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    if (mode === 'curated') {
      var ids = (config && Array.isArray(config.curatedIds)) ? config.curatedIds : [];
      var byId = {};
      cards.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
      var picked = [];
      var seen = {};
      ids.forEach(function (id) {
        if (byId[id] && !seen[id]) { picked.push(byId[id]); seen[id] = true; }
      });
      for (var i = 0; i < recentSorted.length && picked.length < 5; i++) {
        var c = recentSorted[i];
        if (c && c.id && !seen[c.id]) { picked.push(c); seen[c.id] = true; }
      }
      return picked.slice(0, 5);
    }
    return recentSorted.slice(0, 5);
  }

  // ---- Render preview ------------------------------------------------

  function renderCardContent(c) {
    if (c.renderedFront && c.frontClasses) {
      return '<div class="mini-card-scaler"><div class="' + escHtml(c.frontClasses) + '">' + c.renderedFront + '</div></div>';
    }
    return (
      '<div class="cf-mini-fallback">' +
        '<div class="cf-mini-fallback__portrait" style="background-image: ' + cssUrl(c.avatar || '') + ';"></div>' +
        '<div class="cf-mini-fallback__label">' +
          '<span class="cf-mini-fallback__name">' + escHtml(c.name) + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  function renderPreview() {
    if (!els.previewGrid || !els.preview) return;
    var formConfig = readFormAsConfig();
    var picks = applyHeroMode(state.cards, formConfig);
    if (!picks.length) {
      els.previewGrid.innerHTML = '';
      if (els.previewEmpty) els.previewEmpty.hidden = false;
    } else {
      if (els.previewEmpty) els.previewEmpty.hidden = true;
      els.previewGrid.innerHTML = picks.map(function (c) {
        return '<div class="mini-card" data-card-id="' + escHtml(c.id || '') + '">' + renderCardContent(c) + '</div>';
      }).join('');
    }
    els.preview.hidden = false;
  }

  // ---- Form binding --------------------------------------------------

  function readFormAsConfig() {
    var mode = els.modeSelect ? els.modeSelect.value : 'recent';
    var ids = parseCuratedIds(els.curatedTextarea ? els.curatedTextarea.value : '');
    return { mode: mode, curatedIds: ids };
  }

  function fillFormFromConfig(config) {
    if (els.modeSelect) els.modeSelect.value = (config && config.mode) || 'recent';
    if (els.curatedTextarea) {
      var ids = (config && Array.isArray(config.curatedIds)) ? config.curatedIds : [];
      els.curatedTextarea.value = ids.join('\n');
    }
    renderMeta(config);
  }

  function renderMeta(config) {
    if (!els.meta) return;
    if (!config || !config.updatedAt) {
      els.meta.textContent = 'No saved configuration yet — defaults to "Most Recent".';
      return;
    }
    var when = '';
    try { when = new Date(config.updatedAt).toLocaleString(); } catch (_) { when = config.updatedAt; }
    els.meta.innerHTML = '<strong>Last updated:</strong> ' + escHtml(when) +
      ' &middot; <strong>By:</strong> ' + escHtml(config.updatedBy || 'unknown');
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearError();
    hideToast();

    var formConfig = readFormAsConfig();
    var v = validateCurated(formConfig.curatedIds);
    if (!v.ok) {
      showError(v.error);
      return;
    }

    if (els.saveBtn) { els.saveBtn.disabled = true; }
    var result = await saveConfig(formConfig);
    if (els.saveBtn) { els.saveBtn.disabled = false; }

    if (result.ok && result.body) {
      state.config = result.body;
      fillFormFromConfig(result.body);
      renderPreview();
      showToast('success', 'Saved. Splash will pick up changes on next load.');
    } else {
      var msg = (result.body && result.body.error) || ('Save failed (status ' + result.status + ')');
      showToast('error', msg);
    }
  }

  function bindForm() {
    if (els.form) els.form.addEventListener('submit', onSubmit);
    if (els.modeSelect) els.modeSelect.addEventListener('change', renderPreview);
    if (els.curatedTextarea) {
      els.curatedTextarea.addEventListener('input', function () {
        clearError();
        // Live-validate but only re-render preview if currently in curated mode
        if (els.modeSelect && els.modeSelect.value === 'curated') {
          renderPreview();
        }
      });
    }
  }

  // ---- Init ----------------------------------------------------------

  function cacheEls() {
    els.loading = $('cf-admin-loading');
    els.forbidden = $('cf-admin-forbidden');
    els.form = $('cf-admin-form');
    els.modeSelect = $('cf-admin-mode');
    els.curatedTextarea = $('cf-admin-curated');
    els.saveBtn = $('cf-admin-save');
    els.error = $('cf-admin-error');
    els.toast = $('cf-admin-toast');
    els.meta = $('cf-admin-meta');
    els.preview = $('cf-admin-preview');
    els.previewGrid = $('cf-admin-preview-grid');
    els.previewEmpty = $('cf-admin-preview-empty');
  }

  async function init() {
    cacheEls();

    var principal = await fetchPrincipal();
    state.principal = principal;
    renderNavAuth(principal);

    if (!isAdmin(principal)) {
      if (els.loading) els.loading.hidden = true;
      if (els.forbidden) els.forbidden.hidden = false;
      return;
    }

    if (els.loading) els.loading.hidden = true;
    if (els.form) els.form.hidden = false;

    // Fetch cards + current config in parallel.
    var results = await Promise.all([fetchCards(), fetchConfig()]);
    state.cards = results[0] || [];
    state.config = results[1] || { mode: 'recent', curatedIds: [], updatedAt: null, updatedBy: null };

    fillFormFromConfig(state.config);
    bindForm();
    renderPreview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
