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

  var demoGuard = require('../_utils/demoGuard');
  if (demoGuard.isDemoMode()) {
    // Return a realistic mock heartbeat instead of blocking
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        status: 'ok',
        demo: true,
        message: 'Heartbeat cycle completed (demo)',
        runId: 'demo-run-' + Date.now(),
        summary: {
          agents_active: 8,
          tasks_created: 2,
          tasks_moved: 1,
          documents_updated: 1,
          social_drafts_queued: 1,
          approvals_pending: 1,
          duration_ms: 4200 + Math.floor(Math.random() * 800),
          highlights: [
            'Nova delegated 2 new tasks based on active campaign priorities.',
            'Echo queued a LinkedIn post for CEO approval.',
            'Cipher reviewed weekly cost trends — spend is within budget.',
            'Forge confirmed all deploys healthy, uptime 99.97%.',
            'Scribe updated the Automation & Controls wiki page.'
          ]
        }
      }
    };
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

    // Run the heartbeat — returns { skipped, reason, runId } or undefined
    const result = await heartbeat(context, null);

    if (result && result.skipped) {
      context.res = {
        status: 409,
        headers: corsHeaders,
        body: {
          status: 'skipped',
          reason: result.reason,
          message: result.reason === 'lock'
            ? 'Heartbeat skipped: another run is active (holder: ' + result.holderRunId + ')'
            : 'Heartbeat skipped: ' + result.reason
        }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: 'ok', message: 'Heartbeat cycle completed', runId: result && result.runId }
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
