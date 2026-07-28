// allocation-intel.js — Capital Allocation digest builder (System 12)
// Composes geminiUsage + financeDigest + outcomeDigest + persisted capitalAllocation state
// into a per-agent spend/cap decision surface. Imports FROM finance-intel NEVER the reverse.

var {
  AGENT_IDS,
  AGENT_ROLES,
  CAPITAL_DECISION_THRESHOLDS
} = require('./constants');
// Property access so applyBudgetOverrides' runtime reassignment is visible —
// a destructured number would be a stale copy of the deploy-time default.
var _CONST = require('./constants');

function _monthKey(ms) {
  var d = new Date(ms);
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return y + '-' + m;
}

function _round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function _agentStatus(spent, cap) {
  if (!(cap > 0)) return 'GREEN';
  var remaining = cap - spent;
  if (remaining < 0) return 'RED';
  if (remaining / cap <= 0.30) return 'YELLOW';
  return 'GREEN';
}

function _systemStatus(pct) {
  if (pct >= 120) return 'RED';
  if (pct >= 90) return 'YELLOW';
  return 'GREEN';
}

// Aggregate geminiUsage entries for the current month, bucketed by agentId.
// geminiUsage schema: { agentId, totalCost, timestamp (ISO), ... }
function _aggregateSpendByAgent(geminiUsage, monthKey) {
  var out = {};
  if (!Array.isArray(geminiUsage)) return out;
  for (var i = 0; i < geminiUsage.length; i++) {
    var e = geminiUsage[i];
    if (!e || !e.agentId || !e.timestamp) continue;
    var ts = Date.parse(e.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (_monthKey(ts) !== monthKey) continue;
    var aid = e.agentId;
    if (!out[aid]) out[aid] = 0;
    out[aid] += Number(e.totalCost) || 0;
  }
  return out;
}

// Classifies the dominant spend driver for an agent over the month by walking
// actions / experiments and attributing spend windows. Lightweight — if no
// strong signal just returns 'general'.
function _inferDriver(agentId, outcomeDigest) {
  if (!outcomeDigest) return 'general';
  var hasExp = Array.isArray(outcomeDigest.perExperiment) &&
    outcomeDigest.perExperiment.some(function (e) { return e && e.agent === agentId; });
  if (hasExp) return 'experiments';
  var hasCamp = Array.isArray(outcomeDigest.perAgent) &&
    outcomeDigest.perAgent.some(function (a) { return a && a.agent === agentId && (a.totalPosts || 0) > 0; });
  if (hasCamp) return 'posts';
  return 'general';
}

function buildAllocationDigest(geminiUsage, financeDigest, outcomeDigest, capitalAllocation, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var month = _monthKey(now);
  var systemBudget = _CONST.FINANCE_BUDGET_MONTHLY;

  var spendByAgent = _aggregateSpendByAgent(geminiUsage, month);
  var systemSpent = Object.keys(spendByAgent).reduce(function (s, k) { return s + spendByAgent[k]; }, 0);
  var pct = systemBudget > 0 ? Math.round((systemSpent / systemBudget) * 100) : 0;
  var squeezeMode = pct >= CAPITAL_DECISION_THRESHOLDS.systemBudgetSqueezePct;

  var perAgent = {};
  AGENT_IDS.forEach(function (aid) {
    var role = AGENT_ROLES[aid] || {};
    var cap = Number(role.monthlyCap) || 0;
    var spent = _round2(spendByAgent[aid] || 0);
    var remaining = _round2(cap - spent);
    perAgent[aid] = {
      cap: _round2(cap),
      spent: spent,
      remaining: remaining,
      pct: cap > 0 ? Math.round((spent / cap) * 100) : 0,
      status: _agentStatus(spent, cap),
      driver: _inferDriver(aid, outcomeDigest)
    };
  });

  // Top spenders (descending by spent, non-zero only)
  var topSpenders = AGENT_IDS
    .map(function (aid) { return { agent: aid, spent: perAgent[aid].spent, pct: perAgent[aid].pct, driver: perAgent[aid].driver }; })
    .filter(function (a) { return a.spent > 0; })
    .sort(function (a, b) { return b.spent - a.spent; });

  // ROI by campaign: outcomeDigest.perCampaign exposes engagement but not spend
  // (geminiUsage has no campaign_id). Attribute spend proportionally across
  // campaigns with non-zero engagement — matches the finance-intel approach of
  // averaging system spend across active campaigns. Shows only campaigns with
  // engagement > 0 so the dashboard doesn't bury signal in dozens of $0/0 rows.
  var roiByCampaign = [];
  if (outcomeDigest && Array.isArray(outcomeDigest.perCampaign)) {
    var _withEng = outcomeDigest.perCampaign.map(function (c) {
      var engagement = (c.totalEngagements || 0)
        + (c.blogViewsAttributed || 0) * 10
        + (c.formSubmitsAttributed || 0) * 50;
      return { c: c, engagement: engagement };
    }).filter(function (x) { return x.engagement > 0; });
    // Proportional spend attribution: share of this month's system spend split
    // evenly across engagement-producing campaigns. Not true per-campaign cost
    // (we don't track that yet), but surfaces relative ROI signal.
    var _perCampSpend = _withEng.length > 0 ? systemSpent / _withEng.length : 0;
    roiByCampaign = _withEng
      .sort(function (a, b) { return b.engagement - a.engagement; })
      .slice(0, 10)
      .map(function (x) {
        var spent = _round2(_perCampSpend);
        return {
          campaignId: x.c.campaignId,
          title: (x.c.title || x.c.campaignId || '').substring(0, 60),
          spent: spent,
          engagement: x.engagement,
          costPerEngagement: x.engagement > 0 ? Math.round((spent / x.engagement) * 1000) / 1000 : null,
          spendAttribution: 'proportional'
        };
      });
  }

  // ROI by experiment
  var roiByExperiment = [];
  if (outcomeDigest && Array.isArray(outcomeDigest.perExperiment)) {
    roiByExperiment = outcomeDigest.perExperiment.slice(0, 10).map(function (e) {
      var estimated = _round2(e.estimatedCost || 0);
      var actual = _round2(e.actualCost || 0);
      return {
        experimentId: e.experimentId || e.id,
        hypothesis: (e.hypothesis || '').substring(0, 80),
        agent: e.agent,
        estimatedCost: estimated,
        actualCost: actual,
        costVariance: actual > 0 && estimated > 0 ? _round2(actual - estimated) : null,
        verdict: e.verdict || e.status || null,
        samplesComplete: e.samplesComplete || 0
      };
    });
  }

  // Persisted queue/log pass-through
  var pendingRequests = (capitalAllocation && Array.isArray(capitalAllocation.pendingRequests))
    ? capitalAllocation.pendingRequests.filter(function (r) { return r && (r.status === 'pending_cipher' || r.status === 'pending_ceo'); })
    : [];
  var recentDecisions = (capitalAllocation && Array.isArray(capitalAllocation.decisionLog))
    ? capitalAllocation.decisionLog.slice(-10)
    : [];

  return {
    generatedAt: new Date(now).toISOString(),
    month: month,
    system: {
      budget: _round2(systemBudget),
      spent: _round2(systemSpent),
      pct: pct,
      status: _systemStatus(pct),
      remaining: _round2(systemBudget - systemSpent),
      squeezeMode: squeezeMode
    },
    perAgent: perAgent,
    topSpenders: topSpenders,
    roiByCampaign: roiByCampaign,
    roiByExperiment: roiByExperiment,
    openRequests: pendingRequests,
    recentDecisions: recentDecisions
  };
}

// Prompt block (per-agent awareness). Called from prompt-builders.js in Phase 3.
function _buildAllocationPromptBlock(agent, digest) {
  if (!agent || !digest) return '';
  var aid = agent.id;
  var pa = (digest.perAgent && digest.perAgent[aid]) || null;
  var sys = digest.system || {};
  var lines = [];
  lines.push('\n\nYOUR BUDGET (allocation for ' + digest.month + '):');
  if (pa) {
    lines.push('  Cap: $' + pa.cap + ' · Spent: $' + pa.spent + ' · Remaining: $' + pa.remaining + ' (' + pa.pct + '% of cap) · Status: ' + pa.status);
  } else {
    lines.push('  (no cap assigned)');
  }
  lines.push('\nSYSTEM BUDGET:');
  lines.push('  $' + sys.spent + ' / $' + sys.budget + ' (' + sys.pct + '%) · Status: ' + sys.status);
  if (sys.squeezeMode) {
    lines.push('  Squeeze mode: ALL new experiment/campaign proposals require Cipher approval regardless of size.');
  }
  lines.push('\nGuidance: if your proposal would push spent over cap, emit a \'request-budget\' action with estimatedCost + justification. Cipher reviews. Under $' + CAPITAL_DECISION_THRESHOLDS.autoApproveBelow + ' auto-approves (unless squeeze mode).');

  // Cipher-only: pending queue + retro
  if (aid === 'cipher') {
    var openReqs = Array.isArray(digest.openRequests) ? digest.openRequests : [];
    if (openReqs.length > 0) {
      lines.push('\nPENDING BUDGET REQUESTS (you decide):');
      openReqs.slice(0, 10).forEach(function (r) {
        lines.push('- ' + r.id + ' [' + r.agentId + ', $' + (r.estimatedCost || 0) + ', ' + (r.type || 'request') + ']: ' + (r.justification || '').substring(0, 120));
      });
      lines.push('Emit \'approve-budget-request\' with decision + note. Cite: system budget state, agent\'s prior ROI, cap remaining.');
    }
    var retro = Array.isArray(digest.roiByExperiment)
      ? digest.roiByExperiment.filter(function (e) { return e.actualCost > 0 && e.estimatedCost > 0; }).slice(0, 5)
      : [];
    if (retro.length > 0) {
      lines.push('\nRECENT BUDGET OUTCOMES (variance):');
      retro.forEach(function (e) {
        var variancePct = e.estimatedCost > 0 ? Math.round(((e.actualCost - e.estimatedCost) / e.estimatedCost) * 100) : 0;
        lines.push('- ' + e.agent + ' "' + e.hypothesis.substring(0, 40) + '": est $' + e.estimatedCost + ' / actual $' + e.actualCost + ' / ' + (variancePct >= 0 ? '+' : '') + variancePct + '%');
      });
    }
  }

  return lines.join('\n');
}

module.exports = {
  buildAllocationDigest: buildAllocationDigest,
  _buildAllocationPromptBlock: _buildAllocationPromptBlock,
  _monthKey: _monthKey
};
