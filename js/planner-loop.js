// planner-loop.js — Planner Loop v1: Deterministic Weekly Executive Planning
// Propose-only: never mutates tasks, never executes actions.
// Enqueues recommendations as pending_approval into ActionQueue.
// Depends on: PriorityEngine, PriorityAudit, PlannerAudit, ActionQueue, TaskVerifier (optional)

var PlannerLoop = (function () {
  'use strict';

  // ── Storage keys ──
  var PLAN_KEY = 'ap_planner_latest_plan';
  var LAST_RUN_KEY = 'ap_planner_last_run';
  var ENABLED_KEY = 'ap_planner_enabled';
  var CADENCE_KEY = 'ap_planner_cadence_days';

  // ── Defaults ──
  var DEFAULT_ENABLED = false;
  var DEFAULT_CADENCE_DAYS = 7;

  // ── Thresholds (from rules file or defaults) ──
  var THRESHOLDS = {
    stuckInReviewDays: 2,
    stuckInProgressDays: 7,
    pendingApprovalsWarning: 5,
    focusListMax: 5,
    stuckListMax: 5,
    recommendationsMax: 8,
    cadenceDays: 7
  };

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
    return THRESHOLDS.cadenceDays || DEFAULT_CADENCE_DAYS;
  }

  function getLastRunTimestamp() {
    try { return localStorage.getItem(LAST_RUN_KEY) || null; } catch (e) { return null; }
  }

  function _setLastRun(isoTs) {
    try { localStorage.setItem(LAST_RUN_KEY, isoTs); } catch (e) { /* ignore */ }
  }

  // ── Cadence check: is it time to run? ──
  function shouldAutoRun() {
    if (!isEnabled()) return false;
    var last = getLastRunTimestamp();
    if (!last) return true;
    var elapsed = Date.now() - new Date(last).getTime();
    var cadenceMs = getCadenceDays() * 86400000;
    return elapsed >= cadenceMs;
  }

  // ═══════════════════════════════════════════════════
  // ── Load rules (optional, non-blocking) ──
  // ═══════════════════════════════════════════════════
  function loadRules() {
    if (_rulesLoaded) return Promise.resolve(THRESHOLDS);
    return fetch('/data/company-planner-rules.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.thresholds) {
          var t = data.thresholds;
          if (t.stuckInReviewDays) THRESHOLDS.stuckInReviewDays = t.stuckInReviewDays;
          if (t.stuckInProgressDays) THRESHOLDS.stuckInProgressDays = t.stuckInProgressDays;
          if (t.pendingApprovalsWarning) THRESHOLDS.pendingApprovalsWarning = t.pendingApprovalsWarning;
          if (t.focusListMax) THRESHOLDS.focusListMax = t.focusListMax;
          if (t.stuckListMax) THRESHOLDS.stuckListMax = t.stuckListMax;
          if (t.recommendationsMax) THRESHOLDS.recommendationsMax = t.recommendationsMax;
          if (t.cadenceDays) THRESHOLDS.cadenceDays = t.cadenceDays;
        }
        _rulesLoaded = true;
        return THRESHOLDS;
      })
      .catch(function () { _rulesLoaded = true; return THRESHOLDS; });
  }

  // ═══════════════════════════════════════════════════
  // ── run(snapshot) — Main planner entry point ──
  // ═══════════════════════════════════════════════════
  function run(snapshot) {
    snapshot = snapshot || {};
    var runId = 'plan_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
    var now = new Date();
    var nowIso = now.toISOString();

    PlannerAudit.logRunStarted(runId);

    try {
      var tasks = snapshot.tasks || [];
      var nonDone = tasks.filter(function (t) { return t.status !== 'done'; });

      // ── Gather inputs ──
      var laneCounts = _getLaneCounts(tasks);
      var priCounts = { low: 0, medium: 0, high: 0, critical: 0 };
      try { priCounts = PriorityEngine.getCounts(); } catch (e) { /* degrade */ }

      var overdueCount = _countOverdue(nonDone);
      var pendingApprovalsCount = 0;
      try { pendingApprovalsCount = ActionQueue.countByStatus('pending_approval'); } catch (e) { /* degrade */ }

      var verBlockedDone = _countVerificationBlockedDone(nonDone);

      // ── Build summary ──
      var summary = {
        criticalCount: priCounts.critical,
        highCount: priCounts.high,
        overdueCount: overdueCount,
        inReviewCount: laneCounts.review || 0,
        pendingApprovalsCount: pendingApprovalsCount,
        verificationBlockedDoneCount: verBlockedDone
      };

      // ── Focus list (top N by score) ──
      var focus = _buildFocusList(nonDone);

      // ── Stuck list ──
      var stuck = _buildStuckList(nonDone);

      // ── Recommendations ──
      var recommendations = _buildRecommendations(nonDone, summary, focus, stuck);

      // ── Build plan artifact ──
      var plan = {
        id: runId,
        createdAt: nowIso,
        range: {
          startDate: nowIso.substring(0, 10),
          endDate: new Date(now.getTime() + getCadenceDays() * 86400000).toISOString().substring(0, 10)
        },
        summary: summary,
        focus: focus,
        stuck: stuck,
        recommendations: recommendations,
        notes: []
      };

      // ── Store plan ──
      _storePlan(plan);
      _setLastRun(nowIso);

      // ── Enqueue recommendations into ActionQueue ──
      var enqueuedCount = _enqueueRecommendations(recommendations, runId);

      // ── Audit completion ──
      PlannerAudit.logRunCompleted(runId, {
        focusCount: focus.length,
        stuckCount: stuck.length,
        recommendationCount: recommendations.length,
        enqueuedCount: enqueuedCount,
        summary: summary
      });

      if (enqueuedCount > 0) {
        PlannerAudit.logRecommendationsEnqueued(runId, enqueuedCount);
      }

      return plan;

    } catch (e) {
      PlannerAudit.logError('run() threw: ' + (e.message || 'unknown'));
      return null;
    }
  }

  // ═══════════════════════════════════════════════════
  // ── Focus list builder ──
  // ═══════════════════════════════════════════════════
  function _buildFocusList(tasks) {
    var scored = [];
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var cached = null;
      try { cached = PriorityEngine.getCached(t.id); } catch (e) { /* degrade */ }
      var score = cached ? cached.score : 0;
      var bucket = cached ? cached.bucket : 'low';
      if (bucket === 'high' || bucket === 'critical' || score > 8) {
        scored.push({ taskId: t.id, title: t.title || '', score: score, bucket: bucket, rationale: _focusRationale(t, bucket) });
      }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, THRESHOLDS.focusListMax);
  }

  function _focusRationale(task, bucket) {
    var parts = [];
    if (bucket === 'critical') parts.push('Critical priority');
    else if (bucket === 'high') parts.push('High priority');
    if (task.dueDate) {
      var daysUntil = (new Date(task.dueDate).getTime() - Date.now()) / 86400000;
      if (daysUntil < 0) parts.push('overdue');
      else if (daysUntil <= 2) parts.push('due soon');
    }
    if (task.status === 'review') parts.push('in review');
    if (task.blocked) parts.push('blocked');
    return parts.length > 0 ? parts.join(', ') : 'High score';
  }

  // ═══════════════════════════════════════════════════
  // ── Stuck list builder ──
  // ═══════════════════════════════════════════════════
  function _buildStuckList(tasks) {
    var stuck = [];
    var nowMs = Date.now();

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var refDate = t.updatedAt || t.createdAt;
      if (!refDate) continue;
      var ageDays = (nowMs - new Date(refDate).getTime()) / 86400000;

      var isStuck = false;
      var blockerHint = '';

      if (t.status === 'review' && ageDays >= THRESHOLDS.stuckInReviewDays) {
        isStuck = true;
        blockerHint = 'In review for ' + Math.floor(ageDays) + ' days';
      } else if (t.status === 'in-progress' && ageDays >= THRESHOLDS.stuckInProgressDays) {
        isStuck = true;
        blockerHint = 'In progress for ' + Math.floor(ageDays) + ' days';
      }

      if (isStuck) {
        // Add verification fail reason if available
        var vHint = '';
        try {
          if (typeof TaskVerifier !== 'undefined' && TaskVerifier.isLoaded && TaskVerifier.isLoaded()) {
            var vr = TaskVerifier.verify(t);
            if (vr.status === 'fail' && vr.reasons.length > 0) vHint = ' — Verification: ' + vr.reasons[0];
            else if (vr.status === 'manual') vHint = ' — Manual review required';
          }
        } catch (e) { /* degrade */ }

        stuck.push({
          taskId: t.id,
          title: t.title || '',
          lane: t.status,
          ageDays: Math.floor(ageDays),
          blockerHint: blockerHint + vHint
        });
      }
    }

    stuck.sort(function (a, b) { return b.ageDays - a.ageDays; });
    return stuck.slice(0, THRESHOLDS.stuckListMax);
  }

  // ═══════════════════════════════════════════════════
  // ── Recommendation rules (deterministic heuristics) ──
  // ═══════════════════════════════════════════════════
  function _buildRecommendations(tasks, summary, focus, stuck) {
    var recs = [];
    var maxRecs = THRESHOLDS.recommendationsMax;

    // Rule 1: Critical tasks with verification fail/manual → request_info
    for (var i = 0; i < tasks.length && recs.length < maxRecs; i++) {
      var t = tasks[i];
      var cached = null;
      try { cached = PriorityEngine.getCached(t.id); } catch (e) { /* degrade */ }
      if (!cached || cached.bucket !== 'critical') continue;

      var vStatus = null;
      var vReason = '';
      try {
        if (typeof TaskVerifier !== 'undefined' && TaskVerifier.isLoaded && TaskVerifier.isLoaded()) {
          var vr = TaskVerifier.verify(t);
          vStatus = vr.status;
          vReason = vr.reasons.length > 0 ? vr.reasons[0] : '';
        }
      } catch (e) { /* degrade */ }

      if (vStatus === 'fail' || vStatus === 'manual') {
        recs.push({
          id: 'rec_' + recs.length + '_' + t.id,
          type: 'request_info',
          targetId: t.id,
          payload: { missingFields: [], message: 'Critical task missing requirements: ' + (vReason || 'verification incomplete') },
          riskLevel: 'low',
          requiresApproval: true,
          rationale: 'Critical task "' + (t.title || t.id) + '" has verification ' + vStatus,
          priorityBucket: 'critical'
        });
      }
    }

    // Rule 2: Critical tasks stuck in backlog → move to in-progress
    for (var j = 0; j < tasks.length && recs.length < maxRecs; j++) {
      var t2 = tasks[j];
      var c2 = null;
      try { c2 = PriorityEngine.getCached(t2.id); } catch (e) { /* degrade */ }
      if (!c2 || c2.bucket !== 'critical') continue;
      if (t2.status !== 'backlog' && t2.status !== 'todo') continue;

      recs.push({
        id: 'rec_' + recs.length + '_' + t2.id,
        type: 'move_task_lane',
        targetId: t2.id,
        payload: { targetLane: 'in-progress' },
        riskLevel: 'low',
        requiresApproval: true,
        rationale: 'Critical task "' + (t2.title || t2.id) + '" is still in ' + t2.status,
        priorityBucket: 'critical'
      });
    }

    // Rule 3: Tasks stuck in review with verification blocked for done → add_task_comment
    for (var k = 0; k < stuck.length && recs.length < maxRecs; k++) {
      var s = stuck[k];
      if (s.lane !== 'review') continue;

      recs.push({
        id: 'rec_' + recs.length + '_' + s.taskId,
        type: 'add_task_comment',
        targetId: s.taskId,
        payload: { comment: '[Planner] Task stuck in review (' + s.ageDays + 'd). ' + (s.blockerHint || 'Please review requirements.') },
        riskLevel: 'low',
        requiresApproval: true,
        rationale: 'Task "' + (s.title || s.taskId) + '" stuck in review for ' + s.ageDays + ' days',
        priorityBucket: 'high'
      });
    }

    // Rule 4: High pending approvals → create_task to address backlog
    if (summary.pendingApprovalsCount >= THRESHOLDS.pendingApprovalsWarning && recs.length < maxRecs) {
      recs.push({
        id: 'rec_' + recs.length + '_approvals',
        type: 'create_task',
        targetId: null,
        payload: { title: 'Review approvals backlog (' + summary.pendingApprovalsCount + ' pending)', description: 'Planner flagged high pending approval count. Review and action the queue.', priority: 'high', status: 'backlog' },
        riskLevel: 'medium',
        requiresApproval: true,
        rationale: summary.pendingApprovalsCount + ' pending approvals exceeds threshold of ' + THRESHOLDS.pendingApprovalsWarning,
        priorityBucket: 'high'
      });
    }

    // Rule 5: High tasks stuck in progress → request_info
    for (var m = 0; m < stuck.length && recs.length < maxRecs; m++) {
      var sp = stuck[m];
      if (sp.lane !== 'in-progress') continue;

      recs.push({
        id: 'rec_' + recs.length + '_' + sp.taskId,
        type: 'request_info',
        targetId: sp.taskId,
        payload: { missingFields: [], message: 'Task has been in progress for ' + sp.ageDays + ' days. Status update needed.' },
        riskLevel: 'low',
        requiresApproval: true,
        rationale: 'Task "' + (sp.title || sp.taskId) + '" in progress for ' + sp.ageDays + ' days',
        priorityBucket: 'medium'
      });
    }

    return recs.slice(0, maxRecs);
  }

  // ═══════════════════════════════════════════════════
  // ── Enqueue recommendations (pending_approval only) ──
  // ═══════════════════════════════════════════════════
  function _enqueueRecommendations(recs, correlationId) {
    if (!Array.isArray(recs) || recs.length === 0) return 0;
    if (typeof ActionQueue === 'undefined' || !ActionQueue.enqueue) {
      try { PlannerAudit.logError('ActionQueue unavailable for enqueue'); } catch (e) { /* ignore */ }
      return 0;
    }

    var count = 0;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var enqueued = ActionQueue.enqueue({
        correlationId: correlationId,
        source: 'planner',
        proposedBy: 'planner_loop_v1',
        actionType: r.type,
        targetId: r.targetId,
        payload: r.payload,
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
  // ── Helpers ──
  // ═══════════════════════════════════════════════════
  function _getLaneCounts(tasks) {
    var counts = {};
    for (var i = 0; i < tasks.length; i++) {
      var s = tasks[i].status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }

  function _countOverdue(tasks) {
    var now = Date.now();
    var count = 0;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].dueDate && new Date(tasks[i].dueDate).getTime() < now) count++;
    }
    return count;
  }

  function _countVerificationBlockedDone(tasks) {
    var count = 0;
    try {
      if (typeof TaskVerifier === 'undefined' || !TaskVerifier.isLoaded || !TaskVerifier.isLoaded()) return 0;
      for (var i = 0; i < tasks.length; i++) {
        var vr = TaskVerifier.verifyForTransition(tasks[i], 'done');
        if (!vr.allowed) count++;
      }
    } catch (e) { /* degrade */ }
    return count;
  }

  function _storePlan(plan) {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); }
    catch (e) { console.warn('[PlannerLoop] Plan storage write failed'); }
  }

  function getLatestPlan() {
    try {
      var raw = localStorage.getItem(PLAN_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  return {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    getCadenceDays: getCadenceDays,
    getLastRunTimestamp: getLastRunTimestamp,
    shouldAutoRun: shouldAutoRun,
    loadRules: loadRules,
    run: run,
    getLatestPlan: getLatestPlan,
    THRESHOLDS: THRESHOLDS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlannerLoop;
}
