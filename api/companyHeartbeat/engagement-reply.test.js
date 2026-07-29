// Run: node api/companyHeartbeat/engagement-reply.test.js
// Engagement Reply Loop — unit tests (plan: docs/superpowers/plans/2026-07-28-engagement-reply-loop.md)
// Harness style mirrors prospect-pipeline.test.js.
const assert = require('node:assert');
const ER = require('./engagement-reply');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}
function atest(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log('  PASS ', name); })
    .catch(e => { fail++; console.log('  FAIL ', name, '-', e.message); });
}

const NOW = Date.parse('2026-07-28T18:00:00Z');
const HOUR = 3600e3;

// ── fixtures ─────────────────────────────────────────────────────────────────
// Our DID everywhere: the fetched thread's post author IS us (snapshots only
// cover our own posts), so self-exclusion is per-thread self-comparison.
const OUR_DID = 'did:plc:ambientpixels';
const OUR_HANDLE = 'ambientpixels.bsky.social';

function ourPost(over) {
  return Object.assign({
    uri: 'at://did:plc:ambientpixels/app.bsky.feed.post/ours1',
    cid: 'cid-ours1',
    author: { did: OUR_DID, handle: OUR_HANDLE },
    record: { text: 'Your homepage headline buries the value prop. Lead with the outcome.' },
    indexedAt: new Date(NOW - 48 * HOUR).toISOString()
  }, over || {});
}

// A reply post as returned inside thread.replies[].post
function replyPost(over) {
  const base = {
    uri: 'at://did:plc:alvaro/app.bsky.feed.post/r1',
    cid: 'cid-r1',
    author: { did: 'did:plc:alvaro', handle: 'alvaromartincrespo.bsky.social' },
    record: {
      text: 'Gracias! ¿Cómo sería un ejemplo de reescritura del titular?',
      reply: {
        root: { uri: 'at://did:plc:alvaro/app.bsky.feed.post/original', cid: 'cid-original' },
        parent: { uri: 'at://did:plc:ambientpixels/app.bsky.feed.post/ours1', cid: 'cid-ours1' }
      }
    },
    indexedAt: new Date(NOW - 20 * HOUR).toISOString()
  };
  const merged = Object.assign({}, base, over || {});
  if (over && over.record) merged.record = Object.assign({}, base.record, over.record);
  if (over && over.author) merged.author = Object.assign({}, base.author, over.author);
  return merged;
}

function thread(post, replies) {
  return { post: post, replies: (replies || []).map(p => ({ post: p })) };
}

function snap(over) {
  return Object.assign({
    actionId: 'act_ours1',
    platform: 'bluesky',
    atUri: 'at://did:plc:ambientpixels/app.bsky.feed.post/ours1',
    postUrl: 'https://bsky.app/profile/ambientpixels.bsky.social/post/ours1',
    publishedAt: new Date(NOW - 48 * HOUR).toISOString(),
    samples: [{ lag: 't1', comments: 1, likes: 0, reposts: 0 }]
  }, over || {});
}

const CFG = ER.loadConfig({});

// ── loadConfig ───────────────────────────────────────────────────────────────
test('loadConfig defaults match the locked design decisions', () => {
  assert.strictEqual(CFG.enabled, true);
  assert.strictEqual(CFG.maxPerDay, 3);
  assert.strictEqual(CFG.maxAgeHours, 72);
  assert.strictEqual(CFG.perAuthorCooldownDays, 14);
});

test('loadConfig merges systemConfig.engagementReply per-key (MERGE semantics)', () => {
  const cfg = ER.loadConfig({ engagementReply: { maxAgeHours: 168 } });
  assert.strictEqual(cfg.maxAgeHours, 168);
  assert.strictEqual(cfg.maxPerDay, 3); // untouched default survives
});

// ── eligibleSnapshots ────────────────────────────────────────────────────────
test('eligibleSnapshots: bluesky + atUri + any sample comments > 0', () => {
  const store = {
    a: snap({ actionId: 'a' }),
    b: snap({ actionId: 'b', samples: [{ lag: 't1', comments: 0 }] }),           // no comments
    c: snap({ actionId: 'c', platform: 'x' }),                                    // wrong platform
    d: snap({ actionId: 'd', atUri: null }),                                      // no atUri
    e: snap({ actionId: 'e', samples: [{ lag: 't1', error: 'X' }, { lag: 't7', comments: 2 }] })
  };
  const el = ER.eligibleSnapshots(store);
  const ids = el.map(x => x.actionId).sort();
  assert.deepStrictEqual(ids, ['a', 'e']);
});

