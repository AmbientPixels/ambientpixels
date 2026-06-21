// Deterministic Proposal Generator (System: keep-the-fleet-fed, server-side).
//
// WHY THIS EXISTS: agents never emit propose-campaign / propose-objective because
// the action has no working route through the heartbeat pipeline (the output-envelope
// contract sends proposals into the generic `proposals` array, which is never
// dispatched by type; and propose-campaign/-objective are absent from
// KNOWN_ACTION_TYPES). Confirmed zero proposals in 30+ days on BOTH Gemini and Claude.
// Rather than depend on the model, this module computes the propose-worthy condition
// deterministically and writes proposals straight to approvalQueue for CEO approval.
//
// See docs/superpowers/specs/2026-06-20-deterministic-proposal-generator-design.md
//
// computeProposals(state, nowMs)  → pure, unit-tested core. Returns 0-2 entries.
// runProposalGenerator({storage,nowMs,log}) → IO: load state, compute, append to queue.
//
// SAFETY: purely additive (only appends approvalQueue entries), never auto-executes,
// caps at <=1 of each type per 24h. CEO approves everything via the existing Actions UI.

'use strict';

const SOURCE = 'auto:proposal-generator';
const STAGNANT_DAYS = 14;
const STALE_DAYS = 14;
const DEDUP_HOURS = 24;
const OBJECTIVE_COMPLETE_PCT = 95;
const MIN_ACTIVE_CAMPAIGNS = 3;
const MIN_ACTIVE_OBJECTIVES = 3;
const DECLINING_VERDICTS = ['DECLINING', 'NO DATA'];

// Map socialAccountStats platform keys → valid campaign social task types.
const PLATFORM_TASK_TYPE = {
  bluesky: 'social_bluesky',
  x: 'social_x',
  twitter: 'social_x',
  linkedin: 'social_linkedin'
};

function _arr(v) { return Array.isArray(v) ? v : null; }
function _activeOf(list) { return (list || []).filter(function (x) { return x && x.status === 'active'; }); }
function _lc(s) { return String(s || '').trim().toLowerCase(); }
function _taskTime(t) { return Date.parse(t && (t.completedAt || t.updatedAt || t.createdAt) || '') || 0; }

// A campaign is stagnant if no linked task reached `done` within STAGNANT_DAYS.
function _isStagnant(campaign, tasks, nowMs) {
  var cutoff = nowMs - STAGNANT_DAYS * 86400000;
  return !tasks.some(function (t) {
    var cid = t.campaign_id || t.campaignId;
    return cid === campaign.id && t.status === 'done' && _taskTime(t) >= cutoff;
  });
}

// An objective is stale if no active campaign references it AND no linked task had
// activity within STALE_DAYS.
function _isStale(objective, campaigns, tasks, nowMs) {
  var cutoff = nowMs - STALE_DAYS * 86400000;
  var hasActiveCampaign = campaigns.some(function (c) {
    return c.status === 'active' && (c.objective_id === objective.id || c.objectiveId === objective.id);
  });
  if (hasActiveCampaign) return false;
  var hasRecentTask = tasks.some(function (t) {
    var oid = t.objective_id || t.objectiveId;
    return oid === objective.id && _taskTime(t) >= cutoff;
  });
  return !hasRecentTask;
}

// Has the generator already proposed this type within DEDUP_HOURS, or is one pending?
function _isDeduped(queue, proposalType, nowMs) {
  var cutoff = nowMs - DEDUP_HOURS * 3600000;
  return queue.some(function (q) {
    if (!q || q.type !== proposalType) return false;
    if (q.status === 'pending') return true;
    return q.source === SOURCE && (Date.parse(q.createdAt || '') || 0) >= cutoff;
  });
}

function _livePlatforms(socialAccountStats) {
  var out = [];
  var stats = socialAccountStats || {};
  Object.keys(stats).forEach(function (k) {
    var mapped = PLATFORM_TASK_TYPE[_lc(k)];
    if (mapped && out.indexOf(mapped) === -1) out.push(mapped);
  });
  return out.length ? out.slice(0, 5) : ['social_bluesky'];
}

function _blueskyFollowers(socialAccountStats) {
  var b = socialAccountStats && socialAccountStats.bluesky;
  var n = b && Number(b.followers);
  return Number.isFinite(n) ? n : null;
}

