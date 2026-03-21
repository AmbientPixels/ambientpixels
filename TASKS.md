# Blindspot Game — Improvement Tasks

## Status
Blindspot is a standalone arena combat card game at /blindspot/. 74 iterations shipped. Core loop works: landing → stranger fight → quick build → campaign (10 bosses with images) → forge → PvP. Needs polish to feel like a shippable game.

## Done
- (2026-03-21) Boss mastery stars: 3 tiers (bronze/silver/gold at 3/5/10 wins). Bronze: +1 to boss weakness stat. Silver: title "BossName's Bane". Gold: +25 sparks. Stars render on campaign ladder next to boss name. Mastery resets on ascension.
- (2026-03-21) Card rarity system: forge visits drive rarity — Common (0) → Uncommon (3, +2% crit) → Rare (8, +5% crit) → Epic (15, +3 all stats) → Legendary (25, +5 all stats, "The Forgeborn" title). Border glow per tier, rarity badge on lobby card, passives panel shows rarity bonuses, upgrade toast on tier change.
- (2026-03-21) Move result feedback: already implemented — MOVE_BEATS map, flashMoveResult() with green/red glow, CSS at line 1690.
- (2026-03-21) Loss screen with rematch + advice: data-driven tip based on what killed the player (boss abilities → try Guard, never healed → Heal below 50%, etc.) plus prominent Rematch button for instant retry. Reduces friction from loss to retry.
- (2026-03-21) Pre-fight boss pattern hint: CLASS_PATTERNS map (12 classes) shows "Tends to: X" line in pre-fight overlay for campaign, Enter Arena, and tower fights. Helps players anticipate boss strategy.
- (2026-03-21) Post-Quick-Build onboarding: 3-step spotlight guide (Campaign → Forge → PvP) with dark backdrop, spotlight cutout around target element, step counter, back/next navigation. Shown once on first lobby visit via `bs-onboarded-lobby` localStorage flag. Test harnesses updated to dismiss overlay.
- (2026-03-21) First-battle tutorial hints: contextual hint banners above move buttons for first 3 campaign battles. Round 1 shows introductory tips (Strike/Counter/Heal); after each round, shows counter-play hint based on boss move (e.g., "The boss guarded — Ability stuns guards!"). Dismissable via X button. Tracked via `bs-tutorial-battle-count` localStorage.
- (2026-03-21) Boss adaptive scaling: server-side in cardforgearenabattle — when player power exceeds boss power by 20%+, boss stats scale by min(2.0, playerPower/bossPower * 0.85). Keeps Boss 1 easy for new players but competitive for high-power cards.
- (2026-03-20) Forge stat budget cap: total power capped at 400 — bonus points auto-reduced if current total + bonus exceeds cap. Budget line shows Power: X/400. Respec also caps at 400. Existing cards above 400 grandfathered with 0 bonus points.
- (2026-03-20) Forge sticky Cancel/Forge buttons: moved actions outside scrollable area into flex-pinned footer with border-top separator. Removes 5rem padding workaround.
- (2026-03-20) Mobile campaign + overlays: responsive CSS for 375-480px — compact boss cards, scrollable pre-fight overlay with compact stat comparison, vertical loot card stack, tighter How to Play modal with 44px close target, compact results screen, compact combat guide/weekly/tower sections.
- (2026-03-20) Mobile forge overlay: scrollable viewport (overflow-y auto), slider thumbs 28px for touch, 44px tab/button touch targets, card preview compacts to 100px at 375px, budget wraps, action buttons full-width, 5rem bottom padding for reachability.
- (2026-03-20) Mobile battle layout: responsive CSS for 375-480px — compact battle header, nameplate overlap fix for horizontal cards, combat log max-height constrained, HP/hype bar text scaled, buff chips wrap, move buttons sized for 375px.
- (2026-03-20) Pre-fight boss stat comparison: dual bar chart in prefight overlay showing player vs boss stats (STR/AGI/INT/END/LCK) with color-coded advantage/disadvantage. Added combatStats to client-side bosses.json. CSS grid layout with centered stat labels and mirrored fill bars.
- (2026-03-20) Battle combat log: improved round-by-round messaging clarity — emoji prefixes per event type (⚔️ strikes, 🛡️ guards, ✨ crits, 💚 heals, 🔥 burn, 💥 stun, 🌑 blind, 🔄 counter, ❌ fails), consistent "Enemy" terminology (was mixed Opponent/Enemy), guard shows block % with before/after damage, heal disruption shows reduction %, net round summary ("📊 Net: You dealt X dmg, healed Y HP, took Z dmg"). Server-side in `api/cardforgearenabattle/index.js`.
- (2026-03-20) Campaign progress: "X/10 defeated" counter in campaign header, crown icon when all bosses beaten. Populates existing `#bs-campaign-progress` span in renderCampaignLadder().
- (2026-03-20) Landing page intro: cinematic text sequence before first stranger fight — "You are The Stranger" / "This card is not yours" / "Win it... or lose everything." Staggered fade-up with Cinzel font, accent final line, localStorage gate (once only), landing fade-out transition.
- (2026-03-20) Mobile battle: optimized 5-button move layout for touch — 3+2 grid, min-height 64px/60px, touch-action:manipulation (no tap delay), active scale+brightness feedback, larger icons (1.3-1.4rem), bigger labels on small phones.
- (2026-03-20) Forge respec: already implemented — respec button in Stats tab (costs forge wins), activateRespec() resets sliders to 0 and pools all stat points, deducts respecCost on forge apply. No changes needed.
- (2026-03-20) PvP matchmaking: "Searching for opponent..." overlay with spinner → opponent card reveal (slide-in + VS flash) → battle start. API call runs in parallel with animation. Player + opponent cards shown side-by-side with avatars/names/class.
- (2026-03-20) Lobby stat bars: damage/heal estimates next to each stat — STR shows strike dmg range, AGI shows charge bonus, INT shows ability dmg range, END shows heal range + HP total, LCK shows wild card range. CSS for .bs-stat-bar-est with mobile breakpoint.
- (2026-03-20) Quick Build card reveal: full-screen celebration overlay after saving card — card display with name/class/rarity/avatar/stats, particle burst, glow pulse, "Your card is ready" message, auto-redirect after 8s, fixed fa-swords (Pro-only) → fa-shield-halved (free)
- (2026-03-20) Boss avatar flow verified: all 10 boss images exist, avatar field in all 3 data files, API passes avatar through startBattle response, arena-battle-ui.js renders img tags — no issues found
- (2026-03-20) Forge Look tab: palette/container preview now updates visually on mobile — scroll-into-view with glow flash, narrowed selectors, compact card size, CSS transitions, cascade fix (mobile breakpoint after base styles), inferno/frost palette styles, fullbleed mobile scaling
- (2026-03-20) iter 56-62: mobile bottom nav, bounty rewards, boss images, in-game leaderboard, loot choice (pick 1 of 3), combat guide overlay, combat tooltips, forge palette preview, ascension system, stat bars, boss defeat tips, streak glow, battle palette borders

