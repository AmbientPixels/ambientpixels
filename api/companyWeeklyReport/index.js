// companyWeeklyReport — Timer Trigger (weekly, Sunday 16:00 UTC)
// Generates the three cadence weekly reports (Cipher financial, Forge ops,
// Nova strategic) that agents are nudged for but never produce — the nudge
// asks them to spend 2 of their 3 action slots per cycle, so it always loses
// the priority fight against firefighting (zero weekly_report memories ever
// existed before this function). This mirrors companyMorningReport: a dedicated
// cron computes the aggregates itself and writes directly, bypassing the agent
// action budget. Output lands in the `weeklyReports` archive (rolling 12 per
// agent), which is exactly what the cadence nudge reads — so writing here resets
// the "⏰ WEEKLY REPORT DUE — never written" prompt that fires every cycle.

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=';
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

const REPORT_AGENTS = ['cipher', 'forge', 'nova'];
const MAX_WEEKLY_REPORTS_PER_AGENT = 12;
const IDEMPOTENCY_MS = 6 * 24 * 60 * 60 * 1000; // skip an agent if it already has a report within 6 days
const MONTHLY_BUDGET = 35.00;

// Runtime model resolution — reads dashboard toggle with 5-min cache (mirrors morning report)
let _modelCache = { value: null, expires: 0 };
async function _useClaude() {
  if (_modelCache.expires > Date.now()) return _modelCache.value;
  try {
    const cfg = await storage.getState('systemConfig');
    const model = (cfg && cfg.heartbeatModel) || process.env.HEARTBEAT_MODEL || 'gemini';
    _modelCache = { value: model.toLowerCase().indexOf('claude') !== -1, expires: Date.now() + 300000 };
    return _modelCache.value;
  } catch (e) { return (process.env.HEARTBEAT_MODEL || '').toLowerCase() === 'claude'; }
}

// 60s timeout guards against AI upstream hangs that would burn the 5-min function budget.
async function _callModel(prompt, maxTokens, caller) {
  var ctl = new AbortController();
  var timeoutId = setTimeout(function () { ctl.abort(); }, 60000);
  try {
    if ((await _useClaude()) && ANTHROPIC_API_KEY) {
      var res = await fetch(CLAUDE_URL, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens || 400, messages: [{ role: 'user', content: prompt }] }) });
      var data = await res.json();
      if (!res.ok) throw new Error('Claude ' + res.status);
      var cu = data.usage || {};
      storage.logGeminiUsage({ caller: caller || 'weekly-report', model: CLAUDE_MODEL, promptTokens: cu.input_tokens || 0, completionTokens: cu.output_tokens || 0, totalTokens: (cu.input_tokens || 0) + (cu.output_tokens || 0) }).catch(function () {});
      return (data.content && data.content[0] && data.content[0].text) || '';
    }
    var gBody = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: maxTokens || 400, thinkingConfig: { thinkingBudget: 0 } } };
    var gRes = await fetch(GEMINI_URL + GEMINI_API_KEY, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gBody) });
    var gData = await gRes.json();
    if (!gRes.ok) throw new Error('Gemini ' + gRes.status);
    var um = gData && gData.usageMetadata;
    if (um) storage.logGeminiUsage({ caller: caller || 'weekly-report', model: 'gemini-2.5-flash', promptTokens: um.promptTokenCount || 0, completionTokens: um.candidatesTokenCount || 0, totalTokens: um.totalTokenCount || 0 }).catch(function () {});
    return (gData && gData.candidates && gData.candidates[0] && gData.candidates[0].content && gData.candidates[0].content.parts && gData.candidates[0].content.parts[0] && gData.candidates[0].content.parts[0].text) || '';
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Aggregate builders (computed inline from raw state — no coupling to heartbeat internals) ──

function _round(n) { return Math.round((n || 0) * 100) / 100; }

