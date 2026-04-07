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

  // ─── Configuration / network ──────────────────────────────────
  function apiBase() {
    return window.location.hostname.indexOf('ambientpixels.ai') !== -1
      ? 'https://ambientpixels-nova-api.azurewebsites.net'
      : '';
  }

  function authHeaders() {
    var headers = {};
    var key = '';
    if (window._config && window._config.ambientosInternalKey) {
      key = window._config.ambientosInternalKey;
    } else if (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteKey) {
      key = CompanyStore.getWriteKey() || '';
    }
    if (key) headers['X-AmbientOS-Key'] = key;
    return headers;
  }

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

  // ─── Formatting ───────────────────────────────────────────────
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = (s == null ? '' : String(s));
    return d.innerHTML;
  }

  function fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }

  function relTime(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var diff = Date.now() - t;
    if (diff < 0) return 'just now';
    var s = Math.floor(diff / 1000);
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  }

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

  function switchTab(zoneEl, tabName) {
    if (!zoneEl || !tabName) return;
    var tabs = zoneEl.querySelectorAll('.ah-tab');
    var panels = zoneEl.querySelectorAll('.ah-tab-panel');
    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-tab') === tabName);
    });
    panels.forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-tab') === tabName);
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
    switchTab(zoneEl, initial);

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

  // ─── Pub/sub bus ──────────────────────────────────────────────
  // Used by Phase 7 hero strip to subscribe to data-loaded events
  // published by each zone's render module.
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
  // Note: makeSparkline / makeTimeline (Chart.js wrappers) land in Phase 4b
  // alongside the Traffic Brief refactor.
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
    initTabs: initTabs,
    initAllTabs: initAllTabs,
    switchTab: switchTab,
    getActiveTab: getActiveTab,
    publish: publish,
    subscribe: subscribe
  };
})();
