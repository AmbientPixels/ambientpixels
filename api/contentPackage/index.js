// contentPackage — GET /api/content-package?id=<packageId>
// Returns a single package JSON from blob storage.

const storage = require('../_utils/companyStorage');
const imageEngine = require('../_lib/contentEngine/imageEngine');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal'
      }
    };
    return;
  }

  // Auth
  var secret = (req.headers && req.headers['x-company-secret']) || '';
  var clientPrincipal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !clientPrincipal) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    return;
  }

  try {
    var packageId = ((req.query && req.query.id) || '').trim();
    if (!packageId) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'id query param required' }) };
      return;
    }

    var pkg = await imageEngine.loadPackage(packageId);
    if (!pkg) {
      context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: 'Package not found: ' + packageId }) };
      return;
    }

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, package: pkg })
    };

  } catch (err) {
    context.log.error('[contentPackage] Error:', err);
    context.res = {
      status: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Internal error: ' + (err.message || String(err)) })
    };
  }
};
