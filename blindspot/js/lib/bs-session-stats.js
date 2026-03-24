/**
 * bs-session-stats.js — Battle round tracking, boss dialogue, loss tips, session stats display
 *
 * IIFE on window.BsSessionStats.
 * Depends on: BsConst (CLASS_PATTERNS, TUTORIAL_COUNTER_HINTS)
 */
(function () {
  'use strict';

  var _C = window.BsConst || {};
  var CLASS_PATTERNS = _C.CLASS_PATTERNS;
  var TUTORIAL_COUNTER_HINTS = _C.TUTORIAL_COUNTER_HINTS;

  var _battleRoundStats = null;

  // Callbacks injected by monolith
  var _cb = {};

  // Boss dialogue
  var BOSS_DIALOGUE = {
    'bs-boss-1':  { start: '"Everyone passes through here once."', loss: '"...not bad."' },
    'bs-boss-2':  { start: '"Rules exist for a reason."',          loss: '"You broke every one."' },
    'bs-boss-3':  { start: '"You never see them coming."',         loss: '"Neither did I."' },
    'bs-boss-4':  { start: '"Your data is already mine."',         loss: '"Error... unexpected input."' },
    'bs-boss-5':  { start: '"I don\'t think. I hit."',             loss: '"Hit... harder..."' },
    'bs-boss-6':  { start: '"Knowledge is the only weapon."',      loss: '"A lesson... for me."' },
    'bs-boss-7':  { start: '"Nothing gets through."',              loss: '"Impossible..."' },
    'bs-boss-8':  { start: '"Which move am I thinking of?"',       loss: '"You read me..."' },
    'bs-boss-9':  { start: '"Instinct. Teeth. Fury."',             loss: '"The hunt... ends."' },
    'bs-boss-10': { start: '"I built this arena. I am the final wall."', loss: '"You are no longer a Stranger."' }
  };

  function showBossDialogue(bossId, phase) {
    var d = BOSS_DIALOGUE[bossId];
    if (!d || !d[phase]) return;
    var logEl = document.getElementById('arena-battle-log');
    if (!logEl) return;
    var entry = document.createElement('div');
    entry.className = 'arena-log-entry';
    entry.style.cssText = 'color:var(--bs-accent-glow); font-style:italic;';
    entry.textContent = d[phase];
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function showRoundFlash(roundNum) {
    var el = document.createElement('div');
    el.className = 'bs-round-flash';
    el.textContent = 'Round ' + roundNum;
    el.setAttribute('aria-live', 'assertive');
    var stage = document.querySelector('.arena-battle__stage') || document.body;
    stage.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('bs-round-flash--active'); });
    setTimeout(function() {
      el.classList.add('bs-round-flash--exit');
      setTimeout(function() { el.remove(); }, 400);
    }, 800);
  }

  function resetBattleStats() {
    _battleRoundStats = {
      rounds: 0,
      damageDealt: 0,
      damageTaken: 0,
      healingDone: 0,
      moves: { strike: 0, guard: 0, ability: 0, heal: 0, counter: 0 }
    };
  }

  function trackRoundResult(roundResult) {
    if (!_battleRoundStats) resetBattleStats();
    _battleRoundStats.rounds++;
    _battleRoundStats.damageDealt += (roundResult.playerDamage || 0);
    _battleRoundStats.damageTaken += (roundResult.opponentDamage || 0);
    _battleRoundStats.healingDone += (roundResult.playerHeal || 0);
    const move = roundResult.playerMove;
    if (move && _battleRoundStats.moves.hasOwnProperty(move)) {
      _battleRoundStats.moves[move]++;
    }
    // Flash move buttons to show RPS matchup result
    if (_cb.flashMoveResult) _cb.flashMoveResult(roundResult.playerMove, roundResult.opponentMove);
    // Round transition flash
    if (_battleRoundStats.rounds > 1) showRoundFlash(_battleRoundStats.rounds);
    // Play move SFX based on player's move
    var moveSfxMap = { strike: 'strikeHit', guard: 'guardBlock', ability: 'abilityZap', heal: 'healChime', counter: 'counterPing' };
    if (move && moveSfxMap[move] && _cb.playSfx) _cb.playSfx(moveSfxMap[move]);
    // Crit SFX overlay
    if (roundResult.playerCrit && _cb.playSfx) setTimeout(function() { _cb.playSfx('critHit'); }, 100);
    // Tutorial: show contextual hint about enemy move for first 3 campaign battles
    if (_cb.isInTutorialRange && _cb.isInTutorialRange() && _cb.getBattleType && _cb.getBattleType() === 'pve' && roundResult.opponentMove) {
      var hint = TUTORIAL_COUNTER_HINTS[roundResult.opponentMove];
      if (hint && _cb.showTutorialHint) {
        setTimeout(function() { _cb.showTutorialHint(hint); }, 600);
      }
    }
  }

  function hookBattleTracking() {
    if (window._bsTrackingHooked) return;
    window._bsTrackingHooked = true;
    // Hook initBattle to reset stats
    if (window.ArenaBattleUI && window.ArenaBattleUI.initBattle) {
      const origInit = window.ArenaBattleUI.initBattle;
      window.ArenaBattleUI.initBattle = function (battleData) {
        resetBattleStats();
        if (_cb.startBattleAmbient) _cb.startBattleAmbient();
        // Clear leftover item + charm buttons from previous battle
        var movesEl = document.getElementById('arena-moves');
        if (movesEl) {
          movesEl.querySelectorAll('.arena-move-btn--item, .arena-move-btn--charm').forEach(function(btn) { btn.remove(); });
        }
        var result = origInit.call(window.ArenaBattleUI, battleData);
        if (_cb.addCharmButtonToBattle) _cb.addCharmButtonToBattle();
        if (_cb.addItemButtonsToBattle) _cb.addItemButtonsToBattle();
        // Boss dialogue at battle start
        if (_cb.getBattleType && _cb.getBattleType() === 'pve' && _cb.getCurrentBossId) {
          var bossId = _cb.getCurrentBossId();
          if (bossId) setTimeout(function() { showBossDialogue(bossId, 'start'); }, 500);
        }
        return result;
      };
    }
    // Hook submitMove to track each round's result
    if (window.ArenaAPI && window.ArenaAPI.submitMove) {
      const origSubmit = window.ArenaAPI.submitMove;
      window.ArenaAPI.submitMove = async function () {
        const response = await origSubmit.apply(window.ArenaAPI, arguments);
        if (response && response.roundResult) {
          trackRoundResult(response.roundResult);
        }
        return response;
      };
    }
  }

  // Data-driven loss tip based on what happened in the fight
  function getLossTip() {
    const s = _battleRoundStats;
    var currentBossId = _cb.getCurrentBossId ? _cb.getCurrentBossId() : null;
    var bossesById = _cb.getBossesById ? _cb.getBossesById() : {};
    const boss = bossesById[currentBossId];
    if (!s || s.rounds === 0) {
      // Fallback to class-based tip
      var classTips = {
        'Enforcer': 'Enforcers guard often. Use Ability to break through.',
        'Fighter': 'Fighters strike hard. Guard or Counter their attacks.',
        'Scout': 'Scouts are fast and evasive. Use abilities.',
        'Hacker': 'Hackers use abilities often. Guard when they charge up.',
        'Berserker': 'Berserkers are all-in on strikes. Counter destroys them.',
        'Scholar': 'Scholars mix heals and abilities. Pressure with strikes.',
        'Guardian': 'Guardians are tanks. Use abilities, not strikes.',
        'Trickster': 'Tricksters are unpredictable. Watch their pattern.',
        'Caster': 'Casters hit hard with abilities. Guard when charged.'
      };
      return boss ? (classTips[boss.class] || 'Your card remembers.') : 'Your card remembers.';
    }
    // Analyze what went wrong
    if (s.healingDone === 0 && s.damageTaken > 0) {
      return 'You never healed. Try Heal when below 50% HP.';
    }
    if (s.moves.guard === 0 && s.moves.counter === 0 && s.damageTaken > s.damageDealt) {
      return 'You took more damage than you dealt. Try Guard or Counter.';
    }
    if (s.moves.strike > 0 && s.moves.ability === 0 && boss && (boss.class === 'Guardian' || boss.class === 'Enforcer')) {
      return 'Strikes bounce off guards. Use Ability to break through.';
    }
    if (s.moves.ability > 0 && s.moves.strike === 0) {
      return 'Mix in Strikes — abilities need charges to recharge.';
    }
    if (s.damageTaken > s.damageDealt * 1.5) {
      return 'You were overwhelmed. Guard absorbs damage, Counter punishes attacks.';
    }
    if (s.moves.counter >= s.rounds * 0.5) {
      return 'Too many Counters. Counter only works against Strikes.';
    }
    // Fallback to class-based
    var patterns = CLASS_PATTERNS[boss ? boss.class : ''];
    if (patterns) return (boss ? boss.name : 'This boss') + ' favors ' + patterns + '. Plan around that.';
    return 'Your card remembers. Try a different strategy.';
  }

  function renderSessionStats() {
    if (!_battleRoundStats || _battleRoundStats.rounds === 0) return;
    const s = _battleRoundStats;
    // Remove any previous stats panel
    document.querySelector('.bs-session-stats')?.remove();

    const moveIcons = { strike: 'fa-fist-raised', guard: 'fa-shield-halved', ability: 'fa-bolt', heal: 'fa-heart', counter: 'fa-rotate-left' };
    const moveLabels = { strike: 'Strike', guard: 'Guard', ability: 'Ability', heal: 'Heal', counter: 'Counter' };
    let movesHtml = '';
    for (const [move, count] of Object.entries(s.moves)) {
      if (count > 0) {
        movesHtml += `<span class="bs-session-stat__move"><i class="fas ${moveIcons[move]}"></i> ${count}</span>`;
      }
    }

    const panel = document.createElement('div');
    panel.className = 'bs-session-stats';
    panel.innerHTML = `
      <div class="bs-session-stats__title"><i class="fas fa-chart-bar"></i> Battle Stats</div>
      <div class="bs-session-stats__grid">
        <div class="bs-session-stat">
          <span class="bs-session-stat__val">${s.rounds}</span>
          <span class="bs-session-stat__label">Rounds</span>
        </div>
        <div class="bs-session-stat bs-session-stat--dmg">
          <span class="bs-session-stat__val">${s.damageDealt}</span>
          <span class="bs-session-stat__label">Damage Dealt</span>
        </div>
        <div class="bs-session-stat bs-session-stat--taken">
          <span class="bs-session-stat__val">${s.damageTaken}</span>
          <span class="bs-session-stat__label">Damage Taken</span>
        </div>
        <div class="bs-session-stat bs-session-stat--heal">
          <span class="bs-session-stat__val">${s.healingDone}</span>
          <span class="bs-session-stat__label">Healing</span>
        </div>
      </div>
      ${movesHtml ? `<div class="bs-session-stats__moves">${movesHtml}</div>` : ''}
    `;

    // Insert after subtitle/power row in results overlay
    const subtitle = document.getElementById('arena-results-subtitle');
    const power = document.querySelector('.bs-results-power');
    const insertAfter = power || subtitle;
    if (insertAfter) {
      insertAfter.after(panel);
    }
  }

  window.BsSessionStats = {
    hookBattleTracking: hookBattleTracking,
    showBossDialogue: showBossDialogue,
    getLossTip: getLossTip,
    renderSessionStats: renderSessionStats,
    resetBattleStats: resetBattleStats,
    getStats: function () { return _battleRoundStats; },
    setCallbacks: function (cb) { _cb = cb; }
  };
})();
