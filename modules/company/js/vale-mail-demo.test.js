// Run with: node modules/company/js/vale-mail-demo.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createDemoGraph, shiftIso } = require('./vale-mail-demo.js');
const { METHODS } = require('./vale-graph-browser.js');

const FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'data', 'vale-mail-demo.json');
const RAW = fs.readFileSync(FIXTURE_PATH, 'utf8');
const fixture = () => JSON.parse(RAW);

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const ANCHOR = Date.parse(fixture().anchor);
const DAY = 86400000;
const NOW = ANCHOR + 3 * DAY + 3600000; // three days and an hour after the fixture was written
function demo(over) {
  return createDemoGraph(fixture(), Object.assign({ now: () => NOW, latency: 0, sleep: async () => {} }, over || {}));
}
const allMsgs = (f) => [].concat(...Object.values(f.folders));

(async () => {
  // ── Interface parity ──
  await test('has exactly the real client interface (METHODS) and isDemo', async () => {
    const g = demo();
    METHODS.forEach((m) => assert.strictEqual(typeof g[m], 'function', m));
    assert.strictEqual(g.isDemo, true);
  });
  await test('every method returns a Promise', async () => {
    const g = demo();
    const id = fixture().folders.inbox[0].id;
    const calls = {
      listMessages: () => g.listMessages({ folder: 'inbox' }), getMessage: () => g.getMessage(id),
      listAttachments: () => g.listAttachments(id), search: () => g.search('chad'), me: () => g.me(),
      calendarView: () => g.calendarView(new Date(NOW - DAY).toISOString(), new Date(NOW + DAY).toISOString())
    };
    for (const k of Object.keys(calls)) { const p = calls[k](); assert.ok(p && typeof p.then === 'function', k); await p; }
  });
  await test('requires a fixture with folders', async () => {
    assert.throws(() => createDemoGraph(null), /fixture/);
    assert.throws(() => createDemoGraph({}), /fixture/);
  });
  await test('does not mutate the fixture object passed in', async () => {
    const f = fixture();
    const g = createDemoGraph(f, { now: () => NOW, latency: 0, sleep: async () => {} });
    await g.move(f.folders.inbox[0].id, 'archive');
    assert.strictEqual(JSON.stringify(f), JSON.stringify(fixture()));
  });

  // ── Latency ──
  await test('default latency is between 150 and 400 ms per call', async () => {
    const slept = [];
    const g = createDemoGraph(fixture(), { now: () => NOW, sleep: async (ms) => slept.push(ms) });
    await g.me(); await g.listMessages({ folder: 'inbox' }); await g.search('invoice');
    assert.strictEqual(slept.length, 3);
    slept.forEach((ms) => assert.ok(ms >= 150 && ms <= 400, String(ms)));
  });
  await test('latency is injectable (number or function)', async () => {
    const slept = [];
    await createDemoGraph(fixture(), { now: () => NOW, latency: 7, sleep: async (ms) => slept.push(ms) }).me();
    await createDemoGraph(fixture(), { now: () => NOW, latency: () => 9, sleep: async (ms) => slept.push(ms) }).me();
    assert.deepStrictEqual(slept, [7, 9]);
  });

  // ── Dates ──
  await test('shiftIso keeps the input style (Z or Graph calendar no-zone format)', async () => {
    assert.strictEqual(shiftIso('2026-10-17T15:00:00Z', 3600000), '2026-10-17T16:00:00.000Z');
    assert.strictEqual(shiftIso('2026-10-17T17:00:00.0000000', DAY), '2026-10-18T17:00:00.0000000');
    assert.strictEqual(shiftIso('not a date', DAY), 'not a date');
    assert.strictEqual(shiftIso(null, DAY), null);
  });
  await test('every message date is shifted by (now - anchor)', async () => {
    const g = demo();
    const src = fixture().folders.inbox[0];
    const m = await g.getMessage(src.id);
    assert.strictEqual(Date.parse(m.receivedDateTime) - Date.parse(src.receivedDateTime), NOW - ANCHOR);
    assert.strictEqual(Date.parse(m.sentDateTime) - Date.parse(src.sentDateTime), NOW - ANCHOR);
  });
  await test('calendar events and triagedAt are shifted too', async () => {
    const g = demo();
    const f = fixture();
    const src = f.calendar[0];
    const ev = await g.calendarView(new Date(NOW - 2 * DAY).toISOString(), new Date(NOW + 3 * DAY).toISOString());
    const e = ev.find((x) => x.id === src.id);
    assert.ok(e, 'event in window');
    assert.strictEqual(Date.parse(e.start.dateTime + 'Z') - Date.parse(src.start.dateTime + 'Z'), NOW - ANCHOR);
    assert.strictEqual(Date.parse(g.extras().triagedAt) - Date.parse(f.triagedAt), NOW - ANCHOR);
  });
  await test('extras exposes labels, rules, workHours, drafts, folderList for the UI', async () => {
    const x = demo().extras();
    const f = fixture();
    assert.deepStrictEqual(x.labels, f.labels);
    assert.deepStrictEqual(x.rules, f.rules);
    assert.deepStrictEqual(x.workHours, f.workHours);
    assert.deepStrictEqual(x.drafts, f.drafts);
    assert.deepStrictEqual(x.folderList, f.folderList);
    x.labels.zzz = 1;
    assert.ok(!('zzz' in demo().extras().labels));
  });

  // ── listMessages ──
  await test('listMessages returns a folder newest-first, without bodies', async () => {
    const { items, next } = await demo().listMessages({ folder: 'inbox' });
    assert.strictEqual(items.length, fixture().folders.inbox.length);
    assert.strictEqual(next, null);
    for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].receivedDateTime >= items[i].receivedDateTime);
    items.forEach((m) => { assert.ok(!('body' in m)); assert.strictEqual(m.parentFolderId, 'inbox'); assert.ok(m.bodyPreview != null); });
  });
  await test('listMessages pages with top and an opaque skipToken', async () => {
    const g = demo();
    const p1 = await g.listMessages({ folder: 'inbox', top: 12 });
    assert.strictEqual(p1.items.length, 12);
    assert.ok(typeof p1.next === 'string');
    const p2 = await g.listMessages({ folder: 'inbox', skipToken: p1.next });
    const p3 = await g.listMessages({ folder: 'inbox', skipToken: p2.next });
    assert.strictEqual(p2.items.length, 12);
    assert.strictEqual(p3.items.length, fixture().folders.inbox.length - 24);
    assert.strictEqual(p3.next, null);
    const ids = new Set([...p1.items, ...p2.items, ...p3.items].map((m) => m.id));
    assert.strictEqual(ids.size, fixture().folders.inbox.length);
  });
  await test('top is capped at 50; sent and archive folders list their own mail', async () => {
    const g = demo();
    assert.strictEqual((await g.listMessages({ folder: 'inbox', top: 999 })).items.length, fixture().folders.inbox.length);
    assert.strictEqual((await g.listMessages({ folder: 'sentitems' })).items.length, fixture().folders.sentitems.length);
    assert.strictEqual((await g.listMessages({ folder: 'archive' })).items.length, fixture().folders.archive.length);
  });
  await test('unknown folder or bad skipToken is a 404/400 GraphError-shaped rejection', async () => {
    const g = demo();
    await assert.rejects(g.listMessages({ folder: 'nope' }), (e) => e.name === 'GraphError' && e.status === 404);
    await assert.rejects(g.listMessages({ folder: 'inbox', skipToken: 'garbage' }), (e) => e.status === 400);
  });

  // ── getMessage / attachments ──
  await test('getMessage returns the full message with body, replyTo and headers', async () => {
    const src = allMsgs(fixture()).find((m) => m.replyTo && m.replyTo.length);
    assert.ok(src, 'fixture has a Reply-To case');
    const m = await demo().getMessage(src.id);
    assert.strictEqual(m.body.content, src.body.content);
    assert.deepStrictEqual(m.replyTo, src.replyTo);
    assert.ok(Array.isArray(m.internetMessageHeaders));
  });
  await test('getMessage on a missing id rejects with 404', async () => {
    await assert.rejects(demo().getMessage('nope'), (e) => e.status === 404 && e.code === 'ErrorItemNotFound');
  });
  await test('returned messages are copies (mutating them does not change the store)', async () => {
    const g = demo();
    const id = fixture().folders.inbox[0].id;
    const m = await g.getMessage(id);
    m.subject = 'changed';
    assert.notStrictEqual((await g.getMessage(id)).subject, 'changed');
  });
  await test('listAttachments returns metadata without contentBytes', async () => {
    const f = fixture();
    const id = Object.keys(f.attachments)[0];
    const atts = await demo().listAttachments(id);
    assert.strictEqual(atts.length, f.attachments[id].length);
    atts.forEach((a, i) => {
      assert.ok(!('contentBytes' in a));
      assert.deepStrictEqual(Object.keys(a).sort(), ['contentId', 'contentType', 'id', 'isInline', 'name', 'size']);
      assert.strictEqual(a.id, f.attachments[id][i].id);
    });
    assert.deepStrictEqual(await demo().listAttachments(f.folders.inbox.find((m) => !f.attachments[m.id]).id), []);
  });
  await test('getAttachmentBytes decodes base64 contentBytes into an ArrayBuffer', async () => {
    const f = fixture();
    const id = Object.keys(f.attachments)[0];
    const a = f.attachments[id][0];
    const buf = await demo().getAttachmentBytes(id, a.id);
    assert.ok(buf instanceof ArrayBuffer);
    assert.strictEqual(Buffer.from(buf).toString('base64'), a.contentBytes);
    await assert.rejects(demo().getAttachmentBytes(id, 'nope'), (e) => e.status === 404);
  });
  await test('inline cid attachments are present for the logo-concepts email', async () => {
    const f = fixture();
    const inline = Object.keys(f.attachments).filter((k) => f.attachments[k].some((a) => a.isInline && a.contentId));
    assert.ok(inline.length >= 1);
    const atts = await demo().listAttachments(inline[0]);
    assert.ok(atts.some((a) => a.isInline && a.contentId));
  });

  // ── search ──
  await test('search matches subject, preview and sender, all terms, case-insensitive', async () => {
    const g = demo();
    const src = fixture().folders.inbox.find((m) => /statement of work/i.test(m.subject));
    const r1 = await g.search('STATEMENT of work');
    assert.ok(r1.some((m) => m.id === src.id));
    const r2 = await g.search('kim@clientco.example');
    assert.ok(r2.length >= 1 && r2.every((m) => JSON.stringify([m.from, m.toRecipients, m.ccRecipients, m.subject, m.bodyPreview]).toLowerCase().includes('kim@clientco.example')));
    assert.deepStrictEqual(await g.search('zzqx-nothing-matches'), []);
    r1.forEach((m) => assert.ok(!('body' in m)));
  });
  await test('search spans inbox, sent and archive, newest first, and refuses empty', async () => {
    const g = demo();
    const r = await g.search('a');
    const folders = new Set(r.map((m) => m.parentFolderId));
    assert.ok(folders.has('inbox') && folders.has('sentitems'));
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].receivedDateTime >= r[i].receivedDateTime);
    await assert.rejects(g.search('  "" '), (e) => e.status === 400);
  });

  // ── Mutations ──
  await test('patchMessage marks read/unread and flags, and persists', async () => {
    const g = demo();
    const src = fixture().folders.inbox.find((m) => !m.isRead);
    const out = await g.patchMessage(src.id, { isRead: true, flag: true });
    assert.strictEqual(out.isRead, true);
    assert.strictEqual(out.flag.flagStatus, 'flagged');
    const again = await g.getMessage(src.id);
    assert.strictEqual(again.isRead, true);
    assert.strictEqual(again.flag.flagStatus, 'flagged');
    await g.patchMessage(src.id, { flag: false, isRead: false });
    const back = await g.getMessage(src.id);
    assert.strictEqual(back.flag.flagStatus, 'notFlagged');
    assert.strictEqual(back.isRead, false);
  });
  await test('patchMessage ignores other fields and refuses empty patches', async () => {
    const g = demo();
    const id = fixture().folders.inbox[0].id;
    await g.patchMessage(id, { isRead: true, subject: 'hacked' });
    assert.notStrictEqual((await g.getMessage(id)).subject, 'hacked');
    await assert.rejects(g.patchMessage(id, {}), (e) => e.status === 400);
  });
  await test('move to archive keeps the id (immutable ids) and moves folders; undo moves back', async () => {
    const g = demo();
    const id = fixture().folders.inbox[0].id;
    const moved = await g.move(id, 'archive');
    assert.strictEqual(moved.id, id);
    assert.strictEqual(moved.parentFolderId, 'archive');
    assert.ok(!(await g.listMessages({ folder: 'inbox' })).items.some((m) => m.id === id));
    assert.ok((await g.listMessages({ folder: 'archive' })).items.some((m) => m.id === id));
    await g.move(id, 'inbox');
    assert.ok((await g.listMessages({ folder: 'inbox' })).items.some((m) => m.id === id));
    await assert.rejects(g.move(id, 'deleteditems'), (e) => e.status === 404);
  });
  await test('attachments follow a moved message', async () => {
    const g = demo();
    const id = Object.keys(fixture().attachments)[0];
    await g.move(id, 'archive');
    assert.ok((await g.listAttachments(id)).length >= 1);
  });

  // ── Drafts and send ──
  await test('createReply makes a draft addressed to Reply-To (else From), RE: subject, same thread', async () => {
    const g = demo();
    const f = fixture();
    const plain = f.folders.inbox.find((m) => !(m.replyTo && m.replyTo.length) && !/^re:/i.test(m.subject));
    const d = await g.createReply(plain.id);
    assert.strictEqual(d.isDraft, true);
    assert.strictEqual(d.parentFolderId, 'drafts');
    assert.strictEqual(d.conversationId, plain.conversationId);
    assert.strictEqual(d.subject, 'RE: ' + plain.subject);
    assert.deepStrictEqual(d.toRecipients.map((r) => r.emailAddress.address), [plain.from.emailAddress.address]);
    assert.ok(d.body.content.includes(plain.from.emailAddress.address), 'quoted header names the sender');
    const rt = allMsgs(f).find((m) => m.replyTo && m.replyTo.length);
    const d2 = await g.createReply(rt.id);
    assert.deepStrictEqual(d2.toRecipients.map((r) => r.emailAddress.address), rt.replyTo.map((r) => r.emailAddress.address));
  });
  await test('createReply keeps an existing RE: prefix and reply-all adds cc minus me', async () => {
    const g = demo();
    const f = fixture();
    const re = f.folders.inbox.find((m) => /^re:/i.test(m.subject) && m.ccRecipients && m.ccRecipients.length);
    const d = await g.createReply(re.id, { all: true });
    assert.strictEqual(d.subject, re.subject);
    const all = d.toRecipients.concat(d.ccRecipients || []).map((r) => r.emailAddress.address.toLowerCase());
    assert.ok(!all.includes(f.me.mail.toLowerCase()));
    re.ccRecipients.forEach((c) => { if (c.emailAddress.address.toLowerCase() !== f.me.mail.toLowerCase()) assert.ok(all.includes(c.emailAddress.address.toLowerCase())); });
    await assert.rejects(g.createReply('nope'), (e) => e.status === 404);
  });
  await test('drafts do not show in inbox/sent lists or search', async () => {
    const g = demo();
    const id = fixture().folders.inbox[0].id;
    const d = await g.createReply(id);
    assert.ok(!(await g.listMessages({ folder: 'inbox' })).items.some((m) => m.id === d.id));
    assert.ok(!(await g.listMessages({ folder: 'sentitems' })).items.some((m) => m.id === d.id));
    assert.ok((await g.listMessages({ folder: 'drafts' })).items.some((m) => m.id === d.id));
  });
  await test('patchDraft updates body/recipients; only drafts can be patched', async () => {
    const g = demo();
    const id = fixture().folders.inbox[0].id;
    const d = await g.createReply(id);
    const p = await g.patchDraft(d.id, { bodyHtml: '<p>Yes</p>', toRecipients: ['x@y.example'] });
    assert.strictEqual(p.body.content, '<p>Yes</p>');
    assert.strictEqual(p.body.contentType, 'html');
    assert.deepStrictEqual(p.toRecipients, [{ emailAddress: { address: 'x@y.example' } }]);
    assert.strictEqual(p.bodyPreview, 'Yes');
    await assert.rejects(g.patchDraft(id, { bodyHtml: 'x' }), (e) => e.status === 400);
    await assert.rejects(g.patchDraft(d.id, {}), (e) => e.status === 400);
    await assert.rejects(g.patchDraft(d.id, { toRecipients: ['bad'] }), (e) => e.status === 400);
  });
  await test('sendDraft moves the draft to Sent, from me, dated now, and it is no longer a draft', async () => {
    const g = demo();
    const id = fixture().folders.inbox[0].id;
    const d = await g.createReply(id);
    await g.patchDraft(d.id, { bodyHtml: '<p>Done</p>' });
    const r = await g.sendDraft(d.id);
    assert.strictEqual(r, undefined);
    const sent = (await g.listMessages({ folder: 'sentitems' })).items;
    assert.strictEqual(sent[0].id, d.id, 'newest in Sent');
    const m = await g.getMessage(d.id);
    assert.strictEqual(m.isDraft, false);
    assert.strictEqual(m.parentFolderId, 'sentitems');
    assert.strictEqual(m.from.emailAddress.address, fixture().me.mail);
    assert.strictEqual(Date.parse(m.sentDateTime), NOW);
    assert.strictEqual(m.isRead, true);
    await assert.rejects(g.sendDraft(d.id), (e) => e.status === 404 && e.code === 'ErrorItemNotFound', 'cannot send twice: the draft is gone');
    await assert.rejects(g.sendDraft('nope'), (e) => e.status === 404);
  });
  await test('a draft with no recipients cannot be sent', async () => {
    const g = demo();
    const d = await g.createDraft({ to: [], subject: 'S', bodyHtml: '<p>x</p>' });
    await assert.rejects(g.sendDraft(d.id), (e) => e.status === 400 && e.code === 'ErrorInvalidRecipients');
  });
  await test('createDraft makes a new draft; sent later in its own thread', async () => {
    const g = demo();
    const d = await g.createDraft({ to: 'kim@clientco.example', subject: 'Hello', bodyHtml: '<p>Hi</p>' });
    assert.strictEqual(d.isDraft, true);
    assert.strictEqual(d.subject, 'Hello');
    assert.ok(d.conversationId && d.conversationId !== d.id);
    await g.sendDraft(d.id);
    assert.strictEqual((await g.listMessages({ folder: 'sentitems' })).items[0].subject, 'Hello');
    await assert.rejects(g.createDraft({ to: ['nope'], subject: '', bodyHtml: '' }), (e) => e.status === 400);
  });
  await test('two demo instances do not share state', async () => {
    const a = demo(); const b = demo();
    const id = fixture().folders.inbox[0].id;
    await a.move(id, 'archive');
    assert.strictEqual((await b.getMessage(id)).parentFolderId, 'inbox');
  });

  // ── Calendar / me ──
  await test('calendarView returns events overlapping the window, by start', async () => {
    const g = demo();
    const f = fixture();
    const all = await g.calendarView(new Date(NOW - 5 * DAY).toISOString(), new Date(NOW + 5 * DAY).toISOString());
    assert.strictEqual(all.length, f.calendar.length);
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].start.dateTime <= all[i].start.dateTime);
    const none = await g.calendarView(new Date(NOW + 30 * DAY).toISOString(), new Date(NOW + 31 * DAY).toISOString());
    assert.deepStrictEqual(none, []);
    await assert.rejects(g.calendarView('x', 'y'), (e) => e.status === 400);
  });
  await test('me returns the fixture mailbox owner', async () => {
    assert.deepStrictEqual(await demo().me(), fixture().me);
  });

  // ── Demo drafts (round 2) ──
  const { rewriteInstruction, demoDraft } = require('./vale-mail-demo.js');
  await test('rewriteInstruction turns "ask X if…" into a question, never echoing the instruction', () => {
    assert.strictEqual(rewriteInstruction('ask Ravi if Tuesday works for a demo', 'Ravi'), 'Does Tuesday work for a demo?');
    assert.strictEqual(rewriteInstruction('ask Ravi whether he can send the key', 'Ravi'), 'Can you send the key?');
    assert.strictEqual(rewriteInstruction('ask Kim to send the redlines'), 'Could you send the redlines?');
    assert.strictEqual(rewriteInstruction('tell Kim we ship Monday', 'Kim'), 'We ship Monday.');
    assert.strictEqual(rewriteInstruction('let Kim know that she can use the sandbox', 'Kim'), 'You can use the sandbox.');
    assert.strictEqual(rewriteInstruction('yes, send it Monday'), 'Yes, send it Monday.');
  });
  await test('demoDraft: written drafts per email and stance, generic fallback, no "Quick note:"', () => {
    const fx = fixture();
    const yes = demoDraft(fx.drafts, { id: 'demo-inb-006', stance: 'yes', firstName: 'Dana' });
    assert.ok(/Thursday/.test(yes) && /^Hi Dana,/.test(yes), yes);
    assert.ok(/sandbox/.test(demoDraft(fx.drafts, { id: 'demo-inb-024', stance: 'yes', firstName: 'Ravi' })));
    assert.ok(/checking in/.test(demoDraft(fx.drafts, { id: 'demo-inb-011', stance: 'nudge', firstName: 'Jordan' })));
    assert.ok(/checking in/i.test(demoDraft(fx.drafts, { id: 'nope', stance: 'nudge', firstName: 'Pat' })));
    const compose = demoDraft(fx.drafts, { instruction: 'ask Ravi if Tuesday works for a demo', firstName: 'Ravi' });
    assert.ok(/Does Tuesday work/.test(compose) && !/ask Ravi/.test(compose) && !/Quick note:/.test(compose), compose);
    const choice = demoDraft(fx.drafts, { id: 'demo-inb-027', stance: 'choice', option: 'B', firstName: 'Elena' });
    assert.ok(/go with B\./.test(choice), choice);
    Object.keys(fx.drafts).forEach((k) => { if (typeof fx.drafts[k] === 'string') assert.ok(!/Quick note:/.test(fx.drafts[k]), k); });
  });
  await test('demoDraft: a mismatched Reply-To always gets the verify draft', () => {
    const fx = fixture();
    ['yes', 'ack', null].forEach((stance) => {
      const t = demoDraft(fx.drafts, { id: 'demo-inb-015', stance, mismatch: true, firstName: 'Dana', instruction: stance ? '' : 'sounds good' });
      assert.ok(/call/.test(t) && !/Sounds good/i.test(t), t);
    });
  });


  // ── Round 3: demo drafts never invent facts, times or promises ──
  // Every number and time word in a written draft must come from the email it answers (or its
  // thread); anything else goes in a [bracketed placeholder], as the real prompt asks.
  const TIME_WORDS = /\b(today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mornings?|afternoons?|evenings?|weekends?|nightly|daily|weekly|minutes?|hours?|days?|weeks?|months?|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?|noon|midnight|am|pm|end of day|eod|asap)\b/gi;
  function claims(text) {
    const t = String(text || '').replace(/\[[^\]]*\]/g, ' ').replace(/\{[a-zA-Z]+\}/g, ' ');
    return (t.match(/\d+/g) || []).concat((t.match(TIME_WORDS) || []).map((w) => w.toLowerCase()));
  }
  function sourceText(fx, id) {
    const all = Object.values(fx.folders).flat();
    const m = all.find((x) => x.id === id);
    if (!m) return '';
    const thread = all.filter((x) => x.conversationId === m.conversationId);
    const strip = (h) => String(h || '').replace(/<[^>]*>/g, ' ');
    return thread.map((x) => x.subject + ' ' + strip(x.body && x.body.content)).join(' ').toLowerCase();
  }
  function inSource(src, claim) {
    if (/^\d+$/.test(claim)) return new RegExp('(^|\\D)' + claim + '(\\D|$)').test(src);
    return new RegExp('\\b' + claim.replace(/\s+/g, '\\s+') + '\\b', 'i').test(src);
  }
  await test('demo drafts: no number or time word that the email does not state (unless [bracketed])', () => {
    const fx = fixture();
    const bad = [];
    Object.keys(fx.drafts).forEach((k) => {
      if (typeof fx.drafts[k] !== 'string') return;
      claims(fx.drafts[k]).forEach((c) => bad.push('generic ' + k + ': ' + c));
    });
    Object.keys(fx.drafts.byId || {}).forEach((id) => {
      const src = sourceText(fx, id);
      assert.ok(src, 'draft for a message that exists: ' + id);
      Object.keys(fx.drafts.byId[id]).forEach((st) => {
        claims(fx.drafts.byId[id][st]).forEach((c) => { if (!inSource(src, c)) bad.push(id + ' ' + st + ': ' + c); });
      });
    });
    assert.deepStrictEqual(bad, []);
  });
  await test('demo drafts: Ravi\'s yes promises nothing the email does not say', () => {
    const t = demoDraft(fixture().drafts, { id: 'demo-inb-024', stance: 'yes', firstName: 'Ravi' });
    const outside = t.replace(/\[[^\]]*\]/g, '');
    assert.ok(/sandbox key/.test(t), t);
    assert.ok(!/rate-limited|nightly|\btoday\b/i.test(outside), t);
  });
  await test('demo: listConversation returns the whole thread across folders, no drafts', async () => {
    const g = demo();
    const conv = await g.listConversation('conv-northwind-kickoff');
    const want = Object.values(fixture().folders).flat().filter((m) => m.conversationId === 'conv-northwind-kickoff').length;
    assert.strictEqual(conv.length, want);
    assert.ok(conv.every((m) => m.conversationId === 'conv-northwind-kickoff' && !('body' in m)));
    await assert.rejects(g.listConversation(''), (e) => e.status === 400);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
