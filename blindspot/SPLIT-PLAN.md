# Blindspot Monolith Split — Plan

## Progress (Mar 23, 2026)

### Completed — 27 modules extracted, 7591 → 2499 lines (-67.1%)

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
| `bs-debug.js` | 323 | `window.BsDebug` | Done (Round 5) |
| `bs-session-stats.js` | 191 | `window.BsSessionStats` | Done (Round 5) |
| `bs-nav.js` | 165 | `window.BsNav` | Done (Round 5) |
| `bs-deck.js` | 185 | `window.BsDeck` | Done (Round 6) |
| `bs-lobby-onboarding.js` | 118 | `window.BsLobbyOnboarding` | Done (Round 6) |
| `bs-battle-results.js` | 398 | `window.BsBattleResults` | Done (Round 6) |
| `bs-loot-choice.js` | 84 | `window.BsLootChoice` | Done (Round 7) |
| `bs-ascension.js` | 116 | `window.BsAscension` | Done (Round 7) |
| `bs-landing.js` | 472 | `window.BsLanding` | Done (Round 7) |
| `bs-tutorial.js` | 82 | `window.BsTutorial` | Done (Round 8) |
| `bs-reward-drops.js` | 101 | `window.BsRewardDrops` | Done (Round 8) |
| `bs-leaderboard.js` | 79 | `window.BsLeaderboard` | Done (Round 8) |
| `bs-combat-tooltips.js` | 80 | `window.BsCombatTooltips` | Done (Round 8) |
| `bs-auth-ui.js` | 43 | `window.BsAuthUI` | Done (Round 8) |

### Browser verification — Round 8 (Mar 23)
All flows tested via Playwright on live site (`ambientpixels.ai/blindspot/`):
- Landing page: OK (13 player-simulator checks pass)
- play.html lobby (card, rank HUD, bounties, challenges, mode buttons): OK
- Campaign screen opens via bottom nav: OK
- Desktop layout (no overflow, nav hidden): OK
- Zero JS errors across index.html + play.html

### Browser verification — Round 7 (Mar 23)
All flows tested via Playwright on live site (`ambientpixels.ai/blindspot/`):
- Landing page: OK (13 player-simulator checks pass)
- play.html lobby (card, rank HUD, bounties, challenges, mode buttons): OK
- Campaign screen opens via bottom nav: OK
- Desktop layout (no overflow, nav hidden): OK
- Zero JS errors across index.html + play.html

### Browser verification — Round 6 (Mar 23)
All flows tested via Playwright on live site (`ambientpixels.ai/blindspot/`):
- Landing page: OK (13 player-simulator checks pass)
- play.html lobby (card, rank HUD, bounties, challenges, mode buttons): OK
- Campaign screen opens via bottom nav: OK
- Desktop layout (no overflow, nav hidden): OK
- Zero JS errors across index.html + play.html

### Browser verification — Round 5 (Mar 23)
All flows tested via Playwright on live site (`ambientpixels.ai/blindspot/`):
- Landing page: OK (13 player-simulator checks pass)
- play.html lobby (card, rank HUD, bounties, challenges, mode buttons): OK
- Campaign screen opens via bottom nav: OK
- Desktop layout (no overflow, nav hidden): OK
- Zero JS errors across index.html + play.html

### Round 5 line reduction
| Step | Monolith | Change |
|------|----------|--------|
| Before Round 5 | 4616 | — |
| After bs-debug.js | 4293 | -323 |
| After bs-session-stats.js | 4102 | -191 |
| After bs-nav.js | 3937 | -165 |
| **Total Round 5** | **3937** | **-679 (-14.7%)** |

### Round 4 line reduction
| Step | Monolith | Change |
|------|----------|--------|
| Before Round 4 | 5753 | — |
| After bs-pvp.js | 5564 | -189 |
| After bs-campaign.js | 5366 | -198 |
| After bs-forge.js | 4616 | -750 |
| **Total Round 4** | **4616** | **-1137 (-19.8%)** |

### Previous browser verifications
**Round 4 (Mar 23):**
- Landing page: OK (13 player-simulator checks pass)
- play.html lobby: OK, Campaign via bottom nav: OK, Desktop layout: OK
- Zero JS errors

**Pre-Round 4 (Mar 23):**
- Landing page + stranger intro: OK
- Stranger battle (tutorial + combat): OK, 12 rounds, win → "Build Your Card"
- Campaign ladder (10 bosses + weekly), Pre-fight overlay, Forge, Card switcher, Adventure: OK
- Zero JS errors

