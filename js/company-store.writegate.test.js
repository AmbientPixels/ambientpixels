// Run with: node js/company-store.writegate.test.js
//
// HQ phase 0 (2026-10-16): no write before sync, a failed read is never empty, saves report the truth.
//
// Why this exists: the store wrote whole arrays to the server whenever a page asked, even before it
// had read the server's copy — so a slow or failed sync let a tab overwrite live data with a stale
// cache. A failed read was treated as "no data" and cleared the cache, and setState() swallowed
// server errors so callers reported success.

const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// A fresh store per scenario, with a scripted server.
// routes: { 'GET tasks': {status, value} | 'fail', 'POST': {status} }
function freshStore(routes) {
  const calls = [];
  const mem = {};
  global.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  };
  global.fetch = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const m = /key=([^&]+)/.exec(url);
    const key = m ? decodeURIComponent(m[1]) : null;
    calls.push({ method, url, key, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const route = method === 'GET' ? (key === '_ping' ? { status: 200, value: 'ok' } : routes['GET ' + key] || { status: 200, value: null })
      : routes.POST || { status: 200 };
    if (route === 'fail') return Promise.reject(new Error('network down'));
    return Promise.resolve({
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: () => Promise.resolve(method === 'GET' ? { key, value: route.value } : { status: 'saved' })
    });
  };
  const file = path.join(__dirname, 'company-store.js');
  delete require.cache[require.resolve(file)];
  const store = require(file);
  return { store, calls, mem, posts: () => calls.filter((c) => c.method === 'POST') };
}

const TASKS = [{ id: 't1', title: 'Live task', status: 'todo' }];

(async () => {
  await test('a write before the probe/sync is refused, not sent', async () => {
    const { store, posts } = freshStore({});
    const sent = store.setStateSync('ap_tasks', []);
    assert.strictEqual(sent, false);
    assert.strictEqual(posts().length, 0);
    assert.strictEqual(store.getWriteStatus().failCount, 1);
    assert.match(store.getWriteStatus().lastError, /still loading/);
  });

  await test('after a successful sync the same write goes through', async () => {
    const { store, posts } = freshStore({ 'GET tasks': { status: 200, value: TASKS } });
    await store.init({ serverBase: 'https://api.test' });
    await store.syncFromServer();
    assert.strictEqual(store.isKeyReady('ap_tasks'), true);
    assert.strictEqual(store.setStateSync('ap_tasks', TASKS), true);
    assert.strictEqual(posts().length, 1);
    assert.strictEqual(posts()[0].body.key, 'tasks');
  });

  await test('a failed read keeps the cached copy (never empty) and holds writes for that key', async () => {
    const { store, posts, mem } = freshStore({ 'GET tasks': { status: 503, value: null } });
    mem.ap_tasks = JSON.stringify(TASKS); // what this browser had cached
    await store.init({ serverBase: 'https://api.test' });
    await store.syncFromServer();
    assert.deepStrictEqual(store.getStateSync('ap_tasks', []), TASKS, 'cache must survive a failed read');
    assert.deepStrictEqual(store.getStaleKeys(), ['ap_tasks']);
    assert.strictEqual(store.setStateSync('ap_tasks', []), false, 'must not write over live data');
    assert.strictEqual(posts().length, 0);
    assert.match(store.getWriteStatus().lastError, /couldn't load it/);
  });

  await test('a network failure on read behaves the same as a 503', async () => {
    const { store, posts } = freshStore({ 'GET campaigns': 'fail' });
    await store.init({ serverBase: 'https://api.test' });
    await store.syncFromServer();
    assert.ok(store.getStaleKeys().indexOf('ap_campaigns') !== -1);
    store.setStateSync('ap_campaigns', []);
    assert.strictEqual(posts().length, 0);
  });

  await test('a confirmed absence (200, value null) is read OK and writable', async () => {
    const { store } = freshStore({});
    await store.init({ serverBase: 'https://api.test' });
    await store.syncFromServer();
    assert.deepStrictEqual(store.getStateSync('ap_tasks', 'x'), []);
    assert.deepStrictEqual(store.getStateSync('ap_workspace_identity', 'x'), {}, 'object keys default to {}');
    assert.strictEqual(store.isKeyReady('ap_tasks'), true);
  });

  await test('setState rejects and counts a server refusal (403) instead of swallowing it', async () => {
    const { store } = freshStore({ 'GET tasks': { status: 200, value: TASKS }, POST: { status: 403 } });
    await store.init({ serverBase: 'https://api.test' });
    await store.syncFromServer();
    await assert.rejects(store.setState('ap_tasks', TASKS), /403/);
    assert.strictEqual(store.getWriteStatus().failCount, 1);
  });

  await test('setStateSync counts an async server failure', async () => {
    const { store } = freshStore({ 'GET tasks': { status: 200, value: TASKS }, POST: { status: 500 } });
    await store.init({ serverBase: 'https://api.test' });
    await store.syncFromServer();
    store.setStateSync('ap_tasks', TASKS);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(store.getWriteStatus().failCount, 1);
    assert.match(store.getWriteStatus().lastError, /500/);
  });

  await test('setState on a key outside the startup sync reads it first, then writes', async () => {
    const { store, calls } = freshStore({ 'GET tasksArchive': { status: 200, value: [{ id: 'old' }] } });
    await store.init({ serverBase: 'https://api.test' });
    await store.syncFromServer();
    await store.setState('ap_tasks_archive', []);
    const seq = calls.filter((c) => c.key === 'tasksArchive' || (c.method === 'POST' && c.body.key === 'tasksArchive')).map((c) => c.method);
    assert.deepStrictEqual(seq, ['GET', 'POST']);
  });

  await test('setState on an unsynced startup key is refused (rejects)', async () => {
    const { store, posts } = freshStore({ 'GET directives': { status: 503 } });
    await store.init({ serverBase: 'https://api.test' });
    await store.syncFromServer();
    await assert.rejects(store.setState('ap_directives', []), /Not saved/);
    assert.strictEqual(posts().length, 0);
  });

  await test('offline (server unreachable) keeps the local-only mode working', async () => {
    const { store, posts } = freshStore({});
    global.fetch = () => Promise.reject(new Error('offline'));
    await store.init({ serverBase: 'https://api.test' });
    assert.strictEqual(store.getMode(), 'local');
    assert.strictEqual(store.setStateSync('ap_tasks', TASKS), true);
    assert.strictEqual(posts().length, 0);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exitCode = 1;
})();