function computeFinance(usage, nowMs) {
  var weekAgo = nowMs - 7 * 86400000;
  var twoWeekAgo = nowMs - 14 * 86400000;
  var monthPrefix = new Date(nowMs).toISOString().substring(0, 7);
  var thisWeek = 0, prevWeek = 0, mtd = 0;
  var byAgentWeek = {};
  (Array.isArray(usage) ? usage : []).forEach(function (e) {
    var t = e.timestamp ? new Date(e.timestamp).getTime() : 0;
    var c = e.totalCost || 0;
    var aid = (e.agentId || 'unattributed').toLowerCase();
    if (t >= weekAgo) { thisWeek += c; byAgentWeek[aid] = (byAgentWeek[aid] || 0) + c; }
    else if (t >= twoWeekAgo) { prevWeek += c; }
    if (e.timestamp && String(e.timestamp).indexOf(monthPrefix) === 0) mtd += c;
  });
  var top = Object.keys(byAgentWeek).map(function (a) { return { agent: a, cost: _round(byAgentWeek[a]) }; })
    .sort(function (a, b) { return b.cost - a.cost; }).slice(0, 4);
  var wow = prevWeek > 0 ? Math.round(((thisWeek - prevWeek) / prevWeek) * 100) : 0;
  return { thisWeek: _round(thisWeek), prevWeek: _round(prevWeek), wowPct: wow, topAgents: top, mtd: _round(mtd), monthlyBudget: MONTHLY_BUDGET, mtdPct: Math.round((mtd / MONTHLY_BUDGET) * 100) };
}

function computeOps(runs, govLog, nowMs) {
  var weekAgo = nowMs - 7 * 86400000;
  var r = (Array.isArray(runs) ? runs : []).filter(function (x) {
    var t = x.startedAt ? new Date(x.startedAt).getTime() : 0; return t >= weekAgo;
  });
  var errors = r.filter(function (x) { return x.status && x.status !== 'ok'; }).length;
  var totalDur = r.reduce(function (s, x) { return s + (x.durationMs || 0); }, 0);
  var executed = r.reduce(function (s, x) { return s + ((x.agentActions && x.agentActions.executed) || 0); }, 0);
  var autoFixes = r.reduce(function (s, x) { return s + (x.autoFixes || 0); }, 0);
  var govTally = {};
  (Array.isArray(govLog) ? govLog : []).forEach(function (g) {
    var t = g.timestamp ? new Date(g.timestamp).getTime() : 0;
    if (t >= weekAgo) { var ty = g.type || 'other'; govTally[ty] = (govTally[ty] || 0) + 1; }
  });
  return {
    runs: r.length, errors: errors, avgDurationSec: r.length ? _round(totalDur / r.length / 1000) : 0,
    executed: executed, autoFixes: autoFixes,
    policyViolations: govTally['policy-violation'] || 0, ceoRejects: govTally['ceo-reject'] || 0,
    govTally: govTally
  };
}

function computeStrategic(campaigns, objectives, tasks, nowMs, today) {
  var weekAgo = nowMs - 7 * 86400000;
  var c = Array.isArray(campaigns) ? campaigns : [];
  var o = Array.isArray(objectives) ? objectives : [];
  var t = Array.isArray(tasks) ? tasks : [];
  function inWeek(iso) { return iso && new Date(iso).getTime() >= weekAgo; }
  var activeCampaigns = c.filter(function (x) { return x.status === 'active' && !x.deletedAt; });
  var newCampaigns = c.filter(function (x) { return inWeek(x.createdAt); });
  var endedCampaigns = c.filter(function (x) { return (x.status === 'completed' || x.status === 'paused' || x.status === 'cancelled') && inWeek(x.updatedAt); });
  var activeObjectives = o.filter(function (x) { return x.status !== 'complete' && x.status !== 'cancelled'; });
  var avgProgress = activeObjectives.length ? Math.round(activeObjectives.reduce(function (s, x) { return s + (x.progressPercentage || 0); }, 0) / activeObjectives.length) : 0;
  var completed = t.filter(function (x) { return x.status === 'done' && inWeek(x.completedAt); }).length;
  var created = t.filter(function (x) { return inWeek(x.createdAt); }).length;
  var overdue = t.filter(function (x) { return x.dueDate && x.dueDate < today && x.status !== 'done'; }).length;
  return {
    activeCampaigns: activeCampaigns.length, newCampaigns: newCampaigns.length, endedCampaigns: endedCampaigns.length,
    activeObjectives: activeObjectives.length, avgProgress: avgProgress,
    tasksCompleted: completed, tasksCreated: created, tasksOverdue: overdue,
    topCampaigns: activeCampaigns.slice(0, 4).map(function (x) { return x.title; })
  };
}

