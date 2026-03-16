// pixel-agent-community — List approved community agents
// GET /api/pixel-agent-community

const storage = require('../_utils/companyStorage');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    const agents = (await storage.getState('pixelAgentCommunity')) || [];

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        agents: agents.filter(a => a.active),
        total: agents.length
      }
    };
  } catch (err) {
    context.log.error('[AgentCommunity] Error:', err.message);
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { agents: [], total: 0 }
    };
  }
};
