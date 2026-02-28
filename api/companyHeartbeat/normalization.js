// normalization.js — extracted from companyHeartbeat/index.js (Phase 2 refactor)
// Proposal validation, dual-envelope normalizer (legacy→new format)

const { KNOWN_ACTION_TYPES } = require('./constants');
const { logEvent } = require('./helpers');

// ── Blocked proposal builder ──

function _buildBlockedProposal(agentId, runId, reasonBlocked, proposedAction, payload) {
  var p = payload || {};
  var ac = Array.isArray(p.acceptanceCriteria) && p.acceptanceCriteria.length > 0
    ? p.acceptanceCriteria : ['Define success criteria.'];
  var ev = p.evidence && typeof p.evidence === 'object' ? Object.assign({}, p.evidence) : {};
  if (!ev.runId) ev.runId = runId;
  if (!ev.gate) ev.gate = reasonBlocked;
  var result = {
    type: 'proposal',
    agentId: agentId,
    runId: runId,
    reasonBlocked: reasonBlocked,
    proposedAction: proposedAction,
    payload: {
      title: String(p.title || 'Blocked ' + proposedAction + ' (' + reasonBlocked + ')').substring(0, 120),
      category: String(p.category || 'maintenance'),
      objective_id: p.objective_id || null,
      objective_suggestion: p.objective_suggestion || (reasonBlocked === 'objective_gate' ? 'Assign an objective before this task can proceed.' : null),
      acceptanceCriteria: ac.slice(0, 5),
      evidence: ev
    }
  };
  // Preserve extra payload fields from specialized gates (blockedKeys, cap, bucket, allowedKeys)
  if (p.blockedKeys) result.payload.blockedKeys = p.blockedKeys;
  if (p.allowedKeys) result.payload.allowedKeys = p.allowedKeys;
  if (p.cap !== undefined) result.payload.cap = p.cap;
  if (p.current !== undefined) result.payload.current = p.current;
  if (p.bucket) result.payload.bucket = p.bucket;
  if (p.taskId) result.payload.taskId = p.taskId;
  return result;
}

function _normalizeProposal(p) {
  if (!p || typeof p !== 'object') return p;
  p.type = 'proposal';
  if (p.payload) {
    if (p.payload.title) p.payload.title = String(p.payload.title).substring(0, 120);
    if (!p.payload.category) p.payload.category = 'maintenance';
    p.payload.category = String(p.payload.category);
    if (!Array.isArray(p.payload.acceptanceCriteria) || p.payload.acceptanceCriteria.length === 0) {
      p.payload.acceptanceCriteria = ['Define success criteria.'];
    }
    if (p.payload.acceptanceCriteria.length > 5) p.payload.acceptanceCriteria = p.payload.acceptanceCriteria.slice(0, 5);
    if (!p.payload.evidence || typeof p.payload.evidence !== 'object') p.payload.evidence = {};
    if (!p.payload.evidence.runId && p.runId) p.payload.evidence.runId = p.runId;
  }
  return p;
}

function _isValidProposal(p) {
  if (!p || p.type !== 'proposal') return false;
  if (!p.agentId || !p.runId || !p.reasonBlocked || !p.proposedAction) return false;
  if (!p.payload) return false;
  if (!p.payload.title) return false;
  if (!p.payload.category) return false;
  if (!Array.isArray(p.payload.acceptanceCriteria) || p.payload.acceptanceCriteria.length < 1) return false;
  if (!p.payload.evidence || typeof p.payload.evidence !== 'object' || !p.payload.evidence.runId) return false;
  if (!p.payload.objective_id && !p.payload.objective_suggestion) return false;
  return true;
}

