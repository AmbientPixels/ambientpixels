// product-analytics-dashboard.js — Product Analytics section for Analytics Hub
// Fetches from /api/productAnalyticsQuery and renders KPIs, product breakdown, funnels, top events.
(function () {
  'use strict';

  var API = 'https://ambientpixels-nova-api.azurewebsites.net/api/productAnalyticsQuery';
  var SECRET = 'pixelpusher';

  var kpisEl = document.getElementById('pa-kpis');
  var productsEl = document.getElementById('pa-products');
  var funnelEl = document.getElementById('pa-funnel');
  var eventsEl = document.getElementById('pa-events');
  var productFilter = document.getElementById('pa-product-filter');
  var rangeFilter = document.getElementById('pa-range-filter');
  var refreshBtn = document.getElementById('pa-refresh');

  if (!kpisEl) return;

  var PRODUCT_COLORS = {
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
    ambientscore: 'fa-chart-line',
    blindspot: 'fa-crosshairs',
    cardforge: 'fa-layer-group',
    storyforge: 'fa-book-open',
    blog: 'fa-rss',
    tileforge: 'fa-th-large',
    nova: 'fa-star',
    dashboard: 'fa-gauge'
  };

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function kpiCard(label, value, sub, icon) {
    return '<div class="pa-kpi">' +
      '<div class="pa-kpi__value">' + (icon ? '<i class="fas ' + icon + ' pa-kpi__icon"></i> ' : '') + esc(String(value)) + '</div>' +
      '<div class="pa-kpi__label">' + esc(label) + '</div>' +
      (sub ? '<div class="pa-kpi__sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function loadAll() {
    var product = productFilter ? productFilter.value : 'all';
    var range = rangeFilter ? rangeFilter.value : '7d';

    kpisEl.innerHTML = '<div class="pa-loading">Loading analytics...</div>';
    if (productsEl) productsEl.innerHTML = '';
    if (funnelEl) funnelEl.innerHTML = '';
    if (eventsEl) eventsEl.innerHTML = '';

    var headers = { 'x-company-secret': SECRET };

    Promise.all([
      fetch(API + '?range=' + range + '&product=' + product + '&metric=overview', { headers: headers }).then(function (r) { return r.json(); }),
      fetch(API + '?range=' + range + '&metric=products', { headers: headers }).then(function (r) { return r.json(); }),
      fetch(API + '?range=' + range + '&product=' + product + '&metric=funnels', { headers: headers }).then(function (r) { return r.json(); }),
      fetch(API + '?range=' + range + '&product=' + product + '&metric=events', { headers: headers }).then(function (r) { return r.json(); })
    ]).then(function (results) {
      renderOverview(results[0]);
      renderProducts(results[1]);
      renderFunnels(results[2]);
      renderEvents(results[3]);
    }).catch(function (err) {
      kpisEl.innerHTML = '<div class="pa-error">Failed to load analytics: ' + esc(err.message) + '</div>';
    });
  }

  function renderOverview(resp) {
    if (!resp || !resp.data) {
      kpisEl.innerHTML = '<div class="pa-empty">No data yet. Events will appear after users visit instrumented pages.</div>';
      return;
    }
    var d = resp.data;
    var dailyArr = d.daily || [];
    var todayDau = dailyArr.length > 0 ? dailyArr[dailyArr.length - 1].dau : 0;
    var avgDau = dailyArr.length > 0 ? Math.round(dailyArr.reduce(function (s, x) { return s + x.dau; }, 0) / dailyArr.length) : 0;

    kpisEl.innerHTML =
      kpiCard('Total Events', d.totalEvents || 0, resp.range, 'fa-bolt') +
      kpiCard('Unique Users', d.uniqueUsers || 0, resp.range, 'fa-users') +
      kpiCard('Today DAU', todayDau, '', 'fa-calendar-day') +
      kpiCard('Avg DAU', avgDau, resp.range, 'fa-chart-simple');

    // Sparkline
    if (dailyArr.length > 1) {
      var maxDau = Math.max.apply(null, dailyArr.map(function (x) { return x.dau; })) || 1;
      var width = 300;
      var height = 50;
      var step = width / (dailyArr.length - 1);
      var points = dailyArr.map(function (x, i) {
        return (i * step).toFixed(1) + ',' + (height - 4 - (x.dau / maxDau) * (height - 8)).toFixed(1);
      }).join(' ');

      kpisEl.innerHTML += '<div class="pa-sparkline">' +
        '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
        '<polyline points="' + points + '" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<div class="pa-sparkline__labels">' +
        '<span>' + esc(dailyArr[0].day) + '</span><span>' + esc(dailyArr[dailyArr.length - 1].day) + '</span></div></div>';
    }
  }

  function renderProducts(resp) {
    if (!productsEl || !resp || !resp.data || !Array.isArray(resp.data) || resp.data.length === 0) return;

    var html = '<div class="pa-section-title">Product Breakdown</div>';
    html += '<div class="pa-product-grid">';

    resp.data.forEach(function (p) {
      var color = PRODUCT_COLORS[p.product] || '#94a3b8';
      var icon = PRODUCT_ICONS[p.product] || 'fa-cube';
      html += '<div class="pa-product-card" style="border-left-color:' + color + ';">' +
        '<div class="pa-product-card__name"><i class="fas ' + icon + '" style="color:' + color + ';"></i> ' + esc(p.product) + '</div>' +
        '<div class="pa-product-card__value">' + p.users + ' <span class="pa-product-card__unit">users</span></div>' +
        '<div class="pa-product-card__meta">' + p.events + ' events &middot; ' + p.sessions + ' sessions</div>' +
        '</div>';
    });

    html += '</div>';
    productsEl.innerHTML = html;
  }

  function renderFunnels(resp) {
    if (!funnelEl || !resp || !resp.data) return;
    var funnels = resp.data;
    var keys = Object.keys(funnels);
    if (keys.length === 0) return;

    var html = '<div class="pa-section-title">Funnel Analysis</div>';

    keys.forEach(function (product) {
      var steps = funnels[product];
      if (!steps || steps.length === 0) return;
      var maxUsers = steps[0].users || 1;
      var color = PRODUCT_COLORS[product] || '#60a5fa';

      html += '<div class="pa-funnel-group">';
      html += '<div class="pa-funnel-group__name">' + esc(product) + '</div>';

      steps.forEach(function (step, idx) {
        var pct = maxUsers > 0 ? Math.round((step.users / maxUsers) * 100) : 0;
        var dropoff = idx > 0 && steps[idx - 1].users > 0
          ? ' (' + Math.round((1 - step.users / steps[idx - 1].users) * 100) + '% drop)'
          : '';

        html += '<div class="pa-funnel-row">' +
          '<div class="pa-funnel-row__label">' + esc(step.step.replace(/_/g, ' ')) + '</div>' +
          '<div class="pa-funnel-row__bar-wrap">' +
          '<div class="pa-funnel-row__bar" style="width:' + Math.max(pct, 2) + '%;background:' + color + ';"></div></div>' +
          '<div class="pa-funnel-row__value">' + step.users + '<span class="pa-funnel-row__pct"> ' + pct + '%' + dropoff + '</span></div>' +
          '</div>';
      });

      html += '</div>';
    });

    funnelEl.innerHTML = html;
  }

  function renderEvents(resp) {
    if (!eventsEl || !resp || !resp.data || !Array.isArray(resp.data) || resp.data.length === 0) return;

    var html = '<div class="pa-section-title">Top Events</div>';
    html += '<table class="pa-events-table">';
    html += '<thead><tr><th>Product</th><th>Event</th><th style="text-align:right;">Count</th></tr></thead><tbody>';

    resp.data.slice(0, 20).forEach(function (e) {
      var color = PRODUCT_COLORS[e.product] || '#94a3b8';
      html += '<tr>' +
        '<td><span class="pa-events-dot" style="background:' + color + ';"></span>' + esc(e.product) + '</td>' +
        '<td class="pa-events-name">' + esc(e.event.replace(/_/g, ' ')) + '</td>' +
        '<td style="text-align:right;font-weight:600;">' + e.count + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    eventsEl.innerHTML = html;
  }

  // Wire up controls
  if (productFilter) productFilter.addEventListener('change', loadAll);
  if (rangeFilter) rangeFilter.addEventListener('change', loadAll);
  if (refreshBtn) refreshBtn.addEventListener('click', loadAll);

  // Initial load
  loadAll();
})();
