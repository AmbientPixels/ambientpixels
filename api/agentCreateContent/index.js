// agentCreateContent — POST /api/agent-create-content
// Agent → Creative Bridge: allows internal agents to request content generation.
// Requires x-company-secret + x-agent-name headers.
// Agent CANNOT bypass approval queue, override usage limits, or skip telemetry.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const storage = require('../_utils/companyStorage');
const imageEngine = require('../_lib/contentEngine/imageEngine');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// Load valid agent IDs + roles from company-agents.json
var AGENT_MAP = {}; // { id: { role } }
try {
  var _raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/company-agents.json'), 'utf8'));
  (_raw.agents || []).forEach(function (a) {
    if (a.id) AGENT_MAP[a.id.toLowerCase()] = { role: a.role || 'unknown' };
  });
} catch (_e) { /* fallback: empty map means all agents rejected */ }

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-agent-name'
      }
    };
    return;
  }

  // Auth: require x-company-secret
  var secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: 'Unauthorized: invalid company secret' }) };
    return;
  }

  // Auth: require x-agent-name, normalize, validate against canonical agent.id
  var agentName = ((req.headers && req.headers['x-agent-name']) || '').toLowerCase().trim();
  if (!agentName) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ ok: false, error: 'INVALID_AGENT' }) };
    return;
  }
  var agentEntry = AGENT_MAP[agentName];
  if (!agentEntry) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ ok: false, error: 'INVALID_AGENT' }) };
    return;
  }
  var agentRole = agentEntry.role;

  try {
    var body = req.body || {};

    // Defensive: strip fields agent cannot override
    delete body.accountId;
    delete body.accountType;
    delete body.engineVersion;
    delete body.presetVersion;

    // Load config defaults
    var _ceConfig = null;
    try { _ceConfig = await imageEngine.loadContentEngineConfig(); } catch (e) { /* use hardcoded defaults */ }

    var topic = (body.topic || '').trim();
    var goal = (body.goal || '').trim();
    var preset = (body.preset || (_ceConfig && _ceConfig.defaultPreset) || 'ap-neon-glass').trim();
    var outputs = body.outputs || (_ceConfig && _ceConfig.defaultOutputs) || ['x_image'];
    var variations = Math.min(Math.max(parseInt(body.variations) || 1, 1), 4);
    var directiveId = (body.directiveId || '').trim() || null;
    var objectiveId = (body.objectiveId || '').trim() || null;
    var reasoningSummary = (body.reasoningSummary || '').trim() || null;

    // Strict validation
    if (!topic || topic.length < 3) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'topic required (min 3 chars)' }) };
      return;
    }
    if (!goal || goal.length < 3) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'goal required (min 3 chars)' }) };
      return;
    }
    if (!preset || !imageEngine.PRESETS[preset]) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'preset required. Valid: ' + imageEngine.VALID_PRESETS.join(', ') }) };
      return;
    }
    if (!Array.isArray(outputs) || outputs.length === 0) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'outputs[] required' }) };
      return;
    }
    outputs = outputs.filter(function (o) { return !!imageEngine.PURPOSES[o]; });
    if (outputs.length === 0) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'No valid output types. Valid: ' + Object.keys(imageEngine.PURPOSES).join(', ') }) };
      return;
    }

    // Fixed account context — agent cannot override
    var accountId = 'ambientpixels-internal';
    var accountType = 'internal';

    // Usage limit check — agent cannot bypass
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

    // ── Step 1: Create brief ──
    var briefId = 'brief_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    var brief = {
      id: briefId,
      createdAt: new Date().toISOString(),
      createdBy: agentName,
      source: 'agent',
      topic: topic,
      goal: goal,
      preset: preset,
      outputs: outputs,
      variations: variations,
      status: 'generating',
      directiveId: directiveId,
      objectiveId: objectiveId
    };
    await imageEngine.saveBrief(brief);
    context.log('[agentCreateContent] Brief created by', agentName, ':', briefId);

    // ── Step 2: Generate images (direct call, no HTTP) ──
    var packageId = 'pkg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    var allOutputs = {};
    var thumbUrls = [];
    var successCount = 0;
    var failedCount = 0;

    for (var v = 0; v < variations; v++) {
      for (var i = 0; i < outputs.length; i++) {
        var outputType = outputs[i];
        var outputKey = variations > 1 ? outputType + '_v' + (v + 1) : outputType;
        var variationNum = v + 1;
        var prompt = imageEngine.buildPrompt({
          topic: topic, goal: goal, preset: preset,
          outputType: outputType, variation: variationNum
        });
        try {
          context.log('[agentCreateContent] Generating', outputKey, 'for', agentName);
          var result = await imageEngine.generateImage({
            topic: topic, goal: goal, preset: preset,
            outputType: outputType, variation: variationNum,
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
        } catch (genErr) {
          context.log.error('[agentCreateContent] Failed:', outputKey, genErr.message);
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

    // Total failure
    if (successCount === 0) {
      brief.status = 'failed';
      brief.updatedAt = new Date().toISOString();
      await imageEngine.saveBrief(brief);
      context.res = {
        status: 502,
        headers: CORS,
        body: JSON.stringify({ ok: false, error: 'All image generations failed', briefId: briefId, packageId: packageId })
      };
      return;
    }

    // ── Step 3: Save package with agent metadata ──
    var promptSummary = 'Topic: ' + topic + ' — ' + goal + ' (' + preset + ')';
    if (promptSummary.length > 140) promptSummary = promptSummary.substring(0, 137) + '...';

    var overallStatus = failedCount === 0 ? 'pending_approval' : 'partial_success';
    var durationMs = Date.now() - generationStartMs;

    var pkg = {
      id: packageId,
      briefId: briefId,
      createdAt: new Date().toISOString(),
      generatedBy: agentName,
      createdBy: agentName,
      agentRole: agentRole,
      source: 'agent',
      createdVia: 'agent',
      directiveId: directiveId,
      objectiveId: objectiveId,
      reasoningSummary: reasoningSummary,
      accountId: accountId,
      accountType: accountType,
      engineVersion: imageEngine.ENGINE_VERSION,
      preset: preset,
      presetVersion: imageEngine.getPresetVersion(preset),
      variations: variations,
      outputs: allOutputs,
      promptSummary: promptSummary,
      status: overallStatus,
      successCount: successCount,
      failedCount: failedCount,
      durationMs: durationMs,
      estimatedCost: imageEngine.estimateCost(successCount),
      model: imageEngine.GEMINI_IMAGE_MODEL,
      provider: imageEngine.GEMINI_IMAGE_PROVIDER
    };

    var packageUrl = await imageEngine.savePackage(pkg);
    context.log('[agentCreateContent] Package saved:', packageId, 'by', agentName);

    // Update brief
    brief.status = overallStatus;
    brief.packageId = packageId;
    brief.updatedAt = new Date().toISOString();
    await imageEngine.saveBrief(brief);

    // ── Step 4: Submit to Approval Queue (agent CANNOT bypass) ──
    var successImageUrls = [];
    Object.keys(allOutputs).forEach(function (k) {
      if (allOutputs[k].status === 'success' && allOutputs[k].imageUrl) successImageUrls.push(allOutputs[k].imageUrl);
    });

    var approvalItem = {
      id: 'aq-' + packageId,
      kind: 'content.package',
      type: 'content.package',
      title: 'Content Package — ' + topic,
      subtitle: successCount + ' image' + (successCount !== 1 ? 's' : '') + (failedCount > 0 ? ', ' + failedCount + ' failed' : '') + ' · ' + preset + ' · by ' + agentName,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: agentName,
      source: 'agent',
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
    context.log('[agentCreateContent] Approval queue item added:', approvalItem.id);

    // ── Step 5: Write usage record with agent fields ──
    try {
      await imageEngine.writeUsageRecord({
        accountId: accountId,
        accountType: accountType,
        packageId: packageId,
        timestamp: pkg.createdAt,
        engineVersion: imageEngine.ENGINE_VERSION,
        preset: preset,
        presetVersion: imageEngine.getPresetVersion(preset),
        formatsRequested: outputs,
        variations: variations,
        imagesGenerated: successCount,
        model: imageEngine.GEMINI_IMAGE_MODEL,
        durationMs: durationMs,
        estimatedCost: imageEngine.estimateCost(successCount),
        status: overallStatus === 'partial_success' ? 'partial' : 'success',
        createdBy: agentName,
        agentRole: agentRole,
        source: 'agent',
        directiveId: directiveId,
        objectiveId: objectiveId
      });
      context.log('[agentCreateContent] Usage record written');
    } catch (usageErr) {
      context.log.warn('[agentCreateContent] Usage record write failed (non-fatal):', usageErr.message);
    }

    // ── Step 6: Append to gallery index ──
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
        variations: variations,
        createdBy: agentName,
        source: 'agent'
      });
    } catch (idxErr) {
      context.log.warn('[agentCreateContent] Gallery index append failed (non-fatal):', idxErr.message);
    }

    // ── Response ──
    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        packageId: packageId,
        approvalItemId: approvalItem.id,
        briefId: briefId,
        successCount: successCount,
        failedCount: failedCount,
        status: overallStatus
      })
    };

  } catch (err) {
    context.log.error('[agentCreateContent] Error:', err);
    context.res = {
      status: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Internal error: ' + (err.message || String(err)) })
    };
  }
};
