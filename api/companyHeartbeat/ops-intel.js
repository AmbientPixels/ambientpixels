// ops-intel.js — Forge's operational intelligence digest builder
// Mirrors social-intel.js pattern: builds digest from raw data, formats into prompt block

var { OPS_INTEL_WINDOW_RUNS } = require('./constants');

// Thresholds: YELLOW = monitor, RED = create ops_breakfix
var THRESHOLDS = {
  heartbeatFailureRate:  { yellow: 20, red: 40 },
  heartbeatDurationMs:   { yellow: 180000, red: 300000 },
  p95Latency:            { yellow: 2000, red: 4000 },
  p50Latency:            { yellow: 1000, red: 2000 },
  errorCount7d:          { yellow: 50, red: 200 },
  singleErrorType:       { yellow: 20, red: 50 },
  dailyCostSpikeMult:    { yellow: 1.5, red: 3.0 },
  backlogUtilization:    { yellow: 80, red: 95 },
  agentBlockedRate:      { yellow: 30, red: 60 },
  governanceViolations7d:{ yellow: 3, red: 8 }
};

function buildForgeOpsDigest(heartbeatRuns, geminiUsage, governanceLog, siteIntel, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var runs = Array.isArray(heartbeatRuns) ? heartbeatRuns : [];
  var usage = Array.isArray(geminiUsage) ? geminiUsage : [];
  var govLog = Array.isArray(governanceLog) ? governanceLog : [];
  var sevenDayMs = 7 * 24 * 60 * 60 * 1000;
  var sevenCutoff = now - sevenDayMs;

  // ── Heartbeat Health ──
  var recentRuns = runs.slice(-OPS_INTEL_WINDOW_RUNS);
  var last5 = recentRuns.slice(-5);

  var last5Summary = last5.map(function (r) {
    return {
      runId: r.runId || r.id || '',
      startedAt: r.startedAt || r.timestamp || '',
      durationMs: r.durationMs || r.duration || 0,
      status: r.error ? 'error' : 'ok',
      agentsRan: (r.agentResults ? Object.keys(r.agentResults).length : r.agentsRan) || 0,
      actionsExecuted: r.actionsExecuted || r.totalActions || 0,
      actionsBlocked: r.actionsBlocked || 0,
      errorSummary: r.error ? String(r.error).substring(0, 100) : null
    };
  });

  var failCount5 = last5Summary.filter(function (r) { return r.status === 'error'; }).length;
  var failRate5 = last5.length > 0 ? Math.round((failCount5 / last5.length) * 100) : 0;

  var failCount20 = recentRuns.filter(function (r) { return r.error; }).length;
  var failRate20 = recentRuns.length > 0 ? Math.round((failCount20 / recentRuns.length) * 100) : 0;

  var durations = last5Summary.map(function (r) { return r.durationMs; }).filter(function (d) { return d > 0; });
  var avgDurationMs = durations.length > 0 ? Math.round(durations.reduce(function (a, b) { return a + b; }, 0) / durations.length) : 0;

  // Trend: compare avg of last 5 vs previous 5
  var prev5 = recentRuns.slice(-10, -5);
  var prevDurations = prev5.map(function (r) { return r.durationMs || r.duration || 0; }).filter(function (d) { return d > 0; });
  var prevAvg = prevDurations.length > 0 ? prevDurations.reduce(function (a, b) { return a + b; }, 0) / prevDurations.length : 0;
  var trend = 'stable';
  if (prevAvg > 0 && avgDurationMs > prevAvg * 1.2) trend = 'degrading';
  else if (prevAvg > 0 && avgDurationMs < prevAvg * 0.8) trend = 'improving';

  // Per-agent reliability from recent runs (supports both old agentResults and new perAgent format)
  var perAgent = {};
  recentRuns.forEach(function (r) {
    var agentData = r.perAgent || r.agentResults;
    if (!agentData) return;
    Object.keys(agentData).forEach(function (aid) {
      if (!perAgent[aid]) perAgent[aid] = { ran: 0, failed: 0, blocked: 0, executed: 0, zeroActionRuns: 0 };
      perAgent[aid].ran++;
      var ar = agentData[aid];
      if (ar.error) perAgent[aid].failed++;
      perAgent[aid].blocked += (ar.actionsBlocked || 0);
      var exec = ar.actionsExecuted || ar.actionsAttempted || ar.actions || 0;
      perAgent[aid].executed += exec;
      if (exec === 0 && !ar.error) perAgent[aid].zeroActionRuns++;
    });
  });

  // Stalled agent detection: agents with 0 actions over 5+ consecutive recent runs
  // Exclude quill (reactive editor) from stall detection
  var stalledAgents = [];
  var STALL_THRESHOLD = 5;
  Object.keys(perAgent).forEach(function (aid) {
    if (aid === 'quill') return;
    var a = perAgent[aid];
    if (a.ran >= STALL_THRESHOLD && a.zeroActionRuns >= STALL_THRESHOLD && a.executed === 0) {
      stalledAgents.push({ agent: aid, runs: a.ran, zeroRuns: a.zeroActionRuns });
    }
  });

  // Top blocked patterns
  var blockReasons = {};
  recentRuns.forEach(function (r) {
    if (!r.blockedActions) return;
    (Array.isArray(r.blockedActions) ? r.blockedActions : []).forEach(function (b) {
      var reason = b.reason || b.gate || 'unknown';
      blockReasons[reason] = (blockReasons[reason] || 0) + 1;
    });
  });
  var topBlocked = Object.keys(blockReasons)
    .sort(function (a, b) { return blockReasons[b] - blockReasons[a]; })
    .slice(0, 3)
    .map(function (k) { return { reason: k, count: blockReasons[k] }; });

  // Backlog from most recent run
  var latestRun = runs.length > 0 ? runs[runs.length - 1] : {};
  var backlog = {
    activeTasks: (latestRun.metrics && latestRun.metrics.activeTasks) || latestRun.activeTasks || 0,
    cap: 50,
    overdueTasks: (latestRun.metrics && latestRun.metrics.overdueTasks) || 0,
    blockedTasks: (latestRun.metrics && latestRun.metrics.blockedTasks) || 0
  };
  backlog.utilization = backlog.cap > 0 ? Math.round((backlog.activeTasks / backlog.cap) * 100) : 0;

  // ── Cost Intelligence ──
  var dailySpend = {};
  usage.forEach(function (u) {
    if (!u.timestamp) return;
    var day = u.timestamp.substring(0, 10);
    if (!dailySpend[day]) dailySpend[day] = { cost: 0, calls: 0 };
    dailySpend[day].cost += (u.totalCost || 0);
    dailySpend[day].calls += 1;
  });
  var days = Object.keys(dailySpend).sort().slice(-7);
  var dailySpend7d = days.map(function (d) { return { date: d, cost: Math.round(dailySpend[d].cost * 100) / 100, calls: dailySpend[d].calls }; });
  var totalSpend7d = dailySpend7d.reduce(function (s, d) { return s + d.cost; }, 0);
  var avgDailySpend = days.length > 0 ? Math.round((totalSpend7d / days.length) * 100) / 100 : 0;
  var projectedMonthly = Math.round(avgDailySpend * 30 * 100) / 100;

  // Spend trend: compare this week vs previous week
  var prevDays = Object.keys(dailySpend).sort().slice(-14, -7);
  var prevWeekSpend = prevDays.reduce(function (s, d) { return s + (dailySpend[d] ? dailySpend[d].cost : 0); }, 0);
  var spendTrend = 'flat';
  var spendDelta = 0;
  if (prevWeekSpend > 0) {
    spendDelta = Math.round(((totalSpend7d - prevWeekSpend) / prevWeekSpend) * 100);
    if (spendDelta > 15) spendTrend = 'rising';
    else if (spendDelta < -15) spendTrend = 'falling';
  }

  // Top agent spenders
  var agentSpend = {};
  usage.forEach(function (u) {
    var ts = Date.parse(u.timestamp || '');
    if (!Number.isFinite(ts) || ts < sevenCutoff) return;
    var aid = u.agentId || u.caller || 'unknown';
    agentSpend[aid] = (agentSpend[aid] || 0) + (u.totalCost || 0);
  });
  var topAgentSpend = Object.keys(agentSpend)
    .sort(function (a, b) { return agentSpend[b] - agentSpend[a]; })
    .slice(0, 3)
    .map(function (k) { return { agent: k, cost: Math.round(agentSpend[k] * 100) / 100 }; });

  // Cost spike detection
  var costAlert = null;
  if (dailySpend7d.length > 0 && avgDailySpend > 0) {
    var maxDay = dailySpend7d.reduce(function (max, d) { return d.cost > max.cost ? d : max; }, dailySpend7d[0]);
    if (maxDay.cost > avgDailySpend * THRESHOLDS.dailyCostSpikeMult.red) costAlert = 'spike_red';
    else if (maxDay.cost > avgDailySpend * THRESHOLDS.dailyCostSpikeMult.yellow) costAlert = 'spike_yellow';
  }

  // ── Error Intelligence ──
  var telemetry = (siteIntel && siteIntel.telemetry) || {};
  var errors = telemetry.errors || [];
  var totalErrors = errors.reduce(function (s, e) { return s + (e.count || 0); }, 0);
  var perf = telemetry.performance || {};

  var perfAlert = null;
  if (perf.p95 > THRESHOLDS.p95Latency.red) perfAlert = 'p95_red';
  else if (perf.p95 > THRESHOLDS.p95Latency.yellow) perfAlert = 'p95_yellow';
  if (perf.p50 > THRESHOLDS.p50Latency.red) perfAlert = (perfAlert || '') + ' p50_red';
  else if (perf.p50 > THRESHOLDS.p50Latency.yellow) perfAlert = (perfAlert || '') + ' p50_yellow';

  // ── Governance ──
  var violations7d = govLog.filter(function (g) {
    var ts = Date.parse(g.timestamp || '');
    return Number.isFinite(ts) && ts >= sevenCutoff;
  });
  var violationsByAgent = {};
  var violationTypes = {};
  violations7d.forEach(function (g) {
    var aid = (g.data && g.data.agent) || g.agentId || 'unknown';
    violationsByAgent[aid] = (violationsByAgent[aid] || 0) + 1;
    var vType = g.type || 'unknown';
    violationTypes[vType] = (violationTypes[vType] || 0) + 1;
  });
  var topViolationType = Object.keys(violationTypes).sort(function (a, b) { return violationTypes[b] - violationTypes[a]; })[0] || null;

  // ── Threshold Alerts ──
  var alerts = [];
  if (failRate5 >= THRESHOLDS.heartbeatFailureRate.red) alerts.push({ level: 'RED', signal: 'Heartbeat failure rate ' + failRate5 + '% (last 5 runs)', threshold: THRESHOLDS.heartbeatFailureRate.red + '%' });
  else if (failRate5 >= THRESHOLDS.heartbeatFailureRate.yellow) alerts.push({ level: 'YELLOW', signal: 'Heartbeat failure rate ' + failRate5 + '%', threshold: THRESHOLDS.heartbeatFailureRate.yellow + '%' });

  if (avgDurationMs > THRESHOLDS.heartbeatDurationMs.red) alerts.push({ level: 'RED', signal: 'Heartbeat avg duration ' + Math.round(avgDurationMs / 1000) + 's', threshold: Math.round(THRESHOLDS.heartbeatDurationMs.red / 1000) + 's' });
  else if (avgDurationMs > THRESHOLDS.heartbeatDurationMs.yellow) alerts.push({ level: 'YELLOW', signal: 'Heartbeat avg duration ' + Math.round(avgDurationMs / 1000) + 's', threshold: Math.round(THRESHOLDS.heartbeatDurationMs.yellow / 1000) + 's' });

  if (perf.p95 > THRESHOLDS.p95Latency.red) alerts.push({ level: 'RED', signal: 'p95 latency ' + perf.p95 + 'ms', threshold: THRESHOLDS.p95Latency.red + 'ms' });
  else if (perf.p95 > THRESHOLDS.p95Latency.yellow) alerts.push({ level: 'YELLOW', signal: 'p95 latency ' + perf.p95 + 'ms', threshold: THRESHOLDS.p95Latency.yellow + 'ms' });

  if (totalErrors > THRESHOLDS.errorCount7d.red) alerts.push({ level: 'RED', signal: totalErrors + ' errors (7d)', threshold: THRESHOLDS.errorCount7d.red });
  else if (totalErrors > THRESHOLDS.errorCount7d.yellow) alerts.push({ level: 'YELLOW', signal: totalErrors + ' errors (7d)', threshold: THRESHOLDS.errorCount7d.yellow });

  if (costAlert === 'spike_red') alerts.push({ level: 'RED', signal: 'Daily cost spike >3x average', threshold: '3x avg' });
  else if (costAlert === 'spike_yellow') alerts.push({ level: 'YELLOW', signal: 'Daily cost spike >1.5x average', threshold: '1.5x avg' });

  if (backlog.utilization >= THRESHOLDS.backlogUtilization.red) alerts.push({ level: 'RED', signal: 'Backlog at ' + backlog.utilization + '%', threshold: THRESHOLDS.backlogUtilization.red + '%' });
  else if (backlog.utilization >= THRESHOLDS.backlogUtilization.yellow) alerts.push({ level: 'YELLOW', signal: 'Backlog at ' + backlog.utilization + '%', threshold: THRESHOLDS.backlogUtilization.yellow + '%' });

  if (violations7d.length >= THRESHOLDS.governanceViolations7d.red) alerts.push({ level: 'RED', signal: violations7d.length + ' governance violations (7d)', threshold: THRESHOLDS.governanceViolations7d.red });
  else if (violations7d.length >= THRESHOLDS.governanceViolations7d.yellow) alerts.push({ level: 'YELLOW', signal: violations7d.length + ' governance violations (7d)', threshold: THRESHOLDS.governanceViolations7d.yellow });

  // Stalled agent alerts
  stalledAgents.forEach(function (s) {
    alerts.push({ level: 'YELLOW', signal: s.agent + ' produced 0 actions across ' + s.zeroRuns + ' consecutive runs — may be blocked or misconfigured', threshold: STALL_THRESHOLD + ' zero-action runs' });
  });

  return {
    asOfUtc: new Date(now).toISOString(),
    heartbeatHealth: {
      last5: last5Summary,
      failRate5: failRate5,
      failRate20: failRate20,
      avgDurationMs: avgDurationMs,
      trend: trend,
      perAgent: perAgent,
      stalledAgents: stalledAgents,
      topBlocked: topBlocked,
      backlog: backlog
    },
    costIntel: {
      dailySpend7d: dailySpend7d,
      totalSpend7d: Math.round(totalSpend7d * 100) / 100,
      avgDailySpend: avgDailySpend,
      projectedMonthly: projectedMonthly,
      spendTrend: spendTrend,
      spendDeltaPct: spendDelta,
      topAgentSpend: topAgentSpend,
      alert: costAlert
    },
    errorIntel: {
      errors: errors.slice(0, 5),
      totalErrors: totalErrors,
      p50: perf.p50 || 0,
      p95: perf.p95 || 0,
      perfAlert: perfAlert
    },
    governance: {
      violations7d: violations7d.length,
      byAgent: violationsByAgent,
      topType: topViolationType
    },
    alerts: alerts
  };
}