## Done (continued)
- (2026-03-20) Session stats panel: post-battle summary showing damage dealt (red), damage taken (orange), healing done (green), rounds survived, and move breakdown with icons. Hooks ArenaAPI.submitMove to track per-round data, resets on initBattle. Responsive 4-col → 2-col grid, monospace values, Cinzel title. Extended to first real fight (handleFirstRealFightResult).
- (2026-03-20) Sound effects: Web Audio API synthesizer with 6 sounds — loot (sparkle arpeggio), bossDefeat (power chord fanfare), ascension (rising sweep + shimmer), forgeComplete (anvil hit + metallic ring), battleWin (ascending jingle), battleLoss (descending minor notes). Mute unified with ArenaAudio toggle (top bar bolt icon controls both file SFX and synth sounds). Removed redundant _sfxMuted state.

## Done (continued 2)
- (2026-03-20) Weekly rotating boss: 4 bosses (Revenant/Berserker, Mirage/Trickster, Colossus/Guardian, Oracle/Caster) rotate by ISO week number. First weekly win awards stat bonus (+8) and 2 forge wins, tracked per-week via localStorage (resets Monday). Rendered above campaign ladder with accent-bordered card, countdown timer, win/loss badge, replay after cleared. Server-side bossLevel 201-204 skip progression gating (always available for signed-in users). CSS: weekly challenge container with gradient border, weekly boss card styling, done-state opacity.
- (2026-03-20) PvP Elo rating + visible rank: 6 rank tiers (Iron→Diamond) based on Elo rating (K=32). Opponent Elo estimated from card power. PvP screen shows rank badge, Elo number, W/L record, progress bar to next tier. Gallery cards show opponent estimated Elo. Elo change toast after PvP battles with rank-up announcement. Lobby stats show PvP rating when unlocked. All localStorage (bs-pvp-elo, bs-pvp-record).
- (2026-03-20) Mobile lobby layout (375px): lobby stats row flex-wraps, stat bar estimates hidden at 375px (removed min-width at 480px), passives max-width 100% on mobile, challenges header 44px touch target, toast positioned above bottom nav.

