/* forge-gallery.js — mixed-style gallery.
 * Per redesign-handoff.md §8 + Phase 6 Task 6.1.
 *
 * Flow: try fetch /api/cardforgeloadcards → normalize + default styleId='ember'
 *       for legacy cards → render grid → wire filter chips.
 * On fetch failure (file://, offline, no published cards yet), falls back to
 * a 6-card mock — one per style, showcases the full catalog. Per plan 6.1 Step 5.
 *
 * Portraits are built fresh per card (not via dispatcher cache) because
 * gallery shows multiple cards simultaneously and the cache is designed for
 * the editor's single-card context (appendChild would move nodes between cells).
 */

(function () {
  'use strict';

  var STYLE_ORDER = ['monograph', 'ember', 'codex', 'press', 'arcade', 'terminal'];
  var STYLE_LABELS = {
    monograph: 'Monograph',
    ember:     'Ember',
    codex:     'Codex',
    press:     'Press',
    arcade:    'Arcade',
    terminal:  'Terminal'
  };

  // Mock seed — 6 cards, one per style, different characters. Used when the
  // real API is unreachable (file://) or the published-cards blob is empty.
  var MOCK_CARDS = [
    { id: 'demo-aria',  styleId: 'monograph', portraitId: 'aria',  name: 'Aria Stormwind',   classLabel: 'Fantasy Ranger',   rarity: 'Rare',      stats: { STR: 60, AGI: 92, INT: 72, END: 65, LCK: 58 } },
    { id: 'demo-kenji', styleId: 'ember',     portraitId: 'kenji', name: 'Kenji Nakamura',   classLabel: 'Corporate Ronin',  rarity: 'Epic',      stats: { STR: 88, AGI: 76, INT: 54, END: 82, LCK: 40 } },
    { id: 'demo-elena', styleId: 'codex',     portraitId: 'elena', name: 'Dr. Elena Voss',   classLabel: 'Arcane Scholar',   rarity: 'Rare',      stats: { STR: 42, AGI: 58, INT: 98, END: 52, LCK: 70 } },
    { id: 'demo-rex',   styleId: 'press',     portraitId: 'rex',   name: 'Commander Rex',    classLabel: 'Space Marine',     rarity: 'Legendary', stats: { STR: 92, AGI: 58, INT: 68, END: 90, LCK: 45 } },
    { id: 'demo-nova',  styleId: 'arcade',    portraitId: 'nova',  name: 'Captain Nova',     classLabel: 'Legendary Hero',   rarity: 'Mythic',    stats: { STR: 80, AGI: 82, INT: 78, END: 82, LCK: 85 } },
    { id: 'demo-zara',  styleId: 'terminal',  portraitId: 'zara',  name: 'Zara-7',           classLabel: 'Cyberpunk Runner', rarity: 'Epic',      stats: { STR: 55, AGI: 94, INT: 85, END: 62, LCK: 72 } }
  ];

  function hashString(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function pickPortraitFor(card) {
    // Deterministic pick from the 12 portraits based on card.id or card.name.
    // Legacy published cards have no FORGE portraitId — we assign one by hash
    // so the same card always gets the same face.
    var chars = (window.ForgePortrait && window.ForgePortrait.CHARACTERS) || [];
    if (chars.length === 0) return null;
    var seed = card.id || card.name || 'nova';
    return chars[hashString(seed) % chars.length].id;
  }

  function normalizeCard(c) {
    // Legacy cards from the real API — map to gallery-friendly shape.
    // combatStats keys are lowercase (str/agi/int/end/lck) per Blindspot audit 0.1.
    var cs = c.combatStats || {};
    return {
      id:         c.id || ('cf-' + Math.random().toString(36).slice(2, 8)),
      styleId:    c.styleId || 'ember',      // legacy default per Phase 6 open item
      portraitId: c.portraitId || pickPortraitFor(c),
      name:       c.name || 'Untitled',
      classLabel: c.class || c.characterClass || 'Unknown',
      rarity:     c.rarity || 'Rare',
      stats: {
        STR: Number(cs.str) || 50,
        AGI: Number(cs.agi) || 50,
        INT: Number(cs.int) || 50,
        END: Number(cs.end) || 50,
        LCK: Number(cs.lck) || 50
      }
    };
  }

  async function loadGalleryCards() {
    // file:// protocol — fetch to the Azure Function won't work; use mock.
    if (window.location.protocol === 'file:') {
      return MOCK_CARDS.slice();
    }
    try {
      var url = (window.buildApiPath ? window.buildApiPath('loadCards') : '/api/cardforgeloadcards');
      var resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      var cards = Array.isArray(data && data.galleryCards) ? data.galleryCards : [];
      if (cards.length === 0) {
        console.debug('[forge-gallery] published gallery empty — seeding mock');
        return MOCK_CARDS.slice();
      }
      return cards.map(normalizeCard);
    } catch (e) {
      console.debug('[forge-gallery] fetch failed — seeding mock:', e && e.message);
      return MOCK_CARDS.slice();
    }
  }

  /**
   * Build a single gallery card element. Uses the style module directly
   * (not via ForgeRender) so each card gets its own fresh portrait SVG —
   * the dispatcher cache is editor-scoped.
   */
  function buildGalleryCard(card) {
    var styleGlobal = 'ForgeStyle' + (card.styleId.charAt(0).toUpperCase() + card.styleId.slice(1));
    var style = window[styleGlobal] || window.ForgeStyleEmber;
    if (!style || typeof style.build !== 'function') return null;

    var built = style.build(card);
    var portrait = window.ForgePortrait ? window.ForgePortrait.build(card.portraitId) : null;
    if (portrait && built.portraitSlot) {
      built.portraitSlot.appendChild(portrait);
    }

    var wrap = document.createElement('div');
    wrap.className = 'forge-card forge-card--' + style.id + ' forge-card--size-sm';
    wrap.dataset.styleId = style.id;
    wrap.appendChild(built.frag);
    return wrap;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderGrid(root, cards, filter) {
    if (!root) return;
    root.innerHTML = '';

    var visible = cards.filter(function (c) { return filter === 'all' || c.styleId === filter; });

    if (visible.length === 0) {
      root.innerHTML = '<div class="forge-gallery-empty">No cards in this style yet.</div>';
      return;
    }

    visible.forEach(function (card, idx) {
      var cell = document.createElement('div');
      cell.className = 'forge-gallery-cell';
      cell.dataset.styleId = card.styleId;
      cell.dataset.rotate = (idx % 2 === 0) ? 'pos' : 'neg';

      var cardWrap = document.createElement('div');
      cardWrap.className = 'forge-gallery-card-wrap';

      var cardEl = buildGalleryCard(card);
      if (cardEl) cardWrap.appendChild(cardEl);

      var meta = document.createElement('div');
      meta.className = 'forge-gallery-cell-meta';
      meta.innerHTML =
        '<div class="forge-gallery-cell-name">' + escapeHtml(card.name) + '</div>' +
        '<div class="forge-gallery-cell-style">' + escapeHtml((STYLE_LABELS[card.styleId] || card.styleId).toUpperCase()) + ' STYLE</div>';

      cell.appendChild(cardWrap);
      cell.appendChild(meta);
      root.appendChild(cell);
    });
  }

  function wireFilters(filtersRoot, gridRoot, cards) {
    if (!filtersRoot) return;
    filtersRoot.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.forge-gallery-chip');
      if (!chip) return;
      var filter = chip.dataset.filter;
      if (!filter) return;

      // Update active state
      filtersRoot.querySelectorAll('.forge-gallery-chip').forEach(function (c) {
        c.classList.toggle('is-active', c === chip);
      });

      renderGrid(gridRoot, cards, filter);

      // Telemetry (silent-fail until wrapper ships real events)
      if (window.ForgeTelemetry && typeof window.ForgeTelemetry.track === 'function') {
        window.ForgeTelemetry.track('gallery.filter', { styleId: filter });
      }
    });
  }

  window.ForgeGallery = {
    STYLE_ORDER: STYLE_ORDER,
    STYLE_LABELS: STYLE_LABELS,
    MOCK_CARDS: MOCK_CARDS,
    loadGalleryCards: loadGalleryCards,
    buildGalleryCard: buildGalleryCard,
    renderGrid: renderGrid,
    normalizeCard: normalizeCard
  };

  document.addEventListener('DOMContentLoaded', async function () {
    var gridRoot = document.getElementById('forge-gallery-grid');
    var filtersRoot = document.getElementById('forge-gallery-filters');
    if (!gridRoot) return;

    // Show loading state while we fetch
    gridRoot.innerHTML = '<div class="forge-gallery-loading"><span class="forge-gallery-loading-dot"></span>LOADING GALLERY</div>';

    var cards = await loadGalleryCards();
    renderGrid(gridRoot, cards, 'all');
    wireFilters(filtersRoot, gridRoot, cards);
  });
})();
