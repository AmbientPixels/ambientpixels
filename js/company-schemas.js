// company-schemas.js — Lightweight validators for Company runtime data
// Used by both client (company-store.js) and server (timer triggers)

var CompanySchemas = (function () {
  'use strict';

  // ── Validation helpers ──
  function isString(v) { return typeof v === 'string'; }
  function isOptString(v) { return v === null || v === undefined || typeof v === 'string'; }
  function isNumber(v) { return typeof v === 'number' && !isNaN(v); }
  function isArray(v) { return Array.isArray(v); }
  function isOneOf(v, list) { return list.indexOf(v) !== -1; }

  var TASK_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done'];
  var TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];
  var LOG_TYPES = ['heartbeat', 'standup', 'task-created', 'task-updated', 'task-moved', 'chat', 'cron', 'error', 'morning-report', 'agent-action'];

  // ── Task ──
  function validateTask(t) {
    if (!t || typeof t !== 'object') return { valid: false, error: 'Task must be an object' };
    if (!isString(t.id)) return { valid: false, error: 'Task.id must be a string' };
    if (!isString(t.title) || t.title.length === 0) return { valid: false, error: 'Task.title is required' };
    if (!isOneOf(t.status, TASK_STATUSES)) return { valid: false, error: 'Task.status invalid: ' + t.status };
    if (!isOneOf(t.priority, TASK_PRIORITIES)) return { valid: false, error: 'Task.priority invalid: ' + t.priority };
    if (!isOptString(t.assignee)) return { valid: false, error: 'Task.assignee must be string or null' };
    if (!isOptString(t.division)) return { valid: false, error: 'Task.division must be string or null' };
    if (!isString(t.createdAt)) return { valid: false, error: 'Task.createdAt required' };
    return { valid: true };
  }

  // ── LogEvent ──
  function validateLogEvent(e) {
    if (!e || typeof e !== 'object') return { valid: false, error: 'LogEvent must be an object' };
    if (!isString(e.id)) return { valid: false, error: 'LogEvent.id must be a string' };
    if (!isString(e.type) || !isOneOf(e.type, LOG_TYPES)) return { valid: false, error: 'LogEvent.type invalid: ' + e.type };
    if (!isString(e.timestamp)) return { valid: false, error: 'LogEvent.timestamp required' };
    return { valid: true };
  }

  function createLogEvent(type, data) {
    return {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      type: type,
      agentId: (data && data.agentId) || null,
      summary: (data && data.summary) || '',
      details: (data && data.details) || null,
      cycle: (data && data.cycle) || null,
      timestamp: new Date().toISOString()
    };
  }

  // ── MorningReport ──
  function validateMorningReport(r) {
    if (!r || typeof r !== 'object') return { valid: false, error: 'MorningReport must be an object' };
    if (!isString(r.id)) return { valid: false, error: 'MorningReport.id required' };
    if (!isString(r.date)) return { valid: false, error: 'MorningReport.date required' };
    if (!isString(r.ceoSummary)) return { valid: false, error: 'MorningReport.ceoSummary required' };
    if (!isArray(r.completedTasks)) return { valid: false, error: 'MorningReport.completedTasks must be an array' };
    if (!isArray(r.newTasks)) return { valid: false, error: 'MorningReport.newTasks must be an array' };
    return { valid: true };
  }

  function createMorningReport(data) {
    return {
      id: 'report-' + Date.now(),
      date: new Date().toISOString().split('T')[0],
      generatedAt: new Date().toISOString(),
      completedTasks: (data && data.completedTasks) || [],
      newTasks: (data && data.newTasks) || [],
      decisions: (data && data.decisions) || [],
      risks: (data && data.risks) || [],
      ideas: (data && data.ideas) || [],
      ceoSummary: (data && data.ceoSummary) || '',
      agentHighlights: (data && data.agentHighlights) || {}
    };
  }

  // ── Guardrail Config ──
  var GUARDRAIL_DEFAULTS = {
    maxActionsPerCyclePerAgent: 3,
    maxGeminiCallsPerCycle: 10,
    maxNewTasksPerCycle: 5,
    dedupeWindowMs: 300000 // 5 minutes
  };

  function getGuardrails(overrides) {
    var g = {};
    Object.keys(GUARDRAIL_DEFAULTS).forEach(function (k) {
      g[k] = (overrides && overrides[k] !== undefined) ? overrides[k] : GUARDRAIL_DEFAULTS[k];
    });
    return g;
  }

  return {
    TASK_STATUSES: TASK_STATUSES,
    TASK_PRIORITIES: TASK_PRIORITIES,
    LOG_TYPES: LOG_TYPES,
    validateTask: validateTask,
    validateLogEvent: validateLogEvent,
    createLogEvent: createLogEvent,
    validateMorningReport: validateMorningReport,
    createMorningReport: createMorningReport,
    GUARDRAIL_DEFAULTS: GUARDRAIL_DEFAULTS,
    getGuardrails: getGuardrails
  };
})();

// Support both browser and Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompanySchemas;
}
