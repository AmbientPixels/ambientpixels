/**
 * Social Command Center — consolidated social panel for CEO Dashboard.
 * Replaces social-pulse.js + engagement-pulse.js + inline renderGrowthSocial.
 * Renders directly into #social-command-ceo and #social-command-dev (no mirror hack).
 */
(function () {
  'use strict';

  // ── Helpers ──
  function _apiBase() {
    return window.location.hostname.includes('ambientpixels.ai')
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
      : '/api';
  }

  function _headers() {
    var h = {};
    try { if (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteHeaders) h = CompanyStore.getWriteHeaders() || {}; } catch (e) {}
    try { if (!h['x-company-secret']) { var k = sessionStorage.getItem('ap_server_key') || ''; if (k) h['x-company-secret'] = k; } } catch (e2) {}
    return h;
  }

  function _esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  function _fmtNum(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  // ── SVG Line Graph ──
  function _renderLineGraph(series, opts) {
    var w = opts.width || 400;
    var h = opts.height || 120;
    var pad = { top: 8, right: 8, bottom: 4, left: 8 };
    var plotW = w - pad.left - pad.right;
    var plotH = h - pad.top - pad.bottom;

    // Global max across all series
    var globalMax = 1;
    series.forEach(function (s) {
      s.data.forEach(function (d) { if (d.value > globalMax) globalMax = d.value; });
    });

    var svgParts = [];
    svgParts.push('<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" class="scc-svg">');

    // Defs for gradients
    svgParts.push('<defs>');
    series.forEach(function (s, si) {
      svgParts.push('<linearGradient id="scc-grad-' + si + '" x1="0" y1="0" x2="0" y2="1">');
      svgParts.push('<stop offset="0%" stop-color="' + s.color + '" stop-opacity="0.25"/>');
      svgParts.push('<stop offset="100%" stop-color="' + s.color + '" stop-opacity="0.02"/>');
      svgParts.push('</linearGradient>');
    });
    svgParts.push('</defs>');

    // Grid lines (3 horizontal)
    for (var gi = 1; gi <= 3; gi++) {
      var gy = pad.top + (plotH * gi / 4);
      svgParts.push('<line x1="' + pad.left + '" y1="' + gy + '" x2="' + (w - pad.right) + '" y2="' + gy + '" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>');
    }

    // Render each series
    series.forEach(function (s, si) {
      var len = s.data.length;
      if (len < 2) return;

      var points = [];
      for (var i = 0; i < len; i++) {
        var x = pad.left + (i / (len - 1)) * plotW;
        var y = pad.top + plotH - (s.data[i].value / globalMax) * plotH;
        points.push(x.toFixed(1) + ',' + y.toFixed(1));
      }
      var pointStr = points.join(' ');

      // Fill polygon (line + bottom edge)
      var bottomRight = (pad.left + plotW).toFixed(1) + ',' + (pad.top + plotH).toFixed(1);
      var bottomLeft = pad.left.toFixed(1) + ',' + (pad.top + plotH).toFixed(1);
      svgParts.push('<polygon points="' + pointStr + ' ' + bottomRight + ' ' + bottomLeft + '" fill="url(#scc-grad-' + si + ')"/>');

      // Line
      svgParts.push('<polyline points="' + pointStr + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');

      // Dots
      for (var j = 0; j < len; j++) {
        var dx = pad.left + (j / (len - 1)) * plotW;
        var dy = pad.top + plotH - (s.data[j].value / globalMax) * plotH;
        svgParts.push('<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="3" fill="' + s.color + '" opacity="0" class="scc-dot"><title>' + _esc(s.data[j].date) + ': ' + s.data[j].value + '</title></circle>');
      }
    });

    svgParts.push('</svg>');

    // Date labels below
    var labels = [];
    if (series.length > 0 && series[0].data.length > 0) {
      var d = series[0].data;
      // Show every other label to avoid crowding
      var step = d.length <= 7 ? 1 : 2;
      labels.push('<div class="scc-graph-labels">');
      for (var li = 0; li < d.length; li++) {
        var vis = (li % step === 0 || li === d.length - 1) ? '1' : '0';
        labels.push('<span style="opacity:' + vis + '">' + _esc((d[li].date || '').slice(5)) + '</span>');
      }
      labels.push('</div>');
    }

    // Legend
    var legend = '<div class="scc-graph-legend">';
    series.forEach(function (s) {
      legend += '<span class="scc-legend-item"><span class="scc-legend-swatch" style="background:' + s.color + '"></span>' + _esc(s.label) + '</span>';
    });
    legend += '</div>';

    return '<div class="scc-graph-wrap">' + legend + svgParts.join('') + labels.join('') + '</div>';
  }

  // ── Top Issue (from recent failures) ──
  function _topIssue(recentFailures) {
    var now = Date.now();
    var dayMs = 86400000;
    var counts = {};
    (recentFailures || []).forEach(function (f) {
      var ts = Date.parse(f.timestamp || '');
      if (isNaN(ts) || (now - ts) > dayMs) return;
      var cls = f.error_class || 'UNKNOWN';
      counts[cls] = (counts[cls] || 0) + 1;
    });
    var keys = Object.keys(counts);
    if (!keys.length) return null;
    keys.sort(function (a, b) { return counts[b] - counts[a]; });
    return { error_class: keys[0], count: counts[keys[0]] };
  }

  // ── Build 14-day buckets ──
  function _buildDayBuckets(days) {
    var buckets = {};
    var now = new Date();
    for (var d = days - 1; d >= 0; d--) {
      var day = new Date(now.getTime() - d * 86400000);
      buckets[day.toISOString().split('T')[0]] = 0;
    }
    return buckets;
  }

  // ── Main render ──
  var _cache = null;
  var _loading = false;

  function _render(container) {
    if (!container || !_cache) return;
    var metrics = _cache.metrics || {};
    var acct = _cache.acct || {};
    var eng = _cache.eng || {};

    var summary = metrics.summary || {};
    var engSummary = eng.summary || {};
    var engSplit = eng.engagementSplit || {};
    var engMeta = eng.meta || {};
    var acctTotals = acct.totals || {};
    var platforms = acct.platforms || {};
    var events = metrics.events || metrics.recentPosts || [];

    // ── Headline chips ──
    var totalFollowers = acctTotals.followers || 0;
    var postsWeek = summary.published || 0;
    var likes7d = engSummary.likes7d || 0;
    var comments7d = engSummary.comments7d || 0;
    var reposts7d = engSummary.reposts7d || 0;
    var totalEng = likes7d + comments7d + reposts7d;
    var successRate = summary.successRate || 0;
    var mode = engMeta.mode || 'mock_fallback';
    var isLive = mode === 'real';

    var html = '<div class="scc-chips">';
    html += '<div class="scc-chip"><div class="scc-chip-value" style="color:#60a5fa;">' + _esc(_fmtNum(totalFollowers)) + '</div><div class="scc-chip-label">Followers</div></div>';
    html += '<div class="scc-chip"><div class="scc-chip-value" style="color:#60a5fa;">' + _esc(postsWeek) + '</div><div class="scc-chip-label">Posts (7d)</div></div>';
    html += '<div class="scc-chip"><div class="scc-chip-value" style="color:#34d399;">' + _esc(_fmtNum(likes7d)) + '</div><div class="scc-chip-label">Likes (7d)</div></div>';
    html += '<div class="scc-chip"><div class="scc-chip-value" style="color:#fbbf24;">' + _esc(_fmtNum(comments7d)) + '</div><div class="scc-chip-label">Comments (7d)</div></div>';
    html += '<div class="scc-chip"><div class="scc-chip-value" style="color:#a78bfa;">' + _esc(_fmtNum(reposts7d)) + '</div><div class="scc-chip-label">Reposts (7d)</div></div>';
    html += '<div class="scc-chip scc-chip--badge"><span class="scc-badge scc-badge--' + (isLive ? 'live' : 'mock') + '">' + (isLive ? 'LIVE' : 'MOCK') + '</span></div>';
    html += '</div>';

    // ── Platform cards ──
    var order = ['x', 'linkedin', 'bluesky'];
    var labels = { x: 'X', linkedin: 'LinkedIn', bluesky: 'Bluesky' };
    var colors = { x: '#1d9bf0', linkedin: '#0a66c2', bluesky: '#0085ff' };

    html += '<div class="scc-platforms">';
    for (var i = 0; i < order.length; i++) {
      var pl = platforms[order[i]];
      var plEng = engSplit[order[i]] || {};
      var plColor = colors[order[i]];
      html += '<div class="scc-platform-card" style="border-left-color:' + plColor + ';">';
      html += '<div class="scc-platform-name">' + _esc(labels[order[i]]) + '</div>';
      if (pl && pl.ok !== false) {
        var plFollowers = pl.followers || 0;
        var plPosts = pl.tweets_count || pl.posts_count || 0;
        var plLikes = plEng.likes7d || 0;
        var plComments = plEng.comments7d || 0;
        var plReposts = plEng.reposts7d || 0;
        html += '<div class="scc-platform-stat"><span>' + _esc(_fmtNum(plFollowers)) + '</span><span class="scc-platform-stat-label">followers</span></div>';
        html += '<div class="scc-platform-stat"><span>' + _esc(_fmtNum(plPosts)) + '</span><span class="scc-platform-stat-label">posts</span></div>';
        html += '<div class="scc-platform-eng">';
        html += '<span style="color:#34d399;" title="Likes">' + _esc(_fmtNum(plLikes)) + ' <i class="fas fa-heart" style="font-size:0.4rem;"></i></span>';
        html += '<span style="color:#fbbf24;" title="Comments">' + _esc(_fmtNum(plComments)) + ' <i class="fas fa-comment" style="font-size:0.4rem;"></i></span>';
        html += '<span style="color:#a78bfa;" title="Reposts">' + _esc(_fmtNum(plReposts)) + ' <i class="fas fa-retweet" style="font-size:0.4rem;"></i></span>';
        html += '</div>';
      } else {
        html += '<div class="scc-platform-stat scc-platform-stat--off">Not connected</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // ── Line graph (14-day: posts + likes + comments + reposts) ──
    var postBuckets = _buildDayBuckets(14);
    var likesBuckets = _buildDayBuckets(14);
    var commentsBuckets = _buildDayBuckets(14);
    var repostsBuckets = _buildDayBuckets(14);

    // Posts from metrics trends.daily or events
    var metricsDaily = (metrics.trends && metrics.trends.daily) || [];
    if (metricsDaily.length > 0) {
      metricsDaily.forEach(function (d) {
        if (d.date && postBuckets.hasOwnProperty(d.date)) postBuckets[d.date] = (d.published || 0);
      });
    } else {
      events.forEach(function (e) {
        if (e.timestamp && (e.result === 'success' || e.status === 'success')) {
          var dk = (e.timestamp || '').substring(0, 10);
          if (postBuckets.hasOwnProperty(dk)) postBuckets[dk]++;
        }
      });
    }

    // Engagement breakdown from engagement trends.daily
    var engDaily = (eng.trends && (eng.trends.daily || eng.trends.last7 || eng.trends.last30)) || [];
    engDaily.forEach(function (d) {
      if (d.date) {
        if (likesBuckets.hasOwnProperty(d.date)) likesBuckets[d.date] = (d.likes || 0);
        if (commentsBuckets.hasOwnProperty(d.date)) commentsBuckets[d.date] = (d.comments || 0);
        if (repostsBuckets.hasOwnProperty(d.date)) repostsBuckets[d.date] = (d.reposts || 0);
      }
    });

    var dayKeys = Object.keys(postBuckets).sort();
    var postSeries = dayKeys.map(function (k) { return { date: k, value: postBuckets[k] }; });
    var likesSeries = dayKeys.map(function (k) { return { date: k, value: likesBuckets[k] }; });
    var commentsSeries = dayKeys.map(function (k) { return { date: k, value: commentsBuckets[k] }; });
    var repostsSeries = dayKeys.map(function (k) { return { date: k, value: repostsBuckets[k] }; });

    html += _renderLineGraph([
      { label: 'Posts', data: postSeries, color: '#60a5fa' },
      { label: 'Likes', data: likesSeries, color: '#34d399' },
      { label: 'Comments', data: commentsSeries, color: '#fbbf24' },
      { label: 'Reposts', data: repostsSeries, color: '#a78bfa' }
    ], { width: 400, height: 120 });

    // ── Comment alert (conditional) ──
    var topPosts = eng.topPosts || [];
    var postsWithComments = topPosts.filter(function (p) { return (p.comments || 0) > 0; });
    if (postsWithComments.length > 0) {
      var totalCommentCount = 0;
      postsWithComments.forEach(function (p) { totalCommentCount += (p.comments || 0); });
      var platformIcons = { x: 'fab fa-x-twitter', linkedin: 'fab fa-linkedin', bluesky: 'fas fa-cloud' };

      html += '<div class="scc-comment-alert">';
      html += '<div class="scc-comment-alert-header">';
      html += '<i class="fas fa-comment" style="color:#fbbf24;margin-right:5px;"></i>';
      html += '<strong>' + totalCommentCount + ' comment' + (totalCommentCount !== 1 ? 's' : '') + '</strong>';
      html += ' across ' + postsWithComments.length + ' post' + (postsWithComments.length !== 1 ? 's' : '');
      html += '</div>';

      // Show top 3 posts with comments
      var showPosts = postsWithComments.slice(0, 3);
      showPosts.forEach(function (p) {
        var icon = platformIcons[p.platform] || 'fas fa-share-alt';
        html += '<div class="scc-comment-post">';
        html += '<i class="' + icon + '" style="color:' + (colors[p.platform] || '#60a5fa') + ';margin-right:5px;font-size:0.55rem;"></i>';
        html += '<span class="scc-comment-post-text">' + _esc((p.text_preview || '').substring(0, 80)) + (p.text_preview && p.text_preview.length > 80 ? '...' : '') + '</span>';
        html += '<span class="scc-comment-count">' + (p.comments || 0) + '</span>';
        if (p.link) html += '<a href="' + _esc(p.link) + '" target="_blank" class="scc-comment-link" title="View post"><i class="fas fa-external-link-alt"></i></a>';
        html += '</div>';
      });

      html += '</div>';
    }

    // ── Top issue (conditional) ──
    var issue = summary.topIssue || _topIssue(metrics.recentFailures || []);
    if (issue) {
      html += '<div class="scc-issue-row"><i class="fas fa-exclamation-triangle" style="color:#fbbf24;margin-right:4px;"></i>';
      html += '<span class="scc-issue-pill">' + _esc(issue.error_class) + '</span>';
      html += '<span class="scc-issue-count">' + _esc(issue.count) + ' in last 24h</span>';
      html += '</div>';
    }

    container.innerHTML = html;

    // Populate stat cards if they exist
    var fEl = document.getElementById('gstat-followers');
    var eEl = document.getElementById('gstat-engagements');
    if (fEl) fEl.textContent = totalFollowers > 0 ? totalFollowers.toLocaleString() : '—';
    if (eEl) eEl.textContent = totalEng > 0 ? totalEng.toLocaleString() : '—';
  }

  function _renderAll() {
    var targets = ['social-command-ceo', 'social-command-dev'];
    for (var i = 0; i < targets.length; i++) {
      var el = document.getElementById(targets[i]);
      if (el) _render(el);
    }
  }

  function load() {
    if (_loading) return;
    _loading = true;

    var base = _apiBase();
    var hdrs = _headers();

    Promise.all([
      fetch(base + '/social-metrics?limit=50', { headers: hdrs }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(base + '/social-account-stats', { headers: hdrs }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(base + '/social-engagement?limit=50', { headers: hdrs }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (results) {
      _cache = { metrics: results[0] || {}, acct: results[1] || {}, eng: results[2] || {} };
      _loading = false;
      _renderAll();
    }).catch(function () {
      _loading = false;
      var targets = ['social-command-ceo', 'social-command-dev'];
      for (var i = 0; i < targets.length; i++) {
        var el = document.getElementById(targets[i]);
        if (el) el.innerHTML = '<div class="dash-empty">Social data unavailable.</div>';
      }
    });
  }

  function refresh() {
    _cache = null;
    load();
  }

  // Expose for renderAll() integration
  window.refreshSocialCommand = refresh;

  // Auto-init
  function init() {
    var ceo = document.getElementById('social-command-ceo');
    var dev = document.getElementById('social-command-dev');
    if (ceo || dev) load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
