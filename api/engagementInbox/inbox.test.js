// engagementInbox — Run with: node api/engagementInbox/inbox.test.js
//
// The store these rows come from has been filling up since 2026-07-28 with the
// author, text and thread context of every human reply to our Bluesky posts, and
// until now nothing read it. So the risk here is not that the maths is wrong —
// it is that a row renders as a blank line, or that an empty section quietly
// reads as "nobody replied" when it means "we never asked that platform".

const assert = require('assert');

// Stubbed BEFORE ./index is required, so the handler itself can be driven —
// same pattern as engagementReplyDraft/override.test.js. The pure functions
// below are still tested directly; this is only for the wiring that decides
// what gets counted versus what gets returned.
const storagePath = require.resolve('../_utils/companyStorage');
let fakeState = {};
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: {
    async getState(k) { return fakeState[k] === undefined ? null : fakeState[k]; },
    async setState(k, v) { fakeState[k] = v; return true; },
    async mutateState() { return { ok: true, written: false }; },
    validateSecret(s) { return s === 'test-secret'; }
  }
};

const mod = require('./index');
const {
  _buildReplyRows: replyRows,
  _buildReactionRows: reactionRows,
  _blueskyUrl: bskyUrl,
  _responseTimeStats: responseStats
} = mod;

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

