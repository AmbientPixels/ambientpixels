// approveProposal — POST /api/approveProposal
//
// Inline approve/reject for Goal Generation (System 13) product proposals.
// Only flips approvalQueue[x].status for entries with type starting 'product_'.
// On rejection, also appends an entry to capitalAllocation.decisionLog so the
// Allocation dashboard + Cipher's retro block surface product rejections.
//
// Downstream side-effects (editing product-facts.json on product_proposal
// approve, creating launch campaign, etc.) remain MANUAL for v1. This endpoint
// only updates the queue entry — CEO follows up by hand.

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    return;
  }

  const body = req.body || {};
  const id = String(body.id || '').trim();
  const decision = body.decision;
  const ceoNote = String(body.ceoNote || '').trim().substring(0, 500);

  if (!id) {
    context.res = { status: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id required' }) };
    return;
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    context.res = { status: 400, headers: corsHeaders, body: JSON.stringify({ error: 'decision must be approved or rejected' }) };
    return;
  }
  if (decision === 'rejected' && !ceoNote) {
    context.res = { status: 400, headers: corsHeaders, body: JSON.stringify({ error: 'ceoNote required on reject' }) };
    return;
  }

  try {
    const aq = (await storage.getState('approvalQueue')) || [];
    const target = aq.find(function (q) {
      return q && q.id === id &&
        typeof q.type === 'string' && q.type.indexOf('product_') === 0 &&
        q.status === 'pending';
    });
    if (!target) {
      context.res = { status: 404, headers: corsHeaders, body: JSON.stringify({ error: 'proposal not found or not pending' }) };
      return;
    }

    target.status = decision;
    target.resolvedAt = new Date().toISOString();
    target.resolvedBy = 'ceo';
    if (ceoNote) target.ceoNote = ceoNote;
    await storage.setState('approvalQueue', aq);

    // On rejection, mirror to capitalAllocation.decisionLog so the Allocation
    // dashboard surfaces product rejections alongside budget rejections.
    // Shape matches existing entries: { id, agentId, decisionBy, action,
    // estimatedCost, reason, at } + additive proposalId/proposalType.
    if (decision === 'rejected') {
      try {
        const alloc = (await storage.getState('capitalAllocation')) || {};
        const log = Array.isArray(alloc.decisionLog) ? alloc.decisionLog : [];
        log.push({
          id: 'dlog_' + Date.now() + '_pr_' + Math.random().toString(36).substr(2, 4),
          agentId: target.proposedBy || 'nova',
          decisionBy: 'ceo',
          action: 'rejected',
          estimatedCost: Number.isFinite(target.estimatedCost) ? target.estimatedCost : null,
          reason: ceoNote,
          at: target.resolvedAt,
          proposalId: target.id,
          proposalType: target.type
        });
        alloc.decisionLog = log.slice(-100);
        alloc.updatedAt = new Date().toISOString();
        await storage.setState('capitalAllocation', alloc);
      } catch (_e) { /* non-fatal */ }
    }

    context.res = { status: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, entry: target }) };
  } catch (err) {
    context.log.error && context.log.error('[approveProposal] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed', details: err && err.message ? err.message : String(err) })
    };
  }
};