function _buildCampaignProposal(reasons, targets, socialAccountStats, nowMs) {
  var iso = new Date(nowMs).toISOString();
  var names = targets.map(function (t) { return t.product; });
  var name = names.length
    ? ('Re-activate ' + names.slice(0, 2).join(' + ')).substring(0, 100)
    : 'Revive audience growth';
  var followers = _blueskyFollowers(socialAccountStats);
  var kpi = followers != null
    ? ('+' + Math.max(25, Math.round(followers * 0.15)) + ' bluesky followers in 30 days')
    : 'Establish a measurable weekly posting cadence with engagement growth';
  return {
    id: 'cprop_' + nowMs + '_auto',
    type: 'campaign_proposal',
    status: 'pending',
    proposedBy: 'nova',
    source: SOURCE,
    name: name,
    description: ('Auto-generated campaign to address a coverage gap. ' +
      (names.length ? ('Targets: ' + names.join(', ') + '. ') : '') +
      'Review, adjust, and approve to seed a task cadence.').substring(0, 1000),
    rationale: ('Auto-generated (deterministic): ' + reasons.join('; ') + '.').substring(0, 500),
    platforms: _livePlatforms(socialAccountStats),
    frequency: 3,
    cadence: 'weekly',
    duration: '30 days',
    product: (names[0] || '').substring(0, 50),
    kpiTarget: kpi.substring(0, 200),
    northStarMetric: null,
    strategyFlag: null,
    createdAt: iso
  };
}

function _buildObjectiveProposal(reasons, primaryReason, socialAccountStats, nowMs) {
  var iso = new Date(nowMs).toISOString();
  var titleByReason = {
    count: 'Establish a measurable growth objective',
    complete: 'Define the successor goal for a near-complete objective',
    stale: 'Re-activate strategy around a stalled objective'
  };
  var followers = _blueskyFollowers(socialAccountStats);
  var success = followers != null
    ? ('Grow bluesky followers from ' + followers + ' to ' + (followers + Math.max(25, Math.round(followers * 0.15))) + ' within 60 days')
    : 'Define a single measurable metric and hit its 60-day target';
  return {
    id: 'oprop_' + nowMs + '_auto',
    type: 'objective_proposal',
    status: 'pending',
    proposedBy: 'nova',
    source: SOURCE,
    title: (titleByReason[primaryReason] || titleByReason.count).substring(0, 100),
    description: ('Auto-generated objective to keep the fleet aimed at a measurable goal. ' +
      'Review and refine the metric/target before approving.').substring(0, 1000),
    rationale: ('Auto-generated (deterministic): ' + reasons.join('; ') + '.').substring(0, 500),
    successCriteria: success.substring(0, 300),
    timeHorizon: '60 days',
    suggestedCampaigns: [],
    northStarMetric: null,
    metricTarget: null,
    metricDeadline: null,
    strategyFlag: null,
    createdAt: iso
  };
}

