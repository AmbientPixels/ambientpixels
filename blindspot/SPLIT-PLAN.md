# Blindspot Monolith Split — Plan

## Progress (Mar 23, 2026)

### Completed — 13 modules extracted, 7591 → 4616 lines (-39.2%)

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
| `bs-pvp.js` | 248 | `window.BsPvp` | Done (Round 4) |
| `bs-campaign.js` | 254 | `window.BsCampaign` | Done (Round 4) |
| `bs-forge.js` | 824 | `window.BsForge` | Done (Round 4) |

### Browser verification — Round 4 (Mar 23)
All flows tested via Playwright on live site (`ambientpixels.ai/blindspot/`):
- Landing page: OK (13 player-simulator checks pass)
- play.html lobby (card, rank HUD, bounties, challenges, mode buttons): OK
- Campaign screen opens via bottom nav: OK
- Desktop layout (no overflow, nav hidden): OK
- Zero JS errors across index.html + play.html

### Round 4 line reduction
| Step | Monolith | Change |
|------|----------|--------|
| Before Round 4 | 5753 | — |
| After bs-pvp.js | 5564 | -189 |
| After bs-campaign.js | 5366 | -198 |
| After bs-forge.js | 4616 | -750 |
| **Total Round 4** | **4616** | **-1137 (-19.8%)** |

### Previous browser verification (Mar 23, pre-Round 4)
- Landing page + stranger intro: OK
- Stranger battle (tutorial + combat): OK, 12 rounds, win → "Build Your Card"
- play.html lobby (card, rank HUD, bounties, challenges, mode buttons): OK
- Campaign ladder (10 bosses + weekly): OK
- Pre-fight overlay (stat comparison, charm selector, arena selector): OK
- Forge (Stats/Look/Details tabs, palettes, containers): OK
- Card switcher (prev/next, 1/3 → 2/3): OK
- Adventure (BS.adventure(6), typewriter, scene image, choices): OK
- Zero JS errors across all flows

### Bugs found + fixed during verification (pre-Round 4)
- `BsCrates.openOverlay()` crashed when `crateIndex` was `undefined` (NaN index) — added guard
- `BS.addCrate()` didn't call `updateCrateBadge()` — badge stayed hidden after adding crate

### Pattern used
- Each module is a self-contained IIFE exposing `window.BsModuleName`
- Monolith keeps thin delegate functions (1-2 lines each) preserving all call sites
- Cross-cutting concerns use callback injection (`setCallbacks()` pattern)
- `_progress` shared via object reference — in-place mutations work across modules
- Functions that modify `_selectedCard` or call save API stay in monolith

## Round 4 — Page Flows (COMPLETED Mar 23)

### Extraction results

| Order | Module | Lines | Ease | Key Functions |
|-------|--------|-------|------|---------------|
| 1 | `bs-pvp.js` | 248 | Easy | `renderPvPGallery`, `showPvPComparison`, PvP Elo helpers, rating display |
| 2 | `bs-campaign.js` | 254 | Easy | `renderCampaignLadder`, `renderTowerSection`, weekly boss UI |
| 3 | `bs-forge.js` | 824 | Medium | Stat allocation, palette/container UI, avatar, canvas particles |

## Round 5 Plan — Big Sections

Monolith is at 4616 lines. Remaining sections by size:

| Size | Section | Ease | Notes |
|------|---------|------|-------|
| 422 | Battle Results | Medium | Victory animations, result display, session stats overlay. Reads `_battleType`, `_currentBossId`, `_activeBattle`. |
| 393 | Landing Page | Medium | Stranger intro, fight flow, Quick Build trigger. Heavy DOM + auth flow. |
| 368 | Lobby | Medium-Hard | Lobby rendering — cross-references many sections (card, rank HUD, bounties, challenges, mode buttons). |
| 329 | Debug Console | Easy | `window.BS` cheat console. Zero tanglement — reads/writes `_progress` only. |
| 212 | Session Stats | Easy | Battle round tracking + display. Isolated data collector. |
| 207 | Navigation | Easy | `showScreen()`, bottom nav, back buttons. Low deps. |
| 179 | Deck Management | Easy-Medium | Deck grid, card deletion, deck switcher overlay. |
| 149 | Shared Utilities | Low ROI | `escHtml`, boss record, mastery stars — many callers depend on these. |
| 117 | Lobby Onboarding | Easy | 3-step spotlight tutorial. Isolated DOM. |

### Recommended extraction order

| Order | Module | ~Lines | Ease | Why |
|-------|--------|--------|------|-----|
| 1 | `bs-debug.js` | 329 | Easy | Zero tanglement, self-contained `window.BS` console. Biggest easy win. |
| 2 | `bs-session-stats.js` | 212 | Easy | Isolated data collector + display. No cross-cutting deps. |
| 3 | `bs-nav.js` | 207 | Easy | `showScreen()`, bottom nav wiring. Low deps, high call count → big delegate surface. |
| 4 | `bs-deck.js` | 179 | Easy-Medium | Deck management overlay. Moderate card data deps. |
| 5 | `bs-battle-results.js` | 422 | Medium | Victory animations, XP/sparks/Elo, loot trigger. Many state writes. |

Round 5 target: modules 1-3 (~748 lines, 4616→~3868, pushing below 4000).

### Deferred (Round 6+)
- Landing Page (~393 lines) — heavy auth + DOM flow, benefits from all other modules being stable first
- Lobby rendering (~368 lines) — cross-references many sections, extract last
- Battle orchestration (~49 lines `BATTLE COMPLETION HOOK` + scattered) — deeply tangled with state

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
<script src="js/lib/bs-pvp.js"></script>
<script src="js/lib/bs-campaign.js"></script>
<script src="js/lib/bs-forge.js"></script>
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
if (_Pvp.setCallbacks) _Pvp.setCallbacks({ getSelectedCard, getCardPower, ensureCombatStats, escHtml, ... });
if (_Camp.setCallbacks) _Camp.setCallbacks({ getBosses, getBossesById, getHighestBoss, ... });
if (_Forge.setCallbacks) _Forge.setCallbacks({ getConfig, getSelectedCard, setSelectedCard, ... });
```

## Test infrastructure
- `tests/smoke-test.js` — 23 structural checks (parse, CSS, HTML elements)
- `tests/unit-tests.js` — 83 game math checks (Elo, rarity, archetypes, passives, DC, loot)
- `tests/run-all.js` — combined runner (106 total)
- `tests/player-simulator.js` — Playwright click-through (landing, lobby, campaign, nav)
- `tests/api-contract.js` — boss data + battle API shape validation
