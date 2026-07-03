// proposalEdit — POST /api/proposalEdit.
// Edit the substantive fields of a PENDING campaign/objective proposal in the
// approvalQueue. Validation is delegated to the pure ./validate module; this file
// is only auth + IO + governance logging. Never materializes — Approve still does
// that via the existing proposalDecide / client path.
const storage = require('../_utils/companyStorage');
const { validatePatch } = require('./validate');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: corsHeaders, body: { error: 'Unauthorized' } };
    return;
  }

  const body = req.body || {};
  const id = String(body.id || '').trim();
  const patch = body.patch;
  if (!id) { context.res = { status: 400, headers: corsHeaders, body: { error: 'id required' } }; return; }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) { context.res = { status: 400, headers: corsHeaders, body: { error: 'patch object required' } }; return; }

  try {
    const aq = (await storage.getState('approvalQueue')) || [];
    const target = aq.find(function (q) { return q && q.id === id; });
    if (!target) { context.res = { status: 404, headers: corsHeaders, body: { error: 'proposal not found' } }; return; }
    if (target.status !== 'pending') { context.res = { status: 409, headers: corsHeaders, body: { error: 'proposal not pending' } }; return; }
    if (target.type !== 'campaign_proposal' && target.type !== 'objective_proposal') {
      context.res = { status: 400, headers: corsHeaders, body: { error: 'not an editable proposal type' } };
      return;
    }

    const { clean, error } = validatePatch(target.type, patch);
    if (error) { context.res = { status: 400, headers: corsHeaders, body: { error: error } }; return; }

    const nowIso = new Date().toISOString();
    Object.assign(target, clean);
    target.editedAt = nowIso;
    target.editedBy = 'ceo';
    target._edited = true;

    // Metric-flag consistency: keep the "serves no north star" badge honest after an edit.
    // Objectives SHOULD carry a north star, so re-derive the flag both ways (metric added
    // clears it; metric removed re-flags). Campaigns do NOT require a north star, so only
    // CLEAR a pre-existing flag when the CEO adds a metric — never ADD it to a normally
    // unflagged campaign (which would invent a badge the generator never set).
    if (target.type === 'objective_proposal') {
      target.strategyFlag = (target.northStarMetric && target.metricTarget != null) ? null : 'no-north-star-metric';
    } else if (target.type === 'campaign_proposal' && target.strategyFlag === 'no-north-star-metric' && target.northStarMetric) {
      target.strategyFlag = null;
    }

    await storage.setState('approvalQueue', aq);

    // Observability (non-fatal): record the edit in the CEO-facing audit trail.
    try {
      const gl = (await storage.getState('governanceLog')) || [];
      gl.push({
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        type: 'proposal-edited',
        agentId: target.proposedBy || null,
        summary: 'CEO edited ' + target.type + ': ' + (target.title || target.name || target.id),
        timestamp: nowIso,
        details: { proposalId: target.id, proposalType: target.type, fields: Object.keys(clean) }
      });
      // Cap 5000 to match helpers.js `_appendToDestination` (the canonical governanceLog
      // writer / forensic window) — deliberately NOT the 500 some sibling endpoints use,
      // which would truncate the heartbeat's own history on every write.
      await storage.setState('governanceLog', gl.length > 5000 ? gl.slice(-5000) : gl);
    } catch (_glErr) { /* non-fatal */ }

    context.res = { status: 200, headers: corsHeaders, body: { ok: true, entry: target } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 300) } };
  }
};
