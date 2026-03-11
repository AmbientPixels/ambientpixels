/**
 * CardForge Deck Builder — cardforge-deck-builder.js
 * Full deck composition experience for deck.html
 * Dual mode: builder (no ?deck param) / viewer (?deck=shareId)
 */
(function () {
  'use strict';

  const MAX_DECK_SIZE = 30;
  const DECK_ICONS = [
    'fas fa-layer-group', 'fas fa-shield-halved', 'fas fa-wand-sparkles',
    'fas fa-fire', 'fas fa-bolt', 'fas fa-skull-crossbones',
    'fas fa-crown', 'fas fa-dragon', 'fas fa-star',
    'fas fa-gem', 'fas fa-hat-wizard', 'fas fa-dice-d20'
  ];

  const params = new URLSearchParams(window.location.search);
  const shareId = params.get('deck') || '';
  const isViewMode = !!shareId;

  let _allCards = [];
  let _deckCards = [];   // ordered array of card objects in the deck
  let _deckMeta = { id: '', name: 'New Deck', icon: DECK_ICONS[0], description: '', tags: '' };
  let _dragIdx = -1;

  // ── Boot ──
  document.addEventListener('DOMContentLoaded', function () {
    if (isViewMode) {
      bootViewMode();
    } else {
      bootBuilderMode();
    }
  });

  // ================================================================
  //  VIEW MODE — shared deck viewer (preserves original behavior)
  // ================================================================
  async function bootViewMode() {
    const app = document.getElementById('db-app');
    app.innerHTML =
      '<div class="db-bar">' +
        '<a href="/cardforge/" class="db-bar-brand"><i class="fas fa-arrow-left"></i> CardForge</a>' +
        '<div class="db-bar-actions">' +
          '<button type="button" class="db-btn" id="dv-copy-link"><i class="fas fa-link"></i> Copy Link</button>' +
          '<button type="button" class="db-btn db-btn-primary" id="dv-clone-deck"><i class="fas fa-clone"></i> Clone to My Decks</button>' +
        '</div>' +
      '</div>' +
      '<div class="db-view-container" id="dv-content">' +
        '<div class="db-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading deck...</p></div>' +
      '</div>' +
      '<div class="db-toast" id="db-toast"></div>';

    document.getElementById('dv-copy-link').addEventListener('click', function () {
      navigator.clipboard.writeText(window.location.href).then(function () { showToast('Link copied!'); });
    });

    document.getElementById('dv-clone-deck').addEventListener('click', cloneDeck);

    try {
      const endpoint = window.buildApiPath('deckLoad', { shareId: shareId });
      const res = await fetch(endpoint);
      if (!res.ok) {
        if (res.status === 404) { showViewError('Deck not found. It may have been removed.'); return; }
        throw new Error('HTTP ' + res.status);
      }
      const data = await res.json();
      renderViewDeck(data);
    } catch (err) {
      console.error('[DeckBuilder] View load error:', err);
      showViewError('Failed to load deck: ' + err.message);
    }
  }

  function renderViewDeck(deck) {
    window._viewDeckData = deck;
    const container = document.getElementById('dv-content');
    const icon = deck.icon || 'fas fa-layer-group';
    const cards = deck.cards || [];
    const tags = deck.tags || [];

    let tagsHTML = '';
    if (tags.length) {
      tagsHTML = '<div class="db-view-tags">' +
        tags.map(function (t) { return '<span class="db-view-tag">' + esc(t) + '</span>'; }).join('') +
        '</div>';
    }

    let descHTML = '';
    if (deck.description) descHTML = '<p class="db-view-desc">' + esc(deck.description) + '</p>';

    let metaParts = [cards.length + ' card' + (cards.length !== 1 ? 's' : '')];
    if (deck.updatedAt) metaParts.push('Updated ' + new Date(deck.updatedAt).toLocaleDateString());

    document.title = deck.name + ' - CardForge Deck';

    let gridHTML = '';
    if (cards.length === 0) {
      gridHTML = '<p style="text-align:center;color:#6a6a8a;padding:2rem;">This deck has no cards.</p>';
    } else {
      gridHTML = '<div class="db-view-grid">' +
        cards.map(function (c, i) {
          const imgHTML = c.preview
            ? '<img class="deck-card-tile-img" src="' + escAttr(c.preview) + '" alt="' + escAttr(c.name) + '" loading="lazy" style="width:100%;aspect-ratio:5/7;object-fit:cover;display:block;background:#12121e" />'
            : '<div style="width:100%;aspect-ratio:5/7;display:flex;align-items:center;justify-content:center;background:#12121e;color:#3a3a5a;font-size:1.5rem"><i class="fas fa-image"></i></div>';
          return '<div style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.06);border-radius:8px;overflow:hidden;transition:transform 0.15s">' +
            imgHTML +
            '<div style="padding:0.5rem 0.6rem">' +
              '<div style="font-size:0.78rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(c.name || 'Untitled') + '</div>' +
              '<div style="font-size:0.65rem;color:#6a6a8a;margin-top:0.15rem">#' + (i + 1) + '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
        '</div>';
    }

    container.innerHTML =
      '<div class="db-view-header">' +
        '<div class="db-view-icon"><i class="' + icon + '"></i></div>' +
        '<h2 class="db-view-title">' + esc(deck.name) + '</h2>' +
        descHTML + tagsHTML +
        '<div class="db-view-meta">' + metaParts.join(' &middot; ') + '</div>' +
      '</div>' +
      gridHTML;
  }

  function cloneDeck() {
    const deck = window._viewDeckData;
    if (!deck) { showToast('Deck not loaded yet'); return; }

    var existing = [];
    try { existing = JSON.parse(localStorage.getItem('cardforge_decks') || '[]'); } catch (e) { existing = []; }

    var dup = existing.find(function (d) { return d.shareId === shareId; });
    if (dup) { showToast('This deck is already in your collection'); return; }

    var newDeck = {
      id: 'deck_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: deck.name,
      icon: deck.icon || 'fas fa-layer-group',
      description: deck.description || '',
      cardIds: (deck.cards || []).map(function (c) { return c.cardId; }),
      shareId: shareId,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    };

    existing.push(newDeck);
    localStorage.setItem('cardforge_decks', JSON.stringify(existing));
    showToast('Deck cloned to your collection!');
  }

  function showViewError(msg) {
    document.getElementById('dv-content').innerHTML =
      '<div class="db-error">' +
        '<i class="fas fa-exclamation-triangle"></i>' +
        '<p>' + msg + '</p>' +
        '<a href="/cardforge/" class="db-btn">Back to CardForge</a>' +
      '</div>';
  }

  // ================================================================
  //  BUILDER MODE — full deck composition
  // ================================================================
  async function bootBuilderMode() {
    const app = document.getElementById('db-app');

    // Check for existing deck to edit via ?edit=deckId
    const editId = params.get('edit') || '';

    app.innerHTML = buildBuilderHTML();
    bindBuilderEvents();

    // Load existing deck if editing
    if (editId) {
      const decks = JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
      const deck = decks.find(function (d) { return d.id === editId; });
      if (deck) {
        _deckMeta.id = deck.id;
        _deckMeta.name = deck.name || 'Untitled Deck';
        _deckMeta.icon = deck.icon || DECK_ICONS[0];
        _deckMeta.description = deck.description || '';
        _deckMeta.tags = deck.tags || '';
        document.getElementById('db-deck-name').value = _deckMeta.name;
        document.getElementById('db-deck-desc').value = _deckMeta.description;
        document.getElementById('db-meta-icon').innerHTML = '<i class="' + _deckMeta.icon + '"></i>';
      }
    }

    // Load user's card collection
    await loadCollection(editId);

    // Show tutorial tips on first visit
    showTips();
  }

  function buildBuilderHTML() {
    return '' +
      '<!-- Top bar -->' +
      '<div class="db-bar">' +
        '<a href="/cardforge/" class="db-bar-brand"><i class="fas fa-arrow-left"></i> CardForge</a>' +
        '<div class="db-bar-title"><i class="fas fa-hammer"></i> Deck Builder</div>' +
        '<div class="db-bar-actions">' +
          '<button type="button" class="db-btn" id="db-save-btn"><i class="fas fa-save"></i> Save</button>' +
          '<button type="button" class="db-btn db-btn-primary" id="db-publish-btn" disabled><i class="fas fa-share-from-square"></i> Publish</button>' +
        '</div>' +
      '</div>' +

      '<!-- Metadata bar -->' +
      '<div class="db-meta">' +
        '<div style="position:relative">' +
          '<div class="db-meta-icon" id="db-meta-icon" title="Change icon"><i class="' + _deckMeta.icon + '"></i></div>' +
          '<div class="db-icon-picker" id="db-icon-picker">' +
            DECK_ICONS.map(function (ic) {
              return '<button type="button" data-icon="' + ic + '" title="' + ic.split('fa-')[1] + '"><i class="' + ic + '"></i></button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<input type="text" class="db-meta-name" id="db-deck-name" value="' + escAttr(_deckMeta.name) + '" placeholder="Deck name" maxlength="60" />' +
        '<input type="text" class="db-meta-desc" id="db-deck-desc" value="" placeholder="Description (optional)" maxlength="200" />' +
        '<span class="db-meta-capacity" id="db-capacity">0/' + MAX_DECK_SIZE + '</span>' +
      '</div>' +

      '<!-- Main split -->' +
      '<div class="db-main">' +
        '<!-- Collection panel -->' +
        '<div class="db-collection">' +
          '<div class="db-collection-header">' +
            '<div class="db-collection-title"><i class="fas fa-cards"></i> My Collection <span class="count" id="db-coll-count">0</span></div>' +
            '<div class="db-collection-search"><i class="fas fa-search"></i><input type="text" id="db-coll-search" placeholder="Search cards..." /></div>' +
            '<div class="db-collection-filters">' +
              '<select id="db-coll-class"><option value="">All Classes</option></select>' +
              '<select id="db-coll-rarity"><option value="">All Rarities</option></select>' +
            '</div>' +
          '</div>' +
          '<div class="db-collection-grid" id="db-coll-grid">' +
            '<div class="db-collection-empty"><i class="fas fa-spinner fa-spin"></i><p>Loading collection...</p></div>' +
          '</div>' +
        '</div>' +

        '<!-- Deck composition panel -->' +
        '<div class="db-deck">' +
          '<div class="db-deck-header">' +
            '<div class="db-deck-title">Deck Composition</div>' +
            '<div class="db-deck-stats" id="db-deck-stats"></div>' +
          '</div>' +
          '<div class="db-deck-list" id="db-deck-list">' +
            '<div class="db-deck-empty"><i class="fas fa-layer-group"></i><p>No cards in deck</p><small>Click cards from your collection to add them</small></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<!-- Toast -->' +
      '<div class="db-toast" id="db-toast"></div>';
  }

  function bindBuilderEvents() {
    // Save
    document.getElementById('db-save-btn').addEventListener('click', saveDeck);

    // Publish
    document.getElementById('db-publish-btn').addEventListener('click', publishDeck);

    // Icon picker
    var iconBtn = document.getElementById('db-meta-icon');
    var iconPicker = document.getElementById('db-icon-picker');
    iconBtn.addEventListener('click', function () { iconPicker.classList.toggle('open'); });
    iconPicker.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      _deckMeta.icon = btn.dataset.icon;
      iconBtn.innerHTML = '<i class="' + _deckMeta.icon + '"></i>';
      iconPicker.classList.remove('open');
    });
    document.addEventListener('click', function (e) {
      if (!iconBtn.contains(e.target) && !iconPicker.contains(e.target)) {
        iconPicker.classList.remove('open');
      }
    });

    // Metadata inputs
    document.getElementById('db-deck-name').addEventListener('input', function () { _deckMeta.name = this.value; });
    document.getElementById('db-deck-desc').addEventListener('input', function () { _deckMeta.description = this.value; });

    // Collection search + filters
    var searchInput = document.getElementById('db-coll-search');
    var debounceTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderCollectionGrid, 200);
    });
    document.getElementById('db-coll-class').addEventListener('change', renderCollectionGrid);
    document.getElementById('db-coll-rarity').addEventListener('change', renderCollectionGrid);

  }

  // ── Load collection ──
  async function loadCollection(editDeckId) {
    // Wait for auth bootstrap (from deck.html inline script) before checking auth state
    if (window._authReady) { try { await window._authReady; } catch (e) {} }

    const isAuthed = (sessionStorage.getItem('isAuthenticated') === 'true') ||
                     (document.body?.getAttribute('data-auth-state') === 'signed-in');

    let cards = [];

    // Try cloud first
    if (isAuthed) {
      try {
        const loadUrl = window.buildApiPath('loadCards');
        const authHeaders = window.ArenaAPI && window.ArenaAPI.getPrincipalHeader
          ? await window.ArenaAPI.getPrincipalHeader() : {};
        const resp = await fetch(loadUrl, {
          method: 'GET',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders)
        });
        if (resp.ok) {
          const data = await resp.json();
          cards = Array.isArray(data?.userCards) ? data.userCards : [];
        }
      } catch (err) {
        console.warn('[DeckBuilder] Cloud load failed, using localStorage:', err);
      }
    }

    // Fallback to localStorage
    var localCards = [];
    try { localCards = JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]'); } catch (e) { localCards = []; }
    if (cards.length === 0) {
      cards = localCards;
    }

    // Enrich cloud cards with rendered HTML from localStorage (same pattern as deck viewer & lightbox)
    if (localCards.length > 0) {
      cards = cards.map(function (c) {
        var cd = c.cardData || c;
        if (cd.renderedFront && cd.frontClasses) return c;
        // Try to find matching card in localStorage by id
        var localMatch = localCards.find(function (s) { return s.id === c.id; });
        if (localMatch && localMatch.cardData && localMatch.cardData.renderedFront) {
          var enriched = Object.assign({}, c);
          if (enriched.cardData) {
            enriched.cardData = Object.assign({}, enriched.cardData, {
              renderedFront: localMatch.cardData.renderedFront,
              frontClasses: localMatch.cardData.frontClasses,
              renderedBack: localMatch.cardData.renderedBack || '',
              backClasses: localMatch.cardData.backClasses || ''
            });
          } else {
            enriched.renderedFront = localMatch.cardData.renderedFront;
            enriched.frontClasses = localMatch.cardData.frontClasses;
          }
          return enriched;
        }
        return c;
      });
    }

    // Filter out sample/default cards
    _allCards = cards.filter(function (c) {
      return c.id && !c.id.startsWith('sample_') && !c.id.startsWith('default_');
    });

    // Populate filter dropdowns
    populateFilterOptions();

    // If editing, load deck cards
    if (editDeckId) {
      const decks = JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
      const deck = decks.find(function (d) { return d.id === editDeckId; });
      if (deck && deck.cardIds) {
        _deckCards = deck.cardIds.map(function (id) {
          return _allCards.find(function (c) { return c.id === id; });
        }).filter(Boolean);
      }
    }

    renderCollectionGrid();
    renderDeckList();
    updateCapacity();
  }

  function populateFilterOptions() {
    var classes = new Set();
    var rarities = new Set();
    _allCards.forEach(function (c) {
      var cd = c.cardData || c;
      if (cd.characterClass) classes.add(cd.characterClass);
      if (cd.rarity) rarities.add(cd.rarity);
    });

    var classSelect = document.getElementById('db-coll-class');
    classes.forEach(function (cl) {
      var opt = document.createElement('option');
      opt.value = cl;
      opt.textContent = cl;
      classSelect.appendChild(opt);
    });

    var raritySelect = document.getElementById('db-coll-rarity');
    rarities.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      raritySelect.appendChild(opt);
    });
  }

  // ── Helpers: card display ──
  var RARITY_COLORS = {
    Common: '#9ca3af', Uncommon: '#34d399', Rare: '#60a5fa',
    Epic: '#a78bfa', Legendary: '#fbbf24', Mythic: '#f472b6'
  };

  function rarityBadge(rarity) {
    if (!rarity) return '';
    var color = RARITY_COLORS[rarity] || '#9ca3af';
    return '<span class="db-rarity-badge" style="--rarity-color:' + color + '">' + esc(rarity) + '</span>';
  }

  function statPills(stats) {
    if (!Array.isArray(stats) || stats.length === 0) return '';
    var top = stats.slice(0, 3);
    return '<div class="db-stat-pills">' +
      top.map(function (s) {
        return '<span class="db-stat-pill">' + esc(s.label || s.name || '?') + ' ' + (s.value || 0) + '</span>';
      }).join('') +
      '</div>';
  }

  // ── Collection grid ──
  function renderCollectionGrid() {
    var grid = document.getElementById('db-coll-grid');
    var search = (document.getElementById('db-coll-search').value || '').toLowerCase();
    var classFilter = document.getElementById('db-coll-class').value;
    var rarityFilter = document.getElementById('db-coll-rarity').value;
    var deckCardIds = new Set(_deckCards.map(function (c) { return c.id; }));

    var filtered = _allCards.filter(function (c) {
      var cd = c.cardData || c;
      var name = (cd.name || c.name || '').toLowerCase();
      if (search && name.indexOf(search) === -1) return false;
      if (classFilter && (cd.characterClass || '') !== classFilter) return false;
      if (rarityFilter && (cd.rarity || '') !== rarityFilter) return false;
      return true;
    });

    document.getElementById('db-coll-count').textContent = filtered.length;

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="db-collection-empty"><i class="fas fa-inbox"></i><p>' +
        (_allCards.length === 0 ? 'No cards found. Create some in CardForge first!' : 'No cards match your filters') +
        '</p></div>';
      return;
    }

    grid.innerHTML = filtered.map(function (c) {
      var cd = c.cardData || c;
      var cardName = cd.name || c.name || 'Untitled';
      var cardImage = cd.avatar || c.avatar || '';
      var inDeck = deckCardIds.has(c.id);
      var hasRendered = cd.renderedFront && cd.frontClasses;

      var cardClass = cd.characterClass || c.class || '';
      var cardRarity = cd.rarity || '';
      var cardStats = cd.stats || [];

      var contentHTML;
      if (hasRendered) {
        // Full rendered card using mini-card-scaler pattern
        contentHTML = '<div class="db-mini-card-wrap">' +
          '<div class="mini-card-scaler"><div class="' + cd.frontClasses + '">' + cd.renderedFront + '</div></div>' +
        '</div>';
      } else {
        // Fallback: styled mini-card with available data
        var rarityColor = RARITY_COLORS[cardRarity] || '#9ca3af';
        var imgHTML = cardImage
          ? '<img class="db-fallback-card-img" src="' + escAttr(cardImage) + '" alt="' + escAttr(cardName) + '" loading="lazy" />'
          : '<div class="db-fallback-card-placeholder"><i class="fas fa-user-shield"></i></div>';
        contentHTML = '<div class="db-fallback-card" style="border-color:' + rarityColor + '">' +
          '<div class="db-fallback-card-header" style="background:' + rarityColor + '22;border-bottom:1px solid ' + rarityColor + '44">' +
            '<span class="db-fallback-card-title">' + esc(cardName) + '</span>' +
          '</div>' +
          '<div class="db-fallback-card-art">' + imgHTML + '</div>' +
          '<div class="db-fallback-card-footer">' +
            (cardClass ? '<span class="db-fallback-card-class">' + esc(cardClass) + '</span>' : '') +
            (cardRarity ? '<span class="db-fallback-card-rarity" style="color:' + rarityColor + '">' + esc(cardRarity) + '</span>' : '') +
          '</div>' +
        '</div>';
      }

      var infoHTML = '<div class="db-coll-card-info">' +
        '<div class="db-coll-card-name">' + esc(cardName) + '</div>' +
        '<div class="db-coll-card-meta">' +
          (cardClass ? '<span class="db-coll-card-class">' + esc(cardClass) + '</span>' : '') +
          rarityBadge(cardRarity) +
        '</div>' +
        statPills(cardStats) +
      '</div>';

      return '<div class="db-coll-card' + (inDeck ? ' in-deck' : '') + (hasRendered ? ' has-render' : '') + '" data-card-id="' + c.id + '">' +
        contentHTML + infoHTML +
      '</div>';
    }).join('');

    // Click to add
    grid.querySelectorAll('.db-coll-card:not(.in-deck)').forEach(function (el) {
      el.addEventListener('click', function () {
        var cardId = el.dataset.cardId;
        addCardToDeck(cardId);
      });
    });
  }

  // ── Add / Remove cards ──
  function addCardToDeck(cardId) {
    if (_deckCards.length >= MAX_DECK_SIZE) {
      showToast('Deck is full (' + MAX_DECK_SIZE + ' cards max)');
      return;
    }
    var card = _allCards.find(function (c) { return c.id === cardId; });
    if (!card) return;
    if (_deckCards.find(function (c) { return c.id === cardId; })) return;

    _deckCards.push(card);
    renderDeckList();
    renderCollectionGrid();
    updateCapacity();
  }

  function removeCardFromDeck(cardId) {
    _deckCards = _deckCards.filter(function (c) { return c.id !== cardId; });
    renderDeckList();
    renderCollectionGrid();
    updateCapacity();
  }

  // ── Deck list (right panel) ──
  function renderDeckList() {
    var list = document.getElementById('db-deck-list');
    var publishBtn = document.getElementById('db-publish-btn');

    if (_deckCards.length === 0) {
      list.innerHTML = '<div class="db-deck-empty"><i class="fas fa-layer-group"></i><p>No cards in deck</p><small>Click cards from your collection to add them</small></div>';
      publishBtn.disabled = true;
      updateDeckStats();
      return;
    }

    publishBtn.disabled = false;

    list.innerHTML = _deckCards.map(function (c, i) {
      var cd = c.cardData || c;
      var cardName = cd.name || c.name || 'Untitled';
      var cardClass = cd.characterClass || '';
      var rarity = cd.rarity || '';
      var cardImage = cd.avatar || c.avatar || '';
      var cardStats = cd.stats || [];

      var thumbHTML = cardImage
        ? '<img class="db-deck-item-thumb" src="' + escAttr(cardImage) + '" alt="" />'
        : '<div class="db-deck-item-thumb-placeholder"><i class="fas fa-image"></i></div>';

      return '<div class="db-deck-item" draggable="true" data-idx="' + i + '" data-card-id="' + c.id + '">' +
        '<span class="db-deck-item-num">' + (i + 1) + '</span>' +
        thumbHTML +
        '<div class="db-deck-item-info">' +
          '<div class="db-deck-item-name">' + esc(cardName) + '</div>' +
          '<div class="db-deck-item-meta">' +
            (cardClass ? '<span>' + esc(cardClass) + '</span>' : '') +
            rarityBadge(rarity) +
          '</div>' +
          statPills(cardStats) +
        '</div>' +
        '<button class="db-deck-item-remove" title="Remove"><i class="fas fa-times"></i></button>' +
      '</div>';
    }).join('');

    // Remove buttons
    list.querySelectorAll('.db-deck-item-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var cardId = btn.closest('.db-deck-item').dataset.cardId;
        removeCardFromDeck(cardId);
      });
    });

    // Drag-and-drop reorder
    list.querySelectorAll('.db-deck-item').forEach(function (item) {
      item.addEventListener('dragstart', function (e) {
        _dragIdx = parseInt(item.dataset.idx);
        e.dataTransfer.effectAllowed = 'move';
        item.style.opacity = '0.4';
      });

      item.addEventListener('dragend', function () {
        item.style.opacity = '';
        list.querySelectorAll('.db-deck-item').forEach(function (el) { el.classList.remove('drag-over'); });
      });

      item.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', function () {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', function (e) {
        e.preventDefault();
        item.classList.remove('drag-over');
        var dropIdx = parseInt(item.dataset.idx);
        if (_dragIdx === dropIdx || _dragIdx < 0) return;

        var moved = _deckCards.splice(_dragIdx, 1)[0];
        _deckCards.splice(dropIdx, 0, moved);
        _dragIdx = -1;
        renderDeckList();
      });
    });

    updateDeckStats();
  }

  function updateDeckStats() {
    var statsEl = document.getElementById('db-deck-stats');
    if (_deckCards.length === 0) { statsEl.innerHTML = ''; return; }

    var classCounts = {};
    var rarityCounts = {};
    _deckCards.forEach(function (c) {
      var cd = c.cardData || c;
      var cl = cd.characterClass || 'Unknown';
      var r = cd.rarity || 'Common';
      classCounts[cl] = (classCounts[cl] || 0) + 1;
      rarityCounts[r] = (rarityCounts[r] || 0) + 1;
    });

    var topClass = Object.entries(classCounts).sort(function (a, b) { return b[1] - a[1]; })[0];
    var topRarity = Object.entries(rarityCounts).sort(function (a, b) { return b[1] - a[1]; })[0];

    statsEl.innerHTML =
      '<span class="db-deck-stat"><i class="fas fa-shield-halved"></i> ' + esc(topClass[0]) + ' (' + topClass[1] + ')</span>' +
      '<span class="db-deck-stat"><i class="fas fa-gem"></i> ' + esc(topRarity[0]) + ' (' + topRarity[1] + ')</span>';
  }

  function updateCapacity() {
    var el = document.getElementById('db-capacity');
    var count = _deckCards.length;
    el.textContent = count + '/' + MAX_DECK_SIZE;
    el.className = 'db-meta-capacity' + (count >= MAX_DECK_SIZE ? ' full' : '') + (count > MAX_DECK_SIZE ? ' over' : '');
  }

  // ── Save ──
  function saveDeck() {
    var name = (document.getElementById('db-deck-name').value || '').trim();
    if (!name) { showToast('Please enter a deck name'); return; }

    var decks = [];
    try { decks = JSON.parse(localStorage.getItem('cardforge_decks') || '[]'); } catch (e) { decks = []; }

    var existing = _deckMeta.id ? decks.find(function (d) { return d.id === _deckMeta.id; }) : null;

    if (existing) {
      existing.name = name;
      existing.icon = _deckMeta.icon;
      existing.description = _deckMeta.description;
      existing.cardIds = _deckCards.map(function (c) { return c.id; });
      existing.lastModified = new Date().toISOString();
    } else {
      _deckMeta.id = 'deck_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      decks.push({
        id: _deckMeta.id,
        name: name,
        icon: _deckMeta.icon,
        description: _deckMeta.description,
        tags: _deckMeta.tags,
        cardIds: _deckCards.map(function (c) { return c.id; }),
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      });
    }

    localStorage.setItem('cardforge_decks', JSON.stringify(decks));
    showToast('Deck saved!');

    // Update URL to include edit param for future saves
    if (!params.get('edit')) {
      var newUrl = window.location.pathname + '?edit=' + _deckMeta.id;
      window.history.replaceState({}, '', newUrl);
    }
  }

  // ── Publish ──
  async function publishDeck() {
    var name = (document.getElementById('db-deck-name').value || '').trim();
    if (!name) { showToast('Please enter a deck name'); return; }
    if (_deckCards.length === 0) { showToast('Add cards to your deck first'); return; }

    var isAuthed = (sessionStorage.getItem('isAuthenticated') === 'true') ||
                   (document.body?.getAttribute('data-auth-state') === 'signed-in');
    if (!isAuthed) { showToast('Sign in to publish decks'); return; }

    // Save first
    saveDeck();

    showToast('Publishing deck...');

    try {
      var userId = 'anonymous';
      try { userId = JSON.parse(sessionStorage.getItem('userInfo') || '{}').userId || 'anonymous'; } catch (e) {}

      var cards = _deckCards.map(function (c) {
        var cd = c.cardData || c;
        return {
          cardId: c.id,
          name: cd.name || c.name || 'Untitled',
          preview: cd.avatar || c.avatar || null,
          characterClass: cd.characterClass || '',
          rarity: cd.rarity || '',
          avatar: cd.avatar || c.avatar || '',
          stats: cd.stats || []
        };
      });

      var tagsList = (_deckMeta.tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);

      var endpoint = window.buildApiPath('deckPublish');
      var response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.csrfProtection?.getToken?.() || '',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          deckId: _deckMeta.id,
          name: name,
          icon: _deckMeta.icon,
          description: _deckMeta.description,
          tags: tagsList,
          visibility: 'unlisted',
          cards: cards,
          userId: userId
        }),
        credentials: 'include'
      });

      if (!response.ok) throw new Error('HTTP ' + response.status);

      var result = await response.json();
      var shareUrl = window.location.origin + '/cardforge/deck.html?deck=' + result.shareId;

      // Update deck with shareId
      var decks = JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
      var deck = decks.find(function (d) { return d.id === _deckMeta.id; });
      if (deck) {
        deck.shareId = result.shareId;
        localStorage.setItem('cardforge_decks', JSON.stringify(decks));
      }

      showToast('Deck published! Share link copied.');
      navigator.clipboard.writeText(shareUrl).catch(function () {});

    } catch (err) {
      console.error('[DeckBuilder] Publish error:', err);
      showToast('Failed to publish: ' + err.message);
    }
  }

  // ── Tutorial Tips ──
  function showTips() {
    if (localStorage.getItem('db-tips-dismissed')) return;

    // Collection panel tip
    var collHeader = document.querySelector('.db-collection-header');
    if (collHeader) {
      var collTip = document.createElement('div');
      collTip.className = 'db-tip';
      collTip.innerHTML =
        '<i class="fas fa-hand-pointer db-tip-icon"></i>' +
        '<span>Click any card to add it to your deck. Use search and filters to find specific cards.</span>' +
        '<button class="db-tip-close" title="Dismiss"><i class="fas fa-times"></i></button>';
      collHeader.appendChild(collTip);
    }

    // Deck panel tip
    var deckHeader = document.querySelector('.db-deck-header');
    if (deckHeader) {
      var deckTip = document.createElement('div');
      deckTip.className = 'db-tip';
      deckTip.innerHTML =
        '<i class="fas fa-arrows-up-down db-tip-icon"></i>' +
        '<span>Drag cards to reorder your deck. Click <i class="fas fa-times"></i> to remove a card.</span>' +
        '<button class="db-tip-close" title="Dismiss"><i class="fas fa-times"></i></button>';
      deckHeader.after(deckTip);
    }

    // Bind close buttons — each tip dismisses independently
    document.querySelectorAll('.db-tip-close').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tip = btn.closest('.db-tip');
        if (tip) {
          tip.style.opacity = '0';
          tip.style.maxHeight = '0';
          tip.style.padding = '0';
          tip.style.margin = '0';
          setTimeout(function () { tip.remove(); checkAllDismissed(); }, 200);
        }
      });
    });
  }

  function checkAllDismissed() {
    if (document.querySelectorAll('.db-tip').length === 0) {
      localStorage.setItem('db-tips-dismissed', '1');
    }
  }

  // ── Helpers ──
  function showToast(msg) {
    // Prefer the deck-builder's own #db-toast element for in-page feedback;
    // fall back to shared UIUtils toast if element is missing (e.g. embedded views)
    var el = document.getElementById('db-toast');
    if (el) {
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(function () { el.classList.remove('show'); }, 3000);
    } else if (window.UIUtils && window.UIUtils.showToast) {
      window.UIUtils.showToast(msg);
    }
  }

  // Delegate to shared utilities (with inline fallback for standalone deck.html)
  function esc(s) { return (window.UIUtils && window.UIUtils.escapeHtml) ? window.UIUtils.escapeHtml(s) : (function() { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; })(); }
  function escAttr(s) { return (window.UIUtils && window.UIUtils.escapeHtmlAttr) ? window.UIUtils.escapeHtmlAttr(s) : (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

})();
