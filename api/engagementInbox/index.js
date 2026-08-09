// engagementInbox — every real interaction with our posts, as readable rows.
// GET /api/engagement-inbox?limit=50
//
// WHY THIS EXISTS
//
// The Analytics Hub could tell you a post had 1 comment. It could not tell you
// who wrote it, what they said, or which post they were replying to — so the one
// thing a human can actually act on was the one thing the dashboard withheld.
//
// Meanwhile companyHeartbeat/engagement-reply.js has been harvesting exactly
// that into an `engagementReplies` store since 2026-07-28 — author handle, their
// full text, our post's text, timestamp, and whether a draft reply was queued —
// and NOTHING read it. No endpoint, no dashboard, no prompt. Every human reply
// to our posts was being captured and shown to no one. This is the reader.
//
// At current volume (195 posts → 65 interactions in four months) aggregate
// charts are the wrong instrument. You do not need a dashboard for 17
// interactions; you need to read all of them. So this returns rows, not totals.
//
// SCOPE, stated because it is easy to mistake for a bug: replies are BLUESKY
// only. engagement-reply harvests via AT Protocol getPostThread, which is free
// and public; X and LinkedIn have no equivalent we pay for. Likes and reposts
// come from the snapshot store and cover all three platforms, so the inbox shows
// X and LinkedIn engagement as counts without conversation. `coverage` in the
// response says so explicitly rather than letting silence read as "nobody
// replied".

const storage = require('../_utils/companyStorage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  // X-AmbientOS-Key is not validated by anything server-side, but the hub's
  // shared fetch helper can attach it — and a header missing from this list
  // fails CORS preflight, which surfaces as a dead panel rather than a 403.
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal, X-AmbientOS-Key',
  'Content-Type': 'application/json'
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_DAYS = 30;

function parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(n, 90);
}

// at://did:plc:xxx/app.bsky.feed.post/rkey → https://bsky.app/profile/did/post/rkey
// bsky.app resolves a DID in the profile slot, so no handle lookup is needed —
// which matters because the handle can change and the DID cannot.
function blueskyUrl(atUri) {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/.exec(String(atUri || ''));
  if (!m) return '';
  return 'https://bsky.app/profile/' + m[1] + '/post/' + m[2];
}

/**
 * Why a 'new' entry was never drafted, and whether a human can force it.
 *
 * 'new' is not a queue. companyHeartbeat/engagement-reply.js drops a comment
 * permanently once it is older than maxAgeHours (72 by default), so an entry can
 * sit at 'new' forever with nothing coming for it. Labelling that "needs a
 * reply" was true about the human and false about the machine.
 *
 * Rules are not reimplemented — filterCandidates() is asked directly, twice: as
 * the cron would run it (what stopped this?) and with the age gate lifted (would
 * the button work?). Failing softly is deliberate: an inbox that cannot explain
 * itself must still show the conversations.
 */
function annotateBlocked(store, cfg, nowMs) {
  const out = {};
  let filterCandidates;
  let OVERRIDE_CONFIG;
  try {
    filterCandidates = require('../companyHeartbeat/engagement-reply').filterCandidates;
    OVERRIDE_CONFIG = require('../engagementReplyDraft').OVERRIDE_CONFIG;
  } catch (e) {
    return out;
  }
  if (!filterCandidates || !OVERRIDE_CONFIG) return out;

  const fresh = (Array.isArray(store) ? store : []).filter((e) => e && e.status === 'new');
  fresh.forEach((entry) => {
    // Only this candidate, plus every settled entry — those are the history the
    // per-author cooldown, one-per-thread and daily-budget rules read from.
    const subset = store.filter((e) => e && (e.status !== 'new' || e.id === entry.id));
    const firedIn = (conf) => {
      try {
        const v = filterCandidates(subset, conf, nowMs);
        if (v.survivors.some((s) => s && s.id === entry.id)) return null;
        return Object.keys(v.drops).filter((k) => v.drops[k] > 0)[0] || 'unknown';
      } catch (e) {
        return undefined; // unknown, not "nothing blocked it"
      }
    };
    const asCron = firedIn(cfg);
    // Imported, never re-declared: if this drifted from what the endpoint
    // actually applies, the button would appear exactly where it will refuse.
    const ignoringAge = firedIn(Object.assign({}, cfg, OVERRIDE_CONFIG));
    out[entry.id] = {
      blocked_reason: asCron === undefined ? null : asCron,
      // The button lifts the age gate and nothing else.
      can_draft: ignoringAge === null,
      // Why the button cannot help either. filterCandidates reports drops in a
      // fixed order and too_old comes first, so it MASKS the deeper guard: both
      // live entries read "aged out" when the real reason one cannot be drafted
      // is that we replied to that person 11 days ago. Showing the cron's first
      // drop as the explanation would be a confident wrong answer.
      override_blocked_reason: ignoringAge === undefined ? null : ignoringAge
    };
  });
  return out;
}

