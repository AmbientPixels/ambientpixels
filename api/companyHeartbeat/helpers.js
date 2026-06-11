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

  // Inject agent personality for voice differentiation
  const _agentId = options.agentId || 'nova';
  const _pData = (C._agentPersonalityData && C._agentPersonalityData[_agentId]) || {};
  const _voiceHint = _pData.communicationStyle
    ? '- Voice: ' + _pData.communicationStyle
    : '';
  const prompt = [
    'Write exactly ONE conversational first-person sentence for a newly created ' + k + '.',
    'Rules:',
    '- Max 180 characters',
    '- Plain human language',
    '- No lists, no labels, no metadata, no markdown',
    '- Return only the sentence',
    _voiceHint,
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
//
// Two bugs fixed here as of 2026-04-15:
//
// 1) Wrong destination. Prior code routed every event to `logs` via
//    storage.appendLog. The CEO-facing audit trail is `governanceLog` — that's
//    where policy-violation, stall-alert, campaign-pace-alert, and fleet
//    events should land (per skill changelog). Routine telemetry (heartbeat,
//    run-*, mode-resolved) stays in `logs`.
//
// 2) Read-modify-write race. appendLog did GET→push→SET with no lock. When
//    rate-limit gates fired 500+ times in one cycle (Gemini over-production),
//    concurrent R-M-W overwrote each other — only ~1 of ~500 landed. Fix:
//    buffer events during a heartbeat run, flush once at end as a single
//    bulk append per destination.
//
// Non-heartbeat callers (crons, standup) still work unchanged — if no run
// is active, logEvent falls back to direct appendLog.

// Types that land in governanceLog (CEO-facing audit trail).
// Anything not listed goes to `logs` (routine telemetry).
const _GOVERNANCE_TYPES = new Set([
  'policy-violation',
  'stall-alert',
  'campaign-pace-alert',
  'system-directive-created',
  'experiment-auto-concluded',
  'emergence-signal',
  'agent-retired', 'agent-hired', 'agent-evolved'
]);

let _runBuffer = null;     // { cycleId, events: [] } when a heartbeat is active
const RUN_BUFFER_MAX = 2000; // defensive cap per run — shouldn't be hit in practice

function beginRunLogging(cycleId) {
  _runBuffer = { cycleId: cycleId, events: [] };
}

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

  // Active heartbeat buffer → push in-memory (O(1), no race).
  if (_runBuffer && _runBuffer.cycleId === cycleId && _runBuffer.events.length < RUN_BUFFER_MAX) {
    _runBuffer.events.push(event);
    return;
  }

  // Fallback: non-heartbeat caller or buffer full. Route to correct destination
  // directly. Uses the same state keys as flushRunLog to keep reads consistent.
  await _appendToDestination(event);
}

async function _appendToDestination(event) {
  const stateKey = _GOVERNANCE_TYPES.has(event.type) ? 'governanceLog' : 'logs';
  // Direct-write path retains existing cap semantics (governanceLog has no
  // hard cap today; logs is capped at 1000 via storage.appendLog). For
  // governanceLog we manage the write inline.
  if (stateKey === 'logs') {
    await storage.appendLog(event);
    return;
  }
  const current = (await storage.getState('governanceLog')) || [];
  current.push(event);
  // Keep governanceLog forensic window wide — cap at 5000 (CEO-facing trail).
  const trimmed = current.length > 5000 ? current.slice(-5000) : current;
  await storage.setState('governanceLog', trimmed);
}

