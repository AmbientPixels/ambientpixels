// worldState — GET /api/worldState
//
// Read-through for the Shared World Model dashboard. Returns the cached
// snapshot from runtimeMemory.worldState with on-demand fallback build if
// the cache is missing or stale (>90 min old).
//
// Pattern mirrors outcomeDigest and awarenessDigest endpoints.

const storage = require('../_utils/companyStorage');
const { buildWorldState } = require('../companyHeartbeat/world-state-intel');

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
    if (runtime && runtime.worldState && runtime.worldState.generatedAt) {
      snapshot = runtime.worldState;
    }

    // Fallback: on-demand rebuild if cache is missing or stale (>90 min)
    const staleMs = 90 * 60 * 1000;
    const age = snapshot ? (Date.now() - Date.parse(snapshot.generatedAt)) : Infinity;
    const isStale = !snapshot || age > staleMs;

    if (isStale) {
      const [
        campaigns, objectives, tasks, approvalQueue, governanceLog,
        agentExperiments, executionMode
      ] = await Promise.all([
        storage.getState('campaigns').then(v => v || []),
        storage.getState('objectives').then(v => v || []),
        storage.getState('tasks').then(v => v || []),
        storage.getState('approvalQueue').then(v => v || []),
        storage.getState('governanceLog').then(v => v || []),
        storage.getState('agentExperiments').then(v => v || []),
        storage.getState('execution_mode').then(v => v || 'supervised_autonomous')
      ]);
      let productFacts = null;
      try { productFacts = require('../_data/product-facts.json'); } catch (_e) { /* missing */ }

      // Specialist digests live in runtimeMemory; use cached if present
      snapshot = buildWorldState({
        financeDigest: runtime.financeDigest || null,
        forgeOpsDigest: runtime.forgeOpsDigest || null,
        outcomeDigest: runtime.outcomeDigest || null,
        strategicDigest: runtime.strategicDigest || null,
        socialAccountStats: runtime.socialAccountStats || null,
        contentDigest: runtime.contentDigest || null,
        campaigns: campaigns,
        objectives: objectives,
        tasks: tasks,
        approvalQueue: approvalQueue,
        governanceLog: governanceLog,
        agentExperiments: agentExperiments,
        executionMode: executionMode,
        productFacts: productFacts
      }, Date.now());
      snapshot._builtOnDemand = true;
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify(snapshot)
    };
  } catch (err) {
    context.log.error && context.log.error('[worldState] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to build world state', details: err && err.message ? err.message : String(err) })
    };
  }
};
