// Run with: node api/_lib/stripe/revenueLedger.test.js
const assert = require('assert');
const RL = require('./revenueLedger');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// The two real entries that made the company believe it had customers.
const SELF = { id: 'evt_1', type: 'one_time', amountCents: 19900, customerEmail: 'thechadmartin@gmail.com' };
const REAL = { id: 'evt_2', type: 'one_time', amountCents: 2900, customerEmail: 'stranger@example.com' };
const LIST = ['thechadmartin@gmail.com'];

// ── isInternalEntry ──

test('a founder self-purchase is internal — derived from email, no migration needed', () => {
  // Derive-on-read is the whole point: the two historical entries get classified
  // correctly without ever mutating the financial record.
  assert.strictEqual(RL.isInternalEntry(SELF, LIST), true);
});

test('a real customer is not internal', () => {
  assert.strictEqual(RL.isInternalEntry(REAL, LIST), false);
});

test('email matching is case- and whitespace-insensitive', () => {
  assert.strictEqual(RL.isInternalEntry({ customerEmail: '  ThEChadMartin@Gmail.com ' }, LIST), true);
});

test('a stored internal flag wins even if the email is absent', () => {
  // Future entries are stamped at write time; the flag must survive email changes.
  assert.strictEqual(RL.isInternalEntry({ internal: true, customerEmail: null }, []), true);
});

test('an empty or missing list classifies nothing as internal', () => {
  // The honest failure mode: unconfigured means "we do not know", not "all internal".
  assert.strictEqual(RL.isInternalEntry(SELF, []), false);
  assert.strictEqual(RL.isInternalEntry(SELF, null), false);
});

test('garbage entries do not throw', () => {
  assert.strictEqual(RL.isInternalEntry(null, LIST), false);
  assert.strictEqual(RL.isInternalEntry({}, LIST), false);
  assert.strictEqual(RL.isInternalEntry({ customerEmail: 123 }, LIST), false);
});

// ── splitRevenue ──

test('splitRevenue separates external money from internal, keeping both', () => {
  // Internal revenue is never deleted — hiding it would repeat the original sin
  // in the opposite direction.
  const r = RL.splitRevenue([SELF, SELF, REAL], LIST);
  assert.strictEqual(r.external.length, 1);
  assert.strictEqual(r.internal.length, 2);
  assert.strictEqual(r.externalCents, 2900);
  assert.strictEqual(r.internalCents, 39800);
});

test('splitRevenue counts only positive types toward money', () => {
  const r = RL.splitRevenue([
    REAL,
    { id: 'r1', type: 'refund', amountCents: -2900, customerEmail: 'stranger@example.com' }
  ], LIST);
  assert.strictEqual(r.externalCents, 2900, 'refunds must not inflate or deflate the positive total');
  assert.strictEqual(r.external.length, 1, 'only positive-type entries count as sales');
});

test('splitRevenue on the live ledger shape reports $0 external, $398 internal', () => {
  // The actual state of the company on 2026-08-01.
  const r = RL.splitRevenue([
    { id: 'a', type: 'one_time', amountCents: 19900, customerEmail: 'thechadmartin@gmail.com' },
    { id: 'b', type: 'one_time', amountCents: 19900, customerEmail: 'thechadmartin@gmail.com' }
  ], LIST);
  assert.strictEqual(r.externalCents, 0);
  assert.strictEqual(r.internalCents, 39800);
  assert.strictEqual(r.external.length, 0, 'zero real customers');
});

test('splitRevenue is safe on empty and garbage input', () => {
  const r = RL.splitRevenue(null, LIST);
  assert.strictEqual(r.externalCents, 0);
  assert.strictEqual(r.internalCents, 0);
  assert.deepStrictEqual(r.external, []);
});

// ── resolveInternalEmails (pure part) ──

test('resolveInternalEmails prefers systemConfig, falls back to env', () => {
  assert.deepStrictEqual(
    RL.parseInternalEmails({ internalRevenueEmails: ['A@b.com', ' c@d.com '] }, ''),
    ['a@b.com', 'c@d.com']
  );
  assert.deepStrictEqual(RL.parseInternalEmails({}, 'x@y.com, z@w.com'), ['x@y.com', 'z@w.com']);
  assert.deepStrictEqual(RL.parseInternalEmails(null, ''), []);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
