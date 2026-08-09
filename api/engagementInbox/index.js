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
 * Pure. engagementReplies entries → inbox rows, newest first.
 * `status` is passed through untouched: 'new' means nobody has drafted anything
 * and it is the only status that represents an unanswered human.
 */
function buildReplyRows(store, sinceMs, limit) {
  return (Array.isArray(store) ? store : [])
    .filter((e) => e && e.replyUri && e.author)
    .filter((e) => {
      const ts = Date.parse(e.indexedAt || e.discoveredAt || '');
      return !Number.isNaN(ts) && ts >= sinceMs;
    })
    .sort((a, b) => Date.parse(b.indexedAt || b.discoveredAt || 0) - Date.parse(a.indexedAt || a.discoveredAt || 0))
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      kind: 'reply',
      platform: 'bluesky',
      author: e.author,
      text: e.text || '',
      our_post_text: e.ourPostText || '',
      our_post_action_id: e.ourPostActionId || '',
      at: e.indexedAt || e.discoveredAt || null,
      status: e.status || 'new',
      task_id: e.taskId || null,
      skip_reason: e.skipReason || null,
      link: blueskyUrl(e.replyUri),
      our_post_link: blueskyUrl(e.ourPostAtUri)
    }));
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
    const [replyStore, snapshots] = await Promise.all([
      storage.getState('engagementReplies').catch(() => null),
      storage.getState('socialEngagementSnapshots').catch(() => null)
    ]);

    const replies = buildReplyRows(replyStore, sinceMs, limit);
    const reactions = buildReactionRows(snapshots, sinceMs, limit);

    const counts = { new: 0, task_created: 0, answered: 0, skipped: 0 };
    replies.forEach((r) => {
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
          replies: replies.length,
          byStatus: counts,
          // The only number that asks something of a human today.
          needsAttention: counts.new || 0,
          reactions: reactions.length,
          likes: reactions.reduce((a, r) => a + r.likes, 0),
          reposts: reactions.reduce((a, r) => a + r.reposts, 0)
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
module.exports._buildReactionRows = buildReactionRows;
module.exports._blueskyUrl = blueskyUrl;