## Done (continued 3)
- (2026-03-20) Challenges for replayability: 8 persistent challenges with 3 tiers each (bronze/silver/gold) — Warrior (wins), Slayer (bosses), Unstoppable (streak), Artisan (forge visits), Transcendent (ascension), Gladiator (PvP), Completionist (bounties), Powerhouse (card power). Each tier awards stat bonuses or forge wins. Collapsible panel in lobby with progress bars, tier pips, reward labels. Tracks total wins + total bounties completed. Auto-checks and grants rewards on lobby render.
- (2026-03-20) Card border effects for ascension levels: 5 tiers — Ember (warm pulse), Frost (icy shimmer), Arcane (purple crackle), Void (dark energy), Holographic (rainbow prismatic spin). Data attribute on lobby card display drives CSS-only effects. Each matches its ascension palette unlock. Ascension 5 holographic uses dual conic-gradient pseudo-elements with counter-rotating spin.
- (2026-03-20) Accessibility (ARIA labels): role=region on screens, role=dialog on overlays, role=alertdialog on forfeit modal, role=progressbar on HP/XP/hype/forge bars, role=log on combat log with aria-live, aria-label on move buttons + nav + back buttons + audio toggles, aria-hidden on decorative icons/canvas/VS divider, aria-current on bottom nav, role=list on challenges/bounties.

## Done (continued 4)
- (2026-03-20) Endgame — Infinite Tower after Ascension 5: survival roguelike mode in campaign screen. Cycles through 10 campaign bosses (floor N = boss (N-1)%10+1). Lose once → reset to floor 1. Tracks best floor (localStorage). Milestone rewards every 5 floors: +3 stat bonuses at floors 5/10/15/20/25, titles at 30/50. Tower section with floor counter, next boss preview with avatar, cycle indicator, Enter/Continue button. Prefight overlay with stat comparison. Tower battle type in results: "Floor X Cleared" / "Tower Run Over" with Next Floor / Exit Tower buttons. Win auto-advances to next floor. CSS: gradient border card, centered floor display, responsive mobile layout. Ascension 5 reward text updated to mention tower unlock.

## Next up (do these in order)

### Phase 1: Mobile — make it work on phones
1. ~~**Mobile lobby layout**~~ ✅ Done

2. ~~**Mobile battle layout**~~ ✅ Done

3. ~~**Mobile forge overlay**~~ ✅ Done

4. ~~**Mobile campaign + overlays**~~ ✅ Done

### Phase 1b: Fix checkpoint concerns
4b. ~~**Forge sticky Cancel/Forge buttons**~~ ✅ Done

4c. ~~**Reduce forge CSS specificity**~~ ✅ Done (shipped in 2394f8cc)

### Phase 2: Balance — make fights fair
5. ~~**Boss adaptive scaling**~~ ✅ Done (already implemented at index.js:967-979)

6. ~~**Forge stat budget cap**~~ ✅ Done

### Phase 3: Teaching — help players learn
7. ~~**Post-Quick-Build onboarding**~~ ✅ Done

8. ~~**First-battle tutorial hints**~~ ✅ Done

9. ~~**Pre-fight boss pattern hint**~~ ✅ Done

