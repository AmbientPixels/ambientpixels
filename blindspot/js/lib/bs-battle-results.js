/**
 * bs-battle-results.js — Battle results: victory animation, XP/sparks/Elo,
 * boss-first-kill rewards, forge trigger, loot choice trigger.
 * Extracted from blindspot-flow.js (Round 6)
 *
 * API: window.BsBattleResults
 *   .setCallbacks(cb)
 *   .handleResult(battleResult, battleData)
 *   .playVictoryAnimation()
 */
(function () {
  'use strict';

  var _cb = {};

  function setCallbacks(cb) { _cb = cb || {}; }

  // ── Callback helpers ──

  function playSfx(n) { if (_cb.playSfx) _cb.playSfx(n); }
  function addSparks(n) { if (_cb.addSparks) _cb.addSparks(n); }
  function showSuccessToast(m) { if (_cb.showSuccessToast) _cb.showSuccessToast(m); }
  function showOverlay(id) { if (_cb.showOverlay) _cb.showOverlay(id); }
  function safeLSSet(k, v) { if (_cb.safeLSSet) _cb.safeLSSet(k, v); }
  function syncProgressToServer() { if (_cb.syncProgressToServer) _cb.syncProgressToServer(); }
  function getCardPower(c) { return _cb.getCardPower ? _cb.getCardPower(c) : 0; }

  // State accessors
  function getBattleType() { return _cb.getBattleType ? _cb.getBattleType() : 'pve'; }
  function getCurrentBossId() { return _cb.getCurrentBossId ? _cb.getCurrentBossId() : null; }
  function getBossesById() { return _cb.getBossesById ? _cb.getBossesById() : {}; }
  function getSelectedCard() { return _cb.getSelectedCard ? _cb.getSelectedCard() : null; }
  function getProfile() { return _cb.getProfile ? _cb.getProfile() : null; }
  function getConfig() { return _cb.getConfig ? _cb.getConfig() : null; }
  function getPvpOpponentId() { return _cb.getPvpOpponentId ? _cb.getPvpOpponentId() : null; }
  function getPVP_RANKS() { return _cb.getPVP_RANKS ? _cb.getPVP_RANKS() : []; }
  function getELO_DEFAULT() { return _cb.getELO_DEFAULT ? _cb.getELO_DEFAULT() : 1000; }

  // Pending forge state (read/write via callbacks)
  function setPendingForge(v) { if (_cb.setPendingForge) _cb.setPendingForge(v); }
  function setLastStreakBonus(v) { if (_cb.setLastStreakBonus) _cb.setLastStreakBonus(v); }
  function setLastStreakMsg(v) { if (_cb.setLastStreakMsg) _cb.setLastStreakMsg(v); }
  function getLastStreakBonus() { return _cb.getLastStreakBonus ? _cb.getLastStreakBonus() : 0; }
  function getLastStreakMsg() { return _cb.getLastStreakMsg ? _cb.getLastStreakMsg() : ''; }

  // Progression
  function checkDailyBonus() { if (_cb.checkDailyBonus) _cb.checkDailyBonus(); }
  function recordBossResult(id, w) { if (_cb.recordBossResult) _cb.recordBossResult(id, w); }
  function getWeeklyBoss() { return _cb.getWeeklyBoss ? _cb.getWeeklyBoss() : null; }
  function recordWeeklyResult(w) { if (_cb.recordWeeklyResult) _cb.recordWeeklyResult(w); }
  function checkMasteryRewards(id) { if (_cb.checkMasteryRewards) _cb.checkMasteryRewards(id); }
  function getHighestBossDefeated() { return _cb.getHighestBossDefeated ? _cb.getHighestBossDefeated() : 0; }
  function setHighestBossDefeated(n) { if (_cb.setHighestBossDefeated) _cb.setHighestBossDefeated(n); }
  function getForgeWins() { return _cb.getForgeWins ? _cb.getForgeWins() : 0; }
  function setForgeWins(n) { if (_cb.setForgeWins) _cb.setForgeWins(n); }
  function getWinStreak() { return _cb.getWinStreak ? _cb.getWinStreak() : 0; }
  function setWinStreak(n) { if (_cb.setWinStreak) _cb.setWinStreak(n); }
  function setBestStreak(n) { if (_cb.setBestStreak) _cb.setBestStreak(n); }
  function incrementTotalWins() { if (_cb.incrementTotalWins) _cb.incrementTotalWins(); }
  function setCardTitle(t) { if (_cb.setCardTitle) _cb.setCardTitle(t); }
  function getAscension() { return _cb.getAscension ? _cb.getAscension() : 0; }
  function isWeeklyBoss(id) { return _cb.isWeeklyBoss ? _cb.isWeeklyBoss(id) : false; }
  function isWeeklyRewardClaimed() { return _cb.isWeeklyRewardClaimed ? _cb.isWeeklyRewardClaimed() : false; }
  function isForgeUnlocked() { return _cb.isForgeUnlocked ? _cb.isForgeUnlocked() : false; }
  function setForgeUnlocked() { if (_cb.setForgeUnlocked) _cb.setForgeUnlocked(); }

  // Actions
  function applyBossReward(boss) { return _cb.applyBossReward ? _cb.applyBossReward(boss) : Promise.resolve(null); }
  function showRewardDrop(r, s) { if (_cb.showRewardDrop) _cb.showRewardDrop(r, s); }
  function awardCrate(t) { if (_cb.awardCrate) _cb.awardCrate(t); }
  function showBossDialogue(id, p) { if (_cb.showBossDialogue) _cb.showBossDialogue(id, p); }
  function showAscensionOffer(a) { if (_cb.showAscensionOffer) _cb.showAscensionOffer(a); }
  function showForgeProgressInResults() { if (_cb.showForgeProgressInResults) _cb.showForgeProgressInResults(); }
  function rollLoot() { return _cb.rollLoot ? _cb.rollLoot() : { stat: 'str', amount: 1, label: '+1 STR', rarity: 'common' }; }
  function showLootChoice(opts) { if (_cb.showLootChoice) _cb.showLootChoice(opts); }
  function completeBounty(t) { if (_cb.completeBounty) _cb.completeBounty(t); }
  function getDailyBounties() { return _cb.getDailyBounties ? _cb.getDailyBounties() : { bounties: [], fights: 0 }; }
  function checkBattleCrate() { if (_cb.checkBattleCrate) _cb.checkBattleCrate(); }
  function handleTowerResult(w) { if (_cb.handleTowerResult) _cb.handleTowerResult(w); }
  function getTowerFloor() { return _cb.getTowerFloor ? _cb.getTowerFloor() : 0; }
  function getTowerBest() { return _cb.getTowerBest ? _cb.getTowerBest() : 0; }
  function getLossTip() { return _cb.getLossTip ? _cb.getLossTip() : 'Your card remembers.'; }
  function renderSessionStats() { if (_cb.renderSessionStats) _cb.renderSessionStats(); }
  function loadProfile() { return _cb.loadProfile ? _cb.loadProfile() : Promise.resolve(); }
  function updateRankDisplay() { if (_cb.updateRankDisplay) _cb.updateRankDisplay(); }

  // PvP
  function pvpGalleryGet() { return _cb.pvpGalleryGet ? _cb.pvpGalleryGet() : []; }
  function estimateOpponentElo(c) { return _cb.estimateOpponentElo ? _cb.estimateOpponentElo(c) : 1000; }
  function getPvPElo() { return _cb.getPvPElo ? _cb.getPvPElo() : 1000; }
  function setPvPElo(v) { if (_cb.setPvPElo) _cb.setPvPElo(v); }
  function getPvPRecord() { return _cb.getPvPRecord ? _cb.getPvPRecord() : { w: 0, l: 0 }; }
  function setPvPRecord(r) { if (_cb.setPvPRecord) _cb.setPvPRecord(r); }
  function getPvPRank(elo) { return _cb.getPvPRank ? _cb.getPvPRank(elo) : { name: 'Iron', color: '#888', icon: 'fa-shield', min: 0 }; }
  function showEloChange(t, c, r) { if (_cb.showEloChange) _cb.showEloChange(t, c, r); }
  function calcEloChange(p, o, w) { return _cb.calcEloChange ? _cb.calcEloChange(p, o, w) : 0; }

  // Cosmetics (for victory animation)
  function getEquipped() { return _cb.getEquipped ? _cb.getEquipped() : {}; }
  function findCosmeticDef(id) { return _cb.findCosmeticDef ? _cb.findCosmeticDef(id) : null; }

  // ── Victory animation ──

  function playVictoryAnimation() {
    var equipped = getEquipped();
    if (!equipped.victory) return;
    var def = findCosmeticDef(equipped.victory);
    if (!def) return;

    var fx = document.createElement('div');
    fx.className = 'bs-victory-fx';

    if (def.id === 'victory_confetti') {
      fx.classList.add('bs-victory-fx--confetti');
      var colors = ['#EF9F27', '#ff5252', '#4ade80', '#7dd3fc', '#a855f7', '#f472b6'];
      for (var i = 0; i < 40; i++) {
        var p = document.createElement('div');
        p.className = 'bs-vfx-particle';
        p.style.left = (Math.random() * 100) + '%';
        p.style.top = '-10px';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.animationDelay = (Math.random() * 1) + 's';
        p.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
        p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
        fx.appendChild(p);
      }
    } else if (def.id === 'victory_lightning') {
      fx.classList.add('bs-victory-fx--lightning');
      for (var b = 0; b < 5; b++) {
        var bolt = document.createElement('div');
        bolt.className = 'bs-vfx-bolt';
        bolt.style.left = (10 + Math.random() * 80) + '%';
        bolt.style.top = '0';
        bolt.style.animationDelay = (Math.random() * 1.2) + 's';
        bolt.style.height = (100 + Math.random() * 200) + 'px';
        fx.appendChild(bolt);
      }
    } else if (def.id === 'victory_fireworks') {
      fx.classList.add('bs-victory-fx--fireworks');
      var fwColors = ['#EF9F27', '#ff5252', '#4ade80', '#7dd3fc', '#a855f7', '#ffdd00'];
      for (var fw = 0; fw < 6; fw++) {
        var burst = document.createElement('div');
        burst.className = 'bs-vfx-firework';
        burst.style.left = (15 + Math.random() * 70) + '%';
        burst.style.top = (15 + Math.random() * 50) + '%';
        burst.style.animationDelay = (fw * 0.4 + Math.random() * 0.3) + 's';
        burst.style.setProperty('--fw-color', fwColors[fw % fwColors.length]);
        fx.appendChild(burst);
      }
    } else if (def.id === 'victory_shockwave') {
      fx.classList.add('bs-victory-fx--shockwave');
      for (var sw = 0; sw < 3; sw++) {
        var ring = document.createElement('div');
        ring.className = 'bs-vfx-ring';
        ring.style.animationDelay = (sw * 0.5) + 's';
        fx.appendChild(ring);
      }
    } else if (def.id === 'victory_ravens') {
      fx.classList.add('bs-victory-fx--ravens');
      for (var r = 0; r < 8; r++) {
        var raven = document.createElement('div');
        raven.className = 'bs-vfx-raven';
        raven.innerHTML = '<i class="fas fa-crow"></i>';
        raven.style.left = (30 + Math.random() * 40) + '%';
        raven.style.bottom = (10 + Math.random() * 30) + '%';
        raven.style.setProperty('--raven-dx', ((Math.random() - 0.5) * 400) + 'px');
        raven.style.setProperty('--raven-dy', (-200 - Math.random() * 300) + 'px');
        raven.style.animationDelay = (Math.random() * 1) + 's';
        fx.appendChild(raven);
      }
    }

    document.body.appendChild(fx);
    setTimeout(function() { fx.remove(); }, 4000);
  }

  // ── Main battle result handler ──

  async function handleResult(battleResult, battleData) {
    var _battleType = getBattleType();
    var _currentBossId = getCurrentBossId();
    var _bossesById = getBossesById();
    var _selectedCard = getSelectedCard();
    var _profile = getProfile();
    var _config = getConfig();
    var PVP_RANKS = getPVP_RANKS();
    var ELO_DEFAULT = getELO_DEFAULT();

    var isWin = battleResult.winner === 'player';
    playSfx(isWin ? 'battleWin' : 'battleLoss');
    if (isWin) playVictoryAnimation();
    // Daily spark bonus (first fight of the day)
    checkDailyBonus();

    // Track boss record
    if (_battleType === 'pve' && _currentBossId) {
      recordBossResult(_currentBossId, isWin);
      // Track weekly boss separately
      var weeklyBoss = getWeeklyBoss();
      if (weeklyBoss && _currentBossId === weeklyBoss.id) {
        recordWeeklyResult(isWin);
      }
      // Check mastery tier-ups on wins
      if (isWin) checkMasteryRewards(_currentBossId);
    }

    // Spark rewards — earn currency from all activities
    var sparkReward = 0;
    if (isWin) {
      sparkReward = 10; // Base win reward
      if (_battleType === 'pve' && _currentBossId) {
        var fightBoss = _bossesById[_currentBossId];
        var isFirstKill = fightBoss && fightBoss.boss === getHighestBossDefeated();
        if (isFirstKill) sparkReward = 25; // First kill bonus
        if (fightBoss && fightBoss.boss >= 8) sparkReward += 10; // Late-game bonus
      }
      if (_battleType === 'pvp') sparkReward = 15; // PvP wins are worth more
      addSparks(sparkReward);
    } else {
      addSparks(3); // Small consolation for losing
    }

    // PvP wins grant forge progress
    if (_battleType === 'pvp' && isWin) {
      setForgeWins(getForgeWins() + 0.5);
    }

    // PvP Elo update
    if (_battleType === 'pvp') {
      var _pvpOpponentId = getPvpOpponentId();
      var opponent = pvpGalleryGet().find(function(c) { return c.id === _pvpOpponentId; });
      var oppElo = opponent ? estimateOpponentElo(opponent) : ELO_DEFAULT;
      var playerElo = getPvPElo();
      var oldRank = getPvPRank(playerElo);
      var eloChange = calcEloChange(playerElo, oppElo, isWin);
      var newElo = Math.max(0, playerElo + eloChange);
      setPvPElo(newElo);
      var rec = getPvPRecord();
      if (isWin) rec.w++; else rec.l++;
      setPvPRecord(rec);
      syncProgressToServer();
      var newRank = getPvPRank(newElo);
      // Show Elo change toast
      var sign = eloChange >= 0 ? '+' : '';
      var eloColor = eloChange >= 0 ? 'var(--bs-accent)' : 'var(--bs-danger, #ff5252)';
      showEloChange(sign + eloChange, eloColor, oldRank.name !== newRank.name ? newRank : null);

      // Update results modal with Elo info
      var xpSection = document.getElementById('arena-results-xp-section');
      if (xpSection) {
        var xpAmtEl = document.getElementById('arena-results-xp');
        if (xpAmtEl) xpAmtEl.innerHTML = '<span style="color:' + eloColor + ';">' + sign + eloChange + ' Elo</span>';
        var rankLabel = document.getElementById('arena-results-rank-label');
        if (rankLabel) {
          rankLabel.innerHTML =
            '<span style="color:' + oldRank.color + ';"><i class="fas ' + oldRank.icon + '"></i> ' + oldRank.name + '</span>' +
            ' <i class="fas fa-arrow-right" style="color:var(--bs-text-muted);margin:0 0.3rem;"></i> ' +
            '<span style="color:' + newRank.color + ';"><i class="fas ' + newRank.icon + '"></i> ' + newRank.name + ' (' + newElo + ')</span>';
        }
        // Show progress to next PvP rank instead of XP bar
        var barFill = document.getElementById('arena-results-xp-fill');
        var barText = document.getElementById('arena-results-xp-text');
        var pvpNextRank = PVP_RANKS[PVP_RANKS.indexOf(newRank) + 1];
        if (barFill && barText && pvpNextRank) {
          var pvpPct = Math.min(100, Math.max(0, ((newElo - newRank.min) / (pvpNextRank.min - newRank.min)) * 100));
          barFill.style.width = pvpPct + '%';
          barFill.style.background = newRank.color;
          barText.textContent = newElo + ' / ' + pvpNextRank.min + ' Elo';
        } else if (barFill && barText) {
          barFill.style.width = '100%';
          barFill.style.background = newRank.color;
          barText.textContent = newElo + ' Elo — Max Rank!';
        }
        // Rank up notification
        var rankUpEl = document.getElementById('arena-results-rank-up');
        var newRankEl = document.getElementById('arena-results-new-rank');
        if (oldRank.name !== newRank.name && eloChange > 0) {
          if (rankUpEl) rankUpEl.style.display = 'block';
          if (newRankEl) newRankEl.textContent = newRank.name;
        }
      }
    }

    loadProfile().then(function() { updateRankDisplay(); });

    // Win streak tracking
    if (isWin) {
      incrementTotalWins();
      var newStreak = getWinStreak() + 1;
      setWinStreak(newStreak);
      setBestStreak(newStreak);

      // Streak rewards — milestone bonuses
      var streakBonus = 0;
      var streakMsg = '';
      if (newStreak >= 3 && newStreak < 5) {
        streakBonus = Math.round(sparkReward * 0.1); // +10% sparks
        streakMsg = '+' + streakBonus + ' streak sparks';
      } else if (newStreak >= 5 && newStreak < 10) {
        streakBonus = Math.round(sparkReward * 0.2); // +20% sparks
        streakMsg = '+' + streakBonus + ' streak sparks';
      } else if (newStreak >= 10 && newStreak < 15) {
        streakBonus = Math.round(sparkReward * 0.3); // +30% sparks
        streakMsg = '+' + streakBonus + ' streak sparks';
      } else if (newStreak >= 15) {
        streakBonus = Math.round(sparkReward * 0.5); // +50% sparks
        streakMsg = '+' + streakBonus + ' streak sparks';
      }
      if (streakBonus > 0) addSparks(streakBonus);

      // Milestone rewards at exact thresholds
      if (newStreak === 5) {
        setForgeWins(getForgeWins() + 1);
        showSuccessToast('5-streak! +1 Forge Win');
      } else if (newStreak === 10) {
        addSparks(50);
        showSuccessToast('10-streak! +50 Sparks');
      } else if (newStreak === 15) {
        setCardTitle('The Relentless');
        addSparks(100);
        showSuccessToast('15-streak! Title: "The Relentless" + 100 Sparks');
      }

      // Store streak bonus for results display
      setLastStreakBonus(streakBonus);
      setLastStreakMsg(streakMsg);

      // Loot choice — pick 1 of 3 rewards
      var lootOptions = [rollLoot(), rollLoot(), rollLoot()];
      var usedStats = {};
      lootOptions.forEach(function(l, i) {
        if (l.stat && usedStats[l.stat]) {
          var available = ['str','agi','int','end','lck'].filter(function(s) { return !usedStats[s]; });
          if (available.length > 0) {
            var newStat = available[Math.floor(Math.random() * available.length)];
            lootOptions[i] = { stat: newStat, amount: l.amount, label: '+' + l.amount + ' ' + newStat.toUpperCase(), rarity: l.rarity, icon: l.icon };
          }
        }
        if (l.stat) usedStats[l.stat] = true;
      });
      showLootChoice(lootOptions);

      // Bounty checks
      if (getWinStreak() >= 3) completeBounty('streak3');
      // Track wins for win2 bounty
      var bountyData = getDailyBounties();
      bountyData.wins = (bountyData.wins || 0) + 1;
      if (bountyData.wins >= 2) completeBounty('win2');
      // Battle crate: every 5 wins
      checkBattleCrate();
    } else {
      setWinStreak(0);
      setLastStreakBonus(0);
      setLastStreakMsg('');
    }

    // Track fight for daily bounty
    completeBounty('play3');

    // Infinite Tower results
    if (_battleType === 'tower') {
      handleTowerResult(isWin);
      // Override button labels for tower
      var tAgainBtn = document.getElementById('arena-results-again');
      var tLobbyBtn = document.getElementById('arena-results-lobby');
      if (isWin) {
        if (tAgainBtn) tAgainBtn.textContent = 'Next Floor';
        if (tLobbyBtn) tLobbyBtn.textContent = 'Exit Tower';
      } else {
        if (tAgainBtn) tAgainBtn.textContent = 'Try Again';
        if (tLobbyBtn) tLobbyBtn.textContent = 'Exit Tower';
      }
      var tTitleEl = document.getElementById('arena-results-title');
      var tSubEl = document.getElementById('arena-results-subtitle');
      if (isWin) {
        var clearedFloor = getTowerFloor();
        if (tTitleEl) tTitleEl.textContent = 'Floor ' + clearedFloor + ' Cleared';
        if (tSubEl) tSubEl.textContent = 'The tower stretches higher...';
      } else {
        if (tTitleEl) tTitleEl.textContent = 'Tower Run Over';
        if (tSubEl) tSubEl.textContent = 'You reached Floor ' + getTowerBest() + ' at your best.';
      }
      showForgeProgressInResults();
      return;
    }

    if (_battleType === 'pve' && isWin) {
      var boss = _bossesById[_currentBossId];
      var prevHighest = getHighestBossDefeated();
      var isWeekly = isWeeklyBoss(_currentBossId);
      var isNewBossDefeat = !isWeekly && boss && boss.boss > prevHighest;

      if (boss && !isWeekly) setHighestBossDefeated(boss.boss);

      // Forge progression: any win grants progress, new bosses give more
      if (isNewBossDefeat) {
        var forgeGain = 1;
        if (getWinStreak() >= 5) forgeGain = 2; // Streak bonus
        setForgeWins(getForgeWins() + forgeGain);
        // Boss crate on first kill
        awardCrate('boss');
      } else if (!isWeekly) {
        // Replay wins grant half a forge point (tracked as decimals, rounded on display)
        setForgeWins(getForgeWins() + 0.5);
      }

      // Weekly boss: award stat reward + 2 forge wins + weekly crate on first weekly win
      if (isWeekly && !isWeeklyRewardClaimed()) {
        playSfx('bossDefeat');
        setForgeWins(getForgeWins() + 2);
        awardCrate('weekly');
        var weeklyReward = await applyBossReward(boss);
        if (weeklyReward) {
          showRewardDrop(weeklyReward, boss);
        }
      }

      // Play boss defeat fanfare on new boss kills
      if (isNewBossDefeat) playSfx('bossDefeat');
      // Boss defeat dialogue
      if (_currentBossId) showBossDialogue(_currentBossId, 'loss');

      // Apply boss reward (stat bonus, title, etc.)
      if (isNewBossDefeat && boss) {
        var bossReward = await applyBossReward(boss);
        if (bossReward) {
          showRewardDrop(bossReward, boss);
        }
        completeBounty('newBoss');
      }

      // Sync progression to server after boss fight
      syncProgressToServer();

      // Boss 10 — The Architect
      if (boss && boss.boss === 10 && isNewBossDefeat) {
        setTimeout(function() {
          document.getElementById('arena-results-overlay').style.display = 'none';
          var asc = getAscension();
          if (asc > 0) {
            // Already ascended before — offer ascension again
            showAscensionOffer(asc);
          } else {
            showOverlay('bs-architect-win');
          }
        }, 2000);
        return;
      }

      // Show Blindspot rank-up message instead of CardForge's
      if (battleResult.rankUp) {
        var resRankUpEl = document.getElementById('arena-results-rank-up');
        var resNewRankEl = document.getElementById('arena-results-new-rank');
        if (resRankUpEl) resRankUpEl.style.display = 'block';
        if (resNewRankEl) resNewRankEl.textContent = battleResult.newRank;
      }

      // Forge unlock at Silver rank-up
      if (battleResult.rankUp && _profile && _profile.rank === 'silver') {
        if (!localStorage.getItem('bs-forge-unlock-shown')) {
          safeLSSet('bs-forge-unlock-shown', 'true');
          setTimeout(function() {
            document.getElementById('arena-results-overlay').style.display = 'none';
            showOverlay('bs-forge-unlock');
          }, 2000);
          return;
        }
      }

      // Forge visit trigger — only prompt on the FIRST unlock, not every time
      if (!isForgeUnlocked()) {
        var needed = _config ? _config.forgeVisit.winsRequired : 3;
        if (getForgeWins() >= needed) {
          setForgeUnlocked();
          setPendingForge(true); // Flag checked after loot is picked
        }
      }
    }

    showForgeProgressInResults();

    // Override CardForge button labels with Blindspot copy
    var againBtn = document.getElementById('arena-results-again');
    var lobbyBtn = document.getElementById('arena-results-lobby');
    if (againBtn) againBtn.innerHTML = isWin ? 'Next Fight' : '<i class="fas fa-redo"></i> Rematch';
    if (lobbyBtn) lobbyBtn.textContent = 'Lobby';

    // Override results with Blindspot flavor
    var titleEl = document.getElementById('arena-results-title');
    var subtitleEl = document.getElementById('arena-results-subtitle');
    if (isWin) {
      var resBoss = _bossesById[_currentBossId];
      var streak = getWinStreak();
      if (titleEl) titleEl.textContent = streak >= 3 ? streak + 'x Victory!' : 'Victory';
      if (subtitleEl && resBoss) subtitleEl.textContent = 'You defeated ' + resBoss.name;
      // Show power after win (remove previous to prevent stacking)
      var power = getCardPower(_selectedCard);
      var prevPower = document.querySelector('.bs-results-power');
      if (prevPower) prevPower.remove();
      var prevStreak = document.querySelector('.bs-results-streak-bonus');
      if (prevStreak) prevStreak.remove();
      if (power > 0) {
        var powerEl = document.createElement('div');
        powerEl.className = 'bs-results-power';
        powerEl.innerHTML = '<i class="fas fa-bolt"></i> ' + power + ' Power';
        if (subtitleEl) subtitleEl.after(powerEl);
      }
      // Show streak bonus in results
      var lastBonus = getLastStreakBonus();
      var lastMsg = getLastStreakMsg();
      if (lastBonus > 0) {
        var streakEl = document.createElement('div');
        streakEl.className = 'bs-results-streak-bonus';
        streakEl.innerHTML = '<i class="fas fa-fire"></i> ' + lastMsg;
        var afterEl = document.querySelector('.bs-results-power') || subtitleEl;
        if (afterEl) afterEl.after(streakEl);
      }
    } else {
      if (titleEl) titleEl.textContent = 'Defeated';
      if (subtitleEl) {
        // "Almost" moment — check if boss had <10% HP
        var almostMsg = '';
        if (battleResult && battleResult.opponentHp !== undefined && battleResult.opponentMaxHp) {
          var bossHpPct = battleResult.opponentHp / battleResult.opponentMaxHp;
          if (bossHpPct < 0.1 && bossHpPct > 0) {
            var bossName = _bossesById[_currentBossId];
            almostMsg = 'So close! ' + (bossName ? bossName.name : 'The boss') + ' survived with ' + battleResult.opponentHp + ' HP. ';
          }
        }
        var tip = getLossTip();
        subtitleEl.textContent = almostMsg + tip;
      }
    }

    // Session stats panel
    renderSessionStats();
  }

  window.BsBattleResults = {
    setCallbacks: setCallbacks,
    handleResult: handleResult,
    playVictoryAnimation: playVictoryAnimation
  };
})();
