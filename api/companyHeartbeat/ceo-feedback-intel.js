// ceo-feedback-intel.js — make the CEO's written reasons durable.
//
// Pure. No I/O. Called from the heartbeat before agentMemories is saved.
//
// Why: `revision_requested` + a written reason is the only channel that transmits
// reasoning to an agent (approval teaches nothing, rejection alone teaches "no").
// Until 2026-10-06 that reason lived for 7 days in a prompt line ("RECENT CEO
// DECISIONS") and in `action.approval.decision_note`, then vanished. Nothing wrote it
// to memory, so the fleet's one proven training signal had no persistence.
//
// What this does: for every action or approval-queue entry the CEO sent back or
// rejected WITH a note, write one `constraint` memory to the responsible agent with
// source `auto:ceo-revision`. That source is already exempt from TTL pruning in the
// heartbeat (index.js, memory prune pass) and ranks first in memory-select, so the
// correction outlives the item it came from. Idempotent: keyed on the source id.
'use strict';

const SOURCE = 'auto:ceo-revision';
const MAX_TEXT = 300;
const MAX_PER_AGENT_PER_RUN = 3;
const DECISION_STATUSES = new Set(['revision_requested', 'rejected', 'declined']);

function _clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function _kindOfAction(a) {
  const t = String(a.type || '');
  if (/reply/.test(t)) return 'reply';
  if (/social/.test(t)) return 'post';
  if (/publish_document|blog/.test(t)) return 'article';
  return t || 'action';
}

function _previewOfAction(a) {
  const p = a.payload || {};
  return _clip(p.text || p.content || p.title || a.summary || a.id, 70);
}

// Candidate corrections from the live actions store.
function candidatesFromActions(actions) {
  const out = [];
  (Array.isArray(actions) ? actions : []).forEach(a => {
    if (!a || !a.id || !a.approval) return;
    if (!DECISION_STATUSES.has(String(a.approval.status || ''))) return;
    const note = _clip(a.approval.decision_note || a.approval.note || a.approval.reason, 180);
    if (!note) return;
    const agentId = String(a.created_by || a.origin_agent || '').toLowerCase();
    if (!agentId) return;
    out.push({
      sourceId: 'action:' + a.id,
      agentId: agentId,
      status: String(a.approval.status),
      kind: _kindOfAction(a),
      preview: _previewOfAction(a),
      note: note,
      at: a.approval.decided_at || a.approval.updated_at || a.updatedAt || a.updated_at || null,
      campaignId: a.campaign_id || null
    });
  });
  return out;
}

// Candidate corrections from the approval queue (proposals, replies).
function candidatesFromQueue(approvalQueue) {
  const out = [];
  (Array.isArray(approvalQueue) ? approvalQueue : []).forEach(q => {
    if (!q || !q.id) return;
    if (!DECISION_STATUSES.has(String(q.status || ''))) return;
    const note = _clip(q.rejectionNote || q.revisionNote || q.ceoNote || q.note, 180);
    if (!note) return;
    const agentId = String(q.proposedBy || q.agentId || q.createdBy || '').toLowerCase();
    if (!agentId) return;
    const kind = String(q.type || 'item').replace(/_proposal$/, ' proposal').replace(/_/g, ' ');
    out.push({
      sourceId: 'aq:' + q.id,
      agentId: agentId,
      status: String(q.status),
      kind: kind,
      preview: _clip(q.name || q.title || q.text || q.id, 70),
      note: note,
      at: q.rejectedAt || q.resolvedAt || q.updatedAt || null,
      campaignId: q.materializedId || null,
      betKey: q.betKey || (q.bet && q.bet.betKey) || null
    });
  });
  return out;
}

function _alreadyHarvested(list, sourceId) {
  return (Array.isArray(list) ? list : []).some(m => m && m.evidence && m.evidence.sourceId === sourceId);
}

function buildMemory(c, nowIso) {
  const verb = c.status === 'revision_requested' ? 'sent back' : 'rejected';
  const text = _clip('CEO ' + verb + ' my ' + c.kind + ' "' + c.preview + '": "' + c.note + '". Apply this before the next similar item.', MAX_TEXT);
  const evidence = { sourceId: c.sourceId, status: c.status, decidedAt: c.at || null };
  if (c.campaignId) evidence.campaignId = c.campaignId;
  if (c.betKey) evidence.betKey = c.betKey;
  return {
    id: 'mem-ceo-' + c.sourceId.replace(/[^a-z0-9]/gi, '').slice(-24) + '-' + Math.random().toString(36).slice(2, 6),
    type: 'constraint',
    text: text,
    source: SOURCE,
    timestamp: c.at || nowIso,
    // No expiresAt: CEO corrections are permanent (the prune pass exempts this source).
    evidence: evidence
  };
}

// Mutates memoryStore in place (same contract as the other heartbeat writers).
// Returns { written, byAgent, skipped }.
function harvestCeoFeedback(input) {
  const i = input || {};
  const store = i.memoryStore || {};
  const nowIso = new Date(Number.isFinite(i.nowMs) ? i.nowMs : Date.now()).toISOString();
  const cap = Number.isFinite(i.maxPerAgent) ? i.maxPerAgent : MAX_PER_AGENT_PER_RUN;
  const candidates = candidatesFromActions(i.actions).concat(candidatesFromQueue(i.approvalQueue));
  const byAgent = {};
  let written = 0, skipped = 0;
  candidates.forEach(c => {
    if (!Array.isArray(store[c.agentId])) store[c.agentId] = [];
    if (_alreadyHarvested(store[c.agentId], c.sourceId)) { skipped++; return; }
    if ((byAgent[c.agentId] || 0) >= cap) { skipped++; return; }
    store[c.agentId].push(buildMemory(c, nowIso));
    byAgent[c.agentId] = (byAgent[c.agentId] || 0) + 1;
    written++;
  });
  return { written: written, byAgent: byAgent, skipped: skipped };
}

module.exports = { harvestCeoFeedback, candidatesFromActions, candidatesFromQueue, buildMemory, SOURCE, MAX_PER_AGENT_PER_RUN };
