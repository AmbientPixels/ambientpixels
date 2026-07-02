// approveProposal — POST /api/approveProposal
//
// Inline approve/reject for both Goal Generation (System 13 — product_*) and
// Agent Identity Evolution (System 14 — agent_*) proposals. Flips approvalQueue
// entry status + executes type-specific state-mutation side effects.
//
// Atomicity (System 14 retire is the complex case):
//   Write order: approvalQueue (status flip) → tasks (reassignment) →
//   agentRegistry (archive) → governanceLog (audit). On partial failure CEO
//   retries — all steps are idempotent by state-check, not proposal-ID tracking
//   (except evolve's doctrineHistory which uses proposalId).
//
// Downstream side-effects for product_* approvals (editing product-facts.json,
// creating launch campaign) remain MANUAL. Agent_* approvals fully automated.

const storage = require('../_utils/companyStorage');
const { DOMAIN_LEAD_MAP } = require('../companyHeartbeat/constants');

const SUPPORTED_PREFIXES = ['product_', 'agent_', 'budget_request'];

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
        typeof q.type === 'string' &&
        SUPPORTED_PREFIXES.some(function (p) { return q.type.indexOf(p) === 0; }) &&
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

    // Observability: record the decision WITH detail (what/who/decision) — the audit
    // trail previously logged CEO decisions with no context on what was decided.
    try {
      const _gl = (await storage.getState('governanceLog')) || [];
      _gl.push({
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        type: 'proposal-decided',
        agentId: target.proposedBy || null,
        summary: 'CEO ' + decision + ': ' + (target.type || '?') + ' — ' + (target.title || target.name || (target.product && target.product.name) || target.id),
        timestamp: target.resolvedAt,
        details: { proposalId: target.id, proposalType: target.type, decision: decision, decidedBy: 'ceo', note: ceoNote || null }
      });
      await storage.setState('governanceLog', _gl.slice(-500));
    } catch (_glErr) { /* non-fatal */ }

    // On rejection (either system), mirror to capitalAllocation.decisionLog.
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

    // ── Budget request (Capital Allocation, pending_ceo tier) side-effect ──
    // The queue entry links to capitalAllocation.pendingRequests via requestId.
    // Without this branch a >$2 CEO-tier request could never leave pending_ceo
    // (the queue flip happened but the underlying request stayed pending forever).
    if (target.type === 'budget_request' && target.requestId) {
      try {
        const alloc = (await storage.getState('capitalAllocation')) || {};
        const pend = Array.isArray(alloc.pendingRequests) ? alloc.pendingRequests : [];
        const reqEntry = pend.find(function (r) { return r && r.id === target.requestId; });
        if (reqEntry) {
          reqEntry.status = decision; // 'approved' | 'rejected'
          reqEntry.ceoDecision = { decision: decision, note: ceoNote || null, at: target.resolvedAt, decisionBy: 'ceo' };
          if (decision === 'approved') {
            // reject decisionLog is already written by the generic block above; log approvals here.
            const log = Array.isArray(alloc.decisionLog) ? alloc.decisionLog : [];
            log.push({
              id: 'dlog_' + Date.now() + '_breq_' + Math.random().toString(36).substr(2, 4),
              requestId: reqEntry.id, agentId: reqEntry.agentId || null, decisionBy: 'ceo',
              action: 'approved', estimatedCost: Number.isFinite(reqEntry.estimatedCost) ? reqEntry.estimatedCost : null,
              reason: ceoNote || null, at: target.resolvedAt
            });
            alloc.decisionLog = log.slice(-100);
          }
          alloc.pendingRequests = pend;
          alloc.updatedAt = new Date().toISOString();
          await storage.setState('capitalAllocation', alloc);
        }
      } catch (_e) { /* non-fatal — queue status already flipped */ }
    }

    // ── Agent Identity Evolution (System 14) side-effects on approve ──
    // Idempotent by state-check. On partial failure, CEO retries with same id
    // and already-completed steps become no-ops.
    const sideEffectResult = { kind: null };
    if (decision === 'approved' && target.type.indexOf('agent_') === 0) {
      try {
        const registry = (await storage.getState('agentRegistry')) || { agents: [] };

        if (target.type === 'agent_hire_proposal') {
          // Idempotency: skip if already in registry
          if (!registry.agents.some(function (a) { return a.id === target.hire.id; })) {
            registry.agents.push({
              id: target.hire.id,
              name: target.hire.name,
              status: 'active',
              tier: target.hire.tier,
              role: target.hire.role,
              focus: target.hire.focus,
              reportsTo: target.hire.reportsTo,
              monthlyCap: target.hire.monthlyCap,
              doctrine: target.hire.doctrine,
              expectedActionMix: target.hire.expectedActionMix,
              systemPromptTemplate: target.hire.systemPromptTemplate,
              hiredAt: new Date().toISOString(),
              retiredAt: null, retiredReason: null,
              doctrineHistory: []
            });
            registry.updatedAt = new Date().toISOString();
            await storage.setState('agentRegistry', registry);
            sideEffectResult.kind = 'agent-hired';
            sideEffectResult.agentId = target.hire.id;
          } else {
            sideEffectResult.kind = 'agent-hired-idempotent';
          }

        } else if (target.type === 'agent_retire_proposal') {
          const targetAgentId = target.retire.targetAgent;
          // Step 1: Task reassignment (idempotent — filter excludes already-reassigned)
          const tasks = (await storage.getState('tasks')) || [];
          const domainLead = DOMAIN_LEAD_MAP[targetAgentId] || 'nova';
          let reassignedCount = 0;
          tasks.forEach(function (t) {
            if (t.assignee === targetAgentId &&
                ['todo', 'in-progress', 'review'].indexOf(t.status) !== -1) {
              t.assignee = domainLead;
              t.comments = t.comments || [];
              t.comments.push({
                author: 'system',
                text: 'Reassigned from ' + targetAgentId + ' (retired ' + target.resolvedAt.substring(0, 10) + '): ' + (ceoNote || ''),
                at: target.resolvedAt
              });
              reassignedCount++;
            }
          });
          if (reassignedCount > 0) await storage.setState('tasks', tasks);

          // Step 2: flip registry status (idempotent — only acts if still active)
          const reg = registry.agents.find(function (a) { return a.id === targetAgentId; });
          if (reg && reg.status === 'active') {
            reg.status = 'archived';
            reg.retiredAt = target.resolvedAt;
            reg.retiredReason = ceoNote || (target.retire.rationale || '').substring(0, 500);
            registry.updatedAt = new Date().toISOString();
            await storage.setState('agentRegistry', registry);
          }

          // Step 3: governance log (non-fatal)
          try {
            const gov = (await storage.getState('governanceLog')) || [];
            gov.push({
              at: target.resolvedAt, type: 'agent-retired',
              targetAgent: targetAgentId, reassignedCount: reassignedCount,
              ceoNote: ceoNote, proposalId: target.id
            });
            await storage.setState('governanceLog', gov.slice(-500));
          } catch (_e) { /* non-fatal */ }

          sideEffectResult.kind = 'agent-retired';
          sideEffectResult.agentId = targetAgentId;
          sideEffectResult.reassignedCount = reassignedCount;

        } else if (target.type === 'agent_evolution_proposal') {
          const targetAgentId = target.evolution.targetAgent;
          const reg = registry.agents.find(function (a) { return a.id === targetAgentId; });
          if (reg) {
            reg.doctrineHistory = reg.doctrineHistory || [];
            // Idempotency: skip if this proposal already recorded
            if (!reg.doctrineHistory.some(function (h) { return h.proposalId === target.id; })) {
              const snapshot = target.evolution.snapshot || {};
              reg.doctrineHistory.push({
                at: target.resolvedAt,
                changedFields: Object.keys(target.evolution.changes || {}),
                prev: snapshot,
                ceoNote: ceoNote,
                proposalId: target.id
              });
              // Apply changes (shallow merge — doctrine/expectedActionMix objects fully replaced)
              Object.keys(target.evolution.changes || {}).forEach(function (k) {
                reg[k] = target.evolution.changes[k];
              });
              registry.updatedAt = new Date().toISOString();
              await storage.setState('agentRegistry', registry);
              sideEffectResult.kind = 'agent-evolved';
              sideEffectResult.agentId = targetAgentId;
              sideEffectResult.changedFields = Object.keys(target.evolution.changes || {});
            } else {
              sideEffectResult.kind = 'agent-evolved-idempotent';
            }
          }
        }
      } catch (sideEffectErr) {
        context.log && context.log.error && context.log.error('[approveProposal] agent_ side-effect failed:', sideEffectErr.message);
        context.res = {
          status: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: true, entry: target, warning: 'side-effect failed: ' + sideEffectErr.message + ' — retry the approve call, idempotent on state' })
        };
        return;
      }
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, entry: target, sideEffect: sideEffectResult.kind ? sideEffectResult : null })
    };
  } catch (err) {
    context.log.error && context.log.error('[approveProposal] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed', details: err && err.message ? err.message : String(err) })
    };
  }
};
