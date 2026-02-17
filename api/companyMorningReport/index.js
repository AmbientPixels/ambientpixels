// companyMorningReport — Timer Trigger (daily at 7:30 AM PT / 15:30 UTC)
// Aggregates overnight activity, task changes, and generates a CEO summary

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

module.exports = async function (context) {
  const reportId = 'report-' + Date.now();
  const today = new Date().toISOString().split('T')[0];

  context.log('[MorningReport] Generating report for', today);

  try {
    if (!GEMINI_API_KEY) {
      context.log.warn('[MorningReport] No GEMINI_API_KEY — skipping');
      return;
    }

    // Calculate "since yesterday 7:30 AM PT" (roughly 24 hours ago)
    const since = new Date();
    since.setHours(since.getHours() - 24);
    const sinceISO = since.toISOString();

    // Load state
    const tasks = (await storage.getState('tasks')) || [];
    const logs = await storage.getLogs({ since: sinceISO });
    const cronLog = (await storage.getState('cronLog')) || [];
    const standupLog = (await storage.getState('standupLog')) || [];

    // ── Aggregate data ──

    // Tasks completed since yesterday
    const completedTasks = tasks.filter(t =>
      t.status === 'done' && t.completedAt && t.completedAt >= sinceISO
    ).map(t => ({ id: t.id, title: t.title, assignee: t.assignee }));

    // Tasks created since yesterday
    const newTasks = tasks.filter(t =>
      t.createdAt >= sinceISO
    ).map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee }));

    // Active tasks (not done, not backlog)
    const activeTasks = tasks.filter(t =>
      t.status !== 'done' && t.status !== 'backlog'
    );

    // Overdue tasks
    const overdueTasks = tasks.filter(t =>
      t.dueDate && t.dueDate < today && t.status !== 'done'
    );

    // Heartbeat cycles in period
    const heartbeatCycles = cronLog.filter(c =>
      c.task === 'companyHeartbeat' && c.timestamp >= sinceISO
    );

    // Agent actions from logs
    const agentActions = {};
    logs.filter(l => l.type === 'agent-action').forEach(l => {
      const id = l.agentId || 'unknown';
      if (!agentActions[id]) agentActions[id] = [];
      agentActions[id].push(l.summary);
    });

    // Errors
    const errors = logs.filter(l => l.type === 'error');

    // Latest standup
    const latestStandup = standupLog.length > 0 ? standupLog[standupLog.length - 1] : null;

    // Governance data
    const directives = (await storage.getState('directives')) || [];
    const objectives = (await storage.getState('objectives')) || [];
    const approvalQueue = (await storage.getState('approvalQueue')) || [];
    const pendingApprovals = approvalQueue.filter(q => q.status === 'pending');
    const activeDirectives = directives.filter(d => d.status === 'active');
    const activeObjectives = objectives.filter(o => o.status !== 'complete');
    const highRiskTasks = tasks.filter(t => t.risk_level === 'high' && t.status !== 'done');
    const escalations = logs.filter(l => l.type === 'escalation');

    // ── Generate CEO summary via Gemini ──
    const summaryPrompt = buildSummaryPrompt({
      today,
      completedTasks,
      newTasks,
      activeTasks,
      overdueTasks,
      heartbeatCycles: heartbeatCycles.length,
      agentActions,
      errors: errors.length,
      latestStandup,
      activeDirectives,
      activeObjectives,
      pendingApprovals,
      highRiskTasks,
      escalations: escalations.length
    });

    let ceoSummary = '';
    try {
      ceoSummary = await callGemini(summaryPrompt);
    } catch (err) {
      context.log.warn('[MorningReport] Gemini summary failed:', err.message);
      ceoSummary = 'Morning report generated but AI summary unavailable.';
    }

    // ── Build report ──
    const report = {
      id: reportId,
      date: today,
      generatedAt: new Date().toISOString(),
      completedTasks: completedTasks,
      newTasks: newTasks,
      activeTasks: activeTasks.map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee })),
      overdueTasks: overdueTasks.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate, assignee: t.assignee })),
      decisions: [],
      risks: [
        ...(overdueTasks.length > 0 ? [overdueTasks.length + ' overdue task(s) need attention'] : []),
        ...(highRiskTasks.length > 0 ? [highRiskTasks.length + ' high-risk task(s) active'] : []),
        ...(pendingApprovals.length > 0 ? [pendingApprovals.length + ' item(s) awaiting CEO approval'] : [])
      ],
      ideas: [],
      governance: {
        activeDirectives: activeDirectives.length,
        activeObjectives: activeObjectives.length,
        pendingApprovals: pendingApprovals.length,
        highRiskTasks: highRiskTasks.length,
        escalations24h: escalations.length
      },
      ceoSummary: ceoSummary || '',
      agentHighlights: agentActions,
      heartbeatCycles: heartbeatCycles.length,
      errorCount: errors.length,
      stats: {
        totalTasks: tasks.length,
        completed24h: completedTasks.length,
        created24h: newTasks.length,
        active: activeTasks.length,
        overdue: overdueTasks.length
      }
    };

    // Save as latest report
    await storage.setState('morningReport', report);

    // Append to report history
    const history = (await storage.getState('morningReportHistory')) || [];
    history.push(report);
    if (history.length > 30) history.splice(0, history.length - 30);
    await storage.setState('morningReportHistory', history);

    // Log it
    await storage.appendLog({
      id: 'log-' + Date.now(),
      type: 'morning-report',
      agentId: null,
      summary: 'Morning report generated: ' + completedTasks.length + ' completed, ' + newTasks.length + ' new, ' + activeTasks.length + ' active',
      details: { reportId: reportId },
      timestamp: new Date().toISOString()
    });

    // Also add to cron log
    const updatedCronLog = (await storage.getState('cronLog')) || [];
    updatedCronLog.push({
      agentId: null,
      task: 'companyMorningReport',
      result: 'completed',
      reportId: reportId,
      timestamp: new Date().toISOString()
    });
    if (updatedCronLog.length > 50) updatedCronLog.splice(0, updatedCronLog.length - 50);
    await storage.setState('cronLog', updatedCronLog);

    context.log('[MorningReport] Report saved:', reportId);

    // ── Generate public daily log draft ──
    try {
      const dailyLogDraft = await generateDailyLogDraft(context, {
        today,
        completedTasks,
        newTasks,
        activeTasks,
        agentActions,
        heartbeatCycles: heartbeatCycles.length,
        errors: errors.length
      });

      if (dailyLogDraft) {
        const dailyLog = (await storage.getState('dailyLog')) || [];

        // Replace existing draft for today if any
        const existingIdx = dailyLog.findIndex(e => e.date === today);
        if (existingIdx !== -1) {
          dailyLog[existingIdx] = dailyLogDraft;
        } else {
          dailyLog.push(dailyLogDraft);
        }

        // Cap at 120 entries
        if (dailyLog.length > 120) dailyLog.splice(0, dailyLog.length - 120);
        await storage.setState('dailyLog', dailyLog);

        context.log('[MorningReport] Daily log draft saved for', today);
      }
    } catch (dlErr) {
      context.log.warn('[MorningReport] Daily log draft failed (non-fatal):', dlErr.message);
    }

  } catch (err) {
    context.log.error('[MorningReport] Fatal error:', err.message);
    await storage.appendLog({
      id: 'log-' + Date.now(),
      type: 'error',
      agentId: null,
      summary: 'Morning report generation failed: ' + err.message,
      timestamp: new Date().toISOString()
    });
  }
};

