// bet-ledger.js — kill rules, scale rules, scoring, and the ledger every proposer reads.
//
// Pure. No I/O. Called from the heartbeat once outcomeDigest exists (perCampaign
// carries qualifiedUsesAttributed) and before agentMemories is saved.
//
// Why (2026-10-06): campaigns were never scored. campaign-lifecycle flips
// endDate → complete and records nothing; a campaign marked complete early is
// reactivated next cycle; nothing anywhere reads whether a campaign reached a person.
// This module:
//   evaluateBets  — for each active campaign with a bet: kill when the per-campaign
//                   number is measured AND below kill.below after kill.byDay; mark
//                   scaleEligible when above scale.above. Never fires on null.
//   scoreBets     — for each campaign reaching a terminal state (killed, complete,
//                   canceled, archived) with a bet and no verdict: won / lost /
//                   inconclusive / unmeasured, with the actual number, n, and a
//                   calibration error. Writes a verified_fact memory to the proposer.
//   buildLedger   — the last LEDGER_CAP verdicts, rebuilt from campaigns each cycle
//                   (so it can never drift from the source), plus per-agent
//                   calibration and the mechanisms never tried.
//   `killed` is terminal. campaign-lifecycle's reactivation loop only touches
//   `complete`, so a killed campaign stays killed without touching that file.
'use strict';

const { MECHANISMS, STALE_VERDICT_DAYS } = require('./bet-schema');

const LEDGER_CAP = 100;
const TERMINAL = new Set(['killed', 'complete', 'completed', 'canceled', 'cancelled', 'archived']);
const MIN_SCORE_POSTS = 8;      // fewer published items than this → inconclusive, never won/lost
const MIN_SCORE_DAYS = 14;      // younger than this → inconclusive
const MEMORY_SOURCE = 'auto:bet-verdict';

function _ts(v) { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : null; }
function _days(fromIso, nowMs) { const t = _ts(fromIso); return t === null ? null : (nowMs - t) / 86400000; }
function _id(prefix) { return prefix + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }

// The per-campaign number a bet is judged on. null = unmeasured.
function campaignMetric(metric, pc) {
  if (!pc) return { value: null, n: 0 };
  if (metric === 'campaign_qualified_uses') return { value: pc.qualifiedUsesAttributed === undefined ? null : pc.qualifiedUsesAttributed, n: pc.qualifiedUsesMeasuredPosts || 0 };
  if (metric === 'campaign_clicks') return { value: Number.isFinite(pc.clicksAttributed) ? pc.clicksAttributed : null, n: pc.postsComplete || 0 };
  return { value: null, n: 0 };
}

function _pcFor(outcomeDigest, campaignId) {
  const list = outcomeDigest && Array.isArray(outcomeDigest.perCampaign) ? outcomeDigest.perCampaign : [];
  return list.find(c => c && c.campaignId === campaignId) || null;
}

