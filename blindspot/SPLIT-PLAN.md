# Blindspot Monolith Split — Plan

## Progress (Mar 23, 2026)

### Completed — 10 modules extracted, 7591 → 5753 lines (-24.2%)

| Module | Lines | API | Status |
|--------|-------|-----|--------|
| `bs-constants.js` | 233 | `window.BsConst` | Done |
| `bs-state.js` | 228 | `window.BsState` | Done |
| `bs-audio-sfx.js` | 366 | `window.BsSfx` | Done |
| `bs-toast.js` | 36 | `window.BsToast` | Done |
| `bs-cosmetics.js` | 250 | `window.BsCosmetics` | Done |
| `bs-crates.js` | 220 | `window.BsCrates` | Done |
| `bs-strategy.js` | 207 | `window.BsStrategy` | Done |
| `bs-card-renderer.js` | 131 | `window.BsCardRenderer` | Done |
| `bs-charms.js` | 245 | `window.BsCharms` | Done (Round 3) |
| `bs-rewards.js` | 279 | `window.BsRewards` | Done (Round 3) |

### Browser verification (Mar 23)
All flows tested via Playwright on live site (`ambientpixels.ai/blindspot/`):
- Landing page + stranger intro: OK
- Stranger battle (tutorial + combat): OK, 12 rounds, win → "Build Your Card"
- play.html lobby (card, rank HUD, bounties, challenges, mode buttons): OK
- Campaign ladder (10 bosses + weekly): OK
- Pre-fight overlay (stat comparison, charm selector, arena selector): OK
- Forge (Stats/Look/Details tabs, palettes, containers): OK
- Card switcher (prev/next, 1/3 → 2/3): OK
- Adventure (BS.adventure(6), typewriter, scene image, choices): OK
- Zero JS errors across all flows

### Bugs found + fixed during verification
- `BsCrates.openOverlay()` crashed when `crateIndex` was `undefined` (NaN index) — added guard
- `BS.addCrate()` didn't call `updateCrateBadge()` — badge stayed hidden after adding crate

### Pattern used
- Each module is a self-contained IIFE exposing `window.BsModuleName`
- Monolith keeps thin delegate functions (1-2 lines each) preserving all call sites
- Cross-cutting concerns use callback injection (`setCallbacks()` pattern)
- `_progress` shared via object reference — in-place mutations work across modules
- Functions that modify `_selectedCard` or call save API stay in monolith

### Round 3 details (charms + rewards)
- **bs-charms.js**: Charm state, selector UI, charm battle button, charm effects, adventure item buttons. Callbacks: `getConfig`, `toast`, `sfx`
- **bs-rewards.js**: CHALLENGES constant (8 milestones x 3 tiers), BOUNTY_POOL, challenge progress tracking, render functions. Callbacks: progression getters (highestBoss, bestStreak, forgeVisits, ascension, cardPower, PvP). `completeBounty` stays in monolith (writes to `_selectedCard`, calls save API). `checkAndClaimChallenges` also stays in monolith.

### Next: bs-progression.js (~200 lines, low ROI — defer)
Tiny getters/setters for sparks, wins, streaks, ascension. These are already thin and well-isolated in the monolith. Extraction provides minimal line reduction since most are 1-liners.

### Round 4+: Page flows (high interdependency)
These are the remaining ~5750 lines. Each page flow (lobby, campaign, forge, battle results,
PvP, tower, deck, navigation) is deeply tangled with DOM and cross-references other flows.
Extraction requires careful callback wiring and browser testing after each module.

## Architecture

### Load order (current)
```html
<script src="js/lib/bs-constants.js"></script>
<script src="js/lib/bs-state.js"></script>
<script src="js/lib/bs-audio-sfx.js"></script>
<script src="js/lib/bs-toast.js"></script>
<script src="js/lib/bs-cosmetics.js"></script>
<script src="js/lib/bs-crates.js"></script>
<script src="js/lib/bs-strategy.js"></script>
<script src="js/lib/bs-card-renderer.js"></script>
<script src="js/lib/bs-charms.js"></script>
<script src="js/lib/bs-rewards.js"></script>
<!-- existing lib modules (arena API, battle UI, adventure, etc.) -->
<script src="js/blindspot-flow.js"></script>
```

### State ownership
- `bs-state.js` owns `_progress` object + server sync + localStorage cache
- `bs-constants.js` owns all game data constants
- `bs-rewards.js` owns CHALLENGES + BOUNTY_POOL constants
- Monolith still owns: `_config`, `_selectedCard`, `_bosses`, `_activeBattle`, and all UI state vars
- Future: move `_config`/`_bosses` to `bs-state.js` after Round 4

### Callback injection (for circular deps)
```js
// In monolith, after loadGameData():
if (_Crt.setCallbacks) _Crt.setCallbacks({ applyCrateLoot, renderLobby, updateSparksShop });
if (_Chm.setCallbacks) _Chm.setCallbacks({ getConfig, toast, sfx });
if (_Rew.setCallbacks) _Rew.setCallbacks({ getHighestBoss, getBestStreak, getForgeVisits, getAscension, getCardPower, getPvPRecord, getPvPElo, getPvPRank, getPvPRanks });
```

## Test infrastructure
- `tests/smoke-test.js` — 23 structural checks (parse, CSS, HTML elements)
- `tests/unit-tests.js` — 83 game math checks (Elo, rarity, archetypes, passives, DC, loot)
- `tests/run-all.js` — combined runner (106 total)
- `tests/player-simulator.js` — Playwright click-through (landing, lobby, campaign, nav)
- `tests/api-contract.js` — boss data + battle API shape validation
