// Run with: node modules/company/js/vale-graph-browser.test.js
const assert = require('assert');
const G = require('./vale-graph-browser.js');
const { createGraphClient, GraphError, METHODS, BASE } = G;

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

function res(status, body, headers, raw) {
  const h = headers || {};
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (h[k.toLowerCase()] == null ? null : h[k.toLowerCase()]) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    arrayBuffer: async () => raw || new ArrayBuffer(0)
  };
}
function fakeFetch(seq) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, method: (init && init.method) || 'GET', headers: (init && init.headers) || {}, body: init && init.body });
    const r = seq[Math.min(calls.length - 1, seq.length - 1)];
    return typeof r === 'function' ? r(url, init) : r;
  };
  f.calls = calls;
  return f;
}
const noSleep = async () => {};
function client(f, over) {
  return createGraphClient(Object.assign({ fetch: f, getToken: async () => 'TOK', sleep: noSleep }, over || {}));
}
const dec = (u) => decodeURIComponent(u);

(async () => {
  // ── Interface ──
  await test('exposes every method of the shared interface', async () => {
    const c = client(fakeFetch([res(200, {})]));
    ['listMessages', 'getMessage', 'listAttachments', 'getAttachmentBytes', 'search', 'patchMessage', 'move',
      'createReply', 'patchDraft', 'sendDraft', 'createDraft', 'calendarView', 'me'].forEach((m) => {
      assert.ok(METHODS.includes(m), 'METHODS has ' + m);
      assert.strictEqual(typeof c[m], 'function', m);
    });
    assert.strictEqual(c.isDemo, false);
    assert.strictEqual(BASE, 'https://graph.microsoft.com/v1.0');
  });
  await test('createGraphClient requires fetch and getToken', async () => {
    assert.throws(() => createGraphClient({ getToken: async () => 'x' }), /fetch/);
    assert.throws(() => createGraphClient({ fetch: async () => {} }), /getToken/);
  });

  // ── Headers ──
  await test('every request carries the bearer token and the immutable-id preference', async () => {
    const f = fakeFetch([res(200, { value: [] })]);
    await client(f).listMessages({ folder: 'inbox' });
    assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer TOK');
    assert.strictEqual(f.calls[0].headers.Prefer, 'IdType="ImmutableId"');
    assert.strictEqual(f.calls[0].method, 'GET');
  });
  await test('getToken is awaited per request (a refreshed token is used next call)', async () => {
    let n = 0;
    const f = fakeFetch([res(200, { value: [] })]);
    const c = client(f, { getToken: async () => 'T' + (++n) });
    await c.listMessages({ folder: 'inbox' }); await c.listMessages({ folder: 'inbox' });
    assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer T1');
    assert.strictEqual(f.calls[1].headers.Authorization, 'Bearer T2');
  });
  await test('a missing token fails before any network call', async () => {
    const f = fakeFetch([res(200, {})]);
    await assert.rejects(client(f, { getToken: async () => '' }).me(), (e) => e instanceof GraphError && e.code === 'no_token');
    assert.strictEqual(f.calls.length, 0);
  });
  await test('401 asks getToken for a forced refresh once, then retries', async () => {
    const asked = [];
    const f = fakeFetch([res(401, { error: { code: 'InvalidAuthenticationToken', message: 'expired' } }), res(200, { displayName: 'C', mail: 'c@x.example' })]);
    const me = await client(f, { getToken: async (o) => { asked.push(o || {}); return asked.length === 1 ? 'OLD' : 'NEW'; } }).me();
    assert.strictEqual(me.mail, 'c@x.example');
    assert.strictEqual(f.calls.length, 2);
    assert.strictEqual(asked[1].forceRefresh, true);
    assert.strictEqual(f.calls[1].headers.Authorization, 'Bearer NEW');
  });
  await test('a second 401 is surfaced as GraphError 401 (no loop)', async () => {
    const f = fakeFetch([res(401, { error: { message: 'no' } })]);
    await assert.rejects(client(f).me(), (e) => e.status === 401);
    assert.strictEqual(f.calls.length, 2);
  });

  // ── listMessages ──
  await test('listMessages hits the folder, newest first, list fields only (no body), default top 50', async () => {
    const f = fakeFetch([res(200, { value: [{ id: 'a' }], '@odata.nextLink': BASE + '/me/mailFolders/inbox/messages?$skiptoken=abc' })]);
    const out = await client(f).listMessages({ folder: 'inbox' });
    const u = dec(f.calls[0].url);
    assert.ok(u.startsWith(BASE + '/me/mailFolders/inbox/messages?'), u);
    assert.ok(u.includes('$orderby=receivedDateTime desc'));
    assert.ok(u.includes('$top=50'));
    assert.ok(/\$select=[^&]*bodyPreview/.test(u) && /\$select=[^&]*internetMessageHeaders/.test(u) && /\$select=[^&]*flag/.test(u));
    assert.ok(!/\$select=[^&]*\bbody\b(?!Preview)/.test(u), 'list must not pull full bodies');
    assert.deepStrictEqual(out.items, [{ id: 'a' }]);
    assert.strictEqual(out.next, BASE + '/me/mailFolders/inbox/messages?$skiptoken=abc');
  });
  await test('listMessages caps top at 50 and floors it at 1', async () => {
    const f = fakeFetch([res(200, { value: [] })]);
    await client(f).listMessages({ folder: 'sentitems', top: 500 });
    await client(f).listMessages({ folder: 'archive', top: -3 });
    assert.ok(dec(f.calls[0].url).includes('/mailFolders/sentitems/messages?') && dec(f.calls[0].url).includes('$top=50'));
    assert.ok(dec(f.calls[1].url).includes('/mailFolders/archive/messages?') && dec(f.calls[1].url).includes('$top=1'));
  });
  await test('listMessages follows skipToken (the previous next link) verbatim', async () => {
    const next = BASE + '/me/mailFolders/inbox/messages?$skiptoken=xyz';
    const f = fakeFetch([res(200, { value: [{ id: 'b' }] })]);
    const out = await client(f).listMessages({ folder: 'inbox', skipToken: next });
    assert.strictEqual(f.calls[0].url, next);
    assert.strictEqual(out.next, null);
  });
  await test('a skipToken pointing off Graph is refused without a request', async () => {
    const f = fakeFetch([res(200, { value: [] })]);
    await assert.rejects(client(f).listMessages({ folder: 'inbox', skipToken: 'https://evil.example/steal' }), (e) => e.code === 'bad_url');
    await assert.rejects(client(f).listMessages({ folder: 'inbox', skipToken: 'https://graph.microsoft.com.evil.example/v1.0/x' }), (e) => e.code === 'bad_url');
    assert.strictEqual(f.calls.length, 0);
  });
  await test('a next link from Graph pointing off Graph is dropped (next: null)', async () => {
    const f = fakeFetch([res(200, { value: [{ id: 'a' }], '@odata.nextLink': 'https://evil.example/steal' })]);
    const out = await client(f).listMessages({ folder: 'inbox' });
    assert.strictEqual(out.next, null);
  });
  await test('folder ids are URL-encoded and empty folders refused', async () => {
    const f = fakeFetch([res(200, { value: [] })]);
    await client(f).listMessages({ folder: 'AAMk/=+x' });
    assert.ok(f.calls[0].url.includes('/mailFolders/AAMk%2F%3D%2Bx/messages?'));
    await assert.rejects(client(f).listMessages({}), (e) => e.code === 'bad_arg');
  });

  // ── getMessage / attachments ──
  await test('getMessage selects body, replyTo, headers and attachments flag, and asks for HTML bodies', async () => {
    const f = fakeFetch([res(200, { id: 'm1', body: { contentType: 'html', content: '<p>x</p>' } })]);
    const m = await client(f).getMessage('m1');
    const u = dec(f.calls[0].url);
    assert.ok(u.startsWith(BASE + '/me/messages/m1?'));
    ['body', 'replyTo', 'internetMessageHeaders', 'hasAttachments', 'conversationId', 'toRecipients', 'ccRecipients'].forEach((k) => assert.ok(new RegExp('\\$select=[^&]*\\b' + k + '\\b').test(u), k));
    assert.strictEqual(f.calls[0].headers.Prefer, 'IdType="ImmutableId", outlook.body-content-type="html"');
    assert.strictEqual(m.id, 'm1');
  });
  await test('ids are always URL-encoded in paths', async () => {
    const f = fakeFetch([res(200, {})]);
    await client(f).getMessage('a/b?c#d');
    assert.ok(f.calls[0].url.startsWith(BASE + '/me/messages/a%2Fb%3Fc%23d?'));
    await assert.rejects(client(f).getMessage(''), (e) => e.code === 'bad_arg');
  });
  await test('listAttachments returns metadata only (never contentBytes) and follows pages', async () => {
    const f = fakeFetch([
      res(200, { value: [{ id: 'a1', name: 'x.png', size: 10, contentType: 'image/png', isInline: true, contentId: '<logo@x>', contentBytes: 'QUJD' }], '@odata.nextLink': BASE + '/me/messages/m1/attachments?$skip=1' }),
      res(200, { value: [{ id: 'a2', name: 'y.txt', size: 3, contentType: 'text/plain', isInline: false }] })
    ]);
    const atts = await client(f).listAttachments('m1');
    assert.ok(dec(f.calls[0].url).startsWith(BASE + '/me/messages/m1/attachments'));
    assert.deepStrictEqual(atts, [
      { id: 'a1', name: 'x.png', size: 10, contentType: 'image/png', isInline: true, contentId: '<logo@x>' },
      { id: 'a2', name: 'y.txt', size: 3, contentType: 'text/plain', isInline: false, contentId: null }
    ]);
  });
  await test('getAttachmentBytes reads $value as an ArrayBuffer', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const f = fakeFetch([res(200, undefined, {}, buf)]);
    const out = await client(f).getAttachmentBytes('m1', 'a1');
    assert.strictEqual(f.calls[0].url, BASE + '/me/messages/m1/attachments/a1/$value');
    assert.ok(out instanceof ArrayBuffer);
    assert.deepStrictEqual(Array.from(new Uint8Array(out)), [1, 2, 3]);
  });

  // ── search ──
  await test('search uses $search with a quoted, quote-stripped query and no $orderby/$filter', async () => {
    const f = fakeFetch([res(200, { value: [{ id: 's1' }] })]);
    const items = await client(f).search('invoice "Q4"');
    const u = dec(f.calls[0].url);
    assert.ok(u.startsWith(BASE + '/me/messages?'));
    assert.ok(u.includes('$search="invoice Q4"'), u);
    assert.ok(!u.includes('$orderby') && !u.includes('$filter'));
    assert.deepStrictEqual(items, [{ id: 's1' }]);
  });
  await test('an empty search is refused without a request', async () => {
    const f = fakeFetch([res(200, { value: [] })]);
    await assert.rejects(client(f).search('  ""  '), (e) => e.code === 'bad_arg');
    assert.strictEqual(f.calls.length, 0);
  });

  // ── Mutations ──
  await test('patchMessage sends only isRead and flag, normalising a boolean flag', async () => {
    const f = fakeFetch([res(200, { id: 'm1', isRead: true })]);
    await client(f).patchMessage('m1', { isRead: true, flag: true, subject: 'hacked', body: 'x' });
    assert.strictEqual(f.calls[0].method, 'PATCH');
    assert.strictEqual(f.calls[0].url, BASE + '/me/messages/m1');
    assert.strictEqual(f.calls[0].headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(JSON.parse(f.calls[0].body), { isRead: true, flag: { flagStatus: 'flagged' } });
    await client(f).patchMessage('m1', { flag: false });
    assert.deepStrictEqual(JSON.parse(f.calls[1].body), { flag: { flagStatus: 'notFlagged' } });
    await client(f).patchMessage('m1', { flag: { flagStatus: 'complete', extra: 1 } });
    assert.deepStrictEqual(JSON.parse(f.calls[2].body), { flag: { flagStatus: 'complete' } });
  });
  await test('patchMessage with nothing to change is refused', async () => {
    const f = fakeFetch([res(200, {})]);
    await assert.rejects(client(f).patchMessage('m1', {}), (e) => e.code === 'bad_arg');
    await assert.rejects(client(f).patchMessage('m1', { flag: { flagStatus: 'bogus' } }), (e) => e.code === 'bad_arg');
    assert.strictEqual(f.calls.length, 0);
  });
  await test('move POSTs destinationId and returns the moved message', async () => {
    const f = fakeFetch([res(201, { id: 'm1', parentFolderId: 'ARCH' })]);
    const m = await client(f).move('m1', 'archive');
    assert.strictEqual(f.calls[0].method, 'POST');
    assert.strictEqual(f.calls[0].url, BASE + '/me/messages/m1/move');
    assert.deepStrictEqual(JSON.parse(f.calls[0].body), { destinationId: 'archive' });
    assert.strictEqual(m.parentFolderId, 'ARCH');
  });
  await test('createReply POSTs createReply (or createReplyAll) and returns the draft', async () => {
    const f = fakeFetch([res(201, { id: 'd1', isDraft: true })]);
    const d = await client(f).createReply('m1');
    assert.strictEqual(f.calls[0].url, BASE + '/me/messages/m1/createReply');
    assert.strictEqual(f.calls[0].method, 'POST');
    assert.strictEqual(d.id, 'd1');
    await client(f).createReply('m1', { all: true });
    assert.strictEqual(f.calls[1].url, BASE + '/me/messages/m1/createReplyAll');
  });
  await test('patchDraft sets an HTML body and normalises recipients (strings or objects)', async () => {
    const f = fakeFetch([res(200, { id: 'd1' })]);
    await client(f).patchDraft('d1', { bodyHtml: '<p>Hi</p>', toRecipients: ['a@x.example', { emailAddress: { address: 'b@x.example', name: 'B' } }] });
    assert.strictEqual(f.calls[0].method, 'PATCH');
    assert.strictEqual(f.calls[0].url, BASE + '/me/messages/d1');
    assert.deepStrictEqual(JSON.parse(f.calls[0].body), {
      body: { contentType: 'html', content: '<p>Hi</p>' },
      toRecipients: [{ emailAddress: { address: 'a@x.example' } }, { emailAddress: { address: 'b@x.example', name: 'B' } }]
    });
  });
  await test('patchDraft refuses an empty patch and bad addresses', async () => {
    const f = fakeFetch([res(200, {})]);
    await assert.rejects(client(f).patchDraft('d1', {}), (e) => e.code === 'bad_arg');
    await assert.rejects(client(f).patchDraft('d1', { toRecipients: ['not an address'] }), (e) => e.code === 'bad_arg');
    assert.strictEqual(f.calls.length, 0);
  });
  await test('sendDraft POSTs send and resolves on 202 with no body', async () => {
    const f = fakeFetch([res(202, undefined)]);
    const out = await client(f).sendDraft('d1');
    assert.strictEqual(f.calls[0].url, BASE + '/me/messages/d1/send');
    assert.strictEqual(f.calls[0].method, 'POST');
    assert.strictEqual(out, undefined);
  });
  await test('reply flow runs in order: createReply -> PATCH draft -> send', async () => {
    const f = fakeFetch([res(201, { id: 'd9', isDraft: true }), res(200, { id: 'd9' }), res(202, undefined)]);
    const c = client(f);
    const d = await c.createReply('m1');
    await c.patchDraft(d.id, { bodyHtml: '<p>Yes</p>' });
    await c.sendDraft(d.id);
    assert.deepStrictEqual(f.calls.map((x) => x.method + ' ' + x.url.replace(BASE, '')), [
      'POST /me/messages/m1/createReply', 'PATCH /me/messages/d9', 'POST /me/messages/d9/send'
    ]);
  });
  await test('createDraft POSTs a new message with subject, html body and recipients', async () => {
    const f = fakeFetch([res(201, { id: 'd2', isDraft: true })]);
    const d = await client(f).createDraft({ to: ['kim@clientco.example'], subject: 'Hello', bodyHtml: '<p>Hi</p>' });
    assert.strictEqual(f.calls[0].url, BASE + '/me/messages');
    assert.strictEqual(f.calls[0].method, 'POST');
    assert.deepStrictEqual(JSON.parse(f.calls[0].body), {
      subject: 'Hello', body: { contentType: 'html', content: '<p>Hi</p>' }, toRecipients: [{ emailAddress: { address: 'kim@clientco.example' } }]
    });
    assert.strictEqual(d.id, 'd2');
  });
  await test('createDraft accepts a single address string', async () => {
    const f = fakeFetch([res(201, { id: 'd3' })]);
    await client(f).createDraft({ to: 'kim@clientco.example', subject: 'S', bodyHtml: '' });
    assert.deepStrictEqual(JSON.parse(f.calls[0].body).toRecipients, [{ emailAddress: { address: 'kim@clientco.example' } }]);
  });

  // ── Calendar / me ──
  await test('calendarView asks for the window, ordered, with the timezone in the same Prefer header', async () => {
    const f = fakeFetch([res(200, { value: [{ id: 'e1' }] })]);
    const ev = await client(f).calendarView('2026-10-17T07:00:00Z', '2026-10-19T07:00:00Z');
    const u = dec(f.calls[0].url);
    assert.ok(u.startsWith(BASE + '/me/calendarView?'));
    assert.ok(u.includes('startDateTime=2026-10-17T07:00:00Z') && u.includes('endDateTime=2026-10-19T07:00:00Z'));
    assert.ok(u.includes('$orderby=start/dateTime'));
    assert.strictEqual(f.calls[0].headers.Prefer, 'IdType="ImmutableId", outlook.timezone="Pacific Standard Time"');
    assert.deepStrictEqual(ev, [{ id: 'e1' }]);
  });
  await test('calendarView honours a timeZone option and refuses a non-ISO window', async () => {
    const f = fakeFetch([res(200, { value: [] })]);
    await client(f, { timeZone: 'UTC' }).calendarView('2026-10-17T00:00:00Z', '2026-10-18T00:00:00Z');
    assert.strictEqual(f.calls[0].headers.Prefer, 'IdType="ImmutableId", outlook.timezone="UTC"');
    await assert.rejects(client(f).calendarView('tomorrow', 'later'), (e) => e.code === 'bad_arg');
    assert.strictEqual(f.calls.length, 1);
  });
  await test('me returns displayName and mail (falling back to the UPN)', async () => {
    const f = fakeFetch([res(200, { displayName: 'Chad', mail: null, userPrincipalName: 'chad@ambientpixels.ai' })]);
    const me = await client(f).me();
    assert.ok(dec(f.calls[0].url).startsWith(BASE + '/me?$select='));
    assert.deepStrictEqual(me, { displayName: 'Chad', mail: 'chad@ambientpixels.ai' });
  });

  // ── Retry / errors ──
  await test('429 honours Retry-After (seconds) then succeeds', async () => {
    const slept = [];
    const f = fakeFetch([res(429, {}, { 'retry-after': '2' }), res(200, { value: [] })]);
    await client(f, { sleep: async (ms) => slept.push(ms) }).listMessages({ folder: 'inbox' });
    assert.deepStrictEqual(slept, [2000]);
    assert.strictEqual(f.calls.length, 2);
  });
  await test('Retry-After is capped at 10 seconds', async () => {
    const slept = [];
    const f = fakeFetch([res(503, {}, { 'retry-after': '120' }), res(200, { value: [] })]);
    await client(f, { sleep: async (ms) => slept.push(ms) }).listMessages({ folder: 'inbox' });
    assert.deepStrictEqual(slept, [10000]);
  });
  await test('5xx without Retry-After backs off and retries at most 3 times', async () => {
    const slept = [];
    const f = fakeFetch([res(500, { error: { code: 'x', message: 'boom' } })]);
    await assert.rejects(client(f, { sleep: async (ms) => slept.push(ms) }).getMessage('m1'), (e) => e instanceof GraphError && e.status === 500);
    assert.strictEqual(f.calls.length, 4);
    assert.strictEqual(slept.length, 3);
    slept.forEach((ms) => assert.ok(ms > 0 && ms <= 10000));
  });
  await test('send is never retried on 5xx (could double-send) but is retried on 429', async () => {
    const f = fakeFetch([res(500, {})]);
    await assert.rejects(client(f).sendDraft('d1'), (e) => e.status === 500);
    assert.strictEqual(f.calls.length, 1);
    const g = fakeFetch([res(429, {}, { 'retry-after': '1' }), res(202, undefined)]);
    await client(g).sendDraft('d1');
    assert.strictEqual(g.calls.length, 2);
  });
  await test('other POSTs (createReply, move) are not retried on 5xx either', async () => {
    const f = fakeFetch([res(502, {})]);
    await assert.rejects(client(f).createReply('m1'), (e) => e.status === 502);
    await assert.rejects(client(f).move('m1', 'archive'), (e) => e.status === 502);
    assert.strictEqual(f.calls.length, 2);
  });
  await test('4xx errors carry status and Graph code, and are not retried', async () => {
    const f = fakeFetch([res(404, { error: { code: 'ErrorItemNotFound', message: 'gone' } })]);
    await assert.rejects(client(f).getMessage('m1'), (e) => e instanceof GraphError && e.status === 404 && e.code === 'ErrorItemNotFound');
    assert.strictEqual(f.calls.length, 1);
  });
  await test('a network failure becomes GraphError status 0 code network', async () => {
    const f = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(client(f).me(), (e) => e instanceof GraphError && e.status === 0 && e.code === 'network');
  });
  await test('a non-JSON success body does not crash (returns {})', async () => {
    const f = async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => 'not json' });
    assert.deepStrictEqual(await client(f).me(), { displayName: '', mail: '' });
  });

  // ── Paging cap ──
  await test('calendarView pages but stops at the cap', async () => {
    let i = 0;
    const page = () => res(200, { value: Array.from({ length: 50 }, () => ({ id: 'e' + (i++) })), '@odata.nextLink': BASE + '/me/calendarView?$skip=' + i });
    const f = fakeFetch([page]);
    const ev = await client(f).calendarView('2026-10-17T00:00:00Z', '2026-10-18T00:00:00Z');
    assert.strictEqual(ev.length, 100);
    assert.strictEqual(f.calls.length, 2);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