10. ~~**Loss screen with rematch + advice**~~ ✅ Done

11. ~~**Move result feedback**~~ ✅ Done (already implemented — MOVE_BEATS map, flashMoveResult() with green/red glow, CSS at line 1690)

### Phase 4: Progression — reasons to keep playing
12. ~~**Card rarity system**~~ ✅ Done

13. ~~**Boss mastery stars**~~ ✅ Done (committed in 44ce3cb3)

14. **Streak rewards** — Win streaks currently show fire icon but give nothing. 3-streak: +10% sparks bonus on next win. 5-streak: free Battle Crate. 10-streak: guaranteed rare crate. 15-streak: title "The Relentless" + permanent +2% crit. Losing resets streak. Show streak bonus in battle results.

15. **Next unlock teasers** — Show contextual "next unlock" hints throughout the UI. Lobby: "2 more wins until Battle Crate." Campaign: "Beat Boss 4 to unlock Neon palette." Forge: "15 more power to unlock Heavy Hitter passive." Small text, muted color, positioned near relevant UI element. Creates micro-goals.

16. **Class signature moves** — Each class gets a unique ability name and icon. Rogue: "Shadow Strike" (dagger icon), Mage: "Arcane Blast" (sparkle), Fighter: "Power Slam" (fist), Scout: "Snipe" (crosshair), etc. Static map from `card.class` to name+icon in blindspot-flow.js. Updates the Ability button label and icon during battle. Purely cosmetic — same server-side mechanics.

### Phase 5: Loot crates — the dopamine loop
17. **Loot crate data model** — Define crate types in `blindspot/data/game-config.json`: Battle Crate (every 5 wins), Boss Crate (first boss kill), Weekly Crate (weekly boss), Ember Crate (50 sparks), Ascension Crate (per ascension). Loot tables with weighted rarity: common 60%, uncommon 25%, rare 12%, epic 3%. Drop pools: stat boosts (+3/+5/+8/+12), sparks (10/25/50/100), forge tokens, respec scrolls, XP boosters, card frames (gold filigree, bone, crystal, circuit, dragon scale), card backs, name plates (flame text, glitch, royal banner), victory animations (confetti, lightning, ravens), battle charms, titles with effects.

18. **Crate inventory + earn triggers** — Store unopened crates in localStorage `bs-crates` array. Track win counter, award Battle Crate every 5 wins. Boss Crate on first kill. Weekly Crate on weekly boss clear. Ascension Crate on ascension. Show crate count badge in lobby below forge progress. Toast "Crate earned!" on award. Ember Crate purchase in a Sparks shop section.

19. **Crate opening ceremony** — Full-screen overlay with interactive sequence: (a) Crate appears center, glowing with rarity particles. (b) Tap to start — crate shakes with increasing intensity (CSS keyframes). (c) Roulette: items scroll through a slot-machine strip, slowing over 2-3s. (d) Burst reveal: crate explodes (scale + opacity), winning item zooms in with glow + particle burst matching rarity (white/green/blue/purple). (e) Item card with "Equip Now" / "Collect" buttons. Web Audio SFX: ratchet clicks during spin, cymbal crash on reveal.

20. **Cosmetic inventory + equip** — "Collection" screen accessible from lobby. Grid of all owned cosmetics (frames, backs, plates, animations) with equipped state. Tap to equip/unequip. Equipped items render on card in lobby, battle, and PvP. Store in localStorage `bs-cosmetics` (owned) and `bs-equipped` (active).

21. **Battle charms** — One-use consumable items from crates. Before battle, optionally equip one charm — shows as a glowing 6th button during combat. Types: Heal Potion (instant 30% HP), Power Surge (+25% damage this round), Shield Wall (block all damage this round), Lucky Strike (guaranteed crit), Charge Boost (full ability charges). Consumed win or lose.

### Phase 6: Deck system — multiple characters
22. **Card collection model** — Players can own multiple cards. `bs-deck` localStorage array stores card objects. Quick Build creates and adds to deck. `_selectedCard` is the active fighter. Forge edits active card only. Server profile tracks `cardIds[]`. Each card has independent stats, class, palette, avatar, name, rarity, and equipped cosmetics.

