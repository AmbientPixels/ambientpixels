// campaign-lifecycle.js — Campaign normalization, auto-complete, auto-pause, reactivation, auto-replenish
// Extracted from index.js to reduce heartbeat orchestrator size.

const { normalizeCampaignRef } = require('../_shared/campaignMatcher');

var _validTaskTypes = ['blog_post', 'social_linkedin', 'social_bluesky', 'social_x', 'social_reddit', 'social_facebook', 'design_asset', 'internal_doc', 'research', 'ops', 'financial', 'general'];

var _cadenceMs = { daily: 86400000, weekly: 604800000, biweekly: 1209600000 };
var _taskTypeToAgent = {
  blog_post: 'scribe', social_linkedin: 'echo', social_bluesky: 'echo',
  social_x: 'echo', social_facebook: 'echo', design_asset: 'pixel',
  research: 'scout', internal_doc: 'scribe', general: 'nova',
  bluesky_discovery: 'scout', bluesky_reply: 'scribe'
};
var _taskTypeLabels = {
  blog_post: 'blog post', social_linkedin: 'LinkedIn post', social_bluesky: 'Bluesky post',
  social_x: 'X post', social_facebook: 'Facebook post', design_asset: 'design asset',
  research: 'research task', internal_doc: 'internal doc', general: 'task',
  bluesky_discovery: 'Bluesky thread discovery', bluesky_reply: 'Bluesky reply draft'
};

/**
 * Run all campaign lifecycle operations: normalize, auto-complete, auto-pause, reactivate, auto-replenish.
 * Mutates campaigns, tasks, and objectives in-place.
 *
 * @param {Object} opts
 * @param {Array} opts.campaigns
 * @param {Array} opts.tasks
 * @param {Array} opts.objectives
 * @param {Function} opts.log - context.log or equivalent
 * @returns {{ campaignsChanged: boolean, tasksChanged: boolean, autoFixCount: number, campaignGovEvents: Array, campaignsTouched: Set, campaignById: Object }}
 */
