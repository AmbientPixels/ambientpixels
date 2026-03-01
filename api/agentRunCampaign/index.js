// agentRunCampaign — POST /api/agent-run-campaign
// Agent Campaign Run: generates multiple content packages in one run.
// Internal HQ only. All outputs go to Approval Queue.
// NO auto-posting. NO scheduling. NO public publishing.
// Reuses existing Content Engine generation pipeline.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const storage = require('../_utils/companyStorage');
const imageEngine = require('../_lib/contentEngine/imageEngine');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// Hard safety caps
const MAX_PACKAGES_PER_RUN = 5;
const MAX_VARIATIONS = 4;
const MAX_FORMATS = 6;

// Allowed agents for campaign runs
const CAMPAIGN_AGENTS = ['echo', 'pixel', 'nova'];

// Allowed channels
const VALID_CHANNELS = ['x', 'site', 'linkedin', 'mixed'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

// Load agent map from company-agents.json
var AGENT_MAP = {};
try {
  var _raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/company-agents.json'), 'utf8'));
  (_raw.agents || []).forEach(function (a) {
    if (a.id) AGENT_MAP[a.id.toLowerCase()] = { role: a.role || 'unknown' };
  });
} catch (_e) { /* empty map = all agents rejected */ }

// Validation regex
var RE_CAMPAIGN_ID = /^[a-z0-9_\-]{6,64}$/;
var RE_CAMPAIGN_TAG = /^[A-Za-z0-9_]{3,48}$/;

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

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  // Auth: x-company-secret
  var secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ ok: false, error: 'Unauthorized: invalid company secret' }) };
    return;
  }

  // Auth: x-agent-name — normalize, validate against campaign allowlist + company-agents.json
  var agentName = ((req.headers && req.headers['x-agent-name']) || '').toLowerCase().trim();
  if (!agentName) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ ok: false, error: 'INVALID_AGENT' }) };
    return;
  }
  if (CAMPAIGN_AGENTS.indexOf(agentName) === -1) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ ok: false, error: 'AGENT_NOT_ALLOWED', allowed: CAMPAIGN_AGENTS }) };
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

    // ── Validation ──

    // campaignId
    var campaignId = (body.campaignId || '').trim();
    if (!campaignId || !RE_CAMPAIGN_ID.test(campaignId)) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'campaignId required, must match ^[a-z0-9_\\-]{6,64}$' }) };
      return;
    }

    // campaignTag
    var campaignTag = (body.campaignTag || '').trim();
    if (!campaignTag || !RE_CAMPAIGN_TAG.test(campaignTag)) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'campaignTag required, must match ^[A-Za-z0-9_]{3,48}$' }) };
      return;
    }

    var campaignName = (body.campaignName || '').trim() || campaignTag;
    var campaignWeek = (body.campaignWeek || '').trim() || null;

    // channel
    var channel = (body.channel || '').trim().toLowerCase();
    if (!channel || VALID_CHANNELS.indexOf(channel) === -1) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'channel required. Valid: ' + VALID_CHANNELS.join(', ') }) };
      return;
    }

    // priority
    var priority = (body.priority || 'medium').trim().toLowerCase();
    if (VALID_PRIORITIES.indexOf(priority) === -1) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'priority must be: ' + VALID_PRIORITIES.join(', ') }) };
      return;
    }

    // preset
    var preset = (body.preset || '').trim();
    if (!preset || !imageEngine.PRESETS[preset]) {
      // Load config default
      var _ceConfig = null;
      try { _ceConfig = await imageEngine.loadContentEngineConfig(); } catch (e) {}
      preset = (_ceConfig && _ceConfig.defaultPreset) || 'ap-neon-glass';
      if (!imageEngine.PRESETS[preset]) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'Invalid preset' }) };
        return;
      }
    }

    // formats
    var formats = body.formats;
    if (!Array.isArray(formats) || formats.length === 0) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'formats[] required, cannot be empty' }) };
      return;
    }
    formats = formats.filter(function (f) { return !!imageEngine.PURPOSES[f]; });
    if (formats.length === 0) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'No valid format types. Valid: ' + Object.keys(imageEngine.PURPOSES).join(', ') }) };
      return;
    }
    if (formats.length > MAX_FORMATS) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'limit_exceeded', details: 'formats count exceeds server cap (' + MAX_FORMATS + ')' }) };
      return;
    }

    // variations
    var variations = Math.min(Math.max(parseInt(body.variations) || 1, 1), MAX_VARIATIONS);
    if ((parseInt(body.variations) || 1) > MAX_VARIATIONS) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'limit_exceeded', details: 'variations exceeds server cap (' + MAX_VARIATIONS + ')' }) };
      return;
    }

    // packageCount
    var packageCount = parseInt(body.packageCount) || 1;
    if (packageCount < 1 || packageCount > MAX_PACKAGES_PER_RUN) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'limit_exceeded', details: 'packageCount exceeds server cap (' + MAX_PACKAGES_PER_RUN + ')' }) };
      return;
    }

    // topics
    var topics = body.topics;
    if (!Array.isArray(topics) || topics.length < packageCount) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'topics[] required, must have at least ' + packageCount + ' entries' }) };
      return;
    }
    // Trim to packageCount
    topics = topics.slice(0, packageCount).map(function (t) { return (t || '').trim(); });
    for (var ti = 0; ti < topics.length; ti++) {
      if (!topics[ti] || topics[ti].length < 3) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'topics[' + ti + '] must be at least 3 chars' }) };
        return;
      }
    }

    var goalTemplate = (body.goalTemplate || '').trim();
    if (!goalTemplate || goalTemplate.length < 3) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'validation_failed', details: 'goalTemplate required (min 3 chars)' }) };
      return;
    }

    var reasoningSummary = (body.reasoningSummary || '').trim() || null;
    var directiveId = (body.campaignId || body.directiveId || '').trim() || null;
    var objectiveId = (body.objectiveId || '').trim() || null;

    // ── Account ID resolved server-side ──
    var accountId = 'ambientpixels-internal';
    var accountType = 'internal';

    // ── Pre-flight usage check ──
    var limitCheck = await imageEngine.checkUsageLimits(accountId);
    if (!limitCheck.allowed) {
      context.res = {
        status: 429,
        headers: CORS,
        body: JSON.stringify({ ok: false, error: 'daily_limit_reached', remaining: limitCheck.remaining || 0 })
      };
      return;
    }

    context.log('[agentRunCampaign] Starting campaign', campaignId, 'by', agentName, '—', packageCount, 'packages');

    // ── Campaign Loop ──
    var results = [];
    var packagesCreated = 0;
    var stoppedByLimit = false;

    for (var pi = 0; pi < packageCount; pi++) {
      // Re-check usage limit before each package
      try {
        var midCheck = await imageEngine.checkUsageLimits(accountId);
        if (!midCheck.allowed) {
          context.log('[agentRunCampaign] Daily limit reached at package', pi + 1);
          stoppedByLimit = true;
          // Record remaining topics as skipped
          for (var sk = pi; sk < packageCount; sk++) {
            results.push({ topic: topics[sk], packageId: null, briefId: null, approvalItemId: null, status: 'failed', successCount: 0, failedCount: 0, error: 'daily_limit_reached' });
          }
          break;
        }
      } catch (limitErr) {
        // Fail open
        context.log.warn('[agentRunCampaign] Usage check error (fail-open):', limitErr.message);
      }

      var topic = topics[pi];
      var generationStartMs = Date.now();

      try {
        // ── Create brief ──
        var briefId = 'brief_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
        var brief = {
          id: briefId,
          createdAt: new Date().toISOString(),
          createdBy: agentName,
          source: 'agent',
          topic: topic,
          goal: goalTemplate,
          preset: preset,
          outputs: formats,
          variations: variations,
          status: 'generating',
          campaignId: campaignId,
          campaignName: campaignName,
          campaignTag: campaignTag,
          campaignWeek: campaignWeek,
          channel: channel,
          priority: priority,
          directiveId: directiveId,
          objectiveId: objectiveId
        };
        await imageEngine.saveBrief(brief);

        // ── Generate images ──
        var packageId = 'pkg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
        var allOutputs = {};
        var thumbUrls = [];
        var successCount = 0;
        var failedCount = 0;

        for (var v = 0; v < variations; v++) {
          for (var fi = 0; fi < formats.length; fi++) {
            var outputType = formats[fi];
            var outputKey = variations > 1 ? outputType + '_v' + (v + 1) : outputType;
            var variationNum = v + 1;
            var prompt = imageEngine.buildPrompt({
              topic: topic, goal: goalTemplate, preset: preset,
              outputType: outputType, variation: variationNum
            });
            try {
              var result = await imageEngine.generateImage({
                topic: topic, goal: goalTemplate, preset: preset,
                outputType: outputType, variation: variationNum,
                jobId: packageId + '_' + outputKey
              });
              allOutputs[outputKey] = {
                status: 'success', outputType: outputType, variation: variationNum,
                size: result.size, imageUrl: result.imageUrl, thumbUrl: result.thumbUrl,
                metaUrl: result.metaUrl, model: result.model, bytes: result.bytes, promptUsed: prompt
              };
              thumbUrls.push(result.thumbUrl);
              successCount++;
            } catch (genErr) {
              context.log.error('[agentRunCampaign] Gen failed:', outputKey, genErr.message);
              allOutputs[outputKey] = {
                status: 'failed', outputType: outputType, variation: variationNum,
                error: genErr.message, promptUsed: prompt
              };
              failedCount++;
            }
          }
        }

        // Total failure for this package
        if (successCount === 0) {
          brief.status = 'failed';
          brief.updatedAt = new Date().toISOString();
          await imageEngine.saveBrief(brief);
          results.push({ topic: topic, packageId: packageId, briefId: briefId, approvalItemId: null, status: 'failed', successCount: 0, failedCount: failedCount, error: 'All image generations failed' });
          continue;
        }

        // ── Save package ──
        var promptSummary = 'Campaign: ' + campaignTag + ' — ' + topic + ' (' + preset + ')';
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
          createdVia: 'agent-run-campaign',
          campaignId: campaignId,
          campaignName: campaignName,
          campaignTag: campaignTag,
          campaignWeek: campaignWeek,
          channel: channel,
          priority: priority,
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

        // Update brief
        brief.status = overallStatus;
        brief.packageId = packageId;
        brief.updatedAt = new Date().toISOString();
        await imageEngine.saveBrief(brief);

        // ── Approval Queue ──
        var successImageUrls = [];
        Object.keys(allOutputs).forEach(function (k) {
          if (allOutputs[k].status === 'success' && allOutputs[k].imageUrl) successImageUrls.push(allOutputs[k].imageUrl);
        });

        var approvalItem = {
          id: 'aq-' + packageId,
          kind: 'content.package',
          type: 'content.package',
          entityType: 'content.package',
          entityId: packageId,
          title: 'Campaign: ' + campaignTag + ' \u2014 ' + topic,
          subtitle: preset + ' | ' + variations + ' variation' + (variations !== 1 ? 's' : '') + ' | ' + formats.length + ' format' + (formats.length !== 1 ? 's' : ''),
          status: 'pending',
          createdAt: new Date().toISOString(),
          createdBy: agentName,
          source: 'agent',
          briefId: briefId,
          packageId: packageId,
          preset: preset,
          goal: goalTemplate,
          successCount: successCount,
          failedCount: failedCount,
          campaignId: campaignId,
          campaignTag: campaignTag,
          channel: channel,
          priority: priority,
          preview: {
            thumbs: thumbUrls.slice(0, 4),
            preset: preset,
            goal: goalTemplate,
            outputTypes: formats,
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

        // ── Usage record ──
        try {
          await imageEngine.writeUsageRecord({
            accountId: accountId,
            accountType: accountType,
            packageId: packageId,
            timestamp: pkg.createdAt,
            engineVersion: imageEngine.ENGINE_VERSION,
            preset: preset,
            presetVersion: imageEngine.getPresetVersion(preset),
            formatsRequested: formats,
            variations: variations,
            imagesGenerated: successCount,
            model: imageEngine.GEMINI_IMAGE_MODEL,
            durationMs: durationMs,
            estimatedCost: imageEngine.estimateCost(successCount),
            status: overallStatus === 'partial_success' ? 'partial' : 'success',
            createdBy: agentName,
            agentRole: agentRole,
            source: 'agent',
            sourceEndpoint: 'agentRunCampaign',
            campaignId: campaignId,
            campaignTag: campaignTag,
            channel: channel,
            directiveId: directiveId,
            objectiveId: objectiveId
          });
        } catch (usageErr) {
          context.log.warn('[agentRunCampaign] Usage record write failed (non-fatal):', usageErr.message);
        }

        // ── Gallery index ──
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
            outputTypes: formats,
            variations: variations,
            createdBy: agentName,
            source: 'agent',
            campaignId: campaignId,
            campaignTag: campaignTag
          });
        } catch (idxErr) {
          context.log.warn('[agentRunCampaign] Gallery index append failed (non-fatal):', idxErr.message);
        }

        packagesCreated++;
        results.push({
          topic: topic,
          packageId: packageId,
          briefId: briefId,
          approvalItemId: approvalItem.id,
          status: successCount > 0 ? 'success' : 'failed',
          successCount: successCount,
          failedCount: failedCount,
          error: null
        });

        context.log('[agentRunCampaign] Package', pi + 1, '/', packageCount, 'done:', packageId, 'success:', successCount, 'failed:', failedCount);

      } catch (pkgErr) {
        context.log.error('[agentRunCampaign] Package', pi + 1, 'error:', pkgErr.message);
        results.push({
          topic: topic,
          packageId: null,
          briefId: null,
          approvalItemId: null,
          status: 'failed',
          successCount: 0,
          failedCount: 0,
          error: pkgErr.message
        });
      }
    }

    // ── Response ──
    var runStatus = (packagesCreated === packageCount) ? 'success' : 'partial_success';

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        campaignId: campaignId,
        createdBy: agentName,
        agentRole: agentRole,
        packageCountRequested: packageCount,
        packagesCreated: packagesCreated,
        runStatus: runStatus,
        results: results
      })
    };

  } catch (err) {
    context.log.error('[agentRunCampaign] Error:', err);
    context.res = {
      status: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: 'Internal error: ' + (err.message || String(err)) })
    };
  }
};
