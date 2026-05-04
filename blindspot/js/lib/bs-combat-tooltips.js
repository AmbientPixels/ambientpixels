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

  // Per-class signature ability gets its own CSS-driven art variant.
  // Maps card class → variant slug → CSS modifier + child markup.
  var CLASS_ABILITY_VARIANT = {
    'Fighter':   'powerstrike',  'Enforcer': 'powerstrike',  'Berserker': 'powerstrike',
    'Caster':    'arcaneblast',  'Scholar':  'arcaneblast',  'Hacker':    'arcaneblast',
    'Scout':     'shadowstrike', 'Rogue':    'shadowstrike', 'Pilot':     'shadowstrike',
    'Guardian':  'fortify',      'Medic':    'fortify',
    'Trickster': 'wildcard',     'Wildcard': 'wildcard'
  };
  var ABILITY_VARIANT_MARKUP = {
    powerstrike:  '<span class="bs-fx-ability__pulse"></span>'.repeat(4),
    arcaneblast:  '<span class="bs-fx-ability__bolt"></span>'.repeat(4),
    shadowstrike: '<span class="bs-fx-ability__dash"></span>'.repeat(5),
    fortify:      '<span class="bs-fx-ability__hex"></span>'.repeat(4),
    // Wild Card: glowing color-shifting core + 5 orbital moons at
    // varied radii / directions / speeds. Higher visual energy than
    // the other variants — this is the Ultimate.
    wildcard:     '<span class="bs-fx-ability__core"></span>' +
                  '<span class="bs-fx-ability__orbit"><span class="bs-fx-ability__moon"></span></span>'.repeat(5)
  };
  var GENERIC_ABILITY_MARKUP = '<span class="bs-fx-ability__twinkle"></span>'.repeat(7);

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
      // Swap ability button art slot to the class-family CSS variant
      // (powerstrike/arcaneblast/shadowstrike/fortify/wildcard). Unknown
      // classes fall back to the generic purple-twinkle ability.
      var artEl = document.querySelector('.arena-move-btn--ability .bs-move-card__art');
      if (artEl) {
        var variant = CLASS_ABILITY_VARIANT[cardClass];
        var nextClass = 'bs-move-card__art' + (variant
          ? ' bs-move-card__art--ability-' + variant
          : ' bs-move-card__art--ability');
        var nextHTML = variant ? ABILITY_VARIANT_MARKUP[variant] : GENERIC_ABILITY_MARKUP;
        if (artEl.className !== nextClass) artEl.className = nextClass;
        if (artEl.innerHTML !== nextHTML) artEl.innerHTML = nextHTML;
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
