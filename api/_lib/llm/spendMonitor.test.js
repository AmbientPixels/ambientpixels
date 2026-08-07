// Run with: node api/_lib/llm/spendMonitor.test.js
//
// The point of this monitor is to fire BEFORE customers find out. So the tests
// that matter are the ones proving each alarm actually trips at its threshold —
// an untested alarm is indistinguishable from no alarm until the day it matters.

const assert = require('assert');
const m = require('./spendMonitor');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
}

const NOW = Date.parse('2026-08-07T12:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3600000).toISOString();
const daysAgo = d => new Date(NOW - d * 86400000).toISOString();

function usage(cost, ts, over) {
  return Object.assign({ model: 'claude-sonnet-4-6', caller: 'pixel-agent-run', totalCost: cost, timestamp: ts }, over || {});
}
function summarize(over) {
  return m.summarize(Object.assign({ claudeUsage: [], geminiUsage: [], fallbackLog: [], nowMs: NOW }, over || {}));
}

// ── reading the meter ──

test('sums Claude spend across BOTH rails — reading one is half the bill', () => {
  // Fleet calls land in geminiUsage with a claude-* model; product calls in
  // claudeUsage. A monitor that reads one rail under-reports by design.
  const r = summarize({
    claudeUsage: [usage(1.0, hoursAgo(2))],
    geminiUsage: [usage(2.0, hoursAgo(3)), { model: 'gemini-2.5-flash', totalCost: 99, timestamp: hoursAgo(1) }]
  });
  assert.strictEqual(r.spend24hUsd, 3.0, 'expected 3.0, got ' + r.spend24hUsd);
});

test('Gemini spend is excluded from the Anthropic balance', () => {
  const r = summarize({ geminiUsage: [{ model: 'gemini-2.5-pro', totalCost: 50, timestamp: hoursAgo(1) }] });
  assert.strictEqual(r.spend24hUsd, 0);
});

test('the 24h and 7d windows actually window', () => {
  const r = summarize({
    claudeUsage: [usage(5, hoursAgo(2)), usage(10, daysAgo(3)), usage(999, daysAgo(30))]
  });
  assert.strictEqual(r.spend24hUsd, 5);
  assert.strictEqual(r.spend7dUsd, 15, 'the 30-day-old entry leaked into the 7d window');
});

test('runway divides remaining balance by real daily burn', () => {
  const r = summarize({
    claudeUsage: [usage(70, daysAgo(1))],           // $70 over the 7d window = $10/day
    anthropicCredits: { balanceUsd: 100, asOf: daysAgo(7) }
  });
  assert.strictEqual(r.dailyBurnUsd, 10);
  assert.strictEqual(r.remainingUsd, 30);
  assert.strictEqual(r.runwayDays, 3);
});

test('no recorded balance reports burn honestly instead of inventing runway', () => {
  const r = summarize({ claudeUsage: [usage(7, daysAgo(1))] });
  assert.strictEqual(r.balanceConfigured, false);
  assert.strictEqual(r.remainingUsd, null);
  assert.strictEqual(r.runwayDays, null);
  assert.strictEqual(r.dailyBurnUsd, 1);
});

test('zero burn reports null runway, not Infinity', () => {
  const r = summarize({ anthropicCredits: { balanceUsd: 100, asOf: daysAgo(7) } });
  assert.strictEqual(r.runwayDays, null, 'got ' + r.runwayDays);
});

test('top callers are ranked, so a spike names its source', () => {
  const r = summarize({
    claudeUsage: [
      usage(1, hoursAgo(1), { caller: 'pixel-agent-run' }),
      usage(9, hoursAgo(1), { caller: 'roast-rewrite-compose' }),
      usage(3, hoursAgo(1), { caller: 'as-analyze' })
    ]
  });
  assert.strictEqual(r.topCallers[0].caller, 'roast-rewrite-compose');
  assert.strictEqual(r.topCallers[0].usd, 9);
});

// ── the alarms ──

function decide(report, prev) {
  return m.decideAlerts(Object.assign({
    spend24hUsd: 0, spend7dUsd: 0, dailyBurnUsd: 0, remainingUsd: null, runwayDays: null,
    balanceConfigured: false, fallbacks24h: 0, creditFallbacks24h: 0, chainExhausted24h: 0, topCallers: []
  }, report), prev, NOW);
}
const keys = out => out.alerts.map(a => a.key).sort();

test('a fully exhausted chain is critical — users are seeing errors', () => {
  const out = decide({ chainExhausted24h: 2 });
  assert.deepStrictEqual(keys(out), ['chain-exhausted']);
  assert.strictEqual(out.alerts[0].severity, 'critical');
});

test('credit fallbacks alert even though the product is still UP', () => {
  // This is the whole point: with a Gemini fallback in place, exhausted Anthropic
  // credits are SILENT. Nobody complains, quality just quietly drops.
  const out = decide({ creditFallbacks24h: 5 });
  assert.deepStrictEqual(keys(out), ['credit-fallback']);
  assert.ok(/UP but running on the backup/.test(out.alerts[0].description), out.alerts[0].description);
});

test('runway under 3 days is critical, under 10 is a warning, above is silent', () => {
  assert.deepStrictEqual(keys(decide({ runwayDays: 2.5, remainingUsd: 25, dailyBurnUsd: 10 })), ['runway-critical']);
  assert.deepStrictEqual(keys(decide({ runwayDays: 8, remainingUsd: 80, dailyBurnUsd: 10 })), ['runway-warn']);
  assert.deepStrictEqual(keys(decide({ runwayDays: 40, remainingUsd: 400, dailyBurnUsd: 10 })), []);
});

test('runway alerts stay silent when no balance was ever recorded', () => {
  assert.deepStrictEqual(keys(decide({ runwayDays: null, dailyBurnUsd: 10 })), []);
});

test('a burn spike fires at 3x the weekly average', () => {
  const out = decide({ spend24hUsd: 40, dailyBurnUsd: 10, topCallers: [{ caller: 'pixel-agent-run', usd: 38 }] });
  assert.deepStrictEqual(keys(out), ['burn-spike']);
  assert.ok(/pixel-agent-run/.test(out.alerts[0].description), 'spike must name its source');
});

test('a spike below the dollar floor is noise and stays quiet', () => {
  // $0.10 -> $0.40 is 4x and completely uninteresting.
  assert.deepStrictEqual(keys(decide({ spend24hUsd: 0.4, dailyBurnUsd: 0.1 })), []);
});

test('normal spend produces no alerts at all', () => {
  assert.deepStrictEqual(keys(decide({ spend24hUsd: 3, dailyBurnUsd: 3, runwayDays: 60, remainingUsd: 180 })), []);
});

test('several conditions can fire together', () => {
  const out = decide({ chainExhausted24h: 1, creditFallbacks24h: 3, runwayDays: 1, remainingUsd: 5, dailyBurnUsd: 5 });
  assert.deepStrictEqual(keys(out), ['chain-exhausted', 'credit-fallback', 'runway-critical']);
});

// ── not crying wolf ──

test('the same condition does not re-alert inside the cooldown', () => {
  const first = decide({ creditFallbacks24h: 5 });
  const second = m.decideAlerts(
    Object.assign({ spend24hUsd: 0, dailyBurnUsd: 0, runwayDays: null, chainExhausted24h: 0, topCallers: [] }, { creditFallbacks24h: 5 }),
    first.nextState, NOW + 3600000);
  assert.deepStrictEqual(second.alerts, [], 'alerted again one hour later');
});

test('it re-alerts once the cooldown has expired — a real problem must keep nagging', () => {
  const first = decide({ creditFallbacks24h: 5 });
  const later = m.decideAlerts(
    Object.assign({ spend24hUsd: 0, dailyBurnUsd: 0, runwayDays: null, chainExhausted24h: 0, topCallers: [] }, { creditFallbacks24h: 5 }),
    first.nextState, NOW + m.ALERT_COOLDOWN_MS + 1000);
  assert.deepStrictEqual(keys(later), ['credit-fallback']);
});

test('one condition cooling down does not mute a different one', () => {
  const first = decide({ creditFallbacks24h: 5 });
  const second = m.decideAlerts(
    Object.assign({ spend24hUsd: 0, dailyBurnUsd: 0, runwayDays: null, topCallers: [] },
      { creditFallbacks24h: 5, chainExhausted24h: 2 }),
    first.nextState, NOW + 3600000);
  assert.deepStrictEqual(keys(second), ['chain-exhausted']);
});

test('state survives a round trip through JSON, as it will through blob storage', () => {
  const first = decide({ creditFallbacks24h: 5 });
  const revived = JSON.parse(JSON.stringify(first.nextState));
  const second = m.decideAlerts(
    Object.assign({ spend24hUsd: 0, dailyBurnUsd: 0, runwayDays: null, chainExhausted24h: 0, topCallers: [] }, { creditFallbacks24h: 5 }),
    revived, NOW + 3600000);
  assert.deepStrictEqual(second.alerts, []);
});

test('empty and malformed state never throws', () => {
  for (const bad of [null, undefined, {}, { firedAt: null }]) {
    assert.doesNotThrow(() => decide({ creditFallbacks24h: 1 }, bad), JSON.stringify(bad));
  }
  assert.doesNotThrow(() => m.summarize({ nowMs: NOW }));
  assert.doesNotThrow(() => m.summarize({ claudeUsage: [null], geminiUsage: [undefined], fallbackLog: [null], nowMs: NOW }));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
