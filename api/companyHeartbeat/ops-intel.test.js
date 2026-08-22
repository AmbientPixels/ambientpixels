// Run with: node api/companyHeartbeat/ops-intel.test.js
//
// Regression tests for the 2026-08-22 false-RED incident.
//
// For five days Forge held the fleet at a RED "p95 latency 14207ms" alert, filed an
// ops_breakfix every six hours, and proposed migrating to Azure Durable Functions as
// "the definitive solution". Echo then published two victory-lap posts announcing the
// fix. Measured that day in Application Insights:
//
//   pageViews  (what the alert read):   n=83     p95 = 14207ms
//   ...of which crawlers:               n=61     Applebot alone n=9, p95 = 16102ms
//   requests   (real function latency): n=8516   p95 =   921ms
//   FunctionTimeoutException, 7d:       2
//
// The numbers Forge quoted (14207, 12986) were individual Applebot page loads. There
// was no latency problem, and the proposed migration would not have touched the metric.
// THREE bugs in total. The first fix attempt introduced the third: the bot filter
// used Kusto !has, which matches whole tokens, so !has "bot" never matched
// "Googlebot 2.1" and excluded nothing. Corrected to !contains (n=83 -> n=22), and
// the sample floor raised 20 -> 100, because n=22 would have cleared a floor of 20
// and produced a fresh small-sample RED at p95=8963ms.
const assert = require('assert');
const { buildForgeOpsDigest, _buildForgeOpsPromptBlock } = require('./ops-intel');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

const NOW = Date.parse('2026-08-22T04:00:00Z');
const siteIntel = (performance) => ({ telemetry: { performance, errors: [], topPages: [], topReferrers: [] } });
const digest = (performance) => buildForgeOpsDigest([], [], [], siteIntel(performance), NOW);
const perfAlertsOf = (d) => (d.alerts || []).filter(a => /page load|latency/i.test(a.signal || ''));

// ── sample floor ────────────────────────────────────────────────────────────
test('the real incident shape raises NO alert once the sample floor applies', () => {
  // 22 human pageviews a week is the actual measured traffic once crawlers are
  // excluded. p95 there is the 2nd slowest row, not a percentile.
  const d = digest({ n: 22, p50: 1972, p95: 8963 });
  assert.strictEqual(d.errorIntel.perfUnderSampled, true);
  assert.strictEqual(d.errorIntel.perfAlert, null);
  assert.strictEqual(perfAlertsOf(d).length, 0, 'must not fire RED on 22 samples');
});

test('an under-sampled digest still REPORTS the numbers', () => {
  // Suppressing the alert must not hide the data — the agent should be able to see
  // the value and the reason it is not actionable.
  const d = digest({ n: 22, p50: 1972, p95: 8963 });
  assert.strictEqual(d.errorIntel.p95, 8963);
  assert.strictEqual(d.errorIntel.perfSamples, 22);
});

test('a real slowdown on adequate traffic still fires RED', () => {
  const d = digest({ n: 5000, p50: 2500, p95: 9000 });
  assert.strictEqual(d.errorIntel.perfUnderSampled, false);
  assert.ok(/p95_red/.test(d.errorIntel.perfAlert));
  assert.strictEqual(perfAlertsOf(d).length, 1);
});

test('healthy page load on adequate traffic raises nothing', () => {
  const d = digest({ n: 5000, p50: 800, p95: 1500 });
  assert.strictEqual(d.errorIntel.perfAlert, null);
  assert.strictEqual(perfAlertsOf(d).length, 0);
});

test('exactly at the floor is allowed to alert', () => {
  const d = digest({ n: 100, p50: 900, p95: 9000 });
  assert.strictEqual(d.errorIntel.perfUnderSampled, false);
  assert.ok(/p95_red/.test(d.errorIntel.perfAlert));
});

test('a perf payload with no count behaves as before (no floor applied)', () => {
  // Older cached siteIntel has no `n`. It must not silently start suppressing.
  const d = digest({ p50: 900, p95: 9000 });
  assert.strictEqual(d.errorIntel.perfUnderSampled, false);
  assert.ok(/p95_red/.test(d.errorIntel.perfAlert));
});

// ── labelling ───────────────────────────────────────────────────────────────
test('the alert says "site page load", never a bare "p95 latency"', () => {
  const a = perfAlertsOf(digest({ n: 5000, p50: 2500, p95: 9000 }))[0];
  assert.ok(/site page load/i.test(a.signal), 'signal was: ' + a.signal);
  assert.ok(/n=5000/.test(a.signal), 'sample size must travel with the number');
  assert.ok(!/^p95 latency/.test(a.signal), 'the old wording read as backend health');
});

test('the Forge prompt block names what was measured and warns when under-sampled', () => {
  const d = digest({ n: 22, p50: 1972, p95: 8963 });
  const block = _buildForgeOpsPromptBlock({ id: 'forge' }, d);
  assert.ok(/HUMAN browsers only/.test(block));
  assert.ok(/not API or function latency/i.test(block));
  assert.ok(/n=22 pageviews/.test(block));
  assert.ok(/SAMPLE TOO SMALL TO ALERT ON/.test(block), 'must tell the agent not to open ops tasks');
});

test('the prompt block omits the warning when the sample is adequate', () => {
  const block = _buildForgeOpsPromptBlock({ id: 'forge' }, digest({ n: 5000, p50: 800, p95: 1500 }));
  assert.ok(/HUMAN browsers only/.test(block));
  assert.ok(!/SAMPLE TOO SMALL/.test(block));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