23. **Card switcher in lobby** — Below card display, left/right arrows to cycle owned cards. Show "2 / 5" count. Switching updates lobby display, stat bars, passives, sets `selectedCardId` on server. Animation: card slides out left, new card slides in right.

24. **New card creation** — "Create New Card" button in lobby (visible when deck < 8 cards). Opens Quick Build for a fresh card. New cards start Common rarity with base stats. Cap at 8 cards per player.

25. **Deck management screen** — New screen from lobby. Grid of all cards with mini previews showing avatar, name, class, power, rarity border. Tap to set active. Swipe or long-press to delete (with "Are you sure?" confirmation). Sort by power/class/newest.

### Phase 7: Combat feel — make every move land
26. **Per-move combat SFX** — Add Web Audio synth sounds for each move type. Currently only have win/loss/loot/boss/forge/ascension sounds — zero audio during actual combat. Strike: short punch thud. Guard: metallic shield clang. Ability: electric zap. Heal: soft chime rise. Counter: ricochet ping. Crit: louder strike + glass shatter. Dodge: quick whoosh. Hook into the battle log entries or submitMove response to trigger. Respect ArenaAudio mute toggle.

27. **Round transition flash** — Between rounds, flash "Round X" centered over the battle field. Cinzel font, accent color, fade in/out over 0.8s. Currently the round counter silently increments.

28. **Boss dialogue** — Each boss says one line when the fight starts and one when they're defeated. Stored in bosses.json as `tauntStart` and `tauntLoss` fields. Show as a speech bubble or italic line in the combat log. E.g., Gatekeeper start: "Everyone passes through here once." Loss: "...not bad." Gives bosses personality. 10 bosses × 2 lines = 20 lines total.

29. **"Almost" loss moment** — When the player loses and the boss had <10% HP remaining, show a special message on the loss screen: "So close! The Trickster survived with 4 HP." The near-miss creates a story and fuels the rematch urge. Check `battleResult.opponentHp` vs `battleResult.opponentMaxHp`.

### Phase 8: Retention — reasons to come back
30. **Daily spark bonus** — First fight each day gives +10 bonus sparks regardless of win/loss. Track via `bs-last-daily` localStorage date (ISO date string, compare to today). Toast: "Daily bonus: +10 Sparks." Award in handlePlayPageResult before normal sparks.

31. **Card level from XP** — Derive a visible level number from total XP. Level = floor(sqrt(xp / 50)) + 1, capping at 50. Show "Lv. 23" on the lobby card and in battle nameplate. Players understand levels instinctively — "500 Power" is abstract, "Level 23" is concrete. Pure display — no gameplay effect beyond what XP already does.

32. **PvP card comparison** — When browsing the PvP gallery, tapping an opponent shows a stat comparison overlay (like the pre-fight boss comparison) before choosing to fight. Currently players pick opponents blind. Show your card vs theirs with advantage/disadvantage indicators.

33. **Forfeit grace period** — Forfeiting within the first 2 rounds gives half the normal loss XP penalty and doesn't break win streak. After round 2, forfeit is a full loss. Encourages players to experiment with builds and bail on clearly bad matchups without punishment. Show "(early forfeit — reduced penalty)" in results.

34. **Lobby cleanup** — Combine power+sparks+streak into one compact HUD line. Collapse passives into a count badge ("7 passives") that expands on tap. Reduce visual noise.

35. **Landing page social proof** — Add live counters to landing page: "X battles fought", "X cards forged." Pull from a simple counter in company-state or estimate from localStorage across sessions. Shows the game is alive to new visitors.

36. **Battle ambient audio** — Subtle ambient loop during battle (low rumble + crowd murmur via Web Audio oscillators, no audio files). Fades in on battle start, out on result. Respects mute toggle.

## Backlog
- Ascension system rebalance (harder bosses per ascension level)
- PvP matchmaking by power range
- Card trading/sharing between players
- Seasonal content (new bosses, limited palettes)
- Achievement badges on card display
- Spectator mode for PvP
- Ability variants (alternate class powers from crates)
- Tournament mode (bracket-style PvP events)
