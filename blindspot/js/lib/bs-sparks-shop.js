/**
 * bs-sparks-shop.js — Sparks shop UI (Ember Crates + Consumables)
 * window.BsSparksShop
 */
(function() {
  'use strict';

  var _cb = {};
  var _crateBound = false;
  var _itemsBound = false;

  // Consumable shop items with Spark prices
  var SHOP_ITEMS = [
    { id: 'stamina_potion',       name: 'Stamina Potion',     icon: 'fa-bolt',           cost: 10, desc: 'Restore 5 stamina mid-fight' },
    { id: 'endurance_tonic',      name: 'Endurance Tonic',    icon: 'fa-dumbbell',       cost: 15, desc: '+3 max stamina for this fight' },
    { id: 'second_wind',          name: 'Second Wind',        icon: 'fa-wind',           cost: 20, desc: 'Auto-restore stamina at exhaustion' },
    { id: 'element_ward',         name: 'Element Ward',       icon: 'fa-shield-halved',  cost: 15, desc: 'Negate weakness for 3 rounds' },
    { id: 'element_burst',        name: 'Element Burst',      icon: 'fa-burst',          cost: 25, desc: 'Next elemental hit +50% bonus' },
    { id: 'element_shift',        name: 'Element Shift',      icon: 'fa-rotate',         cost: 25, desc: 'Shift to counter opponent element' },
    { id: 'prism_shard',          name: 'Prism Shard',        icon: 'fa-gem',            cost: 35, desc: 'Become element-neutral' },
    { id: 'charm_resist_fire',    name: 'Fire Ward Charm',    icon: 'fa-fire',           cost: 20, desc: '-15% Fire damage taken' },
    { id: 'charm_resist_earth',   name: 'Earth Ward Charm',   icon: 'fa-mountain',       cost: 20, desc: '-15% Earth damage taken' },
    { id: 'charm_resist_arcane',  name: 'Arcane Ward Charm',  icon: 'fa-hat-wizard',     cost: 20, desc: '-15% Arcane damage taken' },
    { id: 'charm_resist_shadow',  name: 'Shadow Ward Charm',  icon: 'fa-ghost',          cost: 20, desc: '-15% Shadow damage taken' }
  ];

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

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
    if (!_crateBound && btn) {
      _crateBound = true;
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

    // Render consumable item grid
    renderItemShop(sparks);
  }

  function renderItemShop(sparks) {
    var container = document.getElementById('bs-item-shop');
    if (!container) return;
    container.style.display = sparks > 0 ? '' : 'none';

    // Only build HTML once, then just update disabled states
    if (!_itemsBound) {
      _itemsBound = true;
      var html = '<p style="font-size:0.7rem; color:var(--bs-text-muted); margin-bottom:0.4rem;"><i class="fas fa-box-open"></i> Buy consumables:</p>'
        + '<div class="bs-item-shop-grid">';
      SHOP_ITEMS.forEach(function(item) {
        html += '<button class="bs-shop-item" data-shop-id="' + escHtml(item.id) + '"'
          + ' title="' + escHtml(item.desc) + '"'
          + ' aria-label="Buy ' + escHtml(item.name) + ' for ' + item.cost + ' Sparks">'
          + '<i class="fas ' + item.icon + '"></i>'
          + '<span class="bs-shop-item__name">' + escHtml(item.name) + '</span>'
          + '<span class="bs-shop-item__cost"><i class="fas fa-fire"></i>' + item.cost + '</span>'
          + '</button>';
      });
      html += '</div>';
      container.innerHTML = html;

      // Bind click handlers
      container.querySelectorAll('.bs-shop-item').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.dataset.shopId;
          var def = SHOP_ITEMS.find(function(i) { return i.id === id; });
          if (!def) return;
          var curSparks = _cb.getSparks ? _cb.getSparks() : 0;
          if (curSparks < def.cost) {
            if (_cb.toast) _cb.toast('Not enough Sparks! Need ' + def.cost + '.');
            return;
          }
          if (_cb.spendSparks) _cb.spendSparks(def.cost);
          if (_cb.addToInventory) _cb.addToInventory(id);
          if (_cb.toast) _cb.toast(def.name + ' purchased!');
          render();
        });
      });
    }

    // Update disabled state
    container.querySelectorAll('.bs-shop-item').forEach(function(btn) {
      var id = btn.dataset.shopId;
      var def = SHOP_ITEMS.find(function(i) { return i.id === id; });
      btn.disabled = !def || sparks < def.cost;
    });
  }

  window.BsSparksShop = {
    render: render,
    setCallbacks: function(cbs) { _cb = cbs || {}; }
  };
})();
