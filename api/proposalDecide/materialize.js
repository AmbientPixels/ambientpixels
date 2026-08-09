'use strict';

const { titleSimilarity } = require('../_utils/titleSimilarity');

// Live-entity statuses that block a duplicate (mirrors the Actions-page guards).
const LIVE_STATUSES = {
  campaigns: ['active', 'paused', 'complete', 'completed'],
  objectives: ['active', 'on_track', 'at_risk', 'behind']
};

// Same-intent threshold shared with the propose-time gates (helpers.titleSimilarity
// call sites in agent-runner.js / proposal-generator.js). Keep in lockstep.
const SEMANTIC_DUP_THRESHOLD = 0.6;
// Looser bar for pairing a campaign with its sibling objective proposal / adopting
// an orphan campaign — pairing a campaign to the right parent tolerates more
// lexical distance than blocking a duplicate does.
const SIBLING_MATCH_THRESHOLD = 0.5;

function _norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function _ts(nowIso) { const t = Date.parse(nowIso); return Number.isFinite(t) ? t : 0; }
function _id(prefix, nowIso) { return prefix + _ts(nowIso).toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

// Valid campaign task types (mirrors the heartbeat normalizer's allowlist). A
// campaign with no valid type can't be routed by auto-replenish — it just makes
// untyped generic tasks. So we always resolve to at least one valid type.
// social_facebook and social_instagram were MISSING here while campaigns.html has
// offered a Facebook checkbox for months. The effect was silent and total: an approved
// campaign whose platforms were ['social_facebook'] had every entry filtered out by
// deriveTaskTypes below, fell through to keyword inference, and defaulted to
// social_bluesky. A Facebook campaign quietly became a Bluesky campaign — no error, no
// flag, and `derived: true` was the only trace.
//
// social_reddit is still absent, deliberately unresolved rather than silently included:
// Reddit is in actionsScheduler's _manualPlatforms, so campaign-generated Reddit tasks
// would produce actions nothing can auto-post. That is a real question about the manual
// outbox, not a list to pad.
const VALID_TASK_TYPES = ['blog_post', 'social_linkedin', 'social_bluesky', 'social_x', 'social_facebook', 'social_instagram', 'design_asset', 'internal_doc', 'research', 'ops', 'financial', 'general'];
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
// orphaned. Priority: explicit ref → northStarMetric equality → pending-sibling
// deferral → product mention (BEST match) → title-token overlap (>=2).
// `matched` is true when we inferred (vs honored an explicit ref), so the
// campaign can be flagged for CEO review.
//
// Pending-sibling deferral (2026-07-28): when the campaign was proposed together
// with a NEW objective (same intent, both in the queue), the objective doesn't
// exist yet at campaign-approval time — the old fuzzy tiers would mislink the
// campaign to an OLDER objective and the sibling would be born orphaned (that is
// how obj-first-customer collected 15 campaigns while 8 objectives sat at zero).
// Instead: materialize the campaign UNLINKED with `deferredToProposalId`; when
// that objective proposal is approved, adoptOrphanCampaigns() links them. If the
// CEO rejects the sibling, the orphan campaign surfaces in Nova's prompt for
// link-campaign-to-objective / manual review (needsReview stays true).
function deriveObjectiveId(p, objectives, pendingObjectiveProposals) {
  p = p || {};
  const objs = (objectives || []).filter(function (o) {
    return o && ACTIVE_OBJECTIVE_STATUSES.indexOf(o.status) !== -1 && !o.deletedAt;
  });
  const explicit = p.objective_id || p.objectiveId || p.suggestedObjectiveId || null;
  if (explicit && objs.some(function (o) { return o.id === explicit; })) {
    return { objectiveId: explicit, matched: false, via: 'explicit' };
  }
  if (p.northStarMetric) {
    const ns = objs.find(function (o) { return o.northStarMetric && o.northStarMetric === p.northStarMetric; });
    if (ns) return { objectiveId: ns.id, matched: true, via: 'metric' };
  }
  const pName = p.name || p.title || '';
  const sibling = (pendingObjectiveProposals || []).find(function (q) {
    if (!q || q.status !== 'pending') return false;
    if (p.northStarMetric && q.northStarMetric && q.northStarMetric === p.northStarMetric) return true;
    return titleSimilarity(pName, q.title || q.name || '') >= SIBLING_MATCH_THRESHOLD;
  });
  if (sibling) {
    return { objectiveId: null, matched: false, deferredToProposalId: sibling.id };
  }
  const prod = _norm(p.product || '');
  if (prod.length > 2) {
    // BEST product match, not first — first-match is how every AmbientScore
    // campaign dogpiled the oldest AmbientScore objective.
    let pmBest = null, pmScore = -1;
    objs.forEach(function (o) {
      if (_norm((o.title || '') + ' ' + (o.description || '')).indexOf(prod) === -1) return;
      const s = titleSimilarity(pName, o.title || '');
      if (s > pmScore) { pmScore = s; pmBest = o; }
    });
    if (pmBest) return { objectiveId: pmBest.id, matched: true, via: 'product' };
  }
  const nameTokens = _tokens(pName);
  if (nameTokens.length) {
    let best = null, bestScore = 0;
    objs.forEach(function (o) {
      const ot = _tokens(o.title || '');
      const overlap = nameTokens.filter(function (w) { return ot.indexOf(w) !== -1; }).length;
      if (overlap > bestScore) { bestScore = overlap; best = o; }
    });
    if (best && bestScore >= 2) return { objectiveId: best.id, matched: true, via: 'tokens' };
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
    // Duration contract is WEEKS (composer emits numeric weeks), but agent
    // proposals carry free text like "90 days" — parseInt read that as 90
    // WEEKS and minted a 2028 end date (2026-07-29). Convert day-phrased
    // durations to weeks before applying.
    let weeks = parseInt(p.duration, 10) || 0;
    if (weeks > 0 && /day/i.test(String(p.duration))) weeks = Math.max(1, Math.round(weeks / 7));
    const endDate = weeks > 0 ? new Date(_ts(nowIso) + weeks * 7 * 86400000).toISOString().slice(0, 10) : null;
    // Never mint an unworkable campaign: guarantee task types, try to find a parent
    // goal, and flag for CEO review whenever either had to be inferred.
    const tt = deriveTaskTypes(p);
    const od = deriveObjectiveId(p, ctx.objectives || [], ctx.pendingObjectiveProposals || []);
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
      objectiveLinkVia: od.via || null,
      pendingObjectiveProposalId: od.deferredToProposalId || null,
      // needsReview only for GENUINE guesses: derived task types, no parent at
      // all, or a fuzzy link (product/token tiers). Explicit refs and north-star
      // metric equality are deterministic — flagging them meant every agent
      // proposal nagged the CEO forever (2026-08-01). Propose-time derivation in
      // agent-runner now stamps platforms + suggestedObjectiveId onto the
      // proposal itself, so the CEO reviews routing BEFORE approval instead.
      needsReview: !!(tt.derived || !od.objectiveId || (od.matched && od.via !== 'metric')),
      source: p.meetingId ? 'meeting' : (p.source || 'proposal'),
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
      source: p.meetingId ? 'meeting' : (p.source || 'proposal'),
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

// Find the live entity a proposal would duplicate, or null. Three detectors:
// exact normalized title (legacy), semantic title similarity >= 0.6 (rewordings —
// "Founder's Program" vs "Founding Partner Program" sailed through exact match),
// and for objectives, north-star-metric ownership (same metric = same intent
// regardless of wording). Tasks are never deduped (stateKey not in LIVE_STATUSES).
// Returns { entity, why } so the caller can tell exact (skip-and-approve, legacy
// behavior) from semantic (block-and-inform — a 0.6 match can rarely be a false
// positive, so the human decides).
function findLiveDuplicate(stateKey, proposal, existing) {
  const live = LIVE_STATUSES[stateKey];
  if (!live) return null;
  const p = proposal || {};
  const title = typeof p === 'string' ? p : (p.title || p.name || '');
  const n = _norm(title);
  const liveEntities = (existing || []).filter(function (e) {
    return e && live.indexOf(e.status) !== -1 && !e.deletedAt;
  });
  const exact = liveEntities.find(function (e) { return _norm(e.title || e.name) === n; });
  if (exact) return { entity: exact, why: 'exact-title' };
  // Semantic + metric detectors consider only entities that can still accept
  // work (active/paused et al) — NOT complete/completed. A finished campaign is
  // history; a distinct successor sharing brand vocabulary must not be blocked
  // ("Build in Public" [completed] blocked "LinkedIn Build-in-Public: The First
  // Customer Journey" — CEO false positive 2026-07-29; two shared tokens vs a
  // two-token title scores 1.0 under smaller-set overlap). Exact-title reuse
  // still blocks against completed entities so a same-named campaign isn't
  // silently recreated.
  const openEntities = liveEntities.filter(function (e) {
    return e.status !== 'complete' && e.status !== 'completed';
  });
  const sem = openEntities.find(function (e) {
    return titleSimilarity(title, e.title || e.name || '') >= SEMANTIC_DUP_THRESHOLD;
  });
  if (sem) return { entity: sem, why: 'semantic-title' };
  if (stateKey === 'objectives' && typeof p === 'object' && p.northStarMetric) {
    const ns = openEntities.find(function (e) {
      return (e.northStarMetric || (e.criteria && e.criteria.metric) || '') === p.northStarMetric;
    });
    if (ns) return { entity: ns, why: 'north-star-metric' };
  }
  return null;
}

// Back-compat boolean wrapper (exact-title only — original behavior). Prefer
// findLiveDuplicate, which also catches rewordings.
function isLiveDuplicate(stateKey, title, existing) {
  const hit = findLiveDuplicate(stateKey, title, existing);
  return !!(hit && hit.why === 'exact-title');
}

// After a NEW objective materializes, link any orphan campaigns that were waiting
// for it (or that plainly belong to it). Mutates matching campaign objects in
// place; returns the adopted campaigns so the caller persists + back-links.
// Match, in order of confidence: explicit deferral stamp from deriveObjectiveId
// → same north-star metric → title similarity >= 0.5. Only unparented
// active/paused campaigns are eligible — never re-parents a linked campaign.
function adoptOrphanCampaigns(objectiveEntity, objectiveProposalId, campaigns) {
  const obj = objectiveEntity || {};
  const adopted = [];
  (campaigns || []).forEach(function (c) {
    if (!c || c.deletedAt || c.objective_id) return;
    if (c.status !== 'active' && c.status !== 'paused') return;
    const stamped = objectiveProposalId && c.pendingObjectiveProposalId === objectiveProposalId;
    const metricMatch = !!(c.northStarMetric && obj.northStarMetric && c.northStarMetric === obj.northStarMetric);
    const titleMatch = titleSimilarity(c.title || c.name || '', obj.title || '') >= SIBLING_MATCH_THRESHOLD;
    if (!stamped && !metricMatch && !titleMatch) return;
    c.objective_id = obj.id;
    c.pendingObjectiveProposalId = null;
    c.linkedBy = 'system:objective-adoption';
    c.linkedAt = new Date().toISOString();
    adopted.push(c);
  });
  return adopted;
}

module.exports = {
  materializeFromProposal, isLiveDuplicate, findLiveDuplicate, adoptOrphanCampaigns,
  deriveTaskTypes, deriveObjectiveId, LIVE_STATUSES,
  SEMANTIC_DUP_THRESHOLD, SIBLING_MATCH_THRESHOLD
};
