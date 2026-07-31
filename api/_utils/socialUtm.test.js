// Run with: node api/_utils/socialUtm.test.js
const assert = require('assert');
const u = require('./socialUtm');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
}

const ID = 'act_1785477821876_bsreply_9pxbw';
const REPORT = 'https://ambientpixels.ai/ambientscore/report.html?id=ccr_1784853000319_0045708f';

// ── injectUtm ──

test('appends with ? when the own-domain URL has no query string', () => {
  const out = u.injectUtm('see https://ambientpixels.ai', 'bluesky', ID);
  assert.ok(out.indexOf('ambientpixels.ai?utm_source=bluesky&utm_content=' + ID) !== -1, out);
});

test('appends with & when the URL already carries ?id= — the prospect-reply case', () => {
  // This is the live shape: every prospect reply links to a personalised report.
  const out = u.injectUtm('Full report here: ' + REPORT, 'bluesky', ID);
  assert.ok(out.indexOf('?id=ccr_1784853000319_0045708f&utm_source=bluesky&utm_content=' + ID) !== -1, out);
  assert.ok(out.indexOf('?utm_source') === -1, 'must not add a second question mark');
});

test('is idempotent — a URL already carrying utm_ is left alone', () => {
  // A re-draft must never double-stamp.
  const once = u.injectUtm('go ' + REPORT, 'bluesky', ID);
  const twice = u.injectUtm(once, 'bluesky', 'act_different');
  assert.strictEqual(twice, once);
});

test('leaves third-party URLs untouched', () => {
  const text = 'context https://example.com/page and https://ambientpixels.ai/x';
  const out = u.injectUtm(text, 'bluesky', ID);
  assert.ok(out.indexOf('https://example.com/page and') !== -1, 'third-party URL must be unchanged');
  assert.ok(out.indexOf('ambientpixels.ai/x?utm_source=') !== -1, 'own URL must be tagged');
});

test('text with no URL is returned unchanged', () => {
  assert.strictEqual(u.injectUtm('no links here', 'bluesky', ID), 'no links here');
});

test('empty and null input do not throw', () => {
  assert.strictEqual(u.injectUtm('', 'bluesky', ID), '');
  assert.strictEqual(u.injectUtm(null, 'bluesky', ID), '');
});

// ── utmReserve ──

test('utmReserve counts only untagged own-domain URLs', () => {
  const one = u.utmReserve('a ' + REPORT, 'bluesky', ID);
  assert.ok(one > 50, 'a single tag costs more than 50 chars, got ' + one);
  assert.strictEqual(u.utmReserve('no links', 'bluesky', ID), 0);
  const tagged = u.injectUtm('a ' + REPORT, 'bluesky', ID);
  assert.strictEqual(u.utmReserve(tagged, 'bluesky', ID), 0, 'already-tagged URLs cost nothing');
});

test('utmReserve matches what injectUtm actually adds', () => {
  const before = 'Full report here: ' + REPORT;
  const after = u.injectUtm(before, 'bluesky', ID);
  assert.strictEqual(after.length - before.length, u.utmReserve(before, 'bluesky', ID));
});

// ── trimPreservingTrailingUrl ──

test('protects an INLINE trailing link — the shape every prospect reply uses', () => {
  // The scheduled-post trim only protects a link on its own line, so reusing it
  // here would hard-cut the report link off the end.
  const text = 'We ran a quick free scan of your site and found a few things worth fixing quickly. Full report here: ' + REPORT;
  const out = u.trimPreservingTrailingUrl(text, 140);
  assert.ok(out.length <= 140, 'length ' + out.length);
  assert.ok(out.indexOf(REPORT) !== -1, 'the report link must survive: ' + out);
});

test('protects a newline-separated trailing link too', () => {
  const text = 'Some body copy that runs on for a while and needs cutting down to size.\n' + REPORT;
  const out = u.trimPreservingTrailingUrl(text, 130);
  assert.ok(out.length <= 130);
  assert.ok(out.indexOf(REPORT) !== -1, 'link must survive');
});

test('text already under the limit is returned unchanged', () => {
  const text = 'short ' + REPORT;
  assert.strictEqual(u.trimPreservingTrailingUrl(text, 300), text);
});

test('when the link alone exceeds the budget, ship the link not a truncated body', () => {
  const out = u.trimPreservingTrailingUrl('some body text here ' + REPORT, 95);
  assert.ok(out.length <= 95);
  assert.ok(out.indexOf('ambientpixels.ai') !== -1, 'a bare link beats no link');
});

test('with no link at all it hard-cuts', () => {
  const out = u.trimPreservingTrailingUrl('x'.repeat(200), 50);
  assert.ok(out.length <= 50);
});

// ── the whole pipeline, at real sizes ──

test('a 280-char reply survives UTM injection with the link intact and fits Bluesky', () => {
  // The actual hazard: 280-char cap + ~63-char UTM suffix = ~343, over the 300 limit.
  const body = 'Hey, I ran a quick scan on your page and noticed the donate flow makes people click through to a separate page, which tends to lose people on mobile especially. ';
  const text = (body + 'Full report here: ' + REPORT).substring(0, 280);
  const stamped = u.injectUtm(text, 'bluesky', ID);
  assert.ok(stamped.length > 280, 'precondition: UTM pushes it over, got ' + stamped.length);
  const final = u.trimPreservingTrailingUrl(stamped, 280);
  assert.ok(final.length <= 280, 'must fit, got ' + final.length);
  assert.ok(final.indexOf('utm_content=' + ID) !== -1, 'tracking must survive the trim');
  assert.ok(final.indexOf('report.html?id=ccr_1784853000319_0045708f') !== -1, 'report id must survive');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
