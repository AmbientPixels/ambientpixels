# Blindspot Game — Improvement Tasks

## Status
Blindspot is a standalone arena combat card game at /blindspot/. 62 iterations shipped. Core loop works: landing → stranger fight → quick build → campaign (10 bosses with images) → forge → PvP. Needs polish to feel like a shippable game.

## Done
- (2026-03-20) Forge Look tab: palette/container preview now updates visually on mobile — scroll-into-view with glow flash, narrowed selectors, compact card size, CSS transitions
- (2026-03-20) iter 56-62: mobile bottom nav, bounty rewards, boss images, in-game leaderboard, loot choice (pick 1 of 3), combat guide overlay, combat tooltips, forge palette preview, ascension system, stat bars, boss defeat tips, streak glow, battle palette borders

## Next up (do these in order)
1. Battle screen: verify boss avatars flow from server arena-bosses.json through startBattle API response to renderCombatants in arena-battle-ui.js — if avatars are empty in the battle response, the skull placeholder shows. Files: `ambientpixels/api/cardforgearenabattle/arena-bosses.json`, `ambientpixels/api/cardforgearenabattle/index.js`
3. Quick Build card reveal: after building your card, show a full-screen card reveal celebration (flip animation, particle burst, "Your card is ready") instead of silently redirecting. Files: `ambientpixels/blindspot/js/blindspot-flow.js` (openBlindspotQuickBuild callback), `ambientpixels/blindspot/css/blindspot.css`
4. Lobby stat bars: show damage/heal estimates next to each stat (e.g., "STR 60 → ~24-30 dmg"). File: `ambientpixels/blindspot/js/blindspot-flow.js` (renderLobby stat bars section)
5. PvP screen: add a matchmaking feel with "Searching for opponent..." animation and opponent card reveal. Files: `ambientpixels/blindspot/js/blindspot-flow.js` (renderPvPGallery, startPvPBattle), `ambientpixels/blindspot/css/blindspot.css`
6. Forge respec: let players redistribute ALL stat points (costs forge points). File: `ambientpixels/blindspot/js/blindspot-flow.js` (openForgeScreen)
7. Mobile battle: optimize the 5-button move layout for touch — larger targets, 3+2 grid. File: `ambientpixels/blindspot/css/blindspot.css`
8. Landing page: add dramatic intro before stranger fight ("You are The Stranger. This card is not yours."). File: `ambientpixels/blindspot/js/blindspot-flow.js` (startStrangerFight)
9. Campaign header: show "X/10 defeated" progress counter. File: `ambientpixels/blindspot/js/blindspot-flow.js` (renderCampaignLadder)
10. Battle combat log: improve round-by-round messaging clarity ("You struck for 27. Enemy guarded, blocked 60%."). File: server-side in `ambientpixels/api/cardforgearenabattle/index.js` (resolveRound events)

## Backlog
- Sound effects for loot drops, boss defeats, ascension, forge completion
- Weekly rotating boss with unique rewards
- PvP Elo rating + visible rank
- Build challenges for replayability
- Card border effects for ascension levels
- Session stats after each fight
- Accessibility (ARIA labels)
- Pre-fight boss stat comparison
- Endgame: Infinite Tower after Ascension 5