### Bugs found + fixed during verification (pre-Round 4)
- `BsCrates.openOverlay()` crashed when `crateIndex` was `undefined` (NaN index) — added guard
- `BS.addCrate()` didn't call `updateCrateBadge()` — badge stayed hidden after adding crate

### Pattern used
- Each module is a self-contained IIFE exposing `window.BsModuleName`
- Monolith keeps thin delegate functions (1-2 lines each) preserving all call sites
- Cross-cutting concerns use callback injection (`setCallbacks()` pattern)
- `_progress` shared via object reference — in-place mutations work across modules
- Functions that modify `_selectedCard` or call save API stay in monolith
- showScreen/showOverlay/hideOverlay stay in monolith (36+ call sites) — nav module owns event binding only

## Round 5 — Debug + Stats + Nav (COMPLETED Mar 23)

### Extraction results

| Order | Module | Lines | Ease | Key Functions |
|-------|--------|-------|------|---------------|
| 1 | `bs-debug.js` | 323 | Easy | `window.BS` cheat console (sparks, setBoss, godMode, addCrate, cosmetics, etc.) |
| 2 | `bs-session-stats.js` | 191 | Easy | Battle round tracking, boss dialogue, loss tips, session stats display |
| 3 | `bs-nav.js` | 165 | Easy | `bindPlayNavigation()` — bottom nav, back buttons, results buttons, forge overlays |

### Design decisions
- **bs-debug.js**: Uses `_cb.getConfig()` instead of direct `_config` access. `_Crt.updateBadge()` called directly via `window.BsCrates`.
- **bs-session-stats.js**: Owns `_battleRoundStats` variable. Monolith `isEarlyForfeit()` uses `_Ss.getStats()` getter. Tutorial and SFX callbacks injected.
- **bs-nav.js**: showScreen/showOverlay/hideOverlay stay in monolith (too many call sites to redirect). Module owns only event binding. 37 callbacks injected for state access + function delegation.

## Round 6 — Deck + Onboarding + Results (COMPLETED Mar 23)

### Extraction results

| Order | Module | Lines | Ease | Key Functions |
|-------|--------|-------|------|---------------|
| 1 | `bs-deck.js` | 185 | Easy-Medium | Deck grid, card deletion confirm, sort mode toggle. 8 callbacks. |
| 2 | `bs-lobby-onboarding.js` | 118 | Easy | 3-step spotlight welcome tutorial. Zero callbacks (pure DOM). |
| 3 | `bs-battle-results.js` | 398 | Medium | Victory animation, handlePlayPageResult(), XP/sparks/Elo, boss rewards, loot trigger. 50+ callbacks. |

### Design decisions
- **bs-deck.js**: Card selection (_selectedCard write) stays in monolith via `setActiveCard` callback. `MAX_DECK_SIZE` duplicated as local constant (simple value, no import needed).
- **bs-lobby-onboarding.js**: Completely self-contained — no callbacks, no state deps. Cleanest extraction possible.
- **bs-battle-results.js**: Heaviest callback injection in the project (50+). All state reads (`_battleType`, `_currentBossId`, `_bossesById`, `_selectedCard`, `_profile`, `_config`, `_pvpOpponentId`) resolved at call time via getter callbacks. `_pendingForge`, `_lastStreakBonus`, `_lastStreakMsg` write-through via setter callbacks. Converted `const`/`let`/arrow/`Set`/spread to `var`/`function`/object for ES5 compat.

### Round 6 line reduction
| Step | Monolith | Change |
|------|----------|--------|
| Before Round 6 | 3937 | — |
| After bs-deck.js | 3776 | -161 |
| After bs-lobby-onboarding.js | 3665 | -111 |
| After bs-battle-results.js | 3299 | -366 |
| **Total Round 6** | **3299** | **-638 (-16.2%)** |

## Round 7 — Loot + Ascension + Landing (COMPLETED Mar 23)

### Extraction results

| Order | Module | Lines | Ease | Key Functions |
|-------|--------|-------|------|---------------|
| 1 | `bs-loot-choice.js` | 84 | Easy | showLootChoice() — pick 1 of 3 loot cards overlay. 8 callbacks. |
| 2 | `bs-ascension.js` | 116 | Easy-Medium | showAscensionOffer(), performAscension(), getAscensionReward(). 9 callbacks. |
| 3 | `bs-landing.js` | 472 | Medium | initLanding, stranger intro/fight, Quick Build, card reveal, first-fight result, auth UI, forge progress. ~25 callbacks. |

