// bluesky-participation.js — auto-draft lane for discovered Bluesky threads.
//
// blueskyCandidates held 200 threads discovered since 2026-07-02 and exactly ONE
// had ever been drafted, because drafting meant a human clicking each candidate
// on modules/company/bluesky-discovery.html. Discovery worked (until the idle
// gate killed it — see bluesky-sensor.js); conversion never did. This closes
// that half: the top-scoring fresh candidates become CEO-gated draft tasks on
// their own.
//
// WHAT MAKES THIS NOT THE PROSPECT PIPELINE
// The AS prospect lane was disabled 2026-08-05 after 40 replies produced 0
// clicks. It was outbound SALES measured on clicks. This is participation
// measured on followers: a reply in a stranger's thread is seen by everyone
// reading that thread, which is the only reach an 82-follower account can buy.
// The constraint that keeps the two apart is absolute — a participation reply
// carries NO link and mentions NO product. If that slips, this becomes the thing
// that already failed.
//
// Two pieces of existing machinery would break that constraint on their own, and
// bluesky-participation.test.js pins both: agent-runner.js appends a product URL
// to any bluesky-reply task that carries a [SCAN RESULT] comment (~2050) or a
// destinationUrl (~2059). Tasks from this lane must carry neither.
//
// Pure cores + IO shell, house pattern (prospect-pipeline.js / engagement-reply.js).

'use strict';

var { relevanceVerdict } = require('./bluesky-relevance');
var _BP = require('./_utils/laneBackpressure');

var DEFAULTS = {
  enabled: false,             // OFF until switched on. A new outbound lane never self-starts.
  maxPerDay: 2,               // deliberately small: this talks to strangers as the brand
  perAuthorCooldownDays: 14,
  maxAgeHours: 12,            // beyond this the thread has moved on and a reply is shouting
  // Discovery keeps >= 40. This was 55 when the score was the ONLY quality gate.
  // It is not any more: bluesky-relevance.js now decides fit deterministically,
  // and the score only measures popularity — recency + engagement + keyword hit.
  // Holding 55 re-introduced exactly the popularity bias relevance exists to
  // remove. Measured on the first live run with retargeted keywords: three
  // candidates, one PASSED relevance (a real first-person thread about agent
  // reliability) and was dropped solely for scoring 42. Lowered to keep a floor
  // of freshness and audience-size — a thread nobody reads is still worthless —
  // while letting relevance make the quality call.
  minScore: 45,
  minTextLength: 40           // a three-word post gives nothing specific to answer
};

function loadConfig(systemConfig) {
  var raw = (systemConfig && systemConfig.blueskyParticipation) || {};
  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    cfg[k] = (raw[k] === undefined || raw[k] === null) ? DEFAULTS[k] : raw[k];
  });
  cfg.enabled = raw.enabled === true; // only an explicit true counts
  return cfg;
}

function _dayKey(iso) { return String(iso || '').substring(0, 10); }
function _ts(v) { var n = Date.parse(v || ''); return Number.isFinite(n) ? n : null; }
function _authorKey(a) { return String(a || '').toLowerCase(); }

/**
 * 'new' candidates → the ones worth drafting, with a per-rule drop count.
 * Counting every drop is not decoration: a silent cap reads as "nothing was out
 * there" and that is how a dead lane goes unnoticed for five weeks.
 */