/**
 * What has ACTUALLY happened to a 'task_created' entry.
 *
 * The entry status only records that a task was made for Scribe. It does not
 * mean an action is waiting for approval, and the panel said "draft queued —
 * waiting on your approval" for all of them. Three of those tasks had been
 * CANCELLED on 2026-08-08 and were never going to produce anything, so the
 * dashboard was pointing at an approval queue that did not contain them.
 *
 * The cron's reconcile eventually corrects the entry, but only on its next daily
 * run and only for states it knows. Reading tasks + actions here means the panel
 * is right immediately, and right about states reconcile does not cover.
 *
 * Returns: 'awaiting_approval' | 'drafting' | 'task_canceled' | 'task_missing'
 */
function draftStateFor(entry, taskById, replyActionByTask) {
  if (!entry || !entry.taskId) return 'task_missing';

  const action = replyActionByTask[entry.taskId];
  if (action) {
    const status = (action.approval && action.approval.status) || '';
    // Only NOW is "waiting on your approval" a true sentence.
    if (status === 'pending' || !status) return 'awaiting_approval';
    return 'drafting'; // decided already; reconcile will settle the entry
  }

  const task = taskById[entry.taskId];
  if (!task) return 'task_missing';

  const s = String(task.status || '').toLowerCase();
  if (s === 'canceled' || s === 'cancelled' || s === 'archived') return 'task_canceled';
  if (s === 'done') return 'task_canceled'; // closed without ever producing a reply
  return 'drafting';
}

/**
 * Pure. The drafted reply attached to a conversation, so the decision can
 * happen next to the comment it answers.
 *
 * The loop this replaces: see the reply here → click Draft → wait for the
 * heartbeat → go to the Actions page → find it among unrelated action types →
 * approve. Nothing about the approval itself moves; js/agent-engine.js still
 * owns that, and actionsScheduler still posts it. This only carries what a
 * human needs in order to decide.
 *
 * quality_gate.pass is null when the action has no verdict at all. The gate
 * fails open, so a draft CAN reach approval unchecked, and drawing that as a
 * green tick would report a check that never happened — the same family of bug
 * as "waiting on your approval" for three cancelled tasks.
 */
function buildDraft(action) {
  if (!action) return null;
  const qg = action.qualityGate || (action.payload && action.payload.qualityGate) || null;
  const exec = action.execution || {};
  return {
    action_id: action.id || null,
    text: (action.payload && action.payload.text) || '',
    approval_status: (action.approval && action.approval.status) || 'pending',
    execution_status: exec.status || action.execution_status || null,
    quality_gate: {
      // null, not false: "we did not check" and "we checked and it failed" are
      // different sentences and only one of them is about the draft.
      pass: qg && typeof qg.pass === 'boolean' ? qg.pass : null,
      confidence: qg && Number.isFinite(qg.confidence) ? qg.confidence : null,
      issues: (qg && Array.isArray(qg.issues)) ? qg.issues : []
    },
    // Where the reply actually landed, so an answered row links to what we said
    // rather than only asserting that we said something.
    post_url: (exec.receipt && exec.receipt.post_url) || null,
    created_at: action.created_at || null
  };
}

