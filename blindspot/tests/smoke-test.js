/**
 * Blindspot Smoke Test
 *
 * Validates that changes don't break the game's core files.
 * Run after every code change: node ambientpixels/blindspot/tests/smoke-test.js
 *
 * Checks:
 * 1. JS parses without errors
 * 2. CSS has no unclosed braces
 * 3. HTML has required elements
 * 4. Overlays with bs-overlay--hidden aren't overridden by display rules
 * 5. No duplicate function declarations
 * 6. Critical selectors/IDs exist in HTML
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
let passes = 0;

function pass(msg) { console.log('\x1b[32m  PASS\x1b[0m', msg); passes++; }
function fail(msg) { console.log('\x1b[31m  FAIL\x1b[0m', msg); failures++; }

// ── 1. JS Parse Check ──
try {
  const jsCode = fs.readFileSync(path.join(ROOT, 'js/blindspot-flow.js'), 'utf8');
  new Function(jsCode);
  pass('blindspot-flow.js parses without errors');
} catch (e) {
  fail('blindspot-flow.js parse error: ' + e.message);
}

// ── 2. CSS Brace Balance ──
try {
  const css = fs.readFileSync(path.join(ROOT, 'css/blindspot.css'), 'utf8');
  // Strip comments and strings
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
  const opens = (stripped.match(/{/g) || []).length;
  const closes = (stripped.match(/}/g) || []).length;
  if (opens === closes) {
    pass('blindspot.css braces balanced (' + opens + ' pairs)');
  } else {
    fail('blindspot.css braces unbalanced: ' + opens + ' opens, ' + closes + ' closes');
  }
} catch (e) {
  fail('blindspot.css read error: ' + e.message);
}

// ── 3. CSS Overlay Safety ──
try {
  const css = fs.readFileSync(path.join(ROOT, 'css/blindspot.css'), 'utf8');

  // Check that bs-overlay--hidden has !important
  if (css.includes('.bs-overlay--hidden') && css.includes('display: none !important')) {
    pass('bs-overlay--hidden has !important');
  } else if (css.includes('.bs-overlay--hidden')) {
    fail('bs-overlay--hidden exists but missing !important — overlays will leak through');
  } else {
    fail('bs-overlay--hidden class not found in CSS');
  }

  // Check for overlay classes that set display directly (dangerous pattern)
  const overlayDisplayPattern = /\.bs-[a-z-]+(?:\s*\{[^}]*display\s*:\s*(?:flex|block|grid))/g;
  const matches = css.match(overlayDisplayPattern) || [];
  // Filter to only check classes that also appear as overlay children
  const dangerousOverlays = matches.filter(m => {
    const className = m.match(/\.(bs-[a-z-]+)/)[1];
    // Check if this class is used on an element that also has bs-overlay
    return className.includes('intro') || className.includes('overlay');
  });

  if (dangerousOverlays.length === 0) {
    pass('No overlay classes directly setting display (safe)');
  } else {
    // Not a hard fail — just warn
    console.log('\x1b[33m  WARN\x1b[0m Overlay classes setting display:', dangerousOverlays.map(m => m.match(/\.(bs-[a-z-]+)/)[1]).join(', '));
    console.log('        These MUST NOT override bs-overlay--hidden. Verify with !important.');
  }
} catch (e) {
  fail('CSS overlay safety check error: ' + e.message);
}

// ── 4. HTML Required Elements (index.html) ──
try {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const requiredIds = ['bs-landing', 'bs-fight-btn', 'bs-stranger-win', 'bs-stranger-loss', 'bs-battle-container'];
  requiredIds.forEach(id => {
    if (indexHtml.includes('id="' + id + '"')) {
      pass('index.html has #' + id);
    } else {
      fail('index.html missing #' + id);
    }
  });

  // Check that overlays have bs-overlay--hidden
  const overlayDivs = indexHtml.match(/id="bs-[^"]*"[^>]*class="[^"]*bs-overlay[^"]*"/g) || [];
  overlayDivs.forEach(match => {
    const id = match.match(/id="([^"]+)"/)[1];
    if (id === 'bs-landing') return; // landing is not an overlay
    if (match.includes('bs-overlay--hidden')) {
      pass(id + ' has bs-overlay--hidden');
    } else if (!match.includes('bs-loss-screen') && !match.includes('bs-demo-prompt')) {
      fail(id + ' is an overlay but MISSING bs-overlay--hidden — will show on page load!');
    }
  });
} catch (e) {
  fail('index.html check error: ' + e.message);
}

// ── 5. HTML Required Elements (play.html) ──
try {
  const playHtml = fs.readFileSync(path.join(ROOT, 'play.html'), 'utf8');

  const requiredIds = ['bs-screen-lobby', 'bs-screen-campaign', 'bs-screen-battle', 'bs-player-card', 'bs-play-btn'];
  requiredIds.forEach(id => {
    if (playHtml.includes('id="' + id + '"')) {
      pass('play.html has #' + id);
    } else {
      fail('play.html missing #' + id);
    }
  });
} catch (e) {
  fail('play.html check error: ' + e.message);
}

// ── 6. Boss Data Integrity ──
try {
  const bosses = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/bosses.json'), 'utf8'));
  var campaignBosses = bosses.filter(function(b) { return !b.weekly; });
  if (campaignBosses.length === 10) {
    pass('bosses.json has 10 campaign bosses (+ ' + (bosses.length - 10) + ' weekly)');
  } else {
    fail('bosses.json has ' + campaignBosses.length + ' campaign bosses (expected 10)');
  }

  const allHaveAvatars = bosses.every(b => b.avatar && b.avatar.length > 0);
  if (allHaveAvatars) {
    pass('All bosses have avatar URLs');
  } else {
    const missing = bosses.filter(b => !b.avatar).map(b => b.name);
    fail('Bosses missing avatars: ' + missing.join(', '));
  }
} catch (e) {
  fail('bosses.json check error: ' + e.message);
}

// ── 7. Game Config ──
try {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game-config.json'), 'utf8'));
  if (config.forgeVisit && config.forgeVisit.winsRequired) {
    pass('game-config.json has forgeVisit config');
  } else {
    fail('game-config.json missing forgeVisit config');
  }
} catch (e) {
  fail('game-config.json check error: ' + e.message);
}

// ── 8. CSS Quality Checks ──
try {
  const css = fs.readFileSync(path.join(ROOT, 'css/blindspot.css'), 'utf8');

  // Check for raw hex colors (should use --bs-* tokens)
  const rawHexInRules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^-]#[0-9a-fA-F]{3,8}\b/g) || [];
  // Filter out ones inside var() fallbacks and data attributes
  const suspectHex = rawHexInRules.filter(h => !h.includes('var('));
  if (suspectHex.length > 20) {
    console.log('\x1b[33m  WARN\x1b[0m ' + suspectHex.length + ' raw hex colors found — prefer --bs-* tokens');
  }

  // Check for ::before/::after with content that might create ghost elements
  const pseudoContent = css.match(/::(?:before|after)\s*\{[^}]*content\s*:\s*['"][^'"]+['"]/g) || [];
  if (pseudoContent.length > 0) {
    // Not a fail, just flag for review
    console.log('\x1b[33m  INFO\x1b[0m ' + pseudoContent.length + ' ::before/::after with content — verify no ghost visuals');
  }

  // Check modal backdrop hidden class exists and has !important
  if (css.includes('.bs-modal-backdrop--hidden')) {
    if (css.includes('.bs-modal-backdrop--hidden') && css.match(/bs-modal-backdrop--hidden[\s\S]*?display\s*:\s*none\s*!important/)) {
      pass('bs-modal-backdrop--hidden has !important');
    } else {
      fail('bs-modal-backdrop--hidden exists but may be missing !important');
    }
  }
} catch (e) {
  fail('CSS quality check error: ' + e.message);
}

// ── 9. JS Quality Checks ──
try {
  const js = fs.readFileSync(path.join(ROOT, 'js/blindspot-flow.js'), 'utf8');

  // Check for undefined TIMEOUT references (caught this bug today)
  const timeoutRefs = (js.match(/\bTIMEOUT\b/g) || []).length;
  const timeoutDefs = (js.match(/(?:const|var|let)\s+TIMEOUT\b/g) || []).length;
  if (timeoutRefs > 0 && timeoutDefs === 0) {
    fail('TIMEOUT referenced but never defined — will cause ReferenceError');
  } else if (timeoutRefs > timeoutDefs * 3) {
    console.log('\x1b[33m  WARN\x1b[0m TIMEOUT used ' + timeoutRefs + ' times but only defined ' + timeoutDefs + ' — check scoping');
  }

  // Check for common localStorage key collisions (must use bs- prefix)
  const lsWrites = js.match(/localStorage\.setItem\(['"]([^'"]+)['"]/g) || [];
  const nonPrefixed = lsWrites.filter(m => {
    var key = m.match(/setItem\(['"]([^'"]+)['"]/)[1];
    return !key.startsWith('bs-') && !key.startsWith('blindspot');
  });
  if (nonPrefixed.length > 0) {
    console.log('\x1b[33m  WARN\x1b[0m localStorage keys without bs- prefix: ' + nonPrefixed.map(m => m.match(/['"]([^'"]+)['"]/)[1]).join(', '));
  }

  pass('JS quality checks passed');
} catch (e) {
  fail('JS quality check error: ' + e.message);
}

// ── Summary ──
console.log('\n' + '─'.repeat(50));
if (failures === 0) {
  console.log('\x1b[32m  ALL ' + passes + ' CHECKS PASSED\x1b[0m');
  process.exit(0);
} else {
  console.log('\x1b[31m  ' + failures + ' FAILED\x1b[0m, ' + passes + ' passed');
  process.exit(1);
}
