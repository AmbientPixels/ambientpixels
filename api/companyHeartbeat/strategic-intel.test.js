// Run with: node api/companyHeartbeat/strategic-intel.test.js
const assert = require('assert');
const { _verdict, MIN_TRAFFIC_VOLUME } = require('./strategic-intel');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// args: (trafficDeltaPct, usageDeltaPct, hasTrafficSignal, hasUsageSignal, trafficVolume)

test('low-volume traffic drop is DORMANT, not DECLINING (the AmbientScore bug)', () => {
  // 3 → 0 views = -100% but only 3 combined views — noise, not a trend.
  assert.strictEqual(_verdict(-100, 0, true, false, 3), 'DORMANT');
  // 10 → 1 (AmbientOS): 11 combined still under the floor.
  assert.strictEqual(_verdict(-90, 0, true, false, 11), 'DORMANT');
});
test('truly zero traffic both weeks is still NO DATA', () => {
  assert.strictEqual(_verdict(0, 0, false, false, 0), 'NO DATA');
});
test('a real-volume decline IS DECLINING', () => {
  assert.strictEqual(_verdict(-50, 0, true, false, 40), 'DECLINING');
});
test('a real-volume rise IS GROWING', () => {
  assert.strictEqual(_verdict(50, 0, true, false, 40), 'GROWING');
});
test('real-volume flat traffic is STABLE', () => {
  assert.strictEqual(_verdict(0, 0, true, false, 40), 'STABLE');
});
test('a usage signal drives the verdict even when traffic is below the floor', () => {
  // tiny blog traffic but real usage decline → DECLINING from usage, not noise.
  assert.strictEqual(_verdict(-100, -50, true, true, 3), 'DECLINING');
  assert.strictEqual(_verdict(-100, 30, true, true, 3), 'GROWING');
});
test('floor constant is exported and sane', () => {
  assert.ok(MIN_TRAFFIC_VOLUME >= 10, 'floor should be a meaningful minimum');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
