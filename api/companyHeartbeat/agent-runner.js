// agent-runner.js — extracted from companyHeartbeat/index.js (Phase 4 refactor)
// Per-agent heartbeat processing: prompt build, Gemini call, action handling, guardrails

const storage = require('../_utils/companyStorage');
const webSearch = require('../toolsWebSearch/index');
const imageEngine = require('../_lib/contentEngine/imageEngine');
const crypto = require('crypto');
const { ensureCampaign } = require('../_shared/campaignMatcher');

// Phase 1 modules
const { callGemini } = require('./gemini');
const {
  AGENT_ROLES, GUARDRAILS, DOMAIN_LEAD_MAP,
  MAX_TOOL_CALLS_PER_AGENT, MAX_MEMORIES_PER_AGENT,
  MAX_L4_WRITES_PER_AGENT_PER_DAY, L4_ALLOWED_TYPES, L4_PREFERRED_TYPES, L4_DEFAULT_TTL_DAYS,
  MAX_OBSERVATIONS_PER_AGENT, MAX_OBSERVATION_CHARS
} = require('./constants');
const {
  logEvent, stripTaskPrefixes, _createActionFromHeartbeat, generateConversationalEntityComment
} = require('./helpers');

// Phase 2 modules
const { normalizeAgentResult, _normalizeEnvelope, _normalizeProposal, _isValidProposal } = require('./normalization');

// Phase 3 modules
const { buildHeartbeatPrompt } = require('./prompt-builders');
const { executeTask, reviewTask } = require('./execution-engine');

