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
    if (playerCard) {
      var renderCardHTML = _cb.renderCardHTML;
      if (renderCardHTML) {
        playerCard.innerHTML = renderCardHTML(card, 'compact');
      }
      playerCard.style.overflow = 'hidden';
      playerCard.style.border = 'none';
      playerCard.style.background = 'none';
    }
  }

  function setCallbacks(cbs) { _cb = cbs; }

  return { apply: apply, setCallbacks: setCallbacks };
})();
