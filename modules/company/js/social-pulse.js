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

  function fmtNum(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function renderAccountBar(acctData) {
    if (!acctData || !acctData.platforms) return '';
    var order = ['x', 'linkedin', 'bluesky'];
    var labels = { x: 'X', linkedin: 'LinkedIn', bluesky: 'Bluesky' };
    var colors = { x: '#1d9bf0', linkedin: '#0a66c2', bluesky: '#0085ff' };
    var html = '<div class="spulse-block"><div class="spulse-subtitle">Account Overview</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.4rem;">';
    for (var i = 0; i < order.length; i++) {
      var pl = acctData.platforms[order[i]];
      html += '<div style="border:1px solid rgba(255,255,255,0.06);border-left:2px solid ' + colors[order[i]] + ';border-radius:6px;padding:0.35rem 0.4rem;background:rgba(255,255,255,0.012);">';
      html += '<div style="font-size:0.5rem;opacity:0.45;text-transform:uppercase;margin-bottom:0.15rem;">' + esc(labels[order[i]]) + '</div>';
      if (pl && pl.ok !== false) {
        html += '<div style="font-size:0.8rem;font-weight:700;">' + esc(fmtNum(pl.followers || 0)) + '</div>';
        html += '<div style="font-size:0.42rem;opacity:0.38;">followers</div>';
      } else {
        html += '<div style="font-size:0.48rem;opacity:0.35;">Not connected</div>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderPulse(data, acctData) {
    var root = document.getElementById('panel-social-pulse');
    if (!root) return;

    var summary = data && data.summary ? data.summary : {};
    var trends = data && data.trends ? data.trends : { daily: [] };
    var recentFailures = data && data.recentFailures ? data.recentFailures : [];
    var issue = summary.topIssue || topIssue(recentFailures);
    var totalExec = (summary.published || 0) + (summary.failed || 0);

    var chips = '';
    if (acctData && acctData.totals) {
      chips += '<div class="spulse-chip"><div class="spulse-chip-label">Total Followers</div><div class="spulse-chip-value">' + esc(fmtNum(acctData.totals.followers || 0)) + '</div></div>';
      chips += '<div class="spulse-chip"><div class="spulse-chip-label">Connected</div><div class="spulse-chip-value">' + esc(acctData.totals.platforms_connected || 0) + '/3</div></div>';
    }
    chips += '<div class="spulse-chip"><div class="spulse-chip-label">Published Today</div><div class="spulse-chip-value">' + esc(summary.publishedToday || 0) + '</div></div>';
    chips += '<div class="spulse-chip"><div class="spulse-chip-label">Failures (24h)</div><div class="spulse-chip-value spulse-chip-value--bad">' + esc(summary.failures24h || 0) + '</div></div>';
    chips += '<div class="spulse-chip"><div class="spulse-chip-label">7d Success %</div><div class="spulse-chip-value">' + esc(summary.successRate || 0) + '%</div></div>';

    if (totalExec === 0 && (!acctData || !acctData.totals)) {
      root.innerHTML = '<div class="dash-empty">No social data yet. Connect platforms in Azure env vars.</div>';
      return;
    }

    root.innerHTML = '' +
      '<div class="spulse-grid">' + chips + '</div>' +
      renderAccountBar(acctData) +
      (totalExec > 0 ? (
        '<div class="spulse-block">' +
          '<div class="spulse-subtitle">Delivery Trend (7d)</div>' +
          renderTrendBars(trends.daily || []) +
        '</div>' +
        '<div class="spulse-block">' +
          '<div class="spulse-subtitle">Top Issue</div>' +
          (issue
            ? '<div class="spulse-issue"><span class="spulse-issue-pill">' + esc(issue.error_class) + '</span><span>' + esc(issue.count) + ' in last 24h</span></div>'
            : '<div class="dash-empty">No issues in last 24h.</div>') +
        '</div>'
      ) : '<div class="dash-empty" style="margin-top:0.3rem;">No agent posts yet.</div>');
  }

  function loadPulse() {
    var root = document.getElementById('panel-social-pulse');
    if (!root) return;
    root.innerHTML = '<div class="dash-empty">Loading social pulse...</div>';

    var metricsUrl = getApiBase() + '/social-metrics?limit=25';
    var acctUrl = getApiBase() + '/social-account-stats';

    Promise.all([
      fetch(metricsUrl, { headers: getAuthHeaders() }).then(function (res) { return res.json(); }).catch(function () { return null; }),
      fetch(acctUrl, { headers: getAuthHeaders() }).then(function (res) { return res.json(); }).catch(function () { return null; })
    ]).then(function (results) {
      var metricsData = results[0] || {};
      var acctData = results[1] || null;
      renderPulse(metricsData, acctData);
    }).catch(function (err) {
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
