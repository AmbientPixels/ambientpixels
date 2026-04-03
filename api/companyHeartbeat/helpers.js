// helpers.js — extracted from companyHeartbeat/index.js (Phase 1 refactor)
// Stateless utility functions: status checks, social intel, comment generation, logging

const storage = require('../_utils/companyStorage');
const C = require('./constants');
const { callGemini } = require('./gemini');

// ── Comment sanitization ──

function _sanitizeSingleComment(text, fallbackText) {
  const fallback = String(fallbackText || '').trim() || 'I created this item to keep execution aligned and moving forward.';
  if (!text) return fallback;
  let s = String(text).replace(/\s+/g, ' ').trim();
  s = s.replace(/^['"`]+|['"`]+$/g, '').trim();
  if (!s) return fallback;
  if (s.length > 220) s = s.substring(0, 220).trim();
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

async function generateConversationalEntityComment(kind, options) {
  options = options || {};
  const k = String(kind || 'item').toLowerCase();
  const title = String(options.title || '').trim();
  const goal = String(options.goalTitle || options.goalId || '').trim();
  const seed = String(options.seedText || '').trim();
  const fallback = _sanitizeSingleComment(options.fallbackText || '',
    k === 'campaign'
      ? 'I created this campaign to group related work and keep planning/execution aligned under one objective.'
      : 'I created this project from the goal so the team has a clear execution container to work from.'
  );

  const prompt = [
    'Write exactly ONE conversational first-person sentence for a newly created ' + k + '.',
    'Rules:',
    '- Max 180 characters',
    '- Plain human language',
    '- No lists, no labels, no metadata, no markdown',
    '- Return only the sentence',
    title ? ('Title: ' + title) : '',
    goal ? ('Goal: ' + goal) : '',
    seed ? ('Context: ' + seed.substring(0, 500)) : ''
  ].filter(Boolean).join('\n');

  const raw = await callGemini(prompt, options.agentId || 'nova');
  return _sanitizeSingleComment(raw, fallback);
}

// ── Task prefix stripping ──

function stripTaskPrefixes(title) {
  if (!title) return title || '';
  var changed = true;
  var maxPasses = 5;
  while (changed && maxPasses-- > 0) {
    changed = false;
    for (var i = 0; i < C._TASK_PREFIXES.length; i++) {
      if (C._TASK_PREFIXES[i].test(title)) {
        title = title.replace(C._TASK_PREFIXES[i], '');
        changed = true;
      }
    }
  }
  return title.trim();
}

// ── Status checks ──

function _isActiveStatus(status) {
  return status === 'todo' || status === 'in-progress' || status === 'review';
}

function _isRecent(ts, hours) {
  if (!ts) return false;
  var t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) <= hours * 60 * 60 * 1000;
}

function _hasAssignedActiveTasks(tasks, agentId) {
  return tasks.some(function (t) {
    return String(t.assignee || '').toLowerCase() === agentId &&
      _isActiveStatus(String(t.status || '').toLowerCase());
  });
}

function _hasRecentMention(tasks, agentId) {
  var agentName = (C.AGENT_ROLES[agentId] && C.AGENT_ROLES[agentId].name) || agentId;
  var needle = ('@' + agentName).toLowerCase();

  return tasks.some(function (t) {
    var comments = Array.isArray(t.comments) ? t.comments : [];
    return comments.some(function (c) {
      var text = String(c.text || c.comment || c.body || '').trim().toLowerCase();
      var ts = c.createdAt || c.created_at || c.timestamp || c.time || null;
      return text.indexOf(needle) !== -1 && _isRecent(ts, C.SUB_AGENT_MENTION_WINDOW_HOURS);
    });
  });
}

// ── Status/category normalization ──

function _normalizeCategory(category) {
  return String(category || '').trim().toLowerCase();
}

function _isInProgressStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'in-progress' || normalized === 'in_progress';
}

function _isStartWorkStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || _isInProgressStatus(normalized);
}

function _isTerminalTaskStatus(s) {
  return ['done', 'completed', 'closed'].includes(String(s || '').toLowerCase());
}

function _isObjectiveExemptCategory(category) {
  return C.OBJECTIVE_EXEMPT_CATEGORIES.has(_normalizeCategory(category));
}

function _normalizeActivationMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (C.ALLOWED_MODES.has(normalized)) return normalized;
  return 'supervised_autonomous';
}

async function resolveActivationMode(storage, runId) {
  var raw = await storage.getState('activationMode');
  var provided = String(raw || '').trim().toLowerCase();
  if (C.ALLOWED_MODES.has(provided)) return provided;
  await logEvent('policy-violation', null, 'Invalid or missing activationMode, defaulting to supervised_autonomous', runId, {
    runId: runId, gate: 'activation_mode', reason: 'invalid_or_missing_mode', provided: raw || null
  });
  return 'supervised_autonomous';
}

function normalizeExecutionMode(v) {
  var s = String(v || '').trim().toLowerCase();
  return C.ALLOWED_EXEC_MODES.has(s) ? s : 'active';
}

// ── Escalation ──