// ── Dual-envelope agent output normalizer ──
// Supports legacy { observation, actions } and new { taskUpdates, proposals, remember, observations }
function normalizeAgentResult(parsed) {
  const normalized = { actions: [], proposals: [], remember: [], observations: [] };
  if (!parsed || typeof parsed !== 'object') return normalized;

  // ── Legacy format: { observation, actions } ──
  if (Array.isArray(parsed.actions)) {
    if (typeof parsed.observation === 'string' && parsed.observation.trim()) {
      normalized.observations.push(parsed.observation.trim());
    }
    for (var i = 0; i < parsed.actions.length; i++) {
      var action = parsed.actions[i];
      if (!action || typeof action !== 'object') continue;
      var type = action.type || '';

      if (type === 'remember' && action.memory) {
        // Extract to normalized.remember AND keep in actions for existing processing loop
        normalized.remember.push({
          type: (action.memory.type || '').trim(),
          text: (action.memory.text || '').trim(),
          evidence: action.memory.evidence || undefined,
          expiresAt: action.memory.expiresAt || undefined
        });
        normalized.actions.push(action);
      } else if (type === 'proposal') {
        // Agent explicitly emitted a proposal
        normalized.proposals.push(action.proposal || action);
      } else if (KNOWN_ACTION_TYPES.indexOf(type) !== -1) {
        normalized.actions.push(action);
      } else {
        // Unknown type → observation warning, do not crash
        normalized.observations.push('[unknown-action-type] ' + type + ': ' + (action.summary || '').substring(0, 200));
      }
    }
    return normalized;
  }

  // ── New format: { taskUpdates, proposals, remember, observations } ──
  if (parsed.taskUpdates || parsed.proposals || parsed.remember || parsed.observations) {
    // taskUpdates → actions (same format the processing loop expects)
    if (Array.isArray(parsed.taskUpdates)) {
      for (var j = 0; j < parsed.taskUpdates.length; j++) {
        var tu = parsed.taskUpdates[j];
        if (tu && typeof tu === 'object') normalized.actions.push(tu);
      }
    }
    // proposals
    if (Array.isArray(parsed.proposals)) {
      for (var k = 0; k < parsed.proposals.length; k++) {
        if (parsed.proposals[k] && typeof parsed.proposals[k] === 'object') {
          normalized.proposals.push(parsed.proposals[k]);
        }
      }
    }
    // remember → extract AND convert to action objects for existing processing loop
    if (Array.isArray(parsed.remember)) {
      for (var m = 0; m < parsed.remember.length; m++) {
        var mem = parsed.remember[m];
        if (mem && typeof mem === 'object') {
          normalized.remember.push({
            type: (mem.type || '').trim(),
            text: (mem.text || '').trim(),
            evidence: mem.evidence || undefined,
            expiresAt: mem.expiresAt || undefined
          });
          // Convert to action object for existing processing loop
          normalized.actions.push({ type: 'remember', memory: mem });
        }
      }
    }
    // observations
    if (Array.isArray(parsed.observations)) {
      for (var n = 0; n < parsed.observations.length; n++) {
        if (typeof parsed.observations[n] === 'string') {
          normalized.observations.push(parsed.observations[n]);
        }
      }
    } else if (typeof parsed.observations === 'string' && parsed.observations.trim()) {
      normalized.observations.push(parsed.observations.trim());
    }
    return normalized;
  }

  // Fallback: unrecognized format
  return normalized;
}

// ── Defensive envelope normalization ──
async function _normalizeEnvelope(parsed, opts) {
  const options = opts || {};
  const agentId = options.agentId || null;
  const runId = options.runId || null;
  const onPolicyViolationGate = typeof options.onPolicyViolationGate === 'function' ? options.onPolicyViolationGate : null;
  const envelope = { taskUpdates: [], proposals: [], remember: [], observations: [] };

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (onPolicyViolationGate) onPolicyViolationGate('output_envelope');
    await logEvent('policy-violation', agentId, 'Invalid agent output envelope', runId, {
      runId: runId,
      agentId: agentId,
      gate: 'output_envelope',
      reason: 'invalid_json_or_non_object'
    });
    envelope.observations.push('Invalid agent output envelope.');
    return envelope;
  }

  const fields = ['taskUpdates', 'proposals', 'remember', 'observations'];
  for (const field of fields) {
    const value = parsed[field];
    if (Array.isArray(value)) {
      envelope[field] = value;
      continue;
    }
    if (value === null || value === undefined) {
      envelope[field] = [];
      continue;
    }
    if (typeof value === 'string' || (typeof value === 'object' && !Array.isArray(value))) {
      envelope[field] = [value];
      envelope.observations.push('Normalized non-array field: ' + field);
      continue;
    }
    envelope[field] = [];
    envelope.observations.push('Normalized non-array field: ' + field);
  }

  return envelope;
}

module.exports = {
  _buildBlockedProposal,
  _normalizeProposal,
  _isValidProposal,
  normalizeAgentResult,
  _normalizeEnvelope
};
