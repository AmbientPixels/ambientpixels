// blueskyThread — one fetch of app.bsky.feed.getPostThread, shared.
//
// WHY THIS FILE EXISTS. outcomeRefresh has fetched Bluesky threads since the
// Engagement Reply Loop shipped (depth=1, riding along on the metrics pull).
// The Engagement Inbox now needs the same thread at greater depth so a human
// can read a whole exchange before approving a reply to it. That is two
// callers; a third copy of a URL, a timeout and a status check is how they
// drift apart, so it lives here.
//
// THE ENDPOINT IS FREE AND PUBLIC. public.api.bsky.app needs no auth and costs
// nothing, which is exactly why reply coverage is Bluesky only — X and LinkedIn
// have no equivalent we pay for. Nothing here should grow an API key.

const https = require('https');

const THREAD_ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread';
const DEFAULT_DEPTH = 1;
const DEFAULT_MAX_TURNS = 40;
const TIMEOUT_MS = 10000;

function httpGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: headers || {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_e) { /* raw */ }
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on('error', (err) => reject({ code: 'NETWORK_ERROR', message: err.message }));
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject({ code: 'TIMEOUT', message: 'request timeout' }); });
    req.end();
  });
}

// at://did:plc:xxx/app.bsky.feed.post/rkey → did:plc:xxx
//
// The DID, not the handle: a handle can change and every stored uri would then
// point at the wrong person, while the DID is stable for the life of the account.
function didFromAtUri(atUri) {
  const m = /^at:\/\/([^/]+)\//.exec(String(atUri || ''));
  return m ? m[1] : '';
}

/**
 * Fetch one thread. Returns the raw `thread` node from the response.
 *
 * opts.cache is a per-request Map. The inbox renders many conversations that
 * can share a root, and a page render must never become N network calls.
 * opts.httpGet is injectable so the tests never touch the network.
 *
 * A non-200 THROWS. Returning an empty thread would render as "no conversation
 * here", which is a lie when the truth is that Bluesky said 404.
 */
async function fetchThread(atUri, opts) {
  opts = opts || {};
  if (!atUri) throw { code: 'BSKY_NO_URI', message: 'missing at_uri' };
  const depth = Number.isFinite(opts.depth) ? opts.depth : DEFAULT_DEPTH;
  const cacheKey = atUri + '|' + depth;
  if (opts.cache && opts.cache.has(cacheKey)) return opts.cache.get(cacheKey);

  const get = opts.httpGet || httpGetJson;
  const url = THREAD_ENDPOINT + '?uri=' + encodeURIComponent(atUri) + '&depth=' + depth;
  const res = await get(url, { 'Accept': 'application/json' });
  if (res.status !== 200 || !res.body || !res.body.thread || !res.body.thread.post) {
    throw {
      code: 'BSKY_API_ERROR_' + res.status,
      message: String(res.raw || '').substring(0, 200)
    };
  }
  if (opts.cache) opts.cache.set(cacheKey, res.body.thread);
  return res.body.thread;
}

/**
 * Thread tree → the turns of a conversation, in the order they were said.
 *
 * ourDid decides who is speaking. It is passed in rather than inferred from the
 * root author because the root is NOT always us: a comment on one of our
 * prospect replies has the PROSPECT's original post as its true thread root.
 *
 * Nodes with no post — #blockedPost, #notFoundPost — are skipped rather than
 * rendered as empty turns. A blank quote in the middle of an exchange is worse
 * than an absent one.
 *
 * Returns { turns, truncated }. `truncated` is a sibling of the list rather
 * than a property hung on it, so a caller cannot destructure the turns and lose
 * the warning. No silent caps: half an exchange that looks complete would have
 * someone approving a reply to a conversation they only partly read.
 */
function flattenThread(thread, ourDid, opts) {
  opts = opts || {};
  const maxTurns = Number.isFinite(opts.maxTurns) ? opts.maxTurns : DEFAULT_MAX_TURNS;
  const turns = [];
  let truncated = false;

  function walk(node, depth) {
    if (!node || !node.post || !node.post.uri || !node.post.author) return;
    if (turns.length >= maxTurns) { truncated = true; return; }
    const p = node.post;
    turns.push({
      uri: p.uri,
      author: p.author.handle || '',
      did: p.author.did || '',
      text: String((p.record && p.record.text) || ''),
      at: p.indexedAt || null,
      depth: depth,
      is_ours: !!ourDid && p.author.did === ourDid
    });
    (Array.isArray(node.replies) ? node.replies : []).forEach((child) => walk(child, depth + 1));
  }

  walk(thread, 0);
  return { turns: turns, truncated: truncated };
}

module.exports = {
  THREAD_ENDPOINT: THREAD_ENDPOINT,
  fetchThread: fetchThread,
  flattenThread: flattenThread,
  didFromAtUri: didFromAtUri,
  httpGetJson: httpGetJson
};
