// bluesky-sensor.js — Bluesky thread discovery, as a sensor rather than a thought.
//
// This logic used to live inline in runAgentHeartbeat() under
// `if (agentId === 'scout')`. The idle-agent gate (2026-08-07) skips any agent
// with no assigned tasks BEFORE runAgentHeartbeat is called, so the sensor
// stopped firing the day the gate shipped: Scout was skipped with
// no_assigned_tasks_or_mentions in all 7 cycles that followed, and
// blueskyCandidates went 25.7h stale against a 2h cooldown. A sensor that stops
// producing looks exactly like a quiet week, so nothing alerted.
//
// The root cause is that this was never deliberation. There is no LLM call
// here: it is an HTTP search plus arithmetic. Gating it on whether an agent has
// something to think about was a category error. It now lives in its own module
// and runs from asProspectCron (already on `0 25 */2 * * *`, the same cadence
// as this cooldown) as well as from the Scout path, which still works when
// Scout does have tasks. The cooldown makes the double call a no-op.
//
// Pure cores + IO shell, house pattern (prospect-pipeline.js / rewards-engine.js).

'use strict';

const DEFAULTS = {
  cooldownMs: 2 * 60 * 60 * 1000,
  storeCap: 200,
  dismissedRetentionMs: 7 * 24 * 60 * 60 * 1000,
  repliedDedupeMs: 7 * 24 * 60 * 60 * 1000,
  minScore: 40,
  maxAgeMinutes: 120,
  minReplies: 1,
  limitPerKeyword: 25
};

const FALLBACK_KEYWORDS = ['AI agents', 'indie hacker', 'solo founder', 'build in public'];

function _ts(v) {
  const n = Date.parse(v || '');
  return Number.isFinite(n) ? n : null;
}

// ── pure cores ──

/**
 * Reads the NEWEST discoveredAt, not the last array slot. Pruning and the cap
 * reorder this array, so trusting the tail let a stale entry park at the end and
 * hold the sensor shut.
 */
function isCooldownElapsed(candidates, now, cooldownMs) {
  let newest = 0;
  (Array.isArray(candidates) ? candidates : []).forEach(function (c) {
    const t = c && _ts(c.discoveredAt);
    if (t && t > newest) newest = t;
  });
  return (now - newest) >= cooldownMs;
}

/** Relevance score, 0-100ish. Never negative, never NaN, each term capped. */
function scoreCandidate(raw, now, intentScoreFn) {
  raw = raw || {};
  const indexed = _ts(raw.indexedAt);
  const ageMinutes = indexed ? (now - indexed) / 60000 : Infinity;
  // 30 at 0 min, 0 at 2h. Clamped at 0 so an old but well-engaged thread is not
  // dragged below the intent threshold by age alone.
  const recency = Number.isFinite(ageMinutes) ? Math.max(0, 30 - Math.floor(ageMinutes / 4)) : 0;
  const engagement = Math.min(30, (Number(raw.replyCount) || 0) * 3 + (Number(raw.likeCount) || 0));
  const velocity = Math.min(20, Math.floor((Number(raw._velocity) || 0) * 100));
  let keyword = 0;
  if (typeof intentScoreFn === 'function') {
    try { keyword = Number(intentScoreFn(raw.text || '')) || 0; } catch (e) { keyword = 0; }
  }
  const score = recency + engagement + velocity + keyword;
  return Number.isFinite(score) ? Math.max(0, score) : 0;
}

/** URIs we already hold, plus URIs we already have a reply task for. */
function collectExistingUris(candidates, tasks) {
  const seen = new Set();
  (Array.isArray(candidates) ? candidates : []).forEach(function (c) {
    if (c && c.uri) seen.add(c.uri);
  });
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t || !Array.isArray(t.tags) || t.tags.indexOf('bluesky-reply') === -1) return;
    if (t.threadContext && t.threadContext.uri) seen.add(t.threadContext.uri);
  });
  return seen;
}

/**
 * Drop aged-out dismissals, then cap by KEEPING THE NEWEST. The old version
 * sliced the tail of an append-ordered array, which is only the same thing for
 * as long as nothing ever reorders it.
 */
function pruneCandidates(candidates, now, cap, retentionMs) {
  const keepFor = Number.isFinite(retentionMs) ? retentionMs : DEFAULTS.dismissedRetentionMs;
  let out = (Array.isArray(candidates) ? candidates : []).filter(function (c) {
    if (!c) return false;
    if (c.status !== 'dismissed') return true;
    const d = _ts(c.discoveredAt) || 0;
    return (now - d) < keepFor;
  });
  const limit = Number.isFinite(cap) ? cap : DEFAULTS.storeCap;
  if (out.length > limit) {
    out = out.slice().sort(function (a, b) {
      return (_ts(a.discoveredAt) || 0) - (_ts(b.discoveredAt) || 0);
    }).slice(out.length - limit);
  }
  return out;
}

