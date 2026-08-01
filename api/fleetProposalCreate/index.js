// fleetProposalCreate — POST /api/fleetProposalCreate
//
// Creates a fleet mutation proposal (agent_hire / agent_retire / agent_evolution)
// directly from the CEO dashboard or via curl, bypassing the Forge-only gate.
// Validates shape + appends to approvalQueue. Approval happens via existing
// /api/approveProposal (System 14 Phase 3 side-effects fire there).
//
// This endpoint exists because /api/company-state POST is full-replace only
// (no server-side append), and GET → mutate → POST from a dashboard race-
// conditions with concurrent heartbeat writes. Single-point append avoids this.
//
// NOTE: This endpoint does NOT invoke the heartbeat agent-runner gates
// (rate/cooldown/self-proposal/protected). Those gates protect Forge-emitted
// proposals from misbehavior. CEO direct-POST is trusted — CEO is the final
// authority and approves these anyway. Protected-agent check IS enforced to
// prevent accidental nova/cipher retirement.

const storage = require('../_utils/companyStorage');
const {
  PROTECTED_AGENTS, FLEET_MIN_SIZE, FLEET_MAX_SIZE,
  FLEET_PROPOSAL_COST_CEILINGS
} = require('../companyHeartbeat/constants');

const VALID_TYPES = ['agent_hire_proposal', 'agent_retire_proposal', 'agent_evolution_proposal'];
const TYPE_TO_ACTION = {
  'agent_hire_proposal': 'propose-hire-agent',
  'agent_retire_proposal': 'propose-retire-agent',
  'agent_evolution_proposal': 'propose-role-evolution'
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

function _err(context, status, msg) {
  context.res = { status: status, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    return _err(context, 403, 'Unauthorized');
  }

  const body = req.body || {};
  const type = String(body.type || '').trim();
  const proposedBy = String(body.proposedBy || 'ceo').trim().toLowerCase();

  if (VALID_TYPES.indexOf(type) === -1) {
    return _err(context, 400, 'type must be one of: ' + VALID_TYPES.join(', '));
  }

  try {
    const registry = (await storage.getState('agentRegistry')) || { agents: [] };
    const activeCount = registry.agents.filter(function (a) { return a.status === 'active'; }).length;

    // Build entry based on type
    let entry = null;

    if (type === 'agent_hire_proposal') {
      const hire = body.hire;
      if (!hire || typeof hire !== 'object') return _err(context, 400, 'hire object required');
      const hrId = String(hire.id || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9]{1,11}$/.test(hrId)) return _err(context, 400, 'hire.id must be lowercase alphanumeric 2-12 chars');
      if (registry.agents.some(function (a) { return a.id === hrId; })) return _err(context, 409, 'agent id already exists (active or archived)');
      if (![2, 3, 4].indexOf(Number(hire.tier)) !== -1) {
        // intentional: allow only 2,3,4
      }
      if ([2, 3, 4].indexOf(Number(hire.tier)) === -1) return _err(context, 400, 'tier must be 2, 3, or 4');
      const cap = Number(hire.monthlyCap);
      if (!Number.isFinite(cap) || cap <= 0 || cap > FLEET_PROPOSAL_COST_CEILINGS['propose-hire-agent']) {
        return _err(context, 400, 'monthlyCap out of range (0 < cap ≤ ' + FLEET_PROPOSAL_COST_CEILINGS['propose-hire-agent'] + ')');
      }
      if (activeCount + 1 > FLEET_MAX_SIZE) return _err(context, 400, 'fleet at max size (' + FLEET_MAX_SIZE + ')');
      if (!hire.name || !hire.role || !hire.focus || !hire.rationale || !hire.systemPromptTemplate) {
        return _err(context, 400, 'missing required string fields');
      }
      if (!hire.doctrine || typeof hire.doctrine !== 'object' || !hire.expectedActionMix || typeof hire.expectedActionMix !== 'object') {
        return _err(context, 400, 'doctrine + expectedActionMix required objects');
      }
      const reportsTo = hire.reportsTo === null ? null : String(hire.reportsTo || '').trim().toLowerCase();
      if (reportsTo !== null && !registry.agents.some(function (a) { return a.id === reportsTo && a.status === 'active'; })) {
        return _err(context, 400, 'reportsTo must be an existing active agent or null');
      }

      entry = {
        id: 'hirepr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'agent_hire_proposal',
        status: 'pending',
        proposedBy: proposedBy,
        hire: {
          id: hrId,
          name: String(hire.name).substring(0, 20),
          role: String(hire.role).substring(0, 100),
          tier: Number(hire.tier),
          focus: String(hire.focus).substring(0, 500),
          reportsTo: reportsTo,
          monthlyCap: Math.round(cap * 100) / 100,
          doctrine: hire.doctrine,
          expectedActionMix: hire.expectedActionMix,
          systemPromptTemplate: String(hire.systemPromptTemplate).substring(0, 1000),
          rationale: String(hire.rationale).substring(0, 500),
          estimatedMonthlySpend: Math.round((Number(hire.estimatedMonthlySpend) || cap) * 100) / 100
        },
        estimatedCost: Math.round(cap * 100) / 100,
        evidence: { source: 'ceo-direct-post' },
        createdAt: new Date().toISOString()
      };

    } else if (type === 'agent_retire_proposal') {
      const retire = body.retire;
      if (!retire || typeof retire !== 'object') return _err(context, 400, 'retire object required');
      const target = String(retire.targetAgent || '').trim().toLowerCase();
      if (!target) return _err(context, 400, 'retire.targetAgent required');
      if (PROTECTED_AGENTS.has(target)) return _err(context, 400, 'target is in PROTECTED_AGENTS — cannot retire');
      const targetEntry = registry.agents.find(function (a) { return a.id === target; });
      if (!targetEntry || targetEntry.status !== 'active') {
        return _err(context, 404, 'target agent not found or not active');
      }
      if (activeCount - 1 < FLEET_MIN_SIZE) return _err(context, 400, 'retiring would drop fleet below FLEET_MIN_SIZE (' + FLEET_MIN_SIZE + ')');
      if (!retire.rationale || !retire.reassignmentPlan) return _err(context, 400, 'rationale + reassignmentPlan required');

      const orphans = registry.agents.filter(function (a) {
        return a.status === 'active' && a.reportsTo === target;
      }).map(function (a) { return a.id; });

      entry = {
        id: 'retpr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'agent_retire_proposal',
        status: 'pending',
        proposedBy: proposedBy,
        retire: {
          targetAgent: target,
          rationale: String(retire.rationale).substring(0, 500),
          reassignmentPlan: String(retire.reassignmentPlan).substring(0, 500),
          estimatedWinddownCost: Math.round((Number(retire.estimatedWinddownCost) || 0) * 100) / 100,
          orphans: orphans
        },
        estimatedCost: Math.round((Number(retire.estimatedWinddownCost) || 0) * 100) / 100,
        evidence: { source: 'ceo-direct-post' },
        createdAt: new Date().toISOString()
      };

    } else if (type === 'agent_evolution_proposal') {
      const evo = body.evolution;
      if (!evo || typeof evo !== 'object') return _err(context, 400, 'evolution object required');
      const target = String(evo.targetAgent || '').trim().toLowerCase();
      if (!target) return _err(context, 400, 'evolution.targetAgent required');
      const targetEntry = registry.agents.find(function (a) { return a.id === target; });
      if (!targetEntry || targetEntry.status !== 'active') {
        return _err(context, 404, 'target agent not found or not active');
      }
      const changes = evo.changes;
      if (!changes || typeof changes !== 'object') return _err(context, 400, 'changes object required');
      const protectedFields = ['id', 'name', 'tier', 'status', 'hiredAt', 'retiredAt', 'reportsTo'];
      const hasProtected = Object.keys(changes).some(function (k) { return protectedFields.indexOf(k) !== -1; });
      if (hasProtected) return _err(context, 400, 'changes cannot include protected fields: ' + protectedFields.join(','));
      const allowed = ['focus', 'monthlyCap', 'doctrine', 'expectedActionMix'];
      const hasAllowed = Object.keys(changes).some(function (k) { return allowed.indexOf(k) !== -1; });
      if (!hasAllowed) return _err(context, 400, 'changes must include at least one of: ' + allowed.join(','));
      if ('monthlyCap' in changes) {
        const c = Number(changes.monthlyCap);
        const ceil = FLEET_PROPOSAL_COST_CEILINGS['propose-role-evolution'];
        if (!Number.isFinite(c) || c <= 0 || c > ceil) return _err(context, 400, 'monthlyCap out of range (0 < cap ≤ ' + ceil + ')');
      }
      if (!evo.rationale) return _err(context, 400, 'rationale required');

      // Snapshot pre-change values for doctrineHistory on approve
      const snapshot = {};
      Object.keys(changes).forEach(function (k) { snapshot[k] = targetEntry[k]; });

      entry = {
        id: 'evolpr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'agent_evolution_proposal',
        status: 'pending',
        proposedBy: proposedBy,
        evolution: {
          targetAgent: target,
          changes: changes,
          rationale: String(evo.rationale).substring(0, 500),
          estimatedCostDelta: Math.round((Number(evo.estimatedCostDelta) || 0) * 100) / 100,
          snapshot: snapshot
        },
        estimatedCost: Math.round((Number(evo.estimatedCostDelta) || 0) * 100) / 100,
        evidence: { source: 'ceo-direct-post' },
        createdAt: new Date().toISOString()
      };
    }

    if (!entry) return _err(context, 500, 'failed to build entry');

    // Dedup: check for existing pending proposal with same target/type. The check has
    // to run INSIDE the mutation — checking a snapshot and appending to it later is
    // how two concurrent creators both pass the dedup and both land an entry.
    const targetKey = type + ':' + (entry.hire ? entry.hire.id : (entry.retire ? entry.retire.targetAgent : entry.evolution.targetAgent));
    let dupe = false;
    await storage.mutateState('approvalQueue', function (fresh) {
      const arr = Array.isArray(fresh) ? fresh : [];
      dupe = arr.some(function (q) {
        if (!q || q.type !== type || q.status !== 'pending') return false;
        const qTargetKey = q.type + ':' + (q.hire ? q.hire.id : (q.retire ? q.retire.targetAgent : (q.evolution ? q.evolution.targetAgent : '')));
        return qTargetKey === targetKey;
      });
      if (dupe) return undefined;
      arr.push(entry);
      return arr;
    });
    if (dupe) return _err(context, 409, 'duplicate pending proposal for target');

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, id: entry.id, entry: entry })
    };
  } catch (err) {
    context.log && context.log.error && context.log.error('[fleetProposalCreate] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed', details: err && err.message ? err.message : String(err) })
    };
  }
};
