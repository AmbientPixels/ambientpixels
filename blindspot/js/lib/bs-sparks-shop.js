/**
 * bs-sparks-shop.js — Sparks shop UI (buy Ember Crates)
 * window.BsSparksShop
 */
(function() {
  'use strict';

  var _cb = {};
  var _bound = false;

  function render() {
    var shop = document.getElementById('bs-sparks-shop');
    var btn = document.getElementById('bs-buy-ember-crate');
    if (!shop) return;
    var sparks = _cb.getSparks ? _cb.getSparks() : 0;
    var cost = 50;
    shop.style.display = sparks > 0 ? '' : 'none';
    if (btn) {
      btn.disabled = sparks < cost;
      btn.setAttribute('aria-label', 'Buy Ember Crate for ' + cost + ' Sparks' + (sparks < cost ? ' (not enough Sparks)' : ''));
    }
    if (!_bound && btn) {
      _bound = true;
      btn.addEventListener('click', function() {
        var curSparks = _cb.getSparks ? _cb.getSparks() : 0;
        if (curSparks < cost) {
          if (_cb.toast) _cb.toast('Not enough Sparks! Need ' + cost + '.');
          return;
        }
        if (_cb.spendSparks) _cb.spendSparks(cost);
        if (_cb.awardCrate) _cb.awardCrate('ember');
        render();
        var sparksSpan = document.querySelector('.bs-hud-sparks');
        if (sparksSpan) sparksSpan.innerHTML = '<i class="fas fa-fire"></i> ' + (_cb.getSparks ? _cb.getSparks() : 0) + ' sparks';
      });
    }
  }

  window.BsSparksShop = {
    render: render,
    setCallbacks: function(cbs) { _cb = cbs || {}; }
  };
})();
