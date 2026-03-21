# Loop Checkpoint — 2026-03-21 (iterations 70-76)

## Built
1. **Card rarity system** — Common→Legendary tied to forge visits, border glow per tier
2. **Move result feedback** — green/red glow on move buttons (already implemented)
3. **Loss screen with rematch + advice** — data-driven tips + prominent Rematch button
4. **Pre-fight boss pattern hint** — CLASS_PATTERNS map showing boss tendencies
5. **Post-Quick-Build onboarding** — 3-step spotlight guide for new players
6. **First-battle tutorial hints** — contextual tips for first 3 campaign battles
7. **Boss adaptive scaling** — server-side power scaling (already implemented)
8. **Forge stat budget cap** — total power capped at 400
9. **Boss mastery stars** — bronze/silver/gold tiers at 3/5/10 wins
10. **Streak rewards** — sparks bonus + milestone rewards at 5/10/15
11. **Next unlock teasers** — contextual micro-goal hints in lobby/campaign/forge
12. **Class signature moves** — 10 unique ability names per class with icons
13. **Loot crate data model** — 5 crate types, 3 loot tables, 10 drop pools

## Concerns
1. **Uncommitted JS has wrong config path**: `blindspot-flow.js` has ~60 lines referencing `_config.crates.crateTypes` but game-config.json uses `_config.crates.types`. Fix in task 18.
2. **Uncommitted HTML**: `play.html` has crate indicator div not wired to working code. Fix in task 18.
3. **Raw hex in RARITY_TIERS** (JS lines 477-480): `#1eff8e`, `#3a9fff`, `#a855f7`, `#fbbf24`. Low risk — JS-only, not CSS. Accept or add `--bs-rarity-*` tokens later.
4. **149 raw hex colors in smoke test**: Long-standing, mostly JS canvas/dynamic styling. Acceptable.
5. **CSS classes referenced in game-config.json don't exist yet**: `bs-frame--*`, `bs-back--*`, `bs-plate--*`, `bs-victory--*`. Will be created in task 20 (cosmetic rendering).

## Concern Resolution
- Concerns 1-2: Will be fixed in task 18 (next task) — correct the config path and properly wire the HTML.
- Concerns 3-4: Accepted — JS-only color values, not CSS cascade issues.
- Concern 5: Deferred to task 20 — cosmetic CSS will be created when cosmetics are rendered.

## Next
1. **18: Crate inventory + earn triggers** — fix config path bug, wire HTML, toast on earn
2. **19: Crate opening ceremony** — full-screen slot-machine reveal overlay
3. **20: Cosmetic inventory + equip** — collection screen, equip system, CSS for cosmetics
4. **21: Battle charms** — consumable items from crates, 6th combat button
