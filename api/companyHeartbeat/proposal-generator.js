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

// Module-top require (NOT inside runProposalGenerator): if the composer ever fails
// to load (broken/partial deploy), we want a load-time throw here rather than a
// promise rejection out of runProposalGenerator — the cron awaits that function with
// no try/catch and relies on its "any error is a no-op {ok:false}" contract. No
// circular dependency: proposal-composer.js has no requires of its own.
var composer = require('./proposal-composer');
var helpers = require('./helpers'); // titleSimilarity — semantic proposal dedup

const SOURCE = 'auto:proposal-generator';
const STAGNANT_DAYS = 14;
const STALE_DAYS = 14;
const DEDUP_HOURS = 24;
const EXPIRE_DAYS = 7; // unapproved generator suggestions auto-expire after this
const OBJECTIVE_COMPLETE_PCT = 95;
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

// Queue hygiene: resolved campaign/objective proposals now REMAIN in the queue
// (status approved/rejected/expired) so the reject-cooldown, emergence reject-rate
// and the propose→decide funnel can read them. Prune them after 30d (matches the
// emergence 30d window) so the queue doesn't grow forever. Returns removed count.
var RESOLVED_RETENTION_DAYS = 30;
function _pruneResolvedProposals(queue, nowMs) {
  if (!Array.isArray(queue)) return 0;
  var cutoff = nowMs - RESOLVED_RETENTION_DAYS * 86400000;
  var n = 0;
  for (var i = queue.length - 1; i >= 0; i--) {
    var q = queue[i];
    if (!q) continue;
    if (q.type !== 'campaign_proposal' && q.type !== 'objective_proposal') continue;
    if (q.status !== 'approved' && q.status !== 'rejected' && q.status !== 'declined' && q.status !== 'expired') continue;
    var ts = Date.parse(q.approvedAt || q.rejectedAt || q.expiredAt || q.resolvedAt || q.updatedAt || q.createdAt || '');
    if (Number.isFinite(ts) && ts < cutoff) { queue.splice(i, 1); n++; }
  }
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
    duration: 4,  // weeks (materialize.js parses duration as weeks)
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
    stale: 'Re-activate strategy around a stalled objective',
    deadline: 'Rescue or replace an at-risk objective before its deadline'
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
    metricBaseline: (followers != null ? followers : null),
    metricTarget: metricTarget,
    metricDeadline: metricDeadline,
    strategyFlag: followers != null ? null : 'no-north-star-metric',
    createdAt: iso
  };
}

// ── Conversion dead-zone helpers ───────────────────────────────────────────────
// A revenue-focused objective is live and activity is flowing (scans / shipped
// tasks), but the funnel produced ZERO leads and ZERO sales in the window. That is
// the strongest propose-worthy gap the company has: the fix is a conversion play
// (lead capture, distribution, offer test) — not more content volume.
function _isRevenueObjective(o) {
  if (!o) return false;
  var ns = String(o.northStarMetric || (o.criteria && o.criteria.northStarMetric) || '').toLowerCase();
  if (ns === 'paying_customers' || ns === 'mrr' || ns === 'revenue') return true;
  return /paying customer|first sale|revenue|mrr/i.test(String(o.title || ''));
}
function _tsOf(e) {
  return Date.parse((e && (e.at || e.timestamp || e.createdAt || e.created_at || e.ts)) || '');
}
function _leadsInWindow(asLeads, days, nowMs) {
  var cutoff = nowMs - days * 86400000;
  return (_arr(asLeads) || []).filter(function (e) {
    var ts = _tsOf(e);
    return Number.isFinite(ts) && ts >= cutoff;
  }).length;
}
function _salesInWindow(revenueLedger, days, nowMs) {
  // revenueLedger blob is { entries: [...], updatedAt } — NOT a bare array.
  var entries = (revenueLedger && _arr(revenueLedger.entries)) || _arr(revenueLedger) || [];
  var cutoff = nowMs - days * 86400000;
  return entries.filter(function (e) {
    var ts = _tsOf(e);
    return Number.isFinite(ts) && ts >= cutoff;
  }).length;
}
function _productUsageSignal(perProduct, product) {
  var row = (perProduct || []).filter(function (p) { return p && String(p.product || '') === String(product || ''); })[0];
  var sig = row && row.usage && row.usage.signal;
  return Number.isFinite(Number(sig)) ? Number(sig) : 0;
}
// The trigger is product-agnostic: the target is whatever product the revenue
// objective's linked campaigns point at. AmbientScore is only the fallback for a
// revenue objective with no product-linked campaign (it is the one product with
// a live checkout today).
function _revenueObjectiveProduct(objective, campaigns) {
  var linked = (objective && (_arr(objective.linkedCampaigns) || _arr(objective.linkedDirectives))) || [];
  var byId = {};
  (_arr(campaigns) || []).forEach(function (c) { if (c && c.id) byId[c.id] = c; });
  for (var i = 0; i < linked.length; i++) {
    var c = byId[linked[i]];
    if (c && c.product) return c.product;
  }
  return null;
}