// ── IO shell ──

/**
 * Runs one discovery pass. Never throws: a sensor failure must not take down
 * whatever is hosting it.
 * @returns {Promise<{ran:boolean, reason?:string, added?:number, skipped?:number, total?:number}>}
 */
async function runBlueskyDiscovery(deps) {
  const storage = deps && deps.storage;
  const log = (deps && deps.log) || function () {};
  const now = (deps && deps.now) || Date.now();
  if (!storage) return { ran: false, reason: 'no_storage' };

  try {
    let candidates = (await storage.getState('blueskyCandidates')) || [];
    if (!Array.isArray(candidates)) candidates = [];

    // Number.isFinite, not `||`: a caller passing 0 to mean "no cooldown, run
    // now" hits the falsy branch and silently gets the 2h default back, so the
    // override looks accepted and does nothing.
    const cooldownMs = (deps && Number.isFinite(deps.cooldownMs)) ? deps.cooldownMs : DEFAULTS.cooldownMs;
    if (!isCooldownElapsed(candidates, now, cooldownMs)) {
      return { ran: false, reason: 'cooldown', total: candidates.length };
    }

    const discovery = require('../_utils/blueskyDiscovery');

    // Keywords: systemConfig.blueskyKeywords is dashboard-editable and wins;
    // the JSON file is the fallback.
    let kw = null;
    try {
      const cfg = (await storage.getState('systemConfig')) || {};
      if (cfg.blueskyKeywords && Array.isArray(cfg.blueskyKeywords.keywords)) kw = cfg.blueskyKeywords;
    } catch (e) { /* fall through to file */ }
    if (!kw) {
      try { kw = require('../_data/bluesky-discovery-keywords.json'); } catch (e) { /* defaults */ }
    }
    if (!kw || !Array.isArray(kw.keywords) || !kw.keywords.length) kw = { keywords: FALLBACK_KEYWORDS, filters: {} };
    const filters = kw.filters || {};

    const rawCandidates = await discovery.discoverAcrossKeywords(kw.keywords, {
      maxAgeMinutes: filters.maxAgeMinutes || DEFAULTS.maxAgeMinutes,
      minReplies: filters.minReplies || DEFAULTS.minReplies,
      limitPerKeyword: DEFAULTS.limitPerKeyword
    });
    log('[bluesky-sensor] discovery found ' + rawCandidates.length + ' raw candidates');

    // The heartbeat already holds the board; a cron does not. Only fetch when
    // the caller cannot hand it over.
    let tasks = (deps && Array.isArray(deps.tasks)) ? deps.tasks : null;
    if (!tasks) {
      try { tasks = (await storage.getState('tasks')) || []; } catch (e) { tasks = []; }
    }
    const seen = collectExistingUris(candidates, tasks);

    const minScore = Number.isFinite(filters.minScore) ? filters.minScore : DEFAULTS.minScore;
    let added = 0, skipped = 0;
    for (const c of rawCandidates) {
      if (!c || !c.uri || seen.has(c.uri)) continue;
      const score = scoreCandidate(c, now, discovery.intentScore);
      if (score < minScore) { skipped++; continue; }
      seen.add(c.uri);
      candidates.push({
        id: 'bsc-' + now + '-' + Math.random().toString(36).substr(2, 6),
        uri: c.uri,
        cid: c.cid,
        author: c.author,
        authorDid: c.authorDid,
        text: (c.text || '').substring(0, 500),
        indexedAt: c.indexedAt,
        replyCount: c.replyCount,
        repostCount: c.repostCount,
        likeCount: c.likeCount,
        matchedKeyword: c._matchedKeyword || null,
        score: score,
        status: 'new', // new | dismissed | replied
        discoveredAt: new Date(now).toISOString()
      });
      added++;
    }

    candidates = pruneCandidates(candidates, now, DEFAULTS.storeCap, DEFAULTS.dismissedRetentionMs);
    await storage.setState('blueskyCandidates', candidates);
    log('[bluesky-sensor] complete. ' + added + ' new, ' + skipped
      + ' below intent threshold, ' + candidates.length + ' stored');
    return { ran: true, added: added, skipped: skipped, total: candidates.length };
  } catch (err) {
    log('[bluesky-sensor] failed: ' + String((err && err.message) || err).substring(0, 200));
    return { ran: false, reason: 'error', error: String((err && err.message) || err).substring(0, 200) };
  }
}

module.exports = {
  runBlueskyDiscovery,
  isCooldownElapsed,
  scoreCandidate,
  collectExistingUris,
  pruneCandidates,
  DEFAULTS
};
