// priority-audit.js — Priority Engine v1: Append-only audit log for priority scoring events
// Storage key: ap_priority_audit
// All entries are immutable once written.

var PriorityAudit = (function () {
  'use strict';

  var STORAGE_KEY = 'ap_priority_audit';
  var MAX_ENTRIES = 500;

  // ── Core append ──
  function append(event) {
    if (!event || !event.eventType) return;
    var entry = {
      timestamp: new Date().toISOString(),
      eventType: event.eventType,
      taskId: event.taskId || null,
      previousBucket: event.previousBucket || null,
      newBucket: event.newBucket || null,
      score: event.score != null ? event.score : null,
      breakdown: event.breakdown || null,
      reason: event.reason || null
    };
    var log = _read();
    log.push(entry);
    if (log.length > MAX_ENTRIES) log = log.slice(-MAX_ENTRIES);
    _write(log);
    if (typeof CompanyStoreAdapter !== 'undefined' && CompanyStoreAdapter.bufferAudit) CompanyStoreAdapter.bufferAudit('priority', entry);
    return entry;
  }

  // ── Query helpers ──
  function getAll() { return _read(); }

  function getRecent(count) {
    var log = _read();
    return log.slice(-(count || 20));
  }

  function getByTask(taskId, limit) {
    var filtered = _read().filter(function (e) { return e.taskId === taskId; });
    if (limit) filtered = filtered.slice(-limit);
    return filtered;
  }

  function getChanges(limit) {
    var filtered = _read().filter(function (e) { return e.eventType === 'priority_changed'; });
    if (limit) filtered = filtered.slice(-limit);
    return filtered;
  }

  function getSince(isoDate) {
    var ts = new Date(isoDate).getTime();
    return _read().filter(function (e) { return new Date(e.timestamp).getTime() >= ts; });
  }

  // ── Lifecycle event shortcuts ──
  function logEvaluated(taskId, score, bucket, breakdown) {
    return append({ eventType: 'priority_evaluated', taskId: taskId, score: score, newBucket: bucket, breakdown: breakdown });
  }

  function logChanged(taskId, previousBucket, newBucket, score, breakdown) {
    return append({ eventType: 'priority_changed', taskId: taskId, previousBucket: previousBucket, newBucket: newBucket, score: score, breakdown: breakdown });
  }

  function logError(reason) {
    return append({ eventType: 'priority_engine_error', reason: reason || 'Evaluation failed' });
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
      catch (e) { console.warn('[PriorityAudit] Storage write failed'); }
    }
  }

  return {
    append: append,
    getAll: getAll,
    getRecent: getRecent,
    getByTask: getByTask,
    getChanges: getChanges,
    getSince: getSince,
    logEvaluated: logEvaluated,
    logChanged: logChanged,
    logError: logError
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PriorityAudit;
}
