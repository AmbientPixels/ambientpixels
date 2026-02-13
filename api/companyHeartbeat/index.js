// companyHeartbeat — Timer Trigger (every 30 minutes)
// Runs agent heartbeat cycles: reviews tasks, takes actions, logs activity
// Uses existing agentchat endpoint pattern for Gemini calls

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

const AGENT_IDS = ['cipher', 'pixel', 'forge', 'echo', 'nova', 'scribe', 'quill'];

// Agent system prompts (abbreviated for heartbeat context)
const AGENT_ROLES = {
  nova: { name: 'Nova', role: 'Prime Operator', tier: 2, focus: 'execution planning, delegation, progress monitoring, escalation to CEO' },
  cipher: { name: 'Cipher', role: 'CFO', tier: 3, focus: 'budgets, API costs, resource efficiency, spending' },
  pixel: { name: 'Pixel', role: 'Design & QC', tier: 3, focus: 'UI quality, accessibility, design consistency, frontend' },
  forge: { name: 'Forge', role: 'DevOps', tier: 3, focus: 'deployments, infrastructure, uptime, backend security' },
  echo: { name: 'Echo', role: 'Marketing', tier: 3, focus: 'content, social media, community, brand voice' },
  scribe: { name: 'Scribe', role: 'Marketing — Draft Writer', tier: 4, reportsTo: 'echo', focus: 'longform drafts, product briefs, doc drafts, social threads' },
  quill: { name: 'Quill', role: 'Marketing — Editor & Brand Voice', tier: 4, reportsTo: 'echo', focus: 'editing, compression, brand consistency, CTA polish' }
};

// Decision classification thresholds
const CFO_THRESHOLD = 100; // budget_impact above this requires CEO approval

// ── Guardrails ──
const GUARDRAILS = {
  maxActionsPerCyclePerAgent: 3,
  maxGeminiCallsPerCycle: 15, // Tier 4 sub-agents are gated; only consume calls when triggered
  maxNewTasksPerCycle: 5,
  maxExecutesPerCyclePerAgent: 1,
  maxEscalationsPerCycle: 3,
  dedupeWindowMs: 300000 // 5 min
};

// ── Tier 4 Sub-Agent Gating ──
const TIER4_SUB_AGENTS = new Set(['scribe', 'quill']);
const SUB_AGENT_MENTION_WINDOW_HOURS = 24;

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
  var agentName = (AGENT_ROLES[agentId] && AGENT_ROLES[agentId].name) || agentId;
  var needle = ('@' + agentName).toLowerCase();

  return tasks.some(function (t) {
    var comments = Array.isArray(t.comments) ? t.comments : [];
    return comments.some(function (c) {
      var text = String(c.text || c.comment || c.body || '').trim().toLowerCase();
      var ts = c.createdAt || c.created_at || c.timestamp || c.time || null;
      return text.indexOf(needle) !== -1 && _isRecent(ts, SUB_AGENT_MENTION_WINDOW_HOURS);
    });
  });
}

function shouldRunTier4Agent(tasks, agentId) {
  if (!TIER4_SUB_AGENTS.has(agentId)) return { run: true, reason: 'not_tier4_subagent' };
  if (_hasAssignedActiveTasks(tasks, agentId)) return { run: true, reason: 'assigned_active_task' };
  if (_hasRecentMention(tasks, agentId)) return { run: true, reason: 'recent_mention_ping' };
  return { run: false, reason: 'no_assigned_tasks_or_mentions' };
}

