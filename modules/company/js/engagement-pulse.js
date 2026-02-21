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

  function relativeFromIso(iso) {
    if (!iso) return '';
    var ts = Date.parse(iso);
    if (isNaN(ts)) return '';
    var diffMs = Math.max(0, Date.now() - ts);
    var mins = Math.floor(diffMs / 60000);
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    var days = Math.floor(hrs / 24);
    return days + ' days ago';
  }

  function renderTrendBars(daily) {
    var arr = (daily || []).slice(-7);
    if (!arr.length) return '<div class="dash-empty">No engagement trend data yet.</div>';

    var max = 1;
    arr.forEach(function (d) {
      var t = d.likes || 0;
      if (t > max) max = t;
    });

    var html = '<div class="epulse-trend-title">7d Likes Trend</div><div class="epulse-trend-row">';
    arr.forEach(function (d) {
      var h = Math.max(4, Math.round(((d.likes || 0) / max) * 42));
      html += '<div class="epulse-trend-col">';
      html += '<div class="epulse-trend-bar" style="height:' + h + 'px"></div>';
      html += '<div class="epulse-trend-label">' + esc((d.date || '').slice(5)) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function getModeMeta(mode, lastPulledAt) {
    if (mode === 'real') {
      if (!lastPulledAt) {
        return { badgeClass: 'epulse-badge epulse-badge--live', badgeText: 'LIVE', text: 'No successful pulls yet.' };
      }
      var rel = relativeFromIso(lastPulledAt);
      return {
        badgeClass: 'epulse-badge epulse-badge--live',
        badgeText: 'LIVE',
        text: rel ? ('Last pull: ' + rel) : 'No successful pulls yet.'
      };
    }

    if (mode === 'mock_forced') {
      return { badgeClass: 'epulse-badge epulse-badge--mock', badgeText: 'MOCK (forced)', text: 'Mock data (forced).' };
    }

    return { badgeClass: 'epulse-badge epulse-badge--mock', badgeText: 'MOCK', text: 'Waiting for first engagement pull.' };
  }

  function fmtNum(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function renderAccountRow(acctData) {
    if (!acctData || !acctData.platforms) return '';
    var order = ['x', 'linkedin', 'bluesky'];
    var labels = { x: 'X', linkedin: 'LinkedIn', bluesky: 'Bluesky' };
    var html = '<div class="epulse-split" style="margin-bottom:0.5rem;">';
    for (var i = 0; i < order.length; i++) {
      var pl = acctData.platforms[order[i]];
      html += '<div class="epulse-card">';
      html += '<div class="epulse-card-title">' + esc(labels[order[i]]) + '</div>';
      if (pl && pl.ok !== false) {
        html += '<div class="epulse-row"><span>Followers</span><strong>' + esc(fmtNum(pl.followers || 0)) + '</strong></div>';
        html += '<div class="epulse-row"><span>Posts</span><strong>' + esc(fmtNum(pl.tweets_count || pl.posts_count || 0)) + '</strong></div>';
      } else {
        html += '<div style="font-size:0.52rem;opacity:0.4;padding:0.2rem 0;">Not connected</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderPulse(data, acctData) {
    var root = document.getElementById('panel-engagement-pulse');
    if (!root) return;

    var summary = (data && data.summary) || {};
    var split = (data && data.engagementSplit) || {};
    var trends = (data && data.trends) || {};
    var meta = (data && data.meta) || {};
    var mode = meta.mode || 'mock_fallback';
    var modeMeta = getModeMeta(mode, meta.lastPulledAt || null);

    var chips = '';
    chips += '<div class="epulse-chip"><div class="epulse-chip-label">Likes (7d)</div><div class="epulse-chip-value">' + esc(summary.likes7d || 0) + '</div></div>';
    chips += '<div class="epulse-chip"><div class="epulse-chip-label">Comments (7d)</div><div class="epulse-chip-value">' + esc(summary.comments7d || 0) + '</div></div>';
    chips += '<div class="epulse-chip"><div class="epulse-chip-label">Reposts (7d)</div><div class="epulse-chip-value">' + esc(summary.reposts7d || 0) + '</div></div>';

    if (acctData && acctData.totals) {
      chips += '<div class="epulse-chip"><div class="epulse-chip-label">Total Followers</div><div class="epulse-chip-value">' + esc(fmtNum(acctData.totals.followers || 0)) + '</div></div>';
    }

    root.innerHTML = '' +
      '<div class="epulse-grid">' + chips + '</div>' +
      '<div class="epulse-meta"><span class="' + modeMeta.badgeClass + '">' + esc(modeMeta.badgeText) + '</span><span>' + esc(modeMeta.text) + '</span></div>' +
      renderAccountRow(acctData) +
      renderTrendBars(trends.daily || trends.last7 || []);
  }

  function loadPulse() {
    var root = document.getElementById('panel-engagement-pulse');
    if (!root) return;
    root.innerHTML = '<div class="dash-empty">Loading engagement pulse...</div>';

    var engUrl = getApiBase() + '/social-engagement?limit=50';
    var acctUrl = getApiBase() + '/social-account-stats';

    Promise.all([
      fetch(engUrl, { headers: getAuthHeaders() }).then(function (res) { return res.json(); }).catch(function () { return null; }),
      fetch(acctUrl, { headers: getAuthHeaders() }).then(function (res) { return res.json(); }).catch(function () { return null; })
    ]).then(function (results) {
      var engData = results[0] || {};
      var acctData = results[1] || null;
      renderPulse(engData, acctData);
    }).catch(function (err) {
      root.innerHTML = '<div class="dash-empty">Engagement Pulse unavailable: ' + esc(err.message || 'Unknown error') + '</div>';
    });
  }

  function init() {
    var root = document.getElementById('panel-engagement-pulse');
    if (!root) return;
    loadPulse();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
