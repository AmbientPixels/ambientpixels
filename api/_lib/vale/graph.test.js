// Run with: node api/_lib/vale/graph.test.js
const assert = require('assert');
const { createGraph, GraphError } = require('./graph');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

function res(status, body, headers) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => (headers || {})[k.toLowerCase()] }, text: async () => JSON.stringify(body || {}) };
}
function fakeFetch(seq) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, headers: init.headers }); const r = seq[Math.min(calls.length - 1, seq.length - 1)]; return typeof r === 'function' ? r(url) : r; };
  f.calls = calls;
  return f;
}
const noSleep = async () => {};

(async () => {
  await test('inbox query selects the spec fields and never meetingMessageType', async () => {
    const f = fakeFetch([res(200, { value: [] })]);
    await createGraph({ fetch: f, token: 'T', sleep: noSleep }).listInbox('2026-10-16T13:30:00Z');
    const u = decodeURIComponent(f.calls[0].url);
    assert.ok(u.indexOf('/me/mailFolders/inbox/messages?') !== -1);
    assert.ok(u.indexOf('inferenceClassification') !== -1 && u.indexOf('internetMessageHeaders') !== -1);
    assert.ok(u.indexOf('meetingMessageType') === -1);
    assert.ok(u.indexOf('receivedDateTime ge 2026-10-16T13:30:00Z') !== -1);
    assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer T');
  });
  await test('paging follows nextLink and stops at the cap', async () => {
    const page = (n, next) => res(200, { value: Array.from({ length: n }, (_, i) => ({ id: 'x' + i })), '@odata.nextLink': next });
    const f = fakeFetch([page(50, 'https://graph.microsoft.com/v1.0/next1'), page(50, 'https://graph.microsoft.com/v1.0/next2'), page(50, null)]);
    const out = await createGraph({ fetch: f, token: 'T', sleep: noSleep }).listInbox('2026-10-16T00:00:00Z', 120);
    assert.strictEqual(out.length, 120); assert.strictEqual(f.calls.length, 3);
  });
  await test('a nextLink pointing outside Graph is refused', async () => {
    const f = fakeFetch([res(200, { value: [{ id: 'a' }], '@odata.nextLink': 'https://evil.example/steal' })]);
    await assert.rejects(createGraph({ fetch: f, token: 'T', sleep: noSleep }).listInbox('x', 200), (e) => e instanceof GraphError);
    assert.strictEqual(f.calls.length, 1, 'token must not be sent to a foreign host');
  });
  await test('429 with Retry-After then success', async () => {
    const waits = [];
    const f = fakeFetch([res(429, {}, { 'retry-after': '2' }), res(200, { value: [{ id: 'a' }] })]);
    const out = await createGraph({ fetch: f, token: 'T', sleep: async (ms) => waits.push(ms) }).listSent('x');
    assert.strictEqual(out.length, 1); assert.deepStrictEqual(waits, [2000]);
  });
  await test('Retry-After is capped at 10 seconds', async () => {
    const waits = [];
    const f = fakeFetch([res(503, {}, { 'retry-after': '120' }), res(200, { value: [] })]);
    await createGraph({ fetch: f, token: 'T', sleep: async (ms) => waits.push(ms) }).listSent('x');
    assert.deepStrictEqual(waits, [10000]);
  });
  await test('persistent 500s give up after 3 retries with a GraphError', async () => {
    const f = fakeFetch([res(500, { error: { message: 'boom' } })]);
    await assert.rejects(createGraph({ fetch: f, token: 'T', sleep: noSleep }).listSent('x'), (e) => e instanceof GraphError && e.status === 500);
    assert.strictEqual(f.calls.length, 4);
  });
  await test('a 401 is not retried', async () => {
    const f = fakeFetch([res(401, { error: { message: 'expired' } })]);
    await assert.rejects(createGraph({ fetch: f, token: 'T', sleep: noSleep }).listSent('x'), (e) => e.status === 401);
    assert.strictEqual(f.calls.length, 1);
  });
  await test('calendar view asks for Pacific time and the response status', async () => {
    const f = fakeFetch([res(200, { value: [] })]);
    await createGraph({ fetch: f, token: 'T', sleep: noSleep }).calendarView('2026-10-17T07:00:00Z', '2026-10-19T07:00:00Z');
    assert.strictEqual(f.calls[0].headers.Prefer, 'outlook.timezone="Pacific Standard Time"');
    assert.ok(decodeURIComponent(f.calls[0].url).indexOf('responseStatus') !== -1);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
