// engagementReplyDraft — Run with: node api/engagementReplyDraft/override.test.js
//
// The endpoint overrides exactly ONE rule (the 72h age gate) and must keep every
// other one. Those others are what stop an agent replying to a stranger three
// times in a week, and "there is a button now" is not a reason to lose them.
//
// The rules are not reimplemented in the endpoint — it calls the cron's own
// filterCandidates() with maxAgeHours lifted. These tests drive the real handler
// against a fake store so the wiring, not a copy of the logic, is what is
// asserted.

const assert = require('assert');

const storagePath = require.resolve('../_utils/companyStorage');
let store = {};
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: {
    async getState(k) { return store[k] === undefined ? null : store[k]; },
    async setState(k, v) { store[k] = v; return true; },
    async mutateState(k, fn) {
      const next = await fn(store[k] === undefined ? null : store[k]);
      if (next === undefined) return { ok: true, written: false, value: store[k] };
      store[k] = next;
      return { ok: true, written: true, value: next };
    },
    validateSecret(s) { return s === 'test-secret'; }
  }
};

const handler = require('./index');

const NOW = Date.now();
const HOUR = 3600e3;
const DAY = 24 * HOUR;

function entry(o) {
  return Object.assign({
    id: 'er_target',
    replyUri: 'at://did:plc:them/app.bsky.feed.post/r1',
    replyCid: 'cid1',
    rootUri: 'at://did:plc:us/app.bsky.feed.post/root1',
    rootCid: 'cidroot',
    author: 'sarah.dev',
    authorDid: 'did:plc:them',
    text: 'this is a long enough comment to clear the minimum length rule easily',
    ourPostActionId: 'act_1',
    ourPostAtUri: 'at://did:plc:us/app.bsky.feed.post/root1',
    ourPostText: 'Your resume says "responsible for" eleven times.',
    // 9 DAYS OLD — 3x past the 72h gate. Every test starts from a comment the
    // cron has permanently given up on; that is the whole point of the endpoint.
    indexedAt: new Date(NOW - 9 * DAY).toISOString(),
    discoveredAt: new Date(NOW - 9 * DAY).toISOString(),
    status: 'new',
    taskId: null
  }, o);
}

function ctx() {
  return { res: null, log: Object.assign(function () {}, { warn() {}, error() {}, info() {} }) };
}

async function post(body) {
  const c = ctx();
  await handler(c, { method: 'POST', headers: { 'x-company-secret': 'test-secret' }, body: body });
  return c.res;
}

function reset(replies, extra) {
  store = Object.assign({
    engagementReplies: replies,
    tasks: [],
    actions: [],
    systemConfig: {},
    execution_mode: 'active',
    governanceLog: []
  }, extra || {});
}

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

test('a comment the cron aged out CAN be drafted on demand', async () => {
  reset([entry()]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.ok, true);
  assert.ok(res.body.taskId, 'no task id returned');

  const task = store.tasks[0];
  assert.ok(task, 'no task was appended');
  assert.strictEqual(task.assignee, 'scribe');
  assert.strictEqual(task.taskType, 'bluesky_reply');
  assert.ok(task.tags.indexOf('manual-draft') !== -1, 'not tagged as a manual draft');
  assert.ok(task.description.indexOf('sarah.dev') !== -1, 'the task lost the conversation');

  const e = store.engagementReplies[0];
  assert.strictEqual(e.status, 'task_created');
  assert.strictEqual(e.taskId, task.id);
  assert.strictEqual(e.manualDraft, true, 'the age-gate override is not auditable');
});

