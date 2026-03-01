// company-store-migrate — POST: Bulk import local state to server store
const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 401, headers: corsHeaders, body: { error: 'Unauthorized' } };
    return;
  }

  const body = req.body || {};
  if (!body.payload || typeof body.payload !== 'object') {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { ok: false, error: 'Missing payload object' }
    };
    return;
  }

  try {
    const summary = await storage.migrateStore(body.payload);
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        ok: true,
        source: body.source || 'unknown',
        summary,
        serverTime: new Date().toISOString()
      }
    };
  } catch (err) {
    context.log.error('[company-store-migrate] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { ok: false, error: 'Migration failed', details: err.message }
    };
  }
};
