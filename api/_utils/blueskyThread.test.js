// blueskyThread — Run with: node api/_utils/blueskyThread.test.js
//
// Judging a drafted reply needs the whole exchange, not just the last turn —
// especially now that two turns are allowed and the second one has to sound
// like it heard the first. These tests cover the flattening, because that is
// where a thread stops being a tree and starts being something a person reads.

const assert = require('assert');
const bsky = require('./blueskyThread');

const OUR_DID = 'did:plc:us';
const THEIR_DID = 'did:plc:them';

function post(o) {
  return Object.assign({
    uri: 'at://' + THEIR_DID + '/app.bsky.feed.post/x',
    cid: 'cid',
    author: { did: THEIR_DID, handle: 'stranger.bsky.social' },
    record: { text: 'hello' },
    indexedAt: '2026-08-01T00:00:00.000Z'
  }, o);
}

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

test('a thread flattens to turns in the order they were said', () => {
  const thread = {
    post: post({ uri: 'at://' + OUR_DID + '/app.bsky.feed.post/root', author: { did: OUR_DID, handle: 'us.bsky.social' }, record: { text: 'our post' } }),
    replies: [
      { post: post({ uri: 'at://' + THEIR_DID + '/app.bsky.feed.post/r1', record: { text: 'their reply' }, indexedAt: '2026-08-01T01:00:00.000Z' }),
        replies: [
          { post: post({ uri: 'at://' + OUR_DID + '/app.bsky.feed.post/r2', author: { did: OUR_DID, handle: 'us.bsky.social' }, record: { text: 'our answer' }, indexedAt: '2026-08-01T02:00:00.000Z' }) }
        ] }
    ]
  };
  const { turns } = bsky.flattenThread(thread, OUR_DID);
  assert.deepStrictEqual(turns.map((t) => t.text), ['our post', 'their reply', 'our answer']);
});

test('our own turns are marked, so the page can show who is speaking', () => {
  const thread = {
    post: post({ uri: 'at://' + OUR_DID + '/app.bsky.feed.post/root', author: { did: OUR_DID, handle: 'us.bsky.social' } }),
    replies: [{ post: post({ uri: 'at://' + THEIR_DID + '/app.bsky.feed.post/r1' }) }]
  };
  const { turns } = bsky.flattenThread(thread, OUR_DID);
  assert.deepStrictEqual(turns.map((t) => t.is_ours), [true, false]);
});

test('depth is preserved so a branching thread does not read as one conversation', () => {
  const thread = {
    post: post({ uri: 'at://' + OUR_DID + '/app.bsky.feed.post/root', author: { did: OUR_DID, handle: 'us.bsky.social' } }),
    replies: [
      { post: post({ uri: 'at://' + THEIR_DID + '/app.bsky.feed.post/a' }),
        replies: [{ post: post({ uri: 'at://' + THEIR_DID + '/app.bsky.feed.post/b' }) }] }
    ]
  };
  const { turns } = bsky.flattenThread(thread, OUR_DID);
  assert.deepStrictEqual(turns.map((t) => t.depth), [0, 1, 2]);
});

test('a blocked or deleted node is skipped, never rendered as an empty turn', () => {
  // getPostThread returns #blockedPost / #notFoundPost nodes with no .post.
  // A blank quote in the middle of an exchange is worse than an absent one.
  const thread = {
    post: post({ uri: 'at://' + OUR_DID + '/app.bsky.feed.post/root', author: { did: OUR_DID, handle: 'us.bsky.social' } }),
    replies: [
      { blocked: true },
      { post: null },
      { post: post({ uri: 'at://' + THEIR_DID + '/app.bsky.feed.post/ok', record: { text: 'still here' } }) }
    ]
  };
  const { turns } = bsky.flattenThread(thread, OUR_DID);
  assert.strictEqual(turns.length, 2);
  assert.strictEqual(turns[1].text, 'still here');
});

test('a missing thread yields no turns rather than throwing', () => {
  assert.deepStrictEqual(bsky.flattenThread(null, OUR_DID), { turns: [], truncated: false });
  assert.deepStrictEqual(bsky.flattenThread({}, OUR_DID), { turns: [], truncated: false });
  assert.deepStrictEqual(bsky.flattenThread({ post: {} }, OUR_DID), { turns: [], truncated: false });
});

test('our DID comes out of an at:// uri, because handles change and DIDs do not', () => {
  assert.strictEqual(bsky.didFromAtUri('at://did:plc:us/app.bsky.feed.post/abc'), 'did:plc:us');
  assert.strictEqual(bsky.didFromAtUri('nonsense'), '');
  assert.strictEqual(bsky.didFromAtUri(null), '');
});

test('a huge thread is capped, and says it was capped', () => {
  // No silent caps: a truncated exchange that looks complete would have the CEO
  // approving a reply to a conversation they only saw half of.
  const replies = [];
  for (let i = 0; i < 60; i++) {
    replies.push({ post: post({ uri: 'at://' + THEIR_DID + '/app.bsky.feed.post/r' + i, record: { text: 'turn ' + i } }) });
  }
  const thread = { post: post({ author: { did: OUR_DID, handle: 'us.bsky.social' } }), replies: replies };
  const res = bsky.flattenThread(thread, OUR_DID, { maxTurns: 10 });
  assert.strictEqual(res.turns.length, 10);
  assert.strictEqual(res.truncated, true, 'the caller cannot tell it only got part of the thread');
});

test('the fetch asks the free public endpoint and passes the uri through', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    return { status: 200, body: { thread: { post: post({}) } }, raw: '' };
  };
  const t = await bsky.fetchThread('at://did:plc:us/app.bsky.feed.post/abc', { httpGet: fake, depth: 6 });
  assert.ok(calls[0].indexOf('public.api.bsky.app') !== -1, 'not the free public endpoint');
  assert.ok(calls[0].indexOf('depth=6') !== -1, 'depth not applied');
  assert.ok(calls[0].indexOf(encodeURIComponent('at://did:plc:us/app.bsky.feed.post/abc')) !== -1);
  assert.ok(t && t.post);
});

test('one fetch per uri per request — a render must not re-hit the network', async () => {
  let hits = 0;
  const fake = async () => { hits++; return { status: 200, body: { thread: { post: post({}) } }, raw: '' }; };
  const cache = new Map();
  const uri = 'at://did:plc:us/app.bsky.feed.post/abc';
  await bsky.fetchThread(uri, { httpGet: fake, cache: cache });
  await bsky.fetchThread(uri, { httpGet: fake, cache: cache });
  assert.strictEqual(hits, 1, 'fetched ' + hits + ' times for one uri');
});

test('a non-200 throws with the status, rather than returning an empty thread', () => {
  // An empty thread renders as "no conversation here", which is a lie when the
  // truth is "Bluesky said 404".
  const fake = async () => ({ status: 404, body: null, raw: 'nope' });
  return bsky.fetchThread('at://did:plc:us/app.bsky.feed.post/abc', { httpGet: fake })
    .then(() => { throw new Error('resolved instead of throwing'); })
    .catch((e) => {
      assert.ok(String(e.code || '').indexOf('404') !== -1, 'status missing from the error: ' + JSON.stringify(e));
    });
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\nblueskyThread: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
