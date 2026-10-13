// Run with: node api/studio/index.test.js
// Dispatch and auth, with storage never reached: every action must refuse before it touches a blob.
const assert = require('assert');

delete process.env.STUDIO_ACCESS_KEY;
delete process.env.STUDIO_WORKER_TOKEN;
delete process.env.AZURE_STORAGE_CONNECTION_STRING;
const handler = require('./index');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
async function call(method, action, headers = {}, query = {}, body) {
  const context = { bindingData: { action }, log: { error() {} }, res: null };
  await handler(context, { method, headers, query, body });
  return context.res;
}

(async () => {
  for (const a of ['projects', 'manifest', 'media', 'text', 'files']) {
    await t(`GET ${a}: no key configured -> 403`, async () => assert.strictEqual((await call('GET', a, { 'x-studio-key': 'guess' })).status, 403));
  }
  for (const a of ['heartbeat', 'manifest', 'upload-url']) {
    await t(`POST ${a}: no token configured -> 403`, async () => assert.strictEqual((await call('POST', a, { 'x-studio-worker-token': 'guess' })).status, 403));
  }
  await t('unknown action -> 404', async () => assert.strictEqual((await call('GET', 'constructor')).status, 404));
  await t('POST projects is not a worker action -> 404', async () => assert.strictEqual((await call('POST', 'projects')).status, 404));
  await t('OPTIONS -> 204', async () => assert.strictEqual((await call('OPTIONS', 'projects')).status, 204));

  process.env.STUDIO_ACCESS_KEY = 'op-key';
  process.env.STUDIO_WORKER_TOKEN = 'wk-token';
  await t('operator key cannot use a worker action', async () => assert.strictEqual((await call('POST', 'heartbeat', { 'x-studio-key': 'op-key' })).status, 403));
  await t('worker token cannot read projects', async () => assert.strictEqual((await call('GET', 'projects', { 'x-studio-worker-token': 'wk-token' })).status, 403));
  await t('operator key cannot list files (worker only)', async () => assert.strictEqual((await call('GET', 'files', { 'x-studio-key': 'op-key' }, { project: 'x' })).status, 403));
  await t('valid key, unhosted project -> 404 before storage', async () => {
    process.env.STUDIO_PROJECTS = 'ambientpixels';
    assert.strictEqual((await call('GET', 'media', { 'x-studio-key': 'op-key' }, { project: 'xbox-gps', path: 'renders/xbox-gps/a.mp4' })).status, 404);
  });
  await t('valid key, bad path -> 400 before storage', async () => {
    assert.strictEqual((await call('GET', 'media', { 'x-studio-key': 'op-key' }, { project: 'ambientpixels', path: 'renders/ambientpixels/../x' })).status, 400);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
