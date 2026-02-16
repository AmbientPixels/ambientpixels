// storage-manager.js — Retention + Storage Hygiene v1
// Centralized storage utility for safe writes, pruning, and diagnostics.
// Must be loaded BEFORE all audit/queue/engine scripts.

var StorageManager = (function () {
  'use strict';

  // ── Retention policy defaults ──
  var MAX_LOG_ITEMS = 1000;
  var MAX_QUEUE_HISTORY = 300;
  var MAX_CACHE_ITEMS = 500;
  var MAX_AGE_DAYS = 30;
  var MAX_ARTIFACTS = 5;
  var PROTECT_RECENT_HOURS = 24;

  // ── Known store keys ──
  var LOG_KEYS = [
    'ap_action_audit',
    'ap_worker_audit',
    'ap_planner_audit',
    'ap_calibration_audit',
    'ap_priority_audit'
  ];
  var QUEUE_KEY = 'ap_action_queue';
  var CACHE_KEY = 'ap_priority_cache';
  var ARTIFACT_KEYS = [
    'ap_planner_latest_plan',
    'ap_calibration_latest'
  ];
  var ARTIFACT_HISTORY_KEYS = [
    'ap_planner_artifact_history',
    'ap_calibration_artifact_history'
  ];

  // ── storage_full debounce ──
  var _lastFullTs = 0;
  var FULL_DEBOUNCE_MS = 60000;

  // ═══════════════════════════════════════════════════
  // ── safeSet ──
  // ═══════════════════════════════════════════════════
  function safeSet(key, value) {
    var str = typeof value === 'string' ? value : JSON.stringify(value);
    try {
      localStorage.setItem(key, str);
      return true;
    } catch (e) {
      // Quota exceeded — attempt emergency prune + retry once
      _logStorageFull(key);
      try {
        _emergencyPrune();
        localStorage.setItem(key, str);
        return true;
      } catch (e2) {
        // Give up gracefully — never throw, never loop
        return false;
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // ── safeGet ──
  // ═══════════════════════════════════════════════════
  function safeGet(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  // ═══════════════════════════════════════════════════
  // ── pruneArray ──
  // ═══════════════════════════════════════════════════
  function pruneArray(key, maxItems, maxAgeDays) {
    maxItems = maxItems || MAX_LOG_ITEMS;
    maxAgeDays = maxAgeDays || MAX_AGE_DAYS;

    try {
      var raw = localStorage.getItem(key);
      if (!raw) return 0;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return 0;

      var originalLen = arr.length;
      var cutoffMs = Date.now() - (maxAgeDays * 86400000);
      var recentCutoff = Date.now() - (PROTECT_RECENT_HOURS * 3600000);

      // Filter: keep if within maxItems tail OR within protected window
      // Remove entries older than maxAgeDays first
      arr = arr.filter(function (entry) {
        var ts = entry.timestamp || entry.createdAt;
        if (!ts) return true; // keep entries without timestamp
        var entryMs = new Date(ts).getTime();
        // Always protect last 24h
        if (entryMs >= recentCutoff) return true;
        // Remove if older than maxAgeDays
        if (entryMs < cutoffMs) return false;
        return true;
      });

      // Cap at maxItems (keep newest)
      if (arr.length > maxItems) {
        // Protect last 24h entries at the end
        arr = arr.slice(-maxItems);
      }

      var pruned = originalLen - arr.length;
      if (pruned > 0) {
        safeSet(key, arr);
      }
      return pruned;
    } catch (e) {
      return 0; // Never throw
    }
  }

  // ═══════════════════════════════════════════════════
  // ── pruneQueue (ActionQueue specific) ──
  // ═══════════════════════════════════════════════════
  function pruneQueue() {
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return 0;
      var queue = JSON.parse(raw);
      if (!Array.isArray(queue)) return 0;

      var originalLen = queue.length;
      var protected_ = []; // pending_approval + approved_ready
      var terminal = [];   // executed + failed + blocked

      for (var i = 0; i < queue.length; i++) {
        var s = queue[i].status;
        if (s === 'pending_approval' || s === 'approved_ready' || s === 'executing') {
          protected_.push(queue[i]);
        } else {
          terminal.push(queue[i]);
        }
      }

      // Cap terminal items
      if (terminal.length > MAX_QUEUE_HISTORY) {
        terminal = terminal.slice(-MAX_QUEUE_HISTORY);
      }

      var result = protected_.concat(terminal);
      // Sort by createdAt to maintain order
      result.sort(function (a, b) {
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });

      var pruned = originalLen - result.length;
      if (pruned > 0) {
        safeSet(QUEUE_KEY, result);
      }
      return pruned;
    } catch (e) {
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════
  // ── pruneCache (PriorityEngine cache) ──
  // ═══════════════════════════════════════════════════
  function pruneCache(activeTaskIds) {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return 0;
      var cache = JSON.parse(raw);
      if (!cache || typeof cache !== 'object') return 0;

      var keys = Object.keys(cache);
      var originalCount = keys.length;
      var pruned = 0;

      // Remove entries for tasks no longer present
      if (activeTaskIds && activeTaskIds.length > 0) {
        var idSet = {};
        for (var i = 0; i < activeTaskIds.length; i++) idSet[activeTaskIds[i]] = true;
        for (var j = 0; j < keys.length; j++) {
          if (!idSet[keys[j]]) {
            delete cache[keys[j]];
            pruned++;
          }
        }
      }

      // Cap total entries
      var remaining = Object.keys(cache);
      if (remaining.length > MAX_CACHE_ITEMS) {
        // Remove oldest by evaluatedAt
        remaining.sort(function (a, b) {
          var ta = cache[a].evaluatedAt || '';
          var tb = cache[b].evaluatedAt || '';
          return ta.localeCompare(tb);
        });
        var toRemove = remaining.length - MAX_CACHE_ITEMS;
        for (var k = 0; k < toRemove; k++) {
          delete cache[remaining[k]];
          pruned++;
        }
      }

      if (pruned > 0) {
        safeSet(CACHE_KEY, cache);
      }
      return pruned;
    } catch (e) {
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════
  // ── pruneAll ──
  // ═══════════════════════════════════════════════════
  function pruneAll() {
    var summary = { logs: 0, queue: 0, cache: 0 };

    // Prune all log arrays
    for (var i = 0; i < LOG_KEYS.length; i++) {
      summary.logs += pruneArray(LOG_KEYS[i], MAX_LOG_ITEMS, MAX_AGE_DAYS);
    }

    // Prune action queue
    summary.queue = pruneQueue();

    // Prune priority cache (no active task list available here, just cap)
    summary.cache = pruneCache(null);

    return summary;
  }

  // ═══════════════════════════════════════════════════
  // ── estimateUsage ──
  // ═══════════════════════════════════════════════════
  function estimateUsage() {
    try {
      var total = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        var val = localStorage.getItem(key);
        total += key.length + (val ? val.length : 0);
      }
      return {
        bytesEstimate: total * 2, // JS strings are UTF-16
        kbEstimate: Math.round((total * 2) / 1024),
        itemCount: localStorage.length
      };
    } catch (e) {
      return { bytesEstimate: 0, kbEstimate: 0, itemCount: 0 };
    }
  }

  // ═══════════════════════════════════════════════════
  // ── getStoreCounts ──
  // ═══════════════════════════════════════════════════
  function getStoreCounts() {
    var counts = {};
    for (var i = 0; i < LOG_KEYS.length; i++) {
      var arr = safeGet(LOG_KEYS[i]);
      counts[LOG_KEYS[i]] = Array.isArray(arr) ? arr.length : 0;
    }
    var queue = safeGet(QUEUE_KEY);
    counts[QUEUE_KEY] = Array.isArray(queue) ? queue.length : 0;
    counts[QUEUE_KEY + '_pending'] = 0;
    if (Array.isArray(queue)) {
      for (var j = 0; j < queue.length; j++) {
        if (queue[j].status === 'pending_approval') counts[QUEUE_KEY + '_pending']++;
      }
    }
    var cache = safeGet(CACHE_KEY);
    counts[CACHE_KEY] = cache ? Object.keys(cache).length : 0;
    return counts;
  }

  // ═══════════════════════════════════════════════════
  // ── getOldestEntry ──
  // ═══════════════════════════════════════════════════
  function getOldestEntry() {
    var oldest = null;
    for (var i = 0; i < LOG_KEYS.length; i++) {
      var arr = safeGet(LOG_KEYS[i]);
      if (Array.isArray(arr) && arr.length > 0) {
        var ts = arr[0].timestamp || arr[0].createdAt;
        if (ts && (!oldest || ts < oldest)) oldest = ts;
      }
    }
    return oldest;
  }

  // ═══════════════════════════════════════════════════
  // ── exportDiagnostics ──
  // ═══════════════════════════════════════════════════
  function exportDiagnostics() {
    var diag = {
      exportedAt: new Date().toISOString(),
      usage: estimateUsage(),
      counts: getStoreCounts(),
      oldestEntry: getOldestEntry(),
      audits: {},
      queue: safeGet(QUEUE_KEY) || [],
      priorityCache: safeGet(CACHE_KEY) || {},
      plannerArtifact: safeGet('ap_planner_latest_plan'),
      calibrationArtifact: safeGet('ap_calibration_latest'),
      systemSettings: {
        plannerEnabled: localStorage.getItem('ap_planner_enabled'),
        calibrationEnabled: localStorage.getItem('ap_calibration_enabled'),
        actionsEnabled: localStorage.getItem('ap_action_router_enabled')
      }
    };
    for (var i = 0; i < LOG_KEYS.length; i++) {
      diag.audits[LOG_KEYS[i]] = safeGet(LOG_KEYS[i]) || [];
    }

    // Trigger download
    var blob = new Blob([JSON.stringify(diag, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ambientpixels-diagnostics-' + new Date().toISOString().substring(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return diag;
  }

  // ═══════════════════════════════════════════════════
  // ── resetCaches ──
  // ═══════════════════════════════════════════════════
  function resetCaches() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem('ap_planner_latest_plan'); } catch (e) { /* ignore */ }
    try { localStorage.removeItem('ap_calibration_latest'); } catch (e) { /* ignore */ }
    return true;
  }

  // ═══════════════════════════════════════════════════
  // ── Emergency prune (for quota exceeded) ──
  // ═══════════════════════════════════════════════════
  function _emergencyPrune() {
    // Aggressively trim all logs to half their cap
    for (var i = 0; i < LOG_KEYS.length; i++) {
      pruneArray(LOG_KEYS[i], Math.floor(MAX_LOG_ITEMS / 2), 14);
    }
    pruneQueue();
    pruneCache(null);
  }

  // ── storage_full debounced logger ──
  function _logStorageFull(key) {
    var now = Date.now();
    if (now - _lastFullTs < FULL_DEBOUNCE_MS) return;
    _lastFullTs = now;
    console.warn('[StorageManager] storage_full for key: ' + key);
    // Append one event to action audit if possible
    try {
      var auditKey = 'ap_action_audit';
      var raw = localStorage.getItem(auditKey);
      var log = raw ? JSON.parse(raw) : [];
      log.push({
        timestamp: new Date().toISOString(),
        eventType: 'storage_full',
        reason: 'Quota exceeded writing key: ' + key,
        meta: { key: key, estimatedUsage: estimateUsage().kbEstimate }
      });
      // Direct write — we're already in recovery, safeSet would recurse
      localStorage.setItem(auditKey, JSON.stringify(log.slice(-500)));
    } catch (e) { /* last resort — give up silently */ }
  }

  return {
    safeSet: safeSet,
    safeGet: safeGet,
    pruneArray: pruneArray,
    pruneQueue: pruneQueue,
    pruneCache: pruneCache,
    pruneAll: pruneAll,
    estimateUsage: estimateUsage,
    getStoreCounts: getStoreCounts,
    getOldestEntry: getOldestEntry,
    exportDiagnostics: exportDiagnostics,
    resetCaches: resetCaches,
    MAX_LOG_ITEMS: MAX_LOG_ITEMS,
    MAX_QUEUE_HISTORY: MAX_QUEUE_HISTORY,
    MAX_CACHE_ITEMS: MAX_CACHE_ITEMS,
    MAX_AGE_DAYS: MAX_AGE_DAYS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
