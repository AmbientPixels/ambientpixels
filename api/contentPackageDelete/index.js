// contentPackageDelete — POST /api/content-package-delete
// Soft delete (admin) or hard delete (CEO) a content package.
// Payload: { id: string, mode: "soft"|"hard", purgeImages?: boolean }

const storage = require('../_utils/companyStorage');
const imageEngine = require('../_lib/contentEngine/imageEngine');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// CEO secret — same pattern as other CEO-gated endpoints
const CEO_SECRET = process.env.CEO_SECRET || '';

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal'
      }
    };
    return;
  }

  // Auth — same as other company endpoints
  var secret = (req.headers && req.headers['x-company-secret']) || '';
  var clientPrincipal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !clientPrincipal) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    return;
  }

  try {
    var body = req.body || {};
    var packageId = (body.id || '').trim();
    var mode = (body.mode || '').trim().toLowerCase();

    if (!packageId) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'id is required' }) };
      return;
    }
    if (mode !== 'soft' && mode !== 'hard') {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'mode must be "soft" or "hard"' }) };
      return;
    }

    // Determine actor from principal or fallback
    var actor = 'admin';
    if (clientPrincipal) {
      try {
        var decoded = JSON.parse(Buffer.from(clientPrincipal, 'base64').toString('utf8'));
        actor = decoded.userDetails || decoded.userId || 'authenticated';
      } catch (e) { /* use default */ }
    }

    if (mode === 'soft') {
      var result = await imageEngine.softDeletePackage(packageId, actor);
      context.log('[contentPackageDelete] Soft deleted:', packageId, 'by', actor);
      context.res = {
        status: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, packageId: packageId, mode: 'soft' })
      };
      return;
    }

    // Hard delete — CEO-gated
    // Require either CEO_SECRET match or tier-1 principal
    var isCeo = false;
    if (CEO_SECRET && secret === CEO_SECRET) isCeo = true;
    if (clientPrincipal) {
      try {
        var decoded2 = JSON.parse(Buffer.from(clientPrincipal, 'base64').toString('utf8'));
        // Check for CEO role in claims
        var roles = decoded2.userRoles || [];
        if (roles.indexOf('ceo') !== -1 || roles.indexOf('admin') !== -1) isCeo = true;
      } catch (e) { /* not CEO */ }
    }
    // Fallback: if company secret is valid, allow hard delete (site admin)
    if (storage.validateSecret(secret)) isCeo = true;

    if (!isCeo) {
      context.res = {
        status: 403,
        headers: CORS,
        body: JSON.stringify({ error: 'Hard delete requires CEO/admin authorization' })
      };
      return;
    }

    var purgeImages = body.purgeImages === true;
    var hardResult = await imageEngine.hardDeletePackage(packageId, actor, {
      purgeImages: purgeImages,
      purgeIndex: true
    });

    context.log('[contentPackageDelete] Hard deleted:', packageId, 'by', actor,
      'purgeImages:', purgeImages, 'blobsDeleted:', hardResult.blobsDeleted);

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        packageId: packageId,
        mode: 'hard',
        purgeImages: purgeImages,
        blobsDeleted: hardResult.blobsDeleted
      })
    };

  } catch (err) {
    var statusCode = 500;
    if (err && err.code === 'NOT_FOUND') statusCode = 404;
    context.log.error('[contentPackageDelete] Error:', err);
    context.res = {
      status: statusCode,
      headers: CORS,
      body: JSON.stringify({ error: (err && err.message) || 'Internal error' })
    };
  }
};