function selectForDrafting(candidates, tasks, cfg, nowMs) {
  var drops = {
    not_new: 0, too_old: 0, low_score: 0, too_short: 0,
    already_tasked: 0, author_cooldown: 0, daily_budget: 0,
    // Per-reason relevance drops, merged in below. Kept separate from the rest
    // so "we found nothing" and "we found 40 political threads" do not look the
    // same in the log.
    irrelevant: 0
  };
  var maxAgeMs = cfg.maxAgeHours * 3600e3;
  var cooldownMs = cfg.perAuthorCooldownDays * 86400e3;
  var today = _dayKey(new Date(nowMs).toISOString());

  // History from EVERY bluesky-reply task, not just this lane's, so the prospect
  // and participation lanes cannot tag-team the same stranger.
  var taskedUris = {};
  var lastTouch = {};
  var draftedToday = 0;
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t || !Array.isArray(t.tags) || t.tags.indexOf('bluesky-reply') === -1) return;
    var tc = t.threadContext || {};
    if (tc.uri) taskedUris[tc.uri] = true;
    var when = _ts(t.createdAt) || 0;
    if (tc.author) {
      var a = _authorKey(tc.author);
      lastTouch[a] = Math.max(lastTouch[a] || 0, when);
    }
    // Budget counts only this lane; the others carry their own caps.
    if (t.tags.indexOf('participation') !== -1 && _dayKey(t.createdAt) === today) draftedToday++;
  });
  var budget = Math.max(0, cfg.maxPerDay - draftedToday);

  // Best thread first. Unlike engagement-reply (oldest-first, because those are
  // people waiting on us), nobody here is waiting — so take the strongest.
  var pool = (Array.isArray(candidates) ? candidates : []).filter(Boolean).slice()
    .sort(function (a, b) { return (Number(b.score) || 0) - (Number(a.score) || 0); });

  var survivors = [];
  pool.forEach(function (c) {
    if (c.status !== 'new') { drops.not_new++; return; }
    var age = nowMs - (_ts(c.indexedAt) || _ts(c.discoveredAt) || 0);
    if (!Number.isFinite(age) || age > maxAgeMs) { drops.too_old++; return; }
    if ((Number(c.score) || 0) < cfg.minScore) { drops.low_score++; return; }
    if (String(c.text || '').trim().length < cfg.minTextLength) { drops.too_short++; return; }
    // "Do we belong in this thread?" — a different question from "is this thread
    // busy?", which is all the discovery score can answer. Without this, the top
    // of the real queue was politics, news commentary and one NSFW art post.
    var rel = relevanceVerdict(c.text);
    if (!rel.ok) {
      drops.irrelevant++;
      drops['irrelevant_' + rel.reason] = (drops['irrelevant_' + rel.reason] || 0) + 1;
      return;
    }
    if (c.uri && taskedUris[c.uri]) { drops.already_tasked++; return; }
    var ak = _authorKey(c.author);
    var t = lastTouch[ak];
    if (Number.isFinite(t) && t > 0 && (nowMs - t) < cooldownMs) { drops.author_cooldown++; return; }
    if (budget <= 0) { drops.daily_budget++; return; }
    budget--;
    lastTouch[ak] = nowMs;      // one per author per run
    if (c.uri) taskedUris[c.uri] = true;
    survivors.push(c);
  });

  return { survivors: survivors, drops: drops };
}

/**
 * The Scribe draft task. Shape matches what the dashboard's "Draft Reply" button
 * creates, so agent-runner's existing bluesky-reply routing, quality gate and
 * approval-queue path all work unchanged.
 *
 * Carries NO destinationUrl and NO [SCAN RESULT] comment — both are link
 * injection triggers in agent-runner.
 */
function buildParticipationTask(candidate, nowMs) {
  var c = candidate || {};
  var now = new Date(nowMs).toISOString();
  return {
    id: 'task_' + nowMs + '_bsp_' + Math.random().toString(36).substr(2, 4),
    title: 'Draft Bluesky reply to @' + (c.author || 'unknown'),
    description: 'Reply to this Bluesky thread as a person, not as a brand.\n\n'
      + 'Author: @' + (c.author || 'unknown') + '\n'
      + 'Thread URI: ' + (c.uri || '') + '\n'
      + 'Engagement: ' + (c.replyCount || 0) + ' replies, ' + (c.likeCount || 0) + ' likes\n\n'
      + 'ORIGINAL POST:\n"' + String(c.text || '').substring(0, 500) + '"\n\n'
      + 'THIS IS A PARTICIPATION REPLY. Its only job is to be worth reading. We are\n'
      + 'not selling anything here. The value to us is being visible in someone\n'
      + "else's thread, and that only works if the reply earns its place.\n\n"
      + 'HARD RULES:\n'
      + '- Do NOT include any link. Not ours, not theirs, not anyone\'s.\n'
      + '- Do NOT mention AmbientPixels, AmbientOS, AmbientScore, Resume Roast,\n'
      + '  Pixel Agents, or any other product. Not by name, not by description.\n'
      + '- Do NOT pitch, offer, invite, or hint. No "we built", no "check out",\n'
      + '  no "DM me", no "happy to share".\n'
      + '- Say something specific about what they actually wrote. React to their\n'
      + '  situation, not to the topic in general.\n'
      + '- If you have nothing specific worth adding, LEAVE YOUR DELIVERABLE EMPTY\n'
      + '  and explain why in a task comment. Do not write "nothing to add" or any\n'
      + '  other refusal as the deliverable: the deliverable IS the reply and it\n'
      + '  would be posted verbatim. Only an empty one is understood as a decline.\n'
      + '  A skipped reply costs nothing; a generic one costs the account.\n'
      + '- Under 280 characters. No em dashes. No hype. Proper sentence case.\n\n'
      + 'Output ONLY the reply text. No preamble, no labels, no quotes around it.',
    taskType: 'bluesky_reply',
    category: 'maintenance',
    status: 'todo',
    priority: 'medium',
    assignee: 'scribe',
    source: 'participation-lane',
    created_by: 'system',
    createdAt: now,
    updatedAt: now,
    dueDate: new Date(nowMs + 24 * 3600e3).toISOString(),
    tags: ['bluesky-reply', 'participation'],
    threadContext: {
      uri: c.uri,
      cid: c.cid,
      author: c.author,
      authorDid: c.authorDid,
      originalText: c.text,
      replyCount: c.replyCount,
      likeCount: c.likeCount,
      indexedAt: c.indexedAt
    }
  };
}

