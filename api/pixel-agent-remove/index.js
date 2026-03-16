// pixel-agent-remove — Remove a community agent from the catalog
// POST /api/pixel-agent-remove { agentId }
// Requires x-company-secret header

const storage = require('../_utils/companyStorage');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  if (req.headers['x-company-secret'] !== 'pixelpusher') {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Unauthorized' } };
    return;
  }

  try {
    const { agentId } = req.body || {};

    if (!agentId) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'agentId required' } };
      return;
    }

    let community = (await storage.getState('pixelAgentCommunity')) || [];
    const agent = community.find(a => a.id === agentId);

    if (!agent) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Agent not found in community catalog: ' + agentId } };
      return;
    }

    const agentName = agent.name;
    community = community.filter(a => a.id !== agentId);
    await storage.setState('pixelAgentCommunity', community);

    context.log('[AgentRemove] Removed:', agentName, '(' + agentId + ')');

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { success: true, agentId: agentId, agentName: agentName, remaining: community.length }
    };

  } catch (err) {
    context.log.error('[AgentRemove] Error:', err.message);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Remove failed: ' + err.message } };
  }
};
