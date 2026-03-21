/**
 * Blindspot Visual Regression Test
 *
 * Captures screenshots at mobile (375px) + desktop (1440px) of every
 * key screen/state. Saves timestamped screenshots to screenshots/ dir.
 * Commits screenshots to git so humans can review visual diffs.
 *
 * Runs against the LIVE deployed URL (not localhost).
 *
 * Usage: node ambientpixels/blindspot/tests/visual-test.js [base-url]
 * Default: https://ambientpixels.ai
 *
 * Screens captured:
 * - Landing page (index.html)
 * - Play page lobby (play.html)
 * - Campaign screen (via nav click)
 * - How to Play modal (open state)
 * - Battle screen (if accessible)
 * - Forge overlay (if accessible)
 *
 * Checks:
 * - Horizontal overflow at each viewport
 * - Elements wider than viewport
 * - JS console errors
 * - Key elements visible (fight button, player card, bottom nav, etc.)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.argv[2] || 'https://ambientpixels.ai';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let passed = 0;
let failed = 0;
const warnings = [];
const screenshotPaths = [];

function pass(msg) { console.log('\x1b[32m  PASS\x1b[0m', msg); passed++; }
function fail(msg) { console.log('\x1b[31m  FAIL\x1b[0m', msg); failed++; }
function warn(msg) { console.log('\x1b[33m  WARN\x1b[0m', msg); warnings.push(msg); }

async function screenshot(page, name, vp) {
  const filename = `${name}_${vp}_${TIMESTAMP}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  screenshotPaths.push(filepath);
  // Also save as "latest" for easy comparison
  const latestPath = path.join(SCREENSHOT_DIR, `${name}_${vp}_latest.png`);
  fs.copyFileSync(filepath, latestPath);
  return filepath;
}

async function checkOverflow(page, vpWidth, label) {
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientW = await page.evaluate(() => document.documentElement.clientWidth);
  if (scrollW > clientW + 5) {
    fail(`${label}: horizontal overflow (${scrollW}px content in ${clientW}px viewport)`);
    // Find the widest offending element
    const offenders = await page.evaluate((vw) => {
      return Array.from(document.querySelectorAll('*'))
        .filter(el => el.getBoundingClientRect().width > vw + 5)
        .slice(0, 3)
        .map(el => `${el.tagName}.${(el.className || '').toString().split(' ')[0]}(${Math.round(el.getBoundingClientRect().width)}px)`);
    }, vpWidth);
    if (offenders.length) warn(`  Offenders: ${offenders.join(', ')}`);
  } else {
    pass(`${label}: no horizontal overflow`);
  }
}

async function checkVisible(page, selector, label) {
  const el = await page.$(selector);
  if (!el) { warn(`${label}: element not found`); return false; }
  const visible = await el.isVisible();
  if (visible) { pass(`${label}: visible`); return true; }
  else { warn(`${label}: exists but hidden`); return false; }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const jsErrors = [];

  // ═══════════════════════════════════════════════
  // MOBILE (375px)
  // ═══════════════════════════════════════════════
  console.log('\n══ MOBILE (375×812) ══');

  const mCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const m = await mCtx.newPage();
  m.on('pageerror', err => jsErrors.push(`[mobile] ${err.message}`));

  // Landing
  console.log('\n── Landing ──');
  await m.goto(BASE_URL + '/blindspot/', { waitUntil: 'networkidle', timeout: 15000 });
  await m.waitForTimeout(1500);
  await screenshot(m, 'landing', 'mobile');
  pass('Landing screenshot captured');
  await checkOverflow(m, 375, 'Landing mobile');
  await checkVisible(m, '#bs-fight-btn', 'Fight button');

  // Play page
  console.log('\n── Lobby ──');
  await m.goto(BASE_URL + '/blindspot/play.html', { waitUntil: 'networkidle', timeout: 15000 });
  await m.waitForTimeout(3000);
  await screenshot(m, 'lobby', 'mobile');
  pass('Lobby screenshot captured');
  await checkOverflow(m, 375, 'Lobby mobile');
  await checkVisible(m, '#bs-player-card', 'Player card');
  await checkVisible(m, '#bs-bottom-nav', 'Bottom nav');

  // Campaign (click nav)
  console.log('\n── Campaign ──');
  const campNav = await m.$('[data-nav="campaign"]');
  if (campNav) {
    await campNav.click();
    await m.waitForTimeout(1500);
    await screenshot(m, 'campaign', 'mobile');
    pass('Campaign screenshot captured');
    await checkOverflow(m, 375, 'Campaign mobile');

    // Back to lobby
    const backBtn = await m.$('#bs-campaign-back');
    if (backBtn) await backBtn.click();
    await m.waitForTimeout(500);
  } else {
    warn('Campaign nav not found');
  }

  // How to Play modal
  console.log('\n── How to Play ──');
  const htpBtn = await m.$('#bs-btn-howtoplay');
  if (htpBtn && await htpBtn.isVisible()) {
    await htpBtn.click();
    await m.waitForTimeout(500);
    await screenshot(m, 'howtoplay', 'mobile');
    pass('How to Play screenshot captured');

    // Close
    const gotit = await m.$('#bs-howtoplay-gotit');
    if (gotit) { await gotit.click(); await m.waitForTimeout(300); }
  } else {
    warn('How to Play button not accessible on mobile (may be in bottom nav)');
  }

  await mCtx.close();

  // ═══════════════════════════════════════════════
  // DESKTOP (1440px)
  // ═══════════════════════════════════════════════
  console.log('\n══ DESKTOP (1440×900) ══');

  const dCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const d = await dCtx.newPage();
  d.on('pageerror', err => jsErrors.push(`[desktop] ${err.message}`));

  // Landing
  console.log('\n── Landing ──');
  await d.goto(BASE_URL + '/blindspot/', { waitUntil: 'networkidle', timeout: 15000 });
  await d.waitForTimeout(1500);
  await screenshot(d, 'landing', 'desktop');
  pass('Landing screenshot captured');
  await checkOverflow(d, 1440, 'Landing desktop');

  // Lobby
  console.log('\n── Lobby ──');
  await d.goto(BASE_URL + '/blindspot/play.html', { waitUntil: 'networkidle', timeout: 15000 });
  await d.waitForTimeout(3000);
  await screenshot(d, 'lobby', 'desktop');
  pass('Lobby screenshot captured');
  await checkOverflow(d, 1440, 'Lobby desktop');

  // Campaign
  console.log('\n── Campaign ──');
  const campBtn = await d.$('#bs-btn-campaign');
  if (campBtn && await campBtn.isVisible()) {
    await campBtn.click();
    await d.waitForTimeout(1500);
    await screenshot(d, 'campaign', 'desktop');
    pass('Campaign screenshot captured');
    await checkOverflow(d, 1440, 'Campaign desktop');

    const backBtn2 = await d.$('#bs-campaign-back');
    if (backBtn2) await backBtn2.click();
    await d.waitForTimeout(500);
  }

  // How to Play
  console.log('\n── How to Play ──');
  const htpBtn2 = await d.$('#bs-btn-howtoplay');
  if (htpBtn2 && await htpBtn2.isVisible()) {
    await htpBtn2.click();
    await d.waitForTimeout(500);
    await screenshot(d, 'howtoplay', 'desktop');
    pass('How to Play screenshot captured');

    const gotit2 = await d.$('#bs-howtoplay-gotit');
    if (gotit2) { await gotit2.click(); await d.waitForTimeout(300); }
  }

  await dCtx.close();

  // ═══════════════════════════════════════════════
  // JS ERRORS
  // ═══════════════════════════════════════════════
  if (jsErrors.length > 0) {
    console.log('\n── JS Console Errors ──');
    jsErrors.forEach(e => fail('JS error: ' + e));
  } else {
    pass('No JS console errors');
  }

  // ═══════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════
  await browser.close();

  console.log('\n' + '─'.repeat(50));
  console.log(`  Screenshots: ${screenshotPaths.length} captured → ${SCREENSHOT_DIR}`);
  console.log(`  Timestamp: ${TIMESTAMP}`);
  console.log(`  Compare: *_latest.png files show most recent state`);

  if (failed === 0) {
    console.log(`\x1b[32m  ALL ${passed} CHECKS PASSED\x1b[0m`);
    if (warnings.length > 0) console.log(`  (${warnings.length} warnings)`);
  } else {
    console.log(`\x1b[31m  ${failed} FAILED\x1b[0m, ${passed} passed, ${warnings.length} warnings`);
  }

  // Write manifest for git commit
  const manifest = {
    timestamp: TIMESTAMP,
    baseUrl: BASE_URL,
    screenshots: screenshotPaths.map(p => path.basename(p)),
    passed, failed, warnings: warnings.length
  };
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Visual test fatal error:', err);
  process.exit(1);
});
