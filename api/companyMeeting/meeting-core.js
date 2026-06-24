'use strict';

const prompts = require('./prompts');

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

function _routeInternalTask(candidate, meetingId, nowIso) {
  const assignee = candidate.kind === 'research_task' ? 'scout' : (candidate.proposedBy || 'nova');
  return {
    id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: candidate.title,
    description: candidate.description || candidate.rationale || '',
    taskType: candidate.kind === 'research_task' ? 'research' : (candidate.kind === 'internal_doc' ? 'internal_doc' : 'general'),
    status: 'todo',
    priority: 'medium',
    assignee: assignee,
    objective_id: candidate.targetObjectiveId || null,
    createdAt: nowIso,
    updatedAt: nowIso,
    source: 'meeting',
    created_by: candidate.proposedBy || 'nova',
    meetingId: meetingId
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
  const callModel = opts.callModel || require('../companyHeartbeat/gemini').callGemini;

  // 1. Gather state for the agenda
  const [objectives, campaigns, allocationRaw] = await Promise.all([
    storage.getState('objectives').then(function (v) { return v || []; }),
    storage.getState('campaigns').then(function (v) { return v || []; }),
    storage.getState('capitalAllocation').then(function (v) { return v || null; })
  ]);
  const allocation = _flattenAllocation(allocationRaw);
  const state = {
    activeObjectives: objectives.filter(function (o) { return o.status === 'active'; }),
    activeCampaigns: campaigns.filter(function (c) { return c.status === 'active'; }),
    recentlyFinished: objectives.filter(function (o) { return o.status === 'complete' || o.status === 'archived'; }).slice(-5).map(function (o) { return o.title; }),
    decliningProducts: [], researchSignals: []
  };

  // 2. Agenda proposal (Nova)
  const agendaReply = await callModel(prompts.buildAgendaPrompt('nova', state), 'nova');
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
    const reply = await callModel(prompts.buildDiscussionPrompt(agentId, agenda, transcriptParts.join('\n\n')), agentId);
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

  // 6. Route by blast radius
  const internalCreated = [], proposalsQueued = [];
  const passed = candidates.filter(function (c) { return c.passed; });
  if (passed.some(function (c) { return c.blastRadius === 'internal'; })) {
    const tasks = (await storage.getState('tasks')) || [];
    passed.filter(function (c) { return c.blastRadius === 'internal'; }).forEach(function (c) {
      const t = _routeInternalTask(c, 'amtg-' + nowMs, nowIso); tasks.push(t); internalCreated.push(t.id);
    });
    await storage.setState('tasks', tasks);
  }
  if (passed.some(function (c) { return c.blastRadius === 'strategic'; })) {
    const aq = (await storage.getState('approvalQueue')) || [];
    const meetingStub = { id: 'amtg-' + nowMs };
    passed.filter(function (c) { return c.blastRadius === 'strategic'; }).forEach(function (c) {
      const p = _routeStrategicProposal(c, meetingStub, nowIso); aq.push(p); proposalsQueued.push(p.id);
      c.proposalId = p.id;
    });
    await storage.setState('approvalQueue', aq);
  }

  // 7. Persist record
  const record = {
    id: 'amtg-' + nowMs, trigger: trigger, convened: true, agenda: agenda,
    attendees: MEETING_ATTENDEES, transcript: turns.map(function (t) { return { agentId: t.agentId, text: t.text }; }),
    candidates: candidates, routed: { internalCreated: internalCreated, proposalsQueued: proposalsQueued },
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