async function flushRunLog() {
  if (!_runBuffer || _runBuffer.events.length === 0) {
    _runBuffer = null;
    return { logsAdded: 0, governanceAdded: 0 };
  }
  const events = _runBuffer.events;
  _runBuffer = null; // close window before IO so re-entrance is safe

  const toGovernance = events.filter(e => _GOVERNANCE_TYPES.has(e.type));
  const toLogs = events.filter(e => !_GOVERNANCE_TYPES.has(e.type));

  // Single R-M-W per destination. Sequenced (not parallel) to avoid two
  // concurrent writes against storage if it ever shares transport.
  if (toLogs.length > 0) {
    try {
      const current = (await storage.getState('logs')) || [];
      const combined = current.concat(toLogs);
      const trimmed = combined.length > 1000 ? combined.slice(-1000) : combined;
      await storage.setState('logs', trimmed);
    } catch (_e) { /* non-fatal */ }
  }
  if (toGovernance.length > 0) {
    try {
      const current = (await storage.getState('governanceLog')) || [];
      const combined = current.concat(toGovernance);
      const trimmed = combined.length > 5000 ? combined.slice(-5000) : combined;
      await storage.setState('governanceLog', trimmed);
    } catch (_e) { /* non-fatal */ }
  }
  return { logsAdded: toLogs.length, governanceAdded: toGovernance.length };
}

// Spawn a fresh Scribe copy task after a quality-gate auto-rejection so the
// pipeline self-heals instead of stranding the parent in limbo. Mirrors the
// CEO-revision respawn pattern in index.js:533-575 but keyed off QG issues.
// Idempotent: skips if a non-done Scribe copy task already exists for the parent.
function spawnQgRespawnCopyTask(tasks, parentTask, platform, qgIssues, hallContext) {
  if (!Array.isArray(tasks) || !parentTask || !parentTask.id) return null;

  var _existing = tasks.find(function (t) {
    return t && t.assignee === 'scribe' && t.parent_task_id === parentTask.id &&
      t.status !== 'done' && t.status !== 'archived' &&
      typeof t.title === 'string' && t.title.indexOf('Write social copy') === 0;
  });
  if (_existing) return null;

  var _platform = String(platform || 'linkedin').toLowerCase();
  var _maxLen = _platform === 'x' ? '280 chars'
    : _platform === 'bluesky' ? '300 chars'
    : _platform === 'reddit' ? 'TITLE (max 300 chars) + body (200-800 words, markdown)'
    : _platform === 'facebook' ? '100-250 chars'
    : '400-800 chars for LinkedIn';

  var _cleanTitle = (parentTask.title || 'Untitled').replace(/^(?:DELIVERABLE: Blog Post —\s*|Promote blog post on [^:]+:\s*)/i, '');
  var _issuesList = (qgIssues || []).slice(0, 8).map(function (i) { return '- ' + i; }).join('\n');

  var _description = 'QUALITY GATE REJECTED the previous draft. Rewrite the ' + _platform + ' post for "' + _cleanTitle + '".\n\n'
    + 'Quality gate issues to fix:\n' + (_issuesList || '- (no specific issues captured)') + '\n\n'
    + 'Platform: ' + _platform + '\n'
    + 'Max length: ' + _maxLen + '\n\n';

  if (hallContext && hallContext.factsLine) {
    _description += 'Product facts to ground the copy:' + hallContext.factsLine + '\n\n';
  }

  _description += 'Requirements:\n'
    + '- Address every quality-gate issue above. Do NOT repeat the patterns that failed.\n'
    + '- Write exactly ONE post — one single post, no variations.\n'
    + '- Clean platform-ready copy (no markdown, no headers, no internal notes).\n'
    + '- Use execute-task to produce your deliverable.';

  var _newTaskId = 'task_' + Date.now() + '_qgcopy_' + Math.random().toString(36).substr(2, 4);
  var _newTask = {
    id: _newTaskId,
    title: 'Write social copy for: ' + _cleanTitle,
    description: _description,
    taskType: 'social_copy',
    status: 'todo',
    priority: 'critical',
    assignee: 'scribe',
    source: 'heartbeat',
    created_by: 'system',
    parent_task_id: parentTask.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    campaign_id: parentTask.campaign_id || null,
    objective_id: parentTask.objective_id || null,
    tags: ['social-copy', 'auto-created', 'qg-respawn', 'social-copy-for-' + parentTask.id],
    comments: [{
      id: 'cmt-qgrespawn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      author: 'system',
      text: 'Auto-spawned after quality gate rejection. Rewrite addressing the QG issues in the description above.',
      type: 'system',
      createdAt: new Date().toISOString()
    }]
  };
  tasks.push(_newTask);
  return _newTask;
}

