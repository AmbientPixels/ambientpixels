/* ============================================================
   bs-combat-tooltips.js — Battle hints + move button upgrades
   IIFE → window.BsCombatTooltips
   ============================================================ */
(function () {
  'use strict';

  var _C = window.BsConst || {};
  var _Str = window.BsStrategy || {};

  var BATTLE_HINTS = _Str.BATTLE_HINTS || {};
  var CLASS_SIGNATURE_MOVES = _C.CLASS_SIGNATURE_MOVES || {};
  var MOVE_UPGRADES = _Str.MOVE_UPGRADES || {};

  var _cb = {};

  function setCallbacks(obj) { _cb = obj || {}; }

  function showBattleHint(key) {
    var el = document.getElementById('bs-battle-hint');
    if (!el) return;
    var text = BATTLE_HINTS[key];
    if (!text) { el.style.visibility = 'hidden'; return; }
    el.innerHTML = '<i class="fas fa-lightbulb" style="color:var(--bs-accent);"></i> ' + text;
    el.style.visibility = 'visible';
  }

  function updateCombatTooltips() {
    var card = _cb.getSelectedCard ? _cb.getSelectedCard() : null;

    // Class signature move — rename Ability button to class-specific name + icon
    if (card) {
      var cardClass = card.class || card.characterClass || '';
      var sig = CLASS_SIGNATURE_MOVES[cardClass];
      if (sig) {
        var abilLabel = document.getElementById('arena-ability-label');
        var abilIcon = document.getElementById('arena-ability-icon');
        if (abilLabel) abilLabel.textContent = sig.name;
        if (abilIcon) abilIcon.className = 'fas ' + sig.icon;
      }
    }
    // Move upgrades — rename buttons based on stat thresholds
    if (card && card.combatStats) {
      var cs = card.combatStats;
      Object.entries(MOVE_UPGRADES).forEach(function (entry) {
        var move = entry[0], upg = entry[1];
        if ((cs[upg.stat] || 0) >= upg.threshold) {
          var btn = document.querySelector('[data-move="' + move + '"] .arena-move-btn__label');
          var descEl = document.querySelector('[data-move="' + move + '"] .arena-move-btn__desc');
          if (btn) btn.textContent = upg.name;
          if (descEl) descEl.textContent = upg.desc;
        }
      });
    }

    var battle = _cb.getActiveBattle ? _cb.getActiveBattle() : null;
    if (!battle || !battle.player) return;
    var stats = battle.player.combatStats;
    if (!stats) return;

    // Strike: STR * 2.0 to STR * 2.5
    var strMin = Math.floor(stats.str * 2.0);
    var strMax = Math.floor(stats.str * 2.5);
    var strEl = document.getElementById('arena-move-str');
    if (strEl) strEl.textContent = '~' + strMin + '-' + strMax + ' dmg';

    // Heal: END * 1.5 to END * 2.0
    var endMin = Math.floor(stats.end * 1.5);
    var endMax = Math.floor(stats.end * 2.0);
    var endEl = document.getElementById('arena-move-end');
    if (endEl) endEl.textContent = '~' + endMin + '-' + endMax + ' HP';

    // Ability: show INT
    var intEl = document.getElementById('arena-move-int');
    if (intEl) intEl.textContent = 'INT ' + stats.int;
  }

  window.BsCombatTooltips = {
    setCallbacks: setCallbacks,
    showHint: showBattleHint,
    update: updateCombatTooltips
  };
})();
