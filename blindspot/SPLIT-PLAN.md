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

## Round 4 Plan — Page Flows

### Extraction order (by ease + impact)

| Order | Module | ~Lines | Ease | Key Functions |
|-------|--------|--------|------|---------------|
| 1 | `bs-pvp.js` | 257 | Easy | `renderPvPGallery`, `showPvPComparison`, PvP rating display |
| 2 | `bs-campaign.js` | 280 | Easy | `renderCampaignLadder`, `renderTowerSection`, weekly boss UI |
| 3 | `bs-forge.js` | 795 | Medium | Stat allocation, palette/container UI, avatar, canvas particles |

### Round 4.1: `bs-pvp.js` (~257 lines, lines 3644-3900)
**What moves:** PvP gallery rendering, opponent selection, Elo display, rank badges, PvP comparison overlay.
**Dependencies:** Very low — only reads `_progress.pvpElo/pvpRecord`, `_selectedCard` for opponent estimation. No `_config` or `_bosses`. Isolated DOM (`#bs-pvp-grid`, `#bs-pvp-rating`).
**Stays in monolith:** `startPvPBattle()` (battle orchestration), PvP result handling.
**Callbacks needed:** `getSelectedCard`, `estimateOpponentElo`, `toast`.

### Round 4.2: `bs-campaign.js` (~280 lines, lines 2871-3150)
**What moves:** Campaign ladder rendering (10 bosses), weekly boss UI, tower section, boss selection → prefight.
**Dependencies:** Low-medium — reads `_bosses`/`_bossesByNumber` (read-only), calls `populatePrefightOverlay()` (already delegated to `_Str`), calls `setupPrefightButtons()`.
**Stays in monolith:** `startCampaignBattle()`, `recordBossResult()`, battle orchestration.
**Callbacks needed:** `getBosses`, `getHighestBoss`, `getWeeklyBoss`, `setupPrefightButtons`, `showScreen`.

### Round 4.3: `bs-forge.js` (~795 lines, lines 3906-4700)
**What moves:** Full forge UI (stat sliders, palette/container unlock, avatar gallery/AI gen, name/quote editing), canvas ember particles.
**Dependencies:** Medium — heavy read/write on `_selectedCard` (18 refs), reads `_config` for unlock costs, uses `_Cos` for cosmetics.
**Stays in monolith:** Forge trigger logic (`_pendingForge` flag).
**Callbacks needed:** `getSelectedCard`, `setSelectedCard`, `getConfig`, `syncProgressToServer`, `saveCard`, cosmetic delegates.

### Deferred
- `bs-progression.js` (~200 lines) — tiny getters/setters, low ROI
- Battle orchestration (~461 lines) — too tangled, Round 5+
- Lobby rendering (~365 lines) — cross-references many sections, Round 5+

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

### Callback injection (for circular deps)
```js
// In monolith, after loadGameData():
if (_Crt.setCallbacks) _Crt.setCallbacks({ applyCrateLoot, renderLobby, updateSparksShop });
if (_Chm.setCallbacks) _Chm.setCallbacks({ getConfig, toast, sfx });
if (_Rew.setCallbacks) _Rew.setCallbacks({ getHighestBoss, getBestStreak, ... });
// Round 4 will add: _Pvp.setCallbacks, _Camp.setCallbacks, _Forge.setCallbacks
```

## Test infrastructure
- `tests/smoke-test.js` — 23 structural checks (parse, CSS, HTML elements)
- `tests/unit-tests.js` — 83 game math checks (Elo, rarity, archetypes, passives, DC, loot)
- `tests/run-all.js` — combined runner (106 total)
- `tests/player-simulator.js` — Playwright click-through (landing, lobby, campaign, nav)
- `tests/api-contract.js` — boss data + battle API shape validation
