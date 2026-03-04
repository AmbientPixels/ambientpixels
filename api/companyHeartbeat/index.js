// companyHeartbeat — Timer Trigger (every 30 minutes)
// Runs agent heartbeat cycles: reviews tasks, takes actions, logs activity

const storage = require('../_utils/companyStorage');
const { normalizeCampaignRef, ensureCampaign } = require('../_shared/campaignMatcher');

// ── Extracted modules ──
const C = require('./constants');
const H = require('./helpers');
const { _buildBlockedProposal, _normalizeProposal, _isValidProposal } = require('./normalization');
const { _fetchSiteIntel } = require('./site-intelligence');
const { applyTaskUpdate } = require('./task-mutations');
const { _socialIntelBuildDigest } = require('./social-intel');
const { runAgentHeartbeat } = require('./agent-runner');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // used for early-exit check in main function

// Destructure constants used by main orchestrator
const {
  AGENT_IDS, GUARDRAILS, HEARTBEAT_LOCK_TIMEOUT_MS,
  MAX_MEMORIES_PER_AGENT, L4_DEFAULT_TTL_DAYS,
  TIER4_SUB_AGENTS, ALLOWED_UPDATE_KEYS, CAP_DEFAULTS,
  _MUTATION_BUCKET_MAP, MAX_RESEARCH_STORE_ENTRIES,
  AGENT_COOLDOWN_VIOLATIONS_PER_RUN, MAX_ENTITY_COMMENT_CALLS_PER_RUN
} = C;

// Destructure helpers used by main orchestrator
const {
  _sanitizeSingleComment, generateConversationalEntityComment,
  _normalizeCategory, _isStartWorkStatus, _isTerminalTaskStatus,
  _isObjectiveExemptCategory, resolveActivationMode,
  normalizeExecutionMode, evaluateEscalationPath, shouldRunTier4Agent,
  logEvent
} = H;

// ── Mutable runtime state (loaded from storage each cycle) ──
let _agentMemoryStore = {}; // { agentId: [{ type, text, source, timestamp }] }


// (Social intel functions now in social-intel.js)

