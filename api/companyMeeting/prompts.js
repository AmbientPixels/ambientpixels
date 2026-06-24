'use strict';

const KNOWN_AGENTS = "nova, echo, scout, cipher, pixel, forge, scribe, quill";

function buildAgendaPrompt(agentId, brief, pendingTopics) {
  const pending = (pendingTopics && pendingTopics.length)
    ? ('\nAlready in front of the CEO (do NOT re-raise these): ' + pendingTopics.slice(0, 12).join('; ') + '\n')
    : '';
  return 'You are ' + agentId + ', Prime Operator opening an AmbientOS strategy meeting.\n' +
    'The company must become profitable. Read the money picture below and decide where the biggest ' +
    'opportunity or leak is — something that moves REVENUE, COST, or GROWTH.\n\n' +
    (brief || '(brief unavailable)') + '\n' + pending + '\n' +
    'Convene only if there is real money-moving work. Reply with ONLY a fenced json block:\n' +
    '```json\n{"convene": true, "agenda": [{"topic": "...", "rationale": "<cite a number from the brief>"}]}\n```\n' +
    'At most 3 topics. If nothing is worth a meeting, return {"convene": false, "agenda": []}.';
}

function buildDiscussionPrompt(agentId, agenda, transcript, brief, memorySlice) {
  return 'You are ' + agentId + ' in an AmbientOS strategy meeting. The goal is PROFIT.\n' +
    'AGENDA: ' + JSON.stringify(agenda) + '\n\n' +
    (brief ? (brief + '\n\n') : '') +
    (memorySlice ? (memorySlice + '\n\n') : '') +
    (transcript ? ('Discussion so far:\n' + transcript + '\n\n') : '') +
    'Speak briefly, then propose 0-2 work items that move revenue, cost, or growth.\n' +
    'RULES:\n' +
    '- Every item needs a "profitThesis": the revenue/cost/growth lever, citing a number from the brief.\n' +
    '- For execution work, set "lane":\n' +
    '    "fleet_task"   = a real agent DOES it. Requires "owner" (one of: ' + KNOWN_AGENTS + ') and a concrete "deliverable" (an artifact + how we know it is done).\n' +
    '    "ceo_decision" = a money call only the CEO can make, with options + data.\n' +
    '- BANNED: "convene a sync", "assign a DRI", "lock an SLA", "go/no-go gate", or any item whose deliverable is "a decision" or "a meeting". Propose WORK or a crisp CEO decision, never ceremony.\n' +
    'End with a fenced json block (omit it if you propose nothing):\n' +
    '```json\n{"items":[{"kind":"execution_task","lane":"fleet_task","owner":"cipher",' +
    '"title":"...","deliverable":"...","profitThesis":"...","description":"...","rationale":"...","estimatedCost":0,' +
    '"targetObjectiveId":"<id if under an existing objective, else omit>"}]}\n```\n' +
    'kind may also be campaign|objective|research_task|internal_doc|product_launch|product_pivot|product_retire|social when proposing those directly.';
}

function buildVotePrompt(agentId, candidates) {
  const slate = (candidates || []).map(function (c) {
    return { id: c.id, kind: c.kind, lane: c.lane || null, title: c.title, owner: c.owner || null, profitThesis: c.profitThesis || null };
  });
  return 'You are ' + agentId + ' voting on the proposed work from this AmbientOS meeting.\n' +
    'CANDIDATES (JSON): ' + JSON.stringify(slate) + '\n\n' +
    'Be a hard quality gate. REJECT any item that: has no profitThesis, is a fleet_task with no real owner, ' +
    'is ceremony (a sync/DRI/SLA/"make a decision"), is a duplicate, or is off-strategy/low-leverage.\n' +
    'For EACH candidate, vote approve, reject, or abstain with a one-line rationale.\n' +
    'Reply with ONLY a fenced json block:\n' +
    '```json\n{"votes":[{"id":"cand-1","vote":"approve|reject|abstain","rationale":"..."}]}\n```';
}

module.exports = { buildAgendaPrompt, buildDiscussionPrompt, buildVotePrompt };