// Mutates campaigns in place. Returns { changed, killed: [ids], scaleEligible: [ids], govEvents: [] }.
function evaluateBets(campaigns, outcomeDigest, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nowIso = new Date(now).toISOString();
  const out = { changed: false, killed: [], scaleEligible: [], measurementGaps: [], govEvents: [] };
  (Array.isArray(campaigns) ? campaigns : []).forEach(c => {
    if (!c || c.deletedAt || !c.bet || String(c.status || '').toLowerCase() !== 'active') return;
    const age = _days(c.startDate || c.createdAt, now);
    if (age === null) return;
    const pc = _pcFor(outcomeDigest, c.id);

    // Kill rule
    const k = c.bet.kill || {};
    if (k.metric && Number.isFinite(k.below) && Number.isFinite(k.byDay) && age >= k.byDay) {
      const m = campaignMetric(k.metric, pc);
      if (m.value === null) {
        if (!c.measurementGap) { c.measurementGap = true; c.measurementGapSince = nowIso; out.changed = true; out.measurementGaps.push(c.id); }
      } else {
        if (c.measurementGap) { c.measurementGap = false; out.changed = true; }
        if (m.value < k.below) {
          c.status = 'killed';
          c.killedAt = nowIso;
          c.killedBy = 'code:kill_rule';
          c.killReason = k.metric + ' = ' + m.value + ' (< ' + k.below + ') after day ' + Math.floor(age) + ', measured over ' + m.n + ' posts';
          c.updatedAt = nowIso;
          out.changed = true; out.killed.push(c.id);
          out.govEvents.push({ id: _id('gov-'), type: 'campaign_killed', data: { campaignId: c.id, title: c.title, betKey: c.bet.betKey, metric: k.metric, value: m.value, below: k.below, byDay: k.byDay, n: m.n }, timestamp: nowIso });
          return;
        }
      }
    }
    // Scale rule (flag only — frequency changes stay inside the publish cap, decided elsewhere)
    const s = c.bet.scale || null;
    if (s && s.metric && Number.isFinite(s.above) && Number.isFinite(s.byDay) && age >= s.byDay) {
      const m = campaignMetric(s.metric, pc);
      if (m.value !== null && m.value > s.above && !c.scaleEligible) {
        c.scaleEligible = true; c.scaleEligibleAt = nowIso; c.updatedAt = nowIso;
        out.changed = true; out.scaleEligible.push(c.id);
        out.govEvents.push({ id: _id('gov-'), type: 'campaign_scale_eligible', data: { campaignId: c.id, title: c.title, betKey: c.bet.betKey, metric: s.metric, value: m.value, above: s.above, n: m.n }, timestamp: nowIso });
      }
    }
  });
  return out;
}

// Verdict for one campaign. Pure; does not mutate.
function scoreOne(c, outcomeDigest, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const pc = _pcFor(outcomeDigest, c.id);
  const ex = c.bet.expected || {};
  const metric = c.bet.kill && c.bet.kill.metric ? c.bet.kill.metric : 'campaign_qualified_uses';
  const m = campaignMetric(metric, pc);
  const posts = pc ? (pc.postsPublished || 0) : 0;
  const age = _days(c.startDate || c.createdAt, now);
  const status = String(c.status || '').toLowerCase();
  let result;
  if (m.value === null) result = 'unmeasured';
  else if (status === 'killed') result = 'killed';
  else if (posts < MIN_SCORE_POSTS || age === null || age < MIN_SCORE_DAYS) result = 'inconclusive';
  else result = m.value >= (Number.isFinite(ex.delta) ? ex.delta : 1) ? 'won' : 'lost';
  const expected = Number.isFinite(ex.delta) ? ex.delta : null;
  const calibrationError = (expected !== null && m.value !== null) ? Math.round(Math.abs(expected - m.value) / Math.max(expected, 1) * 100) / 100 : null;
  return {
    result,
    metric,
    actual: { value: m.value, n: m.n, posts, days: age === null ? null : Math.floor(age), source: 'outcomeDigest.perCampaign' },
    expected,
    calibrationError,
    scoredAt: new Date(now).toISOString(),
    scoredBy: 'code'
  };
}

function verdictText(c, v) {
  const key = c.bet && c.bet.betKey ? c.bet.betKey : c.id;
  const a = v.actual || {};
  const base = 'Bet ' + key + ' ' + v.result.toUpperCase() + ' ("' + String(c.title || c.id).slice(0, 50) + '"): ';
  if (v.result === 'unmeasured') return base + 'no attributed measurement over ' + a.posts + ' posts — the pipe, not the idea, is the finding.';
  const body = v.metric + ' = ' + a.value + ' vs expected ' + (v.expected === null ? '?' : v.expected) + ' over ' + a.posts + ' posts / ' + a.days + ' days' + (v.calibrationError !== null ? ' (calibration error ' + v.calibrationError + ')' : '') + '.';
  if (v.result === 'won') return base + body + ' Repeat the mechanism before inventing a new one.';
  if (v.result === 'lost' || v.result === 'killed') return base + body + ' Do not re-propose this betKey without evidence dated after ' + v.scoredAt.slice(0, 10) + '.';
  return base + body + ' Too small to call; say so if you cite it.';
}

