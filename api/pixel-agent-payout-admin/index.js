// pixel-agent-payout-admin — CEO admin view for payout management
// GET /api/pixel-agent-payout-admin — view all payout runs + creator profiles
// POST /api/pixel-agent-payout-admin { action: 'dry-run' | 'execute', month? } — trigger payout

const storage = require('../_utils/companyStorage');
const { executePayoutRun } = require('../_lib/stripe/payoutExecutor');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // CEO only
  if (req.headers['x-company-secret'] !== 'pixelpusher') {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'CEO access required' } };
    return;
  }

  try {
    if (req.method === 'GET') {
      // Load all payout data for admin overview
      var community = (await storage.getState('pixelAgentCommunity').catch(function () { return []; })) || [];
      var creatorStats = (await storage.getState('pixelAgentCreatorStats').catch(function () { return {}; })) || {};

      // Collect unique creator IDs
      var creatorIds = {};
      community.forEach(function (a) { if (a.active && a.creatorId) creatorIds[a.creatorId] = true; });
      Object.keys(creatorStats).forEach(function (cid) { creatorIds[cid] = true; });

      // Load all creator profiles + payout histories
      var creators = [];
      var cids = Object.keys(creatorIds);
      for (var i = 0; i < cids.length; i++) {
        var profile = await storage.getState('creatorProfiles/' + cids[i]).catch(function () { return null; });
        var history = await storage.getState('payout-history/' + cids[i]).catch(function () { return []; });
        var agentCount = community.filter(function (a) { return a.active && a.creatorId === cids[i]; }).length;

        creators.push({
          creatorId: cids[i],
          profile: profile,
          payoutHistory: history || [],
          agentCount: agentCount,
          totalRuns: creatorStats[cids[i]] ? (creatorStats[cids[i]]._total || 0) : 0
        });
      }

      // Load recent payout runs (last 6 months)
      var payoutRuns = [];
      var now = new Date();
      for (var m = 0; m < 6; m++) {
        var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        var run = await storage.getState('payout-runs/' + key).catch(function () { return null; });
        if (run) payoutRuns.push(run);
      }

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          creators: creators,
          payoutRuns: payoutRuns,
          summary: {
            totalCreators: creators.length,
            enrolledCreators: creators.filter(function (c) { return c.profile && c.profile.stripeConnectAccountId; }).length,
            payoutReadyCreators: creators.filter(function (c) { return c.profile && c.profile.payoutsEnabled; }).length,
            totalPaidOut: creators.reduce(function (sum, c) { return sum + (c.profile ? (c.profile.totalPaidOut || 0) : 0); }, 0),
            totalPending: creators.reduce(function (sum, c) { return sum + (c.profile ? (c.profile.pendingBalance || 0) : 0); }, 0)
          }
        }
      };

    } else if (req.method === 'POST') {
      // Trigger payout (same as pixel-agent-payout-run)
      var body = req.body || {};
      var result = await executePayoutRun({
        month: body.month || null,
        triggeredBy: 'ceo-admin',
        dryRun: body.action === 'dry-run',
        context: context
      });

      context.res = { status: 200, headers: CORS_HEADERS, body: result };
    }

  } catch (err) {
    context.log.error('[PayoutAdmin] Error:', err.message, err.stack);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Admin request failed: ' + err.message }
    };
  }
};