// ── harvestFromThread ────────────────────────────────────────────────────────
test('harvest maps the thread shape correctly (incl. true root from record.reply.root)', () => {
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [replyPost()]), NOW);
  assert.strictEqual(h.candidates.length, 1);
  const c = h.candidates[0];
  assert.strictEqual(c.replyUri, 'at://did:plc:alvaro/app.bsky.feed.post/r1');
  assert.strictEqual(c.replyCid, 'cid-r1');
  assert.strictEqual(c.rootUri, 'at://did:plc:alvaro/app.bsky.feed.post/original'); // TRUE thread root
  assert.strictEqual(c.rootCid, 'cid-original');
  assert.strictEqual(c.author, 'alvaromartincrespo.bsky.social');
  assert.strictEqual(c.authorDid, 'did:plc:alvaro');
  assert.strictEqual(c.ourPostActionId, 'act_ours1');
  assert.ok(c.ourPostText.indexOf('headline buries') !== -1);
  assert.ok(c.text.indexOf('reescritura') !== -1);
});

test('harvest: top-level reply with no record.reply falls back to our post as root', () => {
  const rp = replyPost({ record: { text: 'Thank you, I implemented the suggestions.', reply: undefined } });
  delete rp.record.reply;
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [rp]), NOW);
  assert.strictEqual(h.candidates[0].rootUri, ourPost().uri);
  assert.strictEqual(h.candidates[0].rootCid, ourPost().cid);
});

test('harvest excludes self-replies (thread post author DID = us)', () => {
  const selfReply = replyPost({ author: { did: OUR_DID, handle: OUR_HANDLE } });
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [selfReply, replyPost()]), NOW);
  assert.strictEqual(h.candidates.length, 1);
  assert.strictEqual(h.selfExcluded, 1);
});

test('harvest tolerates malformed replies (missing uri/cid/author)', () => {
  const bad = replyPost({ cid: null });
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [bad]), NOW);
  assert.strictEqual(h.candidates.length, 0);
  assert.strictEqual(h.malformed, 1);
});

// ── mergeCandidates ──────────────────────────────────────────────────────────
test('merge dedups on replyUri across runs (idempotent re-harvest)', () => {
  const store = [];
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [replyPost()]), NOW);
  const first = ER.mergeCandidates(store, h.candidates, NOW);
  const second = ER.mergeCandidates(store, h.candidates, NOW);
  assert.strictEqual(first.added, 1);
  assert.strictEqual(second.added, 0);
  assert.strictEqual(store.length, 1);
  assert.strictEqual(store[0].status, 'new');
  assert.ok(store[0].id);
});

test('merge enforces the 500 FIFO cap', () => {
  const store = [];
  for (let i = 0; i < 505; i++) {
    store.push({ id: 'er_' + i, replyUri: 'at://x/' + i, status: 'skipped' });
  }
  ER.mergeCandidates(store, [], NOW);
  assert.strictEqual(store.length, 500);
  assert.strictEqual(store[0].replyUri, 'at://x/5'); // oldest 5 dropped
});

// ── filterCandidates ─────────────────────────────────────────────────────────
function entryFrom(candidate, over) {
  const h = { id: 'er_t', status: 'new', taskId: null, discoveredAt: new Date(NOW).toISOString() };
  return Object.assign(h, candidate, over || {});
}

test('filter passes a fresh, substantial reply', () => {
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [replyPost()]), NOW);
  const store = [entryFrom(h.candidates[0])];
  const r = ER.filterCandidates(store, CFG, NOW);
  assert.strictEqual(r.survivors.length, 1);
});

test('filter drops replies older than maxAgeHours', () => {
  const old = replyPost({ indexedAt: new Date(NOW - 80 * HOUR).toISOString() });
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [old]), NOW);
  const store = [entryFrom(h.candidates[0])];
  const r = ER.filterCandidates(store, CFG, NOW);
  assert.strictEqual(r.survivors.length, 0);
  assert.strictEqual(r.drops.too_old, 1);
});

test('filter drops short/bare-emoji replies ("nice", emoji spam)', () => {
  const short1 = replyPost({ uri: 'at://x/s1', record: { text: 'nice' } });
  const short2 = replyPost({ uri: 'at://x/s2', record: { text: '🔥🔥🔥 ❤️' } });
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [short1, short2]), NOW);
  const store = h.candidates.map(c => entryFrom(c));
  const r = ER.filterCandidates(store, CFG, NOW);
  assert.strictEqual(r.survivors.length, 0);
  assert.strictEqual(r.drops.too_short, 2);
});

