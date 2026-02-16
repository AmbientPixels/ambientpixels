// worker-audit.js — Append-only audit log for Worker Framework v1
// Storage key: ap_worker_audit
// All entries are immutable once written.

var WorkerAudit = (function () {
  'use strict';

  var STORAGE_KEY = 'ap_worker_audit';
  var MAX_ENTRIES = 500;

  // ── Core append ──
  function append(event) {
    if (!event || !event.eventType) return;
    var entry = {
      timestamp: new Date().toISOString(),
      eventType: event.eventType,
      workerType: event.workerType || null,
      owner: event.owner || null,
      correlationId: event.correlationId || null,
      counts: event.counts || null,
      durationMs: event.durationMs || null,
      reason: event.reason || null,
      source: event.source || 'WorkerManager',
      meta: event.meta || null
    };
    var log = _read();
    log.push(entry);
    if (log.length > MAX_ENTRIES) log = log.slice(-MAX_ENTRIES);
    _write(log);
    return entry;
  }

  // ── Query helpers ──
  function getAll() {
    return _read();
  }

  function getRecent(count) {
    var log = _read();
    return log.slice(-(count || 20));
  }

  function getByType(eventType, limit) {
    var log = _read();
    var filtered = log.filter(function (e) { return e.eventType === eventType; });
    if (limit) filtered = filtered.slice(-limit);
    return filtered;
  }

  function getByCorrelation(correlationId) {
    return _read().filter(function (e) { return e.correlationId === correlationId; });
  }

  function getByWorkerType(workerType, limit) {
    var log = _read();
    var filtered = log.filter(function (e) { return e.workerType === workerType; });
    if (limit) filtered = filtered.slice(-limit);
    return filtered;
  }

  function getSince(isoDate) {
    var ts = new Date(isoDate).getTime();
    return _read().filter(function (e) { return new Date(e.timestamp).getTime() >= ts; });
  }

  // ── Lifecycle event shortcuts ──
  function logSpawned(workerType, owner, correlationId) {
    return append({ eventType: 'spawned', workerType: workerType, owner: owner, correlationId: correlationId });
  }

  function logStarted(workerType, owner, correlationId, itemCount) {
    return append({ eventType: 'started', workerType: workerType, owner: owner, correlationId: correlationId, counts: { itemsProcessed: itemCount || 0 } });
  }

  function logReported(workerType, owner, correlationId, itemCount, durationMs) {
    return append({ eventType: 'reported', workerType: workerType, owner: owner, correlationId: correlationId, counts: { itemsProcessed: itemCount || 0 }, durationMs: durationMs });
  }

  function logTerminated(workerType, owner, correlationId, reason, durationMs) {
    return append({ eventType: 'terminated', workerType: workerType, owner: owner, correlationId: correlationId, reason: reason || 'normal', durationMs: durationMs });
  }

  function logTimeout(workerType, owner, correlationId, durationMs) {
    return append({ eventType: 'timeout', workerType: workerType, owner: owner, correlationId: correlationId, reason: 'ttl_exceeded', durationMs: durationMs });
  }

  function logBudgetExceeded(workerType, owner, correlationId) {
    return append({ eventType: 'budget_exceeded', workerType: workerType, owner: owner, correlationId: correlationId, reason: 'budget_exceeded' });
  }

  function logError(workerType, owner, correlationId, reason) {
    return append({ eventType: 'error', workerType: workerType, owner: owner, correlationId: correlationId, reason: reason || 'unknown_error' });
  }

  // ── CEO Kill Switch audit events ──
  function logWorkersEnabled(source) {
    return append({ eventType: 'workers_enabled', source: source || 'CONFIG_UI', meta: { previousState: false, newState: true } });
  }

  function logWorkersDisabled(source) {
    return append({ eventType: 'workers_disabled', source: source || 'CONFIG_UI', meta: { previousState: true, newState: false } });
  }

  function logWorkersTerminated(count, source) {
    return append({ eventType: 'workers_terminated', source: source || 'WorkerManager', reason: 'disabled_by_ceo', counts: { terminated: count }, meta: { previousState: true, newState: false } });
  }

  function logRegistryError(reason) {
    return append({ eventType: 'workers_disabled_registry_error', source: 'WorkerManager', reason: reason || 'registry_load_failed' });
  }

  // ── Latest reports query ──
  function getLatestReports(limit) {
    return getByType('reported', limit || 10);
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
      catch (e) { console.warn('[WorkerAudit] Storage write failed'); }
    }
  }

  return {
    append: append,
    getAll: getAll,
    getRecent: getRecent,
    getByType: getByType,
    getByCorrelation: getByCorrelation,
    getByWorkerType: getByWorkerType,
    getSince: getSince,
    getLatestReports: getLatestReports,
    logSpawned: logSpawned,
    logStarted: logStarted,
    logReported: logReported,
    logTerminated: logTerminated,
    logTimeout: logTimeout,
    logBudgetExceeded: logBudgetExceeded,
    logError: logError,
    logWorkersEnabled: logWorkersEnabled,
    logWorkersDisabled: logWorkersDisabled,
    logWorkersTerminated: logWorkersTerminated,
    logRegistryError: logRegistryError
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkerAudit;
}
