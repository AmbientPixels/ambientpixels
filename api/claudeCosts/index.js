// claudeCosts — GET API for Claude API usage and cost data
// GET /api/claudeCosts           → 30-day summary
// GET /api/claudeCosts?days=7    → N-day summary

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const days = parseInt(req.query && req.query.days) || 30;
    const summary = await storage.getClaudeCostSummary(Math.min(days, 90));

    // Round costs for cleaner output
    Object.keys(summary.byDay).forEach(d => { summary.byDay[d].cost = Math.round(summary.byDay[d].cost * 10000) / 10000; });
    Object.keys(summary.byCaller).forEach(c => { summary.byCaller[c].cost = Math.round(summary.byCaller[c].cost * 10000) / 10000; });
    Object.keys(summary.byAgent).forEach(a => { summary.byAgent[a].cost = Math.round(summary.byAgent[a].cost * 10000) / 10000; });

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: summary
    };

  } catch (err) {
    context.log.error('[ClaudeCosts] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'internal_error', message: err.message }
    };
  }
};
