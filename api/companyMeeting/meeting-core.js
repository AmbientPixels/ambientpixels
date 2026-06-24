'use strict';

const prompts = require('./prompts');
const meetingBrief = require('./meeting-brief');
const { buildWorldState } = require('../companyHeartbeat/world-state-intel');
const gemini = require('../companyHeartbeat/gemini');

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

// execution_task routing: fleet_task → internal (assigned to owner); ceo_decision → strategic;
// no lane but has targetObjectiveId → internal; otherwise strategic (route to CEO).
function classifyBlastRadius(candidate) {
  const kind = candidate && candidate.kind;
  if (kind === 'execution_task') {
    if (candidate.lane === 'fleet_task') return 'internal';
    if (candidate.lane === 'ceo_decision') return 'strategic';
    return candidate.targetObjectiveId ? 'internal' : 'strategic';
  }
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
  const KNOWN = ['nova', 'echo', 'scout', 'cipher', 'pixel', 'forge', 'scribe', 'quill'];
  return obj.items
    .filter(function (it) {
      if (!it || VALID_KINDS.indexOf(it.kind) === -1 || _norm(it.title).length === 0) return false;
      if (_norm(it.profitThesis).length === 0) return false;            // every item needs a thesis
      if (it.kind === 'execution_task') {
        if (it.lane !== 'fleet_task' && it.lane !== 'ceo_decision') return false;
        if (it.lane === 'fleet_task') {
          if (KNOWN.indexOf(String(it.owner || '').toLowerCase()) === -1) return false;
          if (_norm(it.deliverable).length === 0) return false;
        }
      }
      return true;
    })
    .slice(0, MAX_ITEMS_PER_AGENT)
    .map(function (it) {
      return {
        kind: it.kind,
        lane: it.lane || null,
        owner: it.owner ? String(it.owner).toLowerCase() : null,
        deliverable: String(it.deliverable || '').slice(0, 500),
        profitThesis: String(it.profitThesis || '').slice(0, 300),
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

const MEETINGS_CAP = 50;

// Production `capitalAllocation` is nested ({ system: { budget, spent, status } }) while the
// pure `budgetEligible` gate expects a flat shape. Normalize here so the gate actually engages
// in prod; pass-through when already flat (the unit-test mock) or unreadable (fail-open → null).
function _flattenAllocation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.system && typeof raw.system === 'object') {
    return { systemBudget: raw.system.budget, systemSpent: raw.system.spent, systemStatus: raw.system.status };
  }
  return raw;
}

function _taskTypeForOwner(owner) {
  if (owner === 'scout') return 'research';
  if (owner === 'scribe') return 'internal_doc';
  return 'general';
}

function _routeInternalTask(candidate, meetingId, nowIso) {
  const isFleet = candidate.kind === 'execution_task' && candidate.lane === 'fleet_task';
  const assignee = isFleet ? candidate.owner
    : (candidate.kind === 'research_task' ? 'scout' : (candidate.proposedBy || 'nova'));
  const taskType = isFleet ? _taskTypeForOwner(assignee)
    : (candidate.kind === 'research_task' ? 'research' : (candidate.kind === 'internal_doc' ? 'internal_doc' : 'general'));
  return {
    id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: candidate.title,
    description: (isFleet && candidate.deliverable) ? candidate.deliverable : (candidate.description || candidate.rationale || ''),
    taskType: taskType,
    status: 'todo',
    priority: 'medium',
    assignee: assignee,
    objective_id: candidate.targetObjectiveId || null,
    profitThesis: candidate.profitThesis || null,
    createdAt: nowIso,
    updatedAt: nowIso,
    source: 'meeting',
    created_by: candidate.proposedBy || 'nova',
    meetingId: meetingId
  };
}

function _routeDecisionRequest(candidate, meetingId, nowIso) {
  return {
    id: 'mdec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    type: 'decision_request',
    status: 'pending',
    proposedBy: candidate.proposedBy || 'nova',
    source: 'meeting',
    meetingId: meetingId,
    title: candidate.title,
    name: candidate.title,
    description: candidate.description || '',
    profitThesis: candidate.profitThesis || null,
    voteTally: { approve: candidate.approveCount, reject: candidate.rejectCount, abstain: candidate.abstainCount },
    createdAt: nowIso
  };
}

function _routeStrategicProposal(candidate, meeting, nowIso) {
  const typeByKind = {
    campaign: 'campaign_proposal', objective: 'objective_proposal',
    product_launch: 'product_proposal', product_pivot: 'product_pivot_proposal',
    product_retire: 'product_retire_proposal', social: 'social_proposal', execution_task: 'task_proposal'
  };
  return {
    id: 'mprop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    type: typeByKind[candidate.kind] || 'campaign_proposal',
    status: 'pending',
    proposedBy: candidate.proposedBy || 'nova',
    source: 'meeting',
    meetingId: meeting.id,
    title: candidate.title,
    name: candidate.title,
    description: candidate.description || '',
    rationale: candidate.rationale || '',
    profitThesis: candidate.profitThesis || null,
    voteTally: { approve: candidate.approveCount, reject: candidate.rejectCount, abstain: candidate.abstainCount },
    estimatedCost: candidate.estimatedCost,
    createdAt: nowIso
  };
}

// Orchestrate one agentic meeting. `callModel(prompt, agentId)` and `storage` are
// injected for testability; in production the trigger/cron pass the real ones.
async function runAgenticMeeting(opts) {
  opts = opts || {};
  const storage = opts.storage;
  const nowMs = opts.nowMs || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const log = opts.log || function () {};
  const trigger = opts.trigger || 'button';
  const callModel = opts.callModel || async function (prompt, agentId) {
    const r = await gemini.callWithModel(prompt, agentId, 'claude-sonnet');
    if (r != null) return r;
    const active = await gemini.getActiveModel().catch(function () { return { key: 'gemini' }; });
    const fallbackKey = active.key === 'claude-sonnet' ? 'gemini' : active.key;
    return gemini.callWithModel(prompt, agentId, fallbackKey);
  };

  // 1. Gather state for the agenda + the knowledge brief
  const [objectives, campaigns, allocationRaw, runtimeMemory, tasksState, approvalQueueState,
    agentMemories, researchIntel, weeklyReports, agentSeedMemories, socialAccountStats] = await Promise.all([
    storage.getState('objectives').then(function (v) { return v || []; }),
    storage.getState('campaigns').then(function (v) { return v || []; }),
    storage.getState('capitalAllocation').then(function (v) { return v || null; }),
    storage.getState('runtimeMemory').then(function (v) { return v || {}; }),
    storage.getState('tasks').then(function (v) { return v || []; }),
    storage.getState('approvalQueue').then(function (v) { return v || []; }),
    storage.getState('agentMemories').then(function (v) { return v || {}; }),
    storage.getState('researchIntel').then(function (v) { return v || []; }),
    storage.getState('weeklyReports').then(function (v) { return v || {}; }),
    storage.getState('agentSeedMemories').then(function (v) { return v || {}; }),
    storage.getState('socialAccountStats').then(function (v) { return v || {}; })
  ]);
  const allocation = _flattenAllocation(allocationRaw);

  // Shared brief — reuse the heartbeat's cached worldState, else rebuild it (fail-open).
  let worldState = runtimeMemory.worldState;
  if (!worldState || !worldState.generatedAt) {
    try {
      worldState = buildWorldState({
        financeDigest: runtimeMemory.financeDigest, revenueDigest: runtimeMemory.revenueDigest,
        outcomeDigest: runtimeMemory.outcomeDigest, strategicDigest: runtimeMemory.strategicDigest,
        forgeOpsDigest: runtimeMemory.forgeOpsDigest, contentDigest: runtimeMemory.contentDigest,
        socialAccountStats: socialAccountStats, campaigns: campaigns, objectives: objectives,
        tasks: tasksState, approvalQueue: approvalQueueState
      }, nowMs);
    } catch (_e) { worldState = null; log('[agenticMeeting] worldState rebuild failed: ' + (_e && _e.message)); }
  }
  let brief = '';
  try { brief = meetingBrief.buildSharedBrief(worldState, runtimeMemory.outcomeDigest); } catch (_e) { brief = ''; log('[agenticMeeting] brief build failed: ' + (_e && _e.message)); }

  // Topics already in front of the CEO — so Nova does not re-raise them.
  const pendingTopics = (approvalQueueState || [])
    .filter(function (q) { return q && q.status === 'pending' && (q.type === 'decision_request' || /_proposal$/.test(q.type || '')); })
    .map(function (q) { return String(q.title || q.name || '').slice(0, 60); }).filter(Boolean);

  // 2. Agenda proposal (Nova)
  const agendaReply = await callModel(prompts.buildAgendaPrompt('nova', brief, pendingTopics), 'nova');
  let agendaObj = null, _parseErr = null;
  try { const m = (agendaReply || '').match(/\{[\s\S]*\}/); agendaObj = m ? JSON.parse(m[0]) : null; } catch (_e) { agendaObj = null; _parseErr = _e.message; }
  if (!agendaObj || agendaObj.convene === false || !Array.isArray(agendaObj.agenda) || agendaObj.agenda.length === 0) {
    // DIAGNOSTIC: surface WHY we didn't convene so "no agenda" isn't a black box.
    let reason;
    if (agendaReply == null) reason = 'model returned null (API/credits/rate-limit)';
    else if (_parseErr) reason = 'agenda JSON parse failed: ' + _parseErr;
    else if (!agendaObj) reason = 'no JSON object found in reply';
    else if (agendaObj.convene === false) reason = 'model declined to convene (convene:false)';
    else if (!Array.isArray(agendaObj.agenda)) reason = 'agenda field missing/not an array';
    else reason = 'agenda was empty';
    const skipRec = { id: 'amtg-' + nowMs, trigger: trigger, convened: false, reason: reason,
      debug: { replyHead: String(agendaReply == null ? '(null)' : agendaReply).slice(0, 500) }, createdAt: nowIso };
    await _persistMeeting(storage, skipRec);
    log('[agenticMeeting] Not convened: ' + reason);
    return skipRec;
  }
  const agenda = agendaObj.agenda.slice(0, 3);

  // 3. Discussion (each attendee once, sees prior transcript)
  const transcriptParts = [];
  const turns = [];
  for (const agentId of MEETING_ATTENDEES) {
    let slice = '';
    try {
      slice = meetingBrief.buildAgentMemorySlice(agentId, {
        agentMemories: agentMemories, researchIntel: researchIntel,
        weeklyReports: weeklyReports, agentSeedMemories: agentSeedMemories
      });
    } catch (_e) { slice = ''; }
    const reply = await callModel(prompts.buildDiscussionPrompt(agentId, agenda, transcriptParts.join('\n\n'), brief, slice), agentId);
    const items = parseItemsFromReply(reply || '', agentId);
    turns.push({ agentId: agentId, text: reply || '(no response)', items: items });
    transcriptParts.push(agentId + ': ' + (reply || '(no response)'));
  }

  // 4. Candidate slate + budget pre-check
  const candidates = extractCandidates(turns);
  candidates.forEach(function (c) {
    const be = budgetEligible(c, allocation);
    c.eligible = be.eligible; c.ineligibleReason = be.reason;
    c.blastRadius = classifyBlastRadius(c);
  });

  // 5. Vote (each attendee votes on eligible candidates)
  const eligible = candidates.filter(function (c) { return c.eligible; });
  candidates.forEach(function (c) { c.votes = []; });
  if (eligible.length > 0) {
    for (const agentId of MEETING_ATTENDEES) {
      const reply = await callModel(prompts.buildVotePrompt(agentId, eligible), agentId);
      let voteObj = null;
      try { const m = (reply || '').match(/\{[\s\S]*\}/); voteObj = m ? JSON.parse(m[0]) : null; } catch (_e) { voteObj = null; }
      const votes = (voteObj && Array.isArray(voteObj.votes)) ? voteObj.votes : [];
      votes.forEach(function (v) {
        const cand = eligible.find(function (c) { return c.id === v.id; });
        if (cand && ['approve', 'reject', 'abstain'].indexOf(v.vote) !== -1) {
          cand.votes.push({ agentId: agentId, vote: v.vote, rationale: String(v.rationale || '').slice(0, 200) });
        }
      });
    }
  }
  candidates.forEach(function (c) {
    const t = tallyVote(c.votes);
    c.approveCount = t.approve; c.rejectCount = t.reject; c.abstainCount = t.abstain;
    c.tiebreak = t.tiebreak; c.passed = !!c.eligible && t.passed;
  });

  // 6. Route by blast radius, after cross-meeting dedup.
  const internalCreated = [], proposalsQueued = [], suppressedDuplicates = [];
  const passed = candidates.filter(function (c) { return c.passed; });

  const cutoff14d = nowMs - 14 * 86400000;

  const internalPassed = passed.filter(function (c) { return c.blastRadius === 'internal'; });
  const strategicPassed = passed.filter(function (c) { return c.blastRadius === 'strategic'; });

  if (internalPassed.length) {
    const tasks = (await storage.getState('tasks')) || [];
    const activeCount = tasks.filter(function (t) { return t && t.status !== 'done' && t.status !== 'archived'; }).length;
    const existingTasks = tasks.filter(function (t) { return t && t.status !== 'done' && t.status !== 'archived'; });
    let created = 0;
    internalPassed.forEach(function (c) {
      if (meetingBrief.isDuplicateTopic(c, existingTasks)) { suppressedDuplicates.push({ title: c.title, lane: c.lane || c.kind }); return; }
      if (activeCount + created >= 50) { log('[agenticMeeting] task ceiling hit, skipping: ' + c.title); return; }
      const t = _routeInternalTask(c, 'amtg-' + nowMs, nowIso); tasks.push(t); internalCreated.push(t.id);
      existingTasks.push({ title: t.title, targetObjectiveId: t.objective_id }); created++;
    });
    await storage.setState('tasks', tasks);
  }

  if (strategicPassed.length) {
    const aq = (await storage.getState('approvalQueue')) || [];
    const existingDecisions = aq.filter(function (q) {
      return q && q.type === 'decision_request' && (q.status === 'pending' || (Date.parse(q.createdAt || '') || 0) >= cutoff14d);
    });
    const existingProposalsByType = {};
    aq.forEach(function (q) {
      if (q && q.status === 'pending' && /_proposal$/.test(q.type || '')) {
        (existingProposalsByType[q.type] = existingProposalsByType[q.type] || []).push({ title: q.title || q.name });
      }
    });
    const meetingStub = { id: 'amtg-' + nowMs };
    strategicPassed.forEach(function (c) {
      if (c.kind === 'execution_task' && c.lane === 'ceo_decision') {
        if (meetingBrief.isDuplicateTopic(c, existingDecisions)) { suppressedDuplicates.push({ title: c.title, lane: 'ceo_decision' }); return; }
        const dr = _routeDecisionRequest(c, meetingStub.id, nowIso); aq.push(dr); proposalsQueued.push(dr.id);
        c.proposalId = dr.id; existingDecisions.push({ title: dr.title });
      } else {
        const p = _routeStrategicProposal(c, meetingStub, nowIso);
        const peers = existingProposalsByType[p.type] || [];
        if (meetingBrief.isDuplicateTopic(c, peers)) { suppressedDuplicates.push({ title: c.title, lane: c.kind }); return; }
        aq.push(p); proposalsQueued.push(p.id); c.proposalId = p.id; peers.push({ title: p.title });
        existingProposalsByType[p.type] = peers;
      }
    });
    await storage.setState('approvalQueue', aq);
  }

  // 7. Persist record
  const record = {
    id: 'amtg-' + nowMs, trigger: trigger, convened: true, agenda: agenda,
    attendees: MEETING_ATTENDEES, transcript: turns.map(function (t) { return { agentId: t.agentId, text: t.text }; }),
    candidates: candidates, routed: { internalCreated: internalCreated, proposalsQueued: proposalsQueued },
    suppressedDuplicates: suppressedDuplicates,
    createdAt: nowIso, durationMs: Date.now() - nowMs
  };
  await _persistMeeting(storage, record);
  log('[agenticMeeting] convened — candidates ' + candidates.length + ', passed ' + passed.length + ', internal ' + internalCreated.length + ', queued ' + proposalsQueued.length);
  return record;
}

async function _persistMeeting(storage, record) {
  const list = (await storage.getState('agenticMeetings')) || [];
  list.push(record);
  if (list.length > MEETINGS_CAP) list.splice(0, list.length - MEETINGS_CAP);
  await storage.setState('agenticMeetings', list);
}

// Pure signal detector for ad-hoc (non-weekly) meetings. `state` carries simple counts
// so this stays testable. Dedupes against same-type meetings convened in the last 7 days.
function detectMeetingSignals(state, nowMs, recentMeetings) {
  const s = state || {};
  const signals = [];
  if ((s.activeObjectiveCount || 0) < 3) signals.push({ type: 'coverage-gap', reason: 'only ' + (s.activeObjectiveCount || 0) + ' active objective(s)' });
  if (s.finishedRecently && (s.activeObjectiveCount || 0) === 0) signals.push({ type: 'finished-initiative', reason: 'initiatives finished with none active' });
  if ((s.researchSignalCount || 0) > 0) signals.push({ type: 'research-opportunity', reason: (s.researchSignalCount) + ' unactioned research signal(s)' });
  const weekAgo = nowMs - 7 * 86400000;
  const recentTypes = new Set((recentMeetings || [])
    .filter(function (m) { return m.convened && (Date.parse(m.createdAt || '') || 0) >= weekAgo; })
    .map(function (m) { return m.trigger; }));
  return signals.filter(function (sig) { return !recentTypes.has('signal:' + sig.type); });
}

module.exports = { MEETING_ATTENDEES, BLAST_RADIUS_MAP, classifyBlastRadius, tallyVote, budgetEligible, parseItemsFromReply, extractCandidates, MAX_ITEMS_PER_AGENT, VALID_KINDS, runAgenticMeeting, detectMeetingSignals };