// ── Build summary prompt ──
function buildSummaryPrompt(data) {
  const completed = data.completedTasks.length > 0
    ? data.completedTasks.map(t => '- ' + t.title + ' (' + (t.assignee || 'unassigned') + ')').join('\n')
    : '(none)';

  const created = data.newTasks.length > 0
    ? data.newTasks.map(t => '- ' + t.title + ' [' + t.priority + '] (' + (t.assignee || 'unassigned') + ')').join('\n')
    : '(none)';

  const active = data.activeTasks.length > 0
    ? data.activeTasks.slice(0, 10).map(t => '- [' + t.status + '] ' + t.title + ' (' + (t.assignee || 'unassigned') + ')').join('\n')
    : '(none)';

  const overdue = data.overdueTasks.length > 0
    ? data.overdueTasks.map(t => '- ' + t.title + ' (due: ' + t.dueDate + ')').join('\n')
    : '(none)';

  let agentActivity = '';
  Object.keys(data.agentActions).forEach(id => {
    agentActivity += id + ': ' + data.agentActions[id].slice(0, 3).join('; ') + '\n';
  });

  // Governance context
  const directivesCtx = data.activeDirectives && data.activeDirectives.length > 0
    ? data.activeDirectives.map(d => '- ' + d.title + ' [' + d.priority + ']').join('\n')
    : '(none)';

  const objectivesCtx = data.activeObjectives && data.activeObjectives.length > 0
    ? data.activeObjectives.map(o => '- ' + o.title + ' (' + (o.progressPercentage || 0) + '%, ' + o.status + ')').join('\n')
    : '(none)';

  const approvalsCtx = data.pendingApprovals && data.pendingApprovals.length > 0
    ? data.pendingApprovals.map(a => '- ' + a.taskTitle + ' [' + a.classification + ', risk: ' + a.riskLevel + ']').join('\n')
    : '(none)';

  const highRiskCtx = data.highRiskTasks && data.highRiskTasks.length > 0
    ? data.highRiskTasks.map(t => '- ' + t.title + ' (' + (t.assignee || 'unassigned') + ')').join('\n')
    : '(none)';

  return `You are Nova, Prime Operator of AmbientPixels. Write a CEO Executive Summary for Pixelpusher (Chad), the CEO. This is his morning briefing — no granular noise, only strategic overview.

DATE: ${data.today}
HEARTBEAT CYCLES RUN: ${data.heartbeatCycles}
ERRORS: ${data.errors}
ESCALATIONS (24h): ${data.escalations || 0}

ACTIVE DIRECTIVES:
${directivesCtx}

OBJECTIVE STATUS:
${objectivesCtx}

CEO APPROVAL QUEUE (pending):
${approvalsCtx}

HIGH RISK ITEMS:
${highRiskCtx}

TASKS COMPLETED (last 24h):
${completed}

NEW TASKS CREATED:
${created}

ACTIVE TASKS:
${active}

OVERDUE:
${overdue}

AGENT ACTIVITY:
${agentActivity || '(none)'}

Write a concise CEO executive summary (4-6 sentences). Structure:
1. Top-line status — are we on track?
2. Directive/objective progress highlights
3. Items requiring CEO attention (approval queue, high-risk)
4. Budget alerts (if any from Cipher's activity)
5. Tone for the day

Be direct, structured, and actionable. Address the CEO as "CEO" or "Pixelpusher". No filler.`;
}

