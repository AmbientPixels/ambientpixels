// hero-strip.js — Populates the 7 KPI cards at the top of the Analytics Hub
// by subscribing to data-load events published by each zone's render module.
// Phase 7 of the analytics-hub redesign. See plan: iridescent-wiggling-tide.
//
// Subscribed events:
//   traffic-brief.loaded     → Page Views, Sessions, P95 Load, Errors
//   social.loaded            → Followers, Connected
//   account-overview.loaded  → Followers, Connected (fallback / canonical)
//   product-analytics.overview → Today DAU
(function () {
  'use strict';

  if (!window.AHShared) {
    console.warn('[hero-strip] AHShared not loaded — aborting');
    return;
  }
  var AH = window.AHShared;

  function _setCard(metric, value, sub) {
    var card = document.querySelector('.ah-hero-card[data-metric="' + metric + '"]');
    if (!card) return;
    var valEl = card.querySelector('[data-value]');
    var subEl = card.querySelector('[data-sub]');
    if (valEl) valEl.textContent = value;
    if (subEl && sub != null) subEl.textContent = sub;
  }

  function _perfTone(ms) {
    if (ms == null || isNaN(ms)) return null;
    if (ms < 1000) return 'green';
    if (ms <= 3000) return 'amber';
    return 'red';
  }

  function _errorTone(count) {
    if (count == null || isNaN(count)) return null;
    if (count === 0) return 'green';
    if (count <= 10) return 'amber';
    return 'red';
  }

  // ─── Traffic Brief subscriber ─────────────────────────────────
  AH.subscribe('traffic-brief.loaded', function (data) {
    if (!data) return;
    var totals = data.totals || {};
    // Fall back to per-row sum if server didn't include totals (older API)
    var pageViews = totals.pageViews;
    var sessions = totals.uniqueSessions;
    if (pageViews == null && data.topPages) {
      pageViews = data.topPages.reduce(function (s, p) { return s + (p.views || 0); }, 0);
    }
    if (sessions == null && data.topPages) {
      sessions = data.topPages.reduce(function (s, p) { return s + (p.uniqueSessions || 0); }, 0);
    }
    _setCard('pageviews', AH.fmtNum(pageViews || 0), data.rangeLabel || data.range || 'last 7 days');
    _setCard('sessions',  AH.fmtNum(sessions  || 0), 'unique visits');

    var p95 = data.performance && data.performance.pageLoadMs_p95;
    if (p95 != null) {
      _setCard('p95load', p95 + 'ms', 'page load p95');
      // Re-color the card based on perf tone
      var card = document.querySelector('.ah-hero-card[data-metric="p95load"]');
      if (card) {
        card.classList.remove('ah-hero-card--green', 'ah-hero-card--amber', 'ah-hero-card--red');
        var tone = _perfTone(p95);
        if (tone) card.classList.add('ah-hero-card--' + tone);
        else card.classList.add('ah-hero-card--amber'); // default
      }
    }

    var totalErrors = totals.totalErrors;
    if (totalErrors == null && data.errors) {
      totalErrors = data.errors.reduce(function (s, e) { return s + (e.count || 0); }, 0);
    }
    if (totalErrors != null) {
      _setCard('errors', AH.fmtNum(totalErrors), data.rangeLabel || 'exceptions');
      // Re-color the card based on error tone (mirrors p95 logic above).
      // Without this, the card is hardcoded red in analytics-hub.html and
      // looks alarming even when the count is 0 or near-zero.
      var errCard = document.querySelector('.ah-hero-card[data-metric="errors"]');
      if (errCard) {
        errCard.classList.remove('ah-hero-card--green', 'ah-hero-card--amber', 'ah-hero-card--red');
        var errTone = _errorTone(totalErrors);
        if (errTone) errCard.classList.add('ah-hero-card--' + errTone);
        else errCard.classList.add('ah-hero-card--red'); // default if tone unknown
      }
    }
  });

  // ─── Account Overview subscriber (canonical for Followers + Connected) ──
  AH.subscribe('account-overview.loaded', function (data) {
    if (!data) return;
    var t = data.totals || {};
    var followers = t.followers || 0;
    var connected = t.platforms_connected || 0;
    _setCard('followers', AH.fmtNum(followers), 'all platforms');
    _setCard('connected', connected + '/3', t.platforms_errored ? (t.platforms_errored + ' error' + (t.platforms_errored !== 1 ? 's' : '')) : 'platform health');
  });

  // ─── Social subscriber (fallback if account-overview hasn't fired) ──
  AH.subscribe('social.loaded', function (payload) {
    if (!payload) return;
    // Only fill in if account-overview hasn't already populated.
    var followersCard = document.querySelector('.ah-hero-card[data-metric="followers"] [data-value]');
    if (followersCard && followersCard.textContent === '\u2014') {
      _setCard('followers', AH.fmtNum(payload.followers || 0), 'all platforms');
    }
  });

  // ─── Product Analytics subscriber ─────────────────────────────
  AH.subscribe('product-analytics.overview', function (payload) {
    if (!payload || !payload.data) return;
    var d = payload.data;
    var dailyArr = d.daily || [];
    var todayDau = dailyArr.length > 0 ? dailyArr[dailyArr.length - 1].dau : 0;
    _setCard('dau', AH.fmtNum(todayDau || 0), 'daily active');
  });
})();
