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
      latestStandup
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
      risks: overdueTasks.length > 0
        ? [overdueTasks.length + ' overdue task(s) need attention']
        : [],
      ideas: [],
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

  return `You are Nova, CEO of AmbientPixels. Write a brief morning report summary (3-5 sentences) covering the overnight activity.

DATE: ${data.today}
HEARTBEAT CYCLES RUN: ${data.heartbeatCycles}
ERRORS: ${data.errors}

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

Write a concise CEO morning briefing. Highlight what got done, what's in progress, any concerns (especially overdue items), and set the tone for the day. Be direct and actionable. 3-5 sentences max.`;
}

// ── Call Gemini ──
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return '';

  const body = {
    systemInstruction: {
      parts: [{ text: 'You are Nova, CEO of AmbientPixels. You write concise, direct morning briefings.' }]
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