// Mutates campaigns (verdict stamped) and memoryStore (one memory to the proposer).
// Returns { scored: [{campaignId, result}], govEvents, memoriesWritten }.
function scoreBets(campaigns, outcomeDigest, memoryStore, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const out = { scored: [], govEvents: [], memoriesWritten: 0, changed: false };
  (Array.isArray(campaigns) ? campaigns : []).forEach(c => {
    if (!c || !c.bet || c.verdict) return;
    if (!TERMINAL.has(String(c.status || '').toLowerCase())) return;
    const v = scoreOne(c, outcomeDigest, now);
    c.verdict = v;
    c.updatedAt = new Date(now).toISOString();
    out.changed = true;
    out.scored.push({ campaignId: c.id, result: v.result, betKey: c.bet.betKey });
    out.govEvents.push({ id: _id('gov-'), type: 'bet_scored', data: { campaignId: c.id, title: c.title, betKey: c.bet.betKey, result: v.result, actual: v.actual, expected: v.expected, calibrationError: v.calibrationError, proposedBy: c.bet.proposedBy || null }, timestamp: v.scoredAt });
    const agent = String(c.bet.proposedBy || '').toLowerCase();
    if (agent && memoryStore) {
      if (!Array.isArray(memoryStore[agent])) memoryStore[agent] = [];
      const already = memoryStore[agent].some(m => m && m.evidence && m.evidence.betKey === c.bet.betKey && m.evidence.campaignId === c.id);
      if (!already) {
        memoryStore[agent].push({
          id: _id('mem-bet-'),
          type: 'verified_fact',
          text: verdictText(c, v).slice(0, 300),
          source: MEMORY_SOURCE,
          timestamp: v.scoredAt,
          expiresAt: new Date(now + STALE_VERDICT_DAYS * 86400000).toISOString(),
          evidence: { campaignId: c.id, betKey: c.bet.betKey, result: v.result, n: v.actual.posts, value: v.actual.value }
        });
        out.memoriesWritten++;
      }
    }
  });
  return out;
}

// Ledger digest for prompts and dashboards. Rebuilt every cycle from campaigns.
function buildLedger(campaigns, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const rows = (Array.isArray(campaigns) ? campaigns : [])
    .filter(c => c && c.bet && c.verdict)
    .map(c => ({
      campaignId: c.id, title: String(c.title || c.id).slice(0, 60), betKey: c.bet.betKey, mechanism: c.bet.mechanism,
      channel: c.bet.channel, product: c.bet.product, proposedBy: c.bet.proposedBy || null,
      result: c.verdict.result, actual: c.verdict.actual, expected: c.verdict.expected,
      calibrationError: c.verdict.calibrationError, scoredAt: c.verdict.scoredAt,
      stale: (_days(c.verdict.scoredAt, now) || 0) > STALE_VERDICT_DAYS,
      ceoNote: c.verdict.ceoNote || null
    }))
    .sort((a, b) => String(b.scoredAt).localeCompare(String(a.scoredAt)))
    .slice(0, LEDGER_CAP);

  const running = (Array.isArray(campaigns) ? campaigns : [])
    .filter(c => c && c.bet && !c.verdict && String(c.status || '').toLowerCase() === 'active')
    .map(c => ({ campaignId: c.id, title: String(c.title || c.id).slice(0, 60), betKey: c.bet.betKey, mechanism: c.bet.mechanism, proposedBy: c.bet.proposedBy || null, startDate: c.startDate || null, kill: c.bet.kill, measurementGap: !!c.measurementGap, scaleEligible: !!c.scaleEligible }));

  const tried = new Set(rows.concat(running).map(r => r.mechanism).filter(Boolean));
  const neverTried = MECHANISMS.filter(m => !tried.has(m));

  const calibration = {};
  rows.filter(r => r.calibrationError !== null && !r.stale).forEach(r => {
    const a = r.proposedBy || 'unknown';
    if (!calibration[a]) calibration[a] = { scored: 0, sumError: 0 };
    calibration[a].scored++; calibration[a].sumError += r.calibrationError;
  });
  Object.keys(calibration).forEach(a => { calibration[a].meanError = Math.round(calibration[a].sumError / calibration[a].scored * 100) / 100; delete calibration[a].sumError; });

  return { generatedAt: new Date(now).toISOString(), rows, running, neverTried, calibration,
    counts: rows.reduce((acc, r) => { acc[r.result] = (acc[r.result] || 0) + 1; return acc; }, {}) };
}

