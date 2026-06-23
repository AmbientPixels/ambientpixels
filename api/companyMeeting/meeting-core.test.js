// Run with: node api/companyMeeting/meeting-core.test.js
const assert = require('assert');
const core = require('./meeting-core');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// ── classifyBlastRadius ──
test('campaign/objective/product are strategic', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'campaign' }), 'strategic');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'objective' }), 'strategic');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'product_launch' }), 'strategic');
});
test('research_task and internal_doc are internal', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'research_task' }), 'internal');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'internal_doc' }), 'internal');
});
test('execution_task is internal ONLY with a target objective', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'execution_task', targetObjectiveId: 'obj-1' }), 'internal');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'execution_task' }), 'strategic');
});
test('unknown kind defaults to strategic (fail safe to human review)', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'wat' }), 'strategic');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
