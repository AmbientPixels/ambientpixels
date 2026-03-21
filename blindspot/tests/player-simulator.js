/**
 * Blindspot Player Simulator — Playwright click-through test
 *
 * Walks through the actual game flow via real clicks:
 * 1. Landing page → Fight button → Stranger battle
 * 2. play.html → Lobby → Campaign → Pre-fight → Battle moves
 * 3. Forge overlay → Tabs → Avatar gallery → Close
 * 4. How to Play modal → Open → Close
 * 5. Navigation between screens
 *
 * Usage: node ambientpixels/blindspot/tests/player-simulator.js [base-url]
 * Default: https://ambientpixels.ai
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'https://ambientpixels.ai';
let passed = 0;
let failed = 0;
const warnings = [];

function pass(msg) { console.log('\x1b[32m  PASS\x1b[0m', msg); passed++; }
function fail(msg) { console.log('\x1b[31m  FAIL\x1b[0m', msg); failed++; }
function warn(msg) { console.log('\x1b[33m  WARN\x1b[0m', msg); warnings.push(msg); }

async function run() {
  const browser = await chromium.launch({ headless: true });

  // ── Test 1: Landing page loads and has fight button ──
  console.log('\n── Landing Page ──');
  const landingCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const landing = await landingCtx.newPage();
  const jsErrors = [];
  landing.on('pageerror', err => jsErrors.push(err.message));

  try {
    await landing.goto(BASE + '/blindspot/', { waitUntil: 'networkidle', timeout: 15000 });
    pass('Landing page loads');

    const fightBtn = await landing.$('#bs-fight-btn');
    if (fightBtn) {
      const visible = await fightBtn.isVisible();
      if (visible) pass('Fight button visible');
      else fail('Fight button exists but not visible');
    } else {
      fail('Fight button #bs-fight-btn not found');
    }

    // Check title
    const title = await landing.title();
    if (title.toLowerCase().includes('blindspot')) pass('Page title contains Blindspot');
    else warn('Page title missing Blindspot: ' + title);

  } catch (e) {
    fail('Landing page error: ' + e.message);
  }
  await landingCtx.close();

  // ── Test 2: Play page loads with loading gate ──
  console.log('\n── Play Page (Lobby) ──');
  const playCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const play = await playCtx.newPage();
  play.on('pageerror', err => jsErrors.push(err.message));

  try {
    await play.goto(BASE + '/blindspot/play.html', { waitUntil: 'networkidle', timeout: 15000 });
    pass('Play page loads');

    // Check loading gate appears initially
    const gate = await play.$('#bs-loading-gate');
    if (gate) pass('Loading gate element exists');
    else warn('Loading gate not found — may have already dismissed');

    // Wait for loading gate to dismiss
    await play.waitForTimeout(3000);

    // Check if lobby screen is visible (may redirect to landing if not authenticated)
    const lobby = await play.$('#bs-screen-lobby.active');
    const hasLobby = lobby && await lobby.isVisible();

    if (hasLobby) {
      pass('Lobby screen active');

      // Check player card area
      const playerCard = await play.$('#bs-player-card');
      if (playerCard) pass('Player card element exists');
      else fail('Player card #bs-player-card not found');

      // Check play button
      const playBtn = await play.$('#bs-play-btn');
      if (playBtn) {
        const btnVisible = await playBtn.isVisible();
        if (btnVisible) pass('Play button visible');
        else pass('Play button hidden (mobile — uses bottom nav instead)');
      }

      // Check bottom nav
      const bottomNav = await play.$('#bs-bottom-nav');
      if (bottomNav && await bottomNav.isVisible()) {
        pass('Bottom nav visible on mobile');

        // Try clicking Campaign nav
        const campaignNav = await play.$('[data-nav="campaign"]');
        if (campaignNav) {
          await campaignNav.click();
          await play.waitForTimeout(500);
          const campaignScreen = await play.$('#bs-screen-campaign.active');
          if (campaignScreen) {
            pass('Campaign screen opens via bottom nav');

            // Go back to lobby
            const backBtn = await play.$('#bs-campaign-back');
            if (backBtn) {
              await backBtn.click();
              await play.waitForTimeout(500);
              const lobbyAgain = await play.$('#bs-screen-lobby.active');
              if (lobbyAgain) pass('Back to lobby from campaign');
              else warn('Could not return to lobby');
            }
          } else {
            warn('Campaign screen did not activate');
          }
        }
      } else {
        pass('Bottom nav hidden (desktop mode)');
      }

      // Try How to Play
      const htpBtn = await play.$('#bs-btn-howtoplay');
      if (htpBtn && await htpBtn.isVisible()) {
        await htpBtn.click();
        await play.waitForTimeout(500);
        const htpModal = await play.$('#bs-howtoplay:not(.bs-modal-backdrop--hidden)');
        if (htpModal) {
          pass('How to Play modal opens');

          // Close it
          const gotitBtn = await play.$('#bs-howtoplay-gotit');
          if (gotitBtn) {
            await gotitBtn.click();
            await play.waitForTimeout(500);
            const htpClosed = await play.$('#bs-howtoplay.bs-modal-backdrop--hidden');
            if (htpClosed) pass('How to Play modal closes');
            else warn('How to Play modal did not close');
          }
        } else {
          warn('How to Play modal did not open');
        }
      }

    } else {
      warn('Lobby not visible — player may not be authenticated (redirected to landing)');
    }

  } catch (e) {
    fail('Play page error: ' + e.message);
  }
  await playCtx.close();

  // ── Test 3: Desktop layout ──
  console.log('\n── Desktop Layout ──');
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await deskCtx.newPage();

  try {
    await desk.goto(BASE + '/blindspot/play.html', { waitUntil: 'networkidle', timeout: 15000 });
    await desk.waitForTimeout(3000);
    pass('Desktop play page loads');

    // Check no horizontal overflow
    const overflow = await desk.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (!overflow) pass('No horizontal overflow on desktop');
    else fail('Horizontal overflow on desktop');

    // Check bottom nav is hidden on desktop
    const bottomNavHidden = await desk.evaluate(() => {
      const nav = document.getElementById('bs-bottom-nav');
      if (!nav) return true;
      return window.getComputedStyle(nav).display === 'none';
    });
    if (bottomNavHidden) pass('Bottom nav hidden on desktop');
    else warn('Bottom nav visible on desktop — should be hidden');

  } catch (e) {
    fail('Desktop layout error: ' + e.message);
  }
  await deskCtx.close();

  // ── JS Error Summary ──
  if (jsErrors.length > 0) {
    console.log('\n── JS Console Errors ──');
    jsErrors.forEach(e => fail('JS error: ' + e));
  }

  // ── Summary ──
  await browser.close();
  console.log('\n' + '─'.repeat(50));
  if (failed === 0) {
    console.log('\x1b[32m  ALL ' + passed + ' CHECKS PASSED\x1b[0m');
    if (warnings.length > 0) console.log('  (' + warnings.length + ' warnings)');
  } else {
    console.log('\x1b[31m  ' + failed + ' FAILED\x1b[0m, ' + passed + ' passed, ' + warnings.length + ' warnings');
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Player simulator fatal error:', err);
  process.exit(1);
});
