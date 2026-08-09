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

test('one reply per person per thread still blocks', async () => {
  // We already answered this person in this conversation. A button must not turn
  // that into a second reply.
  reset([
    entry({ id: 'er_prior', status: 'answered', answeredAt: new Date(NOW - 8 * DAY).toISOString() }),
    entry()
  ]);
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.reason, 'author_thread_done');
  assert.strictEqual(store.tasks.length, 0, 'a task was created anyway');
  assert.strictEqual(store.engagementReplies[1].status, 'new', 'entry moved despite the block');
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
  // maxAgeHours is the caller's to change; the relationship guards are not.
  reset([
    entry({ id: 'er_prior', status: 'answered', answeredAt: new Date(NOW - 1 * DAY).toISOString() }),
    entry()
  ], { systemConfig: { engagementReply: { maxAgeHours: 9999 } } });
  const res = await post({ id: 'er_target' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.reason, 'author_thread_done');
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
