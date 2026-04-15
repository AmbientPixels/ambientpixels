// allocationDigest — GET /api/allocationDigest
//
// Read-through for the Capital Allocation dashboard (System 12). Returns the
// cached snapshot from runtimeMemory.allocationDigest with on-demand fallback
// build if cache is missing or stale (>90 min).
//
// Pattern mirrors worldState + awarenessDigest endpoints.

const storage = require('../_utils/companyStorage');
const { buildAllocationDigest } = require('../companyHeartbeat/allocation-intel');

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

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    return;
  }

  try {
    const runtime = (await storage.getState('runtimeMemory')) || {};
    let snapshot = null;
    if (runtime && runtime.allocationDigest && runtime.allocationDigest.generatedAt) {
      snapshot = runtime.allocationDigest;
    }

    const staleMs = 90 * 60 * 1000;
    const age = snapshot ? (Date.now() - Date.parse(snapshot.generatedAt)) : Infinity;
    const isStale = !snapshot || age > staleMs;

    if (isStale) {
      const [geminiUsage, capitalAllocation] = await Promise.all([
        storage.getState('geminiUsage').then(v => v || []),
        storage.getState('capitalAllocation').then(v => v || {})
      ]);
      const financeDigest = runtime.financeDigest || null;
      const outcomeDigest = runtime.outcomeDigest || null;

      snapshot = buildAllocationDigest(geminiUsage, financeDigest, outcomeDigest, capitalAllocation, Date.now());
      snapshot._builtOnDemand = true;
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify(snapshot)
    };
  } catch (err) {
    context.log.error && context.log.error('[allocationDigest] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to build allocation digest', details: err && err.message ? err.message : String(err) })
    };
  }
};
