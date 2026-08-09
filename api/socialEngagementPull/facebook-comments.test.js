// Run with: node api/socialEngagementPull/facebook-comments.test.js
//
// Covers the harvest path that puts Facebook comments in the Engagement Inbox, and
// the guard that stops one becoming a Bluesky reply.

const assert = require('assert');
const fb = require('./facebook-comments');
const engagement = require('../companyHeartbeat/engagement-reply');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

const NOW = Date.parse('2026-08-09T12:00:00.000Z');
const OUR_POST = {
  postId: '1250918731441250_9988',
  actionId: 'act_fb_1',
  permalink: 'https://www.facebook.com/122105341017424861/posts/9988',
  text: 'My AI agents police each other without asking me.'
};

function comment(over) {
  return Object.assign({
    id: '9988_111',
    post_id: OUR_POST.postId,
    author: 'Dana Reeve',
    author_id: '7001',
    text: 'How do you stop them from just agreeing with each other all the time?',
    created_time: '2026-08-09T11:00:00.000Z',
    permalink: 'https://www.facebook.com/9988?comment_id=111',
    likes: 2,
    is_reply: false
  }, over || {});
}

console.log('\nbuildCommentEntries');

test('maps a Graph comment to the shape the inbox reads', () => {
  const out = fb.buildCommentEntries([comment()], OUR_POST, '1250918731441250', NOW);
  assert.strictEqual(out.candidates.length, 1);
  const c = out.candidates[0];
  assert.strictEqual(c.platform, 'facebook', 'platform must be stamped or the inbox defaults it to bluesky');
  assert.strictEqual(c.replyUri, 'fb:9988_111', 'replyUri is the dedup key and must be namespaced');
  assert.strictEqual(c.rootUri, 'fb:' + OUR_POST.postId);
  assert.strictEqual(c.author, 'Dana Reeve');
  assert.strictEqual(c.permalink, 'https://www.facebook.com/9988?comment_id=111');
  assert.strictEqual(c.ourPostPermalink, OUR_POST.permalink);
  assert.strictEqual(c.ourPostActionId, 'act_fb_1');
  assert.strictEqual(c.ourPostAtUri, null, 'a Facebook row has no at:// uri');
});

test('excludes the Page talking to itself', () => {
  const out = fb.buildCommentEntries(
    [comment({ id: '9988_self', author_id: '1250918731441250', author: 'AmbientPixels' })],
    OUR_POST, '1250918731441250', NOW
  );
  assert.strictEqual(out.candidates.length, 0);
  assert.strictEqual(out.selfExcluded, 1);
});

test('a comment with no id is malformed, not a new conversation every run', () => {
  const out = fb.buildCommentEntries([comment({ id: '' })], OUR_POST, '1250918731441250', NOW);
  assert.strictEqual(out.candidates.length, 0);
  assert.strictEqual(out.malformed, 1);
});

test('anonymous commenter keeps a renderable author (inbox drops authorless rows)', () => {
  const out = fb.buildCommentEntries([comment({ author: '', author_id: null })], OUR_POST, '125', NOW);
  assert.strictEqual(out.candidates[0].author, 'Facebook user');
});

test('missing page id does not drop everyone as self', () => {
  const out = fb.buildCommentEntries([comment()], OUR_POST, null, NOW);
  assert.strictEqual(out.candidates.length, 1);
  assert.strictEqual(out.selfExcluded, 0);
});

console.log('\nselectFacebookTargets');

const EVENTS = [
  { event_type: 'execution', result: 'success', platform: 'facebook', action_id: 'act_fb_1', executed_at: '2026-08-09T10:00:00.000Z' },
  { event_type: 'execution', result: 'success', platform: 'bluesky', action_id: 'act_bs_1', executed_at: '2026-08-09T10:00:00.000Z' },
  { event_type: 'execution', result: 'failure', platform: 'facebook', action_id: 'act_fb_fail', executed_at: '2026-08-09T10:00:00.000Z' }
];
const ACTIONS_BY_ID = {
  act_fb_1: { id: 'act_fb_1', payload: { text: 'hello' }, execution: { receipt: { post_id: '125_9988', post_url: 'https://www.facebook.com/x/posts/9988' } } }
};

test('takes the post id from the receipt, never from the url', () => {
  const sel = fb.selectFacebookTargets(EVENTS, ACTIONS_BY_ID, 0, 25);
  assert.strictEqual(sel.targets.length, 1);
  assert.strictEqual(sel.targets[0].postId, '125_9988');
  assert.strictEqual(sel.targets[0].text, 'hello');
});

test('a post whose receipt is gone is counted, not guessed', () => {
  const sel = fb.selectFacebookTargets(EVENTS, {}, 0, 25);
  assert.strictEqual(sel.targets.length, 0);
  assert.strictEqual(sel.skippedNoPostId, 1, 'must be reported so the cap is never silent');
});

test('ignores other platforms and failed publishes', () => {
  const sel = fb.selectFacebookTargets(EVENTS, ACTIONS_BY_ID, 0, 25);
  assert.ok(sel.targets.every((t) => t.postId === '125_9988'));
});

console.log('\npullFacebookComments');