function processCampaignLifecycle({ campaigns, tasks, objectives, log }) {
  let campaignsChanged = false;
  let autoFixCount = 0;
  const campaignGovEvents = [];
  const campaignsTouched = new Set();

  // ── Normalize campaign fields ──
  for (const c of campaigns) {
    if (!c || typeof c !== 'object') continue;
    if (!c.id) { c.id = 'cmp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6); campaignsChanged = true; autoFixCount++; campaignsTouched.add(c.id); }
    if (!c.status) { c.status = 'active'; campaignsChanged = true; autoFixCount++; if (c.id) campaignsTouched.add(c.id); }
    if (!c.createdAt) { c.createdAt = new Date().toISOString(); campaignsChanged = true; autoFixCount++; if (c.id) campaignsTouched.add(c.id); }
    if (!c.updatedAt) { c.updatedAt = c.createdAt; campaignsChanged = true; autoFixCount++; if (c.id) campaignsTouched.add(c.id); }
    if (!c.title) { c.title = 'Untitled Campaign'; campaignsChanged = true; autoFixCount++; if (c.id) campaignsTouched.add(c.id); }
    if (c.description === undefined || c.description === null) { c.description = ''; campaignsChanged = true; autoFixCount++; if (c.id) campaignsTouched.add(c.id); }
    if (c.taskType && _validTaskTypes.indexOf(c.taskType) === -1) { c.taskType = null; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); }
    if (Array.isArray(c.allowedTaskTypes)) { c.allowedTaskTypes = c.allowedTaskTypes.filter(function (t) { return _validTaskTypes.indexOf(t) !== -1; }); if (c.allowedTaskTypes.length === 0) { c.allowedTaskTypes = null; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); } }
    if (c.maxTasks !== undefined && c.maxTasks !== null && typeof c.maxTasks !== 'number') { c.maxTasks = parseInt(c.maxTasks, 10) || null; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); }
    if (c.frequency !== undefined && c.frequency !== null && typeof c.frequency !== 'number') { c.frequency = parseInt(c.frequency, 10) || null; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); }
    if (c.frequency && c.frequency < 1) { c.frequency = 1; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); }
    if (c.cadence && ['daily', 'weekly', 'biweekly'].indexOf(c.cadence) === -1) { c.cadence = null; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); }
    if (c.endDate && isNaN(new Date(c.endDate).getTime())) { c.endDate = null; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); }
    if (c.startDate && isNaN(new Date(c.startDate).getTime())) { c.startDate = null; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); }
    if (c.autoComplete !== undefined && typeof c.autoComplete !== 'boolean') { c.autoComplete = c.autoComplete !== false && c.autoComplete !== 'false'; campaignsChanged = true; if (c.id) campaignsTouched.add(c.id); }
  }

  // ── Normalize objective linking ──
  for (const _normObj of objectives) {
    if (!_normObj) continue;
    if (!Array.isArray(_normObj.linkedCampaigns)) {
      if (Array.isArray(_normObj.linkedDirectives)) {
        _normObj.linkedCampaigns = _normObj.linkedDirectives;
      } else if (_normObj.linkedDirective) {
        _normObj.linkedCampaigns = [_normObj.linkedDirective];
      } else {
        _normObj.linkedCampaigns = [];
      }
    }
    _normObj.linkedDirectives = _normObj.linkedCampaigns; // backward compat alias
    autoFixCount++;
  }

  // ── Normalize campaign refs on tasks ──
  for (const t of tasks) {
    if (!t) continue;
    normalizeCampaignRef(t);
    if (!t.campaign_id) {
      log('[Heartbeat] Task ' + (t.id || '?') + ' has no campaign_id — skipping auto-attach (CEO-only campaign creation)');
    }
  }

  // ── Build campaignById map ──
  const campaignById = {};
  for (const _c of campaigns) { if (_c && _c.id) campaignById[_c.id] = _c; }

  // ── Auto-complete campaigns where ALL linked tasks are done ──
  for (const c of campaigns) {
    if (!c || c.deletedAt || String(c.status || '').toLowerCase() !== 'active') continue;
    if (c.autoComplete === false) continue;
    const cmpTasks = tasks.filter(function (t) { return t && t.campaign_id === c.id; });
    if (cmpTasks.length === 0) continue;
    var _acMaxTasks = (c.maxTasks && typeof c.maxTasks === 'number') ? c.maxTasks : null;
    if (!_acMaxTasks && c.frequency && c.cadence) {
      var _acCadenceDays = { daily: 1, weekly: 7, biweekly: 14 };
      var _acPeriodDays = _acCadenceDays[c.cadence] || 7;
      var _acSocialTypes = (Array.isArray(c.allowedTaskTypes) ? c.allowedTaskTypes : []).filter(function(tt) { return /^social_/.test(tt); });
      var _acPlatformCount = _acSocialTypes.length || 1;
      var _acStartMs = c.startDate ? new Date(c.startDate).getTime() : new Date(c.createdAt || Date.now()).getTime();
      var _acEndMs = c.endDate ? new Date(c.endDate).getTime() : (_acStartMs + 90 * 86400000);
      var _acPeriods = Math.ceil(Math.max(1, Math.ceil((_acEndMs - _acStartMs) / 86400000)) / _acPeriodDays);
      _acMaxTasks = c.frequency * _acPeriods * _acPlatformCount;
    }
    if (_acMaxTasks && cmpTasks.length < _acMaxTasks) continue;
    if (c.endDate && new Date(c.endDate).getTime() > Date.now()) continue;
    const allDone = cmpTasks.every(function (t) {
      const s = String(t.status || '').toLowerCase();
      return s === 'done' || s === 'archived';
    });
    if (!allDone) continue;
    c.status = 'complete';
    c.updatedAt = new Date().toISOString();
    campaignsChanged = true;
    autoFixCount++;
    if (c.id) campaignsTouched.add(c.id);
    campaignGovEvents.push({
      id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      type: 'campaign_auto_complete',
      data: { campaignId: c.id, title: c.title, taskCount: cmpTasks.length },
      timestamp: new Date().toISOString()
    });
  }

  // ── Auto-pause campaigns past their endDate ──
  for (const c of campaigns) {
    if (!c || c.deletedAt || String(c.status || '').toLowerCase() !== 'active') continue;
    if (c.endDate && new Date(c.endDate).getTime() < Date.now()) {
      c.status = 'complete';
      c.updatedAt = new Date().toISOString();
      campaignsChanged = true;
      if (c.id) campaignsTouched.add(c.id);
      campaignGovEvents.push({
        id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        type: 'campaign_enddate_complete',
        data: { campaignId: c.id, title: c.title, endDate: c.endDate },
        timestamp: new Date().toISOString()
      });
    }
  }

  // ── Reactivate prematurely completed campaigns whose end date is still in the future ──
  for (const c of campaigns) {
    if (!c || c.deletedAt) continue;
    if (String(c.status || '').toLowerCase() !== 'complete') continue;
    if (!c.endDate) continue;
    if (new Date(c.endDate).getTime() > Date.now()) {
      c.status = 'active';
      c.updatedAt = new Date().toISOString();
      campaignsChanged = true;
      if (c.id) campaignsTouched.add(c.id);
      log('[Heartbeat] Reactivated campaign "' + (c.title || c.id) + '" — end date ' + c.endDate.substring(0, 10) + ' not yet reached');
      campaignGovEvents.push({
        id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        type: 'campaign_reactivated',
        data: { campaignId: c.id, title: c.title, endDate: c.endDate, reason: 'end_date_not_reached' },
        timestamp: new Date().toISOString()
      });
    }
  }

  // ── Auto-replenish: create tasks for active campaigns with 0 active tasks ──
  let tasksChanged = false;
  const _now = Date.now();

  for (const c of campaigns) {
    if (!c || c.deletedAt || String(c.status || '').toLowerCase() !== 'active') continue;
    if (!c.cadence) {
      log('[Heartbeat] Campaign "' + (c.title || c.id) + '" skipped auto-replenish: missing cadence field');
      continue;
    }
    if (c.startDate && new Date(c.startDate).getTime() > _now) continue;
    if (c.endDate && new Date(c.endDate).getTime() < _now) continue;

    const cmpTasks = tasks.filter(t => t && t.campaign_id === c.id && t.status !== 'archived');
    const activeTasks = cmpTasks.filter(t => {
      const s = String(t.status || '').toLowerCase();
      return s !== 'done' && s !== 'archived';
    });
    if (activeTasks.length > 0) continue;

    const _window = _cadenceMs[c.cadence] || 604800000;
    const _periodStart = _now - _window;
    const _allowedTypes = Array.isArray(c.allowedTaskTypes) && c.allowedTaskTypes.length > 0 ? c.allowedTaskTypes : null;
    const _primaryThisPeriod = cmpTasks.filter(t => {
      if (!t.createdAt || new Date(t.createdAt).getTime() <= _periodStart) return false;
      return !_allowedTypes || _allowedTypes.indexOf(t.taskType) !== -1;
    }).length;
    const _freq = c.frequency || 1;
    if (_primaryThisPeriod >= _freq) continue;

    // ── Outcome gate (Phase 4): pause/slow replenish for underperforming campaigns ──
    var _doneTasks = cmpTasks.filter(function (t) { return t.status === 'done'; })
      .sort(function (a, b) { return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime(); });
    if (_doneTasks.length >= 3) {
      var _last3 = _doneTasks.slice(0, 3);
      // Check: did last 3 tasks produce any approved social actions?
      var _withAction = _last3.filter(function (t) { return t._social_action_created; }).length;
      // Check: any tasks have revision comments from CEO?
      var _withRevision = _last3.filter(function (t) {
        return (t.comments || []).some(function (cm) { return cm.type === 'revision' || (cm.author === 'CEO' && /revise|reject|redo|wrong|fix/i.test(cm.text || '')); });
      }).length;
      // Gate 1: all 3 recent tasks had CEO revisions → pause
      if (_withRevision >= 3) {
        c._replenishPaused = true;
        c._replenishPausedReason = '3 consecutive CEO revisions';
        campaignsChanged = true;
        log('[Heartbeat] Outcome gate: pausing replenish for "' + (c.title || c.id) + '" — 3 consecutive CEO revisions');
        continue;
      }
      // Gate 2: 0 of last 3 produced a social action → slow to 2x cadence
      if (_withAction === 0 && _doneTasks.length >= 5) {
        var _timeSinceLastCreate = cmpTasks.length > 0 ? _now - new Date(cmpTasks[cmpTasks.length - 1].createdAt || 0).getTime() : Infinity;
        if (_timeSinceLastCreate < _window * 2) {
          log('[Heartbeat] Outcome gate: slowing replenish for "' + (c.title || c.id) + '" — 0 of last 3 tasks produced actions, waiting 2x cadence');
          continue;
        }
      }
    }
    // Gate 3: 10+ done tasks, 0 with social actions → auto-pause
    if (_doneTasks.length >= 10) {
      var _anyActions = _doneTasks.filter(function (t) { return t._social_action_created; }).length;
      if (_anyActions === 0) {
        c._replenishPaused = true;
        c._replenishPausedReason = '10+ tasks with 0 approved actions';
        c.status = 'paused';
        campaignsChanged = true;
        log('[Heartbeat] Outcome gate: auto-pausing campaign "' + (c.title || c.id) + '" — 10+ completed tasks, 0 produced actions');
        continue;
      }
    }

    const allowedTypes = Array.isArray(c.allowedTaskTypes) && c.allowedTaskTypes.length > 0
      ? c.allowedTaskTypes
      : (c.taskType ? [c.taskType] : ['general']);

    let chosenType = allowedTypes[0];
    if (allowedTypes.length > 1) {
      const typeCounts = {};
      allowedTypes.forEach(tt => { typeCounts[tt] = 0; });
      cmpTasks.forEach(t => {
        const tt = t.taskType || '';
        if (typeCounts[tt] !== undefined) typeCounts[tt]++;
      });
      chosenType = allowedTypes.reduce((best, tt) => (typeCounts[tt] || 0) < (typeCounts[best] || 0) ? tt : best, allowedTypes[0]);
    }

    const label = _taskTypeLabels[chosenType] || chosenType.replace(/_/g, ' ');
    const assignee = _taskTypeToAgent[chosenType] || 'echo';
    const _cadenceDays = { daily: 1, weekly: 3, biweekly: 5 };
    const _dueDays = _cadenceDays[c.cadence] || 3;
    const newTask = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      title: 'Draft ' + label + ' for ' + (c.title || 'campaign'),
      description: 'Auto-created by campaign scheduler. Campaign: ' + (c.title || c.id) + '. Create a ' + label + ' aligned with the campaign brief and objectives.',
      status: 'todo',
      taskType: chosenType,
      assignee: assignee,
      campaign_id: c.id,
      objective_id: c.objective_id || null,
      priority: c.priority || 'medium',
      dueDate: new Date(Date.now() + _dueDays * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: { type: 'campaign_scheduler', campaignId: c.id, campaignTitle: c.title }
    };

    tasks.push(newTask);
    tasksChanged = true;
    log('[Heartbeat] Auto-replenish: created task "' + newTask.title + '" for campaign "' + (c.title || c.id) + '" (type: ' + chosenType + ', assignee: ' + assignee + ')');
    campaignGovEvents.push({
      id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      type: 'campaign_auto_replenish',
      data: { campaignId: c.id, campaignTitle: c.title, taskId: newTask.id, taskTitle: newTask.title, taskType: chosenType },
      timestamp: new Date().toISOString()
    });
  }

  return { campaignsChanged, tasksChanged, autoFixCount, campaignGovEvents, campaignsTouched, campaignById };
}

module.exports = { processCampaignLifecycle };
