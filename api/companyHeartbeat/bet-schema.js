// bet-schema.js — every campaign proposal is a pre-registered bet.
//
// Pure. No I/O. Used by agent-runner (propose-campaign), proposalDecide
// (materialize), bet-ledger (kill / scale / score) and prompt-builders (evidence).
//
// Why (2026-10-06): proposals were "post on platform X about product Y N times a
// week", judged by title similarity ≥ 0.6 and an exact-name reject cooldown. Thirteen
// rewordings of the same AmbientScore campaign reached the queue in 18 days, none
// stated what would count as failure, and no campaign has ever been scored. A bet
// has a fingerprint (betKey) that a reworded title cannot dodge, evidence with a
// denominator, an expected effect on the north star, and a kill rule evaluated in
// code against a per-campaign number. A `lost` or `killed` betKey is blocked for
// LOST_BLOCK_DAYS unless the new evidence is dated after the verdict.
'use strict';

// Closed list. Adding a mechanism is a code change on purpose: the list is also the
// "mechanisms never tried" prompt, and a free-text mechanism would let a reworded
// broadcast campaign look novel.
const MECHANISMS = [
  'search_page',        // a page written to rank for a query people actually type
  'directory_listing',  // Product Hunt, AI directories, top.gg, awesome-lists
  'community_reply',    // replies into threads where someone is asking (CEO-approved, named people)
  'broadcast_post',     // original posts to our own followers
  'weekly_scoreboard',  // one weekly numbers post replacing daily broadcast
  'tool_or_utility',    // a free tool / embed / badge that earns a link or a use
  'partnership',        // another account or product sends people
  'email',              // owned list
  'copy_variant'        // an A/B inside an existing campaign (experiments live here)
];

const METRICS = ['qualified_uses_week', 'campaign_qualified_uses', 'campaign_clicks'];
const LOST_BLOCK_DAYS = 60;
const STALE_VERDICT_DAYS = 90;
const MAX_DURATION_DAYS = 56;
const MIN_KILL_DAY = 7;

