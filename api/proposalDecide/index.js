// proposalDecide — POST /api/proposalDecide.
// Approve/reject a queued meeting proposal. On approve, materializes the real
// entity (campaign/objective/task) and flips the approvalQueue entry. On reject,
// flips status + records a decisionLog mirror (same shape approveProposal writes).
const storage = require('../_utils/companyStorage');
const { materializeFromProposal, isLiveDuplicate } = require('./materialize');

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
  const decision = body.decision;
  const ceoNote = String(body.ceoNote || '').trim().slice(0, 500);
  if (!id) { context.res = { status: 400, headers: corsHeaders, body: { error: 'id required' } }; return; }
  if (decision !== 'approved' && decision !== 'rejected') {
    context.res = { status: 400, headers: corsHeaders, body: { error: 'decision must be approved or rejected' } };
    return;
  }

  try {
    const aq = (await storage.getState('approvalQueue')) || [];
    const target = aq.find(function (q) { return q && q.id === id && q.status === 'pending'; });
    if (!target) { context.res = { status: 404, headers: corsHeaders, body: { error: 'proposal not found or not pending' } }; return; }

    const nowIso = new Date().toISOString();
    let created = null;

    if (decision === 'approved') {
      // Load objectives so a campaign proposal can be auto-linked to a parent goal.
      const objectives = (await storage.getState('objectives')) || [];
      const mat = materializeFromProposal(target, nowIso, { objectives });
      if (mat && mat.stateKey) {
        let existing = (await storage.getState(mat.stateKey)) || [];
        if (!Array.isArray(existing)) existing = [];
        if (!isLiveDuplicate(mat.stateKey, mat.entity.title, existing)) {
          existing.push(mat.entity);
          await storage.setState(mat.stateKey, existing);
          created = mat.entity;
          // Maintain the objective -> campaign back-link (mirrors the Actions-page
          // approve path). Without it the parent objective's linkedCampaigns goes
          // stale and progress derivation reads 0/phantom. Idempotent.
          if (mat.stateKey === 'campaigns' && mat.entity.objective_id) {
            const parentObj = objectives.find(function (o) { return o && o.id === mat.entity.objective_id; });
            if (parentObj) {
              if (!Array.isArray(parentObj.linkedCampaigns)) parentObj.linkedCampaigns = [];
              if (parentObj.linkedCampaigns.indexOf(mat.entity.id) === -1) {
                parentObj.linkedCampaigns.push(mat.entity.id);
                await storage.setState('objectives', objectives);
              }
            }
          }
        }
      }
      target.status = 'approved';
      target.approvedAt = nowIso;
      target.resolvedBy = 'ceo';
      if (ceoNote) target.ceoNote = ceoNote;
      await storage.setState('approvalQueue', aq);
    } else {
      target.status = 'rejected';
      target.rejectedAt = nowIso;
      target.resolvedBy = 'ceo';
      if (ceoNote) target.rejectionNote = ceoNote;
      await storage.setState('approvalQueue', aq);
      // Mirror rejection into capitalAllocation.decisionLog (non-fatal).
      try {
        const alloc = (await storage.getState('capitalAllocation')) || {};
        const logArr = Array.isArray(alloc.decisionLog) ? alloc.decisionLog : [];
        logArr.push({
          id: 'dlog_' + Date.now() + '_pr_' + Math.random().toString(36).slice(2, 6),
          agentId: target.proposedBy || 'nova',
          decisionBy: 'ceo', action: 'rejected',
          estimatedCost: Number.isFinite(target.estimatedCost) ? target.estimatedCost : null,
          reason: ceoNote, at: nowIso, proposalId: target.id, proposalType: target.type
        });
        alloc.decisionLog = logArr.slice(-100);
        alloc.updatedAt = nowIso;
        await storage.setState('capitalAllocation', alloc);
      } catch (_e) { /* non-fatal */ }
    }

    context.res = { status: 200, headers: corsHeaders, body: { ok: true, entry: target, created: created } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 300) } };
  }
};