// Deadline-at-risk: an active objective with a real criteria deadline is running
// out of window (≤25% of its span or ≤7d left) at under 50% progress. The metric
// machinery measures honestly (a 0.5% objective reads 0%) — this is the sensor
// that turns "quietly missing the deadline" into a successor/rescue proposal.
function _isDeadlineAtRisk(o, nowMs) {
  if (!o || !o.criteria) return false;
  var deadline = Date.parse(o.criteria.by || o.criteria.deadline || '');
  if (!Number.isFinite(deadline)) return false;
  var start = Date.parse(o.criteria.baselineStampedAt || o.createdAt || '');
  if (!Number.isFinite(start) || start >= deadline) return false;
  var progress = Number(o.progressPercentage != null ? o.progressPercentage : o.progress) || 0;
  if (progress >= 50) return false;
  var left = deadline - nowMs;
  if (left <= 0) return true; // past due and still active
  var total = deadline - start;
  return left <= total * 0.25 || left <= 7 * 86400000;
}

// ── Pure detection ─────────────────────────────────────────────────────────────
// Returns 0-N grounded signals, highest severity first. NO count-padding triggers.
function detectSignals(state, nowMs) {
  if (!state || typeof state !== 'object') return [];
  var tasks = _arr(state.tasks) || [];
  var perProduct = (state.strategicDigest && _arr(state.strategicDigest.perProduct)) || [];
  var signals = [];

  var campaigns = _arr(state.campaigns);
  if (campaigns) {
    var activeCampaigns = _activeOf(campaigns);
    var covered = _coveredProductSet(activeCampaigns, perProduct);
    var declUncovered = perProduct.filter(function (p) {
      return p && DECLINING_VERDICTS.indexOf(String(p.verdict || '').toUpperCase()) !== -1 && !covered[_lc(p.product)];
    });
    if (declUncovered.length) {
      var sorted = declUncovered.slice().sort(function (a, b) {
        return ((a.traffic && a.traffic.deltaPct) || 0) - ((b.traffic && b.traffic.deltaPct) || 0);
      });
      signals.push({
        kind: 'campaign', trigger: 'declining_uncovered', severity: 3,
        subject: { product: sorted[0].product },
        evidence: { decliningProducts: sorted.map(function (p) { return { product: p.product, deltaPct: (p.traffic && p.traffic.deltaPct) }; }) }
      });
    }
    var allStagnant = activeCampaigns.length > 0 && activeCampaigns.every(function (c) { return _isStagnant(c, tasks, nowMs); });
    if (allStagnant) {
      signals.push({
        kind: 'campaign', trigger: 'all_stagnant', severity: 2,
        subject: { product: (activeCampaigns.filter(function (c) { return c.product; })[0] || {}).product || null },
        evidence: { stagnantDays: STAGNANT_DAYS, campaignCount: activeCampaigns.length,
          products: activeCampaigns.filter(function (c) { return c.product; }).map(function (c) { return c.product; }) }
      });
    }
  }

  var objectives = _arr(state.objectives);
  if (objectives) {
    var activeObjectives = _activeOf(objectives);
    var nearDone = activeObjectives.filter(function (o) { return Number(o.progress) >= OBJECTIVE_COMPLETE_PCT; });
    if (nearDone.length) {
      signals.push({
        kind: 'objective', trigger: 'near_complete', severity: 3,
        subject: { objectiveId: nearDone[0].id, objectiveTitle: nearDone[0].title || '' },
        evidence: { progress: Number(nearDone[0].progress), count: nearDone.length }
      });
    }
    var stale = activeObjectives.filter(function (o) {
      return _isStale(o, campaigns || [], tasks, nowMs) && !_isPlaceholderObjective(o, campaigns || [], tasks);
    });
    if (stale.length) {
      signals.push({
        kind: 'objective', trigger: 'stale_objective', severity: 2,
        subject: { objectiveId: stale[0].id, objectiveTitle: stale[0].title || '' },
        evidence: { staleDays: STALE_DAYS, count: stale.length }
      });
    }
    var atRisk = activeObjectives.filter(function (o) { return _isDeadlineAtRisk(o, nowMs); });
    if (atRisk.length) {
      var ar0 = atRisk[0];
      signals.push({
        kind: 'objective', trigger: 'deadline_at_risk', severity: 3,
        subject: { objectiveId: ar0.id, objectiveTitle: ar0.title || '' },
        evidence: {
          deadline: (ar0.criteria && (ar0.criteria.by || ar0.criteria.deadline)) || null,
          progressPct: Number(ar0.progressPercentage != null ? ar0.progressPercentage : ar0.progress) || 0,
          daysLeft: Math.max(0, Math.round((Date.parse((ar0.criteria && (ar0.criteria.by || ar0.criteria.deadline)) || '') - nowMs) / 86400000)),
          count: atRisk.length
        }
      });
    }
  }

  // Conversion dead-zone (severity 4 — outranks every content-coverage trigger).
  var _allObjectives = _arr(state.objectives);
  var revObjectives = _allObjectives ? _activeOf(_allObjectives).filter(_isRevenueObjective) : [];
  if (revObjectives.length) {
    var targetProduct = _revenueObjectiveProduct(revObjectives[0], state.campaigns) || 'AmbientScore';
    var leads7 = _leadsInWindow(state.asLeads, 7, nowMs);
    var sales7 = _salesInWindow(state.revenueLedger, 7, nowMs);
    var usage7 = _productUsageSignal(perProduct, targetProduct);
    var doneTasks7 = tasks.filter(function (t) {
      if (!t || t.status !== 'done') return false;
      var ts = Date.parse(t.updatedAt || t.completedAt || t.createdAt || '');
      return Number.isFinite(ts) && ts >= nowMs - 7 * 86400000;
    }).length;
    var activityFlowing = usage7 > 0 || doneTasks7 >= 3;
    if (activityFlowing && leads7 === 0 && sales7 === 0) {
      // Name the overlapping active campaign(s) so the proposal reads as a
      // conversion-step play, not a duplicate of the campaign already running.
      var overlapping = _activeOf(campaigns || []).filter(function (c) {
        return String((c && c.product) || '').toLowerCase() === String(targetProduct).toLowerCase();
      }).map(function (c) { return String(c.name || c.id || '').substring(0, 60); }).slice(0, 3);
      signals.push({
        kind: 'campaign', trigger: 'conversion_dead', severity: 4,
        subject: { product: targetProduct, objectiveId: revObjectives[0].id },
        evidence: {
          leads7d: 0, sales7d: 0, usage7d: usage7, doneTasks7d: doneTasks7,
          activeCampaigns: overlapping,
          objective: String(revObjectives[0].title || '').substring(0, 80)
        }
      });
    }
  }

  signals.sort(function (a, b) { return b.severity - a.severity; });
  return signals;
}

