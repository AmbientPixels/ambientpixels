// analytics-hub-shared.js — Shared helpers for the Analytics Hub redesign.
// Exposes window.AHShared. Loaded BEFORE the four analytics module scripts so
// they can call into shared helpers in later phases.
// See plan: iridescent-wiggling-tide. Phase 3 — helpers exist; consumer
// modules don't call them yet (refactor lands in Phases 4b/4c/5).
(function () {
  'use strict';

  var SCHEMA_VERSION = '1';
  var SCHEMA_KEY = 'ambientpixels.analyticsHub.schema';
  var TAB_KEY_PREFIX = 'ambientpixels.analyticsHub.tab.';

  // ─── localStorage schema migration ────────────────────────────
  // If the schema version is missing or different, wipe every
  // ambientpixels.analyticsHub.* key. Prevents stale tab names from a future
  // redesign pointing at panels that no longer exist.
  function _migrateSchema() {
    try {
      if (localStorage.getItem(SCHEMA_KEY) === SCHEMA_VERSION) return;
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('ambientpixels.analyticsHub.') === 0) keysToRemove.push(k);
      }
      keysToRemove.forEach(function (k) { localStorage.removeItem(k); });
      localStorage.setItem(SCHEMA_KEY, SCHEMA_VERSION);
    } catch (e) {
      // localStorage may be blocked (privacy mode, tracking prevention)
      console.warn('[AHShared] localStorage unavailable:', e.message);
    }
  }

  // ─── Configuration / network (delegated to shared ap-api.js / ap-utils.js) ──
  function apiBase() { return APApi.base().replace(/\/api$/, ''); }
  var authHeaders = APApi.keyHeaders;

  function fetchJSON(url, opts) {
    opts = opts || {};
    var headers = {};
    var auth = authHeaders();
    Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });
    }
    return fetch(apiBase() + url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  // ─── Formatting (delegated to shared ap-utils.js) ─────────────
  var esc = APUtils.esc;
  var fmtNum = APUtils.fmtNum;
  var relTime = APUtils.relTime;

  function perfColor(ms) {
    if (ms == null || isNaN(ms)) return 'rgba(255,255,255,0.9)';
    if (ms < 1000) return '#34d399';
    if (ms <= 3000) return '#fbbf24';
    return '#ef4444';
  }

  function formatRangeLabel(range) {
    if (range === '1d') return 'Last 24 hours';
    if (range === '30d') return 'Last 30 days';
    return 'Last 7 days';
  }

  // ─── Trust dot calculator ─────────────────────────────────────
  // For Top Pages rows: higher session/view ratio = more real distinct visits.
  // Returns { tone: 'high'|'med'|'low', label, ratio }.
  function trustDot(views, sessions) {
    if (!views || views <= 0) return { tone: 'low', label: 'no data', ratio: 0 };
    var ratio = (sessions || 0) / views;
    if (ratio >= 0.5) return { tone: 'high', label: 'real users', ratio: ratio };
    if (ratio >= 0.15) return { tone: 'med', label: 'mixed traffic', ratio: ratio };
    return { tone: 'low', label: 'bot-like or refresh-heavy', ratio: ratio };
  }

  // ─── Card builders (return HTML strings) ──────────────────────
  function kpiCard(opts) {
    opts = opts || {};
    var label = esc(opts.label || '');
    var value = esc(opts.value == null ? '—' : opts.value);
    var sub = opts.sub ? '<div class="ah-kpi-card__sub">' + esc(opts.sub) + '</div>' : '';
    var icon = opts.icon ? '<i class="fas fa-' + esc(opts.icon) + '"></i> ' : '';
    var toneClass = opts.tone ? ' ah-kpi-card--' + esc(opts.tone) : '';
    return '<div class="ah-kpi-card' + toneClass + '">' +
      '<div class="ah-kpi-card__label">' + icon + label + '</div>' +
      '<div class="ah-kpi-card__value">' + value + '</div>' +
      sub +
      '</div>';
  }

  function emptyState(opts) {
    opts = opts || {};
    var icon = opts.icon ? '<div class="ah-empty__icon"><i class="fas fa-' + esc(opts.icon) + '"></i></div>' : '';
    var title = opts.title ? '<div class="ah-empty__title">' + esc(opts.title) + '</div>' : '';
    var hint = opts.hint ? '<div class="ah-empty__hint">' + esc(opts.hint) + '</div>' : '';
    return '<div class="ah-empty">' + icon + title + hint + '</div>';
  }

  // ─── Tab system ───────────────────────────────────────────────
  function getActiveTab(zoneId) {
    if (!zoneId) return null;
    try {
      return localStorage.getItem(TAB_KEY_PREFIX + zoneId);
    } catch (e) {
      return null;
    }
  }

  function switchTab(zoneEl, tabName, source) {
    if (!zoneEl || !tabName) return;
    var tabs = zoneEl.querySelectorAll('.ah-tab');
    var panels = zoneEl.querySelectorAll('.ah-tab-panel');
    var activatedPanel = null;
    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-tab') === tabName);
    });
    panels.forEach(function (p) {
      var match = p.getAttribute('data-tab') === tabName;
      p.classList.toggle('is-active', match);
      if (match) activatedPanel = p;
    });
    // Publish a global tab-change event so any consumer (e.g. traffic-brief.js)
    // can re-render charts that need a visible canvas to compute dimensions.
    publish('tab-change', {
      zoneId: zoneEl.id || null,
      tabName: tabName,
      panel: activatedPanel,
      source: source || 'click'
    });
  }

  function initTabs(zoneEl, opts) {
    opts = opts || {};
    if (!zoneEl) return;
    var tabsNav = zoneEl.querySelector('.ah-tabs');
    if (!tabsNav) return;
    var zoneId = zoneEl.id;
    if (!zoneId) return;

    var tabs = tabsNav.querySelectorAll('.ah-tab');
    if (tabs.length === 0) return;

    // Determine which tab to activate first
    var saved = getActiveTab(zoneId);
    var available = Array.prototype.map.call(tabs, function (t) { return t.getAttribute('data-tab'); });
    var initial = (saved && available.indexOf(saved) !== -1) ? saved : available[0];
    switchTab(zoneEl, initial, 'init');

    // Wire click handlers
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.getAttribute('data-tab');
        switchTab(zoneEl, name);
        try { localStorage.setItem(TAB_KEY_PREFIX + zoneId, name); } catch (e) {}
        if (opts.onTabChange) {
          var panel = zoneEl.querySelector('.ah-tab-panel[data-tab="' + name + '"]');
          var alreadyLoaded = panel && panel.dataset.loaded === 'true';
          opts.onTabChange(name, panel, alreadyLoaded);
          if (panel && !alreadyLoaded) panel.dataset.loaded = 'true';
        }
      });
    });
  }

  function initAllTabs() {
    var zones = document.querySelectorAll('.ah-zone');
    zones.forEach(function (zone) {
      if (zone.querySelector('.ah-tabs')) initTabs(zone);
    });
  }

  // ─── Chart.js wrapper: daily-views timeline ──────────────────
  // Renders a smooth filled line chart of [{day, views}, ...] into a canvas.
  // Returns the Chart instance (or null if Chart.js or canvas missing).
  function makeTimeline(canvasEl, opts) {
    opts = opts || {};
    if (!canvasEl || typeof Chart === 'undefined') return null;
    var data = opts.data || [];
    if (data.length < 2) return null;

    // Destroy any prior chart on this canvas
    if (canvasEl._ahChart) {
      try { canvasEl._ahChart.destroy(); } catch (e) {}
      canvasEl._ahChart = null;
    }

    var ctx = canvasEl.getContext('2d');
    var color = opts.color || '#5ac8fa';
    var rgbaSoft = opts.rgbaSoft || 'rgba(90,200,250,0.2)';
    var rgbaFaint = opts.rgbaFaint || 'rgba(90,200,250,0.02)';
    var grad = ctx.createLinearGradient(0, 0, 0, canvasEl.parentElement.offsetHeight || 120);
    grad.addColorStop(0, rgbaSoft);
    grad.addColorStop(1, rgbaFaint);

    var labels = data.map(function (d) { return d.day ? String(d.day).slice(5) : ''; });
    var values = data.map(function (d) { return d.views || 0; });
    var valueLabel = opts.valueLabel || 'views';

    canvasEl._ahChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          borderColor: color,
          backgroundColor: grad,
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 4,
          pointBackgroundColor: color
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20,20,30,0.95)',
            titleColor: 'rgba(255,255,255,0.8)',
            bodyColor: 'rgba(255,255,255,0.7)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 8,
            titleFont: { size: 10 },
            bodyFont: { size: 10 },
            callbacks: {
              label: function (c) { return ' ' + c.parsed.y.toLocaleString() + ' ' + valueLabel; }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 9 }, maxRotation: 0 },
            border: { color: 'rgba(255,255,255,0.06)' }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 9 } },
            border: { color: 'rgba(255,255,255,0.06)' }
          }
        }
      }
    });
    return canvasEl._ahChart;
  }

  // ─── Pub/sub bus ──────────────────────────────────────────────
  // Used by Phase 7 hero strip to subscribe to data-loaded events
  // published by each zone's render module. Also used by traffic-brief.js
  // (Phase 4b) to listen for 'tab-change' events so it can re-render the
  // Chart.js timeline when its panel becomes visible.
  // Standard events:
  //   'tab-change'   { zoneId, tabName, panel, source: 'click'|'init' }
  //   'zone-data'    { zoneId, payload }   (Phase 7)
  var _subs = {};
  function publish(event, data) {
    var list = _subs[event];
    if (!list) return;
    list.forEach(function (fn) {
      try { fn(data); } catch (e) { console.error('[AHShared.publish]', event, e); }
    });
  }
  function subscribe(event, fn) {
    if (!_subs[event]) _subs[event] = [];
    _subs[event].push(fn);
    return function unsubscribe() {
      _subs[event] = _subs[event].filter(function (f) { return f !== fn; });
    };
  }

  // ─── Init on DOMContentLoaded ─────────────────────────────────
  function _init() {
    _migrateSchema();
    initAllTabs();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // ─── Public API ───────────────────────────────────────────────
  window.AHShared = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    apiBase: apiBase,
    authHeaders: authHeaders,
    fetchJSON: fetchJSON,
    esc: esc,
    fmtNum: fmtNum,
    relTime: relTime,
    perfColor: perfColor,
    formatRangeLabel: formatRangeLabel,
    trustDot: trustDot,
    kpiCard: kpiCard,
    emptyState: emptyState,
    makeTimeline: makeTimeline,
    initTabs: initTabs,
    initAllTabs: initAllTabs,
    switchTab: switchTab,
    getActiveTab: getActiveTab,
    publish: publish,
    subscribe: subscribe
  };
})();
