'use strict';
// Pure convergence decision logic for heartbeat task revision loops.
// No IO — unit-tested in convergence.test.js. agent-runner.js performs the writes.

const CONVERGENCE_THRESHOLD = 5;                          // default deliverable cap before convergence acts
const CONVERGENCE_THRESHOLD_BY_TYPE = { design_asset: 3 };
const CONVERGENCE_AUTO_ACCEPT_TYPES = new Set(['design_asset', 'internal_doc', 'research', 'general']);
const CONVERGENCE_GRACE_HOURS = 48;                       // public task auto-cancels this long after escalation

function convergenceThresholdFor(taskType) {
  const key = String(taskType || '').toLowerCase();
  return CONVERGENCE_THRESHOLD_BY_TYPE[key] || CONVERGENCE_THRESHOLD;
}

function _deliverableCount(task) {
  return (((task && task.comments) || []).filter(function (c) { return c && c.type === 'deliverable'; })).length;
}

// Decide what to do with a task that may be in a revision loop.
// Returns { action, reason, threshold, deliverableCount }.
//   action: 'none' | 'auto-accept' | 'escalate' | 'grace-close'
function classifyConvergence(task, nowMs) {
  const t = task || {};
  const threshold = convergenceThresholdFor(t.taskType);
  const count = _deliverableCount(t);
  const internal = CONVERGENCE_AUTO_ACCEPT_TYPES.has(String(t.taskType || '').toLowerCase());
  const state = t._convergenceState || null;

  // Internal, low-stakes task at/over threshold: accept the latest draft. Wins even over a
  // prior escalation — accepting beats cancelling already-produced internal work.
  if (count >= threshold && internal) {
    return { action: 'auto-accept', reason: 'internal task at threshold — accept latest draft', threshold: threshold, deliverableCount: count };
  }
  // Public task already escalated: close it once the grace window lapses; otherwise wait.
  if (state && state.escalatedAt) {
    const escMs = Date.parse(state.escalatedAt);
    if (Number.isFinite(escMs) && (nowMs - escMs) >= CONVERGENCE_GRACE_HOURS * 3600000) {
      return { action: 'grace-close', reason: 'escalated > ' + CONVERGENCE_GRACE_HOURS + 'h without CEO action', threshold: threshold, deliverableCount: count };
    }
    return { action: 'none', reason: 'escalated, within grace window', threshold: threshold, deliverableCount: count };
  }
  if (count < threshold) {
    return { action: 'none', reason: 'below threshold', threshold: threshold, deliverableCount: count };
  }
  // Public task at threshold, first time.
  return { action: 'escalate', reason: 'public task at threshold — escalate to CEO', threshold: threshold, deliverableCount: count };
}

module.exports = {
  CONVERGENCE_THRESHOLD: CONVERGENCE_THRESHOLD,
  CONVERGENCE_THRESHOLD_BY_TYPE: CONVERGENCE_THRESHOLD_BY_TYPE,
  CONVERGENCE_AUTO_ACCEPT_TYPES: CONVERGENCE_AUTO_ACCEPT_TYPES,
  CONVERGENCE_GRACE_HOURS: CONVERGENCE_GRACE_HOURS,
  convergenceThresholdFor: convergenceThresholdFor,
  classifyConvergence: classifyConvergence,
  _deliverableCount: _deliverableCount
};
