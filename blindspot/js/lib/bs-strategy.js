/**
 * Blindspot Strategy — Passives, Archetypes, Move Matchups, Prefight Info
 *
 * Pure game logic for combat strategy display. No mutable state.
 *
 * API: window.BsStrategy
 */
window.BsStrategy = (function () {
  'use strict';

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  var _C = window.BsConst || {};
  var STAT_PASSIVES = _C.STAT_PASSIVES;
  var MOVE_UPGRADES = _C.MOVE_UPGRADES;
  var ARCHETYPES = _C.ARCHETYPES;
  var WEAKNESS_LABELS = _C.WEAKNESS_LABELS;
  var WEAKNESS_COLORS = _C.WEAKNESS_COLORS;
  var BOSS_ICONS = _C.BOSS_ICONS;
  var CLASS_PATTERNS = _C.CLASS_PATTERNS;
  var MOVE_BEATS = _C.MOVE_BEATS;
  var BATTLE_HINTS = _C.BATTLE_HINTS;

  // ── Pure functions ──

  function detectArchetype(stats) {
    if (!stats) return ARCHETYPES.find(function(a) { return a.id === 'balanced'; });
    var sorted = Object.entries(stats).sort(function(a, b) { return b[1] - a[1]; });
    var top = sorted[0][0];
    var second = sorted[1][0];
    for (var i = 0; i < ARCHETYPES.length; i++) {
      var arch = ARCHETYPES[i];
      if (arch.primary === top && arch.secondary === second) return arch;
      if (arch.primary === top) return arch;
    }
    return ARCHETYPES.find(function(a) { return a.id === 'balanced'; });
  }

  function getActivePassives(stats) {
    if (!stats) return [];
    var active = [];
    var statKeys = Object.keys(STAT_PASSIVES);
    for (var s = 0; s < statKeys.length; s++) {
      var stat = statKeys[s];
      var tiers = STAT_PASSIVES[stat];
      for (var t = 0; t < tiers.length; t++) {
        if ((stats[stat] || 0) >= tiers[t].threshold) {
          active.push(Object.assign({}, tiers[t], { stat: stat }));
        }
      }
    }
    return active;
  }

  function getNextPassive(stats) {
    if (!stats) return null;
    var closest = null;
    var closestGap = Infinity;
    var statKeys = Object.keys(STAT_PASSIVES);
    for (var s = 0; s < statKeys.length; s++) {
      var stat = statKeys[s];
      var tiers = STAT_PASSIVES[stat];
      for (var t = 0; t < tiers.length; t++) {
        var gap = tiers[t].threshold - (stats[stat] || 0);
        if (gap > 0 && gap < closestGap) {
          closestGap = gap;
          closest = Object.assign({}, tiers[t], { stat: stat, gap: gap });
        }
      }
    }
    return closest;
  }

  function getMoveMatchup(playerMove, opponentMove) {
    if (!playerMove || !opponentMove || playerMove === opponentMove) return 'draw';
    if (MOVE_BEATS[playerMove] && MOVE_BEATS[playerMove].indexOf(opponentMove) !== -1) return 'win';
    if (MOVE_BEATS[opponentMove] && MOVE_BEATS[opponentMove].indexOf(playerMove) !== -1) return 'lose';
    return 'draw';
  }

  // ── Prefight info HTML builder ──

  function buildPrefightInfo(boss) {
    var html = '"' + escHtml(boss.flavor) + '"';
    if (boss.weakness) {
      html += '<br><span style="color:' + (WEAKNESS_COLORS[boss.weakness] || 'var(--bs-accent)') + ';font-size:0.8rem;margin-top:0.5rem;display:inline-block;"><i class="fas fa-crosshairs"></i> Stat weakness: ' + (WEAKNESS_LABELS[boss.weakness] || boss.weakness) + '</span>';
    }
    var res = boss.resistances || {};
    var resKeys = Object.keys(res).filter(function(k) { return res[k] > 0; });
    if (resKeys.length) {
      html += '<br><span style="font-size:0.75rem;color:#ff6b6b;display:inline-block;"><i class="fas fa-shield-halved"></i> Resists: ' + resKeys.map(function(k) { return k + ' -' + res[k] + '%'; }).join(', ') + '</span>';
    }
    var mw = boss.moveWeaknesses || {};
    var mwKeys = Object.keys(mw).filter(function(k) { return mw[k] > 0; });
    if (mwKeys.length) {
      html += '<br><span style="font-size:0.75rem;color:#4ade80;display:inline-block;"><i class="fas fa-bullseye"></i> Weak to: ' + mwKeys.map(function(k) { return k + ' +' + mw[k] + '%'; }).join(', ') + '</span>';
    }
    if (boss.signaturePassive) {
      html += '<br><span style="font-size:0.75rem;color:var(--bs-accent);display:inline-block;"><i class="fas fa-star"></i> ' + escHtml(boss.signaturePassive.name) + ' \u2014 ' + escHtml(boss.signaturePassive.desc) + '</span>';
    }
    if (CLASS_PATTERNS[boss.class]) {
      html += '<br><span style="font-size:0.75rem;color:var(--bs-text-muted);display:inline-block;"><i class="fas fa-chess"></i> Tends to: ' + CLASS_PATTERNS[boss.class] + '</span>';
    }
    if (boss.bossTip) {
      html += '<br><span style="font-size:0.75rem;color:var(--bs-text-muted);font-style:italic;margin-top:0.25rem;display:inline-block;">' + escHtml(boss.bossTip) + '</span>';
    }
    return html;
  }

  // ── Prefight overlay population (needs card + DOM) ──

  function populatePrefightOverlay(boss, selectedCard) {
    if (!boss) return;
    var flavorEl = document.getElementById('bs-prefight-flavor');
    var titleEl = document.getElementById('bs-prefight-title');
    var avatarEl = document.getElementById('bs-prefight-avatar');
    if (flavorEl) flavorEl.innerHTML = buildPrefightInfo(boss);
    if (titleEl) titleEl.textContent = boss.name;
    if (avatarEl) {
      if (boss.avatar) {
        avatarEl.innerHTML = '<img src="' + escHtml(boss.avatar) + '" alt="' + escHtml(boss.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        avatarEl.style.width = '96px';
        avatarEl.style.height = '96px';
      } else {
        var icon = BOSS_ICONS[boss.class] || 'fa-skull';
        avatarEl.innerHTML = '<i class="fas ' + icon + '"></i>';
      }
    }
    var compEl = document.getElementById('bs-prefight-comparison');
    if (compEl && selectedCard) {
      var ps = selectedCard.combatStats || {};
      var bs = boss.combatStats || {};
      var labels = [
        { key: 'str', label: 'STR', icon: 'fa-fist-raised' },
        { key: 'agi', label: 'AGI', icon: 'fa-wind' },
        { key: 'int', label: 'INT', icon: 'fa-brain' },
        { key: 'end', label: 'END', icon: 'fa-shield-alt' },
        { key: 'lck', label: 'LCK', icon: 'fa-dice' }
      ];
      compEl.innerHTML = '<div class="bs-prefight-comparison__header">'
        + '<span class="bs-prefight-comparison__you">You</span>'
        + '<span class="bs-prefight-comparison__vs">VS</span>'
        + '<span class="bs-prefight-comparison__boss">' + escHtml(boss.name) + '</span>'
        + '</div>'
        + labels.map(function(s) {
            var pv = ps[s.key] || 0;
            var bv = bs[s.key] || 0;
            var diff = pv - bv;
            var diffClass = diff > 0 ? 'bs-stat-advantage' : diff < 0 ? 'bs-stat-disadvantage' : 'bs-stat-even';
            return '<div class="bs-prefight-stat-row">'
              + '<span class="bs-prefight-stat-row__pval">' + pv + '</span>'
              + '<div class="bs-prefight-stat-row__bar">'
              + '<div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--player" style="width:' + pv + '%"></div>'
              + '</div>'
              + '<span class="bs-prefight-stat-row__label"><i class="fas ' + s.icon + '"></i> ' + s.label + '</span>'
              + '<div class="bs-prefight-stat-row__bar">'
              + '<div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--boss" style="width:' + bv + '%"></div>'
              + '</div>'
              + '<span class="bs-prefight-stat-row__bval ' + diffClass + '">' + bv + '</span>'
              + '</div>';
          }).join('');
    } else if (compEl) {
      compEl.innerHTML = '';
    }
  }

  // ── Move flash (DOM) ──

  function flashMoveResult(playerMove, opponentMove) {
    var matchup = getMoveMatchup(playerMove, opponentMove);
    if (matchup === 'draw') return;
    var playerBtn = document.querySelector('[data-move="' + playerMove + '"]');
    var opponentBtn = document.querySelector('[data-move="' + opponentMove + '"]');
    if (!playerBtn) return;
    var winClass = 'bs-move-flash--win';
    var loseClass = 'bs-move-flash--lose';
    if (matchup === 'win') {
      playerBtn.classList.add(winClass);
      if (opponentBtn) opponentBtn.classList.add(loseClass);
    } else {
      playerBtn.classList.add(loseClass);
      if (opponentBtn) opponentBtn.classList.add(winClass);
    }
    setTimeout(function () {
      playerBtn.classList.remove(winClass, loseClass);
      if (opponentBtn) opponentBtn.classList.remove(winClass, loseClass);
    }, 600);
  }

  // ── Public API ──

  return {
    detectArchetype: detectArchetype,
    getActivePassives: getActivePassives,
    getNextPassive: getNextPassive,
    getMoveMatchup: getMoveMatchup,
    buildPrefightInfo: buildPrefightInfo,
    populatePrefightOverlay: populatePrefightOverlay,
    flashMoveResult: flashMoveResult,
    STAT_PASSIVES: STAT_PASSIVES,
    MOVE_UPGRADES: MOVE_UPGRADES,
    ARCHETYPES: ARCHETYPES,
    WEAKNESS_LABELS: WEAKNESS_LABELS,
    WEAKNESS_COLORS: WEAKNESS_COLORS,
    BOSS_ICONS: BOSS_ICONS,
    BATTLE_HINTS: BATTLE_HINTS,
    MOVE_BEATS: MOVE_BEATS
  };
})();
