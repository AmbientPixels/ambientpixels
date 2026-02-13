// companyHeartbeat — Timer Trigger (every 30 minutes)
// Runs agent heartbeat cycles: reviews tasks, takes actions, logs activity
// Uses existing agentchat endpoint pattern for Gemini calls

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

const AGENT_IDS = ['cipher', 'pixel', 'forge', 'echo', 'nova'];

// Agent system prompts (abbreviated for heartbeat context)
const AGENT_ROLES = {
  nova: { name: 'Nova', role: 'CEO', focus: 'strategy, priorities, team coordination, product direction' },
  cipher: { name: 'Cipher', role: 'CFO', focus: 'budgets, API costs, resource efficiency, spending' },
  pixel: { name: 'Pixel', role: 'Design & QC', focus: 'UI quality, accessibility, design consistency, frontend' },
  forge: { name: 'Forge', role: 'DevOps', focus: 'deployments, infrastructure, uptime, backend security' },
  echo: { name: 'Echo', role: 'Marketing', focus: 'content, social media, community, brand voice' }
};

// ── Guardrails ──
const GUARDRAILS = {
  maxActionsPerCyclePerAgent: 3,
  maxGeminiCallsPerCycle: 10,
  maxNewTasksPerCycle: 5,
  dedupeWindowMs: 300000 // 5 min
};

module.exports = async function (context) {
  const cycleId = 'cycle-' + Date.now();
  const cycleStart = new Date().toISOString();
  let geminiCalls = 0;
  let newTasksCreated = 0;
  const agentActions = {};

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
            applyTaskUpdate(tasks, update);
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

    // Log cron entry
    const cronLog = (await storage.getState('cronLog')) || [];
    cronLog.push({
      agentId: null,
      task: 'companyHeartbeat',
      result: 'completed',
      cycleId: cycleId,
      geminiCalls: geminiCalls,
      newTasks: newTasksCreated,
      agentActions: agentActions,
      timestamp: new Date().toISOString()
    });
    if (cronLog.length > 50) cronLog.splice(0, cronLog.length - 50);
    await storage.setState('cronLog', cronLog);

    await logEvent('heartbeat', null,
      'Heartbeat cycle complete: ' + geminiCalls + ' API calls, ' + newTasksCreated + ' new tasks',
      cycleId
    );

    context.log('[Heartbeat] Cycle complete:', cycleId, '| Gemini calls:', geminiCalls, '| New tasks:', newTasksCreated);

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

  for (const action of actions) {
    if (actionCount >= GUARDRAILS.maxActionsPerCyclePerAgent) break;

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
          division: action.task.division || null
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

  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.

This is an automated heartbeat check. Review your current tasks and the company task board, then decide what actions to take (if any). Not every heartbeat needs action — only act if something is genuinely needed.

YOUR TASKS:
${taskList}

OTHER ACTIVE TASKS:
${otherTasks}

CURRENT TIME: ${new Date().toISOString()}

Respond with ONLY valid JSON in this exact format:
{
  "observation": "One sentence about what you notice or your current state",
  "actions": [
    {
      "type": "create-task|update-task|move-task",
      "summary": "Brief description of what you're doing",
      "task": { "title": "", "description": "", "priority": "low|medium|high|critical", "assignee": "agentId" },
      "taskId": "existing-task-id",
      "updates": { "description": "..." },
      "newStatus": "todo|in-progress|review|done"
    }
  ]
}

Rules:
- actions array can be empty if nothing needs doing
- Max 3 actions per heartbeat
- Only create tasks that are genuinely useful
- Only move tasks if you have reason to
- Keep observations brief and factual`;
}

// ── Apply task mutation ──
function applyTaskUpdate(tasks, update) {
  if (update.action === 'create') {
    const task = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      title: update.task.title,
      description: update.task.description || '',
      status: update.task.status || 'backlog',
      priority: update.task.priority || 'medium',
      assignee: update.task.assignee || null,
      division: update.task.division || null,
      tags: [],
      dueDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      comments: [],
      source: 'heartbeat'
    };
    tasks.push(task);
    if (tasks.length > 500) tasks.splice(0, tasks.length - 500);
    return task;
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
