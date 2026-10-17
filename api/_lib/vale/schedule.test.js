// Run with: node api/_lib/vale/schedule.test.js
const assert = require('assert');
const { pacificParts, shouldSendBrief } = require('./schedule');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const t = (iso) => Date.parse(iso);

(async () => {
  await test('summer: 13:30 UTC is 06:30 PDT and sends', () => {
    assert.deepStrictEqual(pacificParts(t('2026-07-15T13:30:00Z')).minutes, 6 * 60 + 30);
    assert.strictEqual(shouldSendBrief(t('2026-07-15T13:30:00Z'), null).send, true);
  });
  await test('winter: 13:30 UTC is 05:30 PST — too early', () => assert.strictEqual(shouldSendBrief(t('2026-01-15T13:30:00Z'), null).reason, 'outside_window'));
  await test('winter: 14:30 UTC is 06:30 PST and sends', () => assert.strictEqual(shouldSendBrief(t('2026-01-15T14:30:00Z'), null).send, true));
  await test('09:00 Pacific is outside the window', () => assert.strictEqual(shouldSendBrief(t('2026-01-15T17:00:00Z'), null).reason, 'outside_window'));
  await test('catch-up: 07:30 PDT still sends when today has not gone', () => assert.strictEqual(shouldSendBrief(t('2026-07-15T14:30:00Z'), { days: { '2026-07-14': { status: 'sent' } } }).send, true));
  await test('already sent today does not send again', () => assert.strictEqual(shouldSendBrief(t('2026-07-15T14:30:00Z'), { days: { '2026-07-15': { status: 'sent', at: '2026-07-15T13:31:00Z' } } }).reason, 'already_sent'));
  await test('a fresh sending marker blocks a duplicate', () => assert.strictEqual(shouldSendBrief(t('2026-07-15T13:50:00Z'), { days: { '2026-07-15': { status: 'sending', at: '2026-07-15T13:30:00Z' } } }).reason, 'in_flight'));
  await test('a stale sending marker (45 min) is retried', () => assert.strictEqual(shouldSendBrief(t('2026-07-15T14:30:00Z'), { days: { '2026-07-15': { status: 'sending', at: '2026-07-15T13:45:00Z' } } }).send, true));
  await test('a failed day is retried', () => assert.strictEqual(shouldSendBrief(t('2026-07-15T14:30:00Z'), { days: { '2026-07-15': { status: 'failed', at: '2026-07-15T13:31:00Z' } } }).send, true));
  await test('spring-forward day (2026-03-08): 14:30 UTC is 07:30 PDT and sends', () => {
    const r = shouldSendBrief(t('2026-03-08T14:30:00Z'), null);
    assert.strictEqual(r.send, true); assert.strictEqual(r.date, '2026-03-08');
  });
  await test('fall-back day (2026-11-01): 14:30 UTC is 06:30 PST and sends', () => {
    assert.strictEqual(pacificParts(t('2026-11-01T14:30:00Z')).minutes, 6 * 60 + 30);
    assert.strictEqual(shouldSendBrief(t('2026-11-01T14:30:00Z'), null).send, true);
  });
  await test('the date is the Pacific date, not the UTC date', () => assert.strictEqual(pacificParts(t('2026-07-16T03:00:00Z')).date, '2026-07-15'));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