test('an answered row carries WHEN it was answered, not just that it was', () => {
  // Without this the page can only say "answered", which is the same sentence
  // for a reply sent in an hour and one sent nine days later.
  const at = new Date(NOW - 3 * 3600e3).toISOString();
  const [r] = replyRows([entry({ status: 'answered', answeredAt: at })], SINCE, 50);
  assert.strictEqual(r.answered_at, at);
  const [u] = replyRows([entry({ status: 'new' })], SINCE, 50);
  assert.strictEqual(u.answered_at, null, 'an unanswered row must not carry a time');
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

test('the reason a button is missing is the guard that blocks the OVERRIDE', () => {
  // Both live production rows report blocked_reason 'too_old' because that check
  // runs first inside filterCandidates. But the age gate is exactly what the
  // button lifts, so "aged out" is a confident wrong answer to "why can I not
  // draft this". The deeper guard has to be reported separately.
  const cfg = { maxAgeHours: 72, minTextLength: 15, perAuthorCooldownDays: 14, maxPerDay: 3 };
  const old = new Date(NOW - 9 * DAY).toISOString();

  const store = [
    // Two exchanges already spent in this thread — the button's own limit.
    entry({ id: 'p1', status: 'answered', answeredAt: new Date(NOW - 9 * DAY).toISOString(), indexedAt: old }),
    entry({ id: 'p2', status: 'answered', answeredAt: new Date(NOW - 8 * DAY).toISOString(), indexedAt: old }),
    entry({ id: 'target', status: 'new', indexedAt: old })
  ];
  const ann = mod._annotateBlocked(store, cfg, NOW).target;
  assert.strictEqual(ann.blocked_reason, 'too_old', 'the cron drop should still be reported');
  assert.strictEqual(ann.can_draft, false);
  assert.strictEqual(ann.override_blocked_reason, 'author_thread_done',
    'the panel would tell the CEO "aged out" when the real reason is the conversation is spent');
});

test('one prior exchange leaves the button available — that is the point of 2', () => {
  const cfg = { maxAgeHours: 72, minTextLength: 15, perAuthorCooldownDays: 14, maxPerDay: 3 };
  const old = new Date(NOW - 9 * DAY).toISOString();
  const store = [
    entry({ id: 'prior', status: 'answered', answeredAt: new Date(NOW - 8 * DAY).toISOString(), indexedAt: old }),
    entry({ id: 'target', status: 'new', indexedAt: old })
  ];
  const ann = mod._annotateBlocked(store, cfg, NOW).target;
  assert.strictEqual(ann.blocked_reason, 'too_old');
  assert.strictEqual(ann.can_draft, true, 'the second turn of a conversation is unreachable');
  assert.strictEqual(ann.override_blocked_reason, null);
});

test('an item blocked ONLY by age is draftable, with no override blocker', () => {
  const cfg = { maxAgeHours: 72, minTextLength: 15, perAuthorCooldownDays: 14, maxPerDay: 3 };
  const store = [entry({ id: 'target', status: 'new', indexedAt: new Date(NOW - 9 * DAY).toISOString() })];
  const ann = mod._annotateBlocked(store, cfg, NOW).target;
  assert.strictEqual(ann.blocked_reason, 'too_old');
  assert.strictEqual(ann.can_draft, true, 'the age gate is the one thing the button lifts');
  assert.strictEqual(ann.override_blocked_reason, null);
});

test('a fresh item is queued, not blocked at all', () => {
  const cfg = { maxAgeHours: 72, minTextLength: 15, perAuthorCooldownDays: 14, maxPerDay: 3 };
  const store = [entry({ id: 'target', status: 'new', indexedAt: new Date(NOW - 2 * 3600e3).toISOString() })];
  const ann = mod._annotateBlocked(store, cfg, NOW).target;
  assert.strictEqual(ann.blocked_reason, null, 'nothing stopped it — the cron will draft it next run');
  assert.strictEqual(ann.can_draft, true);
});

test('empty and missing stores are handled without throwing', () => {
  assert.deepStrictEqual(replyRows(null, SINCE, 50), []);
  assert.deepStrictEqual(replyRows([], SINCE, 50), []);
  assert.deepStrictEqual(reactionRows(null, SINCE, 50), []);
  assert.deepStrictEqual(reactionRows(undefined, SINCE, 50), []);
});

async function callHandler(query) {
  const context = { res: null, log: Object.assign(function () {}, { error() {}, warn() {} }) };
  await mod(context, {
    method: 'GET',
    headers: { 'x-company-secret': 'test-secret' },
    query: query || {}
  });
  return context.res;
}

test('a small limit trims what is RETURNED, never what is COUNTED', async () => {
  // `limit` is a rendering budget. The sidebar badge and the counts strip both
  // read counts.needsAttention, so if a page asked for fewer rows the badge
  // would quietly under-report how many people are waiting — a number that
  // changes depending on how you ask for it, which is the same shape as the
  // cumulative-metrics bug that inflated the hub 22x.
  const store = [];
  for (let i = 0; i < 7; i++) {
    store.push(entry({
      id: 'er_' + i,
      replyUri: 'at://did:plc:a/app.bsky.feed.post/r' + i,
      indexedAt: new Date(NOW - (i + 1) * 3600e3).toISOString(),
      status: 'new'
    }));
  }
  fakeState = { engagementReplies: store };

  const res = await callHandler({ limit: '3' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.replies.length, 3, 'limit must still trim the payload');
  assert.strictEqual(res.body.counts.byStatus.new, 7,
    'got ' + res.body.counts.byStatus.new + ' — the count followed the page size');
  assert.strictEqual(res.body.counts.needsAttention, 7,
    'the sidebar badge would under-report by ' + (7 - res.body.counts.needsAttention) + ' people');
});

test('a truncated payload says so, rather than looking like the whole story', async () => {
  const store = [];
  for (let i = 0; i < 7; i++) {
    store.push(entry({
      id: 'er_' + i,
      replyUri: 'at://did:plc:a/app.bsky.feed.post/r' + i,
      indexedAt: new Date(NOW - (i + 1) * 3600e3).toISOString(),
      status: 'new'
    }));
  }
  fakeState = { engagementReplies: store };

  const res = await callHandler({ limit: '3' });
  assert.strictEqual(res.body.meta.repliesTotal, 7);
  assert.strictEqual(res.body.meta.repliesShown, 3);
});

test('an unauthenticated caller gets 403, not the conversations', async () => {
  fakeState = { engagementReplies: [entry()] };
  const context = { res: null, log: Object.assign(function () {}, { error() {}, warn() {} }) };
  await mod(context, { method: 'GET', headers: {}, query: {} });
  assert.strictEqual(context.res.status, 403);
});

// ── Response time (Phase 1b) ────────────────────────────────────────────
//
// The only number that says whether we are conversational rather than merely
// present. Every assertion below exists to stop it becoming a confident zero:
// this panel has already shipped four bugs where one kind of nothing was
// reported as another.

function answered(o) {
  return entry(Object.assign({ status: 'answered' }, o));
}

// hoursAgo(n) → an ISO string n hours before NOW.
function hoursAgo(n) { return new Date(NOW - n * 3600e3).toISOString(); }

test('a median needs three samples — two is an anecdote, not a median', () => {
  const s = responseStats([
    answered({ id: 'a', replyUri: 'at://did:plc:a/app.bsky.feed.post/a', indexedAt: hoursAgo(50), answeredAt: hoursAgo(48) }),
    answered({ id: 'b', replyUri: 'at://did:plc:a/app.bsky.feed.post/b', indexedAt: hoursAgo(40), answeredAt: hoursAgo(30) })
  ], SINCE);
  assert.strictEqual(s.medianHours, null, 'reported a median off two conversations');
  assert.strictEqual(s.samples, 2, 'the reader has to be told how close we are to a real number');
});

test('three samples give the middle one, not the mean', () => {
  const s = responseStats([
    answered({ id: 'a', replyUri: 'at://did:plc:a/app.bsky.feed.post/a', indexedAt: hoursAgo(100), answeredAt: hoursAgo(99) }),   // 1h
    answered({ id: 'b', replyUri: 'at://did:plc:a/app.bsky.feed.post/b', indexedAt: hoursAgo(100), answeredAt: hoursAgo(96) }),   // 4h
    answered({ id: 'c', replyUri: 'at://did:plc:a/app.bsky.feed.post/c', indexedAt: hoursAgo(100), answeredAt: hoursAgo(40) })    // 60h
  ], SINCE);
  assert.strictEqual(s.medianHours, 4, 'got ' + s.medianHours + ' — one slow reply must not move the middle');
  assert.strictEqual(s.samples, 3);
});

test('an even count averages the two middle values', () => {
  const s = responseStats([
    answered({ id: 'a', replyUri: 'at://did:plc:a/app.bsky.feed.post/a', indexedAt: hoursAgo(100), answeredAt: hoursAgo(99) }),   // 1h
    answered({ id: 'b', replyUri: 'at://did:plc:a/app.bsky.feed.post/b', indexedAt: hoursAgo(100), answeredAt: hoursAgo(98) }),   // 2h
    answered({ id: 'c', replyUri: 'at://did:plc:a/app.bsky.feed.post/c', indexedAt: hoursAgo(100), answeredAt: hoursAgo(95) }),   // 5h
    answered({ id: 'd', replyUri: 'at://did:plc:a/app.bsky.feed.post/d', indexedAt: hoursAgo(100), answeredAt: hoursAgo(90) })    // 10h
  ], SINCE);
  assert.strictEqual(s.medianHours, 3.5);
});

test('an answered conversation with no answeredAt is counted, never treated as instant', () => {
  // reconcileEngagement stamps answeredAt, but entries settled before it did
  // have none. Scoring those as 0h would report the fleet as instantaneous.
  const s = responseStats([
    answered({ id: 'a', replyUri: 'at://did:plc:a/app.bsky.feed.post/a', indexedAt: hoursAgo(100), answeredAt: null }),
    answered({ id: 'b', replyUri: 'at://did:plc:a/app.bsky.feed.post/b', indexedAt: hoursAgo(100), answeredAt: hoursAgo(96) }),
    answered({ id: 'c', replyUri: 'at://did:plc:a/app.bsky.feed.post/c', indexedAt: hoursAgo(100), answeredAt: hoursAgo(95) })
  ], SINCE);
  assert.strictEqual(s.medianHours, null, 'two timed samples cannot make a median');
  assert.strictEqual(s.samples, 2);
  assert.strictEqual(s.answeredNoTimestamp, 1,
    'silently dropping it makes "not enough data" indistinguishable from "nobody replied"');
});

test('a reply answered before it arrived is skew, not a zero-hour response', () => {
  const s = responseStats([
    answered({ id: 'a', replyUri: 'at://did:plc:a/app.bsky.feed.post/a', indexedAt: hoursAgo(40), answeredAt: hoursAgo(50) }),
    answered({ id: 'b', replyUri: 'at://did:plc:a/app.bsky.feed.post/b', indexedAt: hoursAgo(100), answeredAt: hoursAgo(96) }),
    answered({ id: 'c', replyUri: 'at://did:plc:a/app.bsky.feed.post/c', indexedAt: hoursAgo(100), answeredAt: hoursAgo(95) })
  ], SINCE);
  assert.strictEqual(s.samples, 2, 'a negative interval was counted');
  assert.strictEqual(s.medianHours, null);
});

test('only answered conversations count — a queued draft is not a response', () => {
  const s = responseStats([
    entry({ id: 'a', replyUri: 'at://did:plc:a/app.bsky.feed.post/a', status: 'task_created', indexedAt: hoursAgo(100), answeredAt: hoursAgo(99) }),
    entry({ id: 'b', replyUri: 'at://did:plc:a/app.bsky.feed.post/b', status: 'skipped', indexedAt: hoursAgo(100), answeredAt: hoursAgo(99) }),
    answered({ id: 'c', replyUri: 'at://did:plc:a/app.bsky.feed.post/c', indexedAt: hoursAgo(100), answeredAt: hoursAgo(95) })
  ], SINCE);
  assert.strictEqual(s.samples, 1);
});

test('conversations outside the window do not prop up the median', () => {
  const s = responseStats([
    answered({ id: 'old', replyUri: 'at://did:plc:a/app.bsky.feed.post/o', indexedAt: new Date(NOW - 90 * DAY).toISOString(), answeredAt: new Date(NOW - 89 * DAY).toISOString() }),
    answered({ id: 'b', replyUri: 'at://did:plc:a/app.bsky.feed.post/b', indexedAt: hoursAgo(100), answeredAt: hoursAgo(96) }),
    answered({ id: 'c', replyUri: 'at://did:plc:a/app.bsky.feed.post/c', indexedAt: hoursAgo(100), answeredAt: hoursAgo(95) })
  ], SINCE);
  assert.strictEqual(s.samples, 2, 'the window the rows use must be the window the number uses');
});

test('an empty store reports no samples rather than throwing or claiming zero', () => {
  assert.deepStrictEqual(responseStats([], SINCE), { medianHours: null, samples: 0, answeredNoTimestamp: 0 });
  assert.deepStrictEqual(responseStats(null, SINCE), { medianHours: null, samples: 0, answeredNoTimestamp: 0 });
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\nengagementInbox: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
