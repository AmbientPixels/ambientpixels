// emergence-intel.js — Emergence Monitoring digest builder (System 15)
//
// Pure function. No storage calls inside — all inputs passed as params.
// Filtering semantics (applied inside the function, NOT the caller's responsibility):
//   - rejectRate: only counts approvalQueue entries with resolvedBy === 'ceo' and
//     status in {'approved','rejected'}. Auto-approved entries (Capital system's
//     <$0.50 tier, any resolvedBy !== 'ceo') are EXCLUDED from both numerator
//     and denominator.
//   - fleetChurn: only counts agent_*_proposal entries with status === 'approved'.
//     Pending proposals count toward proposalRate velocity, NOT churn.
//   - Governance log is only needed for optional signal enrichment (surfacing
//     recent agent-retired events as evidence). Primary signals derive from
//     approvalQueue.
//
// Output shape: see plan Phase 1a. Always returns a valid digest object even if
// inputs are empty — signals array may be empty but metrics sub-objects are populated.

var {
  EMERGENCE_THRESHOLDS,
  EMERGENCE_BLAST_RADIUS,
  EMERGENCE_SIGNALS_MAX
} = require('./constants');

var DAY_MS = 24 * 60 * 60 * 1000;

function _id(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
}

function _ratio(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 100) / 100;
}

function _ageHours(iso, nowMs) {
  var t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return Math.round(((nowMs - t) / (60 * 60 * 1000)) * 10) / 10;
}

// Signal 1: proposal rate per agent per type (7d + 30d).
// Emits signal per agent if any type exceeds per-agent 7d threshold.
function _computeProposalRate(approvalQueue, nowMs) {
  var cutoff7d = nowMs - 7 * DAY_MS;
  var cutoff30d = nowMs - 30 * DAY_MS;
  var byType = {};
  var byAgent = {};

  approvalQueue.forEach(function (q) {
    if (!q || !q.createdAt || !q.type) return;
    var ts = Date.parse(q.createdAt);
    if (!Number.isFinite(ts) || ts < cutoff30d) return;
    var is7d = ts >= cutoff7d;
    var type = q.type;
    var agent = q.proposedBy || 'unknown';

    if (!byType[type]) byType[type] = { total7d: 0, total30d: 0, byAgent: {} };
    if (!byType[type].byAgent[agent]) byType[type].byAgent[agent] = { '7d': 0, '30d': 0 };
    byType[type].total30d += 1;
    byType[type].byAgent[agent]['30d'] += 1;
    if (is7d) {
      byType[type].total7d += 1;
      byType[type].byAgent[agent]['7d'] += 1;
    }

    if (!byAgent[agent]) byAgent[agent] = { total7d: 0, total30d: 0, byType: {} };
    if (!byAgent[agent].byType[type]) byAgent[agent].byType[type] = { '7d': 0, '30d': 0 };
    byAgent[agent].total30d += 1;
    byAgent[agent].byType[type]['30d'] += 1;
    if (is7d) {
      byAgent[agent].total7d += 1;
      byAgent[agent].byType[type]['7d'] += 1;
    }
  });

  // Generate signals from thresholds
  var signals = [];
  var t = EMERGENCE_THRESHOLDS;
  Object.keys(byAgent).forEach(function (agent) {
    var byT = byAgent[agent].byType;
    Object.keys(byT).forEach(function (type) {
      var c = byT[type]['7d'];
      if (c >= t.proposalRatePerAgent7d.red) {
        signals.push({
          id: _id('esig'),
          level: 'RED',
          signalType: 'proposal-rate',
          subject: agent + ':' + type,
          signal: agent + ' emitted ' + c + ' ' + type + ' proposals in last 7d (>= ' + t.proposalRatePerAgent7d.red + ')',
          recommendation: 'Review whether ' + agent + ' has a legitimate pattern; if not, CEO may reject and trigger 14d cooldown. Consider if proposal thresholds need recalibration.',
          threshold: { ...t.proposalRatePerAgent7d, window: '7d', metric: 'per-agent per-type count' },
          evidence: { count: c, type: type, agent: agent },
          at: new Date(nowMs).toISOString()
        });
      } else if (c >= t.proposalRatePerAgent7d.yellow) {
        signals.push({
          id: _id('esig'),
          level: 'YELLOW',
          signalType: 'proposal-rate',
          subject: agent + ':' + type,
          signal: agent + ' emitted ' + c + ' ' + type + ' proposals in last 7d (>= ' + t.proposalRatePerAgent7d.yellow + ')',
          recommendation: 'Monitor. Expected to self-limit via existing daily rate caps.',
          threshold: { ...t.proposalRatePerAgent7d, window: '7d' },
          evidence: { count: c, type: type, agent: agent },
          at: new Date(nowMs).toISOString()
        });
      }
    });
  });

  return { metrics: { byType: byType, byAgent: byAgent }, signals: signals };
}

