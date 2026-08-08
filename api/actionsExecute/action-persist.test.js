// Run with: node api/actionsExecute/action-persist.test.js
//
// The 2026-08-08 duplicate-post incident: actionsExecute read the whole
// actions array, held it across a 15-60s public platform call, then wrote the
// stale snapshot back. Any concurrent writer (a heartbeat cycle writes this
// same array) made one side clobber the other — which is how a successful
// post's receipt vanished and the action stranded at 'running'. These tests
// pin the fix: execution state is synced surgically onto the FRESH stored
// copy under mutateState, so a success receipt survives every interleaving.
const assert = require('assert');
const { syncExecutionState, trimActions } = require('./action-persist');

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }

// Minimal storage stub honoring the mutateState contract: mutator(current) →
// undefined = no write; array = stored. `interleave` lets a test simulate a
// concurrent writer changing state before the mutator reads it.
function makeStorage(initialActions) {
  const store = { actions: initialActions };
  return {
    store,
    async mutateState(key, mutator) {
      const next = await mutator(store[key]);
      if (next === undefined) return { ok: true, written: false, value: store[key] };
      store[key] = next;
      return { ok: true, written: true, value: next };
    }
  };
}

t('execution fields land on the fresh copy; fields owned by others survive', async () => {
  // Dashboard changed decision_note AFTER our snapshot was taken — the sync
  // must not resurrect our stale view of anything but execution/telemetry.
  const storage = makeStorage([
    { id: 'a1', approval: { status: 'approved', decision_note: 'set-by-dashboard-meanwhile' }, execution: { status: 'running' } }
  ]);
  const local = { id: 'a1', approval: { status: 'approved', decision_note: null },
    execution: { status: 'success', receipt: { post_id: '123' } }, execution_status: 'success', telemetry: { attempt: 1 } };
  const r = await syncExecutionState(storage, local);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.applied, true);
  const stored = storage.store.actions[0];
  assert.strictEqual(stored.execution.status, 'success');
  assert.strictEqual(stored.execution.receipt.post_id, '123');
  assert.strictEqual(stored.execution_status, 'success');
  assert.strictEqual(stored.approval.decision_note, 'set-by-dashboard-meanwhile', 'stale snapshot must not clobber fields it does not own');
});

t('an action added by a concurrent writer survives the sync', async () => {
  // THE incident shape: heartbeat appended a2 while our post was in flight.
  // The old whole-array write erased it; the surgical sync must keep it.
  const storage = makeStorage([
    { id: 'a1', execution: { status: 'running' } },
    { id: 'a2-added-by-heartbeat', execution: { status: 'pending' } }
  ]);
  const local = { id: 'a1', execution: { status: 'success', receipt: {} }, execution_status: 'success' };
  const r = await syncExecutionState(storage, local);
  assert.strictEqual(r.applied, true);
  assert.strictEqual(storage.store.actions.length, 2, 'concurrent writer\'s action was clobbered');
  assert.ok(storage.store.actions.some(a => a.id === 'a2-added-by-heartbeat'));
});

t('a vanished action id writes nothing and reports applied:false', async () => {
  const storage = makeStorage([{ id: 'other' }]);
  const r = await syncExecutionState(storage, { id: 'gone', execution: { status: 'success' } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.applied, false);
  assert.strictEqual(storage.store.actions.length, 1);
});

t('storage failure resolves to ok:false, never throws at the caller', async () => {
  const storage = { async mutateState() { throw new Error('etag conflict exhausted'); } };
  const r = await syncExecutionState(storage, { id: 'a1', execution: { status: 'success' } });
  assert.strictEqual(r.ok, false);
  assert.ok(/etag/.test(r.error));
});

t('trimActions drops old finished entries, keeps recent and unparseable ones', () => {
  const now = Date.parse('2026-08-08T00:00:00Z');
  const old = new Date(now - 91 * 24 * 3600 * 1000).toISOString();
  const recent = new Date(now - 5 * 24 * 3600 * 1000).toISOString();
  const arr = [
    { id: 'old', execution: { finished_at: old } },
    { id: 'recent', execution: { finished_at: recent } },
    { id: 'no-ts' }
  ];
  const out = trimActions(arr, now);
  assert.deepStrictEqual(out.map(a => a.id), ['recent', 'no-ts']);
});

t('trimActions caps runaway arrays at the max count', () => {
  const arr = [];
  for (let i = 0; i < 2100; i++) arr.push({ id: 'a' + i });
  const out = trimActions(arr, Date.now());
  assert.strictEqual(out.length, 2000);
  assert.strictEqual(out[out.length - 1].id, 'a2099', 'must keep the newest tail');
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\naction-persist tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
