/**
 * bs-ascension.js — Ascension offer overlay + perform ascension
 * Extracted from blindspot-flow.js (Round 7)
 *
 * API: window.BsAscension
 *   .showOffer(currentAscension)  — render ascension overlay
 *   .setCallbacks(cbs)            — inject cross-cutting deps
 */
(function () {
  'use strict';

  var _cb = {};

  var ASCENSION_REWARDS = {
    1: 'Inferno Palette',
    2: 'Frost Palette',
    3: 'Arcane Palette',
    4: 'Void Palette',
    5: 'Holographic Border + Infinite Tower'
  };

  var REWARD_VISUAL_MAP = {
    1: 'palette_inferno',
    2: 'palette_frost',
    3: 'palette_arcane',
    4: 'palette_void',
    5: 'border_holographic'
  };

  function getAscensionReward(level) {
    return ASCENSION_REWARDS[level] || 'Prestige Star ' + level;
  }

  function showOffer(currentAscension) {
    var nextAsc = currentAscension + 1;
    var overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.id = 'bs-ascension-offer';

    // Build star HTML
    var stars = '';
    for (var s = 0; s < currentAscension; s++) {
      stars += '<i class="fas fa-star bs-ascension-star"></i>';
    }
    stars += '<i class="fas fa-star bs-ascension-star" style="color:var(--bs-text-muted);opacity:0.3;"></i>';

    overlay.innerHTML =
      '<div class="bs-ascension-overlay">' +
        '<p class="bs-overlay__title">Campaign Complete \u2014 Again.</p>' +
        '<div class="bs-ascension-stars">' + stars + '</div>' +
        '<p class="bs-overlay__subtitle">Ascend to level ' + nextAsc + '? Bosses grow stronger. Your legend grows.</p>' +
        '<p style="font-size:0.75rem; color:var(--bs-text-muted); max-width:300px; margin:0 auto;">' +
          'Bosses gain +' + (nextAsc * 20) + '% stats. You keep your card, rank, and visual unlocks. ' +
          'New palette unlocked: <strong style="color:var(--bs-accent);">' + getAscensionReward(nextAsc) + '</strong>' +
        '</p>' +
        '<div style="display:flex; gap:0.75rem; margin-top:1.5rem; justify-content:center; flex-wrap:wrap;">' +
          '<button class="bs-btn bs-btn--primary bs-btn--glow" id="bs-ascend-btn">' +
            '<i class="fas fa-arrow-up"></i> Ascend' +
          '</button>' +
          '<button class="bs-btn bs-btn--secondary" id="bs-ascend-skip">Stay at Ascension ' + currentAscension + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('bs-ascend-btn').addEventListener('click', function () {
      performAscension(nextAsc);
      overlay.remove();
    }, { once: true });

    document.getElementById('bs-ascend-skip').addEventListener('click', function () {
      overlay.remove();
      if (_cb.showScreen) _cb.showScreen('lobby');
      if (_cb.renderLobby) _cb.renderLobby();
    }, { once: true });
  }

  function performAscension(newLevel) {
    if (_cb.playSfx) _cb.playSfx('ascension');
    if (_cb.setAscension) _cb.setAscension(newLevel);
    if (_cb.awardCrate) _cb.awardCrate('ascension');

    // Reset boss progress but keep stats/visuals/rank
    var progress = _cb.getProgress ? _cb.getProgress() : {};
    progress.highestBoss = 0;
    progress.bossRecords = {};
    progress.masteryClaimed = {};

    // Unlock ascension visual reward
    if (REWARD_VISUAL_MAP[newLevel] && _cb.unlockVisual) {
      _cb.unlockVisual(REWARD_VISUAL_MAP[newLevel]);
    }

    // Reset forge progress
    if (_cb.setForgeWins) _cb.setForgeWins(0);
    localStorage.removeItem('bs-forge-pending');

    // Clear adventure skip flags for ascension replay with new text
    for (var ak = 1; ak <= 10; ak++) {
      try { localStorage.removeItem('bs-adventure-skip-bs-boss-' + ak); } catch (e) {}
    }

    if (_cb.showSuccessToast) _cb.showSuccessToast('Ascended to level ' + newLevel + '! Bosses are now stronger.');
    if (_cb.syncProgressToServer) _cb.syncProgressToServer();
    if (_cb.showScreen) _cb.showScreen('lobby');
    if (_cb.renderLobby) _cb.renderLobby();
  }

  function setCallbacks(cbs) { _cb = cbs; }

  window.BsAscension = {
    showOffer: showOffer,
    getReward: getAscensionReward,
    setCallbacks: setCallbacks
  };
})();
