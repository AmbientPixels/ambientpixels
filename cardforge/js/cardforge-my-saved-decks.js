/**
 * CardForge — "My Saved Decks" view in the deck builder.
 *
 * Signed-in: reads from cloud via CardForgeDeckStore (per-account).
 * Signed-out: falls back to localStorage.cardforge_decks (browser-local).
 *
 * Renders a tile grid with Edit (→ deck.html?edit={id}) and Delete actions.
 * Shows a "Published" badge when a saved deck also has a shareId. Offers a
 * one-shot migration banner when a signed-in user has local decks but an
 * empty cloud collection.
 *
 * Activated by deck builder's bootMySavedMode().
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cardforge_decks';
  var state = { items: [], boundContainer: null };

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return 'unknown';
    try { return new Date(iso).toLocaleDateString(); } catch (_) { return String(iso); }
  }

  function isSignedIn() {
    try {
      return sessionStorage.getItem('isAuthenticated') === 'true' ||
        (document.body && document.body.getAttribute('data-auth-state') === 'signed-in');
    } catch (_) { return false; }
  }

  function readDecks() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  function writeDecks(decks) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(decks)); } catch (_) {}
  }

  function deleteDeck(deckId) {
    if (!deckId) return;
    var deck = state.items.find(function (d) { return d.id === deckId; });
    var name = (deck && deck.name) || 'this deck';
    if (!confirm('Delete "' + name + '"? Published copies (if any) are not affected.')) return;
    var decks = readDecks().filter(function (d) { return d && d.id !== deckId; });
    writeDecks(decks);
    state.items = decks;
    if (window.CardForgeDeckStore) window.CardForgeDeckStore.pushDelete(deckId);
    var grid = document.getElementById('cf-msd-grid');
    if (grid) renderInto(grid, decks);
  }

  function renderTiles(items) {
    var sorted = items.slice().sort(function (a, b) {
      var ta = Date.parse(a.lastModified || a.createdAt || 0) || 0;
      var tb = Date.parse(b.lastModified || b.createdAt || 0) || 0;
      return tb - ta;
    });
    return sorted.map(function (d) {
      var icon = d.icon || 'fas fa-layer-group';
      var when = fmtDate(d.lastModified || d.createdAt);
      var count = Array.isArray(d.cardIds) ? d.cardIds.length : 0;
      var pubBadge = d.shareId
        ? '<span class="db-msd-badge" title="This deck has a published copy"><i class="fas fa-share-from-square"></i> Published</span>'
        : '';
      return '' +
        '<div class="db-mpd-tile" data-deck-id="' + escHtml(d.id) + '">' +
          '<div class="db-mpd-tile-icon"><i class="' + escHtml(icon) + '"></i></div>' +
          '<div class="db-mpd-tile-name">' + escHtml(d.name || 'Untitled Deck') + '</div>' +
          '<div class="db-mpd-tile-meta">' + count + ' card' + (count === 1 ? '' : 's') + ' &middot; Saved ' + escHtml(when) + ' ' + pubBadge + '</div>' +
          '<div class="db-mpd-tile-actions">' +
            '<button type="button" class="db-btn" data-action="edit"><i class="fas fa-pen"></i> Edit</button>' +
            '<button type="button" class="db-btn db-mpd-unpub" data-action="delete"><i class="fas fa-trash"></i> Delete</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function migrationBannerHTML(localCount) {
    return '' +
      '<div class="db-msd-migrate" id="cf-msd-migrate">' +
        '<div class="db-msd-migrate__text">' +
          '<strong>You have ' + localCount + ' deck' + (localCount === 1 ? '' : 's') + ' on this browser.</strong> ' +
          'Upload them to your account so they appear when you sign in elsewhere?' +
        '</div>' +
        '<div class="db-msd-migrate__actions">' +
          '<button type="button" class="db-btn db-btn-primary" data-action="migrate-upload"><i class="fas fa-cloud-arrow-up"></i> Upload to my account</button>' +
          '<button type="button" class="db-btn" data-action="migrate-keep"><i class="fas fa-xmark"></i> Keep local</button>' +
        '</div>' +
      '</div>';
  }

  function emptyHTML() {
    var note = isSignedIn()
      ? '<small>No saved decks in your account yet. Open the Builder to create one.</small>'
      : '<small>Saved decks live in this browser until you sign in. Sign in to sync across devices.</small>';
    return '<div class="db-mpd-empty">' +
        '<i class="fas fa-floppy-disk"></i>' +
        '<p>No saved decks yet.</p>' +
        note +
      '</div>';
  }

  function renderInto(container, items) {
    if (!container) return;
    var html = '';
    if (window.CardForgeDeckStore && window.CardForgeDeckStore.shouldOfferMigration && window.CardForgeDeckStore.shouldOfferMigration()) {
      html += migrationBannerHTML(items.length);
    }
    if (!items || !items.length) {
      html += emptyHTML();
    } else {
      html += renderTiles(items);
    }
    container.innerHTML = html;
  }

  function bindActions(container) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');

      if (action === 'migrate-upload') {
        if (!window.CardForgeDeckStore) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';
        window.CardForgeDeckStore.migrateLocalToCloud().then(function (res) {
          state.items = readDecks();
          renderInto(container, state.items);
        }).catch(function () {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Upload to my account';
        });
        return;
      }
      if (action === 'migrate-keep') {
        if (window.CardForgeDeckStore) window.CardForgeDeckStore.markMigrationDismissed();
        var banner = document.getElementById('cf-msd-migrate');
        if (banner) banner.remove();
        return;
      }

      var tile = btn.closest('.db-mpd-tile');
      var deckId = tile && tile.getAttribute('data-deck-id');
      if (!deckId) return;
      if (action === 'edit') {
        window.location.href = '/cardforge/deck.html?edit=' + encodeURIComponent(deckId);
      } else if (action === 'delete') {
        deleteDeck(deckId);
      }
    });
  }

  async function mount(container) {
    if (!container) return;
    if (!container._msdBound) {
      container._msdBound = true;
      bindActions(container);
    }
    state.boundContainer = container;

    // First paint from local cache so signed-out works instantly
    state.items = readDecks();
    renderInto(container, state.items);

    // If signed in, wait for cloud boot to finish so we render the
    // per-account list (not a leftover from another account on this browser).
    if (isSignedIn() && window.CardForgeDeckStore && window.CardForgeDeckStore.bootCloudSync) {
      try {
        await window.CardForgeDeckStore.bootCloudSync();
        state.items = readDecks();
        renderInto(container, state.items);
      } catch (_) { /* keep local-only render */ }
    }
  }

  // Re-render when sync completes (e.g. delayed cloud response)
  window.addEventListener('cardforge:decks-synced', function () {
    if (!state.boundContainer) return;
    state.items = readDecks();
    renderInto(state.boundContainer, state.items);
  });

  window.CardForgeMySavedDecks = { mount: mount };
})();
