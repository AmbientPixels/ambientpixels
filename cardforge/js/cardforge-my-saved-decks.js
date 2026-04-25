/**
 * CardForge — "My Saved Decks" view in the deck builder.
 *
 * Reads localStorage.cardforge_decks and renders a tile grid with
 * Edit (→ deck.html?edit={id}) and Delete actions. A "Published"
 * badge is shown when a saved deck also has a shareId.
 *
 * Activated by deck builder's bootMySavedMode().
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cardforge_decks';
  var state = { items: [] };

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return 'unknown';
    try { return new Date(iso).toLocaleDateString(); } catch (_) { return String(iso); }
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
    if (!confirm('Delete "' + name + '"? This removes it from your browser. Published copies (if any) are not affected.')) return;
    var decks = readDecks().filter(function (d) { return d && d.id !== deckId; });
    writeDecks(decks);
    state.items = decks;
    var grid = document.getElementById('cf-msd-grid');
    if (grid) renderInto(grid, decks);
  }

  function renderInto(container, items) {
    if (!container) return;
    if (!items || !items.length) {
      container.innerHTML =
        '<div class="db-mpd-empty">' +
          '<i class="fas fa-floppy-disk"></i>' +
          '<p>No saved decks yet.</p>' +
          '<small>Saved decks live in this browser. Switching browsers or clearing site data will clear them.</small>' +
        '</div>';
      return;
    }
    var sorted = items.slice().sort(function (a, b) {
      var ta = Date.parse(a.lastModified || a.createdAt || 0) || 0;
      var tb = Date.parse(b.lastModified || b.createdAt || 0) || 0;
      return tb - ta;
    });
    container.innerHTML = sorted.map(function (d) {
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

  function bindActions(container) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var tile = btn.closest('.db-mpd-tile');
      var deckId = tile && tile.getAttribute('data-deck-id');
      if (!deckId) return;
      var action = btn.getAttribute('data-action');
      if (action === 'edit') {
        window.location.href = '/cardforge/deck.html?edit=' + encodeURIComponent(deckId);
      } else if (action === 'delete') {
        deleteDeck(deckId);
      }
    });
  }

  function mount(container) {
    if (!container) return;
    if (!container._msdBound) {
      container._msdBound = true;
      bindActions(container);
    }
    state.items = readDecks();
    renderInto(container, state.items);
  }

  window.CardForgeMySavedDecks = { mount: mount };
})();