test('filter enforces one reply per person per thread ever (author_thread_done)', () => {
  const done = entryFrom(ER.harvestFromThread(snap(), thread(ourPost(), [replyPost()]), NOW).candidates[0],
    { replyUri: 'at://old/r0', status: 'answered', answeredAt: new Date(NOW - 100 * 86400e3).toISOString() });
  const again = entryFrom(ER.harvestFromThread(snap(), thread(ourPost(), [replyPost({ uri: 'at://x/r2', cid: 'cid-r2' })]), NOW).candidates[0]);
  const r = ER.filterCandidates([done, again], CFG, NOW);
  assert.strictEqual(r.survivors.length, 0);
  assert.strictEqual(r.drops.author_thread_done, 1);
});

test('filter enforces perAuthorCooldownDays across DIFFERENT threads', () => {
  const answered = entryFrom(ER.harvestFromThread(snap(), thread(ourPost(), [replyPost()]), NOW).candidates[0], {
    replyUri: 'at://old/r0', rootUri: 'at://old/rootA', status: 'answered',
    answeredAt: new Date(NOW - 5 * 86400e3).toISOString()
  });
  const otherThread = entryFrom(ER.harvestFromThread(snap(), thread(ourPost(), [replyPost({ uri: 'at://x/r3', cid: 'cid-r3' })]), NOW).candidates[0],
    { rootUri: 'at://other/rootB' });
  const r = ER.filterCandidates([answered, otherThread], CFG, NOW);
  assert.strictEqual(r.survivors.length, 0);
  assert.strictEqual(r.drops.author_cooldown, 1);
  // outside the cooldown window the same author becomes eligible again
  const stale = Object.assign({}, answered, { answeredAt: new Date(NOW - 20 * 86400e3).toISOString() });
  const r2 = ER.filterCandidates([stale, otherThread], CFG, NOW);
  assert.strictEqual(r2.survivors.length, 1);
});

test('filter daily budget: maxPerDay minus tasks already created today, and same-run selections consume it', () => {
  const already = [];
  for (let i = 0; i < 2; i++) {
    already.push(entryFrom(ER.harvestFromThread(snap(), thread(ourPost(), [replyPost({ uri: 'at://b/' + i, cid: 'c' + i, author: { did: 'did:plc:b' + i, handle: 'b' + i + '.bsky.social' } })]), NOW).candidates[0], {
      status: 'task_created', taskId: 'task_x' + i, taskCreatedAt: new Date(NOW - 1 * HOUR).toISOString(), rootUri: 'at://done/' + i
    }));
  }
  const fresh = [];
  for (let i = 0; i < 3; i++) {
    fresh.push(entryFrom(ER.harvestFromThread(snap(), thread(ourPost(), [replyPost({ uri: 'at://f/' + i, cid: 'f' + i, author: { did: 'did:plc:f' + i, handle: 'f' + i + '.bsky.social' } })]), NOW).candidates[0],
      { rootUri: 'at://fresh/' + i }));
  }
  const r = ER.filterCandidates(already.concat(fresh), CFG, NOW);
  assert.strictEqual(r.survivors.length, 1); // 3 cap - 2 today = 1
  assert.strictEqual(r.drops.daily_budget, 2);
});

test('filter blocks the same author twice in one run (selection feeds the cooldown set)', () => {
  const a = entryFrom(ER.harvestFromThread(snap(), thread(ourPost(), [replyPost({ uri: 'at://x/a1', cid: 'a1' })]), NOW).candidates[0], { rootUri: 'at://t/1' });
  const b = entryFrom(ER.harvestFromThread(snap(), thread(ourPost(), [replyPost({ uri: 'at://x/a2', cid: 'a2' })]), NOW).candidates[0], { rootUri: 'at://t/2' });
  const r = ER.filterCandidates([a, b], CFG, NOW);
  assert.strictEqual(r.survivors.length, 1);
  assert.strictEqual(r.drops.author_cooldown, 1);
});

// ── asksProductQuestion ──────────────────────────────────────────────────────
test('asksProductQuestion: live Spanish follow-up question → true (question mark + topic word)', () => {
  assert.strictEqual(ER.asksProductQuestion('Gracias! ¿Cómo sería un ejemplo de reescritura del titular?'), true);
});

