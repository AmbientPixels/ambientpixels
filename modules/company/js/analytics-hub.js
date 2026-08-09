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

  var getAuthHeaders = APApi.secretHeaders;
  var _apiBase = APApi.base;

  // ─── Render: Account Overview totals + one card per platform ───
  // Platforms the account overview renders, in display order. Facebook and Instagram were
  // absent here while socialAccountStats had ALREADY been pulling Facebook — the data was
  // fetched, cached and then dropped on the floor by this list, so the dashboard showed
  // three platforms and reported itself complete.
  var ACCT_ORDER = ['x', 'linkedin', 'bluesky', 'facebook', 'instagram'];
  var ACCT_BADGE_ICONS = {
    x: 'fa-x-twitter', linkedin: 'fa-linkedin', bluesky: 'fa-bluesky',
    facebook: 'fa-facebook', instagram: 'fa-instagram'
  };

  // A count we could not read renders as the placeholder glyph, NOT as 0.
  // `followers: null` and `followers: 0` mean completely different things — one is a lost
  // token, the other is an audience of nobody — and `|| 0` rendered them identically.
  // Matches the '···' convention used by the public live-pulse widget (never an em dash).
  function _acctNum(v) {
    return (typeof v === 'number' && isFinite(v)) ? AH.fmtNum(v) : '···';
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
        cacheHint.textContent = 'cached \u00b7 ' + ageMin + 'm ago';
      } else {
        cacheHint.textContent = 'live';
      }
    }

    var t = data.totals || {};
    if (totalsRoot) {
      // A total summed over platforms we could not read is not a total. Naming the gap
      // keeps "2,479 followers" from being read as complete when one platform contributed
      // nothing because its token is dead.
      var unknownOn = Array.isArray(t.followers_unknown_on) ? t.followers_unknown_on : [];
      var followersNote = unknownOn.length
        ? '<div class="sa-acct-total-note">excludes ' + AH.esc(unknownOn.join(', ')) + ' (unreadable)</div>'
        : '';
      totalsRoot.innerHTML = '' +
        '<div class="sa-acct-total"><div class="sa-acct-total-label">Total Followers</div><div class="sa-acct-total-value">' + AH.esc(AH.fmtNum(t.followers || 0)) + '</div>' + followersNote + '</div>' +
        '<div class="sa-acct-total"><div class="sa-acct-total-label">Total Posts</div><div class="sa-acct-total-value">' + AH.esc(AH.fmtNum(t.posts || 0)) + '</div></div>' +
        '<div class="sa-acct-total"><div class="sa-acct-total-label">Connected</div><div class="sa-acct-total-value">' + AH.esc(t.platforms_connected || 0) + '/' + AH.esc(t.platforms_attempted || ACCT_ORDER.length) + '</div></div>' +
        '<div class="sa-acct-total"><div class="sa-acct-total-label">Errors</div><div class="sa-acct-total-value">' + AH.esc(t.platforms_errored || 0) + '</div></div>';
    }

    var platforms = data.platforms || {};
    var order = ACCT_ORDER;
    var cardsHtml = '';
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var pl = platforms[key];
      if (!pl) {
        cardsHtml += '<div class="sa-acct-card sa-acct-card--' + key + '"><div class="sa-acct-card-err"><i class="fas fa-exclamation-triangle"></i> ' + AH.esc(key) + ' not connected</div></div>';
        continue;
      }
      var avatarHtml = pl.avatar ? '<img class="sa-acct-avatar" src="' + AH.esc(pl.avatar) + '" alt="" onerror="this.style.display=\'none\'" />' : '';
      var badgeIcon = ACCT_BADGE_ICONS[key] || 'fa-globe';
      cardsHtml += '<div class="sa-acct-card sa-acct-card--' + key + '">';
      cardsHtml += '<div class="sa-acct-card-head">' + avatarHtml + '<div><div class="sa-acct-card-name">' + AH.esc(pl.name || '') + '</div><div class="sa-acct-card-handle">' + AH.esc(pl.handle || '') + '</div></div><span class="sa-acct-badge sa-acct-badge--' + key + '"><i class="fa-brands ' + badgeIcon + '"></i></span></div>';
      cardsHtml += '<div class="sa-acct-stats">';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + AH.esc(_acctNum(pl.followers)) + '</div><div class="sa-acct-stat-label">Followers</div></div>';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + AH.esc(_acctNum(pl.following)) + '</div><div class="sa-acct-stat-label">Following</div></div>';
      cardsHtml += '<div class="sa-acct-stat"><div class="sa-acct-stat-value">' + AH.esc(_acctNum(pl.tweets_count != null ? pl.tweets_count : pl.posts_count)) + '</div><div class="sa-acct-stat-label">Posts</div></div>';
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
