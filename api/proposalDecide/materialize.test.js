// Run with: node api/proposalDecide/materialize.test.js
const assert = require('assert');
const { materializeFromProposal, isLiveDuplicate } = require('./materialize');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const NOW = '2026-06-23T12:00:00.000Z';

// ── materializeFromProposal ──
test('campaign_proposal → campaigns entity', () => {
  const m = materializeFromProposal({ id: 'mprop_1', type: 'campaign_proposal', name: 'Beacon Launch', description: 'd', proposedBy: 'echo' }, NOW);
  assert.strictEqual(m.stateKey, 'campaigns');
  assert.ok(/^camp-/.test(m.entity.id));
  assert.strictEqual(m.entity.title, 'Beacon Launch');
  assert.strictEqual(m.entity.status, 'active');
  assert.strictEqual(m.entity.source, 'meeting');
  assert.strictEqual(m.entity.proposalId, 'mprop_1');
});
test('objective_proposal → objectives entity', () => {
  const m = materializeFromProposal({ id: 'mprop_2', type: 'objective_proposal', title: 'Grow Bluesky', description: 'd' }, NOW);
  assert.strictEqual(m.stateKey, 'objectives');
  assert.ok(/^obj-/.test(m.entity.id));
  assert.strictEqual(m.entity.status, 'active');
  assert.strictEqual(m.entity.progress, 0);
  assert.strictEqual(m.entity.proposalId, 'mprop_2');
});
test('task_proposal → tasks entity', () => {
  const m = materializeFromProposal({ id: 'mprop_3', type: 'task_proposal', title: 'Audit blockers', proposedBy: 'cipher', meetingId: 'amtg-9' }, NOW);
  assert.strictEqual(m.stateKey, 'tasks');
  assert.ok(/^task-/.test(m.entity.id));
  assert.strictEqual(m.entity.status, 'todo');
  assert.strictEqual(m.entity.assignee, 'cipher');
  assert.strictEqual(m.entity.meetingId, 'amtg-9');
  assert.strictEqual(m.entity.source, 'meeting');
});
test('task_proposal assignee falls back to nova', () => {
  const m = materializeFromProposal({ id: 'x', type: 'task_proposal', title: 't' }, NOW);
  assert.strictEqual(m.entity.assignee, 'nova');
});
test('unknown type → null (status-flip only)', () => {
  assert.strictEqual(materializeFromProposal({ id: 'x', type: 'social_proposal', title: 't' }, NOW), null);
  assert.strictEqual(materializeFromProposal({ id: 'x', type: 'product_proposal', title: 't' }, NOW), null);
});

// ── isLiveDuplicate ──
test('campaign dup by normalized title against a live campaign', () => {
  const existing = [{ title: 'Beacon Launch', status: 'active' }];
  assert.strictEqual(isLiveDuplicate('campaigns', 'beacon   launch', existing), true);
});
test('campaign not a dup against an archived campaign', () => {
  const existing = [{ title: 'Beacon Launch', status: 'archived' }];
  assert.strictEqual(isLiveDuplicate('campaigns', 'Beacon Launch', existing), false);
});
test('objective dup honors objective live statuses', () => {
  assert.strictEqual(isLiveDuplicate('objectives', 'Grow X', [{ title: 'Grow X', status: 'at_risk' }]), true);
  assert.strictEqual(isLiveDuplicate('objectives', 'Grow X', [{ title: 'Grow X', status: 'complete' }]), false);
});
test('tasks never dedup', () => {
  assert.strictEqual(isLiveDuplicate('tasks', 'Audit blockers', [{ title: 'Audit blockers', status: 'todo' }]), false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