// Prompt text for proposers. ~600 chars typical.
function buildEvidenceBlock(ledger, outcomeDigest, agentId) {
  if (!ledger) return '';
  const lines = ['\nBET LEDGER (what the company has actually learned — cite it, do not contradict it):'];
  const recent = (ledger.rows || []).slice(0, 10);
  if (recent.length) {
    recent.forEach(r => {
      const a = r.actual || {};
      lines.push('- ' + r.result.toUpperCase() + (r.stale ? ' (stale)' : '') + ' ' + r.betKey + ': ' + (a.value === null || a.value === undefined ? 'unmeasured' : a.value + ' vs expected ' + r.expected) + ' over ' + (a.posts || 0) + ' posts' + (r.ceoNote ? ' — CEO: "' + String(r.ceoNote).slice(0, 80) + '"' : ''));
    });
  } else {
    lines.push('- No bet has been scored yet. Every campaign before 2026-10-06 ended unscored.');
  }
  if ((ledger.running || []).length) {
    lines.push('RUNNING: ' + ledger.running.map(r => r.betKey + (r.measurementGap ? ' [unmeasured — raise it]' : '') + (r.scaleEligible ? ' [scale-eligible]' : '')).join('; '));
  }
  if ((ledger.neverTried || []).length) lines.push('MECHANISMS NEVER TRIED: ' + ledger.neverTried.join(', ') + '. A bet on one of these needs no prior verdict; a bet on a tried one must cite its row.');
  const cal = ledger.calibration && ledger.calibration[agentId];
  if (cal) lines.push('YOUR CALIBRATION: mean error ' + cal.meanError + ' over ' + cal.scored + ' scored bets (0 = your expected effects match reality).');
  const perChannel = {};
  ((outcomeDigest && outcomeDigest.perCampaign) || []).forEach(c => {
    if (!c || !c.postsPublished) return;
    const ch = c.channel || 'all';
    if (!perChannel[ch]) perChannel[ch] = { posts: 0, people: 0, measured: 0 };
    perChannel[ch].posts += c.postsPublished;
    if (typeof c.qualifiedUsesAttributed === 'number') { perChannel[ch].people += c.qualifiedUsesAttributed; perChannel[ch].measured += c.qualifiedUsesMeasuredPosts || 0; }
  });
  const chKeys = Object.keys(perChannel);
  if (chKeys.length) lines.push('PEOPLE PER POST (all campaigns): ' + chKeys.map(k => k + ' ' + perChannel[k].people + '/' + perChannel[k].posts + (perChannel[k].measured < perChannel[k].posts ? ' (' + perChannel[k].measured + ' measured)' : '')).join('; '));
  lines.push('Rules: a proposal must be a bet {mechanism, product, channel, hypothesis, evidence:[{metric,k,n,window,source,asOf}], expected:{metric,delta,byDay}, kill:{metric,below,byDay}}. A betKey that LOST or was KILLED in the last 60 days is blocked unless your evidence asOf is newer than the verdict.');
  return lines.join('\n') + '\n';
}

module.exports = { evaluateBets, scoreBets, scoreOne, buildLedger, buildEvidenceBlock, campaignMetric, verdictText, LEDGER_CAP, MIN_SCORE_POSTS, MIN_SCORE_DAYS, MEMORY_SOURCE, TERMINAL };
