// pulseStats — Public READ API for the Live Pulse page.
// GET /api/pulseStats
//
// Aggregates a small set of numbers from cronLog so the public
// /pulse/ page can show live operational signal without exposing
// the full company-state. Response is numeric/timestamp only —
// nothing sensitive.

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60' // 1-min cache — heartbeat is 30min anyway
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const log = (await storage.getState('cronLog')) || [];
    const cycles = Array.isArray(log) ? log : [];

    // Today (UTC) — cronLog timestamps are ISO-UTC.
    const todayPrefix = new Date().toISOString().slice(0, 10);

    let aiCallsToday = 0;
    let todayCycles = 0;
    for (const c of cycles) {
      const ts = c && (c.timestamp || c.at);
      if (!ts || ts.indexOf(todayPrefix) !== 0) continue;
      todayCycles++;
      aiCallsToday += (typeof c.geminiCalls === 'number' ? c.geminiCalls : 0);
    }

    // Last heartbeat — most recent cycle by timestamp.
    let last = null;
    for (const c of cycles) {
      const ts = c && (c.timestamp || c.at);
      if (!ts) continue;
      if (!last || ts > last.ts) last = { ts, cycleId: c.cycleId || null };
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        aiCallsToday: aiCallsToday,
        cyclesToday: todayCycles,
        lastHeartbeatAt: last ? last.ts : null,
        lastHeartbeatCycleId: last ? last.cycleId : null,
        generatedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    context.log('[pulseStats] error', err && err.message);
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        aiCallsToday: 0,
        cyclesToday: 0,
        lastHeartbeatAt: null,
        lastHeartbeatCycleId: null,
        error: 'unavailable'
      })
    };
  }
};
