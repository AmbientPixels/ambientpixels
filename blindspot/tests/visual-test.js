/**
 * Blindspot Visual Test — Playwright screenshots at mobile + desktop
 *
 * Usage: node ambientpixels/blindspot/tests/visual-test.js [url]
 * Default URL: https://ambientpixels.ai/blindspot/play.html
 *
 * Captures screenshots at 375px (mobile) and 1440px (desktop) for:
 * - play.html lobby screen
 * - play.html campaign screen (if accessible)
 * - index.html landing page
 *
 * Screenshots saved to: ambientpixels/blindspot/tests/screenshots/
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.argv[2] || 'https://ambientpixels.ai';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 }
];

const PAGES = [
  { name: 'landing', path: '/blindspot/' },
  { name: 'play', path: '/blindspot/play.html' }
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  let passed = 0;
  let failed = 0;

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.name === 'mobile' ? 2 : 1
    });

    for (const pg of PAGES) {
      const page = await context.newPage();
      const label = `${pg.name}-${vp.name}`;

      try {
        console.log(`  Capturing ${label} (${vp.width}x${vp.height})...`);
        await page.goto(BASE_URL + pg.path, { waitUntil: 'networkidle', timeout: 15000 });
        // Wait for loading gate to dismiss
        await page.waitForTimeout(2000);

        const filePath = path.join(SCREENSHOT_DIR, `${label}.png`);
        await page.screenshot({ path: filePath, fullPage: true });
        console.log(`\x1b[32m  PASS\x1b[0m ${label} → ${filePath}`);
        passed++;

        // Basic visual checks
        const errors = [];

        // Check for horizontal overflow
        const hasOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        if (hasOverflow) {
          errors.push('Horizontal overflow detected');
        }

        // Check for elements wider than viewport
        const wideElements = await page.evaluate((vpWidth) => {
          const els = document.querySelectorAll('*');
          const wide = [];
          els.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width > vpWidth + 5 && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
              wide.push(`${el.tagName}.${el.className.split(' ')[0]} (${Math.round(rect.width)}px)`);
            }
          });
          return wide.slice(0, 5);
        }, vp.width);

        if (wideElements.length > 0) {
          errors.push(`Elements wider than viewport: ${wideElements.join(', ')}`);
        }

        // Check for JS errors in console
        const jsErrors = [];
        page.on('pageerror', err => jsErrors.push(err.message));
        await page.waitForTimeout(500);
        if (jsErrors.length > 0) {
          errors.push(`JS errors: ${jsErrors.join('; ')}`);
        }

        if (errors.length > 0) {
          errors.forEach(e => console.log(`\x1b[33m  WARN\x1b[0m ${label}: ${e}`));
        }

      } catch (err) {
        console.log(`\x1b[31m  FAIL\x1b[0m ${label}: ${err.message}`);
        failed++;
      }

      await page.close();
    }

    await context.close();
  }

  await browser.close();

  console.log('\n' + '─'.repeat(50));
  if (failed === 0) {
    console.log(`\x1b[32m  ALL ${passed} SCREENSHOTS CAPTURED\x1b[0m`);
    console.log(`  Screenshots: ${SCREENSHOT_DIR}`);
  } else {
    console.log(`\x1b[31m  ${failed} FAILED\x1b[0m, ${passed} passed`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Visual test fatal error:', err);
  process.exit(1);
});
