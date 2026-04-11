// observability-metrics.js — Observability Dashboard v1.1: Deterministic metrics aggregator
// Reads from audit logs, queue, priority engine, and storage manager.
// No external libraries. Fail closed — returns empty metrics on error.

var ObservabilityMetrics = (function () {
  'use strict';

  var MAX_EVENTS = 2000;

  // ── Helpers ──
  function _safeGet(key) {
    try {
      if (typeof StorageManager !== 'undefined' && StorageManager.safeGet) return StorageManager.safeGet(key);
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _toDay(ts) {
    try { return new Date(ts).toISOString().substring(0, 10); } catch (e) { return null; }
  }

  function _clamp(arr, max) {
    if (!Array.isArray(arr)) return [];
    return arr.length > max ? arr.slice(-max) : arr;
  }

  function _percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = Math.ceil(p / 100 * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  function _dayRange(days) {
    var end = new Date();
    var start = new Date(end.getTime() - days * 86400000);
    return { days: days, startTs: start.toISOString(), endTs: end.toISOString(), startMs: start.getTime(), endMs: end.getTime() };
  }

  function _dayRangeExplicit(startMs, endMs, days) {
    return { days: days, startTs: new Date(startMs).toISOString(), endTs: new Date(endMs).toISOString(), startMs: startMs, endMs: endMs };
  }

  function _filterSince(arr, startMs) {
    return arr.filter(function (e) {
      var ts = e.timestamp || e.createdAt;
      return ts && new Date(ts).getTime() >= startMs;
    });
  }

  // ═══════════════════════════════════════════════════
  // ── compute ──
  // ═══════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════
  // ── Data Quality detection ──
  // ═══════════════════════════════════════════════════
  var CORE_STORES = ['ActionAudit', 'ActionQueue'];
  var ALL_STORES = ['ActionAudit', 'PlannerAudit', 'CalibrationAudit', 'PriorityAudit', 'ActionQueue'];

  function _checkDataQuality() {
    var missing = [];
    var notes = [];
    for (var i = 0; i < ALL_STORES.length; i++) {
      var name = ALL_STORES[i];
      if (name === 'ActionQueue') {
        var q = _safeGet('ap_action_queue');
        if (!q) { missing.push(name); notes.push('ActionQueue missing: queue metrics unavailable'); }
      } else {
        var mod = _getModule(name);
        if (!mod) { missing.push(name); notes.push(name + ' missing: related metrics shown as n/a'); }
      }
    }
    var corePresent = 0;
    for (var j = 0; j < CORE_STORES.length; j++) {
      if (missing.indexOf(CORE_STORES[j]) === -1) corePresent++;
    }
    var status = 'ok';
    if (missing.length > 0 && corePresent >= CORE_STORES.length) status = 'partial';
    else if (corePresent < CORE_STORES.length) status = missing.length >= ALL_STORES.length ? 'none' : 'partial';
    return { status: status, missing: missing, notes: notes };
  }

  // ═══════════════════════════════════════════════════
  // ── Delta computation (current vs prior period) ──
  // ═══════════════════════════════════════════════════
  function _computeDeltas(currentKpis, priorKpis) {
    if (!priorKpis) return _nullDeltas();
    return {
      approvalRatePP: _deltaPP(currentKpis.approvals.approvalRate, priorKpis.approvals.approvalRate),
      successRatePP: _deltaPP(currentKpis.execution.successRate, priorKpis.execution.successRate),
      avgTimeToApprovalMin: _deltaNum(currentKpis.timeToApprovalMin.avg, priorKpis.timeToApprovalMin.avg),
      criticalResolutionRatePP: _deltaPP(currentKpis.priority.criticalResolutionRate, priorKpis.priority.criticalResolutionRate),
      blockedDoneCount: _deltaNum(currentKpis.verification.blockedDoneCount, priorKpis.verification.blockedDoneCount),
      pendingCount: _deltaNum(currentKpis.queue.pending, priorKpis.queue.pending)
    };
  }

  function _deltaPP(cur, prev) {
    if (cur == null || prev == null) return null;
    return Math.round((cur - prev) * 10000) / 100; // percentage points, 2 decimal
  }

  function _deltaNum(cur, prev) {
    if (cur == null || prev == null) return null;
    return cur - prev;
  }

  function _nullDeltas() {
    return { approvalRatePP: null, successRatePP: null, avgTimeToApprovalMin: null, criticalResolutionRatePP: null, blockedDoneCount: null, pendingCount: null };
  }

  function compute(opts) {
    var days = (opts && opts.days) || 7;
    var range = _dayRange(days);
    var dataQuality = _checkDataQuality();

    try {
      // ── Read all data once ──
      var actionEvents = _clamp(_readAudit('ActionAudit', range), MAX_EVENTS);
      var workerEvents = [];
      var plannerEvents = _clamp(_readAudit('PlannerAudit', range), MAX_EVENTS);
      var calibrationEvents = _clamp(_readAudit('CalibrationAudit', range), MAX_EVENTS);
      var priorityEvents = _clamp(_readAudit('PriorityAudit', range), MAX_EVENTS);
      var queueAll = _clamp(_safeGet('ap_action_queue') || [], MAX_EVENTS);
      var queueInRange = _filterSince(queueAll, range.startMs);

      // ── KPIs ──
      var kpis = _computeKpis(actionEvents, workerEvents, plannerEvents, calibrationEvents, priorityEvents, queueAll, queueInRange, range);

      // ── Prior period KPIs ──
      var prior = null;
      var deltas = _nullDeltas();
      try {
        var priorRange = _dayRangeExplicit(range.startMs - days * 86400000, range.startMs, days);
        var pAction = _clamp(_readAudit('ActionAudit', priorRange), MAX_EVENTS);
        var pWorker = [];
        var pPlanner = _clamp(_readAudit('PlannerAudit', priorRange), MAX_EVENTS);
        var pCal = _clamp(_readAudit('CalibrationAudit', priorRange), MAX_EVENTS);
        var pPrio = _clamp(_readAudit('PriorityAudit', priorRange), MAX_EVENTS);
        var pQueueInRange = _filterSince(queueAll, priorRange.startMs).filter(function (e) {
          var ts = e.timestamp || e.createdAt;
          return ts && new Date(ts).getTime() < priorRange.endMs;
        });
        var priorKpis = _computeKpis(pAction, pWorker, pPlanner, pCal, pPrio, queueAll, pQueueInRange, priorRange);
        prior = { kpis: priorKpis };
        deltas = _computeDeltas(kpis, priorKpis);
      } catch (pe) { /* fail closed: deltas stay null */ }

      // ── byDay ──
      var byDay = _computeByDay(actionEvents, workerEvents, plannerEvents, calibrationEvents, priorityEvents, range);

      // ── Breakdowns ──
      var breakdowns = _computeBreakdowns(actionEvents, queueInRange);

      // ── Recent events ──
      var recent = _computeRecent(actionEvents, workerEvents, plannerEvents, calibrationEvents);

      return {
        range: { days: range.days, startTs: range.startTs, endTs: range.endTs },
        kpis: kpis,
        prior: prior,
        deltas: deltas,
        dataQuality: dataQuality,
        byDay: byDay,
        breakdowns: breakdowns,
        recent: recent
      };
    } catch (e) {
      console.warn('[ObservabilityMetrics] compute failed:', e);
      var empty = _emptyResult(range);
      empty.dataQuality = dataQuality;
      return empty;
    }
  }

  // ── Read audit with getSince or fallback ──
  function _readAudit(name, range) {
    try {
      var mod = _getModule(name);
      if (!mod) return [];
      if (mod.getSince) return mod.getSince(range.startTs);
      if (mod.getAll) return _filterSince(mod.getAll(), range.startMs);
      return [];
    } catch (e) { return []; }
  }

  function _getModule(name) {
    if (name === 'ActionAudit' && typeof ActionAudit !== 'undefined') return ActionAudit;
    if (name === 'PlannerAudit' && typeof PlannerAudit !== 'undefined') return PlannerAudit;
    if (name === 'CalibrationAudit' && typeof CalibrationAudit !== 'undefined') return CalibrationAudit;
    if (name === 'PriorityAudit' && typeof PriorityAudit !== 'undefined') return PriorityAudit;
    return null;
  }

  // ═══════════════════════════════════════════════════
  // ── KPI computation ──
  // ═══════════════════════════════════════════════════
  function _computeKpis(actionEv, workerEv, plannerEv, calEv, prioEv, queueAll, queueRange, range) {
    // Approvals
    var approved = 0, rejected = 0;
    for (var i = 0; i < actionEv.length; i++) {
      var et = actionEv[i].eventType;
      if (et === 'action_approved' || et === 'action_batch_approved') {
        approved += actionEv[i].meta && actionEv[i].meta.count ? actionEv[i].meta.count : 1;
      }
      if (et === 'action_rejected' || et === 'action_batch_rejected') {
        rejected += actionEv[i].meta && actionEv[i].meta.count ? actionEv[i].meta.count : 1;
      }
    }
    var approvalTotal = approved + rejected;
    var approvalRate = approvalTotal > 0 ? approved / approvalTotal : null;

    // Execution
    var succeeded = 0, failed = 0;
    for (var j = 0; j < actionEv.length; j++) {
      if (actionEv[j].eventType === 'action_succeeded') succeeded++;
      if (actionEv[j].eventType === 'action_failed') failed++;
    }
    var execTotal = succeeded + failed;
    var successRate = execTotal > 0 ? succeeded / execTotal : null;

    // Time to approval (from queue items)
    var ttaValues = [];
    for (var k = 0; k < queueRange.length; k++) {
      var qi = queueRange[k];
      if (qi.approvedAt && qi.createdAt) {
        var diff = (new Date(qi.approvedAt).getTime() - new Date(qi.createdAt).getTime()) / 60000;
        if (diff >= 0 && diff < 43200) ttaValues.push(diff); // cap at 30 days in minutes
      }
    }
    ttaValues.sort(function (a, b) { return a - b; });
    var ttaAvg = ttaValues.length > 0 ? ttaValues.reduce(function (s, v) { return s + v; }, 0) / ttaValues.length : null;

    // Queue snapshot (current)
    var qPending = 0, qApproved = 0, qExecuting = 0, qBlocked = 0;
    for (var m = 0; m < queueAll.length; m++) {
      var s = queueAll[m].status;
      if (s === 'pending_approval') qPending++;
      else if (s === 'approved_ready') qApproved++;
      else if (s === 'executing') qExecuting++;
      else if (s === 'blocked') qBlocked++;
    }

    // Priority counts (current)
    var criticalNow = 0, highNow = 0, criticalResolved = 0;
    if (typeof PriorityEngine !== 'undefined' && PriorityEngine.getCounts) {
      var counts = PriorityEngine.getCounts();
      criticalNow = counts.critical || 0;
      highNow = counts.high || 0;
    }
    // Critical resolution from priority changes
    for (var n = 0; n < prioEv.length; n++) {
      var pe = prioEv[n];
      if (pe.eventType === 'priority_changed' && pe.previousBucket === 'critical' && pe.newBucket !== 'critical') {
        criticalResolved++;
      }
    }
    var criticalTotal = criticalNow + criticalResolved;
    var criticalResolutionRate = criticalTotal > 0 ? criticalResolved / criticalTotal : null;

    // Verification friction (blocked Done)
    var blockedDoneCount = 0;
    for (var p = 0; p < actionEv.length; p++) {
      if (actionEv[p].eventType === 'action_blocked' && actionEv[p].actionType === 'move_task_to_done') {
        blockedDoneCount++;
      }
    }

    // Workers
    var wSpawned = 0, wRuns = 0, wTerminated = 0;
    for (var q = 0; q < workerEv.length; q++) {
      var wet = workerEv[q].eventType;
      if (wet === 'worker_spawned' || wet === 'spawned') wSpawned++;
      if (wet === 'worker_run_started' || wet === 'worker_run_completed' || wet === 'started' || wet === 'reported') wRuns++;
      if (wet === 'worker_terminated' || wet === 'terminated') wTerminated++;
    }

    // Planner
    var plRuns = 0, plRecs = 0;
    for (var r = 0; r < plannerEv.length; r++) {
      if (plannerEv[r].eventType === 'planner_run_completed') {
        plRuns++;
        if (plannerEv[r].counts && plannerEv[r].counts.recommendations) plRecs += plannerEv[r].counts.recommendations;
      }
      if (plannerEv[r].eventType === 'planner_recommendations_enqueued' && plannerEv[r].counts) {
        plRecs += plannerEv[r].counts.enqueued || 0;
      }
    }

    // Calibration
    var calRuns = 0, calProposals = 0;
    for (var t = 0; t < calEv.length; t++) {
      if (calEv[t].eventType === 'calibration_run_completed') calRuns++;
      if (calEv[t].eventType === 'calibration_recommendations_enqueued' && calEv[t].counts) {
        calProposals += calEv[t].counts.enqueued || 0;
      }
    }

    // Storage
    var estBytes = 0, storageFullEvents = 0;
    if (typeof StorageManager !== 'undefined' && StorageManager.estimateUsage) {
      estBytes = StorageManager.estimateUsage().bytesEstimate || 0;
    }
    for (var u = 0; u < actionEv.length; u++) {
      if (actionEv[u].eventType === 'storage_full') storageFullEvents++;
    }

    return {
      approvals: { approved: approved, rejected: rejected, approvalRate: approvalRate },
      execution: { succeeded: succeeded, failed: failed, successRate: successRate },
      timeToApprovalMin: {
        avg: ttaAvg,
        p50: ttaValues.length > 0 ? _percentile(ttaValues, 50) : null,
        p90: ttaValues.length > 0 ? _percentile(ttaValues, 90) : null
      },
      queue: { pending: qPending, approvedReady: qApproved, executing: qExecuting, blocked: qBlocked },
      priority: { criticalNow: criticalNow, highNow: highNow, criticalResolved: criticalResolved, criticalResolutionRate: criticalResolutionRate },
      verification: { blockedDoneCount: blockedDoneCount },
      workers: { spawned: wSpawned, runs: wRuns, terminated: wTerminated },
      planner: { runs: plRuns, recsEnqueued: plRecs },
      calibration: { runs: calRuns, proposalsEnqueued: calProposals },
      storage: { estBytes: estBytes, storageFullEvents: storageFullEvents }
    };
  }

  // ═══════════════════════════════════════════════════
  // ── byDay bucketing ──
  // ═══════════════════════════════════════════════════
  function _computeByDay(actionEv, workerEv, plannerEv, calEv, prioEv, range) {
    // Build day keys
    var days = [];
    var dayMap = {};
    var cur = new Date(range.startMs);
    var endMs = new Date(range.endTs).getTime();
    while (cur.getTime() <= endMs) {
      var dayKey = cur.toISOString().substring(0, 10);
      var entry = {
        day: dayKey,
        approved: 0, rejected: 0,
        succeeded: 0, failed: 0,
        pending: 0,
        criticalNow: 0,
        blockedDone: 0,
        workerRuns: 0,
        plannerRuns: 0,
        calibrationRuns: 0
      };
      days.push(entry);
      dayMap[dayKey] = entry;
      cur = new Date(cur.getTime() + 86400000);
    }

    // Bucket action events
    for (var i = 0; i < actionEv.length; i++) {
      var d = _toDay(actionEv[i].timestamp);
      if (!d || !dayMap[d]) continue;
      var et = actionEv[i].eventType;
      if (et === 'action_approved' || et === 'action_batch_approved') dayMap[d].approved++;
      if (et === 'action_rejected' || et === 'action_batch_rejected') dayMap[d].rejected++;
      if (et === 'action_succeeded') dayMap[d].succeeded++;
      if (et === 'action_failed') dayMap[d].failed++;
      if (et === 'action_enqueued') dayMap[d].pending++;
      if (et === 'action_blocked' && actionEv[i].actionType === 'move_task_to_done') dayMap[d].blockedDone++;
    }

    // Bucket worker events
    for (var j = 0; j < workerEv.length; j++) {
      var wd = _toDay(workerEv[j].timestamp);
      if (!wd || !dayMap[wd]) continue;
      if (workerEv[j].eventType === 'worker_run_completed' || workerEv[j].eventType === 'reported') dayMap[wd].workerRuns++;
    }

    // Bucket planner events
    for (var k = 0; k < plannerEv.length; k++) {
      var pd = _toDay(plannerEv[k].timestamp);
      if (!pd || !dayMap[pd]) continue;
      if (plannerEv[k].eventType === 'planner_run_completed') dayMap[pd].plannerRuns++;
    }

    // Bucket calibration events
    for (var m = 0; m < calEv.length; m++) {
      var cd = _toDay(calEv[m].timestamp);
      if (!cd || !dayMap[cd]) continue;
      if (calEv[m].eventType === 'calibration_run_completed') dayMap[cd].calibrationRuns++;
    }

    // Bucket priority (critical bucket evaluations per day)
    for (var n = 0; n < prioEv.length; n++) {
      var prd = _toDay(prioEv[n].timestamp);
      if (!prd || !dayMap[prd]) continue;
      if (prioEv[n].newBucket === 'critical') dayMap[prd].criticalNow++;
    }

    return days;
  }

  // ═══════════════════════════════════════════════════
  // ── Breakdowns ──
  // ═══════════════════════════════════════════════════
  function _computeBreakdowns(actionEv, queueRange) {
    // By source
    var bySource = {};
    for (var i = 0; i < actionEv.length; i++) {
      var src = actionEv[i].source || 'unknown';
      if (!bySource[src]) bySource[src] = { approved: 0, rejected: 0, succeeded: 0, failed: 0 };
      var et = actionEv[i].eventType;
      if (et === 'action_approved') bySource[src].approved++;
      if (et === 'action_rejected') bySource[src].rejected++;
      if (et === 'action_succeeded') bySource[src].succeeded++;
      if (et === 'action_failed') bySource[src].failed++;
    }

    // By actionType
    var byType = {};
    for (var j = 0; j < actionEv.length; j++) {
      var at = actionEv[j].actionType || 'unknown';
      if (!byType[at]) byType[at] = { succeeded: 0, failed: 0 };
      if (actionEv[j].eventType === 'action_succeeded') byType[at].succeeded++;
      if (actionEv[j].eventType === 'action_failed') byType[at].failed++;
    }

    // Top reject reasons
    var reasonMap = {};
    for (var k = 0; k < actionEv.length; k++) {
      if ((actionEv[k].eventType === 'action_rejected' || actionEv[k].eventType === 'action_batch_rejected') && actionEv[k].reason) {
        var r = (actionEv[k].reason || '').toLowerCase().trim();
        if (r) reasonMap[r] = (reasonMap[r] || 0) + 1;
      }
    }
    // Also check queue for reject reasons
    for (var m = 0; m < queueRange.length; m++) {
      if (queueRange[m].status === 'failed' && queueRange[m].rejectReason) {
        var qr = (queueRange[m].rejectReason || '').toLowerCase().trim();
        if (qr) reasonMap[qr] = (reasonMap[qr] || 0) + 1;
      }
    }
    var topRejectReasons = Object.keys(reasonMap).map(function (r) {
      return { reason: r, count: reasonMap[r] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

    // Top failure reasons
    var failMap = {};
    for (var n = 0; n < actionEv.length; n++) {
      if (actionEv[n].eventType === 'action_failed' && actionEv[n].reason) {
        var fr = (actionEv[n].reason || '').toLowerCase().trim();
        if (fr) failMap[fr] = (failMap[fr] || 0) + 1;
      }
    }
    var topFailureReasons = Object.keys(failMap).map(function (f) {
      return { reason: f, count: failMap[f] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

    return {
      approvalsBySource: bySource,
      actionsByType: byType,
      topRejectReasons: topRejectReasons,
      topFailureReasons: topFailureReasons
    };
  }

  // ═══════════════════════════════════════════════════
  // ── Recent events ──
  // ═══════════════════════════════════════════════════
  function _computeRecent(actionEv, workerEv, plannerEv, calEv) {
    return {
      actions: actionEv.slice(-25).reverse().map(function (e) {
        return { timestamp: e.timestamp, eventType: e.eventType, actionType: e.actionType, source: e.source, reason: e.reason, riskLevel: e.riskLevel };
      }),
      workers: workerEv.slice(-25).reverse().map(function (e) {
        return { timestamp: e.timestamp, eventType: e.eventType, workerType: e.workerType, correlationId: e.correlationId };
      }),
      planner: plannerEv.slice(-10).reverse().map(function (e) {
        return { timestamp: e.timestamp, eventType: e.eventType, counts: e.counts, reason: e.reason };
      }),
      calibration: calEv.slice(-10).reverse().map(function (e) {
        return { timestamp: e.timestamp, eventType: e.eventType, counts: e.counts, reason: e.reason };
      })
    };
  }

  // ── Empty result fallback ──
  function _emptyResult(range) {
    return {
      range: { days: range.days, startTs: range.startTs, endTs: range.endTs },
      kpis: {
        approvals: { approved: 0, rejected: 0, approvalRate: null },
        execution: { succeeded: 0, failed: 0, successRate: null },
        timeToApprovalMin: { avg: null, p50: null, p90: null },
        queue: { pending: 0, approvedReady: 0, executing: 0, blocked: 0 },
        priority: { criticalNow: 0, highNow: 0, criticalResolved: 0, criticalResolutionRate: null },
        verification: { blockedDoneCount: 0 },
        workers: { spawned: 0, runs: 0, terminated: 0 },
        planner: { runs: 0, recsEnqueued: 0 },
        calibration: { runs: 0, proposalsEnqueued: 0 },
        storage: { estBytes: 0, storageFullEvents: 0 }
      },
      prior: null,
      deltas: _nullDeltas(),
      dataQuality: { status: 'none', missing: [], notes: [] },
      byDay: [],
      breakdowns: { approvalsBySource: {}, actionsByType: {}, topRejectReasons: [], topFailureReasons: [] },
      recent: { actions: [], workers: [], planner: [], calibration: [] }
    };
  }

  return {
    compute: compute
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ObservabilityMetrics;
}
