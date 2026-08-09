// Run with: node api/companyHeartbeat/_utils/blockCounts.test.js
//
// These exist because the run record's actionsBlocked lied by 13x and nobody noticed —
// it made refused agents look like idle ones. The counts here feed Forge's health view
// and the agent-performance block rate, so being wrong is not cosmetic.

const assert = require('assert');
const { countBlocksByAgent, topGateForAgent } = require('./blockCounts');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const LOG = [
  { type: 'policy-violation', agentId: 'scribe', timestamp: '2026-08-09T18:00:00Z', cycle: 'c1', details: { runId: 'c1', gate: 'campaign_freeze' } },
  { type: 'policy-violation', agentId: 'scribe', timestamp: '2026-08-09T18:00:01Z', cycle: 'c1', details: { runId: 'c1', gate: 'campaign_freeze' } },
  { type: 'policy-violation', agentId: 'scribe', timestamp: '2026-08-09T18:00:02Z', cycle: 'c1', details: { runId: 'c1', gate: 'quality_gate' } },
  { type: 'policy-violation', agentId: 'echo',   timestamp: '2026-08-09T18:00:03Z', cycle: 'c1', details: { runId: 'c1', gate: 'orphan' } },
  { type: 'policy-violation', agentId: 'echo',   timestamp: '2026-08-01T10:00:00Z', cycle: 'c0', details: { runId: 'c0', gate: 'orphan' } },
  // Not a violation — must never be counted as a block.
  { type: 'agent-action',     agentId: 'scribe', timestamp: '2026-08-09T18:00:04Z', cycle: 'c1', details: { runId: 'c1' } }
];

console.log('\nblockCounts');

t('counts only policy-violation entries', () => {
  const r = countBlocksByAgent(LOG);
  assert.strictEqual(r.scribe.total, 3, 'scribe: 3 violations, the agent-action must not count');
  assert.strictEqual(r.echo.total, 2);
});

t('breaks down by gate, which is the actionable part', () => {
  const r = countBlocksByAgent(LOG);
  assert.strictEqual(r.scribe.byGate.campaign_freeze, 2);
  assert.strictEqual(r.scribe.byGate.quality_gate, 1);
});

t('runIds filter scopes to a set of runs', () => {
  const r = countBlocksByAgent(LOG, { runIds: ['c1'] });
  assert.strictEqual(r.echo.total, 1, 'the c0 entry must be excluded');
});

t('sinceMs filter drops older entries', () => {
  const r = countBlocksByAgent(LOG, { sinceMs: Date.parse('2026-08-05T00:00:00Z') });
  assert.strictEqual(r.echo.total, 1);
  assert.strictEqual(r.scribe.total, 3);
});

// An unparseable date must be KEPT. Dropping it would silently under-count, which is the
// precise failure this module was written to end.
t('an unparseable timestamp is kept, not dropped', () => {
  const odd = [{ type: 'policy-violation', agentId: 'nova', timestamp: 'not-a-date', details: { gate: 'rate_limit' } }];
  const r = countBlocksByAgent(odd, { sinceMs: Date.now() });
  assert.strictEqual(r.nova.total, 1, 'a bad date must not make a real block vanish');
});

t('entries with no agent are skipped rather than bucketed as undefined', () => {
  const r = countBlocksByAgent([{ type: 'policy-violation', details: { gate: 'x' } }]);
  assert.deepStrictEqual(Object.keys(r), []);
});

t('a missing gate is labelled, not dropped', () => {
  const r = countBlocksByAgent([{ type: 'policy-violation', agentId: 'q', details: {} }]);
  assert.strictEqual(r.q.byGate.unknown, 1);
});

t('handles junk input without throwing', () => {
  assert.deepStrictEqual(countBlocksByAgent(null), {});
  assert.deepStrictEqual(countBlocksByAgent([null, undefined, 'x']), {});
});

t('topGateForAgent names the worst offender', () => {
  const r = countBlocksByAgent(LOG);
  assert.deepStrictEqual(topGateForAgent(r, 'scribe'), { gate: 'campaign_freeze', count: 2 });
  assert.strictEqual(topGateForAgent(r, 'nobody'), null);
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
