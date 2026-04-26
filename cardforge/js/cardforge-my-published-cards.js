/**
 * CardForge — "My Published" tab in the editor's Forge sidebar.
 *
 * Fetches /api/cardforgeloadcards, filters galleryCards by my userId,
 * renders into [data-forge-content="published"] section, supports
 * Load-into-editor (via cardForgeActions.loadCard) and Unpublish
 * (via cardforgedeletecard).
 *
 * Lazy-loads on first tab activation. Listens to
 * cardforge:my-published-changed and refreshes.
 */
(function () {
  'use strict';

  var API_LOAD_CARDS = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';
  var API_DELETE_CARD = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeletecard';
  var CACHE_KEY = 'cf_my_published_cards_v1';

  var els = {};
  var state = { items: [], loaded: false, loading: false };

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

  function matchesUser(c, userId) {
    if (!c || !userId) return false;
    var cd = c.cardData || c;
    return c.publishedBy === userId || cd.publishedBy === userId
        || c.userId === userId || cd.userId === userId;
  }

  async function fetchMyPublishedCards() {
    var myUserId = await window.CardForgePublished.getMyUserId();
    if (!myUserId) return { signedIn: false, items: [] };
    var headers = {};
    try { headers = await window._cfGetAuthHeaders(); } catch (_) {}
    var res;
    try {
      res = await fetch(API_LOAD_CARDS, {
        method: 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
      });
    } catch (_) { return { signedIn: true, items: [], error: 'network' }; }
    if (!res.ok) return { signedIn: true, items: [], error: 'http_' + res.status };
    var data = await res.json();
    var pool = Array.isArray(data && data.galleryCards) ? data.galleryCards : [];
    var mine = pool.filter(function (c) { return matchesUser(c, myUserId); });
    return { signedIn: true, items: mine, myUserId: myUserId };
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
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-right-to-bracket"></i><p>Sign in to see what you\'ve published.</p></div>';
      return;
    }
    if (result.error) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load (' + escHtml(result.error) + ').</p><button type="button" class="forge-action-btn" id="cf-mpc-retry">Retry</button></div>';
      var retry = $('cf-mpc-retry');
      if (retry) retry.addEventListener('click', function () { refresh(true); });
      return;
    }
    if (!result.items.length) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-share-from-square"></i><p>No published cards yet.</p><small>Publish from the editor\'s Ship tab.</small></div>';
      return;
    }
    els.list.innerHTML = result.items.map(function (c) {
      var cd = c.cardData || c;
      var name = cd.name || 'Untitled';
      var when = fmtDate(c.publishDate || cd.publishDate);
      var id = c.id || cd.id || '';
      return '' +
        '<div class="cf-mpc-row" data-card-id="' + escHtml(id) + '">' +
          '<div class="cf-mpc-thumb mini-card">' + renderCardThumb(c) + '</div>' +
          '<div class="cf-mpc-meta">' +
            '<div class="cf-mpc-name">' + escHtml(name) + '</div>' +
            '<div class="cf-mpc-sub">Published ' + escHtml(when) + '</div>' +
            '<div class="cf-mpc-actions">' +
              '<button type="button" class="forge-action-btn cf-mpc-load" data-action="load"><i class="fas fa-pen"></i> Edit</button>' +
              '<button type="button" class="forge-action-btn cf-mpc-unpub" data-action="unpub"><i class="fas fa-trash"></i> Unpublish</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  async function refresh(force) {
    if (state.loading) return;
    state.loading = true;
    try {
      // Render cache instantly if present.
      if (!force) {
        var cached = readCache();
        if (cached && cached.length) {
          state.items = cached;
          render({ signedIn: true, items: cached });
        }
      }
      var result = await fetchMyPublishedCards();
      state.loaded = true;
      state.items = result.items || [];
      if (result.signedIn && !result.error) writeCache(state.items);
      render(result);
    } finally { state.loading = false; }
  }

  function loadIntoEditor(cardId) {
    if (!cardId) return;
    // forge.html (and any non-editor host): cardForgeActions isn't loaded.
    // Stash the card data in sessionStorage so the editor's URL handler
    // can read it directly — avoids a re-fetch through the App Insights /
    // CSRF-wrapped fetch chain that was hanging on resp.json().
    if (!window.cardForgeActions) {
      var cached = state.items.find(function (x) {
        return (x.id || (x.cardData && x.cardData.id)) === cardId;
      });
      if (cached) {
        try { sessionStorage.setItem('cf_edit_card_' + cardId, JSON.stringify(cached)); }
        catch (_) {}
      }
      window.location.href = '/cardforge/editor.html?edit=' + encodeURIComponent(cardId);
      return;
    }
    // Editor sidebar path: load directly into the current session.
    // Push the published card into _mergedCards so loadCard() can find it
    // even if it isn't in localStorage cardforge_saved_cards.
    var c = state.items.find(function (x) { return (x.id || (x.cardData && x.cardData.id)) === cardId; });
    if (c) {
      var actions = window.cardForgeActions;
      actions._mergedCards = actions._mergedCards || [];
      var existing = actions._mergedCards.find(function (x) { return x.id === cardId; });
      if (!existing) actions._mergedCards.push(c);
    }
    window.cardForgeActions.loadCard(cardId);
    // Switch back to My Cards tab so user sees they're now editing.
    var cardsTab = document.querySelector('.forge-sidebar-tab[data-forge-tab="cards"]');
    if (cardsTab) cardsTab.click();
  }

  async function unpublishCard(cardId) {
    if (!cardId) return;
    if (!confirm('Unpublish this card? It will be removed from the public gallery. Your saved card is not affected.')) return;
    var myUserId = await window.CardForgePublished.getMyUserId();
    if (!myUserId) { alert('Sign in required.'); return; }
    // Direct call to the Function App (cross-origin). SWA does NOT proxy POSTs
    // on rewrite routes (returns 405) and won't inject x-ms-client-principal —
    // so we pass userId in the body and use credentials:'omit'. Same pattern
    // as cardforgedeckdelete and the corrected hero-config admin flow.
    var res;
    try {
      res = await fetch(API_DELETE_CARD, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        // mode:'unpublish' = remove from gallery only; the user's draft stays.
        body: JSON.stringify({ cardId: cardId, userId: myUserId, mode: 'unpublish' })
      });
    } catch (_) { alert('Network error — try again.'); return; }
    if (!res.ok) {
      var msg = 'Unpublish failed (' + res.status + ').';
      try { var b = await res.json(); if (b && b.error) msg = b.error; } catch (_) {}
      alert(msg);
      return;
    }
    state.items = state.items.filter(function (x) { return (x.id || (x.cardData && x.cardData.id)) !== cardId; });
    writeCache(state.items);
    render({ signedIn: true, items: state.items });
    window.CardForgePublished.notifyChanged({ kind: 'card', action: 'unpublish', id: cardId });
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
      else if (action === 'unpub') unpublishCard(id);
    });
  }

  function ensureBound() {
    els.tab = document.querySelector('.forge-sidebar-tab[data-forge-tab="published"]');
    els.section = document.querySelector('.forge-tab-content[data-forge-content="published"]');
    els.list = $('cf-mpc-list');
    els.count = $('cf-mpc-count');
    if (!els.tab || !els.section || !els.list) return false;
    if (els.tab._mpcBound) return true;
    els.tab._mpcBound = true;
    els.tab.addEventListener('click', function () {
      // Lazy-load on first activation, refresh on subsequent.
      refresh(false);
    });
    bindActions();
    window.addEventListener(window.CardForgePublished.EVENT, function () {
      clearCache();
      if (els.section.classList.contains('active')) refresh(true);
    });
    return true;
  }

  function init() {
    if (!ensureBound()) {
      // Editor markup may not be in the DOM yet — retry once after load.
      setTimeout(ensureBound, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
