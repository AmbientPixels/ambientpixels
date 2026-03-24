# Blindspot Monolith Split — Plan

## Current State (Mar 23, 2026)
- `blindspot-flow.js`: 7591 lines, 46 sections, ~50 shared mutable variables
- All code inside a single IIFE — no exports, everything communicates via closure
- Test safety net: 23 smoke checks + 83 unit tests (`node tests/run-all.js`)

## The Core Problem
Almost everything reads/writes `_progress` and `_selectedCard`. These two objects plus `_config` and `_bosses` are the gravitational center.

## State Management Strategy
Create a **shared state module** (`bs-state.js`) that:
- Owns all mutable state variables
- Exposes getters/setters (not raw references)
- Is loaded first, before all other modules
- Other modules access state via `window.BsState`

## Module Split Order (incremental, one per session)

### Round 1: Pure utilities (zero risk)
| Module | ~Lines | Source Sections |
|--------|--------|----------------|
| `bs-audio-sfx.js` | 260 | SFX defs + ambient audio |
| `bs-toast.js` | 30 | Toast notifications |

### Round 2: State + constants
| Module | ~Lines | Notes |
|--------|--------|-------|
| `bs-state.js` | 200 | Central state owner. `window.BsState` |
| `bs-constants.js` | 150 | ARCHETYPES, STAT_PASSIVES, CARD_RARITIES, LOOT_TABLE, PVP_RANKS, etc. |

### Round 3: Game systems
| Module | ~Lines | Source Sections |
|--------|--------|----------------|
| `bs-progression.js` | 200 | Progression getters/setters, tower, weekly, mastery |
| `bs-strategy.js` | 280 | Passives, archetypes, move upgrades, prefight info |
| `bs-rarity.js` | 40 | Card rarity from forge visits |
| `bs-cosmetics.js` | 230 | Cosmetic inventory, equipping |
| `bs-charms.js` | 200 | Charm selection, adventure items |
| `bs-crates.js` | 250 | Crate inventory, opening ceremony |
| `bs-rewards.js` | 300 | Loot drops, challenges, bounties |

### Round 4: Battle systems
| Module | ~Lines | Source Sections |
|--------|--------|----------------|
| `bs-battle-hooks.js` | 200 | Battle tracking, results hook |
| `bs-pvp.js` | 260 | PvP gallery, matchmaking, Elo |
| `bs-ascension.js` | 60 | Ascension offers and rewards |

### Round 5: Page flows (largest, most interconnected)
| Module | ~Lines | Source Sections |
|--------|--------|----------------|
| `bs-lobby.js` | 400 | Lobby rendering, onboarding |
| `bs-campaign.js` | 150 | Campaign ladder |
| `bs-tower.js` | 180 | Infinite tower |
| `bs-forge-screen.js` | 800 | Full forge UI |
| `bs-deck.js` | 400 | Deck management, card switcher |
| `bs-battle-results.js` | 400 | Post-battle screens, victory |
| `bs-landing.js` | 200 | Landing page, stranger intro |
| `bs-navigation.js` | 200 | Screen routing, bottom nav |

### Round 6: Cleanup
| Module | ~Lines | Source Sections |
|--------|--------|----------------|
| `bs-cheats.js` | 350 | Debug console |
| `blindspot-flow.js` | ~100 | Boot only (init + DOMContentLoaded) |

## Per-Session Protocol
1. Extract ONE module
2. Wire via `window.BsModuleName` (IIFE pattern, same as bs-adventure.js)
3. Add `<script>` tag to index.html and play.html
4. Run `node tests/run-all.js` — must pass
5. Manual smoke test in browser (lobby loads, battle starts)
6. Commit + push

## Shared State Variables (move to bs-state.js)
```
_progress, _progressLoaded, _syncInFlight, _syncTimer
_config, _bosses, _bossesById, _bossesByNumber
_selectedCard, _strangerCard
_profile, _profileData
_activeBattle, _currentBossId, _battleType
_isStrangerFight, _isFirstRealFight
_equippedCharm, _charmUsedThisBattle
_adventureItems, _adventureItemsUsed
_pvpGallery, _pvpOpponentId
_hookInstalled, _origShowResults, _battleRoundStats, _submitMoveHooked
_towerPendingFloor, _pendingForge
_lastStreakBonus, _lastStreakMsg
_cosmeticLookup, _cosmeticsBySlot, _collectionSlot
_switcherBound, _deckSortMode, _deckEventsBound, _deckDeleteTarget
_newCardBound, _navBound, _sparksShopBound
_tutorialStep, _tutorialEl
_audioCtx, _ambientNodes
_loadingTarget, _loadingCurrent, _loadingRAF, _loadingFill
```