// Signal 2: reject rate per emitter (30d, CEO-resolved only).
// Auto-approved entries (resolvedBy !== 'ceo') are EXCLUDED from both num and denom.
function _computeRejectRate(approvalQueue, nowMs) {
  var cutoff = nowMs - 30 * DAY_MS;
  var byEmitter = {};

  approvalQueue.forEach(function (q) {
    if (!q || !q.resolvedAt || !q.resolvedBy) return;
    if (q.resolvedBy !== 'ceo') return; // exclude auto-approved
    if (q.status !== 'approved' && q.status !== 'rejected') return;
    var ts = Date.parse(q.resolvedAt);
    if (!Number.isFinite(ts) || ts < cutoff) return;
    var agent = q.proposedBy || 'unknown';
    if (!byEmitter[agent]) byEmitter[agent] = { total: 0, approved: 0, rejected: 0, rate: 0 };
    byEmitter[agent].total += 1;
    if (q.status === 'rejected') byEmitter[agent].rejected += 1;
    else byEmitter[agent].approved += 1;
  });

  Object.keys(byEmitter).forEach(function (a) {
    byEmitter[a].rate = _ratio(byEmitter[a].rejected, byEmitter[a].total);
  });

  var signals = [];
  var t = EMERGENCE_THRESHOLDS;
  Object.keys(byEmitter).forEach(function (agent) {
    var e = byEmitter[agent];
    if (e.total < t.rejectRateMinSamples) return; // guard against low-sample noise
    if (e.rate >= t.rejectRatePerEmitter.red) {
      signals.push({
        id: _id('esig'),
        level: 'RED',
        signalType: 'reject-rate',
        subject: agent,
        signal: agent + ' reject rate ' + Math.round(e.rate * 100) + '% (' + e.rejected + '/' + e.total + ') in last 30d',
        recommendation: 'Proposals from this emitter are consistently rejected. Review their prompt / doctrine for misalignment, or consider propose-role-evolution to adjust expectedActionMix.',
        threshold: { ...t.rejectRatePerEmitter, minSamples: t.rejectRateMinSamples },
        evidence: { agent: agent, total: e.total, rejected: e.rejected },
        at: new Date(nowMs).toISOString()
      });
    } else if (e.rate >= t.rejectRatePerEmitter.yellow) {
      signals.push({
        id: _id('esig'),
        level: 'YELLOW',
        signalType: 'reject-rate',
        subject: agent,
        signal: agent + ' reject rate ' + Math.round(e.rate * 100) + '% (' + e.rejected + '/' + e.total + ') in last 30d',
        recommendation: 'Monitor. Trending toward noise threshold.',
        threshold: { ...t.rejectRatePerEmitter, minSamples: t.rejectRateMinSamples },
        evidence: { agent: agent, total: e.total, rejected: e.rejected },
        at: new Date(nowMs).toISOString()
      });
    }
  });

  return { metrics: { byEmitter: byEmitter }, signals: signals };
}

