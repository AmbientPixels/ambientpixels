// analytics-hub.js — Account Overview zone of the Analytics Hub.
// Phase 5: stripped down from 589 lines to ~150. Deleted ~440 lines of
// dead legacy code (sa-from/sa-to/sa-platform/sa-result/sa-campaign filters,
// sa-kpis, sa-platform-grid, sa-posts-body, sa-diagnostics, sa-pull-now,
// sa-prev/sa-next pagers, sa-live-posts-body) that referenced DOM IDs no
// longer present on the page. Dead branches were unreachable from init()
// (which only calls bindAccountRefresh() + loadAccountStats(false)).
// Refactored remaining code to use AHShared helpers and publish for the
// Phase 7 hero strip. See plan: iridescent-wiggling-tide.
(function () {
  'use strict';

  if (!window.AHShared) {
    console.warn('[analytics-hub] AHShared not loaded — aborting');
    return;
  }
  var AH = window.AHShared;

  var state = { accountData: null };

  // Custom auth — uses x-company-secret from CompanyStore or sessionStorage.
  // Can't use AH.authHeaders because that's the X-AmbientOS-Key pattern, and
  // /api/social-account-stats expects x-company-secret.
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

  function _apiBase() {
    return window.location.hostname.indexOf('ambientpixels.ai') !== -1
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
      : '/api';
  }

  // ─── Render: Account Overview totals + 3 platform cards ───
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
        cacheHint.textContent = 'cached \u00b7 ' + ageMin + 'm ago';
      } else {
        cacheHint.textContent = 'live';
      }
    }

    var t = data.totals || {};
    if (totalsRoot) {
      totalsRoot.innerHTML = '' +
        '<div class="sa-acct-total"><div class="sa-acct-total-label">Total Followers</div><div class="sa-acct-total-value">' + AH.esc(AH.fmtNum(t.followers || 0)) + '</div></div>' +
        '<div class="sa-acct-total"><div class="sa-acct-total-label">Total Posts</div><div class="sa-acct-total-value">' + AH.esc(AH.fmtNum(t.posts || 0)) + '</div></div>' +
        '<div class="sa-acct-total"><div class="sa-acct-total-label">Connected</div><div class="sa-acct-total-value">' + AH.esc(t.platforms_connected || 0) + '/3</div></div>' +
        '<div class="sa-acct-total"><div class="sa-acct-total-label">Errors</div><div class="sa-acct-total-value">' + AH.esc(t.platforms_errored || 0) + '</div></div>';
    }

    var platforms = data.platforms || {};
    var order = ['x', 'linkedin', 'bluesky'];
    var cardsHtml = '';
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var pl = platforms[key];
      if (!pl) {
        cardsHtml += '<div class="sa-acct-card sa-acct-card--' + key + '"><div class="sa-acct-card-err"><i class="fas fa-exclamation-triangle"></i> ' + AH.esc(key) + ' not connected</div></div>';
        continue;
      }
      var avatarHtml = pl.avatar ? '<img class="sa-acct-avatar" src="' + AH.esc(pl.avatar) + '" alt="" onerror="this.style.display=\'none\'" />' : '';
      var badgeIcons = { x: 'fa-x-twitter', linkedin: 'fa-linkedin', bluesky: 'fa-bluesky' };
      var badgeIcon = badgeIcons[key] || 'fa-globe';
      cardsHtml += '<div class="sa-acct-card sa-acct-card--' + key + '">';
      cardsHtml += '<div class="sa-acct-card-head">' + avatarHtml + '<div><div class="sa-acct-card-name">' + AH.esc(pl.name || '') + '</div><div class="sa-acct-card-handle">' + AH.esc(pl.handle || '') + '</div></div><span class="sa-acct-badge sa-acct-badge--' + key + '"><i class="fa-brands ' + badgeIcon + '"></i></span></div>';
      cardsHtml += '<div class="sa-acct-stats">';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + AH.esc(AH.fmtNum(pl.followers || 0)) + '</div><div class="sa-acct-stat-label">Followers</div></div>';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + AH.esc(AH.fmtNum(pl.following != null ? pl.following : 0)) + '</div><div class="sa-acct-stat-label">Following</div></div>';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + AH.esc(AH.fmtNum(pl.tweets_count || pl.posts_count || 0)) + '</div><div class="sa-acct-stat-label">Posts</div></div>';
      cardsHtml += '</div></div>';
    }
    if (gridRoot) gridRoot.innerHTML = cardsHtml;

    var errors = data.errors || [];
    if (errRoot) {
      if (errors.length) {
        errRoot.innerHTML = errors.map(function (e) {
          return '<div class="sa-acct-err-line"><i class="fas fa-exclamation-circle"></i> ' + AH.esc(e) + '</div>';
        }).join('');
      } else {
        errRoot.innerHTML = '';
      }
    }

    // Phase 7 hook: hero strip subscribes to populate Followers + Connected cards
    AH.publish('account-overview.loaded', data);
  }

  function loadAccountStats(forceRefresh) {
    var url = _apiBase() + '/social-account-stats' + (forceRefresh ? '?refresh=1' : '');
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));
        renderAccountOverview(resp.body || {});
      })
      .catch(function (err) {
        var grid = document.getElementById('sa-acct-grid');
        if (grid) grid.innerHTML = '<div class="dash-empty">Account stats failed: ' + AH.esc(err.message || 'Unknown error') + '</div>';
      });
  }

  function bindAccountRefresh() {
    var btn = document.getElementById('sa-acct-refresh');
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      loadAccountStats(true).finally(function () { btn.disabled = false; });
    });
  }

  function init() {
    bindAccountRefresh();
    loadAccountStats(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
