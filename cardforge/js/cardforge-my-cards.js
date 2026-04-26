/**
 * CardForge — "My Cards" (drafts) panel for the dedicated /cardforge/forge.html.
 *
 * Loaded only on forge.html. Fetches userCards from /api/cardforgeloadcards and
 * renders into #my-cards-list. Provides Edit (-> editor with ?card=) and
 * Delete (-> cardforgedeletecard) actions per row. Mirrors the visual idiom
 * of cardforge-my-published-cards.js so all four panels feel consistent.
 *
 * Listens to cardforge:my-published-changed so refresh kicks in after an
 * unpublish elsewhere (the unpublish flow leaves the draft in place but
 * flips its published flag).
 */
(function () {
  'use strict';

  var API_LOAD_CARDS = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';
  var API_DELETE_CARD = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeletecard';
  var CACHE_KEY = 'cf_my_drafts_v1';

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
    try { return new Date(iso).toLocaleDateString(); } catch (_) { return String(iso); }
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

  async function fetchMyCards() {
    var myUserId = window.CardForgePublished
      ? await window.CardForgePublished.getMyUserId()
      : null;
    if (!myUserId) return { signedIn: false, items: [] };
    state.myUserId = myUserId;

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

    var data;
    try { data = await res.json(); } catch (_) { return { signedIn: true, items: [], error: 'parse' }; }

    var pool = Array.isArray(data && data.userCards) ? data.userCards : [];
    pool.sort(function (a, b) {
      var ad = (a && (a.lastModified || (a.cardData && a.cardData.lastModified) || a.createdAt || (a.cardData && a.cardData.createdAt))) || 0;
      var bd = (b && (b.lastModified || (b.cardData && b.cardData.lastModified) || b.createdAt || (b.cardData && b.cardData.createdAt))) || 0;
      return new Date(bd).getTime() - new Date(ad).getTime();
    });
    return { signedIn: true, items: pool, myUserId: myUserId };
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
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-right-to-bracket"></i><p>Sign in to see your drafts.</p></div>';
      return;
    }
    if (result.error) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load (' + escHtml(result.error) + ').</p><button type="button" class="forge-action-btn" id="cf-mc-retry">Retry</button></div>';
      var retry = $('cf-mc-retry');
      if (retry) retry.addEventListener('click', function () { refresh(true); });
      return;
    }
    if (!result.items.length) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-layer-group"></i><p>No drafts yet.</p><small>Open the editor to forge your first card.</small></div>';
      return;
    }
    els.list.innerHTML = result.items.map(function (c) {
      var cd = c.cardData || c;
      var name = cd.name || 'Untitled';
      var when = fmtDate(cd.lastModified || cd.savedAt || cd.updatedAt || cd.createdAt || c.createdAt);
      var id = c.id || cd.id || '';
      var isPublished = !!(c.published || cd.published);
      return '' +
        '<div class="cf-mpc-row" data-card-id="' + escHtml(id) + '">' +
          '<div class="cf-mpc-thumb mini-card">' + renderCardThumb(c) + '</div>' +
          '<div class="cf-mpc-meta">' +
            '<div class="cf-mpc-name">' + escHtml(name) +
              (isPublished ? ' <span class="cf-mpc-badge">Published</span>' : '') +
            '</div>' +
            '<div class="cf-mpc-sub">Saved ' + escHtml(when) + '</div>' +
            '<div class="cf-mpc-actions">' +
              '<button type="button" class="forge-action-btn" data-action="edit"><i class="fas fa-pen"></i> Edit</button>' +
              '<button type="button" class="forge-action-btn cf-mpc-unpub" data-action="delete"><i class="fas fa-trash"></i> Delete</button>' +
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
      var result = await fetchMyCards();
      state.loaded = true;
      state.items = result.items || [];
      if (result.signedIn && !result.error) writeCache(state.items);
      render(result);
    } finally { state.loading = false; }
  }

  function editCard(cardId) {
    if (!cardId) return;
    // Stash the card data in sessionStorage so the editor's URL handler
    // can read it directly without re-fetching through wrapped fetch.
    var cached = state.items.find(function (x) {
      return (x.id || (x.cardData && x.cardData.id)) === cardId;
    });
    if (cached) {
      try { sessionStorage.setItem('cf_edit_card_' + cardId, JSON.stringify(cached)); }
      catch (_) {}
    }
    // ?edit= triggers the editor's auto-load handler.
    // ?card= is reserved for the lightbox overlay deep-link on editor.html
    // and gallery.html, so we deliberately pick a different param here.
    window.location.href = '/cardforge/editor.html?edit=' + encodeURIComponent(cardId);
  }

  async function deleteCard(cardId) {
    if (!cardId) return;
    if (!confirm('Delete this draft? This removes it from your collection. If it\'s also published, the published copy stays in the gallery.')) return;
    var myUserId = state.myUserId || (window.CardForgePublished && await window.CardForgePublished.getMyUserId());
    if (!myUserId) { alert('Sign in required.'); return; }
    var res;
    try {
      res = await fetch(API_DELETE_CARD, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: cardId, userId: myUserId, scope: 'user' })
      });
    } catch (_) { alert('Network error — try again.'); return; }
    if (!res.ok) {
      var msg = 'Delete failed (' + res.status + ').';
      try { var b = await res.json(); if (b && b.error) msg = b.error; } catch (_) {}
      alert(msg);
      return;
    }
    state.items = state.items.filter(function (x) { return (x.id || (x.cardData && x.cardData.id)) !== cardId; });
    writeCache(state.items);
    render({ signedIn: true, items: state.items, myUserId: state.myUserId });
    if (window.CardForgePublished) window.CardForgePublished.notifyChanged({ kind: 'card', action: 'delete', id: cardId });
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
      if (action === 'edit') editCard(id);
      else if (action === 'delete') deleteCard(id);
    });
  }

  function mount(container) {
    els.list = container || $('my-cards-list');
    els.count = $('my-cards-count');
    if (!els.list) return;
    bindActions();
    refresh(false);

    var changed = (window.CardForgePublished && window.CardForgePublished.EVENT) || 'cardforge:my-published-changed';
    window.addEventListener(changed, function () { clearCache(); refresh(true); });
  }

  window.CardForgeMyCards = { mount: mount, refresh: refresh };
})();
