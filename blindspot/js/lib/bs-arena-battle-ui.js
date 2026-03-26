/**
 * Arena Battle UI — battle screen rendering, animations, move handling
 * Phase A combat overhaul: sequential turns, kill shot, crit banner, sound escalation, streak counter
 */
window.ArenaBattleUI = (function () {
  'use strict';

  let _battleData = null;
  let _currentRound = 1;
  let _isAnimating = false;
  let _playerCharges = 0;
  let _abilityCost = 2;
  let _maxCharges = 4;
  let _chargeRate = 1;
  let _abilityInfo = null;
  // A5: combo streak — consecutive rounds the player dealt damage
  let _playerStreak = 0;
  // B4: hype meter
  let _hype = 0;
  let _crowdBoostPending = false;
  // Phase 1: move history for combo preview + matchup feedback
  let _moveHistory = [];
  // Stance system
  let _playerStance = 'balanced';

  function initBattle(battleData) {
    _battleData = battleData;
    _currentRound = 1;
    _isAnimating = false;
    _playerStreak = 0;
    _moveHistory = [];

    // Close results overlay if still open
    var overlay = document.getElementById('arena-results-overlay');
    if (overlay) overlay.style.display = 'none';

    // Reset battle header buttons
    var forfeitBtn = document.getElementById('arena-forfeit-btn');
    var postActions = document.getElementById('arena-battle-post');
    if (forfeitBtn) forfeitBtn.style.display = '';
    if (postActions) postActions.style.display = 'none';

    // Reset hype and boost state
    _hype = 0;
    _crowdBoostPending = false;
    var hypeBar = document.getElementById('arena-hype-bar');
    var hypeFill = document.getElementById('arena-hype-fill');
    if (hypeBar) hypeBar.classList.remove('arena-hype-bar--near-full');
    if (hypeFill) hypeFill.style.width = '0%';

    // Reset status chips
    ['arena-player-status', 'arena-opponent-status'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    // Reset combatant visual states from previous battle
    ['arena-player-side', 'arena-opponent-side'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.classList.remove('arena-combatant--defeated', 'arena-combatant--last-stand');
      }
    });
    var field = document.querySelector('.arena-battle__field');
    if (field) field.classList.remove('arena--killshot');

    renderCombatants(battleData);
    updateHpBars(battleData.player.hp, battleData.player.maxHp, battleData.opponent.hp, battleData.opponent.maxHp);
    updateRoundLabel(_currentRound);
    clearLog();
    addLogEntry('Battle started! Choose your move.');
    addLogEntry('💥 Fill the Hype Meter with crits, streaks & big moments for a crowd damage boost!', 'hint');
    enableMoves(true);

    // Charge system state
    _playerCharges = (battleData.charges && battleData.charges.player) || 0;
    _abilityCost = battleData.abilityCost || 2;
    _maxCharges = battleData.maxCharges || 4;
    _chargeRate = battleData.chargeRate || 1;
    _abilityInfo = battleData.player.abilityDef || null;

    // Update move stat labels
    const strEl = document.getElementById('arena-move-str');
    const intEl = document.getElementById('arena-move-int');
    const endEl = document.getElementById('arena-move-end');
    if (strEl) strEl.textContent = `STR ${battleData.player.combatStats.str}`;
    if (endEl) endEl.textContent = `END ${battleData.player.combatStats.end}`;

    // Dynamic ability button
    updateAbilityButton(battleData.player.combatStats);
    updateChargeDisplay();

    // Render active buff passives under player card
    renderActiveBuffs(battleData.player.passives);

    // Stamina system init
    _battleData.stamina = battleData.stamina || null;
    _battleData.maxStamina = battleData.maxStamina || null;
    if (_battleData.stamina && _battleData.maxStamina) {
      updateStaminaBars(_battleData.stamina.player, _battleData.maxStamina.player, _battleData.stamina.opponent, _battleData.maxStamina.opponent);
      updateMoveCosts(_battleData.stamina.player);
    }

    // Cooldown system init
    _battleData.cooldowns = battleData.cooldowns || { player: {}, opponent: {} };
    updateCooldownOverlays(_battleData.cooldowns.player);

    // Stance system init
    _playerStance = (battleData.stances && battleData.stances.player) || 'balanced';
    _battleData.stances = battleData.stances || { player: 'balanced', opponent: 'balanced' };
    initStanceButtons();
    updateBossStance(_battleData.stances.opponent);
  }

  function renderActiveBuffs(passives) {
    var container = document.getElementById('arena-player-buffs');
    if (!container) return;
    if (!passives || passives.length === 0) {
      container.innerHTML = '';
      return;
    }
    var iconMap = {
      crit_chance: 'fa-bullseye', damage_reduction: 'fa-shield-alt', ability_power: 'fa-bolt',
      str_bonus: 'fa-hand-fist', int_bonus: 'fa-brain', end_bonus: 'fa-heart',
      hp_regen: 'fa-heart-pulse', xp_bonus: 'fa-star', all_stats: 'fa-chart-line'
    };
    var labelMap = {
      crit_chance: 'Crit', damage_reduction: 'Armor', ability_power: 'AP',
      str_bonus: 'STR', int_bonus: 'INT', end_bonus: 'END',
      hp_regen: 'Regen', xp_bonus: 'XP', all_stats: 'All'
    };
    container.innerHTML = passives.map(function (p) {
      var icon = iconMap[p.effect] || 'fa-circle';
      var label = labelMap[p.effect] || p.effect;
      return '<span class="arena-buff-chip" title="' + label + ' +' + p.value + '">' +
        '<i class="fas ' + icon + '"></i> +' + p.value +
        '</span>';
    }).join('');
  }

  function renderCombatants(data) {
    const playerCard = document.getElementById('arena-player-card');
    const opponentCard = document.getElementById('arena-opponent-card');
    const playerName = document.getElementById('arena-player-name');
    const opponentName = document.getElementById('arena-opponent-name');

    if (playerCard) {
      playerCard.innerHTML = data.player.avatar
        ? `<img src="${data.player.avatar}" alt="${data.player.name}" class="arena-combatant__img">`
        : `<div class="arena-combatant__placeholder"><i class="fas fa-user-shield"></i></div>`;
    }
    if (opponentCard) {
      opponentCard.innerHTML = data.opponent.avatar
        ? `<img src="${data.opponent.avatar}" alt="${data.opponent.name}" class="arena-combatant__img">`
        : `<div class="arena-combatant__placeholder"><i class="fas fa-skull"></i></div>`;
    }
    if (playerName) playerName.textContent = data.player.name || 'You';
    if (opponentName) opponentName.textContent = data.opponent.name || 'Enemy';

    // Element badges on nameplates
    var _Const = window.BsConst || {};
    var _ED = _Const.ELEMENT_DEFS || {};
    var _CDE = _Const.CLASS_DEFAULT_ELEMENT || {};
    var elements = data.elements || {};
    var pEl = elements.player || (data.player.element) || (_CDE[data.player.class] || '');
    var oEl = elements.opponent || (data.opponent.element) || (_CDE[data.opponent.class] || '');
    var pElBadge = document.getElementById('arena-player-element');
    var oElBadge = document.getElementById('arena-opponent-element');
    if (pElBadge && pEl && _ED[pEl]) {
      pElBadge.innerHTML = '<i class="fas ' + _ED[pEl].icon + '" style="color:' + _ED[pEl].color + ';"></i>';
      pElBadge.title = _ED[pEl].label + ' element';
    }
    if (oElBadge && oEl && _ED[oEl]) {
      oElBadge.innerHTML = '<i class="fas ' + _ED[oEl].icon + '" style="color:' + _ED[oEl].color + ';"></i>';
      oElBadge.title = _ED[oEl].label + ' element';
    }
  }

  function updateHpBars(playerHp, playerMax, opponentHp, opponentMax) {
    const playerFill = document.getElementById('arena-player-hp-fill');
    const opponentFill = document.getElementById('arena-opponent-hp-fill');
    const playerText = document.getElementById('arena-player-hp-text');
    const opponentText = document.getElementById('arena-opponent-hp-text');

    const playerPct = Math.max(0, Math.min(100, (playerHp / playerMax) * 100));
    const opponentPct = Math.max(0, Math.min(100, (opponentHp / opponentMax) * 100));

    if (playerFill) playerFill.style.width = playerPct + '%';
    if (opponentFill) opponentFill.style.width = opponentPct + '%';
    if (playerText) playerText.textContent = `${Math.max(0, playerHp)} / ${playerMax}`;
    if (opponentText) opponentText.textContent = `${Math.max(0, opponentHp)} / ${opponentMax}`;

    // Color shifts at low HP
    if (playerFill) playerFill.classList.toggle('arena-hp-bar__fill--low', playerPct < 30);
    if (opponentFill) opponentFill.classList.toggle('arena-hp-bar__fill--low', opponentPct < 30);
  }

  function updateStaminaBars(pStam, pMax, oStam, oMax) {
    var pFill = document.getElementById('arena-player-stamina-fill');
    var oFill = document.getElementById('arena-opponent-stamina-fill');
    var pText = document.getElementById('arena-player-stamina-text');
    var oText = document.getElementById('arena-opponent-stamina-text');
    var pBar = document.getElementById('arena-player-stamina-bar');
    var oBar = document.getElementById('arena-opponent-stamina-bar');
    var threshold = (window.BsConst && BsConst.STAMINA_EXHAUSTION_THRESHOLD) || 3;

    var pPct = pMax > 0 ? Math.max(0, Math.min(100, (pStam / pMax) * 100)) : 0;
    var oPct = oMax > 0 ? Math.max(0, Math.min(100, (oStam / oMax) * 100)) : 0;

    if (pFill) pFill.style.width = pPct + '%';
    if (oFill) oFill.style.width = oPct + '%';
    if (pText) pText.textContent = pStam + ' / ' + pMax;
    if (oText) oText.textContent = oStam + ' / ' + oMax;
    if (pBar) pBar.classList.toggle('arena-stamina-bar--exhausted', pStam < threshold);
    if (oBar) oBar.classList.toggle('arena-stamina-bar--exhausted', oStam < threshold);
  }

  function updateMoveCosts(playerStamina) {
    var costs = (window.BsConst && BsConst.STAMINA_COSTS) || { strike: 3, guard: 1, heal: 2, counter: 3, ability: 4 };
    var threshold = (window.BsConst && BsConst.STAMINA_EXHAUSTION_THRESHOLD) || 3;
    document.querySelectorAll('.arena-move-btn[data-move]').forEach(function(btn) {
      var move = btn.getAttribute('data-move');
      var cost = costs[move] || 2;
      var costEl = btn.querySelector('.arena-move-btn__cost');
      if (costEl) costEl.textContent = '\u26A1' + cost;
      // Hard-block Ability if can't afford
      if (move === 'ability') {
        btn.classList.toggle('arena-move-btn--no-stamina', playerStamina < cost);
      }
      // Exhaustion visual warning on all buttons
      btn.classList.toggle('arena-move-btn--exhausted', playerStamina < threshold);
    });
  }

  function updateCooldownOverlays(cds) {
    var maxRounds = (window.BsConst && BsConst.COOLDOWN_ROUNDS) || {};
    document.querySelectorAll('.arena-move-btn[data-move]').forEach(function(btn) {
      var move = btn.getAttribute('data-move');
      var remaining = (cds && cds[move]) || 0;
      var max = maxRounds[move] || 0;
      var wasOnCooldown = btn.classList.contains('arena-move-btn--on-cooldown');
      btn.classList.toggle('arena-move-btn--on-cooldown', remaining > 0);
      if (remaining > 0 && max > 0) {
        var deg = (remaining / max) * 360;
        btn.style.setProperty('--cd-deg', deg + 'deg');
        btn.setAttribute('data-cd', remaining);
      } else {
        btn.style.removeProperty('--cd-deg');
        btn.removeAttribute('data-cd');
        // Ready pulse: cooldown just cleared this round
        if (wasOnCooldown) {
          btn.classList.add('arena-move-btn--cd-ready');
          setTimeout(function() { btn.classList.remove('arena-move-btn--cd-ready'); }, 600);
        }
      }
    });
  }

  function initStanceButtons() {
    var row = document.getElementById('arena-stance-row');
    if (!row) return;
    row.querySelectorAll('.arena-stance-btn').forEach(function(btn) {
      var stance = btn.getAttribute('data-stance');
      btn.classList.toggle('arena-stance-btn--active', stance === _playerStance);
      btn.onclick = function() {
        if (_isAnimating) return;
        _playerStance = stance;
        row.querySelectorAll('.arena-stance-btn').forEach(function(b) {
          b.classList.toggle('arena-stance-btn--active', b.getAttribute('data-stance') === stance);
        });
        // Update stamina cost badges to reflect stance adjustment
        if (_battleData.stamina) updateMoveCosts(_battleData.stamina.player);
      };
    });
  }

  var _lastBossStance = 'balanced';
  function updateBossStance(stance) {
    var el = document.getElementById('arena-boss-stance');
    if (!el) return;
    var defs = (window.BsConst && BsConst.STANCE_DEFS) || {};
    var def = defs[stance] || defs.balanced || { icon: 'fa-circle-nodes' };
    el.innerHTML = '<i class="fas ' + def.icon + '"></i>';
    el.className = 'arena-boss-stance';
    if (stance === 'aggressive') el.classList.add('arena-boss-stance--aggressive');
    if (stance === 'defensive') el.classList.add('arena-boss-stance--defensive');
    if (stance !== _lastBossStance && _lastBossStance) {
      var label = (def.label || stance).charAt(0).toUpperCase() + (def.label || stance).slice(1);
      addLogEntry('\u2694\uFE0F Boss shifts to ' + label + ' stance!', 'event');
    }
    _lastBossStance = stance;
  }

  // Telegraph: show boss's pre-committed move intent above opponent card
  var INTENT_ICONS = {
    strike: 'fa-hand-fist',
    guard: 'fa-shield-halved',
    ability: 'fa-bolt',
    heal: 'fa-heart-pulse',
    counter: 'fa-shield'
  };
  var INTENT_COLORS = {
    strike: '#ef4444',
    guard: '#3b82f6',
    ability: '#a855f7',
    heal: '#22c55e',
    counter: '#f97316'
  };

  function showBossIntent(intent) {
    var container = document.getElementById('arena-boss-intent');
    var iconEl = document.getElementById('arena-boss-intent-icon');
    var textEl = document.getElementById('arena-boss-intent-text');
    if (!container || !iconEl || !textEl) return;

    if (!intent || !intent.move) {
      container.style.display = 'none';
      return;
    }

    var move = intent.move;
    var flavor = intent.flavor || ('Enemy will ' + move);
    var icon = INTENT_ICONS[move] || 'fa-question';
    var color = INTENT_COLORS[move] || 'var(--bs-text-muted)';

    iconEl.innerHTML = '<i class="fas ' + icon + '" style="color:' + color + '"></i>';
    textEl.textContent = flavor;
    container.style.display = '';
    container.style.setProperty('--intent-color', color);

    // Animate entrance
    container.classList.remove('arena-boss-intent--enter');
    void container.offsetWidth; // force reflow
    container.classList.add('arena-boss-intent--enter');
  }

  function hideBossIntent() {
    var container = document.getElementById('arena-boss-intent');
    if (container) container.style.display = 'none';
  }

  function updateRoundLabel(round) {
    const el = document.getElementById('arena-round-label');
    if (el) el.textContent = `Round ${round}`;
  }

  function clearLog() {
    const log = document.getElementById('arena-battle-log');
    if (log) log.innerHTML = '';
  }

  function addLogEntry(text, type = '') {
    const log = document.getElementById('arena-battle-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'arena-log-entry' + (type ? ` arena-log-entry--${type}` : '');
    entry.textContent = text;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  function updateAbilityButton(combatStats) {
    if (!_abilityInfo) return;
    const iconEl = document.getElementById('arena-ability-icon');
    const labelEl = document.getElementById('arena-ability-label');
    const statEl = document.getElementById('arena-move-int');
    const descEl = document.getElementById('arena-ability-desc');
    const abilityBtn = document.querySelector('.arena-move-btn--ability');

    if (iconEl) iconEl.className = 'fas ' + _abilityInfo.icon;
    if (labelEl) labelEl.textContent = _abilityInfo.label;
    if (descEl) descEl.textContent = _abilityInfo.bonusDesc || 'Class ability';
    if (abilityBtn) abilityBtn.title = `${_abilityInfo.label} (${_abilityInfo.stat.toUpperCase()}). Costs ${_abilityCost} charges. +30% vs Strike. Reduced 30% by Guard. ${_abilityInfo.bonusDesc}`;

    // Update stat display to match ability stat
    const statKey = _abilityInfo.stat;
    const statVal = combatStats[statKey] || 0;
    if (statEl) statEl.textContent = `${statKey.toUpperCase()} ${statVal}`;
  }

  function updateChargeDisplay() {
    const chargeEl = document.getElementById('arena-ability-charge');
    if (chargeEl) chargeEl.textContent = `${Math.floor(_playerCharges)}/${_abilityCost}`;
  }

  function enableMoves(enabled) {
    // If tutorial is controlling buttons, don't override its state
    if (enabled && window.BsTutorial && window.BsTutorial.isControllingMoves && window.BsTutorial.isControllingMoves()) return;
    document.querySelectorAll('.arena-move-btn').forEach(btn => {
      btn.disabled = !enabled;
      btn.classList.toggle('arena-move-btn--disabled', !enabled);
    });

    // Lock ability button if insufficient charges
    const abilityBtn = document.querySelector('.arena-move-btn--ability');
    if (abilityBtn && enabled) {
      const locked = _playerCharges < _abilityCost;
      abilityBtn.disabled = locked;
      abilityBtn.classList.toggle('arena-move-btn--locked', locked);
      abilityBtn.classList.toggle('arena-move-btn--disabled', locked);
    }
  }

  function triggerHitShake(side) {
    const el = document.getElementById(side === 'player' ? 'arena-player-side' : 'arena-opponent-side');
    if (!el) return;
    el.classList.remove('arena-combatant--hit');
    void el.offsetWidth; // reflow to restart animation
    el.classList.add('arena-combatant--hit');
    setTimeout(() => el.classList.remove('arena-combatant--hit'), 400);
  }

  function showDamageFloat(side, amount, isHeal) {
    const container = document.getElementById(side === 'player' ? 'arena-player-side' : 'arena-opponent-side');
    if (!container) return;

    const floater = document.createElement('div');
    floater.className = 'arena-dmg-float' + (isHeal ? ' arena-dmg-float--heal' : '');
    floater.textContent = isHeal ? `+${amount}` : `-${amount}`;
    container.appendChild(floater);

    setTimeout(() => floater.remove(), 1200);
  }

  // ─── A1: single-attacker animation helper ────────────────────────────────
  // attackerSide: 'player' | 'opponent'
  // dmg: damage this attacker deals to target
  // heal: HP this attacker recovers
  async function animateAttack(attackerSide, move, dmg, heal) {
    const targetSide = attackerSide === 'player' ? 'opponent' : 'player';
    const audio = window.ArenaAudio;

    if (move === 'counter') {
      // Counter is a stance — show badge at defender, no outgoing damage
      if (audio) audio.play('guard');
      showCounterStanceBadge(attackerSide);
      await sleep(300);
      return;
    }

    if (audio) audio.play(move);
    await sleep(200);

    if (dmg > 0) {
      showDamageFloat(targetSide, dmg, false);
      triggerHitShake(targetSide);
      if (audio) audio.play('hit');
    }
    if (heal > 0) {
      showDamageFloat(attackerSide, heal, true);
      if (audio) audio.play('heal');
    }
  }

  // ─── A3: CRITICAL! banner ────────────────────────────────────────────────
  function showCritBanner(targetSide) {
    const container = document.getElementById(
      targetSide === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'arena-crit-banner';
    banner.textContent = 'CRITICAL!';
    container.appendChild(banner);
    setTimeout(() => banner.remove(), 1100);
  }

  // ─── A1: speed badge ─────────────────────────────────────────────────────
  function showSpeedBadge(winningSide) {
    const container = document.getElementById(
      winningSide === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const badge = document.createElement('div');
    badge.className = 'arena-speed-badge' +
      (winningSide === 'opponent' ? ' arena-speed-badge--enemy' : '');
    badge.textContent = '⚡ First Strike!';
    container.appendChild(badge);
    setTimeout(() => badge.remove(), 1200);
  }

  // ─── A5: streak badge ────────────────────────────────────────────────────
  function showStreakBadge(count) {
    const container = document.getElementById('arena-player-side');
    if (!container) return;
    // Remove any existing streak badge before adding new one
    const existing = container.querySelector('.arena-streak-badge');
    if (existing) existing.remove();

    const badge = document.createElement('div');
    var heatClass = count >= 5 ? ' arena-streak-badge--fire' : count >= 3 ? ' arena-streak-badge--hot' : '';
    badge.className = 'arena-streak-badge' + heatClass;
    badge.textContent = count >= 4 ? `\uD83D\uDD25\uD83D\uDD25 ${count}x Streak!` : `\uD83D\uDD25 ${count}x Streak!`;
    container.appendChild(badge);
    setTimeout(() => badge.remove(), 1500);
  }

  // ─── B1: Last Stand activation banner ───────────────────────────────────
  function showLastStandActivation(side) {
    if (window.ArenaAudio) window.ArenaAudio.play('last_stand');
    const container = document.getElementById(
      side === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'arena-last-stand-banner';
    banner.textContent = side === 'player' ? '\u26A0 LAST STAND!' : '\u26A0 LAST STAND!';
    container.appendChild(banner);
    setTimeout(() => banner.remove(), 2200);
  }

  // ─── B3: counter stance badge ────────────────────────────────────────────
  function showCounterStanceBadge(side) {
    const container = document.getElementById(
      side === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const badge = document.createElement('div');
    badge.className = 'arena-counter-badge';
    badge.textContent = '\uD83D\uDEE1 Counter Stance';
    container.appendChild(badge);
    setTimeout(() => badge.remove(), 1400);
  }

  // ─── B3: reflect burst banner ─────────────────────────────────────────────
  function showReflectBanner(side) {
    const container = document.getElementById(
      side === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'arena-reflect-banner';
    banner.textContent = 'Reflected!';
    container.appendChild(banner);
    setTimeout(() => banner.remove(), 1100);
  }

  // ─── B2: render burn / stun / blind status chips ─────────────────────────
  function renderStatusEffects(tempEffects) {
    if (!tempEffects) return;
    var sides = { player: 'arena-player-status', opponent: 'arena-opponent-status' };
    var chipDefs = {
      burn:  { icon: 'fa-fire',      label: 'Burn',  cls: 'burn'  },
      stun:  { icon: 'fa-bolt',      label: 'Stun',  cls: 'stun'  },
      blind: { icon: 'fa-eye-slash', label: 'Blind', cls: 'blind' }
    };
    ['player', 'opponent'].forEach(function (side) {
      var el = document.getElementById(sides[side]);
      if (!el) return;
      var effects = (tempEffects[side] || []).filter(function (e) {
        return chipDefs[e.effect];
      });
      el.innerHTML = effects.map(function (e) {
        var def = chipDefs[e.effect];
        var rounds = (e.roundsLeft > 1)
          ? ' <span style="opacity:0.7;font-size:0.6rem">' + e.roundsLeft + '</span>'
          : '';
        return '<span class="arena-status-chip arena-status-chip--' + def.cls + ' arena-status-chip--new">' +
          '<i class="fas ' + def.icon + '"></i> ' + def.label + rounds +
          '</span>';
      }).join('');
      el.querySelectorAll('.arena-status-chip--new').forEach(function (chip) {
        setTimeout(function () { chip.classList.remove('arena-status-chip--new'); }, 600);
      });
    });
  }

  // ─── B4: hype meter ───────────────────────────────────────────────────────
  function updateHype(points) {
    _hype = Math.min(100, _hype + points);
    var fill = document.getElementById('arena-hype-fill');
    var bar  = document.getElementById('arena-hype-bar');
    if (fill) fill.style.width = _hype + '%';
    if (bar)  bar.classList.toggle('arena-hype-bar--near-full', _hype >= 75);
    if (_hype >= 100) {
      showCrowdErupts();
      _crowdBoostPending = true;
      _hype = 0;
      if (fill) fill.style.width = '0%';
      if (bar)  bar.classList.remove('arena-hype-bar--near-full');
    }
  }

  function showCrowdBoostFlash() {
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var badge = document.createElement('div');
    badge.className = 'arena-crowd-boost-flash';
    badge.textContent = '⚡ CROWD BOOST!';
    field.appendChild(badge);
    setTimeout(function () { badge.remove(); }, 1000);
  }

  function showCrowdErupts() {
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var banner = document.createElement('div');
    banner.className = 'arena-crowd-banner';
    banner.textContent = 'CROWD ERUPTS!';
    field.appendChild(banner);
    if (window.ArenaAudio) window.ArenaAudio.play('crowd');
    setTimeout(function () { banner.remove(); }, 1800);
  }

  // ─── A2: kill shot slow-mo ───────────────────────────────────────────────
  async function triggerKillShot(defeatedSide) {
    const field = document.querySelector('.arena-battle__field');
    const defeatedEl = document.getElementById(
      defeatedSide === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (window.ArenaAudio) window.ArenaAudio.play('killshot');
    if (field) field.classList.add('arena--killshot');
    if (defeatedEl) defeatedEl.classList.add('arena-combatant--defeated');
    shakeScreen('heavy', 600);
    flashScreen('rgba(255, 255, 255, 0.15)', 300);
    burstParticles(defeatedSide, 20, defeatedSide === 'opponent' ? '#FFD700' : '#ff5252');
    await sleep(1400);
    if (field) field.classList.remove('arena--killshot');
    // Leave arena-combatant--defeated on — it stays until battle end resets the view
  }

  // ─── Screen shake + particles (Phase 5A juice) ──────────────────────────

  function shakeScreen(intensity, duration) {
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var cls = intensity === 'heavy' ? 'arena-screen-shake--heavy'
            : intensity === 'crit' ? 'arena-screen-shake--crit'
            : 'arena-screen-shake';
    field.classList.remove('arena-screen-shake', 'arena-screen-shake--crit', 'arena-screen-shake--heavy');
    void field.offsetWidth;
    field.classList.add(cls);
    setTimeout(function () { field.classList.remove(cls); }, duration || 500);
  }

  function flashScreen(color, duration) {
    var existing = document.querySelector('.arena-screen-flash');
    if (existing) existing.remove();
    var flash = document.createElement('div');
    flash.className = 'arena-screen-flash';
    flash.style.background = color || 'rgba(255, 50, 50, 0.15)';
    document.querySelector('.arena-battle__field').appendChild(flash);
    setTimeout(function () { flash.remove(); }, duration || 400);
  }

  function spawnParticles(container, count, color, direction) {
    if (!container) return;
    direction = direction || 'up';
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'arena-particle arena-particle--' + direction;
      p.style.setProperty('--p-color', color || 'var(--bs-accent)');
      p.style.setProperty('--p-x', (Math.random() * 100) + '%');
      p.style.setProperty('--p-delay', (Math.random() * 300) + 'ms');
      p.style.setProperty('--p-size', (3 + Math.random() * 4) + 'px');
      container.appendChild(p);
      setTimeout(function () { p.remove(); }, 1500);
    }
  }

  function burstParticles(side, count, color) {
    var container = document.getElementById(side === 'player' ? 'arena-player-side' : 'arena-opponent-side');
    spawnParticles(container, count || 12, color || '#FFD700', 'burst');
  }

  // ─── Phase 1A: Matchup feedback banner ───────────────────────────────────
  var MATCHUP_MESSAGES = {
    strike_heal:    { text: 'Strike disrupts Heal!', cls: 'win' },
    strike_ability: { text: 'Strike catches Ability off-guard!', cls: 'win' },
    guard_strike:   { text: 'Guard blocks Strike!', cls: 'win' },
    ability_guard:  { text: 'Ability breaks through Guard!', cls: 'win' },
    ability_counter:{ text: 'Ability bypasses Counter!', cls: 'win' },
    counter_strike: { text: 'Counter reflects Strike!', cls: 'win' },
    heal_strike:    { text: 'Heal disrupted by Strike!', cls: 'lose' },
    ability_strike: { text: 'Ability caught by Strike!', cls: 'lose' },
    strike_guard:   { text: 'Strike blocked by Guard!', cls: 'lose' },
    guard_ability:  { text: 'Guard stunned by Ability!', cls: 'lose' },
    counter_ability:{ text: 'Counter fails vs Ability!', cls: 'lose' },
    strike_counter: { text: 'Strike reflected by Counter!', cls: 'lose' }
  };

  function showMatchupBanner(playerMove, opponentMove) {
    if (playerMove === opponentMove) return;
    var key = playerMove + '_' + opponentMove;
    var msg = MATCHUP_MESSAGES[key];
    if (!msg) return;
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var banner = document.createElement('div');
    banner.className = 'arena-matchup-banner arena-matchup-banner--' + msg.cls;
    banner.textContent = msg.text;
    field.appendChild(banner);
    setTimeout(function () { banner.remove(); }, 1800);
  }

  // ─── Phase 1A: Passive activation flash ─────────────────────────────────
  var PASSIVE_PATTERNS = [
    { pattern: /guard.+pierce/i, name: 'Heavy Hitter', icon: 'fa-hand-fist', color: '#ff5252' },
    { pattern: /Quick Draw|speed priority|always act first/i, name: 'Quick Draw', icon: 'fa-forward', color: '#00e676' },
    { pattern: /Elusive|dodged your strike/i, name: 'Elusive', icon: 'fa-ghost', color: '#00e676' },
    { pattern: /Brutal|crit.*damage/i, name: 'Brutal', icon: 'fa-skull-crossbones', color: '#ff5252' },
    { pattern: /Focused|ability costs 1/i, name: 'Focused', icon: 'fa-bullseye', color: '#7b2fff' },
    { pattern: /Arcane Mastery/i, name: 'Arcane Mastery', icon: 'fa-hat-wizard', color: '#7b2fff' },
    { pattern: /Fortified Heal/i, name: 'Fortified Heal', icon: 'fa-shield-heart', color: '#ff9100' },
    { pattern: /Iron Guard|blocks 75%/i, name: 'Iron Guard', icon: 'fa-shield-halved', color: '#ff9100' },
    { pattern: /Fortune|crit chance/i, name: 'Fortune', icon: 'fa-clover', color: '#ffd740' },
    { pattern: /Wild Card|crits deal 2x/i, name: 'Wild Card', icon: 'fa-dice', color: '#ffd740' },
    { pattern: /Regen restored/i, name: 'Unbreakable', icon: 'fa-heart-circle-plus', color: '#ff9100' },
    { pattern: /Weakness exploit/i, name: 'Weakness Exploit', icon: 'fa-crosshairs', color: '#4ade80' },
    { pattern: /Class advantage/i, name: 'Class Advantage', icon: 'fa-chess', color: '#ffd740' }
  ];

  function showPassiveFlashes(events) {
    if (!events || !events.length) return;
    var container = document.getElementById('arena-player-side');
    if (!container) return;
    var shown = {};
    var evText = events.join(' ');
    for (var i = 0; i < PASSIVE_PATTERNS.length; i++) {
      var p = PASSIVE_PATTERNS[i];
      // Only flash for player-relevant events (skip "Enemy" prefixed ones)
      if (p.pattern.test(evText) && !shown[p.name]) {
        // Skip if the matching text is about the enemy
        var enemyMatch = evText.match(new RegExp('Enemy.{0,40}' + p.pattern.source, 'i'));
        if (enemyMatch) continue;
        shown[p.name] = true;
        showSinglePassiveFlash(container, p, Object.keys(shown).length - 1);
      }
    }
  }

  function showSinglePassiveFlash(container, passive, index) {
    var flash = document.createElement('div');
    flash.className = 'arena-passive-flash';
    flash.style.color = passive.color;
    flash.style.animationDelay = (index * 200) + 'ms';
    flash.innerHTML = '<i class="fas ' + passive.icon + '"></i> ' + passive.name + '!';
    container.appendChild(flash);
    setTimeout(function () { flash.remove(); }, 2000 + index * 200);
  }

  // ─── Phase 1B: Combo banner ─────────────────────────────────────────────
  var COMBO_DEFS = {
    flurry:    { name: 'FLURRY',    icon: '\uD83C\uDF2A\uFE0F', color: '#ff9100', desc: 'Triple Strike!' },
    riposte:   { name: 'RIPOSTE',   icon: '\u2694\uFE0F',       color: '#3a9fff', desc: 'Guard into Counter!' },
    empowered: { name: 'EMPOWERED', icon: '\u2728',             color: '#a855f7', desc: 'Heal into Ability!' }
  };

  function showComboBanner(comboId) {
    if (!comboId || !COMBO_DEFS[comboId]) return;
    var combo = COMBO_DEFS[comboId];
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var banner = document.createElement('div');
    banner.className = 'arena-combo-banner';
    banner.style.setProperty('--combo-color', combo.color);
    banner.innerHTML = '<span class="arena-combo-banner__icon">' + combo.icon + '</span>' +
      '<span class="arena-combo-banner__name">' + combo.name + '</span>' +
      '<span class="arena-combo-banner__desc">' + combo.desc + '</span>';
    field.appendChild(banner);
    if (window.ArenaAudio) window.ArenaAudio.play('crit');
    setTimeout(function () { banner.remove(); }, 2200);
  }

  // ─── Phase 1B: First-combo discovery toast (one-time per combo type) ────
  function showComboDiscoveryToast(comboId) {
    var combo = COMBO_DEFS[comboId];
    if (!combo) return;
    var key = 'bs-combo-discovered-' + comboId;
    try { if (localStorage.getItem(key)) return; } catch (e) { return; }
    try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
    var toast = window.BsToast;
    if (toast && toast.show) {
      toast.show('Combo Discovered: ' + combo.name + '! Tap the \u24D8 icon for all combos.', 'success', 5000);
    } else {
      addLogEntry('\u2728 Combo Discovered: ' + combo.name + '! Check the combat guide (\u24D8) for all combos.', 'hint');
    }
  }

  // ─── Phase 1A: Combo hint (preview next combo in move buttons) ──────────
  function updateComboHints() {
    // Show subtle hint on move buttons when a combo is 1 move away
    var btns = document.querySelectorAll('.arena-move-btn');
    btns.forEach(function (btn) { btn.classList.remove('arena-move-btn--combo-hint'); });

    var last1 = _moveHistory[_moveHistory.length - 1];
    var last2 = _moveHistory[_moveHistory.length - 2];

    // Flurry hint: 2 strikes in a row → hint on Strike
    if (last1 === 'strike' && last2 === 'strike') {
      var strikeBtn = document.querySelector('[data-move="strike"]');
      if (strikeBtn) strikeBtn.classList.add('arena-move-btn--combo-hint');
    }
    // Riposte hint: just guarded → hint on Counter
    if (last1 === 'guard') {
      var counterBtn = document.querySelector('[data-move="counter"]');
      if (counterBtn) counterBtn.classList.add('arena-move-btn--combo-hint');
    }
    // Empowered hint: just healed → hint on Ability
    if (last1 === 'heal') {
      var abilityBtn = document.querySelector('.arena-move-btn--ability');
      if (abilityBtn) abilityBtn.classList.add('arena-move-btn--combo-hint');
    }
  }

  // ─── A1: main round animation — two sequential phases ────────────────────
  async function animateRoundResult(result) {
    _isAnimating = true;
    enableMoves(false);

    const abilityName = _abilityInfo ? _abilityInfo.label : 'Ability';
    const moveNames = { strike: 'Strike', guard: 'Guard', ability: abilityName, heal: 'Heal', counter: 'Counter' };
    const audio = window.ArenaAudio;
    const speedWinner = result.speedWinner || 'player';

    // Determine ordered attacker/defender sides and their stats
    const firstSide  = speedWinner;
    const secondSide = speedWinner === 'player' ? 'opponent' : 'player';
    const firstMove  = speedWinner === 'player' ? result.playerMove    : result.opponentMove;
    const secondMove = speedWinner === 'player' ? result.opponentMove   : result.playerMove;
    const firstDmg   = speedWinner === 'player' ? result.playerDamage  : result.opponentDamage;
    const secondDmg  = speedWinner === 'player' ? result.opponentDamage : result.playerDamage;
    const firstHeal  = speedWinner === 'player' ? result.playerHeal    : result.opponentHeal;
    const secondHeal = speedWinner === 'player' ? result.opponentHeal   : result.playerHeal;

    // Crit detection — events use "Your strike" vs "Opponent"
    const playerCrit   = result.events && result.events.some(e => e.includes('Your strike landed a critical'));
    const opponentCrit = result.events && result.events.some(e => e.includes('Opponent landed a critical'));
    const firstCrit    = speedWinner === 'player' ? playerCrit   : opponentCrit;
    const secondCrit   = speedWinner === 'player' ? opponentCrit : playerCrit;

    // Crowd boost detection
    const crowdBoosted = result.events && result.events.some(e => e.includes('Crowd energy fuels your attack'));

    // A1: Show speed badge near the faster combatant
    showSpeedBadge(speedWinner);

    // Phase 1A: Show matchup result banner
    showMatchupBanner(result.playerMove, result.opponentMove);

    // ── Phase 1: First attacker ──────────────────────────────────────────
    const firstLabel = firstSide === 'player' ? 'You' : 'Opponent';
    addLogEntry(`${firstLabel} used ${moveNames[firstMove] || firstMove}.`, 'info');

    await animateAttack(firstSide, firstMove, firstDmg, firstHeal);

    // A3: crit banner on target of first hit
    if (firstCrit) {
      const firstTarget = firstSide === 'player' ? 'opponent' : 'player';
      showCritBanner(firstTarget);
      shakeScreen('crit', 400);
      flashScreen('rgba(255, 50, 50, 0.12)', 350);
      if (audio) audio.play('crit');
      await sleep(150);
    }

    // Crowd boost flash — player was first and boost fired
    if (crowdBoosted && firstSide === 'player') {
      showCrowdBoostFlash();
      await sleep(200);
    }

    // A2: kill-shot check — if first attacker drops target to 0, skip Phase 2
    const firstKillsOpponent = firstSide === 'player'   && result.opponentHp <= 0;
    const firstKillsPlayer   = firstSide === 'opponent' && result.playerHp   <= 0;
    const phase1KillShot     = firstKillsOpponent || firstKillsPlayer;

    if (phase1KillShot) {
      const defeatedSide = firstSide === 'player' ? 'opponent' : 'player';
      await sleep(200);
      await triggerKillShot(defeatedSide);

    } else {
      // Pause so player absorbs what just happened before the counter
      await sleep(700);

      // ── Phase 2: Second attacker ───────────────────────────────────────
      const secondLabel = secondSide === 'player' ? 'You' : 'Opponent';
      addLogEntry(`${secondLabel} used ${moveNames[secondMove] || secondMove}.`, 'info');

      await animateAttack(secondSide, secondMove, secondDmg, secondHeal);

      // A3: crit banner on target of second hit
      if (secondCrit) {
        const secondTarget = secondSide === 'player' ? 'opponent' : 'player';
        showCritBanner(secondTarget);
        shakeScreen('crit', 400);
        flashScreen('rgba(255, 50, 50, 0.12)', 350);
        if (audio) audio.play('crit');
        await sleep(150);
      }

      // Crowd boost flash — player was second and boost fired
      if (crowdBoosted && secondSide === 'player') {
        showCrowdBoostFlash();
        await sleep(200);
      }

      // A2: kill-shot check after Phase 2
      const phase2KillShot = result.playerHp <= 0 || result.opponentHp <= 0;
      if (phase2KillShot) {
        const defeatedSide = result.playerHp <= 0 ? 'player' : 'opponent';
        await sleep(200);
        await triggerKillShot(defeatedSide);
      } else {
        await sleep(500);
      }
    }

    // ── B3: Counter reflect animation (fires before HP update for drama) ───
    if (result.playerCounterReflect) {
      showReflectBanner('player');
      if (audio) audio.play('crit');
      await sleep(300);
      showDamageFloat('opponent', result.playerDamage, false);
      triggerHitShake('opponent');
      if (audio) audio.play('hit');
      await sleep(500);
    } else if (result.opponentCounterReflect) {
      showReflectBanner('opponent');
      if (audio) audio.play('crit');
      await sleep(300);
      showDamageFloat('player', result.opponentDamage, false);
      triggerHitShake('player');
      if (audio) audio.play('hit');
      await sleep(500);
    }

    // ── Phase 3: Resolution ───────────────────────────────────────────────
    // HP bars update after both attacks for clean readability
    updateHpBars(result.playerHp, _battleData.player.maxHp, result.opponentHp, _battleData.opponent.maxHp);

    // Update stamina bars + move costs from round result
    if (result.stamina) {
      _battleData.stamina = { player: result.stamina.player, opponent: result.stamina.opponent };
      _battleData.maxStamina = { player: result.stamina.playerMax, opponent: result.stamina.opponentMax };
      updateStaminaBars(result.stamina.player, result.stamina.playerMax, result.stamina.opponent, result.stamina.opponentMax);
      updateMoveCosts(result.stamina.player);
    }

    // Update cooldown overlays from round result
    if (result.cooldowns) {
      _battleData.cooldowns = result.cooldowns;
      updateCooldownOverlays(result.cooldowns.player);
    }

    // Update stances from round result
    if (result.stances) {
      _battleData.stances = result.stances;
      updateBossStance(result.stances.opponent);
    }

    // Log events (matchup results, crits, heals, buffs)
    if (result.events && result.events.length > 0) {
      result.events.forEach(e => addLogEntry(e, 'event'));
    }

    // Phase 1A: Flash passive activations detected from events
    showPassiveFlashes(result.events);

    // Phase 1B: Combo banner + first-discovery toast + juice
    if (result.comboTriggered) {
      showComboBanner(result.comboTriggered);
      showComboDiscoveryToast(result.comboTriggered);
      var comboColor = COMBO_DEFS[result.comboTriggered] ? COMBO_DEFS[result.comboTriggered].color : '#FFD700';
      shakeScreen('crit', 400);
      var field = document.querySelector('.arena-battle__field');
      spawnParticles(field, 15, comboColor, 'up');
    }

    // Phase 1B: Track move history for combo hints
    _moveHistory.push(result.playerMove);

    // B1: Last Stand — check transition before updating stored HP
    const prevPlayerHpPct  = _battleData.player.hp   / _battleData.player.maxHp;
    const prevOpponentHpPct = _battleData.opponent.hp / _battleData.opponent.maxHp;
    const newPlayerHpPct   = result.playerHp   / _battleData.player.maxHp;
    const newOpponentHpPct  = result.opponentHp / _battleData.opponent.maxHp;

    const isPlayerLastStand   = result.playerHp   > 0 && newPlayerHpPct   < 0.20;
    const isOpponentLastStand = result.opponentHp > 0 && newOpponentHpPct  < 0.20;

    const playerSideEl   = document.getElementById('arena-player-side');
    const opponentSideEl = document.getElementById('arena-opponent-side');
    if (playerSideEl)   playerSideEl.classList.toggle('arena-combatant--last-stand', isPlayerLastStand);
    if (opponentSideEl) opponentSideEl.classList.toggle('arena-combatant--last-stand', isOpponentLastStand);

    // Show activation banner on first entry into Last Stand
    if (isPlayerLastStand   && prevPlayerHpPct   >= 0.20) showLastStandActivation('player');
    if (isOpponentLastStand && prevOpponentHpPct >= 0.20) showLastStandActivation('opponent');

    // A5: update streak counter
    if (result.playerDamage > 0) {
      _playerStreak++;
      if (_playerStreak >= 2) showStreakBadge(_playerStreak);
    } else if (result.playerMove === 'guard' || result.playerMove === 'heal' || result.playerMove === 'counter') {
      _playerStreak = 0;
    }

    // B2: render status effect chips
    renderStatusEffects(result.tempEffects);

    // B4: hype updates
    if (playerCrit || opponentCrit)                             updateHype(25);
    if (result.playerCounterReflect || result.opponentCounterReflect) updateHype(20);
    if (isPlayerLastStand   && prevPlayerHpPct   >= 0.20)      updateHype(20);
    if (isOpponentLastStand && prevOpponentHpPct >= 0.20)      updateHype(20);
    if (_playerStreak >= 3)                                    updateHype(15);
    if (result.tempEffects && (
      (result.tempEffects.opponent || []).some(function (e) { return e.effect === 'stun'; }) ||
      (result.tempEffects.player   || []).some(function (e) { return e.effect === 'stun'; })
    )) updateHype(15);

    // Update local HP state
    _battleData.player.hp   = result.playerHp;
    _battleData.opponent.hp = result.opponentHp;

    // Update charges from round result
    if (result.charges) {
      _playerCharges = result.charges.player;
      updateChargeDisplay();
    }


    await sleep(300);
    _isAnimating = false;
  }

  async function handleMoveClick(move) {
    if (_isAnimating || !_battleData) return;

    // Client-side cooldown check
    if (_battleData.cooldowns && _battleData.cooldowns.player && _battleData.cooldowns.player[move] > 0) {
      addLogEntry(move.charAt(0).toUpperCase() + move.slice(1) + ' is on cooldown!', 'error');
      return;
    }

    enableMoves(false);

    try {
      const boost = _crowdBoostPending;
      _crowdBoostPending = false;
      var moveExtra = {};
      if (boost) moveExtra.crowdBoost = true;
      if (window._pendingItemUse) { moveExtra.useItem = window._pendingItemUse; window._pendingItemUse = null; }
      if (_playerStance !== 'balanced') moveExtra.stance = _playerStance;
      const response = await window.ArenaAPI.submitMove(
        _battleData.battleId, _currentRound, move, moveExtra
      );

      // Hide boss intent during animation — the telegraphed move is playing out
      hideBossIntent();

      await animateRoundResult(response.roundResult);

      if (response.battleStatus === 'complete') {
        // Clean up tutorial if still active when battle ends
        if (window._arenaTutorial && window._arenaTutorial.isActive()) {
          window._arenaTutorial.end();
        }
        var endAudio = window.ArenaAudio;
        if (endAudio) endAudio.play(response.battleResult.winner === 'player' ? 'victory' : 'defeat');
        // Stop any looping music
        if (endAudio && typeof endAudio.stopMusic === 'function') endAudio.stopMusic();
        // Show post-battle actions, hide forfeit
        var forfeitBtn = document.getElementById('arena-forfeit-btn');
        var postActions = document.getElementById('arena-battle-post');
        if (forfeitBtn) forfeitBtn.style.display = 'none';
        if (postActions) postActions.style.display = '';
        await sleep(600);
        window.ArenaResults.showResults(response.battleResult, _battleData);
      } else {
        _currentRound = response.currentRound;
        updateRoundLabel(_currentRound);
        addLogEntry(`Round ${_currentRound} — Choose your move.`);
        // Telegraph: Show boss's next committed move
        if (response.roundResult && response.roundResult.nextBossIntent) {
          showBossIntent(response.roundResult.nextBossIntent);
        }
        // Tutorial hooks — wait one frame for CSS to settle after animation
        if (window.BsTutorial && window.BsTutorial.isActive()) {
          requestAnimationFrame(function () {
            window.BsTutorial.onMoveComplete(move);
            window.BsTutorial.checkContextual({
              playerHp: response.roundResult.playerHp,
              playerMaxHp: _battleData.player.maxHp,
              charges: _playerCharges,
              abilityCost: _abilityCost,
              hype: _hype,
              round: _currentRound
            });
          });
        }
        enableMoves(true);
        updateComboHints();
      }
    } catch (err) {
      addLogEntry(`Error: ${err.message}`, 'error');
      enableMoves(true);
    }
  }

  function showForfeitModal() {
    if (_isAnimating || !_battleData) return;
    const modal = document.getElementById('arena-forfeit-modal');
    if (modal) modal.style.display = 'flex';
  }

  function hideForfeitModal() {
    const modal = document.getElementById('arena-forfeit-modal');
    if (modal) modal.style.display = 'none';
  }

  async function executeForfeit() {
    hideForfeitModal();
    enableMoves(false);
    try {
      const response = await window.ArenaAPI.forfeitBattle(_battleData.battleId);
      addLogEntry('You forfeited the battle.', 'error');
      if (window.ArenaAudio && typeof window.ArenaAudio.stopMusic === 'function') {
        window.ArenaAudio.stopMusic();
      }
      await sleep(400);
      window.ArenaResults.showResults(response.battleResult, _battleData);
    } catch (err) {
      addLogEntry(`Error: ${err.message}`, 'error');
    }
  }

  // Bind move buttons
  function bindEvents() {
    document.querySelectorAll('.arena-move-btn').forEach(btn => {
      btn.addEventListener('click', () => handleMoveClick(btn.dataset.move));
    });

    const forfeitBtn = document.getElementById('arena-forfeit-btn');
    if (forfeitBtn) forfeitBtn.addEventListener('click', showForfeitModal);

    const forfeitConfirm = document.getElementById('arena-forfeit-confirm');
    if (forfeitConfirm) forfeitConfirm.addEventListener('click', executeForfeit);

    const forfeitCancel = document.getElementById('arena-forfeit-cancel');
    if (forfeitCancel) forfeitCancel.addEventListener('click', hideForfeitModal);

    // Close modal on overlay click
    const modal = document.getElementById('arena-forfeit-modal');
    if (modal) modal.addEventListener('click', function (e) {
      if (e.target === modal) hideForfeitModal();
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return { initBattle, bindEvents, enableMoves, showBossIntent, hideBossIntent };
})();
