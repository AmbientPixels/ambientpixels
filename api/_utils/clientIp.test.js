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

t('falls back to x-real-ip / x-client-ip / client-ip for local dev', function () {
  assert.strictEqual(getClientIp({ headers: { 'x-real-ip': '10.0.0.4' } }), '10.0.0.4');
  // x-client-ip was as-analyze's fallback before it moved onto this helper.
  assert.strictEqual(getClientIp({ headers: { 'x-client-ip': '10.0.0.6' } }), '10.0.0.6');
  assert.strictEqual(getClientIp({ headers: { 'client-ip': '10.0.0.5:993' } }), '10.0.0.5');
});

t('never returns empty — an empty bucket key would pool every caller together', function () {
  assert.strictEqual(getClientIp({ headers: {} }), 'unknown');
  assert.strictEqual(getClientIp({}), 'unknown');
  assert.strictEqual(getClientIp({ headers: { 'x-forwarded-for': '   ,  ' } }), 'unknown');
});

console.log('\nno endpoint may read the header directly');

t('clientIp.js is the only place that touches x-forwarded-for', function () {
  // Structural, because the bug is not a wrong value — it is the wrong SOURCE,
  // and every wrong version looked reasonable in review. Nine endpoints
  // independently wrote `split(',')[0]` and all nine were wrong the same way.
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const offenders = [];

  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      // Any test file: harnesses legitimately SET this header on mock requests.
      // Matches smoke-test.js too, which the narrower `.test.js` check missed.
      if (/test/i.test(entry.name)) continue;
      if (full === path.join(root, '_utils', 'clientIp.js')) continue;

      const code = fs.readFileSync(full, 'utf8')
        .split(/\r?\n/)
        .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      if (code.indexOf('x-forwarded-for') !== -1) {
        offenders.push(path.relative(root, full));
      }
    }
  })(root);

  assert.deepStrictEqual(offenders, [],
    'these read x-forwarded-for directly instead of using getClientIp: ' + offenders.join(', '));
});

console.log('\nclientIp tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
