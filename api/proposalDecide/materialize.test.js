// Run with: node api/proposalDecide/materialize.test.js
const assert = require('assert');
const { materializeFromProposal, isLiveDuplicate, findLiveDuplicate, adoptOrphanCampaigns, deriveTaskTypes, deriveObjectiveId } = require('./materialize');

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
  assert.strictEqual(m.entity.source, 'proposal');
  assert.strictEqual(m.entity.proposalId, 'mprop_1');
});
test('campaign_proposal duration \"90 days\" converts to ~13 weeks, not 90 weeks', () => {
  const m = materializeFromProposal({ id: 'mp_d', type: 'campaign_proposal', name: 'Duration Check', duration: '90 days' }, NOW);
  const end = new Date(m.entity.endDate).getTime(), start = Date.parse(NOW);
  const days = Math.round((end - start) / 86400000);
  assert.ok(days >= 84 && days <= 98, 'expected ~90 days, got ' + days);
});
test('campaign_proposal numeric duration stays weeks', () => {
  const m = materializeFromProposal({ id: 'mp_d2', type: 'campaign_proposal', name: 'Duration Check 2', duration: 4 }, NOW);
  const days = Math.round((new Date(m.entity.endDate).getTime() - Date.parse(NOW)) / 86400000);
  assert.strictEqual(days, 28);
});
test('campaign_proposal from a meeting keeps source: meeting', () => {
  const m = materializeFromProposal({ id: 'mprop_1b', type: 'campaign_proposal', name: 'Beacon Launch', meetingId: 'amtg-1' }, NOW);
  assert.strictEqual(m.entity.source, 'meeting');
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
test('objective_proposal with metricBaseline materializes criteria.baseline to the real value', () => {
  const m = materializeFromProposal({
    id: 'mprop_4', type: 'objective_proposal', title: 'Grow Bluesky', description: 'd',
    northStarMetric: 'bluesky_followers', metricTarget: 200, metricDeadline: '2026-09-01', metricBaseline: 80
  }, NOW);
  assert.ok(m.entity.criteria, 'criteria should be present');
  assert.strictEqual(m.entity.criteria.baseline, 80);
});
test('objective_proposal WITHOUT metricBaseline still yields criteria.baseline === null', () => {
  const m = materializeFromProposal({
    id: 'mprop_5', type: 'objective_proposal', title: 'Grow Bluesky', description: 'd',
    northStarMetric: 'bluesky_followers', metricTarget: 200, metricDeadline: '2026-09-01'
  }, NOW);
  assert.ok(m.entity.criteria, 'criteria should be present');
  assert.strictEqual(m.entity.criteria.baseline, null);
});
test('objective_proposal with EXPLICIT metricBaseline null yields criteria.baseline === null (not 0)', () => {
  const m = materializeFromProposal({
    id: 'mprop_6', type: 'objective_proposal', title: 'Grow Bluesky', description: 'd',
    northStarMetric: 'bluesky_followers', metricTarget: 200, metricDeadline: '2026-09-01', metricBaseline: null
  }, NOW);
  assert.ok(m.entity.criteria, 'criteria should be present');
  assert.strictEqual(m.entity.criteria.baseline, null);
});
test('objective_proposal with metricBaseline 0 yields criteria.baseline === 0', () => {
  const m = materializeFromProposal({
    id: 'mprop_7', type: 'objective_proposal', title: 'Land first paying customers', description: 'd',
    northStarMetric: 'paying_customers', metricTarget: 3, metricDeadline: '2026-09-01', metricBaseline: 0
  }, NOW);
  assert.ok(m.entity.criteria, 'criteria should be present');
  assert.strictEqual(m.entity.criteria.baseline, 0);
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

// ── findLiveDuplicate (semantic + metric detectors — 2026-07-28 hardening) ──
test('findLiveDuplicate: exact title → why exact-title', () => {
  const hit = findLiveDuplicate('campaigns', { name: 'beacon   launch' }, [{ id: 'c1', title: 'Beacon Launch', status: 'active' }]);
  assert.ok(hit);
  assert.strictEqual(hit.why, 'exact-title');
});
test('findLiveDuplicate: reworded twin caught semantically (the Founder\'s/Founding Partner class)', () => {
  const hit = findLiveDuplicate('objectives',
    { title: "Activate the AmbientScore Founder's Program" },
    [{ id: 'o1', title: 'AmbientScore Founding Partner Program', status: 'active' }]);
  assert.ok(hit, 'expected a semantic hit');
  assert.strictEqual(hit.why, 'semantic-title');
  assert.strictEqual(hit.entity.id, 'o1');
});
test('findLiveDuplicate: same north-star metric = same intent regardless of wording', () => {
  const hit = findLiveDuplicate('objectives',
    { title: 'Totally Different Wording Here', northStarMetric: 'paying_customers' },
    [{ id: 'o2', title: 'First Paying Customer', status: 'active', northStarMetric: 'paying_customers' }]);
  assert.ok(hit);
  assert.strictEqual(hit.why, 'north-star-metric');
});
test('findLiveDuplicate: different intent on same product is NOT a dup', () => {
  const hit = findLiveDuplicate('objectives',
    { title: 'System Stability Hardening for AmbientScore' },
    [{ id: 'o3', title: 'First Paying Customer — AmbientScore Launch', status: 'active' }]);
  assert.strictEqual(hit, null);
});
test('findLiveDuplicate: COMPLETED campaign does not semantically block a distinct successor (the Build-in-Public false positive)', () => {
  const hit = findLiveDuplicate('campaigns',
    { name: 'LinkedIn Build-in-Public: The First Customer Journey' },
    [{ id: 'c-bip', title: 'Build in Public', status: 'completed' }]);
  assert.strictEqual(hit, null);
});
test('findLiveDuplicate: COMPLETED campaign still blocks EXACT name reuse', () => {
  const hit = findLiveDuplicate('campaigns',
    { name: 'build in public' },
    [{ id: 'c-bip', title: 'Build in Public', status: 'completed' }]);
  assert.ok(hit);
  assert.strictEqual(hit.why, 'exact-title');
});
test('findLiveDuplicate: ACTIVE campaign still semantically blocks rewordings', () => {
  const hit = findLiveDuplicate('campaigns',
    { name: 'AmbientScore Founding Partner Push' },
    [{ id: 'c-fpp', title: 'AmbientScore Founding Partner Program', status: 'active' }]);
  assert.ok(hit);
  assert.strictEqual(hit.why, 'semantic-title');
});
test('findLiveDuplicate: canceled/archived entities never block', () => {
  const hit = findLiveDuplicate('objectives',
    { title: 'Grow Bluesky Audience' },
    [{ id: 'o4', title: 'Grow Bluesky Audience', status: 'canceled' }]);
  assert.strictEqual(hit, null);
});
test('isLiveDuplicate wrapper stays exact-only (back-compat)', () => {
  const existing = [{ id: 'o1', title: 'AmbientScore Founding Partner Program', status: 'active' }];
  assert.strictEqual(isLiveDuplicate('objectives', "Activate the AmbientScore Founder's Program", existing), false);
  assert.strictEqual(isLiveDuplicate('objectives', 'ambientscore  founding partner program', existing), true);
});

// ── Sibling-race: pending-objective deferral (2026-07-28) ──
const PENDING_SIBLING = [{ id: 'oprop_9', type: 'objective_proposal', status: 'pending', title: 'AmbientScore Founding Partner Program' }];
test('deriveObjectiveId: defers to a pending sibling objective proposal instead of mislinking', () => {
  const r = deriveObjectiveId(
    { name: 'AmbientScore Founding Partner Push', product: 'ambientscore' },
    [{ id: 'obj-old', title: 'Re-activate AmbientScore + Blindspot', status: 'active' }],
    PENDING_SIBLING);
  assert.strictEqual(r.objectiveId, null, 'must NOT product-match the old objective');
  assert.strictEqual(r.deferredToProposalId, 'oprop_9');
});
test('deriveObjectiveId: active north-star owner beats deferral (metric ownership is authoritative)', () => {
  const r = deriveObjectiveId(
    { name: 'AmbientScore Founding Partner Push', northStarMetric: 'paying_customers' },
    [{ id: 'obj-fc', title: 'First Paying Customer', status: 'active', northStarMetric: 'paying_customers' }],
    PENDING_SIBLING);
  assert.strictEqual(r.objectiveId, 'obj-fc');
  assert.strictEqual(r.deferredToProposalId, undefined);
});
test('deriveObjectiveId: product tier picks BEST title match, not first', () => {
  const r = deriveObjectiveId(
    { name: 'AmbientScore Founding Partner Q4 Push', product: 'ambientscore' },
    [
      { id: 'obj-old', title: 'First Paying Customer — AmbientScore Launch', status: 'active' },
      { id: 'obj-new', title: 'AmbientScore Founding Partner Program', status: 'active' }
    ], []);
  assert.strictEqual(r.objectiveId, 'obj-new');
});
test('materialize: deferred campaign stamps pendingObjectiveProposalId + needsReview', () => {
  const m = materializeFromProposal(
    { id: 'mp9', type: 'campaign_proposal', name: 'AmbientScore Founding Partner Push', product: 'ambientscore' },
    NOW, { objectives: [{ id: 'obj-old', title: 'Re-activate AmbientScore + Blindspot', status: 'active' }], pendingObjectiveProposals: PENDING_SIBLING });
  assert.strictEqual(m.entity.objective_id, null);
  assert.strictEqual(m.entity.pendingObjectiveProposalId, 'oprop_9');
  assert.strictEqual(m.entity.needsReview, true);
});

// ── adoptOrphanCampaigns (the other half of the sibling-race fix) ──
test('adoptOrphanCampaigns: adopts by deferral stamp', () => {
  const camps = [{ id: 'c1', title: 'Some Campaign', status: 'active', objective_id: null, pendingObjectiveProposalId: 'oprop_9' }];
  const obj = { id: 'obj-new', title: 'Zz Unrelated Title' };
  const adopted = adoptOrphanCampaigns(obj, 'oprop_9', camps);
  assert.strictEqual(adopted.length, 1);
  assert.strictEqual(camps[0].objective_id, 'obj-new');
  assert.strictEqual(camps[0].pendingObjectiveProposalId, null);
});
test('adoptOrphanCampaigns: adopts orphan by title similarity', () => {
  const camps = [{ id: 'c2', title: 'AmbientScore Founding Partner Push', status: 'paused', objective_id: null }];
  const adopted = adoptOrphanCampaigns({ id: 'obj-new', title: 'AmbientScore Founding Partner Program' }, 'oprop_x', camps);
  assert.strictEqual(adopted.length, 1);
  assert.strictEqual(camps[0].objective_id, 'obj-new');
});
test('adoptOrphanCampaigns: adopts orphan by north-star metric', () => {
  const camps = [{ id: 'c3', title: 'Zz Unrelated', status: 'active', objective_id: null, northStarMetric: 'paying_customers' }];
  const adopted = adoptOrphanCampaigns({ id: 'obj-new', title: 'Qq Different', northStarMetric: 'paying_customers' }, null, camps);
  assert.strictEqual(adopted.length, 1);
});
test('adoptOrphanCampaigns: never re-parents an already-linked campaign', () => {
  const camps = [{ id: 'c4', title: 'AmbientScore Founding Partner Push', status: 'active', objective_id: 'obj-old' }];
  const adopted = adoptOrphanCampaigns({ id: 'obj-new', title: 'AmbientScore Founding Partner Program' }, null, camps);
  assert.strictEqual(adopted.length, 0);
  assert.strictEqual(camps[0].objective_id, 'obj-old');
});
test('adoptOrphanCampaigns: ignores canceled/completed campaigns', () => {
  const camps = [{ id: 'c5', title: 'AmbientScore Founding Partner Push', status: 'canceled', objective_id: null }];
  const adopted = adoptOrphanCampaigns({ id: 'obj-new', title: 'AmbientScore Founding Partner Program' }, null, camps);
  assert.strictEqual(adopted.length, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
