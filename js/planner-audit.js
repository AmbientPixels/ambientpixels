// planner-audit.js — Planner Loop v1: Append-only audit log for planner events
// Storage key: ap_planner_audit
// All entries are immutable once written.

var PlannerAudit = (function () {
  'use strict';

  var STORAGE_KEY = 'ap_planner_audit';
  var MAX_ENTRIES = 300;

  // ── Core append ──
  function append(event) {
    if (!event || !event.eventType) return;
    var entry = {
      timestamp: new Date().toISOString(),
      eventType: event.eventType,
      plannerRunId: event.plannerRunId || null,
      counts: event.counts || null,
      reason: event.reason || null,
      meta: event.meta || null
    };
    var log = _read();
    log.push(entry);
    if (log.length > MAX_ENTRIES) log = log.slice(-MAX_ENTRIES);
    _write(log);
    return entry;
  }

  // ── Query helpers ──
  function getAll() { return _read(); }

  function getRecent(count) {
    var log = _read();
    return log.slice(-(count || 20));
  }

  function getByRunId(runId) {
    return _read().filter(function (e) { return e.plannerRunId === runId; });
  }

  // ── Lifecycle shortcuts ──
  function logRunStarted(runId) {
    return append({ eventType: 'planner_run_started', plannerRunId: runId });
  }

  function logRunCompleted(runId, counts) {
    return append({ eventType: 'planner_run_completed', plannerRunId: runId, counts: counts });
  }

  function logRecommendationsEnqueued(runId, count) {
    return append({ eventType: 'planner_recommendations_enqueued', plannerRunId: runId, counts: { enqueued: count } });
  }

  function logSkipped(reason) {
    return append({ eventType: 'planner_skipped', reason: reason || 'cadence_not_met' });
  }

  function logError(reason) {
    return append({ eventType: 'planner_error', reason: reason || 'Planner run failed' });
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)); }
    catch (e) { console.warn('[PlannerAudit] Storage write failed'); }
  }

  return {
    append: append,
    getAll: getAll,
    getRecent: getRecent,
    getByRunId: getByRunId,
    logRunStarted: logRunStarted,
    logRunCompleted: logRunCompleted,
    logRecommendationsEnqueued: logRecommendationsEnqueued,
    logSkipped: logSkipped,
    logError: logError
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlannerAudit;
}
