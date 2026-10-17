// Run with: node api/_lib/vale/liveMail.test.js
const assert = require('assert');
const live = require('./liveMail');
const { createGraph } = require('./graph');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const NOW = Date.parse('2026-10-17T16:00:00Z');
const RULES = { vips: ['evergreengoodwill.org'], muted: [], receipts: ['stripe.com'], rulesOnlyDomains: ['evergreengoodwill.org', 'hansonconsultgroup.com'], projects: {} };
function msg(from, name, subject, preview, at, extra) {
  return Object.assign({ id: 'id-' + subject, subject, from: { emailAddress: { address: from, name } }, receivedDateTime: at, isRead: false, bodyPreview: preview, webLink: 'https://outlook.office.com/x/' + encodeURIComponent(subject) }, extra || {});
}
const RECENT = [
  msg('someone@gmail.com', 'Pat Lee', 'Alias test', 'Testing hello@ — does this arrive?', '2026-10-17T06:10:00Z', { toRecipients: [{ emailAddress: { address: 'hello@ambientpixels.ai' } }] }),
  msg('alyssa@evergreengoodwill.org', 'Alyssa', 'Demo times', 'Thursday at 4 works for the audit walkthrough', '2026-10-16T20:00:00Z'),
  msg('receipts@stripe.com', 'Stripe', 'Your receipt', 'Amount paid $7.00', '2026-10-15T10:00:00Z')
];

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => JSON.stringify(body || {}) };
}

