// company-store-append — POST: Batch append audits, queue upserts, artifacts, settings patch
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

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 401, headers: corsHeaders, body: { error: 'Unauthorized' } };
    return;
  }

  const body = req.body || {};
  const result = { audits: {}, queue: null, artifacts: {}, settings: null };

  try {
    // Audits (append per type)
    if (body.audits && typeof body.audits === 'object') {
      for (const type of storage.AUDIT_TYPES) {
        if (Array.isArray(body.audits[type]) && body.audits[type].length > 0) {
          result.audits[type] = await storage.appendStoreAudits(type, body.audits[type]);
        }
      }
    }

    // Queue upserts + tombstones
    if (body.queue && typeof body.queue === 'object') {
      const upserts = Array.isArray(body.queue.upserts) ? body.queue.upserts : [];
      const tombstones = Array.isArray(body.queue.tombstones) ? body.queue.tombstones : [];
      if (upserts.length > 0 || tombstones.length > 0) {
        result.queue = await storage.upsertStoreQueue(upserts, tombstones);
      }
    }

    // Artifacts upserts
    if (body.artifacts && typeof body.artifacts === 'object') {
      if (Array.isArray(body.artifacts.upserts)) {
        const byType = {};
        body.artifacts.upserts.forEach(a => {
          if (!a || !a.type || !a.id) return;
          if (!byType[a.type]) byType[a.type] = [];
          byType[a.type].push(a);
        });
        for (const t in byType) {
          result.artifacts[t] = await storage.upsertStoreArtifacts(t, byType[t]);
        }
      }
    }

    // Settings patch
    if (body.settings && body.settings.patch && typeof body.settings.patch === 'object') {
      result.settings = await storage.patchStoreSettings(body.settings.patch);
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { ok: true, result, serverTime: new Date().toISOString() }
    };
  } catch (err) {
    context.log.error('[company-store-append] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { ok: false, error: 'Append failed', details: err.message }
    };
  }
};
