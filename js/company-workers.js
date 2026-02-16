// company-workers.js — Worker Registry loader + helpers for Worker Framework v1
// Loads and validates worker type definitions from /data/company-workers.json

var CompanyWorkers = (function () {
  'use strict';

  var _registry = null;       // Parsed registry object
  var _loadPromise = null;    // Singleton fetch promise
  var _loadError = null;      // Last load error (normalized string)

  // ── Load registry ──
  function load() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = fetch('/data/company-workers.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!_validate(data)) {
          throw new Error('Invalid registry structure');
        }
        _registry = data;
        _loadError = null;
        return _registry;
      })
      .catch(function (err) {
        _registry = null;
        _loadError = err && err.message ? err.message : 'Registry load failed';
        _loadPromise = null; // Allow retry
        return null;
      });
    return _loadPromise;
  }

  // ── Validation ──
  function _validate(data) {
    if (!data || !Array.isArray(data.workers)) return false;
    for (var i = 0; i < data.workers.length; i++) {
      var w = data.workers[i];
      if (!w.id || typeof w.id !== 'string') return false;
      if (typeof w.enabled !== 'boolean') return false;
      if (!w.budget || typeof w.budget.maxRunsPerHour !== 'number') return false;
      if (typeof w.ttlMinutes !== 'number' || w.ttlMinutes <= 0) return false;
      if (!w.permissions) return false;
      if (!w.outputSchema || !w.outputSchema.requiredSections) return false;
    }
    return true;
  }

  // ── Getters ──
  function isLoaded() {
    return _registry !== null;
  }

  function hasError() {
    return _loadError !== null;
  }

  function getError() {
    return _loadError;
  }

  function getAll() {
    if (!_registry) return [];
    return _registry.workers;
  }

  function getEnabled() {
    return getAll().filter(function (w) { return w.enabled === true; });
  }

  function getById(id) {
    return getAll().find(function (w) { return w.id === id; }) || null;
  }

  function getByOwner(ownerRole) {
    return getAll().filter(function (w) { return w.ownerRole === ownerRole; });
  }

  function getEnabledByOwner(ownerRole) {
    return getEnabled().filter(function (w) { return w.ownerRole === ownerRole; });
  }

  // ── Permission checks ──
  function canCreateTasks(workerId) {
    var w = getById(workerId);
    return w && w.permissions && w.permissions.canCreateTasks === true;
  }

  function canMoveTasks(workerId) {
    var w = getById(workerId);
    return w && w.permissions && w.permissions.canMoveTasks === true;
  }

  function canPublish(workerId) {
    var w = getById(workerId);
    return w && w.permissions && w.permissions.canPublish === true;
  }

  // ── Output schema ──
  function getRequiredSections(workerId) {
    var w = getById(workerId);
    if (!w || !w.outputSchema) return [];
    return w.outputSchema.requiredSections || [];
  }

  return {
    load: load,
    isLoaded: isLoaded,
    hasError: hasError,
    getError: getError,
    getAll: getAll,
    getEnabled: getEnabled,
    getById: getById,
    getByOwner: getByOwner,
    getEnabledByOwner: getEnabledByOwner,
    canCreateTasks: canCreateTasks,
    canMoveTasks: canMoveTasks,
    canPublish: canPublish,
    getRequiredSections: getRequiredSections
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompanyWorkers;
}
