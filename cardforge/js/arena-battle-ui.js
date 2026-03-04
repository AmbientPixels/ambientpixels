/**
 * Arena Battle UI — battle screen rendering, animations, move handling
 */
window.ArenaBattleUI = (function () {
  'use strict';

  let _battleData = null;
  let _currentRound = 1;
  let _isAnimating = false;

  function initBattle(battleData) {
    _battleData = battleData;
    _currentRound = 1;
    _isAnimating = false;

    renderCombatants(battleData);
    updateHpBars(battleData.player.hp, battleData.player.maxHp, battleData.opponent.hp, battleData.opponent.maxHp);
    updateRoundLabel(_currentRound, battleData.totalRounds);
    clearLog();
    addLogEntry('Battle started! Choose your move.');
    enableMoves(true);

    // Update move stat labels
    const strEl = document.getElementById('arena-move-str');
    const intEl = document.getElementById('arena-move-int');
    if (strEl) strEl.textContent = `STR ${battleData.player.combatStats.str}`;
    if (intEl) intEl.textContent = `INT ${battleData.player.combatStats.int}`;
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

  function updateRoundLabel(round, total) {
    const el = document.getElementById('arena-round-label');
    if (el) el.textContent = `Round ${round} of ${total}`;
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

  function enableMoves(enabled) {
    document.querySelectorAll('.arena-move-btn').forEach(btn => {
      btn.disabled = !enabled;
      btn.classList.toggle('arena-move-btn--disabled', !enabled);
    });
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

  async function animateRoundResult(result) {
    _isAnimating = true;
    enableMoves(false);

    const moveNames = { strike: 'Strike', guard: 'Guard', ability: 'Ability' };

    // Show moves chosen
    addLogEntry(`Round ${result.round}: You used ${moveNames[result.playerMove]}. Opponent used ${moveNames[result.opponentMove]}.`, 'info');

    // Brief pause for drama
    await sleep(400);

    // Show damage floats
    if (result.opponentDamage > 0) {
      showDamageFloat('player', result.opponentDamage, false);
    }
    if (result.playerDamage > 0) {
      showDamageFloat('opponent', result.playerDamage, false);
    }
    if (result.playerHeal > 0) {
      showDamageFloat('player', result.playerHeal, true);
    }
    if (result.opponentHeal > 0) {
      showDamageFloat('opponent', result.opponentHeal, true);
    }

    await sleep(300);

    // Animate HP bars
    updateHpBars(result.playerHp, _battleData.player.maxHp, result.opponentHp, _battleData.opponent.maxHp);

    // Log events
    if (result.events && result.events.length > 0) {
      result.events.forEach(e => addLogEntry(e, 'event'));
    }

    // Update local state
    _battleData.player.hp = result.playerHp;
    _battleData.opponent.hp = result.opponentHp;

    await sleep(400);
    _isAnimating = false;
  }

  async function handleMoveClick(move) {
    if (_isAnimating || !_battleData) return;

    enableMoves(false);

    try {
      const response = await window.ArenaAPI.submitMove(_battleData.battleId, _currentRound, move);

      await animateRoundResult(response.roundResult);

      if (response.battleStatus === 'complete') {
        await sleep(600);
        window.ArenaResults.showResults(response.battleResult, _battleData);
      } else {
        _currentRound = response.currentRound;
        updateRoundLabel(_currentRound, _battleData.totalRounds);
        addLogEntry(`Round ${_currentRound} — Choose your move.`);
        enableMoves(true);
      }
    } catch (err) {
      addLogEntry(`Error: ${err.message}`, 'error');
      enableMoves(true);
    }
  }

  async function handleForfeit() {
    if (_isAnimating || !_battleData) return;
    if (!confirm('Are you sure you want to forfeit this battle?')) return;

    enableMoves(false);
    try {
      const response = await window.ArenaAPI.forfeitBattle(_battleData.battleId);
      addLogEntry('You forfeited the battle.', 'error');
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
    if (forfeitBtn) forfeitBtn.addEventListener('click', handleForfeit);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return { initBattle, bindEvents, enableMoves };
})();