// A CEO "no" means no: once a generator proposal for a given trigger is rejected,
// the same trigger stays quiet for a week instead of re-minting daily nags.
var GENERATOR_REJECT_COOLDOWN_DAYS = 7;
function _isRejectCooldown(queue, type, trigger, nowMs) {
  if (!trigger) return false;
  var cutoff = nowMs - GENERATOR_REJECT_COOLDOWN_DAYS * 86400000;
  return (_arr(queue) || []).some(function (q) {
    if (!q || q.type !== type || q.source !== SOURCE) return false;
    if (q.status !== 'rejected' && q.status !== 'declined') return false;
    if (String(q.trigger || '') !== trigger) return false;
    var ts = Date.parse(q.rejectedAt || q.resolvedAt || q.updatedAt || q.createdAt || '');
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

// Pick at most one campaign + one objective signal, honoring the existing 24h/pending
// dedup plus the per-trigger rejection cooldown.
function _pickTopPerType(signals, queue, nowMs) {
  var picks = [];
  var haveCampaign = false, haveObjective = false;
  (signals || []).forEach(function (sig) {
    var type = sig.kind === 'campaign' ? 'campaign_proposal' : 'objective_proposal';
    if (_isRejectCooldown(queue, type, sig.trigger, nowMs)) return;
    if (sig.kind === 'campaign' && !haveCampaign && !_isDeduped(queue, 'campaign_proposal', nowMs)) {
      picks.push(sig); haveCampaign = true;
    } else if (sig.kind === 'objective' && !haveObjective && !_isDeduped(queue, 'objective_proposal', nowMs)) {
      picks.push(sig); haveObjective = true;
    }
  });
  return picks;
}

// Deterministic fallback: translate a signal into args for the existing builders.
function _deterministicFromSignal(signal, state, nowMs) {
  var sas = state.socialAccountStats || {};
  if (signal.kind === 'campaign') {
    if (signal.trigger === 'conversion_dead') {
      var cdTarget = signal.subject.product || 'AmbientScore';
      var cdActive = signal.evidence.activeCampaigns || [];
      var cdReasons = ['conversion dead-zone on "' + (signal.evidence.objective || 'revenue objective') + '": ' +
        (signal.evidence.usage7d || 0) + ' product usage events and ' + (signal.evidence.doneTasks7d || 0) +
        ' shipped tasks in 7d but 0 leads and 0 sales — fix the conversion step (lead capture, distribution, offer test), not content volume'];
      var cdP = _buildCampaignProposal(cdReasons, [{ product: cdTarget }], sas, nowMs);
      cdP.name = ('Conversion fix — ' + cdTarget).substring(0, 100);
      var cdIntro = cdActive.length
        ? '"' + cdActive[0] + '" is active and shipping, but the funnel converted 0 leads and 0 sales in 7d. This is NOT a duplicate content campaign — it targets the conversion step itself: '
        : 'Activity is flowing but the funnel converted 0 leads and 0 sales in 7d. This campaign targets the conversion step itself: ';
      cdP.description = (cdIntro +
        'lead capture, distribution into buyer-intent spaces, or an offer/pricing test. ' +
        'Approve to run it alongside (or instead of) the current campaign.').substring(0, 1000);
      cdP.kpiTarget = 'First captured lead within 14 days; first sale within 30 days';
      return cdP;
    }
    if (signal.trigger === 'declining_uncovered') {
      var dps = signal.evidence.decliningProducts || [];
      var f = dps[0];
      var delta = f && Number.isFinite(f.deltaPct) ? (' ' + f.deltaPct + '% traffic') : '';
      var reasons = [dps.length + ' product(s) declining with no active campaign (e.g. ' + (f ? f.product : '') + delta + ')'];
      var targets = dps.map(function (p) { return { product: p.product }; });
      return _buildCampaignProposal(reasons, targets, sas, nowMs);
    }
    var stagReasons = ['all active campaigns stagnant (no completed work in ' + STAGNANT_DAYS + 'd)'];
    var stagTargets = (signal.evidence.products || []).map(function (p) { return { product: p }; });
    return _buildCampaignProposal(stagReasons, stagTargets, sas, nowMs);
  }
  var primary = signal.trigger === 'near_complete' ? 'complete'
    : signal.trigger === 'deadline_at_risk' ? 'deadline' : 'stale';
  var oReasons;
  if (signal.trigger === 'near_complete') {
    oReasons = [signal.evidence.count + ' active objective(s) >= ' + OBJECTIVE_COMPLETE_PCT + '% complete (successor needed)'];
  } else if (signal.trigger === 'deadline_at_risk') {
    oReasons = ['"' + (signal.subject.objectiveTitle || signal.subject.objectiveId) + '" is at ' +
      signal.evidence.progressPct + '% with ' + signal.evidence.daysLeft + 'd to its ' +
      (signal.evidence.deadline || '?') + ' deadline — decide the rescue play or the successor now, not after the miss'];
  } else {
    oReasons = [signal.evidence.count + ' active objective(s) stale (no campaign/task activity in ' + STALE_DAYS + 'd)'];
  }
  return _buildObjectiveProposal(oReasons, primary, sas, nowMs);
}

// ── Pure core (deterministic path) ──────────────────────────────────────────────
// Signal-driven: detect → pick top per type → deterministic build. Returns 0-2.
function computeProposals(state, nowMs) {
  if (!state || typeof state !== 'object') return [];
  var queue = _arr(state.approvalQueue) || [];
  var picks = _pickTopPerType(detectSignals(state, nowMs), queue, nowMs);
  return picks.map(function (sig) {
    var p = _deterministicFromSignal(sig, state, nowMs);
    if (p && !p.trigger) p.trigger = sig.trigger; // enables the per-trigger reject cooldown
    return p;
  });
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
      details: { type: p.type, source: p.source || SOURCE, proposalId: p.id, composedBy: p.composedBy || 'deterministic' }
    });
  });
  var trimmed = log.length > 5000 ? log.slice(-5000) : log;
  await storage.setState('governanceLog', trimmed);
}

