# Blindspot — Road to 9/10

Current: **5/10 shipped game, 7/10 foundation.**
Target: **9/10 shipped game.**

## The 5 gaps between 5/10 and 9/10

| Gap | Problem | Impact |
|-----|---------|--------|
| **Combat feels like coin flips** | 5 moves, RPS resolution, stat thresholds invisible to player | Players don't feel skillful, fights blur together |
| **Cards are stat bundles** | No lore, no history, no earned identity | Nothing to care about — "one retry away from another random card" |
| **No social pull** | Can't share, challenge friends, or see what happened while away | No reason to come back, no word-of-mouth |
| **Guest flow is fragile** | 3 bugs found in one session, localStorage handoff between pages | New players bounce on broken first impression |
| **Mobile untested** | Desktop layout solid, responsive paths never battle-tested | Majority of casual game traffic is mobile |

---

## Phase 1: Combat Depth (make fights feel skillful)

**Goal:** Player should think "I won because I played well" not "I got lucky."

### 1A. Visible move feedback
- Show WHY a move won/lost: "Your Heavy Strike pierced their Guard (STR 72 > 60 threshold)"
- Show stat-threshold passives activating: flash "Quick Draw!" when AGI 60+ fires
- Show weakness exploit: "Exploited Fire weakness! +20% damage"
- Boss telegraph: boss hints at next move type ("The Gatekeeper raises his shield...")

### 1B. Move combos + memory
- **Combo system**: Strike→Strike→Strike = "Flurry" (bonus damage). Guard→Counter = "Riposte" (guaranteed crit). Heal→Ability = "Empowered" (+50% ability)
- Show combo name + bonus on screen when triggered
- Combos reward paying attention to sequence, not just spamming one move

### 1C. Stamina / resource tension
- Each move costs stamina (Strike=1, Ability=3, Heal=2, Guard=0, Counter=2)
- Stamina regenerates 2/round
- Start with 6 stamina → forces planning: "Can I afford Ability this round or do I need to Guard and regen?"
- Creates real decisions every round instead of "pick the RPS winner"

