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

test('board minute: north star and bet ledger facts come from code, unmeasured stays unmeasured', () => {
  const facts = b.buildBriefFacts({
    heartbeatRuns: [], approvalQueue: [], ceoActionList: [],
    objectives: [{ id: 'obj-build-public', status: 'active', northStarMetric: 'qualified_uses_week', criteria: { target: 10, by: '2026-12-03' } }],
    outcomeDigest: { betLedger: {
      running: [{ title: 'Search pages', betKey: 'search_page|rr|google|any', startDate: new Date(NOW - 9 * 86400000).toISOString(), kill: { byDay: 14 }, measurementGap: true }],
      rows: [
        { title: 'Old bet', betKey: 'k1', result: 'lost', actual: { value: 0, posts: 12 }, expected: 3, scoredAt: new Date(NOW - 30 * 86400000).toISOString() },
        { title: 'New bet', betKey: 'k2', result: 'won', actual: { value: 4, posts: 10 }, expected: 3, scoredAt: new Date(NOW - 2 * 86400000).toISOString() }
      ],
      neverTried: ['directory_listing'], calibration: { scout: { scored: 1, meanError: 0.33 } }
    } }
  }, NOW);
  assert.strictEqual(facts.northStar.value, 'unmeasured');
  assert.strictEqual(facts.northStar.target, 10);
  assert.strictEqual(facts.bets.running[0].daysIn, 9);
  assert.strictEqual(facts.bets.running[0].measurementGap, true);
  assert.deepStrictEqual(facts.bets.scoredThisWeek.map(r => r.title), ['New bet'], 'only this week');
  const text = b.formatBriefFallback(facts, 'morning');
  assert.ok(text.includes('North star qualified_uses_week: unmeasured (target 10 by 2026-12-03)'), text);
  assert.ok(text.includes('Search pages (day 9, kill check day 14, UNMEASURED)'), text);
  assert.ok(text.includes('New bet WON (4 people vs expected 3 over 10 posts)'), text);
  assert.ok(text.includes('Mechanisms never tried: directory_listing'));
  const none = b.formatBriefFallback(b.buildBriefFacts({ outcomeDigest: { betLedger: { running: [], rows: [] } } }, NOW), 'evening');
  assert.ok(none.includes('Bets running: none'), none);
  assert.strictEqual(b.buildBriefFacts({}, NOW).bets, null, 'no ledger → no bets section, not a fake one');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
