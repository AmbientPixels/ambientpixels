// outcome-intel.js — Outcome Attribution Phase 3
//
// Builds a per-agent / per-experiment / per-hook / per-campaign rollup from
// the outcomeSnapshots store. Consumed by prompt-builders (Phase 4), the
// Cipher ROI panel (upgrade), and the attribution dashboard (Phase 6).
//
// Ground rules:
//   - Only snapshots with `complete: true` (t7+ reached) count toward engagement math.
//     Incomplete snapshots are surfaced as "pending" counts but never as signal.
//   - LinkedIn snapshots today never reach complete (no metrics pull). Digest
//     flags this explicitly: linkedinPendingCount surfaces the blind spot.
//   - Auto-conclude gates (consumed by Phase 4b):
//       samples >= 10, AND
//       >= 5 samples on both treatment + baseline arms, AND
//       |effectSize| >= 0.15, AND
//       verdict in { 'promote', 'discard' }.
//     Below all four → 'inconclusive', experiment stays active.

const { classifyHook } = require('./performance-intel');

const AUTO_CONCLUDE = {
  minSamples: 10,
  minPerArm: 5,
  minEffectSize: 0.15
};

// Engagement rate — the normalized signal per snapshot. Views-based for
// platforms that expose it (X). Bluesky/Reddit don't expose views; use a
// crude reach proxy: (likes + comments + reposts) / (1 + likes*5) to normalize
// so a post with 100 likes and 10 comments isn't directly comparable to a post
// with 1000 views and 10 total engagements. When views is 0 AND it's a
// platform known to lack view counts, we emit `null` and exclude from
// cross-platform ER comparisons — per-platform distributions stay valid.
function computeER(sample, platform) {
  if (!sample) return null;
  const views = Number(sample.views || 0);
  const likes = Number(sample.likes || 0);
  const comments = Number(sample.comments || 0);
  const reposts = Number(sample.reposts || 0);
  if (views > 0) {
    return (likes + comments + reposts) / views;
  }
  // Platforms without views: return null; caller must handle.
  return null;
}

// Raw engagement total — use when ER isn't available (no views).
function totalEngagement(sample) {
  if (!sample) return 0;
  return (Number(sample.likes || 0) + Number(sample.comments || 0) + Number(sample.reposts || 0));
}

