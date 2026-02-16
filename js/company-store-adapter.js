// company-store-adapter.js — Client-side adapter for server-side Company Store v1
// Buffers writes, flushes in batches, falls back to localStorage on failure.
// Toggle: ap_server_persistence_enabled (default false)
// Outbox: ap_server_outbox (capped at 200 batches)

var CompanyStoreAdapter = (function () {
  'use strict';

  var ENABLED_KEY = 'ap_server_persistence_enabled';
  var OUTBOX_KEY = 'ap_server_outbox';
  var LAST_SYNC_KEY = 'ap_server_last_sync';
  var MAX_OUTBOX = 200;
  var FLUSH_DEBOUNCE_MS = 500;

  var API_BASE = '/api';
  var _buffer = { audits: {}, queue: { upserts: [], tombstones: [] }, artifacts: { upserts: [] }, settings: { patch: {} } };
  var _flushTimer = null;
  var _flushing = false;
  var _queueDirty = false;

  // ── Toggle ──
  function isEnabled() {
    try { return localStorage.getItem(ENABLED_KEY) === 'true'; } catch (e) { return false; }
  }

  function setEnabled(val) {
    try { localStorage.setItem(ENABLED_KEY, val ? 'true' : 'false'); } catch (e) { /* ignore */ }
  }

  // ── Auth key (sessionStorage only — never persisted to localStorage) ──
  function _getKey() {
    try { return sessionStorage.getItem('ap_server_key') || ''; } catch (e) { return ''; }
  }

  function setKey(key) {
    try { sessionStorage.setItem('ap_server_key', key || ''); } catch (e) { /* ignore */ }
  }

  // ── HTTP helpers ──
  function _post(endpoint, body) {
    return fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-company-secret': _getKey() },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function _get(endpoint, params) {
    var qs = '';
    if (params) {
      var parts = [];
      for (var k in params) { if (params[k] != null) parts.push(k + '=' + encodeURIComponent(params[k])); }
      if (parts.length) qs = '?' + parts.join('&');
    }
    return fetch(API_BASE + endpoint + qs, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'x-company-secret': _getKey() }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ── Buffer + Flush ──
  function _scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(function () {
      _flushTimer = null;
      flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  function bufferAudit(type, event) {
    if (!isEnabled()) return;
    if (!_buffer.audits[type]) _buffer.audits[type] = [];
    _buffer.audits[type].push(event);
    _scheduleFlush();
  }

  function bufferQueueUpsert(item) {
    if (!isEnabled()) return;
    _buffer.queue.upserts.push(item);
    _scheduleFlush();
  }

  function markQueueDirty() {
    if (!isEnabled()) return;
    _queueDirty = true;
    _scheduleFlush();
  }

  function bufferSettingsPatch(patch) {
    if (!isEnabled()) return;
    for (var k in patch) { _buffer.settings.patch[k] = patch[k]; }
    _scheduleFlush();
  }

  function bufferArtifact(artifact) {
    if (!isEnabled()) return;
    _buffer.artifacts.upserts.push(artifact);
    _scheduleFlush();
  }

  function _isBufferEmpty() {
    if (_queueDirty) return false;
    var hasAudits = false;
    for (var t in _buffer.audits) { if (_buffer.audits[t].length > 0) { hasAudits = true; break; } }
    return !hasAudits &&
      _buffer.queue.upserts.length === 0 &&
      _buffer.queue.tombstones.length === 0 &&
      _buffer.artifacts.upserts.length === 0 &&
      Object.keys(_buffer.settings.patch).length === 0;
  }

  function _drainBuffer() {
    var queueUpserts = _buffer.queue.upserts;
    // If queue marked dirty, read full queue from localStorage for sync
    if (_queueDirty) {
      try { queueUpserts = JSON.parse(localStorage.getItem('ap_action_queue') || '[]'); } catch (e) { /* keep buffer */ }
      _queueDirty = false;
    }
    var batch = {
      audits: _buffer.audits,
      queue: { upserts: queueUpserts, tombstones: _buffer.queue.tombstones },
      artifacts: { upserts: _buffer.artifacts.upserts },
      settings: Object.keys(_buffer.settings.patch).length > 0 ? { patch: _buffer.settings.patch } : null
    };
    _buffer = { audits: {}, queue: { upserts: [], tombstones: [] }, artifacts: { upserts: [] }, settings: { patch: {} } };
    return batch;
  }

  function flush() {
    if (_flushing || !isEnabled() || _isBufferEmpty()) return Promise.resolve(false);
    _flushing = true;
    var batch = _drainBuffer();
    return _post('/company-store-append', batch)
      .then(function (resp) {
        _flushing = false;
        if (resp && resp.ok) {
          _setLastSync((resp.serverTime) || new Date().toISOString());
          return true;
        }
        _pushOutbox(batch);
        return false;
      })
      .catch(function () {
        _flushing = false;
        _pushOutbox(batch);
        return false;
      });
  }

  // ── Outbox ──
  function _readOutbox() {
    try { var raw = localStorage.getItem(OUTBOX_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }

  function _writeOutbox(outbox) {
    try {
      if (typeof StorageManager !== 'undefined' && StorageManager.safeSet) {
        StorageManager.safeSet(OUTBOX_KEY, outbox);
      } else {
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
      }
    } catch (e) { /* ignore */ }
  }

  function _pushOutbox(batch) {
    var outbox = _readOutbox();
    outbox.push({ ts: new Date().toISOString(), batch: batch });
    if (outbox.length > MAX_OUTBOX) outbox = outbox.slice(-MAX_OUTBOX);
    _writeOutbox(outbox);
  }

  function getOutboxSize() { return _readOutbox().length; }

  function flushOutbox() {
    if (!isEnabled()) return Promise.resolve({ flushed: 0, failed: 0 });
    var outbox = _readOutbox();
    if (outbox.length === 0) return Promise.resolve({ flushed: 0, failed: 0 });
    var remaining = [];
    var flushed = 0;
    var chain = Promise.resolve();
    outbox.forEach(function (entry) {
      chain = chain.then(function () {
        return _post('/company-store-append', entry.batch)
          .then(function (resp) { if (resp && resp.ok) flushed++; else remaining.push(entry); })
          .catch(function () { remaining.push(entry); });
      });
    });
    return chain.then(function () {
      _writeOutbox(remaining);
      if (flushed > 0) _setLastSync(new Date().toISOString());
      return { flushed: flushed, failed: remaining.length };
    });
  }

  // ── Sync metadata ──
  function _setLastSync(iso) {
    try { localStorage.setItem(LAST_SYNC_KEY, iso); } catch (e) { /* ignore */ }
  }

  function getLastSync() {
    try { return localStorage.getItem(LAST_SYNC_KEY) || null; } catch (e) { return null; }
  }

  // ── Snapshot (pull from server) ──
  function loadSnapshot(options) {
    if (!isEnabled()) return Promise.resolve(null);
    var params = {};
    if (options && options.since) params.since = options.since;
    if (options && options.limit) params.limit = options.limit;
    return _get('/company-store-snapshot', params)
      .then(function (resp) {
        if (resp && resp.ok) {
          _setLastSync(resp.serverTime || new Date().toISOString());
          return resp.snapshot;
        }
        return null;
      })
      .catch(function () { return null; });
  }

  function deltaSync() {
    if (!isEnabled()) return Promise.resolve({ ok: false, reason: 'Adapter disabled' });
    var since = getLastSync();
    return loadSnapshot(since ? { since: since } : {})
      .then(function (snapshot) {
        if (!snapshot) return { ok: false, reason: 'No snapshot available' };
        _mergeSnapshotToLocal(snapshot, !!since);
        return { ok: true, delta: !!since };
      });
  }

  // ── Migrate: push local → server ──
  function pushLocalToServer() {
    if (!isEnabled()) return Promise.resolve({ ok: false, reason: 'Adapter disabled' });
    var payload = _collectLocalState();
    return _post('/company-store-migrate', { source: 'localStorage', payload: payload })
      .then(function (resp) {
        if (resp && resp.ok) {
          _setLastSync(new Date().toISOString());
          return { ok: true, summary: resp.summary };
        }
        return { ok: false, reason: 'Server rejected' };
      })
      .catch(function (err) { return { ok: false, reason: err.message || 'Network error' }; });
  }

  // ── Migrate: pull server → local ──
  function pullServerToLocal() {
    return loadSnapshot()
      .then(function (snapshot) {
        if (!snapshot) return { ok: false, reason: 'No snapshot available' };
        _applySnapshotToLocal(snapshot);
        return { ok: true };
      });
  }

  // ── Merge snapshot (delta-aware) ──
  function _mergeSnapshotToLocal(snapshot, isDelta) {
    // Settings — server wins (same as full)
    if (snapshot.settings) {
      var s = snapshot.settings;
      if (s.actionsEnabled != null) localStorage.setItem('ap_actions_enabled', s.actionsEnabled ? 'true' : 'false');
      if (s.taskEnabled != null) localStorage.setItem('ap_actions_task_enabled', s.taskEnabled ? 'true' : 'false');
      if (s.socialEnabled != null) localStorage.setItem('ap_actions_social_enabled', s.socialEnabled ? 'true' : 'false');
      if (s.emailEnabled != null) localStorage.setItem('ap_actions_email_enabled', s.emailEnabled ? 'true' : 'false');
      if (s.configChangesEnabled != null) localStorage.setItem('ap_config_changes_enabled', s.configChangesEnabled ? 'true' : 'false');
      if (s.priorityWeights) localStorage.setItem('ap_priority_weights', JSON.stringify(s.priorityWeights));
      if (s.plannerThresholds) localStorage.setItem('ap_planner_thresholds', JSON.stringify(s.plannerThresholds));
    }
    // Audits — delta: append new, dedup by eventId; full: replace
    var auditMap = { action: 'ap_action_audit', worker: 'ap_worker_audit', planner: 'ap_planner_audit', calibration: 'ap_calibration_audit', priority: 'ap_priority_audit' };
    if (snapshot.audits) {
      for (var type in auditMap) {
        if (!Array.isArray(snapshot.audits[type])) continue;
        try {
          if (isDelta && snapshot.audits[type].length > 0) {
            var local = JSON.parse(localStorage.getItem(auditMap[type]) || '[]');
            var seen = {};
            var tail = local.length > 2000 ? local.slice(-2000) : local;
            for (var k = 0; k < tail.length; k++) { if (tail[k].eventId) seen[tail[k].eventId] = true; }
            var newOnes = [];
            for (var j = 0; j < snapshot.audits[type].length; j++) {
              var ev = snapshot.audits[type][j];
              if (ev.eventId && seen[ev.eventId]) continue;
              newOnes.push(ev);
            }
            if (newOnes.length > 0) {
              local = local.concat(newOnes);
              if (local.length > 500) local = local.slice(-500);
              localStorage.setItem(auditMap[type], JSON.stringify(local));
            }
          } else {
            localStorage.setItem(auditMap[type], JSON.stringify(snapshot.audits[type]));
          }
        } catch (e) { /* ignore */ }
      }
    }
    // Queue — server wins, preserve local pending not on server
    if (Array.isArray(snapshot.actionQueue)) {
      try {
        var localQueue = JSON.parse(localStorage.getItem('ap_action_queue') || '[]');
        var serverIds = {};
        snapshot.actionQueue.forEach(function (item) { serverIds[item.id] = true; });
        var localOnly = localQueue.filter(function (item) {
          return !serverIds[item.id] && item.status === 'pending_approval';
        });
        var merged = snapshot.actionQueue.concat(localOnly);
        localStorage.setItem('ap_action_queue', JSON.stringify(merged));
      } catch (e) { /* ignore */ }
    }
  }

  // ── Local state collection (for push) ──
  function _collectLocalState() {
    var state = { audits: {}, actionQueue: [], settings: {}, artifacts: {} };
    try { state.audits.action = JSON.parse(localStorage.getItem('ap_action_audit') || '[]'); } catch (e) { state.audits.action = []; }
    try { state.audits.worker = JSON.parse(localStorage.getItem('ap_worker_audit') || '[]'); } catch (e) { state.audits.worker = []; }
    try { state.audits.planner = JSON.parse(localStorage.getItem('ap_planner_audit') || '[]'); } catch (e) { state.audits.planner = []; }
    try { state.audits.calibration = JSON.parse(localStorage.getItem('ap_calibration_audit') || '[]'); } catch (e) { state.audits.calibration = []; }
    try { state.audits.priority = JSON.parse(localStorage.getItem('ap_priority_audit') || '[]'); } catch (e) { state.audits.priority = []; }
    try { state.actionQueue = JSON.parse(localStorage.getItem('ap_action_queue') || '[]'); } catch (e) { state.actionQueue = []; }
    // Settings
    var s = state.settings;
    try { s.actionsEnabled = localStorage.getItem('ap_actions_enabled') === 'true'; } catch (e) {}
    try { s.taskEnabled = localStorage.getItem('ap_actions_task_enabled') !== 'false'; } catch (e) {}
    try { s.socialEnabled = localStorage.getItem('ap_actions_social_enabled') === 'true'; } catch (e) {}
    try { s.emailEnabled = localStorage.getItem('ap_actions_email_enabled') === 'true'; } catch (e) {}
    try { s.configChangesEnabled = localStorage.getItem('ap_config_changes_enabled') === 'true'; } catch (e) {}
    try { var pw = localStorage.getItem('ap_priority_weights'); if (pw) s.priorityWeights = JSON.parse(pw); } catch (e) {}
    try { var pt = localStorage.getItem('ap_planner_thresholds'); if (pt) s.plannerThresholds = JSON.parse(pt); } catch (e) {}
    // Artifacts
    try { var pp = localStorage.getItem('ap_planner_latest_plan'); if (pp) { var plan = JSON.parse(pp); state.artifacts.plannerLatest = { id: plan.planId || 'plan_latest', type: 'planner', createdAt: plan.generatedAt || new Date().toISOString(), data: plan }; } } catch (e) {}
    return state;
  }

  // ── Apply snapshot to local (server wins for settings; union for audits; dedup queue) ──
  function _applySnapshotToLocal(snapshot) {
    // Settings — server wins
    if (snapshot.settings) {
      var s = snapshot.settings;
      if (s.actionsEnabled != null) localStorage.setItem('ap_actions_enabled', s.actionsEnabled ? 'true' : 'false');
      if (s.taskEnabled != null) localStorage.setItem('ap_actions_task_enabled', s.taskEnabled ? 'true' : 'false');
      if (s.socialEnabled != null) localStorage.setItem('ap_actions_social_enabled', s.socialEnabled ? 'true' : 'false');
      if (s.emailEnabled != null) localStorage.setItem('ap_actions_email_enabled', s.emailEnabled ? 'true' : 'false');
      if (s.configChangesEnabled != null) localStorage.setItem('ap_config_changes_enabled', s.configChangesEnabled ? 'true' : 'false');
      if (s.priorityWeights) localStorage.setItem('ap_priority_weights', JSON.stringify(s.priorityWeights));
      if (s.plannerThresholds) localStorage.setItem('ap_planner_thresholds', JSON.stringify(s.plannerThresholds));
    }
    // Audits — replace local with server (server is authoritative)
    var auditMap = { action: 'ap_action_audit', worker: 'ap_worker_audit', planner: 'ap_planner_audit', calibration: 'ap_calibration_audit', priority: 'ap_priority_audit' };
    if (snapshot.audits) {
      for (var type in auditMap) {
        if (Array.isArray(snapshot.audits[type])) {
          try { localStorage.setItem(auditMap[type], JSON.stringify(snapshot.audits[type])); } catch (e) { /* ignore */ }
        }
      }
    }
    // Queue — server wins, preserve local pending not on server
    if (Array.isArray(snapshot.actionQueue)) {
      try {
        var localQueue = JSON.parse(localStorage.getItem('ap_action_queue') || '[]');
        var serverIds = {};
        snapshot.actionQueue.forEach(function (item) { serverIds[item.id] = true; });
        var localOnly = localQueue.filter(function (item) {
          return !serverIds[item.id] && item.status === 'pending_approval';
        });
        var merged = snapshot.actionQueue.concat(localOnly);
        localStorage.setItem('ap_action_queue', JSON.stringify(merged));
      } catch (e) { /* ignore */ }
    }
  }

  // ── Status ──
  function getStatus() {
    return {
      enabled: isEnabled(),
      hasKey: !!_getKey(),
      outboxSize: getOutboxSize(),
      lastSync: getLastSync()
    };
  }

  return {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    setKey: setKey,
    getStatus: getStatus,
    getLastSync: getLastSync,
    getOutboxSize: getOutboxSize,
    // Buffer + flush
    bufferAudit: bufferAudit,
    bufferQueueUpsert: bufferQueueUpsert,
    markQueueDirty: markQueueDirty,
    bufferSettingsPatch: bufferSettingsPatch,
    bufferArtifact: bufferArtifact,
    flush: flush,
    flushOutbox: flushOutbox,
    // Snapshot + delta
    loadSnapshot: loadSnapshot,
    deltaSync: deltaSync,
    // Migrate
    pushLocalToServer: pushLocalToServer,
    pullServerToLocal: pullServerToLocal
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompanyStoreAdapter;
}
