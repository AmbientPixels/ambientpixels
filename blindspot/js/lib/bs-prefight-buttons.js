/**
 * Blindspot Pre-Fight Buttons
 *
 * Replaces the single Fight button with Adventure + Fight (or just Fight)
 * in the pre-fight overlay. Restores original button on overlay close.
 *
 * API: window.BsPrefightButtons
 *   .setup(bossId)          — wire Adventure/Fight buttons for a boss
 *   .setCallbacks({...})    — inject monolith deps
 */
window.BsPrefightButtons = (function () {
  'use strict';

  var _cb = {};

  function setup(bossId) {
    var goBtn = document.getElementById('bs-prefight-go');
    if (!goBtn || !goBtn.parentNode) return;
    var parent = goBtn.parentNode;
    var hasAdv = window.BsAdventure && window.BsAdventure.hasAdventure(bossId) &&
                 !(_cb.isWeeklyBoss && _cb.isWeeklyBoss(bossId));

    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;';

    if (hasAdv) {
      // Adventure button
      var advBtn = document.createElement('button');
      advBtn.className = 'bs-btn bs-btn--primary bs-btn--large bs-btn--glow';
      advBtn.innerHTML = '<i class="fas fa-book-open"></i> Adventure';
      wrapper.appendChild(advBtn);

      advBtn.addEventListener('click', function () {
        if (_cb.hideOverlay) _cb.hideOverlay('bs-prefight-overlay');
        var advBuffs = {};
        if (_cb.setAdventureItems) _cb.setAdventureItems([]);

        var card = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
        if (card && _cb.ensureCombatStats) _cb.ensureCombatStats(card);
        var boss = _cb.getBossById ? _cb.getBossById(bossId) : null;

        var launchOpts = {
          containerEl: document.getElementById('bs-adventure-overlay'),
          playerClass: card ? (card.class || card.characterClass || '') : '',
          bossWeakness: boss ? boss.weakness : null,
          bossName: boss ? boss.name : '',
          ascension: _cb.getAscension ? _cb.getAscension() : 0
        };

        var promise;
        try {
          promise = window.BsAdventure.launch(bossId, card ? card.combatStats : {}, launchOpts);
        } catch (e) {
          console.warn('[BS] Adventure launch error:', e);
          promise = Promise.resolve({ buffs: {}, items: [] });
        }

        promise.then(function (result) {
          advBuffs = result.buffs || {};
          if (_cb.setAdventureItems) _cb.setAdventureItems(result.items || []);
        }).catch(function (e) {
          console.warn('[BS] Adventure error:', e);
        }).then(function () {
          if (_cb.startCampaignBattle) _cb.startCampaignBattle(bossId, advBuffs);
        });
      }, { once: true });

      // Fight button (skip adventure)
      var fightBtn = document.createElement('button');
      fightBtn.className = 'bs-btn bs-btn--secondary bs-btn--large';
      fightBtn.innerHTML = '<i class="fas fa-swords"></i> Fight';
      wrapper.appendChild(fightBtn);

      fightBtn.addEventListener('click', function () {
        if (_cb.hideOverlay) _cb.hideOverlay('bs-prefight-overlay');
        if (_cb.setAdventureItems) _cb.setAdventureItems([]);
        if (_cb.startCampaignBattle) _cb.startCampaignBattle(bossId, {});
      }, { once: true });

    } else {
      // No adventure — single Fight button
      var singleBtn = document.createElement('button');
      singleBtn.className = 'bs-btn bs-btn--primary bs-btn--large bs-btn--glow';
      singleBtn.textContent = 'Fight';
      wrapper.appendChild(singleBtn);

      singleBtn.addEventListener('click', function () {
        if (_cb.hideOverlay) _cb.hideOverlay('bs-prefight-overlay');
        if (_cb.setAdventureItems) _cb.setAdventureItems([]);
        if (_cb.startCampaignBattle) _cb.startCampaignBattle(bossId, {});
      }, { once: true });
    }

    // Replace the old button with new wrapper
    parent.replaceChild(wrapper, goBtn);

    // Restore original button structure on overlay close (for next open)
    var restoreBtn = function () {
      if (wrapper.parentNode) {
        var newGoBtn = document.createElement('button');
        newGoBtn.className = 'bs-btn bs-btn--primary bs-btn--large bs-btn--glow';
        newGoBtn.id = 'bs-prefight-go';
        newGoBtn.textContent = 'Fight';
        wrapper.parentNode.replaceChild(newGoBtn, wrapper);
      }
    };

    setTimeout(function () {
      var overlay = document.getElementById('bs-prefight-overlay');
      if (!overlay) { restoreBtn(); return; }
      if (overlay.classList.contains('bs-overlay--hidden')) { restoreBtn(); return; }
      var observer = new MutationObserver(function () {
        if (overlay.classList.contains('bs-overlay--hidden')) { observer.disconnect(); restoreBtn(); }
      });
      observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
      setTimeout(function () { observer.disconnect(); }, 60000);
    }, 100);
  }

  function setCallbacks(cbs) { _cb = cbs; }

  return { setup: setup, setCallbacks: setCallbacks };
})();