// ── Semantic dedup for social posts (Phase 1 — quality hardening, 2026-06-10) ──
//
// The same-task dedup guards (one task → one pending action) miss campaign churn:
// many DIFFERENT tasks under one campaign producing near-identical copy. During the
// 7–9 day unsupervised run, ~11 near-duplicate "Startup Obituary" posts shipped while
// the fuzzy guard blocked 0 — because the live publish path (index.js auto-post) and
// the agent-runner create-social-action handler never compared post BODIES against
// each other, only task titles / same-task pending actions.
//
// This compares cleaned post copy against recent posts on the same platform (further
// scoped to the same campaign when the new post has one), using the house word-overlap
// metric (cf. comment dedup at agent-runner.js:~3290 and title fuzzy dedup at :~1505):
// similarity = sharedWords / max(|A|, |B|). Returns the best match — callers block +
// increment guardrails.fuzzyDupBlocked when isDuplicate is true.
//
// Pure + dependency-free so BOTH creation paths can call it and so it's checkable
// offline against the live actions store.

function _socialDedupNormalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')   // URLs — shared boilerplate + per-post UTM noise
    .replace(/[#@][\w-]+/g, ' ')        // hashtags + @mentions — campaign boilerplate
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _socialDedupWords(s) {
  return _socialDedupNormalize(s).split(' ').filter(function (w) { return w.length > 2; });
}

// opts: { text, platform, campaignId, actions, tasks, now?, threshold?, minWords?, windowDays? }
// returns: { isDuplicate, similarity (0–1), matchId }
function findNearDuplicateSocialPost(opts) {
  var EMPTY = { isDuplicate: false, similarity: 0, matchId: null };
  opts = opts || {};
  if (!opts.text || !Array.isArray(opts.actions)) return EMPTY;

  var threshold = (typeof opts.threshold === 'number') ? opts.threshold : 0.6;
  var minWords = (typeof opts.minWords === 'number') ? opts.minWords : 8;
  var windowDays = (typeof opts.windowDays === 'number') ? opts.windowDays : 14;
  var now = (typeof opts.now === 'number') ? opts.now : Date.now();
  var platform = String(opts.platform || '');
  var campaignId = opts.campaignId || null;
  var tasks = Array.isArray(opts.tasks) ? opts.tasks : [];

  var newWords = _socialDedupWords(opts.text);
  if (newWords.length < minWords) return EMPTY;        // too short to judge — let it through
  var newSet = new Set(newWords);

  var cutoff = now - windowDays * 24 * 60 * 60 * 1000;

  // Memoize parentTaskId → campaign_id so same-campaign scoping doesn't re-scan tasks.
  var _campaignCache = {};
  function _campaignOf(action) {
    var pid = action && action._parentTaskId;
    if (!pid) return null;
    if (Object.prototype.hasOwnProperty.call(_campaignCache, pid)) return _campaignCache[pid];
    var t = tasks.find(function (x) { return x && x.id === pid; });
    var c = t ? (t.campaign_id || null) : null;
    _campaignCache[pid] = c;
    return c;
  }

  var bestSim = 0;
  var bestId = null;
  for (var i = 0; i < opts.actions.length; i++) {
    var a = opts.actions[i];
    if (!a || typeof a.type !== 'string' || a.type.indexOf('social_post') !== 0) continue;
    if (String(a.platform || '') !== platform) continue;
    var st = (a.approval && a.approval.status) || '';
    if (st === 'rejected' || st === 'cancelled') continue;   // retry allowed after reject
    var ex = (a.execution && a.execution.status) || '';
    if (ex === 'failed') continue;                           // failed sends don't block new ones
    var ts = a.created_at || a.createdAt || (a.approval && a.approval.approved_at) || null;
    if (ts) {
      var tms = new Date(ts).getTime();
      if (Number.isFinite(tms) && tms < cutoff) continue;    // outside lookback window
    }
    if (campaignId) {
      var ec = _campaignOf(a);
      if (ec && ec !== campaignId) continue;                 // different campaign — skip
    }
    var exText = (a.payload && a.payload.text) || (a.action_payload && a.action_payload.text) || '';
    var exWords = _socialDedupWords(exText);
    if (exWords.length < minWords) continue;
    var exSet = new Set(exWords);
    var inter = 0;
    newSet.forEach(function (w) { if (exSet.has(w)) inter++; });
    var sim = inter / Math.max(newSet.size, exSet.size);
    if (sim > bestSim) { bestSim = sim; bestId = a.id || null; }
  }

  return { isDuplicate: bestSim >= threshold, similarity: bestSim, matchId: bestId };
}

// ── Per-source daily post cap (Phase 1 item 2 — quality hardening, 2026-06-10) ──
//
// findNearDuplicateSocialPost (item 1) bounds near-identical COPY; this bounds VOLUME so a
// single post SOURCE can't flood ONE platform with many posts in a day even when each post
// is worded differently enough to slip past the copy check. The "source" is the campaign
// when the post is campaigned, else the parent task — because the worst real flood was an
// UNCAMPAIGNED promo task that re-posted to X ~13× in 24h (hourly), which a campaign-only
// cap would miss entirely (43 of 75 historical posts had no campaign).
//
// Counts non-rejected/cancelled/failed social_post actions sharing the same source on the
// same platform in the last 24h. Cap: daily-cadence campaigns get `frequency` posts/
// platform/day, everything else (weekly/biweekly campaigns AND uncampaigned task sources)
// gets 1, plus a 1-post buffer so normal cadence is never throttled. Callers DEFER (not
// drop) over-cap posts so a flood spreads as older posts age out of the window.
//
// Pure + dependency-free so BOTH creation paths can call it and it's checkable offline.

function campaignDailyPostCapStatus(opts) {
  var ZERO = { exceeded: false, count: 0, cap: Infinity };
  opts = opts || {};
  var srcKey = opts.campaignId || opts.parentTaskId || null;
  if (!srcKey || !Array.isArray(opts.actions)) return ZERO; // no source to attribute → uncapped

  var now = (typeof opts.now === 'number') ? opts.now : Date.now();
  var windowMs = (typeof opts.windowMs === 'number') ? opts.windowMs : 24 * 60 * 60 * 1000;
  var platform = String(opts.platform || '');
  var cutoff = now - windowMs;

  var freq = (typeof opts.frequency === 'number' && opts.frequency > 0) ? opts.frequency : 1;
  var buffer = (typeof opts.buffer === 'number') ? opts.buffer : 1;
  // Only daily campaigns earn a frequency-scaled allowance; task sources & non-daily get 1.
  var base = (opts.campaignId && String(opts.cadence || '').toLowerCase() === 'daily') ? Math.ceil(freq) : 1;
  var cap = base + buffer;

  var tasks = Array.isArray(opts.tasks) ? opts.tasks : [];
  var _cache = {};
  function _sourceOf(a) {
    var pid = a && a._parentTaskId;
    // campaign source resolves via parent task's campaign_id; falls back to the task id.
    if (!pid) return null;
    if (Object.prototype.hasOwnProperty.call(_cache, pid)) return _cache[pid];
    var t = tasks.find(function (x) { return x && x.id === pid; });
    var c = (t && t.campaign_id) ? t.campaign_id : pid;
    _cache[pid] = c;
    return c;
  }

  var count = 0;
  for (var i = 0; i < opts.actions.length; i++) {
    var a = opts.actions[i];
    if (!a || typeof a.type !== 'string' || a.type.indexOf('social_post') !== 0) continue;
    if (String(a.platform || '') !== platform) continue;
    // Volume cap counts ALL attempts (incl. CEO-rejected + failed) — the flood is the SOURCE
    // generating posts, not whether they shipped (the worst case was 13 rejected + 1 success
    // from one task in 24h). Only explicitly cancelled/withdrawn actions don't count.
    var st = (a.approval && a.approval.status) || '';
    var ex = (a.execution && a.execution.status) || '';
    if (st === 'cancelled' || ex === 'cancelled') continue;
    var ts = a.created_at || a.createdAt || (a.approval && a.approval.approved_at) || null;
    if (ts) { var tms = new Date(ts).getTime(); if (Number.isFinite(tms) && tms < cutoff) continue; }
    if (_sourceOf(a) !== srcKey) continue;
    count++;
  }
  return { exceeded: count >= cap, count: count, cap: cap };
}

// ── Sentence-case normalization for agent-written text (2026-06-10) ──
//
// The founder-voice doctrine told agents to "start sentences lowercase when natural", which
// reads as broken capitalization to humans. This deterministically enforces proper sentence
// case on published copy regardless of what the LLM produced: capitalize the first word of
// every sentence (start of text, after . ! ?, and at each line start) and the standalone
// pronoun "i". The casual tone (short lines, no hype, no em dashes) is untouched — only the
// first letter of sentences changes.
//
// Safe by construction: URLs / bare domains / hashtags / @mentions are extracted and restored
// verbatim so a sentence that opens with a link or tag keeps its casing, and "i" inside a URL
// slug is never altered. Decimals/versions ("v2.5", "$1.15") aren't treated as sentence ends
// because the boundary requires whitespace after the punctuation.

function capitalizeSentences(text) {
  if (!text || typeof text !== 'string') return text;

  // 1. Freeze URLs / bare domains / hashtags / @mentions in ONE pass so a placeholder can
  //    never be re-matched by a later pattern. The {{FRZ:n}} placeholder has no [a-z] /
  //    standalone "i" so steps 2-3 leave it alone, and it can't collide with real digits in
  //    copy ("24 agents", "$1.15"). Restored verbatim at the end so links/tags keep their case.
  var _frozen = [];
  var _freezeRe = /(?:https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:ai|com|io|net|org|app|dev|co|xyz|gg)(?:\/\S*)?|[#@][\w-]+)/gi;
  var out = text.replace(_freezeRe, function (tok) { _frozen.push(tok); return '{{FRZ:' + (_frozen.length - 1) + '}}'; });

  // 2. Capitalize the first letter of each sentence: start of string, after .!? (+ optional
  //    closing quotes/brackets) + whitespace, or at a line start (allowing markdown list/
  //    quote markers + leading spaces). Optional opening quotes/brackets are skipped over.
  out = out.replace(
    /(^|[.!?]["')\]]*\s+|\n[ \t>*\-]*)(["'(\[]*)([a-z])/g,
    function (_m, boundary, lead, ch) { return boundary + lead + ch.toUpperCase(); }
  );

  // 3. Standalone pronoun "i" -> "I" (apostrophe boundary also covers i'm/i've/i'll/i'd).
  out = out.replace(/\bi\b/g, 'I');

  // 4. Restore frozen tokens verbatim.
  return out.replace(/\{\{FRZ:(\d+)\}\}/g, function (_m, n) { return _frozen[Number(n)]; });
}
module.exports = {
  _sanitizeSingleComment,
  generateConversationalEntityComment,
  findNearDuplicateSocialPost,
  campaignDailyPostCapStatus,
  capitalizeSentences,
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
  normalizeExecutionMode,
  evaluateEscalationPath,
  shouldRunTier4Agent,
  _socialIntelIsoDayUTC,
  _socialIntelEventTs,
  _socialIntelResolveMode,
  _createActionFromHeartbeat,
  logEvent,
  beginRunLogging,
  flushRunLog,
  spawnQgRespawnCopyTask
};