// ── IO orchestration ────────────────────────────────────────────────────────
// storage is injected (../_utils/companyStorage in prod). opts.callModel (optional)
// enables LLM-authored proposals; without it (or on failure) the deterministic
// builder is used. Detect → pick top per type → compose-or-fallback → queue.
async function runProposalGenerator(opts) {
  opts = opts || {};
  var storage = opts.storage;
  var nowMs = opts.nowMs || Date.now();
  var log = opts.log || function () {};
  var callModel = typeof opts.callModel === 'function' ? opts.callModel : null;
  try {
    var loaded = await Promise.all([
      storage.getState('campaigns').then(function (v) { return v || []; }),
      storage.getState('objectives').then(function (v) { return v || []; }),
      storage.getState('tasks').then(function (v) { return v || []; }),
      storage.getState('approvalQueue').then(function (v) { return v || []; }),
      storage.getState('runtimeMemory').then(function (v) { return v || {}; }),
      storage.getState('socialAccountStats').then(function (v) { return v || {}; }),
      storage.getState('revenueLedger').then(function (v) { return v || []; }),
      storage.getState('as_leads').then(function (v) { return v || []; }).catch(function () { return []; })
    ]);
    var productNames = [];
    try { productNames = Object.keys(require('../_data/product-facts.json').products || {}); }
    catch (_pfErr) { /* names optional — grounding falls back to empty */ }

    var state = {
      campaigns: loaded[0],
      objectives: loaded[1],
      tasks: loaded[2],
      approvalQueue: loaded[3],
      strategicDigest: (loaded[4] && loaded[4].strategicDigest) || null,
      socialAccountStats: loaded[5],
      revenueLedger: loaded[6],
      asLeads: loaded[7],
      productNames: productNames
    };

    // Runtime toggle: set systemConfig.proposalGenerator.enabled = false to stop the
    // deterministic generator (e.g. once the agent-emitted path is confirmed sufficient).
    // Default (unset) = enabled. Expiry of stale generator proposals still runs when off.
    var _sysCfg = (await storage.getState('systemConfig')) || {};
    var _genEnabled = !(_sysCfg.proposalGenerator && _sysCfg.proposalGenerator.enabled === false);

    var proposals = [];
    if (_genEnabled) {
      var picks = _pickTopPerType(detectSignals(state, nowMs), state.approvalQueue, nowMs);
      for (var i = 0; i < picks.length; i++) {
        var sig = picks[i];
        var proposal = null;
        var composedBy = 'deterministic';
        if (callModel) {
          var grounding = composer.buildGrounding(sig, state);
          var composed = await composer.compose(sig, grounding, callModel, nowMs);
          if (composed && composed.proposal) { proposal = composed.proposal; composedBy = 'llm'; }
          else { log('[proposalGenerator] compose skipped (' + (composed && composed.reason) + ') — using deterministic fallback for ' + sig.kind); }
        }
        if (!proposal) { proposal = _deterministicFromSignal(sig, state, nowMs); composedBy = 'deterministic'; }
        proposal.composedBy = composedBy;
        proposal.trigger = proposal.trigger || sig.trigger; // enables the per-trigger reject cooldown
        proposals.push(proposal);
      }
    } else {
      log('[proposalGenerator] Disabled via systemConfig.proposalGenerator.enabled=false — running expiry only.');
    }

    // Re-read queue right before write to minimize clobber. Always run expiry (even
    // when nothing new is created) so stale generic suggestions don't pile up.
    var queue = (await storage.getState('approvalQueue')) || [];
    var expired = _expireStaleGeneratorProposals(queue, nowMs);
    var pruned = _pruneResolvedProposals(queue, nowMs);
    if (pruned) log('[proposalGenerator] Pruned ' + pruned + ' resolved proposal(s) older than ' + RESOLVED_RETENTION_DAYS + 'd.');

    // Re-check dedup against the freshly-read queue. LLM compose latency widened the
    // window since the initial read (loaded[3]); a concurrent cron/trigger run may
    // have queued a same-type proposal. Drop ours if so — prevents a clobbered write
    // and keeps the proposal-created funnel log consistent with what we actually queue.
    // Best-effort only: two runs that both re-read before either writes still last-write-
    // wins; this additive cron intentionally has no lock, so the window is narrowed, not closed.
    proposals = proposals.filter(function (p) { return !_isDeduped(queue, p.type, nowMs); });

    // Semantic dedup vs ACTIVE objectives/campaigns + pending proposals — the type-level
    // throttle above is content-blind, which let the generator re-propose intents that
    // were already live under different wording (duplicate-objective CEO escalation,
    // 2026-07-27). Mirrors the proposal_semantic_dup gate in agent-runner.
    proposals = proposals.filter(function (p) {
      var pTitle = p.title || p.name || '';
      if (!pTitle) return true;
      var against = (p.type === 'objective_proposal' ? state.objectives : state.campaigns) || [];
      var live = against.filter(function (x) { return x && (!x.status || x.status === 'active'); });
      for (var li = 0; li < live.length; li++) {
        if (helpers.titleSimilarity(pTitle, live[li].title || live[li].name) >= 0.6) {
          log('[proposalGenerator] Dropped ' + p.type + ' "' + pTitle.substring(0, 60) + '" — semantic dup of active ' + live[li].id);
          return false;
        }
      }
      var pend = queue.find(function (q) {
        return q.type === p.type && q.status === 'pending' &&
          helpers.titleSimilarity(pTitle, q.title || q.name || '') >= 0.6;
      });
      if (pend) {
        log('[proposalGenerator] Dropped ' + p.type + ' "' + pTitle.substring(0, 60) + '" — semantic dup of pending ' + pend.id);
        return false;
      }
      return true;
    });
    proposals.forEach(function (p) { queue.push(p); });

    if (!proposals.length && !expired && !pruned) {
      log('[proposalGenerator] No propose-worthy conditions; nothing created, expired, or pruned.');
      return { ok: true, created: 0, expired: 0, pruned: 0, types: [] };
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
  detectSignals: detectSignals,
  runProposalGenerator: runProposalGenerator,
  _expireStaleGeneratorProposals: _expireStaleGeneratorProposals,
  _pruneResolvedProposals: _pruneResolvedProposals,
  _isPlaceholderObjective: _isPlaceholderObjective,
  _pickTopPerType: _pickTopPerType,
  _deterministicFromSignal: _deterministicFromSignal
};
