// Run with: node api/companyHeartbeat/agent-proposal-select.test.js
const assert = require('assert');
const { proposalSeverity, selectTopProposals } = require('./agent-proposal-select');

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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
