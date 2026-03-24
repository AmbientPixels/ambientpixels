/**
 * bs-campaign.js — Campaign ladder, weekly boss UI, Infinite Tower section.
 * Extracted from blindspot-flow.js (Round 4.2).
 */
(function () {
  'use strict';

  var _C = window.BsConst || {};
  var BOSS_ICONS = _C.BOSS_ICONS;
  var PALETTE_UNLOCK_BOSSES = _C.PALETTE_UNLOCK_BOSSES;

  var _Str = window.BsStrategy || {};
  var WEAKNESS_LABELS = _Str.WEAKNESS_LABELS;
  var WEAKNESS_COLORS = _Str.WEAKNESS_COLORS;

  // ── Callbacks injected by monolith ──
  var _cb = {};
  function setCallbacks(cbs) { _cb = cbs || {}; }

  function escHtml(s) { return _cb.escHtml ? _cb.escHtml(s) : String(s || ''); }

  // ── Campaign Ladder ──

  function renderCampaignLadder() {
    var container = document.getElementById('bs-boss-ladder');
    if (!container) return;

    var bosses = _cb.getBosses ? _cb.getBosses() : [];
    var bossesById = _cb.getBossesById ? _cb.getBossesById() : {};
    var highestDefeated = _cb.getHighestBoss ? _cb.getHighestBoss() : 0;

    var progressEl = document.getElementById('bs-campaign-progress');
    var campaignOnly = bosses.filter(function (b) { return !b.weekly && !(_cb.isWeeklyBoss && _cb.isWeeklyBoss(b.id)); });
    if (progressEl) {
      var total = campaignOnly.length;
      var defeated = Math.min(highestDefeated, total);
      if (defeated >= total) {
        progressEl.innerHTML = '<i class="fas fa-crown" style="color:var(--bs-accent);"></i> ' + total + '/' + total + ' defeated';
      } else {
        progressEl.textContent = defeated + '/' + total + ' defeated';
      }
      // Campaign palette unlock teaser
      var existingTeaser = document.getElementById('bs-campaign-teaser');
      if (existingTeaser) existingTeaser.remove();
      for (var pi = 0; pi < PALETTE_UNLOCK_BOSSES.length; pi++) {
        if (highestDefeated < PALETTE_UNLOCK_BOSSES[pi].bossNum) {
          var tDiv = document.createElement('div');
          tDiv.id = 'bs-campaign-teaser';
          tDiv.className = 'bs-unlock-teaser';
          tDiv.style.marginTop = '0.25rem';
          tDiv.innerHTML = '<i class="fas fa-palette" style="color:var(--bs-accent);"></i> Beat Boss ' + PALETTE_UNLOCK_BOSSES[pi].bossNum + ' to unlock ' + PALETTE_UNLOCK_BOSSES[pi].palette + ' palette';
          progressEl.parentNode.insertBefore(tDiv, progressEl.nextSibling);
          break;
        }
      }
    }

    // Weekly boss challenge section
    var weeklyBoss = _cb.getWeeklyBoss ? _cb.getWeeklyBoss() : null;
    var daysLeft = _cb.getDaysUntilWeeklyReset ? _cb.getDaysUntilWeeklyReset() : 0;
    var weeklyHtml = '';
    if (weeklyBoss) {
      var weeklyRec = _cb.getWeeklyRecord ? _cb.getWeeklyRecord() : { wins: 0, losses: 0 };
      var wDefeated = weeklyRec.wins > 0;
      var wRecord = weeklyRec;
      var wIcon = BOSS_ICONS[weeklyBoss.class] || 'fa-skull';
      var wRecordBadge = (wRecord.wins > 0 || wRecord.losses > 0)
        ? '<span class="bs-boss-card__record">' + wRecord.wins + 'W / ' + wRecord.losses + 'L</span>'
        : '';
      var wRewardClaimed = _cb.isWeeklyRewardClaimed ? _cb.isWeeklyRewardClaimed() : false;
      var wRewardBadge = weeklyBoss.reward
        ? '<span class="bs-boss-card__reward ' + (wRewardClaimed ? 'bs-boss-card__reward--claimed' : '') + '">'
          + '<i class="fas fa-arrow-up"></i> '
          + escHtml(weeklyBoss.reward.label)
          + '</span>'
        : '';

      weeklyHtml = '<div class="bs-weekly-challenge">'
        + '<div class="bs-weekly-challenge__header">'
        + '<span class="bs-weekly-challenge__title"><i class="fas fa-calendar-week"></i> Weekly Challenge</span>'
        + '<span class="bs-weekly-challenge__timer"><i class="fas fa-clock"></i> ' + daysLeft + 'd left</span>'
        + '</div>'
        + '<div class="bs-boss-card bs-boss-card--weekly ' + (wDefeated ? 'bs-boss-card--weekly-done' : '') + '" data-boss-class="' + escHtml(weeklyBoss.class) + '">'
        + '<span class="bs-boss-card__number"><i class="fas fa-star"></i></span>'
        + (weeklyBoss.avatar
          ? '<div class="bs-boss-avatar" style="padding:0;overflow:hidden;"><img src="' + escHtml(weeklyBoss.avatar) + '" alt="' + escHtml(weeklyBoss.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
          : '<div class="bs-boss-avatar"><i class="fas ' + wIcon + '"></i></div>')
        + '<div class="bs-boss-card__info">'
        + '<div class="bs-boss-card__name">' + escHtml(weeklyBoss.name) + ' ' + wRecordBadge + '</div>'
        + '<div class="bs-boss-card__class">' + escHtml(weeklyBoss.class) + '</div>'
        + wRewardBadge
        + '<div class="bs-boss-card__flavor">"' + escHtml(weeklyBoss.flavor) + '"</div>'
        + '</div>'
        + '<div class="bs-boss-card__action">'
        + '<button class="bs-btn bs-btn--weekly" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-boss="' + weeklyBoss.id + '">'
        + (wRewardClaimed ? '<i class="fas fa-redo"></i> Replay' : '<i class="fas fa-bolt"></i> Challenge')
        + '</button>'
        + '</div>'
        + '</div>'
        + '</div>';
    }

    container.innerHTML = weeklyHtml + campaignOnly.map(function(boss, i) {
      var bDefeated = boss.boss <= highestDefeated;
      var current = boss.boss === highestDefeated + 1;
      var locked = boss.boss > highestDefeated + 1;

      var statusClass = '';
      if (bDefeated) statusClass = 'bs-boss-card--defeated';
      else if (current) statusClass = 'bs-boss-card--current';
      else if (locked) statusClass = 'bs-boss-card--locked';

      var icon = BOSS_ICONS[boss.class] || 'fa-skull';
      var record = _cb.getBossRecord ? _cb.getBossRecord(boss.id) : { wins: 0, losses: 0 };

      var connector = i < campaignOnly.length - 1
        ? '<div class="bs-ladder-connector ' + (bDefeated ? 'bs-ladder-connector--done' : '') + '"></div>'
        : '';

      var recordBadge = (record.wins > 0 || record.losses > 0)
        ? '<span class="bs-boss-card__record">' + record.wins + 'W / ' + record.losses + 'L</span>'
        : '';

      var rewardBadge = boss.reward
        ? '<span class="bs-boss-card__reward ' + (_cb.isRewardClaimed && _cb.isRewardClaimed(boss.id) ? 'bs-boss-card__reward--claimed' : '') + '">'
          + '<i class="fas ' + (boss.reward.type === 'title' ? 'fa-crown' : boss.reward.type === 'forge_bonus' ? 'fa-fire' : 'fa-arrow-up') + '"></i> '
          + escHtml(boss.reward.label)
          + '</span>'
        : '';

      var masteryStars = _cb.renderMasteryStars ? _cb.renderMasteryStars(boss.id) : '';

      return '<div class="bs-boss-card ' + statusClass + '" data-boss-class="' + escHtml(boss.class) + '">'
        + '<span class="bs-boss-card__number">' + boss.boss + '</span>'
        + (boss.avatar ? '<div class="bs-boss-avatar" style="padding:0;overflow:hidden;"><img src="' + escHtml(boss.avatar) + '" alt="' + escHtml(boss.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>' : '<div class="bs-boss-avatar"><i class="fas ' + icon + '"></i></div>')
        + '<div class="bs-boss-card__info">'
        + '<div class="bs-boss-card__name">' + escHtml(boss.name) + ' ' + masteryStars + ' ' + recordBadge + '</div>'
        + '<div class="bs-boss-card__class">' + escHtml(boss.class) + '</div>'
        + (current ? '<span class="bs-boss-card__here"><i class="fas fa-location-dot"></i> You are here</span>' : '')
        + rewardBadge
        + (boss.weakness ? '<span class="bs-boss-weakness" style="color:' + (WEAKNESS_COLORS[boss.weakness] || 'var(--bs-accent)') + '"><i class="fas fa-crosshairs"></i> Weak to ' + (WEAKNESS_LABELS[boss.weakness] || boss.weakness) + '</span>' : '')
        + '<div class="bs-boss-card__flavor">"' + escHtml(boss.flavor) + '"</div>'
        + '</div>'
        + '<div class="bs-boss-card__action">'
        + (locked
          ? '<i class="fas fa-lock" style="color:var(--bs-text-muted);"></i>'
          : '<button class="bs-btn" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-boss="' + boss.id + '">' + (bDefeated ? '<i class="fas fa-redo"></i> Replay' : 'Fight') + '</button>')
        + '</div>'
        + '</div>'
        + connector;
    }).join('');

    // Bind fight buttons
    container.querySelectorAll('[data-fight-boss]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var bossId = btn.dataset.fightBoss;
        var boss = bossesById[bossId];
        if (!boss) return;
        if (_cb.populatePrefightOverlay) _cb.populatePrefightOverlay(boss);
        if (_cb.showOverlay) _cb.showOverlay('bs-prefight-overlay');
        if (_cb.setupPrefightButtons) _cb.setupPrefightButtons(bossId);
      });
    });

    // Render Infinite Tower section (after Ascension 5)
    renderTowerSection();
  }

  // ── Infinite Tower ──

  function renderTowerSection() {
    var section = document.getElementById('bs-tower-section');
    if (!section) return;

    if (!(_cb.isTowerUnlocked && _cb.isTowerUnlocked())) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    var currentFloor = _cb.getTowerFloor ? _cb.getTowerFloor() : 0;
    var bestFloor = _cb.getTowerBest ? _cb.getTowerBest() : 0;
    var inRun = currentFloor > 0;
    var nextFloor = inRun ? currentFloor + 1 : 1;
    var nextBoss = _cb.getTowerBossForFloor ? _cb.getTowerBossForFloor(nextFloor) : null;
    var nextBossName = nextBoss ? nextBoss.name : 'Unknown';
    var nextBossClass = nextBoss ? nextBoss.class : '';
    var nextBossIcon = BOSS_ICONS[nextBossClass] || 'fa-skull';
    var cycle = Math.floor((nextFloor - 1) / 10) + 1;

    // Upcoming milestone
    var nextMilestone = 0;
    for (var m = 5; m <= 50; m += 5) {
      if (m > (inRun ? currentFloor : 0)) { nextMilestone = m; break; }
    }
    var milestoneReward = nextMilestone && _cb.getTowerMilestoneReward ? _cb.getTowerMilestoneReward(nextMilestone) : null;

    var bestHtml = bestFloor > 0
      ? '<div class="bs-tower__best"><i class="fas fa-trophy"></i> Best: Floor ' + bestFloor + '</div>'
      : '';

    var milestoneHtml = milestoneReward
      ? '<div class="bs-tower__milestone"><i class="fas fa-gift"></i> Floor ' + nextMilestone + ': ' + escHtml(milestoneReward.label) + '</div>'
      : '';

    var floorDisplay = inRun
      ? '<div class="bs-tower__floor-display">'
        + '<span class="bs-tower__floor-num">' + currentFloor + '</span>'
        + '<span class="bs-tower__floor-label">Current Floor</span>'
        + (cycle > 1 ? '<span class="bs-tower__cycle">Cycle ' + cycle + '</span>' : '')
        + '</div>'
      : '<div class="bs-tower__floor-display">'
        + '<span class="bs-tower__floor-num"><i class="fas fa-tower-observation"></i></span>'
        + '<span class="bs-tower__floor-label">Ready to climb</span>'
        + '</div>';

    var nextBossAvatar = nextBoss && nextBoss.avatar
      ? '<img src="' + escHtml(nextBoss.avatar) + '" alt="' + escHtml(nextBossName) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
      : '<i class="fas ' + nextBossIcon + '"></i>';

    section.innerHTML = '<div class="bs-tower">'
      + '<div class="bs-tower__header">'
      + '<span class="bs-tower__title"><i class="fas fa-tower-observation"></i> Infinite Tower</span>'
      + bestHtml
      + '</div>'
      + floorDisplay
      + '<div class="bs-tower__next">'
      + '<div class="bs-tower__next-avatar">' + nextBossAvatar + '</div>'
      + '<div class="bs-tower__next-info">'
      + '<div class="bs-tower__next-label">Floor ' + nextFloor + '</div>'
      + '<div class="bs-tower__next-name">' + escHtml(nextBossName) + '</div>'
      + '<div class="bs-tower__next-class">' + escHtml(nextBossClass) + '</div>'
      + '</div>'
      + '<button class="bs-btn bs-btn--primary bs-btn--glow bs-tower__enter" id="bs-tower-enter">'
      + '<i class="fas fa-bolt"></i> ' + (inRun ? 'Continue' : 'Enter')
      + '</button>'
      + '</div>'
      + milestoneHtml
      + '<p class="bs-tower__desc">Climb as high as you can. Lose once and you fall back to Floor 1.</p>'
      + '</div>';

    document.getElementById('bs-tower-enter').addEventListener('click', function() {
      if (_cb.startTowerBattle) _cb.startTowerBattle();
    }, { once: true });
  }

  // ── Public API ──

  window.BsCampaign = {
    renderLadder: renderCampaignLadder,
    renderTower: renderTowerSection,
    setCallbacks: setCallbacks
  };
})();
