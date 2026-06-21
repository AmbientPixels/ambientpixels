// rewards-engine-trigger — HTTP wrapper to manually run the agent XP/reward engine.
// Mirrors proposal-generator-trigger. POST /api/rewards-engine-trigger
// For post-deploy verification without waiting for the hourly timer.

const storage = require('../_utils/companyStorage');
const { runRewardsEngine } = require('../companyHeartbeat/rewards-engine');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid write secret' } };
    return;
  }
  try {
    const result = await runRewardsEngine({
      storage: storage,
      nowMs: Date.now(),
      log: function () { context.log.apply(context, arguments); }
    });
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', result: result } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err).substring(0, 300) } };
  }
};
