// company-heartbeat-trigger — HTTP wrapper to manually invoke the heartbeat cycle
// POST /api/company-heartbeat-trigger

const storage = require('../_utils/companyStorage');

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

  // Validate write secret
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = {
      status: 403,
      headers: corsHeaders,
      body: { error: 'Invalid write secret' }
    };
    return;
  }

  context.log('[HeartbeatTrigger] Manual heartbeat triggered');

  try {
    // Import and run the heartbeat logic
    const heartbeat = require('../companyHeartbeat/index');

    // Create a mock timer context
    await heartbeat(context, null);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: 'ok', message: 'Heartbeat cycle completed' }
    };
  } catch (err) {
    context.log.error('[HeartbeatTrigger] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Heartbeat failed', details: err.message }
    };
  }
};
