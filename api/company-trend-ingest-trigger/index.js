// company-trend-ingest-trigger — HTTP wrapper to manually invoke trend ingestion
// POST /api/company-trend-ingest-trigger

const storage = require('../_utils/companyStorage');
const { runIngestion } = require('../companyTrendIngest/index');

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
  if (demoGuard.isDemoMode && demoGuard.isDemoMode()) {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        ok: true,
        demo: true,
        message: 'Trend ingestion completed (demo)',
        trendCount: 12
      }
    };
    return;
  }

  // Auth check
  var secret = (req.headers && req.headers['x-company-secret']) || '';
  var clientPrincipal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !clientPrincipal) {
    context.res = {
      status: 403,
      headers: corsHeaders,
      body: { error: 'Unauthorized' }
    };
    return;
  }

  try {
    var result = await runIngestion(context.log.bind(context));
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: result
    };
  } catch (err) {
    context.log.error('[TrendIngestTrigger] Error:', err.message || err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Ingestion failed', details: err.message }
    };
  }
};
