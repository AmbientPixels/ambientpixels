// as-prospect-trigger — HTTP wrapper to manually run the prospect pipeline.
// Mirrors rewards-engine-trigger / milestone-herald-trigger. POST /api/as-prospect-trigger
// For post-deploy verification without waiting for the 2h timer.

const storage = require('../_utils/companyStorage');
const { runProspectPipeline } = require('../companyHeartbeat/prospect-pipeline');

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
    const result = await runProspectPipeline({
      storage: storage,
      log: function () { context.log.apply(context, arguments); }
    });
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', result: result } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err).substring(0, 300) } };
  }
};
