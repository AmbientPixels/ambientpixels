// Run with: node modules/company/js/agent-progress.test.js
// Pure-helper tests for the Agent Progress dashboard.
const assert = require('assert');
const { computeFleetPulse, healthFlag, sortByXp, xpBarPct } = require('./agent-progress');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const rewards = { perAgent: {
  scribe: { xp: 302, level: 4, rank: 'Veteran', renown: 147, streakDays: 3, achievements: [{}, {}, {}] },
  echo:   { xp: 195, level: 3, rank: 'Rookie', renown: 1, streakDays: 1, achievements: [] },
  nova:   { xp: 4, level: 1, rank: 'Rookie', renown: 0, streakDays: 1, achievements: [{}] }
} };

test('computeFleetPulse totals, average level, top agent, achievements', () => {
  const p = computeFleetPulse(rewards);
  assert.strictEqual(p.totalXp, 501, 'total xp');
  assert.strictEqual(p.topAgentId, 'scribe', 'top agent by xp');
  assert.strictEqual(p.achievementsUnlocked, 4, 'fleet achievements');
  assert.strictEqual(p.avgLevel, 2.7, 'avg level rounded to 1dp ((4+3+1)/3)');
});

test('computeFleetPulse empty -> zeros, null top', () => {
  const p = computeFleetPulse({ perAgent: {} });
  assert.deepStrictEqual(p, { totalXp: 0, avgLevel: 0, topAgentId: null, achievementsUnlocked: 0 });
});

test('sortByXp orders agent ids by xp desc', () => {
  assert.deepStrictEqual(sortByXp(rewards), ['scribe', 'echo', 'nova']);
});

test('healthFlag: RED budget -> red', () => {
  assert.strictEqual(healthFlag('echo', { allocPA: { echo: { status: 'RED' } } }), 'red');
});
test('healthFlag: YELLOW budget OR drift OR stale -> yellow', () => {
  assert.strictEqual(healthFlag('echo', { allocPA: { echo: { status: 'YELLOW' } } }), 'yellow');
  assert.strictEqual(healthFlag('nova', { rdPA: { nova: { roleAdherence: { drift: 'drifting-create-social-action' } } } }), 'yellow');
  assert.strictEqual(healthFlag('forge', { eff: { forge: { executed: 0 } } }), 'yellow');
});
test('healthFlag: healthy -> green', () => {
  assert.strictEqual(healthFlag('scribe', { allocPA: { scribe: { status: 'GREEN' } }, rdPA: { scribe: { roleAdherence: { drift: 'on-role' } } }, eff: { scribe: { executed: 5 } } }), 'green');
  assert.strictEqual(healthFlag('ghost', {}), 'green', 'no data -> green (innocent until flagged)');
});

test('xpBarPct matches the engine level curve', () => {
  assert.strictEqual(xpBarPct(1, 16), 21, 'L1: 16/75');   // cost 75, into 16 -> 21%
  assert.strictEqual(xpBarPct(2, 120), 45, 'L2: 45/100');  // cost 100, cum 75, into 45 -> 45%
  assert.strictEqual(xpBarPct(1, 0), 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
