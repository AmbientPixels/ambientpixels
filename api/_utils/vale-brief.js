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

  return {
    lastRunAt: lastRun && (lastRun.timestamp || lastRun.at || null),
    pendingApprovals: pendingApprovals,
    openActionCount: openActions.length,
    dueSoon: dueSoon
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
  return lines.join('\n');
}

module.exports = { buildBriefFacts, formatBriefFallback };
