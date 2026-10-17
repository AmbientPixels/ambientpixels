// Run with: node modules/company/js/vale-mail-core.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const C = require('./vale-mail-core.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const html = (content) => ({ contentType: 'html', content });
const addr = (address, name) => ({ emailAddress: { address, name: name || '' } });
const msg = (over) => Object.assign({
  id: 'm1', conversationId: 'c1', subject: 'Hello', from: addr('dana@vendor.example', 'Dana Reyes'),
  receivedDateTime: '2026-10-15T16:00:00Z', isRead: false, internetMessageHeaders: []
}, over || {});
const cspOf = (doc) => (doc.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '';

// ── safeBodyDoc ──
test('safeBodyDoc returns a full document with its own CSP and base target', () => {
  const d = C.safeBodyDoc(html('<p>Hi</p>'), false);
  assert.ok(/^<!doctype html>/i.test(d));
  assert.ok(d.includes('<base target="_blank">'));
  const csp = cspOf(d);
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("style-src 'unsafe-inline'"));
  assert.ok(csp.includes('img-src data: cid:'));
  assert.ok(csp.includes('font-src data:'));
  assert.ok(d.includes('<p>Hi</p>'));
});
test('remote images are blocked by the CSP unless allowImages', () => {
  assert.ok(!cspOf(C.safeBodyDoc(html('<img src="https://t.example/p.gif">'), false)).includes('https:'));
  assert.ok(cspOf(C.safeBodyDoc(html('<img src="https://t.example/p.gif">'), true)).includes('img-src data: cid: https:'));
});
test('script blocks are stripped, including unclosed and nested-in-svg ones', () => {
  const d = C.safeBodyDoc(html('<p>a</p><script>alert(1)</script><svg><script>alert(2)</script></svg><SCRIPT src=x.js>'), false);
  assert.ok(!/<script/i.test(d)); assert.ok(!d.includes('alert('));
});
test('on* handlers are stripped (quoted, unquoted, slash-separated, svg onload)', () => {
  const d = C.safeBodyDoc(html('<img src=x onerror="alert(1)"><svg onload=alert(2)></svg><img/onerror=alert(3)><a href="#" OnClick=\'x()\'>l</a><img alt=">" onerror=alert(4)>'), false);
  assert.ok(!/\son[a-z]+\s*=/i.test(d) && !/\/on[a-z]+\s*=/i.test(d), d);
  assert.ok(!d.includes('alert('));
});
test('meta http-equiv (refresh, CSP) is stripped; only our CSP meta remains', () => {
  const d = C.safeBodyDoc(html('<meta http-equiv="refresh" content="0;url=https://evil.example"><meta http-equiv="Content-Security-Policy" content="default-src *"><p>x</p>'), false);
  assert.ok(!/refresh/i.test(d));
  assert.strictEqual((d.match(/http-equiv/gi) || []).length, 1);
  assert.ok(!d.includes('default-src *'));
});
test('javascript:, vbscript: and data:text/html URLs are neutralised, even when obfuscated', () => {
  const d = C.safeBodyDoc(html('<a href="javascript:alert(1)">a</a><a href=" JaVa&#x09;Script:alert(2)">b</a><a href="vbscript:x">c</a><a href="data:text/html,<script>x</script>">d</a><iframe src="javascript:x"></iframe>'), false);
  assert.ok(!/javascript:/i.test(d.replace(/&#x09;/g, '')) && !/java&#x09;script/i.test(d));
  assert.ok(!/vbscript:/i.test(d)); assert.ok(!/data:text\/html/i.test(d));
});
test('named-entity obfuscation (&colon; &Tab; &NewLine;) and svg xlink:href cannot smuggle javascript:', () => {
  const d = C.safeBodyDoc(html('<a href="javascript&colon;alert(1)">a</a><a href="java&Tab;script:alert(2)">b</a><a href="jav&NewLine;ascript:alert(3)">c</a><svg><a xlink:href="javascript:alert(4)"><text>t</text></a></svg>'), false);
  assert.ok(!d.includes('alert('), d);
});
test('only raster data: images survive in src; svg data URIs and data: links do not', () => {
  const d = C.safeBodyDoc(html('<img src="data:image/png;base64,AAAA"><img src="data:image/svg+xml,<svg onload=x>"><a href="data:image/png;base64,AA">l</a>'), false);
  assert.ok(d.includes('src="data:image/png;base64,AAAA"'));
  assert.ok(!d.includes('svg+xml')); assert.ok(!d.includes('href="data:'));
});
test('ordinary links survive', () => {
  const d = C.safeBodyDoc(html('<a href="https://ok.example/page?a=1&amp;b=2">ok</a> <a href="mailto:x@y.example">m</a>'), false);
  assert.ok(d.includes('href="https://ok.example/page?a=1&amp;b=2"')); assert.ok(d.includes('href="mailto:x@y.example"'));
});
test('embedding and navigation tags are removed (iframe, object, embed, base, link, form)', () => {
  const d = C.safeBodyDoc(html('<base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/x.css"><iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><form action="https://evil.example/steal" method="post"><input name="pw"><button formaction="https://evil.example">Go</button></form>'), false);
  assert.ok(!/<iframe|<object|<embed|<link|<form/i.test(d));
  assert.strictEqual((d.match(/<base/gi) || []).length, 1);
  assert.ok(!d.includes('evil.example'));
});
test('ping and srcdoc attributes are removed', () => {
  const d = C.safeBodyDoc(html('<a href="https://ok.example" ping="https://track.example">x</a><div srcdoc="<script>">y</div>'), false);
  assert.ok(!/ping=/i.test(d)); assert.ok(!/srcdoc=/i.test(d));
});
test('HTML comments are removed (no comment-smuggled tags)', () => {
  const d = C.safeBodyDoc(html('<!--<script>alert(1)</script>--><p>a</p><!--[if mso]><x><![endif]-->'), false);
  assert.ok(!d.includes('<!--')); assert.ok(!d.includes('alert('));
});
test('an email\'s own html/head/body wrapper is unwrapped, its <style> kept, <title> dropped', () => {
  const d = C.safeBodyDoc(html('<!DOCTYPE html><html><head><title>Secret title</title><style>p{color:red}</style></head><body class="x"><p>Body</p></body></html>'), false);
  assert.strictEqual((d.match(/<body/gi) || []).length, 1);
  assert.ok(d.includes('p{color:red}')); assert.ok(!d.includes('Secret title')); assert.ok(d.includes('<p>Body</p>'));
});
test('text bodies are escaped inside <pre>', () => {
  const d = C.safeBodyDoc({ contentType: 'text', content: 'a < b & <script>x</script>' }, false);
  assert.ok(d.includes('<pre')); assert.ok(d.includes('a &lt; b &amp; &lt;script&gt;'));
  assert.ok(!/<script/i.test(d));
});
test('a missing body yields an empty but valid document', () => {
  const d = C.safeBodyDoc(null, false);
  assert.ok(/^<!doctype html>/i.test(d)); assert.ok(cspOf(d).includes("default-src 'none'"));
});
test('cid: images are swapped for data: URLs when an inline map is given', () => {
  const d = C.safeBodyDoc(html('<img src="cid:logo1@x">'), false, { 'logo1@x': 'data:image/png;base64,AAAA' });
  assert.ok(d.includes('src="data:image/png;base64,AAAA"'));
});

// ── hasRemoteImages ──
test('hasRemoteImages finds http, https and protocol-relative img src', () => {
  assert.strictEqual(C.hasRemoteImages('<img src="https://a.example/x.png">'), true);
  assert.strictEqual(C.hasRemoteImages("<IMG SRC='http://a.example/x.png'>"), true);
  assert.strictEqual(C.hasRemoteImages('<img src=//a.example/x.png>'), true);
});
test('hasRemoteImages finds srcset and CSS url()', () => {
  assert.strictEqual(C.hasRemoteImages('<img src="cid:a" srcset="https://a.example/x2.png 2x">'), true);
  assert.strictEqual(C.hasRemoteImages('<td style="background:url(\'https://a.example/bg.png\')">'), true);
  assert.strictEqual(C.hasRemoteImages('<style>.h{background-image:url(//a.example/b.png)}</style>'), true);
  assert.strictEqual(C.hasRemoteImages('<table background="https://a.example/bg.png">'), true);
});
test('hasRemoteImages ignores data:, cid: and links', () => {
  assert.strictEqual(C.hasRemoteImages('<img src="data:image/png;base64,AA"><img src="cid:x"><a href="https://a.example">x</a>'), false);
  assert.strictEqual(C.hasRemoteImages(''), false);
  assert.strictEqual(C.hasRemoteImages(null), false);
});

// ── htmlToText / textToHtml ──
test('htmlToText turns blocks into lines and decodes entities', () => {
  assert.strictEqual(C.htmlToText('<p>Hi&nbsp;Chad,</p><p>Can we meet &amp; talk?<br>Thanks</p>'), 'Hi Chad,\nCan we meet & talk?\nThanks');
});
test('htmlToText drops style, script and head content', () => {
  assert.strictEqual(C.htmlToText('<head><title>T</title><style>p{}</style></head><script>x()</script><div>Body &lt;3 &#39;ok&#39; &#x41;</div>'), "Body <3 'ok' A");
});
test('htmlToText collapses runs of blank lines', () => {
  assert.strictEqual(C.htmlToText('<div>a</div><div></div><div></div><div></div><div>b</div>'), 'a\n\nb');
});
test('textToHtml escapes and turns newlines into <br>', () => {
  assert.strictEqual(C.textToHtml('a < b & "c"\r\nnext'), 'a &lt; b &amp; &quot;c&quot;<br>next');
  assert.strictEqual(C.textToHtml(null), '');
});

// ── replyTargets / replyToMismatch ──
test('replyTargets uses Reply-To when present', () => {
  const t = C.replyTargets(msg({ replyTo: [addr('Help@Desk.example', 'Help desk')] }));
  assert.deepStrictEqual(t, [{ name: 'Help desk', address: 'help@desk.example' }]);
});
test('replyTargets falls back to From', () => {
  assert.deepStrictEqual(C.replyTargets(msg({ replyTo: [] })), [{ name: 'Dana Reyes', address: 'dana@vendor.example' }]);
  assert.deepStrictEqual(C.replyTargets(msg()), [{ name: 'Dana Reyes', address: 'dana@vendor.example' }]);
  assert.deepStrictEqual(C.replyTargets({}), []);
});
test('replyToMismatch flags a Reply-To that differs from From', () => {
  const r = C.replyToMismatch(msg({ replyTo: [addr('dana.reyes@freemail.example', 'Dana Reyes')] }));
  assert.deepStrictEqual(r, { from: { name: 'Dana Reyes', address: 'dana@vendor.example' }, replyTo: [{ name: 'Dana Reyes', address: 'dana.reyes@freemail.example' }] });
});
test('replyToMismatch is null when Reply-To matches From case-insensitively, or is absent', () => {
  assert.strictEqual(C.replyToMismatch(msg({ replyTo: [addr('DANA@Vendor.example')] })), null);
  assert.strictEqual(C.replyToMismatch(msg()), null);
  assert.strictEqual(C.replyToMismatch(null), null);
});

// ── findQuestion ──
test('findQuestion returns the first question sentence', () => {
  assert.strictEqual(C.findQuestion('Thanks for the deck. Could we move the call to Thursday? Also, budget is fine.'), 'Could we move the call to Thursday?');
});
test('findQuestion ignores questions in quoted history', () => {
  assert.strictEqual(C.findQuestion('Sounds good, see you then.\n\nOn Tue, Oct 14, 2026 at 9:00 AM Chad Martin wrote:\n> Can you do Thursday?'), null);
  assert.strictEqual(C.findQuestion('Noted.\n> Are you in?'), null);
  assert.strictEqual(C.findQuestion('Fine.\n-----Original Message-----\nFrom: x\nWill it work?'), null);
  assert.strictEqual(C.findQuestion('Fine.\n________________________________\nFrom: Dana\nSent: Monday\nWill it work?'), null);
  assert.strictEqual(C.findQuestion('Great.\n\nFrom: Dana Reyes <dana@vendor.example>\nSent: Monday\nWill it work?'), null);
});
test('findQuestion returns null when there is no question, and caps at 200 chars', () => {
  assert.strictEqual(C.findQuestion('Just an update. All good.'), null);
  assert.strictEqual(C.findQuestion(''), null);
  assert.strictEqual(C.findQuestion(null), null);
  const long = 'Would ' + 'very '.repeat(60) + 'long work?';
  assert.strictEqual(C.findQuestion(long + ' Short one?'), 'Short one?');
  const q = C.findQuestion('Hi Chad,\nAre you free on the 20th?');
  assert.strictEqual(q, 'Are you free on the 20th?');
});

// ── threadStrip ──
test('threadStrip counts messages, those from me, and the latest time', () => {
  const t = C.threadStrip([
    msg({ receivedDateTime: '2026-10-10T10:00:00Z' }),
    msg({ from: addr('Chad@AmbientPixels.ai'), sentDateTime: '2026-10-12T10:00:00Z', receivedDateTime: undefined }),
    msg({ receivedDateTime: '2026-10-14T10:00:00Z' })
  ], 'chad@ambientpixels.ai');
  assert.deepStrictEqual(t, { count: 3, fromMe: 1, latestAt: '2026-10-14T10:00:00Z' });
});
test('threadStrip handles empty input and a {mail} me', () => {
  assert.deepStrictEqual(C.threadStrip([], 'x@y.example'), { count: 0, fromMe: 0, latestAt: null });
  assert.strictEqual(C.threadStrip([msg({ from: addr('me@x.example') })], { mail: 'ME@x.example' }).fromMe, 1);
});

// ── waitingOnYou ──
const NOW = Date.parse('2026-10-17T16:00:00Z');
const OPTS = { ownDomain: 'ambientpixels.ai' };
test('waitingOnYou: external, unanswered, older than 24h → since', () => {
  assert.deepStrictEqual(C.waitingOnYou(msg(), [], NOW, OPTS), { since: '2026-10-15T16:00:00Z' });
});
test('waitingOnYou: null when answered after it arrived', () => {
  assert.strictEqual(C.waitingOnYou(msg(), [{ sentDateTime: '2026-10-16T09:00:00Z' }], NOW, OPTS), null);
  assert.deepStrictEqual(C.waitingOnYou(msg(), [{ sentDateTime: '2026-10-14T09:00:00Z' }], NOW, OPTS), { since: '2026-10-15T16:00:00Z' });
});
test('waitingOnYou: null when under 24h, internal, or a newsletter', () => {
  assert.strictEqual(C.waitingOnYou(msg({ receivedDateTime: '2026-10-17T00:00:00Z' }), [], NOW, OPTS), null);
  assert.strictEqual(C.waitingOnYou(msg({ from: addr('vale@ambientpixels.ai') }), [], NOW, OPTS), null);
  assert.strictEqual(C.waitingOnYou(msg({ internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<x>' }] }), [], NOW, OPTS), null);
  assert.strictEqual(C.waitingOnYou(msg({ from: addr('noreply@vendor.example') }), [], NOW, OPTS), null);
  assert.strictEqual(C.waitingOnYou(null, [], NOW, OPTS), null);
});

// ── bucketOf / counts ──
test('bucketOf maps labels to buckets', () => {
  assert.strictEqual(C.bucketOf(msg(), 'needs_you'), 'needs_you');
  assert.strictEqual(C.bucketOf(msg(), { label: 'waiting', why: 'x' }), 'waiting');
  assert.strictEqual(C.bucketOf(msg(), 'noise'), 'newsletter');
  assert.strictEqual(C.bucketOf(msg(), 'newsletter'), 'newsletter');
  assert.strictEqual(C.bucketOf(msg(), 'fyi'), 'set_aside');
  assert.strictEqual(C.bucketOf(msg(), 'receipt'), 'set_aside');
  assert.strictEqual(C.bucketOf(msg(), 'unsure'), 'other');
  assert.strictEqual(C.bucketOf(msg(), null), 'other');
});
test('bucketOf: a List-Unsubscribe header makes it a newsletter; a flag makes it needs_you', () => {
  assert.strictEqual(C.bucketOf(msg({ internetMessageHeaders: [{ name: 'list-unsubscribe', value: '<x>' }] }), 'fyi'), 'newsletter');
  assert.strictEqual(C.bucketOf(msg({ flag: { flagStatus: 'flagged' }, internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<x>' }] }), 'noise'), 'needs_you');
});
test('counts tallies buckets over a label map', () => {
  const ms = [msg({ id: 'a' }), msg({ id: 'b' }), msg({ id: 'c' }), msg({ id: 'd' }), msg({ id: 'e' })];
  const labels = { a: { label: 'needs_you' }, b: 'needs_you', c: 'noise', d: 'fyi' };
  assert.deepStrictEqual(C.counts(ms, labels), { needs_you: 2, waiting: 0, newsletter: 1, set_aside: 1, all: 5 });
  assert.deepStrictEqual(C.counts(null, null), { needs_you: 0, waiting: 0, newsletter: 0, set_aside: 0, all: 0 });
});

// ── isClientMsg ──
test('isClientMsg matches client domains on sender or recipients', () => {
  assert.strictEqual(C.isClientMsg(msg({ from: addr('kim@ClientCo.example') }), ['clientco.example']), true);
  assert.strictEqual(C.isClientMsg(msg({ from: addr('kim@eu.clientco.example') }), ['@clientco.example']), true);
  assert.strictEqual(C.isClientMsg(msg({ from: addr('chad@ambientpixels.ai'), toRecipients: [addr('kim@clientco.example')] }), ['clientco.example']), true);
  assert.strictEqual(C.isClientMsg(msg({ from: addr('kim@notclientco.example') }), ['clientco.example']), false);
  assert.strictEqual(C.isClientMsg(msg(), []), false);
});

// ── searchQuery ──
test('searchQuery keeps safe characters and trims', () => {
  assert.strictEqual(C.searchQuery('  invoice  q3 '), 'invoice q3');
  assert.strictEqual(C.searchQuery('dana@vendor.example'), 'dana@vendor.example');
  assert.strictEqual(C.searchQuery('"kickoff deck"'), '"kickoff deck"');
});
test('searchQuery strips KQL/URL-breaking characters, unbalanced quotes, and caps at 80', () => {
  assert.strictEqual(C.searchQuery('a&b=c#d?e(f)*'), 'a b c d e f');
  assert.strictEqual(C.searchQuery('"open quote'), 'open quote');
  assert.strictEqual(C.searchQuery('x'.repeat(200)).length, 80);
});
test('searchQuery returns null for empty or non-string input', () => {
  assert.strictEqual(C.searchQuery(''), null);
  assert.strictEqual(C.searchQuery('  ##  '), null);
  assert.strictEqual(C.searchQuery(42), null);
});

// ── sendMachine ──
test('sendMachine walks the happy path idle→drafting→ready→countdown→sending→sent', () => {
  const m = C.sendMachine();
  assert.strictEqual(m.state, 'idle');
  ['draft', 'drafted', 'send', 'elapse', 'sent'].forEach((a) => m.next(a));
  assert.strictEqual(m.state, 'sent');
});
test('sendMachine rejects send from idle', () => {
  const m = C.sendMachine();
  assert.strictEqual(m.can('send'), false);
  assert.throws(() => m.next('send'), /bad_transition/);
  assert.strictEqual(m.state, 'idle');
});
test('sendMachine undo: countdown→undone→ready, and can send again', () => {
  const m = C.sendMachine();
  m.next('edit'); m.next('send'); m.next('undo');
  assert.strictEqual(m.state, 'undone');
  assert.strictEqual(m.can('elapse'), false);
  m.next('edit'); assert.strictEqual(m.state, 'ready');
  m.next('send'); assert.strictEqual(m.state, 'countdown');
});
test('sendMachine failure: sending→failed→ready; never back to countdown directly', () => {
  const m = C.sendMachine();
  m.next('edit'); m.next('send'); m.next('elapse'); m.next('fail');
  assert.strictEqual(m.state, 'failed');
  assert.strictEqual(m.can('send'), false);
  m.next('edit'); assert.strictEqual(m.state, 'ready');
});
test('sendMachine: undo is impossible once sending; sent is final until reset', () => {
  const m = C.sendMachine();
  m.next('edit'); m.next('send'); m.next('elapse');
  assert.strictEqual(m.can('undo'), false);
  m.next('sent');
  ['send', 'undo', 'edit', 'draft'].forEach((a) => assert.strictEqual(m.can(a), false, a));
  m.next('reset'); assert.strictEqual(m.state, 'idle');
});
test('sendMachine: a failed draft returns to idle; ready can re-draft or discard', () => {
  const m = C.sendMachine();
  m.next('draft'); m.next('draftFailed'); assert.strictEqual(m.state, 'idle');
  m.next('draft'); m.next('drafted'); m.next('draft'); assert.strictEqual(m.state, 'drafting');
  m.next('drafted'); m.next('discard'); assert.strictEqual(m.state, 'idle');
  assert.strictEqual(m.can('nonsense'), false);
});

// ── shortcutFor ──
const ev = (key, over) => Object.assign({ key, ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'BODY' } }, over || {});
test('shortcutFor maps every documented key', () => {
  const map = { j: 'next', k: 'prev', Enter: 'open', e: 'archive', r: 'reply', d: 'draft', f: 'flag', u: 'unread', '/': 'search', '?': 'help', Escape: 'close', Esc: 'close' };
  Object.keys(map).forEach((k) => assert.strictEqual(C.shortcutFor(ev(k)), map[k], k));
});
test('shortcutFor ignores modifier combos', () => {
  assert.strictEqual(C.shortcutFor(ev('r', { ctrlKey: true })), null);
  assert.strictEqual(C.shortcutFor(ev('r', { metaKey: true })), null);
  assert.strictEqual(C.shortcutFor(ev('e', { altKey: true })), null);
});
test('shortcutFor ignores typing in inputs, textareas, selects and contenteditable', () => {
  assert.strictEqual(C.shortcutFor(ev('j', { target: { tagName: 'INPUT' } })), null);
  assert.strictEqual(C.shortcutFor(ev('j', { target: { tagName: 'textarea' } })), null);
  assert.strictEqual(C.shortcutFor(ev('j', { target: { tagName: 'SELECT' } })), null);
  assert.strictEqual(C.shortcutFor(ev('j', { target: { tagName: 'DIV', isContentEditable: true } })), null);
});
test('shortcutFor returns null for unknown keys and bad events', () => {
  assert.strictEqual(C.shortcutFor(ev('x')), null);
  assert.strictEqual(C.shortcutFor(ev('J')), null);
  assert.strictEqual(C.shortcutFor(null), null);
});

// ── Product config + demo fixture ──
const DATA = path.join(__dirname, '..', '..', '..', 'data');
const product = JSON.parse(fs.readFileSync(path.join(DATA, 'vale-mail-product.json'), 'utf8'));
const demo = JSON.parse(fs.readFileSync(path.join(DATA, 'vale-mail-demo.json'), 'utf8'));
const allMsgs = () => [].concat(demo.folders.inbox || [], demo.folders.sentitems || [], demo.folders.archive || []);

test('product config has every field and ships unconfigured (clientId empty, demo default)', () => {
  ['productName', 'agent', 'tenantId', 'clientId', 'valeScope', 'ownDomain', 'graphScopes', 'demoDefault', 'copy'].forEach((k) => assert.ok(k in product, k));
  assert.strictEqual(product.clientId, '');
  assert.strictEqual(product.demoDefault, true);
  assert.strictEqual(product.agent.color.toLowerCase(), '#9b8cff');
  ['User.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.Read'].forEach((s) => assert.ok(product.graphScopes.includes(s), s));
  assert.ok(/access_as_user$/.test(product.valeScope));
});
test('product config carries no other company\'s names', () => {
  assert.ok(!/hanson|clerk/i.test(JSON.stringify(product)));
  assert.ok(!/hanson|clerk/i.test(JSON.stringify(demo)));
});
test('fixture has ~45 messages across inbox, sent and archive with unique ids', () => {
  const all = allMsgs();
  assert.ok(all.length >= 40 && all.length <= 60, String(all.length));
  ['inbox', 'sentitems', 'archive'].forEach((f) => assert.ok(demo.folders[f].length > 0, f));
  assert.strictEqual(new Set(all.map((m) => m.id)).size, all.length);
  assert.ok(Array.isArray(demo.folderList) && demo.folderList.length >= 3);
});
test('fixture people are invented: every non-Chad/Vale address is on a .example domain', () => {
  const own = product.ownDomain;
  const seen = [];
  allMsgs().forEach((m) => [m.from].concat(m.toRecipients || [], m.ccRecipients || [], m.replyTo || []).forEach((r) => r && seen.push(r.emailAddress.address.toLowerCase())));
  (demo.calendar || []).forEach((e) => (e.attendees || []).forEach((a) => seen.push(a.emailAddress.address.toLowerCase())));
  seen.forEach((a) => assert.ok(/\.example$/.test(a) || a === 'chad@' + own || a === 'vale@' + own, a));
});
test('fixture covers the edges: phishing Reply-To, remote-image newsletter, client thread, attachments, inline cid, text body', () => {
  const inbox = demo.folders.inbox;
  assert.ok(inbox.some((m) => C.replyToMismatch(m)), 'phishing');
  assert.ok(inbox.some((m) => C.bucketOf(m, null) === 'newsletter' && C.hasRemoteImages(m.body.content)), 'newsletter');
  assert.ok(inbox.filter((m) => C.isClientMsg(m, demo.rules.rulesOnlyDomains)).length >= 2, 'client thread');
  assert.ok(Object.keys(demo.attachments).length >= 2);
  Object.keys(demo.attachments).forEach((id) => assert.ok(allMsgs().some((m) => m.id === id && m.hasAttachments), id));
  assert.ok(Object.values(demo.attachments).some((list) => list.some((a) => a.isInline && a.contentId)), 'inline');
  assert.ok(inbox.some((m) => m.body.contentType === 'text'), 'text body');
  assert.ok(inbox.some((m) => C.findQuestion(C.htmlToText(m.body.content))), 'question');
});
test('fixture threads span inbox and sent, so the thread strip and waiting-on-others have data', () => {
  const sentConvs = new Set(demo.folders.sentitems.map((m) => m.conversationId));
  assert.ok(demo.folders.inbox.filter((m) => sentConvs.has(m.conversationId)).length >= 3);
  assert.ok(Object.values(demo.labels).some((l) => l.label === 'waiting'));
});
test('fixture labels point at real messages, use known labels, and leave a few unsorted', () => {
  const ids = new Set(allMsgs().map((m) => m.id));
  const known = ['needs_you', 'waiting', 'fyi', 'noise', 'newsletter', 'receipt', 'unsure'];
  Object.keys(demo.labels).forEach((id) => {
    assert.ok(ids.has(id), id);
    assert.ok(known.includes(demo.labels[id].label), demo.labels[id].label);
    assert.ok(demo.labels[id].why && demo.labels[id].why.length <= 120);
  });
  const unsorted = demo.folders.inbox.filter((m) => !demo.labels[m.id]);
  assert.ok(unsorted.length >= 2 && unsorted.length < demo.folders.inbox.length / 3, String(unsorted.length));
});
test('fixture has today+tomorrow calendar, canned drafts per stance, and a me + anchor', () => {
  assert.ok(demo.calendar.length >= 3);
  const anchorDay = demo.anchor.slice(0, 10);
  assert.ok(demo.calendar.some((e) => e.start.dateTime.slice(0, 10) === anchorDay));
  assert.ok(demo.calendar.some((e) => e.start.dateTime.slice(0, 10) > anchorDay));
  ['yes', 'no', 'later', 'more', 'ack', 'compose', 'default'].forEach((s) => assert.ok(typeof demo.drafts[s] === 'string' && demo.drafts[s].length > 10, s));
  assert.strictEqual(demo.me.mail, 'chad@' + product.ownDomain);
  assert.ok(!isNaN(Date.parse(demo.anchor)));
});
test('every fixture body renders safely and every message has the fields the UI reads', () => {
  allMsgs().forEach((m) => {
    ['id', 'conversationId', 'subject', 'bodyPreview', 'body', 'from', 'toRecipients', 'isRead', 'hasAttachments'].forEach((k) => assert.ok(k in m, m.id + ' ' + k));
    assert.ok(m.receivedDateTime || m.sentDateTime, m.id);
    const d = C.safeBodyDoc(m.body, false);
    assert.ok(!/<script/i.test(d), m.id);
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