// ── IO shell ──

/**
 * One pass. Never throws — a lane failure must not take down its host cron.
 */
async function runParticipationLane(deps) {
  var storage = deps && deps.storage;
  var log = (deps && deps.log) || function () {};
  var now = (deps && deps.now) || Date.now();
  if (!storage) return { ran: false, reason: 'no_storage' };

  try {
    var systemConfig = (await storage.getState('systemConfig')) || {};
    var cfg = loadConfig(systemConfig);
    if (!cfg.enabled) return { ran: false, reason: 'disabled' };

    var candidates = (await storage.getState('blueskyCandidates')) || [];
    if (!Array.isArray(candidates)) candidates = [];
    var tasks = (await storage.getState('tasks')) || [];
    if (!Array.isArray(tasks)) tasks = [];

    var picked = selectForDrafting(candidates, tasks, cfg, now);
    if (!picked.survivors.length) {
      log('[participation] nothing drafted. drops: ' + JSON.stringify(picked.drops));
      return { ran: true, drafted: 0, drops: picked.drops };
    }

    // Backpressure. maxPerDay=2 is small, but this is the third lane feeding the same
    // Scribe reply queue (roast + AS prospects are the others) and three small rates
    // still summed to 21 tasks a day against a drain of ~8. Depth is shared because
    // the queue is shared. Survivors that do not fit keep their 'new' status and are
    // reconsidered next run, subject to the usual maxAgeHours staleness rule.
    var _cap = _BP.laneCapacity(tasks, 'scribe', 'bluesky_reply');
    if (_cap.remaining < picked.survivors.length) {
      log('[participation] backpressure: scribe holds ' + _cap.open + '/' + _cap.depth
        + ' open reply tasks, drafting ' + _cap.remaining + ' of ' + picked.survivors.length);
      picked.survivors = picked.survivors.slice(0, _cap.remaining);
      if (!picked.survivors.length) {
        picked.drops.lane_backpressure = (picked.drops.lane_backpressure || 0) + 1;
        return { ran: true, drafted: 0, drops: picked.drops };
      }
    }

    var created = [];
    picked.survivors.forEach(function (c) {
      var task = buildParticipationTask(c, now);
      tasks.push(task);
      created.push({ taskId: task.id, uri: c.uri, author: c.author, score: c.score });
      // 'replied' is the dashboard's own word for "handled" — it sets exactly
      // this when its Draft Reply button creates a task. Reusing it keeps the
      // candidate out of the manual queue without inventing a status the UI
      // does not render.
      var stored = candidates.find(function (x) { return x && x.uri === c.uri; });
      if (stored) {
        stored.status = 'replied';
        stored.taskId = task.id;
        stored.draftedBy = 'participation-lane';
        stored.draftedAt = new Date(now).toISOString();
      }
    });

    await storage.setState('tasks', tasks);
    await storage.setState('blueskyCandidates', candidates);
    log('[participation] drafted ' + created.length + ' reply task(s): '
      + created.map(function (x) { return '@' + x.author + ' (' + x.score + ')'; }).join(', ')
      + ' | drops: ' + JSON.stringify(picked.drops));
    return { ran: true, drafted: created.length, created: created, drops: picked.drops };
  } catch (err) {
    log('[participation] failed: ' + String((err && err.message) || err).substring(0, 200));
    return { ran: false, reason: 'error', error: String((err && err.message) || err).substring(0, 200) };
  }
}

module.exports = {
  runParticipationLane,
  loadConfig,
  selectForDrafting,
  buildParticipationTask,
  DEFAULTS
};
