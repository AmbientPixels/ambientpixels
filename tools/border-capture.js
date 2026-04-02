// border-capture.js — Screenshot border frames as transparent PNGs
// Usage: node tools/border-capture.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BORDERS = [
  'border-gold-filigree',
  'border-arcane',
  'border-frost',
  'border-ember',
  'border-shadow',
  'border-nature',
  'border-circuit',
  'border-royal'
];

const OUT_DIR = path.join(__dirname, '..', 'cardforge', 'images', 'borders');

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const htmlPath = path.join(__dirname, 'border-generator.html');
  await page.goto('file://' + htmlPath.replace(/\\/g, '/'));
  await page.waitForTimeout(2000);

  for (const id of BORDERS) {
    const outPath = path.join(OUT_DIR, id + '.png');

    // Hide label + force transparent backgrounds for clean capture
    await page.evaluate((borderId) => {
      var el = document.getElementById(borderId);
      // Hide label
      var label = el.querySelector('.border-label');
      if (label) label.style.display = 'none';
      // Make body transparent
      document.body.style.background = 'transparent';
      // Remove any background from the frame itself
      el.style.background = 'transparent';
      // Remove inset box-shadow darkness (keep only border + outer glow)
      // We need to strip inset shadows that fill the interior with dark color
      var computed = getComputedStyle(el);
      var shadow = computed.boxShadow;
      if (shadow && shadow !== 'none') {
        // Keep only non-inset shadows (outer glows)
        var parts = shadow.split(/,(?![^(]*\))/);
        var filtered = parts.filter(function(p) { return p.indexOf('inset') === -1; });
        el.style.boxShadow = filtered.length > 0 ? filtered.join(',') : 'none';
      }
    }, id);

    const el = await page.locator('#' + id);
    await el.screenshot({ path: outPath, omitBackground: true });
    console.log('Saved:', outPath);
  }

  // Also save with labels for preview (reload to restore original styles)
  const previewDir = path.join(OUT_DIR, 'preview');
  if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

  await page.goto('file://' + htmlPath.replace(/\\/g, '/'));
  await page.waitForTimeout(1500);

  for (const id of BORDERS) {
    const el = await page.locator('#' + id);
    const outPath = path.join(previewDir, id + '-preview.png');
    await el.screenshot({ path: outPath, omitBackground: true });
  }
  console.log('\nPreviews saved to', previewDir);

  await browser.close();
  console.log('\nDone! Generated', BORDERS.length, 'border frames.');
})();
