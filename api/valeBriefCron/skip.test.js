// Run with: node api/valeBriefCron/skip.test.js
const assert = require('assert');
const { skipDiscordMorning } = require('./index');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const ON = { VALE_STRICT_AUTH: '1', VALE_MAIL_ENABLED: '1' };
const DELIVERED = { lastSent: { date: '2026-10-20', at: '2026-10-20T13:30:00Z' } };

test('mail on + delivered once → skip the morning Discord brief', () => assert.strictEqual(skipDiscordMorning('morning', ON, DELIVERED), true));
test('the evening wrap is never skipped', () => assert.strictEqual(skipDiscordMorning('evening', ON, DELIVERED), false));
test('mail on but never delivered → keep Discord', () => assert.strictEqual(skipDiscordMorning('morning', ON, { days: {} }), false));
test('mail off → keep Discord', () => assert.strictEqual(skipDiscordMorning('morning', { VALE_STRICT_AUTH: '1' }, DELIVERED), false));
test('no log → keep Discord', () => assert.strictEqual(skipDiscordMorning('morning', ON, null), false));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