test('asksProductQuestion: live thank-you (topic word but NO question) → false', () => {
  assert.strictEqual(ER.asksProductQuestion('Thank you, I implemented the suggestions.'), false);
});

test('asksProductQuestion: off-topic question → false', () => {
  assert.strictEqual(ER.asksProductQuestion('How are you doing today?'), false);
});

// ── findScanComment ──────────────────────────────────────────────────────────
const SCAN_CMT = '[SCAN RESULT] Score 62/100 (C). Key findings: headline vague. Report: https://ambientpixels.ai/ambientscore/report.html?id=ccr_abc123';
function scanFixtures() {
  const actions = [{ id: 'act_ours1', type: 'social_post.reply', _parentTaskId: 'task_parent1' }];
  const tasks = [{ id: 'task_parent1', comments: [{ id: 'c1', text: SCAN_CMT }] }];
  return { actions, tasks };
}

test('findScanComment walks ourPostActionId → parent task → [SCAN RESULT] comment', () => {
  const { actions, tasks } = scanFixtures();
  const entry = { ourPostActionId: 'act_ours1' };
  assert.strictEqual(ER.findScanComment(entry, actions, tasks), SCAN_CMT);
});

test('findScanComment returns null when there is no parent chain', () => {
  assert.strictEqual(ER.findScanComment({ ourPostActionId: 'act_none' }, [], []), null);
});

// ── buildEngagementReplyTask ─────────────────────────────────────────────────
test('task shape: tags, scribe, todo, source, objective, threadContext with root carried', () => {
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [replyPost()]), NOW);
  const entry = entryFrom(h.candidates[0]);
  const task = ER.buildEngagementReplyTask(entry, null, NOW);
  assert.strictEqual(task.taskType, 'bluesky_reply');
  assert.strictEqual(task.status, 'todo');
  assert.strictEqual(task.assignee, 'scribe');
  assert.strictEqual(task.source, 'engagementReply');
  assert.strictEqual(task.objective_id, 'obj-first-customer');
  assert.deepStrictEqual(task.tags, ['bluesky-reply', 'engagement-reply']);
  assert.ok(task.title.indexOf('@alvaromartincrespo.bsky.social') !== -1);
  // threadContext: parent = THEIR reply, root = TRUE thread root
  assert.strictEqual(task.threadContext.uri, entry.replyUri);
  assert.strictEqual(task.threadContext.cid, entry.replyCid);
  assert.strictEqual(task.threadContext.root.uri, entry.rootUri);
  assert.strictEqual(task.threadContext.root.cid, entry.rootCid);
  assert.strictEqual(task.threadContext.author, entry.author);
  assert.strictEqual(task.threadContext.originalText, entry.text);
  // description carries both sides of the conversation + the language rule
  assert.ok(task.description.indexOf(entry.text) !== -1);
  assert.ok(task.description.indexOf('headline buries') !== -1);
  assert.ok(/same language/i.test(task.description));
  assert.ok(task.dueDate);
  assert.strictEqual(task.comments.length, 0);
});

test('task carries the [SCAN RESULT] comment verbatim when provided (link repair + grounding hook)', () => {
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [replyPost()]), NOW);
  const task = ER.buildEngagementReplyTask(entryFrom(h.candidates[0]), SCAN_CMT, NOW);
  assert.strictEqual(task.comments.length, 1);
  assert.strictEqual(task.comments[0].text, SCAN_CMT);
  assert.strictEqual(task.comments[0].text.indexOf('[SCAN RESULT]'), 0); // must keep the prefix at char 0
  assert.ok(/report link/i.test(task.description)); // grounded-link rule appears only with scan context
});

test('task without scan comment forbids links in the description rules', () => {
  const h = ER.harvestFromThread(snap(), thread(ourPost(), [replyPost()]), NOW);
  const task = ER.buildEngagementReplyTask(entryFrom(h.candidates[0]), null, NOW);
  assert.ok(/NO links/i.test(task.description));
});

// ── reconcileEngagement ──────────────────────────────────────────────────────
function tcEntry(over) {
  return Object.assign({
    id: 'er_1', replyUri: 'at://x/r1', author: 'alvaromartincrespo.bsky.social',
    authorDid: 'did:plc:alvaro', rootUri: 'at://root/1', status: 'task_created',
    taskId: 'task_e1', taskCreatedAt: new Date(NOW - 2 * HOUR).toISOString(),
    discoveredAt: new Date(NOW - 2 * HOUR).toISOString()
  }, over || {});
}

