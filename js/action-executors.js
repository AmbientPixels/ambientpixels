// action-executors.js — Action Router v1.1: Safe executors with strict allow-lists
// Each executor validates inputs, enforces safety rules, and returns { success, reason? }
// Never throws raw errors. Never executes unknown actions.

var ActionExecutors = (function () {
  'use strict';

  // ── Lane allow-list for move_task_lane (NEVER includes 'done') ──
  var SAFE_LANES = ['backlog', 'todo', 'in-progress', 'review'];

  // ── Execute an action queue item ──
  // Returns: { success: boolean, reason?: string }
  function execute(item) {
    if (!item || !item.actionType) {
      return { success: false, reason: 'No action type specified' };
    }

    switch (item.actionType) {
      case 'add_task_comment':
        return _execAddComment(item);
      case 'label_task':
        return _execLabelTask(item);
      case 'move_task_lane':
        return _execMoveTaskLane(item);
      case 'request_info':
        return _execRequestInfo(item);
      case 'move_task_to_done':
        return _execMoveTaskToDone(item);
      case 'create_task':
        return _execCreateTask(item);
      case 'delete_task':
        return { success: false, reason: 'Delete task not implemented in v1' };
      case 'publish_social_draft':
        return { success: false, reason: 'Social draft publishing not integrated' };
      case 'publish_social_live':
        return { success: false, reason: 'Social live publishing not integrated' };
      case 'system_adjustment':
        return _execSystemAdjustment(item);
      default:
        return { success: false, reason: 'Unknown executor for action: ' + item.actionType };
    }
  }

  // ── add_task_comment ──
  function _execAddComment(item) {
    var taskId = item.targetId;
    var text = (item.payload && item.payload.comment) || (item.payload && item.payload.text) || '';
    if (!taskId) return { success: false, reason: 'No target task ID' };
    if (!text) return { success: false, reason: 'Empty comment text' };

    if (typeof AgentEngine !== 'undefined' && AgentEngine.addTaskComment) {
      var result = AgentEngine.addTaskComment(taskId, {
        text: text,
        agentId: item.proposedBy || 'system'
      });
      if (result) return { success: true };
      return { success: false, reason: 'Task not found or comment failed' };
    }
    return { success: false, reason: 'AgentEngine not available' };
  }

  // ── label_task (adds tags as comment if no tag model exists) ──
  function _execLabelTask(item) {
    var taskId = item.targetId;
    var labels = (item.payload && item.payload.labels) || [];
    if (!taskId) return { success: false, reason: 'No target task ID' };
    if (!Array.isArray(labels) || labels.length === 0) {
      return { success: false, reason: 'No labels provided' };
    }

    // Try to update task tags if model supports it
    if (typeof AgentEngine !== 'undefined' && AgentEngine.updateTask) {
      var task = AgentEngine.getTaskById ? AgentEngine.getTaskById(taskId) : null;
      if (!task) return { success: false, reason: 'Task not found' };
      var existing = Array.isArray(task.tags) ? task.tags : [];
      var merged = existing.slice();
      labels.forEach(function (l) { if (merged.indexOf(l) === -1) merged.push(l); });
      AgentEngine.updateTask(taskId, { tags: merged });
      return { success: true };
    }
    return { success: false, reason: 'AgentEngine not available' };
  }

  // ── move_task_lane (safe lanes only, NEVER 'done') ──
  function _execMoveTaskLane(item) {
    var taskId = item.targetId;
    var targetLane = (item.payload && item.payload.targetLane) || '';
    if (!taskId) return { success: false, reason: 'No target task ID' };

    if (SAFE_LANES.indexOf(targetLane) === -1) {
      return { success: false, reason: 'Lane "' + targetLane + '" not in safe allow-list' };
    }

    if (typeof AgentEngine !== 'undefined' && AgentEngine.moveTask) {
      AgentEngine.moveTask(taskId, targetLane);
      return { success: true };
    }
    return { success: false, reason: 'AgentEngine not available' };
  }

  // ── request_info (adds a structured comment requesting missing fields) ──
  function _execRequestInfo(item) {
    var taskId = item.targetId;
    var fields = (item.payload && item.payload.missingFields) || [];
    if (!taskId) return { success: false, reason: 'No target task ID' };

    var text = '[Action Router] Information requested';
    if (fields.length > 0) {
      text += ': ' + fields.join(', ');
    }
    if (item.payload && item.payload.message) {
      text += ' — ' + item.payload.message;
    }

    if (typeof AgentEngine !== 'undefined' && AgentEngine.addTaskComment) {
      var result = AgentEngine.addTaskComment(taskId, {
        text: text,
        agentId: item.proposedBy || 'system'
      });
      if (result) return { success: true };
      return { success: false, reason: 'Task not found or comment failed' };
    }
    return { success: false, reason: 'AgentEngine not available' };
  }

  // ── move_task_to_done (STRICTLY requires TaskVerifier PASS) ──
  function _execMoveTaskToDone(item) {
    var taskId = item.targetId;
    if (!taskId) return { success: false, reason: 'No target task ID' };

    // Enforce verification PASS
    if (!item.verification || item.verification.status !== 'pass') {
      return { success: false, reason: 'TaskVerifier PASS required to mark as Done' };
    }

    // Double-check with live verifier
    if (typeof TaskVerifier !== 'undefined' && TaskVerifier.isLoaded && TaskVerifier.isLoaded()) {
      var task = (typeof AgentEngine !== 'undefined' && AgentEngine.getTaskById) ? AgentEngine.getTaskById(taskId) : null;
      if (!task) return { success: false, reason: 'Task not found' };
      var vr = TaskVerifier.verify(task);
      if (vr.status !== 'pass') {
        return { success: false, reason: 'Live verification failed: ' + (vr.reasons[0] || 'incomplete') };
      }
    }

    if (typeof AgentEngine !== 'undefined' && AgentEngine.moveTask) {
      AgentEngine.moveTask(taskId, 'done');
      return { success: true };
    }
    return { success: false, reason: 'AgentEngine not available' };
  }

  // ── create_task ──
  function _execCreateTask(item) {
    var payload = item.payload || {};
    if (!payload.title) return { success: false, reason: 'Task title required' };

    if (typeof AgentEngine !== 'undefined' && AgentEngine.addTask) {
      AgentEngine.addTask({
        title: payload.title,
        description: payload.description || '',
        status: payload.status || 'backlog',
        priority: payload.priority || 'medium',
        assignee: payload.assignee || null,
        division: payload.division || null,
        dueDate: payload.dueDate || null
      });
      return { success: true };
    }
    return { success: false, reason: 'AgentEngine not available' };
  }

  // ═══════════════════════════════════════════════════
  // ── system_adjustment executor v0 ──
  // ═══════════════════════════════════════════════════
  var BACKUP_KEY = 'ap_system_adjustment_backup_latest';
  var FLAGS_KEY = 'ap_action_flags';
  var MAX_FLAGS = 50;

  var ALLOWED_TYPES = ['adjust_priority_weight', 'adjust_planner_threshold', 'flag_action_type'];

  function _execSystemAdjustment(item) {
    // ── Preconditions ──
    if (!item || item.status !== 'approved_ready') {
      return { success: false, reason: 'Item must be approved_ready' };
    }
    if (typeof ActionRouter === 'undefined' || !ActionRouter.isEnabled || !ActionRouter.isEnabled()) {
      return { success: false, reason: 'actionsEnabled is false' };
    }
    if (typeof ActionRouter === 'undefined' || !ActionRouter.isConfigChangesEnabled || !ActionRouter.isConfigChangesEnabled()) {
      return { success: false, reason: 'configChangesEnabled is false' };
    }
    var payload = item.payload;
    if (!payload || !payload.type || !payload.proposedChange) {
      return { success: false, reason: 'Missing payload type or proposedChange' };
    }
    if (ALLOWED_TYPES.indexOf(payload.type) === -1) {
      _auditAdjustment('system_adjustment_blocked', item, null, null, 'Unknown adjustment type: ' + payload.type);
      return { success: false, reason: 'Unknown adjustment type: ' + payload.type };
    }

    // ── Dispatch by type ──
    switch (payload.type) {
      case 'adjust_priority_weight': return _applyPriorityWeight(item);
      case 'adjust_planner_threshold': return _applyPlannerThreshold(item);
      case 'flag_action_type': return _applyFlagActionType(item);
      default: return { success: false, reason: 'Unhandled type' };
    }
  }

  // ── A) adjust_priority_weight ──
  function _applyPriorityWeight(item) {
    if (typeof PriorityEngine === 'undefined' || !PriorityEngine.getWeights || !PriorityEngine.setWeights) {
      _auditAdjustment('system_adjustment_blocked', item, null, null, 'PriorityEngine API unavailable');
      return { success: false, reason: 'PriorityEngine API unavailable' };
    }
    var pc = item.payload.proposedChange;
    var field = pc.field;
    if (!field || (PriorityEngine.WEIGHT_FIELDS || []).indexOf(field) === -1) {
      _auditAdjustment('system_adjustment_blocked', item, null, null, 'Invalid weight field: ' + field);
      return { success: false, reason: 'Invalid weight field: ' + field };
    }
    var before = PriorityEngine.getWeights();
    _writeBackup(item, { priorityWeights: before, plannerThresholds: _safeGetPlannerThresholds() });

    var currentVal = before[field];
    var newVal;
    if (pc.newValue != null) {
      newVal = pc.newValue;
    } else if (pc.delta != null) {
      newVal = currentVal + pc.delta;
    } else {
      _auditAdjustment('system_adjustment_blocked', item, null, null, 'No delta or newValue provided');
      return { success: false, reason: 'No delta or newValue provided' };
    }
    // Bounds: 0–5
    newVal = Math.max(0, Math.min(5, Math.round(newVal * 100) / 100));

    var next = {};
    next[field] = newVal;
    var writeOk = PriorityEngine.setWeights(next);
    if (!writeOk) {
      _auditAdjustment('system_adjustment_failed', item, currentVal, newVal, 'Storage write failed');
      return { success: false, reason: 'Storage write failed' };
    }
    _auditAdjustment('system_adjustment_applied', item, currentVal, newVal, null);
    return { success: true, applied: { field: field, before: currentVal, after: newVal } };
  }

  // ── B) adjust_planner_threshold ──
  function _applyPlannerThreshold(item) {
    if (typeof PlannerLoop === 'undefined' || !PlannerLoop.getThresholds || !PlannerLoop.setThresholds) {
      _auditAdjustment('system_adjustment_blocked', item, null, null, 'PlannerLoop API unavailable');
      return { success: false, reason: 'PlannerLoop API unavailable' };
    }
    var pc = item.payload.proposedChange;
    var field = pc.field;
    var current = PlannerLoop.getThresholds();
    if (!field || current[field] == null) {
      _auditAdjustment('system_adjustment_blocked', item, null, null, 'Invalid threshold field: ' + field);
      return { success: false, reason: 'Invalid threshold field: ' + field };
    }
    var before = _safeGetPriorityWeights();
    _writeBackup(item, { priorityWeights: before, plannerThresholds: current });

    var currentVal = current[field];
    var newVal;
    if (pc.newValue != null) {
      newVal = pc.newValue;
    } else if (pc.delta != null) {
      newVal = currentVal + pc.delta;
    } else {
      _auditAdjustment('system_adjustment_blocked', item, null, null, 'No delta or newValue provided');
      return { success: false, reason: 'No delta or newValue provided' };
    }
    // Use PlannerLoop bounds if available
    var bounds = (PlannerLoop.THRESHOLD_BOUNDS && PlannerLoop.THRESHOLD_BOUNDS[field]);
    if (bounds) {
      newVal = Math.max(bounds.min, Math.min(bounds.max, Math.round(newVal)));
    }

    var next = {};
    next[field] = newVal;
    var writeOk = PlannerLoop.setThresholds(next);
    if (!writeOk) {
      _auditAdjustment('system_adjustment_failed', item, currentVal, newVal, 'Storage write failed');
      return { success: false, reason: 'Storage write failed' };
    }
    _auditAdjustment('system_adjustment_applied', item, currentVal, newVal, null);
    return { success: true, applied: { field: field, before: currentVal, after: newVal } };
  }

  // ── C) flag_action_type (no config mutation) ──
  function _applyFlagActionType(item) {
    var pc = item.payload.proposedChange || {};
    var target = item.payload.target || pc.actionType || 'unknown';
    var note = pc.rationale || pc.note || 'Flagged by calibration';

    // Append to capped flags list
    try {
      var flags = [];
      var raw = localStorage.getItem(FLAGS_KEY);
      if (raw) flags = JSON.parse(raw);
      if (!Array.isArray(flags)) flags = [];
      flags.push({ actionType: target, note: note, createdAt: new Date().toISOString(), actionId: item.id });
      if (flags.length > MAX_FLAGS) flags = flags.slice(-MAX_FLAGS);
      if (typeof StorageManager !== 'undefined' && StorageManager.safeSet) {
        StorageManager.safeSet(FLAGS_KEY, flags);
      } else {
        localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
      }
    } catch (e) { /* best-effort */ }

    _auditAdjustment('system_adjustment_flagged', item, null, target, note);
    return { success: true, applied: { flagged: target, note: note } };
  }

  // ── Backup snapshot ──
  function _writeBackup(item, beforeState) {
    var backup = {
      id: 'backup_' + Date.now().toString(36),
      createdAt: new Date().toISOString(),
      actionId: item.id || null,
      correlationId: item.correlationId || null,
      before: beforeState
    };
    try {
      if (typeof StorageManager !== 'undefined' && StorageManager.safeSet) {
        StorageManager.safeSet(BACKUP_KEY, backup);
      } else {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      }
    } catch (e) { /* best-effort */ }
  }

  function _safeGetPriorityWeights() {
    try { return (typeof PriorityEngine !== 'undefined' && PriorityEngine.getWeights) ? PriorityEngine.getWeights() : null; }
    catch (e) { return null; }
  }

  function _safeGetPlannerThresholds() {
    try { return (typeof PlannerLoop !== 'undefined' && PlannerLoop.getThresholds) ? PlannerLoop.getThresholds() : null; }
    catch (e) { return null; }
  }

  // ── Audit helper ──
  function _auditAdjustment(eventType, item, beforeValue, afterValue, reason) {
    if (typeof ActionAudit === 'undefined' || !ActionAudit.append) return;
    try {
      ActionAudit.append({
        eventType: eventType,
        actionId: item.id || null,
        correlationId: item.correlationId || null,
        adjustmentType: (item.payload && item.payload.type) || null,
        target: (item.payload && item.payload.target) || null,
        field: (item.payload && item.payload.proposedChange && item.payload.proposedChange.field) || null,
        beforeValue: beforeValue,
        afterValue: afterValue,
        reason: reason || null
      });
    } catch (e) { /* fail silent */ }
  }

  return {
    execute: execute,
    SAFE_LANES: SAFE_LANES,
    BACKUP_KEY: BACKUP_KEY
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionExecutors;
}
