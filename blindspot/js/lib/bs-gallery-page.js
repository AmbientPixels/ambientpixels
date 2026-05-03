/**
 * bs-gallery-page.js — Public Gallery render + detail modal.
 *
 * Phase 2 of the gallery split: extracts renderGallery + openGalleryDetail +
 * closeGalleryDetail out of blindspot-flow.js into a self-contained module
 * that gallery.html can use without loading the lobby/battle/forge monolith.
 *
 * Dependencies (all on window):
 *   BsUtils.escapeHtml          — string escaping
 *   BsCardRenderer.render       — full card HTML
 *   BsCardRenderer.ensureCombatStats — stat normalization
 *   ArenaAPI.loadCards          — fetch published gallery cards
 *   buildApiPath                — admin config endpoints
 *
 * Public API: window.BsGalleryPage
 *   .init()    — wire the close button + backdrop click handlers (idempotent)
 *   .render()  — fetch + render the gallery grid; returns a Promise
 */
(function () {
  'use strict';

  function escHtml(s) {
    return (window.BsUtils && window.BsUtils.escapeHtml)
      ? window.BsUtils.escapeHtml(String(s))
      : String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }

  function renderCardHTML(card, size) {
    if (window.BsCardRenderer && window.BsCardRenderer.render) {
      return window.BsCardRenderer.render(card, size);
    }
    return '';
  }

  function ensureCombatStats(card) {
    if (window.BsCardRenderer && window.BsCardRenderer.ensureCombatStats) {
      window.BsCardRenderer.ensureCombatStats(card);
    }
  }

  function fetchAdminConfig(key) {
    var url = window.buildApiPath
      ? window.buildApiPath('adminConfig', { key: key })
      : '/api/blindspotadminconfig?key=' + key;
    return fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  async function render() {
    var grid = document.getElementById('bs-gallery-grid');
    var countEl = document.getElementById('bs-gallery-count');
    if (!grid) return;
    grid.innerHTML = '<div class="bs-gallery__loading"><i class="fas fa-spinner fa-spin"></i> Loading cards…</div>';
    if (countEl) countEl.textContent = '';

    try {
      var responses = await Promise.all([
        window.ArenaAPI.loadCards(),
        fetchAdminConfig('moderation'),
        fetchAdminConfig('gallery')
      ]);
      var data = responses[0];
      var modConfig = responses[1];
      var galleryConfig = responses[2];

      var hiddenIds = new Set((modConfig && Array.isArray(modConfig.hiddenIds)) ? modConfig.hiddenIds : []);
      var mode = (galleryConfig && galleryConfig.mode) || 'recent';
      var curatedIds = (galleryConfig && Array.isArray(galleryConfig.curatedIds)) ? galleryConfig.curatedIds : [];

      var cards = (data.galleryCards || []).filter(function (c) {
        if (!c) return false;
        if (c.publishedToGallery === false) return false;
        var hasArt = c.avatar || c.image || c.imageUrl || c.art;
        if (!hasArt) return false;
        if (hiddenIds.has(c.id)) return false;
        return true;
      });

      if (mode === 'curated' && curatedIds.length > 0) {
        var byId = new Map();
        for (var i = 0; i < cards.length; i++) byId.set(cards[i].id, cards[i]);
        cards = curatedIds.map(function (id) { return byId.get(id); }).filter(Boolean);
      } else if (mode === 'random') {
        cards = cards.slice();
        for (var j = cards.length - 1; j > 0; j--) {
          var k = Math.floor(Math.random() * (j + 1));
          var t = cards[j]; cards[j] = cards[k]; cards[k] = t;
        }
      } else {
        // 'recent' (default) and 'highest-rated' fallback
        cards = cards.slice().sort(function (a, b) {
          var ta = a.publishDate || a.publishedAt || a.createdAt || 0;
          var tb = b.publishDate || b.publishedAt || b.createdAt || 0;
          var da = ta ? Date.parse(ta) : 0;
          var db = tb ? Date.parse(tb) : 0;
          return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
        });
      }

      if (countEl) countEl.textContent = cards.length + (cards.length === 1 ? ' card' : ' cards');
      if (cards.length === 0) {
        grid.innerHTML = '<div class="bs-gallery__empty"><i class="fas fa-inbox"></i><p>No public cards yet. Publish your card from the forge to start the gallery.</p></div>';
        return;
      }

      grid.innerHTML = cards.map(function (c, i) {
        ensureCombatStats(c);
        return '<button class="bs-gallery-tile" data-gallery-idx="' + i + '" type="button" role="listitem" aria-label="View ' + escHtml(c.name || 'card') + '">'
          + renderCardHTML(c, 'full')
          + '</button>';
      }).join('');

      grid.querySelectorAll('.bs-gallery-tile').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.dataset.galleryIdx, 10);
          var card = cards[idx];
          if (card) openDetail(card);
        });
      });
    } catch (e) {
      console.warn('[Blindspot] Gallery load failed:', e);
      grid.innerHTML = '<div class="bs-gallery__empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load gallery. Try again later.</p></div>';
    }
  }

  function openDetail(card) {
    var modal = document.getElementById('bs-gallery-detail');
    var cardEl = document.getElementById('bs-gallery-detail-card');
    var metaEl = document.getElementById('bs-gallery-detail-meta');
    if (!modal || !cardEl) return;
    ensureCombatStats(card);
    cardEl.innerHTML = renderCardHTML(card, 'full');
    if (metaEl) {
      var power = (card.combatStats ? Object.values(card.combatStats).reduce(function (a, b) { return a + (b || 0); }, 0) : 0);
      var dateStr = card.publishDate ? new Date(card.publishDate).toLocaleDateString() : '';
      // publishedBy is a userId — opaque to other players. Surface a
      // truncated form as a creator handle until display-name wiring lands.
      var creator = card.publishedBy ? ('Forged by ' + String(card.publishedBy).slice(0, 8) + '…') : '';
      metaEl.innerHTML = '<div class="bs-gallery-detail__row"><i class="fas fa-bolt"></i> Power ' + power + '</div>'
        + (creator ? '<div class="bs-gallery-detail__row"><i class="fas fa-hammer"></i> ' + escHtml(creator) + '</div>' : '')
        + (dateStr ? '<div class="bs-gallery-detail__row"><i class="fas fa-calendar"></i> Published ' + escHtml(dateStr) + '</div>' : '');
    }
    modal.classList.remove('bs-modal-backdrop--hidden');
  }

  function closeDetail() {
    var modal = document.getElementById('bs-gallery-detail');
    if (modal) modal.classList.add('bs-modal-backdrop--hidden');
  }

  var _wired = false;
  function init() {
    if (_wired) return;
    _wired = true;
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'bs-gallery-detail-close') closeDetail();
      if (e.target && e.target.id === 'bs-gallery-detail') closeDetail();
    });
  }

  window.BsGalleryPage = {
    init: init,
    render: render,
    openDetail: openDetail,
    closeDetail: closeDetail
  };
})();
