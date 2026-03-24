/**
 * bs-boss-rewards.js — Boss reward application + claimed rewards + visual unlocks
 * window.BsBossRewards
 */
(function() {
  'use strict';

  var _cb = {};

  // --- Claimed rewards (prevent double-claiming) ---
  function getProgress() { return _cb.getProgress ? _cb.getProgress() : { claimedRewards: [], visualUnlocks: [] }; }

  function getClaimedRewards() { return getProgress().claimedRewards; }
  function claimReward(bossId) {
    var p = getProgress();
    if (!p.claimedRewards.includes(bossId)) p.claimedRewards.push(bossId);
  }
  function isRewardClaimed(bossId) {
    return getProgress().claimedRewards.includes(bossId);
  }

  // --- Visual unlocks ---
  function getUnlockedVisuals() { return getProgress().visualUnlocks; }
  function unlockVisual(key) {
    var p = getProgress();
    if (!p.visualUnlocks.includes(key)) p.visualUnlocks.push(key);
  }
  function hasVisualUnlock(key) {
    return getProgress().visualUnlocks.includes(key);
  }

  // --- Apply boss reward to card ---
  function applyBossReward(boss) {
    var weekly = _cb.isWeeklyBoss ? _cb.isWeeklyBoss(boss.id) : false;
    if (weekly) {
      if (!boss.reward || (_cb.isWeeklyRewardClaimed && _cb.isWeeklyRewardClaimed())) return Promise.resolve(null);
    } else {
      if (!boss.reward || isRewardClaimed(boss.id)) return Promise.resolve(null);
    }

    var reward = boss.reward;
    var selectedCard = _cb.getSelectedCard ? _cb.getSelectedCard() : null;

    if (reward.type === 'stat_bonus' && selectedCard && selectedCard.combatStats) {
      selectedCard.combatStats[reward.stat] = Math.min(100,
        (selectedCard.combatStats[reward.stat] || 0) + reward.amount
      );

      var cardToSave = {};
      for (var k in selectedCard) {
        if (selectedCard.hasOwnProperty(k)) cardToSave[k] = selectedCard[k];
      }
      cardToSave.stats = [
        { name: 'Strength', value: cardToSave.combatStats.str },
        { name: 'Agility', value: cardToSave.combatStats.agi },
        { name: 'Intelligence', value: cardToSave.combatStats.int },
        { name: 'Endurance', value: cardToSave.combatStats.end },
        { name: 'Luck', value: cardToSave.combatStats.lck }
      ];

      var url = window.buildApiPath('saveCard');
      var headers = { 'Content-Type': 'application/json' };

      return window.ArenaAPI.getPrincipalHeader().then(function(authHeaders) {
        for (var h in authHeaders) {
          if (authHeaders.hasOwnProperty(h)) headers[h] = authHeaders[h];
        }
        var csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfMeta && csrfMeta.content) headers['X-CSRF-Token'] = csrfMeta.content;
        return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(cardToSave) });
      }).then(function(resp) {
        if (!resp.ok) throw new Error('Save failed');
        if (weekly) { if (_cb.claimWeeklyReward) _cb.claimWeeklyReward(); } else { claimReward(boss.id); }
        return reward;
      }).catch(function(e) {
        selectedCard.combatStats[reward.stat] = Math.min(100,
          (selectedCard.combatStats[reward.stat] || 0) - reward.amount
        );
        console.warn('[Blindspot] Reward save failed, reverted:', e);
        return null;
      });
    }

    if (reward.type === 'title') {
      if (_cb.setCardTitle) _cb.setCardTitle(reward.title);
      if (weekly) { if (_cb.claimWeeklyReward) _cb.claimWeeklyReward(); } else { claimReward(boss.id); }
    }

    if (reward.type === 'visual') {
      unlockVisual(reward.unlock);
      if (weekly) { if (_cb.claimWeeklyReward) _cb.claimWeeklyReward(); } else { claimReward(boss.id); }
    }

    if (reward.type === 'forge_bonus') {
      var config = _cb.getConfig ? _cb.getConfig() : null;
      var forgeWins = _cb.getForgeWins ? _cb.getForgeWins() : 0;
      var bonusPts = (config && config.forgeVisit && config.forgeVisit.bonusPoints) ? config.forgeVisit.bonusPoints : 25;
      if (_cb.setForgeWins) _cb.setForgeWins(forgeWins + Math.floor(reward.amount / bonusPts));
    }

    return Promise.resolve(reward);
  }

  window.BsBossRewards = {
    getClaimedRewards: getClaimedRewards,
    claimReward: claimReward,
    isRewardClaimed: isRewardClaimed,
    getUnlockedVisuals: getUnlockedVisuals,
    unlockVisual: unlockVisual,
    hasVisualUnlock: hasVisualUnlock,
    applyBossReward: applyBossReward,
    setCallbacks: function(cbs) { _cb = cbs || {}; }
  };
})();
