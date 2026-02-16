// action-audit.js — Append-only audit log for Action Router v1
// Storage key: ap_action_audit
// All entries are immutable once written.

var ActionAudit = (function () {
  'use strict';

  var STORAGE_KEY = 'ap_action_audit';
  var MAX_ENTRIES = 500;

  function _makeEventId(e) { return 'action_' + (e.timestamp || Date.now()) + '_' + (e.correlationId || '') + '_' + Math.random().toString(36).slice(2, 8); }

  // ── Core append ──
  function append(event) {
    if (!event || !event.eventType) return;
    var entry = {
      eventId: event.eventId || null,
      timestamp: new Date().toISOString(),
      eventType: event.eventType,
      actionId: event.actionId || null,
      actionType: event.actionType || null,
      riskLevel: event.riskLevel || null,
      targetId: event.targetId || null,
      correlationId: event.correlationId || null,
      source: event.source || 'ActionRouter',
      durationMs: event.durationMs || null,
      reason: event.reason || null,
      meta: event.meta || null
    };
    if (!entry.eventId) entry.eventId = _makeEventId(entry);
    var log = _read();
    log.push(entry);
    if (log.length > MAX_ENTRIES) log = log.slice(-MAX_ENTRIES);
    _write(log);
    if (typeof CompanyStoreAdapter !== 'undefined' && CompanyStoreAdapter.bufferAudit) CompanyStoreAdapter.bufferAudit('action', entry);
    return entry;
  }

  // ── Query helpers ──
  function getAll() { return _read(); }

  function getRecent(count) {
    var log = _read();
    return log.slice(-(count || 20));
  }

  function getByCorrelation(correlationId) {
    return _read().filter(function (e) { return e.correlationId === correlationId; });
  }

  function getByType(eventType, limit) {
    var log = _read();
    var filtered = log.filter(function (e) { return e.eventType === eventType; });
    if (limit) filtered = filtered.slice(-limit);
    return filtered;
  }

  function getByActionType(actionType, limit) {
    var log = _read();
    var filtered = log.filter(function (e) { return e.actionType === actionType; });
    if (limit) filtered = filtered.slice(-limit);
    return filtered;
  }

  function getSince(isoDate) {
    var ts = new Date(isoDate).getTime();
    return _read().filter(function (e) { return new Date(e.timestamp).getTime() >= ts; });
  }

  // ── Lifecycle event shortcuts ──
  function logEnqueued(actionId, actionType, riskLevel, targetId, correlationId, source) {
    return append({ eventType: 'action_enqueued', actionId: actionId, actionType: actionType, riskLevel: riskLevel, targetId: targetId, correlationId: correlationId, source: source });
  }

  function logBlocked(actionId, actionType, riskLevel, targetId, correlationId, reason) {
    return append({ eventType: 'action_blocked', actionId: actionId, actionType: actionType, riskLevel: riskLevel, targetId: targetId, correlationId: correlationId, reason: reason });
  }

  function logApproved(actionId, actionType, targetId, correlationId, approver) {
    return append({ eventType: 'action_approved', actionId: actionId, actionType: actionType, targetId: targetId, correlationId: correlationId, meta: { approvedBy: approver } });
  }

  function logRejected(actionId, actionType, targetId, correlationId, approver, reason) {
    return append({ eventType: 'action_rejected', actionId: actionId, actionType: actionType, targetId: targetId, correlationId: correlationId, reason: reason, meta: { rejectedBy: approver } });
  }

  function logStarted(actionId, actionType, targetId, correlationId) {
    return append({ eventType: 'action_started', actionId: actionId, actionType: actionType, targetId: targetId, correlationId: correlationId });
  }

  function logSucceeded(actionId, actionType, targetId, correlationId, durationMs) {
    return append({ eventType: 'action_succeeded', actionId: actionId, actionType: actionType, targetId: targetId, correlationId: correlationId, durationMs: durationMs });
  }

  function logFailed(actionId, actionType, targetId, correlationId, reason, durationMs) {
    return append({ eventType: 'action_failed', actionId: actionId, actionType: actionType, targetId: targetId, correlationId: correlationId, reason: reason, durationMs: durationMs });
  }

  // ── Kill switch audit events (debounced externally) ──
  function logActionsEnabled(source) {
    return append({ eventType: 'actions_enabled', source: source || 'CONFIG_UI' });
  }

  function logActionsDisabled(source) {
    return append({ eventType: 'actions_disabled', source: source || 'CONFIG_UI' });
  }

  function logUnknownAction(actionType, correlationId, source) {
    return append({ eventType: 'action_blocked', actionType: actionType, correlationId: correlationId, source: source, reason: 'unknown_action_type' });
  }

  // ── Batch audit events (v1.5) ──
  function logBatchApproved(count, groupId, approver) {
    return append({ eventType: 'action_batch_approved', meta: { count: count, groupId: groupId, approvedBy: approver || 'CEO' } });
  }

  function logBatchRejected(count, groupId, approver, reason) {
    return append({ eventType: 'action_batch_rejected', reason: reason, meta: { count: count, groupId: groupId, rejectedBy: approver || 'CEO' } });
  }

  // ── Internal storage ──
  function _read() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return [];
  }

  function _write(log) {
    if (typeof StorageManager !== 'undefined' && StorageManager.safeSet) {
      StorageManager.safeSet(STORAGE_KEY, log);
    } else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)); }
      catch (e) { console.warn('[ActionAudit] Storage write failed'); }
    }
  }

  return {
    append: append,
    getAll: getAll,
    getRecent: getRecent,
    getByCorrelation: getByCorrelation,
    getByType: getByType,
    getByActionType: getByActionType,
    getSince: getSince,
    logEnqueued: logEnqueued,
    logBlocked: logBlocked,
    logApproved: logApproved,
    logRejected: logRejected,
    logStarted: logStarted,
    logSucceeded: logSucceeded,
    logFailed: logFailed,
    logActionsEnabled: logActionsEnabled,
    logActionsDisabled: logActionsDisabled,
    logUnknownAction: logUnknownAction,
    logBatchApproved: logBatchApproved,
    logBatchRejected: logBatchRejected
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionAudit;
}
