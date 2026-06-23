// Run with: node api/actionsArchiver/actionsArchiver.test.js
// Tests the pure planner + the archive-then-trim run logic (with in-memory mocks).
const assert = require('assert');
const { runArchiver, planArchiveAndTrim, _isTerminalAction } = require('./index');

const NOW = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23T12:00:00Z
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const _asyncTests = [];
function testAsync(name, fn) {
  _asyncTests.push(function () {
    return fn().then(function () { pass++; console.log('  PASS ', name); })
      .catch(function (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); });
  });
}

// Action factories
const terminalSuccess = (id, age) => ({ id, approval: { status: 'approved' }, execution: { status: 'success', finished_at: daysAgo(age) } });
const rejected = (id, age) => ({ id, approval: { status: 'rejected' }, created_at: daysAgo(age) });
const cancelled = (id, age) => ({ id, approval: { status: 'cancelled' }, created_at: daysAgo(age) });
const stuckApproved = (id, age) => ({ id, approval: { status: 'approved' }, execution: { status: 'pending' }, created_at: daysAgo(age) }); // approved-but-never-posted
const pendingOld = (id, age) => ({ id, approval: { status: 'pending' }, created_at: daysAgo(age) });

// ── _isTerminalAction ──
test('_isTerminalAction: posted success is terminal', () => assert.ok(_isTerminalAction(terminalSuccess('a', 1))));
test('_isTerminalAction: rejected is terminal', () => assert.ok(_isTerminalAction(rejected('a', 1))));
test('_isTerminalAction: cancelled is terminal', () => assert.ok(_isTerminalAction(cancelled('a', 1))));
test('_isTerminalAction: approved-but-never-posted is NOT terminal', () => assert.ok(!_isTerminalAction(stuckApproved('a', 1))));
test('_isTerminalAction: pending is NOT terminal', () => assert.ok(!_isTerminalAction(pendingOld('a', 1))));
test('_isTerminalAction: running is NOT terminal', () => assert.ok(!_isTerminalAction({ approval: { status: 'approved' }, execution: { status: 'running' } })));

// ── planArchiveAndTrim ──
test('plan: old terminal → archive + trim', () => {
  const p = planArchiveAndTrim([terminalSuccess('A', 10)], NOW, 7);
  assert.deepStrictEqual(p.toArchive.map(x => x.id), ['A']);
  assert.deepStrictEqual(p.toTrimIds, ['A']);
});
test('plan: old non-terminal (stuck approved) → archive but NOT trim', () => {
  const p = planArchiveAndTrim([stuckApproved('C', 10)], NOW, 7);
  assert.deepStrictEqual(p.toArchive.map(x => x.id), ['C']);
  assert.deepStrictEqual(p.toTrimIds, []);
});
test('plan: recent terminal → neither archived nor trimmed', () => {
  const p = planArchiveAndTrim([terminalSuccess('D', 2)], NOW, 7);
  assert.deepStrictEqual(p.toArchive, []);
  assert.deepStrictEqual(p.toTrimIds, []);
});
test('plan: undated entry is kept (never archived/trimmed)', () => {
  const p = planArchiveAndTrim([{ id: 'Z', approval: { status: 'rejected' } }], NOW, 7);
  assert.deepStrictEqual(p.toArchive, []);
  assert.deepStrictEqual(p.toTrimIds, []);
});

// ── runArchiver (mocked storage + archive) ──
function mockStorage(initial) {
  const s = Object.assign({}, initial);
  return { getState: async (k) => s[k], setState: async (k, v) => { s[k] = v; }, _state: s };
}
function mockArchive() {
  const parts = {};
  return {
    readArchive: async (key) => ({ entries: parts[key] || [], total: (parts[key] || []).length }),
    appendArchive: async (key, entries) => { parts[key] = (parts[key] || []).concat(entries); return parts[key].length; },
    _parts: parts
  };
}

testAsync('runArchiver: archives all old, trims only terminal-old, keeps in-flight + recent', async () => {
  const actions = [
    terminalSuccess('A', 10), // archive + trim
    rejected('B', 10),        // archive + trim
    stuckApproved('C', 10),   // archive, KEEP (non-terminal)
    terminalSuccess('D', 2),  // recent → keep, not archived
    pendingOld('E', 10)       // archive, KEEP (non-terminal)
  ];
  const store = mockStorage({ actions: actions.slice(), governanceLog: [] });
  const arch = mockArchive();
  const res = await runArchiver({ storage: store, archive: arch, nowMs: NOW, ageDays: 7, log: function () {} });

  assert.strictEqual(res.archived, 4, 'A,B,C,E archived (D is recent)');
  assert.strictEqual(res.trimmed, 2, 'only A,B trimmed');
  const liveIds = store._state.actions.map(a => a.id).sort();
  assert.deepStrictEqual(liveIds, ['C', 'D', 'E'], 'in-flight (C,E) + recent (D) remain live');
  assert.strictEqual(store._state.governanceLog.length, 1, 'one archive-run summary logged');
});

testAsync('runArchiver: does NOT trim when archive write fails (cold copy not guaranteed)', async () => {
  const store = mockStorage({ actions: [terminalSuccess('A', 10)], governanceLog: [] });
  const arch = {
    readArchive: async () => ({ entries: [], total: 0 }),
    appendArchive: async () => { throw new Error('blob down'); }
  };
  const res = await runArchiver({ storage: store, archive: arch, nowMs: NOW, ageDays: 7, log: function () {} });
  assert.strictEqual(res.trimmed, 0, 'no trim when archive failed');
  assert.strictEqual(store._state.actions.length, 1, 'live action retained');
});

// Run async tests sequentially, then report.
(async () => {
  for (const t of _asyncTests) { await t(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();
