// Run with: node api/actionsArchiver/actionsArchiver.test.js
// Tests the pure planner + the archive-then-trim run logic (with in-memory mocks).
const assert = require('assert');
const { runArchiver, planArchiveAndTrim, _isTerminalAction, buildAttributionEntries, mergeAttributionIndex, ATTR_INDEX_KEY } = require('./index');

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

// ── buildAttributionEntries (attribution-decay fix) ──
test('attrEntries: action with agent + parent-task campaign → indexed', () => {
  const acts = [{ id: 'act1', created_by: 'echo', _parentTaskId: 't1' }];
  const taskById = { t1: { id: 't1', campaign_id: 'camp-A' } };
  const out = buildAttributionEntries(acts, taskById, NOW);
  assert.deepStrictEqual(out.act1, { agent: 'echo', campaignId: 'camp-A', at: NOW });
});
test('attrEntries: direct campaign_id on action wins without a task', () => {
  const out = buildAttributionEntries([{ id: 'act2', createdBy: 'scout', campaign_id: 'camp-B' }], {}, NOW);
  assert.deepStrictEqual(out.act2, { agent: 'scout', campaignId: 'camp-B', at: NOW });
});
test('attrEntries: agent-only action indexed with null campaign', () => {
  const out = buildAttributionEntries([{ id: 'act3', created_by: 'nova' }], {}, NOW);
  assert.deepStrictEqual(out.act3, { agent: 'nova', campaignId: null, at: NOW });
});
test('attrEntries: action with neither agent nor campaign is skipped', () => {
  const out = buildAttributionEntries([{ id: 'act4' }], {}, NOW);
  assert.deepStrictEqual(out, {});
});
test('attrEntries: id-less action skipped, no crash', () => {
  const out = buildAttributionEntries([{ created_by: 'echo' }, null], {}, NOW);
  assert.deepStrictEqual(out, {});
});

// ── mergeAttributionIndex ──
test('merge: new entries added to empty index', () => {
  const merged = mergeAttributionIndex(null, { a: { agent: 'echo', campaignId: 'c1', at: 1 } }, 5000, 'ISO');
  assert.deepStrictEqual(merged.map, { a: { agent: 'echo', campaignId: 'c1', at: 1 } });
  assert.strictEqual(merged.count, 1);
});
test('merge: existing entry wins on conflict but backfills missing fields', () => {
  const existing = { map: { a: { agent: 'echo', campaignId: null, at: 1 } } };
  const merged = mergeAttributionIndex(existing, { a: { agent: 'scout', campaignId: 'c9', at: 2 } }, 5000, 'ISO');
  // agent stays echo (existing wins); campaignId backfilled from addition; at stays 1
  assert.deepStrictEqual(merged.map.a, { agent: 'echo', campaignId: 'c9', at: 1 });
});
test('merge: cap keeps newest by at', () => {
  const existing = { map: { old: { agent: 'a', campaignId: null, at: 10 }, mid: { agent: 'b', campaignId: null, at: 20 } } };
  const merged = mergeAttributionIndex(existing, { neo: { agent: 'c', campaignId: null, at: 30 } }, 2, 'ISO');
  assert.strictEqual(merged.count, 2);
  assert.ok(merged.map.neo && merged.map.mid, 'newest two kept');
  assert.ok(!merged.map.old, 'oldest dropped');
});

// ── runArchiver writes the attribution index ──
testAsync('runArchiver: archived actions with agents get an attribution index entry', async () => {
  const actions = [
    { id: 'A', created_by: 'echo', _parentTaskId: 't1', approval: { status: 'approved' }, execution: { status: 'success', finished_at: daysAgo(10) } },
    { id: 'B', created_by: 'scout', approval: { status: 'rejected' }, created_at: daysAgo(10) },
    { id: 'C', approval: { status: 'approved' }, execution: { status: 'success', finished_at: daysAgo(10) } } // no agent/campaign → not indexed
  ];
  const store = mockStorage({ actions: actions.slice(), governanceLog: [], tasks: [{ id: 't1', campaign_id: 'camp-A' }] });
  const res = await runArchiver({ storage: store, archive: mockArchive(), nowMs: NOW, ageDays: 7, log: function () {} });
  assert.strictEqual(res.attrIndexed, 2, 'A and B indexed; C skipped (no agent/campaign)');
  const idx = store._state[ATTR_INDEX_KEY];
  assert.ok(idx && idx.map, 'index blob written');
  assert.deepStrictEqual(idx.map.A, { agent: 'echo', campaignId: 'camp-A', at: NOW });
  assert.deepStrictEqual(idx.map.B, { agent: 'scout', campaignId: null, at: NOW });
  assert.ok(!idx.map.C, 'C not indexed');
});
testAsync('runArchiver: attribution index NOT written when archive fails', async () => {
  const store = mockStorage({ actions: [{ id: 'A', created_by: 'echo', approval: { status: 'approved' }, execution: { status: 'success', finished_at: daysAgo(10) } }], governanceLog: [], tasks: [] });
  const arch = { readArchive: async () => ({ entries: [], total: 0 }), appendArchive: async () => { throw new Error('blob down'); } };
  const res = await runArchiver({ storage: store, archive: arch, nowMs: NOW, ageDays: 7, log: function () {} });
  assert.strictEqual(res.attrIndexed, 0, 'no indexing when archive failed');
  assert.ok(!store._state[ATTR_INDEX_KEY], 'index blob not written');
});

// Run async tests sequentially, then report.
(async () => {
  for (const t of _asyncTests) { await t(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();