test('reconcile → answered when the reply action shipped (approved/executed)', () => {
  const store = [tcEntry()];
  const tasks = [{ id: 'task_e1', status: 'done' }];
  const actions = [{ id: 'act_r1', type: 'social_post.reply', _parentTaskId: 'task_e1', approval: { status: 'approved' }, execution: { status: 'success' } }];
  const r = ER.reconcileEngagement(store, tasks, actions, NOW);
  assert.strictEqual(store[0].status, 'answered');
  assert.strictEqual(store[0].actionId, 'act_r1');
  assert.ok(store[0].answeredAt);
  assert.strictEqual(r.answered, 1);
});

test('reconcile → skipped when the action was rejected', () => {
  const store = [tcEntry()];
  const tasks = [{ id: 'task_e1', status: 'done' }];
  const actions = [{ id: 'act_r1', type: 'social_post.reply', _parentTaskId: 'task_e1', approval: { status: 'rejected' } }];
  ER.reconcileEngagement(store, tasks, actions, NOW);
  assert.strictEqual(store[0].status, 'skipped');
  assert.strictEqual(store[0].skipReason, 'ceo_rejected');
});

test('reconcile → skipped when the task closed with no action (declined/QG-dead)', () => {
  const store = [tcEntry()];
  const tasks = [{ id: 'task_e1', status: 'done' }];
  ER.reconcileEngagement(store, tasks, [], NOW);
  assert.strictEqual(store[0].status, 'skipped');
  assert.strictEqual(store[0].skipReason, 'closed_without_action');
});

test('reconcile leaves in-flight tasks alone (todo/in-progress, pending approval)', () => {
  const store = [tcEntry()];
  const tasks = [{ id: 'task_e1', status: 'in-progress' }];
  ER.reconcileEngagement(store, tasks, [], NOW);
  assert.strictEqual(store[0].status, 'task_created');
  const store2 = [tcEntry()];
  const tasks2 = [{ id: 'task_e1', status: 'done' }];
  const pending = [{ id: 'act_r1', type: 'social_post.reply', _parentTaskId: 'task_e1', approval: { status: 'pending' } }];
  ER.reconcileEngagement(store2, tasks2, pending, NOW);
  assert.strictEqual(store2[0].status, 'task_created');
});

test('reconcile self-heals a vanished young task back to new (concurrent-writer clobber)', () => {
  const store = [tcEntry()];
  const r = ER.reconcileEngagement(store, [], [], NOW);
  assert.strictEqual(store[0].status, 'new');
  assert.strictEqual(store[0].taskId, null);
  assert.strictEqual(r.reset, 1);
});

test('reconcile marks an OLD vanished task skipped (no zombie re-drafts)', () => {
  const store = [tcEntry({ taskCreatedAt: new Date(NOW - 40 * HOUR).toISOString() })];
  ER.reconcileEngagement(store, [], [], NOW);
  assert.strictEqual(store[0].status, 'skipped');
  assert.strictEqual(store[0].skipReason, 'task_vanished');
});

// ── IO shell ─────────────────────────────────────────────────────────────────
function fakeStorage(seed) {
  const state = Object.assign({}, seed);
  const writes = [];
  return {
    state, writes,
    getState: async k => (k in state ? state[k] : null),
    setState: async (k, v) => { state[k] = v; writes.push(k); }
  };
}

const LIVE_THREAD = thread(ourPost(), [replyPost()]);

