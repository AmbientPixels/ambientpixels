// company-store-upsert-settings — POST: Patch settings with allow-list validation
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
  if (!body.settingsPatch || typeof body.settingsPatch !== 'object') {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { ok: false, error: 'Missing settingsPatch object in body' }
    };
    return;
  }

  try {
    const result = await storage.patchStoreSettings(body.settingsPatch);
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { ok: true, result, serverTime: new Date().toISOString() }
    };
  } catch (err) {
    context.log.error('[company-store-upsert-settings] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { ok: false, error: 'Settings update failed', details: err.message }
    };
  }
};
