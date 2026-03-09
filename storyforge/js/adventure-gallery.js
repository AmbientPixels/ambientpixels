/**
 * adventure-gallery.js — StoryForge gallery controller
 * Phase 5: masonry layout, sort, search, enhanced cards, redesigned detail modal
 */
(function () {
  'use strict';

  var UI = window.AdventureUI;
  var Share = window.AdventureShare;

  var GALLERY_API = '/api/storyforgegallery';
  var PAGE_SIZE = 18;

  var genres = [];
  var allAdventures = []; // all fetched adventures (for client-side sort/search)
  var filteredAdventures = [];
  var currentGenre = null;
  var currentPage = 1;
  var allLoaded = false;
  var searchQuery = '';
  var sortMode = 'newest';

  var GENRE_ICONS = {
    fantasy: 'fa-dragon', horror: 'fa-ghost', scifi: 'fa-rocket',
    detective: 'fa-magnifying-glass', postapoc: 'fa-radiation', pirate: 'fa-skull-crossbones'
  };

  var GENRE_COLORS = {
    fantasy: '#7C3AED', horror: '#EF4444', scifi: '#06B6D4',
    detective: '#FBBF24', postapoc: '#84CC16', pirate: '#F97316'
  };

  var ENDING_LABELS = { victory: 'Victory', death: 'Defeated', escape: 'Escaped' };
  var ENDING_ICONS = { victory: 'fa-trophy', death: 'fa-skull', escape: 'fa-person-running' };

  var XP_PER_LEVEL = [0, 30, 80, 150, 250, 400];
  function getLevelFromXP(xp) {
    if (!xp) return 1;
    for (var i = XP_PER_LEVEL.length - 1; i >= 0; i--) {
      if (xp >= XP_PER_LEVEL[i]) return i + 1;
    }
    return 1;
  }

  function init() {
    loadGenres().then(function () {
      renderFilterTabs();
      bindEvents();
      fetchGallery(null, 1);
      handleDeepLink();
    });
  }

  function loadGenres() {
    return fetch('/storyforge/data/genres.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { genres = data.genres || []; })
      .catch(function () { genres = []; });
  }

  // --- Stats Bar ---
  function updateStatsBar() {
    var bar = UI.$('galleryStatsBar');
    if (!bar) return;

    var total = allAdventures.length;
    var victories = allAdventures.filter(function (a) { return a.endingType === 'victory'; }).length;
    var deaths = allAdventures.filter(function (a) { return a.endingType === 'death'; }).length;
    var genreSet = {};
    allAdventures.forEach(function (a) { if (a.genre) genreSet[a.genre] = true; });
    var genreCount = Object.keys(genreSet).length;

    bar.innerHTML =
      '<div class="adv-gallery__stat-chip"><i class="fas fa-scroll"></i> <strong>' + total + '</strong> adventures</div>' +
      '<div class="adv-gallery__stat-chip"><i class="fas fa-trophy"></i> <strong>' + victories + '</strong> victories</div>' +
      '<div class="adv-gallery__stat-chip"><i class="fas fa-skull"></i> <strong>' + deaths + '</strong> defeats</div>' +
      '<div class="adv-gallery__stat-chip"><i class="fas fa-masks-theater"></i> <strong>' + genreCount + '</strong> genres</div>';
  }

  // --- Filter Tabs ---
  function renderFilterTabs() {
    var container = UI.$('galleryFilters');
    if (!container) return;

    var html = '<button class="adv-gallery__filter adv-gallery__filter--active" data-genre="">' +
      '<i class="fas fa-globe"></i> All</button>';

    genres.forEach(function (g) {
      html += '<button class="adv-gallery__filter" data-genre="' + g.id + '">' +
        '<i class="fas ' + g.icon + '"></i> ' + g.name + '</button>';
    });

    container.innerHTML = html;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.adv-gallery__filter');
      if (!btn) return;

      container.querySelectorAll('.adv-gallery__filter').forEach(function (b) {
        b.classList.remove('adv-gallery__filter--active');
      });
      btn.classList.add('adv-gallery__filter--active');

      currentGenre = btn.dataset.genre || null;
      applyFiltersAndRender();
    });
  }

  // --- Sort & Search ---
  function applyFiltersAndRender() {
    var results = allAdventures.slice();

    // Genre filter
    if (currentGenre) {
      results = results.filter(function (a) { return a.genre === currentGenre; });
    }

    // Search filter
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      results = results.filter(function (a) {
        return (a.playerName && a.playerName.toLowerCase().indexOf(q) !== -1) ||
               (a.characterName && a.characterName.toLowerCase().indexOf(q) !== -1) ||
               (a.endingText && a.endingText.toLowerCase().indexOf(q) !== -1) ||
               (a.genre && a.genre.toLowerCase().indexOf(q) !== -1);
      });
    }

    // Sort
    results.sort(function (a, b) {
      switch (sortMode) {
        case 'oldest':
          return (a.publishedAt || 0) - (b.publishedAt || 0);
        case 'longest':
          return (b.turnCount || 0) - (a.turnCount || 0);
        case 'shortest':
          return (a.turnCount || 0) - (b.turnCount || 0);
        case 'level':
          return (b.xp || 0) - (a.xp || 0);
        default: // newest
          return (b.publishedAt || 0) - (a.publishedAt || 0);
      }
    });

    filteredAdventures = results;
    renderGrid(results);
  }

  function renderGrid(adventures) {
    var grid = UI.$('galleryGrid');
    var emptyEl = UI.$('galleryEmpty');

    grid.classList.remove('adv-gallery__grid--loading');

    if (!adventures.length) {
      grid.innerHTML = '';
      emptyEl.style.display = '';
      UI.$('loadMoreWrap').style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    grid.innerHTML = '';

    adventures.forEach(function (adv) {
      grid.insertAdjacentHTML('beforeend', renderCard(adv));
    });

    // Bind card clicks
    grid.querySelectorAll('.adv-gallery__card').forEach(function (card, i) {
      card._advData = adventures[i];
      card.addEventListener('click', function (e) {
        // Don't open detail if clicking share button
        if (e.target.closest('.adv-gallery__card-action')) return;
        showDetail(card._advData);
      });
    });

    // Bind card share buttons
    grid.querySelectorAll('.adv-gallery__card-share').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.dataset.adventureId;
        Share.copyShareLink(id).then(function () {
          btn.innerHTML = '<i class="fas fa-check"></i>';
          setTimeout(function () {
            btn.innerHTML = '<i class="fas fa-share-nodes"></i>';
          }, 1500);
        });
      });
    });

    // Hide load more for client-side filtered views
    UI.$('loadMoreWrap').style.display = allLoaded ? 'none' : '';
  }

  // --- Fetch Gallery ---
  function fetchGallery(genre, page) {
    var url = GALLERY_API + '?page=' + page + '&limit=' + PAGE_SIZE;
    if (genre) url += '&genre=' + encodeURIComponent(genre);

    var grid = UI.$('galleryGrid');
    var emptyEl = UI.$('galleryEmpty');
    var loadMoreWrap = UI.$('loadMoreWrap');

    if (page === 1) {
      grid.innerHTML = '<div class="adv-gallery__empty"><i class="fas fa-spinner fa-spin"></i><p>Loading adventures...</p></div>';
      grid.classList.add('adv-gallery__grid--loading');
    }

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load gallery');
        return res.json();
      })
      .then(function (data) {
        var adventures = data.adventures || [];
        currentPage = data.page || page;

        if (page === 1) {
          allAdventures = adventures;
        } else {
          allAdventures = allAdventures.concat(adventures);
        }

        if (data.hasMore) {
          allLoaded = false;
        } else {
          allLoaded = true;
        }

        updateStatsBar();
        applyFiltersAndRender();
      })
      .catch(function (err) {
        if (page === 1) {
          grid.innerHTML = '';
          grid.classList.remove('adv-gallery__grid--loading');
          emptyEl.style.display = '';
        }
        console.error('Gallery fetch error:', err);
      });
  }

  // --- Render Card ---
  function renderCard(adv) {
    var genreData = genres.find(function (g) { return g.id === adv.genre; });
    var genreName = genreData ? genreData.name : (adv.genre || 'Unknown');
    var genreIcon = GENRE_ICONS[adv.genre] || 'fa-book';
    var genreColor = GENRE_COLORS[adv.genre] || '#7C3AED';

    var thumbHtml;
    var thumbSrc = adv.firstSceneImage || adv.thumbnailImage;
    var altText = UI.escapeHtml((adv.playerName || 'Adventure') + ' — ' + genreName + ' adventure');
    if (thumbSrc) {
      thumbHtml = '<img src="' + thumbSrc + '" alt="' + altText + '" loading="lazy" />';
    } else {
      thumbHtml = '<img src="/storyforge/images/genre-' + (adv.genre || 'fantasy') + '.webp" alt="' + altText + '" loading="lazy" style="opacity:0.5;filter:saturate(0.6)" />';
    }

    var endingType = adv.endingType || 'escape';
    var endingLabel = ENDING_LABELS[endingType] || 'The End';

    var level = getLevelFromXP(adv.xp);
    var levelHtml = adv.xp ? '<span class="adv-gallery__level-badge">Lv.' + level + '</span>' : '';

    var excerpt = adv.endingText
      ? UI.escapeHtml(adv.endingText.substring(0, 140)) + (adv.endingText.length > 140 ? '...' : '')
      : '';

    var characterHtml = '';
    if (adv.characterName) {
      characterHtml = '<div class="adv-gallery__card-character"><i class="fas fa-user"></i> ' +
        UI.escapeHtml(adv.characterName) + '</div>';
    }

    var dateStr = '';
    if (adv.publishedAt) {
      var d = new Date(adv.publishedAt);
      dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    return '<div class="adv-gallery__card">' +
      '<div class="adv-gallery__card-thumb">' + thumbHtml +
        '<div class="adv-gallery__card-overlay">' +
          '<span class="adv-gallery__badge adv-gallery__badge--genre" style="color:' + genreColor + ';background:' + genreColor + '22">' +
            '<i class="fas ' + genreIcon + '"></i> ' + genreName +
          '</span>' +
          '<span class="adv-gallery__badge adv-gallery__badge--' + endingType + '">' +
            '<i class="fas ' + (ENDING_ICONS[endingType] || 'fa-flag') + '"></i> ' + endingLabel +
          '</span>' +
          levelHtml +
        '</div>' +
      '</div>' +
      '<div class="adv-gallery__card-body">' +
        '<div class="adv-gallery__card-header">' +
          '<span class="adv-gallery__card-title">' + UI.escapeHtml(adv.playerName || 'Unknown Adventurer') + '</span>' +
        '</div>' +
        characterHtml +
        '<div class="adv-gallery__card-meta">' +
          '<span><i class="fas fa-shoe-prints"></i> ' + (adv.turnCount || 0) + ' turns</span>' +
          '<span><i class="fas fa-heart"></i> ' + (adv.stats ? adv.stats.hp : '?') + ' HP</span>' +
          '<span><i class="fas fa-coins"></i> ' + (adv.stats ? adv.stats.gold : 0) + '</span>' +
        '</div>' +
        (excerpt ? '<div class="adv-gallery__card-excerpt">' + excerpt + '</div>' : '') +
      '</div>' +
      '<div class="adv-gallery__card-footer">' +
        '<span class="adv-gallery__card-date">' + dateStr + '</span>' +
        '<div class="adv-gallery__card-actions">' +
          '<button class="adv-gallery__card-action adv-gallery__card-share" data-adventure-id="' + UI.escapeHtml(adv.adventureId) + '" title="Share">' +
            '<i class="fas fa-share-nodes"></i>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // --- Detail Modal ---
  function showDetail(adv) {
    var genreData = genres.find(function (g) { return g.id === adv.genre; });
    var genreName = genreData ? genreData.name : (adv.genre || 'Unknown');
    var genreIcon = GENRE_ICONS[adv.genre] || 'fa-book';
    var genreColor = GENRE_COLORS[adv.genre] || '#7C3AED';
    var endingType = adv.endingType || 'escape';
    var endingLabel = ENDING_LABELS[endingType] || 'The End';

    var level = getLevelFromXP(adv.xp);

    // Hero image
    var heroHtml;
    var heroSrc = adv.firstSceneImage || adv.thumbnailImage;
    var heroAlt = UI.escapeHtml((adv.playerName || 'Adventure') + ' scene');
    if (heroSrc) {
      heroHtml = '<div class="adv-gallery__detail-hero">' +
        '<img src="' + heroSrc + '" alt="' + heroAlt + '" />' +
        '<div class="adv-gallery__detail-hero-gradient"></div>' +
        '<button class="adv-gallery__detail-close" id="detailClose"><i class="fas fa-times"></i></button>' +
      '</div>';
    } else {
      heroHtml = '<div class="adv-gallery__detail-hero" style="aspect-ratio:auto;min-height:48px;background:rgba(var(--sf-accent-rgb),0.06)">' +
        '<button class="adv-gallery__detail-close" id="detailClose"><i class="fas fa-times"></i></button>' +
      '</div>';
    }

    // Character info
    var characterHtml = '';
    if (adv.characterName || adv.characterDesc) {
      characterHtml = '<div class="adv-gallery__detail-character">' +
        '<div class="adv-gallery__detail-character-info">' +
          '<div class="adv-gallery__detail-character-name"><i class="fas fa-user" style="margin-right:0.4rem;font-size:0.75rem;color:var(--sf-accent-soft)"></i>' + UI.escapeHtml(adv.characterName || 'Unknown') + '</div>' +
          (adv.characterDesc ? '<div class="adv-gallery__detail-character-desc">' + UI.escapeHtml(adv.characterDesc) + '</div>' : '') +
        '</div>' +
      '</div>';
    }

    // Stats
    var statsHtml =
      '<div class="adv-gallery__detail-stat"><div class="adv-gallery__detail-stat-value">' + (adv.turnCount || 0) + '</div><div class="adv-gallery__detail-stat-label">Turns</div></div>' +
      '<div class="adv-gallery__detail-stat adv-gallery__detail-stat--hp"><div class="adv-gallery__detail-stat-value">' + (adv.stats ? adv.stats.hp : '?') + '</div><div class="adv-gallery__detail-stat-label">HP</div></div>' +
      '<div class="adv-gallery__detail-stat adv-gallery__detail-stat--gold"><div class="adv-gallery__detail-stat-value">' + (adv.stats ? adv.stats.gold : 0) + '</div><div class="adv-gallery__detail-stat-label">Gold</div></div>' +
      '<div class="adv-gallery__detail-stat adv-gallery__detail-stat--rep"><div class="adv-gallery__detail-stat-value">' + (adv.stats ? adv.stats.reputation : 0) + '</div><div class="adv-gallery__detail-stat-label">Rep</div></div>';

    if (adv.xp) {
      statsHtml += '<div class="adv-gallery__detail-stat adv-gallery__detail-stat--level"><div class="adv-gallery__detail-stat-value">' + level + '</div><div class="adv-gallery__detail-stat-label">Level</div></div>';
    }

    // Event timeline
    var timelineHtml = '';
    if (adv.eventLog && adv.eventLog.length) {
      timelineHtml = '<div class="adv-gallery__detail-timeline">' +
        '<div class="adv-gallery__detail-timeline-label">Adventure Events</div>' +
        '<div class="adv-gallery__detail-events">' +
        adv.eventLog.map(function (evt) {
          return '<span class="adv-gallery__detail-event">' + UI.escapeHtml(evt.replace(/_/g, ' ')) + '</span>';
        }).join('') +
        '</div></div>';
    }

    var html =
      '<div class="adv-gallery__detail">' +
        heroHtml +
        '<div class="adv-gallery__detail-content">' +
          '<div class="adv-gallery__detail-title-row">' +
            '<span class="adv-gallery__detail-title">' +
              '<i class="fas ' + genreIcon + '" style="color:' + genreColor + '"></i>' +
              UI.escapeHtml(adv.playerName || 'Unknown') + ' — ' + genreName +
            '</span>' +
            '<span class="adv-gallery__badge adv-gallery__badge--' + endingType + '" style="font-size:0.7rem;padding:0.2rem 0.6rem">' +
              '<i class="fas ' + (ENDING_ICONS[endingType] || 'fa-flag') + '"></i> ' + endingLabel +
            '</span>' +
          '</div>' +
          characterHtml +
          '<div class="adv-gallery__detail-stats">' + statsHtml + '</div>' +
          (adv.endingText ? '<div class="adv-gallery__detail-text">' + UI.escapeHtml(adv.endingText) + '</div>' : '') +
          timelineHtml +
          '<div class="adv-gallery__detail-actions">' +
            '<button class="adv-btn adv-btn--primary" id="detailShare">' +
              '<i class="fas fa-link"></i> Copy Share Link' +
            '</button>' +
            '<a href="/storyforge/play.html?genre=' + (adv.genre || 'fantasy') + '" class="adv-btn">' +
              '<i class="fas fa-play"></i> Start Similar Adventure' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Create overlay
    var previousFocus = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'adv-gallery__overlay';
    overlay.id = 'detailOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Adventure details');
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Focus the close button
    overlay.querySelector('#detailClose').focus();

    // Store previous focus for restoration
    overlay._previousFocus = previousFocus;

    // Close handlers
    overlay.querySelector('#detailClose').addEventListener('click', closeDetail);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDetail();
    });

    // Share button
    overlay.querySelector('#detailShare').addEventListener('click', function () {
      var btn = this;
      Share.copyShareLink(adv.adventureId).then(function () {
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(function () {
          btn.innerHTML = '<i class="fas fa-link"></i> Copy Share Link';
        }, 2000);
      });
    });

    // Escape key
    document.addEventListener('keydown', handleEscape);
  }

  function closeDetail() {
    var overlay = document.getElementById('detailOverlay');
    var prevFocus = overlay ? overlay._previousFocus : null;
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleEscape);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }

  function handleEscape(e) {
    if (e.key === 'Escape') closeDetail();
  }

  // --- Deep Link ---
  function handleDeepLink() {
    var params = new URLSearchParams(window.location.search);
    var adventureId = params.get('adventure');
    if (!adventureId) return;

    fetch(GALLERY_API + '?limit=100')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var adventures = data.adventures || [];
        var adv = adventures.find(function (a) { return a.adventureId === adventureId; });
        if (adv) showDetail(adv);
      })
      .catch(function () { /* silently fail */ });
  }

  // --- Events ---
  function bindEvents() {
    // Load more (button fallback + IntersectionObserver auto-load)
    var loadMoreBtn = UI.$('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        if (!allLoaded) {
          currentPage++;
          fetchGallery(currentGenre, currentPage);
        }
      });

      // Auto-load more when "Load More" button scrolls into view
      if ('IntersectionObserver' in window) {
        var loadObserver = new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting && !allLoaded) {
            currentPage++;
            fetchGallery(currentGenre, currentPage);
          }
        }, { rootMargin: '200px' });
        loadObserver.observe(loadMoreBtn);
      }
    }

    // Search
    var searchInput = UI.$('gallerySearch');
    if (searchInput) {
      var debounceTimer = null;
      searchInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          searchQuery = searchInput.value.trim();
          applyFiltersAndRender();
        }, 250);
      });
    }

    // Sort
    var sortSelect = UI.$('gallerySort');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        sortMode = sortSelect.value;
        applyFiltersAndRender();
      });
    }
  }

  // --- Boot ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
