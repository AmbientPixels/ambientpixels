// traffic-brief.js — Traffic Brief render module for the Analytics Hub.
// Phase 4a: extracted verbatim from the inline IIFE in analytics-hub.html.
// No behavior change. Refactor to use AHShared helpers + tab system lands
// in Phase 4b. See plan: iridescent-wiggling-tide.
(function () {
  var body = document.getElementById('sa-tb-body');
  if (!body) return;

  function _esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function _perfColor(ms) {
    if (ms == null || isNaN(ms)) return 'rgba(255,255,255,0.9)';
    if (ms < 1000) return '#34d399';
    if (ms <= 3000) return '#fbbf24';
    return '#ef4444';
  }

  function _kpiCard(label, value, color) {
    return '<div style="background:#2c2c2e;border-radius:10px;padding:12px;">'
      + '<div style="font-size:11px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;">' + _esc(label) + '</div>'
      + '<div style="font-size:22px;font-weight:700;letter-spacing:-0.03em;color:' + color + ';margin-top:2px;">' + _esc(value) + '</div>'
      + '</div>';
  }

  function _renderBarChart(title, icon, rows, keyField, valField) {
    rows = (rows || []).slice(0, 5);
    var header = '<div style="font-size:0.62rem;font-weight:600;opacity:0.5;margin-bottom:0.4rem;"><i class="fas fa-' + icon + '" style="margin-right:4px;"></i>' + _esc(title) + '</div>';
    if (rows.length === 0) return header + '<div style="font-size:0.6rem;opacity:0.25;">No data</div>';
    var maxVal = Math.max.apply(null, rows.map(function (r) { return r[valField] || 0; }));
    var h = header;
    rows.forEach(function (r) {
      var val = r[valField] || 0;
      var pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
      var label = r[keyField] || '—';
      h += '<div style="display:flex;align-items:center;gap:6px;padding:0.2rem 0;font-size:0.6rem;">'
        + '<span style="flex:0 0 90px;opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + _esc(label) + '">' + _esc(label) + '</span>'
        + '<div style="flex:1;height:6px;background:rgba(255,255,255,0.04);border-radius:3px;overflow:hidden;">'
        + '<div style="width:' + pct + '%;height:100%;background:#5ac8fa;border-radius:3px;transition:width 0.3s;"></div>'
        + '</div>'
        + '<span style="flex:0 0 40px;text-align:right;font-weight:600;color:#5ac8fa;">' + val.toLocaleString() + '</span>'
        + '</div>';
    });
    return h;
  }

  function _renderTimeline(dailyViews) {
    if (!dailyViews || dailyViews.length < 2) return;
    var canvas = document.getElementById('sa-tb-timeline');
    if (!canvas) return;
    if (window._tbLineChart) { window._tbLineChart.destroy(); window._tbLineChart = null; }
    var ctx = canvas.getContext('2d');
    var grad = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.offsetHeight || 120);
    grad.addColorStop(0, 'rgba(90,200,250,0.2)');
    grad.addColorStop(1, 'rgba(90,200,250,0.02)');
    var labels = dailyViews.map(function (d) { return d.day ? d.day.slice(5) : ''; });
    var values = dailyViews.map(function (d) { return d.views || 0; });
    window._tbLineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          borderColor: '#5ac8fa',
          backgroundColor: grad,
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 4,
          pointBackgroundColor: '#5ac8fa'
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
              label: function (ctx) { return ' ' + ctx.parsed.y.toLocaleString() + ' views'; }
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
  }

  function _render(data) {
    if (data.warning && data.warning.indexOf('telemetry_unavailable') === 0) {
      body.innerHTML = '<div style="font-size:0.62rem;padding:0.5rem;border:1px solid rgba(251,191,36,0.2);border-radius:6px;background:rgba(251,191,36,0.04);color:#fbbf24;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i>' + _esc(data.warning) + '</div>';
      return;
    }
    var hasData = (data.topPages && data.topPages.length > 0) || (data.topReferrers && data.topReferrers.length > 0) || (data.dailyViews && data.dailyViews.length > 0);
    if (!hasData) {
      body.innerHTML = '<div style="font-size:0.62rem;padding:0.5rem;opacity:0.4;">No traffic data available.</div>';
      return;
    }
    var totalViews = 0;
    if (data.topPages) data.topPages.forEach(function (p) { totalViews += (p.views || 0); });

    var p50 = data.performance ? data.performance.pageLoadMs_p50 : null;
    var p95 = data.performance ? data.performance.pageLoadMs_p95 : null;

    var html = '<div class="sa-tb-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;">';
    html += _kpiCard('Page Views', totalViews.toLocaleString(), '#5ac8fa');
    html += _kpiCard('P50 Load', p50 != null ? p50 + 'ms' : '—', _perfColor(p50));
    html += _kpiCard('P95 Load', p95 != null ? p95 + 'ms' : '—', _perfColor(p95));
    html += '</div>';

    if (data.dailyViews && data.dailyViews.length >= 2) {
      html += '<div style="position:relative;height:120px;margin-bottom:12px;"><canvas id="sa-tb-timeline" height="120"></canvas></div>';
    }

    html += '<div class="sa-tb-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">';
    var dispPages = (data.topPages || []).map(function (p) { return { label: p.pageTitle || p.path || '/', views: p.views }; });
    html += '<div>' + _renderBarChart('Top Pages', 'file-alt', dispPages, 'label', 'views') + '</div>';
    html += '<div>' + _renderBarChart('Top Referrers', 'external-link-alt', data.topReferrers, 'referrer', 'sessions') + '</div>';
    html += '<div>' + _renderBarChart('Top Campaigns', 'bullhorn', data.topCampaigns, 'campaign', 'sessions') + '</div>';
    html += '</div>';
    body.innerHTML = html;

    // Render chart after DOM is updated
    if (data.dailyViews && data.dailyViews.length >= 2) {
      _renderTimeline(data.dailyViews);
    }
  }

  function _fetch() {
    var range = document.getElementById('sa-tb-range');
    var rangeVal = range ? range.value : '7d';
    body.innerHTML = '<div style="opacity:0.3;padding:1rem;text-align:center;font-size:0.7rem;">Loading...</div>';
    var apiBase = window.location.hostname.includes('ambientpixels.ai') ? 'https://ambientpixels-nova-api.azurewebsites.net' : '';
    fetch(apiBase + '/api/telemetry/summary?range=' + rangeVal)
      .then(function (r) { return r.json(); })
      .then(function (data) { _render(data); })
      .catch(function (err) {
        body.innerHTML = '<div style="font-size:0.62rem;padding:0.5rem;color:#fbbf24;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i>' + _esc(err.message || 'fetch error') + '</div>';
      });
  }

  _fetch();
  var refreshBtn = document.getElementById('sa-tb-refresh');
  var rangeEl = document.getElementById('sa-tb-range');
  if (refreshBtn) refreshBtn.addEventListener('click', _fetch);
  if (rangeEl) rangeEl.addEventListener('change', _fetch);
})();
