// Idle-agent gating — shouldRunAgent()
// Shipped 2026-08-07 to stop agents with empty queues paying for a full-price heartbeat
// call just to conclude they have nothing to do.
//
// The tests that matter here are the DEADLOCK ones. This gate decides whether an agent
// thinks at all, so a wrong 'false' is silent — the agent simply never speaks again, which
// is exactly how Scribe went dark for 46h on 2026-07-29 via a different mechanism.

const { test } = require('node:test');
const assert = require('node:assert');

const H = require('./helpers.js');
const C = require('./constants.js');

const NOW = new Date('2026-08-07T18:00:00Z');
const iso = ms => new Date(NOW.getTime() + ms).toISOString();

function task(over) {
  return Object.assign({
    id: 't1', title: 'x', assignee: 'scribe', status: 'todo', comments: []
  }, over);
}

test('shouldRunAgent: agent with an active task runs', () => {
  const r = H.shouldRunAgent([task({ assignee: 'scribe', status: 'todo' })], 'scribe');
  assert.strictEqual(r.run, true);
  assert.strictEqual(r.reason, 'assigned_active_task');
});

test('shouldRunAgent: agent with an empty queue is skipped', () => {
  const r = H.shouldRunAgent([task({ assignee: 'echo' })], 'scribe');
  assert.strictEqual(r.run, false);
  assert.strictEqual(r.reason, 'no_assigned_tasks_or_mentions');
});

test('shouldRunAgent: done/canceled/archived work does not count as active', () => {
  ['done', 'canceled', 'archived'].forEach(status => {
    const r = H.shouldRunAgent([task({ assignee: 'scribe', status })], 'scribe');
    assert.strictEqual(r.run, false, status + ' should not wake an agent');
  });
});

test('shouldRunAgent: in-progress and review count as active', () => {
  ['in-progress', 'review'].forEach(status => {
    const r = H.shouldRunAgent([task({ assignee: 'scribe', status })], 'scribe');
    assert.strictEqual(r.run, true, status + ' should wake an agent');
  });
});

// ── Deadlock guards ──

test('DEADLOCK: Nova always runs, even with a completely empty board', () => {
  const r = H.shouldRunAgent([], 'nova');
  assert.strictEqual(r.run, true);
  assert.strictEqual(r.reason, 'always_run_agent');
});

test('DEADLOCK: Nova runs when the board holds ONLY backlog tasks', () => {
  // _isActiveStatus excludes 'backlog' by design, but Nova is the only agent who can see
  // backlog tasks and the only one who can triage them out of it. Gating her on "active
  // work" would strand the whole backlog permanently.
  const r = H.shouldRunAgent([task({ assignee: 'nova', status: 'backlog' })], 'nova');
  assert.strictEqual(r.run, true);
});

test('DEADLOCK: an unassigned task still wakes Nova so it can be triaged', () => {
  const r = H.shouldRunAgent([task({ assignee: null, status: 'todo' })], 'nova');
  assert.strictEqual(r.run, true);
});

test('DEADLOCK: a skipped agent wakes the moment work is assigned to it', () => {
  const board = [task({ assignee: 'echo' })];
  assert.strictEqual(H.shouldRunAgent(board, 'pixel').run, false);
  board.push(task({ id: 't2', assignee: 'pixel', status: 'todo' }));
  assert.strictEqual(H.shouldRunAgent(board, 'pixel').run, true, 'must self-heal next cycle');
});

test('an @mention inside the window wakes an idle agent', () => {
  const name = (C.AGENT_ROLES.pixel && C.AGENT_ROLES.pixel.name) || 'pixel';
  const board = [task({
    assignee: 'scribe',
    comments: [{ text: 'need a hero image @' + name + ' please', createdAt: iso(-60 * 60 * 1000) }]
  })];
  const r = H.shouldRunAgent(board, 'pixel');
  assert.strictEqual(r.run, true);
  assert.strictEqual(r.reason, 'recent_mention_ping');
});

test('a stale @mention does NOT wake an idle agent forever', () => {
  const name = (C.AGENT_ROLES.pixel && C.AGENT_ROLES.pixel.name) || 'pixel';
  const old = new Date(NOW.getTime() - (C.SUB_AGENT_MENTION_WINDOW_HOURS + 24) * 3600 * 1000).toISOString();
  const board = [task({ assignee: 'scribe', comments: [{ text: '@' + name + ' ping', createdAt: old }] })];
  assert.strictEqual(H.shouldRunAgent(board, 'pixel').run, false);
});

test('malformed board does not throw — a crash here would take down the cycle', () => {
  assert.doesNotThrow(() => H.shouldRunAgent([], 'scribe'));
  assert.doesNotThrow(() => H.shouldRunAgent([{}], 'scribe'));
  assert.doesNotThrow(() => H.shouldRunAgent([{ assignee: null, comments: null }], 'scribe'));
});

test('every ALWAYS_RUN agent is a real agent in the registry', () => {
  C.ALWAYS_RUN_AGENTS.forEach(id => {
    assert.ok(C.AGENT_ROLES[id], 'ALWAYS_RUN_AGENTS contains unknown agent: ' + id);
  });
});

test('shouldRunTier4Agent still behaves as before (no regression)', () => {
  assert.strictEqual(H.shouldRunTier4Agent([], 'scribe').reason, 'not_tier4_subagent');
  assert.strictEqual(H.shouldRunTier4Agent([], 'quill').run, false);
  assert.strictEqual(H.shouldRunTier4Agent([task({ assignee: 'quill' })], 'quill').run, true);
});
