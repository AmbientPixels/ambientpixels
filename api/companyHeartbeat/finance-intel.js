// finance-intel.js — Cipher's financial intelligence digest builder
// Mirrors ops-intel.js pattern: builds digest from raw data, formats into prompt block

var { FINANCE_BUDGET_DAILY, FINANCE_BUDGET_MONTHLY } = require('./constants');

var THRESHOLDS = {
  dailyOverBudget: { yellow: 1.2, red: 1.5 },
  wasteRate:       { yellow: 30, red: 50 },
  costPerAction:   { yellow: 0.02, red: 0.05 },
  weeklyTrend:     { yellow: 15, red: 30 }
};

function buildFinanceDigest(geminiUsage, heartbeatRuns, campaigns, tasks, performanceDigest, costSummary, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var usage = Array.isArray(geminiUsage) ? geminiUsage : [];
  var runs = Array.isArray(heartbeatRuns) ? heartbeatRuns : [];
  var camps = Array.isArray(campaigns) ? campaigns : [];
  var allTasks = Array.isArray(tasks) ? tasks : [];
  var sevenDayMs = 7 * 24 * 60 * 60 * 1000;
  var sevenCutoff = now - sevenDayMs;

  // ── Budget Status ──
  var gemini = costSummary || {};
  var byDay = gemini.byDay || {};
  var days = Object.keys(byDay).sort().slice(-7);
  var prevDays = Object.keys(byDay).sort().slice(-14, -7);

  var thisWeekSpend = days.reduce(function (s, d) { return s + ((byDay[d] && byDay[d].cost) || 0); }, 0);
  var prevWeekSpend = prevDays.reduce(function (s, d) { return s + ((byDay[d] && byDay[d].cost) || 0); }, 0);
  var avgDailySpend = days.length > 0 ? thisWeekSpend / days.length : 0;
  var projectedMonthly = avgDailySpend * 30;

  var trendDelta = prevWeekSpend > 0 ? Math.round(((thisWeekSpend - prevWeekSpend) / prevWeekSpend) * 100) : 0;
  var trendDirection = trendDelta > 15 ? 'rising' : (trendDelta < -15 ? 'falling' : 'flat');

  var dailyPct = FINANCE_BUDGET_DAILY > 0 ? Math.round((avgDailySpend / FINANCE_BUDGET_DAILY) * 100) : 0;
  var monthlyPct = FINANCE_BUDGET_MONTHLY > 0 ? Math.round((projectedMonthly / FINANCE_BUDGET_MONTHLY) * 100) : 0;

  function _budgetStatus(actual, budget, yellowMult, redMult) {
    if (actual > budget * redMult) return 'RED';
    if (actual > budget * yellowMult) return 'YELLOW';
    return 'GREEN';
  }

  var budget = {
    daily: { actual: Math.round(avgDailySpend * 100) / 100, budget: FINANCE_BUDGET_DAILY, pct: dailyPct, status: _budgetStatus(avgDailySpend, FINANCE_BUDGET_DAILY, THRESHOLDS.dailyOverBudget.yellow, THRESHOLDS.dailyOverBudget.red) },
    monthly: { actual: Math.round(projectedMonthly * 100) / 100, budget: FINANCE_BUDGET_MONTHLY, pct: monthlyPct, status: _budgetStatus(projectedMonthly, FINANCE_BUDGET_MONTHLY, THRESHOLDS.dailyOverBudget.yellow, THRESHOLDS.dailyOverBudget.red) }
  };

  // ── Agent Efficiency ──
  var agentCosts = {};
  var byAgent = gemini.byAgent || {};
  Object.keys(byAgent).forEach(function (aid) {
    agentCosts[aid] = { cost: (byAgent[aid] && byAgent[aid].cost) || 0, calls: (byAgent[aid] && byAgent[aid].calls) || 0 };
  });

  // Count actions from heartbeat runs (last 7d)
  var agentActions = {};
  var recentRuns = runs.filter(function (r) {
    var ts = Date.parse(r.startedAt || r.timestamp || '');
    return Number.isFinite(ts) && ts >= sevenCutoff;
  });
  recentRuns.forEach(function (r) {
    if (!r.agentResults) return;
    Object.keys(r.agentResults).forEach(function (aid) {
      if (!agentActions[aid]) agentActions[aid] = { executed: 0, blocked: 0 };
      var ar = r.agentResults[aid];
      agentActions[aid].executed += (ar.actionsExecuted || ar.actions || 0);
      agentActions[aid].blocked += (ar.actionsBlocked || 0);
    });
  });

  // Merge cost + actions + performance
  var perfAgents = (performanceDigest && performanceDigest.agents) || {};
  var agentEfficiency = {};
  var allAgentIds = new Set(Object.keys(agentCosts).concat(Object.keys(agentActions)));
  allAgentIds.forEach(function (aid) {
    var cost = (agentCosts[aid] && agentCosts[aid].cost) || 0;
    var executed = (agentActions[aid] && agentActions[aid].executed) || 0;
    var blocked = (agentActions[aid] && agentActions[aid].blocked) || 0;
    var total = executed + blocked;
    var wasteRate = total > 0 ? Math.round((blocked / total) * 100) : 0;
    var costPerAction = executed > 0 ? Math.round((cost / executed) * 1000) / 1000 : 0;

    var approvalRate = (perfAgents[aid] && perfAgents[aid].ceoApprovalRate) || 0;
    var costPerApproved = (approvalRate > 0 && executed > 0) ? Math.round((cost / (executed * approvalRate)) * 1000) / 1000 : 0;

    var status = 'GREEN';
    if (wasteRate >= THRESHOLDS.wasteRate.red || costPerAction >= THRESHOLDS.costPerAction.red) status = 'RED';
    else if (wasteRate >= THRESHOLDS.wasteRate.yellow || costPerAction >= THRESHOLDS.costPerAction.yellow) status = 'YELLOW';

    agentEfficiency[aid] = { cost: Math.round(cost * 100) / 100, executed: executed, blocked: blocked, wasteRate: wasteRate, costPerAction: costPerAction, costPerApproved: costPerApproved, status: status };
  });

  // Sort by cost descending for top spenders
  var sortedAgents = Object.keys(agentEfficiency).sort(function (a, b) {
    return agentEfficiency[b].cost - agentEfficiency[a].cost;
  });

  // ── Campaign ROI ──
  var activeCamps = camps.filter(function (c) { return c.status === 'active'; });
  var totalSpend7d = thisWeekSpend;
  var costPerCampaign = activeCamps.length > 0 ? totalSpend7d / activeCamps.length : 0;

  var campaignROI = activeCamps.slice(0, 5).map(function (c) {
    // Count engagement on tasks linked to this campaign
    var campTasks = allTasks.filter(function (t) { return t.campaign_id === c.id; });
    var engagement = 0;
    // Use performance digest social engagement if available
    campTasks.forEach(function (t) {
      // Rough: count completed social tasks as engagement proxy (1 completed social task ~ some engagement)
      if (t.status === 'done' && /social_/.test(t.taskType || '')) engagement += 10;
      // If task has reviewed_copy, it went through the pipeline
      if (t.reviewed_copy) engagement += 5;
    });

    var roiSignal = 'NEUTRAL';
    if (costPerCampaign > 0) {
      var engPerDollar = engagement / Math.max(0.01, costPerCampaign);
      if (engPerDollar > 50) roiSignal = 'POSITIVE';
      else if (engPerDollar < 10) roiSignal = 'NEGATIVE';
    }

    return {
      id: c.id,
      title: (c.title || c.id).substring(0, 40),
      estimatedCost: Math.round(costPerCampaign * 100) / 100,
      engagement: engagement,
      signal: roiSignal
    };
  });

  // ── Product Cost-to-Serve ──
  var totalCost = gemini.totalCost || thisWeekSpend;
  var productUsage = (typeof costSummary === 'object' && costSummary !== null) ? costSummary : {};
  // We don't have per-product Gemini costs, so this is a macro system metric
  var totalInteractions = (gemini.totalCalls || 0);
  var costPerInteraction = totalInteractions > 0 ? Math.round((totalCost / totalInteractions) * 1000) / 1000 : 0;

  // ── Alerts ──
  var alerts = [];

  if (budget.daily.status === 'RED') alerts.push({ level: 'RED', signal: 'Daily spend $' + budget.daily.actual + ' exceeds ' + THRESHOLDS.dailyOverBudget.red + 'x budget', recommendation: 'Identify highest-cost agent and recommend cadence reduction' });
  else if (budget.daily.status === 'YELLOW') alerts.push({ level: 'YELLOW', signal: 'Daily spend $' + budget.daily.actual + ' approaching budget limit', recommendation: 'Monitor — no action needed yet' });

  if (Math.abs(trendDelta) >= THRESHOLDS.weeklyTrend.red) alerts.push({ level: 'RED', signal: 'Weekly cost ' + (trendDelta > 0 ? '↑' : '↓') + Math.abs(trendDelta) + '% wow', recommendation: 'Investigate root cause — new campaigns or agent changes?' });
  else if (Math.abs(trendDelta) >= THRESHOLDS.weeklyTrend.yellow) alerts.push({ level: 'YELLOW', signal: 'Weekly cost trending ' + (trendDelta > 0 ? 'up' : 'down') + ' ' + Math.abs(trendDelta) + '%', recommendation: 'Monitor next cycle' });

  sortedAgents.forEach(function (aid) {
    var eff = agentEfficiency[aid];
    if (eff.status === 'RED') alerts.push({ level: 'RED', signal: aid + ' waste rate ' + eff.wasteRate + '% or cost $' + eff.costPerAction + '/action', recommendation: 'Flag to Nova — agent may need prompt optimization or task reassignment' });
    else if (eff.status === 'YELLOW' && alerts.length < 4) alerts.push({ level: 'YELLOW', signal: aid + ' waste rate ' + eff.wasteRate + '%', recommendation: 'Monitor — check if blocked actions are systemic' });
  });

  return {
    asOfUtc: new Date(now).toISOString(),
    budget: budget,
    agentEfficiency: agentEfficiency,
    sortedAgents: sortedAgents,
    campaignROI: campaignROI,
    costTrend: { thisWeek: Math.round(thisWeekSpend * 100) / 100, lastWeek: Math.round(prevWeekSpend * 100) / 100, deltaPct: trendDelta, direction: trendDirection },
    costPerInteraction: costPerInteraction,
    alerts: alerts
  };
}

