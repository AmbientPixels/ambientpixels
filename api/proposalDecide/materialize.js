'use strict';

// Live-entity statuses that block a duplicate (mirrors the Actions-page guards).
const LIVE_STATUSES = {
  campaigns: ['active', 'paused', 'complete', 'completed'],
  objectives: ['active', 'on_track', 'at_risk', 'behind']
};

function _norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function _ts(nowIso) { const t = Date.parse(nowIso); return Number.isFinite(t) ? t : 0; }
function _id(prefix, nowIso) { return prefix + _ts(nowIso).toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

// Build the real entity a CEO-approved proposal should create. Returns
// { stateKey, entity } or null for types we don't materialize (status-flip only).
function materializeFromProposal(proposal, nowIso) {
  const p = proposal || {};
  const title = p.title || p.name || '';
  if (p.type === 'campaign_proposal') {
    const weeks = parseInt(p.duration, 10) || 0;
    const endDate = weeks > 0 ? new Date(_ts(nowIso) + weeks * 7 * 86400000).toISOString().slice(0, 10) : null;
    return { stateKey: 'campaigns', entity: {
      id: _id('camp-', nowIso),
      title: title,
      description: p.description || '',
      status: 'active',
      startDate: String(nowIso).slice(0, 10),
      endDate: endDate,
      allowedTaskTypes: p.platforms || [],
      frequency: p.frequency || 2,
      cadence: p.cadence || 'weekly',
      northStarMetric: p.northStarMetric || null,
      objective_id: p.objective_id || p.objectiveId || p.suggestedObjectiveId || null,
      source: 'meeting',
      proposalId: p.id,
      createdAt: nowIso
    } };
  }
  if (p.type === 'objective_proposal') {
    const hasCriteria = p.northStarMetric && isFinite(Number(p.metricTarget)) && Number(p.metricTarget) > 0 && p.metricDeadline;
    return { stateKey: 'objectives', entity: {
      id: _id('obj-', nowIso),
      title: title,
      description: p.description || '',
      status: 'active',
      progress: 0,
      successCriteria: p.successCriteria || '',
      timeHorizon: p.timeHorizon || '',
      northStarMetric: p.northStarMetric || null,
      criteria: hasCriteria ? { metric: p.northStarMetric, target: Number(p.metricTarget), by: p.metricDeadline, baseline: null } : null,
      source: 'meeting',
      proposalId: p.id,
      createdAt: nowIso
    } };
  }
  if (p.type === 'task_proposal') {
    return { stateKey: 'tasks', entity: {
      id: _id('task-', nowIso),
      title: title,
      description: p.description || '',
      taskType: 'general',
      status: 'todo',
      priority: 'medium',
      assignee: p.proposedBy || 'nova',
      objective_id: null,
      source: 'meeting',
      meetingId: p.meetingId || null,
      created_by: p.proposedBy || 'nova',
      createdAt: nowIso,
      updatedAt: nowIso
    } };
  }
  return null;
}

// True if a live entity with the same normalized title already exists in `existing`.
// Tasks are never deduped (stateKey not in LIVE_STATUSES).
function isLiveDuplicate(stateKey, title, existing) {
  const live = LIVE_STATUSES[stateKey];
  if (!live) return false;
  const n = _norm(title);
  return (existing || []).some(function (e) {
    return e && live.indexOf(e.status) !== -1 && _norm(e.title || e.name) === n;
  });
}

module.exports = { materializeFromProposal, isLiveDuplicate, LIVE_STATUSES };
