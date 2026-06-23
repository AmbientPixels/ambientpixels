'use strict';

// The 6 strategic agents who attend, discuss, and vote.
const MEETING_ATTENDEES = ['nova', 'echo', 'scout', 'cipher', 'pixel', 'forge'];

// Static kind → blast-radius map. Unknown kinds fall through to 'strategic'.
const BLAST_RADIUS_MAP = {
  research_task: 'internal',
  internal_doc: 'internal',
  campaign: 'strategic',
  objective: 'strategic',
  product_launch: 'strategic',
  product_pivot: 'strategic',
  product_retire: 'strategic',
  social: 'strategic'
};

// execution_task is internal only when it attaches to an existing objective;
// a free-floating execution task is treated as strategic (route to CEO).
function classifyBlastRadius(candidate) {
  const kind = candidate && candidate.kind;
  if (kind === 'execution_task') return candidate.targetObjectiveId ? 'internal' : 'strategic';
  return BLAST_RADIUS_MAP[kind] || 'strategic';
}

// Simple majority of cast (non-abstain) votes. Exact tie → Nova decides; if Nova
// did not approve (rejected, abstained, or absent) the item fails (conservative).
function tallyVote(votes) {
  let approve = 0, reject = 0, abstain = 0;
  (votes || []).forEach(function (v) {
    if (v.vote === 'approve') approve++;
    else if (v.vote === 'reject') reject++;
    else abstain++;
  });
  let passed, tiebreak = false;
  if (approve > reject) passed = true;
  else if (reject > approve) passed = false;
  else {
    tiebreak = true;
    const nova = (votes || []).find(function (v) { return v.agentId === 'nova'; });
    passed = !!(nova && nova.vote === 'approve');
  }
  return { approve: approve, reject: reject, abstain: abstain, passed: passed, tiebreak: tiebreak };
}

// Deterministic budget gate. Fail-OPEN on missing/unreadable allocation state so a
// transient read error never silently blocks the whole meeting.
function budgetEligible(candidate, allocation) {
  const cost = Number(candidate && candidate.estimatedCost);
  if (!Number.isFinite(cost) || cost <= 0) return { eligible: true, reason: null };
  if (!allocation || typeof allocation !== 'object') return { eligible: true, reason: null };
  if (allocation.systemStatus === 'RED') return { eligible: false, reason: 'system budget RED' };
  const remaining = (Number(allocation.systemBudget) || 0) - (Number(allocation.systemSpent) || 0);
  if (cost > remaining) {
    return { eligible: false, reason: 'cost ' + cost + ' exceeds remaining ' + remaining.toFixed(2) };
  }
  return { eligible: true, reason: null };
}

module.exports = { MEETING_ATTENDEES, BLAST_RADIUS_MAP, classifyBlastRadius, tallyVote, budgetEligible };
