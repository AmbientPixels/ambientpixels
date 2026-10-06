// Run: node companyHeartbeat/scout-mechanism-task.test.js
'use strict';
const assert = require('assert');
const { mintScoutMechanismTask, TAG, CADENCE_DAYS } = require('./scout-mechanism-task');

const NOW = Date.parse('2026-10-07T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();
const ledger = { neverTried: ['search_page', 'directory_listing', 'tool_or_utility'], rows: [{ betKey: 'broadcast_post|ambientscore|social-bluesky|any', result: 'lost', actual: { value: 0, posts: 12 }, expected: 3 }] };

// 1. Mints one well-formed Scout task from the never-tried list, citing the ledger.
{
  const r = mintScoutMechanismTask({ tasks: [], ledger, objectiveId: 'obj-build-public', nowMs: NOW });
  assert.strictEqual(r.reason, 'minted');
  const t = r.task;
  assert.strictEqual(t.assignee, 'scout');
  assert.strictEqual(t.status, 'todo');
  assert.ok(ledger.neverTried.indexOf(r.mechanism) !== -1);
  assert.ok(t.tags.indexOf(TAG) !== -1 && t.tags.indexOf('mechanism:' + r.mechanism) !== -1);
  assert.ok(/LOST broadcast_post\|ambientscore/.test(t.description), 'ledger row cited');
  assert.ok(/propose-campaign/.test(t.description) && /denominator/.test(t.description));
  assert.ok(/all eight products/.test(t.description));
  assert.strictEqual(t.objective_id, 'obj-build-public');
  assert.strictEqual(t.campaign_id, null);
  assert.ok(Date.parse(t.dueDate) > NOW);
}

// 2. Never more than one open task; cadence of 7 days after the last one; dormant/disabled respected.
{
  const open = { id: 'x', tags: [TAG], status: 'todo', createdAt: daysAgo(20) };
  assert.strictEqual(mintScoutMechanismTask({ tasks: [open], ledger, nowMs: NOW }).reason, 'open_task_exists');
  const done = { id: 'y', tags: [TAG], status: 'done', createdAt: daysAgo(3) };
  assert.strictEqual(mintScoutMechanismTask({ tasks: [done], ledger, nowMs: NOW }).reason, 'minted_within_cadence');
  const old = { id: 'z', tags: [TAG], status: 'done', createdAt: daysAgo(CADENCE_DAYS + 1) };
  assert.strictEqual(mintScoutMechanismTask({ tasks: [old], ledger, nowMs: NOW }).reason, 'minted');
  assert.strictEqual(mintScoutMechanismTask({ tasks: [], ledger, nowMs: NOW, scoutActive: false }).reason, 'scout_not_active');
  assert.strictEqual(mintScoutMechanismTask({ tasks: [], ledger, nowMs: NOW, enabled: false }).reason, 'disabled');
}

// 3. Rotates through the list week by week; falls back to the full enum when everything was tried.
{
  const a = mintScoutMechanismTask({ tasks: [], ledger, nowMs: NOW }).mechanism;
  const b = mintScoutMechanismTask({ tasks: [], ledger, nowMs: NOW + 7 * 86400000 }).mechanism;
  assert.notStrictEqual(a, b, 'next week picks the next mechanism');
  const r = mintScoutMechanismTask({ tasks: [], ledger: { neverTried: [], rows: [] }, nowMs: NOW });
  assert.strictEqual(r.reason, 'minted');
  assert.ok(/none scored yet/.test(r.task.description));
}

console.log('scout-mechanism-task.test.js: all assertions passed');
