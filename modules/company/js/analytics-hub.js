(function () {
  'use strict';

  var state = {
    cursor: '',
    prevStack: [],
    nextCursor: null,
    limit: 25,
    rows: [],
    metricsData: null,
    engagementData: null,
    pullRun: null,
    accountData: null
  };

  function getApiBase() {
    return window.location.hostname.includes('ambientpixels.ai')
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
      : '/api';
  }

  function getAuthHeaders() {
    var headers = {};
    try {
      if (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteHeaders) {
        headers = CompanyStore.getWriteHeaders() || {};
      }
    } catch (e) { /* ignore */ }

    try {
      if (!headers['x-company-secret']) {
        var key = sessionStorage.getItem('ap_server_key') || '';
        if (key) headers['x-company-secret'] = key;
      }
    } catch (e2) { /* ignore */ }

    return headers;
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function fmtDateInput(d) {
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, '0');
    var day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function readFilters() {
    return {
      from: document.getElementById('sa-from').value,
      to: document.getElementById('sa-to').value,
      platform: document.getElementById('sa-platform').value,
      result: document.getElementById('sa-result').value,
      campaign: document.getElementById('sa-campaign').value.trim()
    };
  }

  function writeFiltersToQuery(filters) {
    var q = new URLSearchParams();
    Object.keys(filters).forEach(function (k) {
      if (filters[k]) q.set(k, filters[k]);
    });
    var qs = q.toString();
    var next = window.location.pathname + (qs ? '?' + qs : '');
    window.history.replaceState({}, '', next);
  }

  function loadFiltersFromQuery() {
    var q = new URLSearchParams(window.location.search || '');
    var now = new Date();
    var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    document.getElementById('sa-from').value = q.get('from') || fmtDateInput(weekAgo);
    document.getElementById('sa-to').value = q.get('to') || fmtDateInput(now);
    document.getElementById('sa-platform').value = q.get('platform') || '';
    document.getElementById('sa-result').value = q.get('result') || '';
    document.getElementById('sa-campaign').value = q.get('campaign') || '';
  }

  function buildUrl(filters) {
    var p = new URLSearchParams();
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    if (filters.platform) p.set('platform', filters.platform);
    if (filters.result) p.set('result', filters.result);
    if (filters.campaign) p.set('campaign', filters.campaign);
    p.set('limit', String(state.limit));
    if (state.cursor) p.set('cursor', state.cursor);
    return getApiBase() + '/social-metrics?' + p.toString();
  }

  function buildEngagementUrl(filters) {
    var p = new URLSearchParams();
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    if (filters.platform) p.set('platform', filters.platform);
    p.set('limit', '50');
    return getApiBase() + '/social-engagement?' + p.toString();
  }

  function fmtLatency(ms) {
    if (!ms || !isFinite(ms) || ms < 1) return '—';
    var sec = Math.round(ms / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.round(sec / 60);
    if (min < 60) return min + 'm';
    return (min / 60).toFixed(1) + 'h';
  }

  function relativeFromIso(iso) {
    if (!iso) return '—';
    var ts = Date.parse(iso);
    if (isNaN(ts)) return '—';
    var mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function renderKpis(summary) {
    var root = document.getElementById('sa-kpis');
    root.innerHTML = '' +
      '<div class="sa-kpi" data-result-filter="success"><div class="sa-kpi-label">Published</div><div class="sa-kpi-value sa-kpi-value--good">' + esc(summary.published || 0) + '</div></div>' +
      '<div class="sa-kpi" data-result-filter="failure"><div class="sa-kpi-label">Failed</div><div class="sa-kpi-value sa-kpi-value--bad">' + esc(summary.failed || 0) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Success Rate</div><div class="sa-kpi-value">' + esc(summary.successRate || 0) + '%</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Avg Latency</div><div class="sa-kpi-value">' + esc(fmtLatency(summary.avgLatency || 0)) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Fail Streak</div><div class="sa-kpi-value">' + esc(summary.failStreak || 0) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Pending Approvals</div><div class="sa-kpi-value">' + esc(summary.pendingApprovals || 0) + '</div></div>';
  }

  function renderMiniBars(rootId, rows, valueFn, color) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var items = Array.isArray(rows) ? rows.slice(-7) : [];
    if (!items.length) {
      root.innerHTML = '<div class="dash-empty">No trend data.</div>';
      return;
    }
    var max = 1;
    items.forEach(function (r) {
      var v = valueFn(r);
      if (v > max) max = v;
    });
    var html = '<div class="sa-mini-bars">';
    items.forEach(function (r) {
      var v = valueFn(r);
      var h = Math.max(3, Math.round((v / max) * 34));
      html += '<div class="sa-mini-col">';
      html += '<div class="sa-mini-bar" style="height:' + h + 'px; background:' + color + ';"></div>';
      html += '<div class="sa-mini-label">' + esc((r.date || '').slice(5)) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    root.innerHTML = html;
  }

  function renderHealthPanel() {
    var root = document.getElementById('sa-health-chips');
    if (!root) return;

    var metrics = state.metricsData || {};
    var engagement = state.engagementData || {};
    var summary = metrics.summary || {};
    var split = engagement.engagementSplit || {};
    var meta = engagement.meta || {};
    var recentPosts = metrics.recentPosts || [];

    var trackedPosts = (split.x && split.x.posts7d || 0) + (split.linkedin && split.linkedin.posts7d || 0) + (split.bluesky && split.bluesky.posts7d || 0);
    var withUrl = 0;
    for (var i = 0; i < recentPosts.length; i++) {
      if (recentPosts[i] && recentPosts[i].post_url) withUrl += 1;
    }
    var urlQuality = recentPosts.length ? Math.round((withUrl / recentPosts.length) * 100) + '%' : '—';
    var pullState = state.pullRun
      ? ('+' + (state.pullRun.snapshotsAdded || 0) + ' snapshots')
      : 'Not run yet';

    root.innerHTML = '' +
      '<div class="sa-health-chip"><div class="sa-health-chip-label">Last Pull</div><div class="sa-health-chip-value">' + esc(relativeFromIso(meta.lastPulledAt || '')) + '</div></div>' +
      '<div class="sa-health-chip"><div class="sa-health-chip-label">Pull Run</div><div class="sa-health-chip-value">' + esc(pullState) + '</div></div>' +
      '<div class="sa-health-chip"><div class="sa-health-chip-label">Posts Tracked (7d)</div><div class="sa-health-chip-value">' + esc(trackedPosts) + '</div></div>' +
      '<div class="sa-health-chip"><div class="sa-health-chip-label">Post URL Coverage</div><div class="sa-health-chip-value">' + esc(urlQuality) + '</div></div>' +
      '<div class="sa-health-chip"><div class="sa-health-chip-label">Failures 24h</div><div class="sa-health-chip-value">' + esc(summary.failures24h || 0) + '</div></div>';

    renderMiniBars('sa-delivery-mini', (metrics.trends && metrics.trends.daily) || [], function (r) {
      return (r.published || 0) + (r.failed || 0);
    }, 'rgba(96,165,250,0.78)');

    renderMiniBars('sa-engagement-mini', (engagement.trends && engagement.trends.last7) || [], function (r) {
      return (r.likes || 0) + (r.comments || 0) + (r.reposts || 0);
    }, 'rgba(52,211,153,0.75)');

    var pullFeedback = document.getElementById('sa-pull-feedback');
    if (pullFeedback) {
      if (state.pullRun) {
        var e = state.pullRun.platformErrors || { x: 0, linkedin: 0, bluesky: 0 };
        pullFeedback.textContent = 'Last manual pull: +' + (state.pullRun.snapshotsAdded || 0) +
          ' snapshots · errors x:' + (e.x || 0) + ' linkedin:' + (e.linkedin || 0) + ' bluesky:' + (e.bluesky || 0);
      } else {
        pullFeedback.textContent = 'Manual pull status will appear here.';
      }
    }
  }

  function renderPlatforms(split) {
    var root = document.getElementById('sa-platform-grid');
    function card(key, label) {
      var v = split[key] || { published: 0, failed: 0 };
      return '<div class="sa-platform-card">' +
        '<div class="sa-platform-title">' + esc(label) + '</div>' +
        '<div class="sa-platform-row"><span>Published</span><strong>' + esc(v.published || 0) + '</strong></div>' +
        '<div class="sa-platform-row"><span>Failed</span><strong>' + esc(v.failed || 0) + '</strong></div>' +
      '</div>';
    }

    root.innerHTML = card('x', 'X') + card('linkedin', 'LinkedIn') + card('bluesky', 'Bluesky');
  }

  function rowTextPreview(row) {
    if (!row) return '';
    return row.result === 'failure'
      ? (row.error_class || 'Failure') + (row.error_code ? ' (' + row.error_code + ')' : '')
      : 'Published post';
  }

  function renderPosts(rows) {
    var body = document.getElementById('sa-posts-body');
    var empty = document.getElementById('sa-posts-empty');

    if (!rows || !rows.length) {
      body.innerHTML = '';
      empty.style.display = '';
      return;
    }

    empty.style.display = 'none';
    var html = '';
    rows.forEach(function (r) {
      var resultClass = r.result === 'success' ? 'sa-result-pill sa-result-pill--success' : 'sa-result-pill sa-result-pill--failure';
      var urlCell = r.post_url
        ? '<a class="sa-link" href="' + esc(r.post_url) + '" target="_blank" rel="noopener noreferrer">Open</a>'
        : '—';
      html += '<tr>' +
        '<td>' + esc(r.platform || '') + '</td>' +
        '<td>' + esc(rowTextPreview(r)) + '</td>' +
        '<td><span class="' + resultClass + '">' + esc(r.result || '') + '</span></td>' +
        '<td>' + esc((r.timestamp || '').replace('T', ' ').replace('Z', '')) + '</td>' +
        '<td>' + esc(r.attempt || 1) + '</td>' +
        '<td>' + esc(r.error_class || '') + '</td>' +
        '<td>' + urlCell + '</td>' +
      '</tr>';
    });
    body.innerHTML = html;
  }

  function renderDiagnostics(failures) {
    var root = document.getElementById('sa-diagnostics');
    if (!failures || !failures.length) {
      root.innerHTML = '<div class="dash-empty">No failures for selected filters.</div>';
      return;
    }

    var map = {};
    failures.forEach(function (f) {
      var cls = f.error_class || 'UNKNOWN';
      if (!map[cls]) map[cls] = { count: 0, last: '' };
      map[cls].count += 1;
      if (!map[cls].last || (f.timestamp || '') > map[cls].last) map[cls].last = f.timestamp || '';
    });

    var keys = Object.keys(map).sort(function (a, b) { return map[b].count - map[a].count; });
    var html = '<div class="sa-diag-row sa-diag-head"><div>Error Class</div><div>Count</div><div>Last Occurrence (UTC)</div></div>';
    keys.forEach(function (k) {
      html += '<div class="sa-diag-row"><div>' + esc(k) + '</div><div>' + esc(map[k].count) + '</div><div>' + esc((map[k].last || '').replace('T', ' ').replace('Z', '')) + '</div></div>';
    });
    root.innerHTML = html;
  }

  function metricOrZero(val) {
    return Number.isFinite(val) ? val : 0;
  }

  // ═══ Account Overview rendering ═══

  function fmtNum(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function platBadge(platform) {
    var p = String(platform || '').toLowerCase();
    return '<span class="sa-plat-badge sa-plat-badge--' + esc(p) + '">' + esc(p === 'x' ? 'X' : p === 'linkedin' ? 'LinkedIn' : p === 'bluesky' ? 'Bluesky' : p) + '</span>';
  }

  function fmtShortDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mon[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  function renderAccountOverview(data) {
    state.accountData = data;
    var totalsRoot = document.getElementById('sa-acct-totals');
    var gridRoot = document.getElementById('sa-acct-grid');
    var errRoot = document.getElementById('sa-acct-errors');
    var cacheHint = document.getElementById('sa-acct-cache');

    if (!data) {
      gridRoot.innerHTML = '<div class="dash-empty">Account stats unavailable.</div>';
      return;
    }

    var meta = data.meta || {};
    if (cacheHint) {
      if (meta.cached) {
        var ageMin = Math.round((meta.cacheAgeMs || 0) / 60000);
        cacheHint.textContent = 'cached · ' + ageMin + 'm ago';
      } else {
        cacheHint.textContent = 'live';
      }
    }

    var t = data.totals || {};
    totalsRoot.innerHTML = '' +
      '<div class="sa-acct-total"><div class="sa-acct-total-label">Total Followers</div><div class="sa-acct-total-value">' + esc(fmtNum(t.followers || 0)) + '</div></div>' +
      '<div class="sa-acct-total"><div class="sa-acct-total-label">Total Posts</div><div class="sa-acct-total-value">' + esc(fmtNum(t.posts || 0)) + '</div></div>' +
      '<div class="sa-acct-total"><div class="sa-acct-total-label">Connected</div><div class="sa-acct-total-value">' + esc(t.platforms_connected || 0) + '/3</div></div>' +
      '<div class="sa-acct-total"><div class="sa-acct-total-label">Errors</div><div class="sa-acct-total-value">' + esc(t.platforms_errored || 0) + '</div></div>';

    var platforms = data.platforms || {};
    var order = ['x', 'linkedin', 'bluesky'];
    var cardsHtml = '';
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var pl = platforms[key];
      if (!pl) {
        cardsHtml += '<div class="sa-acct-card sa-acct-card--' + key + '"><div class="sa-acct-card-err"><i class="fas fa-exclamation-triangle"></i> ' + esc(key) + ' not connected</div></div>';
        continue;
      }
      var avatarHtml = pl.avatar ? '<img class="sa-acct-avatar" src="' + esc(pl.avatar) + '" alt="" onerror="this.style.display=\'none\'" />' : '';
      var badgeIcons = { x: 'fa-x-twitter', linkedin: 'fa-linkedin', bluesky: 'fa-bluesky' };
      var badgeIcon = badgeIcons[key] || 'fa-globe';
      cardsHtml += '<div class="sa-acct-card sa-acct-card--' + key + '">';
      cardsHtml += '<div class="sa-acct-card-head">' + avatarHtml + '<div><div class="sa-acct-card-name">' + esc(pl.name || '') + '</div><div class="sa-acct-card-handle">' + esc(pl.handle || '') + '</div></div><span class="sa-acct-badge sa-acct-badge--' + key + '"><i class="fa-brands ' + badgeIcon + '"></i></span></div>';
      cardsHtml += '<div class="sa-acct-stats">';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + esc(fmtNum(pl.followers || 0)) + '</div><div class="sa-acct-stat-label">Followers</div></div>';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + esc(fmtNum(pl.following != null ? pl.following : 0)) + '</div><div class="sa-acct-stat-label">Following</div></div>';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + esc(fmtNum(pl.tweets_count || pl.posts_count || 0)) + '</div><div class="sa-acct-stat-label">Posts</div></div>';
      cardsHtml += '</div></div>';
    }
    gridRoot.innerHTML = cardsHtml;

    var errors = data.errors || [];
    if (errors.length) {
      errRoot.innerHTML = errors.map(function (e) {
        return '<div class="sa-acct-err-line"><i class="fas fa-exclamation-circle"></i> ' + esc(e) + '</div>';
      }).join('');
    } else {
      errRoot.innerHTML = '';
    }
  }

  function renderLiveRecentPosts(data) {
    var tbody = document.getElementById('sa-live-posts-body');
    var empty = document.getElementById('sa-live-posts-empty');
    if (!tbody || !empty) return;
    var posts = (data && data.recentPosts) || [];

    if (!posts.length) {
      tbody.innerHTML = '';
      empty.style.display = '';
      empty.textContent = 'No recent posts from connected accounts.';
      return;
    }

    empty.style.display = 'none';
    var html = '';
    posts.forEach(function (p) {
      var linkCell = p.url ? '<a class="sa-link" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">Open</a>' : '—';
      html += '<tr>';
      html += '<td>' + platBadge(p.platform) + '</td>';
      html += '<td>' + esc((p.text || '').slice(0, 100) || '—') + '</td>';
      html += '<td>' + esc(p.likes != null ? p.likes : '—') + '</td>';
      html += '<td>' + esc(p.replies != null ? p.replies : (p.comments != null ? p.comments : '—')) + '</td>';
      html += '<td>' + esc(p.reposts != null ? p.reposts : (p.retweets != null ? p.retweets : '—')) + '</td>';
      html += '<td class="sa-live-date">' + esc(fmtShortDate(p.created_at)) + '</td>';
      html += '<td>' + linkCell + '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;
  }

  function loadAccountStats(forceRefresh) {
    var url = getApiBase() + '/social-account-stats' + (forceRefresh ? '?refresh=1' : '');
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));
        renderAccountOverview(resp.body || {});
        renderLiveRecentPosts(resp.body || {});
      })
      .catch(function (err) {
        var grid = document.getElementById('sa-acct-grid');
        if (grid) grid.innerHTML = '<div class="dash-empty">Account stats failed: ' + esc(err.message || 'Unknown error') + '</div>';
        var postsEmpty = document.getElementById('sa-live-posts-empty');
        if (postsEmpty) { postsEmpty.textContent = 'Could not load recent posts.'; postsEmpty.style.display = ''; }
        var postsBody = document.getElementById('sa-live-posts-body');
        if (postsBody) postsBody.innerHTML = '';
      });
  }

  function setPullStatus(text, tone) {
    var node = document.getElementById('sa-pull-status');
    if (!node) return;
    node.className = 'sa-inline-status';
    if (tone === 'ok') node.className += ' sa-inline-status--ok';
    if (tone === 'err') node.className += ' sa-inline-status--err';
    node.textContent = text || '';
  }

  function triggerPullNow() {
    var btn = document.getElementById('sa-pull-now');
    if (!btn) return;
    btn.disabled = true;
    setPullStatus('Pulling latest engagement from platforms...', '');

    fetch(getApiBase() + '/social-engagement-pull-now', {
      method: 'POST',
      headers: getAuthHeaders()
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));
        state.pullRun = (resp.body && resp.body.run) || null;
        setPullStatus('Pull complete. Refreshing dashboard data...', 'ok');
        loadData();
      })
      .catch(function (err) {
        setPullStatus('Pull failed: ' + (err.message || 'Unknown error'), 'err');
      })
      .finally(function () {
        btn.disabled = false;
      });
  }

  function loadEngagementData(filters) {
    var url = buildEngagementUrl(filters);
    fetch(url, { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));
        state.engagementData = resp.body || {};
        renderHealthPanel();
      })
      .catch(function () {
        state.engagementData = {
          summary: {},
          engagementSplit: {},
          trends: { last7: [] },
          meta: {}
        };
        renderHealthPanel();
      });
  }

  function bindAccountRefresh() {
    var btn = document.getElementById('sa-acct-refresh');
    if (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        loadAccountStats(true).finally(function () { btn.disabled = false; });
      });
    }
  }

  function updatePagerButtons() {
    document.getElementById('sa-prev').disabled = state.prevStack.length === 0;
    document.getElementById('sa-next').disabled = !state.nextCursor;
  }

  function loadData() {
    var filters = readFilters();
    writeFiltersToQuery(filters);
    loadEngagementData(filters);

    var url = buildUrl(filters);
    fetch(url, { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));

        var data = resp.body || {};
        state.metricsData = data;
        var summary = data.summary || {};
        var totalExec = (summary.published || 0) + (summary.failed || 0);
        state.rows = data.recentPosts || [];
        state.nextCursor = data.nextCursor || null;

        renderKpis(summary);
        renderPlatforms(data.platformSplit || {});
        renderPosts(state.rows);
        renderDiagnostics(data.recentFailures || []);
        if (totalExec === 0) {
          document.getElementById('sa-posts-empty').textContent = 'No social executions yet.';
          document.getElementById('sa-diagnostics').innerHTML = '<div class="dash-empty">No social executions yet.</div>';
        } else {
          document.getElementById('sa-posts-empty').textContent = 'No posts found for selected filters.';
        }
        renderHealthPanel();
        updatePagerButtons();
      })
      .catch(function (err) {
        state.metricsData = {
          summary: {},
          trends: { daily: [] },
          recentPosts: []
        };
        document.getElementById('sa-kpis').innerHTML = '<div class="dash-empty">Failed to load metrics: ' + esc(err.message || 'Unknown error') + '</div>';
        document.getElementById('sa-platform-grid').innerHTML = '';
        document.getElementById('sa-posts-body').innerHTML = '';
        document.getElementById('sa-posts-empty').style.display = '';
        document.getElementById('sa-diagnostics').innerHTML = '<div class="dash-empty">Failed to load diagnostics.</div>';
        renderHealthPanel();
      });
  }

  function bindKpiQuickFilters() {
    var root = document.getElementById('sa-kpis');
    if (!root) return;
    root.addEventListener('click', function (evt) {
      var node = evt.target;
      while (node && node !== root && !node.getAttribute('data-result-filter')) node = node.parentNode;
      if (!node || node === root) return;
      var result = node.getAttribute('data-result-filter') || '';
      if (!result) return;
      document.getElementById('sa-result').value = result;
      state.cursor = '';
      state.prevStack = [];
      loadData();
    });
  }

  function bind() {
    bindAccountRefresh();

    var pullBtn = document.getElementById('sa-pull-now');
    if (pullBtn) {
      pullBtn.addEventListener('click', function () {
        triggerPullNow();
      });
    }
  }

  function init() {
    bind();
    loadAccountStats(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
