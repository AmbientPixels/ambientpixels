/**
 * Blindspot Card Switcher
 *
 * Lobby card cycling arrows + New Card button.
 *
 * API: window.BsCardSwitcher
 *   .renderSwitcher()    — show/hide arrows + card count
 *   .renderNewCardBtn()  — show/hide new card button
 *   .setCallbacks({...}) — inject monolith deps
 */
window.BsCardSwitcher = (function () {
  'use strict';

  var MAX_DECK_SIZE = 8;
  var _switcherBound = false;
  var _newCardBound = false;
  var _cb = {};

  function switchCard(direction) {
    var deck = _cb.getDeck ? _cb.getDeck() : [];
    if (deck.length <= 1) return;
    var currentIdx = _cb.getSelectedCardIndex ? _cb.getSelectedCardIndex() : 0;
    var nextIdx = direction === 'next'
      ? (currentIdx + 1) % deck.length
      : (currentIdx - 1 + deck.length) % deck.length;
    var nextCard = deck[nextIdx];
    if (!nextCard) return;

    var cardEl = document.getElementById('bs-player-card');
    if (!cardEl) return;

    var outClass = direction === 'next' ? 'bs-card-slide-out-left' : 'bs-card-slide-out-right';
    var inClass = direction === 'next' ? 'bs-card-slide-in-right' : 'bs-card-slide-in-left';

    cardEl.classList.add(outClass);

    setTimeout(function () {
      if (_cb.setActiveCard) _cb.setActiveCard(nextCard);
      cardEl.classList.remove(outClass);
      if (_cb.renderLobby) _cb.renderLobby();
      cardEl.classList.add(inClass);
      setTimeout(function () { cardEl.classList.remove(inClass); }, 250);
    }, 250);
  }

  function renderSwitcher() {
    var deck = _cb.getDeck ? _cb.getDeck() : [];
    var switcherEl = document.getElementById('bs-card-switcher');
    if (!switcherEl) return;

    if (deck.length <= 1) {
      switcherEl.style.display = 'none';
      return;
    }

    switcherEl.style.display = '';
    var countEl = document.getElementById('bs-card-count');
    if (countEl) {
      var idx = _cb.getSelectedCardIndex ? _cb.getSelectedCardIndex() : 0;
      countEl.textContent = (idx + 1) + ' / ' + deck.length;
    }

    if (!_switcherBound) {
      _switcherBound = true;
      var prevBtn = document.getElementById('bs-card-prev');
      var nextBtn = document.getElementById('bs-card-next');
      if (prevBtn) prevBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        switchCard('prev');
      });
      if (nextBtn) nextBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        switchCard('next');
      });
    }
  }

  function renderNewCardBtn() {
    var btn = document.getElementById('bs-new-card-btn');
    if (!btn) return;

    var isGuest = localStorage.getItem('bs-guest-mode') === 'true';
    var deckSize = _cb.getDeckSize ? _cb.getDeckSize() : 0;
    var config = _cb.getConfig ? _cb.getConfig() : null;
    var needed = config ? config.forgeVisit.winsRequired : 3;
    var forgeReady = (_cb.isForgeUnlocked && _cb.isForgeUnlocked()) ||
                     (_cb.getHighestBossDefeated && _cb.getHighestBossDefeated() >= 10) ||
                     (_cb.getForgeWins && _cb.getForgeWins() >= needed) ||
                     (_cb.isForgePending && _cb.isForgePending());

    if (isGuest) {
      // Guest mode: always show the button as a sign-in conversion CTA.
      // Frame it as the unlock for deck-building (which requires server
      // persistence — guests can't expand beyond their first card).
      // Lock icon + clear copy makes the gating obvious.
      btn.style.display = '';
      btn.disabled = false;
      btn.classList.add('bs-btn--locked');
      btn.innerHTML = '<i class="fas fa-lock" aria-hidden="true"></i> Save &amp; Build Deck';
    } else if (!forgeReady) {
      // Signed-in beginner — forge not yet unlocked. Show the button
      // ghosted with a progress hint so the player knows the unlock
      // exists and what it costs. Click shows a toast pointing them
      // at the campaign rather than silently doing nothing.
      var wins = (_cb.getForgeWins && _cb.getForgeWins()) || 0;
      btn.style.display = '';
      btn.disabled = false;
      btn.classList.add('bs-btn--locked');
      btn.innerHTML = '<i class="fas fa-lock" aria-hidden="true"></i> Build Deck (' + wins + '/' + needed + ' wins)';
    } else {
      btn.classList.remove('bs-btn--locked');
      if (deckSize >= MAX_DECK_SIZE) {
        // Deck full. Hide rather than relabel + reroute to Manage Deck —
        // having two buttons that land on the same screen reads as a
        // duplicate. Manage Deck is right next to this button and
        // already handles retiring. Once a card is retired the button
        // re-renders below the cap and comes back as "+ New Card".
        btn.style.display = 'none';
      } else {
        btn.style.display = '';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> New Card';
      }
    }

    if (!_newCardBound) {
      _newCardBound = true;
      btn.addEventListener('click', function () {
        // Re-read state at click time so the handler stays correct
        // across guest → signed-in transitions and forge-unlock changes
        // without needing to rebind.
        var nowGuest = localStorage.getItem('bs-guest-mode') === 'true';
        if (nowGuest) {
          window.location.href = '/blindspot/login.html?redirect=/blindspot/play.html';
          return;
        }
        // Re-evaluate forge-readiness — same conditions as render.
        var nowConfig = _cb.getConfig ? _cb.getConfig() : null;
        var nowNeeded = nowConfig ? nowConfig.forgeVisit.winsRequired : 3;
        var nowReady = (_cb.isForgeUnlocked && _cb.isForgeUnlocked()) ||
                       (_cb.getHighestBossDefeated && _cb.getHighestBossDefeated() >= 10) ||
                       (_cb.getForgeWins && _cb.getForgeWins() >= nowNeeded) ||
                       (_cb.isForgePending && _cb.isForgePending());
        if (!nowReady) {
          var wins = (_cb.getForgeWins && _cb.getForgeWins()) || 0;
          var remaining = Math.max(0, nowNeeded - wins);
          var msg = remaining > 0
            ? 'Win ' + remaining + ' more campaign fight' + (remaining === 1 ? '' : 's') + ' to unlock deck building.'
            : 'Deck building is unlocking — refresh the lobby.';
          if (window.BsToast && window.BsToast.show) window.BsToast.show(msg, 'info');
          return;
        }
        var size = _cb.getDeckSize ? _cb.getDeckSize() : 0;
        if (size >= MAX_DECK_SIZE && _cb.showScreen) {
          // Mirror bs-nav.js's Manage Deck handler — showScreen alone
          // just switches the view; renderDeckManagement populates the
          // grid. Skipping the render leaves the player on a blank
          // screen.
          _cb.showScreen('deck');
          if (_cb.renderDeckManagement) _cb.renderDeckManagement();
        } else if (_cb.showNewCardClassPicker) {
          _cb.showNewCardClassPicker();
        }
      });
    }

    // Share Card button — show when player has a card
    var shareBtn = document.getElementById('bs-share-card-btn');
    if (shareBtn) {
      var hasCard = _cb.getSelectedCard && _cb.getSelectedCard();
      shareBtn.style.display = hasCard ? '' : 'none';
      if (hasCard && !shareBtn._bound) {
        shareBtn._bound = true;
        shareBtn.addEventListener('click', function () {
          var card = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
          if (card && window.BsCardShare) window.BsCardShare.showShareModal(card);
        });
      }
    }
  }

  function setCallbacks(cbs) { _cb = cbs; }

  return { renderSwitcher: renderSwitcher, renderNewCardBtn: renderNewCardBtn, setCallbacks: setCallbacks };
})();
