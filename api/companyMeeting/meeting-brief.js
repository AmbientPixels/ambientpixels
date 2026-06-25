'use strict';

// Pure assembly of the meeting's shared business brief + per-agent memory slices
// + cross-meeting dedup. No state I/O — the caller loads state and passes it in.

const SHARED_BRIEF_CAP = 2500;

function _money(n) { return '$' + (Number(n) || 0).toFixed(2); }

// Render the money-forward brief from a worldState object (heartbeat buildWorldState
// output) + the outcomeDigest funnel. Every section is omitted if its source is
// missing — never throws (except the dev char-cap guard).
function buildSharedBrief(worldState, outcomeDigest) {
  const ws = worldState || {};
  const fin = ws.finance || {};
  const lines = [];
  lines.push('═══ BUSINESS BRIEF (money first) ═══');

  // MONEY — company income vs LLM/ops cost, kept DISTINCT. The "runway" from
  // financeDigest is days-of-LLM-budget-left-this-month, NOT company cash runway;
  // labeling it plainly stopped the fleet treating a budget-pacing number as an
  // existential cash emergency.
  lines.push('MONEY (company income): revenue ' + _money(fin.monthlyRevenue) + ' MTD, ' +
    _money(fin.mrr) + ' MRR, ' + (fin.payingCustomers || 0) + ' paying customers.');
  const budgetPacing = (ws.company && ws.company.runwayDays != null)
    ? ('~' + ws.company.runwayDays + 'd of budget left this month at current burn')
    : 'budget pacing n/a';
  lines.push('LLM/OPS COST (NOT company cash runway): ' + _money(fin.monthlyActual) + ' of ' +
    _money(fin.monthlyBudget) + '/mo AI budget (' + (fin.status || 'unknown') + '); ' + budgetPacing +
    '. This is AI spend, not company runway.');

  // PRODUCTS — earns vs burns
  const prods = Array.isArray(ws.products) ? ws.products : [];
  if (prods.length) {
    const pStr = prods.slice(0, 8).map(function (p) {
      const flag = (p.signal && /declin/i.test(p.signal)) ? ' BURNING' : '';
      return p.name + ' (' + (p.status || 'active') + (p.signal ? ', ' + p.signal : '') + flag + ')';
    }).join(', ');
    lines.push('PRODUCTS: ' + pStr + '.');
  }

  // FUNNEL
  const ot = (outcomeDigest && outcomeDigest.totals) || null;
  if (ot) {
    lines.push('FUNNEL: ' + (ot.complete || 0) + '/' + (ot.snapshots || 0) + ' posts measured → ' +
      (ot.blogViews || 0) + ' blog views → ' + (ot.formSubmits || 0) + ' form submits.');
  }

  // PIPELINE
  const objs = Array.isArray(ws.objectives) ? ws.objectives : [];
  if (objs.length) {
    lines.push('OBJECTIVES: ' + objs.slice(0, 5).map(function (o) { return '"' + o.title + '" ' + (o.progress || 0) + '%'; }).join(', ') + '.');
  }
  const camps = Array.isArray(ws.campaigns) ? ws.campaigns : [];
  if (camps.length) {
    lines.push('CAMPAIGNS: ' + camps.slice(0, 5).map(function (c) { return '"' + c.title + '" ' + (c.pace || '') + ' ' + (c.progress || 0) + '%'; }).join(', ') + '.');
  }

  lines.push('═══ END BRIEF ═══');
  const block = lines.join('\n');
  if (block.length > SHARED_BRIEF_CAP) {
    throw new Error('[meeting-brief] shared brief exceeds ' + SHARED_BRIEF_CAP + ' char cap: ' + block.length);
  }
  return block;
}

const MEMORY_SLICE_CAP = 1500;

function _trim(s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); }

// Per-agent specialty memory. Returns '' when the agent has nothing.
function buildAgentMemorySlice(agentId, mem) {
  const id = String(agentId || '').toLowerCase();
  const m = mem || {};
  const seed = m.agentSeedMemories || {};
  const memories = (m.agentMemories || {})[id] || [];
  const research = Array.isArray(m.researchIntel) ? m.researchIntel : [];
  const weekly = (m.weeklyReports || {})[id] || [];
  const lines = [];

  // Seed anchors (global + own)
  const seedBits = [];
  if (seed._global) seedBits.push(_trim(seed._global, 160));
  if (seed[id]) seedBits.push(_trim(seed[id], 160));
  if (seedBits.length) lines.push('ANCHORS: ' + seedBits.join(' | '));

  // Latest weekly report (cipher/forge/nova)
  if (weekly.length) {
    const last = weekly[weekly.length - 1] || {};
    if (last.summary) lines.push('LAST WEEKLY: ' + _trim(last.summary, 240));
  }

  // Role-specialty source: scout → research intel; everyone → own reflections/verdicts
  if (id === 'scout' && research.length) {
    lines.push('RESEARCH: ' + research.slice(0, 3).map(function (r) {
      return _trim((r.title || '') + (r.summary ? ' — ' + r.summary : ''), 160);
    }).join(' | '));
  }
  const focus = memories.filter(function (x) {
    return x && (x.type === 'reflection' || (x.source && String(x.source).indexOf('experiment-verdict') !== -1));
  }).slice(-3);
  if (focus.length) {
    lines.push('YOUR NOTES: ' + focus.map(function (x) { return _trim(x.content || x.text || '', 160); }).filter(Boolean).join(' | '));
  }

  if (!lines.length) return '';
  let block = '─ YOUR MEMORY (' + id + ') ─\n' + lines.join('\n');
  if (block.length > MEMORY_SLICE_CAP) block = block.slice(0, MEMORY_SLICE_CAP);
  return block;
}

const TOPIC_STOP_WORDS = new Set(['the', 'and', 'for', 'launch', 'campaign', 'this', 'week', 'plus',
  'new', 'with', 'into', 'our', 'decision', 'lock', 'gate', 'scope', 'final', 'post', 'model', 'plan',
  'review', 'sync', 'sprint', 'freeze', 'go', 'no']);

function _topicTokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length > 2 && !TOPIC_STOP_WORDS.has(w); });
}

// True if `candidate` repeats a topic already present in `existing` (array of
// {title, targetObjectiveId?}). Match = same non-null targetObjectiveId, or >=2
// shared significant title tokens.
function isDuplicateTopic(candidate, existing) {
  const c = candidate || {};
  const cTokens = _topicTokens(c.title);
  const cObj = c.targetObjectiveId || null;
  return (existing || []).some(function (e) {
    if (!e) return false;
    if (cObj && e.targetObjectiveId && e.targetObjectiveId === cObj) return true;
    const eTokens = _topicTokens(e.title);
    const shared = cTokens.filter(function (w) { return eTokens.indexOf(w) !== -1; }).length;
    return shared >= 2;
  });
}

module.exports = { buildSharedBrief, buildAgentMemorySlice, isDuplicateTopic, SHARED_BRIEF_CAP, MEMORY_SLICE_CAP };
