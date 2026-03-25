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

    var deckSize = _cb.getDeckSize ? _cb.getDeckSize() : 0;
    var config = _cb.getConfig ? _cb.getConfig() : null;
    var needed = config ? config.forgeVisit.winsRequired : 3;
    var forgeReady = (_cb.isForgeUnlocked && _cb.isForgeUnlocked()) ||
                     (_cb.getHighestBossDefeated && _cb.getHighestBossDefeated() >= 10) ||
                     (_cb.getForgeWins && _cb.getForgeWins() >= needed) ||
                     (_cb.isForgePending && _cb.isForgePending());
    if (!forgeReady) {
      btn.style.display = 'none';
      return;
    }

    btn.style.display = '';
    if (deckSize >= MAX_DECK_SIZE) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-layer-group" aria-hidden="true"></i> Deck Full (' + MAX_DECK_SIZE + '/' + MAX_DECK_SIZE + ')';
    } else {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> New Card';
    }

    if (!_newCardBound) {
      _newCardBound = true;
      btn.addEventListener('click', function () {
        if (_cb.showNewCardClassPicker) _cb.showNewCardClassPicker();
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
