// campaignAvailability.js — which campaigns will actually accept a new task right now.
//
// WHY THIS EXISTS
//
// Agents cannot see the campaign gates, so they propose into campaigns that are shut and
// get refused. Measured over 7 days on 2026-08-09: 294 blocked actions across the fleet,
// and `campaign_status` (paused) or `campaign_freeze` (cadence/cap/date) was the top gate
// for six of nine agents — Echo alone hit campaign_freeze 30 times. Every one of those is
// ~45s of model time spent producing a proposal that was never going to land.
//
// This is not a new rule. It is the EXISTING gate logic in agent-runner.js (~1490-1597 for
// freeze, index.js ~2687 for paused status), read ahead of time so the prompt can say
// "don't bother" before the tokens are spent.
//
// >>> MIRROR WARNING <<<
// If the gates in agent-runner.js change, change this too. The failure mode is asymmetric:
// reporting a campaign CLOSED when it is open costs one skipped opportunity, while reporting
// it OPEN when it is shut costs a wasted action and puts us back where we started. So an
// ambiguous signal resolves to closed.
//
// The block does name the open set — against live data only 1 of 37 campaigns was open, so
// listing the other 36 was a wall of prohibitions to convey a single usable fact. That means
// this module CAN be wrong in the expensive direction if it drifts from the gates, which is
// exactly why the mirror warning is here and why closureReason is pure and unit-tested.

var CADENCE_MS = { daily: 86400000, weekly: 604800000, biweekly: 1209600000 };
var CADENCE_DAYS = { daily: 1, weekly: 7, biweekly: 14 };

/** Pure. Campaign tasks that count toward caps and cadence (auto-created children do not). */
function countableTasks(tasks, campaignId) {
  return (Array.isArray(tasks) ? tasks : []).filter(function (t) {
    return t && t.campaign_id === campaignId && t.status !== 'archived' &&
      !(t.tags && t.tags.indexOf('auto-created') !== -1);
  });
}

/** Pure. Mirrors the maxTasks derivation in agent-runner.js. */
function effectiveMaxTasks(campaign, nowMs) {
  if (campaign.maxTasks && typeof campaign.maxTasks === 'number') return campaign.maxTasks;
  if (!campaign.frequency || !campaign.cadence) return null;
  var periodDays = CADENCE_DAYS[campaign.cadence] || 7;
  var socialTypes = (Array.isArray(campaign.allowedTaskTypes) ? campaign.allowedTaskTypes : [])
    .filter(function (tt) { return /^social_/.test(tt); });
  var platformCount = socialTypes.length || 1;
  var startMs = campaign.startDate ? new Date(campaign.startDate).getTime() : nowMs;
  var endMs = campaign.endDate ? new Date(campaign.endDate).getTime() : (startMs + 90 * 86400000);
  var periods = Math.ceil(Math.max(1, Math.ceil((endMs - startMs) / 86400000)) / periodDays);
  return campaign.frequency * periods * platformCount;
}

/**
 * Pure. Why this campaign is closed to new tasks, or null if it appears open.
 * @returns {{reason: string, detail: string}|null}
 */
function closureReason(campaign, tasks, nowMs) {
  if (!campaign) return null;
  var status = String(campaign.status || '').toLowerCase();

  if (status === 'paused') return { reason: 'paused', detail: 'campaign is paused — ALL task mutations are frozen, not just creation' };
  if (status === 'complete' || status === 'completed') return { reason: 'complete', detail: 'campaign is complete' };
  if (status === 'canceled' || status === 'cancelled') return { reason: 'canceled', detail: 'campaign is canceled' };

  if (campaign.startDate && new Date(campaign.startDate).getTime() > nowMs) {
    return { reason: 'not_started', detail: 'starts ' + String(campaign.startDate).slice(0, 10) };
  }
  if (campaign.endDate && new Date(campaign.endDate).getTime() < nowMs) {
    return { reason: 'ended', detail: 'ended ' + String(campaign.endDate).slice(0, 10) };
  }

  var countable = countableTasks(tasks, campaign.id);
  var cap = effectiveMaxTasks(campaign, nowMs);
  if (cap && countable.length >= cap) {
    return { reason: 'max_tasks', detail: countable.length + '/' + cap + ' tasks — cap reached' };
  }

  // Cadence: a countable task created inside the window closes it until the window passes.
  if (campaign.cadence) {
    var base = CADENCE_MS[campaign.cadence] || 0;
    var window = base;
    if (campaign.frequency && campaign.frequency > 1 && base > 0) {
      window = Math.floor(base / campaign.frequency);
    }
    if (window > 0) {
      var since = nowMs - window;
      var newest = 0;
      for (var i = 0; i < countable.length; i++) {
        var ts = new Date(countable[i].createdAt).getTime();
        if (Number.isFinite(ts) && ts > newest) newest = ts;
      }
      if (newest > since) {
        var freeInMin = Math.max(1, Math.round((newest + window - nowMs) / 60000));
        var when = freeInMin >= 120 ? (Math.round(freeInMin / 60) + 'h') : (freeInMin + 'min');
        return { reason: 'cadence', detail: 'cadence ' + campaign.cadence + ' — next task allowed in ~' + when };
      }
    }
  }

  return null;
}

