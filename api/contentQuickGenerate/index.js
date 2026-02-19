// contentQuickGenerate — POST /api/content-quick-generate
// Combined brief + generate in one call. Auto-creates brief behind the scenes,
// generates all requested images, submits to CEO Approval Queue.
// Accepts: topic, goal, preset, outputs[], audience?, tone?, variations?

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
    var topic = (body.topic || '').trim();
    var goal = (body.goal || '').trim();
    var preset = (body.preset || 'ap-neon-glass').trim();
    var outputs = body.outputs || ['x_image'];
    var audience = (body.audience || '').trim() || undefined;
    var tone = (body.tone || '').trim() || undefined;
    var variations = Math.min(Math.max(parseInt(body.variations) || 1, 1), 4);
    var skipApproval = body.skipApproval === true;

    // Validate
    if (!topic || topic.length < 3) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'topic required (min 3 chars)' }) };
      return;
    }
    if (!goal || goal.length < 3) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'goal required (min 3 chars)' }) };
      return;
    }
    if (!imageEngine.PRESETS[preset]) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid preset: ' + preset }) };
      return;
    }
    if (!Array.isArray(outputs) || outputs.length === 0) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'outputs[] required' }) };
      return;
    }
    // Filter to valid outputs
    outputs = outputs.filter(function (o) { return !!imageEngine.PURPOSES[o]; });
    if (outputs.length === 0) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'No valid output types. Valid: ' + Object.keys(imageEngine.PURPOSES).join(', ') }) };
      return;
    }

    // ── Step 1: Auto-create brief ──
    var briefId = 'brief_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    var brief = {
      id: briefId,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      topic: topic,
      goal: goal,
      audience: audience || null,
      tone: tone || null,
      preset: preset,
      outputs: outputs,
      variations: variations,
      status: 'generating',
      quickGenerate: true
    };
    await imageEngine.saveBrief(brief);
    context.log('[quickGenerate] Brief created:', briefId);

    // ── Step 2: Generate images ──
    var packageId = 'pkg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    var allOutputs = {};
    var thumbUrls = [];
    var successCount = 0;
    var failedCount = 0;

    // For each variation × output combination
    for (var v = 0; v < variations; v++) {
      for (var i = 0; i < outputs.length; i++) {
        var outputType = outputs[i];
        var outputKey = variations > 1 ? outputType + '_v' + (v + 1) : outputType;
        var variationNum = v + 1;
        // Build prompt with variation twist
        var prompt = imageEngine.buildPrompt({
          topic: topic, goal: goal, preset: preset,
          outputType: outputType, audience: audience, tone: tone,
          variation: variationNum
        });
        try {
          context.log('[quickGenerate] Generating', outputKey, '...');
          var result = await imageEngine.generateImage({
            topic: topic, goal: goal, preset: preset,
            outputType: outputType, audience: audience, tone: tone,
            variation: variationNum,
            jobId: packageId + '_' + outputKey
          });

          allOutputs[outputKey] = {
            status: 'success',
            outputType: outputType,
            variation: variationNum,
            size: result.size,
            imageUrl: result.imageUrl,
            thumbUrl: result.thumbUrl,
            metaUrl: result.metaUrl,
            model: result.model,
            bytes: result.bytes,
            promptUsed: prompt
          };
          thumbUrls.push(result.thumbUrl);
          successCount++;
          context.log('[quickGenerate]', outputKey, 'done:', result.size, result.bytes, 'bytes');
        } catch (genErr) {
          context.log.error('[quickGenerate] Failed:', outputKey, genErr.message);
          allOutputs[outputKey] = {
            status: 'failed',
            outputType: outputType,
            variation: variationNum,
            error: genErr.message,
            promptUsed: prompt
          };
          failedCount++;
        }
      }
    }

    // Total failure — nothing succeeded
    if (successCount === 0) {
      brief.status = 'failed';
      brief.updatedAt = new Date().toISOString();
      await imageEngine.saveBrief(brief);
      var failedDetails = [];
      Object.keys(allOutputs).forEach(function (k) { if (allOutputs[k].status === 'failed') failedDetails.push({ outputKey: k, error: allOutputs[k].error }); });
      context.res = {
        status: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'All image generations failed', briefId: briefId, packageId: packageId, details: failedDetails })
      };
      return;
    }

    // ── Step 3: Save package ──
    var promptSummary = 'Topic: ' + topic + ' — ' + goal + ' (' + preset + ')';
    if (promptSummary.length > 140) promptSummary = promptSummary.substring(0, 137) + '...';

    var overallStatus = failedCount === 0
      ? (skipApproval ? 'approved' : 'pending_approval')
      : 'partial_success';

    var pkg = {
      id: packageId,
      briefId: briefId,
      createdAt: new Date().toISOString(),
      generatedBy: 'user',
      preset: preset,
      variations: variations,
      outputs: allOutputs,
      promptSummary: promptSummary,
      status: overallStatus,
      successCount: successCount,
      failedCount: failedCount,
      model: imageEngine.GEMINI_IMAGE_MODEL,
      provider: imageEngine.GEMINI_IMAGE_PROVIDER
    };

    var packageUrl = await imageEngine.savePackage(pkg);
    context.log('[quickGenerate] Package saved:', packageId, 'success:', successCount, 'failed:', failedCount);

    // Update brief
    brief.status = skipApproval ? 'approved' : 'pending_approval';
    brief.packageId = packageId;
    brief.updatedAt = new Date().toISOString();
    await imageEngine.saveBrief(brief);

    // ── Step 4: Approval Queue ──
    var approvalItemId = null;
    if (!skipApproval) {
      var successImageUrls = [];
      Object.keys(allOutputs).forEach(function (k) {
        if (allOutputs[k].status === 'success' && allOutputs[k].imageUrl) successImageUrls.push(allOutputs[k].imageUrl);
      });

      var approvalItem = {
        id: 'aq-' + packageId,
        kind: 'content.package',
        type: 'content.package',
        title: 'Content Package — ' + topic,
        subtitle: successCount + ' image' + (successCount !== 1 ? 's' : '') + (failedCount > 0 ? ', ' + failedCount + ' failed' : '') + ' · ' + preset,
        status: 'pending',
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        briefId: briefId,
        packageId: packageId,
        preset: preset,
        goal: goal,
        successCount: successCount,
        failedCount: failedCount,
        preview: {
          thumbs: thumbUrls.slice(0, 4),
          preset: preset,
          goal: goal,
          outputTypes: outputs,
          successCount: successCount,
          failedCount: failedCount
        },
        links: {
          packageUrl: packageUrl,
          packageViewUrl: '/modules/company/content-engine.html?pkg=' + packageId,
          imageUrls: successImageUrls
        }
      };

      var queue = (await storage.getState('approvalQueue')) || [];
      queue.push(approvalItem);
      if (queue.length > 200) queue = queue.slice(-200);
      await storage.setState('approvalQueue', queue);
      approvalItemId = approvalItem.id;
      context.log('[quickGenerate] Approval queue item added:', approvalItemId);
    }

    // ── Step 5: Append to gallery index ──
    try {
      await imageEngine.appendToIndex({
        packageId: packageId,
        briefId: briefId,
        preset: preset,
        topic: topic,
        createdAt: pkg.createdAt,
        status: overallStatus,
        successCount: successCount,
        failedCount: failedCount,
        thumbs: thumbUrls.slice(0, 4),
        outputTypes: outputs,
        variations: variations
      });
      context.log('[quickGenerate] Gallery index updated');
    } catch (idxErr) {
      context.log.warn('[quickGenerate] Gallery index append failed (non-fatal):', idxErr.message);
    }

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        briefId: briefId,
        packageId: packageId,
        packageUrl: packageUrl,
        outputs: allOutputs,
        successCount: successCount,
        failedCount: failedCount,
        approvalItemId: approvalItemId,
        skippedApproval: skipApproval,
        model: imageEngine.GEMINI_IMAGE_MODEL,
        provider: imageEngine.GEMINI_IMAGE_PROVIDER
      })
    };

  } catch (err) {
    context.log.error('[quickGenerate] Error:', err);
    context.res = {
      status: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Internal error: ' + (err.message || String(err)) })
    };
  }
};
