// pixel-agent-analytics — Creator-facing analytics for their community agents
// GET /api/pixel-agent-analytics — returns stats for agents created by the authenticated user

const storage = require('../_utils/companyStorage');
const { extractUserInfo } = require('../_utils/cfAuth');
const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { loadEntitlements, isProActive } = require('../_lib/stripe/entitlements');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-cf-auth-principal, x-user-id, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // Auth required
  var { userId, isAuthenticated } = extractUserInfo(req, context);

  // CEO fallback
  if (!isAuthenticated && req.headers['x-company-secret'] === 'pixelpusher') {
    userId = 'ceo';
    isAuthenticated = true;
  }

  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
    return;
  }

  try {
    // Load all data sources in parallel
    var results = await Promise.all([
      storage.getState('pixelAgentCommunity').catch(function () { return []; }),
      storage.getState('pixelAgentStats').catch(function () { return {}; }),
      storage.getState('pixelAgentRuns').catch(function () { return []; }),
      storage.getState('pixelAgentSubmissions').catch(function () { return []; }),
      storage.getState('pixelAgentCreatorStats').catch(function () { return {}; }),
      storage.getState('payout-history/' + userId).catch(function () { return []; }),
      storage.getState('creatorProfiles/' + userId).catch(function () { return null; })
    ]);

    var community = results[0] || [];
    var stats = results[1] || {};
    var runs = results[2] || [];
    var submissions = results[3] || [];
    var creatorStats = results[4] || {};
    var payoutHistory = results[5] || [];
    var creatorProfile = results[6] || null;

    // Revenue share constants
    var REVENUE_PER_RUN = 0.02;
    var PRO_RUN_WEIGHT = 1.5;
    var FREE_RUN_WEIGHT = 1.0;

    // Find this creator's live agents
    var isCEO = req.headers['x-company-secret'] === 'pixelpusher';
    var myAgents = community.filter(function (a) {
      if (!a.active) return false;
      // CEO sees all agents
      if (isCEO) return true;
      return a.creatorId === userId;
    });

    // Compute per-agent analytics
    var now = Date.now();
    var sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    var agentAnalytics = myAgents.map(function (agent) {
      var agentRuns = runs.filter(function (r) { return r.agentId === agent.id; });
      var recentRuns = agentRuns.filter(function (r) {
        return new Date(r.timestamp).getTime() > sevenDaysAgo;
      });
      var lastRun = agentRuns.length > 0 ? agentRuns[agentRuns.length - 1] : null;

      var agentTotalRuns = stats[agent.id] || 0;
      var runWeight = FREE_RUN_WEIGHT; // TODO: look up creator tier for weighted earnings

      return {
        id: agent.id,
        name: agent.name,
        tagline: agent.tagline,
        category: agent.category,
        tier: agent.tier,
        icon: agent.icon,
        portraitUrl: agent.portraitUrl || null,
        totalRuns: agentTotalRuns,
        runsLast7d: recentRuns.length,
        lastRunAt: lastRun ? lastRun.timestamp : null,
        approvedAt: agent.approvedAt || null,
        estimatedEarnings: (agentTotalRuns * runWeight * REVENUE_PER_RUN).toFixed(2),
        earningsLast7d: (recentRuns.length * runWeight * REVENUE_PER_RUN).toFixed(2),
        status: 'live'
      };
    });

    // Find pending submissions by this creator
    var pending = submissions.filter(function (s) {
      if (!s.agentConfig) return false;
      if (isCEO) return s.status === 'approved' && !s.approvedAt;
      return s.agentConfig.creatorId === userId &&
        (s.status === 'approved' || s.status === 'pending') &&
        !community.some(function (a) { return a.submissionId === s.id; });
    }).map(function (s) {
      return {
        id: s.agentConfig.id || s.id,
        name: s.agentConfig.name,
        tagline: s.agentConfig.tagline,
        category: s.agentConfig.category,
        status: 'pending_review',
        submittedAt: s.submittedAt,
        scores: s.review ? s.review.scores : null
      };
    });

    // Summary stats
    var totalRuns = agentAnalytics.reduce(function (sum, a) { return sum + a.totalRuns; }, 0);
    var totalRecent = agentAnalytics.reduce(function (sum, a) { return sum + a.runsLast7d; }, 0);
    var totalEarnings = agentAnalytics.reduce(function (sum, a) { return sum + parseFloat(a.estimatedEarnings || 0); }, 0);
    var recentEarnings = agentAnalytics.reduce(function (sum, a) { return sum + parseFloat(a.earningsLast7d || 0); }, 0);

    // Creator leaderboard
    var leaderboard = [];
    var creatorMap = {};
    community.filter(function (a) { return a.active && a.creatorId; }).forEach(function (agent) {
      var cid = agent.creatorId;
      if (!creatorMap[cid]) creatorMap[cid] = { creatorId: cid, creatorName: null, agentCount: 0, totalRuns: 0, creatorTier: 'free', runWeight: FREE_RUN_WEIGHT };
      creatorMap[cid].agentCount++;
      creatorMap[cid].totalRuns += (stats[agent.id] || 0);
      if (agent.creatorName && !creatorMap[cid].creatorName) creatorMap[cid].creatorName = agent.creatorName;
    });

    Object.keys(creatorMap).forEach(function (cid) {
      var entry = creatorMap[cid];
      entry.estimatedEarnings = (entry.totalRuns * entry.runWeight * REVENUE_PER_RUN).toFixed(2);
      leaderboard.push(entry);
    });

    leaderboard.sort(function (a, b) { return b.totalRuns - a.totalRuns; });
    leaderboard.forEach(function (entry, i) { entry.rank = i + 1; });

    // Non-CEO: show top 10 + own rank if outside
    if (!isCEO) {
      var myRank = leaderboard.find(function (e) { return e.creatorId === userId; });
      leaderboard = leaderboard.slice(0, 10);
      if (myRank && myRank.rank > 10) leaderboard.push(myRank);
    }

    // Next payout estimate (current month runs × weight × share %)
    var currentMonthRuns = totalRecent; // approximate with 7-day as proxy
    // Check creator's Pro status from entitlements
    var creatorIsPro = false;
    try {
      var blobSvc = process.env.AZURE_STORAGE_CONNECTION_STRING
        ? BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING)
        : new BlobServiceClient('https://cardforgeblobdata.blob.core.windows.net', new DefaultAzureCredential());
      var entContainer = blobSvc.getContainerClient('cardforge');
      var entRecord = await loadEntitlements(entContainer, userId);
      creatorIsPro = isProActive(entRecord);
    } catch (e) { /* non-fatal — default to free */ }
    var nextPayoutEstimate = currentMonthRuns * (creatorIsPro ? PRO_RUN_WEIGHT : FREE_RUN_WEIGHT) *
      REVENUE_PER_RUN * (creatorIsPro ? 0.70 : 0.50);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        userId: userId,
        agents: agentAnalytics,
        pending: pending,
        summary: {
          totalAgents: agentAnalytics.length,
          pendingCount: pending.length,
          totalRuns: totalRuns,
          runsLast7d: totalRecent,
          estimatedEarnings: totalEarnings.toFixed(2),
          earningsLast7d: recentEarnings.toFixed(2),
          revenuePerRun: REVENUE_PER_RUN,
          nextPayoutEstimate: nextPayoutEstimate.toFixed(2)
        },
        leaderboard: leaderboard,
        payoutHistory: payoutHistory,
        creatorTier: creatorIsPro ? 'pro' : 'free',
        revenueSharePercent: creatorIsPro ? 70 : 50
      }
    };

  } catch (err) {
    context.log.error('[AgentAnalytics] Error:', err.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Failed to load analytics: ' + err.message }
    };
  }
};
