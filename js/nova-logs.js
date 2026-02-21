// nova-logs.js — Execution Log Controller
// Auto-derives execution summary, changelog, and brief archive from public data.
// No manual input required.

(function () {
  'use strict';

  var GITHUB_REPO = 'AmbientPixels/ambientpixels';
  var GITHUB_COMMITS_URL = 'https://api.github.com/repos/' + GITHUB_REPO + '/commits?per_page=15';

  document.addEventListener('DOMContentLoaded', function () {
    loadExecutionSummary();
    loadChangelog();
    loadBriefArchive();
  });

  // ── Today's Execution Summary (auto-derived from PublicLogFeed) ──
  async function loadExecutionSummary() {
    var container = document.getElementById('el-summary');
    if (!container) return;

    var entries = [];
    try {
      if (typeof PublicLogFeed !== 'undefined') {
        entries = await PublicLogFeed.fetchDailyLogFeed();
      }
    } catch (err) {
      console.warn('[Execution Log] PublicLogFeed unavailable:', err.message);
    }

    if (!entries.length) {
      container.innerHTML =
        '<p class="el-summary-empty-title">No recent execution events detected.</p>' +
        '<p class="el-summary-empty-body">Snapshot mode. This log updates automatically as system activity occurs.</p>';
      return;
    }

    var now = new Date();
    var oneDayAgo = new Date(now.getTime() - 86400000);

    var recent = entries.filter(function (e) {
      return new Date(e.date || e.published_at || e.generated_at) >= oneDayAgo;
    });

    var source = recent.length ? recent : entries.slice(0, 3);
    var recencyLabel = recent.length
      ? 'Last 24 hours'
      : 'Most recent entries (older than 24h)';

    var lastDate = new Date(source[0].date || source[0].published_at || source[0].generated_at);
    var diffMs = now - lastDate;
    var diffH = Math.floor(diffMs / 3600000);
    var cadenceLabel = diffH < 1 ? 'Less than 1 hour ago'
      : diffH < 24 ? diffH + ' hours ago'
      : Math.floor(diffH / 24) + ' days ago';

    var bullets = source.slice(0, 5).map(function (e) {
      var title = escapeHtml(e.title || e.summary || 'Activity recorded');
      var stats = e.stats || {};
      var meta = [];
      if (typeof stats.tasks_completed === 'number') meta.push(stats.tasks_completed + ' completed');
      if (typeof stats.tasks_active === 'number') meta.push(stats.tasks_active + ' active');
      var metaStr = meta.length ? ' <span class="el-summary-meta">' + meta.join(', ') + '</span>' : '';
      return '<li>' + title + metaStr + '</li>';
    });

    container.innerHTML =
      '<div class="el-summary-row">' +
        '<span class="el-summary-label">Cadence</span>' +
        '<span class="el-summary-value">' + cadenceLabel + '</span>' +
      '</div>' +
      '<div class="el-summary-row">' +
        '<span class="el-summary-label">Scope</span>' +
        '<span class="el-summary-value">' + recencyLabel + ' (' + source.length + ' entries)</span>' +
      '</div>' +
      '<div class="el-summary-activity">' +
        '<p class="el-summary-activity-head">Key activity</p>' +
        '<ul class="el-summary-list">' + bullets.join('') + '</ul>' +
      '</div>';
  }

  // ── Site Activity Timeline (GitHub API, static fallback) ──
  async function loadChangelog() {
    var timeline = document.getElementById('el-changelog-timeline');
    if (!timeline) return;

    try {
      var res = await fetch(GITHUB_COMMITS_URL, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (res.ok) {
        var commits = await res.json();
        if (commits.length > 0) {
          renderTimeline(timeline, commits.map(function (c) {
            return {
              hash: c.sha.substring(0, 7),
              date: c.commit.author.date,
              message: c.commit.message.split('\n')[0],
              url: c.html_url
            };
          }));
          return;
        }
      }
    } catch (err) {
      console.warn('[Execution Log] GitHub API unavailable:', err.message);
    }

    try {
      var res2 = await fetch('/data/changelog.json?t=' + Date.now());
      var data = await res2.json();
      if (data.entries && data.entries.length) {
        renderTimeline(timeline, data.entries.slice(0, 15));
        return;
      }
    } catch (err) {
      console.warn('[Execution Log] Static changelog also unavailable:', err.message);
    }

    timeline.innerHTML = '<li class="el-timeline-entry"><div class="el-timeline-msg">No site activity available. Snapshot mode.</div></li>';
  }

  function renderTimeline(timeline, entries) {
    timeline.innerHTML = '';
    entries.forEach(function (entry) {
      var date = new Date(entry.date).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      var li = document.createElement('li');
      li.className = 'el-timeline-entry';
      var hashHtml = entry.url
        ? '<a href="' + entry.url + '" target="_blank" rel="noopener" class="el-timeline-hash">' + escapeHtml(entry.hash) + '</a>'
        : '<span class="el-timeline-hash">' + escapeHtml(entry.hash) + '</span>';
      li.innerHTML =
        '<div class="el-timeline-date">' + date + '</div>' +
        '<div class="el-timeline-msg">' + escapeHtml(entry.message) + ' ' + hashHtml + '</div>';
      timeline.appendChild(li);
    });
  }

  // ── Brief Archive (dailyLog API + static fallback) ──
  async function loadBriefArchive() {
    var briefList = document.getElementById('el-brief-list');
    if (!briefList) return;

    var rows = [];

    try {
      if (typeof PublicLogFeed !== 'undefined') {
        var entries = await PublicLogFeed.fetchDailyLogFeed();
        if (entries.length) {
          rows = entries.slice(0, 12).map(function (entry) {
            return { date: formatDate(entry.date), text: buildBriefText(entry) };
          });
        }
      }
    } catch (err) {
      console.warn('[Execution Log] Brief archive API unavailable:', err.message);
    }

    if (!rows.length) {
      try {
        var fallbackRes = await fetch('/data/daily-logs.json?t=' + Date.now());
        var fallback = await fallbackRes.json();
        if (Array.isArray(fallback) && fallback.length) {
          rows = fallback.slice(0, 12).map(function (entry) {
            return { date: formatDate(entry.timestamp), text: entry.message || 'Site activity update.' };
          });
        }
      } catch (e) {
        console.warn('[Execution Log] Static brief archive unavailable:', e.message);
      }
    }

    if (!rows.length) {
      briefList.innerHTML = '<li class="el-brief-empty">No published briefs available.</li>';
      return;
    }

    briefList.innerHTML = '';
    rows.forEach(function (row) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="el-brief-date">' + escapeHtml(row.date) + '</span>' + escapeHtml(row.text);
      briefList.appendChild(li);
    });
  }

  // ── Utility ──
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(value) {
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Unknown date';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function buildBriefText(entry) {
    if (!entry) return 'Brief entry unavailable.';
    var stats = entry.stats || {};
    var parts = [];
    if (typeof stats.tasks_completed === 'number') parts.push(stats.tasks_completed + ' completed');
    if (typeof stats.tasks_active === 'number') parts.push(stats.tasks_active + ' active');
    if (typeof stats.tasks_created === 'number') parts.push(stats.tasks_created + ' created');
    if (parts.length) return parts.join(' / ');
    return entry.title || entry.excerpt || 'Daily brief recorded.';
  }

})();
