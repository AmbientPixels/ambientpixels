// heartbeatProgress — live read endpoint for the Heartbeat visualizer page.
//
// Returns:
//   progress — the in-flight (or most recent) heartbeat's per-agent breadcrumb,
//              written incrementally by companyHeartbeat/index.js so the dashboard
//              can watch agents resolve in real time. Includes each agent's outputs.
//   history  — slim last-N heartbeatRuns for the flight-recorder (reasoning + counts;
//              outputs are only captured live, so history cards omit them).
//
// This endpoint is read-only and never mutates state. Auth mirrors keepalive-status.

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

const HISTORY_LIMIT = 12;

function slimRun(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    runId: r.runId || null,
    startedAt: r.startedAt || null,
    finishedAt: r.finishedAt || null,
    durationMs: r.durationMs || 0,
    status: r.status || null,
    executionMode: r.executionMode || r.mode || null,
    agentActions: r.agentActions || null,
    backlogPressure: r.backlogPressure || null,
    skippedAgents: Array.isArray(r.skippedAgents) ? r.skippedAgents : [],
    perAgent: r.perAgent || {}
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 401, headers: corsHeaders, body: { error: 'unauthorized' } };
    return;
  }

  try {
    const progress = (await storage.getState('heartbeatProgress')) || null;
    const runs = (await storage.getState('heartbeatRuns')) || [];
    const history = (Array.isArray(runs) ? runs.slice(-HISTORY_LIMIT).reverse() : [])
      .map(slimRun)
      .filter(Boolean);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { progress: progress, history: history }
    };
  } catch (err) {
    context.log.error('[heartbeatProgress] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'progress read failed', details: err.message }
    };
  }
};
