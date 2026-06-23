'use strict';

// Compact JSON snapshot of the relevant state for the agenda step.
function _stateSummary(state) {
  const s = state || {};
  return JSON.stringify({
    activeObjectives: (s.activeObjectives || []).map(function (o) { return { id: o.id, title: o.title, progress: o.progress }; }),
    activeCampaigns: (s.activeCampaigns || []).map(function (c) { return { id: c.id, title: c.title || c.name }; }),
    recentlyFinished: s.recentlyFinished || [],
    decliningProducts: s.decliningProducts || [],
    researchSignals: s.researchSignals || []
  });
}

function buildAgendaPrompt(agentId, state) {
  return 'You are ' + agentId + ', Prime Operator opening an AmbientOS strategy meeting.\n' +
    'Current company state (JSON):\n' + _stateSummary(state) + '\n\n' +
    'Decide whether there is anything worth convening the fleet on right now — a coverage gap, ' +
    'a finished initiative needing a successor, a declining product, or a real opportunity.\n' +
    'Reply with ONLY a fenced json block:\n' +
    '```json\n{"convene": true, "agenda": [{"topic": "...", "rationale": "..."}]}\n```\n' +
    'Use at most 3 agenda topics. If nothing is worth a meeting, return {"convene": false, "agenda": []}.';
}

function buildDiscussionPrompt(agentId, agenda, transcript) {
  return 'You are ' + agentId + ' in an AmbientOS strategy meeting.\n' +
    'AGENDA: ' + JSON.stringify(agenda) + '\n\n' +
    (transcript ? ('Discussion so far:\n' + transcript + '\n\n') : '') +
    'Speak briefly on the agenda, then propose 0-2 concrete work items you believe the fleet should take on.\n' +
    'End your reply with a fenced json block of proposals (omit the block if you propose nothing):\n' +
    '```json\n{"items":[{"kind":"campaign|objective|research_task|internal_doc|execution_task|product_launch|product_pivot|product_retire|social",' +
    '"title":"...","description":"...","rationale":"<cite a number or signal>","estimatedCost":0,"targetObjectiveId":"<id if execution_task under an existing objective, else omit>"}]}\n```';
}

function buildVotePrompt(agentId, candidates) {
  const slate = (candidates || []).map(function (c) { return { id: c.id, kind: c.kind, title: c.title, rationale: c.rationale }; });
  return 'You are ' + agentId + ' voting on the proposed work from this AmbientOS meeting.\n' +
    'CANDIDATES (JSON): ' + JSON.stringify(slate) + '\n\n' +
    'For EACH candidate, vote approve, reject, or abstain, with a one-line rationale. Be a quality gate — ' +
    'reject vague, duplicate, off-strategy, or low-leverage items.\n' +
    'Reply with ONLY a fenced json block:\n' +
    '```json\n{"votes":[{"id":"cand-1","vote":"approve|reject|abstain","rationale":"..."}]}\n```';
}

module.exports = { buildAgendaPrompt, buildDiscussionPrompt, buildVotePrompt };