(async () => {
  await atest('shell end-to-end: harvest → filter → task created → store + tasks + gov persisted', async () => {
    const storage = fakeStorage({ tasks: [], actions: [], governanceLog: [], execution_mode: 'active' });
    const summary = await ER.runEngagementReplyLoop({
      storage, log: () => {},
      snapshots: { act_ours1: snap() },
      threadCache: {},
      fetchThread: async () => LIVE_THREAD,
      nowMs: NOW
    });
    assert.strictEqual(summary.created, 1);
    const store = storage.state.engagementReplies;
    assert.strictEqual(store.length, 1);
    assert.strictEqual(store[0].status, 'task_created');
    assert.strictEqual(storage.state.tasks.length, 1);
    assert.strictEqual(storage.state.tasks[0].assignee, 'scribe');
    const gov = storage.state.governanceLog;
    assert.ok(gov.some(e => e.type === 'engagement-reply-drafted'));
    assert.ok(gov.some(e => e.type === 'engagement-reply-run'));
    // second run with identical thread: dedup → nothing new
    const summary2 = await ER.runEngagementReplyLoop({
      storage, log: () => {},
      snapshots: { act_ours1: snap() },
      threadCache: { act_ours1: LIVE_THREAD },
      fetchThread: async () => { throw new Error('should have used cache'); },
      nowMs: NOW + HOUR
    });
    assert.strictEqual(summary2.created, 0);
    assert.strictEqual(storage.state.tasks.length, 1);
  });

  await atest('shell respects execution_mode observe/frozen/manual: harvest only, no tasks', async () => {
    for (const mode of ['observe', 'frozen', 'manual']) {
      const storage = fakeStorage({ tasks: [], actions: [], governanceLog: [], execution_mode: mode });
      const summary = await ER.runEngagementReplyLoop({
        storage, log: () => {},
        snapshots: { act_ours1: snap() },
        threadCache: { act_ours1: LIVE_THREAD },
        fetchThread: async () => LIVE_THREAD,
        nowMs: NOW
      });
      assert.strictEqual(summary.created, 0, mode + ' must not create tasks');
      assert.strictEqual(storage.state.engagementReplies.length, 1, mode + ' still harvests');
      assert.strictEqual(storage.state.tasks.length, 0);
    }
  });

  await atest('shell kill switch: systemConfig.engagementReply.enabled=false skips everything', async () => {
    const storage = fakeStorage({ systemConfig: { engagementReply: { enabled: false } }, tasks: [] });
    const summary = await ER.runEngagementReplyLoop({
      storage, log: () => {},
      snapshots: { act_ours1: snap() },
      threadCache: {}, fetchThread: async () => LIVE_THREAD, nowMs: NOW
    });
    assert.strictEqual(summary.skipped, 'disabled');
    assert.strictEqual(storage.state.engagementReplies, undefined);
  });

  await atest('shell copies the scan comment ONLY for product questions (live pair verbatim)', async () => {
    const vocalai = replyPost({
      uri: 'at://did:plc:vocalai/app.bsky.feed.post/rv', cid: 'cid-rv',
      author: { did: 'did:plc:vocalai', handle: 'vocalai.bsky.social' },
      record: { text: 'Thank you, I implemented the suggestions.', reply: { root: { uri: 'at://v/root', cid: 'cid-vroot' }, parent: { uri: ourPost().uri, cid: ourPost().cid } } }
    });
    const storage = fakeStorage({
      tasks: [{ id: 'task_parent1', comments: [{ id: 'c1', text: SCAN_CMT }] }],
      actions: [{ id: 'act_ours1', type: 'social_post.reply', _parentTaskId: 'task_parent1' }],
      governanceLog: [], execution_mode: 'active'
    });
    await ER.runEngagementReplyLoop({
      storage, log: () => {},
      snapshots: { act_ours1: snap({ samples: [{ lag: 't1', comments: 2 }] }) },
      threadCache: { act_ours1: thread(ourPost(), [replyPost(), vocalai]) },
      fetchThread: async () => { throw new Error('cache expected'); },
      nowMs: NOW
    });
    const created = storage.state.tasks.filter(t => t.source === 'engagementReply');
    assert.strictEqual(created.length, 2);
    const alvaro = created.find(t => t.title.indexOf('alvaromartincrespo') !== -1);
    const vocal = created.find(t => t.title.indexOf('vocalai') !== -1);
    assert.strictEqual(alvaro.comments.length, 1, 'question gets the scan comment');
    assert.strictEqual(alvaro.comments[0].text, SCAN_CMT);
    assert.strictEqual(vocal.comments.length, 0, 'thank-you must NOT get the scan comment (no forced link)');
  });

  await atest('shell survives a fetchThread failure (non-fatal per snapshot)', async () => {
    const storage = fakeStorage({ tasks: [], actions: [], governanceLog: [], execution_mode: 'active' });
    const summary = await ER.runEngagementReplyLoop({
      storage, log: () => {},
      snapshots: { bad: snap({ actionId: 'bad', atUri: 'at://bad' }), act_ours1: snap() },
      threadCache: {},
      fetchThread: async uri => { if (uri === 'at://bad') throw new Error('boom'); return LIVE_THREAD; },
      nowMs: NOW
    });
    assert.strictEqual(summary.fetchErrors, 1);
    assert.strictEqual(summary.created, 1);
  });

  console.log('\nengagement-reply tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})();
