# Loop Checkpoint — Iteration 111 (2026-03-21)

## Built (since checkpoint 76)

### Phase 5: Loot Crates (complete)
1. **Crate inventory + earn triggers** — bs-crates localStorage, earn on wins/boss/weekly/ascension, sparks shop
2. **Crate opening ceremony** — full-screen overlay, shake animation, slot-machine reel, burst reveal, SFX
3. **Cosmetic inventory + equip** — Collection screen with 5 tabs, equip/unequip, glow/tint/text effects
4. **Battle charms** — pre-fight selector, glowing 6th button, 5 client-side effects (heal/damage/block/crit/charge)

### Phase 6: Deck System (started)
5. **Card collection model** — bs-deck localStorage array, getDeck/setDeck/addCard/updateCard/removeCard

### Phase 7: Combat Feel (started)
6. **Per-move combat SFX** — Web Audio synth for strike/guard/ability/heal/counter/crit/dodge
7. **Round transition flash** — "Round X" centered overlay between rounds
8. **Boss dialogue** — tauntStart/tauntLoss speech bubbles in combat log
9. **Near-miss moments** — "So close!" message when boss survives with <10% HP

## Concerns

1. **Charm heal only updates DOM** — Heal Potion modifies HP bar text/fill directly but arena-battle-ui.js tracks its own _battleData.player.hp. Next server round overwrites the visual heal. Cosmetic only until server integration.
   - **Resolution**: Accept for now — charm effects are explicitly labeled "client-side" with server integration deferred. The toast + combat log entry give players feedback. True gameplay effects require Task 20b (server-side charm support).

2. **Charm buff chips are cosmetic only** — Power Surge/Shield Wall/Lucky Strike/Charge Boost show buff chips but don't affect combat calculations.
   - **Resolution**: Same as #1 — accept. Visual feedback is the MVP; gameplay effects need server work.

3. **Inline style opacity on charm button** — btn.style.opacity = '0.3' used alongside CSS :disabled rule.
   - **Resolution**: Fix now — quick change.

4. **Raw rgba in charm CSS** — bs-charm-option--selected box-shadow and bs-charm-pulse keyframes use raw rgba(239, 159, 39, ...).
   - **Resolution**: Fix now — replace with color-mix tokens.

## Next
1. **23: Card switcher in lobby** — left/right arrows to cycle owned cards
2. **24: New card creation** — "Create New Card" button opens Quick Build
3. **25: Deck management screen** — grid of all cards with delete/sort
