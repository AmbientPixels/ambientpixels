// action-queue.js — Action Router v1: localStorage-backed queue for governed action execution
// Storage key: ap_action_queue
// Statuses: pending_approval | approved_ready | executing | executed | failed | blocked

var ActionQueue = (function () {
  'use strict';

  var STORAGE_KEY = 'ap_action_queue';
  var MAX_ITEMS = 200;
  var DEDUPE_WINDOW_MS = 30000; // 30s dedup window

  // ── Enqueue a new action ──
  function enqueue(proposal) {
    if (!proposal || !proposal.actionType) return null;

    // Dedupe: same actionType + targetId within window
    if (_isDuplicate(proposal.actionType, proposal.targetId)) return null;

    var item = {
      id: 'act_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),
      correlationId: proposal.correlationId || null,
      createdAt: new Date().toISOString(),
      source: proposal.source || 'system',
      proposedBy: proposal.proposedBy || null,
      actionType: proposal.actionType,
      targetId: proposal.targetId || null,
      payload: proposal.payload || {},
      riskLevel: proposal.riskLevel || 'medium',
      requiresApproval: proposal.requiresApproval !== false,
      requiresVerification: proposal.requiresVerification === true,
      verification: proposal.verification || null,
      status: proposal.requiresApproval !== false ? 'pending_approval' : 'approved_ready',
      approvedBy: null,
      approvedAt: null,
      failureReason: null,
      attempts: 0
    };

    var queue = _read();
    queue.push(item);
    if (queue.length > MAX_ITEMS) queue = queue.slice(-MAX_ITEMS);
    _write(queue);
    return item;
  }

  // ── Approve ──
  function approve(id, approver) {
    var queue = _read();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id && queue[i].status === 'pending_approval') {
        queue[i].status = 'approved_ready';
        queue[i].approvedBy = approver || 'CEO';
        queue[i].approvedAt = new Date().toISOString();
        _write(queue);
        return queue[i];
      }
    }
    return null;
  }

  // ── Reject ──
  function reject(id, approver, reason) {
    var queue = _read();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id && queue[i].status === 'pending_approval') {
        queue[i].status = 'failed';
        queue[i].failureReason = reason || 'Rejected by ' + (approver || 'CEO');
        _write(queue);
        return queue[i];
      }
    }
    return null;
  }

  // ── Get next ready item ──
  function nextReady() {
    var queue = _read();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].status === 'approved_ready') return queue[i];
    }
    return null;
  }

  // ── Get multiple ready items (up to cap) ──
  function getReady(cap) {
    var queue = _read();
    var ready = [];
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].status === 'approved_ready') {
        ready.push(queue[i]);
        if (ready.length >= (cap || 5)) break;
      }
    }
    return ready;
  }

  // ── Status transitions ──
  function markExecuting(id) { return _setStatus(id, 'executing'); }

  function markExecuted(id) { return _setStatus(id, 'executed'); }

  function markFailed(id, reason) {
    var queue = _read();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) {
        queue[i].status = 'failed';
        queue[i].failureReason = reason || 'Execution failed';
        queue[i].attempts = (queue[i].attempts || 0) + 1;
        _write(queue);
        return queue[i];
      }
    }
    return null;
  }

  function markBlocked(id, reason) {
    var queue = _read();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) {
        queue[i].status = 'blocked';
        queue[i].failureReason = reason || 'Blocked';
        _write(queue);
        return queue[i];
      }
    }
    return null;
  }

  function incrementAttempts(id) {
    var queue = _read();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) {
        queue[i].attempts = (queue[i].attempts || 0) + 1;
        _write(queue);
        return queue[i];
      }
    }
    return null;
  }

  // ── Query helpers ──
  function getAll() { return _read(); }

  function getByStatus(status) {
    return _read().filter(function (item) { return item.status === status; });
  }

  function getPendingApproval() { return getByStatus('pending_approval'); }
  function getExecuted() { return getByStatus('executed'); }
  function getFailed() { return getByStatus('failed'); }
  function getBlocked() { return getByStatus('blocked'); }

  function getById(id) {
    var queue = _read();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) return queue[i];
    }
    return null;
  }

  function getByCorrelation(correlationId) {
    return _read().filter(function (item) { return item.correlationId === correlationId; });
  }

  function getRecent(count) {
    var queue = _read();
    return queue.slice(-(count || 20));
  }

  // ── Counts ──
  function countByStatus(status) {
    return _read().filter(function (item) { return item.status === status; }).length;
  }

  function getExecutedToday() {
    var today = new Date().toISOString().substring(0, 10);
    return _read().filter(function (item) {
      return item.status === 'executed' && item.createdAt && item.createdAt.substring(0, 10) === today;
    });
  }

  // ── Dedup check ──
  function _isDuplicate(actionType, targetId) {
    if (!targetId) return false;
    var cutoff = Date.now() - DEDUPE_WINDOW_MS;
    var queue = _read();
    for (var i = queue.length - 1; i >= 0; i--) {
      var item = queue[i];
      if (new Date(item.createdAt).getTime() < cutoff) break;
      if (item.actionType === actionType && item.targetId === targetId &&
          item.status !== 'failed' && item.status !== 'blocked') {
        return true;
      }
    }
    return false;
  }

  // ── Grouped pending approvals (v1.5) ──
  function getPendingGroups() {
    var pending = getPendingApproval();
    var groupMap = {};
    var groupOrder = [];

    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      var gid, title, subtitle;

      if (item.correlationId) {
        gid = 'corr_' + item.correlationId;
        title = item.source === 'planner' ? 'Planner Run' : 'Correlated Group';
        subtitle = item.correlationId.substring(0, 12);
      } else if (item.targetId) {
        gid = 'task_' + item.targetId;
        title = 'Task Group';
        subtitle = item.targetId;
      } else if (item.source) {
        gid = 'src_' + item.source;
        title = 'Source: ' + item.source;
        subtitle = '';
      } else {
        gid = 'risk_' + (item.riskLevel || 'unknown');
        title = (item.riskLevel || 'unknown') + ' risk';
        subtitle = '';
      }

      if (!groupMap[gid]) {
        groupMap[gid] = { groupId: gid, title: title, subtitle: subtitle, items: [], counts: { total: 0, low: 0, medium: 0, high: 0 }, actionTypes: {}, oldest: item.createdAt, newest: item.createdAt };
        groupOrder.push(gid);
      }
      var g = groupMap[gid];
      g.items.push(item);
      g.counts.total++;
      g.counts[item.riskLevel] = (g.counts[item.riskLevel] || 0) + 1;
      g.actionTypes[item.actionType] = true;
      if (item.createdAt < g.oldest) g.oldest = item.createdAt;
      if (item.createdAt > g.newest) g.newest = item.createdAt;
    }

    return groupOrder.map(function (gid) { return groupMap[gid]; });
  }

  // ── Batch approve (v1.5) ──
  function approveMany(ids, approver) {
    if (!Array.isArray(ids) || ids.length === 0) return { approved: 0, skipped: 0 };
    var queue = _read();
    var approved = 0;
    var skipped = 0;
    var ts = new Date().toISOString();
    for (var i = 0; i < queue.length; i++) {
      if (ids.indexOf(queue[i].id) !== -1) {
        if (queue[i].status === 'pending_approval') {
          queue[i].status = 'approved_ready';
          queue[i].approvedBy = approver || 'CEO';
          queue[i].approvedAt = ts;
          approved++;
        } else { skipped++; }
      }
    }
    _write(queue);
    return { approved: approved, skipped: skipped };
  }

  // ── Batch reject (v1.5) ──
  function rejectMany(ids, approver, reason) {
    if (!Array.isArray(ids) || ids.length === 0) return { rejected: 0, skipped: 0 };
    var norm = _normalizeReason(reason);
    var queue = _read();
    var rejected = 0;
    var skipped = 0;
    for (var i = 0; i < queue.length; i++) {
      if (ids.indexOf(queue[i].id) !== -1) {
        if (queue[i].status === 'pending_approval') {
          queue[i].status = 'failed';
          queue[i].failureReason = norm;
          rejected++;
        } else { skipped++; }
      }
    }
    _write(queue);
    return { rejected: rejected, skipped: skipped };
  }

  function _normalizeReason(reason) {
    if (!reason || typeof reason !== 'string') return 'Rejected';
    return reason.trim().replace(/\s+/g, ' ').substring(0, 200);
  }

  // ── Internal helpers ──
  function _setStatus(id, status) {
    var queue = _read();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) {
        queue[i].status = status;
        _write(queue);
        return queue[i];
      }
    }
    return null;
  }

  function _read() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return [];
  }

  function _write(queue) {
    if (typeof StorageManager !== 'undefined' && StorageManager.safeSet) {
      StorageManager.safeSet(STORAGE_KEY, queue);
    } else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); }
      catch (e) { console.warn('[ActionQueue] Storage write failed'); }
    }
    if (typeof CompanyStoreAdapter !== 'undefined' && CompanyStoreAdapter.markQueueDirty) CompanyStoreAdapter.markQueueDirty();
  }

  return {
    enqueue: enqueue,
    approve: approve,
    reject: reject,
    nextReady: nextReady,
    getReady: getReady,
    markExecuting: markExecuting,
    markExecuted: markExecuted,
    markFailed: markFailed,
    markBlocked: markBlocked,
    incrementAttempts: incrementAttempts,
    getAll: getAll,
    getByStatus: getByStatus,
    getPendingApproval: getPendingApproval,
    getExecuted: getExecuted,
    getFailed: getFailed,
    getBlocked: getBlocked,
    getById: getById,
    getByCorrelation: getByCorrelation,
    getRecent: getRecent,
    countByStatus: countByStatus,
    getExecutedToday: getExecutedToday,
    getPendingGroups: getPendingGroups,
    approveMany: approveMany,
    rejectMany: rejectMany
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionQueue;
}