function _str(v, n) { return String(v == null ? '' : v).trim().slice(0, n || 200); }
function _norm(v) { return _str(v, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function _num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function _isoDay(v) { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; }

// mechanism|product|channel|audience — normalized, order fixed.
function computeBetKey(bet) {
  const b = bet || {};
  // mechanism is an enum slug already (underscores kept); the free-text parts are normalized.
  return [_str(b.mechanism, 40).toLowerCase(), _norm(b.product), _norm(b.channel), _norm(b.audience) || 'any'].join('|');
}

// Returns { ok, errors: [], bet } where bet is the normalized object to store.
// Required: mechanism (enum), product, channel, hypothesis, evidence[] each with
// metric, k, n, window, source (asOf optional), expected {metric, delta, byDay},
// kill {metric, below, byDay}. Optional: audience, scale {metric, above, byDay}.
function validateBet(input, opts) {
  const o = opts || {};
  const errors = [];
  const b = input && typeof input === 'object' ? input : {};
  const mechanism = _str(b.mechanism, 40).toLowerCase();
  if (MECHANISMS.indexOf(mechanism) === -1) errors.push('mechanism must be one of: ' + MECHANISMS.join(', '));
  const product = _str(b.product, 60);
  if (!product) errors.push('product is required');
  const channel = _str(b.channel, 60);
  if (!channel) errors.push('channel is required (platform, "google", "producthunt", ...)');
  const hypothesis = _str(b.hypothesis, 400);
  if (hypothesis.length < 20) errors.push('hypothesis must be a sentence (>= 20 chars)');

  const evidence = Array.isArray(b.evidence) ? b.evidence : [];
  if (!evidence.length) errors.push('evidence[] is required: at least one {metric, k, n, window, source}');
  const evOut = [];
  evidence.slice(0, 5).forEach((e, i) => {
    const k = _num(e && e.k), n = _num(e && e.n);
    const metric = _str(e && e.metric, 60), window = _str(e && e.window, 30), source = _str(e && e.source, 120);
    if (!metric) errors.push('evidence[' + i + '].metric is required');
    if (n === null || n <= 0) errors.push('evidence[' + i + '].n must be a positive number (the denominator)');
    if (k === null || k < 0) errors.push('evidence[' + i + '].k must be a number >= 0');
    if (k !== null && n !== null && k > n) errors.push('evidence[' + i + '].k cannot exceed n');
    if (!window) errors.push('evidence[' + i + '].window is required (e.g. "30d")');
    if (!source) errors.push('evidence[' + i + '].source is required (where the number comes from)');
    evOut.push({ metric, k, n, window, source, asOf: _isoDay(e && e.asOf) || _isoDay(o.nowMs ? new Date(o.nowMs).toISOString() : new Date().toISOString()) });
  });

  const ex = b.expected && typeof b.expected === 'object' ? b.expected : {};
  const exMetric = _str(ex.metric, 60), exDelta = _num(ex.delta), exBy = _num(ex.byDay);
  if (METRICS.indexOf(exMetric) === -1) errors.push('expected.metric must be one of: ' + METRICS.join(', '));
  if (exDelta === null || exDelta <= 0) errors.push('expected.delta must be a positive number (people, not likes)');
  if (exBy === null || exBy < MIN_KILL_DAY || exBy > MAX_DURATION_DAYS) errors.push('expected.byDay must be between ' + MIN_KILL_DAY + ' and ' + MAX_DURATION_DAYS);

  const kl = b.kill && typeof b.kill === 'object' ? b.kill : {};
  const klMetric = _str(kl.metric, 60), klBelow = _num(kl.below), klBy = _num(kl.byDay);
  if (['campaign_qualified_uses', 'campaign_clicks'].indexOf(klMetric) === -1) errors.push('kill.metric must be campaign_qualified_uses or campaign_clicks (a per-campaign number)');
  if (klBelow === null || klBelow < 1) errors.push('kill.below must be >= 1 (a kill rule that fires on 0 fires on an unmeasured pipe)');
  if (klBy === null || klBy < MIN_KILL_DAY || klBy > MAX_DURATION_DAYS) errors.push('kill.byDay must be between ' + MIN_KILL_DAY + ' and ' + MAX_DURATION_DAYS);
  if (exBy !== null && klBy !== null && klBy > exBy) errors.push('kill.byDay must not be later than expected.byDay');

  let scale = null;
  if (b.scale && typeof b.scale === 'object') {
    const scMetric = _str(b.scale.metric, 60), scAbove = _num(b.scale.above), scBy = _num(b.scale.byDay);
    if (['campaign_qualified_uses', 'campaign_clicks'].indexOf(scMetric) === -1) errors.push('scale.metric must be a per-campaign number');
    if (scAbove === null || scAbove < 1) errors.push('scale.above must be >= 1');
    if (scBy === null || scBy < MIN_KILL_DAY || scBy > MAX_DURATION_DAYS) errors.push('scale.byDay out of range');
    scale = { metric: scMetric, above: scAbove, byDay: scBy };
  }

  const bet = {
    mechanism, product, channel, audience: _str(b.audience, 80) || null,
    hypothesis,
    evidence: evOut,
    expected: { metric: exMetric, delta: exDelta, byDay: exBy },
    kill: { metric: klMetric, below: klBelow, byDay: klBy },
    scale,
    betKey: ''
  };
  bet.betKey = computeBetKey(bet);
  return { ok: errors.length === 0, errors, bet: errors.length === 0 ? bet : null };
}

function _daysBetween(aIso, bMs) { const t = Date.parse(aIso || ''); return Number.isFinite(t) ? (bMs - t) / 86400000 : null; }

// Dedup against existing campaigns (any status) and ledger rows.
// Returns { blocked, reason, matchId } — reason is the gate name for governance.
function checkBetKeyAgainst(betKey, newestEvidenceAsOf, campaigns, ledgerRows, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const newestEv = Date.parse(newestEvidenceAsOf || '') || 0;
  const camps = Array.isArray(campaigns) ? campaigns : [];
  const rows = Array.isArray(ledgerRows) ? ledgerRows : [];

  // 1. Already running (active or paused) with the same key.
  const live = camps.find(c => c && !c.deletedAt && c.bet && c.bet.betKey === betKey && (c.status === 'active' || c.status === 'paused'));
  if (live) return { blocked: true, reason: 'betkey_already_running', matchId: live.id };

  // 2. Lost or killed within LOST_BLOCK_DAYS, unless the evidence is newer than the verdict.
  const verdicts = rows.filter(r => r && r.betKey === betKey && (r.result === 'lost' || r.result === 'killed'))
    .concat(camps.filter(c => c && c.bet && c.bet.betKey === betKey && c.verdict && (c.verdict.result === 'lost' || c.verdict.result === 'killed'))
      .map(c => ({ betKey: betKey, result: c.verdict.result, scoredAt: c.verdict.scoredAt, campaignId: c.id })));
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i];
    const age = _daysBetween(v.scoredAt, now);
    if (age === null || age > LOST_BLOCK_DAYS) continue;
    const scoredMs = Date.parse(v.scoredAt || '') || 0;
    if (newestEv > scoredMs) continue; // newer evidence clears the block
    return { blocked: true, reason: 'betkey_lost_recently', matchId: v.campaignId || null, scoredAt: v.scoredAt, result: v.result };
  }
  return { blocked: false, reason: null, matchId: null };
}

function newestEvidenceAsOf(bet) {
  const ev = (bet && Array.isArray(bet.evidence)) ? bet.evidence : [];
  return ev.map(e => e && e.asOf).filter(Boolean).sort().pop() || null;
}

module.exports = {
  MECHANISMS, METRICS, LOST_BLOCK_DAYS, STALE_VERDICT_DAYS, MAX_DURATION_DAYS, MIN_KILL_DAY,
  validateBet, computeBetKey, checkBetKeyAgainst, newestEvidenceAsOf
};
