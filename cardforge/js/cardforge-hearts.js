/**
 * CardForge Hearts — shared client module for the rating + favorites system.
 * Loaded on splash, gallery, lightbox, editor (My Favorites tab).
 *
 * Hybrid model:
 *  - Anonymous viewers can heart cards (count bumps; "hearted" state
 *    lives only in their browser localStorage).
 *  - Authenticated users get full favorites: cross-device sync via
 *    server blob, plus the My Favorites tab in the editor.
 *  - Aggregate count (`card-ratings.json`) reflects votes from BOTH
 *    audiences and drives the gallery "Highest Rated" sort + the
 *    splash "highest-rated" hero mode.
 *
 * The module exposes window.CardForgeHearts:
 *   init()                            — boot; parallel-fetch aggregate + favorites
 *   getCount(cardId)                  — sync, returns int (0 if unknown)
 *   isFavorited(cardId)               — sync, union of auth + anon sets
 *   toggle(cardId, opts)              — async, optimistic; anon stays anon
 *   renderButton(cardId, options)     — returns HTML for a heart button
 *   bindContainer(rootEl)             — delegated click handler on rootEl
 *   EVENT_CHANGED                     — 'cardforge:hearts-changed' for cross-component sync
 */
(function () {
  'use strict';

  var API_BASE = 'https://ambientpixels-nova-api.azurewebsites.net/api';
  var API_RATINGS = API_BASE + '/cardforgeratings';
  var API_FAVORITES = API_BASE + '/cardforgefavorites';
  var API_RATE = API_BASE + '/cardforgerate';

  var EVENT_CHANGED = 'cardforge:hearts-changed';
  var AGG_CACHE_KEY = 'cf_hearts_agg_v1';
  var AGG_CACHE_TTL_MS = 30 * 1000; // 30 seconds — see plan
  var ANON_FAVORITES_KEY = 'cf_anon_hearts'; // localStorage — anon "I hearted this" state
  var CLICK_DEBOUNCE_MS = 500;

  // ---- State ----
  var ratings = {};            // { cardId: count } — public aggregate
  var favorites = new Set();   // authenticated user's hearted cardIds (server-backed)
  var anonFavorites = new Set(); // anonymous user's hearted cardIds (localStorage-backed)
  var inFlight = new Set();    // cardIds currently mid-toggle
  var lastClickAt = 0;
  var booted = false;

  // ---- Utility ----
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function track(event, props) {
    if (window.ProductAnalytics && typeof window.ProductAnalytics.track === 'function') {
      try { window.ProductAnalytics.track(event, props || {}); } catch (_) {}
    }
  }

  function readCache(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.savedAt !== 'number') return null;
      if (Date.now() - parsed.savedAt > AGG_CACHE_TTL_MS) return null;
      return parsed.value;
    } catch (_) { return null; }
  }

  function writeCache(key, value) {
    try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value: value })); } catch (_) {}
  }

  function dispatchChanged(cardId, count, hearted) {
    var ev;
    try {
      ev = new CustomEvent(EVENT_CHANGED, { detail: { cardId: cardId, count: count, hearted: hearted } });
    } catch (_) {
      ev = document.createEvent('CustomEvent');
      ev.initCustomEvent(EVENT_CHANGED, false, false, { cardId: cardId, count: count, hearted: hearted });
    }
    document.dispatchEvent(ev);
  }

  // ---- API calls ----
  async function fetchRatings() {
    var cached = readCache(AGG_CACHE_KEY);
    if (cached && cached.ratings) return cached.ratings;
    try {
      var res = await fetch(API_RATINGS, { credentials: 'omit' });
      if (!res.ok) return {};
      var data = await res.json();
      var agg = (data && data.ratings) || {};
      writeCache(AGG_CACHE_KEY, { ratings: agg });
      return agg;
    } catch (_) { return {}; }
  }

  async function fetchFavorites() {
    try {
      var headers = {};
      if (typeof window._cfGetAuthHeaders === 'function') {
        try { headers = await window._cfGetAuthHeaders(); } catch (_) {}
      }
      var res = await fetch(API_FAVORITES, { headers: headers, credentials: 'omit' });
      if (!res.ok) return [];
      var data = await res.json();
      return (data && Array.isArray(data.cardIds)) ? data.cardIds : [];
    } catch (_) { return []; }
  }

  async function postRate(cardId, action) {
    var headers = { 'Content-Type': 'application/json' };
    if (typeof window._cfGetAuthHeaders === 'function') {
      try {
        var auth = await window._cfGetAuthHeaders();
        Object.keys(auth || {}).forEach(function (k) { headers[k] = auth[k]; });
      } catch (_) {}
    }
    var res = await fetch(API_RATE, {
      method: 'POST',
      headers: headers,
      credentials: 'omit',
      body: JSON.stringify({ cardId: cardId, action: action })
    });
    if (res.status === 401) {
      var err = new Error('Authentication required');
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      var err2 = new Error('Rate request failed: ' + res.status);
      err2.status = res.status;
      throw err2;
    }
    return res.json();
  }

  async function isSignedIn() {
    if (typeof window._cfGetAuthHeaders !== 'function') return false;
    try {
      var headers = await window._cfGetAuthHeaders();
      return !!(headers && headers['X-CF-Auth-Principal']);
    } catch (_) { return false; }
  }

  // ---- Anonymous favorites (localStorage-backed) ----
  // Anonymous viewers don't have a server blob, so we track their
  // hearted state per-browser only. Clearing localStorage forgets the
  // state but doesn't decrement the public aggregate (server has no
  // way to dedup anon actions, so it trusts the client). The aggregate
  // count therefore ratchets monotonically forward for anon — that's
  // expected and matches every other anon-vote system.
  function loadAnonFavorites() {
    try {
      var raw = localStorage.getItem(ANON_FAVORITES_KEY);
      if (!raw) return new Set();
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.cardIds)) return new Set();
      return new Set(parsed.cardIds);
    } catch (_) { return new Set(); }
  }

  function persistAnonFavorites() {
    try {
      var payload = { cardIds: Array.from(anonFavorites), updatedAt: Date.now() };
      localStorage.setItem(ANON_FAVORITES_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  // ---- Public API ----
  function getCount(cardId) {
    if (!cardId) return 0;
    return Number(ratings[cardId] || 0);
  }

  function isFavorited(cardId) {
    if (!cardId) return false;
    return favorites.has(cardId) || anonFavorites.has(cardId);
  }

  // Optimistic toggle. UI updates instantly; on failure we revert and
  // emit an error event so any subscribed component can re-sync.
  // Hybrid auth model:
  //   - Signed in: server tracks user blob + aggregate. Cross-device sync.
  //   - Anonymous: localStorage tracks "I hearted this" state; server
  //     just bumps/decrements the aggregate. Per-IP rate limit on the
  //     server gates abuse.
  async function toggle(cardId, opts) {
    if (!cardId) return;
    var now = Date.now();
    if (now - lastClickAt < CLICK_DEBOUNCE_MS) return;
    lastClickAt = now;
    if (inFlight.has(cardId)) return;

    var signedIn = await isSignedIn();
    var activeSet = signedIn ? favorites : anonFavorites;
    var hadBefore = activeSet.has(cardId);
    var action = hadBefore ? 'remove' : 'add';
    var prevCount = getCount(cardId);
    var optimisticCount = Math.max(0, prevCount + (action === 'add' ? 1 : -1));

    // Optimistic UI update on the appropriate set.
    if (action === 'add') activeSet.add(cardId); else activeSet.delete(cardId);
    if (!signedIn) persistAnonFavorites();
    ratings[cardId] = optimisticCount;
    dispatchChanged(cardId, optimisticCount, action === 'add');

    inFlight.add(cardId);
    try {
      var result = await postRate(cardId, action);
      // Server is authoritative on the aggregate count. For auth users
      // it's also authoritative on hearted state (`result.hearted`);
      // for anon, server just echoes our action — we keep client truth.
      var serverCount = Number(result.count || 0);
      ratings[cardId] = serverCount;
      if (signedIn) {
        if (result.hearted) favorites.add(cardId); else favorites.delete(cardId);
      }
      // Refresh cache so other tabs see the new count within TTL.
      writeCache(AGG_CACHE_KEY, { ratings: ratings });
      track('cardforge.heart.' + (action === 'add' ? 'add' : 'remove'),
        { cardId: cardId, count: serverCount, anonymous: !signedIn });
      dispatchChanged(cardId, serverCount, action === 'add');
    } catch (err) {
      // Revert optimistic update on the active set.
      if (hadBefore) activeSet.add(cardId); else activeSet.delete(cardId);
      if (!signedIn) persistAnonFavorites();
      ratings[cardId] = prevCount;
      dispatchChanged(cardId, prevCount, hadBefore);
      track('cardforge.heart.error',
        { cardId: cardId, action: action, status: err && err.status, anonymous: !signedIn });
      console.warn('[CardForgeHearts] toggle failed:', err);
    } finally {
      inFlight.delete(cardId);
    }
  }

  // Returns HTML string for a heart button. Variants:
  //   { withCount: true }           — gallery (icon + count)
  //   { variant: 'splash' }         — splash showcase + hero fan (icon only, smaller)
  //   { variant: 'lightbox' }       — used inside lightbox actions row (label included)
  function renderButton(cardId, options) {
    var opts = options || {};
    var withCount = !!opts.withCount;
    var variant = opts.variant || 'gallery';
    var hearted = isFavorited(cardId);
    var count = getCount(cardId);
    var classes = ['cf-heart'];
    if (variant === 'splash') classes.push('cf-heart--splash');
    if (variant === 'lightbox') classes.push('cf-heart--lightbox');
    if (withCount) classes.push('cf-heart--with-count');
    if (hearted) classes.push('is-active');
    var label = hearted ? 'Remove from favorites' : 'Add to favorites';
    var countMarkup = withCount
      ? '<span class="cf-heart__count" data-cf-heart-count="' + escHtml(cardId) + '">' + (count > 0 ? count : '') + '</span>'
      : '';
    var labelMarkup = (variant === 'lightbox')
      ? '<span class="cf-heart__label">' + (hearted ? 'Hearted' : 'Heart') + '</span>'
      : '';
    return (
      '<button type="button" class="' + classes.join(' ') + '" ' +
        'data-cf-heart="' + escHtml(cardId) + '" ' +
        'aria-pressed="' + (hearted ? 'true' : 'false') + '" ' +
        'aria-label="' + label + '">' +
        '<i class="fas fa-heart" aria-hidden="true"></i>' +
        labelMarkup +
        countMarkup +
      '</button>'
    );
  }

  // Updates an existing heart button DOM node in place — used after toggle
  // so we don't re-render the whole grid. Looks for [data-cf-heart="<id>"]
  // descendants under root (defaults to document).
  function refreshButtons(cardId, root) {
    var scope = root || document;
    var btns = scope.querySelectorAll('[data-cf-heart="' + cardId + '"]');
    var hearted = isFavorited(cardId);
    var count = getCount(cardId);
    btns.forEach(function (btn) {
      btn.setAttribute('aria-pressed', hearted ? 'true' : 'false');
      btn.setAttribute('aria-label', hearted ? 'Remove from favorites' : 'Add to favorites');
      if (hearted) btn.classList.add('is-active'); else btn.classList.remove('is-active');
      var label = btn.querySelector('.cf-heart__label');
      if (label) label.textContent = hearted ? 'Hearted' : 'Heart';
      var countEl = btn.querySelector('[data-cf-heart-count]');
      if (countEl) countEl.textContent = count > 0 ? count : '';
    });
  }

  // Delegated click handler. Call once per container with hearts inside.
  // Uses CAPTURE phase so the heart handler runs BEFORE any ancestor click
  // (the card tile is a <button> on gallery and an <a> on splash, both of
  // which would otherwise fire their own click — opening the lightbox or
  // navigating away — before our bubble-phase handler could stopPropagation).
  function bindContainer(rootEl) {
    if (!rootEl || rootEl.__cfHeartsBound) return;
    rootEl.__cfHeartsBound = true;
    rootEl.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-cf-heart]');
      if (!btn) return;
      if (!rootEl.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var cardId = btn.getAttribute('data-cf-heart');
      toggle(cardId);
    }, true);
  }

  // Cross-component sync — when any heart toggles anywhere, refresh all
  // visible buttons for that card.
  document.addEventListener(EVENT_CHANGED, function (e) {
    var cardId = e.detail && e.detail.cardId;
    if (!cardId) return;
    refreshButtons(cardId);
  });

  async function init() {
    if (booted) return;
    booted = true;
    // Load anon favorites from localStorage synchronously so the heart
    // UI reflects state immediately on first paint, even before the
    // server fetches resolve.
    anonFavorites = loadAnonFavorites();
    var results = await Promise.all([fetchRatings(), fetchFavorites()]);
    ratings = results[0] || {};
    favorites = new Set(results[1] || []);
  }

  window.CardForgeHearts = {
    init: init,
    getCount: getCount,
    isFavorited: isFavorited,
    toggle: toggle,
    renderButton: renderButton,
    refreshButtons: refreshButtons,
    bindContainer: bindContainer,
    EVENT_CHANGED: EVENT_CHANGED
  };

  // Auto-init on every page that loads this module. Splash + gallery also
  // call init() explicitly to await the boot before rendering, but pages
  // that just need on-demand reads (editor, lightbox) get hearts state
  // populated without special wiring. init() is idempotent.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
