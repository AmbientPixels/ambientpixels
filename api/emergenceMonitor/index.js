// emergenceMonitor — GET /api/emergenceMonitor
//
// Read-through for the Emergence Monitoring dashboard (System 15). Returns
// the cached snapshot from emergenceDigest state key with on-demand fallback
// (>26h stale or missing). Fallback loses streak continuity — flagged with
// _builtOnDemand: true so dashboard can show "live snapshot" badge.

const storage = require('../_utils/companyStorage');
const { buildEmergenceDigest } = require('../companyHeartbeat/emergence-intel');
const { EMERGENCE_DIGEST_FRESHNESS_MS } = require('../companyHeartbeat/constants');

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
    const persisted = await storage.getState('emergenceDigest');
    let snapshot = null;
    if (persisted && persisted.generatedAt) {
      const age = Date.now() - Date.parse(persisted.generatedAt);
      if (age < EMERGENCE_DIGEST_FRESHNESS_MS) {
        snapshot = persisted;
      }
    }

    if (!snapshot) {
      // Fallback: build on-demand. Loses streak continuity — flagged for dashboard.
      const [approvalQueue, governanceLog, capitalAllocation, agentRegistry, heartbeatRuns] = await Promise.all([
        storage.getState('approvalQueue').then(v => v || []),
        storage.getState('governanceLog').then(v => v || []),
        storage.getState('capitalAllocation').then(v => v || {}),
        storage.getState('agentRegistry').then(v => v || { agents: [] }),
        storage.getState('heartbeatRuns').then(v => v || [])
      ]);
      snapshot = buildEmergenceDigest({
        approvalQueue: approvalQueue,
        governanceLog: governanceLog,
        capitalAllocation: capitalAllocation,
        agentRegistry: agentRegistry,
        heartbeatRuns: heartbeatRuns,
        prevDigest: null
      }, Date.now());
      snapshot._builtOnDemand = true;
    }

    context.res = { status: 200, headers: corsHeaders, body: JSON.stringify(snapshot) };
  } catch (err) {
    context.log.error && context.log.error('[emergenceMonitor] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed', details: err && err.message ? err.message : String(err) })
    };
  }
};
