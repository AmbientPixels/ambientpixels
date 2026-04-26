/**
 * Generates the CardForge brand OG image (2400x1260, 2x of 1200x630).
 *
 * Output: ambientpixels/cardforge/images/cardforge-og.png
 *
 * Composition: obsidian gradient bg with an ember glow pool and scattered
 * sparks. Left zone is the wordmark + tagline lockup, right zone is three
 * fanned trading-card silhouettes (decorative, not real cards). Footer is
 * an "AMBIENTPIXELS" rule line bottom-left.
 *
 * Token values mirror cardforge-base.css :root (--cf-ob-bg-0/1/2,
 * --cf-ob-line-1, --cf-ob-ember, --cf-ob-text-1, --cf-ob-text-mute) so the
 * OG reads as the same design language as the live editor.
 *
 * Usage: node ambientpixels/scripts/generate-cardforge-og.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUTPUT = path.resolve(__dirname, '..', 'cardforge', 'images', 'cardforge-og.png');
const IMG_DIR = path.resolve(__dirname, '..', 'images', 'image-packs', 'characters');

function loadDataUrl(filename) {
  const buf = fs.readFileSync(path.join(IMG_DIR, filename));
  const ext = path.extname(filename).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Three example cards rendered into the right-hand fan: one warrior, one
// mage, one creature. Portraits sourced from the live image-pack so the
// OG matches the kind of art users actually generate in CardForge. Stats
// are decorative bar widths (0-100), no game logic.
const CARDS = [
  { name: 'ARIA STORMWIND', portrait: 'guardian-of-the-gilded-halls.jpg', stats: [78, 65, 42] },
  { name: 'DR. ELENA VOSS', portrait: 'ethereal-enigma.jpg',              stats: [92, 70, 35] },
  { name: 'TWILIGHT TITAN', portrait: 'twilight-titan.jpg',               stats: [95, 88, 28] },
];

const CARDS_HTML = CARDS.map((c, i) => `        <div class="card card-${i + 1}">
          <div class="portrait"><img src="${loadDataUrl(c.portrait)}" alt="" /></div>
          <div class="nameplate">${c.name}</div>
          <div class="stats">
            ${c.stats.map(v => `<div class="stat"><span class="fill" style="width: ${v}%"></span></div>`).join('\n            ')}
          </div>
        </div>`).join('\n');

const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Unbounded:wght@500;700;800&display=swap" />
<style>
  :root {
    --cf-ob-bg-0: #07090c;
    --cf-ob-bg-1: #0c1117;
    --cf-ob-bg-2: #141b24;
    --cf-ob-line-1: rgba(255, 255, 255, 0.06);
    --cf-ob-ember: #ff7a1a;
    --cf-ob-text-1: #e7ebf1;
    --cf-ob-text-mute: #6b7381;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1200px; height: 630px;
    background: var(--cf-ob-bg-0);
    color: var(--cf-ob-text-1);
    font-family: 'Inter', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
  .stage {
    position: relative;
    width: 1200px; height: 630px;
    background:
      radial-gradient(1100px 700px at 100% 0%, rgba(255, 122, 26, 0.18) 0%, transparent 55%),
      linear-gradient(135deg, var(--cf-ob-bg-0) 0%, var(--cf-ob-bg-1) 65%, #1a1218 100%);
  }
  /* Hairline grid wash — subtle obsidian texture */
  .stage::before {
    content: '';
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse at 30% 50%, black 0%, transparent 70%);
    -webkit-mask-image: radial-gradient(ellipse at 30% 50%, black 0%, transparent 70%);
  }
  /* Floating ember sparks */
  .ember {
    position: absolute;
    width: 4px; height: 4px;
    border-radius: 50%;
    background: var(--cf-ob-ember);
    box-shadow: 0 0 12px var(--cf-ob-ember), 0 0 4px var(--cf-ob-ember);
  }
  .ember.s { width: 3px; height: 3px; opacity: 0.55; }
  .ember.l { width: 6px; height: 6px; }
  /* Layout — left text / right card stack */
  .layout {
    position: relative;
    width: 100%; height: 100%;
    padding: 80px;
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 40px;
    align-items: center;
  }
  .left { display: flex; flex-direction: column; gap: 22px; }
  .wordmark {
    font-family: 'Unbounded', sans-serif;
    font-size: 96px;
    font-weight: 800;
    letter-spacing: -3px;
    line-height: 0.95;
    color: var(--cf-ob-text-1);
  }
  .wordmark .ember-text {
    color: var(--cf-ob-ember);
    text-shadow: 0 0 24px rgba(255, 122, 26, 0.45);
  }
  .tagline {
    font-family: 'Unbounded', sans-serif;
    font-size: 22px;
    font-weight: 500;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: var(--cf-ob-text-1);
    opacity: 0.78;
  }
  .tagline .dot {
    display: inline-block;
    width: 4px; height: 4px;
    border-radius: 50%;
    background: var(--cf-ob-ember);
    vertical-align: middle;
    margin: 0 12px 4px;
    box-shadow: 0 0 8px var(--cf-ob-ember);
  }
  /* Right zone — fanned cards */
  .cards {
    position: relative;
    width: 100%; height: 100%;
  }
  .card {
    position: absolute;
    top: 50%;
    width: 160px;
    height: 229px;
    background: linear-gradient(180deg, var(--cf-ob-bg-2) 0%, var(--cf-ob-bg-1) 100%);
    border: 1px solid rgba(255, 122, 26, 0.4);
    border-radius: 14px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow:
      0 18px 48px rgba(0, 0, 0, 0.55),
      0 0 36px rgba(255, 122, 26, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .card .portrait {
    flex: 1;
    border-radius: 8px;
    border: 1px solid rgba(255, 122, 26, 0.28);
    position: relative;
    overflow: hidden;
    background: var(--cf-ob-bg-1);
  }
  .card .portrait img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .card .portrait::after {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(180deg, transparent 55%, rgba(0, 0, 0, 0.55) 100%);
    pointer-events: none;
  }
  .card .nameplate {
    background: linear-gradient(90deg, rgba(255, 122, 26, 0.24) 0%, rgba(255, 122, 26, 0.08) 100%);
    border: 1px solid rgba(255, 122, 26, 0.42);
    border-radius: 5px;
    padding: 6px 6px;
    font-family: 'Unbounded', sans-serif;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.3px;
    color: var(--cf-ob-text-1);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }
  .card .stats {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .card .stat {
    height: 6px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 999px;
    overflow: hidden;
  }
  .card .stat .fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--cf-ob-ember) 0%, #ffae6e 100%);
    border-radius: 999px;
    box-shadow: 0 0 8px rgba(255, 122, 26, 0.6);
  }
  /* Per-card placement / rotation / stat variation */
  /* Tight fan — cards positioned so they overlap on padding only, not
     on the nameplate text-area. Card-2 sits center with z-index:2 for
     prominence; outer cards are equally spread with mirrored rotation. */
  .card-1 { left: 0%;  margin-top: -114px; transform: rotate(-9deg); }
  .card-2 { left: 30%; margin-top: -114px; transform: rotate(0deg); z-index: 2; }
  .card-3 { left: 60%; margin-top: -114px; transform: rotate(9deg); }
  /* Footer rule */
  .footer {
    position: absolute;
    left: 80px;
    bottom: 56px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .footer .accent {
    width: 36px;
    height: 1px;
    background: var(--cf-ob-ember);
    box-shadow: 0 0 8px rgba(255, 122, 26, 0.6);
  }
  .footer .lockup {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .footer .label {
    font-family: 'Unbounded', sans-serif;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: var(--cf-ob-text-mute);
  }
  .footer .url {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 16px;
    font-weight: 500;
    letter-spacing: 0.4px;
    color: var(--cf-ob-ember);
    text-shadow: 0 0 12px rgba(255, 122, 26, 0.4);
  }
</style>
</head>
<body>
  <div class="stage">
    <span class="ember"   style="left: 6%;  top: 22%;"></span>
    <span class="ember s" style="left: 14%; top: 78%;"></span>
    <span class="ember l" style="left: 22%; top: 12%;"></span>
    <span class="ember s" style="left: 38%; top: 88%;"></span>
    <span class="ember"   style="left: 46%; top: 30%;"></span>
    <span class="ember s" style="left: 58%; top: 90%;"></span>
    <span class="ember"   style="left: 74%; top: 84%;"></span>
    <span class="ember l" style="left: 92%; top: 28%;"></span>

    <div class="layout">
      <div class="left">
        <div class="wordmark">Card<span class="ember-text">Forge</span></div>
        <div class="tagline">Design<span class="dot"></span>Customize<span class="dot"></span>Share</div>
      </div>
      <div class="cards">
${CARDS_HTML}
      </div>
    </div>

    <div class="footer">
      <div class="accent"></div>
      <div class="lockup">
        <div class="label">AmbientPixels</div>
        <div class="url">ambientpixels.ai/cardforge/</div>
      </div>
    </div>
  </div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.setContent(HTML, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: OUTPUT, type: 'png' });
    console.log('Wrote ' + OUTPUT);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
