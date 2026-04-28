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

    var avatar = card.avatar
      || (card.cardData && card.cardData.avatar)
      || (card.design && card.design.avatar)
      || '';

    // Card-up-front treatment: render the full forged card with its own
    // chrome (border, name plate, info bar, power) so the player reads
    // their build at a glance. The atmospheric backdrop layer (set
    // below) shows the character art behind it as a blurred halo.
    if (typeof _cb.renderCardHTML === 'function') {
      playerCard.innerHTML = _cb.renderCardHTML(card, 'full');
      // Relocate the dynamic buff strip into the rendered card AT THE
      // BOTTOM (after the power footer) so the stack reads: art → info
      // → stats → power → buffs. Buffs sit at the very bottom of the
      // card, mirroring how boss traits anchor the bottom of the boss
      // card. IDs stay intact — every writer targets by id.
      var renderedCard = playerCard.querySelector('.bs-rendered-card');
      if (renderedCard) {
        var buffsEl = document.getElementById('arena-player-buffs');
        if (buffsEl) renderedCard.appendChild(buffsEl);
      }
      // Relocate the equipped item tray (charms + adventure / inventory
      // items the player brought into this fight) from the frame's
      // right-edge vertical strip into a horizontal strip in the panel
      // space below the card. Same #arena-player-item-tray id, so the
      // existing writers (BsCharms.addCharmButtonToBattle /
      // addItemButtonsToBattle) keep working without changes.
      var panel = document.getElementById('arena-player-side');
      var itemTray = document.getElementById('arena-player-item-tray');
      if (panel && itemTray) panel.appendChild(itemTray);
      playerCard.style.backgroundImage = '';
    } else if (avatar) {
      // Fallback when the card renderer isn't loaded — older avatar fill.
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
    playerCard.style.overflow = 'visible';
    playerCard.style.width = '100%';
    playerCard.style.height = '100%';

    // Atmospheric backdrop — full-bleed blurred copy of the card avatar
    // behind the foreground card. CSS handles the blur/saturate/opacity
    // so the background-image is the only thing JS has to set.
    var backdrop = document.getElementById('arena-player-backdrop');
    if (backdrop) {
      if (avatar) {
        backdrop.style.backgroundImage = 'url("' + String(avatar).replace(/"/g, '\\"') + '")';
      } else {
        backdrop.style.backgroundImage = '';
      }
    }
  }

  function setCallbacks(cbs) { _cb = cbs; }

  return { apply: apply, setCallbacks: setCallbacks };
})();
