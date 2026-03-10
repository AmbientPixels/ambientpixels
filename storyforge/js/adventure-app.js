/**
 * adventure-app.js — StoryForge hub controller
 */
(function () {
  'use strict';

  var UI = window.AdventureUI;
  var Storage = window.AdventureStorage;
  var Ent = window.AdventureEntitlements;

  var genres = [];

  function hexToRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return r + ', ' + g + ', ' + b;
  }

  function init() {
    // Wait for auth check to complete before loading entitlements
    var authPromise = window.authReady || Promise.resolve();
    var entPromise = authPromise.then(function () { return Ent ? Ent.load() : null; });
    Promise.all([loadGenres(), entPromise]).then(function () {
      renderGenreGrid();
      loadSavedAdventures();
      handleCheckoutSuccess();
      updateDailyLimitBadge();
    });
  }

  function updateDailyLimitBadge() {
    var badge = document.getElementById('dailyLimitBadge');
    if (!badge) return;
    if (Ent && Ent.isPro()) { badge.style.display = 'none'; return; }
    var limit = (Ent && Ent.getDailyLimit) ? Ent.getDailyLimit() : 3;
    var remaining = getDailyRemaining(limit);
    badge.innerHTML = '<i class="fas fa-bolt"></i> ' + remaining + ' of ' + limit + ' free adventures remaining today';
    badge.className = 'adv-daily-limit' + (remaining === 0 ? ' adv-daily-limit--empty' : '');
    badge.style.display = '';
  }

  function getDailyRemaining(limit) {
    try {
      var stored = JSON.parse(localStorage.getItem('storyforge-ai-usage') || '{}');
      var today = new Date().toISOString().slice(0, 10);
      if (stored.date === today) return Math.max(0, limit - stored.count);
    } catch (e) { /* ignore */ }
    return limit;
  }

  function handleCheckoutSuccess() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      UI.toast('Welcome to StoryForge Pro!', 'success');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  function loadGenres() {
    return fetch('/storyforge/data/genres.json?v=2')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        genres = data.genres || [];
      })
      .catch(function (err) {
        console.error('Failed to load genres:', err);
      });
  }

  // --- Genre Grid ---
  function renderGenreGrid() {
    var grid = document.getElementById('genreGrid');
    if (!grid || !genres.length) return;

    grid.innerHTML = genres.map(function (g) {
      var isLocked = Ent && !Ent.canAccessGenre(g.id, g.tier);
      var lockedClass = isLocked ? ' adv-hub__genre--locked' : '';
      var lockBadge = isLocked ? '<div class="adv-hub__genre-lock"><i class="fas fa-lock"></i> Pro</div>' : '';
      var rgb = hexToRgb(g.color || '#7C3AED');

      return '<a href="' + (isLocked ? '#' : '/storyforge/play.html?genre=' + g.id) +
        '" class="adv-hub__genre' + lockedClass + '" data-genre="' + g.id + '" data-tier="' + (g.tier || 'free') +
        '" style="--genre-color:' + g.color + '; --genre-rgb:' + rgb + '">' +
        '<img class="adv-hub__genre-img" src="images/genre-' + g.id + '.webp" alt="' + g.name + '" loading="lazy" />' +
        lockBadge +
        '<div class="adv-hub__genre-name">' + g.name + '</div>' +
        '<div class="adv-hub__genre-desc">' + g.description + '</div>' +
      '</a>';
    }).join('') +
      '<div class="adv-hub__genre adv-hub__genre--coming-soon">' +
        '<div class="adv-hub__coming-soon-icon"><i class="fas fa-plus"></i></div>' +
        '<div class="adv-hub__genre-name">More Coming Soon</div>' +
        '<div class="adv-hub__genre-desc">New genres & stories on the way</div>' +
      '</div>';

    // Intercept clicks on locked genres
    grid.querySelectorAll('.adv-hub__genre--locked').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var genreName = el.querySelector('.adv-hub__genre-name').textContent;
        Ent.showUpgradePrompt('The ' + genreName + ' genre requires StoryForge Pro.');
      });
    });
  }

  // --- Helpers ---
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return Math.floor(days / 7) + 'w ago';
  }

  // --- Saved Adventures ---
  var MAX_VISIBLE_SAVES = 6;

  function loadSavedAdventures() {
    Storage.loadAdventures().then(function (adventures) {
      var inProgress = adventures.filter(function (a) {
        return a.status !== 'completed' && a.status !== 'abandoned';
      });

      var section = document.getElementById('savedSection');
      var grid = document.getElementById('savedGrid');
      if (!section || !grid) return;

      if (!inProgress.length) {
        section.style.display = 'none';
        return;
      }

      section.style.display = '';
      var showAll = inProgress.length <= MAX_VISIBLE_SAVES;
      var visible = showAll ? inProgress : inProgress.slice(0, MAX_VISIBLE_SAVES);

      function renderCards(list) {
        return list.map(function (adv) {
          var genreData = genres.find(function (g) { return g.id === adv.genre; });
          var genreName = genreData ? genreData.name : adv.genre;
          var genreIcon = genreData ? genreData.icon : 'fa-book';
          var genreColor = genreData ? genreData.color : '#7C3AED';

          var thumbSrc = adv.firstSceneImage || adv.thumbnailImage;
          var thumbHtml = thumbSrc
            ? '<img src="' + thumbSrc + '" alt="" loading="lazy" />'
            : '<i class="fas ' + genreIcon + '" style="color:' + genreColor + '"></i>';

          var turns = adv.turnCount || 0;
          var maxTurns = adv.maxTurns || 25;
          var turnInfo = 'Turn ' + turns + '/' + maxTurns;
          var progressPct = Math.round((turns / maxTurns) * 100);
          var hp = adv.stats ? adv.stats.hp : 0;
          var maxHp = adv.stats ? adv.stats.maxHp : 100;
          var hpPct = Math.round((hp / maxHp) * 100);
          var hpClass = hpPct <= 25 ? 'adv-hub__save-hp-fill--low' : hpPct <= 50 ? 'adv-hub__save-hp-fill--warning' : '';
          var ago = timeAgo(adv.updatedAt);

          return '<div class="adv-hub__save-card" data-adventure-id="' + adv.adventureId + '">' +
            '<button class="adv-hub__save-delete" data-delete-id="' + adv.adventureId + '" title="Delete save"><i class="fas fa-trash-alt"></i></button>' +
            '<div class="adv-hub__save-thumb">' + thumbHtml + '</div>' +
            '<div class="adv-hub__save-info">' +
              (adv.storyTitle ? '<div class="adv-hub__save-story-title">' + UI.escapeHtml(adv.storyTitle) + '</div>' : '') +
              '<div class="adv-hub__save-name">' + UI.escapeHtml(adv.playerName || 'Unknown') + ' — ' + genreName + '</div>' +
              '<div class="adv-hub__save-meta">' +
                '<span>' + turnInfo + '</span>' +
                '<span class="adv-hub__save-hp">HP ' +
                  '<span class="adv-hub__save-hp-bar"><span class="adv-hub__save-hp-fill ' + hpClass + '" style="width:' + hpPct + '%"></span></span>' +
                  hp +
                '</span>' +
                (ago ? '<span class="adv-hub__save-ago">' + ago + '</span>' : '') +
              '</div>' +
            '</div>' +
            '<span class="adv-hub__save-status adv-hub__save-status--in_progress">In Progress</span>' +
            '<div class="adv-hub__save-progress"><div class="adv-hub__save-progress-fill" style="width:' + progressPct + '%"></div></div>' +
          '</div>';
        }).join('');
      }

      grid.innerHTML = renderCards(visible);

      // "View All" toggle if more than MAX_VISIBLE_SAVES
      if (!showAll) {
        var toggleHtml = '<button class="adv-btn adv-hub__save-toggle" id="saveToggleBtn">' +
          '<i class="fas fa-chevron-down"></i> View All (' + inProgress.length + ')' +
          '</button>';
        grid.insertAdjacentHTML('afterend', toggleHtml);
        var expanded = false;
        document.getElementById('saveToggleBtn').addEventListener('click', function () {
          expanded = !expanded;
          grid.innerHTML = renderCards(expanded ? inProgress : visible);
          this.innerHTML = expanded
            ? '<i class="fas fa-chevron-up"></i> Show Less'
            : '<i class="fas fa-chevron-down"></i> View All (' + inProgress.length + ')';
          wireCardEvents();
        });
      }

      function wireCardEvents() {
        // Click to continue
        grid.querySelectorAll('.adv-hub__save-card').forEach(function (card) {
          card.addEventListener('click', function (e) {
            if (e.target.closest('.adv-hub__save-delete')) return;
            var id = card.dataset.adventureId;
            window.location.href = '/storyforge/play.html?continue=' + encodeURIComponent(id);
          });
        });
        // Delete buttons
        grid.querySelectorAll('.adv-hub__save-delete').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var id = btn.dataset.deleteId;
            if (!confirm('Delete this save? This cannot be undone.')) return;
            Storage.deleteAdventure(id).then(function () {
              loadSavedAdventures();
            });
          });
        });
      }
      wireCardEvents();
    }).catch(function (err) {
      console.error('Failed to load saved adventures:', err);
    });
  }

  // --- Boot ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
