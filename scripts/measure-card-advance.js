// measure-card-advance.js — derive cardEngine's AVG_ADVANCE_EM by measurement.
//
// cardEngine.fitSize has to guess how many characters fit on a line before it can decide a
// font size, and for a long time it guessed 0.62em per character. That was 14.5% too wide,
// so it consistently overcounted rows and picked type smaller than the card could carry.
//
// This script replaces the guess with a measurement: render ONE unwrapped line on a canvas
// far wider than it needs, read the ink extents out of the raster, and divide by
// (characters x fontSize). Run it if the font file, the font size range, or letterSpacing
// changes — then paste the mean into AVG_ADVANCE_EM.
//
//   node scripts/measure-card-advance.js
//
// Note it measures ADVANCE ONLY. The separate question of how much of a line word-wrapping
// wastes at the right edge is WRAP_FILL_EFFICIENCY, and is deliberately not folded in here:
// conflating the two is what made the original constant impossible to check.

const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const _satoriModule = require(path.join(API, 'node_modules/satori'));
const satori = typeof _satoriModule === 'function' ? _satoriModule : _satoriModule.default;
const { Resvg } = require(path.join(API, 'node_modules/@resvg/resvg-js'));
const sharp = require(path.join(API, 'node_modules/sharp'));

const FONT = fs.readFileSync(path.join(API, '_lib/contentEngine/fonts/ArchivoBlack-Regular.ttf'));

// Real approved copy, not a pangram: a pangram over-weights rare wide glyphs and would
// bias the advance upward, reintroducing the exact error this replaces.
const SAMPLES = [
  'This picture was not made by an image model.',
  'The words came first. I approved them. The system drew them onto a card straight from the text.',
  'My AI agents police each other without asking me.',
  'It costs nothing to run, and it can only ever show words a person already signed off on.',
  'An image model can put things in a picture that nobody approved. Nothing checks a picture.',
  'You can watch the company run.',
  'Starting this page at zero followers.'
];

const SIZE = 100;          // large, so rounding is a rounding error
const W = 12000, H = 400;  // wide enough that nothing wraps
const LETTER_SPACING = '-0.02em'; // must match cardEngine's line style

async function inkWidth(text) {
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: { width: W, height: H, display: 'flex', backgroundColor: '#000', fontFamily: 'Archivo Black' },
        children: [{
          type: 'div',
          props: {
            style: { display: 'flex', color: '#fff', fontSize: SIZE, lineHeight: 1.22, letterSpacing: LETTER_SPACING },
            children: text
          }
        }]
      }
    },
    { width: W, height: H, fonts: [{ name: 'Archivo Black', data: FONT, weight: 400, style: 'normal' }] }
  );
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });

  let maxX = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = info.width - 1; x > maxX; x--) {
      if (data[y * info.width + x] > 20) { maxX = x; break; }
    }
  }
  return maxX + 1;
}

(async () => {
  console.log('Archivo Black @ ' + SIZE + 'px, letterSpacing ' + LETTER_SPACING + '\n');
  let total = 0;
  let lo = Infinity, hi = -Infinity;
  for (const s of SAMPLES) {
    const w = await inkWidth(s);
    const adv = w / (s.length * SIZE);
    total += adv;
    lo = Math.min(lo, adv);
    hi = Math.max(hi, adv);
    console.log('  chars=' + String(s.length).padStart(3) +
                '  ink=' + String(w).padStart(5) + 'px' +
                '  advance=' + adv.toFixed(4) + 'em   "' + s.slice(0, 40) + (s.length > 40 ? '...' : '') + '"');
  }
  const mean = total / SAMPLES.length;
  console.log('\n  range : ' + lo.toFixed(4) + ' - ' + hi.toFixed(4) + ' em');
  console.log('  MEAN  : ' + mean.toFixed(4) + ' em   <- paste into AVG_ADVANCE_EM in api/_lib/contentEngine/cardEngine.js');
})().catch(err => { console.error('measurement failed:', err); process.exit(1); });