test('a SECOND exchange in a thread is allowed — the button buys one turn', async () => {
  // The automation replies once and stops, which leaves a real back-and-forth
  // dead after one turn. @fberrez.co answered our reply with more substance and
  // nothing could pick it up. One click, one more turn.
  reset([
    entry({ id: 'er_prior', status: 'answered', answeredAt: new Date(NOW - 8 * DAY).toISOString() }),
    entry()
  ]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(store.tasks.length, 1);
});

test('a THIRD reply in the same thread still blocks', async () => {
  // Two exchanges is a conversation. Three is us talking at someone.
  reset([
    entry({ id: 'er_p1', status: 'answered', answeredAt: new Date(NOW - 9 * DAY).toISOString() }),
    entry({ id: 'er_p2', status: 'answered', answeredAt: new Date(NOW - 8 * DAY).toISOString() }),
    entry()
  ]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.reason, 'author_thread_done');
  assert.ok(/twice/i.test(res.body.message), 'the refusal does not say why two was the limit');
  assert.strictEqual(store.tasks.length, 0);
  assert.strictEqual(store.engagementReplies[2].status, 'new', 'entry moved despite the block');
});

test('the second exchange is counted per THREAD, not per person', async () => {
  // A prior reply in a DIFFERENT thread must not spend this thread's allowance.
  // (The per-author cooldown is what governs across threads, tested below.)
  reset([
    entry({
      id: 'er_other', status: 'answered',
      rootUri: 'at://did:plc:us/app.bsky.feed.post/other',
      answeredAt: new Date(NOW - 30 * DAY).toISOString()
    }),
    entry()
  ]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
});

test('the 14-day per-author cooldown still blocks', async () => {
  // Same person, DIFFERENT thread, answered 3 days ago.
  reset([
    entry({
      id: 'er_prior', status: 'answered',
      rootUri: 'at://did:plc:us/app.bsky.feed.post/other',
      answeredAt: new Date(NOW - 3 * DAY).toISOString()
    }),
    entry()
  ]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.reason, 'author_cooldown');
  assert.ok(/pester/i.test(res.body.message), 'the refusal does not explain itself');
  assert.strictEqual(store.tasks.length, 0);
});

test('the cooldown lapses — the same person is reachable again after 14 days', async () => {
  reset([
    entry({
      id: 'er_prior', status: 'answered',
      rootUri: 'at://did:plc:us/app.bsky.feed.post/other',
      answeredAt: new Date(NOW - 20 * DAY).toISOString()
    }),
    entry()
  ]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(store.tasks.length, 1);
});

test('a comment with nothing in it still blocks', async () => {
  reset([entry({ text: 'nice 👍' })]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.reason, 'too_short');
});

test('the daily draft budget still applies', async () => {
  const today = new Date(NOW).toISOString();
  const spent = [0, 1, 2].map((i) => entry({
    id: 'er_spent' + i, status: 'task_created', taskCreatedAt: today,
    author: 'other' + i, authorDid: 'did:plc:o' + i,
    rootUri: 'at://did:plc:us/app.bsky.feed.post/t' + i
  }));
  reset(spent.concat([entry()]));
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.reason, 'daily_budget');
});

test('a conversation whose draft task was CANCELLED can be re-drafted', async () => {
  // The live failure, 2026-08-08: a bulk cancel closed three engagement-reply
  // tasks in the same second. reconcile only recognised 'done', so the entries
  // stayed at task_created forever, the panel reported "waiting on your
  // approval" for a queue that did not contain them, and the dead entry counted
  // as a reply we never sent.
  reset([entry({ status: 'task_created', taskId: 'task_dead', taskCreatedAt: new Date(NOW - 5 * DAY).toISOString() })], {
    tasks: [{ id: 'task_dead', status: 'canceled', assignee: 'scribe' }]
  });
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.already, undefined, 'reported as already drafted when the task was dead');
  assert.strictEqual(store.tasks.length, 2, 'no fresh task was appended');
  assert.strictEqual(store.engagementReplies[0].taskId, res.body.taskId, 'entry still points at the dead task');
});

test('a LIVE draft task is not re-drafted', async () => {
  reset([entry({ status: 'task_created', taskId: 'task_live' })], {
    tasks: [{ id: 'task_live', status: 'in-progress', assignee: 'scribe' }]
  });
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.body.already, true);
  assert.strictEqual(res.body.taskId, 'task_live');
  assert.strictEqual(store.tasks.length, 1, 'duplicated a draft that was already being written');
});

test('a draft already awaiting approval is not re-drafted', async () => {
  reset([entry({ status: 'task_created', taskId: 'task_done' })], {
    tasks: [{ id: 'task_done', status: 'done', assignee: 'scribe' }],
    actions: [{ id: 'act_r', type: 'social_post.reply', _parentTaskId: 'task_done', approval: { status: 'pending' } }]
  });
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.body.already, true, 'would have duplicated a reply sitting in the approval queue');
  assert.strictEqual(store.tasks.length, 1);
});

