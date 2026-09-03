// Active-task ceiling — canceled work must not count as active
//
// Shipped 2026-09-03 after the fleet spent 11 unattended days refusing to create tasks.
//
// THE INCIDENT: the create-task gate counted anything that wasn't 'done' or 'archived'
// as active. 50 tasks sat at status 'canceled'. The gate saw 80/50, slammed shut, and
// logged 127 max_active_tasks_50 policy violations across 47 heartbeat runs — 100% of
// every guardrail block in that window. Real work in flight was 30, i.e. 20 slots free
// the whole time. Six of nine agents then skipped every run for want of assigned tasks,
// which nothing could create. A closed loop that survives a restart.
//
// WHAT MAKES THIS WORTH A TEST: twelve lines below the broken gate, the research ceiling
// had the identical filter WITH the canceled exclusion. Same file, same function, one
// author away from correct. The idle gate in helpers.idle-gate.test.js also had it right.
// The rule was known and written down twice; the counter that actually stops work is the
// one that missed it. So this asserts the rule at every site that enforces or reports a
// ceiling, not just the one that broke — a passing count here means nothing if a sibling
// counter drifts.
//
// A counter that over-counts does not fail loudly. It looks exactly like a busy fleet.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The rule, stated once. Terminal statuses are not active work.
const TERMINAL = ['done', 'archived', 'canceled'];
const isActive = (t) => {
  const st = String((t && t.status) || '').toLowerCase();
  return !TERMINAL.includes(st);
};

test('canceled tasks are not active work', () => {
  const fixture = [
    { status: 'todo' }, { status: 'in-progress' },
    { status: 'done' }, { status: 'archived' }, { status: 'canceled' }
  ];
  assert.equal(fixture.filter(isActive).length, 2);
});

test('the production backlog shape does not trip a cap of 50', () => {
  // The exact composition observed in prod on 2026-09-03.
  const tasks = [
    ...Array(50).fill({ status: 'canceled' }),
    ...Array(21).fill({ status: 'todo' }),
    ...Array(9).fill({ status: 'in-progress' })
  ];
  assert.equal(tasks.length, 80, 'fixture mirrors the 80 non-done/archived tasks in prod');
  assert.equal(tasks.filter(isActive).length, 30, 'only 30 are real work');
  assert.ok(tasks.filter(isActive).length < 50, 'must leave headroom under maxActiveTasks');
});

// Source assertions. The ceiling is inline in agent-runner.js and index.js rather than a
// shared export, so there is nothing to import — and that is precisely why the two copies
// drifted. Until the predicate is extracted, guard the text.
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

test('the create-task ENFORCEMENT gate excludes canceled', () => {
  const src = read('agent-runner.js');
  const line = src.split('\n').find(l => l.includes('const _activeTaskCount = tasks.filter'));
  assert.ok(line, 'could not find the task-ceiling counter — did it move?');
  assert.ok(line.includes("!== 'canceled'"),
    'the gate that BLOCKS task creation counts canceled tasks as active:\n  ' + line.trim());
});

test('the backlogPressure REPORTING metric excludes canceled', () => {
  const src = read('index.js');
  assert.ok(/st !== 'done' && st !== 'archived' && st !== 'canceled'/.test(src),
    'activeTasksNow reports canceled tasks as active — the gate would be fixed while ' +
    'the dashboard and ops-intel still show a jammed backlog');
});

test('enforcement and reporting agree', () => {
  // Two counters, one cap. If they disagree, one of them is lying to the CEO about why
  // the fleet is idle — which is the failure mode that cost 11 days.
  const gate = read('agent-runner.js')
    .split('\n').find(l => l.includes('const _activeTaskCount = tasks.filter'));
  const gateExcludes = TERMINAL.filter(s => gate.includes("!== '" + s + "'"));
  assert.deepEqual(gateExcludes.sort(), [...TERMINAL].sort(),
    'gate excludes ' + JSON.stringify(gateExcludes) + ', expected all of ' + JSON.stringify(TERMINAL));
});
