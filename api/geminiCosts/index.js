// geminiCosts — GET API for Gemini API usage and cost data
// GET /api/geminiCosts           → 30-day summary
// GET /api/geminiCosts?days=7    → N-day summary

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
    // Require auth
    const secret = req.headers['x-company-secret'] || '';
    if (!storage.validateSecret(secret)) {
      context.res = { status: 401, headers: corsHeaders, body: { error: 'unauthorized' } };
      return;
    }

    const days = parseInt(req.query && req.query.days) || 30;
    const summary = await storage.getGeminiCostSummary(Math.min(days, 90));

    // Round costs in byDay/byCaller/byAgent for cleaner output
    Object.keys(summary.byDay).forEach(d => { summary.byDay[d].cost = Math.round(summary.byDay[d].cost * 10000) / 10000; });
    Object.keys(summary.byCaller).forEach(c => { summary.byCaller[c].cost = Math.round(summary.byCaller[c].cost * 10000) / 10000; });
    Object.keys(summary.byAgent).forEach(a => { summary.byAgent[a].cost = Math.round(summary.byAgent[a].cost * 10000) / 10000; });

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: summary
    };

  } catch (err) {
    context.log.error('[GeminiCosts] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'internal_error', message: err.message }
    };
  }
};
