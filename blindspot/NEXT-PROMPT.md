Load the Blindspot skill. We're continuing the monolith split of blindspot-flow.js.

22 modules already extracted (Rounds 1-7), monolith went from 7591 → 2780 lines (-63.4%). See SPLIT-PLAN.md for full history, pattern, and Round 8 plan.

Round 8 extraction order:

1. bs-tutorial.js (~77 lines, lines 2231-2305) — showStrangerTutorial(), onTutorialMoveClick(), highlightTutorialMove(), advanceTutorial(), removeTutorial(). State: `_tutorialStep`, `_tutorialEl`. Uses `TUTORIAL_HINTS` from BsConst. index.html only. Easy.

2. bs-reward-drops.js (~90 lines, lines 2316-2403) — rollLoot(), applyLootDrop(), showRewardDrop(). `applyLootDrop` writes `_selectedCard.combatStats` + calls save API — needs callback for `_selectedCard` access and auth headers. `rollLoot` uses `LOOT_TABLE` from BsConst. Easy-Medium.

3. bs-leaderboard.js (~62 lines, lines 2636-2697) — renderLeaderboard(). Reads `_selectedCard` for "(you)" highlight. Self-contained async screen render. Easy.

4. bs-combat-tooltips.js (~58 lines, lines 2704-2761) — showBattleHint(), updateCombatTooltips(). Reads `_selectedCard`, `_activeBattle`. Uses `BATTLE_HINTS`, `CLASS_SIGNATURE_MOVES`, `MOVE_UPGRADES` from BsConst. Easy.

5. bs-auth-ui.js (~27 lines, lines 2540-2564) — updatePlayAuthUI(). Pure DOM + fetch. Could fold into bs-landing.js (already owns landing auth UI) — your call on whether to merge or create separate module.

Pattern: Each module is a self-contained IIFE on window.BsModuleName. Monolith keeps thin 1-2 line delegates. Cross-cutting deps use setCallbacks() injection. Functions that modify _selectedCard or call save API stay in monolith. showScreen/showOverlay/hideOverlay stay in monolith (36+ call sites).

Extract all five modules, parse check + run `node blindspot/tests/run-all.js` after each. Then browser test the live site to verify. Commit + push after each module. Update SPLIT-PLAN.md at the end.
