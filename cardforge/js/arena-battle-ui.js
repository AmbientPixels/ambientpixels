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

  function initBattle(battleData) {
    _battleData = battleData;
    _currentRound = 1;
    _isAnimating = false;
    _playerStreak = 0;

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
    badge.className = 'arena-streak-badge';
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
    await sleep(1400);
    if (field) field.classList.remove('arena--killshot');
    // Leave arena-combatant--defeated on — it stays until battle end resets the view
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

    // ── Phase 1: First attacker ──────────────────────────────────────────
    const firstLabel = firstSide === 'player' ? 'You' : 'Opponent';
    addLogEntry(`${firstLabel} used ${moveNames[firstMove] || firstMove}.`, 'info');

    await animateAttack(firstSide, firstMove, firstDmg, firstHeal);

    // A3: crit banner on target of first hit
    if (firstCrit) {
      const firstTarget = firstSide === 'player' ? 'opponent' : 'player';
      showCritBanner(firstTarget);
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

    // Log events (matchup results, crits, heals, buffs)
    if (result.events && result.events.length > 0) {
      result.events.forEach(e => addLogEntry(e, 'event'));
    }

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

    enableMoves(false);

    try {
      const boost = _crowdBoostPending;
      _crowdBoostPending = false;
      const response = await window.ArenaAPI.submitMove(
        _battleData.battleId, _currentRound, move,
        boost ? { crowdBoost: true } : {}
      );

      await animateRoundResult(response.roundResult);

      if (response.battleStatus === 'complete') {
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
        enableMoves(true);
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

  return { initBattle, bindEvents, enableMoves };
})();
