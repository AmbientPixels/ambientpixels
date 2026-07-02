// Deterministic Proposal Generator (System: keep-the-fleet-fed, server-side).
//
// WHY THIS EXISTS (historical): originally agents rarely/never emitted
// propose-campaign / propose-objective, so this module computes the propose-worthy
// condition deterministically as a safety net.
//
// STATUS (2026-07): the agent-emitted path DOES now route end-to-end
// (propose-campaign/-objective are in KNOWN_ACTION_TYPES with full handlers in
// agent-runner.js, staged → selectTopProposals → approvalQueue). So this generator
// now runs IN PARALLEL with the agent path and can double up campaign/objective
// proposals (its entries are tagged source:'auto:proposal-generator', proposedBy:'nova').
// It has weaker gating than the agent path (24h dedup + 7-day expiry only — no
// per-agent cap or capital gate). Proposal-lifecycle logging (proposal-created events)
// now makes it possible to compare agent-vs-generator volume; once the agent path is
// confirmed sufficient, disable this generator via systemConfig.proposalGenerator.enabled=false
// (runtime toggle, no redeploy).
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
const EXPIRE_DAYS = 7; // unapproved generator suggestions auto-expire after this
const OBJECTIVE_COMPLETE_PCT = 95;
const MIN_ACTIVE_CAMPAIGNS = 3;
const MIN_ACTIVE_OBJECTIVES = 3;
// Only a genuine DECLINING verdict warrants a reactivation campaign. 'NO DATA'
// means the product is simply uninstrumented (no traffic telemetry), NOT that it
// dropped — lumping it in here produced misleading "AmbientScore 0% traffic"
// reactivation proposals for every product without analytics. Treat NO DATA as
// "no signal", not "declining". (2026-07-02)
const DECLINING_VERDICTS = ['DECLINING'];

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

// A placeholder objective has produced nothing: zero progress, no campaign ever
// referenced it (any status), and no task ever linked to it. These are almost
// always the generator's OWN generic creations. Reactivating a placeholder is
// pointless (it should be cleaned up, not re-proposed), and counting it as
// "stale" creates a self-reinforcing loop where the generator keeps minting new
// childless objectives. So the stale trigger ignores placeholders.
function _isPlaceholderObjective(objective, campaigns, tasks) {
  if (Number(objective.progress) > 0) return false;
  var hasAnyCampaign = (campaigns || []).some(function (c) {
    return c && (c.objective_id === objective.id || c.objectiveId === objective.id);
  });
  if (hasAnyCampaign) return false;
  var hasAnyTask = (tasks || []).some(function (t) {
    var oid = t.objective_id || t.objectiveId;
    return oid === objective.id;
  });
  return !hasAnyTask;
}

