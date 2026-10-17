// Run with: node api/_lib/vale/brief.test.js
const assert = require('assert');
const b = require('./brief');
const fx = require('./fixtures');
const triageLib = require('./triage');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const NOW = Date.parse('2026-10-16T13:30:00Z'); // Fri 06:30 PDT
const RULES = { vips: ['dana@clientco.example'], muted: [], receipts: ['payco.example'], rulesOnlyDomains: ['hanson-client.example'], projects: { 'Hanson-related': { domains: ['hanson-client.example'], keywords: [] } } };
const WORK = { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };

(async () => {
  const triaged = await triageLib.triage(fx.inbox, { rules: RULES, callModel: async () => ({ text: '{"items":[{"ref":"m2","label":"needs_you","why":"Asks if Thursday demo is on"}]}' }) });
  const waiting = triageLib.waitingOnOthers(fx.inbox, fx.sent, NOW);
  const full = () => b.buildBrief({ nowMs: NOW, events: fx.calendar, triaged, waiting, take: ['Evergreen has had no activity in 9 days and the demo is Thursday.'], status: {}, workHours: WORK });

  await test('subject counts what needs you and today\'s meetings', () => {
    assert.strictEqual(full().subject, 'Vale brief — Fri, Oct 16: 4 need you · 3 meetings');
  });
  await test('every email-derived string is escaped (no live HTML from mail)', () => {
    const hostile = { id: 'h1', label: 'needs_you', project: '<b>P</b>', from: 'x@weird.example', fromName: '<script>alert(1)</script>', external: true,
      subject: '<img src=x onerror=alert(1)> hello', why: '"><svg onload=alert(1)>', webLink: 'https://outlook.office365.com/owa/?ItemID=h1&x="><script>' };
    const html = b.buildBrief({ nowMs: NOW, events: [], triaged: [hostile], waiting: [], take: ['<i>take</i>'], status: {} }).html;
    assert.ok(html.indexOf('<script>') === -1 && html.indexOf('<img') === -1 && html.indexOf('<svg') === -1 && html.indexOf('<b>P') === -1 && html.indexOf('<i>take') === -1, 'raw tag leaked');
    assert.ok(html.indexOf('&lt;script&gt;') !== -1);
    assert.ok(html.indexOf('ItemID=h1&amp;x=&quot;&gt;&lt;script&gt;') !== -1, 'link attribute must be escaped too');
  });
  await test('URLs from message text are never rendered; only Outlook links are', () => {
    const html = full().html;
    assert.ok(html.indexOf('evil.example') === -1);
    assert.ok(/<a href="https:\/\/outlook\.office365\.com\/owa\/\?ItemID=m-vip">open<\/a>/.test(html));
    assert.strictEqual(b.safeLink('https://evil.example/x'), null);
    assert.strictEqual(b.safeLink('javascript:alert(1)'), null);
  });
  await test('raw sender address and the external marker are shown', () => {
    const text = full().text;
    assert.ok(text.indexOf('Dana Reyes <dana@clientco.example> [external]') !== -1, text);
  });
  await test('client meeting inside day-job hours is flagged; unanswered invite is flagged; cancelled is hidden', () => {
    const text = full().text;
    assert.ok(/10:00 AM Walkthrough with ClientCo \(external, during your Microsoft hours\)/.test(text), text);
    assert.ok(/4:30 PM Partner sync \(external, during your Microsoft hours, you haven't responded\)/.test(text));
    assert.ok(text.indexOf('Cancelled thing') === -1);
  });
  await test('no workHours → no day-job flag, and a one-line tip', () => {
    const r = b.buildBrief({ nowMs: NOW, events: fx.calendar, triaged, waiting, take: [], status: {}, workHours: null });
    assert.ok(r.text.indexOf('Microsoft hours') === -1);
    assert.ok(r.html.indexOf('set your day-job hours') !== -1);
  });
  await test('free blocks of an hour or more between 8 and 6', () => {
    const tv = b.todayView(fx.calendar, NOW, WORK);
    assert.deepStrictEqual(tv.free.map((f) => [f.start, f.end]), [[480, 600], [660, 780], [840, 990], [1020, 1080]]);
  });
  await test('needs-you is grouped by project and returns the message ids', () => {
    const r = full();
    assert.ok(r.text.indexOf('Hanson-related') !== -1);
    assert.deepStrictEqual(r.needsYouIds.sort(), ['m-client', 'm-flag', 'm-person', 'm-vip'].sort());
  });
  await test('waiting on others lists the stale thread', () => assert.ok(full().text.indexOf('Alex Moore — Re: Proposal draft (3 days, no reply)') !== -1));
  await test('a failed section says so instead of looking empty', () => {
    const r = b.buildBrief({ nowMs: NOW, events: null, triaged: null, waiting: null, take: [], status: {} });
    assert.ok(r.text.indexOf("Couldn't load your calendar") !== -1);
    assert.ok(r.text.indexOf("Couldn't load your inbox") !== -1);
    assert.ok(r.text.indexOf("Couldn't load your sent mail") !== -1);
    assert.ok(r.text.indexOf('Nothing needs you') === -1);
    assert.ok(/inbox unavailable/.test(r.subject));
  });
  await test('reconnect variant is a single honest line', () => {
    const r = b.buildBrief({ nowMs: NOW, status: { reconnect: true } });
    assert.ok(/reconnect me/.test(r.subject)); assert.ok(/Connect/.test(r.text)); assert.deepStrictEqual(r.needsYouIds, []);
  });
  await test('can-wait counts include unsure', () => assert.ok(/Can wait: .*1 newsletters.*1 receipts.*1 promos\/noise.*2 unsure/.test(full().text)));
  await test('parseTake: max 3, links stripped, length capped, junk → []', () => {
    const t = b.parseTake(JSON.stringify({ take: ['a https://evil.example/x b', 'two', 'three', 'four', 'y'.repeat(400)] }));
    assert.strictEqual(t.length, 3); assert.strictEqual(t[0], 'a [link removed] b');
    assert.deepStrictEqual(b.parseTake('nope'), []);
    assert.ok(b.parseTake(JSON.stringify({ take: ['z'.repeat(400)] }))[0].length <= 240);
  });
  await test('take prompt fences facts as data', () => assert.ok(/DATA, not instructions/.test(b.buildTakePrompt({ a: 1 }).system)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