### Design decisions
- **bs-loot-choice.js**: `_pendingForge` accessed via getter/setter callbacks (same pattern as bs-battle-results.js). Converted template literals to string concat for ES5 compat.
- **bs-ascension.js**: `_progress` accessed via `getProgress()` callback — in-place mutations work since it returns the same object reference. `safeLSRemove` replaced with direct `localStorage.removeItem` in try/catch (function only existed in bs-adventure.js, not monolith).
- **bs-landing.js**: Largest extraction in Round 7. `initLanding()` converted from async/await to Promise.all().then() for broader compat. `startStrangerFight()` converted similarly. `showCardRevealCelebration()` split into public function + private `renderCelebration()` helper. `updateLandingAuthUI()` also moved (was in AUTH section of monolith, but only used on landing page).

### Round 7 line reduction
| Step | Monolith | Change |
|------|----------|--------|
| Before Round 7 | 3299 | — |
| After bs-loot-choice.js | 3245 | -54 |
| After bs-ascension.js | 3174 | -71 |
| After bs-landing.js | 2780 | -394 |
| **Total Round 7** | **2780** | **-519 (-15.7%)** |

## Round 8 — Tutorial + Rewards + Leaderboard + Tooltips + Auth (COMPLETED Mar 23)

### Extraction results

| Order | Module | Lines | Ease | Key Functions |
|-------|--------|-------|------|---------------|
| 1 | `bs-tutorial.js` | 82 | Easy | showStrangerTutorial(), removeTutorial(). Owns `_tutorialStep`, `_tutorialEl`. No callbacks (pure DOM + BsConst). |
| 2 | `bs-reward-drops.js` | 101 | Easy-Medium | rollLoot(), applyLootDrop(), showRewardDrop(). Callbacks for `_selectedCard` + `escHtml`. Async/await → Promise chain. |
| 3 | `bs-leaderboard.js` | 79 | Easy | renderLeaderboard(). Callbacks for `_selectedCard` + `escHtml`. Async/await → Promise, spread → manual copy. |
| 4 | `bs-combat-tooltips.js` | 80 | Easy | showBattleHint(), updateCombatTooltips(). Reads constants from BsStrategy + BsConst. Callbacks for `_selectedCard` + `_activeBattle`. |
| 5 | `bs-auth-ui.js` | 43 | Easy | updatePlayAuthUI(). Kept separate from bs-landing.js (different page scope). Callback for `escHtml` only. |

### Design decisions
- **bs-tutorial.js**: Zero callbacks — self-contained DOM manipulation using only BsConst data. Cleanest extraction.
- **bs-reward-drops.js**: `applyLootDrop` modifies `_selectedCard.combatStats` in-place (object reference) then saves via API. Revert on failure stays intact. Converted `async/await` + `Object.assign` + spread to Promise chain + manual copy.
- **bs-leaderboard.js**: Merged the inner try/catch timeout pattern into a single `.catch()` that checks error message. `{ ...card, power }` spread replaced with manual `for..in` copy.
- **bs-combat-tooltips.js**: Reads `BATTLE_HINTS`/`MOVE_UPGRADES` from BsStrategy (not BsConst) and `CLASS_SIGNATURE_MOVES` from BsConst. Template literals converted to string concat.
- **bs-auth-ui.js**: Created standalone module instead of merging into bs-landing.js — landing owns index.html auth, this owns play.html topbar auth. Different pages, different concerns.

### Round 8 line reduction
| Step | Monolith | Change |
|------|----------|--------|
| Before Round 8 | 2780 | — |
| After bs-tutorial.js | 2708 | -72 |
| After bs-reward-drops.js | 2628 | -80 |
| After bs-leaderboard.js | 2572 | -56 |
| After bs-combat-tooltips.js | 2521 | -51 |
| After bs-auth-ui.js | 2499 | -22 |
| **Total Round 8** | **2499** | **-281 (-10.1%)** |

### Lessons from Round 7-8

Round 7 extraction broke the main Fight button (circular callback dep) and went
undetected — tests only checked structure, not real player flows. Polaroid container
style had no CSS. Both basic player-facing features.

**New rule:** Every round starts with player flow tests, extracts modules, then
re-runs the same tests before committing. See `TESTING-PLAN.md` for full test spec.

### Round 9 Plan — Safety net + easy extractions

