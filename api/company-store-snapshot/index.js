// company-store-snapshot — GET: Read full or partial company store state
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

  // Auth check
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 401, headers: corsHeaders, body: { error: 'Unauthorized' } };
    return;
  }

  try {
    const since = (req.query && req.query.since) || null;
    const limit = (req.query && req.query.limit) ? parseInt(req.query.limit, 10) : 500;

    const snapshot = await storage.getStoreSnapshot({ since, limit: Math.min(limit, 5000) });

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        ok: true,
        snapshot,
        serverTime: new Date().toISOString()
      }
    };
  } catch (err) {
    context.log.error('[company-store-snapshot] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { ok: false, error: 'Failed to read snapshot', details: err.message }
    };
  }
};
