/**
 * bs-deck.js — Deck management screen
 * Extracted from blindspot-flow.js (Round 6)
 *
 * API: window.BsDeck
 *   .setCallbacks(cb)
 *   .render()              — renderDeckManagement()
 *   .showDeleteConfirm(id) — showDeckDeleteConfirm(cardId)
 *   .renderButton()        — renderDeckButton()
 */
(function () {
  'use strict';

  var _cb = {};
  var _deckSortMode = 'newest';
  var _deckEventsBound = false;
  var _deckDeleteTarget = null;
  var _lockInProgress = false;
  var _lockedCards = [];

  var MAX_DECK_SIZE = 8;
  var MAX_LOCKED_CARDS = 3;

  function setCallbacks(cb) { _cb = cb || {}; }

  // Helpers — resolved via callbacks
  function getDeck() { return _cb.getDeck ? _cb.getDeck() : []; }
  function getCardPower(card) { return _cb.getCardPower ? _cb.getCardPower(card) : 0; }
  function ensureCombatStats(card) { if (_cb.ensureCombatStats) _cb.ensureCombatStats(card); }
  function renderCardHTML(card, size) { return _cb.renderCardHTML ? _cb.renderCardHTML(card, size) : ''; }
  function escHtml(s) { return _cb.escHtml ? _cb.escHtml(s) : String(s); }
  function getSelectedCard() { return _cb.getSelectedCard ? _cb.getSelectedCard() : null; }
  function setActiveCard(card) { if (_cb.setActiveCard) _cb.setActiveCard(card); }
  function removeCardFromDeck(cardId) { if (_cb.removeCardFromDeck) _cb.removeCardFromDeck(cardId); }
  function showToast(msg) { if (_cb.showSuccessToast) _cb.showSuccessToast(msg); }

  function isCardLocked(cardId) { return _lockedCards.indexOf(cardId) !== -1; }

  function setLockedCards(arr) { _lockedCards = Array.isArray(arr) ? arr : []; }

  function render() {
    var deck = getDeck();
    var grid = document.getElementById('bs-deck-grid');
    var countEl = document.getElementById('bs-deck-count');
    if (!grid) return;

    if (countEl) countEl.textContent = deck.length + ' / ' + MAX_DECK_SIZE;

    // Sort
    var sorted = deck.slice();
    if (_deckSortMode === 'power') {
      sorted.sort(function(a, b) { return getCardPower(b) - getCardPower(a); });
    } else if (_deckSortMode === 'class') {
      sorted.sort(function(a, b) {
        var ca = (a.class || a.characterClass || '').toLowerCase();
        var cb = (b.class || b.characterClass || '').toLowerCase();
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      });
    }
    // 'newest' = default array order (most recent last), reverse for newest-first
    if (_deckSortMode === 'newest') sorted.reverse();

    var selectedCard = getSelectedCard();
    var isActive = function(card) {
      return selectedCard && selectedCard.id && card.id === selectedCard.id;
    };

    grid.innerHTML = sorted.map(function(card) {
      ensureCombatStats(card);
      var name = card.name || 'Unnamed';
      var cls = card.class || card.characterClass || 'Unknown';
      var power = getCardPower(card);
      var active = isActive(card);

      // Force fullbleed in deck view for consistent display
      var deckCard = Object.assign({}, card, { design: Object.assign({}, card.design || {}, { imageContainer: 'fullbleed' }) });

      var locked = isCardLocked(card.id);
      var canDelete = deck.length > 1 && !active && !locked;
      var cardClasses = 'bs-deck-card' + (active ? ' bs-deck-card--active' : '') + (locked ? ' bs-deck-card--locked' : '');

      return '<div class="' + cardClasses + '" data-card-id="' + escHtml(card.id) + '" role="listitem" tabindex="0" aria-label="' + escHtml(name) + ', ' + escHtml(cls) + ', Power ' + power + (active ? ', currently active' : '') + (locked ? ', locked' : '') + '">' +
        renderCardHTML(deckCard, 'compact') +
        (active ? '<div class="bs-deck-card__badge"><i class="fas fa-check-circle" aria-hidden="true"></i> Active</div>' : '') +
        (locked ? '<div class="bs-deck-card__lock-badge"><i class="fas fa-lock" aria-hidden="true"></i></div>' : '') +
        (!active ? '<button class="bs-deck-card__lock-toggle' + (locked ? ' bs-deck-card__lock-toggle--locked' : '') + '" data-lock-id="' + escHtml(card.id) + '" aria-label="' + (locked ? 'Unlock' : 'Lock') + ' ' + escHtml(name) + '"><i class="fas ' + (locked ? 'fa-lock' : 'fa-lock-open') + '"></i></button>' : '') +
        (canDelete ? '<button class="bs-deck-card__delete" data-delete-id="' + escHtml(card.id) + '" aria-label="Delete ' + escHtml(name) + '"><i class="fas fa-trash" aria-hidden="true"></i></button>' : '') +
      '</div>';
    }).join('');

    // Append ghost cards (lost in wager)
    var _W = window.BsWager || {};
    if (_W.detectGhostCards) {
      var ghosts = _W.detectGhostCards([], deck);
      if (ghosts.length > 0 && _W.renderGhostCard) {
        grid.innerHTML += ghosts.map(function(g) { return _W.renderGhostCard(g); }).join('');
      }
    }

    // Bind events (once)
    if (!_deckEventsBound) {
      _deckEventsBound = true;

      // Sort buttons
      document.querySelectorAll('.bs-deck-sort__btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          _deckSortMode = btn.dataset.sort || 'newest';
          document.querySelectorAll('.bs-deck-sort__btn').forEach(function(b) {
            b.classList.toggle('bs-deck-sort__btn--active', b.dataset.sort === _deckSortMode);
          });
          render();
        });
      });
    }

    // Card click = set active (delegated)
    grid.onclick = function(e) {
      var ghostDismiss = e.target.closest('[data-dismiss-ghost]');
      if (ghostDismiss) {
        e.stopPropagation();
        var ghostId = ghostDismiss.dataset.dismissGhost;
        if (window.BsWager && window.BsWager.dismissGhost) window.BsWager.dismissGhost(ghostId);
        var ghostEl = ghostDismiss.closest('.bs-deck-card--ghost');
        if (ghostEl) ghostEl.remove();
        return;
      }

      var lockBtn = e.target.closest('.bs-deck-card__lock-toggle');
      if (lockBtn) {
        e.stopPropagation();
        toggleLock(lockBtn.dataset.lockId);
        return;
      }

      var deleteBtn = e.target.closest('.bs-deck-card__delete');
      if (deleteBtn) {
        e.stopPropagation();
        var deleteId = deleteBtn.dataset.deleteId;
        showDeleteConfirm(deleteId);
        return;
      }

      var cardEl = e.target.closest('.bs-deck-card');
      if (!cardEl) return;
      var cardId = cardEl.dataset.cardId;
      if (!cardId) return;

      var targetCard = deck.find(function(c) { return c.id === cardId; });
      if (!targetCard) return;

      // Delegate card selection to monolith (modifies _selectedCard + syncs)
      setActiveCard(targetCard);

      // Swap active state in-place instead of re-rendering the entire grid
      grid.querySelectorAll('.bs-deck-card').forEach(function(el) {
        var isAct = el.dataset.cardId === cardId;
        el.classList.toggle('bs-deck-card--active', isAct);
        // Update badge
        var existingBadge = el.querySelector('.bs-deck-card__badge');
        var existingDelete = el.querySelector('.bs-deck-card__delete');
        if (isAct) {
          if (!existingBadge) {
            var badge = document.createElement('div');
            badge.className = 'bs-deck-card__badge';
            badge.innerHTML = '<i class="fas fa-check-circle" aria-hidden="true"></i> Active';
            el.appendChild(badge);
          }
          if (existingDelete) existingDelete.remove();
        } else {
          if (existingBadge) existingBadge.remove();
          if (!existingDelete && getDeck().length > 1) {
            var delBtn = document.createElement('button');
            delBtn.className = 'bs-deck-card__delete';
            delBtn.dataset.deleteId = el.dataset.cardId;
            delBtn.setAttribute('aria-label', 'Delete card');
            delBtn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i>';
            el.appendChild(delBtn);
          }
        }
      });
    };
  }

  async function toggleLock(cardId) {
    if (_lockInProgress) return;
    var locked = isCardLocked(cardId);
    var action = locked ? 'unlock' : 'lock';

    // Client-side check before API call
    if (!locked && _lockedCards.length >= MAX_LOCKED_CARDS) {
      showToast('Cannot lock more than ' + MAX_LOCKED_CARDS + ' cards. Unlock one first.');
      return;
    }

    _lockInProgress = true;
    try {
      var result = await window.ArenaAPI.lockCard(cardId, action);
      _lockedCards = result.lockedCards || [];
      render();
      showToast(action === 'lock' ? 'Card locked' : 'Card unlocked');
    } catch (err) {
      showToast('Lock failed: ' + (err.message || 'Unknown error'));
    } finally {
      _lockInProgress = false;
    }
  }

  function showDeleteConfirm(cardId) {
    var deck = getDeck();
    var card = deck.find(function(c) { return c.id === cardId; });
    if (!card) return;

    // Don't delete if only 1 card or if active
    if (deck.length <= 1) return;
    var selectedCard = getSelectedCard();
    if (selectedCard && selectedCard.id === cardId) return;

    _deckDeleteTarget = cardId;

    // Create confirmation overlay
    var existing = document.getElementById('bs-deck-delete-confirm');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'bs-deck-delete-confirm';
    overlay.className = 'bs-deck-confirm-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-label', 'Delete card confirmation');
    overlay.innerHTML =
      '<div class="bs-deck-confirm">' +
        '<h3 class="bs-deck-confirm__title">Delete Card?</h3>' +
        '<p class="bs-deck-confirm__text">Are you sure you want to delete <strong>' + escHtml(card.name || 'this card') + '</strong>? This cannot be undone.</p>' +
        '<div class="bs-deck-confirm__actions">' +
          '<button class="bs-btn bs-btn--secondary" id="bs-deck-delete-cancel" aria-label="Cancel">Cancel</button>' +
          '<button class="bs-btn bs-deck-confirm__delete-btn" id="bs-deck-delete-yes" aria-label="Delete card">Delete</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('bs-deck-delete-cancel').addEventListener('click', function() {
      overlay.remove();
      _deckDeleteTarget = null;
    });

    document.getElementById('bs-deck-delete-yes').addEventListener('click', function() {
      removeCardFromDeck(_deckDeleteTarget);
      overlay.remove();
      _deckDeleteTarget = null;
      render();
    });

    // Backdrop click = cancel
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        overlay.remove();
        _deckDeleteTarget = null;
      }
    });
  }

  function renderButton() {
    var btn = document.getElementById('bs-btn-deck');
    if (!btn) return;
    var deck = getDeck();
    btn.style.display = deck.length > 1 ? '' : 'none';
  }

  window.BsDeck = {
    setCallbacks: setCallbacks,
    setLockedCards: setLockedCards,
    render: render,
    showDeleteConfirm: showDeleteConfirm,
    renderButton: renderButton
  };
})();
