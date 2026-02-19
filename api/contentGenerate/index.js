// contentGenerate — POST /api/content-generate
// Generates a content package from a brief: calls Image Engine for each output,
// writes package JSON to Blob, adds item to CEO Approval Queue.
// Auth: x-company-secret or Azure SWA principal.

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
    var briefId = body.briefId;

    if (!briefId || typeof briefId !== 'string') {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'briefId is required' }) };
      return;
    }

    // Load brief from blob
    var brief = await imageEngine.loadBrief(briefId);
    if (!brief) {
      context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: 'Brief not found: ' + briefId }) };
      return;
    }

    // Prevent re-generation of already approved packages
    if (brief.status === 'approved') {
      context.res = { status: 409, headers: CORS, body: JSON.stringify({ error: 'Brief already approved. Create a new brief to generate again.' }) };
      return;
    }

    // Account context abstraction
    var accountId = (body.accountId || 'ambientpixels-internal').trim();
    var accountType = (body.accountType || 'internal').trim();

    // Soft usage limit check
    var limitCheck = await imageEngine.checkUsageLimits(accountId);
    if (!limitCheck.allowed) {
      context.res = {
        status: 429,
        headers: CORS,
        body: JSON.stringify({ ok: false, error: 'USAGE_LIMIT_EXCEEDED', remaining: limitCheck.remaining || 0 })
      };
      return;
    }

    var generationStartMs = Date.now();
    var packageId = 'pkg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    var outputs = {};
    var errors = [];
    var thumbUrls = [];

    context.log('[contentGenerate] Generating package', packageId, 'for brief', briefId, 'outputs:', brief.outputs);

    // Generate each requested output
    for (var i = 0; i < brief.outputs.length; i++) {
      var outputType = brief.outputs[i];
      try {
        context.log('[contentGenerate] Generating', outputType, '...');
        var result = await imageEngine.generateImage({
          topic: brief.topic,
          goal: brief.goal,
          preset: brief.preset,
          outputType: outputType,
          audience: brief.audience || undefined,
          tone: brief.tone || undefined,
          jobId: packageId + '_' + outputType
        });

        var purpose = imageEngine.PURPOSES[outputType];
        outputs[outputType] = {
          size: result.size,
          imageUrl: result.imageUrl,
          thumbUrl: result.thumbUrl,
          metaUrl: result.metaUrl,
          model: result.model,
          bytes: result.bytes
        };
        thumbUrls.push(result.thumbUrl);
        context.log('[contentGenerate]', outputType, 'generated:', result.size, result.bytes, 'bytes');
      } catch (genErr) {
        context.log.error('[contentGenerate] Failed to generate', outputType, ':', genErr.message);
        errors.push({ outputType: outputType, error: genErr.message });
      }
    }

    // Must have at least one successful output
    if (Object.keys(outputs).length === 0) {
      context.res = {
        status: 502,
        headers: CORS,
        body: JSON.stringify({
          error: 'All image generations failed',
          details: errors
        })
      };
      return;
    }

    // Build prompt summary (truncated for readability)
    var promptSummary = brief.topic + ' — ' + brief.goal + ' (' + brief.preset + ')';
    if (promptSummary.length > 120) promptSummary = promptSummary.substring(0, 117) + '...';

    var durationMs = Date.now() - generationStartMs;
    var successCount = Object.keys(outputs).length;

    // Build package JSON
    var pkg = {
      id: packageId,
      briefId: briefId,
      createdAt: new Date().toISOString(),
      generatedBy: 'Forge',
      accountId: accountId,
      accountType: accountType,
      engineVersion: imageEngine.ENGINE_VERSION,
      preset: brief.preset,
      presetVersion: imageEngine.getPresetVersion(brief.preset),
      outputs: outputs,
      promptSummary: promptSummary,
      status: 'pending_approval',
      successCount: successCount,
      failedCount: errors.length,
      durationMs: durationMs,
      estimatedCost: imageEngine.estimateCost(successCount),
      model: imageEngine.GEMINI_IMAGE_MODEL,
      provider: imageEngine.GEMINI_IMAGE_PROVIDER,
      errors: errors.length > 0 ? errors : undefined
    };

    // Save package to blob
    var packageUrl = await imageEngine.savePackage(pkg);
    context.log('[contentGenerate] Package saved:', packageId);

    // Update brief status
    brief.status = 'pending_approval';
    brief.packageId = packageId;
    brief.updatedAt = new Date().toISOString();
    await imageEngine.saveBrief(brief);

    // ── Add to CEO Approval Queue ──
    var approvalItem = {
      id: 'aq-' + packageId,
      kind: 'content.package',
      type: 'content.package',
      title: 'Content Package — ' + brief.topic,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: brief.createdBy || 'Forge',
      briefId: briefId,
      packageId: packageId,
      preset: brief.preset,
      goal: brief.goal,
      preview: {
        thumbs: thumbUrls,
        preset: brief.preset,
        goal: brief.goal,
        outputTypes: Object.keys(outputs)
      },
      links: {
        packageUrl: packageUrl,
        imageUrls: Object.keys(outputs).map(function (k) { return outputs[k].imageUrl; })
      }
    };

    // Append to existing approval queue
    var queue = (await storage.getState('approvalQueue')) || [];
    queue.push(approvalItem);
    // Cap at 200 items
    if (queue.length > 200) queue = queue.slice(-200);
    await storage.setState('approvalQueue', queue);
    context.log('[contentGenerate] Approval queue item added:', approvalItem.id);

    // Write usage record
    try {
      await imageEngine.writeUsageRecord({
        accountId: accountId,
        accountType: accountType,
        packageId: packageId,
        timestamp: pkg.createdAt,
        engineVersion: imageEngine.ENGINE_VERSION,
        preset: brief.preset,
        presetVersion: imageEngine.getPresetVersion(brief.preset),
        formatsRequested: brief.outputs,
        variations: 1,
        imagesGenerated: successCount,
        model: imageEngine.GEMINI_IMAGE_MODEL,
        durationMs: durationMs,
        estimatedCost: imageEngine.estimateCost(successCount),
        status: errors.length > 0 ? 'partial' : 'success'
      });
      context.log('[contentGenerate] Usage record written');
    } catch (usageErr) {
      context.log.warn('[contentGenerate] Usage record write failed (non-fatal):', usageErr.message);
    }

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        packageId: packageId,
        packageUrl: packageUrl,
        briefId: briefId,
        outputs: outputs,
        approvalItemId: approvalItem.id,
        errors: errors.length > 0 ? errors : undefined
      })
    };

  } catch (err) {
    context.log.error('[contentGenerate] Error:', err);
    context.res = {
      status: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Internal error: ' + (err.message || String(err)) })
    };
  }
};
