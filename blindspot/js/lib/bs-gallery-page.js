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

  // Cached card list (post-moderation, post-sort) — survives across
  // re-renders triggered by filter changes so we don't refetch.
  var _cards = null;
  var _filters = { class: '', element: '', rarity: '' };
  var _creatorFilter = ''; // URL-param-only; not in the dropdown UI
  var _defenderIds = new Set(); // cards currently on the global defense queue

  function getUrlParam(name) {
    try { return new URL(window.location.href).searchParams.get(name) || ''; }
    catch (e) { return ''; }
  }
  function setUrlParam(name, value) {
    try {
      var url = new URL(window.location.href);
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* ignore */ }
  }

  async function render() {
    var grid = document.getElementById('bs-gallery-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="bs-gallery__loading"><i class="fas fa-spinner fa-spin"></i> Loading cards…</div>';

    try {
      // Defense queue is fetched in parallel; soft-fail to empty Set so
      // a queue-API hiccup never blocks the gallery render.
      var defenseQueuePromise = (window.ArenaAPI && window.ArenaAPI.loadDefenseQueue)
        ? window.ArenaAPI.loadDefenseQueue().catch(function () { return null; })
        : Promise.resolve(null);

      var responses = await Promise.all([
        window.ArenaAPI.loadCards(),
        fetchAdminConfig('moderation'),
        fetchAdminConfig('gallery'),
        defenseQueuePromise
      ]);
      var data = responses[0];
      var modConfig = responses[1];
      var galleryConfig = responses[2];
      var defenseQueueData = responses[3];

      _defenderIds = new Set();
      if (defenseQueueData && Array.isArray(defenseQueueData.queue)) {
        defenseQueueData.queue.forEach(function (entry) {
          if (entry && entry.cardId) _defenderIds.add(entry.cardId);
        });
      }

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

      _cards = cards;
      populateFilterOptions(cards);

      // Hydrate filters from URL params (?class=, ?element=, ?rarity=,
      // ?creator=). Keys must match real values in the data after
      // populateFilterOptions has run.
      var urlClass   = getUrlParam('class');
      var urlElement = getUrlParam('element');
      var urlRarity  = getUrlParam('rarity');
      _creatorFilter = getUrlParam('creator');
      if (urlClass)   { _filters.class   = urlClass;   var s1 = document.getElementById('bs-gallery-filter-class');   if (s1) s1.value = urlClass; }
      if (urlElement) { _filters.element = urlElement; var s2 = document.getElementById('bs-gallery-filter-element'); if (s2) s2.value = urlElement; }
      if (urlRarity)  { _filters.rarity  = urlRarity;  var s3 = document.getElementById('bs-gallery-filter-rarity');  if (s3) s3.value = urlRarity; }
      renderCreatorBanner();

      renderGrid();

      // ?card=<id> auto-opens the detail modal on load. Searches the full
      // pre-filter list so a deep-link works even if the card wouldn't
      // otherwise appear under the current filter state.
      var deepCardId = getUrlParam('card');
      if (deepCardId) {
        var match = cards.find(function (c) { return c.id === deepCardId; });
        if (match) openDetail(match);
      }
    } catch (e) {
      console.warn('[Blindspot] Gallery load failed:', e);
      grid.innerHTML = '<div class="bs-gallery__empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load gallery. Try again later.</p></div>';
    }
  }

  function applyFilters(cards) {
    var f = _filters;
    if (!f.class && !f.element && !f.rarity && !_creatorFilter) return cards;
    return cards.filter(function (c) {
      if (f.class) {
        var cardClass = c.class || c.characterClass || '';
        if (cardClass !== f.class) return false;
      }
      if (f.element) {
        var cardElement = (c.element || '').toLowerCase();
        if (cardElement !== f.element) return false;
      }
      if (f.rarity) {
        var cardRarity = (c.rarity || '').toLowerCase();
        if (cardRarity !== f.rarity) return false;
      }
      if (_creatorFilter) {
        var cardCreator = String(c.publishedBy || '');
        if (cardCreator !== _creatorFilter) return false;
      }
      return true;
    });
  }

  function renderGrid() {
    var grid = document.getElementById('bs-gallery-grid');
    var countEl = document.getElementById('bs-gallery-count');
    if (!grid || !_cards) return;

    var filtered = applyFilters(_cards);
    var hasActiveFilter = !!(_filters.class || _filters.element || _filters.rarity);

    if (countEl) {
      var label = filtered.length + (filtered.length === 1 ? ' card' : ' cards');
      if (hasActiveFilter) label += ' / ' + _cards.length + ' total';
      countEl.textContent = label;
    }

    if (filtered.length === 0) {
      var emptyMsg = hasActiveFilter
        ? 'No cards match these filters.'
        : 'No public cards yet. Publish your card from the forge to start the gallery.';
      grid.innerHTML = '<div class="bs-gallery__empty"><i class="fas fa-inbox"></i><p>' + emptyMsg + '</p></div>';
      return;
    }

    grid.innerHTML = filtered.map(function (c, i) {
      ensureCombatStats(c);
      var defenderBadge = (c.id && _defenderIds.has(c.id))
        ? '<span class="bs-gallery-tile__defender" aria-label="On defense queue"><i class="fas fa-shield-halved" aria-hidden="true"></i> Defender</span>'
        : '';
      return '<button class="bs-gallery-tile' + (defenderBadge ? ' bs-gallery-tile--defender' : '') + '" data-gallery-idx="' + i + '" type="button" role="listitem" aria-label="View ' + escHtml(c.name || 'card') + (defenderBadge ? ' (on defense queue)' : '') + '">'
        + renderCardHTML(c, 'full')
        + defenderBadge
        + '</button>';
    }).join('');

    grid.querySelectorAll('.bs-gallery-tile').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.galleryIdx, 10);
        var card = filtered[idx];
        if (card) openDetail(card);
      });
    });
  }

  function setFilter(key, value) {
    if (!(key in _filters)) return;
    _filters[key] = value || '';
    setUrlParam(key, value || '');
    renderGrid();
  }

  function clearCreatorFilter() {
    _creatorFilter = '';
    setUrlParam('creator', '');
    renderCreatorBanner();
    renderGrid();
  }

  function renderCreatorBanner() {
    var existing = document.getElementById('bs-gallery-creator-banner');
    if (!_creatorFilter) {
      if (existing) existing.remove();
      return;
    }
    var label = 'Filtering by creator: ' + _creatorFilter.slice(0, 8) + '…';
    if (existing) {
      existing.querySelector('.bs-gallery-creator-banner__label').textContent = label;
      return;
    }
    var banner = document.createElement('div');
    banner.id = 'bs-gallery-creator-banner';
    banner.className = 'bs-gallery-creator-banner';
    banner.innerHTML = '<i class="fas fa-hammer" aria-hidden="true"></i>'
      + '<span class="bs-gallery-creator-banner__label">' + escHtml(label) + '</span>'
      + '<button type="button" class="bs-gallery-creator-banner__clear" aria-label="Clear creator filter"><i class="fas fa-xmark" aria-hidden="true"></i></button>';
    var grid = document.getElementById('bs-gallery-grid');
    if (grid && grid.parentNode) grid.parentNode.insertBefore(banner, grid);
    banner.querySelector('.bs-gallery-creator-banner__clear').addEventListener('click', clearCreatorFilter);
  }

  // Populate the filter dropdowns from the actual loaded data so players
  // never pick a value that returns zero results. Preserves the "All"
  // option at the top of each select; replaces the rest with sorted
  // unique values pulled from the cards. Custom user-typed class names
  // (e.g. "Rogue Assassin", "Cyber Ninja") show up correctly here.
  function populateFilterOptions(cards) {
    var classes = new Set();
    var elements = new Set();
    var rarities = new Set();
    cards.forEach(function (c) {
      var cl = c.class || c.characterClass;
      if (cl) classes.add(String(cl));
      if (c.element) elements.add(String(c.element).toLowerCase());
      if (c.rarity) rarities.add(String(c.rarity).toLowerCase());
    });
    fillSelect('bs-gallery-filter-class', toSortedArray(classes));
    fillSelect('bs-gallery-filter-element', toSortedArray(elements));
    fillSelect('bs-gallery-filter-rarity', toSortedArray(rarities));
  }

  function toSortedArray(set) {
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var current = sel.value;
    // Drop everything but the "All" option (first <option>)
    while (sel.options.length > 1) sel.remove(1);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      // Title-case for display: "fire" -> "Fire", "Cyber Ninja" left as-is
      opt.textContent = (v && v[0] && v[0] === v[0].toLowerCase())
        ? v.charAt(0).toUpperCase() + v.slice(1)
        : v;
      sel.appendChild(opt);
    });
    // Restore the previously selected value if it's still in the list,
    // otherwise reset to "All".
    if (current && values.indexOf(current) !== -1) sel.value = current;
    else sel.value = '';
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
      var isDefender = !!(card.id && _defenderIds.has(card.id));
      var challengeRow = isDefender
        ? '<a class="bs-gallery-detail__challenge" href="/blindspot/play.html?pvpChallenge=' + encodeURIComponent(card.id) + '">'
          + '<i class="fas fa-shield-halved" aria-hidden="true"></i> Challenge this defender in PvP'
          + '</a>'
        : '';
      metaEl.innerHTML = '<div class="bs-gallery-detail__row"><i class="fas fa-bolt"></i> Power ' + power + '</div>'
        + (creator ? '<div class="bs-gallery-detail__row"><i class="fas fa-hammer"></i> ' + escHtml(creator) + '</div>' : '')
        + (dateStr ? '<div class="bs-gallery-detail__row"><i class="fas fa-calendar"></i> Published ' + escHtml(dateStr) + '</div>' : '')
        + challengeRow;
    }
    modal.classList.remove('bs-modal-backdrop--hidden');
    if (card.id) setUrlParam('card', card.id);
  }

  function closeDetail() {
    var modal = document.getElementById('bs-gallery-detail');
    if (modal) modal.classList.add('bs-modal-backdrop--hidden');
    setUrlParam('card', '');
  }

  var _wired = false;
  function init() {
    if (_wired) return;
    _wired = true;
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'bs-gallery-detail-close') closeDetail();
      if (e.target && e.target.id === 'bs-gallery-detail') closeDetail();
    });
    // Filter dropdowns -- single-select per dimension, AND'd together.
    var filterMap = {
      'bs-gallery-filter-class':   'class',
      'bs-gallery-filter-element': 'element',
      'bs-gallery-filter-rarity':  'rarity'
    };
    Object.keys(filterMap).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        setFilter(filterMap[id], el.value);
      });
    });
  }

  window.BsGalleryPage = {
    init: init,
    render: render,
    openDetail: openDetail,
    closeDetail: closeDetail,
    setFilter: setFilter
  };
})();