// ── Pure core ─────────────────────────────────────────────────────────────────
function computeProposals(state, nowMs) {
  if (!state || typeof state !== 'object') return [];
  var out = [];
  var queue = _arr(state.approvalQueue) || [];
  var tasks = _arr(state.tasks) || [];
  var perProduct = (state.strategicDigest && _arr(state.strategicDigest.perProduct)) || [];
  var socialAccountStats = state.socialAccountStats || {};

  // ── Campaign assessment (only if campaigns array is present) ──
  var campaigns = _arr(state.campaigns);
  if (campaigns && !_isDeduped(queue, 'campaign_proposal', nowMs)) {
    var activeCampaigns = _activeOf(campaigns);
    var reasons = [];
    var targets = [];

    if (activeCampaigns.length < MIN_ACTIVE_CAMPAIGNS) {
      reasons.push('only ' + activeCampaigns.length + ' active campaign(s) (target >= ' + MIN_ACTIVE_CAMPAIGNS + ')');
    }

    var covered = {};
    activeCampaigns.forEach(function (c) { if (c.product) covered[_lc(c.product)] = true; });
    var declUncovered = perProduct.filter(function (p) {
      return p && DECLINING_VERDICTS.indexOf(String(p.verdict || '').toUpperCase()) !== -1 && !covered[_lc(p.product)];
    });
    if (declUncovered.length) {
      targets = declUncovered.slice().sort(function (a, b) {
        return ((a.traffic && a.traffic.deltaPct) || 0) - ((b.traffic && b.traffic.deltaPct) || 0);
      });
      var firstDecl = targets[0];
      var delta = firstDecl.traffic && Number.isFinite(firstDecl.traffic.deltaPct) ? (' ' + firstDecl.traffic.deltaPct + '% traffic') : '';
      reasons.push(declUncovered.length + ' product(s) declining with no active campaign (e.g. ' + firstDecl.product + delta + ')');
    }

    var allStagnant = activeCampaigns.length > 0 && activeCampaigns.every(function (c) {
      return _isStagnant(c, tasks, nowMs);
    });
    if (allStagnant) {
      reasons.push('all active campaigns stagnant (no completed work in ' + STAGNANT_DAYS + 'd)');
      if (!targets.length) {
        targets = activeCampaigns.filter(function (c) { return c.product; }).map(function (c) { return { product: c.product }; });
      }
    }

    if (reasons.length) out.push(_buildCampaignProposal(reasons, targets, socialAccountStats, nowMs));
  }

  // ── Objective assessment (only if objectives array is present) ──
  var objectives = _arr(state.objectives);
  if (objectives && !_isDeduped(queue, 'objective_proposal', nowMs)) {
    var activeObjectives = _activeOf(objectives);
    var oReasons = [];
    var primary = null;

    if (activeObjectives.length < MIN_ACTIVE_OBJECTIVES) {
      oReasons.push('only ' + activeObjectives.length + ' active objective(s) (target >= ' + MIN_ACTIVE_OBJECTIVES + ')');
      primary = primary || 'count';
    }
    var nearDone = activeObjectives.filter(function (o) { return Number(o.progress) >= OBJECTIVE_COMPLETE_PCT; });
    if (nearDone.length) {
      oReasons.push(nearDone.length + ' active objective(s) >= ' + OBJECTIVE_COMPLETE_PCT + '% complete (successor needed)');
      primary = primary || 'complete';
    }
    var stale = activeObjectives.filter(function (o) { return _isStale(o, campaigns || [], tasks, nowMs); });
    if (stale.length) {
      oReasons.push(stale.length + ' active objective(s) stale (no campaign/task activity in ' + STALE_DAYS + 'd)');
      primary = primary || 'stale';
    }

    if (oReasons.length) out.push(_buildObjectiveProposal(oReasons, primary, socialAccountStats, nowMs));
  }

  return out;
}

// ── IO orchestration ────────────────────────────────────────────────────────
// storage is injected (../_utils/companyStorage in prod) so this stays testable.
async function runProposalGenerator(opts) {
  opts = opts || {};
  var storage = opts.storage;
  var nowMs = opts.nowMs || Date.now();
  var log = opts.log || function () {};
  try {
    var loaded = await Promise.all([
      storage.getState('campaigns').then(function (v) { return v || []; }),
      storage.getState('objectives').then(function (v) { return v || []; }),
      storage.getState('tasks').then(function (v) { return v || []; }),
      storage.getState('approvalQueue').then(function (v) { return v || []; }),
      storage.getState('runtimeMemory').then(function (v) { return v || {}; }),
      storage.getState('socialAccountStats').then(function (v) { return v || {}; })
    ]);
    var state = {
      campaigns: loaded[0],
      objectives: loaded[1],
      tasks: loaded[2],
      approvalQueue: loaded[3],
      strategicDigest: (loaded[4] && loaded[4].strategicDigest) || null,
      socialAccountStats: loaded[5]
    };

    var proposals = computeProposals(state, nowMs);
    if (!proposals.length) {
      log('[proposalGenerator] No propose-worthy conditions; nothing created.');
      return { ok: true, created: 0, types: [] };
    }

    // Re-read queue right before write to minimize clobber, then append.
    var queue = (await storage.getState('approvalQueue')) || [];
    proposals.forEach(function (p) { queue.push(p); });
    await storage.setState('approvalQueue', queue);

    var types = proposals.map(function (p) { return p.type; });
    log('[proposalGenerator] Created ' + proposals.length + ' proposal(s): ' + types.join(', '));
    return { ok: true, created: proposals.length, types: types, proposals: proposals };
  } catch (err) {
    log('[proposalGenerator] Fatal (no-op): ' + (err && err.message ? err.message : String(err)));
    return { ok: false, created: 0, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { computeProposals: computeProposals, runProposalGenerator: runProposalGenerator };
