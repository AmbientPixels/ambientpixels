// Run with: node api/_utils/clientIp.test.js
//
// The bug being guarded: `x-forwarded-for.split(',')[0]` on Azure App Service
// includes the client's ephemeral port, so every request became its own
// rate-limit bucket and no anonymous cap ever bound. Measured in production —
// 13 consecutive free runs, 13 buckets, each holding 1, while the API reported
// "4 of 5 free runs left" every time.

const assert = require('assert');
const { getClientIp, stripPort } = require('./clientIp');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

console.log('stripPort');

t('strips an IPv4 port, which is the whole bug', function () {
  assert.strictEqual(stripPort('203.0.113.5:54321'), '203.0.113.5');
});

t('leaves a bare IPv4 alone', function () {
  assert.strictEqual(stripPort('203.0.113.5'), '203.0.113.5');
});

t('keeps bare IPv6 intact — a naive split(":")[0] would bucket everyone as "2001"', function () {
  assert.strictEqual(stripPort('2001:db8::1'), '2001:db8::1');
  assert.strictEqual(stripPort('::1'), '::1');
  // Collapsing distinct IPv6 visitors into one bucket is worse than the
  // original bug: it locks strangers out of each other's free runs.
  assert.notStrictEqual(stripPort('2001:db8::1'), stripPort('2001:db8::2'));
});

t('unwraps bracketed IPv6, with and without a port', function () {
  assert.strictEqual(stripPort('[2001:db8::1]:443'), '2001:db8::1');
  assert.strictEqual(stripPort('[::1]'), '::1');
});

t('handles empty and junk without throwing', function () {
  for (const bad of [null, undefined, '', '   ']) assert.strictEqual(stripPort(bad), '');
});

console.log('\ngetClientIp');

t('the same client on a new connection lands in the SAME bucket', function () {
  // Two requests, two ephemeral ports. This is exactly what production did 13
  // times in a row, each time minting a fresh allowance.
  const a = getClientIp({ headers: { 'x-forwarded-for': '203.0.113.5:41001' } });
  const b = getClientIp({ headers: { 'x-forwarded-for': '203.0.113.5:52774' } });
  assert.strictEqual(a, b, 'same client hashed to two buckets: ' + a + ' vs ' + b);
  assert.strictEqual(a, '203.0.113.5');
});

t('different clients still get different buckets', function () {
  assert.notStrictEqual(
    getClientIp({ headers: { 'x-forwarded-for': '203.0.113.5:41001' } }),
    getClientIp({ headers: { 'x-forwarded-for': '198.51.100.9:41001' } }));
});

t('x-azure-clientip wins, because the platform sets it and a caller cannot', function () {
  const ip = getClientIp({ headers: {
    'x-azure-clientip': '203.0.113.5',
    'x-forwarded-for': '9.9.9.9, 203.0.113.5:41001'
  }});
  assert.strictEqual(ip, '203.0.113.5');
});

t('a spoofed x-forwarded-for prefix cannot mint a fresh allowance', function () {
  // App Service APPENDS rather than replaces, so the first entry is whatever
  // the caller claimed. Reading it let anyone reset their own limit by varying
  // a header — verified against production by sending a fixed value and
  // watching a previously unbindable cap suddenly bind.
  const real = '203.0.113.5';
  const first = getClientIp({ headers: { 'x-forwarded-for': 'attacker-value-1, ' + real + ':41001' } });
  const second = getClientIp({ headers: { 'x-forwarded-for': 'attacker-value-2, ' + real + ':52774' } });
  assert.strictEqual(first, real);
  assert.strictEqual(second, real, 'varying the prefix produced a new bucket - the cap is still bypassable');
});

t('a single-entry x-forwarded-for still works', function () {
  assert.strictEqual(getClientIp({ headers: { 'x-forwarded-for': '203.0.113.5:41001' } }), '203.0.113.5');
});

t('falls back to x-real-ip / client-ip for local dev', function () {
  assert.strictEqual(getClientIp({ headers: { 'x-real-ip': '10.0.0.4' } }), '10.0.0.4');
  assert.strictEqual(getClientIp({ headers: { 'client-ip': '10.0.0.5:993' } }), '10.0.0.5');
});

t('never returns empty — an empty bucket key would pool every caller together', function () {
  assert.strictEqual(getClientIp({ headers: {} }), 'unknown');
  assert.strictEqual(getClientIp({}), 'unknown');
  assert.strictEqual(getClientIp({ headers: { 'x-forwarded-for': '   ,  ' } }), 'unknown');
});

console.log('\nclientIp tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
