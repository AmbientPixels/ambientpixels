// Run with: node api/companyHeartbeat/agent-proposal-select.test.js
const assert = require('assert');
const { proposalSeverity, selectTopProposals, liftProposalActions } = require('./agent-proposal-select');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

test('proposalSeverity maps a known trigger', () => {
  assert.strictEqual(proposalSeverity('runway-critical'), 95);
});
test('proposalSeverity returns unknown severity for missing/garbage trigger', () => {
  assert.strictEqual(proposalSeverity(undefined), 10);
  assert.strictEqual(proposalSeverity('nope'), 10);
});

test('selectTopProposals keeps top-N per type by severity desc', () => {
  const staged = [
    { type: 'campaign_proposal', severity: 50, payload: { name: 'low' } },
    { type: 'campaign_proposal', severity: 80, payload: { name: 'high' } },
    { type: 'campaign_proposal', severity: 60, payload: { name: 'mid' } },
    { type: 'objective_proposal', severity: 70, payload: { title: 'o1' } }
  ];
  const out = selectTopProposals(staged, { campaign_proposal: 2, objective_proposal: 2 });
  assert.strictEqual(out.selected.length, 3); // 2 campaigns + 1 objective
  assert.strictEqual(out.deferred.length, 1); // the 50-severity campaign
  const campNames = out.selected.filter(p => p.type === 'campaign_proposal').map(p => p.payload.name);
  assert.deepStrictEqual(campNames, ['high', 'mid']);
  assert.strictEqual(out.deferred[0].payload.name, 'low');
});

test('selectTopProposals handles empty input', () => {
  const out = selectTopProposals([], { campaign_proposal: 2, objective_proposal: 2 });
  assert.deepStrictEqual(out.selected, []);
  assert.deepStrictEqual(out.deferred, []);
});

test('selectTopProposals defaults cap to 0 for unknown types (defers them)', () => {
  const out = selectTopProposals([{ type: 'weird', severity: 99 }], { campaign_proposal: 2, objective_proposal: 2 });
  assert.strictEqual(out.selected.length, 0);
  assert.strictEqual(out.deferred.length, 1);
});

// ── liftProposalActions ──

test('lift: canonical propose-campaign action passes through', () => {
  const out = liftProposalActions([{ type: 'propose-campaign', campaign: { name: 'C1', description: 'd', trigger: 'runway-critical' } }]);
  assert.strictEqual(out.lifted.length, 1);
  assert.strictEqual(out.remaining.length, 0);
  assert.strictEqual(out.lifted[0].type, 'propose-campaign');
  assert.strictEqual(out.lifted[0].campaign.name, 'C1');
  assert.strictEqual(out.lifted[0].campaign.trigger, 'runway-critical');
});

test('lift: proposedAction variant + underscore naming is recognized', () => {
  const out = liftProposalActions([{ proposedAction: 'propose_objective', objective: { title: 'O1', rationale: 'r' } }]);
  assert.strictEqual(out.lifted.length, 1);
  assert.strictEqual(out.lifted[0].type, 'propose-objective');
  assert.strictEqual(out.lifted[0].objective.title, 'O1');
});

test('lift: queue-entry style type names (campaign_proposal / objective_proposal)', () => {
  const out = liftProposalActions([
    { type: 'campaign_proposal', campaign: { name: 'C2', rationale: 'why' } },
    { type: 'objective_proposal', objective: { title: 'O2', description: 'd' } }
  ]);
  assert.strictEqual(out.lifted.length, 2);
  assert.deepStrictEqual(out.lifted.map(a => a.type), ['propose-campaign', 'propose-objective']);
});

test('lift: payload-nested campaign is unwrapped', () => {
  const out = liftProposalActions([{ type: 'propose-campaign', payload: { campaign: { name: 'C3', description: 'd' } } }]);
  assert.strictEqual(out.lifted.length, 1);
  assert.strictEqual(out.lifted[0].campaign.name, 'C3');
});

test('lift: bare unambiguous payload infers the kind', () => {
  const out = liftProposalActions([{ objective: { title: 'O3', rationale: 'r' } }]);
  assert.strictEqual(out.lifted.length, 1);
  assert.strictEqual(out.lifted[0].type, 'propose-objective');
});

test('lift: flat fields synthesized into a campaign payload, title aliased to name', () => {
  const out = liftProposalActions([{ type: 'propose-campaign', title: 'Flat C', description: 'd', platforms: ['social_bluesky'], cadence: 'weekly' }]);
  assert.strictEqual(out.lifted.length, 1);
  assert.strictEqual(out.lifted[0].campaign.name, 'Flat C');
  assert.deepStrictEqual(out.lifted[0].campaign.platforms, ['social_bluesky']);
});

test('lift: item-level trigger backfilled into the payload', () => {
  const out = liftProposalActions([{ type: 'propose-objective', trigger: 'runway-critical', objective: { title: 'O4', description: 'd' } }]);
  assert.strictEqual(out.lifted[0].objective.trigger, 'runway-critical');
});

test('lift: generic agent suggestion stays in remaining', () => {
  const out = liftProposalActions([{ proposedAction: 'agent_suggestion', payload: { title: 'idea', category: 'maintenance' } }]);
  assert.strictEqual(out.lifted.length, 0);
  assert.strictEqual(out.remaining.length, 1);
});

test('lift: typed but substanceless (no label/description) stays in remaining', () => {
  const out = liftProposalActions([{ type: 'propose-campaign' }]);
  assert.strictEqual(out.lifted.length, 0);
  assert.strictEqual(out.remaining.length, 1);
});

test('lift: ambiguous bare item with BOTH payloads stays in remaining', () => {
  const out = liftProposalActions([{ campaign: { name: 'c', description: 'd' }, objective: { title: 'o', description: 'd' } }]);
  assert.strictEqual(out.lifted.length, 0);
  assert.strictEqual(out.remaining.length, 1);
});

test('lift: null/garbage input handled', () => {
  assert.deepStrictEqual(liftProposalActions(null), { lifted: [], remaining: [] });
  assert.deepStrictEqual(liftProposalActions('nope'), { lifted: [], remaining: [] });
  const out = liftProposalActions([null, 'str', 42]);
  assert.strictEqual(out.lifted.length, 0);
  assert.strictEqual(out.remaining.length, 2); // 'str' and 42 kept, null dropped
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
