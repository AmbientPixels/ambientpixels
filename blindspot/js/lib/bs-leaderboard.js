/* ============================================================
   bs-leaderboard.js — Power leaderboard screen
   IIFE → window.BsLeaderboard
   ============================================================ */
(function () {
  'use strict';

  var _cb = {};

  function setCallbacks(obj) { _cb = obj || {}; }

  function renderLeaderboard() {
    var TIMEOUT = 8000;
    var container = document.getElementById('bs-leaderboard-content');
    if (!container) return;
    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> <i class="fas fa-trophy" style="color:var(--bs-accent);margin:0 0.3em;"></i>Consulting the ranks\u2026</div>';

    var escHtml = _cb.escHtml || function (s) { return String(s); };

    Promise.race([
      window.ArenaAPI.loadCards(),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT); })
    ]).then(function (data) {
      var gallery = (data && data.galleryCards) || [];

      // Sort by power (sum of stats)
      var ranked = gallery.map(function (card) {
        var power = 0;
        if (card.combatStats) {
          power = (card.combatStats.str || 0) + (card.combatStats.agi || 0) + (card.combatStats.int || 0) + (card.combatStats.end || 0) + (card.combatStats.lck || 0);
        } else if (card.stats && Array.isArray(card.stats)) {
          power = card.stats.reduce(function (s, st) { return s + (st.value || 0); }, 0);
        }
        var copy = {};
        for (var k in card) { if (card.hasOwnProperty(k)) copy[k] = card[k]; }
        copy.power = power;
        return copy;
      }).sort(function (a, b) { return b.power - a.power; }).slice(0, 20);

      if (ranked.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">No fighters yet. Be the first to publish your card.</p>';
        return;
      }

      // Check if current player is in the list
      var card = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
      var myCardId = card ? card.id : null;

      container.innerHTML = ranked.map(function (c, i) {
        var isMe = c.id === myCardId;
        var medalIcon = i === 0 ? '<i class="fas fa-crown" style="color:#FFD700;"></i>'
          : i === 1 ? '<i class="fas fa-medal" style="color:#C0C0C0;"></i>'
          : i === 2 ? '<i class="fas fa-medal" style="color:#CD7F32;"></i>' : '';
        return '<div class="bs-boss-card' + (isMe ? ' bs-boss-card--current' : '') + '" style="cursor:default;">'
          + '<span class="bs-boss-card__number" style="' + (i < 3 ? 'border-color:var(--bs-accent);color:var(--bs-accent);' : '') + '">' + (i + 1) + '</span>'
          + '<div class="bs-boss-avatar" style="width:36px;height:36px;font-size:0.9rem;">'
          + (c.avatar ? '<img src="' + escHtml(c.avatar) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '<i class="fas fa-user"></i>')
          + '</div>'
          + '<div class="bs-boss-card__info">'
          + '<div class="bs-boss-card__name">' + medalIcon + ' ' + escHtml(c.name || 'Unnamed') + (isMe ? ' <span style="color:var(--bs-accent);font-size:0.7rem;">(you)</span>' : '') + '</div>'
          + '<div class="bs-boss-card__class">' + escHtml(c.class || '') + ' &middot; ' + c.power + ' Power</div>'
          + '</div></div>';
      }).join('');
    }).catch(function (err) {
      if (err && err.message === 'timeout') {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">Could not load leaderboard. Try again later.</p>';
      } else {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-danger);">Failed to load leaderboard.</p>';
      }
    });
  }

  window.BsLeaderboard = {
    setCallbacks: setCallbacks,
    render: renderLeaderboard
  };
})();
