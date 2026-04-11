// observability-ui.js — Observability Dashboard v1.1: Rendering engine
// Renders KPI cards, sparklines, breakdowns, recent events into a container.
// No external libraries. All IDs prefixed obs-*.

var ObservabilityUI = (function () {
  'use strict';

  var _container = null;
  var _currentDays = 7;
  var _debounce = null;
  var _lastRenderedAt = null;

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
  function _kpiColorClass(val, goodThresh, badThresh) {
    if (val == null) return 'obs-kpi-value--muted';
    if (goodThresh != null && val >= goodThresh) return 'obs-kpi-value--good';
    if (badThresh != null && val < badThresh) return 'obs-kpi-value--bad';
    return 'obs-kpi-value--warn';
  }
  function _timeAgo(ts) {
    if (!ts) return '';
    try {
      var d = new Date(ts);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function _deltaHtml(val, unit, invertSign) {
    if (val == null) return '<span class="obs-delta obs-delta--na">• n/a</span>';
    var positive = invertSign ? val < 0 : val > 0;
    var negative = invertSign ? val > 0 : val < 0;
    var cls = positive ? 'obs-delta--up' : (negative ? 'obs-delta--down' : 'obs-delta--na');
    var icon = positive ? '\u25B2' : (negative ? '\u25BC' : '\u2022');
    var display = (val > 0 ? '+' : '') + (unit === 'pp' ? val.toFixed(1) + 'pp' : Math.round(val) + (unit || ''));
    return '<span class="obs-delta ' + cls + '">' + icon + ' ' + _esc(display) + '</span>';
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
    var data;
    try {
      data = ObservabilityMetrics.compute({ days: _currentDays });
    } catch (e) {
      _container.innerHTML = '<div class="obs-empty">Refresh failed (no data).</div>';
      return;
    }
    _lastRenderedAt = new Date().toISOString();
    var html = '';

    // ── Status bar: data quality + last updated ──
    html += _renderStatusBar(data.dataQuality);

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
    html += _renderKpiGrid(data.kpis, data.deltas);

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
  // ── Status bar: data quality + last updated ──
  // ═══════════════════════════════════════════════════
  function _renderStatusBar(dq) {
    var h = '<div class="obs-status-bar">';
    // Data quality badge
    var badgeCls = 'obs-dq-badge--' + (dq ? dq.status : 'none');
    var badgeLabel = dq ? dq.status.toUpperCase() : 'NONE';
    h += '<span class="obs-dq-badge ' + badgeCls + '">' + badgeLabel + '</span>';
    if (dq && dq.missing && dq.missing.length > 0) {
      h += '<span class="obs-dq-detail">' + _esc(dq.missing.join(', ') + ' unavailable') + '</span>';
    }
    // Last updated
    h += '<span class="obs-last-updated">';
    if (_lastRenderedAt) {
      h += 'Updated: ' + _timeAgo(_lastRenderedAt);
    } else {
      h += 'Not yet rendered';
    }
    h += '</span>';
    h += '</div>';
    return h;
  }

  // ═══════════════════════════════════════════════════
  // ── KPI Grid ──
  // ═══════════════════════════════════════════════════
  function _renderKpiGrid(kpis, deltas) {
    var d = deltas || {};
    var cards = [
      { label: 'Approval Rate', value: _pct(kpis.approvals.approvalRate), sub: kpis.approvals.approved + ' / ' + (kpis.approvals.approved + kpis.approvals.rejected), cls: _kpiColorClass(kpis.approvals.approvalRate, 0.7, 0.5), delta: _deltaHtml(d.approvalRatePP, 'pp') },
      { label: 'Success Rate', value: _pct(kpis.execution.successRate), sub: kpis.execution.succeeded + ' ok / ' + kpis.execution.failed + ' fail', cls: _kpiColorClass(kpis.execution.successRate, 0.8, 0.6), delta: _deltaHtml(d.successRatePP, 'pp') },
      { label: 'Crit Resolution', value: _pct(kpis.priority.criticalResolutionRate), sub: kpis.priority.criticalResolved + ' resolved / ' + kpis.priority.criticalNow + ' current', cls: _kpiColorClass(kpis.priority.criticalResolutionRate, 0.5, 0.2), delta: _deltaHtml(d.criticalResolutionRatePP, 'pp') },
      { label: 'Avg Approval Time', value: _mins(kpis.timeToApprovalMin.avg), sub: 'p50: ' + _mins(kpis.timeToApprovalMin.p50) + ' \u00B7 p90: ' + _mins(kpis.timeToApprovalMin.p90), cls: 'obs-kpi-value--info', delta: _deltaHtml(d.avgTimeToApprovalMin, 'm', true) },
      { label: 'Queue Pending', value: _num(kpis.queue.pending), sub: kpis.queue.approvedReady + ' ready \u00B7 ' + kpis.queue.executing + ' exec \u00B7 ' + kpis.queue.blocked + ' blocked', cls: kpis.queue.pending > 10 ? 'obs-kpi-value--warn' : 'obs-kpi-value--good', delta: _deltaHtml(d.pendingCount, '', true) },
      { label: 'Storage', value: kpis.storage ? Math.round((kpis.storage.estBytes || 0) / 1024) + ' KB' : '—', sub: 'localStorage usage', cls: 'obs-kpi-value--info', delta: '' }
    ];

    var h = '<div class="obs-kpi-grid">';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      h += '<div class="obs-kpi-card">';
      h += '<div class="obs-kpi-label">' + _esc(c.label) + '</div>';
      h += '<div class="obs-kpi-value ' + c.cls + '">' + _esc(c.value);
      if (c.delta) h += ' ' + c.delta;
      h += '</div>';
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
      { title: 'Approvals / day', series: [{ key: 'approved', cls: 'obs-spark-bar--s1' }, { key: 'rejected', cls: 'obs-spark-bar--s2' }] },
      { title: 'Execution / day', series: [{ key: 'succeeded', cls: 'obs-spark-bar--s3' }, { key: 'failed', cls: 'obs-spark-bar--s2' }] },
      { title: 'Queue pending / day', series: [{ key: 'pending', cls: 'obs-spark-bar--s4' }] }
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
      // Stack bars for each series (CSP-safe: no inline background color)
      for (var j = 0; j < series.length; j++) {
        var val = byDay[i][series[j].key] || 0;
        var pct = Math.max(2, Math.round((val / max) * 100));
        h += '<div class="obs-spark-bar ' + series[j].cls + '" style="--h:' + pct + '%" title="' + series[j].key + ': ' + val + '"></div>';
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
    h += '<div class="obs-driver-title"><i class="fas fa-ban obs-icon--bad"></i> Top Reject Reasons</div>';
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
    h += '<div class="obs-driver-title"><i class="fas fa-bolt obs-icon--info"></i> Action Success by Type</div>';
    var types = Object.keys(bd.actionsByType);
    if (types.length === 0) {
      h += '<div class="obs-empty">No execution data.</div>';
    } else {
      h += '<div class="obs-driver-table"><div class="obs-driver-table-head"><span>Type</span><span>OK</span><span>Fail</span><span>Rate</span></div>';
      for (var j = 0; j < types.length; j++) {
        var t = bd.actionsByType[types[j]];
        var total = t.succeeded + t.failed;
        var rate = total > 0 ? Math.round((t.succeeded / total) * 100) + '%' : 'n/a';
        var rateCls = total > 0 ? (t.succeeded / total >= 0.8 ? 'obs-rate--good' : (t.succeeded / total >= 0.5 ? 'obs-rate--warn' : 'obs-rate--bad')) : 'obs-rate--muted';
        var friendlyType = typeof FriendlyLabels !== 'undefined' ? FriendlyLabels.actionType(types[j]) : types[j].replace(/_/g, ' ');
        h += '<div class="obs-driver-table-row"><span>' + _esc(friendlyType) + '</span><span class="obs-rate--good">' + t.succeeded + '</span><span class="obs-rate--bad">' + t.failed + '</span><span class="' + rateCls + '">' + rate + '</span></div>';
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
    h += '<div class="obs-recent-title"><i class="fas fa-bolt obs-icon--warn"></i> Recent Actions <span class="obs-recent-count">(' + recent.actions.length + ')</span></div>';
    if (recent.actions.length === 0) {
      h += '<div class="obs-empty">No action events.</div>';
    } else {
      h += '<div class="obs-recent-table"><div class="obs-recent-table-head"><span>Time</span><span>Event</span><span>Type</span><span>Source</span></div>';
      for (var i = 0; i < recent.actions.length; i++) {
        var a = recent.actions[i];
        var evCls = _eventClass(a.eventType);
        h += '<div class="obs-recent-table-row"><span class="obs-recent-ts">' + _timeAgo(a.timestamp) + '</span>';
        h += '<span class="' + evCls + '">' + _esc((a.eventType || '').replace(/^action_/, '')) + '</span>';
        h += '<span>' + _esc(typeof FriendlyLabels !== 'undefined' ? FriendlyLabels.actionType(a.actionType || '') : (a.actionType || '').replace(/_/g, ' ')) + '</span>';
        h += '<span>' + _esc(a.source || '') + '</span></div>';
      }
      h += '</div>';
    }
    h += '</div>';

    // Recent workers
    h += '</div>';
    return h;
  }

  function _eventClass(et) {
    if (!et) return 'obs-ev--muted';
    if (et.indexOf('approved') !== -1) return 'obs-ev--good';
    if (et.indexOf('rejected') !== -1) return 'obs-ev--bad';
    if (et.indexOf('succeeded') !== -1) return 'obs-ev--info';
    if (et.indexOf('failed') !== -1) return 'obs-ev--bad-light';
    if (et.indexOf('blocked') !== -1) return 'obs-ev--warn';
    if (et.indexOf('enqueued') !== -1) return 'obs-ev--purple';
    return 'obs-ev--muted';
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
