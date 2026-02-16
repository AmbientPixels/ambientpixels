// action-executors.js — Action Router v1: Safe executors with strict allow-lists
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

  return {
    execute: execute,
    SAFE_LANES: SAFE_LANES
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionExecutors;
}