module.exports = async function (context) {
  const demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;
  const cycleId = 'cycle-' + Date.now();
  const runId = cycleId;
  const cycleStart = new Date().toISOString();
  let geminiCalls = 0;
  let newTasksCreated = 0;
  const agentActions = {};
  const _pendingEscalations = [];
  const skippedAgents = [];
  const trigger = (context.bindings && context.bindings.heartbeatTimer) ? 'cron' : 'http';

  context.log('[Heartbeat] Starting cycle:', cycleId, '| trigger:', trigger);

  // ── Concurrency lock: prevent overlapping heartbeat runs ──
  const existingLock = await storage.getState('heartbeatLock');
  if (existingLock && existingLock.locked) {
    const acquiredMs = new Date(existingLock.acquiredAt).getTime();
    const nowMs = Date.now();
    if (!isNaN(acquiredMs) && (nowMs - acquiredMs) < HEARTBEAT_LOCK_TIMEOUT_MS) {
      context.log.warn(
        '[Heartbeat] SKIPPED — another run is active.',
        'Holder:', existingLock.runId,
        '| Acquired:', existingLock.acquiredAt,
        '| Age:', Math.round((nowMs - acquiredMs) / 1000) + 's',
        '| This run:', cycleId
      );
      await logEvent('heartbeat-lock-skipped', null,
        'Heartbeat skipped: concurrency lock held by ' + existingLock.runId, cycleId, {
          runId: cycleId, trigger: trigger,
          holderRunId: existingLock.runId,
          holderAcquiredAt: existingLock.acquiredAt,
          lockAgeMs: nowMs - acquiredMs
        });
      return { skipped: true, reason: 'lock', holderRunId: existingLock.runId };
    }
    // Lock expired — override
    context.log.warn(
      '[Heartbeat] Stale lock detected from', existingLock.runId,
      '| Acquired:', existingLock.acquiredAt,
      '| Expired', Math.round((nowMs - acquiredMs) / 1000) + 's ago. Overriding.'
    );
  }

  // Acquire lock
  await storage.setState('heartbeatLock', {
    locked: true,
    runId: runId,
    acquiredAt: cycleStart,
    expiresAt: new Date(new Date(cycleStart).getTime() + HEARTBEAT_LOCK_TIMEOUT_MS).toISOString(),
    trigger: trigger
  });
  context.log('[Heartbeat] Lock acquired:', runId);

  try {
    if (!GEMINI_API_KEY) {
      context.log.warn('[Heartbeat] No GEMINI_API_KEY — skipping');
      await logEvent('heartbeat', null, 'Heartbeat skipped: no API key', cycleId);
      return { skipped: true, reason: 'no_api_key' };
    }

    // Load current state
    const tasks = (await storage.getState('tasks')) || [];
    const _taskIdsAtLoad = new Set(tasks.map(function (t) { return t && t.id; }).filter(Boolean));
    const _taskIdsArchived = new Set(); // populated by archive block
    const configs = (await storage.getState('agentConfigs')) || {};
    const recentLogs = await storage.getLogs({ limit: 50 });
    const _rawDirectives = (await storage.getState('directives')) || [];
    const campaigns = (await storage.getState('campaigns')) || [];
    // Server-side migration: merge directives into campaigns (one-time)
    if (_rawDirectives.length > 0) {
      const _existingCmpIds = new Set(campaigns.map(c => c && c.id).filter(Boolean));
      let _migrated = 0;
      for (const _rd of _rawDirectives) {
        if (!_rd || !_rd.id || _existingCmpIds.has(_rd.id)) continue;
        let _st = String(_rd.status || 'active').toLowerCase();
        if (_st === 'completed') _st = 'complete';
        if (_st === 'pending-approval') _st = 'active';
        _rd.status = _st;
        _rd._migratedFromDirective = true;
        if (!_rd.createdAt) _rd.createdAt = _rd.createdDate || new Date().toISOString();
        if (!_rd.updatedAt) _rd.updatedAt = _rd.createdAt;
        campaigns.push(_rd);
        _migrated++;
      }
      if (_migrated > 0) {
        context.log('[Heartbeat] Migrated ' + _migrated + ' directives into campaigns');
      }
    }
    const directives = campaigns; // backward compat alias
    const objectives = (await storage.getState('objectives')) || [];
    const _documentsAtLoad = (await storage.getState('documents')) || [];
    const _documentIdsAtLoad = new Set(_documentsAtLoad.map(function (d) { return d && d.id; }).filter(Boolean));
    let campaignsChanged = false;
    let tasksCampaignChanged = false;
    const campaignGovEvents = [];
    let autoFixCount = 0;
    let createdCampaignAutoCount = 0;
    const _guardrailCounts = {
      orphanBlocked: 0,
      exactDupBlocked: 0,
      fuzzyDupBlocked: 0,
      taskCeilingBlocked: 0,
      socialPromoGateBlocked: 0,
      ceoApprovalsTriggered: 0,
      pausedCampaignAutomationBlocked: 0
    };
    const _campaignsTouched = new Set();
    const _tasksTouched = new Set();
    const _agentRunStats = {};
    let _entityCommentCalls = 0;
    async function _commentForEntity(kind, opts) {
      opts = opts || {};
      if (_entityCommentCalls >= MAX_ENTITY_COMMENT_CALLS_PER_RUN) {
        return _sanitizeSingleComment('', opts.fallbackText || 'I created this item to keep execution aligned.');
      }
      _entityCommentCalls++;
      return generateConversationalEntityComment(kind, opts);
    }

    for (const c of campaigns) {
      if (!c || typeof c !== 'object') continue;
      if (!c.id) { c.id = 'cmp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6); campaignsChanged = true; autoFixCount++; _campaignsTouched.add(c.id); }
      if (!c.status) { c.status = 'active'; campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      if (!c.createdAt) { c.createdAt = new Date().toISOString(); campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      if (!c.updatedAt) { c.updatedAt = c.createdAt; campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      if (!c.title) { c.title = 'Untitled Campaign'; campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      if (c.description === undefined || c.description === null) { c.description = ''; campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      // Normalize campaign lifecycle fields (no-op if already set or intentionally absent)
      var _validTaskTypes = ['blog_post', 'social_linkedin', 'social_bluesky', 'social_x', 'design_asset', 'internal_doc', 'research', 'ops', 'financial', 'general'];
      if (c.taskType && _validTaskTypes.indexOf(c.taskType) === -1) { c.taskType = null; campaignsChanged = true; if (c.id) _campaignsTouched.add(c.id); }
      if (Array.isArray(c.allowedTaskTypes)) { c.allowedTaskTypes = c.allowedTaskTypes.filter(function (t) { return _validTaskTypes.indexOf(t) !== -1; }); if (c.allowedTaskTypes.length === 0) { c.allowedTaskTypes = null; campaignsChanged = true; if (c.id) _campaignsTouched.add(c.id); } }
      if (c.maxTasks !== undefined && c.maxTasks !== null && typeof c.maxTasks !== 'number') { c.maxTasks = parseInt(c.maxTasks, 10) || null; campaignsChanged = true; if (c.id) _campaignsTouched.add(c.id); }
      if (c.cadence && ['daily', 'weekly', 'biweekly'].indexOf(c.cadence) === -1) { c.cadence = null; campaignsChanged = true; if (c.id) _campaignsTouched.add(c.id); }
      if (c.endDate && isNaN(new Date(c.endDate).getTime())) { c.endDate = null; campaignsChanged = true; if (c.id) _campaignsTouched.add(c.id); }
      if (c.startDate && isNaN(new Date(c.startDate).getTime())) { c.startDate = null; campaignsChanged = true; if (c.id) _campaignsTouched.add(c.id); }
      if (c.autoComplete !== undefined && typeof c.autoComplete !== 'boolean') { c.autoComplete = c.autoComplete !== false && c.autoComplete !== 'false'; campaignsChanged = true; if (c.id) _campaignsTouched.add(c.id); }
    }

    // Normalize objective linking: linkedDirective/linkedDirectives → linkedCampaigns
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

    // ── Goal → auto-create Campaign for goals with no linked campaigns ──
    let objectivesChanged = false;
    for (const _goalObj of objectives) {
      if (!_goalObj || !_goalObj.id) continue;
      const _goalStatus = String(_goalObj.status || '').toLowerCase();
      if (_goalStatus === 'complete' || _goalStatus === 'canceled') continue;

      const _goalCmpIds = Array.isArray(_goalObj.linkedCampaigns) ? _goalObj.linkedCampaigns : [];
      const _hasActiveCampaign = _goalCmpIds.some(function (cmpId) {
        const cmp = campaigns.find(function (c) { return c && c.id === cmpId && !c.deletedAt; });
        return cmp && String(cmp.status || '').toLowerCase() !== 'archived';
      });
      if (_hasActiveCampaign) continue;

      const _newCmpId = 'cmp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const _goalDescBase = String(_goalObj.description || '').trim();
      const _goalContextLine = await _commentForEntity('campaign', {
        agentId: 'nova',
        title: (_goalObj.quarter ? '[Q' + _goalObj.quarter + '] ' : '') + (_goalObj.title || 'Untitled Campaign'),
        goalTitle: _goalObj.title || _goalObj.id,
        goalId: _goalObj.id,
        seedText: _goalDescBase,
        fallbackText: 'I created this campaign from the goal "' + (_goalObj.title || _goalObj.id) + '" so the team has a clear execution container.'
      });
      const _newCmp = {
        id: _newCmpId,
        title: (_goalObj.quarter ? '[Q' + _goalObj.quarter + '] ' : '') + (_goalObj.title || 'Untitled Campaign'),
        description: _goalContextLine,
        status: 'active',
        priority: _goalObj.priority || 'medium',
        objective_id: _goalObj.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        provenance: 'Auto: Goal → Campaign'
      };
      campaigns.push(_newCmp);
      createdCampaignAutoCount++;
      _campaignsTouched.add(_newCmpId);
      campaignsChanged = true;

      if (!Array.isArray(_goalObj.linkedCampaigns)) _goalObj.linkedCampaigns = [];
      _goalObj.linkedCampaigns.push(_newCmpId);
      _goalObj.linkedDirectives = _goalObj.linkedCampaigns;
      objectivesChanged = true;

      context.log('[Heartbeat] Auto-created Campaign "' + _newCmp.title + '" (' + _newCmpId + ') for Goal "' + (_goalObj.title || _goalObj.id) + '" (' + _goalObj.id + ')');
      await logEvent('goal-auto-campaign', null, 'Auto-created campaign for goal', runId, {
        runId, objectiveId: _goalObj.id, objectiveTitle: _goalObj.title, campaignId: _newCmpId, campaignTitle: _newCmp.title
      });
    }
    if (objectivesChanged) {
      await storage.setState('objectives', objectives);
      context.log('[Heartbeat] Pushed updated objectives after goal→campaign auto-creation');
    }

    // Build campaignById map for O(1) lookups in freeze gates
    const campaignById = {};
    for (const _c of campaigns) { if (_c && _c.id) campaignById[_c.id] = _c; }

    // Ensure tasks have campaign_id (normalize directive_id → campaign_id, then auto-match)
    for (const t of tasks) {
      if (!t) continue;
      normalizeCampaignRef(t);
      if (t.campaign_id) continue;

      const _tResult = await ensureCampaign({
        campaign_id: t.campaign_id,
        title: t.title || '',
        description: t.description || '',
        goalId: t.objective_id || null,
        division: t.division || null,
        provenance: 'Auto: Campaign ' + (t.assignee || 'nova'),
        campaigns: campaigns,
        entrypoint: 'heartbeat_task',
        debug: true,
        logger: context.log
      });
      t.campaign_id = _tResult.campaignId;
      if (_tResult.created) {
        _tResult.campaign.description = await _commentForEntity('campaign', {
          agentId: t.assignee || 'nova',
          title: _tResult.campaign.title || t.title || 'Campaign',
          goalId: t.objective_id || null,
          seedText: t.description || '',
          fallbackText: 'I created this campaign to group related work and keep planning/execution aligned under one objective.'
        });
        _tResult.campaign.updatedAt = new Date().toISOString();
        campaignsChanged = true;
        _campaignsTouched.add(_tResult.campaignId);
        campaignGovEvents.push({
          id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          type: 'campaign-created',
          data: { campaignId: _tResult.campaignId, title: _tResult.campaign.title, provenance: _tResult.campaign.provenance || null, source: 'task_auto_attach' },
          timestamp: new Date().toISOString()
        });
      }
      t.updatedAt = new Date().toISOString();
      tasksCampaignChanged = true;
      autoFixCount++;
      if (t.id) _tasksTouched.add(t.id);
    }

    // Auto-complete campaigns where ALL linked tasks are done (skip if autoComplete === false)
    for (const c of campaigns) {
      if (!c || c.deletedAt || String(c.status || '').toLowerCase() !== 'active') continue;
      if (c.autoComplete === false) continue; // ongoing campaigns opt out
      const cmpTasks = tasks.filter(function (t) { return t && t.campaign_id === c.id; });
      if (cmpTasks.length === 0) continue;
      // For campaigns with maxTasks, also require that the cap is reached before auto-completing
      if (c.maxTasks && typeof c.maxTasks === 'number' && cmpTasks.length < c.maxTasks) continue;
      const allDone = cmpTasks.every(function (t) {
        const s = String(t.status || '').toLowerCase();
        return s === 'done' || s === 'archived';
      });
      if (!allDone) continue;
      c.status = 'complete';
      c.updatedAt = new Date().toISOString();
      campaignsChanged = true;
      autoFixCount++;
      if (c.id) _campaignsTouched.add(c.id);
      campaignGovEvents.push({
        id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        type: 'campaign_auto_complete',
        data: { campaignId: c.id, title: c.title, taskCount: cmpTasks.length },
        timestamp: new Date().toISOString()
      });
    }
    // Auto-pause campaigns past their endDate
    for (const c of campaigns) {
      if (!c || c.deletedAt || String(c.status || '').toLowerCase() !== 'active') continue;
      if (c.endDate && new Date(c.endDate).getTime() < Date.now()) {
        c.status = 'complete';
        c.updatedAt = new Date().toISOString();
        campaignsChanged = true;
        if (c.id) _campaignsTouched.add(c.id);
        campaignGovEvents.push({
          id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          type: 'campaign_enddate_complete',
          data: { campaignId: c.id, title: c.title, endDate: c.endDate },
          timestamp: new Date().toISOString()
        });
      }
    }

    const documents = (await storage.getState('documents')) || [];
    const workspaceMemory = (await storage.getState('workspaceMemory')) || [];
    const workspaceDates = (await storage.getState('dates')) || [];
    const allActions = (await storage.getState('actions')) || [];
    const socialMetricsEvents = (await storage.getState('socialMetricsEvents')) || [];
    const socialEngagementSnapshots = (await storage.getState('socialEngagementSnapshots')) || [];
    const socialEngagementMeta = (await storage.getState('socialEngagementMeta')) || {};
    const runtimeMemory = (await storage.getState('runtimeMemory')) || {};
    const socialAccountStats = (await storage.getState('socialAccountStats')) || null;
    const socialIntel = _socialIntelBuildDigest(
      runtimeMemory && runtimeMemory.socialIntel,
      socialMetricsEvents,
      socialEngagementSnapshots,
      socialEngagementMeta,
      Date.now(),
      socialAccountStats
    );
    runtimeMemory.socialIntel = socialIntel;
    const revisionActions = allActions.filter(a => a.approval && a.approval.status === 'revision_requested');
    // Load persistent agent memories
    _agentMemoryStore = (await storage.getState('agentMemories')) || {};
    // Load CEO-curated seed memories (markdown per agent + global)
    const _seedMemories = (await storage.getState('agentSeedMemories')) || {};
    // Load persistent research intelligence store (survives beyond task completion)
    let researchIntelStore = (await storage.getState('researchIntel')) || [];
    // Load worker reports (client-side workers sync intel here for Nova to read)
    let workerReports = [];
    try { workerReports = (await storage.getState('workerReports')) || []; } catch (_wrErr) { /* non-fatal */ }
    // Fetch cost data for Cipher (CFO) awareness
    let costIntel = null;
    try {
      const geminiCosts = await storage.getGeminiCostSummary(30);
      costIntel = { gemini: geminiCosts };
    } catch (e) { context.log('[Heartbeat] Cost data fetch failed:', e.message); }

    // Fetch site intelligence: real telemetry, social metrics, deployment config
    let siteIntel = null;
    try {
      siteIntel = await _fetchSiteIntel(context, storage);
      const _siParts = [];
      if (siteIntel.telemetry) _siParts.push('telemetry');
      if (siteIntel.socialMetrics) _siParts.push('social');
      if (siteIntel.deployConfig) _siParts.push('deploy');
      if (_siParts.length > 0) context.log('[Heartbeat] Site intel loaded:', _siParts.join(', '));
    } catch (siErr) {
      context.log('[Heartbeat] Site intel fetch failed (non-fatal):', siErr.message);
      siteIntel = null;
    }

    // v2.3: Exclude pending-approval items from heartbeat processing
    const pendingTasks = tasks.filter(t => t.status === 'pending-approval');
    const pendingCmps = campaigns.filter(c => c.status === 'pending-approval');
    if (pendingTasks.length > 0 || pendingCmps.length > 0) {
      context.log('[Heartbeat] Pending approval items detected: ' + pendingTasks.length + ' tasks, ' + pendingCmps.length + ' campaigns — skipping until approved.');
    }
    const activeCampaigns = campaigns.filter(c => c.status === 'active' && !c.deletedAt);
    const activeDirectives = activeCampaigns; // backward compat alias
    const activeObjectives = objectives.filter(o => o.status && o.status !== 'complete' && o.status !== 'canceled');
    const normalizedActivationMode = await resolveActivationMode(storage, runId);

    // Load execution_mode (AmbientCore automation posture)
    const _rawExecMode = await storage.getState('execution_mode');
    const executionMode = normalizeExecutionMode(_rawExecMode);

    await logEvent('mode-resolved', null, 'Activation mode resolved: ' + normalizedActivationMode + ', execution_mode: ' + executionMode, runId, {
      runId: runId, activationMode: normalizedActivationMode, executionMode: executionMode
    });

    // Frozen: block all automation, exit early
    if (executionMode === 'frozen') {
      await logEvent('run-health', null, 'Heartbeat blocked: execution_mode frozen', runId, {
        runId: runId, mode: executionMode, channel: 'heartbeat', result: 'blocked', reason: 'execution_mode_frozen'
      });
      context.log('[Heartbeat] execution_mode=frozen — automation locked, exiting early');
      return { skipped: true, reason: 'frozen' };
    }

    // Compute effective rate caps (Phase 1F: experimental mode gets 1.5x)
    const _capMultiplier = normalizedActivationMode === 'experimental' ? 1.5 : 1;
    const _effectiveCaps = {
      maxCreatesPerAgentPerRun: Math.floor(CAP_DEFAULTS.maxCreatesPerAgentPerRun * _capMultiplier),
      maxMovesPerAgentPerRun: Math.floor(CAP_DEFAULTS.maxMovesPerAgentPerRun * _capMultiplier),
      maxUpdatesPerAgentPerRun: Math.floor(CAP_DEFAULTS.maxUpdatesPerAgentPerRun * _capMultiplier),
      maxProposalsPerAgentPerRun: Math.floor(CAP_DEFAULTS.maxProposalsPerAgentPerRun * _capMultiplier)
    };

    await logEvent('run-start', null, 'Heartbeat run start', runId, {
      runId: runId,
      mode: normalizedActivationMode,
      taskCount: tasks.length,
      agentCount: AGENT_IDS.length
    });

    // ── Per-day memory write counter (Phase 1E) ──
    const _memoryWriteCounters = {}; // keyed by agentId+YYYY-MM-DD
    const _todayKey = new Date().toISOString().substring(0, 10);
    function _getMemWriteCount(aid) {
      return _memoryWriteCounters[aid + ':' + _todayKey] || 0;
    }
    function _incMemWrite(aid) {
      var k = aid + ':' + _todayKey;
      _memoryWriteCounters[k] = (_memoryWriteCounters[k] || 0) + 1;
    }

    // ── Per-run counters (Phase 1C) ──
    const _runCounters = {
      runId: runId,
      mode: normalizedActivationMode,
      totals: { creates: 0, moves: 0, updates: 0, blocked: 0, proposals: 0 },
      byAgent: {}
    };
    function _ensureAgentCounters(aid) {
      if (!_runCounters.byAgent[aid]) _runCounters.byAgent[aid] = { creates: 0, moves: 0, updates: 0, blocked: 0, proposals: 0 };
    }
    function _incBlocked(aid) {
      _ensureAgentCounters(aid);
      _runCounters.totals.blocked++;
      _runCounters.byAgent[aid].blocked++;
    }
    function _incProposal(aid) {
      _ensureAgentCounters(aid);
      _runCounters.totals.proposals++;
      _runCounters.byAgent[aid].proposals++;
    }
    function _canAddProposal(aid) {
      _ensureAgentCounters(aid);
      return _runCounters.byAgent[aid].proposals < _effectiveCaps.maxProposalsPerAgentPerRun;
    }

    const _runGateCounts = {
      output_envelope: 0,
      proposal_schema: 0,
      objective_status: 0,
      observation_clamp: 0,
      project_status: 0
    };
    const _objectiveStatusBlockDetails = [];
    const _projectStatusBlockDetails = [];
    function _incPolicyGate(gate) {
      if (Object.prototype.hasOwnProperty.call(_runGateCounts, gate)) {
        _runGateCounts[gate]++;
      }
    }

    // Cooldown is per-run only (non-persistent): after repeated violations, force proposals-only path.
    const _cooldownLogged = new Set();
    function _isAgentInCooldown(aid) {
      return (_runCounters?.byAgent?.[aid]?.blocked || 0) >= AGENT_COOLDOWN_VIOLATIONS_PER_RUN;
    }
    async function _logAgentCooldownOnce(aid) {
      if (_cooldownLogged.has(aid)) return;
      _cooldownLogged.add(aid);
      await logEvent('policy-violation', aid, 'Agent forced into proposals-only cooldown for this run', runId, {
        runId: runId,
        agentId: aid,
        gate: 'agent_cooldown',
        reason: 'violations_in_run',
        violations: (_runCounters?.byAgent?.[aid]?.blocked || 0)
      });
    }

    // ── Backfill: re-resolve hero image URLs for pending publish AQ entries ──
    // Covers the case where Scribe submitted before Pixel generated the image
    try {
      const _aqBackfill = (await storage.getState('approvalQueue')) || [];
      let _aqChanged = false;
      for (let _bfi = 0; _bfi < _aqBackfill.length; _bfi++) {
        const _bfItem = _aqBackfill[_bfi];
        if (_bfItem.status !== 'pending') continue;
        if (_bfItem.actionType !== 'publish_document') continue;
        if (_bfItem.heroImageUrl) {
          // AQ already has URL — but ensure the action payload is also patched if it's missing it
          const _bfActIdxQ = allActions.findIndex(a => a.id === _bfItem.action_id);
          if (_bfActIdxQ !== -1 && allActions[_bfActIdxQ].payload && !allActions[_bfActIdxQ].payload.hero_image_url) {
            allActions[_bfActIdxQ].payload.hero_image_url = _bfItem.heroImageUrl;
            allActions[_bfActIdxQ].payload.hero_image_asset_id = allActions[_bfActIdxQ].payload.hero_image_asset_id || _bfItem.heroImageAssetId || null;
            _aqChanged = true;
            context.log('[Heartbeat] Backfilled hero_image_url into action payload from AQ entry:', _bfItem.id);
          }
          continue;
        }
        const _bfAssetId = _bfItem.heroImageAssetId || null;
        if (!_bfAssetId) {
          // Check the document store for a newly attached hero_image_asset_id
          if (_bfItem.documentId) {
            const _bfDoc = documents.find(d => d.id === _bfItem.documentId);
            if (_bfDoc && _bfDoc.hero_image_asset_id) {
              _bfItem.heroImageAssetId = _bfDoc.hero_image_asset_id;
            }
          }
        }
        if (_bfItem.heroImageAssetId) {
          const _bfImgAssets = (await storage.getState('imageAssets')) || [];
          const _bfAsset = _bfImgAssets.find(a => a.id === _bfItem.heroImageAssetId);
          if (_bfAsset && _bfAsset.url) {
            _bfItem.heroImageUrl = _bfAsset.url;
            _aqChanged = true;
            // Also backfill the action payload
            const _bfActIdx = allActions.findIndex(a => a.id === _bfItem.action_id);
            if (_bfActIdx !== -1 && allActions[_bfActIdx].payload) {
              allActions[_bfActIdx].payload.hero_image_url = _bfAsset.url;
              allActions[_bfActIdx].payload.hero_image_asset_id = _bfItem.heroImageAssetId;
            }
            context.log('[Heartbeat] Backfilled hero image for AQ entry:', _bfItem.id, '→', _bfAsset.url);
          }
        }
      }
      if (_aqChanged) {
        await storage.setState('approvalQueue', _aqBackfill);
        await storage.setState('actions', allActions);
      }
    } catch (_bfErr) { context.log.warn('[Heartbeat] Hero image backfill failed (non-fatal):', _bfErr.message); }

    // ── RECONCILIATION: Notify Scribe tasks when hero image is ready but comment was missed ──
    try {
      let _heroNotifyChanged = false;
      const _heroReadyDocs = documents.filter(d => d && d.hero_image_asset_id && !d.awaiting_hero_image && d.kind === 'marketing_post');
      for (const _hrd of _heroReadyDocs) {
        // Find active Scribe task referencing this document
        const _hrdOriginTask = tasks.find(t =>
          t.assignee === 'scribe' && t.status !== 'done' && t.status !== 'archived' &&
          t.comments && t.comments.some(c => c.text && c.text.indexOf(_hrd.id) !== -1)
        );
        if (!_hrdOriginTask) continue;
        // Check if already notified
        const _hrdAlreadyNotified = _hrdOriginTask.comments.some(c =>
          c.text && c.text.indexOf('You can now submit this document for publish') !== -1
        );
        if (_hrdAlreadyNotified) continue;
        // Check if publish action already exists (no need to notify)
        const _hrdHasPublish = allActions.some(a =>
          a.type === 'publish_document' && a.payload && a.payload.documentId === _hrd.id
        );
        if (_hrdHasPublish) continue;
        // Add notification comment
        if (!_hrdOriginTask.comments) _hrdOriginTask.comments = [];
        _hrdOriginTask.comments.push({
          id: 'cmt-hero-ready-recon-' + Date.now(),
          author: 'system',
          text: 'Hero image generated and attached to document ' + _hrd.id + ' (asset: ' + _hrd.hero_image_asset_id + '). You can now submit this document for publish using submit-for-publish with documentId: ' + _hrd.id,
          type: 'system',
          createdAt: new Date().toISOString()
        });
        // Move task back to in-progress so Scribe acts on the submit-for-publish step
        if (_hrdOriginTask.status === 'review') {
          _hrdOriginTask.status = 'in-progress';
          _hrdOriginTask.updatedAt = new Date().toISOString();
          context.log('[Heartbeat] RECONCILIATION: moved Scribe task', _hrdOriginTask.id, 'from review → in-progress for submit-for-publish step');
        }
        _heroNotifyChanged = true;
        context.log('[Heartbeat] RECONCILIATION: notified Scribe task', _hrdOriginTask.id, 'that hero image is ready for doc:', _hrd.id);
      }
      if (_heroNotifyChanged) {
        await storage.setState('tasks', tasks);
      }
    } catch (_hnErr) { context.log.warn('[Heartbeat] Hero notify reconciliation failed (non-fatal):', _hnErr.message); }

    // ── PROACTIVE PUBLISH: auto-submit marketing docs that are ready but have no publish action ──
    try {
      var _prNow = Date.now();
      var _PR_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
      var _PR_MIN_CONTENT_LEN = 200; // chars
      const _pubReadyDocs = documents.filter(function(d) {
        if (!d || d.deletedAt || d.status === 'published' || d.status === 'rejected' || d.status === 'archived') return false;
        if (d.status === 'ready_for_approval') return false;
        if (!d.hero_image_asset_id || d.awaiting_hero_image) return false;
        if (!d.kind || ['marketing_post', 'product_brief'].indexOf(d.kind) === -1) return false;
        // Quality filter: skip test items
        if (/\btest\b/i.test(d.title || '')) return false;
        // Quality filter: skip docs older than 14 days
        var _docAge = d.created_at ? _prNow - new Date(d.created_at).getTime() : Infinity;
        if (_docAge > _PR_MAX_AGE_MS) return false;
        // Quality filter: skip docs with insufficient content
        if (!d.content_md || d.content_md.length < _PR_MIN_CONTENT_LEN) return false;
        var hasPublish = allActions.some(function(a) {
          return a.type === 'publish_document' && a.payload && a.payload.documentId === d.id;
        });
        return !hasPublish;
      });
      if (_pubReadyDocs.length > 0) {
        let _prDocsChanged = false;
        var _prApprovalQueue = (await storage.getState('approvalQueue')) || [];
        for (var _pri = 0; _pri < _pubReadyDocs.length; _pri++) {
          var _prDoc = _pubReadyDocs[_pri];
          var _prSlug = _prDoc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          var _prIsPublic = ['marketing_post', 'product_brief'].indexOf(_prDoc.kind) !== -1;
          var _prTarget = _prIsPublic ? '/blog/' + _prSlug : '/docs/published/' + _prSlug;
          var _prHeroUrl = null;
          try {
            var _prImgAssets = (await storage.getState('imageAssets')) || [];
            var _prHeroAsset = _prImgAssets.find(function(a) { return a.id === _prDoc.hero_image_asset_id; });
            if (_prHeroAsset && _prHeroAsset.url) _prHeroUrl = _prHeroAsset.url;
          } catch (_e) {}
          var _prAction = {
            id: 'act_pub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            created_at: new Date().toISOString(),
            created_by: 'system',
            type: 'publish_document',
            platform: 'site',
            payload: {
              documentId: _prDoc.id,
              title: _prDoc.title,
              slug: _prSlug,
              kind: _prDoc.kind,
              content_md: _prDoc.content_md,
              target_path: _prTarget,
              public_url: _prTarget,
              hero_image_asset_id: _prDoc.hero_image_asset_id || null,
              hero_image_url: _prHeroUrl,
              missing_hero_image: false
            },
            classification: 'executive_required',
            requires_ceo_approval: true,
            risk_level: 'medium',
            brand_impact: 'medium',
            budget_impact: 0,
            approval: { status: 'pending', approved_by: null, approved_at: null, decision_note: null },
            execution: { status: 'pending', started_at: null, finished_at: null, attempts: 0, last_error: null, receipt: null },
            action_type: 'publish_document',
            action_category: 'content',
            execution_status: 'pending',
            origin_agent: 'system',
            action_payload: { documentId: _prDoc.id, title: _prDoc.title, slug: _prSlug },
            requires_approval: true,
            is_irreversible: true,
            bundle_id: null
          };
          allActions.push(_prAction);
          // Add proper AQ entry (mirrors agent-runner submit-for-publish structure)
          _prApprovalQueue.push({
            id: 'aq-' + _prAction.id,
            kind: 'action',
            actionType: 'publish_document',
            action_id: _prAction.id,
            taskId: null,
            taskTitle: _prDoc.title,
            originAgent: 'system',
            classification: 'executive_required',
            riskLevel: 'medium',
            budgetImpact: 0,
            brandImpact: 'medium',
            status: 'pending',
            submittedAt: _prAction.created_at,
            preview: (_prDoc.content_md || '').substring(0, 120),
            documentId: _prDoc.id,
            slug: _prSlug,
            docKind: _prDoc.kind,
            heroImageUrl: _prHeroUrl,
            heroImageAssetId: _prDoc.hero_image_asset_id || null
          });
          // Update doc status
          var _prDocIdx = documents.findIndex(function(d) { return d.id === _prDoc.id; });
          if (_prDocIdx !== -1) {
            documents[_prDocIdx].status = 'ready_for_approval';
            documents[_prDocIdx].updated_at = new Date().toISOString();
            documents[_prDocIdx].submitted_by = 'system';
            _prDocsChanged = true;
          }
          context.log('[Heartbeat] PROACTIVE PUBLISH: auto-submitted doc', _prDoc.id, '"' + (_prDoc.title || '') + '" for CEO approval');
        }
        if (_prApprovalQueue.length > 100) _prApprovalQueue.splice(0, _prApprovalQueue.length - 100);
        await storage.setState('approvalQueue', _prApprovalQueue);
        await storage.setState('actions', allActions);
        if (_prDocsChanged) await storage.setState('documents', documents);
      }
    } catch (_prErr) { context.log.warn('[Heartbeat] Proactive publish check failed (non-fatal):', _prErr.message); }

    // ── PROACTIVE LINKEDIN TOKEN REFRESH: refresh if expiring within 7 days ──
    try {
      var _socialCreds = await storage.getState('socialCredentials');
      if (_socialCreds && _socialCreds.linkedin && _socialCreds.linkedin.expiresAt) {
        var _liExpiry = new Date(_socialCreds.linkedin.expiresAt).getTime();
        var _liNow = Date.now();
        var _liDaysLeft = (_liExpiry - _liNow) / (24 * 60 * 60 * 1000);
        if (_liDaysLeft < 7 && _socialCreds.linkedin.refreshToken && _socialCreds.linkedin.clientId && _socialCreds.linkedin.clientSecret) {
          context.log('[Heartbeat] LinkedIn token expires in', Math.round(_liDaysLeft * 10) / 10, 'days — refreshing proactively');
          var _liAdapter = require('./../../actionsExecute/executors/social/linkedin');
          var _liRefresh = await _liAdapter._refreshAccessToken(_socialCreds.linkedin);
          if (_liRefresh.ok) {
            context.log('[Heartbeat] LinkedIn token refreshed successfully, new expiry:', _liRefresh.expiresAt);
          } else {
            context.log.warn('[Heartbeat] LinkedIn token refresh failed:', _liRefresh.error);
          }
        } else if (_liDaysLeft < 7) {
          context.log.warn('[Heartbeat] LinkedIn token expires in', Math.round(_liDaysLeft * 10) / 10, 'days but missing refresh credentials');
        }
      }
    } catch (_liErr) { context.log.warn('[Heartbeat] LinkedIn token refresh check failed (non-fatal):', _liErr.message); }

    // ── AUTO SOCIAL ACTION: when peer-reviewed social promo tasks reach done, create the social action ──
    try {
      var _socialPromoTasks = tasks.filter(function(t) {
        if (!t || t.status !== 'done' || t.assignee !== 'echo') return false;
        if (!/^social_/.test(t.taskType || '')) return false;
        if (!/promote/i.test(t.title || '')) return false;
        return true;
      });
      if (_socialPromoTasks.length > 0) {
        var _existingActions = allActions || [];
        var _socialCreated = 0;
        for (var _spi = 0; _spi < _socialPromoTasks.length; _spi++) {
          var _spTask = _socialPromoTasks[_spi];
          // Check if social action already exists for this task
          var _spHasAction = _existingActions.some(function(a) {
            return a.type === 'social_post.publish' && a._parentTaskId === _spTask.id;
          });
          if (_spHasAction) continue;

          // Extract platform from taskType
          var _spPlatform = (_spTask.taskType || '').replace('social_', '');
          if (!_spPlatform) continue;

          // Extract deliverable text from comments
          var _spDeliverable = null;
          var _spComments = _spTask.comments || [];
          for (var _sci = _spComments.length - 1; _sci >= 0; _sci--) {
            if (_spComments[_sci].type === 'deliverable') {
              _spDeliverable = _spComments[_sci].text || _spComments[_sci].comment || '';
              break;
            }
          }
          if (!_spDeliverable) continue;

          // Extract blog URL from task description
          var _spUrlMatch = (_spTask.description || '').match(/https?:\/\/ambientpixels\.ai\/blog\/[a-z0-9-]+/i);
          var _spBlogUrl = _spUrlMatch ? _spUrlMatch[0] : 'https://ambientpixels.ai';

          // Extract just the social post text from the deliverable
          // Deliverables typically have: preamble → actual post → reasoning/notes
          var _spText = _spDeliverable;

          // Strip everything from "Reasoning:" / "Rationale:" / "Notes:" / "Next Steps:" onwards
          _spText = _spText.replace(/\n[\s*]*(Reasoning|Notes|Rationale|Analysis|Strategy|Why this works|Character Count|Next Steps|Artifact ID)[:\s*][\s\S]*/i, '');
          _spText = _spText.replace(/\n---\s*\n[\s\S]*/, '');

          // Strip code fences (```...```)
          _spText = _spText.replace(/```/g, '');

          // Strip markdown headings and bold markers
          _spText = _spText.replace(/^#+\s+.*$/gm, '');
          _spText = _spText.replace(/\*\*([^*]+)\*\*/g, '$1');

          // Strip preamble lines (agent explaining what they're about to post)
          _spText = _spText.replace(/^.*(?:Here's|Okay|Draft|I've drafted|I've created|Below is|This is my|Post Draft)[^\n]*\n/gi, '');

          // Strip lines like "LinkedIn Post", "X Post", "Bluesky Post Draft (date)"
          _spText = _spText.replace(/^.*(?:LinkedIn|Bluesky|Twitter|X)\s*(?:Post|Draft).*$/gim, '');

          // Strip markdown link syntax [text](url) → url
          _spText = _spText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2');

          // Clean up whitespace
          _spText = _spText.replace(/^\s*\n/gm, '\n').replace(/\n{3,}/g, '\n\n').trim();

          // Ensure URL is in the text
          if (_spText.indexOf('ambientpixels.ai') === -1) {
            _spText += '\n\n' + _spBlogUrl;
          }

          context.log('[Heartbeat] AUTO SOCIAL TEXT CLEAN v2: platform=' + _spPlatform + ' original=' + _spDeliverable.length + ' cleaned=' + _spText.length);
          var _spAction = {
            id: 'act_social_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            created_at: new Date().toISOString(),
            created_by: 'system',
            type: 'social_post.publish',
            platform: _spPlatform,
            _codeVersion: 'v2',
            payload: {
              text: _spText,
              platform: _spPlatform,
              media: [],
              scheduled_for: null
            },
            _parentTaskId: _spTask.id,
            classification: 'executive_required',
            requires_ceo_approval: true,
            approval: { status: 'pending', approved_by: null, approved_at: null, decision_note: null },
            execution: { status: 'pending', started_at: null, finished_at: null, attempts: 0, last_error: null },
            action_type: 'social_post',
            action_category: 'social',
            execution_status: 'pending',
            origin_agent: 'echo',
            requires_approval: true,
            is_irreversible: false,
            bundle_id: null
          };
          _existingActions.push(_spAction);
          _socialCreated++;
          context.log('[Heartbeat] AUTO SOCIAL ACTION: created', _spPlatform, 'post from peer-reviewed task:', _spTask.id);
        }
        if (_socialCreated > 0) {
          await storage.setState('actions', _existingActions);
          allActions = _existingActions;
        }
      }
    } catch (_spErr) { context.log.warn('[Heartbeat] Auto social action check failed (non-fatal):', _spErr.message); }

    // Dedupe check: get recent log summaries to avoid repeats
    const recentSummaries = new Set();
    const dedupeAfter = Date.now() - GUARDRAILS.dedupeWindowMs;
    recentLogs.forEach(function (l) {
      if (new Date(l.timestamp).getTime() > dedupeAfter && l.summary) {
        recentSummaries.add(l.summary);
      }
    });

    // ── Evaluate escalation paths for all active tasks ──
    const now = Date.now();
    const escalationLog = [];
    const novaSkipTaskIds = new Set();

    const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'backlog' && t.status !== 'pending-approval');
    for (const task of activeTasks) {
      const esc = evaluateEscalationPath(task, now);
      if (esc.handler !== 'owner' && esc.handler !== 'normal_flow') {
        escalationLog.push({
          taskId: task.id,
          taskTitle: task.title,
          priority: task.priority,
          dueDate: task.dueDate,
          handler: esc.handler,
          domainLead: esc.domainLead,
          reason: esc.reason,
          novaSkip: esc.novaSkip
        });
      }
      if (esc.novaSkip) {
        novaSkipTaskIds.add(task.id);
        context.log('[Heartbeat] Escalation:', task.title,
          '→ Owner →', esc.domainLead, '| Nova skipped (' + esc.reason + ')');
      }
    }

    // ── Goal cancel → cascade pause to linked Campaigns ──
    let _campaignsCascadePushed = false;
    for (const _obj of objectives) {
      if (!_obj || !_obj.id) continue;
      if (String(_obj.status || '').toLowerCase() !== 'canceled') continue;
      const linkedCmpIds = Array.isArray(_obj.linkedCampaigns) ? _obj.linkedCampaigns : (Array.isArray(_obj.linkedDirectives) ? _obj.linkedDirectives : []);
      for (const cmpId of linkedCmpIds) {
        const cmp = campaigns.find(c => c && c.id === cmpId);
        if (cmp && String(cmp.status || '').toLowerCase() === 'active') {
          cmp.status = 'paused';
          cmp.updatedAt = new Date().toISOString();
          cmp._pausedByGoalCancel = _obj.id;
          _campaignsCascadePushed = true;
          campaignsChanged = true;
          if (cmp.id) _campaignsTouched.add(cmp.id);
          context.log('[Heartbeat] Cascade: Goal canceled (' + _obj.id + ' "' + (_obj.title || '') + '") → paused linked Campaign (' + cmpId + ' "' + (cmp.title || '') + '")');
          await logEvent('goal-cancel-cascade', null, 'Campaign paused by goal cancel cascade', runId, {
            runId, objectiveId: _obj.id, objectiveTitle: _obj.title, campaignId: cmpId, campaignTitle: cmp.title
          });
        }
      }
    }
    if (_campaignsCascadePushed) {
      await storage.setState('campaigns', campaigns);
      context.log('[Heartbeat] Cascade: pushed updated campaigns to server after goal-cancel pause');
    }

    // ── Auto-archive tasks ──
    // 1) Immediate archive for tasks linked to canceled objectives.
    // 2) Done-task aging archive (>7 days old).
    const ARCHIVE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const ARCHIVE_MAX = 2000;
    const archiveNow = Date.now();
    const archive = (await storage.getState('tasksArchive')) || [];
    const archivedTaskIds = new Set(archive.map(function (t) { return t && t.id; }).filter(Boolean));
    const canceledObjectives = new Map();
    for (const _obj of objectives) {
      if (!_obj || !_obj.id) continue;
      if (String(_obj.status || '').toLowerCase() === 'canceled') {
        canceledObjectives.set(_obj.id, _obj);
      }
    }
    const canceledCampaigns = new Map();
    for (const _cmp of campaigns) {
      if (!_cmp || !_cmp.id) continue;
      if (String(_cmp.status || '').toLowerCase() === 'canceled') {
        canceledCampaigns.set(_cmp.id, _cmp);
      }
    }

    const canceledArchiveCounts = new Map();
    const toArchive = [];
    const keepTasks = [];
    for (const task of tasks) {
      // Canceled-campaign archive: archive tasks linked to canceled campaigns
      const campaignId = task && task.campaign_id ? task.campaign_id : null;
      if (campaignId && canceledCampaigns.has(campaignId)) {
        const campaign = canceledCampaigns.get(campaignId);
        const nowIso = new Date().toISOString();
        const archiveStamp = task.archivedAt || nowIso;
        const cancelComment = 'Auto-archived: Campaign canceled (campaignId=' + campaignId + ', title=' + (campaign.title || campaignId) + '). Execution blocked.';
        if (!task.comments) task.comments = [];
        const hasCancelComment = task.comments.some(function (c) {
          return c && c.author === 'system' && c.text === cancelComment;
        });
        if (!hasCancelComment) {
          task.comments.push({
            id: 'cmt-archive-campaign-canceled-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            author: 'system',
            text: cancelComment,
            type: 'system',
            createdAt: nowIso
          });
        }
        const lastComment = (task.comments && task.comments.length > 0) ? task.comments[task.comments.length - 1] : null;
        if (!archivedTaskIds.has(task.id)) {
          toArchive.push({
            id: task.id,
            title: task.title,
            description: (task.description || '').substring(0, 200),
            status: task.status,
            priority: task.priority,
            assignee: task.assignee,
            division: task.division || null,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
            source: task.source,
            commentCount: task.comments ? task.comments.length : 0,
            lastComment: lastComment ? { author: lastComment.author, text: (lastComment.text || '').substring(0, 150), createdAt: lastComment.createdAt } : null,
            archivedAt: archiveStamp,
            archivedReason: 'campaign_canceled',
            campaignId: campaignId,
            campaignTitle: campaign.title || null
          });
          archivedTaskIds.add(task.id);
          _taskIdsArchived.add(task.id);
          canceledArchiveCounts.set('cmp:' + campaignId, (canceledArchiveCounts.get('cmp:' + campaignId) || 0) + 1);
        }
        task._archived = true;
        task.updatedAt = new Date().toISOString();
        keepTasks.push(task);
        continue;
      }

      // Canceled-objective archive
      const objectiveId = task && task.objective_id ? task.objective_id : null;
      if (objectiveId && canceledObjectives.has(objectiveId)) {
        const objective = canceledObjectives.get(objectiveId);
        const nowIso = new Date().toISOString();
        const archiveStamp = task.archivedAt || nowIso;
        const cancelComment = 'Auto-archived: Objective canceled (objectiveId=' + objectiveId + ', title=' + (objective.title || objectiveId) + '). Execution blocked.';
        if (!task.comments) task.comments = [];
        const hasCancelComment = task.comments.some(function (c) {
          return c && c.author === 'system' && c.text === cancelComment;
        });
        if (!hasCancelComment) {
          task.comments.push({
            id: 'cmt-archive-objective-canceled-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            author: 'system',
            text: cancelComment,
            type: 'system',
            createdAt: nowIso
          });
        }
        const lastComment = (task.comments && task.comments.length > 0) ? task.comments[task.comments.length - 1] : null;

        if (!archivedTaskIds.has(task.id)) {
          toArchive.push({
            id: task.id,
            title: task.title,
            description: (task.description || '').substring(0, 200),
            status: task.status,
            priority: task.priority,
            assignee: task.assignee,
            division: task.division || null,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
            source: task.source,
            commentCount: task.comments ? task.comments.length : 0,
            lastComment: lastComment ? { author: lastComment.author, text: (lastComment.text || '').substring(0, 150), createdAt: lastComment.createdAt } : null,
            archivedAt: archiveStamp,
            archivedReason: 'objective_canceled',
            objectiveId: objectiveId,
            objectiveTitle: objective.title || null
          });
          archivedTaskIds.add(task.id);
          _taskIdsArchived.add(task.id);
          canceledArchiveCounts.set(objectiveId, (canceledArchiveCounts.get(objectiveId) || 0) + 1);
        }
        // Mark as archived and KEEP in active. Do NOT use `continue` to remove —
        // CompanyStore sync always re-adds items from localStorage that are missing
        // from server, causing infinite oscillation. Frontend filters _archived tasks.
        task._archived = true;
        task.updatedAt = new Date().toISOString();
        keepTasks.push(task);
        continue;
      }

      // Cleanup: agent hallucinated status 'archived' — fix to valid status.
      // Do NOT remove from active (continue) — CompanyStore sync re-adds from localStorage,
      // causing infinite oscillation. Instead, repair status in-place so the canceled-objective
      // or done-aged archive path handles it on subsequent runs.
      if (task.status === 'archived') {
        task.status = 'done';
        task.completedAt = task.completedAt || new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        context.log('[Heartbeat] Cleanup: task', task.id, 'had invalid status "archived" — repaired to "done"');
        // Fall through to normal archive checks below (done-aged, canceled-objective already handled above)
      }

      if (task.status === 'done') {
        const completedMs = task.completedAt ? new Date(task.completedAt).getTime() : 0;
        const updatedMs = task.updatedAt ? new Date(task.updatedAt).getTime() : 0;
        const doneAt = completedMs || updatedMs;
        if (doneAt && (archiveNow - doneAt) > ARCHIVE_AGE_MS && !archivedTaskIds.has(task.id)) {
          // Compact: strip full comments, keep summary
          const lastComment = (task.comments && task.comments.length > 0) ? task.comments[task.comments.length - 1] : null;
          toArchive.push({
            id: task.id,
            title: task.title,
            description: (task.description || '').substring(0, 200),
            status: 'done',
            priority: task.priority,
            assignee: task.assignee,
            division: task.division || null,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
            source: task.source,
            commentCount: task.comments ? task.comments.length : 0,
            lastComment: lastComment ? { author: lastComment.author, text: (lastComment.text || '').substring(0, 150), createdAt: lastComment.createdAt } : null,
            archivedAt: new Date().toISOString(),
            archivedReason: 'done_aged_7d'
          });
          archivedTaskIds.add(task.id);
          _taskIdsArchived.add(task.id);
          task._archived = true;
          task.updatedAt = new Date().toISOString();
          // Fall through to keepTasks — same anti-oscillation pattern
        }
      }
      keepTasks.push(task);
    }

    if (toArchive.length > 0) {
      archive.push(...toArchive);
      // Cap archive
      if (archive.length > ARCHIVE_MAX) archive.splice(0, archive.length - ARCHIVE_MAX);
      await storage.setState('tasksArchive', archive);
      // Replace tasks array in-place (agents use this reference)
      tasks.length = 0;
      tasks.push(...keepTasks);
      context.log('[Heartbeat] Archived', toArchive.length, 'task(s). Active tasks:', tasks.length);
    }

    if (canceledArchiveCounts.size > 0) {
      const byObjective = Array.from(canceledArchiveCounts.entries()).map(function (entry) {
        return { objectiveId: entry[0], count: entry[1] };
      });
      const totalCanceledArchived = byObjective.reduce(function (sum, item) { return sum + item.count; }, 0);
      const details = {
        runId: runId,
        reason: 'objective_canceled',
        count: totalCanceledArchived,
        byObjective: byObjective
      };
      if (byObjective.length === 1) {
        details.objectiveId = byObjective[0].objectiveId;
      }
      await logEvent('auto-archive', null, 'Auto-archived tasks for canceled objective(s)', runId, details);
    }

    // ── Fix 11c: Document cleanup — archive stale duplicate drafts ──
    // Runs once per heartbeat: archives draft/ready_for_approval docs older than 48h
    // that have near-duplicate titles (keeps the newest of each cluster)
    try {
      const _allDocs = (await storage.getState('documents')) || [];
      const _archivableDocs = _allDocs.filter(d =>
        (d.status === 'draft' || d.status === 'ready_for_approval') &&
        d.created_at && (Date.now() - new Date(d.created_at).getTime()) > 48 * 60 * 60 * 1000
      );
      if (_archivableDocs.length > 0) {
        // Group by fuzzy title — keep newest per cluster, archive the rest
        const _clusters = [];
        for (const doc of _archivableDocs) {
          const _dWords = (doc.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
          let matched = false;
          for (const cluster of _clusters) {
            const _cWords = cluster.words;
            if (_dWords.length >= 3 && _cWords.length >= 3) {
              const _overlap = _dWords.filter(w => _cWords.indexOf(w) !== -1).length;
              const _sim = _overlap / Math.max(_dWords.length, _cWords.length);
              if (_sim > 0.5) {
                cluster.docs.push(doc);
                matched = true;
                break;
              }
            }
          }
          if (!matched) _clusters.push({ words: _dWords, docs: [doc] });
        }
        let _archivedCount = 0;
        for (const cluster of _clusters) {
          if (cluster.docs.length <= 1) continue;
          // Sort newest first, archive all but the newest
          cluster.docs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          for (let ci = 1; ci < cluster.docs.length; ci++) {
            const _idx = _allDocs.findIndex(d => d.id === cluster.docs[ci].id);
            if (_idx !== -1) {
              _allDocs[_idx].status = 'archived';
              _allDocs[_idx].updated_at = new Date().toISOString();
              _allDocs[_idx]._archived_reason = 'duplicate_cleanup';
              _archivedCount++;
            }
          }
        }
        if (_archivedCount > 0) {
          await storage.setState('documents', _allDocs);
          context.log('[Heartbeat] Doc cleanup: archived', _archivedCount, 'stale duplicate draft(s) from', _clusters.length, 'title clusters');
        }
      }
    } catch (_docCleanErr) {
      context.log('[Heartbeat] Doc cleanup error (non-fatal):', String(_docCleanErr).substring(0, 200));
    }

    // ── Auto-triage CEO tasks ──
    // CEO-created tasks with assignee AND dueDate already set need no human triage.
    // Inject a system comment so the prompt-level triage gate is satisfied immediately.
    let autoTriageCount = 0;
    for (const task of tasks) {
      if (task.source === 'heartbeat') continue;          // agent-created — needs real triage
      if (task.status === 'done' || task.status === 'backlog') continue;
      if (!task.assignee || !task.dueDate) continue;      // incomplete — needs Nova triage
      const hasTriageStamp = task.comments && task.comments.some(
        c => c.author === 'nova' || c.author === 'system'
      );
      if (hasTriageStamp) continue;                        // already triaged
      // Inject auto-triage stamp
      if (!task.comments) task.comments = [];
      task.comments.push({
        id: 'cmt-autotriage-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        author: 'system',
        text: 'Auto-triaged: CEO-assigned task with assignee (' + task.assignee + ') and due date (' + task.dueDate.substring(0, 10) + ') preset. Ready for execution.',
        type: 'system',
        createdAt: new Date().toISOString()
      });
      task.updatedAt = new Date().toISOString();
      autoTriageCount++;
    }
    if (autoTriageCount > 0) {
      context.log('[Heartbeat] Auto-triaged', autoTriageCount, 'CEO task(s) with assignee+dueDate');
    }

    // Review cooldown: track tasks that enter review THIS cycle — cannot be reviewed in same cycle
    const _reviewCooldownIds = new Set();
    const _agentCampaignCtx = {
      campaignById: campaignById,
      campaigns: campaigns,
      campaignGovEvents: campaignGovEvents,
      campaignsChanged: false
    };

    // Process each agent
    for (const agentId of AGENT_IDS) {
      if (geminiCalls >= GUARDRAILS.maxGeminiCallsPerCycle) {
        context.log('[Heartbeat] Max Gemini calls reached, stopping');
        break;
      }

      const agentConfig = configs[agentId] || {};
      const heartbeat = agentConfig.heartbeat || { enabled: true };

      // Skip if agent heartbeat is disabled
      if (heartbeat.enabled === false) {
        context.log('[Heartbeat] Agent', agentId, 'heartbeat disabled, skipping');
        continue;
      }

      // Tier 4 sub-agent gating: only run if they have active tasks or recent @mentions
      if (TIER4_SUB_AGENTS.has(agentId)) {
        const gate = shouldRunTier4Agent(tasks, agentId);
        if (!gate.run) {
          context.log('[Heartbeat] Skipping Tier4 sub-agent', agentId + ':', gate.reason);
          skippedAgents.push({ agentId: agentId, reason: gate.reason });
          continue;
        }
        context.log('[Heartbeat] Tier4 sub-agent', agentId, 'triggered:', gate.reason);
      }

      agentActions[agentId] = 0;

      try {
        const result = await runAgentHeartbeat(
          context, agentId, tasks, configs, recentSummaries, cycleId,
          agentId === 'nova' ? novaSkipTaskIds : null,
          activeDirectives, activeObjectives, documents,
          workspaceMemory, workspaceDates, revisionActions,
          agentId === 'cipher' ? costIntel : null,
          _reviewCooldownIds, _seedMemories, researchIntelStore, socialIntel,
          normalizedActivationMode, _isAgentInCooldown, _logAgentCooldownOnce, _incPolicyGate,
          _agentCampaignCtx, siteIntel,
          agentId === 'nova' ? workerReports : null,
          _agentMemoryStore
        );
        // Collect any new research intel from this agent's cycle
        if (result.newResearchIntel) {
          researchIntelStore.push(result.newResearchIntel);
          if (researchIntelStore.length > MAX_RESEARCH_STORE_ENTRIES) {
            researchIntelStore = researchIntelStore.slice(-MAX_RESEARCH_STORE_ENTRIES);
          }
        }
        geminiCalls += result.geminiCalls;
        agentActions[agentId] = result.actions;
        _agentRunStats[agentId] = {
          attempted: result.actionAttempts || 0,
          executed: result.actions || 0,
          blocked: 0,
          newTasksCreated: 0,
          avgLatencyMs: result.durationMs || 0,
          guardrailBlocked: ((result.guardrails && result.guardrails.orphanBlocked) || 0)
            + ((result.guardrails && result.guardrails.exactDupBlocked) || 0)
            + ((result.guardrails && result.guardrails.fuzzyDupBlocked) || 0)
            + ((result.guardrails && result.guardrails.taskCeilingBlocked) || 0)
            + ((result.guardrails && result.guardrails.socialPromoGateBlocked) || 0)
        };
        if (result.guardrails) {
          _guardrailCounts.orphanBlocked += result.guardrails.orphanBlocked || 0;
          _guardrailCounts.exactDupBlocked += result.guardrails.exactDupBlocked || 0;
          _guardrailCounts.fuzzyDupBlocked += result.guardrails.fuzzyDupBlocked || 0;
          _guardrailCounts.taskCeilingBlocked += result.guardrails.taskCeilingBlocked || 0;
          _guardrailCounts.socialPromoGateBlocked += result.guardrails.socialPromoGateBlocked || 0;
        }
        if (_agentCampaignCtx.campaignsChanged) {
          campaignsChanged = true;
          _agentCampaignCtx.campaignsChanged = false;
        }

        // Observe mode: discard taskUpdates before mutation stage
        if (executionMode === 'observe' && result.taskUpdates && result.taskUpdates.length > 0) {
          const _observeBlocked = result.taskUpdates.length;
          context.log('[Heartbeat]', agentId, 'observe mode — discarding', _observeBlocked, 'taskUpdates');
          result.taskUpdates = [];
          _incBlocked(agentId);
          await logEvent('run-digest', agentId, 'Observe mode: taskUpdates discarded', runId, {
            mode: executionMode, channel: 'heartbeat', agentId: agentId,
            taskUpdatesBlocked: _observeBlocked, taskUpdatesApplied: 0,
            proposalsCount: (result.proposals || []).length,
            observationsCount: (result.observations || []).length,
            rememberCount: (result.remember || []).length
          });
        }

        // Apply task mutations
        if (result.taskUpdates && result.taskUpdates.length > 0) {
          for (const update of result.taskUpdates) {
            if (newTasksCreated >= GUARDRAILS.maxNewTasksPerCycle && update.action === 'create') {
              context.log('[Heartbeat] Max new tasks reached, skipping create');
              continue;
            }
            // Review cooldown: block reviews on tasks that entered review this cycle
            if (update.action === 'review' && update.taskId && _reviewCooldownIds.has(update.taskId)) {
              context.log('[Heartbeat]', agentId, 'BLOCKED review on', update.taskId, '— task just entered review this cycle (cooldown)');
              continue;
            }
            const mutationAction = update.action;
            const isTaskMutation = mutationAction === 'create' || mutationAction === 'move' || mutationAction === 'update';

            // Per-run cooldown: once threshold is reached, suppress further task mutations for this agent.
            if (isTaskMutation && _isAgentInCooldown(agentId)) {
              await _logAgentCooldownOnce(agentId);
              continue;
            }

            if (isTaskMutation) {
              if (!result.proposals) result.proposals = [];

              // Manual mode gate: proposal-only, no direct task mutations
              if (normalizedActivationMode === 'manual') {
                _incBlocked(agentId);
                const _modeTask = mutationAction === 'create'
                  ? { id: null, title: (update.task && update.task.title) || 'Untitled', category: (update.task && update.task.category) || null, objective_id: (update.task && update.task.objective_id) || null }
                  : tasks.find(t => t.id === update.taskId);
                if (_canAddProposal(agentId)) {
                  const modeProposal = _normalizeProposal(_buildBlockedProposal(agentId, runId, 'mode_gate', mutationAction === 'create' ? 'create_task' : 'move_task', {
                    title: (_modeTask && _modeTask.title) || (update.task && update.task.title) || null,
                    category: (_modeTask && _modeTask.category) || (update.task && update.task.category) || null,
                    objective_id: (_modeTask && _modeTask.objective_id) || (update.task && update.task.objective_id) || null,
                    objective_suggestion: 'Switch to supervised_autonomous or assign an objective to proceed.',
                    evidence: {
                      blockedAction: mutationAction,
                      taskId: update.taskId || null,
                      mode: normalizedActivationMode
                    }
                  }));
                  if (_isValidProposal(modeProposal)) {
                    result.proposals.push(modeProposal);
                    _incProposal(agentId);
                  } else {
                    _incPolicyGate('proposal_schema');
                    await logEvent('policy-violation', agentId, 'Invalid proposal rejected', runId, { gate: 'proposal_schema', reason: 'invalid_proposal', proposedAction: mutationAction });
                  }
                }
                await logEvent('policy-violation', agentId, 'Task mutation blocked by activation mode', runId, {
                  runId: runId,
                  agentId: agentId,
                  gate: 'mode_gate',
                  action: mutationAction,
                  reason: 'activationMode=manual blocks task mutations',
                  taskId: update.taskId || null,
                  category: (_modeTask && _modeTask.category) || (update.task && update.task.category) || null
                });
                continue;
              }

              // Objective gate: require objective_id for create and transitions into start-work statuses unless exempt category
              let requiresObjective = false;
              let targetTask = null;
              if (mutationAction === 'create') {
                requiresObjective = true;
              } else if (mutationAction === 'move') {
                targetTask = tasks.find(t => t.id === update.taskId);
                const oldStatus = targetTask ? targetTask.status : null;
                if (_isStartWorkStatus(update.newStatus) && !_isStartWorkStatus(oldStatus)) {
                  requiresObjective = true;
                }
              } else if (mutationAction === 'update') {
                targetTask = tasks.find(t => t.id === update.taskId);
                const oldStatus = targetTask ? targetTask.status : null;
                const nextStatus = update.updates ? update.updates.status : null;
                if (_isStartWorkStatus(nextStatus) && !_isStartWorkStatus(oldStatus)) {
                  requiresObjective = true;
                }
              }

              if (requiresObjective) {
                const gateTask = mutationAction === 'create' ? (update.task || {}) : (targetTask || {});
                const category = _normalizeCategory(gateTask.category || gateTask.task_category || null);
                const objectiveId = mutationAction === 'create'
                  ? (update.task && update.task.objective_id)
                  : ((update.updates && update.updates.objective_id) || gateTask.objective_id || null);
                if (!_isObjectiveExemptCategory(category) && !objectiveId) {
                  const gateProposal = _buildBlockedProposal(agentId, runId, 'objective_gate', mutationAction === 'create' ? 'create_task' : 'move_task', {
                    title: gateTask.title || (update.task && update.task.title) || null,
                    category: category || null,
                    objective_id: null,
                    objective_suggestion: 'Assign an objective before this task can proceed.',
                    acceptanceCriteria: ['Link task to an active objective.'],
                    evidence: {
                      blockedAction: mutationAction,
                      taskId: update.taskId || null,
                      targetStatus: update.newStatus || (update.updates && update.updates.status) || null
                    }
                  });
                  _incBlocked(agentId);
                  if (_canAddProposal(agentId)) {
                    const _normalizedObjProposal = _normalizeProposal(gateProposal);
                    if (_isValidProposal(_normalizedObjProposal)) {
                      result.proposals.push(_normalizedObjProposal);
                      _incProposal(agentId);
                    } else {
                      _incPolicyGate('proposal_schema');
                      await logEvent('policy-violation', agentId, 'Invalid proposal rejected', runId, { gate: 'proposal_schema', reason: 'invalid_proposal', proposedAction: mutationAction });
                    }
                  }
                  await logEvent('policy-violation', agentId, 'Task mutation blocked by objective gate', runId, {
                    runId: runId,
                    agentId: agentId,
                    gate: 'objective_gate',
                    action: mutationAction,
                    reason: 'objective_id required for task write',
                    taskId: update.taskId || null,
                    category: category || null
                  });
                  continue;
                }
              }

              // Objective status gate: move/update transitions into start-work statuses require active objective
              if (mutationAction === 'move' || mutationAction === 'update') {
                const oldStatus = targetTask ? targetTask.status : null;
                const nextStatus = mutationAction === 'move'
                  ? update.newStatus
                  : (update.updates ? update.updates.status : null);
                const entersStartWork = _isStartWorkStatus(nextStatus) && !_isStartWorkStatus(oldStatus);

                if (entersStartWork) {
                  const objectiveIdOnTask = targetTask ? (targetTask.objective_id || null) : null;
                  const linkedObjective = objectiveIdOnTask
                    ? objectives.find(o => o.id === objectiveIdOnTask)
                    : null;
                  const objectiveStatus = linkedObjective ? String(linkedObjective.status || '').toLowerCase() : null;
                  const _terminalObjStatuses = ['complete', 'completed', 'canceled'];
                  const missingOrNotActive = !linkedObjective || _terminalObjStatuses.indexOf(objectiveStatus) !== -1;

                  if (missingOrNotActive) {
                    _incBlocked(agentId);
                    const objectiveBlockReason = objectiveStatus === 'complete'
                      ? 'objective_completed'
                      : objectiveStatus === 'canceled'
                        ? 'objective_canceled'
                        : 'objective_missing_or_not_active';

                    if (_canAddProposal(agentId)) {
                      const suggestedFix = linkedObjective
                        ? 'activate objective'
                        : 'reassign objective';
                      const statusProposal = _normalizeProposal({
                        type: 'proposal',
                        agentId: agentId,
                        runId: runId,
                        reasonBlocked: 'objective_status',
                        proposedAction: 'move_task',
                        payload: {
                          title: 'Task blocked: objective must be active before entering in-progress',
                          category: 'governance',
                          objective_id: objectiveIdOnTask,
                          taskId: update.taskId || null,
                          suggestedFix: suggestedFix,
                          objective_suggestion: suggestedFix === 'activate objective'
                            ? 'Activate objective before moving task to in-progress.'
                            : 'Reassign task to an active objective before moving to in-progress.',
                          acceptanceCriteria: ['Objective exists and has status active before task enters in-progress.'],
                          evidence: {
                            runId: runId,
                            gate: 'objective_status',
                            blockedAction: mutationAction,
                            taskId: update.taskId || null,
                            objective_id: objectiveIdOnTask,
                            objective_status: objectiveStatus || 'missing',
                            reason: objectiveBlockReason
                          }
                        }
                      });
                      if (_isValidProposal(statusProposal)) {
                        result.proposals.push(statusProposal);
                        _incProposal(agentId);
                      }
                    }

                    _incPolicyGate('objective_status');
                    if (objectiveBlockReason === 'objective_canceled') {
                      _objectiveStatusBlockDetails.push({
                        objectiveId: objectiveIdOnTask || null,
                        objectiveStatus: 'canceled',
                        reason: 'objective_canceled'
                      });
                    }
                    await logEvent('policy-violation', agentId, 'Task mutation blocked by objective status gate', runId, {
                      runId: runId,
                      agentId: agentId,
                      gate: 'objective_status',
                      reason: objectiveBlockReason,
                      objectiveId: objectiveIdOnTask || null,
                      objectiveStatus: objectiveStatus || 'missing',
                      objective_id: objectiveIdOnTask,
                      taskId: update.taskId || null
                    });
                    continue;
                  }
                }
              }
            }

            // Rate-cap gate: per-agent per-run mutation caps
            if (isTaskMutation) {
              const _bucket = _MUTATION_BUCKET_MAP[mutationAction];
              _ensureAgentCounters(agentId);
              const _capKey = mutationAction === 'create' ? 'maxCreatesPerAgentPerRun'
                : mutationAction === 'move' ? 'maxMovesPerAgentPerRun'
                : 'maxUpdatesPerAgentPerRun';
              const _cap = _effectiveCaps[_capKey];
              const _current = _runCounters.byAgent[agentId][_bucket];
              if (_current >= _cap) {
                _incBlocked(agentId);
                if (_canAddProposal(agentId)) {
                  const _rcProposal = _normalizeProposal(_buildBlockedProposal(agentId, runId, 'rate_cap', mutationAction, {
                    title: 'Rate cap exceeded: ' + _bucket + ' (' + _current + '/' + _cap + ')',
                    category: 'governance',
                    taskId: update.taskId || null,
                    cap: _cap,
                    current: _current,
                    bucket: _bucket,
                    objective_suggestion: 'Reduce mutation volume or request cap increase.',
                    acceptanceCriteria: ['Stay within per-agent per-run ' + _bucket + ' cap of ' + _cap + '.'],
                    evidence: {
                      blockedAction: mutationAction,
                      taskId: update.taskId || null,
                      cap: _cap,
                      current: _current
                    }
                  }));
                  if (_isValidProposal(_rcProposal)) {
                    result.proposals.push(_rcProposal);
                    _incProposal(agentId);
                  } else {
                    _incPolicyGate('proposal_schema');
                    await logEvent('policy-violation', agentId, 'Invalid proposal rejected', runId, { gate: 'proposal_schema', reason: 'invalid_proposal', proposedAction: mutationAction });
                  }
                }
                await logEvent('policy-violation', agentId, 'Task mutation blocked by rate cap', runId, {
                  runId: runId,
                  agentId: agentId,
                  gate: 'rate_cap',
                  action: mutationAction,
                  reason: 'cap_exceeded',
                  cap: _cap,
                  current: _current,
                  taskId: update.taskId || null
                });
                continue;
              }
            }

            // Field allowlist gate: block updates containing disallowed keys
            if (mutationAction === 'update' || (mutationAction === 'move' && update.updates)) {
              const updateKeys = update.updates ? Object.keys(update.updates) : [];
              const blockedKeys = updateKeys.filter(k => !ALLOWED_UPDATE_KEYS.has(k));
              if (blockedKeys.length > 0) {
                const allowlistProposal = _buildBlockedProposal(agentId, runId, 'field_allowlist', mutationAction, {
                  title: 'Update blocked: disallowed fields [' + blockedKeys.join(', ') + ']',
                  category: 'governance',
                  taskId: update.taskId || null,
                  blockedKeys: blockedKeys,
                  allowedKeys: Array.from(ALLOWED_UPDATE_KEYS),
                  objective_suggestion: 'Use only allowed update fields: ' + Array.from(ALLOWED_UPDATE_KEYS).join(', ') + '.',
                  acceptanceCriteria: ['Remove disallowed fields: ' + blockedKeys.join(', ') + '.'],
                  evidence: {
                    blockedAction: mutationAction,
                    taskId: update.taskId || null,
                    blockedKeys: blockedKeys
                  }
                });
                _incBlocked(agentId);
                if (_canAddProposal(agentId)) {
                  const _normalizedAlProposal = _normalizeProposal(allowlistProposal);
                  if (_isValidProposal(_normalizedAlProposal)) {
                    result.proposals.push(_normalizedAlProposal);
                    _incProposal(agentId);
                  } else {
                    _incPolicyGate('proposal_schema');
                    await logEvent('policy-violation', agentId, 'Invalid proposal rejected', runId, { gate: 'proposal_schema', reason: 'invalid_proposal', proposedAction: mutationAction });
                  }
                }
                await logEvent('policy-violation', agentId, 'Task update blocked by field allowlist', runId, {
                  runId: runId,
                  agentId: agentId,
                  gate: 'field_allowlist',
                  action: mutationAction,
                  taskId: update.taskId || null,
                  blockedKeys: blockedKeys
                });
                continue;
              }
            }

            // Canceled-objective freeze: block ALL mutations on tasks linked to canceled objectives
            if (mutationAction !== 'create') {
              const _freezeTask = tasks.find(t => t.id === update.taskId);
              if (_freezeTask && _freezeTask.objective_id) {
                const _freezeObj = objectives.find(o => o.id === _freezeTask.objective_id);
                if (_freezeObj && String(_freezeObj.status || '').toLowerCase() === 'canceled') {
                  _incBlocked(agentId);
                  _incPolicyGate('objective_canceled_freeze');
                  await logEvent('policy-violation', agentId, 'Mutation blocked: task linked to canceled objective', runId, {
                    runId: runId, agentId: agentId, gate: 'objective_canceled_freeze',
                    action: mutationAction, taskId: update.taskId,
                    objectiveId: _freezeTask.objective_id, reason: 'objective_canceled'
                  });
                  continue;
                }
              }
            }

            // Canceled-campaign freeze: block ALL mutations on tasks linked to canceled campaigns
            if (mutationAction !== 'create') {
              const _cmpCancelTask = tasks.find(t => t.id === update.taskId);
              if (_cmpCancelTask && _cmpCancelTask.campaign_id) {
                const _cmpCancel = campaignById[_cmpCancelTask.campaign_id] || null;
                if (_cmpCancel && String(_cmpCancel.status || '').toLowerCase() === 'canceled') {
                  _incBlocked(agentId);
                  await logEvent('policy-violation', agentId, 'Mutation blocked: task linked to canceled campaign', runId, {
                    runId: runId, agentId: agentId, gate: 'campaign_canceled_freeze',
                    action: mutationAction, taskId: update.taskId,
                    campaignId: _cmpCancelTask.campaign_id, reason: 'campaign_canceled'
                  });
                  continue;
                }
              }
            }

            // Campaign status freeze gate: block ALL mutations on tasks linked to paused campaigns
            if (mutationAction !== 'create') {
              const _psTask = tasks.find(t => t.id === update.taskId);
              const _psCampaignId = _psTask ? (_psTask.campaign_id || null) : null;
              if (_psCampaignId) {
                const _psCampaign = campaignById[_psCampaignId] || null;
                const _psOldStatus = _psTask ? (_psTask.status || null) : null;
                const _psNextStatus = mutationAction === 'move'
                  ? update.newStatus
                  : (update.updates ? update.updates.status : null);
                const _psFieldsChanged = update.updates ? Object.keys(update.updates) : (mutationAction === 'move' ? ['status'] : []);

                if (_psCampaign && String(_psCampaign.status || '').toLowerCase() === 'paused') {
                  _incBlocked(agentId);
                  _incPolicyGate('campaign_status');
                  _guardrailCounts.pausedCampaignAutomationBlocked++;
                  _projectStatusBlockDetails.push({ campaignId: _psCampaignId, taskId: update.taskId, reason: 'campaign_paused' });
                  await logEvent('policy-violation', agentId, 'Mutation blocked: campaign paused — all task mutations frozen', runId, {
                    type: 'policy-violation', gate: 'campaign_status', reason: 'campaign_paused',
                    campaignId: _psCampaignId, campaignStatus: 'paused', taskId: update.taskId,
                    attempted: { fieldsChanged: _psFieldsChanged, statusFrom: _psOldStatus, statusTo: _psNextStatus }
                  });
                  continue;
                }
              }
            }

            // ── CONTENT PUBLISH GUARD: blog/content tasks stay in 'review' until submit-for-publish ──
            // Prevents content tasks from going to 'done' before the document is submitted for publish
            {
              const _cpgNextStatus = update.newStatus || (update.updates && update.updates.status) || null;
              if (_cpgNextStatus === 'done') {
                const _cpgTask = tasks.find(t => t.id === update.taskId);
                if (_cpgTask) {
                  const _cpgTitle = (_cpgTask.title || '').toLowerCase();
                  const _cpgTags = _cpgTask.tags || [];
                  const _isContentTask = /draft blog|blog post|draft.*article|content brief/i.test(_cpgTask.title || '') ||
                    _cpgTags.indexOf('content') !== -1 || _cpgTags.indexOf('blog') !== -1;
                  if (_isContentTask) {
                    // Find linked document ID from task comments
                    let _cpgDocId = null;
                    const _cpgComments = _cpgTask.comments || [];
                    for (let _ci = _cpgComments.length - 1; _ci >= 0; _ci--) {
                      const _cmMatch = (_cpgComments[_ci].text || '').match(/doc_[a-z0-9_]+/i);
                      if (_cmMatch) { _cpgDocId = _cmMatch[0]; break; }
                    }
                    if (_cpgDocId) {
                      // Check if a publish_document action exists for this document
                      const _cpgHasPublish = allActions.some(a =>
                        a.type === 'publish_document' && a.payload && a.payload.documentId === _cpgDocId
                      );
                      if (!_cpgHasPublish) {
                        // Cap at review — agent needs to run submit-for-publish first
                        if (update.newStatus) update.newStatus = 'review';
                        if (update.updates && update.updates.status) update.updates.status = 'review';
                        context.log('[Heartbeat]', agentId, 'CONTENT PUBLISH GUARD: capped task', update.taskId, 'to review — doc', _cpgDocId, 'has no publish action yet');
                      }
                    }
                  }
                }
              }
            }

            const updatedTask = applyTaskUpdate(tasks, update, _pendingEscalations, agentId);
            if (updatedTask && updatedTask.id) _tasksTouched.add(updatedTask.id);
            // Increment per-agent mutation counter on successful write
            if (isTaskMutation) {
              const _successBucket = _MUTATION_BUCKET_MAP[mutationAction];
              if (_successBucket) {
                _ensureAgentCounters(agentId);
                _runCounters.totals[_successBucket]++;
                _runCounters.byAgent[agentId][_successBucket]++;
              }
            }
            if (update.action === 'create') newTasksCreated++;
            // CEO task completion → create action for approval queue
            if (update._ceoApprovalAction) {
              const ceo = update._ceoApprovalAction;
              const actionsStore = (await storage.getState('actions')) || [];
              // Dedupe: skip if a task_completion.approve already exists for this taskId
              const existingApproval = actionsStore.find(a => a.type === 'task_completion.approve' && a.payload && a.payload.taskId === ceo.taskId);
              // Skip if ANY social post action was ever linked to this task — social post approval is the gate, not task_completion
              const linkedSocialAction = actionsStore.find(a => a._parentTaskId === ceo.taskId && a.type && a.type.indexOf('social_post') === 0);
              // Skip if a content package approval exists for this task — content.package approval is the gate
              const linkedContentPkg = actionsStore.find(a => a._parentTaskId === ceo.taskId && a.type === 'content.package');
              // Also check approvalQueue for content.package items linked to this task
              const approvalQueueStore = linkedContentPkg ? null : (await storage.getState('approvalQueue')) || [];
              const linkedContentPkgAQ = !linkedContentPkg && approvalQueueStore ? approvalQueueStore.find(q => q.taskId === ceo.taskId && (q.kind === 'content.package' || q.type === 'content.package')) : null;
              if (linkedSocialAction) {
                context.log('[Heartbeat] Skipping task_completion.approve for task:', ceo.taskId, '— linked social action', linkedSocialAction.id, 'will auto-complete on CEO approval');
              } else if (linkedContentPkg || linkedContentPkgAQ) {
                context.log('[Heartbeat] Skipping task_completion.approve for task:', ceo.taskId, '— linked content package in approval queue');
              } else if (existingApproval) {
                context.log('[Heartbeat] Skipping duplicate task_completion.approve for task:', ceo.taskId, '(existing:', existingApproval.id + ')');
              } else {
              const nowIso = new Date().toISOString();
              // Check for linked document — if one exists, publish_document is the real CEO gate
              let _tcDocId = null;
              try {
                const _tcDocs = (await storage.getState('documents')) || [];
                const _tcDoc = _tcDocs.find(d => d.taskId === ceo.taskId);
                if (_tcDoc) _tcDocId = _tcDoc.id;
              } catch (_tcErr) { /* non-fatal */ }

              if (_tcDocId) {
                // Task has a linked document — auto-complete, publish_document is the CEO gate
                const _docParent = tasks.find(t => t.id === ceo.taskId);
                if (_docParent && _docParent.status !== 'done') {
                  _docParent.status = 'done';
                  _docParent.completedAt = nowIso;
                  _docParent.updatedAt = nowIso;
                }
                context.log('[Heartbeat] Auto-completed task with linked doc:', ceo.taskId, '(doc:', _tcDocId, ') — publish_document is the CEO gate');
              } else {
              // No linked document — create task_completion.approve for CEO review
              const completionAction = {
                id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                created_at: nowIso,
                created_by: ceo.reviewerId || agentId,
                type: 'task_completion.approve',
                platform: 'internal',
                payload: {
                  text: '**Task:** ' + ceo.taskTitle + '\n\n**Deliverable:**\n' + (ceo.deliverable || '(no deliverable)').substring(0, 2000) + '\n\n**Peer Review (' + (ceo.reviewerId || 'agent') + '):** ' + (ceo.reviewFeedback || 'Approved'),
                  taskId: ceo.taskId,
                  taskTitle: ceo.taskTitle,
                  assignee: ceo.assignee
                },
                classification: 'autonomous',
                requires_ceo_approval: true,
                risk_level: 'low',
                brand_impact: 'none',
                budget_impact: 0,
                // Pending CEO approval — task stays in review until CEO signs off on the deliverable
                approval: { status: 'pending' },
                execution: { status: 'pending', started_at: null, finished_at: null, attempts: 0, last_error: null, receipt: null },
                action_type: 'task_completion.approve',
                action_category: 'task',
                execution_status: 'pending',
                origin_agent: ceo.reviewerId || agentId,
                action_payload: { taskId: ceo.taskId, taskTitle: ceo.taskTitle },
                requires_approval: true,
                is_irreversible: false,
                _parentTaskId: ceo.taskId,
                source: 'heartbeat'
              };
              actionsStore.push(completionAction);
              _guardrailCounts.ceoApprovalsTriggered++;
              // Task stays in review — CEO approves via actions tab, client-side handler moves task to done
              await storage.setState('actions', actionsStore);
              context.log('[Heartbeat] Created pending task_completion.approve for CEO review:', ceo.taskTitle, '→', completionAction.id);
              } // end action creation
              } // end if(_tcDocId) else
            }
            // Track tasks that just entered review — block same-cycle reviews
            if (updatedTask && updatedTask.status === 'review' && (update.action === 'execute' || update.action === 'move' || update.action === 'social-action-created')) {
              _reviewCooldownIds.add(updatedTask.id);
            }
          }
        }

        // Nova auto-assign fallback: if Nova commented on unassigned tasks, detect agent name and auto-assign
        if (agentId === 'nova') {
          const _AGENT_NAMES = { scribe: 'scribe', pixel: 'pixel', echo: 'echo', forge: 'forge', cipher: 'cipher', scout: 'scout', quill: 'quill' };
          for (let _ti = 0; _ti < tasks.length; _ti++) {
            var _t = tasks[_ti];
            if (_t.assignee || _t.status === 'done') continue;
            // Find the MOST RECENT Nova comment (iterate backwards)
            var _novaComments = (_t.comments || []).filter(function(c) { return c.author === 'nova'; });
            if (_novaComments.length === 0) continue;
            var _latestNova = _novaComments[_novaComments.length - 1];
            var _cLower = (_latestNova.text || '').toLowerCase();
            var _assigned = false;
            var _agentKeys = Object.keys(_AGENT_NAMES);
            for (var _ai = 0; _ai < _agentKeys.length; _ai++) {
              if (_cLower.indexOf(_agentKeys[_ai]) !== -1) {
                _t.assignee = _AGENT_NAMES[_agentKeys[_ai]];
                _t.updatedAt = new Date().toISOString();
                if (_t.id) _tasksTouched.add(_t.id);
                if (!_t.comments) _t.comments = [];
                _t.comments.push({ id: 'cmt-autoassign-' + Date.now(), author: 'system', text: 'Auto-assigned to ' + _agentKeys[_ai] + ' based on Nova triage comment.', type: 'system', createdAt: new Date().toISOString() });
                context.log('[Heartbeat] AUTO-ASSIGN:', _t.id, '→', _AGENT_NAMES[_agentKeys[_ai]], '(Nova mentioned', _agentKeys[_ai], 'in triage comment)');
                _assigned = true;
                break;
              }
            }
          }
        }

        // Record heartbeat
        if (configs[agentId]) {
          configs[agentId].heartbeat = configs[agentId].heartbeat || {};
          configs[agentId].heartbeat.lastBeat = new Date().toISOString();
          configs[agentId].heartbeat.status = 'alive';
        }
      } catch (err) {
        context.log.error('[Heartbeat] Agent', agentId, 'failed:', err.message);
        _agentRunStats[agentId] = _agentRunStats[agentId] || {
          attempted: 0,
          executed: 0,
          blocked: 0,
          newTasksCreated: 0,
          avgLatencyMs: 0,
          error: err.message
        };
        await logEvent('error', agentId, 'Heartbeat failed: ' + err.message, cycleId);
      }
    }

    // TTL pruning of agent memories (Phase 1E)
    const _pruneNow = Date.now();
    const _ttlFallbackMs = L4_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
    for (const _pAid of Object.keys(_agentMemoryStore)) {
      if (!Array.isArray(_agentMemoryStore[_pAid])) continue;
      _agentMemoryStore[_pAid] = _agentMemoryStore[_pAid].filter(function (m) {
        var expiry;
        if (m.expiresAt) {
          expiry = new Date(m.expiresAt).getTime();
        } else if (m.timestamp) {
          expiry = new Date(m.timestamp).getTime() + _ttlFallbackMs;
        } else {
          return true; // no date info, keep
        }
        return isNaN(expiry) || expiry > _pruneNow;
      });
      // Re-enforce store cap after pruning
      if (_agentMemoryStore[_pAid].length > MAX_MEMORIES_PER_AGENT) {
        _agentMemoryStore[_pAid] = _agentMemoryStore[_pAid].slice(-MAX_MEMORIES_PER_AGENT);
      }
    }

    // Objective lifecycle health proposals (non-destructive)
    // Suggest status changes only; do not auto-modify objective records.
    const _tasksByObjectiveId = new Map();
    for (const _t of tasks) {
      if (!_t || !_t.objective_id) continue;
      if (!_tasksByObjectiveId.has(_t.objective_id)) _tasksByObjectiveId.set(_t.objective_id, []);
      _tasksByObjectiveId.get(_t.objective_id).push(_t);
    }

    for (const _obj of objectives) {
      if (!_obj || !_obj.id) continue;
      const _linkedTasks = _tasksByObjectiveId.get(_obj.id) || [];
      const _objStatus = String(_obj.status || '').toLowerCase();
      const _allLinkedDone = _linkedTasks.length > 0 && _linkedTasks.every(t => _isTerminalTaskStatus(t.status));

      // Active objective with all linked tasks complete -> suggest objective completion
      if (_objStatus === 'active' && _allLinkedDone) {
        const _completeProposal = _normalizeProposal({
          type: 'proposal',
          agentId: 'nova',
          runId: runId,
          reasonBlocked: 'objective_lifecycle',
          proposedAction: 'complete_objective',
          payload: {
            title: 'Mark objective completed: ' + (_obj.title || _obj.id),
            category: 'governance',
            objective_id: _obj.id,
            objective_suggestion: 'Mark objective as completed.',
            acceptanceCriteria: ['Objective status is active.', 'All linked tasks are completed.'],
            evidence: {
              runId: runId,
              gate: 'objective_lifecycle',
              objective_id: _obj.id,
              objective_status: _objStatus,
              linked_task_count: _linkedTasks.length,
              completed_task_count: _linkedTasks.length
            }
          }
        });
        if (_isValidProposal(_completeProposal)) {
          await logEvent('proposal', 'nova', 'Objective lifecycle suggestion: mark completed (' + (_obj.title || _obj.id) + ')', runId, _completeProposal);
        }
      }

      // Objective with no linked tasks -> suggest archive
      if (_linkedTasks.length === 0) {
        const _archiveProposal = _normalizeProposal({
          type: 'proposal',
          agentId: 'nova',
          runId: runId,
          reasonBlocked: 'objective_lifecycle',
          proposedAction: 'archive_objective',
          payload: {
            title: 'Archive objective with no linked tasks: ' + (_obj.title || _obj.id),
            category: 'governance',
            objective_id: _obj.id,
            objective_suggestion: 'Archive objective or link at least one active task.',
            acceptanceCriteria: ['Objective has zero linked tasks.', 'Owner confirms objective should be archived or re-linked.'],
            evidence: {
              runId: runId,
              gate: 'objective_lifecycle',
              objective_id: _obj.id,
              objective_status: _objStatus,
              linked_task_count: 0
            }
          }
        });
        if (_isValidProposal(_archiveProposal)) {
          await logEvent('proposal', 'nova', 'Objective lifecycle suggestion: archive (' + (_obj.title || _obj.id) + ')', runId, _archiveProposal);
        }
      }
    }

    // ── Task Integrity Guard (permanent) ──
    const _taskIdsAtPersist = new Set(tasks.map(function (t) { return t && t.id; }).filter(Boolean));
    const _unexpectedRemoved = [];
    _taskIdsAtLoad.forEach(function (tid) {
      if (!_taskIdsAtPersist.has(tid) && !_taskIdsArchived.has(tid)) {
        _unexpectedRemoved.push(tid);
      }
    });
    if (_unexpectedRemoved.length > 0) {
      context.log.warn('[Heartbeat] TASK INTEGRITY VIOLATION:', _unexpectedRemoved.length, 'task(s) removed without archive. IDs:', _unexpectedRemoved.slice(0, 5).join(', '));
      await logEvent('task-integrity-violation', null, 'Tasks removed from active without archive record', runId, {
        runId: runId,
        removedCount: _unexpectedRemoved.length,
        removedSample: _unexpectedRemoved.slice(0, 10),
        tasksLoadedCount: _taskIdsAtLoad.size,
        tasksPersistedCount: _taskIdsAtPersist.size,
        archivedCount: _taskIdsArchived.size,
        mode: normalizedActivationMode
      });
    }

    // Persist updated state
    await storage.setState('tasks', tasks);
    if (campaignsChanged) await storage.setState('campaigns', campaigns);
    if (campaignGovEvents.length > 0) {
      const govLog = (await storage.getState('governanceLog')) || [];
      for (const evt of campaignGovEvents) govLog.push(evt);
      if (govLog.length > 300) govLog.splice(0, govLog.length - 300);
      await storage.setState('governanceLog', govLog);
    }
    await storage.setState('agentConfigs', configs);
    await storage.setState('agentMemories', _agentMemoryStore);
    await storage.setState('researchIntel', researchIntelStore);
    await storage.setState('runtimeMemory', runtimeMemory);

    // Persist escalations to approval queue
    if (_pendingEscalations.length > 0) {
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      for (const esc of _pendingEscalations) {
        approvalQueue.push({
          id: 'appr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          taskId: esc.taskId,
          taskTitle: esc.taskTitle,
          originAgent: esc.originAgent,
          riskLevel: esc.riskLevel,
          budgetImpact: esc.budgetImpact,
          brandImpact: esc.brandImpact,
          classification: esc.classification,
          proposedDeadline: null,
          recommendation: '',
          status: 'pending',
          submittedAt: new Date().toISOString(),
          resolvedAt: null,
          ceoDecision: null
        });
      }
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);
      context.log('[Heartbeat] Escalated', _pendingEscalations.length, 'tasks to CEO approval queue');

      // Log escalation events
      for (const esc of _pendingEscalations) {
        await logEvent('escalation', esc.originAgent,
          esc.taskTitle + ' escalated to CEO (' + esc.classification + ', risk: ' + esc.riskLevel + ')',
          cycleId
        );
      }
    }

    // Log cron entry
    const ranTier4 = AGENT_IDS.filter(function (id) {
      return TIER4_SUB_AGENTS.has(id) && !skippedAgents.some(function (s) { return s.agentId === id; });
    });

    const cronLog = (await storage.getState('cronLog')) || [];
    cronLog.push({
      agentId: null,
      task: 'companyHeartbeat',
      result: 'completed',
      cycleId: cycleId,
      geminiCalls: geminiCalls,
      newTasks: newTasksCreated,
      agentActions: agentActions,
      skippedAgents: skippedAgents,
      ranTier4: ranTier4,
      escalationLog: escalationLog.length > 0 ? escalationLog : undefined,
      timestamp: new Date().toISOString()
    });
    if (cronLog.length > 50) cronLog.splice(0, cronLog.length - 50);
    await storage.setState('cronLog', cronLog);

    const skipSummary = skippedAgents.length > 0
      ? ', skipped: ' + skippedAgents.map(function (s) { return s.agentId; }).join(', ')
      : '';

    await logEvent('heartbeat', null,
      'Heartbeat cycle complete: ' + geminiCalls + ' API calls, ' + newTasksCreated + ' new tasks' + skipSummary,
      cycleId
    );

    await logEvent('run-end', null, 'Heartbeat run end', runId, {
      runId: runId,
      mode: normalizedActivationMode,
      totals: _runCounters.totals,
      byAgent: _runCounters.byAgent
    });

    const _agentsDigest = Object.keys(_runCounters.byAgent).map(function (aid) {
      return {
        agentId: aid,
        blocked: _runCounters.byAgent[aid].blocked || 0,
        proposals: _runCounters.byAgent[aid].proposals || 0
      };
    });
    const topBlockedAgents = _agentsDigest
      .filter(function (a) { return a.blocked > 0; })
      .sort(function (a, b) { return b.blocked - a.blocked; })
      .slice(0, 3)
      .map(function (a) { return { agentId: a.agentId, blocked: a.blocked }; });
    const topProposalAgents = _agentsDigest
      .filter(function (a) { return a.proposals > 0; })
      .sort(function (a, b) { return b.proposals - a.proposals; })
      .slice(0, 3)
      .map(function (a) { return { agentId: a.agentId, proposals: a.proposals }; });

    const _runDigestDetails = {
      runId: runId,
      mode: normalizedActivationMode,
      totals: _runCounters.totals,
      topBlockedAgents: topBlockedAgents,
      topProposalAgents: topProposalAgents
    };
    if (_objectiveStatusBlockDetails.length > 0) {
      _runDigestDetails.objectiveStatusBlocks = _objectiveStatusBlockDetails;
    }
    if (_projectStatusBlockDetails.length > 0) {
      _runDigestDetails.projectStatusBlocks = _projectStatusBlockDetails;
    }
    await logEvent('run-digest', null, 'Heartbeat run digest', runId, _runDigestDetails);

    const blockedTotal = _runCounters.totals.blocked || 0;
    const proposalsTotal = _runCounters.totals.proposals || 0;
    const reasons = [];
    if (blockedTotal > 10) reasons.push('blocked_total_gt_10');
    if ((_runGateCounts.output_envelope || 0) > 0) reasons.push('output_envelope_violations');
    if ((_runGateCounts.proposal_schema || 0) > 0) reasons.push('proposal_schema_violations');
    if ((_runGateCounts.objective_status || 0) > 3) reasons.push('objective_status_gt_3');
    if (_objectiveStatusBlockDetails.length > 0) reasons.push('objective_canceled_blocked');
    if (_projectStatusBlockDetails.length > 0) reasons.push('project_paused_blocked');
    const status = reasons.length === 0 ? 'ok' : 'warn';

    await logEvent('run-health', null, 'Heartbeat run health: ' + status, runId, {
      runId: runId,
      mode: normalizedActivationMode,
      status: status,
      reasons: reasons,
      stats: {
        blockedTotal: blockedTotal,
        proposalsTotal: proposalsTotal,
        gateCounts: _runGateCounts
      }
    });

    // ── Persist compact heartbeat run summary (for dashboard health panel) ──
    const finishedAt = new Date().toISOString();
    const startedAtMs = new Date(cycleStart).getTime();
    const finishedAtMs = new Date(finishedAt).getTime();
    const durationMs = (isNaN(startedAtMs) || isNaN(finishedAtMs)) ? 0 : Math.max(0, finishedAtMs - startedAtMs);

    const createdTaskIds = Array.from(_taskIdsAtPersist).filter(function (tid) { return !_taskIdsAtLoad.has(tid); });
    const createdTaskIdSet = new Set(createdTaskIds);

    const createdCampaignIdSet = new Set(campaignGovEvents
      .filter(function (evt) { return evt && evt.type === 'campaign-created' && evt.data && evt.data.campaignId; })
      .map(function (evt) { return evt.data.campaignId; }));

    const updatedDirectiveCount = 0; // directives merged into campaigns — kept for summary compat
    const updatedCampaignCount = Array.from(_campaignsTouched).filter(function (id) { return !createdCampaignIdSet.has(id); }).length;
    const updatedTaskCount = Array.from(_tasksTouched).filter(function (id) { return !createdTaskIdSet.has(id); }).length;

    const docsAtPersist = (await storage.getState('documents')) || [];
    const createdDocsCount = docsAtPersist.filter(function (d) { return d && d.id && !_documentIdsAtLoad.has(d.id); }).length;

    const activeTasksNow = tasks.filter(function (t) {
      var st = String((t && t.status) || '').toLowerCase();
      return st !== 'done' && st !== 'archived';
    });
    const overdueTasks = activeTasksNow.filter(function (t) {
      if (!t || !t.dueDate) return false;
      var due = new Date(t.dueDate).getTime();
      return !isNaN(due) && due < Date.now();
    }).length;
    const blockedTasks = activeTasksNow.filter(function (t) { return String((t && t.status) || '').toLowerCase() === 'blocked'; }).length;
    const oldestActiveTaskAgeHours = activeTasksNow.reduce(function (maxHrs, t) {
      var created = new Date((t && t.createdAt) || 0).getTime();
      if (isNaN(created) || created <= 0) return maxHrs;
      var ageHrs = (Date.now() - created) / 3600000;
      return ageHrs > maxHrs ? ageHrs : maxHrs;
    }, 0);

    const perAgent = {};
    Object.keys(_agentRunStats).forEach(function (aid) {
      var rs = _agentRunStats[aid] || {};
      var rc = (_runCounters.byAgent && _runCounters.byAgent[aid]) || {};
      perAgent[aid] = {
        actionsAttempted: rs.attempted || 0,
        actionsExecuted: rs.executed || 0,
        actionsBlocked: (rc.blocked || 0) + (rs.guardrailBlocked || 0),
        newTasksCreated: rc.creates || 0,
        avgLatencyMs: rs.avgLatencyMs || 0,
        error: rs.error || null
      };
    });

    const guardrailTotal = (_guardrailCounts.orphanBlocked || 0)
      + (_guardrailCounts.exactDupBlocked || 0)
      + (_guardrailCounts.fuzzyDupBlocked || 0)
      + (_guardrailCounts.taskCeilingBlocked || 0)
      + (_guardrailCounts.socialPromoGateBlocked || 0)
      + (_guardrailCounts.pausedCampaignAutomationBlocked || 0);

    const heartbeatSummary = {
      runId: runId,
      startedAt: cycleStart,
      finishedAt: finishedAt,
      durationMs: durationMs,
      mode: normalizedActivationMode,
      executionMode: executionMode,
      status: status,
      errorSummary: null,
      created: {
        goals: 0,
        campaigns: createdCampaignIdSet.size,
        campaignsAutoCreated: createdCampaignAutoCount,
        tasks: createdTaskIds.length,
        docs: createdDocsCount
      },
      updated: {
        tasks: updatedTaskCount,
        directives: updatedDirectiveCount,
        campaigns: updatedCampaignCount
      },
      autoFixes: autoFixCount,
      agentActions: {
        proposed: proposalsTotal,
        executed: Object.keys(agentActions).reduce(function (sum, aid) { return sum + (agentActions[aid] || 0); }, 0),
        blocked: blockedTotal + guardrailTotal,
        escalated: _pendingEscalations.length
      },
      guardrails: {
        orphanBlocked: _guardrailCounts.orphanBlocked || 0,
        exactDupBlocked: _guardrailCounts.exactDupBlocked || 0,
        fuzzyDupBlocked: _guardrailCounts.fuzzyDupBlocked || 0,
        taskCeilingBlocked: _guardrailCounts.taskCeilingBlocked || 0,
        socialPromoGateBlocked: _guardrailCounts.socialPromoGateBlocked || 0,
        ceoApprovalsTriggered: _guardrailCounts.ceoApprovalsTriggered || 0,
        pausedCampaignAutomationBlocked: _guardrailCounts.pausedCampaignAutomationBlocked || 0
      },
      backlogPressure: {
        activeTasks: activeTasksNow.length,
        activeTasksCap: GUARDRAILS.maxActiveTasks,
        newTasksThisCycle: newTasksCreated,
        newTasksCap: GUARDRAILS.maxNewTasksPerCycle,
        overdueTasks: overdueTasks,
        blockedTasks: blockedTasks,
        oldestActiveTaskAgeHours: Math.round(oldestActiveTaskAgeHours)
      },
      perAgent: perAgent,
      skippedAgents: skippedAgents
    };

    const heartbeatRuns = (await storage.getState('heartbeatRuns')) || [];
    heartbeatRuns.push(heartbeatSummary);
    if (heartbeatRuns.length > 100) heartbeatRuns.splice(0, heartbeatRuns.length - 100);
    await storage.setState('heartbeatRuns', heartbeatRuns);
    await logEvent('heartbeat-summary', null, 'Heartbeat summary persisted', runId, {
      runId: runId,
      status: status,
      durationMs: durationMs,
      newTasks: newTasksCreated
    });

    context.log('[Heartbeat] Cycle complete:', cycleId, '| Gemini calls:', geminiCalls, '| New tasks:', newTasksCreated, '| Skipped:', skippedAgents.length, '| Tier4 ran:', ranTier4.join(', ') || 'none');
    return { skipped: false, runId: runId };

  } catch (err) {
    context.log.error('[Heartbeat] Fatal error:', err.message);
    await logEvent('error', null, 'Heartbeat fatal: ' + err.message, cycleId);
    try {
      const finishedAt = new Date().toISOString();
      const startedAtMs = new Date(cycleStart).getTime();
      const finishedAtMs = new Date(finishedAt).getTime();
      const durationMs = (isNaN(startedAtMs) || isNaN(finishedAtMs)) ? 0 : Math.max(0, finishedAtMs - startedAtMs);
      const heartbeatRuns = (await storage.getState('heartbeatRuns')) || [];
      heartbeatRuns.push({
        runId: runId,
        startedAt: cycleStart,
        finishedAt: finishedAt,
        durationMs: durationMs,
        mode: 'unknown',
        executionMode: 'unknown',
        status: 'error',
        errorSummary: String(err && err.message ? err.message : err),
        created: { goals: 0, campaigns: 0, campaignsAutoCreated: 0, tasks: 0, docs: 0 },
        updated: { tasks: 0, directives: 0, campaigns: 0 },
        autoFixes: 0,
        agentActions: { proposed: 0, executed: 0, blocked: 0, escalated: 0 },
        guardrails: {
          orphanBlocked: 0,
          exactDupBlocked: 0,
          fuzzyDupBlocked: 0,
          taskCeilingBlocked: 0,
          socialPromoGateBlocked: 0,
          ceoApprovalsTriggered: 0,
          pausedCampaignAutomationBlocked: 0
        },
        backlogPressure: {
          activeTasks: 0,
          activeTasksCap: GUARDRAILS.maxActiveTasks,
          newTasksThisCycle: 0,
          newTasksCap: GUARDRAILS.maxNewTasksPerCycle,
          overdueTasks: 0,
          blockedTasks: 0,
          oldestActiveTaskAgeHours: 0
        },
        perAgent: {},
        skippedAgents: []
      });
      if (heartbeatRuns.length > 100) heartbeatRuns.splice(0, heartbeatRuns.length - 100);
      await storage.setState('heartbeatRuns', heartbeatRuns);
    } catch (_persistErr) {
      context.log.warn('[Heartbeat] Failed to persist fatal heartbeat summary:', _persistErr.message || _persistErr);
    }
  } finally {
    // ── Release concurrency lock ──
    try {
      await storage.setState('heartbeatLock', {
        locked: false,
        runId: runId,
        releasedAt: new Date().toISOString(),
        trigger: trigger
      });
      context.log('[Heartbeat] Lock released:', runId);
    } catch (_lockReleaseErr) {
      context.log.warn('[Heartbeat] Failed to release lock:', _lockReleaseErr.message || _lockReleaseErr);
    }
  }
};


// (runAgentHeartbeat now in agent-runner.js)
// (buildSiteContextBlock, buildHeartbeatPrompt now in prompt-builders.js)
// (applyTaskUpdate now in task-mutations.js)
// (_buildExecContextBlock, executeTask, buildExecutePrompt, reviewTask, buildReviewPrompt now in execution-engine.js)
// (callGemini, callGeminiExecute now in gemini.js)
// (_createActionFromHeartbeat, logEvent now in helpers.js)