function getT7(snapshot) {
  return (snapshot.samples || []).find(s => s && s.lag === 't7') || null;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function mean(arr) {
  if (!arr || arr.length === 0) return null;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function buildOutcomeDigest(outcomeSnapshots, actions, campaigns, experiments, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const snaps = outcomeSnapshots && typeof outcomeSnapshots === 'object'
    ? Object.values(outcomeSnapshots).filter(Boolean) : [];

  const complete = snaps.filter(s => s.complete === true);
  const pending = snaps.filter(s => s.complete !== true);
  const linkedinPendingCount = pending.filter(s => (s.platform || '').toLowerCase() === 'linkedin').length;

  // ── Per agent ──
  const perAgent = {};
  const byAgent = {};
  for (let i = 0; i < complete.length; i++) {
    const s = complete[i];
    const aid = s.createdBy || 'unknown';
    if (!byAgent[aid]) byAgent[aid] = [];
    byAgent[aid].push(s);
  }
  Object.keys(byAgent).forEach(aid => {
    const list = byAgent[aid];
    const ers = list.map(s => computeER(getT7(s), s.platform)).filter(x => x !== null && Number.isFinite(x));
    const totals = list.map(s => totalEngagement(getT7(s)));
    // Top/worst hook buckets (min 3 samples per hook)
    const byHook = {};
    list.forEach(s => {
      const h = s.hookType || 'general';
      if (!byHook[h]) byHook[h] = [];
      const total = totalEngagement(getT7(s));
      byHook[h].push(total);
    });
    const hookMedians = Object.keys(byHook)
      .filter(h => byHook[h].length >= 3)
      .map(h => ({ hook: h, median: median(byHook[h]), samples: byHook[h].length }));
    hookMedians.sort((a, b) => b.median - a.median);
    perAgent[aid] = {
      posts7d: list.filter(s => Date.parse(s.publishedAt) >= now - 7 * 86400000).length,
      posts30d: list.filter(s => Date.parse(s.publishedAt) >= now - 30 * 86400000).length,
      medianER: median(ers),
      medianTotalEngagement: median(totals),
      topHook: hookMedians[0] || null,
      worstHook: hookMedians.length > 1 ? hookMedians[hookMedians.length - 1] : null
    };
  });

  // ── Per experiment ──
  const expList = Array.isArray(experiments) ? experiments : [];
  const perExperiment = expList.filter(e => e && e.hypothesis).map(exp => {
    const tag = exp.hypothesis;
    const agent = exp.agentId;
    const treatment = complete.filter(s => s.experimentTag === tag && s.createdBy === agent);
    const baseline = complete.filter(s => s.experimentTag !== tag && s.createdBy === agent);

    const tEng = treatment.map(s => totalEngagement(getT7(s)));
    const bEng = baseline.map(s => totalEngagement(getT7(s)));
    const tMean = mean(tEng) || 0;
    const bMean = mean(bEng) || 0;
    const effectSize = bMean > 0 ? (tMean - bMean) / bMean : 0;

    let verdict = 'inconclusive';
    const samples = treatment.length + baseline.length;
    if (samples >= AUTO_CONCLUDE.minSamples &&
        treatment.length >= AUTO_CONCLUDE.minPerArm &&
        baseline.length >= AUTO_CONCLUDE.minPerArm &&
        Math.abs(effectSize) >= AUTO_CONCLUDE.minEffectSize) {
      verdict = effectSize > 0 ? 'promote' : 'discard';
    }

    return {
      hypothesis: tag,
      agentId: agent,
      startedAt: exp.startedAt || null,
      status: exp.status || 'active',
      samples: samples,
      treatmentSamples: treatment.length,
      baselineSamples: baseline.length,
      treatmentMeanEngagement: Math.round(tMean * 100) / 100,
      baselineMeanEngagement: Math.round(bMean * 100) / 100,
      effectSize: Math.round(effectSize * 1000) / 1000,
      verdict: verdict,
      shouldAutoConclude: verdict === 'promote' || verdict === 'discard'
    };
  });

  // ── Per hook / platform ──
  const perHook = [];
  const hookMap = {};
  complete.forEach(s => {
    const key = (s.platform || 'unknown') + '|' + (s.hookType || 'general');
    if (!hookMap[key]) hookMap[key] = [];
    hookMap[key].push(totalEngagement(getT7(s)));
  });
  // Also compute overall median for percentile ranking
  const overallEngagements = complete.map(s => totalEngagement(getT7(s)));
  const overallMedian = median(overallEngagements) || 0;
  Object.keys(hookMap).forEach(key => {
    const [platform, hookType] = key.split('|');
    const list = hookMap[key];
    if (list.length < 3) return; // min 3 samples per cell
    const m = median(list);
    perHook.push({
      platform: platform,
      hookType: hookType,
      sampleCount: list.length,
      medianEngagement: m,
      percentileVsOverall: overallMedian > 0 ? Math.round((m / overallMedian) * 100) : null
    });
  });
  perHook.sort((a, b) => b.medianEngagement - a.medianEngagement);

  // ── Per campaign ──
  const campList = Array.isArray(campaigns) ? campaigns : [];
  const perCampaign = campList.filter(c => c && c.id).map(c => {
    const list = snaps.filter(s => s.campaignId === c.id);
    const completeList = list.filter(s => s.complete);
    const totalEng = completeList.reduce((sum, s) => sum + totalEngagement(getT7(s)), 0);
    const blogViewsAttributed = list.reduce((sum, s) => sum + ((s.downstream && s.downstream.blogViews) || 0), 0);
    const formSubmitsAttributed = list.reduce((sum, s) => sum + ((s.downstream && s.downstream.formSubmits) || 0), 0);
    return {
      campaignId: c.id,
      title: (c.title || c.id).substring(0, 60),
      postsPublished: list.length,
      postsComplete: completeList.length,
      totalEngagements: totalEng,
      blogViewsAttributed: blogViewsAttributed,
      formSubmitsAttributed: formSubmitsAttributed
    };
  });

  // ── Rewrite impact ──
  // Posts with a quality-gate rewrite in their history (we can't detect this
  // from snapshots alone — it requires agentDecisions from Phase 5). Stub
  // for now; populated in Phase 5 via decision backfill.
  const rewriteImpact = {
    totalRewrites: 0,
    rewriteMeanEngagement: null,
    firstDraftMeanEngagement: null,
    delta: null,
    note: 'Populated by Phase 5 agentDecisions outcome backfill.'
  };

  return {
    generatedAt: new Date(now).toISOString(),
    totals: {
      snapshots: snaps.length,
      complete: complete.length,
      pending: pending.length,
      linkedinPendingCount: linkedinPendingCount
    },
    perAgent: perAgent,
    perExperiment: perExperiment,
    perHook: perHook,
    perCampaign: perCampaign,
    rewriteImpact: rewriteImpact
  };
}

// ── Revenue attribution into the learning loop (Phase 2.4) ──
//
// The outcome rollup above measures engagement. These helpers thread REAL money
// (from the revenueLedger) into the same per-agent / per-campaign rollups, so ROI
// reflects dollars, not just likes. Pure + offline-testable (mirrors revenue-intel
// discipline). Wired by companyHeartbeat/index.js after the revenueDigest is built.
//
// The join: a ledger entry's `utmContent` is the originating post's action id.
// We resolve that action id → { agent, campaignId } via a map built from LIVE
// actions PLUS the archived `actionAttributionIndex` (written by actionsArchiver),
// so a purchase that lands after the post has aged out of live `actions` (the
// first-touch UTM decay bug) still attributes.

var _POSITIVE_REVENUE_TYPES = { one_time: true, subscription_initial: true, subscription_renewal: true };

// Build actionId → { agent, campaignId } from live actions, with an archived
// index as fallback. Live actions win (freshest truth). `archivedIndex` is the
// blob shape written by actionsArchiver: { map: { actionId: { agent, campaignId } } }
// (a flat { actionId: {...} } object is also tolerated).
function buildActionAttributionMap(liveActions, tasks, archivedIndex) {
  var map = {};
  // Seed with the archived fallback first (live overrides below).
  if (archivedIndex && typeof archivedIndex === 'object') {
    var flat = (archivedIndex.map && typeof archivedIndex.map === 'object') ? archivedIndex.map : archivedIndex;
    Object.keys(flat).forEach(function (aid) {
      var v = flat[aid];
      if (v && typeof v === 'object') {
        map[aid] = { agent: v.agent || null, campaignId: v.campaignId || null };
      }
    });
  }
  var taskById = {};
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) { if (t && t.id) taskById[t.id] = t; });
  (Array.isArray(liveActions) ? liveActions : []).forEach(function (a) {
    if (!a || !a.id) return;
    var campaignId = a.campaign_id || null;
    if (!campaignId && a._parentTaskId && taskById[a._parentTaskId]) {
      campaignId = taskById[a._parentTaskId].campaign_id || null;
    }
    var agent = a.created_by || a.createdBy || a.agentId || null;
    map[a.id] = { agent: agent, campaignId: campaignId };
  });
  return map;
}

