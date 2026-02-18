// contentBrief — POST /api/content-brief
// Creates a Content Engine brief and stores it in Blob Storage.
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

    // Validate required fields
    if (!body.topic || typeof body.topic !== 'string' || body.topic.trim().length < 3) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'topic is required (min 3 chars)' }) };
      return;
    }
    if (!body.goal || typeof body.goal !== 'string' || body.goal.trim().length < 3) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'goal is required (min 3 chars)' }) };
      return;
    }

    // Validate preset
    var preset = body.preset || '';
    if (imageEngine.VALID_PRESETS.indexOf(preset) === -1) {
      context.res = {
        status: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'Invalid preset. Valid: ' + imageEngine.VALID_PRESETS.join(', ') })
      };
      return;
    }

    // Validate outputs
    var outputs = body.outputs || [];
    if (!Array.isArray(outputs) || outputs.length === 0) {
      context.res = {
        status: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'outputs is required (array). Valid: ' + imageEngine.VALID_OUTPUTS.join(', ') })
      };
      return;
    }
    for (var i = 0; i < outputs.length; i++) {
      if (imageEngine.VALID_OUTPUTS.indexOf(outputs[i]) === -1) {
        context.res = {
          status: 400,
          headers: CORS,
          body: JSON.stringify({ error: 'Invalid output type: ' + outputs[i] + '. Valid: ' + imageEngine.VALID_OUTPUTS.join(', ') })
        };
        return;
      }
    }

    // Build brief
    var briefId = 'brief_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    var brief = {
      id: briefId,
      createdAt: new Date().toISOString(),
      createdBy: body.createdBy || 'user',
      topic: body.topic.trim(),
      goal: body.goal.trim(),
      audience: (body.audience || '').trim() || null,
      tone: (body.tone || '').trim() || null,
      cta: (body.cta || '').trim() || null,
      preset: preset,
      outputs: outputs,
      status: 'draft'
    };

    // Save to blob
    await imageEngine.saveBrief(brief);
    context.log('[contentBrief] Created brief:', briefId);

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, briefId: briefId, brief: brief })
    };

  } catch (err) {
    context.log.error('[contentBrief] Error:', err);
    context.res = {
      status: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Internal error: ' + (err.message || String(err)) })
    };
  }
};
