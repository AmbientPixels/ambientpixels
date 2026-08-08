// Run with: node api/companyHeartbeat/pa-metrics.test.js
// Counts COMPLETED Resume Roast runs from product-analytics events for the
// objective's kill-gate metric. The counting is injected-reader-pure so no
// blob storage is touched in tests.
const assert = require('assert');
const { countResumeRoastRuns14d, countRunsInEvents } = require('./pa-metrics');

let pass = 0, fail = 0;
function t(name, fn) { queue.push([name, fn]); }
const queue = [];

const NOW = Date.parse('2026-08-08T12:00:00Z');

t('counts only resumeroast agent_run_completed events', function () {
  const events = [
    { product: 'resumeroast', event: 'agent_run_completed' },
    { product: 'resumeroast', event: 'agent_run_completed' },
    { product: 'resumeroast', event: 'agent_run_started' },
    { product: 'pixelagents', event: 'agent_run_completed' },
    { product: 'resumeroast', event: 'page_view' }
  ];
  assert.strictEqual(countRunsInEvents(events), 2);
});

t('internal (our own) runs never count as demand — the publicScans7d rule', function () {
  const events = [
    { product: 'resumeroast', event: 'agent_run_completed' },
    { product: 'resumeroast', event: 'agent_run_completed', internal: true }
  ];
  assert.strictEqual(countRunsInEvents(events), 1);
});

t('one run reported by BOTH the browser and the server counts once', function () {
  // The client emits agent_run_completed and api/pixel-agent-run emits
  // run_delivered for the same roast. Counting both would inflate the kill-gate
  // metric by ~2x for every run that finished on screen.
  const events = [
    { product: 'resumeroast', event: 'run_delivered', props: { runId: 'run-1' } },
    { product: 'resumeroast', event: 'agent_run_completed', props: { runId: 'run-1' } }
  ];
  assert.strictEqual(countRunsInEvents(events), 1);
});

t('a run delivered to a closed tab still counts — server-only is a real run', function () {
  const events = [
    { product: 'resumeroast', event: 'run_delivered', props: { runId: 'run-a' } },
    { product: 'resumeroast', event: 'run_delivered', props: { runId: 'run-b' } },
    { product: 'resumeroast', event: 'agent_run_completed', props: { runId: 'run-b' } }
  ];
  assert.strictEqual(countRunsInEvents(events), 2);
});

t('history predating run_delivered is not lost', function () {
  // Client events from before the server emitter shipped carry a runId and no
  // server twin. Dropping them would read the kill gate near zero on 08-22 for
  // a lane that was working.
  const events = [
    { product: 'resumeroast', event: 'agent_run_completed', props: { runId: 'old-1' } },
    { product: 'resumeroast', event: 'agent_run_completed', props: { runId: 'old-2' } }
  ];
  assert.strictEqual(countRunsInEvents(events), 2);
});

t('a failed run is not a delivered run', function () {
  const events = [
    { product: 'resumeroast', event: 'run_failed', props: { runId: 'x', reason: 'rate_limited' } },
    { product: 'resumeroast', event: 'agent_run_started' }
  ];
  assert.strictEqual(countRunsInEvents(events), 0);
});

t('an internal server-side delivery is excluded too', function () {
  const events = [
    { product: 'resumeroast', event: 'run_delivered', props: { runId: 'mine' }, internal: true },
    { product: 'resumeroast', event: 'run_delivered', props: { runId: 'theirs' } }
  ];
  assert.strictEqual(countRunsInEvents(events), 1);
});

t('empty or malformed input counts 0 without throwing', function () {
  assert.strictEqual(countRunsInEvents([]), 0);
  assert.strictEqual(countRunsInEvents(null), 0);
  assert.strictEqual(countRunsInEvents([null, {}, { product: 'resumeroast' }]), 0);
});

t('countResumeRoastRuns14d reads a 14-day window through the injected reader', async function () {
  const askedRanges = [];
  const reader = async function (startDate, endDate) {
    askedRanges.push([startDate, endDate]);
    return [
      { product: 'resumeroast', event: 'agent_run_completed' },
      { product: 'resumeroast', event: 'agent_run_completed' },
      { product: 'resumeroast', event: 'agent_run_started' }
    ];
  };
  const n = await countResumeRoastRuns14d(NOW, reader);
  assert.strictEqual(n, 2);
  assert.strictEqual(askedRanges.length, 1);
  assert.strictEqual(askedRanges[0][1], '2026-08-08', 'end date must be today (UTC)');
  assert.strictEqual(askedRanges[0][0], '2026-07-25', 'start date must be 14 days back');
});

t('a reader failure resolves to null — unmeasured, never a fake zero', async function () {
  const n = await countResumeRoastRuns14d(NOW, async function () { throw new Error('blob down'); });
  assert.strictEqual(n, null);
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\npa-metrics tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
