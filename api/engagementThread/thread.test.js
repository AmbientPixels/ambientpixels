// engagementThread — Run with: node api/engagementThread/thread.test.js
//
// Judging a drafted reply needs the whole exchange. A row shows our post and
// their comment; this endpoint fetches everything either side of that, on
// demand, so the CEO is never approving a second turn without having read the
// first.

const assert = require('assert');

const storagePath = require.resolve('../_utils/companyStorage');
let fakeState = {};
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: {
    async getState(k) { return fakeState[k] === undefined ? null : fakeState[k]; },
    async setState() { return true; },
    validateSecret(s) { return s === 'test-secret'; }
  }
};

// Stub only the network. flattenThread is the real one — this endpoint is not
// worth testing against a fake of the code it exists to call.
const bskyPath = require.resolve('../_utils/blueskyThread');
const realBsky = require('../_utils/blueskyThread');
let fetchCalls = [];
let fetchImpl = null;
require.cache[bskyPath] = {
  id: bskyPath, filename: bskyPath, loaded: true,
  exports: Object.assign({}, realBsky, {
    fetchThread: async (uri, opts) => {
      fetchCalls.push({ uri: uri, depth: opts && opts.depth });
      return fetchImpl(uri);
    }
  })
};

const handler = require('./index');

const OUR_DID = 'did:plc:us';
const THEIR_DID = 'did:plc:them';

function entry(o) {
  return Object.assign({
    id: 'er_1',
    replyUri: 'at://' + THEIR_DID + '/app.bsky.feed.post/theirs',
    rootUri: 'at://' + OUR_DID + '/app.bsky.feed.post/root',
    author: 'stranger.bsky.social',
    authorDid: THEIR_DID,
    text: 'their comment',
    ourPostAtUri: 'at://' + OUR_DID + '/app.bsky.feed.post/root',
    status: 'new'
  }, o);
}

function fakeThread() {
  return {
    post: {
      uri: 'at://' + OUR_DID + '/app.bsky.feed.post/root',
      author: { did: OUR_DID, handle: 'us.bsky.social' },
      record: { text: 'our post' },
      indexedAt: '2026-08-01T00:00:00.000Z'
    },
    replies: [{
      post: {
        uri: 'at://' + THEIR_DID + '/app.bsky.feed.post/theirs',
        author: { did: THEIR_DID, handle: 'stranger.bsky.social' },
        record: { text: 'their comment' },
        indexedAt: '2026-08-01T01:00:00.000Z'
      }
    }]
  };
}

async function call(query, headers) {
  const context = { res: null, log: Object.assign(function () {}, { error() {}, warn() {} }) };
  await handler(context, {
    method: 'GET',
    headers: headers === undefined ? { 'x-company-secret': 'test-secret' } : headers,
    query: query || {}
  });
  return context.res;
}

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

test('the whole exchange comes back, with our turns marked', async () => {
  fakeState = { engagementReplies: [entry()] };
  fetchCalls = []; fetchImpl = () => fakeThread();
  const res = await call({ id: 'er_1' });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.turns.map((t) => t.text), ['our post', 'their comment']);
  assert.deepStrictEqual(res.body.turns.map((t) => t.is_ours), [true, false]);
});

test('the fetch starts at the TRUE thread root, not at our post', async () => {
  // A comment on one of our prospect replies has the PROSPECT's original post
  // as its root. Starting from ours would show a fragment and call it the
  // conversation.
  const theirRoot = 'at://' + THEIR_DID + '/app.bsky.feed.post/theirroot';
  fakeState = { engagementReplies: [entry({ rootUri: theirRoot })] };
  fetchCalls = []; fetchImpl = () => fakeThread();
  await call({ id: 'er_1' });
  assert.strictEqual(fetchCalls[0].uri, theirRoot);
});

test('an entry with no root falls back to our post AND says so', async () => {
  fakeState = { engagementReplies: [entry({ rootUri: null })] };
  fetchCalls = []; fetchImpl = () => fakeThread();
  const res = await call({ id: 'er_1' });
  assert.strictEqual(fetchCalls[0].uri, 'at://' + OUR_DID + '/app.bsky.feed.post/root');
  assert.strictEqual(res.body.rooted_at, 'our_post',
    'a partial thread presented as the whole one is exactly the bug class this panel keeps shipping');
});

test('the reply we are looking at is flagged, so the page knows where to anchor', async () => {
  fakeState = { engagementReplies: [entry()] };
  fetchCalls = []; fetchImpl = () => fakeThread();
  const res = await call({ id: 'er_1' });
  const theirs = res.body.turns.filter((t) => t.is_the_reply);
  assert.strictEqual(theirs.length, 1);
  assert.strictEqual(theirs[0].text, 'their comment');
});

test('Bluesky being down is reported as such, not as an empty conversation', async () => {
  fakeState = { engagementReplies: [entry()] };
  fetchCalls = []; fetchImpl = () => { throw { code: 'BSKY_API_ERROR_502', message: 'bad gateway' }; };
  const res = await call({ id: 'er_1' });
  assert.strictEqual(res.status, 502);
  assert.ok(/BSKY_API_ERROR_502/.test(JSON.stringify(res.body)),
    'the failure has to name itself: "no turns" would read as "nobody said anything"');
});

test('an unknown id is a 404, never an empty thread', async () => {
  fakeState = { engagementReplies: [entry()] };
  fetchCalls = []; fetchImpl = () => fakeThread();
  const res = await call({ id: 'er_nope' });
  assert.strictEqual(res.status, 404);
});

test('no id is a 400', async () => {
  fakeState = { engagementReplies: [entry()] };
  const res = await call({});
  assert.strictEqual(res.status, 400);
});

test('an unauthenticated caller gets 403, not somebody else words', async () => {
  fakeState = { engagementReplies: [entry()] };
  const res = await call({ id: 'er_1' }, {});
  assert.strictEqual(res.status, 403);
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\nengagementThread: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
