// product-analytics-dashboard.js — Product Analytics section for Analytics Hub
// Fetches from /api/product-analytics-query and renders KPIs, product breakdown, funnels, top events.
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

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function kpiCard(label, value, sub) {
    return '<div style="border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.015);border-radius:8px;padding:0.5rem 0.6rem;">' +
      '<div style="font-size:1.1rem;font-weight:700;">' + esc(String(value)) + '</div>' +
      '<div style="font-size:0.48rem;opacity:0.4;margin-top:0.1rem;">' + esc(label) + '</div>' +
      (sub ? '<div style="font-size:0.42rem;opacity:0.3;margin-top:0.05rem;">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function loadAll() {
    var product = productFilter ? productFilter.value : 'all';
    var range = rangeFilter ? rangeFilter.value : '7d';

    kpisEl.innerHTML = '<div style="opacity:0.3;padding:1rem;text-align:center;font-size:0.7rem;grid-column:1/-1;">Loading...</div>';
    if (productsEl) productsEl.innerHTML = '';
    if (funnelEl) funnelEl.innerHTML = '';
    if (eventsEl) eventsEl.innerHTML = '';

    var headers = { 'x-company-secret': SECRET };

    // Fetch overview + products + funnels + events in parallel
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
      kpisEl.innerHTML = '<div style="opacity:0.4;padding:1rem;text-align:center;font-size:0.65rem;grid-column:1/-1;color:#f87171;">Failed to load analytics: ' + esc(err.message) + '</div>';
    });
  }

  function renderOverview(resp) {
    if (!resp || !resp.data) {
      kpisEl.innerHTML = '<div style="opacity:0.3;padding:0.5rem;font-size:0.6rem;grid-column:1/-1;">No data yet. Events will appear after users visit instrumented pages.</div>';
      return;
    }
    var d = resp.data;
    var dailyArr = d.daily || [];
    var todayDau = dailyArr.length > 0 ? dailyArr[dailyArr.length - 1].dau : 0;
    var avgDau = dailyArr.length > 0 ? Math.round(dailyArr.reduce(function (s, x) { return s + x.dau; }, 0) / dailyArr.length) : 0;

    kpisEl.innerHTML =
      kpiCard('Total Events', d.totalEvents || 0, resp.range) +
      kpiCard('Unique Users', d.uniqueUsers || 0, resp.range) +
      kpiCard('Today DAU', todayDau) +
      kpiCard('Avg DAU', avgDau, resp.range);

    // Mini sparkline from daily data
    if (dailyArr.length > 1) {
      var maxDau = Math.max.apply(null, dailyArr.map(function (x) { return x.dau; })) || 1;
      var width = 200;
      var height = 40;
      var step = width / (dailyArr.length - 1);
      var points = dailyArr.map(function (x, i) {
        return (i * step).toFixed(1) + ',' + (height - (x.dau / maxDau) * (height - 4)).toFixed(1);
      }).join(' ');

      kpisEl.innerHTML += '<div style="grid-column:1/-1;margin-top:0.2rem;">' +
        '<svg viewBox="0 0 ' + width + ' ' + height + '" style="width:100%;height:40px;display:block;">' +
        '<polyline points="' + points + '" fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<div style="display:flex;justify-content:space-between;font-size:0.4rem;opacity:0.3;padding:0 2px;">' +
        '<span>' + esc(dailyArr[0].day) + '</span><span>' + esc(dailyArr[dailyArr.length - 1].day) + '</span></div></div>';
    }
  }

  function renderProducts(resp) {
    if (!productsEl || !resp || !resp.data || !Array.isArray(resp.data) || resp.data.length === 0) return;

    var html = '<div style="font-size:0.55rem;opacity:0.4;margin-bottom:0.3rem;">Product Breakdown</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.3rem;">';

    resp.data.forEach(function (p) {
      var color = PRODUCT_COLORS[p.product] || '#94a3b8';
      html += '<div style="border:1px solid rgba(255,255,255,0.06);border-left:3px solid ' + color + ';border-radius:6px;padding:0.35rem 0.45rem;background:rgba(255,255,255,0.012);">' +
        '<div style="font-size:0.5rem;opacity:0.45;text-transform:uppercase;letter-spacing:0.03em;">' + esc(p.product) + '</div>' +
        '<div style="font-size:0.85rem;font-weight:700;">' + p.users + ' <span style="font-size:0.45rem;opacity:0.4;font-weight:400;">users</span></div>' +
        '<div style="font-size:0.45rem;opacity:0.35;">' + p.events + ' events · ' + p.sessions + ' sessions</div>' +
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

    var html = '<div style="font-size:0.55rem;opacity:0.4;margin-bottom:0.3rem;">Funnel Analysis</div>';

    keys.forEach(function (product) {
      var steps = funnels[product];
      if (!steps || steps.length === 0) return;
      var maxUsers = steps[0].users || 1;

      html += '<div style="margin-bottom:0.5rem;">';
      html += '<div style="font-size:0.48rem;opacity:0.5;margin-bottom:0.2rem;text-transform:uppercase;">' + esc(product) + '</div>';

      steps.forEach(function (step) {
        var pct = maxUsers > 0 ? Math.round((step.users / maxUsers) * 100) : 0;
        var color = PRODUCT_COLORS[product] || '#60a5fa';
        html += '<div style="display:flex;align-items:center;gap:0.3rem;margin-bottom:0.12rem;">' +
          '<div style="width:90px;font-size:0.45rem;opacity:0.5;text-align:right;">' + esc(step.step) + '</div>' +
          '<div style="flex:1;height:14px;background:rgba(255,255,255,0.04);border-radius:3px;overflow:hidden;">' +
          '<div style="height:100%;width:' + pct + '%;background:' + color + ';opacity:0.6;border-radius:3px;min-width:2px;"></div></div>' +
          '<div style="width:40px;font-size:0.45rem;opacity:0.5;">' + step.users + ' (' + pct + '%)</div>' +
          '</div>';
      });

      html += '</div>';
    });

    funnelEl.innerHTML = html;
  }

  function renderEvents(resp) {
    if (!eventsEl || !resp || !resp.data || !Array.isArray(resp.data) || resp.data.length === 0) return;

    var html = '<div style="font-size:0.55rem;opacity:0.4;margin-bottom:0.3rem;">Top Events</div>';
    html += '<table style="width:100%;font-size:0.55rem;border-collapse:collapse;">';
    html += '<thead><tr style="opacity:0.4;"><th style="text-align:left;padding:0.2rem 0.3rem;">Product</th><th style="text-align:left;padding:0.2rem 0.3rem;">Event</th><th style="text-align:right;padding:0.2rem 0.3rem;">Count</th></tr></thead><tbody>';

    resp.data.slice(0, 20).forEach(function (e) {
      var color = PRODUCT_COLORS[e.product] || '#94a3b8';
      html += '<tr style="border-top:1px solid rgba(255,255,255,0.04);">' +
        '<td style="padding:0.15rem 0.3rem;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + color + ';margin-right:0.25rem;"></span>' + esc(e.product) + '</td>' +
        '<td style="padding:0.15rem 0.3rem;opacity:0.7;">' + esc(e.event) + '</td>' +
        '<td style="padding:0.15rem 0.3rem;text-align:right;font-weight:600;">' + e.count + '</td>' +
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
