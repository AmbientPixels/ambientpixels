/**
 * Generates the root OG image (1200x630) featuring the AP. monogram.
 * Output: ambientpixels/images/og-ambientpixels.png
 *
 * Usage: node ambientpixels/scripts/generate-og-image.js
 */

const path = require('path');
const { chromium } = require('playwright');

const OUTPUT = path.resolve(__dirname, '..', 'images', 'og-ambientpixels.png');

const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 1200px;
    height: 630px;
    background: #0c0c0c;
    overflow: hidden;
    font-family: 'Archivo Black', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    position: relative;
    width: 1200px;
    height: 630px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mark {
    position: relative;
    color: #f4f4f4;
    font-size: 440px;
    line-height: 0.82;
    letter-spacing: -0.095em;
    display: flex;
    align-items: flex-end;
    padding: 0;
  }
  .mark .a { margin-right: 0; }
  .dot {
    display: inline-block;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: #d4a952;
    margin-left: 26px;
    margin-bottom: 30px;
    box-shadow:
      0 0 32px rgba(212, 169, 82, 0.55),
      0 0 96px rgba(212, 169, 82, 0.22);
  }
  .vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%);
    pointer-events: none;
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="mark"><span class="a">A</span>P<span class="dot"></span></div>
    <div class="vignette"></div>
  </div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.setContent(HTML, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUTPUT, type: 'png', omitBackground: false });
  await browser.close();
  console.log('Wrote', OUTPUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