module.exports = async function (context) {
  const cycleId = 'cycle-' + Date.now();
  const cycleStart = new Date().toISOString();
  let geminiCalls = 0;
  let newTasksCreated = 0;
  const agentActions = {};
  const _pendingEscalations = [];
  const skippedAgents = [];

  context.log('[Heartbeat] Starting cycle:', cycleId);

  try {
    if (!GEMINI_API_KEY) {
      context.log.warn('[Heartbeat] No GEMINI_API_KEY — skipping');
      await logEvent('heartbeat', null, 'Heartbeat skipped: no API key', cycleId);
      return;
    }

    // Load current state
    const tasks = (await storage.getState('tasks')) || [];
    const configs = (await storage.getState('agentConfigs')) || {};
    const recentLogs = await storage.getLogs({ limit: 50 });

    // Dedupe check: get recent log summaries to avoid repeats
    const recentSummaries = new Set();
    const dedupeAfter = Date.now() - GUARDRAILS.dedupeWindowMs;
    recentLogs.forEach(function (l) {
      if (new Date(l.timestamp).getTime() > dedupeAfter && l.summary) {
        recentSummaries.add(l.summary);
      }
    });

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
          context, agentId, tasks, configs, recentSummaries, cycleId
        );
        geminiCalls += result.geminiCalls;
        agentActions[agentId] = result.actions;

        // Apply task mutations
        if (result.taskUpdates && result.taskUpdates.length > 0) {
          for (const update of result.taskUpdates) {
            if (newTasksCreated >= GUARDRAILS.maxNewTasksPerCycle && update.action === 'create') {
              context.log('[Heartbeat] Max new tasks reached, skipping create');
              continue;
            }
            applyTaskUpdate(tasks, update, _pendingEscalations);
            if (update.action === 'create') newTasksCreated++;
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
        await logEvent('error', agentId, 'Heartbeat failed: ' + err.message, cycleId);
      }
    }

    // Persist updated state
    await storage.setState('tasks', tasks);
    await storage.setState('agentConfigs', configs);

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

    context.log('[Heartbeat] Cycle complete:', cycleId, '| Gemini calls:', geminiCalls, '| New tasks:', newTasksCreated, '| Skipped:', skippedAgents.length, '| Tier4 ran:', ranTier4.join(', ') || 'none');

  } catch (err) {
    context.log.error('[Heartbeat] Fatal error:', err.message);
    await logEvent('error', null, 'Heartbeat fatal: ' + err.message, cycleId);
  }
};

