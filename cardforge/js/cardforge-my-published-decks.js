/**
 * CardForge — "My Published Decks" view in the deck builder.
 *
 * Fetches /api/cardforgedeckload (no shareId), filters publishedDecks
 * by my userId, renders a tile grid. Supports Load-into-builder
 * (navigate to deck.html?edit={localDeckId} if a local deck has the
 * matching shareId; otherwise hydrate snapshot fresh) and Unpublish
 * (POST /api/cardforgedeckdelete).
 *
 * Activated by deck builder's bootMyPublishedMode() — see Task 6.
 */
(function () {
  'use strict';

  var API_DECK_LOAD = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeckload';
  var API_DECK_DELETE = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeckdelete';
  var CACHE_KEY = 'cf_my_published_decks_v1';

  var state = { items: [], loading: false };

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

  async function fetchMyPublishedDecks() {
    var myUserId = await window.CardForgePublished.getMyUserId();
    if (!myUserId) return { signedIn: false, items: [] };
    var res;
    try {
      res = await fetch(API_DECK_LOAD, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    } catch (_) { return { signedIn: true, items: [], error: 'network' }; }
    if (!res.ok) return { signedIn: true, items: [], error: 'http_' + res.status };
    var data = await res.json();
    var pool = Array.isArray(data && data.publishedDecks) ? data.publishedDecks : [];
    var mine = pool.filter(function (d) { return d && d.userId === myUserId; });
    return { signedIn: true, items: mine, myUserId: myUserId };
  }

  function findLocalDeckByShareId(shareId) {
    try {
      var decks = JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
      return decks.find(function (d) { return d && d.shareId === shareId; }) || null;
    } catch (_) { return null; }
  }

  function loadIntoBuilder(deck) {
    if (!deck || !deck.shareId) return;
    var localMatch = findLocalDeckByShareId(deck.shareId);
    if (localMatch && localMatch.id) {
      window.location.href = '/cardforge/deck.html?edit=' + encodeURIComponent(localMatch.id);
      return;
    }
    // No local copy — synthesize one from the published snapshot, save, then edit.
    var newId = 'deck_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var synthetic = {
      id: newId,
      shareId: deck.shareId,
      name: deck.name || 'Untitled Deck',
      icon: deck.icon || 'fas fa-layer-group',
      description: deck.description || '',
      tags: deck.tags || [],
      cardIds: Array.isArray(deck.cardIds) ? deck.cardIds.slice()
            : (Array.isArray(deck.cards) ? deck.cards.map(function (c) { return c.id; }).filter(Boolean) : []),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    try {
      var decks = JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
      decks.unshift(synthetic);
      localStorage.setItem('cardforge_decks', JSON.stringify(decks));
    } catch (_) {}
    window.location.href = '/cardforge/deck.html?edit=' + encodeURIComponent(newId);
  }

  async function unpublishDeck(shareId) {
    if (!shareId) return;
    if (!confirm('Unpublish this deck? It will be removed from the public gallery. Your local deck (if any) is not affected.')) return;
    var myUserId = await window.CardForgePublished.getMyUserId();
    if (!myUserId) { alert('Sign in required.'); return; }
    // Direct call to the Function App (cross-origin). Same userId-in-body
    // pattern as cardforgedeckdelete and the hero-config admin flow.
    var res;
    try {
      res = await fetch(API_DECK_DELETE, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId: shareId, userId: myUserId })
      });
    } catch (_) { alert('Network error — try again.'); return; }
    if (!res.ok) {
      var msg = 'Unpublish failed (' + res.status + ').';
      try { var b = await res.json(); if (b && b.error) msg = b.error; } catch (_) {}
      alert(msg);
      return;
    }
    state.items = state.items.filter(function (x) { return x.shareId !== shareId; });
    writeCache(state.items);
    var grid = document.getElementById('cf-mpd-grid');
    if (grid) renderInto(grid, { signedIn: true, items: state.items });
    window.CardForgePublished.notifyChanged({ kind: 'deck', action: 'unpublish', shareId: shareId });
  }

  function renderInto(container, result) {
    if (!container) return;
    if (!result.signedIn) {
      container.innerHTML = '<div class="db-mpd-empty"><i class="fas fa-right-to-bracket"></i><p>Sign in to see what you\'ve published.</p></div>';
      return;
    }
    if (result.error) {
      container.innerHTML = '<div class="db-mpd-empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load (' + escHtml(result.error) + ').</p></div>';
      return;
    }
    if (!result.items.length) {
      container.innerHTML = '<div class="db-mpd-empty"><i class="fas fa-share-from-square"></i><p>No published decks yet.</p><small>Publish from the deck builder.</small></div>';
      return;
    }
    container.innerHTML = result.items.map(function (d) {
      var icon = d.icon || 'fas fa-layer-group';
      var when = fmtDate(d.publishedAt || d.publishDate || d.createdAt);
      var count = (typeof d.cardCount === 'number') ? d.cardCount : (Array.isArray(d.cardIds) ? d.cardIds.length : 0);
      return '' +
        '<div class="db-mpd-tile" data-share-id="' + escHtml(d.shareId) + '">' +
          '<div class="db-mpd-tile-icon"><i class="' + escHtml(icon) + '"></i></div>' +
          '<div class="db-mpd-tile-name">' + escHtml(d.name || 'Untitled Deck') + '</div>' +
          '<div class="db-mpd-tile-meta">' + count + ' card' + (count === 1 ? '' : 's') + ' · Published ' + escHtml(when) + '</div>' +
          '<div class="db-mpd-tile-actions">' +
            '<button type="button" class="db-btn db-mpd-load" data-action="load"><i class="fas fa-pen"></i> Edit</button>' +
            '<button type="button" class="db-btn db-mpd-unpub" data-action="unpub"><i class="fas fa-trash"></i> Unpublish</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function bindActions(container) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var tile = btn.closest('.db-mpd-tile');
      var shareId = tile && tile.getAttribute('data-share-id');
      if (!shareId) return;
      var deck = state.items.find(function (x) { return x.shareId === shareId; });
      var action = btn.getAttribute('data-action');
      if (action === 'load') loadIntoBuilder(deck);
      else if (action === 'unpub') unpublishDeck(shareId);
    });
  }

  /**
   * Public entry — called by deck builder's bootMyPublishedMode().
   * Renders into the given container. Consumes cache instantly,
   * then refreshes from API and re-renders if items changed.
   */
  async function mount(container) {
    if (!container) return;
    if (!container._mpdBound) {
      container._mpdBound = true;
      bindActions(container);
    }
    // Render cache instantly.
    var cached = readCache();
    if (cached && cached.length) {
      state.items = cached;
      renderInto(container, { signedIn: true, items: cached });
    } else {
      container.innerHTML = '<div class="db-mpd-empty"><i class="fas fa-spinner fa-spin"></i><p>Loading…</p></div>';
    }
    state.loading = true;
    try {
      var result = await fetchMyPublishedDecks();
      state.items = result.items || [];
      if (result.signedIn && !result.error) writeCache(state.items);
      renderInto(container, result);
    } finally { state.loading = false; }
  }

  // Listen for invalidation events globally.
  // Bind via setTimeout so window.CardForgePublished (loaded by the helper
  // module) is guaranteed available by the time we read .EVENT.
  setTimeout(function () {
    var eventName = (window.CardForgePublished && window.CardForgePublished.EVENT) || 'cardforge:my-published-changed';
    window.addEventListener(eventName, function () {
      clearCache();
      var grid = document.getElementById('cf-mpd-grid');
      if (grid) mount(grid);
    });
  }, 0);

  window.CardForgeMyPublishedDecks = { mount: mount };
})();