async function runAgentHeartbeat(context, agentId, tasks, configs, recentSummaries, cycleId, novaSkipTaskIds, activeDirectives, activeObjectives, documents, workspaceMemory, workspaceDates, revisionActions, costIntel, reviewCooldownIds, seedMemories, researchIntelStore, socialIntel, normalizedActivationMode, isAgentInCooldown, logAgentCooldownOnce, incPolicyGate, campaignCtx, siteIntel, workerReports, _agentMemoryStore) {
  const _agentRunStartMs = Date.now();
  const result = {
    geminiCalls: 0,
    actions: 0,
    actionAttempts: 0,
    durationMs: 0,
    taskUpdates: [],
    proposals: [],
    newResearchIntel: null,
    guardrails: {
      orphanBlocked: 0,
      exactDupBlocked: 0,
      fuzzyDupBlocked: 0,
      taskCeilingBlocked: 0,
      socialPromoGateBlocked: 0
    }
  };
  const agent = AGENT_ROLES[agentId];
  if (!agent) return result;

  // Read dynamic doctrine weight from workspace config (slider value), clamp 0.0–0.6
  const agentCfg = configs[agentId] || {};
  let dw = parseFloat(agentCfg.doctrineWeight);
  if (isNaN(dw)) dw = 0.4;
  if (dw > 0.6) dw = 0.6;
  if (dw < 0) dw = 0;
  agent._doctrineWeight = Math.round(dw * 100) / 100;

  // Build execution context bundle for execute/review prompts (eliminates context loss)
  const execContext = {
    campaigns: activeDirectives || [],
    directives: activeDirectives || [], // backward compat alias
    objectives: activeObjectives || [],
    seedMemories: seedMemories || {},
    researchIntel: researchIntelStore || [],
    documents: documents || [],
    agentId: agentId
  };

  // Build context for the agent
  // Pixel: exclude 'review' tasks — once Pixel delivers an image the task awaits review, not further Pixel action
  // Other agents: keep 'review' visible (e.g. Scribe needs to submit-for-publish after hero image attached)
  const agentTasks = tasks.filter(t => t.assignee === agentId && t.status !== 'done'
    && !(agentId === 'pixel' && t.status === 'review'));
  // Nova sees backlog tasks so she can triage them; other agents only see active tasks
  const allActiveTasks = agentId === 'nova'
    ? tasks.filter(t => t.status !== 'done')
    : tasks.filter(t => t.status !== 'done' && t.status !== 'backlog');
  // Only show this agent their own revision-requested actions
  const agentRevisions = (revisionActions || []).filter(a => a.created_by === agentId || a.origin_agent === agentId);

  const prompt = buildHeartbeatPrompt(agent, agentTasks, allActiveTasks, activeDirectives, activeObjectives, documents, workspaceMemory, workspaceDates, agentRevisions, costIntel, reviewCooldownIds, seedMemories, researchIntelStore, socialIntel, workerReports, _agentMemoryStore);

  // Call Gemini
  const response = await callGemini(prompt, agentId);
  result.geminiCalls = 1;

  if (!response) {
    context.log('[Heartbeat]', agentId, 'got no response');
    result.durationMs = Date.now() - _agentRunStartMs;
    return result;
  }

  // Parse structured output
  let parsed = null;
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    // Retry with repair prompt if JSON parse fails
    context.log('[Heartbeat]', agentId, 'JSON parse failed, attempting repair');
    try {
      const repaired = await callGemini(
        'The following text was supposed to be valid JSON but has errors. Fix it and return ONLY the valid JSON, nothing else:\n\n' + response
      );
      result.geminiCalls++;
      if (repaired) {
        const jsonMatch = repaired.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (repairErr) {
      context.log.warn('[Heartbeat]', agentId, 'JSON repair also failed');
    }
  }

  // ── Phase 2B + 4A: Normalize output then defensively normalize envelope ──
  const normalizedResult = normalizeAgentResult(parsed);
  const normalized = await _normalizeEnvelope(
    (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      ? parsed
      : {
        taskUpdates: normalizedResult.actions,
        proposals: normalizedResult.proposals,
        remember: normalizedResult.remember,
        observations: normalizedResult.observations
      },
    { agentId: agentId, runId: cycleId, onPolicyViolationGate: incPolicyGate }
  );

  // Per-run cooldown (non-persistent): proposals/observations allowed, mutations + remember suppressed.
  if (typeof isAgentInCooldown === 'function' && isAgentInCooldown(agentId)) {
    normalized.taskUpdates = normalized.taskUpdates.filter(function (a) {
      const t = (a && a.type) || '';
      return t !== 'create-task' && t !== 'update-task' && t !== 'move-task';
    });
    normalized.remember = [];
    if (typeof logAgentCooldownOnce === 'function') {
      await logAgentCooldownOnce(agentId);
    }
  }

  // Log unknown action types as warnings
  for (var _oi = 0; _oi < normalized.observations.length; _oi++) {
    var _obsItem = typeof normalized.observations[_oi] === 'string'
      ? normalized.observations[_oi]
      : JSON.stringify(normalized.observations[_oi] || '');
    if (_obsItem && _obsItem.indexOf('[unknown-action-type]') === 0) {
      context.log('[Heartbeat]', agentId, 'WARN:', _obsItem);
    }
  }

  // ── Tool-call interception: detect web_search tool calls and execute them ──
  let toolUsage = 0;
  const toolResults = [];
  const toolActions = normalized.taskUpdates.filter(a => a.tool === 'web_search' || a.type === 'web_search');
  const regularActions = normalized.taskUpdates.filter(a => a.tool !== 'web_search' && a.type !== 'web_search');

  // Scout recursion guard: skip search if task already has research_intel
  const scoutTargetTask = agentTasks.find(t => t.status === 'in-progress') || agentTasks[0];
  const hasExistingResearch = scoutTargetTask && scoutTargetTask.research_intel;
  if (agentId === 'scout' && hasExistingResearch && toolActions.length > 0) {
    context.log('[Heartbeat] scout RECURSION BLOCKED: research_intel already exists on task', scoutTargetTask.id);
    await logEvent('tool-recursion-blocked', agentId, 'research_intel already attached to ' + scoutTargetTask.id, cycleId);
    toolActions.length = 0; // clear all tool calls
  }

  for (const toolCall of toolActions) {
    if (toolUsage >= MAX_TOOL_CALLS_PER_AGENT) {
      context.log('[Heartbeat]', agentId, 'RATE LIMITED: web_search call #' + (toolUsage + 1) + ' blocked (max ' + MAX_TOOL_CALLS_PER_AGENT + ')');
      await logEvent('tool-rate-limited', agentId, 'web_search rate limited: ' + ((toolCall.args && toolCall.args.q) || 'no query'), cycleId);
      toolResults.push({ query: (toolCall.args && toolCall.args.q) || '', ok: false, error: 'rate_limited', results: [] });
      continue;
    }
    const q = (toolCall.args && toolCall.args.q) || '';
    const n = (toolCall.args && toolCall.args.n) || 5;
    if (!q) continue;

    context.log('[Heartbeat]', agentId, 'executing web_search:', q);
    const searchResult = await webSearch.searchInternal(q, n, agentId, context);
    toolResults.push(searchResult);
    toolUsage++;
  }

  // If tool calls produced results, do a follow-up Gemini call so the agent can synthesize
  if (toolResults.length > 0 && toolResults.some(r => r.ok && r.results.length > 0)) {
    const toolContext = toolResults.map(function (r, i) {
      if (!r.ok) return 'Search #' + (i + 1) + ' (' + r.query + '): ' + (r.error || 'failed');
      return 'Search #' + (i + 1) + ' (' + r.query + '):\n' + r.results.map(function (hit) {
        return '  - [' + hit.rank + '] ' + hit.title + '\n    URL: ' + hit.url + '\n    ' + (hit.snippet || '').substring(0, 200);
      }).join('\n');
    }).join('\n\n');

    const synthesisPrompt = `You are ${agent.name}, ${agent.role} at AmbientPixels.

You requested web searches and here are the results:

${toolContext}

Based on these results, produce TWO outputs:

1. DELIVERABLE: A full markdown research brief with findings and a "## Sources" section listing ONLY URLs from the search results above. Do NOT cite URLs not returned by the tool.

2. STRUCTURED INTEL: After the deliverable, on a new line, output EXACTLY this JSON block (no extra text around it):
<!--RESEARCH_INTEL_JSON
{"title":"brief title","summary":"max 600 char summary","key_findings":["finding 1","finding 2"],"sources":["url1","url2"],"impact_tags":["marketing|pricing|ux|infra|finance|strategy"]}
RESEARCH_INTEL_JSON-->

Rules for the structured intel:
- summary: max 600 characters
- key_findings: max 5 items, each max 200 characters
- sources: max 3 URLs (only from search results)
- impact_tags: pick from: marketing, pricing, ux, infra, finance, strategy

Write the full deliverable first, then the structured JSON block.`;

    const synthesisResponse = await callGemini(synthesisPrompt);
    result.geminiCalls++;

    if (synthesisResponse) {
      // Extract structured research_intel from synthesis response
      let researchIntel = null;
      let deliverableText = synthesisResponse;
      const intelMatch = synthesisResponse.match(/<!--RESEARCH_INTEL_JSON\s*([\s\S]*?)\s*RESEARCH_INTEL_JSON-->/);
      if (intelMatch) {
        deliverableText = synthesisResponse.replace(/<!--RESEARCH_INTEL_JSON[\s\S]*?RESEARCH_INTEL_JSON-->/, '').trim();
        try {
          const raw = JSON.parse(intelMatch[1].trim());
          const _riId = 'ri_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
          researchIntel = {
            id: _riId,
            title: String(raw.title || '').substring(0, 120),
            summary: String(raw.summary || '').substring(0, 600),
            key_findings: (raw.key_findings || []).slice(0, 5).map(f => String(f).substring(0, 200)),
            sources: (raw.sources || []).slice(0, 3).map(s => String(s)),
            impact_tags: (raw.impact_tags || []).filter(t => ['marketing','pricing','ux','infra','finance','strategy'].indexOf(t) !== -1),
            timestamp: new Date().toISOString(),
            created_by: agentId
          };
          // Persist to research intel store so all agents see it even after task completion
          result.newResearchIntel = researchIntel;
          context.log('[Heartbeat]', agentId, 'research_intel extracted:', researchIntel.title);
        } catch (e) {
          context.log('[Heartbeat]', agentId, 'research_intel JSON parse failed:', e.message);
        }
      }

      // Attach deliverable + research_intel to target task
      const targetTask = agentTasks.find(t => t.status === 'in-progress') || agentTasks[0];
      if (targetTask) {
        result.taskUpdates.push({
          action: 'comment',
          taskId: targetTask.id,
          comment: {
            type: 'deliverable',
            author: agentId,
            text: deliverableText,
            sources: toolResults.filter(r => r.ok).reduce(function (urls, r) {
              return urls.concat(r.results.map(function (h) { return h.url; }));
            }, []),
            timestamp: new Date().toISOString()
          }
        });
        // Store structured research_intel on task metadata
        if (researchIntel) {
          result.taskUpdates.push({
            action: 'set-research-intel',
            taskId: targetTask.id,
            research_intel: researchIntel
          });
        }
        context.log('[Heartbeat]', agentId, 'web research deliverable attached to task:', targetTask.id, researchIntel ? '(with structured intel)' : '(no structured intel)');
      }
    }
  }

  // Process structured actions (non-tool actions)
  const actions = regularActions;
  result.actionAttempts = Array.isArray(actions) ? actions.length : 0;
  let actionCount = 0;

  // SERVER-SIDE FORCED HERO IMAGE: If Pixel has a hero image task idle 10+ min and didn't produce generate-image, inject it
  if (agentId === 'pixel') {
    const _pixelHeroTask = agentTasks.find(t =>
      (t.status === 'todo' || t.status === 'in-progress') &&
      (t.title || '').indexOf('Generate hero image for:') === 0 &&
      t.createdAt
    );
    if (_pixelHeroTask) {
      const _pHeroAge = Date.now() - new Date(_pixelHeroTask.createdAt).getTime();
      const _hasGenerateImage = actions.some(a => a.type === 'generate-image');
      if (!_hasGenerateImage) {
        const _pDocMatch = (_pixelHeroTask.description || '').match(/Document ID:\s*(doc_[a-z0-9_]+)/i);
        const _pDocId = _pDocMatch ? _pDocMatch[1] : null;
        const _pTitle = (_pixelHeroTask.title || '').replace('Generate hero image for: ', '');
        context.log('[Heartbeat] PIXEL FORCED HERO IMAGE: task', _pixelHeroTask.id, 'idle', Math.round(_pHeroAge / 60000), 'min — injecting generate-image action');
        actions.unshift({
          type: 'generate-image',
          taskId: _pixelHeroTask.id,
          summary: 'System-forced hero image generation for: ' + _pTitle,
          image: {
            purpose: 'blog_header',
            topic: _pTitle,
            goal: 'Hero image for: ' + _pTitle,
            preset: 'ap-neon-glass',
            attachTo: _pDocId ? { type: 'document', id: _pDocId } : undefined
          }
        });
      }
    }
  }

  // ANTI-STALL: if agent has triaged idle tasks but produced no execute/create-doc/create-social-action, inject forced execute
  // v2: Skip convergence-blocked tasks (3+ deliverables) — try a different task or review-task instead
  if (agentId !== 'nova') {
    const _hasWorkAction = actions.some(a =>
      a.type === 'execute-task' || a.type === 'create-doc' || a.type === 'create-social-action' || a.type === 'review-task'
    );
    if (!_hasWorkAction) {
      const _prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const _triagedIdle = agentTasks
        .filter(t =>
          (t.status === 'todo' || t.status === 'in-progress') &&
          t.comments && t.comments.some(c => c.author === 'nova' || c.author === 'system')
        )
        .sort((a, b) => (_prioOrder[a.priority] || 3) - (_prioOrder[b.priority] || 3));
      // Filter out convergence-blocked tasks (3+ deliverables — would just get blocked again)
      let _executableIdle = _triagedIdle.filter(t => {
        const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
        return _delCount < 3;
      });
      // Fix 8: For Echo, filter out tasks that already have pending social actions (avoids dedup loop)
      if (agentId === 'echo' && _executableIdle.length > 0) {
        try {
          const _existingActions = (await storage.getState('actions')) || [];
          const _pendingSocialTaskIds = new Set();
          for (let _eai = 0; _eai < _existingActions.length; _eai++) {
            const _ea = _existingActions[_eai];
            if (!_ea || !_ea.type || _ea.type.indexOf('social_post') !== 0) continue;
            const _eaStatus = (_ea.approval && _ea.approval.status) || '';
            if (_eaStatus === 'rejected' || _eaStatus === 'cancelled') continue;
            const _eaExecStatus = (_ea.execution && _ea.execution.status) || '';
            if (_eaExecStatus === 'success') continue;
            if (_ea._parentTaskId) _pendingSocialTaskIds.add(_ea._parentTaskId);
          }
          if (_pendingSocialTaskIds.size > 0) {
            const _beforeCount = _executableIdle.length;
            _executableIdle = _executableIdle.filter(t => !_pendingSocialTaskIds.has(t.id));
            if (_executableIdle.length < _beforeCount) {
              context.log('[Heartbeat] ANTI-STALL: echo filtered out', (_beforeCount - _executableIdle.length),
                'task(s) with pending social actions — remaining:', _executableIdle.length);
            }
          }
        } catch (_pendErr) {
          context.log('[Heartbeat] ANTI-STALL: echo pending social filter error (non-fatal):', String(_pendErr).substring(0, 200));
        }
      }
      if (_executableIdle.length > 0) {
        // For Echo social tasks: batch ALL social promo tasks in one cycle (they're created together)
        if (agentId === 'echo') {
          const _socialIdle = _executableIdle.filter(function (t) {
            var txt = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
            return /^social_/.test(t.taskType || '') || /linkedin|twitter|x\.com|social media|social post|bluesky|tweet/.test(txt);
          });
          if (_socialIdle.length > 0) {
            // Fetch blog post content to build proper social copy
            var _blogContent = null;
            var _blogTitle = null;
            try {
              var _firstDesc = _socialIdle[0].description || '';
              var _docIdMatch = _firstDesc.match(/Document ID:\s*(doc_[a-z0-9_]+)/i);
              if (_docIdMatch) {
                var _allDocs = (await storage.getState('documents')) || [];
                var _srcDoc = _allDocs.find(function (d) { return d.id === _docIdMatch[1]; });
                if (_srcDoc) {
                  _blogTitle = _srcDoc.title || '';
                  // Strip markdown formatting to get clean text for social
                  _blogContent = (_srcDoc.content_md || '')
                    .replace(/^#[^\n]*/m, '')           // remove H1 heading
                    .replace(/#{1,6}\s+/g, '')           // remove other headings
                    .replace(/\*\*([^*]+)\*\*/g, '$1')   // **bold** → bold
                    .replace(/\*([^*]+)\*/g, '$1')        // *italic* → italic
                    .replace(/^\s*[-*]\s+/gm, '')         // bullet points
                    .replace(/\n{2,}/g, '\n').trim();
                }
              }
            } catch (_bcErr) {
              context.log('[Heartbeat] ANTI-STALL: blog content fetch error (non-fatal):', String(_bcErr).substring(0, 200));
            }

            for (var _si = 0; _si < _socialIdle.length; _si++) {
              var _sTask = _socialIdle[_si];
              var _sText = ((_sTask.title || '') + ' ' + (_sTask.description || '')).toLowerCase();
              var _sPlatform = (_sTask.taskType === 'social_linkedin' || /linkedin/.test(_sText)) ? 'linkedin'
                : (_sTask.taskType === 'social_x' || /twitter|x\.com|tweet/.test(_sText)) ? 'x'
                : (_sTask.taskType === 'social_bluesky' || /bluesky/.test(_sText)) ? 'bluesky'
                : 'linkedin';
              var _sUrlMatch = (_sTask.description || '').match(/https?:\/\/ambientpixels\.ai\/blog\/[a-z0-9-]+/i);
              var _sBlogUrl = _sUrlMatch ? _sUrlMatch[0] : 'https://ambientpixels.ai';
              var _sArticleTitle = _blogTitle || (_sTask.title || '').replace(/^Promote blog post on [^:]+:\s*/i, '');

              // Build platform-appropriate social copy from blog content
              var _sPostText = '';
              var _sExcerpt = _blogContent ? _blogContent.substring(0, 300).replace(/\n/g, ' ').trim() : '';
              if (_sPlatform === 'x') {
                // X: 280 char limit — title + short excerpt + URL
                var _xBody = _sArticleTitle;
                if (_sExcerpt) _xBody += ' — ' + _sExcerpt.substring(0, 180 - _sArticleTitle.length);
                _sPostText = _xBody.substring(0, 250).trim() + '\n\n' + _sBlogUrl;
              } else if (_sPlatform === 'bluesky') {
                // Bluesky: 300 char limit
                var _bBody = _sArticleTitle;
                if (_sExcerpt) _bBody += '\n\n' + _sExcerpt.substring(0, 200 - _sArticleTitle.length);
                _sPostText = _bBody.substring(0, 270).trim() + '\n\n' + _sBlogUrl;
              } else {
                // LinkedIn: longer form (aim 400-800 chars)
                _sPostText = _sArticleTitle + '\n\n';
                if (_sExcerpt) _sPostText += _sExcerpt.substring(0, 500) + '\n\n';
                _sPostText += 'Read more: ' + _sBlogUrl;
              }

              context.log('[Heartbeat] ANTI-STALL:', agentId, 'batch social (' + (_si + 1) + '/' + _socialIdle.length + ') — injecting create-social-action for:', _sTask.id, 'platform:', _sPlatform, 'text length:', _sPostText.length);
              actions.push({
                type: 'create-social-action',
                taskId: _sTask.id,
                social: { platform: _sPlatform, text: _sPostText },
                summary: 'Anti-stall social action: ' + (_sTask.title || _sTask.id)
              });
            }
          }
          // If there are also non-social idle tasks, inject execute-task for the first one
          var _nonSocialIdle = _executableIdle.filter(function (t) {
            return !/^social_/.test(t.taskType || '');
          });
          if (_socialIdle.length === 0 && _nonSocialIdle.length > 0) {
            var _nsTask = _nonSocialIdle[0];
            context.log('[Heartbeat] ANTI-STALL:', agentId, 'has', _triagedIdle.length,
              'triaged idle task(s) — injecting execute-task for:', _nsTask.id, '"' + (_nsTask.title || '') + '"');
            actions.unshift({
              type: 'execute-task',
              taskId: _nsTask.id,
              summary: 'Anti-stall forced execution: ' + (_nsTask.title || _nsTask.id)
            });
          }
        } else {
          var _stallTask = _executableIdle[0];
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'has', _triagedIdle.length,
            'triaged idle task(s) (' + (_triagedIdle.length - _executableIdle.length) + ' convergence-blocked) — injecting execute-task for:', _stallTask.id, '"' + (_stallTask.title || '') + '"');
          actions.unshift({
            type: 'execute-task',
            taskId: _stallTask.id,
            summary: 'Anti-stall forced execution: ' + (_stallTask.title || _stallTask.id)
          });
        }
      } else if (_triagedIdle.length > 0) {
        // ALL idle tasks are convergence-blocked — try review-task on another agent's task instead
        const _reviewCandidates = allActiveTasks.filter(t =>
          t.status === 'review' && t.assignee !== agentId &&
          t.comments && t.comments.length > 0
        );
        if (_reviewCandidates.length > 0) {
          const _reviewTarget = _reviewCandidates[0];
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'all', _triagedIdle.length,
            'idle tasks convergence-blocked — injecting review-task for:', _reviewTarget.id, '"' + (_reviewTarget.title || '') + '"');
          actions.unshift({
            type: 'review-task',
            taskId: _reviewTarget.id,
            summary: 'Anti-stall review (all own tasks convergence-blocked): ' + (_reviewTarget.title || _reviewTarget.id)
          });
        } else {
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'all', _triagedIdle.length,
            'idle tasks convergence-blocked and no reviewable tasks from other agents — agent fully stalled');
        }
      }
    }
  }

  // Track visual docs created this cycle — blocks same-cycle submit-for-publish
  const _visualDocsCreatedThisCycle = new Set();
  const _VISUAL_DOC_KINDS = ['marketing_post', 'product_brief'];

  // Tier 4 sub-agent action restrictions (server-side enforcement)
  const TIER4_FORBIDDEN = ['create-social-action', 'create-doc', 'submit-for-publish', 'create-task', 'create-content-package'];
  const isTier4 = agent.tier === 4;

  // Work-producing actions bypass dedup entirely — deliverables are always unique
  const _DEDUP_EXEMPT = new Set(['execute-task', 'create-doc', 'create-social-action', 'generate-image', 'create-content-package', 'review-task']);

  for (const action of actions) {
    if (actionCount >= GUARDRAILS.maxActionsPerCyclePerAgent) break;

    // Block forbidden actions for Tier 4 sub-agents
    if (isTier4 && TIER4_FORBIDDEN.indexOf(action.type) !== -1) {
      context.log('[Heartbeat]', agentId, 'BLOCKED forbidden action:', action.type, '(Tier 4 restriction)');
      continue;
    }

    // Only Echo can create social posts (server-side enforcement)
    if (action.type === 'create-social-action' && agentId !== 'echo') {
      context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action (only Echo can post)');
      continue;
    }

    // ── TASK TYPE PIPELINE GUARD ──
    // Validate action type matches the task's taskType to prevent pipeline mismatches
    if (action.taskId) {
      const _ttTask = tasks.find(t => t.id === action.taskId);
      const _ttType = _ttTask ? (_ttTask.taskType || 'general') : 'general';
      const _ttSocial = ['social_x', 'social_linkedin', 'social_bluesky'];
      const _ttBlog = ['blog_post', 'article', 'newsletter'];
      const _ttDoc = ['blog_post', 'article', 'newsletter', 'internal_doc'];
      const _ttContent = ['design_asset'];

      // Block: social action on a non-social task
      if (action.type === 'create-social-action' && _ttType !== 'general' && _ttSocial.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— taskType is', _ttType, '(expected social_x/social_linkedin/social_bluesky)');
        continue;
      }
      // Block: content package on a non-content task
      if (action.type === 'create-content-package' && _ttType !== 'general' && _ttContent.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-content-package on', action.taskId, '— taskType is', _ttType, '(expected design_asset)');
        continue;
      }
      // Warn: create-doc on task that doesn't require docs (soft — log only)
      if (action.type === 'create-doc' && _ttType !== 'general' && _ttDoc.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'WARNING: create-doc on', action.taskId, '— taskType is', _ttType, '(docs usually for blog_post/article/newsletter/internal_doc)');
      }
      // Warn: submit-for-publish on task that doesn't require docs
      if (action.type === 'submit-for-publish' && _ttType !== 'general' && _ttDoc.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'WARNING: submit-for-publish on', action.taskId, '— taskType is', _ttType, '(publish usually for blog_post/article/newsletter/internal_doc)');
      }
      // Log: track all taskType + action combinations for monitoring
      if (_ttType !== 'general') {
        context.log('[Heartbeat] PIPELINE:', agentId, action.type, 'on taskType:', _ttType, 'task:', action.taskId);
      }
    }

    // Nova escalation guard: skip actions on tasks handled by domain lead
    if (novaSkipTaskIds && action.taskId && novaSkipTaskIds.has(action.taskId)) {
      const skipTarget = tasks.find(t => t.id === action.taskId);
      const dlead = skipTarget ? (skipTarget.domainLead || DOMAIN_LEAD_MAP[(skipTarget.assignee || '').toLowerCase()] || '?') : '?';
      context.log('[Heartbeat] Nova SKIPPED action on', action.taskId,
        '— handled by domain lead (' + dlead + '), not High/Blocked/Overdue');
      continue;
    }

    const _isDedupeExempt = _DEDUP_EXEMPT.has(action.type);
    const summary = agent.name + ': ' + (action.summary || action.type || 'action') + (action.taskId ? ' [' + action.taskId + ']' : '');

    // Dedupe (skipped for work-producing actions)
    if (!_isDedupeExempt && recentSummaries.has(summary)) {
      context.log('[Heartbeat]', agentId, 'skipping duplicate:', summary);
      continue;
    }

    if (action.type === 'create-task' && action.task) {
      // SERVER-SIDE GUARD: active task ceiling — prevent unbounded task growth
      const _activeTaskCount = tasks.filter(t => t.status !== 'done' && t.status !== 'archived').length;
      if (_activeTaskCount >= GUARDRAILS.maxActiveTasks) {
        result.guardrails.taskCeilingBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED create-task: active task ceiling reached (' + _activeTaskCount + '/' + GUARDRAILS.maxActiveTasks + ')');
        continue;
      }

      // Inherit linking from parent campaign when provided
      var _taskCampaignId = action.task.campaign_id || action.task.directive_id || null;
      var _taskObjectiveId = action.task.objective_id || null;
      if (_taskCampaignId && campaignCtx && campaignCtx.campaignById && campaignCtx.campaignById[_taskCampaignId]) {
        var _parentCmp = campaignCtx.campaignById[_taskCampaignId];
        if (!_taskObjectiveId && _parentCmp.objective_id) _taskObjectiveId = _parentCmp.objective_id;
      }

      // SERVER-SIDE GUARD: agent-created tasks must link to a goal or campaign
      const _hasObjective = _taskObjectiveId || (action.task.source && action.task.source.type === 'ceo');
      const _hasCampaign = _taskCampaignId;
      if (!_hasObjective && !_hasCampaign) {
        result.guardrails.orphanBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED orphan task creation: "' + (action.task.title || '') + '" — must set objective_id or campaign_id');
        continue;
      }

      // SERVER-SIDE DEDUP: block if an active task with very similar title already exists
      const proposedTitle = (action.task.title || '').toLowerCase().trim();
      if (proposedTitle) {
        const _normalize = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        const normalizedNew = _normalize(proposedTitle);
        const existingMatch = tasks.find(t => t.status !== 'done' && _normalize(t.title || '') === normalizedNew);
        if (existingMatch) {
          result.guardrails.exactDupBlocked++;
          context.log('[Heartbeat]', agentId, 'BLOCKED duplicate task creation:', proposedTitle, '— matches existing:', existingMatch.id);
          continue;
        }
        // Also check fuzzy: if 80%+ of words match
        const newWords = normalizedNew.split(' ').filter(w => w.length > 2);
        if (newWords.length >= 3) {
          const fuzzyMatch = tasks.find(t => {
            if (t.status === 'done') return false;
            const existingWords = _normalize(t.title || '').split(' ').filter(w => w.length > 2);
            if (existingWords.length === 0) return false;
            const overlap = newWords.filter(w => existingWords.indexOf(w) !== -1).length;
            return overlap / Math.max(newWords.length, existingWords.length) >= 0.8;
          });
          if (fuzzyMatch) {
            result.guardrails.fuzzyDupBlocked++;
            context.log('[Heartbeat]', agentId, 'BLOCKED fuzzy-duplicate task:', proposedTitle, '— similar to:', fuzzyMatch.title, '(', fuzzyMatch.id, ')');
            continue;
          }
        }
      }
      // SERVER-SIDE GUARD: Block premature social promotion tasks for blog posts
      // Social tasks should ONLY be created after CEO publishes + promotes the blog post
      const _taskTitle = (action.task.title || '').toLowerCase();
      const _taskDesc = (action.task.description || '').toLowerCase();
      const _taskText = _taskTitle + ' ' + _taskDesc;
      const _isSocialPromoTask = /social\s*(media|post|promo|copy|campaign)|promote.*blog|blog.*promo/.test(_taskText);
      const _refsBlogPost = /blog\s*post|hello\s*world|marketing_post|first\s*post/.test(_taskText);
      if (_isSocialPromoTask && _refsBlogPost) {
        result.guardrails.socialPromoGateBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED premature social promo task:', action.task.title, '— blog must be published + promoted first. Social tasks are auto-created on publish with promote=true.');
        continue;
      }

      // Log raw Gemini output for debugging task creation issues
      context.log('[Heartbeat]', agentId, 'create-task RAW:', JSON.stringify({
        assignee: action.task.assignee,
        dueDate: action.task.dueDate,
        status: action.task.status,
        priority: action.task.priority
      }));

      // Resolve campaign via shared module if not already set
      if (!_taskCampaignId) {
        const _ctResult = await ensureCampaign({
          campaign_id: _taskCampaignId || null,
          title: action.task.title || '',
          description: action.task.description || '',
          goalId: _taskObjectiveId || null,
          division: action.task.division || null,
          provenance: 'Auto: Campaign ' + agentId,
          campaigns: (campaignCtx && campaignCtx.campaigns) ? campaignCtx.campaigns : [],
          entrypoint: 'heartbeat_create_task',
          debug: true,
          logger: context.log
        });
        _taskCampaignId = _ctResult.campaignId;
        if (_ctResult.created) {
          _ctResult.campaign.description = await generateConversationalEntityComment('campaign', {
            agentId: agentId,
            title: _ctResult.campaign.title || action.task.title || 'Campaign',
            goalId: _taskObjectiveId || null,
            seedText: action.task.description || '',
            fallbackText: 'I created this campaign to group related work and keep planning/execution aligned under one objective.'
          });
          _ctResult.campaign.updatedAt = new Date().toISOString();
          if (campaignCtx) campaignCtx.campaignsChanged = true;
          if (campaignCtx && Array.isArray(campaignCtx.campaignGovEvents)) campaignCtx.campaignGovEvents.push({
            id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
            type: 'campaign-created',
            data: { campaignId: _ctResult.campaignId, title: _ctResult.campaign.title, provenance: _ctResult.campaign.provenance || null, source: 'heartbeat_create_task' },
            timestamp: new Date().toISOString()
          });
        }
      }

      // Only Nova can set parent_task_id — strip from other agents to keep hierarchy clean
      var _parentTaskId = (agentId === 'nova' && action.task.parent_task_id) ? action.task.parent_task_id : null;
      if (action.task.parent_task_id && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED parent_task_id from create-task — only Nova can set task hierarchy');
      }
      // Pass through taskType if agent provides it; auto-infer from title if not set
      let _taskType = action.task.taskType || null;
      if (!_taskType) {
        const _ctTitle = ((action.task.title || '') + ' ' + (action.task.description || '')).toLowerCase();
        if (/write.*blog|draft.*blog|blog\s*post|create.*blog|publish.*blog|new.*blog|first\s*blog|write.*article|marketing.*brief|content.*brief|draft.*brief/.test(_ctTitle)) _taskType = 'blog_post';
        else if (/linkedin.*post|post.*linkedin|draft.*linkedin/.test(_ctTitle)) _taskType = 'social_linkedin';
        else if (/bluesky.*post|post.*bluesky/.test(_ctTitle)) _taskType = 'social_bluesky';
        else if (/social.*post|post.*to.*x\b|tweet/.test(_ctTitle)) _taskType = 'social_x';
        else if (/hero\s*image|generate.*image.*blog|blog.*header/.test(_ctTitle)) _taskType = 'design_asset';
        else if (/spec\b|runbook|release.*note|governance.*doc|internal.*doc/.test(_ctTitle)) _taskType = 'internal_doc';
        else if (/research|competitive.*intel|market.*analysis/.test(_ctTitle)) _taskType = 'research';
        else if (/deploy|infrastructure|ci.*cd|pipeline|devops|scaling|azure.*function/.test(_ctTitle)) _taskType = 'ops';
        else if (/cost.*audit|budget.*review|api.*cost|cost.*project|financial.*review|spend.*analysis|cost.*analysis|audit.*cost/.test(_ctTitle)) _taskType = 'financial';
      }
      result.taskUpdates.push({
        action: 'create',
        task: {
          title: action.task.title || 'Untitled',
          description: action.task.description || '',
          taskType: _taskType || 'general',
          status: action.task.status || 'todo',
          priority: action.task.priority || 'medium',
          assignee: action.task.assignee || agentId,
          division: action.task.division || null,
          dueDate: action.task.dueDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          objective_id: _taskObjectiveId || null,
          campaign_id: _taskCampaignId || null,
          category: action.task.category || null,
          parent_task_id: _parentTaskId
        }
      });
    } else if (action.type === 'update-task' && action.taskId) {
      // Strip parent_task_id from non-Nova agents
      var _updates = action.updates || {};
      if (_updates.parent_task_id && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED parent_task_id from update-task — only Nova can set task hierarchy');
        delete _updates.parent_task_id;
      }
      if (_updates.child_task_ids && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED child_task_ids from update-task — only Nova can set task hierarchy');
        delete _updates.child_task_ids;
      }
      result.taskUpdates.push({
        action: 'update',
        taskId: action.taskId,
        updates: _updates
      });
    } else if (action.type === 'move-task' && action.taskId && action.newStatus) {
      result.taskUpdates.push({
        action: 'move',
        taskId: action.taskId,
        newStatus: action.newStatus
      });
    } else if (action.type === 'execute-task' && action.taskId) {
      // SERVER-SIDE GUARD: block Echo from using execute-task on social post tasks
      // Echo must use create-social-action instead — execute-task bypasses the action governance layer
      if (agentId === 'echo') {
        const socialTask = tasks.find(t => t.id === action.taskId);
        if (socialTask) {
          const taskText = ((socialTask.title || '') + ' ' + (socialTask.description || '')).toLowerCase();
          if (/linkedin|twitter|x\.com|social media|social post|bluesky|tweet/.test(taskText)) {
            context.log('[Heartbeat] BLOCKED Echo execute-task on social post task:', action.taskId, '— must use create-social-action instead');
            continue;
          }
        }
      }
      // TRIAGE GATE: block execution on truly untouched tasks (zero comments = never triaged)
      // Exception: CEO-created tasks with assignee + dueDate are pre-triaged (CEO outranks Nova)
      if (agentId !== 'nova') {
        const targetTask = tasks.find(t => t.id === action.taskId);
        const hasAnyComment = targetTask && targetTask.comments && targetTask.comments.length > 0;
        const isCeoTriaged = targetTask && targetTask.source !== 'heartbeat' && targetTask.assignee && targetTask.dueDate;
        if (targetTask && !hasAnyComment && !isCeoTriaged) {
          context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task has zero comments (needs Nova triage first)');
          continue;
        }
      }
      // DELIVERABLE GUARD: block re-execution if task already has a deliverable or is in review/done
      {
        const _exTask = tasks.find(t => t.id === action.taskId);
        if (_exTask) {
          if (_exTask.status === 'review' || _exTask.status === 'done') {
            context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task already in', _exTask.status);
            continue;
          }
          // CONVERGENCE GUARD: if 3+ deliverables already exist, the task is looping — block and escalate
          const _deliverableCount = (_exTask.comments || []).filter(c => c.type === 'deliverable').length;
          if (_deliverableCount >= 3) {
            context.log('[Heartbeat]', agentId, 'CONVERGENCE BLOCKED execute-task on', action.taskId,
              '— task has', _deliverableCount, 'deliverables already (revision loop detected). Escalating to CEO.');
            // Only add the loop-detected comment once — don't spam every heartbeat cycle
            const _lastSysCmt = (_exTask.comments || []).slice().reverse().find(c => c.author === 'system' || c.agentId === 'system');
            const _alreadyLoopWarned = _lastSysCmt && _lastSysCmt.text && _lastSysCmt.text.indexOf('Revision loop detected') !== -1;
            if (!_alreadyLoopWarned) {
              result.taskUpdates.push({
                action: 'comment',
                taskId: action.taskId,
                comment: '[SYSTEM] Revision loop detected: ' + _deliverableCount + ' deliverables on this task without convergence. Task needs CEO review to break the cycle — either approve the latest draft, provide specific direction, or close the task.',
                agentId: 'system'
              });
            }
            // Move to review so CEO sees it
            if (_exTask.status !== 'review') {
              result.taskUpdates.push({
                action: 'move',
                taskId: action.taskId,
                newStatus: 'review'
              });
            }
            // Convergence recovery: if a ready document exists, auto-trigger submit-for-publish
            // rather than waiting for the agent to do it (they're blocked from executing)
            const _convDoc = documents.find(function(d) {
              if (!d || d.deletedAt || d.status === 'published' || d.status === 'rejected' || d.status === 'archived') return false;
              return (d.taskId === action.taskId) || (d.source && d.source.task_id === action.taskId);
            });
            if (_convDoc && _convDoc.hero_image_asset_id && !_convDoc.awaiting_hero_image) {
              context.log('[Heartbeat] CONVERGENCE RECOVERY: auto-submitting doc', _convDoc.id, 'for publish (task', action.taskId, 'is convergence-locked)');
              if (!_alreadyLoopWarned) {
                result.taskUpdates.push({
                  action: 'comment',
                  taskId: action.taskId,
                  comment: '[SYSTEM] Convergence recovery: document "' + (_convDoc.title || _convDoc.id) + '" is ready (hero image attached). Auto-submitting for publish so the CEO can approve.',
                  agentId: 'system'
                });
              }
              // Inject into the running actions array — submit-for-publish handler deduplicates on its own
              actions.push({ type: 'submit-for-publish', documentId: _convDoc.id, taskId: action.taskId, _systemInjected: true });
            }
            continue;
          }
          const _hasDeliverable = _deliverableCount > 0;
          if (_hasDeliverable && _exTask.status !== 'in-progress') {
            context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task already has a deliverable and is not in-progress (revision). Use review-task or comment-task instead.');
            continue;
          }
          if (_hasDeliverable && _exTask.status === 'in-progress') {
            context.log('[Heartbeat]', agentId, 'REVISION ALLOWED: re-executing task', action.taskId, '— has', _deliverableCount, 'prior deliverable(s), status is in-progress (changes-requested)');
          }
        }
      }
      // Execute: agent produces actual work on a task (costs 1 extra Gemini call)
      if (result.executes >= GUARDRAILS.maxExecutesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max executes reached — skipping execute-task, freeing action slot for other actions');
        continue;
      } else {
        const task = tasks.find(t => t.id === action.taskId);
        if (task) {
          const deliverable = await executeTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext);
          result.geminiCalls++;
          if (deliverable) {
            result.taskUpdates.push({
              action: 'execute',
              taskId: action.taskId,
              deliverable: deliverable,
              agentId: agentId
            });
            result.executes = (result.executes || 0) + 1;

            // SERVER-SIDE FALLBACK: Auto-create document for blog post tasks that used execute-task instead of create-doc
            // Three-layer detection: (1) taskType field, (2) title/desc regex fallback, (3) deliverable content signals
            const _etTaskText = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
            const _etDeliverableLower = (deliverable || '').toLowerCase();
            const _isBlogByType = (task.taskType === 'blog_post' || task.taskType === 'article');
            const _isBlogByTitle = /write.*blog|draft.*blog|blog\s*post|create.*blog|publish.*blog|new.*blog|first\s*blog|introductory\s*post|write.*article|compose.*article|marketing.*brief|content.*brief|draft.*brief/.test(_etTaskText);
            const _isBlogByContent = /document\s*type:\s*marketing_post|publishing\s*to\s*\/blog\/|submit.*ceo.*approv.*publish/.test(_etDeliverableLower);
            const _isBlogTask = agentId === 'scribe' && (_isBlogByType || _isBlogByTitle || _isBlogByContent);
            if (_isBlogTask) context.log('[Heartbeat] BLOG DETECTED:', agentId, 'task:', action.taskId, 'byType:', _isBlogByType, 'byTitle:', _isBlogByTitle, 'byContent:', _isBlogByContent);
            if (_isBlogTask && deliverable.length > 200) {
              const _etDocsStore = (await storage.getState('documents')) || [];
              const _etExistingDoc = _etDocsStore.find(d => {
                if (d.status === 'rejected' || d.status === 'archived') return false;
                // Check top-level taskId (set by execute-task fallback)
                if (d.taskId && d.taskId === action.taskId) return true;
                // Check source.task_id (set by create-doc handler)
                if (d.source && d.source.task_id && d.source.task_id === action.taskId) return true;
                // Exact title match (fallback)
                if (d.title && d.title === task.title) return true;
                return false;
              });
              if (_etExistingDoc) {
                context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback SKIPPED — doc already exists for task:', action.taskId, 'existing doc:', _etExistingDoc.id, _etExistingDoc.title);
              }
              if (!_etExistingDoc) {
                const _etDocId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                // Extract article title from first H1 heading in markdown (not task title)
                const _h1Match = (deliverable || '').match(/^#\s+(.+)$/m);
                const _articleTitle = _h1Match ? _h1Match[1].replace(/\*\*/g, '').trim() : null;
                const _etDoc = {
                  id: _etDocId,
                  title: _articleTitle || task.title || 'Untitled Blog Post',
                  kind: 'marketing_post',
                  content_md: deliverable,
                  status: 'draft',
                  tags: ['blog', 'auto-created-from-execute'],
                  created_by: agentId,
                  taskId: action.taskId,
                  promote: false,
                  awaiting_hero_image: true,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                };
                _etDocsStore.push(_etDoc);
                await storage.setState('documents', _etDocsStore);
                context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback: Created marketing_post from execute-task deliverable:', _etDocId, 'for blog task:', action.taskId);

                // Auto-create Pixel hero image task (same logic as create-doc handler)
                // SPAWN GUARD: do not spawn child tasks from auto-created tasks (prevents auto→auto chains)
                const _etSourceAutoCreated = task.tags && task.tags.indexOf('auto-created') !== -1;
                const _etHeroTitle = 'Generate hero image for: ' + stripTaskPrefixes(_etDoc.title);
                const _etHeroExists = tasks.some(t =>
                  t.assignee === 'pixel' && t.status !== 'done' &&
                  (t.title === _etHeroTitle || (t.description && t.description.indexOf(_etDocId) !== -1))
                );
                if (!_etHeroExists && !_etSourceAutoCreated) {
                  const _etHeroTask = {
                    id: 'task_' + Date.now() + '_hero_' + Math.random().toString(36).substr(2, 4),
                    title: _etHeroTitle,
                    description: 'Generate a hero image for the blog post "' + _etDoc.title + '".\nDocument ID: ' + _etDocId + '\nUse generate-image with purpose "blog_header" and attachTo: { type: "document", id: "' + _etDocId + '" }.\nChoose an appropriate preset based on the content tone.',
                    taskType: 'design_asset',
                    status: 'todo',
                    priority: task.priority || 'high',
                    dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
                    assignee: 'pixel',
                    source: 'heartbeat',
                    created_by: 'system',
                    parent_task_id: action.taskId,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    campaign_id: task.campaign_id || null,
                    objective_id: task.objective_id || null,
                    tags: ['hero-image', 'auto-created', 'visual-workflow'],
                    comments: [{
                      id: 'cmt-hero-' + Date.now(),
                      author: 'nova',
                      text: 'Pixel, generate a hero image for the blog post "' + _etDoc.title + '" (doc: ' + _etDocId + '). Use generate-image with purpose blog_header and attachTo the document.',
                      type: 'system',
                      createdAt: new Date().toISOString()
                    }]
                  };
                  tasks.push(_etHeroTask);
                  context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback: Created Pixel hero image task:', _etHeroTask.id, 'for auto-doc:', _etDocId);
                }
                // Add visible diagnostic comment on the task
                result.taskUpdates.push({
                  action: 'comment',
                  taskId: action.taskId,
                  comment: '[AUTO-DOC] Blog post detected via execute-task — auto-created document (' + _etDocId + ', kind: marketing_post) and Pixel hero image task. Next: Pixel generates hero image, then submit-for-publish.',
                  agentId: 'system'
                });
              }
            }
          }
        }
      }
    } else if (action.type === 'create-social-action' && action.social) {
      // TRIAGE GATE: if this social action is linked to a task, that task must be triaged first
      // Exception: CEO-created tasks with assignee + dueDate are pre-triaged
      if (agentId !== 'nova' && action.taskId) {
        const socialTarget = tasks.find(t => t.id === action.taskId);
        const hasSocialTriage = socialTarget && socialTarget.comments && socialTarget.comments.length > 0;
        const isCeoSocialTriaged = socialTarget && socialTarget.source !== 'heartbeat' && socialTarget.assignee && socialTarget.dueDate;
        if (socialTarget && !hasSocialTriage && !isCeoSocialTriaged) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— task has zero comments (needs Nova triage first)');
          continue;
        }
      }
      // DEDUPE GUARD: block duplicate social posts for the SAME TASK only
      const existingActions = (await storage.getState('actions')) || [];
      const isDupe = existingActions.some(function(ea) {
        if (!ea.type || ea.type.indexOf('social_post') !== 0) return false;
        var eaStatus = (ea.approval && ea.approval.status) || '';
        if (eaStatus === 'rejected' || eaStatus === 'cancelled') return false; // allow retry after reject
        var eaExecStatus = (ea.execution && ea.execution.status) || '';
        if (eaExecStatus === 'success') return false; // completed actions don't block new ones
        // Same task already has a pending/in-flight social action
        if (action.taskId && ea._parentTaskId === action.taskId) return true;
        return false;
      });
      if (isDupe) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — duplicate: pending social action already exists for task', action.taskId);
        continue;
      }

      // FIX 3: Block social actions that reference blog posts not yet published+promoted
      // This prevents the entire cascade: social action → copy task → Scribe create-doc → hero image
      if (action.taskId) {
        const _saParentTask = tasks.find(t => t.id === action.taskId);
        if (_saParentTask) {
          const _saText = ((_saParentTask.title || '') + ' ' + (_saParentTask.description || '')).toLowerCase();
          const _saRefsBlog = /blog\s*post|marketing_post|hello\s*world|write.*article|first\s*post/.test(_saText);
          if (_saRefsBlog) {
            // Check if the blog post is actually published + promoted
            const _saDocs = (await storage.getState('documents')) || [];
            const _saPublishedAndPromoted = _saDocs.some(d =>
              d.status === 'published' && d.promote === true &&
              d.kind === 'marketing_post'
            );
            if (!_saPublishedAndPromoted) {
              context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — blog not published+promoted yet. Social tasks auto-created after CEO approves publish with promote=true.');
              continue;
            }
          }
        }
      }

      // ── COPY REVIEW GATE ──
      // Social posts linked to tasks must go through Scribe for copy writing + peer review first.
      // Mirrors the Pixel hero image pattern: auto-create a Scribe task, block until reviewed.
      // Exception: task already has reviewed_copy (set when Scribe's writing sub-task is approved)
      if (action.taskId) {
        const socialTask = tasks.find(t => t.id === action.taskId);
        if (socialTask && !socialTask.reviewed_copy) {
          // Check if a Scribe writing sub-task already exists for this social task
          const _copyTag = 'social-copy-for-' + action.taskId;
          const _copyTaskExists = tasks.some(t =>
            ((t.tags && t.tags.indexOf(_copyTag) !== -1) ||
             (t.assignee === 'scribe' && t.parent_task_id === action.taskId && (t.title || '').indexOf('Write social copy') === 0))
          );
          // Also check if a COMPLETED Scribe copy task exists (reviewed_copy may not have propagated yet)
          const _copyTaskDone = tasks.find(t =>
            t.status === 'done' &&
            ((t.tags && t.tags.indexOf(_copyTag) !== -1) ||
             (t.assignee === 'scribe' && t.parent_task_id === action.taskId && (t.title || '').indexOf('Write social copy') === 0))
          );
          if (_copyTaskDone) {
            // Copy task is done but reviewed_copy wasn't set — extract deliverable now
            const _deliverables = (_copyTaskDone.comments || []).filter(c => c.type === 'deliverable');
            if (_deliverables.length > 0) {
              socialTask.reviewed_copy = _deliverables[_deliverables.length - 1].text;
              socialTask.updatedAt = new Date().toISOString();
              context.log('[Heartbeat]', agentId, 'Late-resolved reviewed_copy from done copy task:', _copyTaskDone.id);
              // Fall through — allow the social action with the reviewed copy
            }
          }
          // If STILL no reviewed copy, block and create Scribe task
          // SPAWN GUARD: do not spawn child tasks from auto-created tasks (prevents auto→auto chains)
          const _isAutoCreatedSource = socialTask.tags && socialTask.tags.indexOf('auto-created') !== -1;
          if (!socialTask.reviewed_copy && !_isAutoCreatedSource) {
            if (!_copyTaskExists) {
              const _platform = (action.social.platform || 'linkedin').toLowerCase();
              const _maxLen = _platform === 'x' ? '280 chars' : _platform === 'bluesky' ? '300 chars' : '3000 chars for LinkedIn';
              const copyTask = {
                id: 'task_' + Date.now() + '_copy_' + Math.random().toString(36).substr(2, 4),
                title: 'Write social copy for: ' + stripTaskPrefixes(socialTask.title || 'Untitled'),
                description: 'Write publish-ready social media copy for the task: "' + stripTaskPrefixes(socialTask.title || '') + '".\n\n'
                  + 'Original description: ' + ((socialTask.description || 'N/A').substring(0, 500)) + '\n\n'
                  + 'Parent task ID: ' + action.taskId + '\n'
                  + 'Platform: ' + _platform + '\n'
                  + 'Max length: ' + _maxLen + '\n\n'
                  + 'Requirements:\n'
                  + '- Write clean, platform-ready copy (no markdown, no headers, no internal notes)\n'
                  + '- Professional and on-brand for AmbientPixels\n'
                  + '- MUST include a URL: if promoting a blog post, link to the article; otherwise include https://ambientpixels.ai\n'
                  + '- LinkedIn posts: aim for 400-800 chars (concise and punchy, not padded to fill 3000)\n'
                  + '- After writing, this task goes to peer review. Once approved, Echo uses the copy to create the social post.\n'
                  + '- Use execute-task to produce your deliverable.',
                taskType: 'social_copy',
                status: 'todo',
                priority: socialTask.priority || 'high',
                assignee: 'scribe',
                source: 'heartbeat',
                created_by: 'system',
                parent_task_id: action.taskId || null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                dueDate: socialTask.dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                campaign_id: socialTask.campaign_id || null,
                tags: ['social-copy', 'auto-created', _copyTag],
                comments: [{
                  id: 'cmt-' + Date.now(),
                  author: 'system',
                  text: 'Auto-created: Echo attempted to post for task "' + (socialTask.title || '') + '" but no reviewed copy exists. Scribe must write and submit copy for peer review first.',
                  type: 'system',
                  createdAt: new Date().toISOString()
                }]
              };
              tasks.push(copyTask);
              context.log('[Heartbeat]', agentId, 'AUTO-CREATED Scribe copy task:', copyTask.id, 'for social task:', action.taskId);
            } else {
              context.log('[Heartbeat]', agentId, 'Scribe copy task already exists for social task:', action.taskId, '— waiting for review');
            }
            // Mark parent task as awaiting copy review (only once)
            if (!socialTask.awaiting_copy_review) {
              socialTask.awaiting_copy_review = true;
              socialTask.updatedAt = new Date().toISOString();
              if (!socialTask.comments) socialTask.comments = [];
              socialTask.comments.push({
                id: 'cmt-copywait-' + Date.now(),
                author: 'system',
                text: 'Social post blocked — awaiting reviewed copy from Scribe. Once Scribe writes and a peer reviews the copy, Echo can create the social action.',
                type: 'system',
                createdAt: new Date().toISOString()
              });
            }
            context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— awaiting reviewed copy from Scribe');
            continue;
          }
        }
      }

      // Fix 9: If the social task has reviewed_copy but the action text is empty, inject the copy
      if (action.taskId) {
        const _rcTask = tasks.find(t => t.id === action.taskId);
        if (_rcTask && _rcTask.reviewed_copy && (!action.social.text || action.social.text.trim() === '')) {
          action.social.text = _rcTask.reviewed_copy;
          context.log('[Heartbeat]', agentId, 'Injected reviewed_copy into social action text (' + action.social.text.length + ' chars)');
        }
      }

      // Agent-initiated social post action — routes through action layer governance
      const socialPayload = action.social;

      // Fix 10: Strip alternative draft options that Scribe includes in deliverables
      // Scribe often writes multiple options (main + "Alternative Option" sections separated by ---)
      if (socialPayload.text && /\*\*Alternative\s+Option/i.test(socialPayload.text)) {
        let _cleaned = socialPayload.text;
        // Cut at first --- followed by **Alternative Option or just **Alternative Option
        _cleaned = _cleaned.split(/\n-{2,}\s*\n(?=\s*\*\*Alternative)/i)[0]
          || _cleaned.split(/\*\*Alternative\s+Option[^*]*\*\*/i)[0]
          || _cleaned;
        _cleaned = _cleaned.replace(/\n-{2,}\s*$/, '').trim(); // trailing ---
        if (_cleaned.length > 20) {
          context.log('[Heartbeat] Fix 10: Stripped alternative draft options — kept', _cleaned.length, 'of', socialPayload.text.length, 'chars');
          socialPayload.text = _cleaned;
        }
      }

      // Fix 10b: Strip remaining markdown bold/italic from social post text
      if (socialPayload.text && /\*\*/.test(socialPayload.text)) {
        socialPayload.text = socialPayload.text
          .replace(/\*\*([^*]+)\*\*/g, '$1')   // **bold** → bold
          .replace(/\*([^*]+)\*/g, '$1');        // *italic* → italic
      }

      // Server-side sanitizer: strip deliverable metadata that agents sometimes dump into post text
      if (socialPayload.text && /\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up|Peer Review|Notes|Review).*?:\*\*/i.test(socialPayload.text)) {
        let raw = socialPayload.text;
        context.log('[Heartbeat] Sanitizing social post text — detected deliverable metadata');

        // Strategy 1: Extract just the LinkedIn Post Draft section
        const draftMatch = raw.match(/\*\*LinkedIn Post Draft:\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i)
          || raw.match(/\*\*(?:Post|Draft|Content):\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i);
        if (draftMatch && draftMatch[1].trim().length > 20) {
          raw = draftMatch[1].trim();
        } else {
          // Strategy 2: Remove all known section headers and keep what's left
          // Split by section headers and keep only content paragraphs
          const sections = raw.split(/\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up Comment|Peer Review[^*]*|Notes|Review[^*]*):\*\*/i);
          // Find the longest section that looks like actual post content (no markdown headers)
          let best = '';
          for (const section of sections) {
            const cleaned = section.replace(/^#{1,4}\s+.*$/gm, '').replace(/^\s*[-–]\s+/gm, '').trim();
            if (cleaned.length > best.length && !/^\s*\*\*/.test(cleaned) && cleaned.length > 20) {
              best = cleaned;
            }
          }
          if (best.length > 20) raw = best;
        }

        // Strip remaining markdown formatting
        raw = raw.replace(/^#{1,4}\s+.*$/gm, '');          // ## headings
        raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1');        // **bold** → bold
        raw = raw.replace(/\*([^*]+)\*/g, '$1');             // *italic* → italic
        raw = raw.replace(/^\s*\*\s+/gm, '');               // bullet points
        raw = raw.replace(/\n{3,}/g, '\n\n').trim();         // collapse blank lines
        context.log('[Heartbeat] Sanitized text:', raw.substring(0, 120));
        socialPayload.text = raw;
      }

      // Strip meta-comments agents leave in copy (e.g. [ADDRESSED], [NOTE], [REVISED])
      socialPayload.text = (socialPayload.text || '').replace(/\n*\[(?:ADDRESSED|NOTE|REVISED|FEEDBACK|CHANGED|UPDATED)[^\]]*\].*$/gis, '').trim();
      const postText = socialPayload.text || '';

      // Server-side enforcement: reject posts with unfilled template placeholders
      if (/\[(?:[^\]]*(?:mention|insert|\badd\b|include|TBD|link|placeholder|url|website|your |e\.g\.|fill))[^\]]*\]/i.test(postText)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — contains placeholder brackets:', postText.substring(0, 100));
        continue;
      }

      // Server-side enforcement: reject posts without a URL
      // Posts must link to a blog article or include https://ambientpixels.ai
      // Exception: posts with {{ARTICLE_URL}} tokens (resolved at execute time)
      const hasUrl = /https?:\/\//.test(postText) || /\{\{ARTICLE_URL[^}]*\}\}/.test(postText);
      if (!hasUrl) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — no URL found in post text. Must include a blog link or https://ambientpixels.ai');
        continue;
      }

      // Server-side enforcement: reject posts linking to unpublished blog articles
      // v2.4.4: Skip this check for {{ARTICLE_URL}} tokens — those are resolved at execute time
      const textWithoutTokens = postText.replace(/\{\{ARTICLE_URL[^}]*\}\}/g, '');
      const blogSlugMatches = textWithoutTokens.match(/(?:ambientpixels\.ai)?\/blog\/([a-z0-9][a-z0-9-]+[a-z0-9])/gi);
      if (blogSlugMatches && blogSlugMatches.length > 0) {
        const blogPosts = (await storage.getState('blogPosts')) || [];
        const publishedSlugs = new Set(blogPosts.map(p => p.slug));
        const deadSlugs = [];
        for (const match of blogSlugMatches) {
          const slug = match.replace(/.*\/blog\//i, '');
          if (!publishedSlugs.has(slug)) deadSlugs.push(slug);
        }
        if (deadSlugs.length > 0) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — links to unpublished blog slug(s):', deadSlugs.join(', '));
          continue;
        }
      }

      // v2.5: Promotion gating — block social posts that reference blog posts without promote: true
      if (blogSlugMatches && blogSlugMatches.length > 0) {
        const _allDocs = (await storage.getState('documents')) || [];
        const _blogPostsForPromo = (await storage.getState('blogPosts')) || [];
        const unpromotedSlugs = [];
        for (const match of blogSlugMatches) {
          const slug = match.replace(/.*\/blog\//i, '');
          // Find the published blog post, then its source document
          const _bp = _blogPostsForPromo.find(p => p.slug === slug);
          if (_bp) {
            const _srcDoc = _allDocs.find(d => d.id === (_bp.documentId || _bp.document_id));
            if (_srcDoc && !_srcDoc.promote) unpromotedSlugs.push(slug);
            else if (!_srcDoc) unpromotedSlugs.push(slug); // no source doc = no promote flag
          }
        }
        if (unpromotedSlugs.length > 0) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — blog slug(s) not approved for promotion:', unpromotedSlugs.join(', '));
          continue;
        }
      }

      const actionRequest = {
        type: (socialPayload.scheduled_for || socialPayload.schedule_for) ? 'social_post.schedule' : 'social_post.publish',
        platform: socialPayload.platform || 'x',
        payload: {
          text: socialPayload.text || '',
          media: socialPayload.media || [],
          scheduled_for: socialPayload.scheduled_for || socialPayload.schedule_for || null
        },
        created_by: agentId
      };

      // Save to actions store (requires CEO approval)
      const actionsStore = (await storage.getState('actions')) || [];
      const newAction = _createActionFromHeartbeat(actionRequest, agentId);

      // v2.4.4: If agent provided artifact_id, wire up tokens + dependsOn for URL resolution
      if (socialPayload.artifact_id) {
        newAction.tokens = { ARTICLE_URL: { type: 'artifact', id: socialPayload.artifact_id } };
        newAction.dependsOn = [{ type: 'artifact', id: socialPayload.artifact_id }];
        context.log('[Heartbeat]', agentId, 'social action linked to artifact:', socialPayload.artifact_id);
      }

      // Link action to parent task if provided
      if (action.taskId) newAction._parentTaskId = action.taskId;

      actionsStore.push(newAction);
      await storage.setState('actions', actionsStore);

      // Extract first media URL for approval queue preview (if any)
      var _socialPreviewImage = null;
      if (newAction.payload && Array.isArray(newAction.payload.media) && newAction.payload.media.length > 0) {
        var _firstMedia = newAction.payload.media[0];
        _socialPreviewImage = (typeof _firstMedia === 'string') ? _firstMedia : (_firstMedia && _firstMedia.url) || null;
      }

      // Add to approval queue
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      approvalQueue.push({
        id: 'aq-' + newAction.id,
        kind: 'action',
        action_id: newAction.id,
        taskId: action.taskId || null,
        taskTitle: 'Social Post (' + (newAction.platform || 'x') + ')',
        originAgent: agentId,
        classification: newAction.classification,
        riskLevel: newAction.risk_level,
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: (newAction.payload && newAction.payload.text) ? newAction.payload.text.substring(0, 120) : '',
        previewImageUrl: _socialPreviewImage
      });
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);

      // Auto-advance parent task to review if taskId provided
      // Fallback: if no taskId but agent has a matching active task, auto-link
      var socialTaskId = action.taskId || null;
      if (!socialTaskId) {
        var platform = (socialPayload.platform || 'social').toLowerCase();
        var agentActiveTasks = tasks.filter(t => t.assignee === agentId && (t.status === 'todo' || t.status === 'in-progress'));
        var socialKeywords = ['social', 'post', 'linkedin', 'twitter', 'bluesky', 'x post', 'hello world', 'publish', 'announce'];
        var matchingTasks = agentActiveTasks.filter(t => {
          var haystack = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
          return socialKeywords.some(kw => haystack.indexOf(kw) !== -1) || haystack.indexOf(platform) !== -1;
        });
        if (matchingTasks.length === 1) {
          socialTaskId = matchingTasks[0].id;
          context.log('[Heartbeat]', agentId, 'auto-linked social action to task:', socialTaskId, '(fallback match)');
        } else if (matchingTasks.length === 0 && agentActiveTasks.length === 1) {
          socialTaskId = agentActiveTasks[0].id;
          context.log('[Heartbeat]', agentId, 'auto-linked social action to only active task:', socialTaskId);
        }
      }
      if (socialTaskId) {
        var parentIdx = tasks.findIndex(t => t.id === socialTaskId);
        if (parentIdx !== -1 && tasks[parentIdx].status !== 'done' && tasks[parentIdx].status !== 'review') {
          tasks[parentIdx].status = 'review';
          tasks[parentIdx].updatedAt = new Date().toISOString();
          if (!tasks[parentIdx].comments) tasks[parentIdx].comments = [];
          tasks[parentIdx].comments.push({
            id: 'cmt-' + Date.now(),
            author: agentId,
            text: 'Social post created and submitted for CEO approval (action: ' + newAction.id + '). Awaiting CEO decision.',
            type: 'deliverable',
            createdAt: new Date().toISOString()
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', socialTaskId, 'to review (social action created)');
        }
      }

      context.log('[Heartbeat]', agentId, 'created social action:', newAction.id, newAction.type, newAction.platform);
      result.taskUpdates.push({ action: 'social-action-created', actionId: newAction.id, agentId: agentId, taskId: socialTaskId });

    } else if (action.type === 'revise-action' && action.action_id && action.social) {
      // Agent revising a CEO-rejected action — update payload and re-submit for approval
      // Server-side sanitizer: strip deliverable metadata from revised text
      if (action.social.text && /\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up|Peer Review|Notes|Review).*?:\*\*/i.test(action.social.text)) {
        let raw = action.social.text;
        const draftMatch = raw.match(/\*\*LinkedIn Post Draft:\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i)
          || raw.match(/\*\*(?:Post|Draft|Content):\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i);
        if (draftMatch && draftMatch[1].trim().length > 20) {
          raw = draftMatch[1].trim();
        } else {
          const sections = raw.split(/\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up Comment|Peer Review[^*]*|Notes|Review[^*]*):\*\*/i);
          let best = '';
          for (const section of sections) {
            const cleaned = section.replace(/^#{1,4}\s+.*$/gm, '').replace(/^\s*[-–]\s+/gm, '').trim();
            if (cleaned.length > best.length && !/^\s*\*\*/.test(cleaned) && cleaned.length > 20) best = cleaned;
          }
          if (best.length > 20) raw = best;
        }
        raw = raw.replace(/^#{1,4}\s+.*$/gm, '');
        raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1');
        raw = raw.replace(/\*([^*]+)\*/g, '$1');
        raw = raw.replace(/^\s*\*\s+/gm, '');
        raw = raw.replace(/\n{3,}/g, '\n\n').trim();
        action.social.text = raw;
      }
      const revisedText = action.social.text || '';

      // Server-side enforcement: reject revised posts with placeholder brackets
      if (/\[(?:[^\]]*(?:mention|insert|\badd\b|include|TBD|link|placeholder|url|website|your |e\.g\.|fill))[^\]]*\]/i.test(revisedText)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED revise-action — contains placeholder brackets:', revisedText.substring(0, 100));
        continue;
      }

      const actionsStore = (await storage.getState('actions')) || [];
      const origIdx = actionsStore.findIndex(a => a.id === action.action_id);
      if (origIdx === -1) {
        context.log('[Heartbeat]', agentId, 'revise-action: action not found:', action.action_id);
        continue;
      }
      const orig = actionsStore[origIdx];

      // Detect if this is a publish_document action
      const _isPublishRevision = (orig.type === 'publish_document' || orig.action_type === 'publish_document');

      // Update payload with revised content
      orig.payload = orig.payload || {};
      if (_isPublishRevision) {
        // For publish_document: update content_md, not payload.text
        orig.payload.content_md = revisedText;
      } else {
        orig.payload.text = revisedText;
      }
      if (action.social.media) orig.payload.media = action.social.media;
      if (action.social.scheduled_for) orig.payload.scheduled_for = action.social.scheduled_for;

      // For publish_document revisions: re-resolve hero image URL from imageAssets
      // (Pixel may have generated the image after the original submit-for-publish)
      let _revHeroImageUrl = orig.payload.hero_image_url || null;
      if (_isPublishRevision) {
        try {
          // Check if the document now has a hero_image_asset_id (Pixel may have updated it)
          const _revDocs = (await storage.getState('documents')) || [];
          const _revDoc = _revDocs.find(d => d.id === (orig.payload.documentId || ''));
          const _revAssetId = (_revDoc && _revDoc.hero_image_asset_id) || orig.payload.hero_image_asset_id || null;
          if (_revAssetId) {
            orig.payload.hero_image_asset_id = _revAssetId;
            const _revImgAssets = (await storage.getState('imageAssets')) || [];
            const _revAsset = _revImgAssets.find(a => a.id === _revAssetId);
            if (_revAsset && _revAsset.url) {
              _revHeroImageUrl = _revAsset.url;
              orig.payload.hero_image_url = _revHeroImageUrl;
            }
          }
        } catch (_revImgErr) { /* non-fatal */ }
      }

      // Reset approval to pending
      orig.approval = orig.approval || {};
      orig.approval.status = 'pending';
      orig.approval.decision_note = null;
      orig.approval.revised_at = new Date().toISOString();
      orig.approval.revision_count = (orig.approval.revision_count || 0) + 1;

      // Reset execution state so it can be re-executed after approval
      orig.execution_status = 'pending';
      if (orig.execution) {
        orig.execution.status = 'pending';
        orig.execution.attempts = 0;
        orig.execution.last_error = null;
      }

      actionsStore[origIdx] = orig;
      await storage.setState('actions', actionsStore);

      // Auto-memory: remember CEO feedback so agent learns from rejections
      const ceoFeedback = (orig.approval && orig.approval.decision_note) || '';
      if (ceoFeedback.length > 5) {
        if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
        var _autoMemNow = new Date();
        _agentMemoryStore[agentId].push({
          id: 'mem_' + Date.now() + '_auto',
          type: 'feedback',
          text: 'CEO rejected my ' + (orig.platform || '') + ' post and said: "' + ceoFeedback.substring(0, 200) + '"',
          source: 'auto:ceo-revision',
          timestamp: _autoMemNow.toISOString(),
          expiresAt: new Date(_autoMemNow.getTime() + L4_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
        });
        if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
          _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
        }
      }

      // Update or re-add to approval queue
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      const aqIdx = approvalQueue.findIndex(q => q.action_id === orig.id);
      // Extract media preview for revised social post
      var _revisedPreviewImage = null;
      if (orig.payload && Array.isArray(orig.payload.media) && orig.payload.media.length > 0) {
        var _rm = orig.payload.media[0];
        _revisedPreviewImage = (typeof _rm === 'string') ? _rm : (_rm && _rm.url) || null;
      }

      // Preserve existing AQ entry fields for publish_document revisions
      const _prevAqEntry = aqIdx !== -1 ? approvalQueue[aqIdx] : {};

      const aqEntry = _isPublishRevision ? {
        // Publish-document-specific AQ entry
        id: aqIdx !== -1 ? _prevAqEntry.id : 'aq-' + orig.id,
        kind: 'action',
        actionType: 'publish_document',
        action_id: orig.id,
        taskId: _prevAqEntry.taskId || null,
        taskTitle: 'Publish: ' + (orig.payload.title || 'Untitled'),
        originAgent: agentId,
        classification: orig.classification || 'executive_required',
        riskLevel: orig.risk_level || 'medium',
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: (orig.payload.content_md || revisedText).substring(0, 120),
        documentId: orig.payload.documentId || _prevAqEntry.documentId || null,
        slug: orig.payload.slug || _prevAqEntry.slug || null,
        docKind: orig.payload.kind || _prevAqEntry.docKind || null,
        artifactId: _prevAqEntry.artifactId || null,
        heroImageUrl: _revHeroImageUrl,
        heroImageAssetId: orig.payload.hero_image_asset_id || _prevAqEntry.heroImageAssetId || null,
        revisionCount: orig.approval.revision_count || 0
      } : {
        // Social post AQ entry (original behavior)
        id: aqIdx !== -1 ? _prevAqEntry.id : 'aq-' + orig.id,
        kind: 'action',
        action_id: orig.id,
        taskId: null,
        taskTitle: 'Social Post (' + (orig.platform || 'x') + ')',
        originAgent: agentId,
        classification: orig.classification || 'standard',
        riskLevel: orig.risk_level || 'medium',
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: revisedText.substring(0, 120),
        previewImageUrl: _revisedPreviewImage,
        revisionCount: orig.approval.revision_count || 0
      };
      if (aqIdx !== -1) {
        approvalQueue[aqIdx] = aqEntry;
      } else {
        approvalQueue.push(aqEntry);
      }
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);

      context.log('[Heartbeat]', agentId, 'revised action:', orig.id, '| revision #' + orig.approval.revision_count);
      result.taskUpdates.push({ action: 'action-revised', actionId: orig.id, agentId: agentId });

    } else if (action.type === 'comment-task' && action.taskId && action.comment) {
      // Comment dedup: skip if same agent posted a similar comment on this task in last 2 hours
      const targetTask = tasks.find(t => t.id === action.taskId);
      const recentComments = (targetTask && Array.isArray(targetTask.comments)) ? targetTask.comments : [];
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const commentText = String(action.comment).toLowerCase().trim();

      // Guard 1: Max 3 comments per agent per task (prevents spam loops)
      const agentCommentCount = recentComments.filter(c => (c.user || c.author || '') === agentId).length;
      if (agentCommentCount >= 3) {
        context.log('[Heartbeat]', agentId, 'comment-task SKIPPED (agent already has', agentCommentCount, 'comments on task:', action.taskId, ')');
        continue;
      }

      // Guard 2: Similarity dedup — skip if same agent posted 60%+ similar comment in last 2 hours
      const isDuplicate = recentComments.some(c => {
        if ((c.user || c.author || '') !== agentId) return false;
        const ts = c.createdAt || c.created_at || c.timestamp || null;
        if (ts && new Date(ts).getTime() < twoHoursAgo) return false;
        const existing = String(c.text || c.comment || c.body || '').toLowerCase().trim();
        const wordsA = commentText.split(/\s+/);
        const wordsB = new Set(existing.split(/\s+/));
        const overlap = wordsA.filter(w => wordsB.has(w)).length;
        return overlap >= wordsA.length * 0.6;
      });

      // Guard 3: Block follow-up/waiting loop patterns (any agent who already asked about the same thing)
      const isFollowUpLoop = /\b(still waiting|still awaiting|checking in|following up|just checking|any update|provide.*update|firm eta|appendix)\b/i.test(commentText) &&
        recentComments.some(c => {
          if ((c.user || c.author || '') !== agentId) return false;
          const existing = String(c.text || c.comment || c.body || '').toLowerCase();
          return /\b(waiting|awaiting|checking|following|update|appendix)\b/.test(existing);
        });

      // Guard 4: Block Nova re-delegation spam — if Nova already delegated this task (has a comment)
      // and the task is assigned to another agent with active status, no need to re-delegate
      const isDelegationSpam = agentId === 'nova' && targetTask &&
        targetTask.assignee && targetTask.assignee !== 'nova' &&
        (targetTask.status === 'todo' || targetTask.status === 'in-progress' || targetTask.status === 'review') &&
        recentComments.some(c => (c.user || c.author || '') === 'nova' && c.type !== 'system');

      if (isDuplicate || isFollowUpLoop || isDelegationSpam) {
        context.log('[Heartbeat]', agentId, 'comment-task SKIPPED (' + (isDelegationSpam ? 'delegation-spam' : isFollowUpLoop ? 'follow-up loop' : 'duplicate') + ' comment) on task:', action.taskId);
      } else {
        result.taskUpdates.push({
          action: 'comment',
          taskId: action.taskId,
          comment: action.comment,
          agentId: agentId
        });
      }
    } else if (action.type === 'review-task' && action.taskId) {
      // Review: agent reviews another agent's deliverable (costs 1 extra Gemini call)
      const task = tasks.find(t => t.id === action.taskId && t.status === 'review');
      if (task) {
        // CONVERGENCE GUARD: block review if task already has 3+ deliverables — it's looping
        const _rvDelCount = (task.comments || []).filter(c => c.type === 'deliverable').length;
        if (_rvDelCount >= 3) {
          const _lastRvSys = (task.comments || []).slice().reverse().find(c => c.author === 'system' || c.agentId === 'system');
          const _rvAlreadyWarned = _lastRvSys && _lastRvSys.text && _lastRvSys.text.indexOf('Revision loop') !== -1;
          if (!_rvAlreadyWarned) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: '[SYSTEM] Review blocked: task is convergence-locked (' + _rvDelCount + ' deliverables). CEO must approve or close this task before further review can proceed.',
              agentId: 'system'
            });
          }
          context.log('[Heartbeat]', agentId, 'CONVERGENCE BLOCKED review-task on', action.taskId, '—', _rvDelCount, 'deliverables already.');
        } else {
          const review = await reviewTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext);
          result.geminiCalls++;
          if (review) {
            result.taskUpdates.push({
              action: 'review',
              taskId: action.taskId,
              review: review,
              agentId: agentId
            });
          }
        }
      }
    } else if (action.type === 'create-doc' && action.document) {
      // Create a documentation draft — stored in documents store
      const docPayload = action.document;
      const VALID_DOC_KINDS = ['spec', 'runbook', 'release_notes', 'product_brief', 'marketing_post', 'governance'];
      const kind = docPayload.kind || 'product_brief';

      if (docPayload.title && VALID_DOC_KINDS.indexOf(kind) !== -1) {
        // FIX: Block create-doc on social-copy tasks — Scribe must use execute-task for social copy, not create-doc
        // Creating a marketing_post doc for social copy triggers hero image cascade (the entire bug chain)
        if (action.taskId) {
          const _originTask = tasks.find(t => t.id === action.taskId);
          const _isSocialCopyTask = _originTask && (
            (_originTask.tags && _originTask.tags.indexOf('social-copy') !== -1) ||
            ((_originTask.title || '').indexOf('Write social copy for:') === 0)
          );
          if (_isSocialCopyTask) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc on social-copy task:', action.taskId, '— use execute-task for social copy, not create-doc');
            if (action.taskId) {
              result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] create-doc blocked on social copy task. Use execute-task to produce your social copy deliverable, not create-doc.', agentId: 'system' });
            }
            continue;
          }
        }

        // GUARD: Require task linkage — no orphan doc creation
        if (!action.taskId) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-doc without task linkage — orphan docs not allowed. Title:', docPayload.title);
          continue;
        }

        // GUARD: Max 1 doc per agent per heartbeat cycle
        const _docsCreatedThisCycle = result.taskUpdates.filter(u => u.action === 'doc-created' && u.agentId === agentId).length;
        if (_docsCreatedThisCycle >= 1) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-doc — already created', _docsCreatedThisCycle, 'doc(s) this cycle. Title:', docPayload.title);
          result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Doc creation limit reached (1 per heartbeat cycle). Try again next cycle.', agentId: 'system' });
          continue;
        }

        // Fix 11: Hard caps on unpublished documents by kind
        const existingDocs = (await storage.getState('documents')) || [];
        const INTERNAL_KINDS = ['spec', 'runbook', 'release_notes', 'governance'];
        const EXTERNAL_KINDS = ['marketing_post', 'product_brief'];
        const _isInternalKind = INTERNAL_KINDS.indexOf(kind) !== -1;
        const _isExternalKind = EXTERNAL_KINDS.indexOf(kind) !== -1;

        // Fix 11a: Internal docs — hard cap at 5 unpublished, must be AmbientCore/operational subject matter
        if (_isInternalKind) {
          const _activeInternalDocs = existingDocs.filter(d =>
            INTERNAL_KINDS.indexOf(d.kind) !== -1 &&
            d.status !== 'published' && d.status !== 'rejected' && d.status !== 'archived'
          );
          if (_activeInternalDocs.length >= 5) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (internal) — hard cap reached:', _activeInternalDocs.length, 'active internal docs. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Internal doc cap reached (5 max). Publish or archive existing internal docs first.', agentId: 'system' });
            continue;
          }
          // Subject matter gate: internal docs must be about AmbientCore, system operations, or technical reference
          const _docText = ((docPayload.title || '') + ' ' + (docPayload.content_md || '').substring(0, 500)).toLowerCase();
          const _isAmbientCoreTopic = /ambientcore|gridops|heartbeat|agent|orchestrat|governance|storage|pipeline|api|function|deployment|architecture|config|escalation|triage|approval|execution|workflow|system|technical|reference|runbook|spec|schema|endpoint/.test(_docText);
          if (!_isAmbientCoreTopic) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (internal) — not AmbientCore/operational subject matter. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Internal docs (spec/runbook/governance) are for AmbientCore technical reference only. For marketing/blog content, use kind: marketing_post.', agentId: 'system' });
            continue;
          }
        }

        // Fix 11b: External docs — hard cap at 5 unpublished drafts
        if (_isExternalKind) {
          const _activeExternalDocs = existingDocs.filter(d =>
            EXTERNAL_KINDS.indexOf(d.kind) !== -1 &&
            d.status !== 'published' && d.status !== 'rejected' && d.status !== 'archived'
          );
          if (_activeExternalDocs.length >= 5) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (external) — hard cap reached:', _activeExternalDocs.length, 'unpublished external docs. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] External doc cap reached (5 max unpublished). CEO must publish or discard existing drafts before new ones can be created.', agentId: 'system' });
            continue;
          }
        }

        // Fix 11b: Fuzzy title dedup — word-overlap similarity blocks near-duplicate titles
        const _proposedDocTitle = (docPayload.title || '').toLowerCase().trim();
        const _proposedWords = _proposedDocTitle.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
        const duplicateDoc = existingDocs.find(d => {
          if (!d.title) return false;
          if (d.status === 'rejected' || d.status === 'archived') return false;
          const existTitle = d.title.toLowerCase().trim();
          // Exact match
          if (existTitle === _proposedDocTitle) {
            if (action.taskId && d.taskId && action.taskId !== d.taskId) return false;
            if (action.taskId && !d.taskId) return false;
            return true;
          }
          // Fuzzy match: >75% word overlap blocks creation (raised from 60% to reduce false-positive dedup)
          if (_proposedWords.length >= 3) {
            const _existWords = existTitle.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
            if (_existWords.length >= 3) {
              const _overlap = _proposedWords.filter(w => _existWords.indexOf(w) !== -1).length;
              const _similarity = _overlap / Math.max(_proposedWords.length, _existWords.length);
              if (_similarity > 0.75) {
                // Still allow different-task linkage
                if (action.taskId && d.taskId && action.taskId !== d.taskId) return false;
                if (action.taskId && !d.taskId) return false;
                return true;
              }
            }
          }
          return false;
        });
        if (duplicateDoc) {
          context.log('[Heartbeat]', agentId, 'BLOCKED duplicate doc creation:', _proposedDocTitle, '— fuzzy matches existing doc:', duplicateDoc.id, duplicateDoc.title);
          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Document already exists with similar title: "' + duplicateDoc.title + '" (id: ' + duplicateDoc.id + '). Use update-doc to revise it instead of creating a duplicate.',
              agentId: agentId
            });
          }
          continue;
        }

        const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        // If agent title looks like a task name, extract real title from H1 heading
        const _h1FromContent = (docPayload.content_md || '').match(/^#\s+(.+)$/m);
        const _isTaskName = /^(draft|write|create|compose|update)\s/i.test(docPayload.title || '');
        const _docTitle = (_isTaskName && _h1FromContent)
          ? _h1FromContent[1].replace(/\*\*/g, '').trim()
          : docPayload.title;
        const doc = {
          id: docId,
          title: _docTitle,
          kind: kind,
          status: 'draft',
          tags: Array.isArray(docPayload.tags) ? docPayload.tags : [],
          created_by: agentId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          content_md: docPayload.content_md || '',
          promote: false,
          taskId: action.taskId || null,
          source: { action_id: null, task_id: action.taskId || null }
        };

        const docsStore = (await storage.getState('documents')) || [];
        docsStore.push(doc);
        if (docsStore.length > 500) docsStore.splice(0, docsStore.length - 500);
        await storage.setState('documents', docsStore);

        context.log('[Heartbeat]', agentId, 'created doc draft:', doc.id, doc.title);
        result.taskUpdates.push({ action: 'doc-created', documentId: doc.id, agentId: agentId });

        // Link doc back to the originating task: add comment + move to review
        const _isVisualKind = ['marketing_post', 'product_brief'].indexOf(kind) !== -1;
        if (action.taskId) {
          result.taskUpdates.push({
            action: 'comment',
            taskId: action.taskId,
            comment: _isVisualKind
              ? 'Document created: "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + '). Awaiting hero image from Pixel before submitting for publish.'
              : 'Document created: "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + '). Submitting for CEO approval.',
            agentId: agentId
          });
          // Only move if task isn't already in a later stage (prevents race: execute→review then create-doc→in-progress)
          const _cdCurrentTask = tasks.find(t => t.id === action.taskId);
          const _cdCurrentStatus = _cdCurrentTask ? _cdCurrentTask.status : '';
          const _cdTargetStatus = _isVisualKind ? 'in-progress' : 'review';
          const _cdAlreadyAdvanced = (_cdCurrentStatus === 'review' || _cdCurrentStatus === 'done');
          if (!_cdAlreadyAdvanced) {
            result.taskUpdates.push({
              action: 'move',
              taskId: action.taskId,
              newStatus: _cdTargetStatus
            });
          } else {
            context.log('[Heartbeat]', agentId, 'create-doc: skipping status move — task', action.taskId, 'already in', _cdCurrentStatus, '(would have moved to', _cdTargetStatus + ')');
          }
        }

        // Visual doc kinds: auto-create Pixel hero image task instead of auto-submitting for publish
        // Doc stays in draft until Pixel generates the hero image, then Scribe submits in a future heartbeat
        const VISUAL_DOC_KINDS = ['marketing_post', 'product_brief'];
        context.log('[Heartbeat] HERO-DIAG:', agentId, 'doc kind:', kind, 'isVisual:', VISUAL_DOC_KINDS.indexOf(kind) !== -1, 'docId:', doc.id, 'taskId:', action.taskId || 'NONE');
        if (action.taskId) {
          result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[DIAG] create-doc fired — kind: ' + kind + ', isVisual: ' + (VISUAL_DOC_KINDS.indexOf(kind) !== -1) + ', docId: ' + doc.id, agentId: 'system' });
        }
        // SPAWN GUARD: do not spawn hero tasks from auto-created source tasks (prevents auto→auto chains)
        const _cdSourceTask = action.taskId ? tasks.find(t => t.id === action.taskId) : null;
        const _cdSourceAutoCreated = _cdSourceTask && _cdSourceTask.tags && _cdSourceTask.tags.indexOf('auto-created') !== -1;
        if (VISUAL_DOC_KINDS.indexOf(kind) !== -1 && agentId === 'scribe' && !_cdSourceAutoCreated) {
          // Only Scribe-created visual docs trigger hero image tasks (prevents ops/engineering docs from spawning hero tasks)
          // FIX 5: Stronger dedup — check by title substring match, not just exact title or doc ID
          // Prevents multiple hero tasks when the same blog post has multiple doc records
          const _heroTaskTitle = 'Generate hero image for: ' + stripTaskPrefixes(doc.title);
          const _heroNormTitle = doc.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
          const _heroTaskExists = tasks.some(t => {
            if (t.assignee !== 'pixel' || t.status === 'done') return false;
            if (t.title === _heroTaskTitle) return true;
            if (t.description && t.description.indexOf(doc.id) !== -1) return true;
            // Fuzzy: any active Pixel hero task whose title contains the same blog title words
            if ((t.title || '').indexOf('Generate hero image for:') === 0) {
              const _existHeroNorm = t.title.replace('Generate hero image for: ', '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
              if (_existHeroNorm === _heroNormTitle) return true;
              // Check if one contains the other (handles "Write our first blog post: Hello World" vs "Hello World")
              if (_heroNormTitle.length > 10 && (_existHeroNorm.indexOf(_heroNormTitle) !== -1 || _heroNormTitle.indexOf(_existHeroNorm) !== -1)) return true;
            }
            return false;
          });

          context.log('[Heartbeat] HERO-DIAG:', agentId, 'heroTaskExists:', _heroTaskExists, 'heroTitle:', _heroTaskTitle);
          if (action.taskId) {
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[DIAG] hero dedup check — exists: ' + _heroTaskExists + ', looking for: ' + _heroTaskTitle, agentId: 'system' });
          }
          if (!_heroTaskExists) {
            // Create a task for Pixel to generate the hero image
            const heroTask = {
              id: 'task_' + Date.now() + '_hero_' + Math.random().toString(36).substr(2, 4),
              title: _heroTaskTitle,
              description: 'Generate a hero image for the blog post "' + doc.title + '".\nDocument ID: ' + doc.id + '\nUse generate-image with purpose "blog_header" and attachTo: { type: "document", id: "' + doc.id + '" }.\nChoose an appropriate preset based on the content tone.',
              taskType: 'design_asset',
              status: 'todo',
              priority: action.task && action.task.priority ? action.task.priority : 'high',
              dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
              assignee: 'pixel',
              source: 'heartbeat',
              created_by: 'system',
              parent_task_id: action.taskId || null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              campaign_id: action.campaign_id || null,
              objective_id: action.objective_id || (action.task && action.task.objective_id) || null,
              tags: ['hero-image', 'auto-created', 'visual-workflow'],
              comments: [{
                id: 'cmt-hero-' + Date.now(),
                author: 'nova',
                text: 'Pixel, generate a hero image for the blog post "' + doc.title + '" (doc: ' + doc.id + ', kind: ' + kind + '). Use generate-image with purpose blog_header and attachTo the document. Choose a preset that matches the content tone.',
                type: 'system',
                createdAt: new Date().toISOString()
              }]
            };
            tasks.push(heroTask);
            context.log('[Heartbeat]', agentId, 'AUTO-CREATED Pixel hero image task:', heroTask.id, 'for doc:', doc.id);
          } else {
            context.log('[Heartbeat]', agentId, 'Pixel hero image task already exists for doc:', doc.id, '— skipping auto-create');
          }

          // Mark doc as awaiting hero image
          doc.awaiting_hero_image = true;
          doc.updated_at = new Date().toISOString();
          const _awIdx = docsStore.findIndex(d => d.id === docId);
          if (_awIdx !== -1) docsStore[_awIdx] = doc;
          await storage.setState('documents', docsStore);

          // Comment on the originating task
          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Doc created but NOT submitted for publish yet — waiting for Pixel to generate a hero image (doc: ' + doc.id + '). Publish will happen after the hero image is attached.',
              agentId: 'system'
            });
          }

          context.log('[Heartbeat]', agentId, 'visual doc created — deferred publish, awaiting Pixel hero image:', doc.id, doc.title);
        } else {
          // Internal doc kinds (spec, runbook, release_notes, governance) — wiki-style, immediately available
          doc.visibility = 'internal';
          doc.updated_at = new Date().toISOString();
          const dIdx = docsStore.findIndex(d => d.id === docId);
          if (dIdx !== -1) docsStore[dIdx] = doc;
          await storage.setState('documents', docsStore);

          context.log('[Heartbeat]', agentId, 'internal doc saved to wiki:', doc.id, doc.title);
          result.taskUpdates.push({ action: 'doc-created', documentId: doc.id, agentId: agentId });

          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Document "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + ') added to the Document Center wiki.',
              agentId: agentId
            });
          }
        }
      }
    } else if (action.type === 'update-doc' && action.documentId) {
      // Update an existing document's content or metadata
      const docsStore = (await storage.getState('documents')) || [];
      const docIdx = docsStore.findIndex(d => d.id === action.documentId);

      if (docIdx !== -1) {
        const doc = docsStore[docIdx];
        const updates = action.updates || {};
        if (updates.content_md) doc.content_md = updates.content_md;
        if (updates.title) {
          doc.title = updates.title;
          doc.slug = updates.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        }
        if (updates.tags) doc.tags = updates.tags;
        if (updates.append_md && doc.content_md) {
          doc.content_md = doc.content_md + '\n\n' + updates.append_md;
        }
        doc.updated_at = new Date().toISOString();
        doc.last_edited_by = agentId;
        docsStore[docIdx] = doc;
        await storage.setState('documents', docsStore);

        // If doc is published internally, also update the publishedDocs store
        if (doc.visibility === 'internal' && doc.status === 'published' && doc.slug) {
          const pubStore = (await storage.getState('publishedDocs')) || [];
          const pubIdx = pubStore.findIndex(p => p.documentId === doc.id);
          if (pubIdx !== -1) {
            pubStore[pubIdx].content_md = doc.content_md;
            pubStore[pubIdx].title = doc.title;
            pubStore[pubIdx].tags = doc.tags || [];
            pubStore[pubIdx].updated_at = doc.updated_at;
            if (updates.title) {
              pubStore[pubIdx].slug = doc.slug;
              pubStore[pubIdx].target_path = '/docs/published/' + doc.slug;
              pubStore[pubIdx].public_url = '/docs/published/' + doc.slug;
            }
            await storage.setState('publishedDocs', pubStore);
          }
        }

        context.log('[Heartbeat]', agentId, 'updated doc:', doc.id, doc.title);
        result.taskUpdates.push({ action: 'doc-updated', documentId: doc.id, agentId: agentId });
      } else {
        context.log('[Heartbeat]', agentId, 'update-doc failed — doc not found:', action.documentId);
      }

    } else if (action.type === 'submit-for-publish' && action.documentId) {
      // Submit a document for human approval + publish
      // GUARDRAIL: No agent can directly publish — this only creates a publish_document action
      // that requires CEO/human approval before execution.
      const docsStore = (await storage.getState('documents')) || [];
      const docIdx = docsStore.findIndex(d => d.id === action.documentId);

      if (docIdx === -1) {
        context.log('[Heartbeat]', agentId, 'WARN: submit-for-publish skipped — doc not found:', action.documentId);
        continue;
      }

      if (docIdx !== -1) {
        const doc = docsStore[docIdx];

        // Only drafts or review docs can be submitted for publish
        if (doc.status === 'draft' || doc.status === 'review') {
          // Dedup: skip if a pending publish action already exists for this document
          const existingActs = (await storage.getState('actions')) || [];
          const hasPendingPub = existingActs.some(a => a.type === 'publish_document' && a.payload && a.payload.documentId === doc.id && a.approval && a.approval.status === 'pending');
          if (hasPendingPub) {
            context.log('[Heartbeat] Skipping duplicate submit-for-publish for doc:', doc.id, doc.title);
            continue;
          }

          // Hard guardrail: BLOCK submit-for-publish on visual doc kinds without hero image
          const VISUAL_KINDS = ['marketing_post', 'product_brief'];
          if (VISUAL_KINDS.indexOf(doc.kind) !== -1 && !doc.hero_image_asset_id) {
            context.log('[Heartbeat]', agentId, 'BLOCKED submit-for-publish on', doc.kind, 'doc without hero_image_asset_id:', doc.id, doc.title, '— waiting for Pixel hero image');
            docsStore[docIdx].missing_hero_image = true;
            await storage.setState('documents', docsStore);
            // Notify via task comment
            if (action.taskId) {
              result.taskUpdates.push({
                action: 'comment',
                taskId: action.taskId,
                comment: 'Publish BLOCKED: doc "' + doc.title + '" (' + doc.id + ') is a ' + doc.kind + ' and has no hero image yet. Waiting for Pixel to generate one. Submit again after hero_image_asset_id is set.',
                agentId: 'system'
              });
            }
            continue;
          }

          // Update doc status
          docsStore[docIdx].status = 'ready_for_approval';
          docsStore[docIdx].updated_at = new Date().toISOString();
          docsStore[docIdx].submitted_by = agentId;
          await storage.setState('documents', docsStore);

          // Generate slug from title
          const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

          // Route based on doc kind: marketing_post/product_brief → public blog, others → internal docs
          const PUBLIC_KINDS = ['marketing_post', 'product_brief'];
          const isPublic = PUBLIC_KINDS.indexOf(doc.kind) !== -1;
          const pubTargetPath = isPublic ? '/blog/' + slug : '/docs/published/' + slug;
          const pubPublicUrl = isPublic ? '/blog/' + slug : '/docs/published/' + slug;

          // Create publish_document action (requires CEO approval)
          const publishAction = {
            id: 'act_pub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            created_at: new Date().toISOString(),
            created_by: agentId,
            type: 'publish_document',
            platform: 'site',
            payload: {
              documentId: doc.id,
              title: doc.title,
              slug: slug,
              kind: doc.kind,
              content_md: doc.content_md,
              target_path: pubTargetPath,
              public_url: pubPublicUrl,
              hero_image_asset_id: doc.hero_image_asset_id || null,
              hero_image_url: null, // resolved below after imageAssets lookup
              missing_hero_image: (!doc.hero_image_asset_id && VISUAL_KINDS.indexOf(doc.kind) !== -1) || false
            },
            classification: 'executive_required',
            requires_ceo_approval: true,
            risk_level: 'medium',
            brand_impact: 'medium',
            budget_impact: 0,
            approval: {
              status: 'pending',
              approved_by: null,
              approved_at: null,
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
            // Legacy compat fields
            action_type: 'publish_document',
            action_category: 'content',
            execution_status: 'pending',
            origin_agent: agentId,
            action_payload: { documentId: doc.id, title: doc.title, slug: slug },
            requires_approval: true,
            is_irreversible: true,
            bundle_id: null
          };

          // Save action to actions store
          const actionsStore = (await storage.getState('actions')) || [];
          actionsStore.push(publishAction);
          if (actionsStore.length > 500) actionsStore.splice(0, actionsStore.length - 500);
          await storage.setState('actions', actionsStore);

          // v2.4.4: Register draft artifact for URL resolution
          const sfpArtifactId = 'art_' + Date.now() + '_' + slug;
          const sfpArtifacts = (await storage.getState('ap_artifacts')) || [];
          sfpArtifacts.push({
            id: sfpArtifactId,
            type: 'article',
            title: doc.title,
            slug: slug,
            url: null,
            status: 'draft',
            createdAt: new Date().toISOString(),
            publishedAt: null,
            source: { type: 'submit-for-publish', agentId: agentId, taskId: action.taskId || null },
            actionId: publishAction.id,
            documentId: doc.id
          });
          if (sfpArtifacts.length > 200) sfpArtifacts.splice(0, sfpArtifacts.length - 200);
          await storage.setState('ap_artifacts', sfpArtifacts);
          context.log('[Heartbeat] Registered draft artifact:', sfpArtifactId, 'for submit-for-publish action:', publishAction.id);

          // Resolve hero image URL from imageAssets store (for approval queue + drawer preview)
          let _heroImageUrl = null;
          if (doc.hero_image_asset_id) {
            try {
              const _imgAssets = (await storage.getState('imageAssets')) || [];
              const _heroAsset = _imgAssets.find(a => a.id === doc.hero_image_asset_id);
              if (_heroAsset && _heroAsset.url) _heroImageUrl = _heroAsset.url;
            } catch (_heroErr) { /* non-fatal */ }
          }
          // Backfill resolved URL into action payload so actions drawer can render it
          if (_heroImageUrl) {
            publishAction.payload.hero_image_url = _heroImageUrl;
            // Re-save action with resolved hero image URL (action was persisted before URL resolution)
            const _actStore2 = (await storage.getState('actions')) || [];
            const _actIdx2 = _actStore2.findIndex(x => x.id === publishAction.id);
            if (_actIdx2 !== -1) { _actStore2[_actIdx2] = publishAction; await storage.setState('actions', _actStore2); }
          }

          // Add to CEO approval queue
          const approvalQueue = (await storage.getState('approvalQueue')) || [];
          approvalQueue.push({
            id: 'aq-' + publishAction.id,
            kind: 'action',
            actionType: 'publish_document',
            action_id: publishAction.id,
            taskId: action.taskId || null,
            taskTitle: 'Publish: ' + doc.title,
            originAgent: agentId,
            classification: 'executive_required',
            riskLevel: 'medium',
            budgetImpact: 0,
            brandImpact: 'medium',
            status: 'pending',
            timestamp: publishAction.created_at,
            preview: (doc.content_md || '').substring(0, 120),
            documentId: doc.id,
            slug: slug,
            docKind: doc.kind,
            artifactId: sfpArtifactId,
            heroImageUrl: _heroImageUrl,
            heroImageAssetId: doc.hero_image_asset_id || null
          });
          if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
          await storage.setState('approvalQueue', approvalQueue);

          // Audit log
          const auditLog = (await storage.getState('actionAuditLog')) || [];
          auditLog.push({
            id: 'alog-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            type: 'publish-requested',
            data: {
              actionId: publishAction.id,
              documentId: doc.id,
              title: doc.title,
              slug: slug,
              submittedBy: agentId,
              taskId: action.taskId || null
            },
            timestamp: new Date().toISOString()
          });
          if (auditLog.length > 500) auditLog.splice(0, auditLog.length - 500);
          await storage.setState('actionAuditLog', auditLog);

          // Governance log
          const govLog = (await storage.getState('governanceLog')) || [];
          govLog.push({
            id: 'gov-' + Date.now(),
            type: 'publish-requested',
            data: {
              actionId: publishAction.id,
              documentId: doc.id,
              title: doc.title,
              agent: agentId
            },
            timestamp: new Date().toISOString()
          });
          if (govLog.length > 200) govLog.splice(0, govLog.length - 200);
          await storage.setState('governanceLog', govLog);

          context.log('[Heartbeat]', agentId, 'submitted doc for publish:', doc.id, doc.title, '→ action:', publishAction.id);
          result.taskUpdates.push({ action: 'publish-requested', actionId: publishAction.id, documentId: doc.id, agentId: agentId });
        } else {
          context.log('[Heartbeat]', agentId, 'cannot submit doc for publish — status is', doc.status);
        }
      }
    } else if (action.type === 'create-content-package' && action.content) {
      // Agent-initiated image content generation — routes through approval queue
      // GATE: only Echo (marketing visuals) and Pixel (design assets) can generate content
      const CONTENT_ALLOWED_AGENTS = ['echo', 'pixel'];
      if (CONTENT_ALLOWED_AGENTS.indexOf(agentId) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-content-package (only Echo/Pixel can generate images)');
        continue;
      }

      // Guardrail: max 1 content generation per heartbeat per agent
      if ((result.contentGenerates || 0) >= GUARDRAILS.maxContentGeneratesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max content generates reached, skipping');
        continue;
      }

      const cp = action.content;
      const cpTopic = (cp.topic || '').trim();
      const cpGoal = (cp.goal || '').trim();
      if (!cpTopic || cpTopic.length < 3 || !cpGoal || cpGoal.length < 3) {
        context.log('[Heartbeat]', agentId, 'create-content-package SKIPPED: topic/goal too short');
        continue;
      }

      // Load config defaults
      let _ceConfig = null;
      try { _ceConfig = await imageEngine.loadContentEngineConfig(); } catch (e) { /* use hardcoded defaults */ }

      const cpPreset = (cp.preset || (_ceConfig && _ceConfig.defaultPreset) || 'ap-neon-glass').trim();
      let cpOutputs = cp.outputs || (_ceConfig && _ceConfig.defaultOutputs) || ['x_image'];
      const cpVariations = Math.min(Math.max(parseInt(cp.variations) || 1, 1), 2); // agents capped at 2 variations

      // Validate preset
      if (!imageEngine.PRESETS || !imageEngine.PRESETS[cpPreset]) {
        context.log('[Heartbeat]', agentId, 'create-content-package SKIPPED: invalid preset:', cpPreset);
        continue;
      }

      // Validate & filter outputs
      if (imageEngine.PURPOSES) {
        cpOutputs = cpOutputs.filter(function (o) { return !!imageEngine.PURPOSES[o]; });
      }
      if (cpOutputs.length === 0) cpOutputs = ['x_image'];
      // Cap agent output types to 3 max
      if (cpOutputs.length > 3) cpOutputs = cpOutputs.slice(0, 3);

      // Usage limit check
      const accountId = 'ambientpixels-internal';
      try {
        const limitCheck = await imageEngine.checkUsageLimits(accountId);
        if (!limitCheck.allowed) {
          context.log('[Heartbeat]', agentId, 'create-content-package BLOCKED: usage limit exceeded');
          continue;
        }
      } catch (limErr) {
        context.log('[Heartbeat]', agentId, 'create-content-package: usage check failed, proceeding:', limErr.message);
      }

      context.log('[Heartbeat]', agentId, 'generating content package:', cpTopic, '| preset:', cpPreset, '| outputs:', cpOutputs.join(','), '| variations:', cpVariations);
      const genStartMs = Date.now();

      // Create brief
      const cpBriefId = 'brief_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const cpBrief = {
        id: cpBriefId,
        createdAt: new Date().toISOString(),
        createdBy: agentId,
        source: 'heartbeat',
        topic: cpTopic,
        goal: cpGoal,
        preset: cpPreset,
        outputs: cpOutputs,
        variations: cpVariations,
        status: 'generating',
        directiveId: (cp.directiveId || '').trim() || null,
        objectiveId: (cp.objectiveId || '').trim() || null
      };
      await imageEngine.saveBrief(cpBrief);

      // Generate images
      const cpPackageId = 'pkg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const cpAllOutputs = {};
      const cpThumbUrls = [];
      let cpSuccessCount = 0;
      let cpFailedCount = 0;

      for (let v = 0; v < cpVariations; v++) {
        for (let i = 0; i < cpOutputs.length; i++) {
          const outputType = cpOutputs[i];
          const outputKey = cpVariations > 1 ? outputType + '_v' + (v + 1) : outputType;
          const variationNum = v + 1;
          const prompt = imageEngine.buildPrompt({
            topic: cpTopic, goal: cpGoal, preset: cpPreset,
            outputType: outputType, variation: variationNum
          });
          try {
            context.log('[Heartbeat]', agentId, 'generating', outputKey);
            const genResult = await imageEngine.generateImage({
              topic: cpTopic, goal: cpGoal, preset: cpPreset,
              outputType: outputType, variation: variationNum,
              jobId: cpPackageId + '_' + outputKey
            });
            cpAllOutputs[outputKey] = {
              status: 'success', outputType: outputType, variation: variationNum,
              size: genResult.size, imageUrl: genResult.imageUrl, thumbUrl: genResult.thumbUrl,
              metaUrl: genResult.metaUrl, model: genResult.model, bytes: genResult.bytes, promptUsed: prompt
            };
            cpThumbUrls.push(genResult.thumbUrl);
            cpSuccessCount++;
          } catch (genErr) {
            context.log.error('[Heartbeat]', agentId, 'content gen failed:', outputKey, genErr.message);
            cpAllOutputs[outputKey] = {
              status: 'failed', outputType: outputType, variation: variationNum,
              error: genErr.message, promptUsed: prompt
            };
            cpFailedCount++;
          }
        }
      }

      // Total failure
      if (cpSuccessCount === 0) {
        cpBrief.status = 'failed';
        cpBrief.updatedAt = new Date().toISOString();
        await imageEngine.saveBrief(cpBrief);
        context.log('[Heartbeat]', agentId, 'content package generation FAILED (all images failed)');
        continue;
      }

      // Save package
      const cpDurationMs = Date.now() - genStartMs;
      const cpOverallStatus = cpFailedCount === 0 ? 'pending_approval' : 'partial_success';
      const cpPkg = {
        id: cpPackageId, briefId: cpBriefId,
        createdAt: new Date().toISOString(), generatedBy: agentId, createdBy: agentId,
        agentRole: agent.role, source: 'heartbeat', createdVia: 'heartbeat',
        directiveId: cpBrief.directiveId, objectiveId: cpBrief.objectiveId,
        accountId: accountId, accountType: 'internal',
        engineVersion: imageEngine.ENGINE_VERSION, preset: cpPreset,
        presetVersion: imageEngine.getPresetVersion(cpPreset),
        variations: cpVariations, outputs: cpAllOutputs,
        promptSummary: ('Topic: ' + cpTopic + ' — ' + cpGoal + ' (' + cpPreset + ')').substring(0, 140),
        status: cpOverallStatus, successCount: cpSuccessCount, failedCount: cpFailedCount,
        durationMs: cpDurationMs, estimatedCost: imageEngine.estimateCost(cpSuccessCount),
        model: imageEngine.GEMINI_IMAGE_MODEL, provider: imageEngine.GEMINI_IMAGE_PROVIDER
      };
      const cpPackageUrl = await imageEngine.savePackage(cpPkg);

      // Update brief
      cpBrief.status = cpOverallStatus;
      cpBrief.packageId = cpPackageId;
      cpBrief.updatedAt = new Date().toISOString();
      await imageEngine.saveBrief(cpBrief);

      // Submit to approval queue
      const cpSuccessImageUrls = [];
      Object.keys(cpAllOutputs).forEach(function (k) {
        if (cpAllOutputs[k].status === 'success' && cpAllOutputs[k].imageUrl) cpSuccessImageUrls.push(cpAllOutputs[k].imageUrl);
      });

      const cpApprovalItem = {
        id: 'aq-' + cpPackageId, kind: 'content.package', type: 'content.package',
        title: 'Content Package — ' + cpTopic,
        subtitle: cpSuccessCount + ' image' + (cpSuccessCount !== 1 ? 's' : '') + (cpFailedCount > 0 ? ', ' + cpFailedCount + ' failed' : '') + ' · ' + cpPreset + ' · by ' + agentId,
        status: 'pending', createdAt: new Date().toISOString(), createdBy: agentId,
        source: 'heartbeat', briefId: cpBriefId, packageId: cpPackageId,
        preset: cpPreset, goal: cpGoal, successCount: cpSuccessCount, failedCount: cpFailedCount,
        preview: {
          thumbs: cpThumbUrls.slice(0, 4), preset: cpPreset, goal: cpGoal,
          outputTypes: cpOutputs, successCount: cpSuccessCount, failedCount: cpFailedCount
        },
        links: {
          packageUrl: cpPackageUrl, packageViewUrl: '/modules/company/content-engine.html?pkg=' + cpPackageId,
          imageUrls: cpSuccessImageUrls
        }
      };

      const cpQueue = (await storage.getState('approvalQueue')) || [];
      cpQueue.push(cpApprovalItem);
      if (cpQueue.length > 200) cpQueue = cpQueue.slice(-200);
      await storage.setState('approvalQueue', cpQueue);

      // Write usage record
      try {
        await imageEngine.writeUsageRecord({
          accountId: accountId, accountType: 'internal', packageId: cpPackageId,
          timestamp: cpPkg.createdAt, engineVersion: imageEngine.ENGINE_VERSION,
          preset: cpPreset, presetVersion: imageEngine.getPresetVersion(cpPreset),
          formatsRequested: cpOutputs, variations: cpVariations,
          imagesGenerated: cpSuccessCount, model: imageEngine.GEMINI_IMAGE_MODEL,
          durationMs: cpDurationMs, estimatedCost: imageEngine.estimateCost(cpSuccessCount),
          status: cpOverallStatus === 'partial_success' ? 'partial' : 'success',
          createdBy: agentId, agentRole: agent.role, source: 'heartbeat'
        });
      } catch (usageErr) { context.log.warn('[Heartbeat] Usage record write failed (non-fatal):', usageErr.message); }

      // Append to gallery index
      try {
        await imageEngine.appendToIndex({
          packageId: cpPackageId, briefId: cpBriefId, preset: cpPreset, topic: cpTopic,
          createdAt: cpPkg.createdAt, status: cpOverallStatus,
          successCount: cpSuccessCount, failedCount: cpFailedCount,
          thumbs: cpThumbUrls.slice(0, 4), outputTypes: cpOutputs, variations: cpVariations,
          createdBy: agentId, source: 'heartbeat'
        });
      } catch (idxErr) { context.log.warn('[Heartbeat] Gallery index append failed (non-fatal):', idxErr.message); }

      // Auto-advance parent task to review if taskId provided
      if (action.taskId) {
        const taskIdx = tasks.findIndex(t => t.id === action.taskId);
        if (taskIdx !== -1 && tasks[taskIdx].status !== 'done' && tasks[taskIdx].status !== 'review') {
          tasks[taskIdx].status = 'review';
          tasks[taskIdx].updatedAt = new Date().toISOString();
          if (!tasks[taskIdx].comments) tasks[taskIdx].comments = [];
          tasks[taskIdx].comments.push({
            id: 'cmt-' + Date.now(), author: agentId,
            text: 'Content package created (' + cpSuccessCount + ' images, preset: ' + cpPreset + '). Submitted for CEO approval (package: ' + cpPackageId + ').',
            type: 'deliverable', createdAt: new Date().toISOString()
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', action.taskId, 'to review (content package created)');
        }
      }

      result.contentGenerates = (result.contentGenerates || 0) + 1;
      context.log('[Heartbeat]', agentId, 'content package created:', cpPackageId, cpSuccessCount, 'ok,', cpFailedCount, 'failed, duration:', cpDurationMs + 'ms');
      result.taskUpdates.push({ action: 'content-package-created', packageId: cpPackageId, agentId: agentId, taskId: action.taskId || null });

    } else if (action.type === 'generate-image' && action.image) {
      // Single image generation for blog headers, inline illustrations, social media assets
      // Allowed agents: echo, pixel, scribe (scribe can generate blog headers)
      const IMG_ALLOWED_AGENTS = ['echo', 'pixel', 'scribe'];
      if (IMG_ALLOWED_AGENTS.indexOf(agentId) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED generate-image (only echo/pixel/scribe)');
        continue;
      }

      // Guardrail: shares the content generates limit with create-content-package
      if ((result.contentGenerates || 0) >= GUARDRAILS.maxContentGeneratesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max content generates reached, skipping generate-image');
        continue;
      }

      const img = action.image;
      const imgTopic = (img.topic || '').trim();
      const imgGoal = (img.goal || '').trim();
      const imgPurpose = (img.purpose || '').trim(); // blog_header, inline_illustration, social_media
      if (!imgTopic || imgTopic.length < 3 || !imgGoal || imgGoal.length < 3) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: topic/goal too short');
        continue;
      }

      const VALID_PURPOSES = ['blog_header', 'inline_illustration', 'social_media'];
      if (!imgPurpose || VALID_PURPOSES.indexOf(imgPurpose) === -1) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: invalid purpose:', imgPurpose);
        continue;
      }

      // Load config defaults
      let _imgCeConfig = null;
      try { _imgCeConfig = await imageEngine.loadContentEngineConfig(); } catch (e) { /* defaults */ }

      const imgPreset = (img.preset || (_imgCeConfig && _imgCeConfig.defaultPreset) || 'ap-neon-glass').trim();
      // Map purpose → default outputType (agent can override)
      const PURPOSE_OUTPUT_MAP = { 'blog_header': 'blog_image', 'inline_illustration': 'blog_image', 'social_media': 'x_image' };
      const imgOutputType = (img.outputType && imageEngine.PURPOSES && imageEngine.PURPOSES[img.outputType]) ? img.outputType : PURPOSE_OUTPUT_MAP[imgPurpose];

      // Validate preset
      if (!imageEngine.PRESETS || !imageEngine.PRESETS[imgPreset]) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: invalid preset:', imgPreset);
        continue;
      }

      // Usage limit check
      const imgAccountId = 'ambientpixels-internal';
      try {
        const imgLimitCheck = await imageEngine.checkUsageLimits(imgAccountId);
        if (!imgLimitCheck.allowed) {
          context.log('[Heartbeat]', agentId, 'generate-image BLOCKED: usage limit exceeded');
          continue;
        }
      } catch (limErr) {
        context.log('[Heartbeat]', agentId, 'generate-image: usage check failed, proceeding:', limErr.message);
      }

      // Handle attachTo — declared early so early-guard can reference it
      const attachTo = img.attachTo || null;

      // Early guard: skip blog_header generation if target document already has a hero image
      if (imgPurpose === 'blog_header' && attachTo && attachTo.type === 'document' && attachTo.id) {
        const _earlyDocCheck = (await storage.getState('documents')) || [];
        const _earlyDoc = _earlyDocCheck.find(d => d.id === attachTo.id);
        if (_earlyDoc && _earlyDoc.hero_image_asset_id) {
          context.log('[Heartbeat]', agentId, 'generate-image SKIPPED (early): doc', attachTo.id, 'already has hero_image_asset_id:', _earlyDoc.hero_image_asset_id);
          continue;
        }
      }

      context.log('[Heartbeat]', agentId, 'generating image:', imgPurpose, '| topic:', imgTopic, '| preset:', imgPreset, '| outputType:', imgOutputType);
      const imgGenStartMs = Date.now();
      const imgJobId = 'img_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');

      let imgResult = null;
      try {
        imgResult = await imageEngine.generateImage({
          topic: imgTopic,
          goal: imgGoal,
          preset: imgPreset,
          outputType: imgOutputType,
          jobId: imgJobId
        });
      } catch (genErr) {
        context.log.error('[Heartbeat]', agentId, 'generate-image FAILED:', genErr.message);
        // Non-blocking: log failure and continue
        result.taskUpdates.push({ action: 'generate-image-failed', agentId: agentId, error: genErr.message });
        continue;
      }

      const imgDurationMs = Date.now() - imgGenStartMs;
      const imgAlt = (img.alt || imgTopic).substring(0, 200);

      // Build image asset record
      const imgAsset = {
        id: imgJobId,
        url: imgResult.imageUrl,
        thumbUrl: imgResult.thumbUrl,
        metaUrl: imgResult.metaUrl,
        purpose: imgPurpose,
        outputType: imgOutputType,
        preset: imgPreset,
        aspect: (imageEngine.PURPOSES[imgOutputType] && imageEngine.PURPOSES[imgOutputType].aspect) || '4:3',
        alt: imgAlt,
        model: imgResult.model,
        bytes: imgResult.bytes,
        size: imgResult.size,
        attachedTo: null,
        createdBy: agentId,
        createdAt: new Date().toISOString(),
        durationMs: imgDurationMs,
        status: 'active'
      };

      // Link asset to document or action
      if (attachTo && attachTo.type === 'document' && attachTo.id) {
        const imgDocsStore = (await storage.getState('documents')) || [];
        const imgDocIdx = imgDocsStore.findIndex(d => d.id === attachTo.id);

        if (imgDocIdx !== -1) {
          const imgDoc = imgDocsStore[imgDocIdx];

          if (imgPurpose === 'blog_header') {
            // Guard: skip if document already has a hero image attached
            if (imgDoc.hero_image_asset_id) {
              context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: doc', attachTo.id, 'already has hero_image_asset_id:', imgDoc.hero_image_asset_id, '— not overwriting');
              // Still notify Scribe that hero image is available (may have been missed on prior cycle)
              const _heroDocIdExisting = attachTo.id;
              const _originTaskExisting = tasks.find(t =>
                t.assignee === 'scribe' && t.status !== 'done' &&
                t.comments && t.comments.some(c => c.text && c.text.indexOf(_heroDocIdExisting) !== -1)
              );
              if (_originTaskExisting) {
                const _alreadyNotified = _originTaskExisting.comments.some(c => c.text && c.text.indexOf('You can now submit this document for publish') !== -1);
                if (!_alreadyNotified) {
                  if (!_originTaskExisting.comments) _originTaskExisting.comments = [];
                  _originTaskExisting.comments.push({
                    id: 'cmt-hero-ready-' + Date.now(),
                    author: 'system',
                    text: 'Hero image generated and attached to document ' + _heroDocIdExisting + ' (asset: ' + imgDoc.hero_image_asset_id + '). You can now submit this document for publish using submit-for-publish with documentId: ' + _heroDocIdExisting,
                    type: 'system',
                    createdAt: new Date().toISOString()
                  });
                  // Move task back to in-progress so Scribe acts on the submit-for-publish step
                  if (_originTaskExisting.status === 'review') {
                    _originTaskExisting.status = 'in-progress';
                    _originTaskExisting.updatedAt = new Date().toISOString();
                    context.log('[Heartbeat]', agentId, 'moved Scribe task', _originTaskExisting.id, 'from review → in-progress for submit-for-publish step');
                  }
                  context.log('[Heartbeat]', agentId, 'notified originating task', _originTaskExisting.id, 'that hero image is already attached for doc:', _heroDocIdExisting);
                }
              }
            } else {
            // Set hero_image_asset_id only — no content_md mutation
            imgDoc.hero_image_asset_id = imgJobId;
            imgDoc.updated_at = new Date().toISOString();
            imgDoc.last_edited_by = agentId;
            imgAsset.attachedTo = { type: 'document', id: attachTo.id, field: 'hero_image_asset_id' };
            context.log('[Heartbeat]', agentId, 'attached hero image asset', imgJobId, 'to doc:', attachTo.id);

            // Clear awaiting flag
            imgDoc.awaiting_hero_image = false;

            // Notify originating Scribe task that hero image is ready
            const _heroDocId = attachTo.id;
            const _originTask = tasks.find(t =>
              t.assignee === 'scribe' &&
              t.comments && t.comments.some(c => c.text && c.text.indexOf(_heroDocId) !== -1)
            );
            if (_originTask && _originTask.status !== 'done') {
              if (!_originTask.comments) _originTask.comments = [];
              _originTask.comments.push({
                id: 'cmt-hero-ready-' + Date.now(),
                author: 'system',
                text: 'Hero image generated and attached to document ' + _heroDocId + ' (asset: ' + imgJobId + '). You can now submit this document for publish using submit-for-publish with documentId: ' + _heroDocId,
                type: 'system',
                createdAt: new Date().toISOString()
              });
              // Move task back to in-progress so Scribe acts on the submit-for-publish step
              if (_originTask.status === 'review') {
                _originTask.status = 'in-progress';
                _originTask.updatedAt = new Date().toISOString();
                context.log('[Heartbeat]', agentId, 'moved Scribe task', _originTask.id, 'from review → in-progress for submit-for-publish step');
              }
              context.log('[Heartbeat]', agentId, 'notified originating task', _originTask.id, 'that hero image is ready for doc:', _heroDocId);
            } else {
              // Scribe task already done — auto-submit for publish since no agent will do it
              var _heroDoc = imgDoc;
              if (_heroDoc && _heroDoc.kind && ['marketing_post', 'product_brief'].indexOf(_heroDoc.kind) !== -1 && _heroDoc.status !== 'published') {
                context.log('[Heartbeat]', agentId, 'Scribe task already done — auto-injecting submit-for-publish for doc:', _heroDocId);
                actions.push({ type: 'submit-for-publish', documentId: _heroDocId, taskId: _originTask ? _originTask.id : null, _systemInjected: true });
              }
            }
            } // end of else (no existing hero image)
          } else if (imgPurpose === 'inline_illustration') {
            // Token replacement: {{IMAGE:slot}} → ![alt](url)
            const imgSlot = (img.slot || 'default').trim();
            const imgToken = '{{IMAGE:' + imgSlot + '}}';
            // Dedup: skip entirely if this slot was already filled on this doc
            const _existingSlots = (imgDoc.inline_image_assets || []).map(function (a) { return a.slot; });
            if (_existingSlots.indexOf(imgSlot) !== -1) {
              context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: slot', imgSlot, 'already filled on doc:', attachTo.id);
            } else {
              if (imgDoc.content_md && imgDoc.content_md.indexOf(imgToken) !== -1) {
                imgDoc.content_md = imgDoc.content_md.replace(imgToken, '![' + imgAlt + '](' + imgResult.imageUrl + ')');
                context.log('[Heartbeat]', agentId, 'replaced token', imgToken, 'in doc:', attachTo.id);
              } else {
                // Fallback: append at end
                imgDoc.content_md = (imgDoc.content_md || '') + '\n\n![' + imgAlt + '](' + imgResult.imageUrl + ')';
                context.log('[Heartbeat]', agentId, 'appended inline image to doc:', attachTo.id, '(token', imgToken, 'not found)');
              }
              imgDoc.updated_at = new Date().toISOString();
              imgDoc.last_edited_by = agentId;
              if (!imgDoc.inline_image_assets) imgDoc.inline_image_assets = [];
              imgDoc.inline_image_assets.push({ assetId: imgJobId, slot: imgSlot });
              imgAsset.attachedTo = { type: 'document', id: attachTo.id, field: 'inline', slot: imgSlot };
              context.log('[Heartbeat]', agentId, 'attached inline image asset', imgJobId, 'to doc:', attachTo.id);
            }
          }

          imgDocsStore[imgDocIdx] = imgDoc;
          await storage.setState('documents', imgDocsStore);

          // If doc is published internally, update published copy too
          if (imgDoc.visibility === 'internal' && imgDoc.status === 'published' && imgDoc.slug) {
            const imgPubStore = (await storage.getState('publishedDocs')) || [];
            const imgPubIdx = imgPubStore.findIndex(p => p.documentId === imgDoc.id);
            if (imgPubIdx !== -1) {
              if (imgPurpose === 'blog_header') imgPubStore[imgPubIdx].hero_image_asset_id = imgJobId;
              if (imgPurpose === 'inline_illustration') imgPubStore[imgPubIdx].content_md = imgDoc.content_md;
              imgPubStore[imgPubIdx].updated_at = imgDoc.updated_at;
              await storage.setState('publishedDocs', imgPubStore);
            }
          }
        } else {
          context.log('[Heartbeat]', agentId, 'generate-image: attachTo document not found:', attachTo.id);
        }
      } else if (attachTo && attachTo.type === 'action' && attachTo.id) {
        // Attach image to a pending social action's media array
        const imgActionsStore = (await storage.getState('actions')) || [];
        const imgActIdx = imgActionsStore.findIndex(a => a.id === attachTo.id);

        if (imgActIdx !== -1) {
          const imgAct = imgActionsStore[imgActIdx];
          // Only mutate if still pending approval
          if (imgAct.approval && imgAct.approval.status === 'pending') {
            if (!imgAct.payload) imgAct.payload = {};
            if (!imgAct.payload.media) imgAct.payload.media = [];
            // Cap at 1 media item for now
            if (imgAct.payload.media.length < 1) {
              imgAct.payload.media.push({ type: 'image', url: imgResult.imageUrl, alt: imgAlt, assetId: imgJobId });
              imgActionsStore[imgActIdx] = imgAct;
              await storage.setState('actions', imgActionsStore);
              imgAsset.attachedTo = { type: 'action', id: attachTo.id, field: 'media' };
              context.log('[Heartbeat]', agentId, 'attached image to action:', attachTo.id);
            } else {
              context.log('[Heartbeat]', agentId, 'generate-image: action', attachTo.id, 'already has max media items');
            }
          } else {
            context.log('[Heartbeat]', agentId, 'generate-image: action', attachTo.id, 'not in pending status, skipping media attach');
          }
        } else {
          context.log('[Heartbeat]', agentId, 'generate-image: attachTo action not found:', attachTo.id);
        }
      }

      // Persist asset to imageAssets registry
      try {
        const imgAssetsStore = (await storage.getState('imageAssets')) || [];
        imgAssetsStore.push(imgAsset);
        if (imgAssetsStore.length > 500) imgAssetsStore.splice(0, imgAssetsStore.length - 500);
        await storage.setState('imageAssets', imgAssetsStore);
      } catch (assetStoreErr) {
        context.log.error('[Heartbeat]', agentId, 'generate-image: imageAssets persist FAILED (non-fatal):', assetStoreErr.message);
      }

      // Write usage record
      try {
        await imageEngine.writeUsageRecord({
          accountId: imgAccountId, accountType: 'internal', packageId: imgJobId,
          timestamp: imgAsset.createdAt, engineVersion: imageEngine.ENGINE_VERSION,
          preset: imgPreset, presetVersion: imageEngine.getPresetVersion(imgPreset),
          formatsRequested: [imgOutputType], variations: 1,
          imagesGenerated: 1, model: imageEngine.GEMINI_IMAGE_MODEL,
          durationMs: imgDurationMs, estimatedCost: imageEngine.estimateCost(1),
          status: 'success', createdBy: agentId, agentRole: agent.role,
          source: 'heartbeat', actionType: 'generate-image', purpose: imgPurpose
        });
      } catch (usageErr) { context.log.warn('[Heartbeat] generate-image usage record failed (non-fatal):', usageErr.message); }

      // Auto-advance parent task: all image tasks → review (hero images stay in review until attached to blog)
      if (action.taskId) {
        const imgTaskIdx = tasks.findIndex(t => t.id === action.taskId);
        if (imgTaskIdx !== -1 && tasks[imgTaskIdx].status !== 'done') {
          tasks[imgTaskIdx].status = 'review';
          tasks[imgTaskIdx].updatedAt = new Date().toISOString();
          if (!tasks[imgTaskIdx].comments) tasks[imgTaskIdx].comments = [];
          tasks[imgTaskIdx].comments.push({
            id: 'cmt-' + Date.now(), author: agentId,
            text: 'Generated ' + imgPurpose + ' image (asset: ' + imgJobId + ', preset: ' + imgPreset + ').' + (imgAsset.attachedTo ? ' Attached to ' + imgAsset.attachedTo.type + ' ' + imgAsset.attachedTo.id + '.' : ''),
            type: 'deliverable', createdAt: new Date().toISOString(),
            imageUrl: imgAsset.url || null,
            thumbUrl: imgAsset.thumbUrl || imgAsset.url || null,
            assetId: imgJobId
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', action.taskId, 'to review (image generated)');
        }
      }

      result.contentGenerates = (result.contentGenerates || 0) + 1;
      context.log('[Heartbeat]', agentId, 'image generated:', imgJobId, imgPurpose, imgOutputType, imgDurationMs + 'ms');
      result.taskUpdates.push({ action: 'image-generated', assetId: imgJobId, purpose: imgPurpose, agentId: agentId, taskId: action.taskId || null, attachedTo: imgAsset.attachedTo });

    } else if (action.type === 'remember' && action.memory) {
      // Agent saves a persistent memory (hardened Phase 1E + 1F manual gate)
      const mem = action.memory;
      const _memNow = new Date();
      const _memNowIso = _memNow.toISOString();
      let _memOk = false;
      let _memBlockedReason = null;

      // Manual mode gate: block all memory writes
      if (normalizedActivationMode === 'manual') {
        _memBlockedReason = 'mode_gate_manual';
        await logEvent('policy-violation', agentId, 'Memory write blocked: manual mode', runId, {
          runId: runId, agentId: agentId, gate: 'mode_gate', reason: 'manual_blocks_remember'
        });
      } else if (!mem.text || mem.text.trim().length === 0) {
        _memBlockedReason = 'empty_text';
      } else {
        const _memType = (mem.type || '').trim().toLowerCase();

        // Type validation
        if (!_memType || !L4_ALLOWED_TYPES.has(_memType)) {
          _memBlockedReason = 'invalid_type';
          await logEvent('policy-violation', agentId, 'Memory write blocked: invalid type', runId, {
            runId: runId, agentId: agentId, gate: 'memory_schema', reason: 'invalid_type', type: mem.type || null
          });
        }
        // Evidence requirement for preferred AmbientCore types
        else if (L4_PREFERRED_TYPES.has(_memType) && (!mem.evidence || typeof mem.evidence !== 'object' || !mem.evidence.runId)) {
          _memBlockedReason = 'missing_evidence';
          await logEvent('policy-violation', agentId, 'Memory write blocked: preferred type requires evidence', runId, {
            runId: runId, agentId: agentId, gate: 'memory_schema', reason: 'missing_evidence', type: _memType
          });
        }
        // Daily rate-cap
        else if (_getMemWriteCount(agentId) >= MAX_L4_WRITES_PER_AGENT_PER_DAY) {
          _memBlockedReason = 'daily_cap_exceeded';
          await logEvent('policy-violation', agentId, 'Memory write blocked: daily cap exceeded', runId, {
            runId: runId, agentId: agentId, gate: 'memory_rate_cap', reason: 'daily_cap_exceeded',
            cap: MAX_L4_WRITES_PER_AGENT_PER_DAY, current: _getMemWriteCount(agentId)
          });
        }
        // All checks passed — store
        else {
          if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
          var _memExpiresAt = mem.expiresAt || new Date(_memNow.getTime() + L4_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
          _agentMemoryStore[agentId].push({
            id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            type: _memType,
            text: mem.text.trim().substring(0, 300),
            source: cycleId,
            timestamp: mem.ts || _memNowIso,
            expiresAt: _memExpiresAt,
            evidence: L4_PREFERRED_TYPES.has(_memType) ? mem.evidence : undefined
          });
          // Cap per-agent memories
          if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
            _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
          }
          _incMemWrite(agentId);
          _memOk = true;
          context.log('[Heartbeat]', agentId, 'saved memory:', mem.text.substring(0, 80));
          result.taskUpdates.push({ action: 'memory-saved', agentId: agentId });
        }
      }

      await logEvent('memory-write-attempt', agentId, _memOk ? 'Memory saved' : 'Memory blocked: ' + _memBlockedReason, runId, {
        runId: runId, agentId: agentId, ok: _memOk, type: (mem.type || null), blockedReason: _memBlockedReason
      });
    } else if (action.type === 'create-reminder' && action.reminder) {
      // Agent sets a reminder/date in the workspace dates store
      const rem = action.reminder;
      if (rem.title && rem.date) {
        const dates = (await storage.getState('dates')) || [];

        // Dedup: skip if a date with the same title + date already exists
        const normTitle = rem.title.trim().toLowerCase();
        const normDate = rem.date.substring(0, 10);
        const isDupe = dates.some(d =>
          d.title && d.title.trim().toLowerCase() === normTitle && d.date === normDate
        );
        if (isDupe) {
          context.log('[Heartbeat]', agentId, 'SKIPPED duplicate reminder:', rem.title, normDate);
          continue;
        }

        const VALID_TYPES = ['event', 'deadline', 'milestone', 'recurring'];
        const dateEntry = {
          id: 'date_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          title: rem.title.substring(0, 200),
          date: normDate,
          type: (rem.type && VALID_TYPES.indexOf(rem.type) !== -1) ? rem.type : 'deadline',
          description: (rem.description || '').substring(0, 500),
          created_by: agentId,
          created_at: new Date().toISOString()
        };

        dates.push(dateEntry);
        if (dates.length > 200) dates.splice(0, dates.length - 200);
        await storage.setState('dates', dates);

        context.log('[Heartbeat]', agentId, 'created reminder:', dateEntry.id, dateEntry.title, dateEntry.date);
        result.taskUpdates.push({ action: 'reminder-created', dateId: dateEntry.id, agentId: agentId });
      }
    }

    await logEvent('agent-action', agentId, summary, cycleId);
    recentSummaries.add(summary);
    actionCount++;
  }

  result.actions = actionCount;

  // 0-action diagnostic: log why agent did nothing
  if (actionCount === 0 && agentTasks.length > 0) {
    const _idleTodo = agentTasks.filter(t => t.status === 'todo' || t.status === 'in-progress');
    const _triagedCount = _idleTodo.filter(t => t.comments && t.comments.some(c => c.author === 'nova' || c.author === 'system')).length;
    context.log('[Heartbeat] ZERO-ACTION DIAGNOSTIC:', agentId,
      '| assigned:', agentTasks.length,
      '| todo/in-progress:', _idleTodo.length,
      '| triaged:', _triagedCount,
      '| rawActionsFromLLM:', result.actionAttempts,
      '| dedupeExemptTypes: execute-task,create-doc,create-social-action,generate-image,create-content-package,review-task');
  }

  // ── Phase 2B: Process normalized proposals from new-format or explicit agent proposals ──
  for (var _pi = 0; _pi < normalized.proposals.length; _pi++) {
    var _agentProp = normalized.proposals[_pi];
    if (!_agentProp || typeof _agentProp !== 'object') continue;
    // Ensure required fields for validation — fill agent context if missing
    if (!_agentProp.agentId) _agentProp.agentId = agentId;
    if (!_agentProp.runId) _agentProp.runId = cycleId;
    if (!_agentProp.reasonBlocked) _agentProp.reasonBlocked = 'agent_proposed';
    if (!_agentProp.proposedAction) _agentProp.proposedAction = 'agent_suggestion';
    // Fix 7: Auto-wrap proposals missing payload — LLM sometimes returns flat proposals without nested payload
    if (!_agentProp.payload) {
      _agentProp.payload = {
        title: _agentProp.title || _agentProp.summary || _agentProp.proposedAction || 'Agent suggestion',
        category: _agentProp.category || 'maintenance',
        acceptanceCriteria: _agentProp.acceptanceCriteria || ['Define success criteria.'],
        evidence: { runId: _agentProp.runId, agentId: _agentProp.agentId, autoWrapped: true },
        objective_suggestion: _agentProp.objective_suggestion || _agentProp.objective_id || 'Agent-proposed improvement'
      };
    }
    // Fix 7b: Ensure objective linkage even if payload existed but lacked it
    if (_agentProp.payload && !_agentProp.payload.objective_id && !_agentProp.payload.objective_suggestion) {
      _agentProp.payload.objective_suggestion = _agentProp.objective_suggestion || _agentProp.objective_id || 'Agent-proposed improvement';
    }
    var _normProp = _normalizeProposal(_agentProp);
    if (_isValidProposal(_normProp)) {
      result.proposals.push(_normProp);
      context.log('[Heartbeat]', agentId, 'accepted new-format proposal:', (_normProp.payload && _normProp.payload.title) || '(untitled)');
    } else {
      context.log('[Heartbeat]', agentId, 'rejected invalid new-format proposal:', JSON.stringify({ type: _normProp && _normProp.type, agentId: _normProp && _normProp.agentId, runId: _normProp && _normProp.runId, hasPayload: !!(_normProp && _normProp.payload), hasTitle: !!(_normProp && _normProp.payload && _normProp.payload.title), hasCategory: !!(_normProp && _normProp.payload && _normProp.payload.category), hasAC: !!(_normProp && _normProp.payload && Array.isArray(_normProp.payload.acceptanceCriteria) && _normProp.payload.acceptanceCriteria.length > 0), hasEvidence: !!(_normProp && _normProp.payload && _normProp.payload.evidence && _normProp.payload.evidence.runId), hasObjective: !!(_normProp && _normProp.payload && (_normProp.payload.objective_id || _normProp.payload.objective_suggestion)), reasonBlocked: _normProp && _normProp.reasonBlocked, proposedAction: _normProp && _normProp.proposedAction }).substring(0, 500));
    }
  }

  // ── Phase 2B: Log normalized observations (replaces legacy parsed.observation) ──
  let _obsClamped = false;
  let _observationItems = normalized.observations.map(function (o) {
    if (typeof o === 'string') return o;
    if (o === null || o === undefined) return '';
    return String(o);
  }).filter(function (o) { return o.trim().length > 0; });
  if (_observationItems.length > MAX_OBSERVATIONS_PER_AGENT) {
    _observationItems = _observationItems.slice(0, MAX_OBSERVATIONS_PER_AGENT);
    _obsClamped = true;
  }
  _observationItems = _observationItems.map(function (o) {
    if (o.length > MAX_OBSERVATION_CHARS) {
      _obsClamped = true;
      return o.substring(0, MAX_OBSERVATION_CHARS);
    }
    return o;
  });
  if (_obsClamped) {
    if (typeof incPolicyGate === 'function') incPolicyGate('observation_clamp');
    await logEvent('policy-violation', agentId, 'Observation clamp applied', cycleId, {
      runId: cycleId,
      agentId: agentId,
      gate: 'observation_clamp',
      reason: 'exceeded_limits'
    });
  }

  for (var _obsIdx = 0; _obsIdx < _observationItems.length; _obsIdx++) {
    var _obs = _observationItems[_obsIdx];
    if (_obs && !recentSummaries.has(_obs)) {
      await logEvent('agent-action', agentId, agent.name + ': ' + _obs, cycleId);
    }
  }

  result.durationMs = Date.now() - _agentRunStartMs;
  return result;
}

module.exports = { runAgentHeartbeat };