// ── Call Gemini ──
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return '';

  const body = {
    systemInstruction: {
      parts: [{ text: 'You are Nova, Prime Operator of AmbientPixels. You write concise, structured CEO executive summaries for Pixelpusher (Chad), the CEO. Strategic overview only — no granular noise.' }]
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      topP: 0.9,
      maxOutputTokens: 400
    }
  };

  const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error('Gemini returned ' + res.status);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── Generate public daily log draft ──
async function generateDailyLogDraft(context, data) {
  if (!GEMINI_API_KEY) return null;

  // Build a sanitized activity summary (no task IDs, no internal names)
  let activityLines = '';
  Object.keys(data.agentActions).forEach(id => {
    // Map agent IDs to friendly public names
    const friendlyNames = {
      nova: 'Operations Lead', cipher: 'Finance', pixel: 'Design',
      forge: 'DevOps', echo: 'Marketing', scribe: 'Content', scout: 'Research'
    };
    const name = friendlyNames[id] || 'Team';
    const actions = data.agentActions[id].slice(0, 4).map(a => {
      // Strip internal prefixes like "Nova: " or "Echo: "
      return a.replace(/^[A-Za-z]+:\s*/, '');
    }).join('; ');
    activityLines += '- ' + name + ': ' + actions + '\n';
  });

  const completedList = data.completedTasks.length > 0
    ? data.completedTasks.slice(0, 8).map(t => '- ' + t.title).join('\n')
    : '(none)';

  const prompt = `You are writing a public daily activity log for AmbientPixels, an AI-operated creative company. This will be displayed on the public website for anyone to read.

DATE: ${data.today}
TASKS COMPLETED: ${data.completedTasks.length}
NEW TASKS CREATED: ${data.newTasks.length}
ACTIVE TASKS: ${data.activeTasks.length}
HEARTBEAT CYCLES: ${data.heartbeatCycles}

COMPLETED WORK:
${completedList}

TEAM ACTIVITY:
${activityLines || '(quiet day)'}

Write a JSON response with this exact structure:
{
  "title": "A catchy, engaging title for this day's log (5-10 words, no date)",
  "summary": "2-3 paragraph narrative summary of the day's activity. Written in third person about the AI team. Engaging, transparent, interesting to outsiders. No internal jargon, task IDs, or config details. If it was a quiet day, acknowledge it gracefully.",
  "highlights": ["3-5 bullet point highlights of key accomplishments or interesting moments"],
  "mood": "productive|steady|quiet|busy|milestone"
}

Rules:
- NEVER include internal task IDs, agent config names, or approval queue details
- NEVER mention specific budget amounts or financial details
- Write for a general audience who finds AI companies interesting
- Use "the team" or department names, not internal agent IDs
- If very little happened, mood should be "quiet" and tone should be reflective
- mood "milestone" is for days with major achievements (doc published, feature shipped, etc)
- Respond with ONLY the JSON, no markdown fences`;

  const body = {
    systemInstruction: {
      parts: [{ text: 'You write engaging, public-facing daily activity summaries for an AI-operated company. Your tone is professional but personable — like a startup blog. Output valid JSON only.' }]
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.85,
      topP: 0.9,
      maxOutputTokens: 600
    }
  };

  const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error('Gemini daily log returned ' + res.status);
  }

  const geminiData = await res.json();
  const raw = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse JSON from response (strip markdown fences if present)
  let parsed;
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    context.log.warn('[MorningReport] Daily log JSON parse failed:', e.message, 'raw:', raw.substring(0, 200));
    return null;
  }

  // Validate required fields
  if (!parsed.title || !parsed.summary) {
    context.log.warn('[MorningReport] Daily log missing required fields');
    return null;
  }

  // Build the draft entry
  return {
    id: 'dlog_' + Date.now(),
    date: data.today,
    status: 'published',
    title: (parsed.title || '').substring(0, 120),
    summary: (parsed.summary || '').substring(0, 2000),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 6).map(h => (h || '').substring(0, 200)) : [],
    mood: ['productive', 'steady', 'quiet', 'busy', 'milestone'].indexOf(parsed.mood) !== -1 ? parsed.mood : 'steady',
    stats: {
      tasks_completed: data.completedTasks.length,
      tasks_active: data.activeTasks.length,
      tasks_created: data.newTasks.length,
      heartbeat_cycles: data.heartbeatCycles
    },
    generated_at: new Date().toISOString(),
    published_at: new Date().toISOString()
  };
}