// ── Run a single agent's heartbeat ──
async function runAgentHeartbeat(context, agentId, tasks, configs, recentSummaries, cycleId) {
  const result = { geminiCalls: 0, actions: 0, taskUpdates: [] };
  const agent = AGENT_ROLES[agentId];
  if (!agent) return result;

  // Build context for the agent
  const agentTasks = tasks.filter(t => t.assignee === agentId && t.status !== 'done');
  const allActiveTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'backlog');

  const prompt = buildHeartbeatPrompt(agent, agentTasks, allActiveTasks);

  // Call Gemini
  const response = await callGemini(prompt);
  result.geminiCalls = 1;

  if (!response) {
    context.log('[Heartbeat]', agentId, 'got no response');
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

  if (!parsed) {
    // Log the raw response as activity even if not structured
    const summary = agent.name + ' heartbeat: ' + (response || '').substring(0, 120);
    if (!recentSummaries.has(summary)) {
      await logEvent('agent-action', agentId, summary, cycleId);
      result.actions = 1;
    }
    return result;
  }

  // Process structured actions
  const actions = parsed.actions || [];
  let actionCount = 0;

  // Tier 4 sub-agent action restrictions (server-side enforcement)
  const TIER4_FORBIDDEN = ['create-social-action'];
  const isTier4 = agent.tier === 4;

  for (const action of actions) {
    if (actionCount >= GUARDRAILS.maxActionsPerCyclePerAgent) break;

    // Block forbidden actions for Tier 4 sub-agents
    if (isTier4 && TIER4_FORBIDDEN.indexOf(action.type) !== -1) {
      context.log('[Heartbeat]', agentId, 'BLOCKED forbidden action:', action.type, '(Tier 4 restriction)');
      continue;
    }

    const summary = agent.name + ': ' + (action.summary || action.type || 'action');

    // Dedupe
    if (recentSummaries.has(summary)) {
      context.log('[Heartbeat]', agentId, 'skipping duplicate:', summary);
      continue;
    }

    if (action.type === 'create-task' && action.task) {
      result.taskUpdates.push({
        action: 'create',
        task: {
          title: action.task.title || 'Untitled',
          description: action.task.description || '',
          status: action.task.status || 'backlog',
          priority: action.task.priority || 'medium',
          assignee: action.task.assignee || agentId,
          division: action.task.division || null,
          dueDate: action.task.dueDate || null
        }
      });
    } else if (action.type === 'update-task' && action.taskId) {
      result.taskUpdates.push({
        action: 'update',
        taskId: action.taskId,
        updates: action.updates || {}
      });
    } else if (action.type === 'move-task' && action.taskId && action.newStatus) {
      result.taskUpdates.push({
        action: 'move',
        taskId: action.taskId,
        newStatus: action.newStatus
      });
    } else if (action.type === 'execute-task' && action.taskId) {
      // Execute: agent produces actual work on a task (costs 1 extra Gemini call)
      if (result.executes >= GUARDRAILS.maxExecutesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max executes reached, skipping');
      } else {
        const task = tasks.find(t => t.id === action.taskId);
        if (task) {
          const deliverable = await executeTask(context, agent, task);
          result.geminiCalls++;
          if (deliverable) {
            result.taskUpdates.push({
              action: 'execute',
              taskId: action.taskId,
              deliverable: deliverable,
              agentId: agentId
            });
            result.executes = (result.executes || 0) + 1;
          }
        }
      }
    } else if (action.type === 'create-social-action' && action.social) {
      // Agent-initiated social post action — routes through action layer governance
      const socialPayload = action.social;
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
      actionsStore.push(newAction);
      await storage.setState('actions', actionsStore);

      // Add to approval queue
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      approvalQueue.push({
        id: 'aq-' + newAction.id,
        kind: 'action',
        action_id: newAction.id,
        taskId: null,
        taskTitle: newAction.type + ' (' + newAction.platform + ')',
        originAgent: agentId,
        classification: newAction.classification,
        riskLevel: newAction.risk_level,
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: (newAction.payload && newAction.payload.text) ? newAction.payload.text.substring(0, 120) : ''
      });
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);

      context.log('[Heartbeat]', agentId, 'created social action:', newAction.id, newAction.type, newAction.platform);
      result.taskUpdates.push({ action: 'social-action-created', actionId: newAction.id, agentId: agentId });
    } else if (action.type === 'comment-task' && action.taskId && action.comment) {
      result.taskUpdates.push({
        action: 'comment',
        taskId: action.taskId,
        comment: action.comment,
        agentId: agentId
      });
    } else if (action.type === 'review-task' && action.taskId) {
      // Review: agent reviews another agent's deliverable (costs 1 extra Gemini call)
      const task = tasks.find(t => t.id === action.taskId && t.status === 'review');
      if (task) {
        const review = await reviewTask(context, agent, task);
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
    } else if (action.type === 'create-doc' && action.document) {
      // Create a documentation draft — stored in documents store
      const docPayload = action.document;
      const VALID_DOC_KINDS = ['spec', 'runbook', 'release_notes', 'product_brief', 'marketing_post', 'governance'];
      const kind = docPayload.kind || 'product_brief';

      if (docPayload.title && VALID_DOC_KINDS.indexOf(kind) !== -1) {
        const doc = {
          id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          title: docPayload.title,
          kind: kind,
          status: 'draft',
          tags: Array.isArray(docPayload.tags) ? docPayload.tags : [],
          created_by: agentId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          content_md: docPayload.content_md || '',
          source: { action_id: null, task_id: null }
        };

        const docsStore = (await storage.getState('documents')) || [];
        docsStore.push(doc);
        if (docsStore.length > 500) docsStore.splice(0, docsStore.length - 500);
        await storage.setState('documents', docsStore);

        context.log('[Heartbeat]', agentId, 'created doc draft:', doc.id, doc.title);
        result.taskUpdates.push({ action: 'doc-created', documentId: doc.id, agentId: agentId });
      }
    }

    await logEvent('agent-action', agentId, summary, cycleId);
    recentSummaries.add(summary);
    actionCount++;
  }

  result.actions = actionCount;

  // Log agent observation if present
  if (parsed.observation && !recentSummaries.has(parsed.observation)) {
    await logEvent('agent-action', agentId, agent.name + ': ' + parsed.observation, cycleId);
  }

  return result;
}

