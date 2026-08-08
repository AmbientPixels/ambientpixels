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

// ── regression: the trim must not eat the reason to click ──
test('a 12-char overflow must not cost 72 chars of message', () => {
  // LIVE INCIDENT 2026-08-01. Trimming at 280 put a normal reply 12 chars over, and
  // the sentence-boundary fallback cut the body 149 -> 77, deleting the scan finding
  // — the only reason a stranger has to click. The link survived; the message did not.
  const bare = 'https://ambientpixels.ai/ambientscore/report.html?id=ccr_1785286200235_8c848dd9';
  const draft = 'Love the vibe of "ship across a diamond sea". I ran a quick scan on the page. '
    + 'The headline says what kind of thing it is, not why to stay and listen. ' + bare;
  const stamped = u.injectUtm(draft, 'bluesky', 'act_1785552464730_bsreply_zaznt');
  const final = u.trimPreservingTrailingUrl(stamped, u.BSKY_LIMIT);
  assert.ok(final.length <= 300, 'must fit Bluesky, got ' + final.length);
  assert.ok(/headline/i.test(final), 'the scan finding MUST survive — it is the reason to click');
  assert.ok(final.indexOf('utm_content=') !== -1, 'tracking still present');
  assert.ok(final.indexOf('ccr_1785286200235_8c848dd9') !== -1, 'report id still present');
});

test('BSKY_LIMIT matches the working cap used by the reply pipeline', () => {
  // prospect-pipeline.js defines BSKY_REPLY_MAX = 296 (hard cap 300, headroom for
  // trailing edges). Trimming at 280 was a second, tighter, undocumented cap.
  assert.strictEqual(u.BSKY_LIMIT, 296);
});

// ── extractProductUrl ──
//
// THE BUG (live, found 2026-08-08): camp-resume-roast-launch — the one active
// revenue campaign — carries "https://www.ambientpixels.ai/resume-roast/" in its
// description. agent-runner matched campaign URLs with
// /https?:\/\/ambientpixels\.ai\/[a-z0-9\/-]+/i, which does NOT allow "www.", so
// it missed, fell back to the bare homepage, and every scheduled post from that
// campaign sent clicks to the company root instead of the product page — against
// an objective measured in Resume Roast runs.

test('a www URL is found — this is the live bug', () => {
  assert.strictEqual(
    u.extractProductUrl('Post about the roast. Link: https://www.ambientpixels.ai/resume-roast/'),
    'https://www.ambientpixels.ai/resume-roast/');
});

test('a non-www URL still works — no regression', () => {
  assert.strictEqual(
    u.extractProductUrl('see https://ambientpixels.ai/resume-roast/'),
    'https://ambientpixels.ai/resume-roast/');
});

test('the bare homepage is NOT a product URL', () => {
  // It is the fallback the caller applies when nothing is found. Returning it
  // here would make "found the product page" and "gave up" indistinguishable.
  assert.strictEqual(u.extractProductUrl('go to https://ambientpixels.ai'), null);
  assert.strictEqual(u.extractProductUrl('go to https://www.ambientpixels.ai'), null);
});

test('third-party domains are never returned', () => {
  assert.strictEqual(u.extractProductUrl('read https://example.com/resume-roast/'), null);
  assert.strictEqual(u.extractProductUrl('read https://notambientpixels.ai/x/'), null);
});

test('the first product URL wins when several are present', () => {
  assert.strictEqual(
    u.extractProductUrl('https://www.ambientpixels.ai/resume-roast/ and https://ambientpixels.ai/blog/x'),
    'https://www.ambientpixels.ai/resume-roast/');
});

test('empty and malformed input returns null rather than throwing', () => {
  [null, undefined, '', '   ', 42, {}, []].forEach(v => {
    assert.doesNotThrow(() => u.extractProductUrl(v), JSON.stringify(v));
    assert.strictEqual(u.extractProductUrl(v), null);
  });
});

test('OWN_PRODUCT_URL_RE is not left stateful between calls', () => {
  // A /g regex reused via .test() carries lastIndex and returns alternating
  // results. extractProductUrl must not expose that.
  const s = 'https://www.ambientpixels.ai/resume-roast/';
  assert.strictEqual(u.extractProductUrl(s), u.extractProductUrl(s));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
