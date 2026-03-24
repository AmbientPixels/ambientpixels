# Blindspot Monolith Split — Plan

## Progress (Mar 23, 2026)

### Completed — 8 modules extracted, 7591 → 6169 lines (-18.7%)

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

### Pattern used
- Each module is a self-contained IIFE exposing `window.BsModuleName`
- Monolith keeps thin delegate functions (1-2 lines each) preserving all call sites
- Cross-cutting concerns use callback injection (`setCallbacks()` pattern, see bs-crates.js)
- `_progress` shared via object reference — in-place mutations work across modules

### Next session: Browser verification FIRST
**Do not extract more modules until the game is tested in-browser.**
The test suite (106 checks) only covers parse + math. DOM rendering, overlay transitions,
cosmetic equip/unequip, SFX playback, crate opening, and prefight stat comparison all need
manual browser verification. Potential failure modes:
- Delegate functions called before module loads (script order)
- `_config` not passed to crate/cosmetic modules (callbacks wired after loadGameData)
- `ensureCombatStats` delegation breaking card display pipeline
- Cosmetic collection tab switching via `_Cos.setSlot()` instead of local var

### After verification: remaining Round 3 targets
| Module | ~Lines | Notes |
|--------|--------|-------|
| `bs-charms.js` | 200 | Charm selection, adventure items in battle |
| `bs-rewards.js` | 300 | Loot drops, challenges, bounties |
| `bs-progression.js` | 200 | Tiny getters/setters — low ROI, defer |

### Round 4+: Page flows (high interdependency)
These are the remaining ~6000 lines. Each page flow (lobby, campaign, forge, battle results,
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
<!-- existing lib modules (arena API, battle UI, adventure, etc.) -->
<script src="js/blindspot-flow.js"></script>
```

### State ownership
- `bs-state.js` owns `_progress` object + server sync + localStorage cache
- `bs-constants.js` owns all game data constants
- Monolith still owns: `_config`, `_selectedCard`, `_bosses`, `_activeBattle`, and all UI state vars
- Future: move `_config`/`_bosses` to `bs-state.js` after Round 3

### Callback injection (for circular deps)
```js
// In monolith, after loadGameData():
if (_Crt.setCallbacks) _Crt.setCallbacks({
  applyCrateLoot: applyCrateLoot,
  renderLobby: renderLobby,
  updateSparksShop: updateSparksShop
});
```

## Test infrastructure
- `tests/smoke-test.js` — 23 structural checks (parse, CSS, HTML elements)
- `tests/unit-tests.js` — 83 game math checks (Elo, rarity, archetypes, passives, DC, loot)
- `tests/run-all.js` — combined runner (106 total)
- `tests/player-simulator.js` — Playwright click-through (landing, lobby, campaign, nav)
- `tests/api-contract.js` — boss data + battle API shape validation
