// Run with: node api/contentQuickGenerate/anon-cap.test.js
// Covers the daily image caps on /api/content-quick-generate.
//
// Why this matters: the endpoint generates PAID images (~$0.07/call) and is
// deliberately reachable without a credential, so quota is the ONLY thing
// bounding spend. The pre-existing 5-image guard applies only under DEMO_MODE,
// which is off in production.
const assert = require('assert');
const h = require('./index');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message.split('\n')[0]); }
}

console.log('_utcDay');

t('formats as YYYY-MM-DD', function () {
  assert.strictEqual(h._utcDay(Date.parse('2026-08-05T13:45:00Z')), '2026-08-05');
});

t('uses UTC, not local time', function () {
  assert.strictEqual(h._utcDay(Date.parse('2026-08-05T23:30:00Z')), '2026-08-05');
  assert.strictEqual(h._utcDay(Date.parse('2026-08-06T00:30:00Z')), '2026-08-06');
});

console.log('\n_countToday');

t('returns the count when the day matches', function () {
  assert.strictEqual(h._countToday({ date: '2026-08-05', anon: 7 }, '2026-08-05', 'anon'), 7);
});

t('buckets are independent', function () {
  const e = { date: '2026-08-05', anon: 7, auth: 150 };
  assert.strictEqual(h._countToday(e, '2026-08-05', 'anon'), 7);
  assert.strictEqual(h._countToday(e, '2026-08-05', 'auth'), 150);
});

t('resets to 0 on a new day', function () {
  assert.strictEqual(h._countToday({ date: '2026-08-04', anon: 25 }, '2026-08-05', 'anon'), 0);
});

t('absent / malformed state resolves 0, never throws', function () {
  for (const bad of [null, undefined, 42, 'nope', {}]) {
    assert.strictEqual(h._countToday(bad, '2026-08-05', 'anon'), 0);
  }
});

t('missing bucket resolves 0, not NaN', function () {
  assert.strictEqual(h._countToday({ date: '2026-08-05', anon: 5 }, '2026-08-05', 'auth'), 0);
});

t('garbage counts resolve 0 rather than NaN', function () {
  assert.strictEqual(h._countToday({ date: '2026-08-05', anon: 'lots' }, '2026-08-05', 'anon'), 0);
  assert.strictEqual(h._countToday({ date: '2026-08-05', anon: -5 }, '2026-08-05', 'anon'), 0);
});

console.log('\ncap behaviour');

t('caps are 25 anon / 200 auth', function () {
  assert.strictEqual(h.ANON_DAILY_IMAGE_CAP, 25);
  assert.strictEqual(h.AUTH_DAILY_IMAGE_CAP, 200);
});

// Mirrors the handler: bucket + threshold chosen by whether a principal is present.
function blocked(entry, day, isAnon) {
  const bucket = isAnon ? 'anon' : 'auth';
  const cap = isAnon ? h.ANON_DAILY_IMAGE_CAP : h.AUTH_DAILY_IMAGE_CAP;
  return h._countToday(entry, day, bucket) >= cap;
}

t('anonymous blocks only at or above 25', function () {
  const d = '2026-08-05';
  assert.strictEqual(blocked({ date: d, anon: 24 }, d, true), false, '24 must be allowed');
  assert.strictEqual(blocked({ date: d, anon: 25 }, d, true), true, '25 must block');
  assert.strictEqual(blocked({ date: d, anon: 99 }, d, true), true);
});

t('FORGED principal raises the ceiling but never removes it', function () {
  // x-ms-client-principal is unverified and forgeable. An attacker who forges it
  // moves into the auth bucket -- which must still be bounded, or the cap is
  // trivially bypassed and spend is unbounded again.
  const d = '2026-08-05';
  assert.strictEqual(blocked({ date: d, auth: 199 }, d, false), false, '199 allowed');
  assert.strictEqual(blocked({ date: d, auth: 200 }, d, false), true, '200 MUST block');
  assert.strictEqual(blocked({ date: d, auth: 5000 }, d, false), true, 'never unlimited');
});

t('exhausting one bucket does not block the other', function () {
  const d = '2026-08-05';
  const e = { date: d, anon: 25, auth: 0 };
  assert.strictEqual(blocked(e, d, true), true, 'anon exhausted');
  assert.strictEqual(blocked(e, d, false), false, 'auth still fine');
});

t('a blocked day does not carry into the next day', function () {
  const exhausted = { date: '2026-08-05', anon: 25, auth: 200 };
  assert.ok(!blocked(exhausted, '2026-08-06', true), 'anon cap must lift at UTC midnight');
  assert.ok(!blocked(exhausted, '2026-08-06', false), 'auth cap must lift at UTC midnight');
});

t('multi-image calls accumulate into the right bucket only', function () {
  // successCount can be >1 (variations x outputs); the counter adds the batch.
  const day = '2026-08-05';
  let state = null;
  const bump = (n, isAnon) => {
    state = {
      date: day,
      anon: h._countToday(state, day, 'anon') + (isAnon ? n : 0),
      auth: h._countToday(state, day, 'auth') + (isAnon ? 0 : n),
    };
  };
  bump(4, true); bump(4, true); bump(4, false);
  assert.strictEqual(state.anon, 8);
  assert.strictEqual(state.auth, 4);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
