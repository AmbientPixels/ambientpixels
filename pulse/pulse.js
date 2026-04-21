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

  var pulseStatsPromise = fetch(API_BASE + '/pulseStats')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; });

  Promise.all([dailyLogPromise, blogPostsPromise, pulseStatsPromise]).then(function (results) {
    var entries = Array.isArray(results[0]) ? results[0] : [];
    var posts = Array.isArray(results[1]) ? results[1] : (results[1] && results[1].posts) || [];
    var pulseStats = (results[2] && typeof results[2] === 'object') ? results[2] : {};

    renderHero(entries);
    renderStats(entries, pulseStats);
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
  // Tile set: (1) static agent count, (2) AI calls today, (3) all-time
  // dispatch count, (4) last heartbeat (live system pulse).

  function renderStats(entries, pulseStats) {
    // AI calls today — total model requests across today's heartbeat cycles
    var aiStat = document.querySelector('[data-key="ai_calls_today"]');
    if (aiStat) {
      var aiVal = aiStat.querySelector('[data-value]');
      var aiSub = aiStat.querySelector('[data-sub]');
      var calls = (pulseStats && typeof pulseStats.aiCallsToday === 'number') ? pulseStats.aiCallsToday : null;
      var cycles = (pulseStats && typeof pulseStats.cyclesToday === 'number') ? pulseStats.cyclesToday : 0;
      if (calls !== null) {
        aiVal.textContent = calls.toLocaleString();
        aiSub.textContent = cycles ? (cycles + ' cycle' + (cycles === 1 ? '' : 's') + ' today') : 'Model requests';
      } else {
        aiVal.textContent = '—';
        aiSub.textContent = 'Model requests';
      }
    }

    // Total dispatches — cumulative count
    var totalStat = document.querySelector('[data-key="total_dispatches"]');
    if (totalStat) {
      totalStat.querySelector('[data-value]').textContent = entries.length || '0';
    }

    // Last heartbeat — relative time since most recent heartbeat cycle
    var hbStat = document.querySelector('[data-key="last_heartbeat"]');
    if (hbStat) {
      var hbVal = hbStat.querySelector('[data-value]');
      var hbSub = hbStat.querySelector('[data-sub]');
      var ts = pulseStats && pulseStats.lastHeartbeatAt;
      if (ts) {
        hbVal.textContent = relativeTime(ts);
        hbSub.textContent = 'System heartbeat';
      } else {
        hbVal.textContent = '—';
        hbSub.textContent = 'Cycle pending';
      }
    }
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
        html += '<li><i class="fas fa-bolt" aria-hidden="true"></i><span>' + esc(h) + '</span></li>';
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