function _buildForgeOpsPromptBlock(agent, opsDigest) {
  if (!opsDigest || !agent || agent.id !== 'forge') return '';

  var hb = opsDigest.heartbeatHealth || {};
  var cost = opsDigest.costIntel || {};
  var err = opsDigest.errorIntel || {};
  var gov = opsDigest.governance || {};
  var alerts = opsDigest.alerts || [];

  var lines = ['\n\nOPS INTELLIGENCE DASHBOARD (live system data):'];

  // Heartbeat health
  var last5 = hb.last5 || [];
  var okCount = last5.filter(function (r) { return r.status === 'ok'; }).length;
  lines.push('\nHEARTBEAT HEALTH:');
  lines.push('- Last 5 runs: ' + okCount + '/' + last5.length + ' OK | Avg: ' + Math.round((hb.avgDurationMs || 0) / 1000) + 's | Trend: ' + (hb.trend || 'unknown'));
  last5.forEach(function (r) {
    var ts = r.startedAt ? new Date(r.startedAt).toISOString().substring(11, 16) : '?';
    lines.push('  - ' + ts + ': ' + r.status.toUpperCase() + ', ' + Math.round(r.durationMs / 1000) + 's, ' + r.actionsExecuted + ' actions' + (r.actionsBlocked > 0 ? ' (' + r.actionsBlocked + ' blocked)' : '') + (r.errorSummary ? ' — ERROR: ' + r.errorSummary : ''));
  });

  // Per-agent reliability (show agents with issues: failures, high block rate, or stalled)
  var agentIssues = [];
  Object.keys(hb.perAgent || {}).forEach(function (aid) {
    var a = hb.perAgent[aid];
    if (a.failed > 0 || (a.ran > 0 && a.blocked / Math.max(1, a.executed + a.blocked) > 0.3)) {
      var blockRate = a.ran > 0 ? Math.round((a.blocked / Math.max(1, a.executed + a.blocked)) * 100) : 0;
      agentIssues.push(aid + ': ' + a.failed + ' fails, ' + blockRate + '% blocked');
    }
  });
  if (agentIssues.length > 0) {
    lines.push('- Agent issues: ' + agentIssues.join(' | '));
  }

  // Stalled agents (0 actions over multiple consecutive runs)
  var stalled = hb.stalledAgents || [];
  if (stalled.length > 0) {
    lines.push('- STALLED AGENTS (0 output, ' + stalled[0].zeroRuns + '+ runs):');
    stalled.forEach(function (s) {
      lines.push('  - ' + s.agent + ': 0 actions across ' + s.zeroRuns + '/' + s.runs + ' runs');
    });
    lines.push('');
    lines.push('STALLED AGENT PROTOCOL — MANDATORY:');
    lines.push('For EACH agent in STALLED AGENTS above, you MUST emit a create-task action with category="system_directive" this cycle UNLESS:');
    lines.push('  (a) Your memory shows you already issued a directive to that agent in the last 3 heartbeats, OR');
    lines.push('  (b) That agent is externally-blocked (e.g., awaiting CEO approval you can see in their blocked count).');
    lines.push('Required format: { "type": "create-task", "task": { "title": "DIRECTIVE: <specific action>", "description": "Diagnostic: <why stalled — cite run/block counts>. Required: <exact fix>.", "category": "system_directive", "assignee": "<stalled agent id>", "taskType": "ops" }}');
    lines.push('Anti-loop: max 1 active directive per target agent (enforced server-side). Do not wait for permission — course-correction IS your role.');
  }

  var blocked = (hb.topBlocked || []);
  if (blocked.length > 0) {
    lines.push('- Top blocks: ' + blocked.map(function (b) { return b.reason + ' (' + b.count + 'x)'; }).join(', '));
  }

  var bl = hb.backlog || {};
  lines.push('- Backlog: ' + (bl.activeTasks || 0) + '/' + (bl.cap || 50) + ' tasks (' + (bl.utilization || 0) + '%)' + (bl.overdueTasks > 0 ? ', ' + bl.overdueTasks + ' overdue' : '') + (bl.blockedTasks > 0 ? ', ' + bl.blockedTasks + ' blocked' : ''));

  // Cost
  lines.push('\nCOST MONITOR (Gemini API, 7d):');
  lines.push('- $' + (cost.avgDailySpend || 0) + '/day avg | $' + (cost.totalSpend7d || 0) + ' week | $' + (cost.projectedMonthly || 0) + '/mo projected | Trend: ' + (cost.spendTrend || 'unknown') + (cost.spendDeltaPct ? ' (' + (cost.spendDeltaPct > 0 ? '+' : '') + cost.spendDeltaPct + '% wow)' : ''));
  if ((cost.topAgentSpend || []).length > 0) {
    lines.push('- Top: ' + cost.topAgentSpend.map(function (a) { return a.agent + ' $' + a.cost; }).join(', '));
  }

  // Errors & Performance
  lines.push('\nERRORS & PERFORMANCE:');
  lines.push('- Page load: p50=' + (err.p50 || 0) + 'ms, p95=' + (err.p95 || 0) + 'ms');
  if ((err.errors || []).length > 0) {
    lines.push('- Errors (7d): ' + (err.totalErrors || 0) + ' total — ' + err.errors.map(function (e) { return e.name + ' (' + e.count + 'x)'; }).join(', '));
  } else {
    lines.push('- Errors (7d): ' + (err.totalErrors || 0) + ' total');
  }

  // Governance
  if (gov.violations7d > 0) {
    var byAgent = Object.keys(gov.byAgent || {}).map(function (a) { return a + ': ' + gov.byAgent[a]; }).join(', ');
    lines.push('\nGOVERNANCE: ' + gov.violations7d + ' violations (7d)' + (byAgent ? ' (' + byAgent + ')' : '') + (gov.topType ? ' — top: ' + gov.topType : ''));
  }

  // Threshold alerts
  if (alerts.length > 0) {
    lines.push('\nTHRESHOLD ALERTS:');
    alerts.forEach(function (a) {
      var action;
      if (a.level === 'RED') {
        action = ' — CREATE ops_breakfix task';
      } else if (a.level === 'YELLOW' && a.signal && a.signal.indexOf('produced 0 actions') !== -1) {
        // Stalled-agent YELLOW: direct diagnostic action
        var isSelf = a.signal.indexOf('forge') === 0;
        action = isSelf
          ? ' — you (Forge) are stalled. Diagnose self: prompt misconfiguration? orphan guard? no actionable intel? Save a diagnostic memory and comment on Nova\'s highest-priority task with your status.'
          : ' — investigate: create a diagnostic comment on the stalled agent\'s highest-priority task OR a status comment on Nova listing suspected blockers (prompt issue, guardrail, no assigned work).';
      } else {
        action = ' — monitor closely';
      }
      lines.push('- [' + a.level + '] ' + a.signal + action);
    });
  } else {
    lines.push('\nAll thresholds GREEN — no alerts.');
    lines.push('\nGREEN-STATE RESPONSIBILITIES (don\'t go silent on green — proactive ops is how you add value):');
    lines.push('- Weekly ops report: save a `weekly_report` memory summarizing heartbeat reliability, cost trend, top blockers, governance health. Heartbeat tracks the last one and nudges when 7+ days elapse.');
    lines.push('- Runbook creation: when 3+ identical incidents recurred in the last 7d, create a `runbook` doc via create-doc (kind: runbook).');
    lines.push('- Maintenance status: comment on Nova\'s high-priority infra tasks with readiness status when relevant.');
  }

  return lines.join('\n');
}

module.exports = {
  buildForgeOpsDigest: buildForgeOpsDigest,
  _buildForgeOpsPromptBlock: _buildForgeOpsPromptBlock
};
