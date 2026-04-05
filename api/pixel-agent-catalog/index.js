// pixel-agent-catalog — Returns agent catalog with usage stats
// GET /api/pixel-agent-catalog

const storage = require('../_utils/companyStorage');
const path = require('path');
const fs = require('fs');

let agentRegistry = null;
function loadAgentRegistry() {
  if (agentRegistry) return agentRegistry;
  const filePath = path.join(__dirname, '..', '_data', 'pixel-agents.json');
  agentRegistry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return agentRegistry;
}

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const agents = loadAgentRegistry().filter(a => a.active);
    let stats = {};
    let runs = [];

    try {
      const [s, r] = await Promise.all([
        storage.getState('pixelAgentStats').catch(() => ({})),
        storage.getState('pixelAgentRuns').catch(() => [])
      ]);
      stats = s || {};
      runs = r || [];
    } catch { stats = {}; }

    // Compute 7-day run counts per agent
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentByAgent = {};
    for (const run of runs) {
      if (new Date(run.timestamp).getTime() > sevenDaysAgo) {
        recentByAgent[run.agentId] = (recentByAgent[run.agentId] || 0) + 1;
      }
    }

    // Build category list from active agents
    const categories = [...new Set(agents.map(a => a.category))].sort();

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          tagline: a.tagline,
          category: a.category,
          tier: a.tier,
          icon: a.icon,
          capabilities: a.capabilities,
          featured: a.featured,
          order: a.order,
          runs: stats[a.id] || 0
        })),
        categories,
        stats,
        recentStats: recentByAgent,
        totalRuns: stats._totalRuns || 0
      }
    };

  } catch (err) {
    context.log.error('[PixelAgentCatalog] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Failed to load agent catalog.' }
    };
  }
};
