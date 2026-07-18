// milestone-herald-trigger — HTTP wrapper to manually run the Milestone Herald.
// Mirrors rewards-engine-trigger. POST /api/milestone-herald-trigger
// ?dryRun=1 runs full detection but writes nothing — returns what WOULD fire.

const storage = require('../_utils/companyStorage');
const { runMilestoneHerald } = require('../companyHeartbeat/milestone-herald');

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
  const dryRun = String((req.query && req.query.dryRun) || '') === '1';
  try {
    const result = await runMilestoneHerald({
      storage: storage,
      nowMs: Date.now(),
      dryRun: dryRun,
      log: function () { context.log.apply(context, arguments); }
    });
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', result: result } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err).substring(0, 300) } };
  }
};
