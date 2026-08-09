// engagementThread — the whole exchange around ONE harvested comment.
// GET /api/engagement-thread?id=er_xxx
//
// WHY THIS EXISTS
//
// A row in the Engagement Inbox shows our post and their reply. That is enough
// to know someone spoke; it is not enough to judge a REPLY to them. The manual
// draft button raises the per-thread limit from 1 to 2, so the second turn has
// to sound like it heard the first — and until now the only way to read the
// first was to leave the dashboard and open bsky.app.
//
// ON DEMAND, NOT ON RENDER. The inbox shows nine conversations; fetching all of
// their threads on every page load would be nine network calls to render a list
// nobody has asked to expand yet. The page calls this when a human opens one
// conversation, and caches the answer for that row.
//
// BLUESKY ONLY, as ever. app.bsky.feed.getPostThread is free and public; X and
// LinkedIn have no equivalent we pay for. The response says so rather than
// letting an absent thread read as a quiet one.

const storage = require('../_utils/companyStorage');
const bsky = require('../_utils/blueskyThread');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal, X-AmbientOS-Key',
  'Content-Type': 'application/json'
};

// Deep enough for a real back-and-forth, shallow enough that one popular post
// does not return a subtree nobody will read.
const DEPTH = 6;
const MAX_TURNS = 40;

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

  const id = String(((req.query || {}).id) || '').trim();
  if (!id) {
    context.res = { status: 400, headers: CORS, body: { error: 'Missing id' } };
    return;
  }

  try {
    const store = (await storage.getState('engagementReplies')) || [];
    const entry = (Array.isArray(store) ? store : []).find((e) => e && e.id === id);
    if (!entry) {
      // 404, not an empty thread: "we have never heard of this conversation"
      // and "this conversation is empty" are different answers.
      context.res = { status: 404, headers: CORS, body: { error: 'No such reply', id: id } };
      return;
    }

    // This endpoint speaks AT Protocol and nothing else. A Facebook row reaching
    // fetchThread below would return 502 "Could not reach Bluesky", which is a
    // confidently wrong answer: Bluesky is fine, we simply do not read Facebook
    // threads. The permalink already on the entry is where that conversation lives.
    const _platform = entry.platform || 'bluesky';
    if (_platform !== 'bluesky') {
      context.res = {
        status: 409,
        headers: CORS,
        body: {
          error: 'Thread view is Bluesky-only',
          platform: _platform,
          // So the caller can send the human somewhere real instead of nowhere.
          permalink: entry.permalink || '',
          our_post_permalink: entry.ourPostPermalink || '',
          message: 'This conversation is on ' + _platform + '. We harvest the comment but do not read its thread — open the permalink to see it in context.'
        }
      };
      return;
    }

    // The TRUE thread root. For a comment on one of OUR prospect replies that is
    // the PROSPECT's original post, not ours — starting from ours would return a
    // fragment and present it as the conversation. Older entries pre-date
    // rootUri, so the fallback is named in the response rather than assumed.
    const rootUri = entry.rootUri || entry.ourPostAtUri || entry.replyUri;
    const rootedAt = entry.rootUri ? 'thread_root'
      : (entry.ourPostAtUri ? 'our_post' : 'their_reply');

    // Our identity from the at:// uri: a handle can change and every stored uri
    // would then point at the wrong person, while the DID cannot.
    const ourDid = bsky.didFromAtUri(entry.ourPostAtUri);

    let thread;
    try {
      thread = await bsky.fetchThread(rootUri, { depth: DEPTH });
    } catch (fetchErr) {
      // Say that Bluesky failed. Returning zero turns would render as "nobody
      // said anything", which is the exact bug class this panel keeps shipping.
      context.log.warn('[engagementThread] fetch failed for ' + rootUri + ': ' + ((fetchErr && fetchErr.message) || fetchErr));
      context.res = {
        status: 502,
        headers: CORS,
        body: {
          error: 'Could not reach Bluesky',
          code: (fetchErr && fetchErr.code) || 'BSKY_FETCH_FAILED',
          details: (fetchErr && fetchErr.message) || String(fetchErr)
        }
      };
      return;
    }

    const flat = bsky.flattenThread(thread, ourDid, { maxTurns: MAX_TURNS });
    const turns = flat.turns.map((t) => Object.assign({}, t, {
      // Which turn the inbox row is about, so the page can anchor on it instead
      // of making the reader find it.
      is_the_reply: t.uri === entry.replyUri
    }));

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        id: entry.id,
        turns: turns,
        truncated: flat.truncated,
        root_uri: rootUri,
        rooted_at: rootedAt,
        our_did: ourDid || null,
        // No silent gap: if the reply we came here for is not in the thread it
        // was deleted or is hidden, and the reader should know that rather than
        // wonder why they cannot find it.
        reply_present: turns.some((t) => t.is_the_reply),
        coverage: 'Bluesky only — AT Protocol getPostThread. X and LinkedIn threads are not readable to us.'
      }
    };
  } catch (err) {
    context.log.error('[engagementThread] error:', (err && err.message) || err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to load thread', details: (err && err.message) || String(err) }
    };
  }
};