// ── Per-agent prompt builders ──

function _priorBlock(priorReports) {
  if (!priorReports || !priorReports.length) return '';
  return '\n\nYOUR PRIOR WEEKLY REPORTS (build on these, note trends):\n'
    + priorReports.map(function (p) { return '- ' + (p.date || '?') + ': ' + (p.text || '').split('\n')[0].substring(0, 160); }).join('\n');
}

function buildPrompt(agentId, ctx) {
  var common = 'Write a WEEKLY REPORT memory: under 480 characters, lead with a one-line headline, then 2-3 concrete data points, then one decision or recommendation. Plain text, no markdown headers, no preamble. Founder voice: direct, lowercase-casual is fine, no em dashes, no hype.';
  if (agentId === 'cipher') {
    var f = ctx.fin;
    return 'You are Cipher, Strategic CFO of AmbientPixels. ' + common + '\n\n'
      + 'FINANCIAL DATA (week ending ' + ctx.dateStr + '):\n'
      + '- This week spend: $' + f.thisWeek + ' (prev week $' + f.prevWeek + ', ' + (f.wowPct >= 0 ? '+' : '') + f.wowPct + '% WoW)\n'
      + '- Month-to-date: $' + f.mtd + ' / $' + f.monthlyBudget + ' budget (' + f.mtdPct + '%)\n'
      + '- Top-cost agents this week: ' + (f.topAgents.map(function (a) { return a.agent + ' $' + a.cost; }).join(', ') || 'none') + '\n'
      + 'Cover: spend trend, top-cost agents, budget health, one ROI/efficiency recommendation.'
      + _priorBlock(ctx.prior);
  }
  if (agentId === 'forge') {
    var op = ctx.ops;
    return 'You are Forge, DevOps Ops Director of AmbientPixels. ' + common + '\n\n'
      + 'OPS DATA (last 7 days):\n'
      + '- Heartbeat cycles: ' + op.runs + ' (' + op.errors + ' non-ok), avg ' + op.avgDurationSec + 's/cycle\n'
      + '- Agent actions executed: ' + op.executed + ', auto-fixes applied: ' + op.autoFixes + '\n'
      + '- Governance: ' + op.policyViolations + ' policy violations, ' + op.ceoRejects + ' CEO rejects\n'
      + 'Cover: heartbeat reliability, cost/error trend, top blockers, governance health, one ops recommendation.'
      + _priorBlock(ctx.prior);
  }
  // nova
  var s = ctx.strat;
  return 'You are Nova, Prime Operator & Strategic Orchestrator of AmbientPixels. ' + common + '\n\n'
    + 'STRATEGIC DATA (week ending ' + ctx.dateStr + '):\n'
    + '- Campaigns: ' + s.activeCampaigns + ' active (' + s.newCampaigns + ' new this week, ' + s.endedCampaigns + ' paused/completed)\n'
    + '- Objectives: ' + s.activeObjectives + ' active, avg progress ' + s.avgProgress + '%\n'
    + '- Tasks: ' + s.tasksCompleted + ' completed, ' + s.tasksCreated + ' created, ' + s.tasksOverdue + ' overdue\n'
    + (s.topCampaigns.length ? '- Active focus: ' + s.topCampaigns.join(', ') + '\n' : '')
    + 'Cover: what shipped, what stalled, what needs CEO attention, one strategic recommendation.'
    + _priorBlock(ctx.prior);
}