/**
 * Pure. engagementReplies entries → inbox rows, newest first.
 * `status` is passed through untouched: 'new' means nobody has drafted anything
 * and it is the only status that represents an unanswered human.
 */
function buildReplyRows(store, sinceMs, limit, blockedById, taskById, replyActionByTask) {
  taskById = taskById || {};
  replyActionByTask = replyActionByTask || {};
  return (Array.isArray(store) ? store : [])
    .filter((e) => e && e.replyUri && e.author)
    .filter((e) => {
      const ts = Date.parse(e.indexedAt || e.discoveredAt || '');
      return !Number.isNaN(ts) && ts >= sinceMs;
    })
    .sort((a, b) => Date.parse(b.indexedAt || b.discoveredAt || 0) - Date.parse(a.indexedAt || a.discoveredAt || 0))
    .slice(0, limit)
    .map((e) => {
      const b = (blockedById && blockedById[e.id]) || {};
      return {
        id: e.id,
        kind: 'reply',
        platform: 'bluesky',
        author: e.author,
        text: e.text || '',
        our_post_text: e.ourPostText || '',
        our_post_action_id: e.ourPostActionId || '',
        at: e.indexedAt || e.discoveredAt || null,
        // When we answered, so a row can say how long they waited. 'answered'
        // alone is the same sentence for one hour and for nine days.
        answered_at: e.answeredAt || null,
        status: e.status || 'new',
        task_id: e.taskId || null,
        skip_reason: e.skipReason || null,
        // 'new' rows only. Why the automation passed, and whether the CEO can
        // override it (the button lifts the age gate and nothing else).
        blocked_reason: b.blocked_reason === undefined ? null : b.blocked_reason,
        can_draft: b.can_draft === undefined ? false : b.can_draft,
        override_blocked_reason: b.override_blocked_reason === undefined ? null : b.override_blocked_reason,
        // 'task_created' rows only — what really became of that task.
        draft_state: e.status === 'task_created'
          ? draftStateFor(e, taskById, replyActionByTask)
          : null,
        // The reply Scribe wrote, if one exists yet. Null means no action has
        // been created — which is not the same as an empty draft.
        draft: buildDraft(e.taskId ? replyActionByTask[e.taskId] : null),
        manual_draft: e.manualDraft === true || undefined,
        link: blueskyUrl(e.replyUri),
        our_post_link: blueskyUrl(e.ourPostAtUri)
      };
    });
}

/**
 * Pure. How long we take to answer a stranger, in hours.
 *
 * Nothing else in the platform measures this. Post counts, likes and reply
 * counts all say we were PRESENT; only the gap between someone speaking and us
 * answering says we were conversational.
 *
 * Every rule below exists to stop it becoming a confident zero:
 *   - under 3 samples the median is null, not a number. Two conversations is an
 *     anecdote (same rule as roast-funnel-reconcile.js).
 *   - an 'answered' entry with no answeredAt is COUNTED SEPARATELY, never
 *     scored as 0h. reconcileEngagement stamps that field, so entries settled
 *     before it existed have none, and treating a missing timestamp as instant
 *     would report the fleet as replying the moment anyone spoke.
 *   - a negative interval is clock skew or a backfill, not a fast reply.
 *   - the window is the one the rows use, so the number always describes the
 *     conversations on screen.
 *
 * Returns { medianHours, samples, answeredNoTimestamp } — three numbers so the
 * page can say WHICH nothing it means.
 */
function responseTimeStats(store, sinceMs) {
  const durations = [];
  let answeredNoTimestamp = 0;

  (Array.isArray(store) ? store : []).forEach((e) => {
    if (!e || e.status !== 'answered') return;
    const asked = Date.parse(e.indexedAt || e.discoveredAt || '');
    if (Number.isNaN(asked) || asked < sinceMs) return;
    const answeredMs = Date.parse(e.answeredAt || '');
    if (Number.isNaN(answeredMs) || answeredMs < asked) { answeredNoTimestamp++; return; }
    durations.push((answeredMs - asked) / 3600e3);
  });

  if (durations.length < 3) {
    return { medianHours: null, samples: durations.length, answeredNoTimestamp: answeredNoTimestamp };
  }
  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const median = durations.length % 2
    ? durations[mid]
    : (durations[mid - 1] + durations[mid]) / 2;
  return {
    medianHours: Math.round(median * 10) / 10,
    samples: durations.length,
    answeredNoTimestamp: answeredNoTimestamp
  };
}

