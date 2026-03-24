# Blindspot Player Flow Tests — Plan

## Why

Monolith split (Rounds 1-8) extracted 27 modules but broke two basic features:
1. **Fight button dead** — circular callback dependency introduced in Round 7, main entry point non-functional
2. **Polaroid card style missing** — Quick Build offered a container type with no CSS

Both passed all existing tests (parse checks, smoke tests, unit tests). The tests verified code structure but never exercised real player flows.

## Goal

Playwright tests that click through every critical player path and verify the expected result happens. Run these after every deploy. If they pass, the game works. If they fail, something broke.

## Test Coverage

### 1. Landing Page — New Player Flow (index.html)
- [ ] Fight button click → stranger intro overlay appears (not just button exists)
- [ ] Stranger intro text animates in (3 lines become visible)
- [ ] Intro fades → battle container becomes visible
- [ ] Tutorial overlay appears (text bar + Strike highlighted)
- [ ] Only Strike button enabled, other 4 disabled at 30% opacity
- [ ] Click Strike → tutorial advances to Guard
- [ ] Complete all 5 tutorial moves → tutorial overlay removed, all buttons re-enabled
- [ ] Move buttons respond to clicks (round counter increments from "Round 1")
- [ ] Battle completes → win/loss overlay appears
- [ ] Win → "Build Your Card" button appears
- [ ] Quick Build opens (step 1 visible)

### 2. Quick Build Flow (index.html)
- [ ] Step 1 (Vibe): 6 vibe tiles visible, clicking one selects it, Next enabled
- [ ] Step 2 (Stats): 5 stat sliders visible, budget counter shows remaining points
- [ ] Step 3 (Avatar): Gallery grid loads with images, Image Style section visible
- [ ] Step 3: All 3 unlocked container styles apply distinct CSS (masked ≠ framed ≠ polaroid)
- [ ] Step 3: Polaroid style → `data-container="polaroid"` → art has cream border + wider bottom
- [ ] Step 4 (Details): Name input visible, class shown
- [ ] Step 5 (Confirm): Card preview renders with selected avatar + stats + container
- [ ] Confirm → card reveal celebration appears
- [ ] Sign-in prompt shown (for unauthenticated players)

### 3. Play Page — Lobby (play.html)
- [ ] Loading gate appears → dismisses within 5s
- [ ] Player card renders with image (not placeholder)
- [ ] Card switcher arrows work (counter changes, e.g. "1/3" → "2/3")
- [ ] Rank HUD shows power + boss progress
- [ ] Forge progress bar visible
- [ ] Mode buttons visible on desktop (Campaign, PvP, Leaderboard, How to Play)
- [ ] Bottom nav visible on mobile (Arena, Campaign, Forge, Ranks)

### 4. Campaign Flow (play.html)
- [ ] Campaign screen opens (via nav)
- [ ] Boss ladder renders with 10 bosses + weekly
- [ ] Fight/Replay button inside boss card opens pre-fight overlay
- [ ] Pre-fight overlay populated: boss name, avatar, stat comparison
- [ ] Pre-fight has Fight button (and Adventure button if applicable)
- [ ] Pre-fight close/retreat returns to campaign
- [ ] Back button returns to lobby

### 5. Battle Flow (play.html — requires starting a fight)
- [ ] Battle screen shows: player card, opponent card, HP bars, "VS"
- [ ] 5 move buttons visible and enabled
- [ ] Combat tooltips show damage estimates (STR dmg, END HP, INT stat)
- [ ] Click a move → round resolves, round counter increments
- [ ] HP bars change after round resolution
- [ ] Battle log updates with round result text

### 6. Card Container Styles (visual regression)
- [ ] Each container type in Quick Build maps to real CSS rules
- [ ] `masked`: circular portrait (border-radius: 50%)
- [ ] `framed`: full image with border (border-radius: 4px, border visible)
- [ ] `polaroid`: cream background padding, wider bottom
- [ ] `hero`: full edge-to-edge image, no padding
- [ ] `fullbleed`: full edge-to-edge image, no padding
- [ ] `floating`: centered with rounded corners + shadow

### 7. Forge Flow (play.html — requires forge unlocked)
- [ ] Forge overlay opens
- [ ] 3 tabs visible (Stats, Look, Details)
- [ ] Stats tab: stat sliders + budget counter
- [ ] Look tab: palette grid + container grid
- [ ] Details tab: name input, quote input, avatar options
- [ ] Save works (no JS error)

### 8. Navigation (play.html)
- [ ] Every bottom nav item switches to correct screen
- [ ] Every back button returns to previous screen
- [ ] No screen gets "stuck" (all transitions complete)

### 9. Zero Errors Baseline
- [ ] Zero JS errors (pageerror) on index.html through full new-player flow
- [ ] Zero JS errors on play.html through lobby + campaign + navigation
- [ ] Zero 404s on JS/CSS/image loads
- [ ] All 27 lib modules loaded on play.html (window.Bs* checks)

## Implementation Notes

- All tests run via `node blindspot/tests/player-flow-tests.js`
- Use Playwright (already installed) with chromium
- Test against live site: `https://ambientpixels.ai/blindspot/`
- New player tests use `?reset=true` first to clear localStorage
- Tests that need auth (forge, card save) are marked and can be skipped in CI
- Each test reports PASS/FAIL with specific detail on what was expected vs actual
- Tests must complete in < 120 seconds total
- Screenshot on every FAIL for debugging

## File Structure

```
blindspot/tests/
├── run-all.js               — existing (smoke + unit, 106 checks)
├── player-flow-tests.js     — NEW: Playwright click-through flows
├── smoke-test.js            — existing structural checks
├── unit-tests.js            — existing game math checks
├── player-simulator.js      — existing (basic nav, 14 checks) — superseded by player-flow-tests.js
└── screenshots/             — failure screenshots
```
