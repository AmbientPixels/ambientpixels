// revenueDigest — GET /api/revenueDigest
//
// Read-through for the CEO revenue dashboard. Returns the cached revenue digest
// from runtimeMemory.revenueDigest (populated by each heartbeat via
// buildRevenueDigest over the revenueLedger). Falls back to an on-demand build
// from the ledger if the runtime cache is missing or stale.
//
// Same pattern as outcomeDigest / allocationDigest. /api/* is a catch-all proxy
// in staticwebapp.config.json so no route config is needed.

const storage = require('../_utils/companyStorage');
const { buildRevenueDigest } = require('../companyHeartbeat/revenue-intel');
const { getLedger } = require('../_lib/stripe/revenueLedger');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

// Month-to-date LLM spend in cents (only used for the rare on-demand rebuild;
// the cached digest already carries spendCents from the heartbeat).
async function _mtdSpendCents() {
  try {
    const cost = await storage.getGeminiCostSummary(30);
    const byDay = (cost && cost.byDay) || {};
    const prefix = new Date().toISOString().substring(0, 7); // YYYY-MM
    let total = 0;
    Object.keys(byDay).forEach(function (d) {
      if (typeof d === 'string' && d.indexOf(prefix) === 0) total += (byDay[d] && byDay[d].cost) || 0;
    });
    return Math.round(total * 100);
  } catch (_e) {
    return 0;
  }
}

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
    if (runtime && runtime.revenueDigest && runtime.revenueDigest.generatedAt) {
      digest = runtime.revenueDigest;
    }

    // Fallback: build on the fly if cache is missing or stale (>90 min old).
    const staleMs = 90 * 60 * 1000;
    const age = digest ? (Date.now() - Date.parse(digest.generatedAt)) : Infinity;
    const isStale = !digest || age > staleMs;

    if (isStale) {
      const ledger = await getLedger();
      const spendCents = await _mtdSpendCents();
      digest = buildRevenueDigest(ledger, spendCents, Date.now());
      digest._builtOnDemand = true;
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify(digest)
    };
  } catch (err) {
    context.log.error && context.log.error('[revenueDigest] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to build revenue digest', details: err && err.message ? err.message : String(err) })
    };
  }
};
