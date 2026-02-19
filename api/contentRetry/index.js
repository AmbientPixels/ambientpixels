// contentRetry — POST /api/content-retry
// Retries only failed variants from an existing package.
// Accepts: packageId. Loads package, finds outputs with status:'failed', re-generates them.

const crypto = require('crypto');
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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    var body = req.body || {};
    var packageId = (body.packageId || '').trim();

    if (!packageId) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'packageId is required' }) };
      return;
    }

    // Load existing package
    var pkg = await imageEngine.loadPackage(packageId);
    if (!pkg) {
      context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: 'Package not found: ' + packageId }) };
      return;
    }

    // Load brief for prompt data
    var brief = await imageEngine.loadBrief(pkg.briefId);
    if (!brief) {
      context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: 'Brief not found: ' + pkg.briefId }) };
      return;
    }

    // Find failed outputs
    var failedKeys = [];
    Object.keys(pkg.outputs).forEach(function (key) {
      if (pkg.outputs[key].status === 'failed') failedKeys.push(key);
    });

    if (failedKeys.length === 0) {
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true, message: 'No failed variants to retry', packageId: packageId, retriedCount: 0 }) };
      return;
    }

    context.log('[contentRetry] Retrying', failedKeys.length, 'failed variants for package', packageId);

    var retriedCount = 0;
    var stillFailed = 0;
    var newThumbs = [];

    for (var i = 0; i < failedKeys.length; i++) {
      var key = failedKeys[i];
      var entry = pkg.outputs[key];

      // Mark as retrying
      entry.status = 'retrying';
      entry.retryAt = new Date().toISOString();

      // Build prompt with same variation twist
      var prompt = imageEngine.buildPrompt({
        topic: brief.topic,
        goal: brief.goal,
        preset: brief.preset,
        outputType: entry.outputType,
        audience: brief.audience || undefined,
        tone: brief.tone || undefined,
        variation: entry.variation || 1
      });

      try {
        context.log('[contentRetry] Retrying', key, '...');
        var result = await imageEngine.generateImage({
          topic: brief.topic,
          goal: brief.goal,
          preset: brief.preset,
          outputType: entry.outputType,
          audience: brief.audience || undefined,
          tone: brief.tone || undefined,
          variation: entry.variation || 1,
          jobId: packageId + '_' + key + '_retry'
        });

        // Update the output entry in-place
        pkg.outputs[key] = {
          status: 'success',
          outputType: entry.outputType,
          variation: entry.variation || 1,
          size: result.size,
          imageUrl: result.imageUrl,
          thumbUrl: result.thumbUrl,
          metaUrl: result.metaUrl,
          model: result.model,
          bytes: result.bytes,
          promptUsed: prompt,
          retriedAt: new Date().toISOString()
        };
        newThumbs.push(result.thumbUrl);
        retriedCount++;
        context.log('[contentRetry]', key, 'succeeded on retry:', result.size, result.bytes, 'bytes');
      } catch (genErr) {
        context.log.error('[contentRetry]', key, 'failed again:', genErr.message);
        pkg.outputs[key] = {
          status: 'failed',
          outputType: entry.outputType,
          variation: entry.variation || 1,
          error: genErr.message,
          promptUsed: prompt,
          lastRetryAt: new Date().toISOString()
        };
        stillFailed++;
      }
    }

    // Recalculate package counts
    var successCount = 0;
    var failedCount = 0;
    Object.keys(pkg.outputs).forEach(function (k) {
      if (pkg.outputs[k].status === 'success') successCount++;
      else if (pkg.outputs[k].status === 'failed') failedCount++;
    });

    pkg.successCount = successCount;
    pkg.failedCount = failedCount;
    pkg.status = failedCount === 0 ? 'pending_approval' : 'partial_success';
    pkg.lastRetryAt = new Date().toISOString();

    // Save updated package
    var packageUrl = await imageEngine.savePackage(pkg);
    context.log('[contentRetry] Package updated:', packageId, 'success:', successCount, 'failed:', failedCount);

    // Update gallery index entry if all now succeeded
    if (failedCount === 0) {
      try {
        await imageEngine.appendToIndex({
          packageId: packageId,
          briefId: pkg.briefId,
          preset: pkg.preset,
          topic: brief.topic,
          createdAt: pkg.createdAt,
          status: 'pending_approval',
          successCount: successCount,
          failedCount: 0,
          thumbs: newThumbs.slice(0, 4),
          outputTypes: brief.outputs,
          variations: pkg.variations,
          retried: true
        });
      } catch (e) { /* non-fatal */ }
    }

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        packageId: packageId,
        packageUrl: packageUrl,
        retriedCount: retriedCount,
        stillFailed: stillFailed,
        successCount: successCount,
        failedCount: failedCount,
        status: pkg.status,
        outputs: pkg.outputs
      })
    };

  } catch (err) {
    context.log.error('[contentRetry] Error:', err);
    context.res = {
      status: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Internal error: ' + (err.message || String(err)) })
    };
  }
};
