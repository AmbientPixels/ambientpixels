# Blindspot Game — Improvement Tasks

## Status
Blindspot is a standalone arena combat card game at /blindspot/. 62 iterations shipped. Core loop works: landing → stranger fight → quick build → campaign (10 bosses with images) → forge → PvP. Needs polish to feel like a shippable game.

## Done
- (2026-03-20) Campaign progress: "X/10 defeated" counter in campaign header, crown icon when all bosses beaten. Populates existing `#bs-campaign-progress` span in renderCampaignLadder().
- (2026-03-20) Landing page intro: cinematic text sequence before first stranger fight — "You are The Stranger" / "This card is not yours" / "Win it... or lose everything." Staggered fade-up with Cinzel font, accent final line, localStorage gate (once only), landing fade-out transition.
- (2026-03-20) Mobile battle: optimized 5-button move layout for touch — 3+2 grid, min-height 64px/60px, touch-action:manipulation (no tap delay), active scale+brightness feedback, larger icons (1.3-1.4rem), bigger labels on small phones.
- (2026-03-20) Forge respec: already implemented — respec button in Stats tab (costs forge wins), activateRespec() resets sliders to 0 and pools all stat points, deducts respecCost on forge apply. No changes needed.
- (2026-03-20) PvP matchmaking: "Searching for opponent..." overlay with spinner → opponent card reveal (slide-in + VS flash) → battle start. API call runs in parallel with animation. Player + opponent cards shown side-by-side.
- (2026-03-20) Lobby stat bars: damage/heal estimates next to each stat — STR shows strike dmg range, AGI shows charge bonus, INT shows ability dmg range, END shows heal range + HP total, LCK shows wild card range. CSS for .bs-stat-bar-est with mobile breakpoint.
- (2026-03-20) Quick Build card reveal: full-screen celebration overlay after saving card — card display with name/class/rarity/avatar/stats, particle burst, glow pulse, "Your card is ready" message, auto-redirect after 8s, fixed fa-swords → fa-shield-halved
- (2026-03-20) Boss avatar flow verified: all 10 boss images exist, avatar field in all 3 data files, API passes avatar through startBattle response, arena-battle-ui.js renders img tags — no issues found
- (2026-03-20) Forge Look tab: palette/container preview now updates visually on mobile — scroll-into-view with glow flash, narrowed selectors, compact card size, CSS transitions, cascade fix (mobile breakpoint after base styles), inferno/frost palette styles, fullbleed mobile scaling
- (2026-03-20) iter 56-62: mobile bottom nav, bounty rewards, boss images, in-game leaderboard, loot choice (pick 1 of 3), combat guide overlay, combat tooltips, forge palette preview, ascension system, stat bars, boss defeat tips, streak glow, battle palette borders

## Next up (do these in order)
1. Battle combat log: improve round-by-round messaging clarity ("You struck for 27. Enemy guarded, blocked 60%."). File: server-side in `ambientpixels/api/cardforgearenabattle/index.js` (resolveRound events)

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
