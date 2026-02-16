// priority-engine.js — Priority Engine v1: Deterministic Scoring Layer
// Scores tasks based on impact, urgency, strategic alignment, aging, and risk.
// Never uses LLM. Never mutates tasks. Fail-closed on errors.
// Cache: localStorage key ap_priority_cache

var PriorityEngine = (function () {
  'use strict';

  var CACHE_KEY = 'ap_priority_cache';
  var WEIGHTS_KEY = 'ap_priority_weights';

  // ═══════════════════════════════════════════════════
  // ── Configurable weights (with localStorage override layer) ──
  // ═══════════════════════════════════════════════════
  var DEFAULT_WEIGHTS = {
    impact: 3,
    urgency: 2,
    strategicAlignment: 3,
    agingFactor: 1.5,
    riskPenalty: 2
  };

  var WEIGHTS = _loadWeights();

  var WEIGHT_FIELDS = ['impact', 'urgency', 'strategicAlignment', 'agingFactor', 'riskPenalty'];
  var WEIGHT_MIN = 0;
  var WEIGHT_MAX = 5;

  function _loadWeights() {
    try {
      var raw = localStorage.getItem(WEIGHTS_KEY);
      if (raw) {
        var stored = JSON.parse(raw);
        var merged = {};
        for (var k in DEFAULT_WEIGHTS) {
          merged[k] = (stored[k] != null && typeof stored[k] === 'number') ? stored[k] : DEFAULT_WEIGHTS[k];
        }
        return merged;
      }
    } catch (e) { /* ignore */ }
    var copy = {};
    for (var k2 in DEFAULT_WEIGHTS) { copy[k2] = DEFAULT_WEIGHTS[k2]; }
    return copy;
  }

  function getWeights() {
    var copy = {};
    for (var k in WEIGHTS) { copy[k] = WEIGHTS[k]; }
    return copy;
  }

  function setWeights(next) {
    if (!next || typeof next !== 'object') return false;
    var updated = getWeights();
    for (var i = 0; i < WEIGHT_FIELDS.length; i++) {
      var f = WEIGHT_FIELDS[i];
      if (next[f] != null && typeof next[f] === 'number') {
        updated[f] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Math.round(next[f] * 100) / 100));
      }
    }
    WEIGHTS.impact = updated.impact;
    WEIGHTS.urgency = updated.urgency;
    WEIGHTS.strategicAlignment = updated.strategicAlignment;
    WEIGHTS.agingFactor = updated.agingFactor;
    WEIGHTS.riskPenalty = updated.riskPenalty;
    if (typeof StorageManager !== 'undefined' && StorageManager.safeSet) {
      return StorageManager.safeSet(WEIGHTS_KEY, updated);
    }
    try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(updated)); } catch (e) { return false; }
    if (typeof CompanyStoreAdapter !== 'undefined' && CompanyStoreAdapter.bufferSettingsPatch) CompanyStoreAdapter.bufferSettingsPatch({ priorityWeights: updated });
    return true;
  }

  // ── Impact map by task.type (0–5) ──
  var IMPACT_MAP = {
    blog_update: 3,
    social_post: 2,
    ui_change: 2,
    bug_fix: 4,
    feature: 3,
    research: 2,
    infrastructure: 3,
    security: 5
  };
  var DEFAULT_IMPACT = 2;

  // ── Risk penalty map by risk_level ──
  var RISK_MAP = { low: 1, medium: 2, high: 3 };
  var DEFAULT_RISK = 1;

  // ── Bucket thresholds ──
  var BUCKETS = [
    { max: 5, label: 'low' },
    { max: 10, label: 'medium' },
    { max: 17, label: 'high' }
    // 18+ → critical
  ];

  // ═══════════════════════════════════════════════════
  // ── evaluate(task) → { score, bucket, breakdown } ──
  // ═══════════════════════════════════════════════════
  function evaluate(task) {
    if (!task) return _fallback();

    try {
      var breakdown = {
        impact: _calcImpact(task),
        urgency: _calcUrgency(task),
        strategicAlignment: _calcAlignment(task),
        agingFactor: _calcAging(task),
        riskPenalty: _calcRisk(task)
      };

      var raw =
        (breakdown.impact * WEIGHTS.impact) +
        (breakdown.urgency * WEIGHTS.urgency) +
        (breakdown.strategicAlignment * WEIGHTS.strategicAlignment) +
        (breakdown.agingFactor * WEIGHTS.agingFactor) -
        (breakdown.riskPenalty * WEIGHTS.riskPenalty);

      var score = Math.max(0, Math.round(raw * 10) / 10);
      var bucket = _toBucket(score);

      return { score: score, bucket: bucket, breakdown: breakdown };
    } catch (e) {
      if (typeof PriorityAudit !== 'undefined') {
        PriorityAudit.logError('evaluate() threw: ' + (e.message || 'unknown'));
      }
      return _fallback();
    }
  }

  // ═══════════════════════════════════════════════════
  // ── recalculateAll(tasks) ──
  // Evaluates all tasks, updates cache, fires audit events for bucket changes
  // ═══════════════════════════════════════════════════
  function recalculateAll(tasks) {
    if (!Array.isArray(tasks)) return {};

    var oldCache = _readCache();
    var newCache = {};
    var now = new Date().toISOString();
    var errorLogged = false;

    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      if (!task || !task.id) continue;
      if (task.status === 'done') continue;

      try {
        var result = evaluate(task);
        var prev = oldCache[task.id];
        var prevBucket = prev ? prev.bucket : null;

        newCache[task.id] = {
          score: result.score,
          bucket: result.bucket,
          lastEvaluatedAt: now
        };

        // Audit: bucket change
        if (typeof PriorityAudit !== 'undefined') {
          if (prevBucket && prevBucket !== result.bucket) {
            PriorityAudit.logChanged(task.id, prevBucket, result.bucket, result.score, result.breakdown);
          }
        }
      } catch (e) {
        if (!errorLogged && typeof PriorityAudit !== 'undefined') {
          PriorityAudit.logError('recalculateAll() error for task ' + task.id);
          errorLogged = true;
        }
        // Fail closed: keep old cache entry if exists
        if (oldCache[task.id]) newCache[task.id] = oldCache[task.id];
      }
    }

    _writeCache(newCache);
    return newCache;
  }

  // ═══════════════════════════════════════════════════
  // ── Cache access ──
  // ═══════════════════════════════════════════════════
  function getCache() { return _readCache(); }

  function getCached(taskId) {
    var cache = _readCache();
    return cache[taskId] || null;
  }

  function getCounts() {
    var cache = _readCache();
    var counts = { low: 0, medium: 0, high: 0, critical: 0 };
    var keys = Object.keys(cache);
    for (var i = 0; i < keys.length; i++) {
      var bucket = cache[keys[i]].bucket;
      if (counts[bucket] !== undefined) counts[bucket]++;
    }
    return counts;
  }

  function getByBucket(bucket) {
    var cache = _readCache();
    var ids = [];
    var keys = Object.keys(cache);
    for (var i = 0; i < keys.length; i++) {
      if (cache[keys[i]].bucket === bucket) ids.push(keys[i]);
    }
    return ids;
  }

  function getSortedIds() {
    var cache = _readCache();
    var keys = Object.keys(cache);
    keys.sort(function (a, b) {
      return (cache[b].score || 0) - (cache[a].score || 0);
    });
    return keys;
  }

  // ═══════════════════════════════════════════════════
  // ── Factor calculations (all return 0–5) ──
  // ═══════════════════════════════════════════════════
  function _calcImpact(task) {
    var typeVal = (task.type && IMPACT_MAP[task.type]) ? IMPACT_MAP[task.type] : DEFAULT_IMPACT;
    // Boost if priority is already marked critical/high by human
    if (task.priority === 'critical') typeVal = Math.min(5, typeVal + 2);
    else if (task.priority === 'high') typeVal = Math.min(5, typeVal + 1);
    return _clamp(typeVal);
  }

  function _calcUrgency(task) {
    var score = 1;
    var now = Date.now();

    // Due date proximity
    if (task.dueDate) {
      var dueMs = new Date(task.dueDate).getTime();
      if (!isNaN(dueMs)) {
        var daysUntilDue = (dueMs - now) / 86400000;
        if (daysUntilDue < 0) score = 5; // overdue
        else if (daysUntilDue <= 1) score = 4;
        else if (daysUntilDue <= 3) score = 3;
        else if (daysUntilDue <= 7) score = 2;
        else score = 1;
      }
    }

    // Lane aging boost
    if (task.status === 'review' || task.status === 'in-progress') {
      var age = _daysSince(task.updatedAt || task.createdAt);
      if (age > 5) score = Math.max(score, 4);
      else if (age > 3) score = Math.max(score, 3);
    }

    // Blocked / escalated boost
    if (task.blocked || task.escalated) score = Math.max(score, 4);

    return _clamp(score);
  }

  function _calcAlignment(task) {
    // If task has directives or objective links → higher alignment
    if (task.directiveId || task.objectiveId || (task.kpiLinks && task.kpiLinks.length > 0)) {
      return 4;
    }
    // Tags that suggest strategic alignment
    if (task.tags && Array.isArray(task.tags)) {
      if (task.tags.indexOf('strategic') !== -1 || task.tags.indexOf('directive') !== -1) return 3;
    }
    return 1;
  }

  function _calcAging(task) {
    var days = _daysSince(task.createdAt);
    if (days > 14) return 5;
    if (days > 10) return 4;
    if (days > 5) return 3;
    if (days > 3) return 2;
    if (days > 1) return 1;
    return 0;
  }

  function _calcRisk(task) {
    var level = task.risk_level || 'low';
    return RISK_MAP[level] || DEFAULT_RISK;
  }

  // ═══════════════════════════════════════════════════
  // ── Helpers ──
  // ═══════════════════════════════════════════════════
  function _clamp(val) { return Math.max(0, Math.min(5, val)); }

  function _daysSince(dateStr) {
    if (!dateStr) return 0;
    var ms = Date.now() - new Date(dateStr).getTime();
    if (isNaN(ms) || ms < 0) return 0;
    return ms / 86400000;
  }

  function _toBucket(score) {
    for (var i = 0; i < BUCKETS.length; i++) {
      if (score <= BUCKETS[i].max) return BUCKETS[i].label;
    }
    return 'critical';
  }

  function _fallback() {
    return { score: 0, bucket: 'low', breakdown: { impact: 0, urgency: 0, strategicAlignment: 0, agingFactor: 0, riskPenalty: 0 } };
  }

  function _readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {};
  }

  function _writeCache(cache) {
    if (typeof StorageManager !== 'undefined' && StorageManager.safeSet) {
      StorageManager.safeSet(CACHE_KEY, cache);
    } else {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
      catch (e) { console.warn('[PriorityEngine] Cache write failed'); }
    }
  }

  return {
    evaluate: evaluate,
    recalculateAll: recalculateAll,
    getCache: getCache,
    getCached: getCached,
    getCounts: getCounts,
    getByBucket: getByBucket,
    getSortedIds: getSortedIds,
    getWeights: getWeights,
    setWeights: setWeights,
    WEIGHT_FIELDS: WEIGHT_FIELDS,
    WEIGHTS: WEIGHTS,
    IMPACT_MAP: IMPACT_MAP,
    BUCKETS: BUCKETS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PriorityEngine;
}