function fakeStorage(initial) {
  return {
    state: { engagementReplies: initial },
    async mutateState(key, fn) {
      const next = fn(this.state[key]);
      if (next === undefined) return { written: false, attempts: 1 };
      this.state[key] = next;
      return { written: true, attempts: 1 };
    }
  };
}

const baseOpts = (over) => Object.assign({
  actionsById: ACTIONS_BY_ID,
  events: EVENTS,
  sinceMs: 0,
  nowMs: NOW,
  log: () => {},
  getPageId: async () => '1250918731441250'
}, over || {});

(async () => {
  await testAsync('harvests a comment into engagementReplies', async () => {
    const storage = fakeStorage([]);
    const s = await fb.pullFacebookComments(baseOpts({
      storage,
      fetchComments: async () => [comment()]
    }));
    assert.strictEqual(s.added, 1);
    assert.strictEqual(storage.state.engagementReplies.length, 1);
    const e = storage.state.engagementReplies[0];
    assert.strictEqual(e.status, 'new');
    assert.strictEqual(e.platform, 'facebook');
    assert.ok(e.id, 'mergeCandidates stamps an id');
  });

  await testAsync('null read is an error, NOT an empty inbox', async () => {
    const storage = fakeStorage([]);
    const s = await fb.pullFacebookComments(baseOpts({
      storage,
      fetchComments: async () => null
    }));
    assert.strictEqual(s.readErrors, 1, 'null must count as a failed read');
    assert.strictEqual(s.added, 0);
    assert.strictEqual(s.emptyPosts, 0, 'a failed read is not a post with no comments');
  });

  await testAsync('empty array is a post nobody commented on', async () => {
    const storage = fakeStorage([]);
    const s = await fb.pullFacebookComments(baseOpts({
      storage,
      fetchComments: async () => []
    }));
    assert.strictEqual(s.readErrors, 0);
    assert.strictEqual(s.emptyPosts, 1);
    assert.strictEqual(s.added, 0);
  });

  await testAsync('re-running does not duplicate the same comment', async () => {
    const storage = fakeStorage([]);
    const opts = baseOpts({ storage, fetchComments: async () => [comment()] });
    await fb.pullFacebookComments(opts);
    const second = await fb.pullFacebookComments(opts);
    assert.strictEqual(second.added, 0, 'dedup is on replyUri');
    assert.strictEqual(storage.state.engagementReplies.length, 1);
  });

  await testAsync('a throwing read is non-fatal and counted', async () => {
    const storage = fakeStorage([]);
    const s = await fb.pullFacebookComments(baseOpts({
      storage,
      fetchComments: async () => { throw new Error('graph exploded'); }
    }));
    assert.strictEqual(s.readErrors, 1);
    assert.strictEqual(s.added, 0);
  });

  await testAsync('a failed write reports added:0 rather than a phantom success', async () => {
    const storage = fakeStorage([]);
    storage.mutateState = async () => ({ written: false, attempts: 3 });
    const s = await fb.pullFacebookComments(baseOpts({
      storage,
      fetchComments: async () => [comment()]
    }));
    assert.strictEqual(s.added, 0, 'nothing persisted means nothing added');
  });

  console.log('\nthe guard: a Facebook comment must never draft a Bluesky reply');

  await testAsync('filterCandidates refuses a facebook entry', async () => {
    const storage = fakeStorage([]);
    await fb.pullFacebookComments(baseOpts({
      storage,
      fetchComments: async () => [comment()]
    }));
    const store = storage.state.engagementReplies;
    const v = engagement.filterCandidates(store, { maxAgeHours: 72, minTextLength: 15, maxPerDay: 3 }, NOW);
    assert.strictEqual(v.survivors.length, 0, 'a facebook row must never survive into buildEngagementReplyTask');
    assert.strictEqual(v.drops.unsupported_platform, 1);
  });

  test('a bluesky entry still drafts normally', () => {
    const store = [{
      id: 'er_1', status: 'new', platform: 'bluesky',
      replyUri: 'at://did:plc:x/app.bsky.feed.post/1', rootUri: 'at://did:plc:x/app.bsky.feed.post/0',
      author: 'someone.bsky.social',
      text: 'This is a long enough question about how the agents actually work.',
      indexedAt: new Date(NOW - 3600e3).toISOString()
    }];
    const v = engagement.filterCandidates(store, { maxAgeHours: 72, minTextLength: 15, maxPerDay: 3 }, NOW);
    assert.strictEqual(v.survivors.length, 1);
    assert.strictEqual(v.drops.unsupported_platform, 0);
  });

  test('a legacy entry with no platform field still drafts (backlog must not go silent)', () => {
    const store = [{
      id: 'er_legacy', status: 'new',
      replyUri: 'at://did:plc:x/app.bsky.feed.post/2', rootUri: 'at://did:plc:x/app.bsky.feed.post/0',
      author: 'legacy.bsky.social',
      text: 'An older comment harvested before the platform field existed at all.',
      indexedAt: new Date(NOW - 3600e3).toISOString()
    }];
    const v = engagement.filterCandidates(store, { maxAgeHours: 72, minTextLength: 15, maxPerDay: 3 }, NOW);
    assert.strictEqual(v.survivors.length, 1, 'absent platform means bluesky');
  });

  console.log('\n' + passed + ' passed');
})();
