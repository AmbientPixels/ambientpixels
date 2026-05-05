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

    // Crate indicator — click to open, or hint if locked (count === 0)
    document.getElementById('bs-crate-indicator')?.addEventListener('click', function() {
      if (_cb.getCrateCount() > 0) {
        _cb.openCrateOverlay(0);
      } else if (window.BsToast && window.BsToast.show) {
        window.BsToast.show('Win fights to earn a crate. Every 5 wins drops a Battle Crate; first boss kills drop bigger ones.', 'info');
      }
    });

    // Primary PLAY button + Campaign button both open campaign
    const openCampaign = () => { _cb.showScreen('campaign'); _cb.renderCampaignLadder(); };
    // Smart ENTER ARENA: matches the label cascade in renderLobby (CTA-LABEL).
    // Mid-game -> next boss prefight. End-game cascades through:
    //   weekly boss unbeaten -> weekly prefight
    //   tower unlocked       -> campaign screen, scroll to tower
    //   asc < 5              -> ascension offer
    //   fallback             -> campaign screen (replay)
    const enterArena = () => {
      const highest = _cb.getHighestBossDefeated();
      const nextBoss = _cb.getBossByNumber(highest + 1);
      if (nextBoss) {
        _cb.populatePrefightOverlay(nextBoss);
        _cb.showOverlay('bs-prefight-overlay');
        _cb.setupPrefightButtons(nextBoss.id);
        return;
      }

      var weeklyBoss = _cb.getWeeklyBoss && _cb.getWeeklyBoss();
      var weeklyRec = (weeklyBoss && _cb.getWeeklyRecord) ? _cb.getWeeklyRecord() : null;
      var weeklyOpen = weeklyBoss && (!weeklyRec || (weeklyRec.wins || 0) === 0);

      if (weeklyOpen) {
        _cb.populatePrefightOverlay(weeklyBoss);
        _cb.showOverlay('bs-prefight-overlay');
        _cb.setupPrefightButtons(weeklyBoss.id);
        return;
      }

      var towerOpen = _cb.isTowerUnlocked && _cb.isTowerUnlocked();
      if (towerOpen) {
        _cb.showScreen('campaign');
        _cb.renderCampaignLadder();
        setTimeout(function () {
          var t = document.getElementById('bs-tower-section');
          if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
        return;
      }

      var asc = _cb.getAscension ? _cb.getAscension() : 0;
      if (asc < 5 && _cb.showAscensionOffer) {
        _cb.showAscensionOffer(asc);
        return;
      }

      // Final fallback — campaign for replay
      _cb.showScreen('campaign');
      _cb.renderCampaignLadder();
    };
    document.getElementById('bs-play-btn')?.addEventListener('click', enterArena);
    // Lobby Campaign entry points — both wire to the same openCampaign handler.
    // - bs-campaign-viewall: inline "View all →" link in the Campaign section header
    // - bs-btn-campaign: quicklinks card between Sparks Shop and How to Play
    document.getElementById('bs-campaign-viewall')?.addEventListener('click', openCampaign);
    document.getElementById('bs-btn-campaign')?.addEventListener('click', openCampaign);
    // Gallery quicklink (desktop) — same destination as the bottom-nav
    // Gallery button (mobile). Using the same single openGallery handler.
    // Gallery is its own standalone page (phase 5 cleanup) — both the
    // dashboard quick-link button and the lobby Hall of Fighters "View
    // all" link navigate to it instead of running an in-page showScreen.
    const openGallery = () => { window.location.href = '/blindspot/gallery.html'; };
    document.getElementById('bs-btn-gallery')?.addEventListener('click', openGallery);
    document.getElementById('bs-lobby-gallery-viewall')?.addEventListener('click', openGallery);

    // Stats screen entry points: lobby strip "View all" link, any of the
    // four stat tiles (clicking a tile opens the same full screen — no
    // per-tile drill yet), and the back button on the screen itself.
    // The redundant "Stats" quicklinks card was removed — five other
    // routes already exist on the lobby alone.
    const openStats = () => { _cb.showScreen('stats'); if (_cb.renderStatsScreen) _cb.renderStatsScreen(); };
    document.getElementById('bs-stats-viewall')?.addEventListener('click', openStats);
    document.querySelectorAll('.blindspot-stat-tile').forEach(function(tile) {
      tile.addEventListener('click', openStats);
    });
    document.getElementById('bs-stats-back')?.addEventListener('click', function() {
      _cb.showScreen('lobby');
      if (_cb.renderLobby) _cb.renderLobby();
    });
    // The lower nav 'Boss Codex' card replaced the redundant 'Campaign' card —
    // the boss rail above already serves as the campaign destination, so the
    // codex repurposes this slot as a lore/intel overview.
    var codexEl = document.getElementById('bs-codex');
    function openCodex() {
      if (_cb.renderBossCodex) _cb.renderBossCodex();
      if (codexEl) codexEl.classList.remove('bs-modal-backdrop--hidden');
    }
    function closeCodex() { if (codexEl) codexEl.classList.add('bs-modal-backdrop--hidden'); }
    document.getElementById('bs-btn-codex')?.addEventListener('click', openCodex);
    document.getElementById('bs-codex-close')?.addEventListener('click', closeCodex);
    document.getElementById('bs-codex-gotit')?.addEventListener('click', closeCodex);
    if (codexEl) codexEl.addEventListener('click', function(e) { if (e.target === codexEl) closeCodex(); });

    // Campaign rail (lobby) — boss pip clicks. The static markup uses
    // data-nav-target="campaign" but no JS read it; routing here by
    // progression state instead:
    //   - defeated OR next-available  → open pre-fight overlay
    //   - locked                      → land on Campaign so the player
    //                                   can see the unlock requirement
    document.querySelector('.blindspot-boss-rail')?.addEventListener('click', function (e) {
      const pip = e.target.closest('.blindspot-boss-pip');
      if (!pip) return;
      const numEl = pip.querySelector('.blindspot-boss-pip__num');
      const bossNum = numEl ? parseInt(numEl.textContent.trim(), 10) : NaN;
      if (!bossNum) return;
      const highest = _cb.getHighestBossDefeated ? _cb.getHighestBossDefeated() : 0;
      const boss = _cb.getBossByNumber ? _cb.getBossByNumber(bossNum) : null;
      if (boss && bossNum <= highest + 1) {
        _cb.populatePrefightOverlay(boss);
        _cb.showOverlay('bs-prefight-overlay');
        _cb.setupPrefightButtons(boss.id);
      } else {
        // Locked — toast feedback instead of an unexpected screen change.
        // Players were getting silently dropped on the campaign page
        // when they clicked a boss that's beyond their progression.
        if (_cb.showErrorToast) {
          _cb.showErrorToast('Defeat boss ' + (highest + 1) + ' to unlock this fight');
        }
      }
    });

    // Prefight pager (< 09 / 10 >) — flip between bosses without
    // leaving the prefight overlay. Reads current boss from
    // data-boss-num set by populatePrefightOverlay; clamped 1-10.
    function pagerStep(delta) {
      const overlay = document.getElementById('bs-prefight-overlay');
      const cur = overlay ? parseInt(overlay.getAttribute('data-boss-num') || '0', 10) : 0;
      if (!cur) return;
      const next = Math.max(1, Math.min(10, cur + delta));
      if (next === cur) return;
      const boss = _cb.getBossByNumber ? _cb.getBossByNumber(next) : null;
      if (!boss) return;
      _cb.populatePrefightOverlay(boss);
      _cb.setupPrefightButtons(boss.id);
    }
    document.getElementById('bs-prefight-pager-prev')?.addEventListener('click', function () { pagerStep(-1); });
    document.getElementById('bs-prefight-pager-next')?.addEventListener('click', function () { pagerStep(1); });

    // Floating gold embers in the prefight overlay — same approach as
    // the login page: 20 child <span>s with randomised left / bottom /
    // animation-delay / animation-duration. CSS handles the fade-up
    // animation. Idempotent — only spawn if container is empty.
    var emberHost = document.getElementById('bs-prefight-embers');
    if (emberHost && !emberHost.children.length) {
      for (var ei = 0; ei < 20; ei++) {
        var ember = document.createElement('span');
        ember.className = 'blindspot-prefight__ember';
        ember.style.left = (Math.random() * 100) + '%';
        ember.style.bottom = (Math.random() * 30) + '%';
        ember.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
        ember.style.animationDuration = (3 + Math.random() * 3).toFixed(2) + 's';
        emberHost.appendChild(ember);
      }
    }

    document.getElementById('bs-btn-pvp')?.addEventListener('click', () => {
      _cb.showScreen('pvp');
      _cb.renderPvPGallery();
      if (_cb.initPvPTabs) _cb.initPvPTabs();
      if (_cb.renderDefenseQueue) _cb.renderDefenseQueue();
      if (_cb.pollInboxCount) _cb.pollInboxCount();
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
    // Lobby loadout panel "Change ▸" link routes to the same Collection screen
    document.getElementById('bs-loadout-edit')?.addEventListener('click', function() {
      _cb.showScreen('collection');
      _cb.renderCollection();
    });
    // Lobby Sparks Shop tile — opens the full shop screen
    document.getElementById('bs-sparks-tile')?.addEventListener('click', function() {
      _cb.showScreen('shop');
      if (_cb.renderShop) _cb.renderShop();
    });
    // Topbar Sparks pill — same destination as the lobby tile, shortcut from any screen.
    document.getElementById('bs-topbar-sparks')?.addEventListener('click', function() {
      _cb.showScreen('shop');
      if (_cb.renderShop) _cb.renderShop();
    });
    // Topbar dropdown -> Fighter Profile. Bound here as the canonical
    // path because bs-nav already has _cb wired via setCallbacks.
    // bs-auth-ui has a parallel listener as a belt-and-suspenders;
    // setMenuOpen / closeMenu are idempotent so dual-firing is safe.
    document.getElementById('bs-topbar-menu-profile')?.addEventListener('click', function() {
      if (window.BsAuthUI && window.BsAuthUI.closeMenu) window.BsAuthUI.closeMenu();
      _cb.showScreen('stats');
      if (_cb.renderStatsScreen) _cb.renderStatsScreen();
    });
    // Topbar dropdown -> How to Play modal. Same belt-and-suspenders
    // pattern; bs-auth-ui also handles this but routing through nav
    // keeps the navigation surface consistent across modules.
    document.getElementById('bs-topbar-menu-howto')?.addEventListener('click', function() {
      if (window.BsAuthUI && window.BsAuthUI.closeMenu) window.BsAuthUI.closeMenu();
      var htp = document.getElementById('bs-howtoplay');
      if (htp) htp.classList.remove('bs-modal-backdrop--hidden');
    });
    // Topbar Level pill — placeholder until progression detail ships.
    // TODO: route to XP/progression screen when one exists. For now,
    // toast the current level + xp so the click is not a dead end.
    document.getElementById('bs-topbar-level')?.addEventListener('click', function() {
      if (window.BsToast && window.BsToast.show) {
        var xp = (window.BsState && window.BsState.progress && window.BsState.progress.xp) || 0;
        var lvl = (window.BsState && typeof window.BsState.computeLevel === 'function') ? window.BsState.computeLevel(xp) : 1;
        window.BsToast.show('Level ' + lvl + ' (' + xp + ' XP). Progression detail coming soon.', 'info');
      }
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
    // Collection filter (All / Owned only)
    document.querySelectorAll('.bs-collection__filter-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        if (_cb.setCosmeticFilter) _cb.setCosmeticFilter(chip.dataset.filter || 'all');
        _cb.renderCollection();
      });
    });

    // Shop screen
    document.getElementById('bs-btn-shop')?.addEventListener('click', function() {
      _cb.showScreen('shop');
      if (_cb.renderShop) _cb.renderShop();
    });
    document.getElementById('bs-shop-back')?.addEventListener('click', function() {
      _cb.showScreen('lobby');
      _cb.renderLobby();
    });
    // Shop tab switching
    document.querySelectorAll('.bs-shop__tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        if (_cb.setShopTab) _cb.setShopTab(tab.dataset.tab || 'featured');
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
    document.getElementById('bs-combat-help-btn')?.addEventListener('click', () => {
      // Progressive disclosure: re-evaluated on every open (handles mid-session boss kills)
      // Reads localStorage — may drift from server if cleared, but cosmetic-only so fail-safe
      var guide = document.querySelector('.bs-guide');
      if (guide) {
        var progress = {};
        try { progress = JSON.parse(localStorage.getItem('bs-progress') || '{}'); } catch (e) {}
        var highest = progress.highestBoss || 0;
        guide.classList.remove('bs-guide--tier1', 'bs-guide--tier3');
        if (highest >= 3) guide.classList.add('bs-guide--tier3');
        else if (highest >= 1) guide.classList.add('bs-guide--tier1');
      }
      // Combo codex: read bs-combo-discovered-{id} keys + apply --discovered class
      // so the lock/check icon and grayscale state stay in sync with player progress.
      ['flurry', 'riposte', 'empowered'].forEach(function (id) {
        var found = false;
        try { found = !!localStorage.getItem('bs-combo-discovered-' + id); } catch (e) {}
        document.querySelectorAll('[data-combo-id="' + id + '"]').forEach(function (el) {
          el.classList.toggle('bs-combo-codex__entry--discovered', found);
        });
      });
      _cb.showOverlay('bs-combat-guide');
    });
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
        else if (nav === 'gallery') { window.location.href = '/blindspot/gallery.html'; }
        else if (nav === 'leaderboard') { _cb.showScreen('leaderboard'); _cb.renderLeaderboard(); }
        else if (nav === 'pvp') {
          var pvpReq = _cb.getPvpUnlockRequirement ? _cb.getPvpUnlockRequirement() : 3;
          if (_cb.getHighestBossDefeated() >= pvpReq) { _cb.showScreen('pvp'); _cb.renderPvPGallery(); }
          else { _cb.showErrorToast('Beat Boss ' + pvpReq + ' to unlock PvP'); }
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