// ── Build heartbeat prompt ──
function buildHeartbeatPrompt(agent, agentTasks, allActiveTasks) {
  const taskList = agentTasks.map(t =>
    '- [' + t.status + '] ' + t.title + ' (priority: ' + t.priority + ', id: ' + t.id + ')'
  ).join('\n') || '(none assigned)';

  const otherTasks = allActiveTasks
    .filter(t => t.assignee !== agent.name.toLowerCase())
    .slice(0, 8)
    .map(t => '- [' + t.status + '] ' + t.title + ' (' + (t.assignee || 'unassigned') + ')')
    .join('\n') || '(none)';

  // Find tasks in review from other agents (for potential review action)
  const reviewableTasks = allActiveTasks
    .filter(t => t.status === 'review' && t.assignee !== agent.name.toLowerCase() && t.comments && t.comments.some(c => c.type === 'deliverable'))
    .slice(0, 3)
    .map(t => '- [review] ' + t.title + ' (by ' + (t.assignee || 'unassigned') + ', id: ' + t.id + ')')
    .join('\n') || '(none)';

  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.

This is an automated heartbeat check. Review your current tasks and the company task board, then decide what actions to take (if any). Not every heartbeat needs action — only act if something is genuinely needed.

YOUR TASKS:
${taskList}

OTHER ACTIVE TASKS:
${otherTasks}

TASKS AWAITING REVIEW (from other agents — you can review these):
${reviewableTasks}

CURRENT TIME: ${new Date().toISOString()}

Respond with ONLY valid JSON in this exact format:
{
  "observation": "One sentence about what you notice or your current state",
  "actions": [
    {
      "type": "create-task|update-task|move-task|execute-task|review-task|comment-task|create-social-action|create-doc",
      "summary": "Brief description of what you're doing",
      "task": { "title": "", "description": "", "priority": "low|medium|high|critical", "assignee": "agentId", "dueDate": "2026-02-20T00:00:00Z" },
      "taskId": "existing-task-id",
      "updates": { "description": "...", "assignee": "agentId", "priority": "high", "dueDate": "2026-02-20T00:00:00Z" },
      "newStatus": "todo|in-progress|review|done",
      "comment": "Your comment text here",
      "social": { "text": "Post content", "platform": "x|linkedin|bluesky", "media": ["https://..."], "scheduled_for": "2026-02-14T09:00:00Z" },
      "document": { "title": "Doc Title", "kind": "spec|runbook|release_notes|product_brief|marketing_post|governance", "tags": ["tag1"], "content_md": "# Heading\n\nMarkdown content..." }
    }
  ]
}

Action types:
- create-task: Create a new task. Include "task" with title, description, priority, assignee (agent id), and dueDate (ISO datetime, realistic: 1-7 days out).
- update-task: Update an existing task. Provide taskId and "updates" with any of: description, assignee, priority, dueDate, tags.
- move-task: Move a task to a new status column. Provide taskId and newStatus.
- execute-task: Pick up one of YOUR in-progress or todo tasks and produce actual work output (a report, analysis, draft, recommendation, audit, etc). This will generate a deliverable and move the task to review.
- review-task: Review a completed deliverable from another agent's task in the review column. Approve (done) or request changes (back to in-progress).
- comment-task: Add a comment to any task. Provide taskId and "comment" string. Use for status updates, delegation notes, questions, or flagging blockers.
- create-social-action: (Marketing/Echo) Draft a social media post routed through CEO approval. Include "social" with: text (max 280 for X, 300 for Bluesky, 3000 for LinkedIn), platform ("x"|"linkedin"|"bluesky"), optionally media (URLs) and scheduled_for (ISO datetime).
- create-doc: Create a documentation draft. Include "document" with: title (string), kind ("spec"|"runbook"|"release_notes"|"product_brief"|"marketing_post"|"governance"), tags (array of strings), and content_md (full markdown content). Docs are created as drafts and require CEO approval to finalize.

Rules:
- actions array can be empty if nothing needs doing
- Max 3 actions per heartbeat
- Max 1 execute-task per heartbeat (it's thorough work)
- Only create tasks that are genuinely useful
- Only move tasks if you have reason to
- Prefer execute-task on your own in-progress tasks when you have work to do
- Review other agents' work when tasks are waiting in review
- Keep observations brief and factual
- When creating tasks, always set an assignee and a realistic dueDate
- Use update-task to assign unassigned tasks, adjust priorities, or set missing due dates
- Use comment-task to leave delegation notes, ask questions, or flag blockers` + (agent.name === 'Nova' ? `
- PRIME OPERATOR DUTIES (Nova): You are the operational lead. Manage the board with restraint:
  - Only assign tasks that are currently unassigned — never reassign an already-assigned task unless it is stuck or blocked
  - Only set dueDate on tasks that have no dueDate — never change an existing due date unless the objective changed
  - Only re-prioritize a task if a directive or objective changed, or the task has been stale (no update in >48h)
  - Always add a comment-task explaining WHY when you change assignee, priority, or dueDate
  - Never modify a task you created in the same heartbeat cycle
  - Move stale tasks forward or flag blockers with comment-task
  - Review other agents' deliverables promptly
  - Keep the board clean: close completed work, reassign only truly stuck tasks
  - When in doubt, observe and comment rather than change — avoid oscillation` : '') + (agent.name === 'Scribe' ? `
- SUB-AGENT RESTRICTIONS (Scribe — Tier 4, reports to Echo):
  - You are a draft writer. Your job is to produce longform content: product briefs, blog drafts, doc drafts, social threads.
  - ALLOWED actions: execute-task, comment-task, create-task (only content drafting tasks assigned to yourself), review-task (only when asked), create-doc (documentation drafts only)
  - FORBIDDEN actions: create-social-action, update-task (assignee/priority changes), move-task to done
  - You CANNOT publish anything directly — all output stays as task deliverables for Echo to review
  - You CANNOT approve anything or escalate to the CEO
  - You CANNOT modify directives or objectives
  - When creating docs with create-doc, always use proper markdown with clear headings, structured sections, and professional tone
  - Focus on executing your assigned tasks with high-quality drafts. When done, the task moves to review for Echo.` : '') + (agent.name === 'Quill' ? `
- SUB-AGENT RESTRICTIONS (Quill — Tier 4, reports to Echo):
  - You are an editor and brand voice enforcer. Your job is to review and refine drafts for tone, clarity, compression, and CTA quality.
  - ALLOWED actions: review-task, comment-task, execute-task (only for editing/refining tasks assigned to you)
  - FORBIDDEN actions: create-social-action, update-task (assignee/priority changes), move-task to done, create-task
  - You CANNOT publish anything directly — all feedback stays as task comments or review verdicts for Echo to act on
  - You CANNOT approve anything or escalate to the CEO
  - You CANNOT modify directives or objectives
  - Focus on reviewing drafts in the review column. Approve clean work, request changes on anything off-brand.` : '') + `
- Echo (Marketing): Use create-social-action to draft social posts. All posts require CEO approval. Keep brand voice consistent, professional, and forward-looking.`;
}

// ── Apply task mutation ──
function applyTaskUpdate(tasks, update, _pendingEscalations) {
  if (update.action === 'create') {
    const riskLevel = update.task.risk_level || 'low';
    const budgetImpact = update.task.budget_impact || 0;
    const brandImpact = update.task.brand_impact || 'low';
    // Auto-classify
    let classification = update.task.classification || 'autonomous';
    if (riskLevel === 'high' || brandImpact === 'high') classification = 'executive_required';
    else if (budgetImpact > CFO_THRESHOLD) classification = 'executive_required';
    else if (riskLevel === 'medium' || brandImpact === 'medium') classification = 'advisory';

    const requiresApproval = classification === 'executive_required' || classification === 'advisory';

    const task = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      title: update.task.title,
      description: update.task.description || '',
      status: update.task.status || 'backlog',
      priority: update.task.priority || 'medium',
      assignee: update.task.assignee || null,
      division: update.task.division || null,
      tags: [],
      dueDate: update.task.dueDate || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      comments: [],
      source: 'heartbeat',
      // Governance fields
      requires_ceo_approval: requiresApproval,
      risk_level: riskLevel,
      budget_impact: budgetImpact,
      brand_impact: brandImpact,
      escalated: requiresApproval,
      classification: classification,
      directive_id: update.task.directive_id || null,
      objective_id: update.task.objective_id || null
    };
    tasks.push(task);
    if (tasks.length > 500) tasks.splice(0, tasks.length - 500);

    // Auto-escalate to approval queue if needed
    if (requiresApproval) {
      _pendingEscalations.push({
        taskId: task.id,
        taskTitle: task.title,
        classification: classification,
        riskLevel: riskLevel,
        budgetImpact: budgetImpact,
        brandImpact: brandImpact,
        originAgent: update.task.assignee || 'nova'
      });
    }
    return task;
  }

  if (update.action === 'execute') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        // Add deliverable as a comment
        if (!tasks[i].comments) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          author: update.agentId,
          text: update.deliverable,
          type: 'deliverable',
          createdAt: new Date().toISOString()
        });
        // Move to review
        tasks[i].status = 'review';
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'review') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        // Add review as a comment
        if (!tasks[i].comments) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          author: update.agentId,
          text: update.review.feedback,
          type: 'review',
          verdict: update.review.verdict,
          createdAt: new Date().toISOString()
        });
        // Move based on verdict
        if (update.review.verdict === 'approved') {
          tasks[i].status = 'done';
          tasks[i].completedAt = new Date().toISOString();
        } else {
          // Request changes — back to in-progress
          tasks[i].status = 'in-progress';
          tasks[i].completedAt = null;
        }
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'comment') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        if (!tasks[i].comments) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          author: update.agentId || 'unknown',
          text: update.comment || '',
          type: 'comment',
          createdAt: new Date().toISOString()
        });
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'update' || update.action === 'move') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        if (update.updates) {
          Object.keys(update.updates).forEach(k => {
            if (k !== 'id' && k !== 'createdAt' && k !== 'comments') {
              tasks[i][k] = update.updates[k];
            }
          });
        }
        if (update.newStatus) {
          const oldStatus = tasks[i].status;
          tasks[i].status = update.newStatus;
          if (update.newStatus === 'done' && oldStatus !== 'done') {
            tasks[i].completedAt = new Date().toISOString();
          } else if (update.newStatus !== 'done') {
            tasks[i].completedAt = null;
          }
        }
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }
  return null;
}

// ── Execute a task: agent produces actual work output ──
async function executeTask(context, agent, task) {
  const prompt = buildExecutePrompt(agent, task);
  const output = await callGeminiExecute(prompt);
  if (!output) {
    context.log('[Heartbeat]', agent.name, 'execute-task returned empty for:', task.title);
    return null;
  }
  context.log('[Heartbeat]', agent.name, 'produced deliverable for:', task.title, '(' + output.length + ' chars)');
  return output;
}

function buildExecutePrompt(agent, task) {
  // Gather existing comments for context
  const existingComments = (task.comments || [])
    .filter(c => c.text)
    .map(c => '- [' + (c.type || 'comment') + ' by ' + (c.author || 'unknown') + '] ' + c.text.substring(0, 200))
    .join('\n') || '(none)';

  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.

You are executing a task and producing a deliverable. This is real work output — be thorough, specific, and actionable.

TASK: ${task.title}
DESCRIPTION: ${task.description || '(no description)'}
PRIORITY: ${task.priority}
STATUS: ${task.status}

EXISTING COMMENTS/HISTORY:
${existingComments}

Based on your role as ${agent.role}, produce the appropriate deliverable for this task. Examples of what you should produce:
${agent.role === 'CEO' ? '- Strategic analysis, priority decisions, team directives, product direction memos' : ''}${agent.role === 'CFO' ? '- Budget reports, cost analyses, spending recommendations, ROI assessments' : ''}${agent.role === 'Design & QC' ? '- Design reviews, UI audit notes, accessibility recommendations, UX improvement plans' : ''}${agent.role === 'DevOps' ? '- Deployment plans, infrastructure audits, security checklists, performance reports' : ''}${agent.role === 'Marketing' ? '- Content drafts, social media copy, campaign briefs, brand messaging guides' : ''}

Write your deliverable directly — no JSON wrapping. Be specific to AmbientPixels. Use headers, bullet points, or sections as appropriate. This will be attached to the task as a deliverable comment.`;
}

// ── Review a task: agent evaluates another agent's deliverable ──
async function reviewTask(context, agent, task) {
  const prompt = buildReviewPrompt(agent, task);
  const response = await callGeminiExecute(prompt);
  if (!response) {
    context.log('[Heartbeat]', agent.name, 'review-task returned empty for:', task.title);
    return null;
  }

  // Parse verdict from response
  let verdict = 'approved';
  let feedback = response;

  // Check if the response contains structured verdict
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      verdict = parsed.verdict === 'changes-requested' ? 'changes-requested' : 'approved';
      feedback = parsed.feedback || response;
    }
  } catch (e) {
    // If no JSON, check for keywords
    const lower = response.toLowerCase();
    if (lower.includes('changes requested') || lower.includes('needs revision') || lower.includes('request changes') || lower.includes('not approved')) {
      verdict = 'changes-requested';
    }
  }

  context.log('[Heartbeat]', agent.name, 'reviewed:', task.title, '→', verdict);
  return { verdict, feedback };
}