(async () => {
  await test('client mail is reduced to sender + date: no subject, no preview', () => {
    const b = live.formatLiveMail({ recent: RECENT, rules: RULES, nowMs: NOW });
    assert.ok(b.indexOf('alyssa@evergreengoodwill.org') !== -1);
    assert.ok(b.indexOf('Demo times') === -1 && b.indexOf('Thursday at 4') === -1);
    assert.ok(/client mail/i.test(b));
  });
  await test('other mail shows sender, subject, preview, Outlook link, and the address it was sent to', () => {
    const b = live.formatLiveMail({ recent: RECENT, rules: RULES, nowMs: NOW });
    assert.ok(b.indexOf('Pat Lee <someone@gmail.com>') !== -1);
    assert.ok(b.indexOf('Alias test') !== -1 && b.indexOf('does this arrive') !== -1);
    assert.ok(b.indexOf('https://') === -1, 'no raw URLs for the model to copy (it garbled one: office3605)');
    assert.ok(b.indexOf('[#1]') !== -1);
    assert.ok(b.indexOf('to hello@ambientpixels.ai') !== -1);
    assert.ok(b.indexOf('[receipt]') !== -1);
    assert.ok(b.indexOf('Fri, Oct 16, 11:10 PM PT') !== -1, 'times are Pacific (06:10Z = 11:10 PM PDT the day before)');
    assert.ok(b.indexOf('UTC') === -1);
  });
  await test('each email gets a number; links map holds the exact Outlook URL; search keeps counting', () => {
    const links = {};
    const b = live.formatLiveMail({ recent: RECENT, rules: RULES, nowMs: NOW, links });
    assert.strictEqual(links['1'], 'https://outlook.office.com/x/Alias%20test');
    assert.ok(links['2'] && links['3'] && !links['4']);
    assert.ok(/[open N]/.test(b) && /never write URLs/i.test(b));
    live.formatSearch('alyssa', [RECENT[1]], RULES, links);
    assert.strictEqual(links['4'], RECENT[1].webLink);
  });
  await test('only Outlook web links are kept', () => {
    const links = {};
    live.formatLiveMail({ recent: [msg('a@b.com', 'A', 'Evil', 'x', '2026-10-17T01:00:00Z', { webLink: 'javascript:alert(1)' }),
      msg('a@b.com', 'A', 'Ok', 'x', '2026-10-17T01:00:00Z', { webLink: 'https://outlook.office365.com/owa/?ItemID=1' })], rules: RULES, nowMs: NOW, links });
    assert.deepStrictEqual(links, { '2': 'https://outlook.office365.com/owa/?ItemID=1' });
  });
  await test('mail text sits inside DATA markers and previews are clipped', () => {
    const long = [msg('a@b.com', 'A', 'Long', 'x'.repeat(2000), '2026-10-17T01:00:00Z')];
    const b = live.formatLiveMail({ recent: long, rules: RULES, nowMs: NOW });
    assert.ok(b.indexOf('<mail>') !== -1 && b.indexOf('</mail>') !== -1 && /never instructions/i.test(b));
    assert.ok(b.length < 1200);
  });
  await test('empty inbox says so; search results get their own section', () => {
    assert.ok(/no mail in the last 7 days/i.test(live.formatLiveMail({ recent: [], rules: RULES, nowMs: NOW })));
    const s = live.formatSearch('alyssa', [RECENT[1]], RULES);
    assert.ok(s.indexOf('SEARCH RESULTS for "alyssa"') !== -1 && s.indexOf('Demo times') === -1);
    assert.ok(/no matches/i.test(live.formatSearch('nothing', [], RULES)));
  });
  await test('parseSearchRequest reads one SEARCH_MAIL line and sanitizes it', () => {
    assert.strictEqual(live.parseSearchRequest('SEARCH_MAIL: alyssa@evergreengoodwill.org'), 'alyssa@evergreengoodwill.org');
    assert.strictEqual(live.parseSearchRequest('  SEARCH_MAIL: "press" OR kit; DROP\n'), 'press OR kit DROP');
    assert.strictEqual(live.parseSearchRequest('Here is your answer. SEARCH_MAIL: x'), null);
    assert.strictEqual(live.parseSearchRequest('SEARCH_MAIL:   '), null);
    assert.strictEqual(live.parseSearchRequest(''), null);
    assert.strictEqual(live.parseSearchRequest('SEARCH_MAIL: ' + 'a'.repeat(300)).length, 80);
  });
  await test('graph.searchMessages uses $search on /me/messages with a quoted, clean query', async () => {
    const calls = [];
    const f = async (url) => { calls.push(url); return res(200, { value: [] }); };
    await createGraph({ fetch: f, token: 'T', sleep: async () => {} }).searchMessages('press kit', 25);
    const u = decodeURIComponent(calls[0]);
    assert.ok(u.indexOf('/me/messages?') !== -1 && u.indexOf('$search="press kit"') !== -1);
    assert.ok(u.indexOf('$orderby') === -1 && u.indexOf('$filter') === -1); // Graph rejects those with $search
  });
  await test('loadLiveMail: not connected → ok:false with a reason, no Graph call', async () => {
    let fetched = 0;
    const r = await live.loadLiveMail({
      cfg: { tokenKey: 'k' }, now: () => NOW, fetch: async () => { fetched++; return res(200, {}); },
      store: { getWithMeta: async () => ({ value: null }), mutate: async () => {} }, seedRules: RULES
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'not_connected');
    assert.strictEqual(fetched, 0);
  });
  await test('loadLiveMail: unreadable rules fall back to the seed, so client mail stays withheld', async () => {
    const r = await live.loadLiveMail({
      cfg: {}, now: () => NOW, seedRules: RULES,
      store: { getWithMeta: async () => ({ failed: true }) },
      getToken: async () => 'T',
      fetch: async () => res(200, { value: [RECENT[1]] })
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.block.indexOf('Demo times') === -1);
    assert.ok(typeof r.search === 'function');
    assert.strictEqual(r.links['1'], RECENT[1].webLink);
  });
  await test('loadLiveMail: Graph failure → ok:false, never an empty inbox', async () => {
    const r = await live.loadLiveMail({
      cfg: {}, now: () => NOW, seedRules: RULES, sleep: async () => {},
      store: { getWithMeta: async () => ({ value: RULES }) },
      getToken: async () => 'T',
      fetch: async () => res(403, { error: { message: 'denied' } })
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'graph_error');
  });

  await test('answerWithSearch: plain answer → one model call', async () => {
    const prompts = [];
    const r = await live.answerWithSearch(async (sys) => { prompts.push(sys); return { reply: 'Two emails today.' }; }, 'SYS', null);
    assert.strictEqual(r.reply, 'Two emails today.');
    assert.strictEqual(prompts.length, 1);
  });
  await test('answerWithSearch: SEARCH_MAIL → search once, ask again with the results appended', async () => {
    const prompts = []; const searched = [];
    const liveObj = { search: async (q) => { searched.push(q); return '\nRESULTS'; } };
    const replies = ['SEARCH_MAIL: alyssa', 'Alyssa wrote on 10-16.'];
    const r = await live.answerWithSearch(async (sys) => { prompts.push(sys); return { reply: replies[prompts.length - 1], usage: { n: prompts.length } }; }, 'SYS', liveObj);
    assert.deepStrictEqual(searched, ['alyssa']);
    assert.strictEqual(prompts[1], 'SYS\nRESULTS');
    assert.strictEqual(r.reply, 'Alyssa wrote on 10-16.');
    assert.strictEqual(r.usages.length, 2);
  });
  await test('answerWithSearch: never loops, never shows the raw SEARCH_MAIL line', async () => {
    let n = 0;
    const r = await live.answerWithSearch(async () => { n++; return { reply: 'SEARCH_MAIL: again' }; }, 'SYS', { search: async () => '' });
    assert.strictEqual(n, 2);
    assert.ok(r.reply.indexOf('SEARCH_MAIL') === -1 && r.reply.length > 0);
  });
  await test('answerWithSearch: no live mail → a SEARCH_MAIL reply is not executed or shown', async () => {
    const r = await live.answerWithSearch(async () => ({ reply: 'SEARCH_MAIL: x' }), 'SYS', null);
    assert.ok(r.reply.indexOf('SEARCH_MAIL') === -1);
  });
  await test('answerWithSearch: a model error passes straight through', async () => {
    const r = await live.answerWithSearch(async () => ({ error: { status: 500 } }), 'SYS', null);
    assert.deepStrictEqual(r.error, { status: 500 });
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