test('an answered conversation is never re-opened', async () => {
  reset([entry({ status: 'answered' })]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.body.ok, false);
  assert.strictEqual(store.tasks.length, 0);
});

test('a dead draft does not spend the allowance it is asking for', async () => {
  // The re-drafted entry must not count itself as a prior reply. With the
  // 2-exchange limit that would leave only one turn left in a conversation where
  // we have said nothing at all.
  reset([
    entry({ id: 'er_real', status: 'answered', answeredAt: new Date(NOW - 20 * DAY).toISOString() }),
    entry({ status: 'task_created', taskId: 'task_dead' })
  ], { tasks: [{ id: 'task_dead', status: 'canceled' }] });
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body) + ' — the dead entry counted as a reply');
});

test('a second click does not produce a second task', async () => {
  reset([entry()]);
  const first = await post({ id: 'er_target' });
  assert.strictEqual(first.body.ok, true);
  const second = await post({ id: 'er_target' });
  assert.strictEqual(second.body.already, true);
  assert.strictEqual(second.body.taskId, first.body.taskId);
  assert.strictEqual(store.tasks.length, 1, 'the impatient second click made a duplicate reply task');
});

test('the frozen kill switch stops the button too', async () => {
  reset([entry()], { execution_mode: 'frozen' });
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.ok(/frozen/i.test(res.body.error));
  assert.strictEqual(store.tasks.length, 0);
});

test('disabling the loop in systemConfig disables the button', async () => {
  reset([entry()], { systemConfig: { engagementReply: { enabled: false } } });
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(store.tasks.length, 0);
});

test('a config that widens the age gate does not widen anything else', async () => {
  // maxAgeHours is the caller's to change; the cooldown is not.
  reset([
    entry({
      id: 'er_prior', status: 'answered',
      rootUri: 'at://did:plc:us/app.bsky.feed.post/other',
      answeredAt: new Date(NOW - 1 * DAY).toISOString()
    }),
    entry()
  ], { systemConfig: { engagementReply: { maxAgeHours: 9999 } } });
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.reason, 'author_cooldown');
});

test('the AUTOMATION is still one reply per thread — only the button reaches two', async () => {
  // The whole point of routing this through a button: autonomous behaviour is
  // unchanged. Asserted against the cron's own config, not the override.
  const ER = require('../companyHeartbeat/engagement-reply');
  const cfg = ER.loadConfig({});
  assert.strictEqual(cfg.maxRepliesPerThread, 1, 'the drafter would now follow up on its own');

  const prior = entry({ id: 'er_prior', status: 'answered', answeredAt: new Date(NOW - 8 * DAY).toISOString() });
  const target = entry({ indexedAt: new Date(NOW - 1 * 3600e3).toISOString() }); // fresh, so age is not the blocker
  const v = ER.filterCandidates([prior, target], cfg, NOW);
  assert.strictEqual(v.survivors.length, 0, 'the cron picked up a second exchange by itself');
  assert.strictEqual(v.drops.author_thread_done, 1);
});

test('unauthenticated callers get nothing', async () => {
  reset([entry()]);
  const c = ctx();
  await handler(c, { method: 'POST', headers: {}, body: { id: 'er_target' } });
  assert.strictEqual(c.res.status, 403);
  assert.strictEqual(store.tasks.length, 0);
});

test('an unknown id is a 404, not a silent no-op', async () => {
  reset([entry()]);
  const res = await post({ id: 'er_nope' });
  assert.strictEqual(res.status, 404);
});

test('the draft is recorded in the governance log', async () => {
  reset([entry()]);
  await post({ id: 'er_target' });
  const gov = store.governanceLog;
  assert.strictEqual(gov.length, 1);
  assert.strictEqual(gov[0].type, 'engagement-reply-drafted');
  assert.strictEqual(gov[0].data.manual, true);
  assert.ok(gov[0].data.ageHours >= 200, 'the overridden age is not in the audit trail');
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\nengagementReplyDraft: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
