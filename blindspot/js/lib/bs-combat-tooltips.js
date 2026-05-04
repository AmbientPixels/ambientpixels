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
  // Hybrid bespoke hover FX appended to each ability variant. The
  // legacy bs-fx-ability__* spans are kept for backwards compat (CSS
  // hides them in hybrid mode) but the bs-hybrid-fx--* spans are
  // what actually render now.
  var HYBRID_FX_BY_VARIANT = {
    powerstrike:  '<span class="bs-hybrid-fx--ring" style="--fx-delay:0s;--fx-color:rgba(255,130,80,0.85);--fx-glow:rgba(220,40,20,0.7)"></span>' +
                  '<span class="bs-hybrid-fx--ring" style="--fx-delay:0.5s;--fx-color:rgba(255,130,80,0.85);--fx-glow:rgba(220,40,20,0.7)"></span>',
    arcaneblast:  '<span class="bs-hybrid-fx--beam" style="--fx-delay:0s"></span>',
    shadowstrike: '<span class="bs-hybrid-fx--glint" style="--fx-delay:0s"></span>',
    fortify:      '<span class="bs-hybrid-fx--halo" style="--fx-delay:0s"></span>',
    wildcard:     '<span class="bs-hybrid-fx--token" style="--fx-delay:0s;--fx-angle:0deg"></span>' +
                  '<span class="bs-hybrid-fx--token" style="--fx-delay:0s;--fx-angle:90deg"></span>' +
                  '<span class="bs-hybrid-fx--token" style="--fx-delay:0s;--fx-angle:180deg"></span>' +
                  '<span class="bs-hybrid-fx--token" style="--fx-delay:0s;--fx-angle:270deg"></span>'
  };
  var GENERIC_HYBRID_FX = '<span class="bs-hybrid-fx--mote" style="--fx-delay:0s;--fx-angle:0deg"></span>' +
                          '<span class="bs-hybrid-fx--mote" style="--fx-delay:0.1s;--fx-angle:72deg"></span>' +
                          '<span class="bs-hybrid-fx--mote" style="--fx-delay:0.2s;--fx-angle:144deg"></span>' +
                          '<span class="bs-hybrid-fx--mote" style="--fx-delay:0.3s;--fx-angle:216deg"></span>' +
                          '<span class="bs-hybrid-fx--mote" style="--fx-delay:0.4s;--fx-angle:288deg"></span>';

  var ABILITY_VARIANT_MARKUP = {
    // Power Strike: pulsing red core + thick shockwave ring + 5 short
    // impact spikes punching out radially. Heavy slam vocabulary.
    powerstrike:  '<span class="bs-fx-ability__core"></span>' +
                  '<span class="bs-fx-ability__shockwave"></span>' +
                  '<span class="bs-fx-ability__impact"></span>'.repeat(5) +
                  HYBRID_FX_BY_VARIANT.powerstrike,
    // Arcane Blast: pulsing violet core + 6 lightning bolts radiating
    // outward in sequence (60° apart). One core + six bolts.
    arcaneblast:  '<span class="bs-fx-ability__core"></span>' +
                  '<span class="bs-fx-ability__bolt"></span>'.repeat(6) +
                  HYBRID_FX_BY_VARIANT.arcaneblast,
    shadowstrike: '<span class="bs-fx-ability__dash"></span>'.repeat(5) +
                  HYBRID_FX_BY_VARIANT.shadowstrike,
    // Fortify: pulsing gold core + 3 expanding rings — radial shield
    // wave pattern.
    fortify:      '<span class="bs-fx-ability__core"></span>' +
                  '<span class="bs-fx-ability__ring"></span>'.repeat(3) +
                  HYBRID_FX_BY_VARIANT.fortify,
    // Wild Card: glowing color-shifting core + 5 orbital moons at
    // varied radii / directions / speeds. Higher visual energy than
    // the other variants — this is the Ultimate.
    wildcard:     '<span class="bs-fx-ability__core"></span>' +
                  '<span class="bs-fx-ability__orbit"><span class="bs-fx-ability__moon"></span></span>'.repeat(5) +
                  HYBRID_FX_BY_VARIANT.wildcard
  };
  // Default ability art (no class chosen yet) — center core + 5
  // scattered twinkles. Same core+something pattern as the variants
  // so the no-class state reads as "an ability slot waiting for
  // identity" rather than scattered placeholder dots.
  var GENERIC_ABILITY_MARKUP = '<span class="bs-fx-ability__core"></span>' +
                               '<span class="bs-fx-ability__twinkle"></span>'.repeat(5) +
                               GENERIC_HYBRID_FX;

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
    // Move upgrades — rename buttons based on stat thresholds.
    // Ability is intentionally excluded: its label is owned by
    // CLASS_SIGNATURE_MOVES (Power Slam / Arcane Blast / Shadow
    // Strike / Fortify / Wild Card), which is the player-facing
    // identity of that class's signature move. The "Focused" passive
    // at INT 12+ still applies mechanically (cheaper charge cost) —
    // we just don't overwrite the class-specific label with the
    // generic "Focused Ability" string.
    if (card && card.combatStats) {
      var cs = card.combatStats;
      Object.entries(MOVE_UPGRADES).forEach(function (entry) {
        var move = entry[0], upg = entry[1];
        if (move === 'ability') return;
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
