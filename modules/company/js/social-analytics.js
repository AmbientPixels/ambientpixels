(function () {
  'use strict';

  var state = {
    cursor: '',
    prevStack: [],
    nextCursor: null,
    limit: 25,
    rows: []
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

  function fmtLatency(ms) {
    if (!ms || !isFinite(ms) || ms < 1) return '—';
    var sec = Math.round(ms / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.round(sec / 60);
    if (min < 60) return min + 'm';
    return (min / 60).toFixed(1) + 'h';
  }

  function renderKpis(summary) {
    var root = document.getElementById('sa-kpis');
    root.innerHTML = '' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Published</div><div class="sa-kpi-value sa-kpi-value--good">' + esc(summary.published || 0) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Failed</div><div class="sa-kpi-value sa-kpi-value--bad">' + esc(summary.failed || 0) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Success Rate</div><div class="sa-kpi-value">' + esc(summary.successRate || 0) + '%</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Avg Latency</div><div class="sa-kpi-value">' + esc(fmtLatency(summary.avgLatency || 0)) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Fail Streak</div><div class="sa-kpi-value">' + esc(summary.failStreak || 0) + '</div></div>' +
      '<div class="sa-kpi"><div class="sa-kpi-label">Pending Approvals</div><div class="sa-kpi-value">' + esc(summary.pendingApprovals || 0) + '</div></div>';
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

  function updatePagerButtons() {
    document.getElementById('sa-prev').disabled = state.prevStack.length === 0;
    document.getElementById('sa-next').disabled = !state.nextCursor;
  }

  function loadData() {
    var filters = readFilters();
    writeFiltersToQuery(filters);

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
        updatePagerButtons();
      })
      .catch(function (err) {
        document.getElementById('sa-kpis').innerHTML = '<div class="dash-empty">Failed to load metrics: ' + esc(err.message || 'Unknown error') + '</div>';
        document.getElementById('sa-platform-grid').innerHTML = '';
        document.getElementById('sa-posts-body').innerHTML = '';
        document.getElementById('sa-posts-empty').style.display = '';
        document.getElementById('sa-diagnostics').innerHTML = '<div class="dash-empty">Failed to load diagnostics.</div>';
      });
  }

  function bind() {
    document.getElementById('sa-apply').addEventListener('click', function () {
      state.cursor = '';
      state.prevStack = [];
      loadData();
    });

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
