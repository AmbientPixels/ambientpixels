/**
 * bs-nav.js — Play page navigation wiring (bottom nav, back buttons, results buttons)
 *
 * IIFE on window.BsNav.
 * showScreen/showOverlay/hideOverlay stay in monolith (36+ call sites).
 * This module owns bindPlayNavigation() — the one-time event binding.
 */
(function () {
  'use strict';

  var _navBound = false;

  // Callbacks injected by monolith
  var _cb = {};

  function bindPlayNavigation() {
    if (_navBound) return;
    _navBound = true;

    // Crate indicator — click to open
    document.getElementById('bs-crate-indicator')?.addEventListener('click', function() {
      if (_cb.getCrateCount() > 0) _cb.openCrateOverlay(0);
    });

    // Primary PLAY button + Campaign button both open campaign
    const openCampaign = () => { _cb.showScreen('campaign'); _cb.renderCampaignLadder(); };
    // Smart ENTER ARENA: go straight to next boss fight
    const enterArena = () => {
      const highest = _cb.getHighestBossDefeated();
      const nextBoss = _cb.getBossByNumber(highest + 1);
      if (nextBoss) {
        // Show pre-fight overlay for next boss
        _cb.populatePrefightOverlay(nextBoss);
        _cb.showOverlay('bs-prefight-overlay');
        _cb.setupPrefightButtons(nextBoss.id);
      } else {
        // All bosses defeated — go to campaign to replay or ascend
        _cb.showScreen('campaign');
        _cb.renderCampaignLadder();
      }
    };
    document.getElementById('bs-play-btn')?.addEventListener('click', enterArena);
    document.getElementById('bs-btn-campaign')?.addEventListener('click', openCampaign);

    document.getElementById('bs-btn-pvp')?.addEventListener('click', () => {
      _cb.showScreen('pvp');
      _cb.renderPvPGallery();
    });

    document.getElementById('bs-btn-leaderboard')?.addEventListener('click', () => {
      _cb.showScreen('leaderboard');
      _cb.renderLeaderboard();
    });

    // Collection screen
    document.getElementById('bs-btn-collection')?.addEventListener('click', function() {
      _cb.showScreen('collection');
      _cb.renderCollection();
    });
    document.getElementById('bs-collection-back')?.addEventListener('click', function() {
      _cb.showScreen('lobby');
      _cb.renderLobby();
    });
    // Collection tab switching
    document.querySelectorAll('.bs-collection__tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        _cb.setCosmeticSlot(tab.dataset.slot || 'frame');
        _cb.renderCollection();
      });
    });

    // Deck management screen
    document.getElementById('bs-btn-deck')?.addEventListener('click', function() {
      _cb.showScreen('deck');
      _cb.renderDeckManagement();
    });
    document.getElementById('bs-deck-back')?.addEventListener('click', function() {
      _cb.showScreen('lobby');
      _cb.renderLobby();
    });

    // How to Play modal
    var htpEl = document.getElementById('bs-howtoplay');
    function openHowToPlay() { if (htpEl) htpEl.classList.remove('bs-modal-backdrop--hidden'); }
    function closeHowToPlay() { if (htpEl) htpEl.classList.add('bs-modal-backdrop--hidden'); }
    document.getElementById('bs-btn-howtoplay')?.addEventListener('click', openHowToPlay);
    document.getElementById('bs-howtoplay-close')?.addEventListener('click', closeHowToPlay);
    document.getElementById('bs-howtoplay-gotit')?.addEventListener('click', closeHowToPlay);
    if (htpEl) htpEl.addEventListener('click', function(e) { if (e.target === htpEl) closeHowToPlay(); });

    document.getElementById('bs-campaign-back')?.addEventListener('click', () => {
      _cb.showScreen('lobby');
      _cb.renderLobby();
    });
    document.getElementById('bs-leaderboard-back')?.addEventListener('click', () => {
      _cb.showScreen('lobby');
      _cb.renderLobby();
    });
    document.getElementById('bs-pvp-back')?.addEventListener('click', () => {
      _cb.showScreen('lobby');
      _cb.renderLobby();
    });

    // Combat guide
    document.getElementById('bs-combat-help-btn')?.addEventListener('click', () => { _cb.showOverlay('bs-combat-guide'); });
    document.getElementById('bs-combat-guide-close')?.addEventListener('click', () => { _cb.hideOverlay('bs-combat-guide'); });

    // Pre-fight retreat
    document.getElementById('bs-prefight-retreat')?.addEventListener('click', () => {
      _cb.hideOverlay('bs-prefight-overlay');
      _cb.showScreen('lobby');
      _cb.renderLobby();
    });

    // Forge overlays
    document.getElementById('bs-forge-now')?.addEventListener('click', () => { _cb.hideOverlay('bs-forge-trigger'); _cb.openForgeScreen(); });
    document.getElementById('bs-forge-later')?.addEventListener('click', () => { _cb.hideOverlay('bs-forge-trigger'); _cb.safeLSSet('bs-forge-pending', 'true'); _cb.updateForgeProgress(); });
    document.getElementById('bs-forge-unlock-btn')?.addEventListener('click', () => { _cb.hideOverlay('bs-forge-unlock'); _cb.openForgeScreen(true); });

    // Architect win
    document.getElementById('bs-architect-continue')?.addEventListener('click', () => {
      _cb.hideOverlay('bs-architect-win');
      // First completion — offer ascension
      _cb.showAscensionOffer(0);
    });

    // Bottom nav handling
    document.querySelectorAll('.bs-bottom-nav__item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const nav = btn.dataset.nav;
        document.querySelectorAll('.bs-bottom-nav__item').forEach(function(b) { b.classList.remove('bs-bottom-nav__item--active'); });
        btn.classList.add('bs-bottom-nav__item--active');
        if (nav === 'lobby') { _cb.showScreen('lobby'); _cb.renderLobby(); }
        else if (nav === 'campaign') { _cb.showScreen('campaign'); _cb.renderCampaignLadder(); }
        else if (nav === 'forge') {
          var needed = _cb.getForgeWinsRequired();
          var campaignDone = _cb.getHighestBossDefeated() >= 10;
          if (campaignDone || _cb.getForgeWins() >= needed || _cb.isForgePending()) { _cb.openForgeScreen(false, true); }
          else { _cb.showErrorToast('Win ' + Math.ceil(needed - _cb.getForgeWins()) + ' more fights to unlock the Forge'); }
        }
        else if (nav === 'leaderboard') { _cb.showScreen('leaderboard'); _cb.renderLeaderboard(); }
        else if (nav === 'pvp') {
          if (_cb.getHighestBossDefeated() >= 10) { _cb.showScreen('pvp'); _cb.renderPvPGallery(); }
          else { _cb.showErrorToast('Beat Boss 10 to unlock PvP'); }
        }
      });
    });

    // Results buttons
    document.getElementById('arena-results-again')?.addEventListener('click', () => {
      document.getElementById('arena-results-overlay').style.display = 'none';
      if (_cb.isFirstRealFight()) {
        _cb.clearFirstRealFight();
        // After first fight, go to campaign (win advances, loss can retry from ladder)
        _cb.showScreen('lobby');
        _cb.renderLobby();
        return;
      }
      if (_cb.getBattleType() === 'tower') {
        // Tower: continue climbing or restart
        if (_cb.getTowerFloor() > 0) {
          // Still in run — continue to next floor
          _cb.showScreen('campaign');
          _cb.renderCampaignLadder();
          setTimeout(function() { _cb.startTowerBattle(); }, 300);
        } else {
          // Run ended — back to campaign
          _cb.showScreen('campaign');
          _cb.renderCampaignLadder();
        }
        return;
      }
      if (_cb.getBattleType() === 'pvp') { _cb.showScreen('pvp'); _cb.renderPvPGallery(); }
      else if (_cb.getCurrentBossId()) {
        const currentBoss = _cb.getBossById(_cb.getCurrentBossId());
        // Weekly boss — return to campaign after fight
        if (_cb.isWeeklyBoss(_cb.getCurrentBossId())) {
          _cb.showScreen('campaign'); _cb.renderCampaignLadder();
        }
        // Advance to next boss if current was defeated, otherwise retry same boss
        else {
          const highest = _cb.getHighestBossDefeated();
          if (currentBoss && currentBoss.boss <= highest && currentBoss.boss < 10) {
            // Current boss defeated — advance to next
            const nextBoss = _cb.getBossByNumber(currentBoss.boss + 1);
            if (nextBoss) { _cb.startCampaignBattle(nextBoss.id); }
            else { _cb.showScreen('campaign'); _cb.renderCampaignLadder(); }
          } else {
            // Not yet defeated or last boss — retry same
            _cb.startCampaignBattle(_cb.getCurrentBossId());
          }
        }
      }
      else { _cb.showScreen('campaign'); _cb.renderCampaignLadder(); }
    });

    document.getElementById('arena-results-lobby')?.addEventListener('click', () => {
      document.getElementById('arena-results-overlay').style.display = 'none';
      _cb.clearFirstRealFight();
      _cb.refreshLobby();
      _cb.showScreen('lobby');
    });

    document.getElementById('arena-results-close')?.addEventListener('click', () => {
      document.getElementById('arena-results-overlay').style.display = 'none';
    });

    // Battle in-screen buttons
    document.getElementById('arena-battle-again')?.addEventListener('click', () => {
      if (_cb.getCurrentBossId()) _cb.startCampaignBattle(_cb.getCurrentBossId());
    });
    document.getElementById('arena-battle-back')?.addEventListener('click', () => {
      _cb.showScreen('lobby');
      _cb.refreshLobby();
    });
  }

  window.BsNav = {
    bind: bindPlayNavigation,
    setCallbacks: function (cb) { _cb = cb; }
  };
})();
