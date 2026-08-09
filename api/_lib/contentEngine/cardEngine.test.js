// Run with: node api/_lib/contentEngine/cardEngine.test.js
//
// cardEngine turns approved copy into the image Instagram requires. It costs nothing and
// invents nothing, so the failure modes are all layout: type too small to read, an author's
// deliberate line break silently reflowed, or a style value satori refuses.
//
// Renders a real JPEG at the end. No network, no API key, no blob.

const assert = require('assert');
const ce = require('./cardEngine');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}
async function ta(name, fn) {
  try { await fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const AVAIL_W = ce.WIDTH - 176;
const AVAIL_H = ce.HEIGHT - 176 - 150;
const fit = (lines) => ce.fitSize(lines, AVAIL_W, { availHeight: AVAIL_H });

console.log('\ncardEngine');

// ── Line handling: the author's breaks are the design ──
t('explicit line breaks are preserved, not merged', () => {
  assert.deepStrictEqual(ce.splitLines('one\ntwo\nthree'), ['one', 'two', 'three']);
});

t('blank lines survive as paragraph breaks', () => {
  const out = ce.splitLines('para one\n\npara two');
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[1], '', 'the blank line must remain, it is the paragraph gap');
});

t('CRLF is normalised', () => {
  assert.deepStrictEqual(ce.splitLines('a\r\nb'), ['a', 'b']);
});

// ── Sizing ──
// The first implementation sized by longest-line char count assuming no wrap. satori wraps,
// so one 90-char paragraph drove the card to the floor and left 85% of the frame empty.
t('short copy gets noticeably larger type than long copy', () => {
  const short = fit(ce.splitLines('Starting at zero.'));
  const long = fit(ce.splitLines('We have been heads down building for months and posting almost nowhere. The building is the easy part. Distribution is the part we are worst at, and we are doing it in the open now.'));
  assert.ok(short > long, `short (${short}) should exceed long (${long})`);
  assert.ok(long >= 40, `long copy must stay readable, got ${long}px — the old bug produced 30`);
});

t('a single long paragraph does not collapse to the floor', () => {
  const size = fit(ce.splitLines('If an agent stalls for five cycles, Forge the ops watchdog fires a directive at it and everything stops.'));
  assert.ok(size >= 50, `expected >=50px, got ${size}px`);
});

t('size stays inside bounds for absurd input', () => {
  const huge = fit(ce.splitLines('x '.repeat(1200)));
  assert.ok(huge >= 26 && huge <= 92, 'got ' + huge);
  const tiny = fit(ce.splitLines('Hi.'));
  assert.ok(tiny <= 92, 'must not exceed max, got ' + tiny);
});

t('more copy never yields larger type', () => {
  const a = fit(ce.splitLines('One short line.'));
  const b = fit(ce.splitLines('One short line.\nAnd another.\nAnd a third one here.\nAnd a fourth to be sure.'));
  assert.ok(b <= a, `adding lines must not grow type: ${a} -> ${b}`);
});

// ── Markup ──
// satori parses every style value it is handed, including undefined, and throws
// "Cannot read properties of undefined (reading 'trim')" from inside its CSS parser —
// an error that points nowhere near the offending property. Cost one debug cycle.
t('no style value is ever undefined', () => {
  const markup = ce.buildMarkup({ text: 'line one\n\nline two' });
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    const style = node.props && node.props.style;
    if (style) {
      for (const k of Object.keys(style)) {
        assert.notStrictEqual(style[k], undefined, 'undefined style "' + k + '" at ' + path + ' — satori will throw');
      }
    }
    const kids = node.props && node.props.children;
    if (Array.isArray(kids)) kids.forEach((c, i) => walk(c, path + '/' + i));
    else if (kids && typeof kids === 'object') walk(kids, path + '/0');
  };
  walk(markup, 'root');
});

t('empty copy is rejected rather than rendering a blank card', () => {
  assert.throws(() => ce.buildMarkup({ text: '' }), /empty/i);
  assert.throws(() => ce.buildMarkup({ text: '\n\n  \n' }), /empty/i);
});

t('card is 4:5, the tallest ratio the IG feed allows', () => {
  assert.strictEqual(ce.WIDTH, 1080);
  assert.strictEqual(ce.HEIGHT, 1350);
  assert.strictEqual(+(ce.HEIGHT / ce.WIDTH).toFixed(2), 1.25);
});

t('brand font ships with the engine', () => {
  assert.ok(require('fs').existsSync(ce.FONT_PATH), 'ArchivoBlack-Regular.ttf must be present: ' + ce.FONT_PATH);
});

(async () => {
  await ta('renders a real JPEG at full size', async () => {
    const buf = await ce.renderCard({ text: "My AI agents police each other.\n\nI didn't plan any of this." });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 5000, 'expected a real image, got ' + buf.length + ' bytes');
    // Instagram's container endpoint wants JPEG; satori/resvg emit PNG, so sharp converts.
    assert.strictEqual(buf[0], 0xFF, 'not a JPEG (SOI byte 0)');
    assert.strictEqual(buf[1], 0xD8, 'not a JPEG (SOI byte 1)');
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
