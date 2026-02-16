// observability-ui.js — Observability Dashboard v1: Rendering engine
// Renders KPI cards, sparklines, breakdowns, recent events into a container.
// No external libraries. All IDs prefixed obs-*.

var ObservabilityUI = (function () {
  'use strict';

  var _container = null;
  var _currentDays = 7;
  var _debounce = null;

  // ── Helpers ──
  function _esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function _pct(v) { return v != null ? Math.round(v * 100) + '%' : 'n/a'; }
  function _num(v) { return v != null ? v.toLocaleString() : 'n/a'; }
  function _mins(v) { return v != null ? Math.round(v) + 'm' : 'n/a'; }
  function _bytes(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function _kpiColor(val, goodThresh, badThresh) {
    if (val == null) return '#94a3b8';
    if (goodThresh != null && val >= goodThresh) return '#34d399';
    if (badThresh != null && val < badThresh) return '#ef4444';
    return '#fbbf24';
  }
  function _timeAgo(ts) {
    if (!ts) return '';
    try {
      var d = new Date(ts);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  // ═══════════════════════════════════════════════════
  // ── init — call once with a container element ──
  // ═══════════════════════════════════════════════════
  function init(containerEl) {
    _container = containerEl;
    if (!_container) return;
    render();
  }

  // ═══════════════════════════════════════════════════
  // ── render — full rebuild ──
  // ═══════════════════════════════════════════════════
  function render() {
    if (!_container) return;
    var data = ObservabilityMetrics.compute({ days: _currentDays });
    var html = '';

    // ── Controls ──
    html += '<div class="obs-controls">';
    html += '<div class="obs-toggle" id="obs-days-toggle">';
    html += '<button class="obs-toggle-btn' + (_currentDays === 7 ? ' active' : '') + '" data-days="7">7 days</button>';
    html += '<button class="obs-toggle-btn' + (_currentDays === 30 ? ' active' : '') + '" data-days="30">30 days</button>';
    html += '</div>';
    html += '<div class="obs-controls-right">';
    html += '<button class="obs-btn obs-btn--refresh" id="obs-refresh"><i class="fas fa-sync-alt"></i> Refresh</button>';
    if (typeof StorageManager !== 'undefined') {
      html += '<button class="obs-btn obs-btn--export" id="obs-export"><i class="fas fa-download"></i> Export</button>';
    }
    html += '</div>';
    html += '</div>';

    // ── Section A: Executive KPIs ──
    html += '<div class="obs-section-title">Executive KPIs <span class="obs-range-label">(' + _currentDays + 'd)</span></div>';
    html += _renderKpiGrid(data.kpis);

    // ── Section B: Trends ──
    html += '<div class="obs-section-title">Trends</div>';
    html += _renderTrends(data.byDay);

    // ── Section C: Top Drivers ──
    html += '<div class="obs-section-title">Top Drivers</div>';
    html += _renderDrivers(data.breakdowns);

    // ── Section D: Recent Events ──
    html += '<div class="obs-section-title">Recent Events</div>';
    html += _renderRecent(data.recent);

    // ── Section E: Storage Health ──
    html += '<div class="obs-section-title">Storage</div>';
    html += _renderStorage(data.kpis.storage);

    _container.innerHTML = html;
    _bindEvents();
  }

  // ═══════════════════════════════════════════════════
  // ── KPI Grid ──
  // ═══════════════════════════════════════════════════
  function _renderKpiGrid(kpis) {
    var cards = [
      { label: 'Approval Rate', value: _pct(kpis.approvals.approvalRate), sub: kpis.approvals.approved + ' / ' + (kpis.approvals.approved + kpis.approvals.rejected), color: _kpiColor(kpis.approvals.approvalRate, 0.7, 0.5) },
      { label: 'Success Rate', value: _pct(kpis.execution.successRate), sub: kpis.execution.succeeded + ' ok / ' + kpis.execution.failed + ' fail', color: _kpiColor(kpis.execution.successRate, 0.8, 0.6) },
      { label: 'Crit Resolution', value: _pct(kpis.priority.criticalResolutionRate), sub: kpis.priority.criticalResolved + ' resolved / ' + kpis.priority.criticalNow + ' current', color: _kpiColor(kpis.priority.criticalResolutionRate, 0.5, 0.2) },
      { label: 'Avg Approval Time', value: _mins(kpis.timeToApprovalMin.avg), sub: 'p50: ' + _mins(kpis.timeToApprovalMin.p50) + ' · p90: ' + _mins(kpis.timeToApprovalMin.p90), color: '#60a5fa' },
      { label: 'Queue Pending', value: _num(kpis.queue.pending), sub: kpis.queue.approvedReady + ' ready · ' + kpis.queue.executing + ' exec · ' + kpis.queue.blocked + ' blocked', color: kpis.queue.pending > 10 ? '#fbbf24' : '#34d399' },
      { label: 'Blocked Done', value: _num(kpis.verification.blockedDoneCount), sub: 'verification friction', color: kpis.verification.blockedDoneCount > 5 ? '#ef4444' : '#34d399' },
      { label: 'Critical / High', value: kpis.priority.criticalNow + ' / ' + kpis.priority.highNow, sub: 'current priority counts', color: kpis.priority.criticalNow > 3 ? '#ef4444' : '#fbbf24' },
      { label: 'Worker Activity', value: _num(kpis.workers.runs), sub: kpis.workers.spawned + ' spawned · ' + kpis.workers.terminated + ' terminated', color: '#a78bfa' },
      { label: 'Planner Runs', value: _num(kpis.planner.runs), sub: kpis.planner.recsEnqueued + ' recs enqueued', color: '#c084fc' },
      { label: 'Calibration', value: _num(kpis.calibration.runs), sub: kpis.calibration.proposalsEnqueued + ' proposals', color: '#34d399' }
    ];

    var h = '<div class="obs-kpi-grid">';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      h += '<div class="obs-kpi-card">';
      h += '<div class="obs-kpi-label">' + _esc(c.label) + '</div>';
      h += '<div class="obs-kpi-value" style="color:' + c.color + ';">' + _esc(c.value) + '</div>';
      h += '<div class="obs-kpi-sub">' + _esc(c.sub) + '</div>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ═══════════════════════════════════════════════════
  // ── Sparkline Trends ──
  // ═══════════════════════════════════════════════════
  function _renderTrends(byDay) {
    if (!byDay || byDay.length === 0) return '<div class="obs-empty">No trend data in this range.</div>';

    var charts = [
      { title: 'Approvals / day', series: [{ key: 'approved', color: '#34d399' }, { key: 'rejected', color: '#ef4444' }] },
      { title: 'Execution / day', series: [{ key: 'succeeded', color: '#60a5fa' }, { key: 'failed', color: '#ef4444' }] },
      { title: 'Critical tasks / day', series: [{ key: 'criticalNow', color: '#f87171' }] },
      { title: 'Blocked Done / day', series: [{ key: 'blockedDone', color: '#fbbf24' }] },
      { title: 'Worker runs / day', series: [{ key: 'workerRuns', color: '#a78bfa' }] }
    ];

    var h = '<div class="obs-trends-grid">';
    for (var c = 0; c < charts.length; c++) {
      h += _renderSparkChart(charts[c].title, charts[c].series, byDay);
    }
    h += '</div>';
    return h;
  }

  function _renderSparkChart(title, series, byDay) {
    // Find max across all series for scaling
    var max = 1;
    for (var s = 0; s < series.length; s++) {
      for (var d = 0; d < byDay.length; d++) {
        var v = byDay[d][series[s].key] || 0;
        if (v > max) max = v;
      }
    }

    var h = '<div class="obs-spark-chart">';
    h += '<div class="obs-spark-title">' + _esc(title) + '</div>';
    h += '<div class="obs-spark-row">';

    for (var i = 0; i < byDay.length; i++) {
      var dayLabel = byDay[i].day.substring(5); // MM-DD
      h += '<div class="obs-spark-col" title="' + _esc(byDay[i].day) + '">';
      // Stack bars for each series
      for (var j = 0; j < series.length; j++) {
        var val = byDay[j] ? (byDay[i][series[j].key] || 0) : 0;
        var pct = Math.max(2, Math.round((val / max) * 100));
        h += '<div class="obs-spark-bar" style="height:' + pct + '%;background:' + series[j].color + ';" title="' + series[j].key + ': ' + val + '"></div>';
      }
      h += '<div class="obs-spark-label">' + dayLabel + '</div>';
      h += '</div>';
    }

    h += '</div></div>';
    return h;
  }

  // ═══════════════════════════════════════════════════
  // ── Drivers (breakdowns) ──
  // ═══════════════════════════════════════════════════
  function _renderDrivers(bd) {
    var h = '<div class="obs-drivers-grid">';

    // Top reject reasons
    h += '<div class="obs-driver-panel">';
    h += '<div class="obs-driver-title"><i class="fas fa-ban" style="color:#ef4444;opacity:0.5;"></i> Top Reject Reasons</div>';
    if (bd.topRejectReasons.length === 0) {
      h += '<div class="obs-empty">No rejections recorded.</div>';
    } else {
      for (var i = 0; i < bd.topRejectReasons.length; i++) {
        var r = bd.topRejectReasons[i];
        h += '<div class="obs-driver-row"><span class="obs-driver-reason">' + _esc(r.reason) + '</span><span class="obs-driver-count">' + r.count + '</span></div>';
      }
    }
    h += '</div>';

    // Action success by type
    h += '<div class="obs-driver-panel">';
    h += '<div class="obs-driver-title"><i class="fas fa-bolt" style="color:#60a5fa;opacity:0.5;"></i> Action Success by Type</div>';
    var types = Object.keys(bd.actionsByType);
    if (types.length === 0) {
      h += '<div class="obs-empty">No execution data.</div>';
    } else {
      h += '<div class="obs-driver-table"><div class="obs-driver-table-head"><span>Type</span><span>OK</span><span>Fail</span><span>Rate</span></div>';
      for (var j = 0; j < types.length; j++) {
        var t = bd.actionsByType[types[j]];
        var total = t.succeeded + t.failed;
        var rate = total > 0 ? Math.round((t.succeeded / total) * 100) + '%' : 'n/a';
        var rateColor = total > 0 ? (t.succeeded / total >= 0.8 ? '#34d399' : (t.succeeded / total >= 0.5 ? '#fbbf24' : '#ef4444')) : '#94a3b8';
        h += '<div class="obs-driver-table-row"><span>' + _esc(types[j].replace(/_/g, ' ')) + '</span><span style="color:#34d399;">' + t.succeeded + '</span><span style="color:#ef4444;">' + t.failed + '</span><span style="color:' + rateColor + ';">' + rate + '</span></div>';
      }
      h += '</div>';
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  // ═══════════════════════════════════════════════════
  // ── Recent Events ──
  // ═══════════════════════════════════════════════════
  function _renderRecent(recent) {
    var h = '<div class="obs-recent-grid">';

    // Recent actions
    h += '<div class="obs-recent-panel">';
    h += '<div class="obs-recent-title"><i class="fas fa-bolt" style="color:#ffa500;opacity:0.5;"></i> Recent Actions <span class="obs-recent-count">(' + recent.actions.length + ')</span></div>';
    if (recent.actions.length === 0) {
      h += '<div class="obs-empty">No action events.</div>';
    } else {
      h += '<div class="obs-recent-table"><div class="obs-recent-table-head"><span>Time</span><span>Event</span><span>Type</span><span>Source</span></div>';
      for (var i = 0; i < recent.actions.length; i++) {
        var a = recent.actions[i];
        var evColor = _eventColor(a.eventType);
        h += '<div class="obs-recent-table-row"><span class="obs-recent-ts">' + _timeAgo(a.timestamp) + '</span>';
        h += '<span style="color:' + evColor + ';">' + _esc((a.eventType || '').replace(/^action_/, '')) + '</span>';
        h += '<span>' + _esc((a.actionType || '').replace(/_/g, ' ')) + '</span>';
        h += '<span>' + _esc(a.source || '') + '</span></div>';
      }
      h += '</div>';
    }
    h += '</div>';

    // Recent workers
    h += '<div class="obs-recent-panel">';
    h += '<div class="obs-recent-title"><i class="fas fa-hard-hat" style="color:#a78bfa;opacity:0.5;"></i> Recent Workers <span class="obs-recent-count">(' + recent.workers.length + ')</span></div>';
    if (recent.workers.length === 0) {
      h += '<div class="obs-empty">No worker events.</div>';
    } else {
      h += '<div class="obs-recent-table"><div class="obs-recent-table-head"><span>Time</span><span>Event</span><span>Worker</span></div>';
      for (var j = 0; j < recent.workers.length; j++) {
        var w = recent.workers[j];
        h += '<div class="obs-recent-table-row"><span class="obs-recent-ts">' + _timeAgo(w.timestamp) + '</span>';
        h += '<span>' + _esc((w.eventType || '').replace(/^worker_/, '')) + '</span>';
        h += '<span>' + _esc(w.workerType || '') + '</span></div>';
      }
      h += '</div>';
    }
    h += '</div>';

    // Planner + Calibration compact
    h += '<div class="obs-recent-panel">';
    h += '<div class="obs-recent-title"><i class="fas fa-brain" style="color:#c084fc;opacity:0.5;"></i> Planner &amp; Calibration</div>';
    var combined = [];
    for (var k = 0; k < recent.planner.length; k++) { var pe = recent.planner[k]; pe._src = 'planner'; combined.push(pe); }
    for (var m = 0; m < recent.calibration.length; m++) { var ce = recent.calibration[m]; ce._src = 'calibration'; combined.push(ce); }
    combined.sort(function (a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });
    if (combined.length === 0) {
      h += '<div class="obs-empty">No planner or calibration events.</div>';
    } else {
      for (var n = 0; n < Math.min(combined.length, 15); n++) {
        var ev = combined[n];
        var srcPill = ev._src === 'planner' ? '<span class="obs-src-pill obs-src-pill--planner">planner</span>' : '<span class="obs-src-pill obs-src-pill--cal">calibration</span>';
        var label = (ev.eventType || '').replace(/^(planner_|calibration_)/, '');
        var extra = '';
        if (ev.counts) {
          var parts = [];
          if (ev.counts.enqueued) parts.push(ev.counts.enqueued + ' enqueued');
          if (ev.counts.recommendations) parts.push(ev.counts.recommendations + ' recs');
          extra = parts.join(', ');
        }
        if (ev.reason) extra = ev.reason;
        h += '<div class="obs-recent-compact">' + srcPill + ' <span class="obs-recent-ev">' + _esc(label) + '</span>';
        if (extra) h += ' <span class="obs-recent-extra">' + _esc(extra) + '</span>';
        h += '<span class="obs-recent-ts">' + _timeAgo(ev.timestamp) + '</span></div>';
      }
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  function _eventColor(et) {
    if (!et) return '#94a3b8';
    if (et.indexOf('approved') !== -1) return '#34d399';
    if (et.indexOf('rejected') !== -1) return '#ef4444';
    if (et.indexOf('succeeded') !== -1) return '#60a5fa';
    if (et.indexOf('failed') !== -1) return '#f87171';
    if (et.indexOf('blocked') !== -1) return '#fbbf24';
    if (et.indexOf('enqueued') !== -1) return '#a78bfa';
    return '#94a3b8';
  }

  // ═══════════════════════════════════════════════════
  // ── Storage Health ──
  // ═══════════════════════════════════════════════════
  function _renderStorage(storage) {
    var h = '<div class="obs-storage-strip">';
    h += '<span class="obs-storage-item"><strong>Usage:</strong> ' + _bytes(storage.estBytes) + '</span>';
    h += '<span class="obs-storage-item"><strong>storage_full:</strong> ' + storage.storageFullEvents + ' events</span>';
    h += '<span class="obs-storage-hint">Manage storage in <a href="/modules/company/config-overview.html">CONFIG → System Storage</a></span>';
    h += '</div>';
    return h;
  }

  // ═══════════════════════════════════════════════════
  // ── Event binding ──
  // ═══════════════════════════════════════════════════
  function _bindEvents() {
    if (!_container) return;

    // Days toggle
    var toggle = _container.querySelector('#obs-days-toggle');
    if (toggle) {
      toggle.addEventListener('click', function (e) {
        var btn = e.target.closest('.obs-toggle-btn');
        if (!btn || _debounce) return;
        _debounce = setTimeout(function () { _debounce = null; }, 400);
        var d = parseInt(btn.dataset.days, 10);
        if (d && d !== _currentDays) {
          _currentDays = d;
          render();
        }
      });
    }

    // Refresh
    var refreshBtn = _container.querySelector('#obs-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        if (_debounce) return;
        _debounce = setTimeout(function () { _debounce = null; }, 400);
        render();
      });
    }

    // Export
    var exportBtn = _container.querySelector('#obs-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (_debounce) return;
        _debounce = setTimeout(function () { _debounce = null; }, 400);
        if (typeof StorageManager !== 'undefined' && StorageManager.exportDiagnostics) {
          StorageManager.exportDiagnostics();
        }
      });
    }
  }

  return {
    init: init,
    render: render
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ObservabilityUI;
}
