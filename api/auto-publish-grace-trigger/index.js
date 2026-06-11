// auto-publish-grace-trigger — HTTP wrapper to manually run the grace-window pass.
// Mirrors company-weekly-report-trigger. POST /api/auto-publish-grace-trigger
// Useful for post-deploy verification and for forcing a pass after flipping
// systemConfig.autoPublish.enabled without waiting for the hourly timer.

const storage = require('../_utils/companyStorage');
const { runGraceWindow } = require('../_utils/graceWindow');

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
    const result = await runGraceWindow(context);
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', result: result } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err).substring(0, 300) } };
  }
};
