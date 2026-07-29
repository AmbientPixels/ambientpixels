// proposalDecide — POST /api/proposalDecide.
// Approve/reject a queued meeting proposal. On approve, materializes the real
// entity (campaign/objective/task) and flips the approvalQueue entry. On reject,
// flips status + records a decisionLog mirror (same shape approveProposal writes).
const storage = require('../_utils/companyStorage');
const { materializeFromProposal, findLiveDuplicate, adoptOrphanCampaigns } = require('./materialize');
const { MAX_ACTIVE_OBJECTIVES } = require('../companyHeartbeat/constants');

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
    let adopted = [];
    let materializeNote = null;

    if (decision === 'approved') {
      // Load objectives so a campaign proposal can be auto-linked to a parent goal,
      // and pending objective proposals so a same-batch campaign can DEFER linking
      // to its sibling instead of mislinking to an older objective.
      const objectives = (await storage.getState('objectives')) || [];
      const pendingObjectiveProposals = aq.filter(function (q) {
        return q && q.id !== target.id && q.type === 'objective_proposal' && q.status === 'pending';
      });

      // Hard cap on ACTIVE objectives (backstop against goal proliferation —
      // 11 accumulated by 2026-07-28, 8 of them orphaned). Refuse, don't
      // silently approve-without-creating: the CEO should archive or cancel a
      // goal first, or reject this proposal.
      if (target.type === 'objective_proposal') {
        const activeCount = objectives.filter(function (o) {
          return o && o.status === 'active' && !o.deletedAt;
        }).length;
        if (activeCount >= MAX_ACTIVE_OBJECTIVES) {
          context.res = { status: 409, headers: corsHeaders, body: {
            error: 'Active-objective cap reached (' + activeCount + '/' + MAX_ACTIVE_OBJECTIVES + '). Archive or cancel an objective first, or reject this proposal.',
            gate: 'objective_cap'
          } };
          return;
        }
      }

      const mat = materializeFromProposal(target, nowIso, { objectives, pendingObjectiveProposals });
      if (mat && mat.stateKey) {
        let existing = (await storage.getState(mat.stateKey)) || [];
        if (!Array.isArray(existing)) existing = [];
        const dup = findLiveDuplicate(mat.stateKey, target, existing);
        if (dup && dup.why !== 'exact-title') {
          // Semantic / metric duplicate — block and inform rather than silently
          // materialize a reworded twin. The CEO can reject this proposal, or
          // rename it in the drawer if it is genuinely distinct.
          context.res = { status: 409, headers: corsHeaders, body: {
            error: 'Near-duplicate of live ' + (mat.stateKey === 'objectives' ? 'objective' : 'campaign') +
              ' "' + String(dup.entity.title || dup.entity.name || dup.entity.id).slice(0, 80) + '" (' + dup.why + '). ' +
              'Reject this proposal, or edit its title/metric if it is genuinely distinct.',
            gate: 'proposal_semantic_dup',
            duplicateOf: dup.entity.id
          } };
          return;
        }
        if (!dup) {
          existing.push(mat.entity);
          // A new objective adopts orphan campaigns that were deferred to it (or
          // plainly belong to it) — the other half of the sibling-race fix.
          if (mat.stateKey === 'objectives') {
            let camps = (await storage.getState('campaigns')) || [];
            if (!Array.isArray(camps)) camps = [];
            adopted = adoptOrphanCampaigns(mat.entity, target.id, camps);
            if (adopted.length) {
              mat.entity.linkedCampaigns = adopted.map(function (c) { return c.id; });
              await storage.setState('campaigns', camps);
            }
          }
          await storage.setState(mat.stateKey, existing);
          created = mat.entity;
          target.materializedId = mat.entity.id;
          // Maintain the objective -> campaign back-link. Without it the parent
          // objective's linkedCampaigns goes stale and progress derivation reads
          // 0/phantom. Idempotent.
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
        } else {
          materializeNote = 'exact-duplicate of ' + dup.entity.id + ' — entity not re-created';
          target.materializeNote = materializeNote;
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

    // Observability: record the decision with detail so the propose→decide funnel is auditable.
    try {
      const _gl = (await storage.getState('governanceLog')) || [];
      _gl.push({
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        type: 'proposal-decided',
        agentId: target.proposedBy || null,
        summary: 'CEO ' + decision + ': ' + (target.type || '?') + ' — ' + (target.title || target.name || target.id),
        timestamp: nowIso,
        details: { proposalId: target.id, proposalType: target.type, decision: decision, decidedBy: 'ceo', note: ceoNote || null, materialized: !!created }
      });
      await storage.setState('governanceLog', _gl.slice(-500));
    } catch (_glErr) { /* non-fatal */ }

    context.res = { status: 200, headers: corsHeaders, body: {
      ok: true, entry: target, created: created,
      adoptedCampaigns: adopted.map(function (c) { return { id: c.id, title: c.title }; }),
      materializeNote: materializeNote
    } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 300) } };
  }
};