// Signal 3: fleet churn velocity (30d, approved agent_* only).
function _computeFleetChurn(approvalQueue, nowMs) {
  var cutoff = nowMs - 30 * DAY_MS;
  var hires = 0, retires = 0, evolutions = 0;
  approvalQueue.forEach(function (q) {
    if (!q || q.status !== 'approved' || !q.resolvedAt) return;
    var ts = Date.parse(q.resolvedAt);
    if (!Number.isFinite(ts) || ts < cutoff) return;
    if (q.type === 'agent_hire_proposal') hires += 1;
    else if (q.type === 'agent_retire_proposal') retires += 1;
    else if (q.type === 'agent_evolution_proposal') evolutions += 1;
  });

  var netChange = hires - retires;
  var combined = hires + retires;
  var trend;
  if (hires >= 2 && retires >= 2) trend = 'churning';
  else if (hires > retires) trend = 'expanding';
  else if (retires > hires) trend = 'contracting';
  else trend = 'stable';

  var signals = [];
  var t = EMERGENCE_THRESHOLDS;
  if (combined >= t.fleetChurn30d.red) {
    signals.push({
      id: _id('esig'),
      level: 'RED',
      signalType: 'fleet-churn',
      subject: 'system',
      signal: combined + ' fleet mutations in last 30d (' + hires + ' hires + ' + retires + ' retires). Trend: ' + trend,
      recommendation: 'Fleet instability. Review whether churn is purposeful reorganization or runaway pattern. Consider freeze via direct state edit if accelerating.',
      threshold: { ...t.fleetChurn30d, metric: 'hires+retires 30d' },
      evidence: { hires: hires, retires: retires, evolutions: evolutions, trend: trend },
      at: new Date(nowMs).toISOString()
    });
  } else if (combined >= t.fleetChurn30d.yellow) {
    signals.push({
      id: _id('esig'),
      level: 'YELLOW',
      signalType: 'fleet-churn',
      subject: 'system',
      signal: combined + ' fleet mutations in last 30d (' + hires + ' hires + ' + retires + ' retires). Trend: ' + trend,
      recommendation: 'Monitor. Fleet evolving — ensure proposals align with strategic direction.',
      threshold: { ...t.fleetChurn30d },
      evidence: { hires: hires, retires: retires, evolutions: evolutions, trend: trend },
      at: new Date(nowMs).toISOString()
    });
  }

  return {
    metrics: { hires30d: hires, retires30d: retires, evolutions30d: evolutions, netChange30d: netChange, trend: trend },
    signals: signals
  };
}

