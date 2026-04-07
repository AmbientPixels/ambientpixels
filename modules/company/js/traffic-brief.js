// traffic-brief.js — Traffic Brief render module for the Analytics Hub.
// Phase 4b: refactored to use AHShared helpers and .ah-tb-* CSS classes
// instead of inline styles. Subscribes to AHShared 'tab-change' so the
// Chart.js timeline re-renders when the Overview panel becomes visible
// (fixes the case where a user has 'About' saved as their last active
// tab — canvas would otherwise have 0 dimensions inside display:none).
// See plan: iridescent-wiggling-tide.
(function () {
  'use strict';
  if (!window.AHShared) {
    console.warn('[traffic-brief] AHShared not loaded — aborting');
    return;
  }
  var body = document.getElementById('sa-tb-body');
  if (!body) return;

  var AH = window.AHShared;
  var _lastData = null;
  var _chartRendered = false;

  // ─── Bar chart row builder (uses .ah-tb-bar-* CSS classes) ───
  function _renderBarChart(title, icon, rows, keyField, valField, opts) {
    opts = opts || {};
    rows = (rows || []).slice(0, 5);
    var header = '<div class="ah-tb-bar-chart__title">'
      + '<i class="fas fa-' + AH.esc(icon) + '"></i>' + AH.esc(title) + '</div>';
    if (rows.length === 0) {
      // Empty Campaigns gets an actionable hint instead of a dead "No data".
      if (opts.emptyHint) {
        return header + '<div class="ah-tb-bar-hint">' + opts.emptyHint + '</div>';
      }
      return header + '<div class="ah-tb-bar-empty">No data</div>';
    }
    var maxVal = Math.max.apply(null, rows.map(function (r) { return r[valField] || 0; }));
    var html = header;
    rows.forEach(function (r) {
      var val = r[valField] || 0;
      var pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
      var label = r[keyField] || '—';
      html += '<div class="ah-tb-bar-row">'
        + '<span class="ah-tb-bar-label" title="' + AH.esc(label) + '">' + AH.esc(label) + '</span>'
        + '<div class="ah-tb-bar-track"><div class="ah-tb-bar-fill" style="width:' + pct + '%"></div></div>'
        + '<span class="ah-tb-bar-value">' + val.toLocaleString() + '</span>'
        + '</div>';
    });
    return html;
  }

  // ─── Render the timeline if the canvas is currently visible ───
  function _tryRenderTimeline() {
    if (!_lastData || !_lastData.dailyViews || _lastData.dailyViews.length < 2) return;
    var canvas = document.getElementById('sa-tb-timeline');
    if (!canvas) return;
    // Bail if the canvas is inside a display:none panel — we'll re-try on
    // tab-change. offsetHeight === 0 is the cheapest visibility check.
    if (canvas.offsetHeight === 0) return;
    AH.makeTimeline(canvas, { data: _lastData.dailyViews, valueLabel: 'views' });
    _chartRendered = true;
  }

  // ─── Top-level render: KPIs + timeline + 3 bar charts ───
  function _render(data) {
    _lastData = data;
    _chartRendered = false;

    if (data.warning && data.warning.indexOf('telemetry_unavailable') === 0) {
      body.innerHTML = '<div class="ah-warning">'
        + '<i class="fas fa-exclamation-triangle"></i>' + AH.esc(data.warning)
        + '</div>';
      return;
    }
    var hasData = (data.topPages && data.topPages.length > 0)
      || (data.topReferrers && data.topReferrers.length > 0)
      || (data.dailyViews && data.dailyViews.length > 0);
    if (!hasData) {
      body.innerHTML = AH.emptyState({
        icon: 'chart-line',
        title: 'No traffic data yet',
        hint: 'Telemetry is connected and collecting. Check back in a few hours.'
      });
      return;
    }

    var totalViews = 0;
    if (data.topPages) {
      data.topPages.forEach(function (p) { totalViews += (p.views || 0); });
    }
    var p50 = data.performance ? data.performance.pageLoadMs_p50 : null;
    var p95 = data.performance ? data.performance.pageLoadMs_p95 : null;
    var p50Tone = (p50 == null) ? null : (p50 < 1000 ? 'good' : (p50 <= 3000 ? 'warn' : 'bad'));
    var p95Tone = (p95 == null) ? null : (p95 < 1000 ? 'good' : (p95 <= 3000 ? 'warn' : 'bad'));

    var html = '<div class="ah-kpi-grid">';
    html += AH.kpiCard({ icon: 'eye',             label: 'Page Views', value: totalViews.toLocaleString() });
    html += AH.kpiCard({ icon: 'tachometer-alt',  label: 'P50 Load',   value: p50 != null ? p50 + 'ms' : '—', tone: p50Tone });
    html += AH.kpiCard({ icon: 'tachometer-alt',  label: 'P95 Load',   value: p95 != null ? p95 + 'ms' : '—', tone: p95Tone });
    html += '</div>';

    if (data.dailyViews && data.dailyViews.length >= 2) {
      html += '<div class="ah-tb-timeline"><canvas id="sa-tb-timeline" height="130"></canvas></div>';
    }

    html += '<div class="ah-tb-grid">';
    var dispPages = (data.topPages || []).map(function (p) {
      return { label: p.pageTitle || p.path || '/', views: p.views };
    });
    html += '<div>' + _renderBarChart('Top Pages', 'file-alt', dispPages, 'label', 'views') + '</div>';
    html += '<div>' + _renderBarChart('Top Referrers', 'external-link-alt', data.topReferrers, 'referrer', 'sessions') + '</div>';
    html += '<div>' + _renderBarChart('Top Campaigns', 'bullhorn', data.topCampaigns, 'campaign', 'sessions', {
      emptyHint: 'No UTM-tagged traffic in window. Add <code>?utm_source=...&amp;utm_campaign=...</code> to social and email links to start tracking.'
    }) + '</div>';
    html += '</div>';

    body.innerHTML = html;
    _tryRenderTimeline();
  }

  function _fetch() {
    var range = document.getElementById('sa-tb-range');
    var rangeVal = range ? range.value : '7d';
    body.innerHTML = '<div class="ah-loading">Loading traffic data\u2026</div>';
    AH.fetchJSON('/api/telemetry/summary?range=' + rangeVal)
      .then(function (data) { _render(data); })
      .catch(function (err) {
        body.innerHTML = '<div class="ah-warning">'
          + '<i class="fas fa-exclamation-triangle"></i>' + AH.esc(err.message || 'fetch error')
          + '</div>';
      });
  }

  // Re-render the timeline when the user (or initial activation) makes the
  // Overview panel visible. Without this, the chart silently fails when a
  // saved 'about' tab is restored on page load.
  AH.subscribe('tab-change', function (evt) {
    if (evt.zoneId !== 'ah-zone-traffic') return;
    if (evt.tabName !== 'overview') return;
    if (_chartRendered) return;
    // Defer one tick so the panel's display:block has applied
    setTimeout(_tryRenderTimeline, 0);
  });

  _fetch();
  var refreshBtn = document.getElementById('sa-tb-refresh');
  var rangeEl = document.getElementById('sa-tb-range');
  if (refreshBtn) refreshBtn.addEventListener('click', _fetch);
  if (rangeEl) rangeEl.addEventListener('change', _fetch);
})();
