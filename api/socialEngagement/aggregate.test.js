// socialEngagement — engagement aggregation (2026-08-09).
//
// Run with: node api/socialEngagement/aggregate.test.js
//
// The bug this locks down, measured in production before the fix:
//
//   the hub reported   374 likes / 368 comments  for "last 7 days"
//   the posts held      17 likes /  17 comments  between them, LIFETIME
//
// A snapshot's metrics are the post's cumulative counts at the moment we polled.
// The aggregate summed every row, and the cron polls each post ~22 times a week,
// so every number came out ~22x too big and grew if you polled more often. The
// engagement KPI measured the cron schedule.
//
// Two smaller lies rode along: every post rendered with blank text (the text was
// looked up in `actions`, a store trimmed to about a week, while snapshots keep
// 60 days), and "top post this week" filtered on when we last POLLED, so a post
// from 2026-07-24 was that week's winner.

const assert = require('assert');
const mod = require('./index');
const aggregate = mod._aggregateEngagement;

const NOW = Date.parse('2026-08-08T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
function snap(opts) {
  return {
    id: 'seg_' + (++seq),
    post_platform: opts.platform || 'bluesky',
    post_id: opts.postId || 'post_1',
    post_url: opts.url || 'https://bsky.app/x/1',
    action_id: opts.actionId || 'act_1',
    agent_id: 'echo',
    post_text: opts.text === undefined ? '' : opts.text,
    captured_at: opts.at,
    window_hint: 'pull',
    metrics: {
      likes: opts.likes === undefined ? null : opts.likes,
      comments: opts.comments === undefined ? null : opts.comments,
      reposts: opts.reposts === undefined ? null : opts.reposts,
      quotes: null, views: null, clicks: null
    },
    meta: { mode: 'real', source: 'api', error_class: null, error_code: null, error_message: null }
  };
}

function run(rows, meta) {
  const desc = rows.slice().sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
  return aggregate(desc, desc, meta || {}, 0, 50, NOW);
}

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

test('polling the same post 22 times counts its likes ONCE', () => {
  // The production shape exactly: one post, four likes, polled every few hours.
  const rows = [];
  for (let i = 0; i < 22; i++) {
    rows.push(snap({ at: new Date(NOW - (5 * DAY) + (i * 5 * 60 * 60 * 1000)).toISOString(), likes: 4, comments: 0, reposts: 0 }));
  }
  const out = run(rows);
  assert.strictEqual(out.summary.likes7d, 4,
    'got ' + out.summary.likes7d + ' — the old aggregate returned 88 for this exact input');
  assert.strictEqual(out.summary.basis, 'earned');
});

test('a week reports engagement EARNED that week, not lifetime totals', () => {
  // Published three weeks ago with 10 likes; gained 2 more this week. The week
  // earned 2. Reporting 12 would credit this week with three weeks of work.
  const rows = [
    snap({ at: new Date(NOW - 20 * DAY).toISOString(), likes: 10, comments: 3, reposts: 1 }),
    snap({ at: new Date(NOW - 1 * DAY).toISOString(), likes: 12, comments: 3, reposts: 1 })
  ];
  const out = run(rows);
  assert.strictEqual(out.summary.likes7d, 2);
  assert.strictEqual(out.summary.comments7d, 0);
  assert.strictEqual(out.summary.reposts7d, 0);
});

test('a baseline OUTSIDE the window still anchors the delta', () => {
  // If the aggregate only looked at in-window rows it would treat the first one
  // it saw as freshly earned and report 12 instead of 2. This is why the handler
  // passes every snapshot of a post, not just the ones inside from/to.
  const rows = [
    snap({ at: new Date(NOW - 25 * DAY).toISOString(), likes: 10 }),
    snap({ at: new Date(NOW - 2 * DAY).toISOString(), likes: 12 })
  ];
  assert.strictEqual(run(rows).summary.likes7d, 2);
});

test('a failed pull is unknown, not zero', () => {
  // socialEngagementPull writes null metrics when a platform call fails. Reading
  // null as 0 books a collapse to zero and then re-earns the whole post next
  // poll — a phantom spike from an outage.
  const rows = [
    snap({ at: new Date(NOW - 4 * DAY).toISOString(), likes: 6 }),
    snap({ at: new Date(NOW - 3 * DAY).toISOString(), likes: undefined }),  // failed pull
    snap({ at: new Date(NOW - 2 * DAY).toISOString(), likes: 6 })
  ];
  assert.strictEqual(run(rows).summary.likes7d, 6, 'the outage re-earned the post');
});

test('a deleted or unliked post does not produce negative engagement', () => {
  const rows = [
    snap({ at: new Date(NOW - 4 * DAY).toISOString(), likes: 8 }),
    snap({ at: new Date(NOW - 1 * DAY).toISOString(), likes: 0 })   // deleted
  ];
  const out = run(rows);
  assert.strictEqual(out.summary.likes7d, 8, 'the drop must not be subtracted back out');
  out.trends.last30.forEach((d) => assert.ok(d.likes >= 0, 'negative day in the chart: ' + JSON.stringify(d)));
});

test('the daily chart and the 7d summary agree', () => {
  const rows = [
    snap({ at: new Date(NOW - 5 * DAY).toISOString(), likes: 1, comments: 1 }),
    snap({ at: new Date(NOW - 3 * DAY).toISOString(), likes: 3, comments: 2 }),
    snap({ at: new Date(NOW - 1 * DAY).toISOString(), likes: 4, comments: 2 })
  ];
  const out = run(rows);
  const chart = out.trends.last7.reduce((a, d) => ({ l: a.l + d.likes, c: a.c + d.comments }), { l: 0, c: 0 });
  assert.strictEqual(chart.l, out.summary.likes7d);
  assert.strictEqual(chart.c, out.summary.comments7d);
});

test('"top post this week" means published this week, not polled this week', () => {
  const old = { platform: 'x', postId: 'old', actionId: 'act_old', url: 'https://x.com/1' };
  const fresh = { platform: 'bluesky', postId: 'new', actionId: 'act_new', url: 'https://bsky.app/2' };
  const rows = [
    // A July post with more engagement, re-polled today.
    snap(Object.assign({ at: new Date(NOW - 15 * DAY).toISOString(), likes: 9 }, old)),
    snap(Object.assign({ at: new Date(NOW - 1 * DAY).toISOString(), likes: 9 }, old)),
    // This week's post, quieter.
    snap(Object.assign({ at: new Date(NOW - 1 * DAY).toISOString(), likes: 1 }, fresh))
  ];
  const out = run(rows, {
    publishedAtByAction: {
      act_old: new Date(NOW - 15 * DAY).toISOString(),
      act_new: new Date(NOW - 1 * DAY).toISOString()
    }
  });
  assert.strictEqual(out.topPosts.length, 1, 'the July post is still in this week: ' + JSON.stringify(out.topPosts));
  assert.strictEqual(out.topPosts[0].action_id, 'act_new');
});

test('a post keeps its words after the actions store has rolled past it', () => {
  // The blank-row bug: text_preview resolved from `actions`, trimmed to ~a week,
  // while these snapshots live 60 days. Now stamped on the snapshot itself.
  const rows = [snap({ at: new Date(NOW - 1 * DAY).toISOString(), likes: 2, text: 'Your resume says "responsible for" eleven times.' })];
  const out = run(rows, { publishedAtByAction: { act_1: new Date(NOW - DAY).toISOString() }, actionTextMap: {} });
  assert.strictEqual(out.topPosts[0].text_preview, 'Your resume says "responsible for" eleven times.');
});

test('rows captured before the stamp shipped fall back to the live action', () => {
  const rows = [snap({ at: new Date(NOW - 1 * DAY).toISOString(), likes: 2, text: '' })];
  const out = run(rows, {
    publishedAtByAction: { act_1: new Date(NOW - DAY).toISOString() },
    actionTextMap: { act_1: 'still resolvable while the action lives' }
  });
  assert.strictEqual(out.topPosts[0].text_preview, 'still resolvable while the action lives');
});

test('the zero-engagement rate counts posts published, not posts polled', () => {
  const mk = (id, likes) => snap({
    at: new Date(NOW - 2 * DAY).toISOString(), likes: likes,
    postId: id, actionId: 'act_' + id, url: 'https://bsky.app/' + id
  });
  const rows = [mk('a', 2), mk('b', 0), mk('c', 0), mk('d', 0)];
  const published = {};
  ['a', 'b', 'c', 'd'].forEach((id) => { published['act_' + id] = new Date(NOW - 2 * DAY).toISOString(); });
  const out = run(rows, { publishedAtByAction: published });
  assert.strictEqual(out.summary.postsPublished7d, 4);
  assert.strictEqual(out.summary.postsEngaged7d, 1);
  assert.strictEqual(out.summary.zeroEngagementRate7d, 75);
});

test('the per-platform split is earned too, not cumulative x22', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push(snap({ at: new Date(NOW - (4 * DAY) + i * 3600000).toISOString(), likes: 3, platform: 'x', postId: 'xp', actionId: 'act_x', url: 'https://x.com/9' }));
  }
  const out = run(rows, { publishedAtByAction: { act_x: new Date(NOW - 4 * DAY).toISOString() } });
  assert.strictEqual(out.engagementSplit.x.likes7d, 3, 'split inflated: ' + out.engagementSplit.x.likes7d);
  assert.strictEqual(out.engagementSplit.x.posts7d, 1);
  assert.strictEqual(out.engagementSplit.bluesky.likes7d, 0);
});

test('an empty store answers zeros without throwing', () => {
  const out = run([]);
  assert.strictEqual(out.summary.likes7d, 0);
  assert.strictEqual(out.summary.zeroEngagementRate7d, null, 'no posts is unmeasured, not 0% zero-engagement');
  assert.deepStrictEqual(out.topPosts, []);
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\nsocialEngagement aggregate: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
