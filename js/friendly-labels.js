// friendly-labels.js — Shared label humanizer for AmbientPixels company UI
// Converts snake_case, UPPER_CASE, and raw code labels into friendly display text.
// Usage: FriendlyLabels.actionType('move_task_lane') → 'Move Task'

var FriendlyLabels = (function () {
  'use strict';

  // ── Action Types ──
  var ACTION_TYPES = {
    'move_task_lane': 'Move Task',
    'move_task': 'Move Task',
    'MOVE_TASK_LANE': 'Move Task',
    'MOVE_TASK': 'Move Task',
    'update_task': 'Update Task',
    'create_task': 'Create Task',
    'execute_task': 'Execute Task',
    'review_task': 'Review Task',
    'comment_task': 'Comment',
    'request_info': 'Request Info',
    'REQUEST_INFO': 'Request Info',
    'assign_task': 'Assign Task',
    'reassign': 'Reassign',
    'close_task': 'Close Task',
    'reopen_task': 'Reopen Task',
    'escalate': 'Escalate',
    'delegate': 'Delegate',
    'system_adjustment': 'System Adjustment',
    'schedule_post': 'Schedule Post',
    'publish_document': 'Publish Document',
    'create_social_action': 'Social Post',
    'social_post.schedule': 'Social Post',
    'social_post.publish': 'Social Post',
    'social_post.draft': 'Social Post Draft',
    'social_post.reply': 'Social Reply',
    'send_email': 'Send Email',
    'email.send': 'Send Email',
    'email.draft': 'Email Draft',
    'create_document': 'Create Document',
    'create-doc': 'Create Document',
    'submit-for-publish': 'Submit for Publishing',
    'flag_task': 'Flag Task',
    'git.open_pr': 'Open PR',
    'git.deploy': 'Deploy',
    'git.pr': 'Pull Request',
    'web_search': 'Web Search',
    'create-task': 'Create Task',
    'update-task': 'Update Task',
    'move-task': 'Move Task',
    'execute-task': 'Execute Task',
    'review-task': 'Review Task',
    'comment-task': 'Comment',
    'create-social-action': 'Social Post',
    'revise-action': 'Revise Action',
    'create-reminder': 'Create Reminder',
    'update-doc': 'Update Document'
  };

  // ── Execution / Approval Statuses ──
  var STATUSES = {
    'pending': 'Pending',
    'pending_approval': 'Pending Approval',
    'approved': 'Approved',
    'approved_ready': 'Ready',
    'rejected': 'Rejected',
    'cancelled': 'Cancelled',
    'revision_requested': 'Revision Requested',
    'running': 'Running',
    'executing': 'Executing',
    'executed': 'Executed',
    'success': 'Completed',
    'failed': 'Failed',
    'blocked': 'Blocked',
    'overridden': 'Overridden',
    'in-progress': 'In Progress',
    'todo': 'To Do',
    'review': 'In Review',
    'done': 'Done',
    'backlog': 'Backlog',
    'active': 'Active',
    'draft': 'Draft',
    'published': 'Published'
  };

  // ── Audit Event Types ──
  var AUDIT_EVENTS = {
    'action_enqueued': 'Action Queued',
    'action_approved': 'Action Approved',
    'action_batch_approved': 'Batch Approved',
    'action_rejected': 'Action Rejected',
    'action_batch_rejected': 'Batch Rejected',
    'action_started': 'Execution Started',
    'action_succeeded': 'Execution Succeeded',
    'action_failed': 'Execution Failed',
    'action_blocked': 'Action Blocked',
    'action_cancelled': 'Action Cancelled',
    'actions_enabled': 'Actions Enabled',
    'actions_disabled': 'Actions Disabled',
    'planner_run_started': 'Planner Started',
    'planner_run_completed': 'Planner Completed',
    'planner_recommendations_enqueued': 'Recommendations Queued',
    'planner_skipped': 'Planner Skipped',
    'planner_error': 'Planner Error',
    'calibration_run_started': 'Calibration Started',
    'calibration_run_completed': 'Calibration Completed',
    'calibration_recommendations_enqueued': 'Calibration Queued',
    'calibration_skipped': 'Calibration Skipped',
    'calibration_error': 'Calibration Error',
    'spawned': 'Worker Spawned',
    'started': 'Worker Started',
    'reported': 'Worker Reported',
    'terminated': 'Worker Terminated',
    'timeout': 'Worker Timeout',
    'budget_exceeded': 'Budget Exceeded',
    'worker_spawned': 'Worker Spawned',
    'worker_run_started': 'Worker Started',
    'worker_run_completed': 'Worker Completed',
    'worker_terminated': 'Worker Terminated',
    'workers_enabled': 'Workers Enabled',
    'workers_disabled': 'Workers Disabled',
    'workers_terminated': 'Workers Terminated'
  };

  // ── Worker Types ──
  var WORKER_TYPES = {
    'heartbeat_executor': 'Heartbeat',
    'action_executor': 'Action Executor',
    'planner_executor': 'Planner',
    'calibration_executor': 'Calibration',
    'social_publisher': 'Social Publisher',
    'document_publisher': 'Document Publisher'
  };

  // ── Generic fallback: snake_case / UPPER_CASE → Title Case ──
  function _titleCase(raw) {
    if (!raw) return '?';
    return raw
      .replace(/[_-]/g, ' ')
      .replace(/\./g, ' — ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();
  }

  // ── Public API ──
  function actionType(raw) {
    if (!raw) return '?';
    return ACTION_TYPES[raw] || ACTION_TYPES[raw.toLowerCase()] || _titleCase(raw);
  }

  function status(raw) {
    if (!raw) return '?';
    return STATUSES[raw] || STATUSES[raw.toLowerCase()] || _titleCase(raw);
  }

  function auditEvent(raw) {
    if (!raw) return '?';
    return AUDIT_EVENTS[raw] || AUDIT_EVENTS[raw.toLowerCase()] || _titleCase(raw);
  }

  function workerType(raw) {
    if (!raw) return '?';
    return WORKER_TYPES[raw] || WORKER_TYPES[raw.toLowerCase()] || _titleCase(raw);
  }

  return {
    actionType: actionType,
    status: status,
    auditEvent: auditEvent,
    workerType: workerType,
    titleCase: _titleCase
  };
})();
