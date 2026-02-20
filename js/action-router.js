// action-router.js — Action Router v1: Governed Execution Layer
// Depends on: ActionAudit, ActionQueue, ActionExecutors, TaskVerifier (optional)
// Safe-by-default: actionsEnabled defaults to FALSE.
// Autonomy Controls: channel ON = autonomous, channel OFF = CEO approval required.

var ActionRouter = (function () {
  'use strict';

  // ── Kill switch storage keys ──
  var KEYS = {
    global: 'ap_actions_enabled',
    task: 'ap_actions_task_enabled',
    social: 'ap_actions_social_enabled',
    content: 'ap_actions_content_enabled',
    email: 'ap_actions_email_enabled',
    git: 'ap_actions_git_enabled',
    configChanges: 'ap_config_changes_enabled',
    autoPromote: 'ap_auto_promote_enabled'
  };

  // ── Defaults (SAFE — all external channels OFF = CEO approval) ──
  var DEFAULTS = { global: false, task: true, social: false, content: false, email: false, git: false, configChanges: false, autoPromote: false };

  // ── Execution caps ──
  var MAX_PER_CYCLE = 5;
  var MAX_ATTEMPTS = 2;

  // ── Registry cache ──
  var _registry = null;
  var _registryPromise = null;

  // ── Debounce for kill switch audit ──
  var _lastKillAuditTs = 0;
  var KILL_DEBOUNCE_MS = 5000;

  // ═══════════════════════════════════════════════════
  // ── Kill Switches ──
  // ═══════════════════════════════════════════════════
  function _getSetting(key, defaultVal) {
    try {
      var val = localStorage.getItem(key);
      if (val === null) return defaultVal;
      return val === 'true';
    } catch (e) { return defaultVal; }
  }

  function _setSetting(key, val) {
    try { localStorage.setItem(key, String(!!val)); } catch (e) { /* ignore */ }
  }

  function isEnabled() { return _getSetting(KEYS.global, DEFAULTS.global); }
  function isTaskEnabled() { return _getSetting(KEYS.task, DEFAULTS.task); }
  function isSocialEnabled() { return _getSetting(KEYS.social, DEFAULTS.social); }
  function isContentEnabled() { return _getSetting(KEYS.content, DEFAULTS.content); }
  function isEmailEnabled() { return _getSetting(KEYS.email, DEFAULTS.email); }
  function isGitEnabled() { return _getSetting(KEYS.git, DEFAULTS.git); }
  function isConfigChangesEnabled() { return _getSetting(KEYS.configChanges, DEFAULTS.configChanges); }
  function isAutoPromoteEnabled() { return _getSetting(KEYS.autoPromote, DEFAULTS.autoPromote); }

  function setEnabled(val, source) {
    var prev = isEnabled();
    var next = !!val;
    _setSetting(KEYS.global, next);
    if (prev !== next) {
      var now = Date.now();
      if (now - _lastKillAuditTs > KILL_DEBOUNCE_MS) {
        _lastKillAuditTs = now;
        if (next) ActionAudit.logActionsEnabled(source || 'CONFIG_UI');
        else ActionAudit.logActionsDisabled(source || 'CONFIG_UI');
      }
    }
    return next;
  }

  function setTaskEnabled(val) { _setSetting(KEYS.task, val); }
  function setSocialEnabled(val) { _setSetting(KEYS.social, val); }
  function setContentEnabled(val) { _setSetting(KEYS.content, val); }
  function setEmailEnabled(val) { _setSetting(KEYS.email, val); }
  function setGitEnabled(val) { _setSetting(KEYS.git, val); }

  function setConfigChangesEnabled(val, source) {
    var prev = isConfigChangesEnabled();
    var next = !!val;
    _setSetting(KEYS.configChanges, next);
    if (prev !== next) {
      var now = Date.now();
      if (now - _lastKillAuditTs > KILL_DEBOUNCE_MS) {
        _lastKillAuditTs = now;
        if (typeof ActionAudit !== 'undefined') {
          ActionAudit.append({ eventType: next ? 'config_changes_enabled' : 'config_changes_disabled', source: source || 'CONFIG_UI' });
        }
      }
    }
    return next;
  }

  function setAutoPromoteEnabled(val, source) {
    var prev = isAutoPromoteEnabled();
    var next = !!val;
    _setSetting(KEYS.autoPromote, next);
    if (prev !== next) {
      var now = Date.now();
      if (now - _lastKillAuditTs > KILL_DEBOUNCE_MS) {
        _lastKillAuditTs = now;
        if (typeof ActionAudit !== 'undefined') {
          ActionAudit.append({ eventType: next ? 'auto_promote_enabled' : 'auto_promote_disabled', source: source || 'CONFIG_UI' });
        }
      }
    }
    return next;
  }

  // Tool kill switch check by executor type
  function _isToolEnabled(executorType) {
    switch (executorType) {
      case 'task': return isTaskEnabled();
      case 'social': return isSocialEnabled();
      case 'content': return isContentEnabled();
      case 'email': return isEmailEnabled();
      case 'git': return isGitEnabled();
      case 'system': return isConfigChangesEnabled();
      default: return false;
    }
  }

  // ═══════════════════════════════════════════════════
  // ── Registry ──
  // ═══════════════════════════════════════════════════
  function loadRegistry() {
    if (_registryPromise) return _registryPromise;
    _registryPromise = fetch('/data/company-actions.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.actions)) throw new Error('Invalid registry');
        _registry = {};
        data.actions.forEach(function (a) { _registry[a.id] = a; });
        return _registry;
      })
      .catch(function () {
        _registry = null;
        _registryPromise = null;
        return null;
      });
    return _registryPromise;
  }

  function getActionDef(actionType) {
    return (_registry && _registry[actionType]) || null;
  }

  function getRegistryCounts() {
    if (!_registry) return { enabled: 0, disabled: 0, total: 0 };
    var keys = Object.keys(_registry);
    var enabled = keys.filter(function (k) { return _registry[k].enabled; }).length;
    return { enabled: enabled, disabled: keys.length - enabled, total: keys.length };
  }

  // ═══════════════════════════════════════════════════
  // ── routeProposal() ──
  // ═══════════════════════════════════════════════════
  function routeProposal(proposal, taskContext) {
    if (!proposal || !proposal.actionType) {
      ActionAudit.logUnknownAction('(empty)', proposal && proposal.correlationId, proposal && proposal.source);
      return null;
    }

    var def = getActionDef(proposal.actionType);

    // Unknown action type → reject + audit
    if (!def) {
      ActionAudit.logUnknownAction(proposal.actionType, proposal.correlationId, proposal.source);
      return null;
    }

    // Disabled in registry
    if (!def.enabled) {
      ActionAudit.logBlocked(null, proposal.actionType, def.riskLevel, proposal.targetId, proposal.correlationId, 'action_type_disabled');
      return null;
    }

    // Build queue item
    var queueItem = {
      correlationId: proposal.correlationId || null,
      source: proposal.source || 'system',
      proposedBy: proposal.proposedBy || null,
      actionType: proposal.actionType,
      targetId: proposal.targetId || null,
      payload: proposal.payload || {},
      riskLevel: def.riskLevel,
      requiresApproval: def.requiresApproval,
      requiresVerification: def.requiresVerification,
      verification: null
    };

    // Verification gate (if required)
    if (def.requiresVerification && taskContext) {
      if (typeof TaskVerifier !== 'undefined' && TaskVerifier.isLoaded && TaskVerifier.isLoaded()) {
        var vResult = TaskVerifier.verify(taskContext);
        queueItem.verification = {
          status: vResult.status,
          reasons: vResult.reasons,
          riskLevel: vResult.riskLevel,
          requiresApproval: vResult.requiresApproval
        };

        // If verification fails and action implies completion → block
        if (proposal.actionType === 'move_task_to_done' && vResult.status !== 'pass') {
          var blockedItem = ActionQueue.enqueue(queueItem);
          if (blockedItem) {
            ActionQueue.markBlocked(blockedItem.id, 'Verification ' + vResult.status + ': ' + (vResult.reasons[0] || 'incomplete'));
            ActionAudit.logBlocked(blockedItem.id, proposal.actionType, def.riskLevel, proposal.targetId, proposal.correlationId, 'verification_' + vResult.status);
          }
          return blockedItem;
        }
      }
    }

    // Autonomy Controls: channel ON = autonomous, channel OFF = CEO approval
    // When channel is ON, use the registry's requiresApproval setting.
    // When channel is OFF, force CEO approval regardless of registry.
    var channelAutonomous = isEnabled() && _isToolEnabled(def.executor);
    if (channelAutonomous && !def.requiresApproval) {
      queueItem.requiresApproval = false; // → autonomous execution
    } else {
      queueItem.requiresApproval = true;  // → CEO approval queue
    }

    var enqueued = ActionQueue.enqueue(queueItem);
    if (enqueued) {
      ActionAudit.logEnqueued(enqueued.id, proposal.actionType, def.riskLevel, proposal.targetId, proposal.correlationId, proposal.source);
      // Bridge: also write to AgentEngine actions store so Actions page sees it
      if (typeof AgentEngine !== 'undefined' && AgentEngine.getActions) {
        try {
          var actions = AgentEngine.getActions();
          var exists = actions.some(function (a) { return a.id === enqueued.id; });
          if (!exists) {
            actions.push({
              id: enqueued.id,
              type: enqueued.actionType || 'unknown',
              created_by: enqueued.source || 'planner',
              created_at: enqueued.createdAt || new Date().toISOString(),
              platform: 'internal',
              classification: enqueued.classification || 'operational',
              risk_level: def.riskLevel || 'low',
              requires_ceo_approval: !!enqueued.requiresApproval,
              payload: enqueued.payload || {},
              target_id: enqueued.targetId || null,
              correlationId: enqueued.correlationId || null,
              approval: { status: enqueued.requiresApproval ? 'pending' : 'approved', approvedBy: null, approvedAt: null },
              execution: { status: 'pending', started_at: null, completed_at: null, attempts: 0 },
              execution_status: 'pending'
            });
            if (actions.length > 500) actions = actions.slice(-500);
            localStorage.setItem('ap_actions', JSON.stringify(actions));
          }
        } catch (e) { console.warn('[ActionRouter] Bridge sync error:', e.message); }
      }
    }
    return enqueued;
  }

  // ═══════════════════════════════════════════════════
  // ── approve / reject ──
  // ═══════════════════════════════════════════════════
  function _syncActionStatus(id, approvalStatus, approver, reason) {
    if (typeof AgentEngine === 'undefined' || !AgentEngine.getActions) return;
    try {
      var actions = AgentEngine.getActions();
      for (var i = 0; i < actions.length; i++) {
        if (actions[i].id === id) {
          actions[i].approval = actions[i].approval || {};
          actions[i].approval.status = approvalStatus;
          actions[i].approval.approvedBy = approver || 'CEO';
          actions[i].approval.approvedAt = new Date().toISOString();
          if (reason) actions[i].approval.reason = reason;
          actions[i].execution_status = approvalStatus === 'approved' ? 'approved' : approvalStatus;
          localStorage.setItem('ap_actions', JSON.stringify(actions));
          break;
        }
      }
    } catch (e) { console.warn('[ActionRouter] Status sync error:', e.message); }
  }

  function approve(id, approver) {
    var item = ActionQueue.approve(id, approver || 'CEO');
    if (item) {
      ActionAudit.logApproved(item.id, item.actionType, item.targetId, item.correlationId, approver || 'CEO');
      _syncActionStatus(item.id, 'approved', approver);
    }
    return item;
  }

  function reject(id, approver, reason) {
    var item = ActionQueue.reject(id, approver || 'CEO', reason);
    if (item) {
      ActionAudit.logRejected(item.id, item.actionType, item.targetId, item.correlationId, approver || 'CEO', reason || 'Rejected');
      _syncActionStatus(item.id, 'rejected', approver, reason);
    }
    return item;
  }

  // ═══════════════════════════════════════════════════
  // ── Batch approve / reject (v1.5) ──
  // ═══════════════════════════════════════════════════
  function approveGroup(groupId, approver) {
    var groups = ActionQueue.getPendingGroups();
    var group = null;
    for (var i = 0; i < groups.length; i++) { if (groups[i].groupId === groupId) { group = groups[i]; break; } }
    if (!group) return { approved: 0, skipped: 0 };
    var ids = group.items.map(function (it) { return it.id; });
    var result = ActionQueue.approveMany(ids, approver || 'CEO');
    if (result.approved > 0) ActionAudit.logBatchApproved(result.approved, groupId, approver || 'CEO');
    return result;
  }

  function rejectGroup(groupId, approver, reason) {
    var groups = ActionQueue.getPendingGroups();
    var group = null;
    for (var i = 0; i < groups.length; i++) { if (groups[i].groupId === groupId) { group = groups[i]; break; } }
    if (!group) return { rejected: 0, skipped: 0 };
    var ids = group.items.map(function (it) { return it.id; });
    var result = ActionQueue.rejectMany(ids, approver || 'CEO', reason);
    if (result.rejected > 0) ActionAudit.logBatchRejected(result.rejected, groupId, approver || 'CEO', reason);
    return result;
  }

  function approveAllLowRisk(approver) {
    var pending = ActionQueue.getPendingApproval();
    var ids = [];
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].riskLevel === 'low') ids.push(pending[i].id);
    }
    if (ids.length === 0) return { approved: 0, skipped: 0 };
    var result = ActionQueue.approveMany(ids, approver || 'CEO');
    if (result.approved > 0) ActionAudit.logBatchApproved(result.approved, 'all_low_risk', approver || 'CEO');
    return result;
  }

  // ═══════════════════════════════════════════════════
  // ── evaluateAndRun() ──
  // ═══════════════════════════════════════════════════
  function evaluateAndRun() {
    // Global kill switch
    if (!isEnabled()) {
      return { ran: 0, reason: 'actions_disabled' };
    }

    var ready = ActionQueue.getReady(MAX_PER_CYCLE);
    if (ready.length === 0) return { ran: 0, reason: 'queue_empty' };

    // Priority Engine v1 — sort by target task priority score DESC
    try {
      if (typeof PriorityEngine !== 'undefined' && PriorityEngine.getCached) {
        ready.sort(function (a, b) {
          var sa = (a.targetId && PriorityEngine.getCached(a.targetId)) ? PriorityEngine.getCached(a.targetId).score : 0;
          var sb = (b.targetId && PriorityEngine.getCached(b.targetId)) ? PriorityEngine.getCached(b.targetId).score : 0;
          return sb - sa;
        });
      }
    } catch (e) { /* fail closed — use original order */ }

    var executed = 0;

    for (var i = 0; i < ready.length; i++) {
      var item = ready[i];

      // Tool kill switch
      var def = getActionDef(item.actionType);
      if (!def || !_isToolEnabled(def.executor)) {
        ActionQueue.markBlocked(item.id, 'Tool disabled: ' + (def ? def.executor : 'unknown'));
        ActionAudit.logBlocked(item.id, item.actionType, item.riskLevel, item.targetId, item.correlationId, 'tool_disabled');
        continue;
      }

      // Retry limit
      if ((item.attempts || 0) >= MAX_ATTEMPTS) {
        ActionQueue.markFailed(item.id, 'Max retry attempts reached');
        ActionAudit.logFailed(item.id, item.actionType, item.targetId, item.correlationId, 'max_retries', null);
        continue;
      }

      // Execute
      ActionQueue.markExecuting(item.id);
      ActionAudit.logStarted(item.id, item.actionType, item.targetId, item.correlationId);
      var startMs = Date.now();

      try {
        var result = ActionExecutors.execute(item);
        var durationMs = Date.now() - startMs;

        if (result && result.success) {
          ActionQueue.markExecuted(item.id);
          ActionAudit.logSucceeded(item.id, item.actionType, item.targetId, item.correlationId, durationMs);
          executed++;
        } else {
          var reason = (result && result.reason) || 'Unknown execution failure';
          ActionQueue.incrementAttempts(item.id);
          if ((item.attempts || 0) + 1 >= MAX_ATTEMPTS) {
            ActionQueue.markFailed(item.id, reason);
          } else {
            // Return to approved_ready for retry
            ActionQueue.markFailed(item.id, reason);
          }
          ActionAudit.logFailed(item.id, item.actionType, item.targetId, item.correlationId, reason, durationMs);
        }
      } catch (e) {
        var errReason = 'Executor error';
        ActionQueue.markFailed(item.id, errReason);
        ActionAudit.logFailed(item.id, item.actionType, item.targetId, item.correlationId, errReason, Date.now() - startMs);
      }
    }

    return { ran: executed, reason: executed > 0 ? 'ok' : 'no_successful_runs' };
  }

  // ═══════════════════════════════════════════════════
  // ── UI helpers ──
  // ═══════════════════════════════════════════════════
  function getPendingCount() { return ActionQueue.countByStatus('pending_approval'); }
  function getExecutedTodayCount() { return ActionQueue.getExecutedToday().length; }
  function getBlockedCount() { return ActionQueue.countByStatus('blocked'); }

  return {
    // Autonomy Controls
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    isTaskEnabled: isTaskEnabled,
    setTaskEnabled: setTaskEnabled,
    isSocialEnabled: isSocialEnabled,
    setSocialEnabled: setSocialEnabled,
    isContentEnabled: isContentEnabled,
    setContentEnabled: setContentEnabled,
    isEmailEnabled: isEmailEnabled,
    setEmailEnabled: setEmailEnabled,
    isGitEnabled: isGitEnabled,
    setGitEnabled: setGitEnabled,
    isConfigChangesEnabled: isConfigChangesEnabled,
    setConfigChangesEnabled: setConfigChangesEnabled,
    isAutoPromoteEnabled: isAutoPromoteEnabled,
    setAutoPromoteEnabled: setAutoPromoteEnabled,
    // Registry
    loadRegistry: loadRegistry,
    getActionDef: getActionDef,
    getRegistryCounts: getRegistryCounts,
    // Core
    routeProposal: routeProposal,
    approve: approve,
    reject: reject,
    approveGroup: approveGroup,
    rejectGroup: rejectGroup,
    approveAllLowRisk: approveAllLowRisk,
    evaluateAndRun: evaluateAndRun,
    // UI helpers
    getPendingCount: getPendingCount,
    getExecutedTodayCount: getExecutedTodayCount,
    getBlockedCount: getBlockedCount,
    // Constants
    MAX_PER_CYCLE: MAX_PER_CYCLE,
    MAX_ATTEMPTS: MAX_ATTEMPTS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionRouter;
}
