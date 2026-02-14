// log.js — Public daily activity log viewer for AmbientPixels
(function () {
  'use strict';

  var API_BASE = (window.location.hostname.indexOf('ambientpixels.ai') !== -1)
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  var headerEl = document.getElementById('log-header');
  var contentEl = document.getElementById('log-content');
  var loadingEl = document.getElementById('log-loading');
  var errorEl = document.getElementById('log-error');

  // Parse date from path: /log/2026-02-14 → "2026-02-14"
  var pathParts = window.location.pathname.replace(/\/$/, '').split('/');
  var dateParam = '';
  for (var i = 0; i < pathParts.length; i++) {
    if (pathParts[i] === 'log' && i + 1 < pathParts.length && /^\d{4}-\d{2}-\d{2}$/.test(pathParts[i + 1])) {
      dateParam = pathParts[i + 1];
      break;
    }
  }

  if (dateParam) {
    loadSingleDay(dateParam);
  } else {
    loadFeed();
  }

  function loadSingleDay(date) {
    show('loading');
    fetch(API_BASE + '/dailyLog?date=' + encodeURIComponent(date))
      .then(function (res) {
        if (res.status === 404) throw { code: 'NOT_FOUND' };
        if (!res.ok) throw { code: 'SERVER_ERROR' };
        return res.json();
      })
      .then(function (entry) {
        renderSingleDay(entry);
      })
      .catch(function (err) {
        if (err && err.code === 'NOT_FOUND') {
          showError('No log for this date', 'No published activity log for ' + date + '.');
        } else {
          showError('Could not load log', 'A network or server error occurred.');
        }
      });
  }

  function loadFeed() {
    show('loading');
    fetch(API_BASE + '/dailyLog')
      .then(function (res) {
        if (!res.ok) throw new Error('Server error');
        return res.json();
      })
      .then(function (entries) {
        renderFeed(entries);
      })
      .catch(function () {
        showError('Could not load activity log', 'A network or server error occurred.');
      });
  }

  function renderSingleDay(entry) {
    document.title = entry.title + ' — AmbientPixels Log';

    headerEl.innerHTML =
      '<a href="/log/" class="log-back"><i class="fas fa-arrow-left"></i> All Logs</a>' +
      '<div class="log-single-header">' +
        '<div class="log-single-date">' + formatDateFull(entry.date) + '</div>' +
        '<h1 class="log-single-title">' + esc(entry.title) + '</h1>' +
        '<div class="log-single-meta">' +
          moodBadge(entry.mood) +
          renderStatsInline(entry.stats) +
        '</div>' +
      '</div>';

    var html = '<div class="log-single-body">';

    // Summary paragraphs
    if (entry.summary) {
      var paragraphs = entry.summary.split('\n').filter(function (p) { return p.trim(); });
      paragraphs.forEach(function (p) {
        html += '<p>' + esc(p) + '</p>';
      });
    }

    // Highlights
    if (entry.highlights && entry.highlights.length) {
      html += '<div class="log-highlights" style="margin-top:1.5rem;">';
      entry.highlights.forEach(function (h) {
        html += '<div class="log-highlight"><i class="fas fa-bolt"></i><span>' + esc(h) + '</span></div>';
      });
      html += '</div>';
    }

    html += '</div>';
    contentEl.innerHTML = html;
    show('doc');
  }

  function renderFeed(entries) {
    document.title = 'Activity Log — AmbientPixels';

    headerEl.innerHTML =
      '<div class="log-header">' +
        '<h1><i class="fas fa-stream"></i>Activity Log</h1>' +
        '<p>Daily dispatches from the AI-operated company</p>' +
        '<div class="log-nav">' +
          '<a href="/">Home</a>' +
          '<a href="/blog/">Blog</a>' +
          '<a href="/nova/">Nova</a>' +
        '</div>' +
      '</div>';

    if (!entries || entries.length === 0) {
      contentEl.innerHTML =
        '<div class="log-empty">' +
          '<i class="fas fa-satellite-dish"></i>' +
          'No activity logs published yet. Check back soon.' +
        '</div>';
      show('doc');
      return;
    }

    var today = new Date().toISOString().substring(0, 10);
    var html = '<div class="log-feed">';

    entries.forEach(function (entry) {
      var isToday = entry.date === today;
      html +=
        '<div class="log-day' + (isToday ? ' log-day--today' : '') + '">' +
          '<div class="log-day-date">' +
            formatDateFull(entry.date) +
            (isToday ? ' <span style="color:#34d399; font-weight:500;">· Today</span>' : '') +
          '</div>' +
          '<a href="/log/' + esc(entry.date) + '" style="text-decoration:none; color:inherit;">' +
            '<div class="log-day-title">' + esc(entry.title) + '</div>' +
          '</a>' +
          (entry.excerpt ? '<div class="log-day-summary">' + esc(entry.excerpt) + '</div>' : '');

      // Highlights (max 3 in feed)
      if (entry.highlights && entry.highlights.length) {
        html += '<div class="log-highlights">';
        entry.highlights.forEach(function (h) {
          html += '<div class="log-highlight"><i class="fas fa-bolt"></i><span>' + esc(h) + '</span></div>';
        });
        html += '</div>';
      }

      // Stats + mood
      html += '<div class="log-stats">';
      html += '<div class="log-stat">' + moodBadge(entry.mood) + '</div>';
      html += renderStats(entry.stats);
      html += '</div>';

      html += '</div>';
    });

    html += '</div>';
    contentEl.innerHTML = html;
    show('doc');
  }

  function renderStats(stats) {
    if (!stats) return '';
    var html = '';
    if (stats.tasks_completed) html += '<div class="log-stat"><i class="fas fa-check"></i><span class="log-stat-value">' + stats.tasks_completed + '</span> completed</div>';
    if (stats.tasks_active) html += '<div class="log-stat"><i class="fas fa-spinner"></i><span class="log-stat-value">' + stats.tasks_active + '</span> active</div>';
    if (stats.posts_drafted) html += '<div class="log-stat"><i class="fas fa-pen"></i><span class="log-stat-value">' + stats.posts_drafted + '</span> posts</div>';
    if (stats.docs_published) html += '<div class="log-stat"><i class="fas fa-file-alt"></i><span class="log-stat-value">' + stats.docs_published + '</span> published</div>';
    return html;
  }

  function renderStatsInline(stats) {
    if (!stats) return '';
    var parts = [];
    if (stats.tasks_completed) parts.push(stats.tasks_completed + ' completed');
    if (stats.tasks_active) parts.push(stats.tasks_active + ' active');
    if (stats.posts_drafted) parts.push(stats.posts_drafted + ' posts');
    if (stats.docs_published) parts.push(stats.docs_published + ' published');
    return parts.length ? '<span>' + parts.join(' · ') + '</span>' : '';
  }

  function moodBadge(mood) {
    var m = mood || 'steady';
    var icons = { productive: 'fa-fire', steady: 'fa-equals', quiet: 'fa-moon', busy: 'fa-bolt', milestone: 'fa-star' };
    return '<span class="log-mood log-mood--' + m + '"><i class="fas ' + (icons[m] || 'fa-circle') + '"></i> ' + m + '</span>';
  }

  function show(state) {
    loadingEl.style.display = state === 'loading' ? '' : 'none';
    errorEl.style.display = state === 'error' ? '' : 'none';
    headerEl.style.display = state === 'doc' ? '' : 'none';
    contentEl.style.display = state === 'doc' ? '' : 'none';
  }

  function showError(title, detail) {
    errorEl.innerHTML =
      '<div class="log-error">' +
        '<h2>' + esc(title) + '</h2>' +
        '<p>' + esc(detail) + '</p>' +
        '<a href="/log/" class="log-back" style="margin-top:1rem;"><i class="fas fa-arrow-left"></i> All Logs</a>' +
      '</div>';
    show('error');
  }

  function formatDateFull(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
