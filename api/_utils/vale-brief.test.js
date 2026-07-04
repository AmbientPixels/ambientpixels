// Run with: node api/_utils/vale-brief.test.js
const assert = require('assert');
const b = require('./vale-brief');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const NOW = Date.UTC(2026, 6, 3, 14, 0, 0);
const DAY = 86400000;

test('buildBriefFacts counts pending approvals and open actions', () => {
  const facts = b.buildBriefFacts({
    heartbeatRuns: [{ timestamp: '2026-07-03T13:00:00Z' }],
    approvalQueue: [{ status: 'pending' }, { status: 'approved' }, {}],
    ceoActionList: [{ title: 'A', status: 'open' }, { title: 'B', status: 'done' }]
  }, NOW);
  assert.strictEqual(facts.pendingApprovals, 2); // 'pending' + no-status
  assert.strictEqual(facts.openActionCount, 1);
  assert.strictEqual(facts.lastRunAt, '2026-07-03T13:00:00Z');
});

test('dueSoon includes items within 3 days, excludes far-out', () => {
  const facts = b.buildBriefFacts({
    ceoActionList: [
      { title: 'Soon', status: 'open', deadline: new Date(NOW + 2 * DAY).toISOString() },
      { title: 'Later', status: 'open', deadline: new Date(NOW + 10 * DAY).toISOString() }
    ]
  }, NOW);
  assert.strictEqual(facts.dueSoon.length, 1);
  assert.strictEqual(facts.dueSoon[0].title, 'Soon');
});

test('formatBriefFallback renders a readable brief', () => {
  const facts = { pendingApprovals: 2, openActionCount: 1, dueSoon: [{ title: 'PH launch', deadline: '2026-07-07' }] };
  const text = b.formatBriefFallback(facts, 'morning');
  assert.ok(text.includes('Morning brief'));
  assert.ok(text.includes('Approvals waiting on you: 2'));
  assert.ok(text.includes('PH launch'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
