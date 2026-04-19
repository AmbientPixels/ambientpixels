/**
 * Generates OG images (2400x1260, 2x of 1200x630) for the site.
 *
 * Variants:
 *   monogram  - big AP. mark for the root page
 *   wordmark  - pixel-grid mark + AmbientPixels. wordmark for product/journal pages
 *
 * Usage:
 *   node ambientpixels/scripts/generate-og-image.js            # all variants
 *   node ambientpixels/scripts/generate-og-image.js monogram   # one variant
 */

const path = require('path');
const { chromium } = require('playwright');

const IMAGES_DIR = path.resolve(__dirname, '..', 'images');

const HEAD = `
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
    color: #f4f4f4;
  }
  .stage {
    position: relative;
    width: 1200px;
    height: 630px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%);
    pointer-events: none;
  }
</style>
`;

const MONOGRAM_HTML = `<!doctype html><html><head>${HEAD}<style>
  .mark {
    position: relative;
    font-size: 440px;
    line-height: 0.82;
    letter-spacing: -0.095em;
    display: flex;
    align-items: flex-end;
  }
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
</style></head><body>
  <div class="stage">
    <div class="mark">AP<span class="dot"></span></div>
    <div class="vignette"></div>
  </div>
</body></html>`;

const WORDMARK_HTML = `<!doctype html><html><head>${HEAD}<style>
  .lockup {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .grid {
    width: 72px;
    height: 72px;
    flex-shrink: 0;
  }
  .wordmark {
    font-size: 108px;
    line-height: 1;
    letter-spacing: -0.035em;
    white-space: nowrap;
  }
  .tagline {
    position: absolute;
    bottom: 70px;
    left: 0;
    right: 0;
    text-align: center;
    font-family: 'Archivo Black', sans-serif;
    font-size: 17px;
    letter-spacing: 0.36em;
    text-transform: uppercase;
    color: rgba(244, 244, 244, 0.38);
  }
</style></head><body>
  <div class="stage">
    <div class="lockup">
      <svg class="grid" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <g fill="#f4f4f4">
          <circle cx="2"  cy="2"  r="1.25" opacity="0.18"/>
          <circle cx="10" cy="2"  r="1.25" opacity="0.5"/>
          <circle cx="18" cy="2"  r="1.25" opacity="0.18"/>
          <circle cx="2"  cy="10" r="1.25" opacity="0.5"/>
          <circle cx="10" cy="10" r="2"/>
          <circle cx="18" cy="10" r="1.25" opacity="0.5"/>
          <circle cx="2"  cy="18" r="1.25" opacity="0.18"/>
          <circle cx="10" cy="18" r="1.25" opacity="0.5"/>
          <circle cx="18" cy="18" r="1.25" opacity="0.18"/>
        </g>
      </svg>
      <div class="wordmark">AmbientPixels.</div>
    </div>
    <div class="tagline">Creative Systems &nbsp;·&nbsp; Quiet Operations</div>
    <div class="vignette"></div>
  </div>
</body></html>`;

const VARIANTS = {
  monogram: { html: MONOGRAM_HTML, file: 'og-ambientpixels.png' },
  wordmark: { html: WORDMARK_HTML, file: 'og-ambientpixels-wordmark.png' },
};

async function render(variant, { html, file }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const outPath = path.join(IMAGES_DIR, file);
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  console.log(`Wrote ${variant} -> ${outPath}`);
}

(async () => {
  const arg = process.argv[2];
  const targets = arg ? [arg] : Object.keys(VARIANTS);
  for (const name of targets) {
    const v = VARIANTS[name];
    if (!v) {
      console.error(`Unknown variant: ${name}. Valid: ${Object.keys(VARIANTS).join(', ')}`);
      process.exit(1);
    }
    await render(name, v);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
