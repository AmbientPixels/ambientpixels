// reflectionWriter.js — pure helpers for reflectionWriterCron (no I/O).

const MAX_TEXT_CHARS = 1000;
const SKIP_HOURS = 24;
const TTL_DAYS = 30;
const MAX_MEMORIES = 50;
const SOURCE = 'auto:reflection';
const DAY_MS = 86400000;

function selectOverdueAgents(reflectionDigest) {
  const pa = (reflectionDigest && reflectionDigest.perAgent) || {};
  return Object.keys(pa)
    .filter(id => pa[id] && pa[id].reflectionOverdue === true)
    .map(id => ({ agentId: id, data: pa[id] }));
}

function hasRecentReflection(memList, nowMs, skipHours) {
  const cutoff = nowMs - skipHours * 3600 * 1000;
  const list = Array.isArray(memList) ? memList : [];
  return list.some(m => {
    if (!m || m.type !== 'reflection') return false;
    const ts = Date.parse(m.timestamp || 0);
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function buildReflectionPrompt(agentId, a) {
  a = a || {};
  const parts = [];
  parts.push('You are ' + agentId + ', an autonomous agent at AmbientPixels writing a private self-reflection memory.');
  if (a.coreQuestion) parts.push('Your core question: "' + a.coreQuestion + '"');

  const dp = (a.decisionPatterns || []).map(function (p) {
    return '- ' + p.decisionType + ': ' + p.total + ' decisions (' + p.improved + ' improved, ' +
      p.regressed + ' regressed, ' + p.pendingOutcome + ' pending)';
  }).join('\n');
  parts.push('Your recent decision outcomes (14d):\n' + (dp || '- (no structured decisions logged)'));

  const sf = (a.strategyFatigue || []).map(function (f) {
    return '- ' + f.signal + ': ' + f.attempts + ' attempts, ' + Math.abs(f.vsAgentMedian) + '% below your median';
  }).join('\n');
  if (sf) parts.push('Strategy fatigue signals:\n' + sf);

  const rh = a.roleAdherence || {};
  parts.push('Role adherence: ' + (rh.drift || 'unknown') + '.');

  const rf = (a.repeatedFailures || []).map(function (f) {
    return '- ' + (f.title || f.taskId) + ' (' + f.attempts + ' failed attempts)';
  }).join('\n');
  if (rf) parts.push('Repeated failures:\n' + rf);

  parts.push('Write a concrete 100-180 word reflection answering BOTH: (1) what your recent outcomes show, referencing the specifics above; (2) what you will change going forward. Write in first person. Do not restate the data verbatim — synthesize it into a conclusion. Output ONLY the reflection prose, no preamble.');
  return parts.join('\n\n');
}

function buildTemplateFallback(agentId, a) {
  a = a || {};
  const rh = a.roleAdherence || {};
  const drift = rh.drift || 'on-role';
  const topDecision = (a.decisionPatterns || [])[0];
  const fatigue = (a.strategyFatigue || [])[0];
  const bits = ['Reflection (auto-generated from my activity digest).'];
  if (topDecision) {
    bits.push('Over the last 14 days my ' + topDecision.decisionType + ' decisions were ' +
      topDecision.improved + ' improved / ' + topDecision.regressed + ' regressed across ' +
      topDecision.total + ' total.');
  } else {
    bits.push('I have no structured decision outcomes logged in the last 14 days.');
  }
  bits.push('My role adherence reads as "' + drift + '".');
  if (fatigue) {
    bits.push('A fatigue signal shows ' + fatigue.signal + ' running ' + Math.abs(fatigue.vsAgentMedian) +
      '% below my median — worth changing approach.');
  }
  if (a.coreQuestion) {
    bits.push('Against my core question — ' + a.coreQuestion + ' — I will focus next cycle on the highest-leverage gap this data exposes' +
      (drift.indexOf('under-producing') === 0 ? ', starting by producing work in my core action types.' : '.'));
  }
  return bits.join(' ');
}

function makeReflectionMemory(opts) {
  const now = opts.now;
  const text = String(opts.text || '').trim().slice(0, MAX_TEXT_CHARS);
  return {
    id: 'mem-refl-' + now + '-' + Math.random().toString(36).slice(2, 6),
    type: 'reflection',
    text: text,
    source: SOURCE,
    timestamp: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_DAYS * DAY_MS).toISOString(),
    evidence: { basis: 'digest', model: opts.model || null }
  };
}

function capMemories(list, max) {
  if (!Array.isArray(list)) return [];
  return list.length > max ? list.slice(-max) : list;
}

module.exports = {
  MAX_TEXT_CHARS, SKIP_HOURS, TTL_DAYS, MAX_MEMORIES, SOURCE,
  selectOverdueAgents, hasRecentReflection,
  buildReflectionPrompt, buildTemplateFallback,
  makeReflectionMemory, capMemories
};
