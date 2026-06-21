// agentRewards — GET /api/agentRewards
//
// Read-through for the agent XP/reward ledger (Stages 2-4 display surfaces).
// `agentRewards` is written by the rewards engine via companyStorage and is NOT a
// company-state VALID_KEY (same pattern as pingLog / heartbeatProgress), so it must
// be read through this dedicated endpoint rather than /api/company-state.
//
// Pattern mirrors allocationDigest / worldState. Returns the ledger directly, or a
// safe empty default when the engine hasn't run yet.

const storage = require('../_utils/companyStorage');

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
    const rewards = (await storage.getState('agentRewards')) || { perAgent: {}, company: { counters: {}, achievements: [] } };
    context.res = { status: 200, headers: corsHeaders, body: JSON.stringify(rewards) };
  } catch (err) {
    context.log.error && context.log.error('[agentRewards] error:', err && err.message ? err.message : err);
    context.res = { status: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to read agent rewards', details: err && err.message ? err.message : String(err) }) };
  }
};
