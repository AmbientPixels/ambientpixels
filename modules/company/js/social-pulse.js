(function () {
  'use strict';

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

  function fmtMs(ms) {
    if (!ms || !isFinite(ms) || ms < 1) return '—';
    var sec = Math.round(ms / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.round(sec / 60);
    if (min < 60) return min + 'm';
    var hr = (min / 60).toFixed(1);
    return hr + 'h';
  }

  function topIssue(recentFailures) {
    var now = Date.now();
    var dayMs = 24 * 60 * 60 * 1000;
    var counts = {};
    var latestTs = {};

    (recentFailures || []).forEach(function (f) {
      var ts = Date.parse(f.timestamp || '');
      if (isNaN(ts) || (now - ts) > dayMs) return;
      var cls = f.error_class || 'UNKNOWN';
      counts[cls] = (counts[cls] || 0) + 1;
      latestTs[cls] = Math.max(latestTs[cls] || 0, ts);
    });

    var keys = Object.keys(counts);
    if (!keys.length) return null;

    keys.sort(function (a, b) {
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return (latestTs[b] || 0) - (latestTs[a] || 0);
    });

    return { error_class: keys[0], count: counts[keys[0]] };
  }

  function renderTrendBars(daily) {
    var arr = (daily || []).slice(-7);
    if (!arr.length) return '<div class="dash-empty">No trend data yet.</div>';

    var max = 1;
    arr.forEach(function (d) {
      var t = (d.published || 0) + (d.failed || 0);
      if (t > max) max = t;
    });

    var html = '<div class="spulse-trend-row">';
    arr.forEach(function (d) {
      var total = (d.published || 0) + (d.failed || 0);
      var h = Math.max(4, Math.round((total / max) * 42));
      var date = (d.date || '').slice(5);
      html += '<div class="spulse-trend-col">';
      html += '<div class="spulse-trend-bar" style="height:' + h + 'px"></div>';
      html += '<div class="spulse-trend-label">' + esc(date) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderPulse(data) {
    var root = document.getElementById('panel-social-pulse');
    if (!root) return;

    var summary = data && data.summary ? data.summary : {};
    var trends = data && data.trends ? data.trends : { daily: [] };
    var recentFailures = data && data.recentFailures ? data.recentFailures : [];
    var issue = summary.topIssue || topIssue(recentFailures);
    var totalExec = (summary.published || 0) + (summary.failed || 0);

    if (totalExec === 0) {
      root.innerHTML = '<div class="dash-empty">No social executions yet.</div>';
      return;
    }

    var chips = '';
    chips += '<div class="spulse-chip"><div class="spulse-chip-label">Published Today</div><div class="spulse-chip-value">' + esc(summary.publishedToday || 0) + '</div></div>';
    chips += '<div class="spulse-chip"><div class="spulse-chip-label">Failures (24h)</div><div class="spulse-chip-value spulse-chip-value--bad">' + esc(summary.failures24h || 0) + '</div></div>';
    chips += '<div class="spulse-chip"><div class="spulse-chip-label">7d Success %</div><div class="spulse-chip-value">' + esc(summary.successRate || 0) + '%</div></div>';
    chips += '<div class="spulse-chip"><div class="spulse-chip-label">Avg Execution Latency</div><div class="spulse-chip-value">' + esc(fmtMs(summary.avgLatency || 0)) + '</div></div>';
    chips += '<div class="spulse-chip"><div class="spulse-chip-label">Fail Streak</div><div class="spulse-chip-value">' + esc(summary.failStreak || 0) + '</div></div>';

    root.innerHTML = '' +
      '<div class="spulse-grid">' + chips + '</div>' +
      '<div class="spulse-block">' +
        '<div class="spulse-subtitle">Mini Trend (7d)</div>' +
        renderTrendBars(trends.daily || []) +
      '</div>' +
      '<div class="spulse-block">' +
        '<div class="spulse-subtitle">Top Issue</div>' +
        (issue
          ? '<div class="spulse-issue"><span class="spulse-issue-pill">' + esc(issue.error_class) + '</span><span>' + esc(issue.count) + ' in last 24h</span></div>'
          : '<div class="dash-empty">No issues in last 24h.</div>') +
      '</div>';
  }

  function loadPulse() {
    var root = document.getElementById('panel-social-pulse');
    if (!root) return;
    root.innerHTML = '<div class="dash-empty">Loading social pulse...</div>';

    var url = getApiBase() + '/social-metrics?limit=25';
    fetch(url, { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));
        renderPulse(resp.body || {});
      })
      .catch(function (err) {
        root.innerHTML = '<div class="dash-empty">Social Pulse unavailable: ' + esc(err.message || 'Unknown error') + '</div>';
      });
  }

  function init() {
    var root = document.getElementById('panel-social-pulse');
    if (!root) return;
    loadPulse();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
