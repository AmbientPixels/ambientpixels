// Run with: node api/contentQuickGenerate/anon-cap.test.js
// Covers the anonymous daily image cap on /api/content-quick-generate.
//
// Why this matters: the endpoint generates PAID images (~$0.07/call) and
// 'pixelpusher' ships inside public Blindspot JS, so it is reachable by anyone.
// Before the cap it was unbounded — the pre-existing 5-image guard only applies
// under DEMO_MODE, which is off in production.
const assert = require('assert');
const h = require('./index');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('_utcDay');

t('formats as YYYY-MM-DD', function () {
  assert.strictEqual(h._utcDay(Date.parse('2026-08-05T13:45:00Z')), '2026-08-05');
});

t('uses UTC, not local time', function () {
  // 23:30Z is still the 5th in UTC even where local time has rolled over.
  assert.strictEqual(h._utcDay(Date.parse('2026-08-05T23:30:00Z')), '2026-08-05');
  assert.strictEqual(h._utcDay(Date.parse('2026-08-06T00:30:00Z')), '2026-08-06');
});

console.log('\n_anonCountToday');

t('returns the count when the day matches', function () {
  assert.strictEqual(h._anonCountToday({ date: '2026-08-05', count: 7 }, '2026-08-05'), 7);
});

t('resets to 0 on a new day', function () {
  assert.strictEqual(h._anonCountToday({ date: '2026-08-04', count: 25 }, '2026-08-05'), 0);
});

t('absent / malformed state resolves 0, never throws', function () {
  assert.strictEqual(h._anonCountToday(null, '2026-08-05'), 0);
  assert.strictEqual(h._anonCountToday(undefined, '2026-08-05'), 0);
  assert.strictEqual(h._anonCountToday(42, '2026-08-05'), 0);
  assert.strictEqual(h._anonCountToday('nope', '2026-08-05'), 0);
  assert.strictEqual(h._anonCountToday({}, '2026-08-05'), 0);
});

t('garbage counts resolve 0 rather than NaN', function () {
  assert.strictEqual(h._anonCountToday({ date: '2026-08-05', count: 'lots' }, '2026-08-05'), 0);
  assert.strictEqual(h._anonCountToday({ date: '2026-08-05', count: -5 }, '2026-08-05'), 0);
});

console.log('\ncap behaviour (simulated)');

t('cap is 25', function () {
  assert.strictEqual(h.ANON_DAILY_IMAGE_CAP, 25);
});

t('blocks only at or above the cap', function () {
  const day = '2026-08-05';
  const blocked = (n) => h._anonCountToday({ date: day, count: n }, day) >= h.ANON_DAILY_IMAGE_CAP;
  assert.strictEqual(blocked(24), false, '24 must still be allowed');
  assert.strictEqual(blocked(25), true, '25 must block');
  assert.strictEqual(blocked(99), true);
});

t('a blocked day does not carry into the next day', function () {
  const exhausted = { date: '2026-08-05', count: 25 };
  assert.ok(h._anonCountToday(exhausted, '2026-08-06') < h.ANON_DAILY_IMAGE_CAP,
    'the cap must lift at the UTC day boundary');
});

t('multi-image calls accumulate, not just single increments', function () {
  // successCount can be >1 (variations x outputs); the counter adds the batch.
  const day = '2026-08-05';
  let state = null;
  const bump = (n) => { state = { date: day, count: h._anonCountToday(state, day) + n }; };
  bump(4); bump(4); bump(4);
  assert.strictEqual(state.count, 12);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
