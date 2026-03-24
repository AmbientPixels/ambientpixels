/**
 * bs-class-picker.js — New card class picker, creation, and forge open
 * window.BsClassPicker
 */
(function() {
  'use strict';

  var _cb = {};

  var NEW_CARD_CLASS_STATS = {
    Fighter:   { str: 90, agi: 55, int: 35, end: 80, lck: 40 },
    Caster:    { str: 35, agi: 45, int: 95, end: 40, lck: 85 },
    Rogue:     { str: 55, agi: 90, int: 60, end: 50, lck: 45 },
    Guardian:  { str: 65, agi: 35, int: 45, end: 95, lck: 60 },
    Trickster: { str: 45, agi: 65, int: 55, end: 45, lck: 90 }
  };

  var NEW_CARD_DEFAULT_AVATARS = {
    Fighter:   '/blindspot/img/demo/demo-knight.webp',
    Caster:    '/blindspot/img/demo/demo-mage.webp',
    Rogue:     '/blindspot/img/demo/demo-rogue.webp',
    Guardian:  '/blindspot/img/demo/demo-knight.webp',
    Trickster: '/blindspot/img/demo/demo-mage.webp'
  };

  var NEW_CARD_CLASSES = [
    { id: 'Fighter',   icon: 'fa-hand-fist',           label: 'Fighter',   desc: 'Power Strike \u2014 raw STR damage' },
    { id: 'Caster',    icon: 'fa-wand-magic-sparkles', label: 'Caster',    desc: 'Arcane Blast \u2014 INT + Vulnerable' },
    { id: 'Rogue',     icon: 'fa-user-ninja',          label: 'Rogue',     desc: 'Shadow Strike \u2014 always first' },
    { id: 'Guardian',  icon: 'fa-shield-halved',       label: 'Guardian',  desc: 'Fortify \u2014 heal + defense' },
    { id: 'Trickster', icon: 'fa-dice',                label: 'Trickster', desc: 'Wild Card \u2014 high risk, high reward' }
  ];

  function show() {
    var existing = document.querySelector('.bs-class-picker-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'bs-overlay bs-class-picker-overlay';
    overlay.innerHTML =
      '<h2 style="font-family:Cinzel,serif;color:var(--bs-accent);margin-bottom:0.5rem;font-size:1.2rem;">Choose a Class</h2>' +
      '<p style="color:var(--bs-text-muted);font-size:0.8rem;margin-bottom:1rem;">Pick your fighting style. You\'ll customize in the Forge.</p>' +
      '<div class="bs-class-picker-grid">' +
      NEW_CARD_CLASSES.map(function(c) {
        return '<button class="bs-btn bs-btn--secondary bs-class-picker-btn" data-class="' + c.id + '">' +
          '<i class="fas ' + c.icon + '" style="font-size:1.2rem;color:var(--bs-accent);"></i>' +
          '<strong>' + c.label + '</strong>' +
          '<span style="font-size:0.7rem;color:var(--bs-text-muted);">' + c.desc + '</span>' +
          '</button>';
      }).join('') +
      '</div>' +
      '<button class="bs-btn bs-btn--secondary" id="bs-class-picker-cancel" style="margin-top:1rem;font-size:0.8rem;">Cancel</button>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.style.opacity = '1'; });

    overlay.querySelector('#bs-class-picker-cancel').addEventListener('click', function() {
      overlay.remove();
    });

    overlay.querySelectorAll('.bs-class-picker-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var chosenClass = btn.getAttribute('data-class');
        var stats = NEW_CARD_CLASS_STATS[chosenClass];
        btn.disabled = true;
        btn.innerHTML = '<span class="bs-spinner" style="display:inline-block;width:14px;height:14px;"></span> Creating\u2026';

        var defaultAvatar = NEW_CARD_DEFAULT_AVATARS[chosenClass] || '/blindspot/img/demo/demo-knight.webp';
        var statsCopy = {};
        for (var s in stats) { if (stats.hasOwnProperty(s)) statsCopy[s] = stats[s]; }

        window.BlindspotSaveCard.save(
          { cardName: chosenClass, cardClass: chosenClass, cardRarity: 'Common', imageContainer: 'masked', artworkUrl: defaultAvatar },
          statsCopy
        ).then(function(cardId) {
          return window.ArenaAPI.loadCards().then(function(data) {
            var cards = data.userCards || [];
            if (_cb.addCardsToDeck) _cb.addCardsToDeck(cards);
            if (_cb.setSelectedCardId) _cb.setSelectedCardId(cardId);
            if (_cb.safeLSSet) _cb.safeLSSet('bs-selected-card-id', cardId);
            return window.ArenaAPI.selectCard(cardId).catch(function() {}).then(function() {
              var newCard = null;
              for (var i = 0; i < cards.length; i++) {
                if (cards[i].id === cardId) { newCard = cards[i]; break; }
              }
              if (newCard && _cb.setSelectedCard) {
                newCard.combatStats = newCard.combatStats || stats;
                _cb.setSelectedCard(newCard);
              }
              overlay.remove();
              if (_cb.renderLobby) _cb.renderLobby();
              if (_cb.openForgeScreen) _cb.openForgeScreen(true);
            });
          });
        }).catch(function(e) {
          console.error('[Blindspot] New card creation failed:', e);
          if (_cb.showErrorToast) _cb.showErrorToast('Could not create card: ' + (e.message || 'Unknown error'));
          btn.disabled = false;
          var cls = null;
          for (var i = 0; i < NEW_CARD_CLASSES.length; i++) {
            if (NEW_CARD_CLASSES[i].id === chosenClass) { cls = NEW_CARD_CLASSES[i]; break; }
          }
          btn.innerHTML = '<i class="fas ' + (cls ? cls.icon : 'fa-question') + '" style="font-size:1.2rem;color:var(--bs-accent);"></i><strong>' + chosenClass + '</strong>';
        });
      });
    });
  }

  window.BsClassPicker = {
    show: show,
    NEW_CARD_CLASS_STATS: NEW_CARD_CLASS_STATS,
    setCallbacks: function(cbs) { _cb = cbs || {}; }
  };
})();
