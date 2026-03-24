/**
 * bs-card-rarity.js — Card rarity system based on forge visit count
 * window.BsCardRarity
 */
(function() {
  'use strict';

  var _C = window.BsConst || {};
  var CARD_RARITIES = _C.CARD_RARITIES || [];
  var _cb = {};

  function getCardRarity() {
    var visits = _cb.getForgeVisitCount ? _cb.getForgeVisitCount() : 0;
    var rarity = CARD_RARITIES[0];
    for (var i = CARD_RARITIES.length - 1; i >= 0; i--) {
      if (visits >= CARD_RARITIES[i].forges) {
        rarity = CARD_RARITIES[i];
        break;
      }
    }
    return rarity;
  }

  function getNextRarity() {
    var visits = _cb.getForgeVisitCount ? _cb.getForgeVisitCount() : 0;
    for (var i = 0; i < CARD_RARITIES.length; i++) {
      if (visits < CARD_RARITIES[i].forges) {
        return { rarity: CARD_RARITIES[i], forgesNeeded: CARD_RARITIES[i].forges - visits };
      }
    }
    return null;
  }

  function renderRarityBadge() {
    var rarity = getCardRarity();
    return '<span class="bs-rarity-badge bs-rarity-badge--' + rarity.id + '">'
      + '<i class="fas ' + rarity.icon + '"></i> ' + rarity.name
      + '</span>';
  }

  window.BsCardRarity = {
    getCardRarity: getCardRarity,
    getNextRarity: getNextRarity,
    renderRarityBadge: renderRarityBadge,
    setCallbacks: function(cbs) { _cb = cbs || {}; }
  };
})();
