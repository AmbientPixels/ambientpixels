// awarenessDigest — GET /api/awarenessDigest
//
// Read-through for the awareness dashboard (Self-Awareness Phase 5). Returns
// the cached reflection digest from runtimeMemory.reflectionDigest with
// on-demand fallback build. Also surfaces:
//   - reflectionDigestHistory (last 5) for drift-staleness detection
//   - recent consolidated_belief memories for the consolidation section
//   - last reflection timestamp per agent from agentMemories

const storage = require('../_utils/companyStorage');
const { buildReflectionDigest } = require('../companyHeartbeat/reflection-intel');
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

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    return;
  }

  try {
    const runtime = (await storage.getState('runtimeMemory')) || {};
    let digest = null;
    if (runtime && runtime.reflectionDigest && runtime.reflectionDigest.generatedAt) {
      digest = runtime.reflectionDigest;
    }

    // Fallback: build on demand if cache is missing or stale (>90 min old)
    const staleMs = 90 * 60 * 1000;
    const age = digest ? (Date.now() - Date.parse(digest.generatedAt)) : Infinity;
    const isStale = !digest || age > staleMs;

    if (isStale) {
      const decisions = (await storage.getState('agentDecisions')) || [];
      const outcomeSnaps = (await storage.getState('outcomeSnapshots')) || {};
      const actions = (await storage.getState('actions')) || [];
      const memories = (await storage.getState('agentMemories')) || {};
      const tasks = (await storage.getState('tasks')) || [];
      const campaigns = (await storage.getState('campaigns')) || [];
      const experiments = (await storage.getState('agentExperiments')) || [];
      const outcomeDigest = buildOutcomeDigest(outcomeSnaps, actions, campaigns, experiments, Date.now());
      digest = buildReflectionDigest(decisions, outcomeSnaps, actions, memories, tasks, outcomeDigest, Date.now());
      digest._builtOnDemand = true;
    }

    // Attach history for drift-staleness detection
    const history = Array.isArray(runtime.reflectionDigestHistory) ? runtime.reflectionDigestHistory : [];

    // Recent consolidated_belief memories
    const memories = (await storage.getState('agentMemories')) || {};
    const consolidationHistory = [];
    Object.keys(memories).forEach(aid => {
      (memories[aid] || []).forEach(m => {
        if (m && m.type === 'consolidated_belief') {
          consolidationHistory.push({
            agentId: aid,
            id: m.id,
            timestamp: m.timestamp,
            clusterSize: (m.evidence && m.evidence.clusterSize) || null,
            textPreview: String(m.text || '').substring(0, 120)
          });
        }
      });
    });
    consolidationHistory.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        digest: digest,
        history: history,
        consolidationHistory: consolidationHistory.slice(0, 20)
      })
    };
  } catch (err) {
    context.log.error && context.log.error('[awarenessDigest] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to build awareness digest', details: err && err.message ? err.message : String(err) })
    };
  }
};
