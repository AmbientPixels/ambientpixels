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

  function renderPulse(data) {
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

    function platformCard(key, label) {
      var p = split[key] || { likes7d: 0, comments7d: 0, reposts7d: 0 };
      var html = '<div class="epulse-card">';
      html += '<div class="epulse-card-title">' + esc(label) + '</div>';
      html += '<div class="epulse-row"><span>Likes</span><strong>' + esc(p.likes7d || 0) + '</strong></div>';
      html += '<div class="epulse-row"><span>Comments</span><strong>' + esc(p.comments7d || 0) + '</strong></div>';
      html += '<div class="epulse-row"><span>Reposts</span><strong>' + esc(p.reposts7d || 0) + '</strong></div>';
      html += '</div>';
      return html;
    }

    root.innerHTML = '' +
      '<div class="epulse-grid">' + chips + '</div>' +
      '<div class="epulse-meta"><span class="' + modeMeta.badgeClass + '">' + esc(modeMeta.badgeText) + '</span><span>' + esc(modeMeta.text) + '</span></div>' +
      '<div class="epulse-split">' +
        platformCard('x', 'X') +
        platformCard('linkedin', 'LinkedIn') +
        platformCard('bluesky', 'Bluesky') +
      '</div>' +
      renderTrendBars(trends.daily || trends.last7 || []);
  }

  function loadPulse() {
    var root = document.getElementById('panel-engagement-pulse');
    if (!root) return;
    root.innerHTML = '<div class="dash-empty">Loading engagement pulse...</div>';

    var url = getApiBase() + '/social-engagement?limit=50';
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
