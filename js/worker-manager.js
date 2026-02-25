// worker-manager.js — Worker Framework v1: Policy evaluation, spawn/despawn, lifecycle, CEO kill switch
// Depends on: CompanyWorkers, WorkerRuntime, WorkerAudit

var WorkerManager = (function () {
  'use strict';

  // ── Constants: Policy thresholds ──
  var PRESSURE_THRESHOLDS = {
    reviewCount: 8,
    overdueCount: 3,
    pendingApprovals: 6,
    oldestInReviewHours: 24,
    unassignedCount: 30,
    backlogCount: 80
  };

  // ── Caps ──
  var GLOBAL_MAX_WORKERS = 6;
  var MAX_PER_OWNER = 3;

  // ── CEO Kill Switch storage key ──
  var KILL_SWITCH_KEY = 'ap_workers_enabled';

  // ── Run-rate tracking key ──
  var RUN_RATE_KEY = 'ap_worker_run_rates';

  // ── Worker reports storage key ──
  var REPORTS_KEY = 'ap_worker_reports';
  var MAX_REPORTS = 50;

  // ── Active workers (in-memory, ephemeral) ──
  var _activeWorkers = [];
  // Each: { id, type, owner, correlationId, state, spawnedAt, ttlMinutes }

  // ── Consecutive low-pressure cycles ──
  var _lowPressureCycles = 0;

  // ── Debounce: prevent audit spam from kill switch ──
  var _lastKillSwitchAuditTs = 0;
  var KILL_SWITCH_DEBOUNCE_MS = 5000;

  // ── CEO Kill Switch ──
  function isEnabled() {
    try {
      var val = localStorage.getItem(KILL_SWITCH_KEY);
      if (val === null) return true; // default: enabled
      return val === 'true';
    } catch (e) { return true; }
  }

  function setEnabled(enabled, source) {
    var prev = isEnabled();
    var next = !!enabled;
    try { localStorage.setItem(KILL_SWITCH_KEY, String(next)); } catch (e) { /* ignore */ }

    if (prev !== next) {
      var now = Date.now();
      if (now - _lastKillSwitchAuditTs > KILL_SWITCH_DEBOUNCE_MS) {
        _lastKillSwitchAuditTs = now;
        if (next) {
          WorkerAudit.logWorkersEnabled(source || 'CONFIG_UI');
        } else {
          WorkerAudit.logWorkersDisabled(source || 'CONFIG_UI');
          // Terminate any active workers
          var terminated = _terminateAll('disabled_by_ceo');
          if (terminated > 0) {
            WorkerAudit.logWorkersTerminated(terminated, source || 'CONFIG_UI');
          }
        }
      }
    }
    return next;
  }

  // ── Correlation ID generator ──
  function _genCorrelationId() {
    return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
  }

  // ── State machine transitions ──
  // spawning → active → reporting → terminated
  function _setState(worker, newState, reason) {
    worker.state = newState;
    if (reason) worker.terminationReason = reason;
  }

  // ── Spawn a worker ──
  function _spawn(workerDef) {
    var correlationId = _genCorrelationId();
    var worker = {
      id: workerDef.id + '_' + correlationId,
      type: workerDef.id,
      owner: workerDef.ownerRole,
      correlationId: correlationId,
      state: 'spawning',
      spawnedAt: Date.now(),
      ttlMinutes: workerDef.ttlMinutes
    };
    _setState(worker, 'spawning');
    _activeWorkers.push(worker);
    WorkerAudit.logSpawned(worker.type, worker.owner, correlationId);
    return worker;
  }

  // ── Terminate a single worker ──
  function _terminate(worker, reason) {
    var durationMs = Date.now() - worker.spawnedAt;
    _setState(worker, 'terminated', reason);

    if (reason === 'ttl_exceeded') {
      WorkerAudit.logTimeout(worker.type, worker.owner, worker.correlationId, durationMs);
    } else {
      WorkerAudit.logTerminated(worker.type, worker.owner, worker.correlationId, reason, durationMs);
    }

    // Remove from active list
    _activeWorkers = _activeWorkers.filter(function (w) { return w.id !== worker.id; });
  }

  // ── Terminate all active workers ──
  function _terminateAll(reason) {
    var count = _activeWorkers.length;
    var toTerminate = _activeWorkers.slice(); // copy
    toTerminate.forEach(function (w) {
      _terminate(w, reason);
    });
    return count;
  }

  // ── TTL enforcement ──
  function _enforceTimeouts() {
    var now = Date.now();
    _activeWorkers.slice().forEach(function (w) {
      if (w.state !== 'terminated') {
        var elapsed = (now - w.spawnedAt) / 60000;
        if (elapsed >= w.ttlMinutes) {
          _terminate(w, 'ttl_exceeded');
        }
      }
    });
  }

  // ── Budget enforcement (best-effort runs-per-hour) ──
  function _checkBudget(workerDef) {
    var rates = _readRunRates();
    var key = workerDef.id;
    var hourAgo = Date.now() - 3600000;
    var entries = (rates[key] || []).filter(function (ts) { return ts > hourAgo; });
    return entries.length < workerDef.budget.maxRunsPerHour;
  }

  function _recordRun(workerDef) {
    var rates = _readRunRates();
    var key = workerDef.id;
    if (!rates[key]) rates[key] = [];
    rates[key].push(Date.now());
    // Trim old entries
    var hourAgo = Date.now() - 3600000;
    rates[key] = rates[key].filter(function (ts) { return ts > hourAgo; });
    _writeRunRates(rates);
  }

  function _readRunRates() {
    try {
      var raw = localStorage.getItem(RUN_RATE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {};
  }

  function _writeRunRates(rates) {
    try { localStorage.setItem(RUN_RATE_KEY, JSON.stringify(rates)); } catch (e) { /* ignore */ }
  }

  // ── Per-owner cap check ──
  function _countActiveByOwner(ownerRole) {
    return _activeWorkers.filter(function (w) {
      return w.owner === ownerRole && w.state !== 'terminated';
    }).length;
  }

  // ── Pressure evaluation ──
  function _evaluatePressure(snapshot) {
    if (!snapshot) return false;
    var lc = snapshot.laneCounts || {};
    var reviewCount = lc.in_review || 0;
    var overdueCount = snapshot.overdueCount || 0;
    var pendingApprovals = snapshot.pendingApprovalsCount || 0;
    var oldestInReviewHours = snapshot.oldestInReviewHours || 0;

    // Priority Engine v1 — escalate on critical count
    var criticalCount = 0;
    try {
      if (typeof PriorityEngine !== 'undefined' && PriorityEngine.getCounts) {
        criticalCount = PriorityEngine.getCounts().critical || 0;
      }
    } catch (e) { /* fail closed */ }

    var unassignedCount = snapshot.unassignedCount || 0;
    var backlogCount = (lc.backlog || 0) + (lc.todo || 0);

    return (
      reviewCount >= PRESSURE_THRESHOLDS.reviewCount ||
      overdueCount >= PRESSURE_THRESHOLDS.overdueCount ||
      pendingApprovals >= PRESSURE_THRESHOLDS.pendingApprovals ||
      oldestInReviewHours >= PRESSURE_THRESHOLDS.oldestInReviewHours ||
      criticalCount >= 2 ||
      unassignedCount >= PRESSURE_THRESHOLDS.unassignedCount ||
      backlogCount >= PRESSURE_THRESHOLDS.backlogCount
    );
  }

  // ── Store report ──
  function _storeReport(report) {
    try {
      var raw = localStorage.getItem(REPORTS_KEY);
      var reports = raw ? JSON.parse(raw) : [];
      reports.push(report);
      if (reports.length > MAX_REPORTS) reports = reports.slice(-MAX_REPORTS);
      localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    } catch (e) { /* ignore */ }
  }

  function getLatestReports(limit) {
    try {
      var raw = localStorage.getItem(REPORTS_KEY);
      var reports = raw ? JSON.parse(raw) : [];
      return reports.slice(-(limit || 10));
    } catch (e) { return []; }
  }

  // ── Run a single worker ──
  function _runWorker(workerDef, items, context) {
    if (!_checkBudget(workerDef)) {
      WorkerAudit.logBudgetExceeded(workerDef.id, workerDef.ownerRole, null);
      return Promise.resolve(null);
    }

    var worker = _spawn(workerDef);
    _setState(worker, 'active');

    var job = {
      jobType: workerDef.id.replace('_worker', ''),
      items: items,
      context: context
    };

    WorkerAudit.logStarted(worker.type, worker.owner, worker.correlationId, items.length);

    return WorkerRuntime.execute(workerDef, job, worker.correlationId)
      .then(function (report) {
        var durationMs = Date.now() - worker.spawnedAt;
        _setState(worker, 'reporting');
        WorkerAudit.logReported(worker.type, worker.owner, worker.correlationId, items.length, durationMs);
        _recordRun(workerDef);
        _storeReport(report);
        _terminate(worker, 'normal');
        return report;
      })
      .catch(function (err) {
        var reason = (err && err.message) ? err.message : 'unknown_error';
        WorkerAudit.logError(worker.type, worker.owner, worker.correlationId, reason);
        _terminate(worker, 'error');
        return null;
      });
  }

  // ══════════════════════════════════════════════════════════
  // ── PUBLIC: Main integration hook ──
  // Called by heartbeat/Nova. Evaluates pressure, spawns workers as needed.
  // ══════════════════════════════════════════════════════════
  function evaluateAndRun(options) {
    options = options || {};
    var snapshot = options.snapshot || {};

    // 1) CEO Kill Switch — check FIRST
    if (!isEnabled()) {
      var activeCount = _activeWorkers.length;
      if (activeCount > 0) {
        var terminated = _terminateAll('disabled_by_ceo');
        var now = Date.now();
        if (now - _lastKillSwitchAuditTs > KILL_SWITCH_DEBOUNCE_MS) {
          _lastKillSwitchAuditTs = now;
          WorkerAudit.logWorkersTerminated(terminated, 'WorkerManager');
        }
      }
      return Promise.resolve({ ran: false, reason: 'disabled_by_ceo', reports: [] });
    }

    // 2) Load registry (fail closed)
    return CompanyWorkers.load().then(function (registry) {
      if (!registry || CompanyWorkers.hasError()) {
        // Fail closed: disable for this cycle
        var now = Date.now();
        if (now - _lastKillSwitchAuditTs > KILL_SWITCH_DEBOUNCE_MS) {
          _lastKillSwitchAuditTs = now;
          WorkerAudit.logRegistryError(CompanyWorkers.getError() || 'registry_load_failed');
        }
        _terminateAll('registry_error');
        return { ran: false, reason: 'registry_error', reports: [] };
      }

      // 3) Enforce timeouts on any existing workers
      _enforceTimeouts();

      // 4) Evaluate pressure
      var highPressure = _evaluatePressure(snapshot);

      if (!highPressure) {
        _lowPressureCycles++;
        if (_lowPressureCycles >= 2 && _activeWorkers.length > 0) {
          _terminateAll('pressure_normalized');
        }
        return { ran: false, reason: 'pressure_normal', reports: [] };
      }

      _lowPressureCycles = 0;

      // 5) Determine which workers to spawn
      var enabledWorkers = CompanyWorkers.getEnabled();
      var reports = [];
      var spawnPromises = [];

      for (var i = 0; i < enabledWorkers.length; i++) {
        var wDef = enabledWorkers[i];

        // Global cap
        if (_activeWorkers.length >= GLOBAL_MAX_WORKERS) break;

        // Per-owner cap
        if (_countActiveByOwner(wDef.ownerRole) >= Math.min(wDef.maxConcurrent, MAX_PER_OWNER)) continue;

        // Budget check
        if (!_checkBudget(wDef)) continue;

        // Build items for this worker type
        var items = _buildItems(wDef, snapshot);
        if (items.length === 0) continue;

        // Context
        var context = {
          laneCounts: snapshot.laneCounts || {},
          overdueCount: snapshot.overdueCount || 0,
          pendingApprovalsCount: snapshot.pendingApprovalsCount || 0,
          campaigns: snapshot.campaigns || snapshot.directives || [],
          directives: snapshot.campaigns || snapshot.directives || [], // backward compat
          objectives: snapshot.objectives || []
        };

        spawnPromises.push(_runWorker(wDef, items, context));
      }

      if (spawnPromises.length === 0) {
        return { ran: false, reason: 'no_eligible_workers', reports: [] };
      }

      return Promise.all(spawnPromises).then(function (results) {
        var validReports = results.filter(function (r) { return r !== null; });
        return { ran: true, reason: 'pressure_high', reports: validReports };
      });
    });
  }

  // ── Build items list from snapshot for each worker type ──
  function _buildItems(workerDef, snapshot) {
    var items = [];
    var tasks = snapshot.tasks || [];
    var maxItems = workerDef.budget.maxItemsPerRun;

    switch (workerDef.id) {
      case 'triage_worker':
        // Items: overdue + in_review tasks
        items = tasks.filter(function (t) {
          return t.status === 'in_review' || t.isOverdue;
        });
        break;

      case 'scribe_worker':
        // Items: tasks needing documentation / recently completed
        items = tasks.filter(function (t) {
          return t.status === 'done' || t.status === 'in_review';
        });
        break;

      case 'research_worker':
        // Items: blocked tasks
        items = tasks.filter(function (t) {
          return t.status === 'blocked';
        });
        break;

      case 'qa_worker':
        // Items: in_review tasks
        items = tasks.filter(function (t) {
          return t.status === 'in_review';
        });
        break;

      default:
        items = tasks.slice(0, maxItems);
    }

    // Safe minimal projections (strip internal data)
    return items.slice(0, maxItems).map(function (t) {
      return {
        id: t.id,
        title: t.title || 'Untitled',
        status: t.status || 'unknown',
        priority: t.priority || 'medium',
        assignee: t.assignee || null,
        age: t.age || null,
        isOverdue: !!t.isOverdue
      };
    });
  }

  // ── Public getters for UI ──
  function getActiveWorkers() {
    _enforceTimeouts();
    return _activeWorkers.filter(function (w) { return w.state !== 'terminated'; });
  }

  function getActiveCount() {
    return getActiveWorkers().length;
  }

  function getLastReportTimestamp() {
    var reports = getLatestReports(1);
    if (reports.length > 0 && reports[0].finishedAt) return reports[0].finishedAt;
    return null;
  }

  return {
    evaluateAndRun: evaluateAndRun,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    getActiveWorkers: getActiveWorkers,
    getActiveCount: getActiveCount,
    getLatestReports: getLatestReports,
    getLastReportTimestamp: getLastReportTimestamp,
    PRESSURE_THRESHOLDS: PRESSURE_THRESHOLDS,
    GLOBAL_MAX_WORKERS: GLOBAL_MAX_WORKERS,
    MAX_PER_OWNER: MAX_PER_OWNER
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkerManager;
}
