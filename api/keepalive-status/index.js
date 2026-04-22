// keepalive-status — authenticated reader for the dashboard status pill.
// Returns the most recent ping entry; null-safe for the empty-log case.

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

const STATE_KEY = 'pingLog';

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
    const existing = await storage.getState(STATE_KEY);
    const log = Array.isArray(existing) ? existing : [];

    if (log.length === 0) {
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: { lastPingAt: null, lastLatencyMs: null, lastStatus: null, total: 0 }
      };
      return;
    }

    const last = log[log.length - 1];
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        lastPingAt: last.ts || null,
        lastLatencyMs: typeof last.latencyMs === 'number' ? last.latencyMs : null,
        lastStatus: last.status || null,
        total: log.length
      }
    };
  } catch (err) {
    context.log.error('[keepalive-status] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'status read failed', details: err.message }
    };
  }
};