/**
 * Pure. Campaigns currently closed to new tasks.
 * @returns {Array<{id, title, reason, detail}>}
 */
function closedCampaigns(campaigns, tasks, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var list = Array.isArray(campaigns) ? campaigns : [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (!c || !c.id || c.deletedAt) continue;
    // Archived campaigns are not proposed into anyway; listing them is prompt noise.
    if (String(c.status || '').toLowerCase() === 'archived') continue;
    var closure = closureReason(c, tasks, now);
    if (closure) out.push({ id: c.id, title: c.title || c.id, reason: closure.reason, detail: closure.detail });
  }
  return out;
}

/**
 * Prompt block. Leads with what IS open, because that is the short list.
 *
 * The first version listed the closed ones. Against live data that was 36 of 37 campaigns —
 * an enormous block telling agents 36 things not to do, to convey one thing they could.
 * Naming the open set is shorter, and it is the sentence an agent can actually act on.
 *
 * Closed campaigns survive only as a count, except paused, which is named: paused blocks
 * EVERY mutation on tasks already inside it, so an agent can waste an action there without
 * ever trying to create anything.
 */
function buildCampaignAvailabilityBlock(campaigns, tasks, nowMs, opts) {
  opts = opts || {};
  var max = opts.max || 8;
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var list = (Array.isArray(campaigns) ? campaigns : []).filter(function (c) {
    return c && c.id && !c.deletedAt && String(c.status || '').toLowerCase() !== 'archived';
  });
  if (!list.length) return '';

  var closed = closedCampaigns(list, tasks, now);
  var closedIds = {};
  var byReason = {};
  closed.forEach(function (c) { closedIds[c.id] = c; byReason[c.reason] = (byReason[c.reason] || 0) + 1; });
  var open = list.filter(function (c) { return !closedIds[c.id]; });

  var lines = ['CAMPAIGN AVAILABILITY (checked this cycle):'];

  if (open.length) {
    lines.push('  ACCEPTING new tasks (' + open.length + '):');
    open.slice(0, max).forEach(function (c) {
      lines.push('    - "' + (c.title || c.id) + '" (' + c.id + ')');
    });
    if (open.length > max) lines.push('    ...and ' + (open.length - max) + ' more.');
  } else {
    lines.push('  ACCEPTING new tasks: NONE. Every campaign is closed right now.');
    lines.push('  Do work that needs no campaign, or propose a new one — do not retry into a closed campaign.');
  }

  // Paused is named individually: it freezes updates/moves/comments on tasks ALREADY in the
  // campaign, so it costs actions even when nobody is creating anything.
  var paused = closed.filter(function (c) { return c.reason === 'paused'; });
  if (paused.length) {
    lines.push('  PAUSED — every mutation on their tasks is frozen, not just creation (' + paused.length + '):');
    paused.slice(0, max).forEach(function (c) { lines.push('    - "' + c.title + '" (' + c.id + ')'); });
    if (paused.length > max) lines.push('    ...and ' + (paused.length - max) + ' more.');
  }

  var otherClosed = closed.length - paused.length;
  if (otherClosed > 0) {
    var parts = [];
    Object.keys(byReason).forEach(function (r) {
      if (r !== 'paused') parts.push(byReason[r] + ' ' + r.replace(/_/g, ' '));
    });
    lines.push('  Also closed: ' + parts.join(', ') + '.');
  }

  lines.push('Proposing into anything not listed as ACCEPTING is refused by a gate and the action is spent for nothing.');
  return lines.join('\n');
}

module.exports = {
  closureReason,
  closedCampaigns,
  buildCampaignAvailabilityBlock,
  effectiveMaxTasks,
  countableTasks,
  CADENCE_MS,
  CADENCE_DAYS
};
