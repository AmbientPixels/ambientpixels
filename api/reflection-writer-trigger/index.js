// reflection-writer-trigger — HTTP wrapper to manually run reflectionWriterCron.
// Mirrors rewards-engine-trigger. POST /api/reflection-writer-trigger
// For post-deploy verification without waiting for the daily 15:30 UTC timer.
// timerSkip only fires in demo mode, so invoking the timer handler directly is
// safe in production.

const storage = require('../_utils/companyStorage');
const reflectionCron = require('../reflectionWriterCron');

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
    await reflectionCron(context);
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', ran: 'reflectionWriterCron' } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err).substring(0, 300) } };
  }
};
