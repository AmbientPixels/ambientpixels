// Run with: node api/proposalDecide/materialize.test.js
const assert = require('assert');
const { materializeFromProposal, isLiveDuplicate, deriveTaskTypes, deriveObjectiveId } = require('./materialize');

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

// ── deriveTaskTypes (campaigns must never be born with empty/invalid task types) ──
test('deriveTaskTypes: empty platforms → social_bluesky default, flagged derived', () => {
  const r = deriveTaskTypes({ name: 'Daily Pulse Graduation', platforms: [] });
  assert.deepStrictEqual(r.taskTypes, ['social_bluesky']);
  assert.strictEqual(r.derived, true);
});
test('deriveTaskTypes: design intent → design_asset', () => {
  const r = deriveTaskTypes({ name: 'Design Coverage', description: 'visual hero assets per product' });
  assert.deepStrictEqual(r.taskTypes, ['design_asset']);
  assert.strictEqual(r.derived, true);
});
test('deriveTaskTypes: brand/positioning messaging is NOT design → social default', () => {
  const r = deriveTaskTypes({ name: 'Run Loud Public Positioning', description: 'Coordinate press, social, and brand messaging.' });
  assert.deepStrictEqual(r.taskTypes, ['social_bluesky']);
});
test('deriveTaskTypes: blog intent → blog_post', () => {
  const r = deriveTaskTypes({ name: 'Heartbeat Diaries', description: 'weekly build-in-public blog' });
  assert.deepStrictEqual(r.taskTypes, ['blog_post']);
});
test('deriveTaskTypes: explicit valid platforms used as-is, not flagged', () => {
  const r = deriveTaskTypes({ name: 'x', platforms: ['social_x', 'social_bluesky'] });
  assert.deepStrictEqual(r.taskTypes, ['social_x', 'social_bluesky']);
  assert.strictEqual(r.derived, false);
});
test('deriveTaskTypes: invalid task types filtered out', () => {
  const r = deriveTaskTypes({ name: 'x', platforms: ['bogus', 'social_x'] });
  assert.deepStrictEqual(r.taskTypes, ['social_x']);
  assert.strictEqual(r.derived, false);
});

// ── deriveObjectiveId (campaigns should not be born orphaned when a parent exists) ──
const OBJS = [
  { id: 'obj-build-public-2026h2', title: 'Run Loud: The AI Company in Public', status: 'active', northStarMetric: 'bluesky_followers' },
  { id: 'obj-reactivate-as-bs', title: 'Re-activate AmbientScore + Blindspot', status: 'active' },
  { id: 'obj-pulse-daily', title: 'Daily Pulse Dispatch', status: 'active' },
  { id: 'obj-done', title: 'Old Thing', status: 'complete' }
];
test('deriveObjectiveId: matches active objective by title-token overlap', () => {
  const r = deriveObjectiveId({ name: 'Run Loud Public Positioning Campaign' }, OBJS);
  assert.strictEqual(r.objectiveId, 'obj-build-public-2026h2');
  assert.strictEqual(r.matched, true);
});
test('deriveObjectiveId: matches by northStarMetric', () => {
  const r = deriveObjectiveId({ name: 'Unrelated name zzz', northStarMetric: 'bluesky_followers' }, OBJS);
  assert.strictEqual(r.objectiveId, 'obj-build-public-2026h2');
});
test('deriveObjectiveId: honors an explicit ref that points at an active objective', () => {
  const r = deriveObjectiveId({ name: 'x', objective_id: 'obj-pulse-daily' }, OBJS);
  assert.strictEqual(r.objectiveId, 'obj-pulse-daily');
  assert.strictEqual(r.matched, false);
});
test('deriveObjectiveId: no plausible parent → null', () => {
  const r = deriveObjectiveId({ name: 'Zzzzz Qqqqq Wwwww' }, OBJS);
  assert.strictEqual(r.objectiveId, null);
});
test('deriveObjectiveId: never matches a non-active objective', () => {
  const r = deriveObjectiveId({ name: 'Old Thing' }, OBJS);
  assert.strictEqual(r.objectiveId, null);
});

// ── materializeFromProposal integration: never emit an unworkable campaign ──
test('campaign_proposal with empty platforms gets derived types + matched objective + needsReview', () => {
  const m = materializeFromProposal(
    { id: 'mp1', type: 'campaign_proposal', name: 'Run Loud Public Positioning Campaign', description: 'press and social' },
    NOW, { objectives: OBJS });
  assert.ok(m.entity.allowedTaskTypes.length > 0, 'task types non-empty');
  assert.strictEqual(m.entity.objective_id, 'obj-build-public-2026h2');
  assert.strictEqual(m.entity.needsReview, true);
});
test('campaign_proposal with explicit platforms + objective is not flagged', () => {
  const m = materializeFromProposal(
    { id: 'mp2', type: 'campaign_proposal', name: 'Beacon Launch', platforms: ['social_x'], objective_id: 'obj-pulse-daily' },
    NOW, { objectives: OBJS });
  assert.deepStrictEqual(m.entity.allowedTaskTypes, ['social_x']);
  assert.strictEqual(m.entity.objective_id, 'obj-pulse-daily');
  assert.strictEqual(m.entity.needsReview, false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