// Flip generator-sourced, still-pending campaign/objective proposals to 'expired'
// once they pass EXPIRE_DAYS without a CEO decision. Keeps stale generic
// suggestions from accumulating in the queue. Returns the count expired. Mutates
// the queue entries in place. Agent-sourced proposals are left untouched.
function _expireStaleGeneratorProposals(queue, nowMs) {
  var cutoff = nowMs - EXPIRE_DAYS * 86400000;
  var n = 0;
  (queue || []).forEach(function (q) {
    if (!q || q.source !== SOURCE || q.status !== 'pending') return;
    if (q.type !== 'campaign_proposal' && q.type !== 'objective_proposal') return;
    if ((Date.parse(q.createdAt || '') || 0) < cutoff) {
      q.status = 'expired';
      q.expiredAt = new Date(nowMs).toISOString();
      n++;
    }
  });
  return n;
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

// socialAccountStats is shaped { totals, platforms: { bluesky, x, linkedin, ... } }
// in production. Older callers/tests used a flat { bluesky, x } shape. Read the
// nested `.platforms` map when present, else fall back to the flat top level, so
// both shapes resolve real follower/platform data (the flat-only reader silently
// returned null in prod, forcing every proposal into its generic placeholder branch).
function _platformStats(socialAccountStats) {
  return (socialAccountStats && socialAccountStats.platforms) || socialAccountStats || {};
}

function _livePlatforms(socialAccountStats) {
  var out = [];
  var stats = _platformStats(socialAccountStats);
  Object.keys(stats).forEach(function (k) {
    var mapped = PLATFORM_TASK_TYPE[_lc(k)];
    if (mapped && out.indexOf(mapped) === -1) out.push(mapped);
  });
  return out.length ? out.slice(0, 5) : ['social_bluesky'];
}

function _blueskyFollowers(socialAccountStats) {
  var b = _platformStats(socialAccountStats).bluesky;
  var n = b && Number(b.followers);
  return Number.isFinite(n) ? n : null;
}

// Normalize a product/campaign name for substring coverage matching:
// lowercase, strip every non-alphanumeric char. So "Pixel Agents", "PixelAgents",
// and a "Targets: …, PixelAgents, …" description blob all reduce to "pixelagents".
function _normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

// A product is "covered" if any active campaign references it — NOT just via the
// singular `c.product` field, but anywhere in its title/description. Multi-product
// "Re-activate A + B + …" campaigns list every target in the description while
// `c.product` holds only the first; the old singular-field check therefore saw the
// rest as uncovered and re-proposed them every run. This widens coverage to the
// full campaign text so an already-covered product stops the re-proposal loop.
function _coveredProductSet(activeCampaigns, perProduct) {
  var blobs = (activeCampaigns || []).map(function (c) {
    return _normName((c.product || '') + ' ' + (c.title || c.name || '') + ' ' + (c.description || ''));
  });
  var set = {};
  (perProduct || []).forEach(function (p) {
    if (!p || !p.product) return;
    var n = _normName(p.product);
    if (n.length < 4) return; // too short to match reliably
    if (blobs.some(function (b) { return b.indexOf(n) !== -1; })) set[_lc(p.product)] = true;
  });
  // Always honor the explicit singular product field too (covers products that
  // aren't in perProduct at all).
  (activeCampaigns || []).forEach(function (c) { if (c.product) set[_lc(c.product)] = true; });
  return set;
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
  // Mint a MEASURABLE objective whenever we have a live metric to anchor it. The
  // old version always left northStarMetric/metricTarget/metricDeadline null, so the
  // approve handler created a criteria-less placeholder whose progress never moved.
  // With follower data we set a concrete bluesky_followers target (+15%, min +25,
  // 60-day deadline) so the approved objective gets a real criteria object and
  // auto-progress. Without it, we flag the proposal so the CEO knows to add a metric.
  var metricTarget = followers != null ? (followers + Math.max(25, Math.round(followers * 0.15))) : null;
  var metricDeadline = followers != null ? new Date(nowMs + 60 * 86400000).toISOString().slice(0, 10) : null;
  var success = followers != null
    ? ('Grow bluesky followers from ' + followers + ' to ' + metricTarget + ' within 60 days')
    : 'Define a single measurable metric and hit its 60-day target';
  return {
    id: 'oprop_' + nowMs + '_auto',
    type: 'objective_proposal',
    status: 'pending',
    proposedBy: 'nova',
    source: SOURCE,
    title: (titleByReason[primaryReason] || titleByReason.count).substring(0, 100),
    description: ('Auto-generated objective to keep the fleet aimed at a measurable goal. ' +
      (followers != null
        ? 'Pre-filled with a bluesky_followers target — adjust before approving.'
        : 'Add a north-star metric/target before approving.')).substring(0, 1000),
    rationale: ('Auto-generated (deterministic): ' + reasons.join('; ') + '.').substring(0, 500),
    successCriteria: success.substring(0, 300),
    timeHorizon: '60 days',
    suggestedCampaigns: [],
    northStarMetric: followers != null ? 'bluesky_followers' : null,
    metricTarget: metricTarget,
    metricDeadline: metricDeadline,
    strategyFlag: followers != null ? null : 'no-north-star-metric',
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

    var covered = _coveredProductSet(activeCampaigns, perProduct);
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
    // Only SUBSTANTIVE stalled objectives warrant a reactivation proposal. Childless
    // placeholders (progress 0, never had a campaign or task) are ignored — flagging
    // them stale is what created the self-reinforcing "Re-activate stalled objective"
    // loop. They should be cleaned up, not re-proposed.
    var stale = activeObjectives.filter(function (o) {
      return _isStale(o, campaigns || [], tasks, nowMs) && !_isPlaceholderObjective(o, campaigns || [], tasks);
    });
    if (stale.length) {
      oReasons.push(stale.length + ' active objective(s) stale (no campaign/task activity in ' + STALE_DAYS + 'd)');
      primary = primary || 'stale';
    }

    if (oReasons.length) out.push(_buildObjectiveProposal(oReasons, primary, socialAccountStats, nowMs));
  }

  return out;
}

// Observability: append a `proposal-created` event to governanceLog for each
// generator-minted proposal, mirroring the agent-emitted path (index.js ~3076) so
// the propose→decide funnel counts BOTH sources. Without this the generator was
// invisible in the funnel — the whole reason agent-vs-generator volume couldn't be
// compared. Self-contained (uses the injected storage, no helpers import) to keep
// computeProposals pure/testable. Non-fatal: a logging failure never blocks the run.
// `proposal-created` is a governanceLog type (see helpers.js _GOVERNANCE_TYPES).
async function _logProposalCreated(storage, proposals, nowMs) {
  if (!proposals || !proposals.length) return;
  var log = (await storage.getState('governanceLog')) || [];
  proposals.forEach(function (p, i) {
    log.push({
      id: 'log-' + nowMs + '-' + i + '-' + (p.id || 'prop'),
      type: 'proposal-created',
      agentId: p.proposedBy || 'system',
      summary: 'Generator proposal queued: ' + (p.name || p.title || p.type),
      cycle: 'proposal-generator-cron',
      timestamp: new Date(nowMs).toISOString(),
      details: { type: p.type, source: p.source || SOURCE, proposalId: p.id }
    });
  });
  var trimmed = log.length > 5000 ? log.slice(-5000) : log;
  await storage.setState('governanceLog', trimmed);
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

    // Runtime toggle: set systemConfig.proposalGenerator.enabled = false to stop the
    // deterministic generator (e.g. once the agent-emitted path is confirmed sufficient).
    // Default (unset) = enabled. Expiry of stale generator proposals still runs when off.
    var _sysCfg = (await storage.getState('systemConfig')) || {};
    var _genEnabled = !(_sysCfg.proposalGenerator && _sysCfg.proposalGenerator.enabled === false);
    var proposals = _genEnabled ? computeProposals(state, nowMs) : [];
    if (!_genEnabled) log('[proposalGenerator] Disabled via systemConfig.proposalGenerator.enabled=false — running expiry only.');

    // Re-read queue right before write to minimize clobber. Always run expiry (even
    // when nothing new is created) so stale generic suggestions don't pile up.
    var queue = (await storage.getState('approvalQueue')) || [];
    var expired = _expireStaleGeneratorProposals(queue, nowMs);
    proposals.forEach(function (p) { queue.push(p); });

    if (!proposals.length && !expired) {
      log('[proposalGenerator] No propose-worthy conditions; nothing created or expired.');
      return { ok: true, created: 0, expired: 0, types: [] };
    }

    await storage.setState('approvalQueue', queue);

    // Observability funnel (non-fatal): record each new proposal in governanceLog.
    if (proposals.length) {
      try { await _logProposalCreated(storage, proposals, nowMs); }
      catch (_logErr) { log('[proposalGenerator] proposal-created log failed (non-fatal): ' + (_logErr && _logErr.message ? _logErr.message : String(_logErr))); }
    }

    var types = proposals.map(function (p) { return p.type; });
    log('[proposalGenerator] Created ' + proposals.length + ' proposal(s): ' + (types.join(', ') || 'none') +
      (expired ? ('; expired ' + expired + ' stale suggestion(s)') : ''));
    return { ok: true, created: proposals.length, expired: expired, types: types, proposals: proposals };
  } catch (err) {
    log('[proposalGenerator] Fatal (no-op): ' + (err && err.message ? err.message : String(err)));
    return { ok: false, created: 0, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  computeProposals: computeProposals,
  runProposalGenerator: runProposalGenerator,
  _expireStaleGeneratorProposals: _expireStaleGeneratorProposals,
  _isPlaceholderObjective: _isPlaceholderObjective
};
