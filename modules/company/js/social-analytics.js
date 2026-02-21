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
    pullRun: null
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

  function renderEngagementByPlatform(data) {
    var split = (data && data.engagementSplit) || {};
    var meta = (data && data.meta) || {};
    var cards = document.querySelectorAll('.sa-platform-eng-card');
    var metaRoot = document.getElementById('sa-platform-eng-meta');

    cards.forEach(function (card) {
      var platform = card.getAttribute('data-platform') || '';
      var bucket = split[platform] || {};
      card.querySelectorAll('[data-key]').forEach(function (node) {
        var key = node.getAttribute('data-key') || '';
        node.textContent = String(metricOrZero(bucket[key]));
      });
    });

    if (!metaRoot) return;
    if (meta.mode === 'real') {
      metaRoot.innerHTML = '<span class="sa-mode-badge sa-mode-badge--live">LIVE</span>';
      return;
    }

    if (meta.mode === 'mock_fallback' && !meta.lastPulledAt) {
      metaRoot.innerHTML = '<span>Waiting for first engagement pull.</span>';
      return;
    }

    if (meta.mode === 'mock_forced') {
      metaRoot.innerHTML = '<span class="sa-mode-badge sa-mode-badge--mock">MOCK</span>';
      return;
    }

    metaRoot.innerHTML = '';
  }

  function renderEngagementTrends(trends) {
    var root = document.getElementById('sa-engagement-trends');
    var rows = (trends && trends.last7) ? trends.last7 : [];
    if (!rows.length) {
      root.innerHTML = '<div class="dash-empty">No engagement snapshots yet.</div>';
      return;
    }

    var max = 1;
    rows.forEach(function (r) {
      var t = (r.likes || 0) + (r.comments || 0) + (r.reposts || 0);
      if (t > max) max = t;
    });

    var html = '<div class="sa-eng-trends-title">Daily Trend (7d)</div><div class="sa-eng-bars">';
    rows.forEach(function (r) {
      var total = (r.likes || 0) + (r.comments || 0) + (r.reposts || 0);
      var h = Math.max(4, Math.round((total / max) * 42));
      html += '<div class="sa-eng-col">';
      html += '<div class="sa-eng-bar" style="height:' + h + 'px"></div>';
      html += '<div class="sa-eng-label">' + esc((r.date || '').slice(5)) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    root.innerHTML = html;
  }

  function renderEngagement(data) {
    var kpis = document.getElementById('sa-engagement-kpis');
    var tbody = document.getElementById('sa-engagement-top-posts');
    var empty = document.getElementById('sa-engagement-empty');

    var summary = (data && data.summary) || {};
    var topPosts = (data && data.topPosts) || [];
    var rows = (data && data.rows) || [];
    var hasAny = rows.length > 0;

    kpis.innerHTML = '' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Likes (7d)</div><div class="sa-kpi-value">' + esc(summary.likes7d || 0) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Comments (7d)</div><div class="sa-kpi-value">' + esc(summary.comments7d || 0) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Reposts (7d)</div><div class="sa-kpi-value">' + esc(summary.reposts7d || 0) + '</div></div>';

    if (!hasAny) {
      tbody.innerHTML = '';
      empty.style.display = '';
      empty.textContent = 'No engagement snapshots yet.';
      renderEngagementTrends({ last7: [] });
      return;
    }

    renderEngagementTrends(data.trends || {});

    if (!topPosts.length) {
      tbody.innerHTML = '';
      empty.style.display = '';
      empty.textContent = 'No top posts for selected filters.';
      return;
    }

    empty.style.display = 'none';
    var html = '';
    topPosts.forEach(function (p) {
      var linkCell = p.link ? '<a class="sa-link" href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer">Open</a>' : '—';
      html += '<tr>' +
        '<td>' + esc(p.platform || '') + '</td>' +
        '<td>' + esc((p.text_preview || '').slice(0, 90) || '—') + '</td>' +
        '<td>' + esc(p.likes || 0) + '</td>' +
        '<td>' + esc(p.comments || 0) + '</td>' +
        '<td>' + esc(p.reposts || 0) + '</td>' +
        '<td>' + linkCell + '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
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
        renderEngagementByPlatform(resp.body || {});
        renderEngagement(resp.body || {});
        renderHealthPanel();
      })
      .catch(function () {
        state.engagementData = {
          summary: {},
          engagementSplit: {},
          trends: { last7: [] },
          meta: {}
        };
        renderEngagementByPlatform({
          engagementSplit: {
            x: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
            linkedin: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
            bluesky: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 }
          },
          meta: {}
        });
        document.getElementById('sa-engagement-kpis').innerHTML = '<div class="dash-empty">Engagement data unavailable.</div>';
        document.getElementById('sa-engagement-top-posts').innerHTML = '';
        document.getElementById('sa-engagement-empty').style.display = '';
        document.getElementById('sa-engagement-empty').textContent = 'No engagement snapshots yet.';
        document.getElementById('sa-engagement-trends').innerHTML = '<div class="dash-empty">No engagement snapshots yet.</div>';
        renderHealthPanel();
      });
  }

  function bindEngagementPlatformCards() {
    document.querySelectorAll('.sa-platform-eng-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var platform = card.getAttribute('data-platform') || '';
        document.getElementById('sa-platform').value = platform;
        state.cursor = '';
        state.prevStack = [];
        loadData();
      });
    });
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
    bindEngagementPlatformCards();
    bindKpiQuickFilters();

    document.getElementById('sa-apply').addEventListener('click', function () {
      state.cursor = '';
      state.prevStack = [];
      loadData();
    });

    var pullBtn = document.getElementById('sa-pull-now');
    if (pullBtn) {
      pullBtn.addEventListener('click', function () {
        triggerPullNow();
      });
    }

    document.getElementById('sa-reset').addEventListener('click', function () {
      var now = new Date();
      var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      document.getElementById('sa-from').value = fmtDateInput(weekAgo);
      document.getElementById('sa-to').value = fmtDateInput(now);
      document.getElementById('sa-platform').value = '';
      document.getElementById('sa-result').value = '';
      document.getElementById('sa-campaign').value = '';
      state.cursor = '';
      state.prevStack = [];
      loadData();
    });

    document.getElementById('sa-next').addEventListener('click', function () {
      if (!state.nextCursor) return;
      state.prevStack.push(state.cursor);
      state.cursor = state.nextCursor;
      loadData();
    });

    document.getElementById('sa-prev').addEventListener('click', function () {
      if (!state.prevStack.length) return;
      state.cursor = state.prevStack.pop() || '';
      loadData();
    });
  }

  function init() {
    loadFiltersFromQuery();
    bind();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
