// calibration-loop.js — Calibration Loop v1: Bounded Self-Improvement (Propose-Only)
// Analyzes historical signals, computes ops health metrics, generates tuning proposals.
// NEVER auto-adjusts weights. All proposals enqueued as pending_approval.
// Depends on: CalibrationAudit, ActionAudit, ActionQueue, PriorityAudit, PriorityEngine (optional), TaskVerifier (optional)

var CalibrationLoop = (function () {
  'use strict';

  // ── Storage keys ──
  var ARTIFACT_KEY = 'ap_calibration_latest';
  var LAST_RUN_KEY = 'ap_calibration_last_run';
  var ENABLED_KEY = 'ap_calibration_enabled';
  var CADENCE_KEY = 'ap_calibration_cadence_days';

  // ── Defaults ──
  var DEFAULT_ENABLED = false;
  var DEFAULT_CADENCE_DAYS = 7;

  // ── Thresholds + caps (from rules file or defaults) ──
  var THRESHOLDS = {
    lowApprovalRate: 0.6,
    lowSuccessRate: 0.8,
    lowCriticalResolution: 0.3,
    highRejectReasonFrequency: 3,
    stuckReviewDays: 2
  };
  var CAPS = {
    maxWeightAdjustment: 0.5,
    minWeight: 0,
    maxWeight: 5,
    maxPlannerRecommendationAdjustment: 1,
    minPlannerRecommendations: 2,
    maxPlannerRecommendations: 12
  };
  var MAX_PROPOSALS = 6;
  var _rulesLoaded = false;

  // ═══════════════════════════════════════════════════
  // ── Settings ──
  // ═══════════════════════════════════════════════════
  function isEnabled() {
    try {
      var val = localStorage.getItem(ENABLED_KEY);
      if (val === null) return DEFAULT_ENABLED;
      return val === 'true';
    } catch (e) { return DEFAULT_ENABLED; }
  }

  function setEnabled(val) {
    try { localStorage.setItem(ENABLED_KEY, String(!!val)); } catch (e) { /* ignore */ }
  }

  function getCadenceDays() {
    try {
      var val = localStorage.getItem(CADENCE_KEY);
      if (val !== null) { var n = parseInt(val, 10); if (!isNaN(n) && n > 0) return n; }
    } catch (e) { /* ignore */ }
    return DEFAULT_CADENCE_DAYS;
  }

  function getLastRunTimestamp() {
    try { return localStorage.getItem(LAST_RUN_KEY) || null; } catch (e) { return null; }
  }

  function _setLastRun(ts) {
    try { localStorage.setItem(LAST_RUN_KEY, ts); } catch (e) { /* ignore */ }
  }

  function shouldAutoRun() {
    if (!isEnabled()) return false;
    var last = getLastRunTimestamp();
    if (!last) return true;
    var elapsed = Date.now() - new Date(last).getTime();
    return elapsed >= getCadenceDays() * 86400000;
  }

  // ═══════════════════════════════════════════════════
  // ── Load rules ──
  // ═══════════════════════════════════════════════════
  function loadRules() {
    if (_rulesLoaded) return Promise.resolve();
    return fetch('/data/company-calibration-rules.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.thresholds) {
          var t = data.thresholds;
          if (t.lowApprovalRate != null) THRESHOLDS.lowApprovalRate = t.lowApprovalRate;
          if (t.lowSuccessRate != null) THRESHOLDS.lowSuccessRate = t.lowSuccessRate;
          if (t.lowCriticalResolution != null) THRESHOLDS.lowCriticalResolution = t.lowCriticalResolution;
          if (t.highRejectReasonFrequency != null) THRESHOLDS.highRejectReasonFrequency = t.highRejectReasonFrequency;
          if (t.stuckReviewDays != null) THRESHOLDS.stuckReviewDays = t.stuckReviewDays;
        }
        if (data && data.caps) {
          var c = data.caps;
          if (c.maxWeightAdjustment != null) CAPS.maxWeightAdjustment = c.maxWeightAdjustment;
          if (c.minWeight != null) CAPS.minWeight = c.minWeight;
          if (c.maxWeight != null) CAPS.maxWeight = c.maxWeight;
          if (c.maxPlannerRecommendationAdjustment != null) CAPS.maxPlannerRecommendationAdjustment = c.maxPlannerRecommendationAdjustment;
          if (c.minPlannerRecommendations != null) CAPS.minPlannerRecommendations = c.minPlannerRecommendations;
          if (c.maxPlannerRecommendations != null) CAPS.maxPlannerRecommendations = c.maxPlannerRecommendations;
        }
        if (data && data.maxProposals) MAX_PROPOSALS = data.maxProposals;
        _rulesLoaded = true;
      })
      .catch(function () { _rulesLoaded = true; });
  }

  // ═══════════════════════════════════════════════════
  // ── run() — Main entry point ──
  // ═══════════════════════════════════════════════════
  function run(snapshot) {
    snapshot = snapshot || {};
    var runId = 'cal_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
    var nowIso = new Date().toISOString();

    CalibrationAudit.logRunStarted(runId);

    try {
      // ── Compute metrics ──
      var metrics = _computeMetrics(snapshot);
      var breakdowns = _computeBreakdowns();
      var recommendations = _evaluateRules(metrics, breakdowns);

      var artifact = {
        id: runId,
        createdAt: nowIso,
        metrics: metrics,
        breakdowns: breakdowns,
        recommendations: recommendations
      };

      // ── Store artifact ──
      _storeArtifact(artifact);
      _setLastRun(nowIso);

      // ── Enqueue proposals ──
      var enqueuedCount = _enqueueProposals(recommendations, runId);

      // ── Audit ──
      CalibrationAudit.logRunCompleted(runId, {
        recommendationCount: recommendations.length,
        enqueuedCount: enqueuedCount
      }, {
        approvalRate: metrics.approvalRate,
        successRate: metrics.successRate,
        criticalResolutionRate: metrics.criticalResolutionRate
      });

      if (enqueuedCount > 0) {
        CalibrationAudit.logRecommendationsEnqueued(runId, enqueuedCount);
      }

      return artifact;

    } catch (e) {
      CalibrationAudit.logError('run() threw: ' + (e.message || 'unknown'));
      return null;
    }
  }

  // ═══════════════════════════════════════════════════
  // ── Metric computation ──
  // ═══════════════════════════════════════════════════
  function _computeMetrics(snapshot) {
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // A) Approval signals
    var approvedCount = 0;
    var rejectedCount = 0;
    try {
      var aEvents = ActionAudit.getSince(weekAgo);
      for (var i = 0; i < aEvents.length; i++) {
        if (aEvents[i].eventType === 'action_approved' || aEvents[i].eventType === 'action_batch_approved') {
          approvedCount += (aEvents[i].meta && aEvents[i].meta.count) ? aEvents[i].meta.count : 1;
        }
        if (aEvents[i].eventType === 'action_rejected' || aEvents[i].eventType === 'action_batch_rejected') {
          rejectedCount += (aEvents[i].meta && aEvents[i].meta.count) ? aEvents[i].meta.count : 1;
        }
      }
    } catch (e) { /* degrade */ }

    var totalDecisions = approvedCount + rejectedCount;
    var approvalRate = totalDecisions > 0 ? _round(approvedCount / totalDecisions) : null;
    var rejectionRate = totalDecisions > 0 ? _round(rejectedCount / totalDecisions) : null;

    // C) Execution outcomes
    var succeededCount = 0;
    var failedExecCount = 0;
    try {
      var aEvents2 = ActionAudit.getSince(weekAgo);
      for (var j = 0; j < aEvents2.length; j++) {
        if (aEvents2[j].eventType === 'action_succeeded') succeededCount++;
        if (aEvents2[j].eventType === 'action_failed') failedExecCount++;
      }
    } catch (e) { /* degrade */ }

    var totalExec = succeededCount + failedExecCount;
    var successRate = totalExec > 0 ? _round(succeededCount / totalExec) : null;

    // D) Priority effectiveness (critical resolution)
    var criticalResolutionRate = null;
    try {
      var changes = PriorityAudit.getChanges(50);
      var critStart = 0;
      var critResolved = 0;
      for (var k = 0; k < changes.length; k++) {
        if (changes[k].previousBucket === 'critical') critStart++;
        if (changes[k].previousBucket === 'critical' && changes[k].newBucket !== 'critical') critResolved++;
      }
      if (critStart > 0) criticalResolutionRate = _round(critResolved / critStart);
    } catch (e) { /* degrade */ }

    // E) Verification friction
    var blockedDoneCount = 0;
    try {
      var tasks = snapshot.tasks || [];
      if (typeof TaskVerifier !== 'undefined' && TaskVerifier.isLoaded && TaskVerifier.isLoaded()) {
        for (var m = 0; m < tasks.length; m++) {
          if (tasks[m].status === 'done') continue;
          var vr = TaskVerifier.verifyForTransition(tasks[m], 'done');
          if (!vr.allowed) blockedDoneCount++;
        }
      }
    } catch (e) { /* degrade */ }

    // Avg time to approval (approximate from queue)
    var avgTimeToApproval = null;
    try {
      var allItems = ActionQueue.getAll();
      var times = [];
      for (var n = 0; n < allItems.length; n++) {
        var it = allItems[n];
        if (it.approvedAt && it.createdAt) {
          var diff = new Date(it.approvedAt).getTime() - new Date(it.createdAt).getTime();
          if (diff > 0) times.push(diff);
        }
      }
      if (times.length > 0) {
        var sum = 0;
        for (var p = 0; p < times.length; p++) sum += times[p];
        avgTimeToApproval = Math.round(sum / times.length / 60000); // minutes
      }
    } catch (e) { /* degrade */ }

    return {
      approvalRate: approvalRate,
      rejectionRate: rejectionRate,
      successRate: successRate,
      criticalResolutionRate: criticalResolutionRate,
      avgTimeToApproval: avgTimeToApproval,
      blockedDoneCount: blockedDoneCount,
      _raw: { approvedCount: approvedCount, rejectedCount: rejectedCount, succeededCount: succeededCount, failedExecCount: failedExecCount }
    };
  }

  // ═══════════════════════════════════════════════════
  // ── Breakdowns ──
  // ═══════════════════════════════════════════════════
  function _computeBreakdowns() {
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    var byActionType = {};
    var bySource = {};
    var rejectReasons = {};

    try {
      var events = ActionAudit.getSince(weekAgo);
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];

        // By action type
        if (ev.actionType) {
          if (!byActionType[ev.actionType]) byActionType[ev.actionType] = { approved: 0, rejected: 0, succeeded: 0, failed: 0 };
          var bt = byActionType[ev.actionType];
          if (ev.eventType === 'action_approved') bt.approved++;
          if (ev.eventType === 'action_rejected') bt.rejected++;
          if (ev.eventType === 'action_succeeded') bt.succeeded++;
          if (ev.eventType === 'action_failed') bt.failed++;
        }

        // By source
        if (ev.source) {
          if (!bySource[ev.source]) bySource[ev.source] = { approved: 0, rejected: 0 };
          var bs = bySource[ev.source];
          if (ev.eventType === 'action_approved') bs.approved++;
          if (ev.eventType === 'action_rejected') bs.rejected++;
        }

        // Reject reasons
        if ((ev.eventType === 'action_rejected' || ev.eventType === 'action_batch_rejected') && ev.reason) {
          var normR = ev.reason.toLowerCase().trim().substring(0, 60);
          rejectReasons[normR] = (rejectReasons[normR] || 0) + 1;
        }
      }
    } catch (e) { /* degrade */ }

    // Top 5 reject reasons
    var topRejectReasons = Object.keys(rejectReasons).map(function (r) {
      return { reason: r, count: rejectReasons[r] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

    return {
      byActionType: byActionType,
      bySource: bySource,
      topRejectReasons: topRejectReasons
    };
  }

  // ═══════════════════════════════════════════════════
  // ── Tuning rule evaluation ──
  // ═══════════════════════════════════════════════════
  function _evaluateRules(metrics, breakdowns) {
    var recs = [];

    // Rule 1: Low approval rate + planner rejections
    if (metrics.approvalRate !== null && metrics.approvalRate < THRESHOLDS.lowApprovalRate) {
      var plannerRejected = 0;
      var plannerTotal = 0;
      try {
        var bs = breakdowns.bySource || {};
        if (bs.planner) {
          plannerRejected = bs.planner.rejected || 0;
          plannerTotal = (bs.planner.approved || 0) + (bs.planner.rejected || 0);
        }
      } catch (e) { /* degrade */ }

      if (plannerTotal > 0 && plannerRejected / plannerTotal > 0.4 && recs.length < MAX_PROPOSALS) {
        recs.push({
          id: 'cal_rec_planner_aggression',
          type: 'adjust_planner_threshold',
          target: 'PlannerLoop.THRESHOLDS.recommendationsMax',
          proposedChange: { direction: 'decrease', amount: CAPS.maxPlannerRecommendationAdjustment, min: CAPS.minPlannerRecommendations, max: CAPS.maxPlannerRecommendations },
          rationale: 'Approval rate is ' + _pct(metrics.approvalRate) + ' with planner rejection rate at ' + _pct(plannerRejected / plannerTotal) + '. Consider reducing planner recommendation aggressiveness.',
          requiresApproval: true,
          riskLevel: 'medium'
        });
      }
    }

    // Rule 2: Frequent "too early" reject reasons → increase aging weight
    try {
      var topReasons = breakdowns.topRejectReasons || [];
      for (var r = 0; r < topReasons.length && recs.length < MAX_PROPOSALS; r++) {
        if (topReasons[r].reason.indexOf('too early') !== -1 && topReasons[r].count >= THRESHOLDS.highRejectReasonFrequency) {
          recs.push({
            id: 'cal_rec_aging_weight',
            type: 'adjust_priority_weight',
            target: 'PriorityEngine.WEIGHTS.agingFactor',
            proposedChange: { direction: 'increase', amount: CAPS.maxWeightAdjustment, min: CAPS.minWeight, max: CAPS.maxWeight },
            rationale: 'Rejection reason "too early" appeared ' + topReasons[r].count + ' times. Increasing aging weight may improve timing of proposals.',
            requiresApproval: true,
            riskLevel: 'medium'
          });
          break;
        }
      }
    } catch (e) { /* degrade */ }

    // Rule 3: Low critical resolution rate → increase urgency weight
    if (metrics.criticalResolutionRate !== null && metrics.criticalResolutionRate < THRESHOLDS.lowCriticalResolution && recs.length < MAX_PROPOSALS) {
      recs.push({
        id: 'cal_rec_urgency_weight',
        type: 'adjust_priority_weight',
        target: 'PriorityEngine.WEIGHTS.urgency',
        proposedChange: { direction: 'increase', amount: CAPS.maxWeightAdjustment, min: CAPS.minWeight, max: CAPS.maxWeight },
        rationale: 'Critical task resolution rate is ' + _pct(metrics.criticalResolutionRate) + '. Increasing urgency weight may surface critical work earlier.',
        requiresApproval: true,
        riskLevel: 'medium'
      });
    }

    // Rule 4: Low success rate for specific action types → flag
    try {
      var bat = breakdowns.byActionType || {};
      var actionTypes = Object.keys(bat);
      for (var a = 0; a < actionTypes.length && recs.length < MAX_PROPOSALS; a++) {
        var at = bat[actionTypes[a]];
        var totalExec = (at.succeeded || 0) + (at.failed || 0);
        if (totalExec >= 3) {
          var sr = at.succeeded / totalExec;
          if (sr < THRESHOLDS.lowSuccessRate) {
            recs.push({
              id: 'cal_rec_flag_' + actionTypes[a],
              type: 'flag_action_type',
              target: actionTypes[a],
              proposedChange: { flag: 'review_needed', successRate: _round(sr), totalExecutions: totalExec },
              rationale: 'Action type "' + actionTypes[a] + '" has success rate ' + _pct(sr) + ' over ' + totalExec + ' executions. Review recommended.',
              requiresApproval: true,
              riskLevel: 'medium'
            });
          }
        }
      }
    } catch (e) { /* degrade */ }

    return recs.slice(0, MAX_PROPOSALS);
  }

  // ═══════════════════════════════════════════════════
  // ── Enqueue proposals ──
  // ═══════════════════════════════════════════════════
  function _enqueueProposals(recs, correlationId) {
    if (!Array.isArray(recs) || recs.length === 0) return 0;
    if (typeof ActionQueue === 'undefined' || !ActionQueue.enqueue) {
      try { CalibrationAudit.logError('ActionQueue unavailable for enqueue'); } catch (e) { /* ignore */ }
      return 0;
    }

    var count = 0;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var enqueued = ActionQueue.enqueue({
        correlationId: correlationId,
        source: 'calibration',
        proposedBy: 'calibration_loop_v1',
        actionType: 'system_adjustment',
        targetId: r.target,
        payload: { type: r.type, target: r.target, proposedChange: r.proposedChange },
        riskLevel: r.riskLevel || 'medium',
        requiresApproval: true,
        requiresVerification: false,
        verification: null
      });
      if (enqueued) count++;
    }
    return count;
  }

  // ═══════════════════════════════════════════════════
  // ── Artifact access ──
  // ═══════════════════════════════════════════════════
  function _storeArtifact(artifact) {
    try { localStorage.setItem(ARTIFACT_KEY, JSON.stringify(artifact)); }
    catch (e) { console.warn('[CalibrationLoop] Artifact write failed'); }
  }

  function getLatestArtifact() {
    try {
      var raw = localStorage.getItem(ARTIFACT_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  // ── Helpers ──
  function _round(val) { return Math.round(val * 100) / 100; }
  function _pct(val) { return val !== null ? Math.round(val * 100) + '%' : 'N/A'; }

  return {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    getCadenceDays: getCadenceDays,
    getLastRunTimestamp: getLastRunTimestamp,
    shouldAutoRun: shouldAutoRun,
    loadRules: loadRules,
    run: run,
    getLatestArtifact: getLatestArtifact,
    THRESHOLDS: THRESHOLDS,
    CAPS: CAPS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalibrationLoop;
}