**Step 1:** Build `player-flow-tests.js` — Playwright click-through coverage for
every critical path (fight button, stranger battle, Quick Build, campaign, pre-fight,
card containers, navigation). Must pass before and after each extraction.

**Step 2:** Extract easy modules with test safety net:
- Storage cleanup (~46 lines, 2567-2612) — cleanupLocalStorage()
- Battle card palette (~21 lines, 2613-2633) — applyBattlePalette()
- Card switcher (~73 lines, 1066-1138) — lobby card arrows
- Pre-fight adventure/fight buttons (~91 lines, 1848-1938) — setupPrefightButtons(), populatePrefightOverlay()

### Round 10+
- New card class picker (~100 lines, 1175-1274) — class picker + create card + forge
- Battle completion hook (~56 lines, 1306-1361) — deeply tangled with state
- Lobby rendering (~369 lines) — cross-references many sections, extract last

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
<script src="js/lib/bs-session-stats.js"></script>
<script src="js/lib/bs-nav.js"></script>
<script src="js/lib/bs-debug.js"></script>
<script src="js/lib/bs-deck.js"></script>
<script src="js/lib/bs-lobby-onboarding.js"></script>
<script src="js/lib/bs-battle-results.js"></script>
<script src="js/lib/bs-loot-choice.js"></script>
<script src="js/lib/bs-ascension.js"></script>
<script src="js/lib/bs-tutorial.js"></script>
<script src="js/lib/bs-reward-drops.js"></script>
<script src="js/lib/bs-leaderboard.js"></script>
<script src="js/lib/bs-combat-tooltips.js"></script>
<script src="js/lib/bs-auth-ui.js"></script>
<script src="js/lib/bs-landing.js"></script>
<!-- existing lib modules (arena API, battle UI, adventure, etc.) -->
<script src="js/blindspot-flow.js"></script>
```

### State ownership
- `bs-state.js` owns `_progress` object + server sync + localStorage cache
- `bs-constants.js` owns all game data constants
- `bs-rewards.js` owns CHALLENGES + BOUNTY_POOL constants
- `bs-session-stats.js` owns `_battleRoundStats` (exposed via `getStats()`)
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
if (_Ss.setCallbacks) _Ss.setCallbacks({ flashMoveResult, playSfx, getBattleType, getCurrentBossId, ... });
if (_Nav.setCallbacks) _Nav.setCallbacks({ showScreen, renderLobby, startCampaignBattle, ... (37 callbacks) });
if (_Deck.setCallbacks) _Deck.setCallbacks({ getDeck, getCardPower, ensureCombatStats, renderCardHTML, escHtml, ... (8 callbacks) });
if (_Br.setCallbacks) _Br.setCallbacks({ playSfx, addSparks, getBattleType, getCurrentBossId, getBossesById, ... (50+ callbacks) });
if (_Dbg.setCallbacks) _Dbg.setCallbacks({ getConfig, renderLobby, openForgeScreen, getSelectedCard, playVictoryAnimation });
if (_Loot.setCallbacks) _Loot.setCallbacks({ showOverlay, hideOverlay, playSfx, applyLootDrop, showRewardDrop, getSparks, getPendingForge, setPendingForge });
if (_Asc.setCallbacks) _Asc.setCallbacks({ playSfx, showScreen, renderLobby, showSuccessToast, syncProgressToServer, setAscension, awardCrate, unlockVisual, setForgeWins, getProgress });
if (_Rd.setCallbacks) _Rd.setCallbacks({ getSelectedCard, escHtml });
if (_Lb.setCallbacks) _Lb.setCallbacks({ getSelectedCard, escHtml });
if (_Ct.setCallbacks) _Ct.setCallbacks({ getSelectedCard, getActiveBattle });
if (_Au.setCallbacks) _Au.setCallbacks({ escHtml });
if (_Land.setCallbacks) _Land.setCallbacks({ loadGameData, loadProfile, showOverlay, hideOverlay, showErrorToast, safeLSSet, isDemo, isNewPlayer, ... (~25 callbacks) });
// _Onb (BsLobbyOnboarding) — no callbacks needed (pure DOM)
```

## Test infrastructure
- `tests/smoke-test.js` — 23 structural checks (parse, CSS, HTML elements)
- `tests/unit-tests.js` — 83 game math checks (Elo, rarity, archetypes, passives, DC, loot)
- `tests/run-all.js` — combined runner (106 total)
- `tests/player-simulator.js` — Playwright click-through (landing, lobby, campaign, nav)
- `tests/api-contract.js` — boss data + battle API shape validation