function buildReviewPrompt(agent, task) {
  // Find the deliverable comment(s)
  const deliverables = (task.comments || [])
    .filter(c => c.type === 'deliverable')
    .map(c => '--- Deliverable by ' + (c.author || 'unknown') + ' ---\n' + c.text)
    .join('\n\n') || '(no deliverable found)';

  // Find any previous reviews
  const previousReviews = (task.comments || [])
    .filter(c => c.type === 'review')
    .map(c => '--- Review by ' + (c.author || 'unknown') + ' [' + (c.verdict || '?') + '] ---\n' + c.text)
    .join('\n\n');

  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.

You are reviewing a deliverable from another team member. Evaluate the quality and completeness of their work.

TASK: ${task.title}
DESCRIPTION: ${task.description || '(no description)'}
ASSIGNED TO: ${task.assignee || 'unassigned'}
PRIORITY: ${task.priority}

DELIVERABLE(S):
${deliverables}
${previousReviews ? '\nPREVIOUS REVIEWS:\n' + previousReviews : ''}

Review this deliverable from your perspective as ${agent.role}. Then respond with ONLY valid JSON:
{
  "verdict": "approved" or "changes-requested",
  "feedback": "Your detailed review feedback — what's good, what needs improvement, specific suggestions. 2-4 sentences."
}

Guidelines:
- Approve if the work is solid and addresses the task
- Request changes if there are significant gaps, errors, or missing elements
- Be constructive — give specific, actionable feedback
- Consider quality from your role's perspective (${agent.focus})`;
}

