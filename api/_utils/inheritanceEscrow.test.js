// Run with: node api/_utils/inheritanceEscrow.test.js
const assert = require('assert');
const e = require('./inheritanceEscrow');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
}

const CAPTURED = '2026-10-01T12:00:00.000Z';
const REG = { id: 'pixel', name: 'Pixel', role: 'Design — Director' };
const MEMS = [
  { text: 'Hero images under 200KB load before the fold', type: 'learning', timestamp: '2026-09-01T00:00:00Z' },
  { text: 'Prospect replies convert worse with media attached', type: 'learning', timestamp: '2026-09-02T00:00:00Z' }
];
const REPORTS = [{ id: 'wr_1', date: '2026-09-07', text: 'Shipped 3 hero images.' }];

function mkInput(over) {
  return Object.assign({
    agentId: 'pixel', registryEntry: REG, memories: MEMS, reports: REPORTS,
    retiredAt: '2026-10-01T11:59:00.000Z', retiredReason: 'Three seasons below par.',
    capturedAt: CAPTURED
  }, over || {});
}

test('buildEscrow produces a self-describing snapshot with correct counts', () => {
  const esc = e.buildEscrow(mkInput());
  assert.strictEqual(esc.agentId, 'pixel');
  assert.strictEqual(esc.name, 'Pixel');
  assert.strictEqual(esc.role, 'Design — Director');
  assert.strictEqual(esc.status, 'raw', 'Phase 2 owns every other status');
  assert.strictEqual(esc.memoryCount, 2);
  assert.strictEqual(esc.reportCount, 1);
  assert.strictEqual(esc.raw.memories.length, 2);
  assert.strictEqual(esc.raw.reports.length, 1);
  assert.strictEqual(esc.capturedAt, CAPTURED);
  assert.strictEqual(esc.retiredReason, 'Three seasons below par.');
});

test('an agent with nothing recorded still gets an escrow, not a missing one', () => {
  // The record must show the agent genuinely had nothing, rather than looking
  // like the capture failed.
  const esc = e.buildEscrow(mkInput({ memories: undefined, reports: null }));
  assert.strictEqual(esc.memoryCount, 0);
  assert.strictEqual(esc.reportCount, 0);
  assert.deepStrictEqual(esc.raw.memories, []);
  assert.deepStrictEqual(esc.raw.reports, []);
});

test('buildEscrow deep-copies, so the live agentMemories bucket is never aliased', () => {
  const source = [{ text: 'original', type: 'learning' }];
  const esc = e.buildEscrow(mkInput({ memories: source }));
  esc.raw.memories[0].text = 'mutated';
  assert.strictEqual(source[0].text, 'original', 'source memory must be untouched');
});

test('buildEscrow tolerates garbage input without throwing', () => {
  // The call site is non-fatal, but it must not be the thing that throws.
  const esc = e.buildEscrow(null);
  assert.strictEqual(esc.agentId, '');
  assert.strictEqual(esc.memoryCount, 0);
  assert.strictEqual(esc.status, 'raw');
});

test('captureEscrow inserts a new escrow and stamps updatedAt', () => {
  const esc = e.buildEscrow(mkInput());
  const r = e.captureEscrow({}, esc, CAPTURED);
  assert.strictEqual(r.added, true);
  assert.strictEqual(r.store.escrows.pixel.agentId, 'pixel');
  assert.strictEqual(r.store.updatedAt, CAPTURED);
});

test('captureEscrow is idempotent — an existing escrow always wins', () => {
  // Re-approving a retirement must not overwrite a frozen snapshot with a
  // consolidation-degraded one.
  const first = e.buildEscrow(mkInput());
  const r1 = e.captureEscrow({}, first, CAPTURED);
  const degraded = e.buildEscrow(mkInput({ memories: [] }));
  const r2 = e.captureEscrow(r1.store, degraded, '2026-11-01T00:00:00.000Z');
  assert.strictEqual(r2.added, false);
  assert.strictEqual(r2.store.escrows.pixel.memoryCount, 2, 'original snapshot preserved');
});

test('captureEscrow does not mutate the store it is given', () => {
  const store = { escrows: {}, updatedAt: null };
  e.captureEscrow(store, e.buildEscrow(mkInput()), CAPTURED);
  assert.deepStrictEqual(store.escrows, {}, 'input store must be untouched');
});

test('captureEscrow refuses an escrow with no agentId', () => {
  const r = e.captureEscrow({}, { agentId: '' }, CAPTURED);
  assert.strictEqual(r.added, false);
  assert.deepStrictEqual(r.store.escrows, {});
});

test('captureEscrow preserves escrows for other agents', () => {
  const r1 = e.captureEscrow({}, e.buildEscrow(mkInput()), CAPTURED);
  const other = e.buildEscrow(mkInput({ agentId: 'forge', registryEntry: { name: 'Forge', role: 'Ops' } }));
  const r2 = e.captureEscrow(r1.store, other, CAPTURED);
  assert.strictEqual(r2.added, true);
  assert.strictEqual(Object.keys(r2.store.escrows).sort().join(','), 'forge,pixel');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
