/**
 * adventure-gallery.js — StoryForge public gallery controller
 */
(function () {
  'use strict';

  var UI = window.AdventureUI;
  var Share = window.AdventureShare;

  var GALLERY_API = '/api/storyforgegallery';
  var PAGE_SIZE = 12;

  var genres = [];
  var currentGenre = null;
  var currentPage = 1;
  var allLoaded = false;

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
      currentPage = 1;
      allLoaded = false;
      UI.$('galleryGrid').innerHTML = '';
      fetchGallery(currentGenre, 1);
    });
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
    }

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load gallery');
        return res.json();
      })
      .then(function (data) {
        var adventures = data.adventures || [];
        currentPage = data.page || page;

        if (page === 1) grid.innerHTML = '';

        if (!adventures.length && page === 1) {
          emptyEl.style.display = '';
          loadMoreWrap.style.display = 'none';
          return;
        }

        emptyEl.style.display = 'none';

        adventures.forEach(function (adv) {
          grid.insertAdjacentHTML('beforeend', renderCard(adv));
        });

        // Bind card clicks
        grid.querySelectorAll('.adv-gallery__card:not([data-bound])').forEach(function (card) {
          card.setAttribute('data-bound', '1');
          card.addEventListener('click', function () {
            var id = card.dataset.adventureId;
            var advData = card._advData;
            if (advData) showDetail(advData);
          });
        });

        // Store data on card elements
        var cards = grid.querySelectorAll('.adv-gallery__card:not([data-stored])');
        var offset = (page - 1) * PAGE_SIZE;
        adventures.forEach(function (adv, i) {
          var card = cards[i];
          if (card) {
            card._advData = adv;
            card.setAttribute('data-stored', '1');
          }
        });

        if (data.hasMore) {
          loadMoreWrap.style.display = '';
          allLoaded = false;
        } else {
          loadMoreWrap.style.display = 'none';
          allLoaded = true;
        }
      })
      .catch(function (err) {
        if (page === 1) {
          grid.innerHTML = '';
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
    if (adv.firstSceneImage) {
      thumbHtml = '<img src="' + adv.firstSceneImage + '" alt="" loading="lazy" />';
    } else {
      // Use genre illustration as fallback
      thumbHtml = '<img src="/storyforge/images/genre-' + (adv.genre || 'fantasy') + '.png" alt="" loading="lazy" style="opacity:0.6" />';
    }

    var endingType = adv.endingType || 'escape';
    var endingLabel = ENDING_LABELS[endingType] || 'The End';
    var endingBadgeClass = 'adv-gallery__badge--' + endingType;

    var excerpt = adv.endingText
      ? UI.escapeHtml(adv.endingText.substring(0, 120)) + (adv.endingText.length > 120 ? '...' : '')
      : '';

    return '<div class="adv-gallery__card" data-adventure-id="' + UI.escapeHtml(adv.adventureId) + '">' +
      '<div class="adv-gallery__card-thumb">' + thumbHtml + '</div>' +
      '<div class="adv-gallery__card-body">' +
        '<div class="adv-gallery__card-header">' +
          '<span class="adv-gallery__card-title">' + UI.escapeHtml(adv.playerName || 'Unknown') + '</span>' +
          '<span class="adv-gallery__badge adv-gallery__badge--genre" style="color:' + genreColor + ';background:' + genreColor + '18">' + genreName + '</span>' +
          '<span class="adv-gallery__badge ' + endingBadgeClass + '">' +
            '<i class="fas ' + (ENDING_ICONS[endingType] || 'fa-flag') + '"></i> ' + endingLabel +
          '</span>' +
        '</div>' +
        '<div class="adv-gallery__card-meta">' +
          '<span><i class="fas fa-shoe-prints"></i> ' + (adv.turnCount || 0) + ' turns</span>' +
          '<span><i class="fas fa-heart"></i> ' + (adv.stats ? adv.stats.hp : '?') + ' HP</span>' +
          '<span><i class="fas fa-coins"></i> ' + (adv.stats ? adv.stats.gold : 0) + ' gold</span>' +
        '</div>' +
        (excerpt ? '<div class="adv-gallery__card-excerpt">' + excerpt + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  // --- Detail Overlay ---
  function showDetail(adv) {
    var genreData = genres.find(function (g) { return g.id === adv.genre; });
    var genreName = genreData ? genreData.name : (adv.genre || 'Unknown');
    var genreIcon = GENRE_ICONS[adv.genre] || 'fa-book';
    var genreColor = GENRE_COLORS[adv.genre] || '#7C3AED';
    var endingType = adv.endingType || 'escape';
    var endingLabel = ENDING_LABELS[endingType] || 'The End';

    // Image
    var imageHtml = '';
    if (adv.firstSceneImage) {
      imageHtml = '<div class="adv-gallery__detail-image"><img src="' + adv.firstSceneImage + '" alt="" /></div>';
    }

    // Stats
    var statsHtml =
      '<div class="adv-gallery__detail-stat"><div class="adv-gallery__detail-stat-value">' + (adv.turnCount || 0) + '</div><div class="adv-gallery__detail-stat-label">Turns</div></div>' +
      '<div class="adv-gallery__detail-stat"><div class="adv-gallery__detail-stat-value">' + (adv.stats ? adv.stats.hp : '?') + '</div><div class="adv-gallery__detail-stat-label">HP</div></div>' +
      '<div class="adv-gallery__detail-stat"><div class="adv-gallery__detail-stat-value">' + (adv.stats ? adv.stats.gold : 0) + '</div><div class="adv-gallery__detail-stat-label">Gold</div></div>' +
      '<div class="adv-gallery__detail-stat"><div class="adv-gallery__detail-stat-value">' + (adv.stats ? adv.stats.reputation : 0) + '</div><div class="adv-gallery__detail-stat-label">Rep</div></div>';

    // Events
    var eventsHtml = '';
    if (adv.eventLog && adv.eventLog.length) {
      eventsHtml = '<div class="adv-gallery__detail-events">' +
        adv.eventLog.map(function (evt) {
          return '<span class="adv-gallery__detail-event">' + UI.escapeHtml(evt.replace(/_/g, ' ')) + '</span>';
        }).join('') +
      '</div>';
    }

    var html =
      '<div class="adv-gallery__detail">' +
        '<div class="adv-gallery__detail-header">' +
          '<span class="adv-gallery__detail-title">' +
            '<i class="fas ' + genreIcon + '" style="color:' + genreColor + ';margin-right:0.5rem"></i>' +
            UI.escapeHtml(adv.playerName || 'Unknown') + ' — ' + genreName +
          '</span>' +
          '<button class="adv-gallery__detail-close" id="detailClose"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="adv-gallery__detail-body">' +
          imageHtml +
          '<div style="display:flex;align-items:center;gap:0.5rem">' +
            '<span class="adv-gallery__badge adv-gallery__badge--' + endingType + '" style="font-size:0.75rem;padding:0.25rem 0.75rem">' +
              '<i class="fas ' + (ENDING_ICONS[endingType] || 'fa-flag') + '"></i> ' + endingLabel +
            '</span>' +
          '</div>' +
          '<div class="adv-gallery__detail-stats">' + statsHtml + '</div>' +
          (adv.endingText ? '<div class="adv-gallery__detail-text">' + UI.escapeHtml(adv.endingText) + '</div>' : '') +
          eventsHtml +
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
    var overlay = document.createElement('div');
    overlay.className = 'adv-gallery__overlay';
    overlay.id = 'detailOverlay';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

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
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', handleEscape);
  }

  function handleEscape(e) {
    if (e.key === 'Escape') closeDetail();
  }

  // --- Deep Link ---
  function handleDeepLink() {
    var params = new URLSearchParams(window.location.search);
    var adventureId = params.get('adventure');
    if (!adventureId) return;

    // Fetch the specific adventure for the detail view
    fetch(GALLERY_API + '?limit=100')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var adventures = data.adventures || [];
        var adv = adventures.find(function (a) { return a.adventureId === adventureId; });
        if (adv) {
          showDetail(adv);
        }
      })
      .catch(function () {
        // Silently fail — user still sees gallery
      });
  }

  // --- Events ---
  function bindEvents() {
    var loadMoreBtn = UI.$('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        if (!allLoaded) {
          currentPage++;
          fetchGallery(currentGenre, currentPage);
        }
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
