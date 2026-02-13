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
  var TASK_CLASSIFICATIONS = ['autonomous', 'advisory', 'executive_required'];
  var RISK_LEVELS = ['low', 'medium', 'high'];
  var BRAND_IMPACTS = ['low', 'medium', 'high'];
  var DIRECTIVE_STATUSES = ['active', 'completed', 'paused'];
  var OBJECTIVE_STATUSES = ['on_track', 'at_risk', 'behind', 'complete'];
  var QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  var LOG_TYPES = ['heartbeat', 'standup', 'task-created', 'task-updated', 'task-moved', 'chat', 'cron', 'error', 'morning-report', 'agent-action', 'ceo-approval', 'ceo-reject', 'ceo-override', 'ceo-revision', 'escalation', 'directive-created', 'objective-created'];

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

  // ── Directive ──
  function validateDirective(d) {
    if (!d || typeof d !== 'object') return { valid: false, error: 'Directive must be an object' };
    if (!isString(d.id)) return { valid: false, error: 'Directive.id required' };
    if (!isString(d.title) || d.title.length === 0) return { valid: false, error: 'Directive.title required' };
    if (!isOneOf(d.status, DIRECTIVE_STATUSES)) return { valid: false, error: 'Directive.status invalid' };
    return { valid: true };
  }

  function createDirective(data) {
    return {
      id: 'dir-' + Date.now(),
      title: (data && data.title) || '',
      description: (data && data.description) || '',
      createdDate: new Date().toISOString(),
      priority: (data && data.priority) || 'medium',
      status: 'active',
      linkedObjectives: [],
      linkedTasks: []
    };
  }

  // ── Objective ──
  function validateObjective(o) {
    if (!o || typeof o !== 'object') return { valid: false, error: 'Objective must be an object' };
    if (!isString(o.id)) return { valid: false, error: 'Objective.id required' };
    if (!isString(o.title) || o.title.length === 0) return { valid: false, error: 'Objective.title required' };
    if (!isOneOf(o.status, OBJECTIVE_STATUSES)) return { valid: false, error: 'Objective.status invalid' };
    return { valid: true };
  }

  function createObjective(data) {
    return {
      id: 'obj-' + Date.now(),
      title: (data && data.title) || '',
      quarter: (data && data.quarter) || 'Q1',
      year: (data && data.year) || new Date().getFullYear(),
      linkedDirective: (data && data.linkedDirective) || null,
      progressPercentage: 0,
      status: 'on_track',
      owner: 'nova',
      linkedTasks: []
    };
  }

  // ── Decision Classification ──
  function classifyTask(task) {
    if (task.classification) return task.classification;
    // Auto-classify based on risk/impact
    if (task.risk_level === 'high' || task.brand_impact === 'high') return 'executive_required';
    if (task.budget_impact && task.budget_impact > 100) return 'executive_required';
    if (task.risk_level === 'medium' || task.brand_impact === 'medium') return 'advisory';
    return 'autonomous';
  }

  // ── Guardrail Config ──
  var GUARDRAIL_DEFAULTS = {
    maxActionsPerCyclePerAgent: 3,
    maxGeminiCallsPerCycle: 15,
    maxNewTasksPerCycle: 5,
    maxExecutesPerCyclePerAgent: 1,
    dedupeWindowMs: 300000, // 5 minutes
    cfoThreshold: 100 // budget_impact above this requires CEO approval
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
    TASK_CLASSIFICATIONS: TASK_CLASSIFICATIONS,
    RISK_LEVELS: RISK_LEVELS,
    BRAND_IMPACTS: BRAND_IMPACTS,
    DIRECTIVE_STATUSES: DIRECTIVE_STATUSES,
    OBJECTIVE_STATUSES: OBJECTIVE_STATUSES,
    QUARTERS: QUARTERS,
    LOG_TYPES: LOG_TYPES,
    validateTask: validateTask,
    validateLogEvent: validateLogEvent,
    createLogEvent: createLogEvent,
    validateMorningReport: validateMorningReport,
    createMorningReport: createMorningReport,
    validateDirective: validateDirective,
    createDirective: createDirective,
    validateObjective: validateObjective,
    createObjective: createObjective,
    classifyTask: classifyTask,
    GUARDRAIL_DEFAULTS: GUARDRAIL_DEFAULTS,
    getGuardrails: getGuardrails
  };
})();

// Support both browser and Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompanySchemas;
}
