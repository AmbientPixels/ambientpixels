// vale-brief.js — PURE brief fact-gather + deterministic fallback text. The cron feeds
// these facts to the model for a human narration, falling back to formatBriefFallback.
'use strict';

var DAY_MS = 86400000;

function buildBriefFacts(input, now) {
  now = now || Date.now();
  input = input || {};
  var runs = Array.isArray(input.heartbeatRuns) ? input.heartbeatRuns : [];
  var approvals = Array.isArray(input.approvalQueue) ? input.approvalQueue : [];
  var actionList = Array.isArray(input.ceoActionList) ? input.ceoActionList : [];

  var lastRun = runs.length ? runs[runs.length - 1] : null;
  var pendingApprovals = approvals.filter(function (q) {
    return q && (q.status === 'pending' || q.status === 'pending_approval' || !q.status);
  }).length;
  var openActions = actionList.filter(function (a) { return a.status !== 'done'; });
  var dueSoon = openActions.filter(function (a) {
    if (!a.deadline) return false;
    var d = new Date(a.deadline).getTime();
    return isFinite(d) && (d - now) <= 3 * DAY_MS;
  }).map(function (a) { return { title: a.title, deadline: a.deadline }; });

  // Board minute (2026-10-06): the north-star reading and the bet ledger, built by code,
  // so the CEO's first read after an absence is numbers with denominators, not prose.
  var objectives = Array.isArray(input.objectives) ? input.objectives : [];
  var ns = objectives.find(function (o) { return o && o.status === 'active' && o.northStarMetric === 'qualified_uses_week'; }) || null;
  var northStar = ns ? {
    metric: 'qualified_uses_week',
    value: (ns.measuredValue === undefined || ns.measuredValue === null) ? 'unmeasured' : ns.measuredValue,
    target: ns.criteria && ns.criteria.target, by: ns.criteria && ns.criteria.by,
    measuredAt: ns.measuredAt || null
  } : null;
  var ledger = (input.outcomeDigest && input.outcomeDigest.betLedger) || null;
  var weekAgo = now - 7 * DAY_MS;
  var bets = ledger ? {
    running: (ledger.running || []).map(function (r) {
      var start = Date.parse(r.startDate || '');
      return { title: r.title, betKey: r.betKey, daysIn: isFinite(start) ? Math.floor((now - start) / DAY_MS) : null, killBy: r.kill && r.kill.byDay, measurementGap: !!r.measurementGap, scaleEligible: !!r.scaleEligible };
    }),
    scoredThisWeek: (ledger.rows || []).filter(function (r) { var t = Date.parse(r.scoredAt || ''); return isFinite(t) && t >= weekAgo; })
      .map(function (r) { return { title: r.title, result: r.result, value: r.actual && r.actual.value, expected: r.expected, posts: r.actual && r.actual.posts }; }),
    neverTried: ledger.neverTried || [],
    calibration: ledger.calibration || {}
  } : null;

  return {
    lastRunAt: lastRun && (lastRun.timestamp || lastRun.at || null),
    pendingApprovals: pendingApprovals,
    openActionCount: openActions.length,
    dueSoon: dueSoon,
    northStar: northStar,
    bets: bets
  };
}

function formatBriefFallback(facts, kind) {
  facts = facts || {};
  var lines = [];
  lines.push((kind === 'evening' ? 'Evening wrap' : 'Morning brief') + ':');
  lines.push('- Approvals waiting on you: ' + (facts.pendingApprovals || 0));
  lines.push('- Open CEO action items: ' + (facts.openActionCount || 0));
  if (facts.dueSoon && facts.dueSoon.length) {
    lines.push('- Due soon: ' + facts.dueSoon.map(function (a) { return a.title + (a.deadline ? ' (' + a.deadline + ')' : ''); }).join('; '));
  }
  if (facts.northStar) {
    var n = facts.northStar;
    lines.push('- North star qualified_uses_week: ' + n.value + (n.target ? ' (target ' + n.target + ' by ' + n.by + ')' : ''));
  }
  if (facts.bets) {
    var b = facts.bets;
    if (b.running && b.running.length) {
      lines.push('- Bets running: ' + b.running.map(function (r) {
        return r.title + ' (day ' + (r.daysIn === null ? '?' : r.daysIn) + (r.killBy ? ', kill check day ' + r.killBy : '') + (r.measurementGap ? ', UNMEASURED' : '') + (r.scaleEligible ? ', scale-eligible' : '') + ')';
      }).join('; '));
    } else {
      lines.push('- Bets running: none — nothing is being tested');
    }
    if (b.scoredThisWeek && b.scoredThisWeek.length) {
      lines.push('- Scored this week: ' + b.scoredThisWeek.map(function (r) {
        return r.title + ' ' + String(r.result).toUpperCase() + (r.value === null || r.value === undefined ? '' : ' (' + r.value + ' people vs expected ' + r.expected + ' over ' + r.posts + ' posts)');
      }).join('; '));
    }
    if (b.neverTried && b.neverTried.length) lines.push('- Mechanisms never tried: ' + b.neverTried.join(', '));
  }
  return lines.join('\n');
}

module.exports = { buildBriefFacts, formatBriefFallback };
