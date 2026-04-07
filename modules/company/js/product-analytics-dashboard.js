// product-analytics-dashboard.js — Product Analytics zone of the Analytics Hub.
// Phase 4c: refactored to use AHShared helpers and the .ah-zone tab system.
// Each of the four sub-views (Overview / Funnels / Events / Breakdown) maps
// to one productAnalyticsQuery metric and is lazy-loaded on first tab click.
// Refresh / filter change invalidates all loaded flags and re-fetches the
// currently active tab. See plan: iridescent-wiggling-tide.
(function () {
  'use strict';

  if (!window.AHShared) {
    console.warn('[product-analytics] AHShared not loaded — aborting');
    return;
  }
  var AH = window.AHShared;

  var API = 'https://ambientpixels-nova-api.azurewebsites.net/api/productAnalyticsQuery';
  var SECRET = 'pixelpusher';
  var ZONE_ID = 'ah-zone-product';

  var kpisEl       = document.getElementById('pa-kpis');
  var productsEl   = document.getElementById('pa-products');
  var funnelEl     = document.getElementById('pa-funnel');
  var eventsEl     = document.getElementById('pa-events');
  var productFilter = document.getElementById('pa-product-filter');
  var rangeFilter   = document.getElementById('pa-range-filter');
  var refreshBtn    = document.getElementById('pa-refresh');

  if (!kpisEl) return;

  var PRODUCT_COLORS = {
    pixelagents: '#8F00FF',
    agentforge: '#00F0FF',
    ambientscore: '#a3e635',
    blindspot: '#EF9F27',
    cardforge: '#38bdf8',
    storyforge: '#a78bfa',
    blog: '#34d399',
    tileforge: '#fbbf24',
    nova: '#7dd3fc',
    dashboard: '#94a3b8'
  };

  var PRODUCT_ICONS = {
    pixelagents: 'fa-robot',
    agentforge: 'fa-hammer',
    ambientscore: 'fa-chart-line',
    blindspot: 'fa-crosshairs',
    cardforge: 'fa-layer-group',
    storyforge: 'fa-book-open',
    blog: 'fa-rss',
    tileforge: 'fa-th-large',
    nova: 'fa-star',
    dashboard: 'fa-gauge'
  };

  // ─── Lazy-load state ──────────────────────────────────────────
  var _loaded = { overview: false, funnels: false, events: false, breakdown: false };

  function _params() {
    return {
      product: productFilter ? productFilter.value : 'all',
      range:   rangeFilter   ? rangeFilter.value   : '7d'
    };
  }

  function _fetch(metric) {
    var p = _params();
    var url = API + '?range=' + encodeURIComponent(p.range) +
              '&product=' + encodeURIComponent(p.product) +
              '&metric=' + encodeURIComponent(metric);
    return fetch(url, { headers: { 'x-company-secret': SECRET } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function _showError(el, err) {
    if (!el) return;
    el.innerHTML = '<div class="ah-warning">' +
      '<i class="fas fa-exclamation-triangle"></i>' + AH.esc(err && err.message ? err.message : 'fetch error') +
      '</div>';
  }

  // ─── Loaders (one per tab) ────────────────────────────────────
  // Each loader marks _loaded[tab] = true SYNCHRONOUSLY before kicking off
  // the fetch, preventing a race where the IIFE eager-load and the
  // tab-change handler both fire the same fetch in parallel. On error
  // the flag is cleared so a refresh can retry.
  function loadOverview() {
    if (_loaded.overview) return;
    _loaded.overview = true;
    kpisEl.innerHTML = '<div class="ah-loading">Loading product analytics\u2026</div>';
    _fetch('overview').then(renderOverview).catch(function (err) {
      _loaded.overview = false;
      _showError(kpisEl, err);
    });
  }

  function loadFunnels() {
    if (!funnelEl || _loaded.funnels) return;
    _loaded.funnels = true;
    funnelEl.innerHTML = '<div class="ah-loading">Loading funnels\u2026</div>';
    _fetch('funnels').then(renderFunnels).catch(function (err) {
      _loaded.funnels = false;
      _showError(funnelEl, err);
    });
  }

  function loadEvents() {
    if (!eventsEl || _loaded.events) return;
    _loaded.events = true;
    eventsEl.innerHTML = '<div class="ah-loading">Loading top events\u2026</div>';
    _fetch('events').then(renderEvents).catch(function (err) {
      _loaded.events = false;
      _showError(eventsEl, err);
    });
  }

  function loadBreakdown() {
    if (!productsEl || _loaded.breakdown) return;
    _loaded.breakdown = true;
    productsEl.innerHTML = '<div class="ah-loading">Loading product breakdown\u2026</div>';
    _fetch('products').then(renderProducts).catch(function (err) {
      _loaded.breakdown = false;
      _showError(productsEl, err);
    });
  }

  var _loaders = {
    overview:  loadOverview,
    funnels:   loadFunnels,
    events:    loadEvents,
    breakdown: loadBreakdown
  };

  function _loadTab(tabName) {
    if (_loaded[tabName]) return;
    var loader = _loaders[tabName];
    if (loader) loader();
  }

  function _onFilterChange() {
    // Invalidate everything and re-fetch only the currently active tab.
    Object.keys(_loaded).forEach(function (k) { _loaded[k] = false; });
    var activeTab = AH.getActiveTab(ZONE_ID) || 'overview';
    _loadTab(activeTab);
  }

  // ─── Renderers ────────────────────────────────────────────────
  function renderOverview(resp) {
    if (!resp || !resp.data) {
      kpisEl.innerHTML = AH.emptyState({
        icon: 'chart-line',
        title: 'No product analytics yet',
        hint: 'Events will appear after users visit instrumented pages.'
      });
      return;
    }
    var d = resp.data;
    var dailyArr = d.daily || [];
    var todayDau = dailyArr.length > 0 ? dailyArr[dailyArr.length - 1].dau : 0;
    var avgDau = dailyArr.length > 0
      ? Math.round(dailyArr.reduce(function (s, x) { return s + (x.dau || 0); }, 0) / dailyArr.length)
      : 0;

    var html = '';
    html += AH.kpiCard({ icon: 'bolt',          label: 'Total Events', value: AH.fmtNum(d.totalEvents || 0), sub: resp.range });
    html += AH.kpiCard({ icon: 'users',         label: 'Unique Users', value: AH.fmtNum(d.uniqueUsers || 0), sub: resp.range });
    html += AH.kpiCard({ icon: 'calendar-day', label: 'Today DAU',    value: AH.fmtNum(todayDau) });
    html += AH.kpiCard({ icon: 'chart-simple', label: 'Avg DAU',      value: AH.fmtNum(avgDau), sub: resp.range });

    // Sparkline (SVG, full-width inside the grid)
    if (dailyArr.length > 1) {
      var maxDau = Math.max.apply(null, dailyArr.map(function (x) { return x.dau || 0; })) || 1;
      var width = 300;
      var height = 50;
      var step = width / (dailyArr.length - 1);
      var points = dailyArr.map(function (x, i) {
        return (i * step).toFixed(1) + ',' + (height - 4 - ((x.dau || 0) / maxDau) * (height - 8)).toFixed(1);
      }).join(' ');

      html += '<div class="pa-sparkline">' +
        '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
        '<polyline points="' + points + '" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<div class="pa-sparkline__labels">' +
        '<span>' + AH.esc(dailyArr[0].day) + '</span>' +
        '<span>' + AH.esc(dailyArr[dailyArr.length - 1].day) + '</span>' +
        '</div></div>';
    }

    kpisEl.innerHTML = html;

    // Phase 7 hook: hero strip subscribers
    AH.publish('product-analytics.overview', { data: d, range: resp.range });
  }

  function renderProducts(resp) {
    if (!productsEl) return;
    if (!resp || !resp.data || !Array.isArray(resp.data) || resp.data.length === 0) {
      productsEl.innerHTML = AH.emptyState({
        icon: 'cubes',
        title: 'No product breakdown yet',
        hint: 'Per-product user counts appear once events are ingested.'
      });
      return;
    }

    var html = '<div class="pa-section-title">Product Breakdown</div>';
    html += '<div class="pa-product-grid">';

    resp.data.forEach(function (p) {
      var color = PRODUCT_COLORS[p.product] || '#94a3b8';
      var icon = PRODUCT_ICONS[p.product] || 'fa-cube';
      html += '<div class="pa-product-card" style="border-left-color:' + color + ';">' +
        '<div class="pa-product-card__name"><i class="fas ' + icon + '" style="color:' + color + ';"></i> ' + AH.esc(p.product) + '</div>' +
        '<div class="pa-product-card__value">' + AH.fmtNum(p.users) + ' <span class="pa-product-card__unit">users</span></div>' +
        '<div class="pa-product-card__meta">' + AH.fmtNum(p.events) + ' events &middot; ' + AH.fmtNum(p.sessions) + ' sessions</div>' +
        '</div>';
    });

    html += '</div>';
    productsEl.innerHTML = html;
  }

  function renderFunnels(resp) {
    if (!funnelEl) return;
    if (!resp || !resp.data) {
      funnelEl.innerHTML = AH.emptyState({
        icon: 'filter',
        title: 'No funnel data yet',
        hint: 'Funnels appear once instrumented products record sequential events.'
      });
      return;
    }
    var funnels = resp.data;
    var keys = Object.keys(funnels);
    if (keys.length === 0) {
      funnelEl.innerHTML = AH.emptyState({
        icon: 'filter',
        title: 'No funnel data yet',
        hint: 'Funnels appear once instrumented products record sequential events.'
      });
      return;
    }

    var html = '<div class="pa-section-title">Funnel Analysis</div>';

    keys.forEach(function (product) {
      var steps = funnels[product];
      if (!steps || steps.length === 0) return;
      var maxUsers = steps[0].users || 1;
      var color = PRODUCT_COLORS[product] || '#60a5fa';

      html += '<div class="pa-funnel-group">';
      html += '<div class="pa-funnel-group__name">' + AH.esc(product) + '</div>';

      steps.forEach(function (step, idx) {
        var pct = maxUsers > 0 ? Math.round((step.users / maxUsers) * 100) : 0;
        var dropoff = idx > 0 && steps[idx - 1].users > 0
          ? ' (' + Math.round((1 - step.users / steps[idx - 1].users) * 100) + '% drop)'
          : '';

        html += '<div class="pa-funnel-row">' +
          '<div class="pa-funnel-row__label">' + AH.esc(step.step.replace(/_/g, ' ')) + '</div>' +
          '<div class="pa-funnel-row__bar-wrap">' +
          '<div class="pa-funnel-row__bar" style="width:' + Math.max(pct, 2) + '%;background:' + color + ';"></div></div>' +
          '<div class="pa-funnel-row__value">' + AH.fmtNum(step.users) + '<span class="pa-funnel-row__pct"> ' + pct + '%' + dropoff + '</span></div>' +
          '</div>';
      });

      html += '</div>';
    });

    funnelEl.innerHTML = html;
  }

  function renderEvents(resp) {
    if (!eventsEl) return;
    if (!resp || !resp.data || !Array.isArray(resp.data) || resp.data.length === 0) {
      eventsEl.innerHTML = AH.emptyState({
        icon: 'list',
        title: 'No events yet',
        hint: 'Top events appear once telemetry is flowing.'
      });
      return;
    }

    var html = '<div class="pa-section-title">Top Events</div>';
    html += '<table class="pa-events-table">';
    html += '<thead><tr><th>Product</th><th>Event</th><th style="text-align:right;">Count</th></tr></thead><tbody>';

    resp.data.slice(0, 20).forEach(function (e) {
      var color = PRODUCT_COLORS[e.product] || '#94a3b8';
      html += '<tr>' +
        '<td><span class="pa-events-dot" style="background:' + color + ';"></span>' + AH.esc(e.product) + '</td>' +
        '<td class="pa-events-name">' + AH.esc(e.event.replace(/_/g, ' ')) + '</td>' +
        '<td style="text-align:right;font-weight:600;">' + AH.fmtNum(e.count) + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    eventsEl.innerHTML = html;
  }

  // ─── Wiring ───────────────────────────────────────────────────
  if (productFilter) productFilter.addEventListener('change', _onFilterChange);
  if (rangeFilter)   rangeFilter.addEventListener('change',   _onFilterChange);
  if (refreshBtn)    refreshBtn.addEventListener('click',     _onFilterChange);

  // Lazy-load tabs on activation. Initial activation also fires this
  // (AHShared switchTab publishes 'tab-change' with source: 'init').
  AH.subscribe('tab-change', function (evt) {
    if (evt.zoneId !== ZONE_ID) return;
    _loadTab(evt.tabName);
  });

  // Always eager-load Overview on init so the hero strip's DAU subscriber
  // gets fed regardless of which tab is currently active. The loader's
  // synchronous _loaded.overview = true guard prevents a duplicate fetch
  // when the tab-change handler also fires loadOverview() for an active
  // Overview tab. Funnels / Events / Breakdown stay lazy.
  loadOverview();
})();
