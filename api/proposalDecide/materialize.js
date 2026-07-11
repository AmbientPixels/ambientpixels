'use strict';

// Live-entity statuses that block a duplicate (mirrors the Actions-page guards).
const LIVE_STATUSES = {
  campaigns: ['active', 'paused', 'complete', 'completed'],
  objectives: ['active', 'on_track', 'at_risk', 'behind']
};

function _norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function _ts(nowIso) { const t = Date.parse(nowIso); return Number.isFinite(t) ? t : 0; }
function _id(prefix, nowIso) { return prefix + _ts(nowIso).toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

// Valid campaign task types (mirrors the heartbeat normalizer's allowlist). A
// campaign with no valid type can't be routed by auto-replenish — it just makes
// untyped generic tasks. So we always resolve to at least one valid type.
const VALID_TASK_TYPES = ['blog_post', 'social_linkedin', 'social_bluesky', 'social_x', 'design_asset', 'internal_doc', 'research', 'ops', 'financial', 'general'];
// Objective statuses that can still accept new campaign work.
const ACTIVE_OBJECTIVE_STATUSES = ['active', 'on_track', 'at_risk', 'behind'];
// Tokens too generic to carry signal when matching a campaign name to an objective.
const MATCH_STOP_WORDS = new Set(['the', 'and', 'for', 'launch', 'campaign', 'this', 'week', 'plus', 'new', 'with', 'into', 'our', 'ambient']);

function _tokens(s) {
  return _norm(s).split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 && !MATCH_STOP_WORDS.has(w); });
}

// Resolve a non-empty, valid allowedTaskTypes for a campaign proposal.
// Priority: explicit platforms/allowedTaskTypes → keyword intent → social_bluesky
// default (the same default the deterministic generator uses). `derived` is true
// whenever we had to guess (so the campaign can be flagged for CEO review).
function deriveTaskTypes(p) {
  p = p || {};
  let explicit = Array.isArray(p.platforms) ? p.platforms
    : (Array.isArray(p.allowedTaskTypes) ? p.allowedTaskTypes : []);
  const valid = explicit.filter(function (t) { return VALID_TASK_TYPES.indexOf(t) !== -1; });
  if (valid.length) return { taskTypes: valid.slice(0, 5), derived: false };

  const hay = _norm((p.name || p.title || '') + ' ' + (p.description || ''));
  let pick;
  if (/\b(design|visual|hero|graphic|asset|artwork|illustration|mockup|thumbnail)\b/.test(hay)) pick = ['design_asset'];
  else if (/\b(blog|article|diary|diaries|long-?form|essay|write-?up)\b/.test(hay)) pick = ['blog_post'];
  else if (/\b(research|competitive|landscape|analysis)\b/.test(hay)) pick = ['research'];
  else pick = ['social_bluesky'];
  return { taskTypes: pick, derived: true };
}

// Find the best active objective to parent a campaign proposal so it isn't born
// orphaned. Priority: explicit ref → northStarMetric equality → product mention →
// title-token overlap (>=2). `matched` is true when we inferred (vs honored an
// explicit ref), so the campaign can be flagged for CEO review.
function deriveObjectiveId(p, objectives) {
  p = p || {};
  const objs = (objectives || []).filter(function (o) {
    return o && ACTIVE_OBJECTIVE_STATUSES.indexOf(o.status) !== -1 && !o.deletedAt;
  });
  const explicit = p.objective_id || p.objectiveId || p.suggestedObjectiveId || null;
  if (explicit && objs.some(function (o) { return o.id === explicit; })) {
    return { objectiveId: explicit, matched: false };
  }
  if (p.northStarMetric) {
    const ns = objs.find(function (o) { return o.northStarMetric && o.northStarMetric === p.northStarMetric; });
    if (ns) return { objectiveId: ns.id, matched: true };
  }
  const prod = _norm(p.product || '');
  if (prod.length > 2) {
    const pm = objs.find(function (o) { return _norm((o.title || '') + ' ' + (o.description || '')).indexOf(prod) !== -1; });
    if (pm) return { objectiveId: pm.id, matched: true };
  }
  const nameTokens = _tokens(p.name || p.title || '');
  if (nameTokens.length) {
    let best = null, bestScore = 0;
    objs.forEach(function (o) {
      const ot = _tokens(o.title || '');
      const overlap = nameTokens.filter(function (w) { return ot.indexOf(w) !== -1; }).length;
      if (overlap > bestScore) { bestScore = overlap; best = o; }
    });
    if (best && bestScore >= 2) return { objectiveId: best.id, matched: true };
  }
  return { objectiveId: explicit || null, matched: false };
}

// Build the real entity a CEO-approved proposal should create. Returns
// { stateKey, entity } or null for types we don't materialize (status-flip only).
// `context.objectives` (optional) lets a campaign be auto-linked to a parent goal.
function materializeFromProposal(proposal, nowIso, context) {
  const p = proposal || {};
  const ctx = context || {};
  const title = p.title || p.name || '';
  if (p.type === 'campaign_proposal') {
    const weeks = parseInt(p.duration, 10) || 0;
    const endDate = weeks > 0 ? new Date(_ts(nowIso) + weeks * 7 * 86400000).toISOString().slice(0, 10) : null;
    // Never mint an unworkable campaign: guarantee task types, try to find a parent
    // goal, and flag for CEO review whenever either had to be inferred.
    const tt = deriveTaskTypes(p);
    const od = deriveObjectiveId(p, ctx.objectives || []);
    return { stateKey: 'campaigns', entity: {
      id: _id('camp-', nowIso),
      title: title,
      description: p.description || '',
      status: 'active',
      startDate: String(nowIso).slice(0, 10),
      endDate: endDate,
      allowedTaskTypes: tt.taskTypes,
      frequency: p.frequency || 2,
      cadence: p.cadence || 'weekly',
      northStarMetric: p.northStarMetric || null,
      objective_id: od.objectiveId,
      needsReview: !!(tt.derived || od.matched || !od.objectiveId),
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
      criteria: hasCriteria ? { metric: p.northStarMetric, target: Number(p.metricTarget), by: p.metricDeadline, baseline: (p.metricBaseline != null && Number.isFinite(Number(p.metricBaseline)) ? Number(p.metricBaseline) : null) } : null,
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

module.exports = { materializeFromProposal, isLiveDuplicate, deriveTaskTypes, deriveObjectiveId, LIVE_STATUSES };