function _buildFinancePromptBlock(agent, digest) {
  if (!digest || !agent || agent.id !== 'cipher') return '';

  var b = digest.budget || {};
  var trend = digest.costTrend || {};
  var eff = digest.agentEfficiency || {};
  var sorted = digest.sortedAgents || [];
  var roi = digest.campaignROI || [];
  var alerts = digest.alerts || [];

  function _arrow(pct) {
    if (pct > 5) return '↑' + pct + '%';
    if (pct < -5) return '↓' + Math.abs(pct) + '%';
    return '→flat';
  }

  var lines = ['\n\nFINANCIAL INTELLIGENCE DASHBOARD (7d):'];

  // Budget
  lines.push('\nBUDGET STATUS:');
  var daily = b.daily || {};
  var monthly = b.monthly || {};
  lines.push('- Daily: $' + (daily.actual || 0) + ' / $' + (daily.budget || FINANCE_BUDGET_DAILY) + ' (' + (daily.pct || 0) + '%) ' + (daily.status || 'GREEN'));
  lines.push('- Monthly projected: $' + (monthly.actual || 0) + ' / $' + (monthly.budget || FINANCE_BUDGET_MONTHLY) + ' (' + (monthly.pct || 0) + '%) ' + (monthly.status || 'GREEN'));
  lines.push('- Trend: ' + _arrow(trend.deltaPct || 0) + ' week-over-week');

  // Agent efficiency
  lines.push('\nAGENT EFFICIENCY (cost/action | waste):');
  sorted.forEach(function (aid) {
    var e = eff[aid];
    if (!e || e.executed === 0) return;
    lines.push('- ' + aid + ': $' + e.costPerAction + '/action, $' + e.costPerApproved + '/approved, waste ' + e.wasteRate + '% ' + e.status);
  });

  // Campaign ROI
  if (roi.length > 0) {
    lines.push('\nCAMPAIGN ROI:');
    roi.forEach(function (c) {
      lines.push('- "' + c.title + '" — est. $' + c.estimatedCost + ' cost, ' + c.engagement + ' engagement → ' + c.signal);
    });
  }

  // Alerts
  if (alerts.length > 0) {
    lines.push('\nTHRESHOLD ALERTS:');
    alerts.forEach(function (a) {
      lines.push('- [' + a.level + '] ' + a.signal + ' — ' + a.recommendation);
    });
  } else {
    lines.push('\nAll thresholds GREEN — no alerts.');
  }

  return lines.join('\n');
}

module.exports = {
  buildFinanceDigest: buildFinanceDigest,
  _buildFinancePromptBlock: _buildFinancePromptBlock
};