function evaluateEscalationPath(task, now) {
  const assignee = (task.assignee || '').toLowerCase();
  const priority = (task.priority || 'medium').toLowerCase();
  const status = (task.status || '').toLowerCase();
  const domainLead = task.domainLead || C.DOMAIN_LEAD_MAP[assignee] || 'nova';
  const isBlocked = status === 'blocked' || (task.tags && task.tags.indexOf('blocked') !== -1);
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const hoursUntilDue = dueDate ? (dueDate.getTime() - now) / (1000 * 60 * 60) : Infinity;
  const isOverdue = dueDate ? hoursUntilDue < 0 : false;

  if (isBlocked) return { handler: 'escalationLead', domainLead, reason: 'task_blocked', novaSkip: false };
  if (isOverdue) return { handler: 'escalationLead', domainLead, reason: 'task_overdue', novaSkip: false };
  if (priority === 'high' && hoursUntilDue <= 24) return { handler: 'both', domainLead, reason: 'high_due_24h', novaSkip: false };

  const _taskAge = task.updatedAt ? (now - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60) : 0;
  if (priority === 'medium' && hoursUntilDue <= 24) {
    if (assignee === 'nova') return { handler: 'owner', domainLead, reason: 'medium_due_24h_nova_is_owner', novaSkip: false };
    if (_taskAge >= 8) return { handler: 'both', domainLead, reason: 'medium_due_24h_stale_8h', novaSkip: false };
    return { handler: 'domainLead', domainLead, reason: 'medium_due_24h_domain_lead_handles', novaSkip: true };
  }

  return { handler: 'owner', domainLead, reason: 'normal_flow', novaSkip: false };
}

function shouldRunTier4Agent(tasks, agentId) {
  if (!C.TIER4_SUB_AGENTS.has(agentId)) return { run: true, reason: 'not_tier4_subagent' };
  if (_hasAssignedActiveTasks(tasks, agentId)) return { run: true, reason: 'assigned_active_task' };
  if (_hasRecentMention(tasks, agentId)) return { run: true, reason: 'recent_mention_ping' };
  return { run: false, reason: 'no_assigned_tasks_or_mentions' };
}

// ── Social intel ──

function _socialIntelIsoDayUTC(d) {
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function _socialIntelEventTs(ev) {
  var iso = (ev && (ev.executed_at || ev.created_at)) || '';
  var ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : null;
}

function _socialIntelResolveMode(engagementMeta, snapshots) {
  var mode = engagementMeta && typeof engagementMeta.mode === 'string' ? String(engagementMeta.mode).trim() : '';
  if (mode === 'real') return 'real';
  return 'real';
}

// ── Action serialization ──

function _createActionFromHeartbeat(data, agentId) {
  const actionType = data.type || 'social_post.publish';
  const platform = data.platform || 'x';
  const requiresApproval = ['social_post.publish', 'social_post.reply', 'social_post.schedule'].indexOf(actionType) !== -1;
  const catMap = { social_post: 'social', email: 'email', git: 'git', azure: 'azure' };
  const catKey = actionType.split('.')[0] || 'unknown';
  const category = catMap[catKey] || 'content';

  return {
    id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    created_at: new Date().toISOString(),
    created_by: agentId,
    type: actionType,
    platform: platform,
    payload: data.payload || {},
    classification: 'advisory',
    requires_ceo_approval: requiresApproval,
    risk_level: 'medium',
    brand_impact: 'medium',
    budget_impact: 0,
    approval: { status: 'pending', approved_by: null, approved_at: null, decision_note: null },
    execution: { status: 'pending', started_at: null, finished_at: null, attempts: 0, last_error: null, receipt: null },
    action_type: actionType,
    action_category: category,
    execution_status: 'pending',
    origin_agent: agentId,
    action_payload: data.payload || {},
    requires_approval: requiresApproval,
    is_irreversible: ['social_post.publish', 'social_post.reply'].indexOf(actionType) !== -1,
    bundle_id: null,
    source: 'heartbeat',
    experiment_tag: data.experiment_tag || null
  };
}

// ── Log helper ──

async function logEvent(type, agentId, summary, cycleId, details) {
  const event = {
    id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    type: type,
    agentId: agentId,
    summary: summary,
    cycle: cycleId,
    timestamp: new Date().toISOString()
  };
  if (details && typeof details === 'object') event.details = details;
  await storage.appendLog(event);
}

module.exports = {
  _sanitizeSingleComment,
  generateConversationalEntityComment,
  stripTaskPrefixes,
  _isActiveStatus,
  _isRecent,
  _hasAssignedActiveTasks,
  _hasRecentMention,
  _normalizeCategory,
  _isInProgressStatus,
  _isStartWorkStatus,
  _isTerminalTaskStatus,
  _isObjectiveExemptCategory,
  _normalizeActivationMode,
  resolveActivationMode,
  normalizeExecutionMode,
  evaluateEscalationPath,
  shouldRunTier4Agent,
  _socialIntelIsoDayUTC,
  _socialIntelEventTs,
  _socialIntelResolveMode,
  _createActionFromHeartbeat,
  logEvent
};
