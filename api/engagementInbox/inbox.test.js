// engagementInbox — Run with: node api/engagementInbox/inbox.test.js
//
// The store these rows come from has been filling up since 2026-07-28 with the
// author, text and thread context of every human reply to our Bluesky posts, and
// until now nothing read it. So the risk here is not that the maths is wrong —
// it is that a row renders as a blank line, or that an empty section quietly
// reads as "nobody replied" when it means "we never asked that platform".

const assert = require('assert');
const mod = require('./index');
const { _buildReplyRows: replyRows, _buildReactionRows: reactionRows, _blueskyUrl: bskyUrl } = mod;

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const SINCE = NOW - 30 * DAY;

function entry(o) {
  return Object.assign({
    id: 'er_1',
    replyUri: 'at://did:plc:abc/app.bsky.feed.post/rkey1',
    replyCid: 'cid1',
    author: 'sarah.dev',
    text: 'this is the first resume tool that did not just tell me to add keywords',
    ourPostActionId: 'act_1',
    ourPostAtUri: 'at://did:plc:us/app.bsky.feed.post/ourpost',
    ourPostText: 'Your resume says "responsible for" eleven times.',
    indexedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
    discoveredAt: new Date(NOW - 1 * 60 * 60 * 1000).toISOString(),
    status: 'new'
  }, o);
}

function snapshot(o) {
  return Object.assign({
    id: 'seg_1',
    post_platform: 'x',
    post_id: 'p1',
    post_url: 'https://x.com/AIAmbientPixels/status/1',
    action_id: 'act_x',
    post_text: 'Stop just talking about AI.',
    captured_at: new Date(NOW - 1 * DAY).toISOString(),
    metrics: { likes: 2, comments: 1, reposts: 1 }
  }, o);
}

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

test('a reply carries who said it, what they said, and what they replied to', () => {
  const [r] = replyRows([entry()], SINCE, 50);
  assert.strictEqual(r.author, 'sarah.dev');
  assert.ok(r.text.length > 0, 'no reply text — the row would render blank');
  assert.ok(r.our_post_text.length > 0, 'no context for what they replied to');
  assert.strictEqual(r.status, 'new');
  assert.strictEqual(r.kind, 'reply');
});

test('both links resolve to something clickable', () => {
  const [r] = replyRows([entry()], SINCE, 50);
  assert.strictEqual(r.link, 'https://bsky.app/profile/did:plc:abc/post/rkey1');
  assert.strictEqual(r.our_post_link, 'https://bsky.app/profile/did:plc:us/post/ourpost');
});

test('a malformed at:// uri yields an empty link, never a broken one', () => {
  assert.strictEqual(bskyUrl('not-a-uri'), '');
  assert.strictEqual(bskyUrl(''), '');
  assert.strictEqual(bskyUrl(null), '');
  assert.strictEqual(bskyUrl('at://did:plc:x/app.bsky.feed.like/abc'), '', 'a like is not a post');
});

test('newest first — this is an inbox, not an archive', () => {
  const rows = replyRows([
    entry({ id: 'old', replyUri: 'at://did:plc:a/app.bsky.feed.post/old', indexedAt: new Date(NOW - 5 * DAY).toISOString() }),
    entry({ id: 'new', replyUri: 'at://did:plc:a/app.bsky.feed.post/new', indexedAt: new Date(NOW - 1 * DAY).toISOString() })
  ], SINCE, 50);
  assert.deepStrictEqual(rows.map((r) => r.id), ['new', 'old']);
});

test('entries outside the window are dropped', () => {
  const rows = replyRows([entry({ indexedAt: new Date(NOW - 60 * DAY).toISOString() })], SINCE, 50);
  assert.strictEqual(rows.length, 0);
});

test('an entry with no author or uri is skipped rather than rendered blank', () => {
  const rows = replyRows([
    entry({ author: '' }),
    entry({ id: 'no-uri', replyUri: '' }),
    null,
    entry({ id: 'good', replyUri: 'at://did:plc:a/app.bsky.feed.post/good' })
  ], SINCE, 50);
  assert.deepStrictEqual(rows.map((r) => r.id), ['good']);
});

test('status is preserved so answered conversations do not look unanswered', () => {
  const rows = replyRows([
    entry({ id: 'a', replyUri: 'at://did:plc:a/app.bsky.feed.post/a', status: 'answered' }),
    entry({ id: 'b', replyUri: 'at://did:plc:a/app.bsky.feed.post/b', status: 'task_created' }),
    entry({ id: 'c', replyUri: 'at://did:plc:a/app.bsky.feed.post/c', status: 'new' })
  ], SINCE, 50);
  const byId = rows.reduce((m, r) => { m[r.id] = r.status; return m; }, {});
  assert.deepStrictEqual(byId, { a: 'answered', b: 'task_created', c: 'new' });
});

test('reactions report the LATEST cumulative count, never a sum of polls', () => {
  // The 22x bug in the other direction: this store holds one row per poll and
  // each carries lifetime totals. Summing them here would repeat it.
  const rows = reactionRows([
    snapshot({ id: 's1', captured_at: new Date(NOW - 3 * DAY).toISOString(), metrics: { likes: 2, comments: 0, reposts: 0 } }),
    snapshot({ id: 's2', captured_at: new Date(NOW - 2 * DAY).toISOString(), metrics: { likes: 2, comments: 0, reposts: 0 } }),
    snapshot({ id: 's3', captured_at: new Date(NOW - 1 * DAY).toISOString(), metrics: { likes: 3, comments: 0, reposts: 0 } })
  ], SINCE, 50);
  assert.strictEqual(rows.length, 1, 'one post must be one row');
  assert.strictEqual(rows[0].likes, 3, 'got ' + rows[0].likes + ' — summed the polls');
});

test('posts nobody touched stay out of the inbox', () => {
  const rows = reactionRows([
    snapshot({ id: 'quiet', post_id: 'q', metrics: { likes: 0, comments: 0, reposts: 0 } }),
    snapshot({ id: 'loud', post_id: 'l', metrics: { likes: 1, comments: 0, reposts: 0 } })
  ], SINCE, 50);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].likes, 1);
});

test('a reaction row still says what the post was', () => {
  const [r] = reactionRows([snapshot()], SINCE, 50);
  assert.ok(r.our_post_text.length > 0, 'blank row with a number beside it — the bug we just fixed');
  assert.strictEqual(r.platform, 'x');
  assert.ok(r.link);
});

test('empty and missing stores are handled without throwing', () => {
  assert.deepStrictEqual(replyRows(null, SINCE, 50), []);
  assert.deepStrictEqual(replyRows([], SINCE, 50), []);
  assert.deepStrictEqual(reactionRows(null, SINCE, 50), []);
  assert.deepStrictEqual(reactionRows(undefined, SINCE, 50), []);
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\nengagementInbox: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
