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

// Guards the MEASURED advance (0.5415em) against a silent revert to the old 0.62 guess.
// 0.62 is 14.5% too wide, which overcounts wrapped rows and costs a size step on exactly
// the caption lengths we actually publish. These two are real approved posts; under the
// old constant they fit at 48 and 50 respectively.
// Re-derive the constant with scripts/measure-card-advance.js if the font changes.
const IG_FIRST_POST = 'This picture was not made by an image model.\n\nThe words came first. I approved them. The system drew them onto a card straight from the text.\n\nIt costs nothing to run, and it can only ever show words a person already signed off on.\n\nAn image model can put things in a picture that nobody approved. Nothing checks a picture.\n\nSo here, the picture just says the words.';
const FB_MECHANISM = "My AI agents police each other without asking me.\n\nIf an agent stalls for 5 cycles, Forge (the ops watchdog) fires a directive at it. Red banner. Drop everything, fix this first.\n\nOnly 2 agents can issue directives. Max 1 at a time. Forge can't even send one to Nova, it has to escalate to me.\n\nI didn't plan any of this. It came from trying to stop everything breaking.";

t('calibrated advance earns real captions their full size', () => {
  const ig = fit(ce.splitLines(IG_FIRST_POST).slice(0, 14));
  const fb = fit(ce.splitLines(FB_MECHANISM).slice(0, 14));
  assert.ok(ig >= 50, `IG first post should fit at >=50px, got ${ig}px — advance constant may have regressed to 0.62`);
  assert.ok(fb >= 52, `FB mechanism post should fit at >=52px, got ${fb}px — advance constant may have regressed to 0.62`);
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

// Rows of the raster containing ink, as [start, end] bands. Used to prove where the copy
// actually ends, rather than trusting the estimate that placed it.
async function inkBands(buf) {
  const sharp = require('sharp');
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const bands = [];
  let start = -1;
  for (let y = 0; y < info.height; y++) {
    let ink = false;
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > 40) { ink = true; break; }
    }
    if (ink && start === -1) start = y;
    if (!ink && start !== -1) { bands.push([start, y - 1]); start = -1; }
  }
  if (start !== -1) bands.push([start, info.height - 1]);
  return bands;
}

(async () => {
  await ta('renders a real JPEG at full size', async () => {
    const buf = await ce.renderCard({ text: "My AI agents police each other.\n\nI didn't plan any of this." });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 5000, 'expected a real image, got ' + buf.length + ' bytes');
    // Instagram's container endpoint wants JPEG; satori/resvg emit PNG, so sharp converts.
    assert.strictEqual(buf[0], 0xFF, 'not a JPEG (SOI byte 0)');
    assert.strictEqual(buf[1], 0xD8, 'not a JPEG (SOI byte 1)');
  });

  // The other direction from the sizing tests above: bigger type must never push copy into
  // the wordmark. Overflow is the failure that actually ruins a card, and it is invisible to
  // the pure sizing model, so this reads the rendered pixels. The gold rule is the only
  // band <=8px tall, which is how the lockup is located — an earlier version of this check
  // took the last two bands and silently measured the rule against the wordmark instead.
  await ta('copy never collides with the lockup, even at maximum length', async () => {
    for (const [label, text] of [['IG first post', IG_FIRST_POST], ['FB mechanism', FB_MECHANISM],
      ['20 short lines', Array.from({ length: 20 }, (_, i) => 'Short line ' + (i + 1) + '.').join('\n')]]) {
      const bands = await inkBands(await ce.renderCard({ text: text }));
      let ruleIdx = -1;
      for (let i = bands.length - 1; i >= 0; i--) {
        if (bands[i][1] - bands[i][0] + 1 <= 8) { ruleIdx = i; break; }
      }
      assert.ok(ruleIdx > 0, label + ': could not locate the gold rule — layout changed, update this test');
      const copyEnd = bands[ruleIdx - 1][1];
      const lockupTop = bands[ruleIdx][0];
      assert.ok(copyEnd < lockupTop,
        label + ': copy ends at ' + copyEnd + 'px but the lockup starts at ' + lockupTop + 'px — type is too large');
    }
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
