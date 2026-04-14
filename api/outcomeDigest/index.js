// outcomeDigest — GET /api/outcomeDigest
//
// Read-through for the attribution dashboard (Phase 6). Returns the cached
// outcome digest from runtimeMemory.outcomeDigest (populated by each
// heartbeat via buildOutcomeDigest). Falls back to an on-demand build if the
// runtime cache is missing.

const storage = require('../_utils/companyStorage');
const { buildOutcomeDigest } = require('../companyHeartbeat/outcome-intel');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // Auth: require company secret OR SWA principal (CEO dashboard is authed).
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    return;
  }

  try {
    let digest = null;
    const runtime = (await storage.getState('runtimeMemory')) || {};
    if (runtime && runtime.outcomeDigest && runtime.outcomeDigest.generatedAt) {
      digest = runtime.outcomeDigest;
    }

    // Fallback: build on the fly if cache is missing or stale (>90 min old)
    const staleMs = 90 * 60 * 1000;
    const age = digest ? (Date.now() - Date.parse(digest.generatedAt)) : Infinity;
    const isStale = !digest || age > staleMs;

    if (isStale) {
      const snaps = (await storage.getState('outcomeSnapshots')) || {};
      const actions = (await storage.getState('actions')) || [];
      const campaigns = (await storage.getState('campaigns')) || [];
      const experiments = (await storage.getState('agentExperiments')) || [];
      digest = buildOutcomeDigest(snaps, actions, campaigns, experiments, Date.now());
      digest._builtOnDemand = true;
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify(digest)
    };
  } catch (err) {
    context.log.error && context.log.error('[outcomeDigest] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to build outcome digest', details: err && err.message ? err.message : String(err) })
    };
  }
};
