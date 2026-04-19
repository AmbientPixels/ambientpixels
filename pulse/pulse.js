// pulse.js — Public "Live Pulse" page
// Fetches /api/dailyLog + /api/blogPosts and populates dashboard-style tiles.
// Uses /js/public-log-feed.js for shared feed fetchers.
(function () {
  'use strict';

  if (window.ProductAnalytics) try { ProductAnalytics.init('pulse'); } catch (_) {}

  var feed = window.PublicLogFeed;
  var API_BASE = feed ? feed.getApiBase() : '/api';

  var MOODS = {
    productive: { label: 'Productive', tone: 'live' },
    steady:     { label: 'Steady',     tone: 'normal' },
    quiet:      { label: 'Quiet',      tone: 'dim' },
    busy:       { label: 'Busy',       tone: 'live' },
    milestone:  { label: 'Milestone',  tone: 'live' }
  };

  // Load all data in parallel
  var dailyLogPromise = feed
    ? feed.fetchDailyLogFeed().catch(function () { return []; })
    : Promise.resolve([]);

  var blogPostsPromise = fetch(API_BASE + '/blogPosts')
    .then(function (r) { return r.ok ? r.json() : []; })
    .catch(function () { return []; });

  Promise.all([dailyLogPromise, blogPostsPromise]).then(function (results) {
    var entries = Array.isArray(results[0]) ? results[0] : [];
    var posts = Array.isArray(results[1]) ? results[1] : (results[1] && results[1].posts) || [];

    renderHero(entries);
    renderStats(entries);
    renderToday(entries);
    renderStream(entries);
    renderJournal(posts);
  });

  // ---- Hero ---------------------------------------------------

  function renderHero(entries) {
    var dateEl = document.getElementById('pulse-meta-date');
    var moodEl = document.getElementById('pulse-meta-mood');
    var statusEl = document.getElementById('pulse-meta-status');

    var today = entries[0] || null;
    if (today) {
      dateEl.textContent = formatDateShort(today.date);
      var mood = MOODS[today.mood] || MOODS.steady;
      moodEl.textContent = mood.label;
      statusEl.textContent = 'Feed live';
      statusEl.classList.remove('pulse-meta-item--dim');
      statusEl.classList.add('pulse-meta-item--live');
    } else {
      dateEl.textContent = formatDateShort(new Date().toISOString().substring(0, 10));
      moodEl.textContent = 'Standby';
      statusEl.textContent = 'Awaiting dispatch';
    }
  }

  // ---- Stats band ---------------------------------------------
  // Tile set: (1) static agent count, (2) last-dispatch relative time,
  // (3) all-time dispatch count, (4) days in operation since 2024-01-01.

  var FOUNDED_DATE = '2024-01-01';

  function renderStats(entries) {
    // Last dispatch — relative time since most recent published_at
    var latest = entries[0] || null;
    var lastDispatchStat = document.querySelector('[data-key="last_dispatch"]');
    if (lastDispatchStat) {
      var valueEl = lastDispatchStat.querySelector('[data-value]');
      var subEl = lastDispatchStat.querySelector('[data-sub]');
      if (latest && latest.published_at) {
        valueEl.textContent = relativeTime(latest.published_at);
        subEl.textContent = latest.title ? truncate(latest.title, 40) : formatDateShort(latest.date);
      } else if (latest && latest.date) {
        valueEl.textContent = 'today';
        subEl.textContent = formatDateShort(latest.date);
      } else {
        valueEl.textContent = '—';
        subEl.textContent = 'Awaiting feed';
      }
    }

    // Total dispatches — cumulative count
    var totalStat = document.querySelector('[data-key="total_dispatches"]');
    if (totalStat) {
      totalStat.querySelector('[data-value]').textContent = entries.length || '0';
    }

    // Day in operation — days since founded date
    var dayStat = document.querySelector('[data-key="day_in_operation"]');
    if (dayStat) {
      dayStat.querySelector('[data-value]').textContent = daysSince(FOUNDED_DATE);
    }
  }

  function daysSince(isoDate) {
    // "Day 1" is the first day (inclusive), not "0 days elapsed", so +1.
    var start = new Date(isoDate + 'T00:00:00');
    var now = new Date();
    var ms = now.getTime() - start.getTime();
    return Math.max(1, Math.floor(ms / 86400000) + 1);
  }

  function relativeTime(isoTimestamp) {
    var then = new Date(isoTimestamp);
    if (isNaN(then.getTime())) return '—';
    var diffMin = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000));
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return diffMin + 'm ago';
    var h = Math.floor(diffMin / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    var mo = Math.floor(d / 30);
    return mo + 'mo ago';
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.substring(0, n - 1) + '…' : s;
  }

  // ---- Today's dispatch ---------------------------------------

  function renderToday(entries) {
    var body = document.getElementById('pulse-today-body');
    var dateChip = document.getElementById('pulse-today-date');
    var today = entries[0] || null;

    if (!today) {
      body.innerHTML = '<div class="pulse-status">No dispatch published yet. Check back soon.</div>';
      dateChip.textContent = formatDateShort(new Date().toISOString().substring(0, 10));
      return;
    }

    dateChip.textContent = formatDateShort(today.date);

    var html = '';
    html += '<h2 class="pulse-today-title">' + esc(today.title || 'Untitled dispatch') + '</h2>';

    if (today.excerpt || today.summary) {
      var text = today.excerpt || today.summary || '';
      var paragraphs = String(text).split('\n').filter(function (p) { return p.trim(); });
      html += '<div class="pulse-today-summary">';
      paragraphs.forEach(function (p) {
        html += '<p>' + esc(p) + '</p>';
      });
      html += '</div>';
    }

    if (today.highlights && today.highlights.length) {
      html += '<ul class="pulse-today-highlights">';
      today.highlights.forEach(function (h) {
        html += '<li>' + esc(h) + '</li>';
      });
      html += '</ul>';
    }

    html += '<a class="pulse-today-cta" href="/log/' + esc(today.date) + '">Read full log &rarr;</a>';
    body.innerHTML = html;
  }

  // ---- Recent stream ------------------------------------------

  function renderStream(entries) {
    var el = document.getElementById('pulse-stream');
    var list = entries.slice(1, 8); // skip today (shown above), show next 7

    if (!list.length) {
      el.innerHTML = '<div class="pulse-status">No previous dispatches.</div>';
      return;
    }

    var html = '';
    list.forEach(function (e) {
      html += '<a class="pulse-row" href="/log/' + esc(e.date) + '">';
      html +=   '<span class="pulse-row-date">' + formatDateShort(e.date) + '</span>';
      html +=   '<span class="pulse-row-title">' + esc(e.title || '—') + '</span>';
      html +=   '<span class="pulse-row-stats">' + renderStatsInline(e.stats, e.mood) + '</span>';
      html += '</a>';
    });
    el.innerHTML = html;
  }

  // ---- Journal rail -------------------------------------------

  function renderJournal(posts) {
    var el = document.getElementById('pulse-journal');
    if (!posts || !posts.length) {
      el.innerHTML = '<div class="pulse-status">No journal posts yet.</div>';
      return;
    }

    var latest = posts.slice(0, 3);
    var html = '';
    latest.forEach(function (p) {
      var slug = p.slug || '';
      var date = p.published_at || p.created_at || '';
      var dateLabel = date ? formatDateShort(date.substring(0, 10)) : '';
      var title = p.title || 'Untitled';
      var excerpt = (p.excerpt || p.summary || p.description || '').substring(0, 140);
      if (excerpt && (p.excerpt || p.summary || p.description || '').length > 140) excerpt += '…';

      html += '<a class="pulse-post" href="/blog/' + esc(slug) + '">';
      if (dateLabel) html += '<span class="pulse-post-date">' + esc(dateLabel) + '</span>';
      html +=   '<h3 class="pulse-post-title">' + esc(title) + '</h3>';
      if (excerpt) html += '<p class="pulse-post-excerpt">' + esc(excerpt) + '</p>';
      html +=   '<span class="pulse-post-cta">Read &rarr;</span>';
      html += '</a>';
    });
    el.innerHTML = html;
  }

  // ---- Helpers ------------------------------------------------

  function renderStatsInline(stats, mood) {
    var parts = [];
    if (stats) {
      if (stats.tasks_completed) parts.push(stats.tasks_completed + ' done');
      if (stats.posts_drafted)   parts.push(stats.posts_drafted + ' posts');
      if (stats.docs_published)  parts.push(stats.docs_published + ' pub');
    }
    if (mood) {
      var m = MOODS[mood];
      if (m) parts.push(m.label);
    }
    return parts.join(' · ');
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + (dateStr.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return dateStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