/**
 * Pure. Snapshot rows → one row per post that has ANY likes or reposts, so the
 * quiet signals sit next to the conversations instead of only in a chart.
 *
 * Metrics are cumulative lifetime counts (see socialEngagement/index.js for the
 * 22x story), so the latest snapshot per post is the total — never a sum.
 */
function buildReactionRows(snapshots, sinceMs, limit) {
  const latest = {};
  (Array.isArray(snapshots) ? snapshots : []).forEach((s) => {
    if (!s || !s.post_platform || !s.captured_at) return;
    const ts = Date.parse(s.captured_at);
    if (Number.isNaN(ts)) return;
    const key = s.post_platform + '|' + (s.post_id || s.post_url || s.action_id);
    const prior = latest[key];
    if (!prior || ts > Date.parse(prior.captured_at)) latest[key] = s;
  });

  return Object.keys(latest)
    .map((k) => latest[k])
    .filter((s) => {
      const ts = Date.parse(s.captured_at);
      if (ts < sinceMs) return false;
      const m = s.metrics || {};
      return (Number(m.likes) || 0) > 0 || (Number(m.reposts) || 0) > 0;
    })
    .sort((a, b) => {
      const be = (Number(b.metrics.likes) || 0) + (Number(b.metrics.reposts) || 0);
      const ae = (Number(a.metrics.likes) || 0) + (Number(a.metrics.reposts) || 0);
      if (be !== ae) return be - ae;
      return Date.parse(b.captured_at) - Date.parse(a.captured_at);
    })
    .slice(0, limit)
    .map((s) => ({
      kind: 'reaction',
      platform: s.post_platform,
      likes: Number(s.metrics.likes) || 0,
      reposts: Number(s.metrics.reposts) || 0,
      comments: Number(s.metrics.comments) || 0,
      our_post_text: s.post_text || '',
      our_post_action_id: s.action_id || '',
      link: s.post_url || '',
      at: s.captured_at
    }));
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }
  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS, body: { error: 'Method not allowed' } };
    return;
  }

  if (process.env.DEMO_MODE !== 'true') {
    const secret = (req.headers && req.headers['x-company-secret']) || '';
    const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
    if (!storage.validateSecret(secret) && !principal) {
      context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
      return;
    }
  }

  try {
    const q = req.query || {};
    const limit = parseLimit(q.limit);
    const days = parseDays(q.days);
    const sinceMs = Date.now() - (days * 24 * 60 * 60 * 1000);

    // engagementReplies is a companyStorage-direct key, deliberately NOT in
    // company-state's VALID_KEYS (same class as pingLog) — which is exactly why
    // it needed its own reader.
    const [replyStore, snapshots, systemConfig, tasks, actions] = await Promise.all([
      storage.getState('engagementReplies').catch(() => null),
      storage.getState('socialEngagementSnapshots').catch(() => null),
      storage.getState('systemConfig').catch(() => null),
      storage.getState('tasks').catch(() => null),
      storage.getState('actions').catch(() => null)
    ]);

    // So a "waiting on your approval" claim can be checked instead of assumed.
    const taskById = {};
    (Array.isArray(tasks) ? tasks : []).forEach((t) => { if (t && t.id) taskById[t.id] = t; });
    const replyActionByTask = {};
    (Array.isArray(actions) ? actions : []).forEach((a) => {
      if (a && a.type === 'social_post.reply' && a._parentTaskId) replyActionByTask[a._parentTaskId] = a;
    });

    let cfg = {};
    try {
      cfg = require('../companyHeartbeat/engagement-reply').loadConfig(systemConfig || {});
    } catch (e) { /* annotation degrades to "unknown"; the rows still render */ }

    const blockedById = annotateBlocked(Array.isArray(replyStore) ? replyStore : [], cfg, Date.now());

    // COUNT the whole window, RETURN at most `limit`.
    //
    // `limit` is a rendering budget. Counting after it trimmed made every
    // number below a function of how the caller asked — the sidebar badge
    // would say "3 people are waiting" because the page requested three rows.
    // MAX_SAFE_INTEGER rather than Infinity on purpose: Number.isFinite
    // (Infinity) is false and this codebase has already lost an afternoon to
    // that exact guard silently restoring a default.
    const allReplies = buildReplyRows(replyStore, sinceMs, Number.MAX_SAFE_INTEGER, blockedById, taskById, replyActionByTask);
    const allReactions = buildReactionRows(snapshots, sinceMs, Number.MAX_SAFE_INTEGER);
    const replies = allReplies.slice(0, limit);
    const reactions = allReactions.slice(0, limit);
    const responseTime = responseTimeStats(replyStore, sinceMs);

    const counts = { new: 0, task_created: 0, answered: 0, skipped: 0 };
    allReplies.forEach((r) => {
      if (counts[r.status] === undefined) counts[r.status] = 0;
      counts[r.status]++;
    });

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        replies: replies,
        reactions: reactions,
        counts: {
          replies: allReplies.length,
          byStatus: counts,
          // The only number that asks something of a human today.
          // Unanswered from a human's point of view: never drafted, PLUS the
          // ones whose draft task died and produced nothing. The second group
          // used to read as healthy and in-queue.
          needsAttention: (counts.new || 0)
            + allReplies.filter((r) => r.draft_state === 'task_canceled' || r.draft_state === 'task_missing').length,
          // Of those, the ones a click can actually put into the pipeline — which
          // must match the rows that render a button, or the chip undercounts the
          // work. Includes dead drafts: a cancelled task produced nothing, so
          // that conversation is re-draftable too.
          draftable: allReplies.filter((r) =>
            (r.status === 'new' && r.can_draft)
            || r.draft_state === 'task_canceled'
            || r.draft_state === 'task_missing').length,
          reactions: allReactions.length,
          likes: allReactions.reduce((a, r) => a + r.likes, 0),
          reposts: allReactions.reduce((a, r) => a + r.reposts, 0),
          // Hours between a stranger speaking and us answering. null under three
          // samples — the sample counts travel with it so the page can say which
          // nothing it means: none answered, not enough answered, or answered
          // before we started stamping when.
          medianResponseHours: responseTime.medianHours,
          responseSamples: responseTime.samples,
          answeredNoTimestamp: responseTime.answeredNoTimestamp
        },
        coverage: {
          replies: ['bluesky'],
          reactions: ['x', 'linkedin', 'bluesky'],
          // Said out loud so an empty X section is never read as "nobody
          // replied on X" when it means "we do not read X replies".
          note: 'Reply text is harvested from Bluesky only (AT Protocol getPostThread). X and LinkedIn contribute counts, not conversation.'
        },
        meta: {
          days: days,
          // null distinguishes "the store has never been written" from "nobody
          // has replied", which are very different problems.
          replyStoreExists: Array.isArray(replyStore),
          replyStoreSize: Array.isArray(replyStore) ? replyStore.length : null,
          // Shown vs total, so a page rendering 100 of 137 conversations can say
          // so instead of presenting a truncated list as the whole story.
          repliesTotal: allReplies.length,
          repliesShown: replies.length,
          reactionsTotal: allReactions.length,
          reactionsShown: reactions.length,
          generatedAt: new Date().toISOString()
        }
      }
    };
  } catch (err) {
    context.log.error('[engagementInbox] error:', (err && err.message) || err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to load engagement inbox', details: (err && err.message) || String(err) }
    };
  }
};

module.exports._buildReplyRows = buildReplyRows;
module.exports._annotateBlocked = annotateBlocked;
module.exports._buildReactionRows = buildReactionRows;
module.exports._blueskyUrl = blueskyUrl;
module.exports._responseTimeStats = responseTimeStats;