// Attribute positive ledger revenue (cents) through the action map. Only positive
// types (one_time / subscription_*) attribute; refunds/disputes are ignored here so
// a leak never shows as negative "earned by agent X". Returns byAgent / byCampaign
// cent maps plus attributed/unattributed totals.
function attributeRevenue(ledgerEntries, actionMap) {
  var byAgent = {};
  var byCampaign = {};
  var attributedCents = 0;
  var unattributedCents = 0;
  var entries = Array.isArray(ledgerEntries) ? ledgerEntries : [];
  var m = actionMap || {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i] || {};
    var amt = Number(e.amountCents) || 0;
    if (!(_POSITIVE_REVENUE_TYPES[e.type] && amt > 0)) continue;
    var ref = e.utmContent ? m[e.utmContent] : null;
    if (ref && (ref.agent || ref.campaignId)) {
      if (ref.agent) byAgent[ref.agent] = (byAgent[ref.agent] || 0) + amt;
      if (ref.campaignId) byCampaign[ref.campaignId] = (byCampaign[ref.campaignId] || 0) + amt;
      attributedCents += amt;
    } else {
      unattributedCents += amt;
    }
  }
  return { byAgent: byAgent, byCampaign: byCampaign, attributedCents: attributedCents, unattributedCents: unattributedCents };
}

// Merge a revenue attribution result into an already-built outcome digest (in place).
// Adds `revenueAttributedCents` to every perAgent entry and every perCampaign row,
// creates minimal rows for agents/campaigns that earned revenue but have no snapshots
// yet (so the first dollar is never invisible), and attaches a `revenueTotals` summary.
function applyRevenueToOutcomeDigest(digest, attribution) {
  if (!digest) return digest;
  var attr = attribution || { byAgent: {}, byCampaign: {}, attributedCents: 0, unattributedCents: 0 };
  var byAgent = attr.byAgent || {};
  var byCampaign = attr.byCampaign || {};

  digest.perAgent = digest.perAgent || {};
  Object.keys(byAgent).forEach(function (aid) {
    if (!digest.perAgent[aid]) {
      digest.perAgent[aid] = { posts7d: 0, posts30d: 0, medianER: null, medianTotalEngagement: null, topHook: null, worstHook: null };
    }
  });
  Object.keys(digest.perAgent).forEach(function (aid) {
    digest.perAgent[aid].revenueAttributedCents = byAgent[aid] || 0;
  });

  if (Array.isArray(digest.perCampaign)) {
    var present = {};
    digest.perCampaign.forEach(function (c) {
      c.revenueAttributedCents = byCampaign[c.campaignId] || 0;
      present[c.campaignId] = true;
    });
    Object.keys(byCampaign).forEach(function (cid) {
      if (!present[cid]) {
        digest.perCampaign.push({
          campaignId: cid,
          title: String(cid).substring(0, 60),
          postsPublished: 0,
          postsComplete: 0,
          totalEngagements: 0,
          blogViewsAttributed: 0,
          formSubmitsAttributed: 0,
          revenueAttributedCents: byCampaign[cid]
        });
      }
    });
  }

  digest.revenueTotals = {
    attributedCents: attr.attributedCents || 0,
    unattributedCents: attr.unattributedCents || 0,
    byAgentCents: byAgent,
    byCampaignCents: byCampaign
  };
  return digest;
}

module.exports = {
  buildOutcomeDigest: buildOutcomeDigest,
  AUTO_CONCLUDE: AUTO_CONCLUDE,
  computeER: computeER,
  totalEngagement: totalEngagement,
  buildActionAttributionMap: buildActionAttributionMap,
  attributeRevenue: attributeRevenue,
  applyRevenueToOutcomeDigest: applyRevenueToOutcomeDigest
};