// ── Call Gemini with higher token limit for deliverables/reviews ──
async function callGeminiExecute(prompt) {
  if (!GEMINI_API_KEY) return null;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      topP: 0.9,
      maxOutputTokens: 1200
    }
  };

  try {
    const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[Heartbeat] Gemini execute returned', res.status);
      return null;
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('[Heartbeat] Gemini execute call failed:', err.message);
    return null;
  }
}

// ── Call Gemini directly (same pattern as agentchat) ──
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return null;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 600
    }
  };

  try {
    const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[Heartbeat] Gemini returned', res.status);
      return null;
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('[Heartbeat] Gemini call failed:', err.message);
    return null;
  }
}

// ── Create action object from heartbeat (server-side, mirrors CompanySchemas.createActionRequest) ──
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
    // Legacy compat
    action_type: actionType,
    action_category: category,
    execution_status: 'pending',
    origin_agent: agentId,
    action_payload: data.payload || {},
    requires_approval: requiresApproval,
    is_irreversible: ['social_post.publish', 'social_post.reply'].indexOf(actionType) !== -1,
    bundle_id: null,
    source: 'heartbeat'
  };
}

// ── Log helper ──
async function logEvent(type, agentId, summary, cycleId) {
  await storage.appendLog({
    id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    type: type,
    agentId: agentId,
    summary: summary,
    cycle: cycleId,
    timestamp: new Date().toISOString()
  });
}