module.exports = async function (context) {
  const demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;

  if (!GEMINI_API_KEY && !ANTHROPIC_API_KEY) {
    context.log.warn('[WeeklyReport] No model API key — skipping');
    return;
  }

  const nowMs = Date.now();
  const dateStr = new Date().toISOString().substring(0, 10);
  context.log('[WeeklyReport] Generating weekly reports for week ending', dateStr);

  try {
    const [usage, runs, campaigns, objectives, tasks, govLog, wrStoreRaw] = await Promise.all([
      storage.getState('geminiUsage'), storage.getState('heartbeatRuns'),
      storage.getState('campaigns'), storage.getState('objectives'),
      storage.getState('tasks'), storage.getState('governanceLog'),
      storage.getState('weeklyReports')
    ]);
    const weeklyReports = (wrStoreRaw && typeof wrStoreRaw === 'object') ? wrStoreRaw : {};

    const fin = computeFinance(usage, nowMs);
    const ops = computeOps(runs, govLog, nowMs);
    const strat = computeStrategic(campaigns, objectives, tasks, nowMs, dateStr);

    // Generate each report (collect new entries; persist once at the end after a fresh re-read)
    const newEntries = [];
    for (const agentId of REPORT_AGENTS) {
      const existing = Array.isArray(weeklyReports[agentId]) ? weeklyReports[agentId] : [];
      const last = existing[existing.length - 1];
      if (last && last.createdAt && (nowMs - new Date(last.createdAt).getTime()) < IDEMPOTENCY_MS) {
        context.log('[WeeklyReport] Skipping', agentId, '— report exists within 6 days');
        continue;
      }
      const prompt = buildPrompt(agentId, { fin: fin, ops: ops, strat: strat, dateStr: dateStr, prior: existing.slice(-2) });
      let text = '';
      try {
        text = await _callModel(prompt, 350, 'weekly-report');
      } catch (e) {
        context.log.warn('[WeeklyReport]', agentId, 'model call failed (non-fatal):', e.message);
        continue;
      }
      text = (text || '').replace(/```/g, '').trim().substring(0, 600);
      if (text.length < 40) {
        context.log.warn('[WeeklyReport]', agentId, 'output too short — skipping');
        continue;
      }
      newEntries.push({
        agentId: agentId,
        entry: {
          id: 'wr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          agentId: agentId,
          date: dateStr,
          cycleId: 'weekly-cron-' + nowMs,
          text: text,
          createdAt: new Date().toISOString(),
          source: 'companyWeeklyReport'
        }
      });
      context.log('[WeeklyReport] Generated', agentId, 'report (' + text.length + ' chars)');
    }

    if (newEntries.length > 0) {
      // Re-read right before write so a concurrent heartbeat weekly_report save isn't clobbered.
      const fresh = (await storage.getState('weeklyReports')) || {};
      newEntries.forEach(function (ne) {
        if (!Array.isArray(fresh[ne.agentId])) fresh[ne.agentId] = [];
        fresh[ne.agentId].push(ne.entry);
        if (fresh[ne.agentId].length > MAX_WEEKLY_REPORTS_PER_AGENT) {
          fresh[ne.agentId] = fresh[ne.agentId].slice(-MAX_WEEKLY_REPORTS_PER_AGENT);
        }
      });
      await storage.setState('weeklyReports', fresh);

      await storage.appendLog({
        id: 'log-' + Date.now(),
        type: 'weekly-report',
        agentId: null,
        summary: 'Weekly reports generated: ' + newEntries.map(function (n) { return n.agentId; }).join(', '),
        details: { agents: newEntries.map(function (n) { return n.agentId; }), date: dateStr },
        timestamp: new Date().toISOString()
      });

      const cronLog = (await storage.getState('cronLog')) || [];
      cronLog.push({ agentId: null, task: 'companyWeeklyReport', result: 'completed', agents: newEntries.map(function (n) { return n.agentId; }), timestamp: new Date().toISOString() });
      if (cronLog.length > 50) cronLog.splice(0, cronLog.length - 50);
      await storage.setState('cronLog', cronLog);
    }

    context.log('[WeeklyReport] Done —', newEntries.length, 'report(s) saved');
  } catch (err) {
    context.log.error('[WeeklyReport] Fatal error:', err.message);
    await storage.appendLog({
      id: 'log-' + Date.now(),
      type: 'error',
      agentId: null,
      summary: 'Weekly report generation failed: ' + err.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Exported for unit/dry-run use
module.exports._computeFinance = computeFinance;
module.exports._computeOps = computeOps;
module.exports._computeStrategic = computeStrategic;
module.exports._buildPrompt = buildPrompt;
