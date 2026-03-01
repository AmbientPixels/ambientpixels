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

function generateDemoGeminiData(days) {
  const agents = ['nova', 'echo', 'scribe', 'cipher', 'scout', 'forge', 'pixel', 'quill'];
  const callers = ['companyHeartbeat', 'agentChat', 'contentGenerate', 'standupRun'];
  const byDay = {};
  const byCaller = {};
  const byAgent = {};
  var totalInput = 0, totalOutput = 0, totalCost = 0, totalCalls = 0;

  for (var i = days; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    var dateStr = d.toISOString().substring(0, 10);
    var callsToday = 15 + Math.floor(Math.random() * 25);
    var promptToday = callsToday * (4000 + Math.floor(Math.random() * 6000));
    var compToday = callsToday * (1500 + Math.floor(Math.random() * 3000));
    var costToday = (promptToday * 0.10 + compToday * 0.40) / 1000000;
    byDay[dateStr] = { calls: callsToday, promptTokens: promptToday, completionTokens: compToday, cost: Math.round(costToday * 10000) / 10000 };
    totalInput += promptToday; totalOutput += compToday; totalCost += costToday; totalCalls += callsToday;
  }

  callers.forEach(function (c) {
    var share = c === 'companyHeartbeat' ? 0.55 : c === 'agentChat' ? 0.2 : c === 'contentGenerate' ? 0.15 : 0.1;
    byCaller[c] = { calls: Math.round(totalCalls * share), cost: Math.round(totalCost * share * 10000) / 10000 };
  });
  agents.forEach(function (a) {
    var w = a === 'nova' ? 0.25 : a === 'echo' ? 0.18 : a === 'scribe' ? 0.18 : a === 'scout' ? 0.12 : a === 'cipher' ? 0.08 : a === 'forge' ? 0.07 : a === 'pixel' ? 0.06 : 0.06;
    byAgent[a] = { calls: Math.round(totalCalls * w), cost: Math.round(totalCost * w * 10000) / 10000 };
  });

  return {
    period: days + 'd', totalCalls: totalCalls,
    totalTokens: totalInput + totalOutput, totalPromptTokens: totalInput, totalCompletionTokens: totalOutput,
    totalCost: Math.round(totalCost * 100) / 100,
    byDay: byDay, byCaller: byCaller, byAgent: byAgent
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const days = parseInt(req.query && req.query.days) || 30;

    // Demo mode: return generated data (no real geminiUsage blob in demo)
    if (process.env.DEMO_MODE === 'true') {
      context.res = { status: 200, headers: corsHeaders, body: generateDemoGeminiData(Math.min(days, 90)) };
      return;
    }

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
