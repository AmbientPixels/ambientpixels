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
    const el = await page.locator('#' + id);
    const outPath = path.join(OUT_DIR, id + '.png');

    // Remove label before screenshot
    await page.evaluate((borderId) => {
      const label = document.querySelector('#' + borderId + ' .border-label');
      if (label) label.style.display = 'none';
    }, id);

    await el.screenshot({ path: outPath, omitBackground: true });
    console.log('Saved:', outPath);
  }

  // Also save with labels for preview
  const previewDir = path.join(OUT_DIR, 'preview');
  if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

  // Reload to restore labels
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
