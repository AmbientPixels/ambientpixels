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

test('images hidden: remote image URLs are removed so nothing is requested (not just CSP-blocked)', () => {
  const src = '<img src="https://track.example/open.gif?u=1" alt="logo"><img srcset="//cdn.example/a.png 2x"><td background="http://x.example/bg.png">' +
    '<div style="background:url(\'https://x.example/b.png\') no-repeat">a</div><style>.h{background-image:url(https://x.example/c.png)}</style><img src="data:image/png;base64,iVBORw==">';
  const off = C.safeBodyDoc(html(src), false);
  assert.ok(!/track\.example|cdn\.example|x\.example/.test(off), 'no remote URL survives when images are hidden');
  assert.ok(off.includes('alt="logo"'), 'alt text kept');
  assert.ok(off.includes('data:image/png;base64,iVBORw=='), 'inline data images kept');
  const on = C.safeBodyDoc(html(src), true);
  assert.ok(on.includes('https://track.example/open.gif?u=1') && on.includes('https://x.example/c.png'), 'Show images keeps them');
});

// ── UI helpers (Task 5): formatting, clash, errors, drafts ──
const UNOW = Date.parse('2026-10-17T22:00:00Z'); // Sat 3:00 PM Pacific
const PT = { timeZone: 'America/Los_Angeles' };
test('formatWhen: time today, Yesterday, weekday this week, month+day this year, full date older', () => {
  assert.strictEqual(C.formatWhen('2026-10-17T21:48:00Z', UNOW, PT), '2:48 PM');
  assert.strictEqual(C.formatWhen('2026-10-16T21:00:00Z', UNOW, PT), 'Yesterday');
  assert.strictEqual(C.formatWhen('2026-10-13T18:00:00Z', UNOW, PT), 'Tue');
  assert.strictEqual(C.formatWhen('2026-08-02T18:00:00Z', UNOW, PT), 'Aug 2');
  assert.strictEqual(C.formatWhen('2025-12-30T18:00:00Z', UNOW, PT), 'Dec 30, 2025');
  assert.strictEqual(C.formatWhen('', UNOW, PT), '');
  assert.strictEqual(C.formatWhen('not a date', UNOW, PT), '');
});
test('formatWhen uses the time zone for the day boundary (late evening Pacific is still today)', () => {
  // 2026-10-18T05:30Z is Oct 17, 10:30 PM Pacific
  assert.strictEqual(C.formatWhen('2026-10-18T05:30:00Z', Date.parse('2026-10-18T06:00:00Z'), PT), '10:30 PM');
});
test('agoText: just now, minutes, hours, yesterday, days, weeks', () => {
  assert.strictEqual(C.agoText(new Date(UNOW - 20000).toISOString(), UNOW, PT), 'just now');
  assert.strictEqual(C.agoText(new Date(UNOW - 5 * 60000).toISOString(), UNOW, PT), '5 min ago');
  assert.strictEqual(C.agoText(new Date(UNOW - 3 * 3600000).toISOString(), UNOW, PT), '3 hours ago');
  assert.strictEqual(C.agoText(new Date(UNOW - 3600000).toISOString(), UNOW, PT), '1 hour ago');
  assert.strictEqual(C.agoText(new Date(UNOW - 30 * 3600000).toISOString(), UNOW, PT), 'yesterday');
  assert.strictEqual(C.agoText(new Date(UNOW - 4 * 86400000).toISOString(), UNOW, PT), '4 days ago');
  assert.strictEqual(C.agoText(new Date(UNOW - 15 * 86400000).toISOString(), UNOW, PT), '2 weeks ago');
  assert.strictEqual(C.agoText(null, UNOW, PT), '');
});
test('formatSize: bytes, KB, MB', () => {
  assert.strictEqual(C.formatSize(512), '512 B');
  assert.strictEqual(C.formatSize(14 * 1024), '14 KB');
  assert.strictEqual(C.formatSize(1.25 * 1024 * 1024), '1.3 MB');
  assert.strictEqual(C.formatSize(-1), '');
  assert.strictEqual(C.formatSize('x'), '');
});
test('firstName: first word of the name, else the address local part, capitalised', () => {
  assert.strictEqual(C.firstName(addr('dana@x.example', 'Dana Reyes')), 'Dana');
  assert.strictEqual(C.firstName({ name: 'Kim  Park', address: 'kim@x.example' }), 'Kim');
  assert.strictEqual(C.firstName(addr('jordan.lee@x.example', '')), 'Jordan');
  assert.strictEqual(C.firstName(addr('', '')), 'there');
  assert.strictEqual(C.firstName(addr('x@y.example', '"Billing, Team"')), 'Billing');
});
test('fillDraft replaces known placeholders only and never leaves a raw {firstName}', () => {
  assert.strictEqual(C.fillDraft('Hi {firstName}, {instruction}. {other}', { firstName: 'Dana', instruction: 'yes to Thursday' }), 'Hi Dana, yes to Thursday. {other}');
  assert.strictEqual(C.fillDraft('Hi {firstName},', {}), 'Hi there,');
  assert.strictEqual(C.fillDraft(null, {}), '');
});
test('eventMs: Graph calendar time without zone is UTC; zoned times parse as given', () => {
  assert.strictEqual(C.eventMs('2026-10-17T17:00:00.0000000'), Date.parse('2026-10-17T17:00:00Z'));
  assert.strictEqual(C.eventMs('2026-10-17T17:00:00Z'), Date.parse('2026-10-17T17:00:00Z'));
  assert.ok(isNaN(C.eventMs('nope')));
});
test('workHoursClash: overlap inside day-job hours on a work day (Pacific)', () => {
  const wh = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', tz: 'America/Los_Angeles' };
  // Fri 2026-10-16 10:00-10:30 PT = 17:00-17:30Z
  assert.strictEqual(C.workHoursClash(Date.parse('2026-10-16T17:00:00Z'), Date.parse('2026-10-16T17:30:00Z'), wh), true);
  // Fri 17:30-18:00 PT (after hours) = 00:30-01:00Z next day
  assert.strictEqual(C.workHoursClash(Date.parse('2026-10-17T00:30:00Z'), Date.parse('2026-10-17T01:00:00Z'), wh), false);
  // Sat 10:00 PT — not a work day
  assert.strictEqual(C.workHoursClash(Date.parse('2026-10-17T17:00:00Z'), Date.parse('2026-10-17T17:30:00Z'), wh), false);
  // Fri 08:30-09:30 PT overlaps the start
  assert.strictEqual(C.workHoursClash(Date.parse('2026-10-16T15:30:00Z'), Date.parse('2026-10-16T16:30:00Z'), wh), true);
});
test('workHoursClash: no hours set, bad times or missing days default safely', () => {
  assert.strictEqual(C.workHoursClash(Date.parse('2026-10-16T17:00:00Z'), Date.parse('2026-10-16T17:30:00Z'), null), false);
  assert.strictEqual(C.workHoursClash(Date.parse('2026-10-16T17:00:00Z'), Date.parse('2026-10-16T17:30:00Z'), { start: 'x', end: '17:00' }), false);
  // days missing → Mon–Fri; tz missing → Pacific
  assert.strictEqual(C.workHoursClash(Date.parse('2026-10-16T17:00:00Z'), Date.parse('2026-10-16T17:30:00Z'), { start: '09:00', end: '17:00' }), true);
});
test('threadText: honest thread strip sentence', () => {
  assert.strictEqual(C.threadText({ count: 6, fromMe: 2, latestAt: new Date(UNOW - 30 * 3600000).toISOString() }, UNOW), 'Thread of 6 · 2 from you · latest yesterday');
  assert.strictEqual(C.threadText({ count: 1, fromMe: 0, latestAt: null }, UNOW), '');
  assert.strictEqual(C.threadText({ count: 2, fromMe: 1, latestAt: new Date(UNOW - 5 * 60000).toISOString() }, UNOW), 'Thread of 2 · 1 from you · latest 5 min ago');
});
test('errorText: plain words per failure, with whether a retry makes sense', () => {
  assert.ok(/offline|connection/i.test(C.errorText({ status: 0, code: 'network' }).text));
  assert.ok(/sign in/i.test(C.errorText({ status: 401 }).text));
  assert.strictEqual(C.errorText({ status: 401 }).signIn, true);
  assert.ok(/slow down|busy/i.test(C.errorText({ status: 429 }).text));
  assert.ok(/isn.t answering|having trouble/i.test(C.errorText({ status: 503 }).text));
  assert.ok(/find/i.test(C.errorText({ status: 404 }).text));
  assert.strictEqual(C.errorText({ status: 503 }).retry, true);
  assert.ok(C.errorText(new Error('boom')).text.length > 5);
  assert.ok(!/boom/.test(C.errorText(new Error('boom')).text), 'never echoes raw error messages');
});
test('labelName: plain names for every triage label, unknown → not sorted', () => {
  assert.strictEqual(C.labelName('needs_you'), 'Needs you');
  assert.strictEqual(C.labelName('waiting'), 'Waiting');
  assert.strictEqual(C.labelName('fyi'), 'FYI');
  assert.strictEqual(C.labelName('receipt'), 'Receipt');
  assert.strictEqual(C.labelName('noise'), 'Low priority');
  assert.strictEqual(C.labelName('newsletter'), 'Newsletter');
  assert.strictEqual(C.labelName('unsure'), 'Unsure');
  assert.strictEqual(C.labelName(undefined), null);
});
test('isAutomated: no-reply, notification and list mail need no answer', () => {
  assert.strictEqual(C.isAutomated(msg({ from: addr('no-reply@x.example') })), true);
  assert.strictEqual(C.isAutomated(msg({ from: addr('notifications@codehub.example') })), true);
  assert.strictEqual(C.isAutomated(msg({ internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<mailto:u@x>' }] })), true);
  assert.strictEqual(C.isAutomated(msg()), false);
});
test('triageLabels: valeMailState → id map, plus waiting threads mark their newest inbox message', () => {
  const st = { at: '2026-10-17T14:00:00Z', triaged: [{ id: 'a', label: 'needs_you', why: 'W', by: 'model' }, { id: 'b', label: null }], waiting: [{ conversationId: 'c9', toName: 'Jordan', days: 4 }] };
  const inbox = [msg({ id: 'x1', conversationId: 'c9', receivedDateTime: '2026-10-10T10:00:00Z' }), msg({ id: 'x2', conversationId: 'c9', receivedDateTime: '2026-10-11T10:00:00Z' })];
  const map = C.triageLabels(st, inbox);
  assert.deepStrictEqual(map.a, { label: 'needs_you', why: 'W', by: 'model' });
  assert.ok(!('b' in map));
  assert.strictEqual(map.x2.label, 'waiting');
  assert.ok(/Jordan/.test(map.x2.why) && /4 days/.test(map.x2.why));
  assert.ok(!('x1' in map));
  assert.deepStrictEqual(C.triageLabels(null, inbox), {});
});
test('bytesToDataUrl: raster images only, base64 encoded', () => {
  const png = new Uint8Array([137, 80, 78, 71]).buffer;
  assert.strictEqual(C.bytesToDataUrl(png, 'image/png'), 'data:image/png;base64,iVBORw==');
  assert.strictEqual(C.bytesToDataUrl(png, 'image/svg+xml'), null);
  assert.strictEqual(C.bytesToDataUrl(png, 'text/html'), null);
});


// ── Round 1 fixes ──
test('links: OS protocol handlers and file: lose their href entirely', () => {
  const d = C.safeBodyDoc(html('<a href="ms-msdt:/id x">a</a><a href="file://evil/share">b</a><a href="search-ms:query=x">c</a><a href="smb://evil/x">d</a><a href="ms-officecmd:x">e</a>'), false);
  assert.ok(!/href=/.test(d.replace(/<base[^>]*>/, '')), d);
  assert.ok(!/ms-msdt|file:|search-ms|smb:|ms-officecmd/i.test(d));
});
test('links: javascript: is removed, not rewritten to "#"', () => {
  const d = C.safeBodyDoc(html('<a href="javascript:x">a</a>'), false);
  assert.ok(d.includes('<a rel="noopener noreferrer">a</a>'), d);
  assert.ok(!d.includes('href="#"'));
});
test('links: https, mailto, tel and #fragment stay; every <a> gets rel="noopener noreferrer"', () => {
  const d = C.safeBodyDoc(html('<a href="https://ok.example" rel="opener">x</a><a href="tel:+15551234">t</a><a href="#top">f</a><a href="/relative">r</a>'), false);
  assert.ok(d.includes('<a href="https://ok.example" rel="noopener noreferrer">x</a>'), d);
  assert.ok(d.includes('href="tel:+15551234"') && d.includes('href="#top"'));
  assert.ok(!d.includes('href="/relative"') && !d.includes('rel="opener"'));
});
test('svg animation elements are dropped (they could rewrite an href)', () => {
  const d = C.safeBodyDoc(html('<svg><a><animate attributeName=href values=javascript:1 /><set attributeName="href" to="javascript:2"/><animateTransform/><animateMotion/><discard/><handler/><foreignObject><p>x</p></foreignObject><text>t</text></a></svg>'), false);
  assert.ok(!/animate|<set|discard|handler|foreignobject/i.test(d), d);
  assert.ok(!d.includes('javascript'));
});
test('unsafe src values are removed, not rewritten to "#"', () => {
  const d = C.safeBodyDoc(html('<img src="javascript:x" alt="a">'), false);
  assert.ok(d.includes('<img alt="a">'), d);
});

const BATTERY = [
  '<svg><image href="https://evil.example/a.png"/></svg>',
  '<svg><image xlink:href="https://evil.example/a.png"/></svg>',
  '<svg><filter id="f"><feImage href="https://evil.example/a.png"/></filter></svg>',
  '<svg><use href="https://evil.example/s.svg#x"/></svg>',
  '<div style="background:url(&#39;https://evil.example/a.png&#39;)">x</div>',
  '<div style="background:url(&#x27;https://evil.example/a.png&#x27;)">x</div>',
  '<div style="background:u\\72l(https://evil.example/a.png)">x</div>',
  '<div style="background:url(ht\\74ps://evil.example/a.png)">x</div>',
  '<style>@import "https://evil.example/x.css";</style><p>x</p>',
  '<style>@import url(//evil.example/x.css);</style><p>x</p>',
  '<style>div{background-image:image-set("https://evil.example/a.png" 1x)}</style><div>x</div>',
  '<style>div{background:\\75rl(https://evil.example/a.png)}</style><div>x</div>',
  '<div style="background-image:-webkit-image-set(&quot;https://evil.example/a.png&quot; 1x)">x</div>'
];
test('hidden images: no remote URL survives the battery (svg, quoted, CSS-escaped, @import, image-set)', () => {
  BATTERY.forEach((x) => {
    const d = C.safeBodyDoc({ contentType: 'html', content: x }, false);
    assert.ok(!d.includes('evil.example'), x + '\n  ->  ' + d);
  });
});
test('hasRemoteImages is true for every battery case (so the Show images bar is offered)', () => {
  BATTERY.forEach((x) => assert.strictEqual(C.hasRemoteImages(x), true, x));
});
test('hidden images: a decoded "\\3c /style\\3e" cannot close the style block', () => {
  const d = C.safeBodyDoc(html('<style>a{background:url(https://evil.example/a)}\\3c /style\\3e<img src=x></style><p>ok</p>'), false);
  assert.strictEqual((d.match(/<\/style>/gi) || []).length, 2, d); // ours (BASE_CSS) + the email's own
  assert.ok(!d.includes('evil.example'));
});
test('hidden images: local svg <use href="#id"> and plain CSS stay untouched', () => {
  const src = '<svg><use href="#icon"/></svg><div style="color:red;background:url(data:image/png;base64,AA//BB)">x</div>';
  const d = C.safeBodyDoc(html(src), false);
  assert.ok(d.includes('href="#icon"') && d.includes('color:red'), d);
  assert.strictEqual(C.hasRemoteImages(src), false);
});
test('shown images: remote image URLs are kept when allowImages is true', () => {
  const d = C.safeBodyDoc(html('<img src="https://ok.example/a.png">'), true);
  assert.ok(d.includes('src="https://ok.example/a.png"'));
});

test('agoText uses calendar days, matching formatWhen', () => {
  // Thu Oct 15 6:02 PM PT -> Sat Oct 17 12:05 AM PT: 30h elapsed, but two calendar days.
  assert.strictEqual(C.agoText('2026-10-16T01:02:00Z', Date.parse('2026-10-17T07:05:00Z'), PT), '2 days ago');
  // Fri 11 PM PT -> Sat 12:30 AM PT: 90 minutes, across midnight.
  assert.strictEqual(C.agoText('2026-10-17T06:00:00Z', Date.parse('2026-10-17T07:30:00Z'), PT), 'yesterday');
  // Same day, 3 hours.
  assert.strictEqual(C.agoText('2026-10-17T16:00:00Z', Date.parse('2026-10-17T19:00:00Z'), PT), '3 hours ago');
  // Thu 6 PM PT vs Sat 8 AM PT.
  assert.strictEqual(C.agoText('2026-10-16T01:00:00Z', Date.parse('2026-10-17T15:00:00Z'), PT), '2 days ago');
  // Under an hour across midnight stays in minutes.
  assert.strictEqual(C.agoText('2026-10-17T06:50:00Z', Date.parse('2026-10-17T07:10:00Z'), PT), '20 min ago');
  assert.strictEqual(C.formatWhen('2026-10-16T01:02:00Z', Date.parse('2026-10-17T07:05:00Z'), PT), 'Thu');
});
test('threadText passes the time zone through', () => {
  assert.strictEqual(C.threadText({ count: 3, fromMe: 1, latestAt: '2026-10-16T01:02:00Z' }, Date.parse('2026-10-17T07:05:00Z'), PT), 'Thread of 3 · 1 from you · latest 2 days ago');
});

test('findQuestion falls back to a subject that is a question', () => {
  assert.strictEqual(C.findQuestion('Hi Chad, just checking Marcus got in touch.', 'Did Marcus reach you?'), 'Did Marcus reach you?');
  assert.strictEqual(C.findQuestion('Dinner then.', 'RE: Saturday?'), 'Saturday?');
  assert.strictEqual(C.findQuestion('x', 'Re: FW: re: Saturday?'), 'Saturday?');
  assert.strictEqual(C.findQuestion('Can you do Tuesday?', 'Did Marcus reach you?'), 'Can you do Tuesday?');
  assert.strictEqual(C.findQuestion('Update attached.', 'Q3 summary'), null);
  assert.strictEqual(C.findQuestion('Update attached.', '?'), null);
});

test('firstName keeps the full name for senders that are not a person', () => {
  assert.strictEqual(C.firstName({ emailAddress: { name: 'The Product Brief', address: 'editor@productbrief.example' } }), 'The Product Brief');
  assert.strictEqual(C.firstName({ name: 'Issue 88 Weekly', address: 'x@y.example' }), 'Issue 88 Weekly');
  assert.strictEqual(C.firstName({ name: 'Indie Founders Weekly', address: 'x@y.example' }), 'Indie Founders Weekly');
  assert.strictEqual(C.firstName({ name: 'Tally Books', address: 'newsletter@tally.example' }), 'Tally Books');
  assert.strictEqual(C.firstName({ name: 'Dana Reyes', address: 'dana@x.example' }), 'Dana');
});

test('isClientMsg also checks Reply-To; threadIsClient checks every message', () => {
  const D = ['clientco.example'];
  assert.strictEqual(C.isClientMsg(msg({ from: addr('a@vendor.example'), replyTo: [addr('kim@clientco.example')] }), D), true);
  const thread = [msg({ id: 'a', from: addr('kim@clientco.example') }), msg({ id: 'b', from: addr('colleague@ambientpixels.ai'), toRecipients: [addr('chad@ambientpixels.ai')] })];
  assert.strictEqual(C.isClientMsg(thread[1], D), false);
  assert.strictEqual(C.threadIsClient(thread, D), true);
  assert.strictEqual(C.threadIsClient([thread[1]], D), false);
  assert.strictEqual(C.threadIsClient(null, D), false);
});

test('isSimpleHtml: text structure only', () => {
  assert.strictEqual(C.isSimpleHtml('<div>Hi Chad,</div><div><br></div><div>Ana</div>'), true);
  assert.strictEqual(C.isSimpleHtml('<p>Hi <b>there</b></p>'), true);
  assert.strictEqual(C.isSimpleHtml('<p style="color:red">x</p>'), false);
  assert.strictEqual(C.isSimpleHtml('<p>See <a href="https://x.example">this</a></p>'), false);
  assert.strictEqual(C.isSimpleHtml('<table><tr><td>x</td></tr></table>'), false);
  assert.strictEqual(C.isSimpleHtml('<img src="cid:a">'), false);
});
// ── Round 2: parser-differential and URL-normalisation battery ──
const BS = '\\';
const bodyOf = (d) => d.slice(d.indexOf('<body>') + 6, d.lastIndexOf('</body>'));
const differential = (q) => ({
  ['unbalancedQuote' + q]: '<p>Hi</p><img src=http://evil.example/a onerror=x ' + q + 'x>',
  ['unbalancedQuote2' + q]: '<img src=x onerror=alert(1) ' + q + 'x><p>after</p>',
  ['aBypass' + q]: '<a href=javascript:alert(1) ' + q + 'x>c</a>',
  ['metaBypass' + q]: '<meta http-equiv=refresh content=0;url=https://evil.example/ ' + q + 'x>',
  ['styleBypass' + q]: '<div style=background:url(https://evil.example/s) ' + q + 'x>hi</div>'
});
const BATTERY2 = Object.assign({}, differential('"'), differential("'"), {
  slashBack: '<img src="/' + BS + 'evil.example/x">',
  backslash2: '<img src="' + BS + BS + 'evil.example/x">',
  httpsBack: '<img src="https:' + BS + BS + 'evil.example/x">',
  httpNoSlash: '<img src="http:evil.example/x">',
  cssHttp: '<div style="background:url(http:evil.example/x)">a</div>',
  cssBack: '<div style="background:url(' + BS + BS + 'evil.example/cb)">a</div>',
  cssBackEnt: '<div style="background:url(&#92;&#92;evil.example/cbe)">a</div>',
  styleNoSlash: '<style>div{background:url(https:evil.example/x)}</style>',
  importNoSlash: '<style>@import "http:evil.example/x.css";</style><p>x</p>',
  svgFill: '<svg><rect fill="url(http:evil.example/x#a)" width="1" height="1"/></svg>',
  svgUseBack: '<svg><use href="/' + BS + 'evil.example/s.svg#x"/></svg>',
  posterRel: '<video poster="evil.example/p.png"></video>',
  srcsetMixed: '<img srcset="data:image/png;base64,AA 1x, http:evil.example/x 2x">',
  imageFn: '<div style="background:image(https://evil.example/x)">a</div>',
  tabInSrc: '<img src="ht&#9;tps://evil.example/tab">'
});
Object.keys(BATTERY2).forEach((k) => {
  test('battery ' + k + ': no remote target, handler, javascript: or http-equiv survives (images hidden)', () => {
    const b = bodyOf(C.safeBodyDoc(html(BATTERY2[k]), false));
    assert.ok(!/evil\.example/i.test(b), b);
    assert.ok(!/onerror/i.test(b), b);
    assert.ok(!/javascript:/i.test(b), b);
    assert.ok(!/http-equiv/i.test(b), b);
  });
});
['unbalancedQuote"', "unbalancedQuote'", 'slashBack', 'backslash2', 'httpsBack', 'httpNoSlash', 'cssHttp', 'svgFill'].forEach((k) => {
  test('hasRemoteImages is true for ' + k, () => assert.strictEqual(C.hasRemoteImages(BATTERY2[k]), true));
});
test('every "<" in sanitised output starts a tag the sanitiser rebuilt', () => {
  const b = bodyOf(C.safeBodyDoc(html('a < b <3 <img src=x "y> <p>ok</p> 1 > 0 <<script>x</script>'), false));
  assert.ok(!/<(?!\/?(?:p|img)\b)/.test(b), b);
  assert.ok(b.includes('a &lt; b &lt;3'), b);
  assert.ok(b.includes('1 &gt; 0'), b);
});
test('a tag cut off by the end of the input is dropped (as the browser does)', () => {
  const b = bodyOf(C.safeBodyDoc(html('<p>hi</p><img src="https://evil.example/x'), true));
  assert.strictEqual(b, '<p>hi</p>');
});
test('local images stay when hidden: data:, cid: and #fragment', () => {
  const b = bodyOf(C.safeBodyDoc(html('<img src="data:image/png;base64,AA"><svg><use href="#a"/></svg><div style="background:url(data:image/png;base64,AA)">x</div>'), false));
  assert.ok(b.includes('src="data:image/png;base64,AA"'), b);
  assert.ok(b.includes('href="#a"'), b);
  assert.ok(b.includes('url(data:image/png;base64,AA)'), b);
  assert.strictEqual(C.hasRemoteImages('<img src="data:image/png;base64,AA">'), false);
});
test('style blocks keep their CSS (child selectors) and cannot open a tag', () => {
  const b = bodyOf(C.safeBodyDoc(html('<style>a > b { color: red } x<y{}</style><p>t</p>'), false));
  assert.ok(b.includes('a > b { color: red }'), b);
  assert.ok(b.includes('x\\3c y{}'), b);
});
test('attribute names with quotes or junk are dropped, first duplicate wins', () => {
  const b = bodyOf(C.safeBodyDoc(html('<p "x=1 title="a" title="b">t</p>'), true));
  assert.strictEqual(b, '<p title="a">t</p>');
});

// ── questionKind / choiceOptions ──
test('questionKind: choice, open, yesno', () => {
  assert.strictEqual(C.questionKind('Which direction do you prefer, A or B?'), 'choice');
  assert.deepStrictEqual(C.choiceOptions('Which direction do you prefer, A or B?'), ['A', 'B']);
  assert.strictEqual(C.questionKind('What does the report include, and how long does it take to get it?'), 'open');
  assert.strictEqual(C.questionKind('Could we move the kickoff to Thursday at 10am Pacific?'), 'yesno');
  assert.strictEqual(C.questionKind('Saturday?'), 'yesno');
  assert.strictEqual(C.questionKind('Do you want to come or not?'), 'yesno');
  assert.strictEqual(C.questionKind('How did we do?'), 'open');
});
test('questionKind: lead-ins before a colon are ignored; long either/or is open', () => {
  assert.strictEqual(C.questionKind('Mostly wording, but one real ask: can you confirm the second milestone lands before Nov 14?'), 'yesno');
  assert.strictEqual(C.questionKind('Adding one more: is the CSV export something you can include in this sprint, or should we plan it for January?'), 'open');
});
test('choiceOptions: words match the right-hand option length', () => {
  assert.deepStrictEqual(C.choiceOptions('Should we meet Tuesday or Wednesday?'), ['Tuesday', 'Wednesday']);
  assert.deepStrictEqual(C.choiceOptions('Do you want the blue one or the red one?'), ['the blue one', 'the red one']);
  assert.strictEqual(C.choiceOptions('Could we do this?'), null);
});

// ── isAutomated (round 2) ──
test('isAutomated: role and machine mailboxes, own and agent addresses', () => {
  assert.strictEqual(C.isAutomated(msg({ from: addr('billing@cloudhost.example') })), true);
  assert.strictEqual(C.isAutomated(msg({ from: addr('renewals@domaindesk.example') })), true);
  assert.strictEqual(C.isAutomated(msg({ from: addr('vale@ambientpixels.ai') }), { agent: 'vale@ambientpixels.ai' }), true);
  assert.strictEqual(C.isAutomated(msg({ from: addr('chad@ambientpixels.ai') }), { me: { mail: 'Chad@AmbientPixels.ai' } }), true);
  assert.strictEqual(C.isAutomated(msg({ from: addr('dana@vendor.example') }), { me: 'chad@ambientpixels.ai' }), false);
});

// ── sendRecovery ──
test('sendRecovery: 404 with a matching sent item → sent; 404 without → recreate; else retry', () => {
  const started = Date.parse('2026-10-17T10:00:00Z');
  const sent = [{ conversationId: 'c1', sentDateTime: '2026-10-17T10:00:12Z' }, { conversationId: 'c2', sentDateTime: '2026-10-17T10:00:30Z' }];
  assert.strictEqual(C.sendRecovery({ status: 404, code: 'ErrorItemNotFound' }, sent, started, 'c1'), 'sent');
  assert.strictEqual(C.sendRecovery({ status: 404 }, sent, started, 'c9'), 'recreate');
  assert.strictEqual(C.sendRecovery({ status: 404 }, [{ conversationId: 'c1', sentDateTime: '2026-10-16T09:00:00Z' }], started, 'c1'), 'recreate');
  assert.strictEqual(C.sendRecovery({ status: 404 }, null, started, 'c1'), 'recreate');
  assert.strictEqual(C.sendRecovery({ status: 0, code: 'network' }, sent, started, 'c1'), 'retry');
  assert.strictEqual(C.sendRecovery({ status: 503 }, sent, started, 'c1'), 'retry');
});

// ── valeStateFrom ──
test('valeStateFrom: all good', () => {
  const v = C.valeStateFrom([
    { status: 200, body: { value: { at: '2026-10-17T13:41:00Z', triaged: [] } } },
    { status: 200, body: { rules: { rulesOnlyDomains: ['clientco.example'] } } },
    { status: 200, body: { value: { workHours: { start: '09:00', end: '17:00' } } } }
  ]);
  assert.strictEqual(v.sortState, 'ok');
  assert.strictEqual(v.triagedAt, '2026-10-17T13:41:00Z');
  assert.strictEqual(v.rulesFailed, false);
  assert.deepStrictEqual(v.rules.rulesOnlyDomains, ['clientco.example']);
  assert.strictEqual(v.workHours.start, '09:00');
});
test('valeStateFrom: 401 / 500 / missing fail closed', () => {
  const v = C.valeStateFrom([{ status: 401, body: {} }, { status: 500, body: {} }]);
  assert.strictEqual(v.sortState, 'failed');
  assert.strictEqual(v.rulesFailed, true);
  assert.deepStrictEqual(v.rules, {});
  assert.strictEqual(v.workHours, null);
  assert.strictEqual(C.valeStateFrom(null).rulesFailed, true);
});
test('valeStateFrom: malformed bodies (value null, value a string, rules not an object)', () => {
  const v1 = C.valeStateFrom([{ status: 200, body: { value: null } }, { status: 200, body: { rules: 'x' } }, { status: 200, body: { value: 'x' } }]);
  assert.strictEqual(v1.sortState, 'ok');
  assert.strictEqual(v1.triagedAt, null);
  assert.strictEqual(v1.rulesFailed, true);
  assert.strictEqual(v1.workHours, null);
  const v2 = C.valeStateFrom([{ status: 200, body: { value: 'oops' } }, { status: 200, body: { rules: [] } }, { status: 200, body: 'x' }]);
  assert.strictEqual(v2.sortState, 'failed');
  assert.strictEqual(v2.rulesFailed, true);
  const v3 = C.valeStateFrom([{ status: 200, body: { value: { at: 'not a date' } } }, { status: 200, body: null }, {}]);
  assert.strictEqual(v3.sortState, 'ok');
  assert.strictEqual(v3.triagedAt, null);
});

// ── greetingFor / shortcuts / isSimpleHtml (round 2) ──
test('greetingFor: working late after midnight', () => {
  assert.strictEqual(C.greetingFor(0), 'Working late');
  assert.strictEqual(C.greetingFor(4), 'Working late');
  assert.strictEqual(C.greetingFor(5), 'Good morning');
  assert.strictEqual(C.greetingFor(12), 'Good afternoon');
  assert.strictEqual(C.greetingFor(18), 'Good evening');
});
test('shortcutFor: z is undo', () => {
  assert.strictEqual(C.shortcutFor({ key: 'z' }), 'undo');
  assert.strictEqual(C.shortcutFor({ key: 'z', ctrlKey: true }), null);
});
test('isSimpleHtml: Outlook replies with <hr> and blockquote are simple; attributes still are not', () => {
  assert.strictEqual(C.isSimpleHtml('<div>a</div><hr><div><b>From:</b> x</div><blockquote><div>y</div></blockquote>'), true);
  assert.strictEqual(C.isSimpleHtml('<h3>Notes</h3><pre>x</pre><font>y</font>'), true);
  assert.strictEqual(C.isSimpleHtml('<hr style="x">'), false);
  assert.strictEqual(C.isSimpleHtml('<font color="red">x</font>'), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
