// Run with: node api/companyHeartbeat/_utils/laneBackpressure.test.js
//
// The 2026-08-22 Scribe backlog. Three automated lanes minted reply tasks straight
// onto the tasks array, bypassing the active-task ceiling in agent-runner.js (which
// only guards agent-emitted `create-task`). Measured that day:
//
//   reported activeTasks / cap   84 / 50   — 68% over its own ceiling
//   Scribe open tasks            55        (36 bluesky_reply, 18 social_copy)
//   ...created that day alone    21
//   Scribe realistic drain      ~8/day
//   oldest open task             11 days
//
// Intake 21/day against a drain of 8/day never converges. These tests pin the two
// halves of the fix: refuse to mint past a queue depth, and close reply tasks the
// scheduler would refuse to post anyway.
const assert = require('assert');
const BP = require('./laneBackpressure');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

const NOW = Date.parse('2026-08-22T04:00:00Z');
const task = (o) => Object.assign({
  assignee: 'scribe', taskType: 'bluesky_reply', status: 'todo',
  createdAt: new Date(NOW - 3600e3).toISOString()
}, o);
const many = (n, o) => Array.from({ length: n }, (_, i) => task(Object.assign({ id: 't' + i }, o)));

// ── laneCapacity ────────────────────────────────────────────────────────────
test('an empty queue offers the full depth', () => {
  const c = BP.laneCapacity([], 'scribe', 'bluesky_reply');
  assert.strictEqual(c.open, 0);
  assert.strictEqual(c.remaining, BP.DEFAULT_QUEUE_DEPTH);
});

test('the real backlog offers zero', () => {
  // 36 open bluesky_reply tasks is what actually accumulated.
  const c = BP.laneCapacity(many(36), 'scribe', 'bluesky_reply');
  assert.strictEqual(c.open, 36);
  assert.strictEqual(c.remaining, 0, 'must mint nothing while this deep');
});

test('remaining shrinks as the queue fills', () => {
  assert.strictEqual(BP.laneCapacity(many(5), 'scribe', 'bluesky_reply').remaining, 3);
  assert.strictEqual(BP.laneCapacity(many(8), 'scribe', 'bluesky_reply').remaining, 0);
});

test('finished work frees capacity — the self-correcting half', () => {
  // A rate cap keeps minting while the agent is stuck. A depth cap reopens only as
  // she actually finishes things, which is the whole reason it is a depth.
  const t = many(8);
  t.slice(0, 5).forEach(x => { x.status = 'done'; });
  assert.strictEqual(BP.laneCapacity(t, 'scribe', 'bluesky_reply').remaining, 5);
});

test('canceled and archived tasks do not hold capacity', () => {
  const t = many(8);
  t[0].status = 'canceled'; t[1].status = 'cancelled'; t[2].status = 'archived';
  assert.strictEqual(BP.laneCapacity(t, 'scribe', 'bluesky_reply').open, 5);
});

test('other assignees and other task types are not counted', () => {
  const t = many(4)
    .concat(many(10, { assignee: 'echo' }))
    .concat(many(10, { taskType: 'social_copy' }));
  const c = BP.laneCapacity(t, 'scribe', 'bluesky_reply');
  assert.strictEqual(c.open, 4, 'only scribe + bluesky_reply counts');
});

test('all three lanes share one queue, so they share one limit', () => {
  // roast, AS-prospect and participation all mint bluesky_reply onto scribe. Gating
  // one lane alone just moves the overflow to the other two.
  const t = many(6);
  const roast = BP.laneCapacity(t, 'scribe', 'bluesky_reply');
  const participation = BP.laneCapacity(t, 'scribe', 'bluesky_reply');
  assert.strictEqual(roast.remaining, 2);
  assert.strictEqual(participation.remaining, 2, 'same shared budget, not 2 each');
});

test('depth is overridable per call', () => {
  assert.strictEqual(BP.laneCapacity(many(10), 'scribe', 'bluesky_reply', 20).remaining, 10);
});

// ── expireStaleReplyTasks ───────────────────────────────────────────────────
const aged = (days, o) => task(Object.assign({
  id: 'aged' + days, createdAt: new Date(NOW - days * 86400e3).toISOString()
}, o));

test('reply tasks past the window are closed', () => {
  const t = [aged(11), aged(5), aged(1)];
  const out = BP.expireStaleReplyTasks(t, NOW);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(t[0].status, 'canceled');
  assert.strictEqual(t[2].status, 'todo', 'a 1-day-old task is still live');
});

test('the closing comment explains why, not just that', () => {
  const t = [aged(11)];
  BP.expireStaleReplyTasks(t, NOW);
  const c = t[0].comments[0].text;
  assert.ok(/11 days/.test(c));
  assert.ok(/actionsScheduler refuses/.test(c), 'must name the reason it could not have shipped');
});

test('non-reply task types are never touched', () => {
  const t = [aged(30, { taskType: 'social_copy' }), aged(30, { taskType: 'research' })];
  assert.strictEqual(BP.expireStaleReplyTasks(t, NOW).length, 0);
  assert.strictEqual(t[0].status, 'todo');
});

test('already-finished tasks are left alone', () => {
  const t = [aged(11, { status: 'done' }), aged(11, { status: 'canceled' })];
  assert.strictEqual(BP.expireStaleReplyTasks(t, NOW).length, 0);
});

test('a task with no usable timestamp is skipped, not expired as epoch', () => {
  const t = [task({ id: 'x', createdAt: undefined })];
  assert.strictEqual(BP.expireStaleReplyTasks(t, NOW).length, 0);
  assert.strictEqual(t[0].status, 'todo');
});

test('the window is overridable', () => {
  assert.strictEqual(BP.expireStaleReplyTasks([aged(5)], NOW, 7).length, 0);
  assert.strictEqual(BP.expireStaleReplyTasks([aged(5)], NOW, 1).length, 1);
});

test('sweep then capacity: draining stale work reopens the lane', () => {
  // The two halves compose. 36 open, all stale → sweep closes them → lane reopens.
  const t = Array.from({ length: 36 }, (_, i) => aged(4 + (i % 5), { id: 's' + i }));
  assert.strictEqual(BP.laneCapacity(t, 'scribe', 'bluesky_reply').remaining, 0);
  BP.expireStaleReplyTasks(t, NOW);
  assert.strictEqual(BP.laneCapacity(t, 'scribe', 'bluesky_reply').remaining, BP.DEFAULT_QUEUE_DEPTH);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
