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

  var TASK_STATUSES = ['pending-approval', 'backlog', 'todo', 'in-progress', 'review', 'done'];
  var TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];
  var TASK_CLASSIFICATIONS = ['autonomous', 'advisory', 'executive_required'];
  var RISK_LEVELS = ['low', 'medium', 'high'];
  var BRAND_IMPACTS = ['low', 'medium', 'high'];
  var DIRECTIVE_STATUSES = ['pending-approval', 'active', 'completed', 'paused'];
  var OBJECTIVE_STATUSES = ['on_track', 'at_risk', 'behind', 'complete', 'canceled'];
  var QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  var LOG_TYPES = ['heartbeat', 'standup', 'task-created', 'task-updated', 'task-moved', 'chat', 'cron', 'error', 'morning-report', 'agent-action', 'ceo-approval', 'ceo-reject', 'ceo-override', 'ceo-revision', 'escalation', 'directive-created', 'objective-created', 'action-created', 'action-approved', 'action-rejected', 'action-running', 'action-success', 'action-failed', 'publish-requested', 'publish-approved', 'publish-rejected', 'publish-executed', 'publish-failed'];

  // ── Action Layer v1 ──
  var ACTION_CATEGORIES = {
    social: ['social_post.draft', 'social_post.schedule', 'social_post.publish', 'social_post.reply'],
    email: ['email.search', 'email.summarize_thread', 'email.draft', 'email.send'],
    git: ['git.create_branch', 'git.commit', 'git.open_pr'],
    azure: ['azure.deploy'],
    content: ['generate_asset', 'publish_gallery', 'publish_document']
  };
  var ALL_ACTION_TYPES = [];
  Object.keys(ACTION_CATEGORIES).forEach(function (cat) {
    ACTION_CATEGORIES[cat].forEach(function (t) { ALL_ACTION_TYPES.push(t); });
  });

  var ACTION_EXECUTION_STATUSES = ['pending', 'approved', 'running', 'success', 'failed', 'rejected', 'dry_run', 'scheduled'];

  var ACTION_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'revision_requested', 'overridden'];
  var ACTION_EXEC_STATUSES = ['pending', 'queued', 'running', 'success', 'failed'];
  var SUPPORTED_PLATFORMS = ['x', 'linkedin', 'bluesky'];  // only x implemented v1

  // Actions that always require CEO approval
  var ACTIONS_REQUIRE_APPROVAL = [
    'social_post.publish', 'social_post.reply', 'social_post.schedule',
    'email.send',
    'git.open_pr',
    'azure.deploy',
    'publish_gallery',
    'publish_document'
  ];

  // Actions that are irreversible once executed
  var ACTIONS_IRREVERSIBLE = [
    'social_post.publish', 'social_post.reply', 'social_post.schedule',
    'email.send',
    'git.commit', 'git.open_pr',
    'azure.deploy',
    'publish_gallery',
    'publish_document'
  ];

  // Document publish pipeline statuses
  var DOCUMENT_STATUSES = ['draft', 'review', 'ready_for_approval', 'approved', 'published', 'rejected'];

  // Default rate limits per integration category (per 24h)
  var ACTION_RATE_LIMITS = {
    social: 10,
    email: 20,
    git: 15,
    azure: 5,
    content: 10
  };

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
      linkedTasks: [],
      kpiLinks: (data && isArray(data.kpiLinks)) ? data.kpiLinks : [],
      kpiImpactNotes: (data && data.kpiImpactNotes) || ''
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
      linkedDirectives: (data && Array.isArray(data.linkedDirectives)) ? data.linkedDirectives : (data && data.linkedDirective ? [data.linkedDirective] : []),
      progressPercentage: 0,
      status: 'on_track',
      owner: 'nova',
      linkedTasks: []
    };
  }

  // ── Action Request (v1 — nested model) ──
  function validateActionRequest(a) {
    if (!a || typeof a !== 'object') return { valid: false, error: 'ActionRequest must be an object' };
    if (!isString(a.id)) return { valid: false, error: 'ActionRequest.id required' };
    if (!isString(a.type) || ALL_ACTION_TYPES.indexOf(a.type) === -1) return { valid: false, error: 'ActionRequest.type invalid: ' + a.type };
    if (!a.approval || !isOneOf(a.approval.status, ACTION_APPROVAL_STATUSES)) return { valid: false, error: 'ActionRequest.approval.status invalid' };
    if (!a.execution || !isOneOf(a.execution.status, ACTION_EXEC_STATUSES)) return { valid: false, error: 'ActionRequest.execution.status invalid' };
    return { valid: true };
  }

  function createActionRequest(data) {
    var d = data || {};
    var actionType = d.type || d.action_type || '';
    var platform = d.platform || _inferPlatform(actionType, d.payload || d.action_payload);
    var requiresApproval = ACTIONS_REQUIRE_APPROVAL.indexOf(actionType) !== -1;
    return {
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      created_at: new Date().toISOString(),
      created_by: d.created_by || d.origin_agent || 'nova',
      type: actionType,
      platform: platform,
      payload: d.payload || d.action_payload || {},
      classification: d.classification || (requiresApproval ? 'advisory' : 'autonomous'),
      requires_ceo_approval: requiresApproval,
      risk_level: d.risk_level || (requiresApproval ? 'medium' : 'low'),
      brand_impact: d.brand_impact || (actionType.indexOf('social_post') === 0 ? 'medium' : 'low'),
      budget_impact: d.budget_impact || 0,
      approval: {
        status: requiresApproval ? 'pending' : 'approved',
        approved_by: requiresApproval ? null : 'system',
        approved_at: requiresApproval ? null : new Date().toISOString(),
        decision_note: null
      },
      execution: {
        status: 'pending',
        started_at: null,
        finished_at: null,
        attempts: 0,
        last_error: null,
        receipt: null
      },
      // Legacy compat fields (read by existing UI)
      action_type: actionType,
      action_category: getActionCategory(actionType),
      execution_status: requiresApproval ? 'pending' : 'approved',
      origin_agent: d.created_by || d.origin_agent || 'nova',
      action_payload: d.payload || d.action_payload || {},
      requires_approval: requiresApproval,
      is_irreversible: ACTIONS_IRREVERSIBLE.indexOf(actionType) !== -1,
      bundle_id: d.bundle_id || null
    };
  }

  function _inferPlatform(actionType, payload) {
    // Social posts: check payload.platform first, default to 'x'
    if (actionType.indexOf('social_post') === 0) {
      if (payload && payload.platform && SUPPORTED_PLATFORMS.indexOf(payload.platform) !== -1) return payload.platform;
      return 'x';
    }
    if (actionType.indexOf('email') === 0) return 'email';
    if (actionType.indexOf('git') === 0) return 'github';
    if (actionType.indexOf('azure') === 0) return 'azure';
    return 'internal';
  }

  function getActionCategory(actionType) {
    var cats = Object.keys(ACTION_CATEGORIES);
    for (var i = 0; i < cats.length; i++) {
      if (ACTION_CATEGORIES[cats[i]].indexOf(actionType) !== -1) return cats[i];
    }
    return 'unknown';
  }

  function createExecutionReceipt(data) {
    return {
      platform: (data && data.platform) || '',
      handle: (data && data.handle) || '',
      post_id: (data && data.post_id) || '',
      post_url: (data && data.post_url) || '',
      timestamp: new Date().toISOString(),
      content_hash: (data && data.content_hash) || '',
      media_ids: (data && data.media_ids) || [],
      recipients: (data && data.recipients) || [],
      subject: (data && data.subject) || null,
      extra: (data && data.extra) || {}
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
    cfoThreshold: 100, // budget_impact above this requires CEO approval
    actionDryRunDefault: true, // all actions default to dry-run until toggled off
    actionRateLimits: ACTION_RATE_LIMITS
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
    // Action Layer
    ACTION_CATEGORIES: ACTION_CATEGORIES,
    ALL_ACTION_TYPES: ALL_ACTION_TYPES,
    ACTION_EXECUTION_STATUSES: ACTION_EXECUTION_STATUSES,
    ACTION_APPROVAL_STATUSES: ACTION_APPROVAL_STATUSES,
    ACTION_EXEC_STATUSES: ACTION_EXEC_STATUSES,
    SUPPORTED_PLATFORMS: SUPPORTED_PLATFORMS,
    ACTIONS_REQUIRE_APPROVAL: ACTIONS_REQUIRE_APPROVAL,
    ACTIONS_IRREVERSIBLE: ACTIONS_IRREVERSIBLE,
    DOCUMENT_STATUSES: DOCUMENT_STATUSES,
    ACTION_RATE_LIMITS: ACTION_RATE_LIMITS,
    validateActionRequest: validateActionRequest,
    createActionRequest: createActionRequest,
    getActionCategory: getActionCategory,
    createExecutionReceipt: createExecutionReceipt,
    GUARDRAIL_DEFAULTS: GUARDRAIL_DEFAULTS,
    getGuardrails: getGuardrails
  };
})();

// Support both browser and Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompanySchemas;
}
