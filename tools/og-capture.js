// og-capture.js — Screenshot OG images from og-generator.html using Playwright
// Usage: node tools/og-capture.js

const { chromium } = require('playwright');
const path = require('path');

const CARDS = [
  { id: 'og-home',        file: 'og-ambientpixels.png', dest: 'images' },
  { id: 'og-ambientscore', file: 'og-ambientscore.png', dest: 'ambientscore/images' },
  { id: 'og-nova',        file: 'og-nova.png',          dest: 'nova' },
  { id: 'og-blog',        file: 'og-blog.png',          dest: 'blog' },
  { id: 'og-tileforge',   file: 'og-tileforge.png',     dest: 'hanson/tileforge/images' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const htmlPath = path.join(__dirname, 'og-generator.html');
  await page.goto('file://' + htmlPath.replace(/\\/g, '/'));

  // Wait for fonts + icons to load
  await page.waitForTimeout(2000);

  for (const card of CARDS) {
    const el = await page.locator('#' + card.id);
    const outDir = path.join(__dirname, '..', card.dest);
    const outPath = path.join(outDir, card.file);

    // Ensure directory exists
    const fs = require('fs');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    await el.screenshot({ path: outPath });
    console.log('Saved:', outPath);
  }

  await browser.close();
  console.log('\nDone! Generated', CARDS.length, 'OG images.');
})();
