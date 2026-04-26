/**
 * CardForge — "My Favorites" tab in the editor's Forge sidebar.
 *
 * Fetches /api/cardforgefavorites for the signed-in user's cardIds, then
 * resolves them against /api/cardforgeloadcards. Orphans (cardId in user
 * blob but no longer in published index) are dropped silently.
 *
 * Lazy-loads on first tab activation. Listens to CardForgeHearts.EVENT_CHANGED
 * so unfavoriting in any other surface (gallery, lightbox, splash) updates
 * this list in place.
 *
 * Action buttons per row:
 *   - Edit       — only if the user owns the card (publishedBy === myUserId)
 *   - Unfavorite — always; uses cardforgerate (action='remove') via
 *                  CardForgeHearts.toggle, which itself stops propagation
 *                  and emits EVENT_CHANGED so the row drops out naturally.
 */
(function () {
  'use strict';

  var API_LOAD_CARDS = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';
  var API_FAVORITES = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgefavorites';
  var CACHE_KEY = 'cf_my_favorites_v1';

  var els = {};
  var state = { items: [], loaded: false, loading: false, myUserId: null };

  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return 'unknown';
    try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso; }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return (p && Array.isArray(p.items)) ? p.items : null;
    } catch (_) { return null; }
  }

  function writeCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: items })); }
    catch (_) {}
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  function ownsCard(c, userId) {
    if (!c || !userId) return false;
    var cd = c.cardData || c;
    return c.publishedBy === userId || cd.publishedBy === userId
        || c.userId === userId || cd.userId === userId;
  }

  async function fetchFavoritesList() {
    var headers = {};
    try { headers = await window._cfGetAuthHeaders(); } catch (_) {}
    var res;
    try {
      res = await fetch(API_FAVORITES, {
        method: 'GET',
        credentials: 'omit',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
      });
    } catch (_) { return null; }
    if (!res.ok) return null;
    var data;
    try { data = await res.json(); } catch (_) { return null; }
    return Array.isArray(data && data.cardIds) ? data.cardIds : [];
  }

  async function fetchPublishedPool() {
    var headers = {};
    try { headers = await window._cfGetAuthHeaders(); } catch (_) {}
    var res;
    try {
      res = await fetch(API_LOAD_CARDS, {
        method: 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
      });
    } catch (_) { return []; }
    if (!res.ok) return [];
    var data;
    try { data = await res.json(); } catch (_) { return []; }
    return []
      .concat(data.galleryCards || [])
      .concat(data.defaultCards || [])
      .concat(data.userCards || []);
  }

  async function fetchMyFavorites() {
    var myUserId = window.CardForgePublished
      ? await window.CardForgePublished.getMyUserId()
      : null;
    if (!myUserId) return { signedIn: false, items: [] };
    state.myUserId = myUserId;

    var ids = await fetchFavoritesList();
    if (!ids) return { signedIn: true, items: [], error: 'fetch_failed' };
    if (!ids.length) return { signedIn: true, items: [], myUserId: myUserId };

    var pool = await fetchPublishedPool();
    var byId = {};
    pool.forEach(function (c) {
      var cid = c.id || (c.cardData && c.cardData.id);
      if (cid) byId[cid] = c;
    });

    // Preserve user's blob order (most recently hearted last in our system,
    // but cardIds is just the set — we treat input order as canonical).
    // Drop orphans silently.
    var resolved = ids.map(function (id) { return byId[id]; }).filter(Boolean);
    return { signedIn: true, items: resolved, myUserId: myUserId };
  }

  function renderCardThumb(c) {
    var cd = c.cardData || c;
    if (cd.renderedFront && cd.frontClasses) {
      return '<div class="mini-card-scaler"><div class="' + escHtml(cd.frontClasses) + '">' + cd.renderedFront + '</div></div>';
    }
    var portrait = cd.avatar || c.avatar || '';
    return '<div class="cf-mini-fallback">' +
      '<div class="cf-mini-fallback__portrait" style="background-image: url(\'' + escHtml(portrait) + '\');"></div>' +
      '<div class="cf-mini-fallback__label"><span class="cf-mini-fallback__name">' + escHtml(cd.name || 'Card') + '</span></div>' +
    '</div>';
  }

  function render(result) {
    if (!els.list) return;
    if (els.count) els.count.textContent = result.signedIn ? String(result.items.length || '') : '';
    if (!result.signedIn) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-right-to-bracket"></i><p>Sign in to see your favorites.</p></div>';
      return;
    }
    if (result.error) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load (' + escHtml(result.error) + ').</p><button type="button" class="forge-action-btn" id="cf-fav-retry">Retry</button></div>';
      var retry = $('cf-fav-retry');
      if (retry) retry.addEventListener('click', function () { refresh(true); });
      return;
    }
    if (!result.items.length) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-heart"></i><p>No favorites yet.</p><small>Heart any card in the gallery to bookmark it here.</small></div>';
      return;
    }
    var myUserId = result.myUserId || state.myUserId;
    els.list.innerHTML = result.items.map(function (c) {
      var cd = c.cardData || c;
      var name = cd.name || 'Untitled';
      var when = fmtDate(c.publishDate || cd.publishDate);
      var id = c.id || cd.id || '';
      var canEdit = ownsCard(c, myUserId);
      return '' +
        '<div class="cf-mpc-row" data-card-id="' + escHtml(id) + '">' +
          '<div class="cf-mpc-thumb mini-card">' + renderCardThumb(c) + '</div>' +
          '<div class="cf-mpc-meta">' +
            '<div class="cf-mpc-name">' + escHtml(name) + '</div>' +
            '<div class="cf-mpc-sub">Published ' + escHtml(when) + '</div>' +
            '<div class="cf-mpc-actions">' +
              (canEdit
                ? '<button type="button" class="forge-action-btn cf-fav-load" data-action="load"><i class="fas fa-pen"></i> Edit</button>'
                : '') +
              '<button type="button" class="forge-action-btn cf-fav-unfav" data-action="unfav"><i class="fas fa-heart-crack"></i> Unfavorite</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  async function refresh(force) {
    if (state.loading) return;
    state.loading = true;
    try {
      if (!force) {
        var cached = readCache();
        if (cached && cached.length) {
          state.items = cached;
          render({ signedIn: true, items: cached, myUserId: state.myUserId });
        }
      }
      var result = await fetchMyFavorites();
      state.loaded = true;
      state.items = result.items || [];
      if (result.signedIn && !result.error) writeCache(state.items);
      render(result);
    } finally { state.loading = false; }
  }

  function loadIntoEditor(cardId) {
    if (!cardId || !window.cardForgeActions) return;
    var c = state.items.find(function (x) {
      return (x.id || (x.cardData && x.cardData.id)) === cardId;
    });
    if (c) {
      var actions = window.cardForgeActions;
      actions._mergedCards = actions._mergedCards || [];
      var existing = actions._mergedCards.find(function (x) { return x.id === cardId; });
      if (!existing) actions._mergedCards.push(c);
    }
    window.cardForgeActions.loadCard(cardId);
    var cardsTab = document.querySelector('.forge-sidebar-tab[data-forge-tab="cards"]');
    if (cardsTab) cardsTab.click();
  }

  function unfavoriteCard(cardId) {
    if (!cardId || !window.CardForgeHearts) return;
    // Optimistic — drop the row immediately while CardForgeHearts.toggle
    // handles the network call and emits EVENT_CHANGED. If the server
    // rejects, the EVENT_CHANGED revert path will resync the count and
    // a manual refresh will restore the row.
    state.items = state.items.filter(function (x) {
      return (x.id || (x.cardData && x.cardData.id)) !== cardId;
    });
    writeCache(state.items);
    render({ signedIn: true, items: state.items, myUserId: state.myUserId });
    window.CardForgeHearts.toggle(cardId);
  }

  function bindActions() {
    if (!els.list) return;
    els.list.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var row = btn.closest('.cf-mpc-row');
      var id = row && row.getAttribute('data-card-id');
      if (!id) return;
      var action = btn.getAttribute('data-action');
      if (action === 'load') loadIntoEditor(id);
      else if (action === 'unfav') unfavoriteCard(id);
    });
  }

  function ensureBound() {
    els.tab = document.querySelector('.forge-sidebar-tab[data-forge-tab="favorites"]');
    els.section = document.querySelector('.forge-tab-content[data-forge-content="favorites"]');
    els.list = $('cf-fav-list');
    els.count = $('cf-fav-count');
    if (!els.tab || !els.section || !els.list) return false;
    if (els.tab._favBound) return true;
    els.tab._favBound = true;
    els.tab.addEventListener('click', function () {
      refresh(false);
    });
    bindActions();
    var changedEvent = (window.CardForgeHearts && window.CardForgeHearts.EVENT_CHANGED) || 'cardforge:hearts-changed';
    document.addEventListener(changedEvent, function (e) {
      // If a heart was added (not removed) AND the cardId isn't in our
      // current list, the favorites pool may have grown — refresh if the
      // tab is currently active so the new card appears.
      var detail = e && e.detail;
      if (!detail) return;
      var hasIt = state.items.some(function (x) {
        return (x.id || (x.cardData && x.cardData.id)) === detail.cardId;
      });
      if (detail.hearted && !hasIt && els.section && els.section.classList.contains('active')) {
        clearCache();
        refresh(true);
      }
    });
    return true;
  }

  function init() {
    if (!ensureBound()) {
      setTimeout(ensureBound, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