// Signal 4: capital RED streak (consecutive days where ANY heartbeat had systemStatus RED).
// Approximation via heartbeatRuns bucket-by-day. Not perfect but adequate for threshold.
function _computeCapitalRedStreak(capitalAllocation, heartbeatRuns, nowMs) {
  // Bucket heartbeat runs by YYYY-MM-DD; mark day RED if any run in that day
  // has financeDigest.budget.monthly.status === 'RED' OR capitalAllocation snapshot was RED.
  var daysSeen = {}; // { 'YYYY-MM-DD': 'RED' | 'OTHER' }
  (heartbeatRuns || []).forEach(function (r) {
    if (!r) return;
    var ts = Date.parse(r.startedAt || r.timestamp || '');
    if (!Number.isFinite(ts)) return;
    var day = new Date(ts).toISOString().substring(0, 10);
    // Prefer capitalAllocation snapshot if stored; fall back to financeDigest monthly status
    var redThisRun = false;
    if (r.capitalStatus === 'RED') redThisRun = true;
    // If heartbeatSummary doesn't carry capitalStatus, we can't know — use conservative 'OTHER'
    if (redThisRun) daysSeen[day] = 'RED';
    else if (!daysSeen[day]) daysSeen[day] = 'OTHER';
  });

  // Current capital state overrides today
  var todayKey = new Date(nowMs).toISOString().substring(0, 10);
  if (capitalAllocation && capitalAllocation.systemStatus === 'RED') daysSeen[todayKey] = 'RED';

  // Walk backwards from today to find current streak
  var streak = 0;
  var cursor = new Date(nowMs);
  cursor.setUTCHours(0, 0, 0, 0);
  for (var i = 0; i < 30; i++) {
    var key = cursor.toISOString().substring(0, 10);
    if (daysSeen[key] === 'RED') streak += 1;
    else break;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  // Longest streak in last 30 days
  var sortedDays = Object.keys(daysSeen).sort();
  var longest = 0, currentRun = 0;
  sortedDays.forEach(function (d) {
    if (daysSeen[d] === 'RED') { currentRun += 1; if (currentRun > longest) longest = currentRun; }
    else currentRun = 0;
  });

  var signals = [];
  var t = EMERGENCE_THRESHOLDS;
  if (streak >= t.capitalRedStreak.red) {
    signals.push({
      id: _id('esig'),
      level: 'RED',
      signalType: 'capital-red-streak',
      subject: 'system',
      signal: 'Capital has been RED for ' + streak + ' consecutive days',
      recommendation: 'Sustained overspend. Recommend immediate cap tightening via propose-role-evolution OR kill-switch via execution_mode: frozen.',
      threshold: { ...t.capitalRedStreak },
      evidence: { currentStreakDays: streak, longestStreak30d: longest },
      at: new Date(nowMs).toISOString()
    });
  } else if (streak >= t.capitalRedStreak.yellow) {
    signals.push({
      id: _id('esig'),
      level: 'YELLOW',
      signalType: 'capital-red-streak',
      subject: 'system',
      signal: 'Capital has been RED for ' + streak + ' consecutive days',
      recommendation: 'Monitor. Trending toward sustained overspend.',
      threshold: { ...t.capitalRedStreak },
      evidence: { currentStreakDays: streak, longestStreak30d: longest },
      at: new Date(nowMs).toISOString()
    });
  }

  return {
    metrics: { currentStreakDays: streak, longestStreak30d: longest },
    signals: signals
  };
}

// Signal 5: approval queue depth + oldest-pending-age by blast-radius tier.
function _computeApprovalDepth(approvalQueue, nowMs) {
  var pending = (approvalQueue || []).filter(function (q) { return q && q.status === 'pending'; });
  var byTier = { critical: { count: 0, oldestAgeHours: 0 }, high: { count: 0, oldestAgeHours: 0 }, medium: { count: 0, oldestAgeHours: 0 }, low: { count: 0, oldestAgeHours: 0 } };
  var totalOldest = 0;

  pending.forEach(function (q) {
    var tier = EMERGENCE_BLAST_RADIUS[q.type] || 'low';
    byTier[tier].count += 1;
    var age = _ageHours(q.createdAt, nowMs);
    if (age !== null) {
      if (age > byTier[tier].oldestAgeHours) byTier[tier].oldestAgeHours = age;
      if (age > totalOldest) totalOldest = age;
    }
  });

  var signals = [];
  var t = EMERGENCE_THRESHOLDS;
  // Critical-tier age alert
  if (byTier.critical.oldestAgeHours >= t.approvalCriticalAgeH.red) {
    signals.push({
      id: _id('esig'),
      level: 'RED',
      signalType: 'approval-depth',
      subject: 'critical-tier',
      signal: 'Critical-tier proposal pending for ' + Math.round(byTier.critical.oldestAgeHours) + 'h (>= ' + t.approvalCriticalAgeH.red + 'h)',
      recommendation: 'High blast-radius proposal (agent retire / hire / product retire) is blocking. Review + decide ASAP.',
      threshold: { ...t.approvalCriticalAgeH, tier: 'critical' },
      evidence: { oldestAgeHours: byTier.critical.oldestAgeHours, count: byTier.critical.count },
      at: new Date(nowMs).toISOString()
    });
  } else if (byTier.critical.oldestAgeHours >= t.approvalCriticalAgeH.yellow) {
    signals.push({
      id: _id('esig'),
      level: 'YELLOW',
      signalType: 'approval-depth',
      subject: 'critical-tier',
      signal: 'Critical-tier proposal pending for ' + Math.round(byTier.critical.oldestAgeHours) + 'h',
      recommendation: 'Review soon — aging critical proposal.',
      threshold: { ...t.approvalCriticalAgeH, tier: 'critical' },
      evidence: { oldestAgeHours: byTier.critical.oldestAgeHours, count: byTier.critical.count },
      at: new Date(nowMs).toISOString()
    });
  }
  // Total-depth alert
  if (pending.length >= t.approvalDepthTotal.red) {
    signals.push({
      id: _id('esig'),
      level: 'RED',
      signalType: 'approval-depth',
      subject: 'total',
      signal: pending.length + ' pending approvals (>= ' + t.approvalDepthTotal.red + ')',
      recommendation: 'Queue overload. CEO attention required to prevent high-stakes proposals from being buried.',
      threshold: { ...t.approvalDepthTotal },
      evidence: { total: pending.length, byTier: byTier },
      at: new Date(nowMs).toISOString()
    });
  }

  return {
    metrics: { total: pending.length, oldestAgeHours: totalOldest, byTier: byTier },
    signals: signals
  };
}

// Signal 6: fleet throughput collapse (cause-agnostic). Watches the SYMPTOM —
// the heartbeat producing little/no work — so it catches model misconfig,
// credit exhaustion, and rate-limiting alike. Deterministic: fires even during a
// total LLM outage (this cron uses no LLM). Two prongs, level = worst of both.
function _median(nums) {
  if (!nums.length) return null;
  var s = nums.slice().sort(function (a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function _computeThroughputCollapse(heartbeatRuns, nowMs) {
  var t = EMERGENCE_THRESHOLDS.throughputCollapse;
  var realKeys = function (perAgent) {
    return Object.keys(perAgent || {}).filter(function (k) { return k.indexOf('_closing') === -1; });
  };

  // Qualifying runs = ran the agent loop (non-empty perAgent of real agents).
  // Excludes frozen/observe/errored-early runs that legitimately did nothing.
  var qualifying = (heartbeatRuns || []).filter(function (r) {
    return r && r.perAgent && realKeys(r.perAgent).length > 0;
  });
  var window = qualifying.slice(-t.windowRuns);
  var n = window.length;

  var metrics = {
    qualifyingRuns: n,
    windowRuns: t.windowRuns,
    avgExecuted: null,
    silentAgentCount: 0,
    silentAgents: [],
    busyAgentCount: 0
  };

  if (n < t.minRunsRequired) {
    return { metrics: metrics, signals: [] };
  }

  // Prong 1: aggregate executed actions per run.
  var execSum = window.reduce(function (acc, r) {
    var e = r.agentActions && Number(r.agentActions.executed);
    return acc + (Number.isFinite(e) ? e : 0);
  }, 0);
  var avgExecuted = Math.round((execSum / n) * 10) / 10;
  metrics.avgExecuted = avgExecuted;

  // Prong 2: agents present in EVERY window run, executed 0 in all, median
  // latency below the floor (the failed/empty-call signature).
  var agentUniverse = {};
  window.forEach(function (r) {
    realKeys(r.perAgent).forEach(function (id) { agentUniverse[id] = true; });
  });
  var silent = [];
  var busy = 0;
  Object.keys(agentUniverse).forEach(function (id) {
    var appearances = 0, anyExecuted = false, lats = [];
    window.forEach(function (r) {
      var a = r.perAgent && r.perAgent[id];
      if (!a) return;
      appearances += 1;
      var ex = Number(a.actionsExecuted);
      if (Number.isFinite(ex) && ex > 0) anyExecuted = true;
      var lat = Number(a.avgLatencyMs);
      if (Number.isFinite(lat)) lats.push(lat);
    });
    if (anyExecuted) { busy += 1; return; }
    var med = _median(lats);
    // Silent = ran every cycle, never executed, and median latency looks like a
    // failed/empty call (not seconds of deliberation).
    if (appearances === n && med !== null && med < t.latencyFloorMs) silent.push(id);
  });
  metrics.silentAgentCount = silent.length;
  metrics.silentAgents = silent;
  metrics.busyAgentCount = busy;

  // Level = worst of the two prongs.
  function level(value, thr, lowerIsWorse) {
    if (lowerIsWorse) {
      if (value <= thr.red) return 'RED';
      if (value <= thr.yellow) return 'YELLOW';
    } else {
      if (value >= thr.red) return 'RED';
      if (value >= thr.yellow) return 'YELLOW';
    }
    return null;
  }
  var aggLevel = level(avgExecuted, t.avgExecuted, true);
  var silLevel = level(silent.length, t.silentAgents, false);
  var worst = (aggLevel === 'RED' || silLevel === 'RED') ? 'RED'
            : (aggLevel === 'YELLOW' || silLevel === 'YELLOW') ? 'YELLOW' : null;

  var signals = [];
  if (worst) {
    var silentNote = silent.length
      ? ', ' + silent.length + ' agent(s) silent at sub-second latency (' + silent.join(', ') + ')'
      : '';
    signals.push({
      id: _id('esig'),
      level: worst,
      signalType: 'throughput-collapse',
      subject: 'system',
      signal: 'Fleet throughput collapsed: avg ' + avgExecuted + ' actions/run over last ' + n + ' runs' + silentNote,
      recommendation: 'Most common causes: systemConfig.heartbeatModel misconfigured (Gemini ignores the multi-section prompt) or an Anthropic credit/rate-limit failure (swallowed in gemini.js). Check the model setting + Anthropic billing. Healthy Claude runs are 3-15s/agent; sub-500ms + null reasoning = a failed LLM call, not an idle choice.',
      threshold: { avgExecuted: t.avgExecuted, silentAgents: t.silentAgents, windowRuns: t.windowRuns, latencyFloorMs: t.latencyFloorMs },
      evidence: { avgExecuted: avgExecuted, silentAgentCount: silent.length, silentAgents: silent, windowRuns: n },
      at: new Date(nowMs).toISOString()
    });
  }

  return { metrics: metrics, signals: signals };
}

function buildEmergenceDigest(ctx, nowMsIn) {
  var nowMs = Number.isFinite(nowMsIn) ? nowMsIn : Date.now();
  var approvalQueue = Array.isArray(ctx && ctx.approvalQueue) ? ctx.approvalQueue : [];
  var capitalAllocation = (ctx && ctx.capitalAllocation) || {};
  var heartbeatRuns = Array.isArray(ctx && ctx.heartbeatRuns) ? ctx.heartbeatRuns : [];

  var propRate = _computeProposalRate(approvalQueue, nowMs);
  var rejRate  = _computeRejectRate(approvalQueue, nowMs);
  var churn    = _computeFleetChurn(approvalQueue, nowMs);
  var redStreak = _computeCapitalRedStreak(capitalAllocation, heartbeatRuns, nowMs);
  var depth    = _computeApprovalDepth(approvalQueue, nowMs);
  var throughput = _computeThroughputCollapse(heartbeatRuns, nowMs);

  var allSignals = []
    .concat(propRate.signals)
    .concat(rejRate.signals)
    .concat(churn.signals)
    .concat(redStreak.signals)
    .concat(depth.signals)
    .concat(throughput.signals);

  // Trim to EMERGENCE_SIGNALS_MAX (FIFO — keep most recent if over)
  if (allSignals.length > EMERGENCE_SIGNALS_MAX) {
    allSignals = allSignals.slice(-EMERGENCE_SIGNALS_MAX);
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    window: { from: new Date(nowMs - 30 * DAY_MS).toISOString(), to: new Date(nowMs).toISOString() },
    signals: allSignals,
    metrics: {
      proposalRate: propRate.metrics,
      rejectRate:   rejRate.metrics,
      fleetChurn:   churn.metrics,
      capitalRedStreak: redStreak.metrics,
      approvalDepth: depth.metrics,
      throughputCollapse: throughput.metrics
    },
    lastCronRun: new Date(nowMs).toISOString()
  };
}

// Forge-only prompt block.
function _buildEmergencePromptBlock(agent, digest) {
  if (!agent || agent.name !== 'Forge') return '';
  if (!digest || !Array.isArray(digest.signals) || digest.signals.length === 0) return '';

  var redSignals = digest.signals.filter(function (s) { return s.level === 'RED'; }).slice(0, 3);
  var yellowSignals = digest.signals.filter(function (s) { return s.level === 'YELLOW'; }).slice(0, 3);

  var lines = ['\n\nEMERGENCE SIGNALS (observational — CEO has visibility; propose countermeasures through existing actions, do NOT act directly):'];

  if (redSignals.length > 0) {
    lines.push('\nRED (compound patterns crossing threshold):');
    redSignals.forEach(function (s) {
      lines.push('- [' + s.signalType + '] ' + s.signal);
      lines.push('  → ' + s.recommendation);
    });
  }
  if (yellowSignals.length > 0) {
    lines.push('\nYELLOW (monitor):');
    yellowSignals.forEach(function (s) {
      lines.push('- [' + s.signalType + '] ' + s.signal);
    });
  }

  lines.push('\nThese are computed daily at 16:00 UTC from approvalQueue + capitalAllocation + heartbeatRuns. Full details: /modules/company/emergence.html');
  return lines.join('\n');
}

module.exports = {
  buildEmergenceDigest: buildEmergenceDigest,
  _buildEmergencePromptBlock: _buildEmergencePromptBlock
};
