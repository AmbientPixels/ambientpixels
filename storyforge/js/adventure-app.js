/**
 * adventure-app.js — StoryForge hub controller
 */
(function () {
  'use strict';

  var UI = window.AdventureUI;
  var Storage = window.AdventureStorage;

  var genres = [];

  function init() {
    loadGenres().then(function () {
      renderGenreGrid();
      loadSavedAdventures();
    });
  }

  function loadGenres() {
    return fetch('/storyforge/data/genres.json')
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
      return '<a href="/storyforge/play.html?genre=' + g.id + '" class="adv-hub__genre">' +
        '<div class="adv-hub__genre-icon" style="color:' + g.color + '">' +
          '<i class="fas ' + g.icon + '"></i>' +
        '</div>' +
        '<div class="adv-hub__genre-name">' + g.name + '</div>' +
        '<div class="adv-hub__genre-desc">' + g.description + '</div>' +
      '</a>';
    }).join('');
  }

  // --- Saved Adventures ---
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
      grid.innerHTML = inProgress.map(function (adv) {
        var genreData = genres.find(function (g) { return g.id === adv.genre; });
        var genreName = genreData ? genreData.name : adv.genre;
        var genreIcon = genreData ? genreData.icon : 'fa-book';
        var genreColor = genreData ? genreData.color : '#7B8FE0';

        var thumbHtml = adv.firstSceneImage
          ? '<img src="' + adv.firstSceneImage + '" alt="" />'
          : '<i class="fas ' + genreIcon + '" style="color:' + genreColor + '"></i>';

        var turnInfo = 'Turn ' + (adv.turnCount || 0) + '/' + (adv.maxTurns || 25);
        var hpInfo = 'HP ' + (adv.stats ? adv.stats.hp : '?');

        return '<div class="adv-hub__save-card" data-adventure-id="' + adv.adventureId + '">' +
          '<div class="adv-hub__save-thumb">' + thumbHtml + '</div>' +
          '<div class="adv-hub__save-info">' +
            '<div class="adv-hub__save-name">' + UI.escapeHtml(adv.playerName || 'Unknown') + ' — ' + genreName + '</div>' +
            '<div class="adv-hub__save-meta">' +
              '<span>' + turnInfo + '</span>' +
              '<span>' + hpInfo + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="adv-hub__save-status adv-hub__save-status--in_progress">In Progress</span>' +
        '</div>';
      }).join('');

      // Click to continue
      grid.querySelectorAll('.adv-hub__save-card').forEach(function (card) {
        card.addEventListener('click', function () {
          var id = card.dataset.adventureId;
          window.location.href = '/storyforge/play.html?continue=' + encodeURIComponent(id);
        });
      });
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
