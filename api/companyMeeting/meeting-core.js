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

const MAX_ITEMS_PER_AGENT = 2;
const VALID_KINDS = ['research_task', 'internal_doc', 'execution_task', 'campaign', 'objective', 'product_launch', 'product_pivot', 'product_retire', 'social'];

function _norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

// Pull the first JSON object containing an `items` array out of a model reply.
// Tolerates ```json fences and surrounding prose. Returns [] on anything unparseable.
function parseItemsFromReply(reply, agentId) {
  if (!reply || typeof reply !== 'string') return [];
  let obj = null;
  // Try fenced block first, then the first {...} that parses.
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const brace = reply.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);
  for (const c of candidates) {
    try { const parsed = JSON.parse(c); if (parsed && Array.isArray(parsed.items)) { obj = parsed; break; } } catch (_e) { /* keep trying */ }
  }
  if (!obj) return [];
  return obj.items
    .filter(function (it) { return it && VALID_KINDS.indexOf(it.kind) !== -1 && _norm(it.title).length > 0; })
    .slice(0, MAX_ITEMS_PER_AGENT)
    .map(function (it) {
      return {
        kind: it.kind,
        title: String(it.title).slice(0, 140),
        description: String(it.description || '').slice(0, 1000),
        rationale: String(it.rationale || '').slice(0, 500),
        estimatedCost: Number.isFinite(Number(it.estimatedCost)) ? Number(it.estimatedCost) : null,
        targetObjectiveId: it.targetObjectiveId || null,
        proposedBy: agentId
      };
    });
}

// Flatten all turns' items into a deduped candidate slate (by normalized title+kind),
// assigning each a stable id. First proposer wins on a duplicate.
function extractCandidates(turns) {
  const seen = new Set();
  const out = [];
  (turns || []).forEach(function (turn) {
    (turn.items || []).forEach(function (it) {
      const key = it.kind + '::' + _norm(it.title);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(Object.assign({ id: 'cand-' + (out.length + 1) + '-' + key.replace(/[^a-z0-9]+/gi, '').slice(0, 12) }, it));
    });
  });
  return out;
}

module.exports = { MEETING_ATTENDEES, BLAST_RADIUS_MAP, classifyBlastRadius, tallyVote, budgetEligible, parseItemsFromReply, extractCandidates, MAX_ITEMS_PER_AGENT, VALID_KINDS };
