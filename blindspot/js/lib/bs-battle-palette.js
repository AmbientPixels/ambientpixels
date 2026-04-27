/**
 * Blindspot Battle Card Palette
 *
 * Renders the player's card in the battle combatant slot.
 *
 * API: window.BsBattlePalette
 *   .apply()                — render compact card into arena-player-card
 *   .setCallbacks({ getSelectedCard, renderCardHTML })
 */
window.BsBattlePalette = (function () {
  'use strict';

  var _cb = {};

  function apply() {
    var card = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
    if (!card) return;

    var playerCard = document.getElementById('arena-player-card');
    if (!playerCard) return;

    // Bundle-aligned: clean character portrait, no card chrome.
    // Avoid renderCardHTML — it inserts a full card with its own border /
    // info / power bar that reads as a frame around the avatar. We just
    // want the raw character art filling the combatant frame.
    var avatar = card.avatar
      || (card.cardData && card.cardData.avatar)
      || (card.design && card.design.avatar)
      || '';

    if (avatar) {
      playerCard.innerHTML = '';
      playerCard.style.backgroundImage = 'url("' + String(avatar).replace(/"/g, '\\"') + '")';
      playerCard.style.backgroundSize = 'cover';
      playerCard.style.backgroundPosition = 'center top';
      playerCard.style.backgroundRepeat = 'no-repeat';
    } else {
      playerCard.innerHTML = '<div class="arena-combatant__placeholder"><i class="fas fa-user-shield"></i></div>';
      playerCard.style.backgroundImage = '';
    }
    playerCard.style.border = 'none';
    playerCard.style.overflow = 'hidden';
    playerCard.style.width = '100%';
    playerCard.style.height = '100%';
  }

  function setCallbacks(cbs) { _cb = cbs; }

  return { apply: apply, setCallbacks: setCallbacks };
})();
