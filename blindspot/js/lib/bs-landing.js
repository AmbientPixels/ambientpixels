/**
 * bs-landing.js — Landing page (index.html) flow
 * Stranger intro, stranger fight, Quick Build trigger, card reveal,
 * first-fight result, auth UI, forge progress in results.
 * Extracted from blindspot-flow.js (Round 7)
 *
 * API: window.BsLanding
 *   .initLanding()                     — boot landing page
 *   .handleStrangerResult(res, data)   — called by battle completion hook
 *   .handleFirstRealFightResult(res, data)
 *   .showForgeProgressInResults()
 *   .setCallbacks(cbs)
 */
(function () {
  'use strict';

  var _cb = {};

  function escHtml(s) { return window.BsUtils && window.BsUtils.escapeHtml ? window.BsUtils.escapeHtml(String(s)) : String(s); }

  // ── Init Landing ──

  function initLanding() {
    var gameDataPromise = _cb.loadGameData ? _cb.loadGameData() : Promise.resolve();
    var profilePromise = _cb.loadProfile ? _cb.loadProfile() : Promise.resolve(null);

    var fightBtn = document.getElementById('bs-fight-btn');
    if (!fightBtn) return;

    Promise.all([gameDataPromise, profilePromise]).then(function (results) {
      var profile = results[1];

      var landingParams = new URLSearchParams(window.location.search);

      // Dev reset: ?reset=true
      if (landingParams.get('reset') === 'true') {
        Object.keys(localStorage).filter(function (k) { return k.startsWith('bs-') || k === 'blindspot-onboarded' || k === 'cardforge_saved_cards'; }).forEach(function (k) { localStorage.removeItem(k); });
        sessionStorage.clear();
        var BlindspotAPI = _cb.getBlindspotAPI ? _cb.getBlindspotAPI() : null;
        if (BlindspotAPI) BlindspotAPI._apiFetch('POST', { action: 'reset' }).catch(function () {});
        (function () {
          try {
            var url = window.buildApiPath ? window.buildApiPath('arenaProfile') : 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgearenaprofile';
            var fetchPrincipal = BlindspotAPI ? BlindspotAPI.fetchPrincipal() : Promise.resolve(null);
            fetchPrincipal.then(function (principal) {
              var headers = { 'Content-Type': 'application/json' };
              if (principal) headers['X-CF-Auth-Principal'] = principal;
              fetch(url, { method: 'POST', headers: headers, body: JSON.stringify({ action: 'reset' }) });
            });
          } catch (e) {}
        })();
        window.location.href = '/blindspot/';
        return;
      }

      // New card creation flow
      if (landingParams.get('newCard') === 'true' && !(_cb.isDemo ? _cb.isDemo() : true)) {
        document.getElementById('bs-landing').style.display = 'none';
        openNewCardQuickBuild();
        return;
      }

      // Returning authenticated players skip landing
      var isDemo = _cb.isDemo ? _cb.isDemo() : true;
      var isNew = _cb.isNewPlayer ? _cb.isNewPlayer(profile) : true;
      if (!isDemo && !isNew) {
        document.getElementById('bs-landing').style.opacity = '0';
        window.location.href = '/blindspot/play.html';
        return;
      }

      // Auth UI
      updateLandingAuthUI();

      // Combat guide open + close
      var guideOpen = document.getElementById('bs-combat-help-btn');
      if (guideOpen) guideOpen.addEventListener('click', function () { if (_cb.showOverlay) _cb.showOverlay('bs-combat-guide'); });
      var guideClose = document.getElementById('bs-combat-guide-close');
      if (guideClose) guideClose.addEventListener('click', function () { if (_cb.hideOverlay) _cb.hideOverlay('bs-combat-guide'); });

      // Social proof counters
      var proofBattles = document.getElementById('bs-proof-battles');
      var proofCards = document.getElementById('bs-proof-cards');
      if (proofBattles && proofCards) {
        var progress = _cb.getProgress ? _cb.getProgress() : {};
        var baseBattles = 12847;
        var baseCards = 3291;
        proofBattles.textContent = (baseBattles + (progress.totalWins || 0)).toLocaleString();
        proofCards.textContent = (baseCards + (progress.forgeVisits || 0)).toLocaleString();
      }

      fightBtn.addEventListener('click', function () {
        fightBtn.disabled = true;
        fightBtn.innerHTML = '<span class="bs-spinner" style="display:inline-block;width:14px;height:14px;"></span> Loading\u2026';

        showStrangerIntro().then(function () {
          return startStrangerFight();
        }).catch(function (err) {
          console.error('[Blindspot] First fight error:', err);
          fightBtn.disabled = false;
          fightBtn.innerHTML = '<i class="fas fa-bolt"></i> Fight';
          if (_cb.showErrorToast) _cb.showErrorToast('Failed to start fight. Try again.');
          document.getElementById('bs-landing').style.display = '';
          document.getElementById('bs-battle-container').style.display = 'none';
          document.body.classList.remove('bs-battle-active');
        });
      });
    });
  }

  // ── Stranger Intro ──

  function showStrangerIntro() {
    return new Promise(function (resolve) {
      if (localStorage.getItem('bs-stranger-intro-shown')) { resolve(); return; }
      if (_cb.safeLSSet) _cb.safeLSSet('bs-stranger-intro-shown', 'true');

      var landing = document.getElementById('bs-landing');
      landing.style.opacity = '0';
      landing.style.transition = 'opacity 0.5s ease';

      var intro = document.getElementById('bs-stranger-intro');
      if (!intro) { resolve(); return; }

      setTimeout(function () {
        landing.style.display = 'none';
        landing.style.opacity = '';
        intro.classList.remove('bs-overlay--hidden');
        intro.style.display = '';

        var lines = intro.querySelectorAll('.bs-stranger-intro__line');
        var delays = [400, 1800, 3200];
        lines.forEach(function (line, i) {
          setTimeout(function () { line.classList.add('bs-intro-visible'); }, delays[i] || (i * 1400));
        });

        setTimeout(function () {
          intro.classList.add('bs-intro-fadeout');
          setTimeout(function () {
            intro.classList.add('bs-overlay--hidden');
            intro.classList.remove('bs-intro-fadeout');
            resolve();
          }, 600);
        }, 8000);
      }, 500);
    });
  }

  // ── Stranger Fight ──

  function startStrangerFight() {
    if (_cb.setIsStrangerFight) _cb.setIsStrangerFight(true);
    if (_cb.removeTutorial) _cb.removeTutorial();

    document.getElementById('bs-landing').style.display = 'none';

    var battleContainer = document.getElementById('bs-battle-container');
    battleContainer.style.display = 'block';
    battleContainer.style.opacity = '0';
    document.body.classList.add('bs-battle-active');

    if (window.ArenaAudio) window.ArenaAudio.init();

    if (!window._bsBattleEventsBound) {
      window.ArenaBattleUI.bindEvents();
      window._bsBattleEventsBound = true;
    }

    if (_cb.hookBattleCompletion) _cb.hookBattleCompletion();
    if (_cb.hookBattleTracking) _cb.hookBattleTracking();

    var strangerCard = _cb.getStrangerCard ? _cb.getStrangerCard() : null;
    var config = _cb.getConfig ? _cb.getConfig() : {};

    return window.ArenaAPI.startBattle(
      'pve', strangerCard.id, config.tutorialBoss.id,
      { cardData: strangerCard }
    ).then(function (battleData) {
      if (_cb.setActiveBattle) _cb.setActiveBattle(battleData);

      if (window.ArenaAudio && window.ArenaBackgrounds) {
        window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
      }
      if (window.ArenaBackgrounds) window.ArenaBackgrounds.applyToBattleStage();

      window.ArenaBattleUI.initBattle(battleData);
      if (_cb.applyBattlePalette) _cb.applyBattlePalette();
      if (_cb.updateCombatTooltips) _cb.updateCombatTooltips();

      battleContainer.style.transition = 'opacity 0.4s ease';
      battleContainer.style.opacity = '1';

      if (!localStorage.getItem('bs-combat-guide-shown')) {
        if (_cb.safeLSSet) _cb.safeLSSet('bs-combat-guide-shown', 'true');
        if (_cb.showOverlay) _cb.showOverlay('bs-combat-guide');
      }
      if (!localStorage.getItem('bs-tutorial-shown')) {
        if (_cb.safeLSSet) _cb.safeLSSet('bs-tutorial-shown', 'true');
        if (_cb.showStrangerTutorial) _cb.showStrangerTutorial();
      }
    }).catch(function (err) {
      console.error('[Blindspot] Stranger fight error:', err);
      document.getElementById('bs-landing').style.display = '';
      battleContainer.style.display = 'none';
      var fightBtn = document.getElementById('bs-fight-btn');
      if (fightBtn) { fightBtn.disabled = false; fightBtn.textContent = 'Fight'; }
      if (_cb.showErrorToast) _cb.showErrorToast('Could not start battle. Try again.');
    });
  }

  // ── Stranger Result ──

  function handleStrangerResult(battleResult, battleData) {
    var isWin = battleResult.winner === 'player';
    document.getElementById('bs-battle-container').style.display = 'none';
    document.body.classList.remove('bs-battle-active');

    if (isWin) {
      if (_cb.showOverlay) _cb.showOverlay('bs-stranger-win');
      var buildBtn = document.getElementById('bs-build-btn');
      if (buildBtn) buildBtn.addEventListener('click', function () {
        if (_cb.hideOverlay) _cb.hideOverlay('bs-stranger-win');
        openBlindspotQuickBuild();
      }, { once: true });
    } else {
      if (_cb.showOverlay) _cb.showOverlay('bs-stranger-loss');
      var lossOverlay = document.getElementById('bs-stranger-loss');
      if (lossOverlay) lossOverlay.addEventListener('click', function () {
        if (_cb.hideOverlay) _cb.hideOverlay('bs-stranger-loss');
        startStrangerFight();
      }, { once: true });
    }
  }

  // ── Quick Build (after stranger win) ──

  function openBlindspotQuickBuild() {
    if (!window.BlindspotQuickBuild) {
      console.error('[Blindspot] Quick Build not loaded');
      return;
    }

    window.BlindspotQuickBuild.open(function onComplete(cardId, cardData) {
      if (_cb.setIsStrangerFight) _cb.setIsStrangerFight(false);
      if (_cb.setIsFirstRealFight) _cb.setIsFirstRealFight(true);

      var isDemo = _cb.isDemo ? _cb.isDemo() : true;
      if (cardId && !isDemo) {
        window.ArenaAPI.selectCard(cardId).catch(function (e) { console.warn('selectCard:', e); });
      }
      // Cache card immediately so guest lobby can find it (server may not return it)
      if (cardData && _cb.addCardToDeck) _cb.addCardToDeck(cardData);
      if (cardId && _cb.safeLSSet) _cb.safeLSSet('bs-selected-card-id', cardId);

      if (_cb.safeLSSet) {
        _cb.safeLSSet('blindspot-onboarded', 'true');
        _cb.safeLSSet('bs-onboarded-lobby', 'true');
      }
      showCardRevealCelebration(cardId, isDemo);
    });
  }

  // ── Quick Build (new card from lobby) ──

  function openNewCardQuickBuild() {
    if (!window.BlindspotQuickBuild) {
      console.error('[Blindspot] Quick Build not loaded');
      window.location.href = '/blindspot/play.html';
      return;
    }

    window.BlindspotQuickBuild.open(function onComplete(cardId, cardData) {
      if (cardId) {
        // Cache card data immediately in case server roundtrip fails
        if (cardData && _cb.addCardToDeck) _cb.addCardToDeck(cardData);
        if (cardId && _cb.safeLSSet) _cb.safeLSSet('bs-selected-card-id', cardId);

        window.ArenaAPI.loadCards().then(function (data) {
          var cards = (data.userCards || []).filter(function (c) { return !c.isDefault; });
          cards.forEach(function (c) { if (_cb.addCardToDeck) _cb.addCardToDeck(c); });
          var progress = _cb.getProgress ? _cb.getProgress() : {};
          progress.selectedCardId = cardId;
          if (_cb.flushSyncBeforeNavigate) _cb.flushSyncBeforeNavigate();
          window.location.href = '/blindspot/play.html';
        }).catch(function () {
          window.location.href = '/blindspot/play.html';
        });
      } else {
        window.location.href = '/blindspot/play.html';
      }
    });
  }

  // ── Demo Sign-In Prompt ──

  function showDemoSignInPrompt() {
    var existing = document.querySelector('.bs-demo-prompt');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'bs-overlay bs-demo-prompt';
    overlay.innerHTML =
      '<p class="bs-overlay__title">You built your card. Now make it real.</p>' +
      '<p class="bs-overlay__subtitle">Sign in to save your card, track your rank, and climb the campaign.</p>' +
      '<a href="/blindspot/login.html?redirect=/blindspot/" class="bs-btn bs-btn--primary bs-btn--full bs-btn--glow" style="text-decoration:none; text-align:center; display:block; max-width:320px;">' +
        '<i class="fas fa-sign-in-alt"></i> Sign In to Continue' +
      '</a>' +
      '<button class="bs-btn bs-btn--secondary bs-btn--full" style="margin-top:0.75rem; max-width:320px;" id="bs-demo-guest">' +
        '<i class="fas fa-play"></i> Continue as Guest' +
      '</button>' +
      '<p style="font-size:0.7rem; color:var(--bs-text-muted); margin-top:0.5rem; max-width:320px; text-align:center;">Guest progress won\'t sync across devices or browsers</p>' +
      '<button class="bs-btn bs-btn--secondary bs-btn--full" style="margin-top:0.5rem; max-width:320px; opacity:0.6;" id="bs-demo-replay">' +
        '<i class="fas fa-redo"></i> Start Over as Stranger' +
      '</button>';

    document.body.appendChild(overlay);

    var guestBtn = document.getElementById('bs-demo-guest');
    if (guestBtn) guestBtn.addEventListener('click', function () {
      overlay.remove();
      if (_cb.safeLSSet) {
        _cb.safeLSSet('blindspot-onboarded', 'true');
        _cb.safeLSSet('bs-guest-mode', 'true');
      }
      window.location.href = '/blindspot/play.html';
    });

    var replayBtn = document.getElementById('bs-demo-replay');
    if (replayBtn) replayBtn.addEventListener('click', function () {
      overlay.remove();
      document.getElementById('bs-landing').style.display = '';
      var fightBtn = document.getElementById('bs-fight-btn');
      if (fightBtn) { fightBtn.disabled = false; fightBtn.textContent = 'Fight'; }
    });
  }

  // ── Card Reveal Celebration ──

  function showCardRevealCelebration(cardId, isDemoUser) {
    var existing = document.querySelector('.bs-reveal-celebration');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'bs-overlay bs-reveal-celebration';
    overlay.innerHTML = '<div class="bs-reveal-loading"><div class="bs-spinner"></div><p style="color:var(--bs-text-muted);font-family:\'Share Tech Mono\',monospace;margin-top:1rem;font-size:0.85rem;"><i class="fas fa-hammer" style="color:var(--bs-accent);margin-right:0.4em;"></i>Forging your card\u2026</p></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('bs-reveal-celebration--active'); });

    var tryRender = function () {
      var cardPromise;
      try {
        cardPromise = window.ArenaAPI.loadCards();
      } catch (e) {
        cardPromise = Promise.reject(e);
      }

      cardPromise.then(function (data) {
        var cards = (data.userCards || []).filter(function (c) { return !c.isDefault; });
        var card = cardId ? cards.find(function (c) { return c.id === cardId; }) : cards[cards.length - 1];
        // Cache card to deck so play.html can find it (critical for guests)
        if (card) {
          if (_cb.addCardToDeck) _cb.addCardToDeck(card);
          if (_cb.safeLSSet) _cb.safeLSSet('bs-selected-card-id', card.id);
        }
        renderCelebration(overlay, card, cardId, isDemoUser);
      }).catch(function () {
        renderCelebration(overlay, null, cardId, isDemoUser);
      });
    };

    tryRender();
  }

  function renderCelebration(overlay, card, cardId, isDemoUser) {
    if (card && _cb.ensureCombatStats) _cb.ensureCombatStats(card);

    // Create particle elements
    var particles = '';
    for (var i = 0; i < 24; i++) {
      var angle = (i / 24) * Math.PI * 2;
      var dist = 80 + Math.random() * 120;
      var tx = Math.cos(angle) * dist;
      var ty = Math.sin(angle) * dist;
      var size = 3 + Math.random() * 5;
      var delay = Math.random() * 0.4;
      particles += '<div class="bs-reveal-particle" style="--tx:' + tx.toFixed(1) + 'px;--ty:' + ty.toFixed(1) + 'px;--size:' + size + 'px;--delay:' + delay + 's"></div>';
    }

    var cardHtml = _cb.renderCardHTML ? _cb.renderCardHTML(card, 'full') : '';

    overlay.innerHTML =
      '<div class="bs-reveal-particles">' + particles + '</div>' +
      '<div class="bs-reveal-card-wrap" style="display:flex;justify-content:center;">' + cardHtml + '</div>' +
      '<p class="bs-reveal-title">Your card is ready</p>' +
      '<p class="bs-reveal-subtitle">The arena awaits.</p>' +
      (isDemoUser ?
        '<a href="/blindspot/login.html?redirect=/blindspot/play.html" class="bs-btn bs-btn--primary bs-btn--glow bs-reveal-enter" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">' +
          '<i class="fas fa-sign-in-alt"></i> Sign In & Enter the Arena' +
        '</a>' +
        '<button class="bs-btn bs-btn--secondary bs-btn--full" style="margin-top:0.75rem; max-width:320px;" id="bs-reveal-enter">' +
          '<i class="fas fa-play"></i> Continue as Guest' +
        '</button>' +
        '<p style="font-size:0.65rem; color:var(--bs-text-muted); margin-top:0.5rem;">Guest progress won\'t sync across devices</p>'
      :
        '<button class="bs-btn bs-btn--primary bs-btn--glow bs-reveal-enter" id="bs-reveal-enter">' +
          '<i class="fas fa-shield-halved"></i> Enter the Arena' +
        '</button>'
      );

    var enterBtn = document.getElementById('bs-reveal-enter');
    if (enterBtn) enterBtn.addEventListener('click', function () {
      if (isDemoUser && _cb.safeLSSet) {
        _cb.safeLSSet('bs-guest-mode', 'true');
      }
      overlay.classList.add('bs-reveal-celebration--exit');
      setTimeout(function () {
        window.location.href = '/blindspot/play.html';
      }, 400);
    });
  }

  // ── First Real Fight Result ──

  function handleFirstRealFightResult(battleResult, battleData) {
    if (_cb.safeLSSet) _cb.safeLSSet('blindspot-onboarded', 'true');
    var isWin = battleResult.winner === 'player';
    if (isWin && _cb.setForgeWins) _cb.setForgeWins(1);
    showForgeProgressInResults();

    var againBtn = document.getElementById('arena-results-again');
    var lobbyBtn = document.getElementById('arena-results-lobby');
    if (againBtn) againBtn.innerHTML = isWin ? 'Next Fight' : '<i class="fas fa-redo"></i> Rematch';
    if (lobbyBtn) lobbyBtn.textContent = 'Go to Lobby';

    if (_cb.renderSessionStats) _cb.renderSessionStats();
  }

  // ── Forge Progress in Results ──

  function showForgeProgressInResults() {
    var container = document.getElementById('bs-results-forge');
    if (!container) return;
    if (_cb.isForgeUnlocked && _cb.isForgeUnlocked()) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    var wins = _cb.getForgeWins ? _cb.getForgeWins() : 0;
    var config = _cb.getConfig ? _cb.getConfig() : null;
    var needed = config ? config.forgeVisit.winsRequired : 3;
    var pct = Math.min(100, (wins / needed) * 100);
    var label = document.getElementById('bs-results-forge-label');
    var fill = document.getElementById('bs-results-forge-fill');
    if (label) label.textContent = wins >= needed ? 'CARD FORGE READY \u2014 Tap to customize' : 'CARD FORGE \u00b7 ' + wins + ' / ' + needed + ' wins';
    if (fill) fill.style.setProperty('--bar-pct', pct / 100);
  }

  // ── Landing Auth UI ──

  function updateLandingAuthUI() {
    var authArea = document.getElementById('bs-auth-area');
    if (!authArea) return;

    fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.clientPrincipal) {
        sessionStorage.setItem('isAuthenticated', 'true');
        document.body.setAttribute('data-auth-state', 'signed-in');

        var name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'Player';
        authArea.innerHTML =
          '<span class="bs-landing__user" style="display:flex; align-items:center; gap:0.5rem; justify-content:center;">' +
            '<i class="fas fa-user-check" style="color:var(--bs-accent);"></i>' +
            '<span>' + escHtml(name) + '</span>' +
            '<a href="/.auth/logout?post_logout_redirect_uri=/blindspot/" class="bs-landing__signin" style="font-size:0.75rem; opacity:0.7;">' +
              '<i class="fas fa-sign-out-alt"></i> Sign out' +
            '</a>' +
          '</span>' +
          '<span style="display:block; font-size:0.6rem; color:var(--bs-text-muted); margin-top:0.25rem;">Progress saves automatically</span>';
      }
    }).catch(function () {});
  }

  function setCallbacks(cbs) { _cb = cbs; }

  window.BsLanding = {
    initLanding: initLanding,
    handleStrangerResult: handleStrangerResult,
    handleFirstRealFightResult: handleFirstRealFightResult,
    showForgeProgressInResults: showForgeProgressInResults,
    showDemoSignInPrompt: showDemoSignInPrompt,
    setCallbacks: setCallbacks
  };
})();
