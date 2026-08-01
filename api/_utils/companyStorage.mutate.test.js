// companyStorage.mutateState — optimistic-concurrency tests.
//
// The bug these guard against: blob writes were unconditional last-writer-wins, so
// two overlapping read-modify-write cycles on one key silently lost one of them.
// Seen twice on `approvalQueue` (2026-07-23 bluesky_reply drafts resurrected as
// pending; 2026-08-01 cprop_1785542400009_auto stranded pending after its campaign
// went live). The load-bearing test is "retries and preserves the competing write".

const test = require('node:test');
const assert = require('node:assert');
const storage = require('./companyStorage');

// Minimal in-memory stand-in for a blob container with real ETag semantics.
function makeFakeContainer(opts) {
  opts = opts || {};
  const store = new Map(); // blobName -> { content, etag }
  let seq = 0;
  return {
    store: store,
    async createIfNotExists() { return {}; },
    getBlockBlobClient(name) {
      return {
        async download() {
          if (opts.failRead) { const e = new Error('boom'); e.statusCode = 500; throw e; }
          const rec = store.get(name);
          if (!rec) { const e = new Error('BlobNotFound'); e.statusCode = 404; throw e; }
          const snapshot = { etag: rec.etag, readableStreamBody: [Buffer.from(rec.content)] };
          if (opts.onRead) opts.onRead(store, name, seq++);
          return snapshot;
        },
        async upload(content, _len, uploadOpts) {
          const rec = store.get(name);
          const cond = (uploadOpts && uploadOpts.conditions) || {};
          if (cond.ifMatch && (!rec || rec.etag !== cond.ifMatch)) {
            const e = new Error('ConditionNotMet'); e.statusCode = 412; throw e;
          }
          if (cond.ifNoneMatch === '*' && rec) {
            const e = new Error('BlobAlreadyExists'); e.statusCode = 409; throw e;
          }
          store.set(name, { content: content, etag: 'etag-' + (++seq) });
          return {};
        }
      };
    }
  };
}

function seed(container, key, value) {
  container.store.set(key + '.json', { content: JSON.stringify(value), etag: 'etag-0' });
}
function read(container, key) {
  return JSON.parse(container.store.get(key + '.json').content);
}

test('mutateState writes the mutator result', async () => {
  const c = makeFakeContainer();
  storage._setContainerClientForTests(c);
  seed(c, 'approvalQueue', [{ id: 'a', status: 'pending' }]);

  const res = await storage.mutateState('approvalQueue', function (cur) {
    cur.find(e => e.id === 'a').status = 'approved';
    return cur;
  });

  assert.strictEqual(res.written, true);
  assert.strictEqual(res.attempts, 1);
  assert.strictEqual(read(c, 'approvalQueue')[0].status, 'approved');
});

test('mutateState aborts without writing when the mutator returns undefined', async () => {
  const c = makeFakeContainer();
  storage._setContainerClientForTests(c);
  seed(c, 'approvalQueue', [{ id: 'a', status: 'pending' }]);
  const etagBefore = c.store.get('approvalQueue.json').etag;

  const res = await storage.mutateState('approvalQueue', function () { return undefined; });

  assert.strictEqual(res.written, false);
  assert.strictEqual(c.store.get('approvalQueue.json').etag, etagBefore, 'blob must be untouched');
});

test('mutateState retries on conflict and does NOT lose the competing write', async () => {
  // This is the exact incident shape: we read the queue, a concurrent writer lands a
  // wholesale write while we are busy, then we try to flip our entry. Before the fix
  // our write clobbered theirs (or theirs clobbered ours). Now our conditional write
  // gets a 412, we re-read, and BOTH changes survive.
  let firstRead = true;
  const c = makeFakeContainer({
    onRead(store, name) {
      if (!firstRead) return;
      firstRead = false;
      const cur = JSON.parse(store.get(name).content);
      cur.push({ id: 'competitor', status: 'pending' }); // heartbeat adds an entry
      store.set(name, { content: JSON.stringify(cur), etag: 'etag-competitor' });
    }
  });
  storage._setContainerClientForTests(c);
  seed(c, 'approvalQueue', [{ id: 'cprop_x', status: 'pending' }]);

  let mutatorRuns = 0;
  const res = await storage.mutateState('approvalQueue', function (cur) {
    mutatorRuns++;
    const live = cur.find(e => e.id === 'cprop_x');
    if (!live) return undefined;
    live.status = 'approved';
    live.materializedId = 'camp-ms9nl7dy-dcbp';
    return cur;
  });

  assert.strictEqual(res.written, true);
  assert.strictEqual(res.attempts, 2, 'should have conflicted once then retried');
  assert.strictEqual(mutatorRuns, 2, 'mutator must re-run against fresh state');

  const final = read(c, 'approvalQueue');
  assert.strictEqual(final.length, 2, 'competing write must survive');
  assert.strictEqual(final.find(e => e.id === 'cprop_x').status, 'approved', 'our flip must survive');
  assert.strictEqual(final.find(e => e.id === 'cprop_x').materializedId, 'camp-ms9nl7dy-dcbp');
  assert.ok(final.find(e => e.id === 'competitor'), 'competitor entry must still be there');
});

test('mutateState throws ConcurrencyError when every attempt conflicts', async () => {
  const c = makeFakeContainer({
    onRead(store, name) { // a writer that wins the race on every single attempt
      const cur = JSON.parse(store.get(name).content);
      store.set(name, { content: JSON.stringify(cur), etag: 'etag-moving-' + Math.random() });
    }
  });
  storage._setContainerClientForTests(c);
  seed(c, 'approvalQueue', [{ id: 'a', status: 'pending' }]);

  await assert.rejects(
    () => storage.mutateState('approvalQueue', function (cur) { return cur; }, { retries: 3 }),
    function (err) { return err.name === 'ConcurrencyError' && err.key === 'approvalQueue'; }
  );
});

test('mutateState refuses to write when the read failed', async () => {
  // getState collapses a read error to null and callers do `|| []`, which would
  // write an empty array over live data. mutateState must bail instead.
  const c = makeFakeContainer({ failRead: true });
  storage._setContainerClientForTests(c);
  seed(c, 'approvalQueue', [{ id: 'a', status: 'pending' }]);

  await assert.rejects(
    () => storage.mutateState('approvalQueue', function () { return []; }),
    /refusing to write over unread state/
  );
  assert.strictEqual(read(c, 'approvalQueue').length, 1, 'live data must be intact');
});

test('mutateState create-only guards a first write against a concurrent creator', async () => {
  const c = makeFakeContainer();
  storage._setContainerClientForTests(c);
  // Key absent. A competing creator lands between our 404 read and our write.
  let first = true;
  const orig = c.getBlockBlobClient.bind(c);
  c.getBlockBlobClient = function (name) {
    const client = orig(name);
    const origDownload = client.download;
    client.download = async function () {
      try { return await origDownload(); }
      finally {
        if (first) { first = false; c.store.set(name, { content: '[{"id":"other"}]', etag: 'etag-other' }); }
      }
    };
    return client;
  };

  const res = await storage.mutateState('newKey', function (cur) {
    const arr = Array.isArray(cur) ? cur : [];
    arr.push({ id: 'mine' });
    return arr;
  });

  assert.strictEqual(res.written, true);
  const final = read(c, 'newKey');
  assert.ok(final.find(e => e.id === 'other'), 'concurrent creator must not be clobbered');
  assert.ok(final.find(e => e.id === 'mine'), 'our append must survive');
});
