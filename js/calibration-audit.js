// calibration-audit.js — Calibration Loop v1: Append-only audit log for calibration events
// Storage key: ap_calibration_audit
// All entries are immutable once written.

var CalibrationAudit = (function () {
  'use strict';

  var STORAGE_KEY = 'ap_calibration_audit';
  var MAX_ENTRIES = 500;

  // ── Core append ──
  function _makeEventId(e) { return 'calibration_' + (e.timestamp || Date.now()) + '_' + (e.runId || '') + '_' + Math.random().toString(36).slice(2, 8); }

  function append(event) {
    if (!event || !event.eventType) return;
    var entry = {
      eventId: event.eventId || null,
      timestamp: new Date().toISOString(),
      eventType: event.eventType,
      runId: event.runId || null,
      counts: event.counts || null,
      reason: event.reason || null,
      metrics: event.metrics || null
    };
    if (!entry.eventId) entry.eventId = _makeEventId(entry);
    var log = _read();
    log.push(entry);
    if (log.length > MAX_ENTRIES) log = log.slice(-MAX_ENTRIES);
    _write(log);
    if (typeof CompanyStoreAdapter !== 'undefined' && CompanyStoreAdapter.bufferAudit) CompanyStoreAdapter.bufferAudit('calibration', entry);
    return entry;
  }

  // ── Query helpers ──
  function getAll() { return _read(); }

  function getRecent(count) {
    var log = _read();
    return log.slice(-(count || 20));
  }

  function getByRunId(runId) {
    return _read().filter(function (e) { return e.runId === runId; });
  }

  function getSince(isoDate) {
    var ts = new Date(isoDate).getTime();
    return _read().filter(function (e) { return new Date(e.timestamp).getTime() >= ts; });
  }

  // ── Lifecycle shortcuts ──
  function logRunStarted(runId) {
    return append({ eventType: 'calibration_run_started', runId: runId });
  }

  function logRunCompleted(runId, counts, metricsSummary) {
    return append({ eventType: 'calibration_run_completed', runId: runId, counts: counts, metrics: metricsSummary });
  }

  function logRecommendationsEnqueued(runId, count) {
    return append({ eventType: 'calibration_recommendations_enqueued', runId: runId, counts: { enqueued: count } });
  }

  function logSkipped(reason) {
    return append({ eventType: 'calibration_skipped', reason: reason || 'cadence_not_met' });
  }

  function logError(reason) {
    return append({ eventType: 'calibration_error', reason: reason || 'Calibration run failed' });
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
      catch (e) { console.warn('[CalibrationAudit] Storage write failed'); }
    }
  }

  return {
    append: append,
    getAll: getAll,
    getRecent: getRecent,
    getByRunId: getByRunId,
    getSince: getSince,
    logRunStarted: logRunStarted,
    logRunCompleted: logRunCompleted,
    logRecommendationsEnqueued: logRecommendationsEnqueued,
    logSkipped: logSkipped,
    logError: logError
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalibrationAudit;
}