### 1D. Boss-specific mechanics
- Each boss has a unique mechanic beyond stat weakness:
  - Boss 1 (Gatekeeper): telegraphs every move (tutorial boss)
  - Boss 3 (Haunted Ward): goes invisible every 3 rounds (can't Counter)
  - Boss 5 (Mountain Pass): wind mechanic — random move disabled each round
  - Boss 7 (Iron Bastion): reflects 30% damage when Guarding
  - Boss 10 (Forge Eternal): copies your last move
- Creates memorable fights, not just "harder stats"

---

## Phase 2: Card Identity (make cards matter)

**Goal:** Player should name their card, remember their card, show off their card.

### 2A. Card history / battle log
- Every card tracks: battles fought, bosses beaten, win streak record, nemesis (boss they lost to most)
- Display on card back or detail view: "47 battles, 31 wins, conquered all 10 bosses, nemesis: The Warden"
- History makes the card feel like it has a life

### 2B. Earned titles + visual evolution
- Titles from milestones: "Gatekeeper Slayer", "Undefeated in 10", "Ascended One"
- Card border evolves: plain → bronze trim → silver → gold → animated glow (based on total wins)
- Card physically changes as you play — not just stat numbers going up

### 2C. Card personality (Forge v2)
- Forge "Details" tab expanded: write a battle cry, pick a fighting stance, choose a personality trait
- Personality affects boss dialogue: aggressive card gets taunted differently than cautious one
- AI-generated flavor text based on card history: "A scarred veteran of the Haunted Ward, this Fighter has never backed down"

### 2D. Constrained creation > blank slate
- New card starts with class base stats (already have this)
- Player distributes 30 bonus points (not full respec) — forces specialization
- Abilities unlocked through play, not chosen at creation
- Each ability unlock feels earned: "Beat Boss 5 with <50% HP to unlock Whirlwind Strike"

---

## Phase 3: Social Pull (give players a reason to come back)

**Goal:** "Your card was attacked while you were away" is the hook that creates daily opens.

### 3A. Async PvP (defense queue)
- Card enters defense queue when player goes inactive
- Other players challenge it (attacker plays, defender is AI)
- Results inbox: "Your card went 2-1 while you were away, earned 45 Sparks"
- Revenge mechanic: beat someone who beat your card

### 3B. Card sharing
- "Share Card" button generates a card image (canvas → PNG)
- Share to clipboard, download, or direct link
- Link opens a card detail page: `/blindspot/card/{id}` — stats, history, visual
- "Challenge this card" button on shared cards

### 3C. Weekly tournament
- Auto-enter top card into weekly bracket
- 8-player single elimination, resolved async over the week
- Winner gets unique cosmetic + "Weekly Champion" title
- Leaderboard shows bracket and results

### 3D. Friend challenges
- Challenge by sharing a link: `/blindspot/challenge/{myCardId}`
- Recipient fights your card (AI-controlled)
- Both players see results
- No account required to accept a challenge (guest-friendly)

---

## Phase 4: Reliability + Mobile (don't lose players to bugs)

**Goal:** Zero bugs in the first 5 minutes. Works perfectly on phone.

### 4A. Automated player flow tests
- Playwright tests for every critical path:
  - Guest: land → fight → QB → card reveal → lobby → campaign → fight boss
  - Auth: login → lobby → card loads → forge → fight → results
  - Mobile: same flows at 375px width
- Run on every push (CI/CD)

### 4B. Guest flow hardening
- Eliminate localStorage handoff fragility — single-page app or robust state passing
- Server-side guest session (cookie-based, no auth required)
- Guest → auth migration: seamless card + progress transfer on sign-in

### 4C. Mobile polish
- Touch targets: minimum 44px tap targets on all buttons
- Battle screen: swipe gestures for moves (swipe right = Strike, up = Guard, etc.)
- Card reveal: pinch-to-zoom on card
- Bottom sheet navigation (already have this pattern)
- Test on real devices: iPhone SE, Pixel 5, iPad

### 4D. Loading + error states
- Skeleton loaders instead of spinners
- Offline detection: "You're offline — playing with cached data"
- API failure recovery: retry with backoff, never show blank screen
- "Something went wrong" screen with retry button, not white page

---

## Phase 5: Polish + Juice (the difference between 8/10 and 9/10)

**Goal:** Every interaction feels satisfying. Players say "this feels good."

### 5A. Screen shake + particles
- Critical hit: screen shake + red flash
- Boss defeat: explosion particles + screen shake + slow-mo
- Level up: golden particles rise from card
- Crate open: already good (roulette), add haptic feedback on mobile

### 5B. Sound design pass
- Unique SFX per move type (not just generic hit)
- Boss-specific ambient music (already have adventure tracks, extend to fights)
- Victory fanfare scales with streak (bigger streak = bigger celebration)
- Mute state persists correctly across pages

### 5C. Onboarding refinement
- First boss should be beatable by any card (difficulty 1/10)
- First forge visit should be guided: "Try changing your card's palette"
- Tooltip on first crate: explain what's inside before opening
- "What's new" toast on return visits after updates

### 5D. Content depth
- 5 more bosses (15 total) with unique mechanics
- 10 more adventures with branching outcomes
- Seasonal events: holiday bosses, limited cosmetics, themed crates
- Achievement gallery: visual grid of all titles, frames, palettes earned

---

## Execution Order

| Priority | Phase | Why first | Notes |
|----------|-------|-----------|-------|
| **1** | 4A: Player flow tests | Safety net before changing anything | Guest + auth + mobile (375px) Playwright flows |
| **2** | 1A-1B: Combat feedback + combos | Core loop must feel good first | Ship these two, then assess if stamina (1C) is needed |
| **3** | 2A-2B: Card history + visual evolution | Almost free to build, high retention | Run parallel to Phase 1 — data tracking + display, not combat logic |
| **4** | 3B: Card sharing (canvas → PNG) | Client-side, zero infra, instant social | Ship before async PvP — word-of-mouth with no backend lift |
| **5** | 3A: Async PvP | Retention hook — reason to come back | Needs server-side foundation (defense queue, matching, results inbox) |
| **6** | 4C: Mobile polish | Unlock the biggest audience | After core loop + sharing are solid |
| **7** | 1C-1D: Stamina + boss mechanics | Only if 1A+1B don't fix "coin flip" feel | Stamina is highest design risk — could add friction not tension |
| **8** | 3C-3D: Tournaments + friends | Social growth after core is solid | Tournaments need async PvP infra first |
| **9** | 2C-2D: Card personality + constrained creation | Identity depth after loop proven | |
| **10** | 5A-5D: Polish + juice | Final layer after everything works | |
| **∞** | 4B: Guest hardening | Ongoing, weave into each phase | |

### Key decisions deferred until data arrives
- **Stamina (1C):** Ship 1A+1B first. If players still say "coin flip", add stamina. If feedback layer alone fixes it, skip stamina and save the complexity.
- **Async PvP scope (3A):** Card sharing (3B) ships first as the low-cost social test. If sharing generates engagement, invest in the full async PvP backend.

---

## Success Criteria (9/10)

A player who finds Blindspot should:
- [ ] Win their first fight and immediately want the next one
- [ ] Name their card something personal, not just "Fighter"
- [ ] Feel smart when they win, not just lucky
- [ ] Open the game the next day because they got a notification
- [ ] Show their card to a friend
- [ ] Say "this is surprisingly good for a browser game"
