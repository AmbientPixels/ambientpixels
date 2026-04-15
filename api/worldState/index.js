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
      // socialAccountStats + outcomeSnapshots live as top-level state keys
      // (not inside runtimeMemory) — fetch directly. Specialist digests
      // (financeDigest, forgeOpsDigest, outcomeDigest, etc.) live in
      // runtimeMemory and we use cached if present.
      const [
        campaigns, objectives, tasks, approvalQueue, governanceLog,
        agentExperiments, executionMode,
        socialAccountStats, outcomeSnapshots
      ] = await Promise.all([
        storage.getState('campaigns').then(v => v || []),
        storage.getState('objectives').then(v => v || []),
        storage.getState('tasks').then(v => v || []),
        storage.getState('approvalQueue').then(v => v || []),
        storage.getState('governanceLog').then(v => v || []),
        storage.getState('agentExperiments').then(v => v || []),
        storage.getState('execution_mode').then(v => v || 'supervised_autonomous'),
        storage.getState('socialAccountStats').then(v => v || null),
        storage.getState('outcomeSnapshots').then(v => v || {})
      ]);
      let productFacts = null;
      try { productFacts = require('../_data/product-facts.json'); } catch (_e) { /* missing */ }

      // Minimal outcomeDigest fallback — just enough for worldState's
      // coverage + LinkedIn-pending fields when runtime cache is empty.
      let fallbackOutcomeDigest = runtime.outcomeDigest || null;
      if (!fallbackOutcomeDigest && outcomeSnapshots && typeof outcomeSnapshots === 'object') {
        const snaps = Object.values(outcomeSnapshots).filter(Boolean);
        const complete = snaps.filter(s => s && s.complete === true).length;
        const pending = snaps.filter(s => s && s.complete !== true);
        const linkedinPending = pending.filter(s => (s.platform || '').toLowerCase() === 'linkedin').length;
        fallbackOutcomeDigest = {
          totals: { snapshots: snaps.length, complete: complete, pending: pending.length, linkedinPendingCount: linkedinPending },
          perExperiment: []
        };
      }

      snapshot = buildWorldState({
        financeDigest: runtime.financeDigest || null,
        forgeOpsDigest: runtime.forgeOpsDigest || null,
        outcomeDigest: fallbackOutcomeDigest,
        strategicDigest: runtime.strategicDigest || null,
        socialAccountStats: socialAccountStats,
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
