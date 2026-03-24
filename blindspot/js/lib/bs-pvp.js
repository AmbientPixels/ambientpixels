/**
 * bs-pvp.js — PvP gallery, opponent comparison, Elo rating display, rank badges.
 * Extracted from blindspot-flow.js (Round 4.1).
 */
(function () {
  'use strict';

  var _C = window.BsConst || {};
  var ELO_DEFAULT = _C.ELO_DEFAULT;
  var ELO_K = _C.ELO_K;
  var PVP_RANKS = _C.PVP_RANKS;

  var _S = window.BsState || {};
  var _progress = _S.progress;

  // Module-local gallery cache
  var _pvpGallery = [];

  // ── Elo helpers ──

  function getPvPElo() { return _progress.pvpElo; }
  function setPvPElo(v) { _progress.pvpElo = Math.max(0, Math.round(v)); }
  function getPvPRecord() { return _progress.pvpRecord; }
  function setPvPRecord(rec) { _progress.pvpRecord = rec; }

  function getPvPRank(elo) {
    for (var i = PVP_RANKS.length - 1; i >= 0; i--) {
      if (elo >= PVP_RANKS[i].min) return PVP_RANKS[i];
    }
    return PVP_RANKS[0];
  }

  function estimateOpponentElo(card) {
    var power = _cb.getCardPower ? _cb.getCardPower(card) : 0;
    return Math.min(1600, Math.max(800, Math.round(power * 4 + 600)));
  }

  function calcEloChange(playerElo, opponentElo, won) {
    var expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
    var score = won ? 1 : 0;
    return Math.round(ELO_K * (score - expected));
  }

  // ── Elo change toast ──

  function showEloChange(changeText, color, rankUp) {
    var toast = document.createElement('div');
    toast.className = 'bs-elo-toast';
    toast.innerHTML = '<span class="bs-elo-toast__change" style="color:' + color + ';">' + changeText + ' Elo</span>' +
      (rankUp ? '<span class="bs-elo-toast__rankup" style="color:' + rankUp.color + ';"><i class="fas ' + rankUp.icon + '"></i> Promoted to ' + rankUp.name + '!</span>' : '');
    document.body.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('bs-elo-toast--visible'); });
    setTimeout(function() {
      toast.classList.remove('bs-elo-toast--visible');
      setTimeout(function() { toast.remove(); }, 400);
    }, 3000);
  }

  // ── Callbacks injected by monolith ──

  var _cb = {};

  function setCallbacks(cbs) { _cb = cbs || {}; }

  function escHtml(s) { return _cb.escHtml ? _cb.escHtml(s) : String(s || ''); }

  // ── PvP Rating Display ──

  function updatePvPRatingDisplay() {
    var el = document.getElementById('bs-pvp-rating');
    if (!el) return;
    var elo = getPvPElo();
    var rank = getPvPRank(elo);
    var rec = getPvPRecord();
    var nextRank = PVP_RANKS[PVP_RANKS.indexOf(rank) + 1];
    var progressHtml = '';
    if (nextRank) {
      var pct = Math.min(100, Math.max(0, ((elo - rank.min) / (nextRank.min - rank.min)) * 100));
      progressHtml = '<div class="bs-pvp-progress"><div class="bs-pvp-progress__fill" style="width:' + pct + '%;background:' + rank.color + ';"></div></div>' +
        '<span class="bs-pvp-next">' + nextRank.name + ' at ' + nextRank.min + '</span>';
    }
    el.innerHTML =
      '<div class="bs-pvp-rank-badge" style="color:' + rank.color + ';">' +
        '<i class="fas ' + rank.icon + '"></i> ' + rank.name +
      '</div>' +
      '<div class="bs-pvp-elo">' + elo + ' Elo</div>' +
      '<div class="bs-pvp-record">' + rec.w + 'W / ' + rec.l + 'L</div>' +
      progressHtml;
  }

  // ── PvP Gallery ──

  async function renderPvPGallery() {
    var container = document.getElementById('bs-pvp-grid');
    if (!container) return;

    updatePvPRatingDisplay();

    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> <i class="fas fa-binoculars" style="color:var(--bs-accent);margin:0 0.3em;"></i>Scouting the arena\u2026</div>';

    try {
      var data;
      try {
        data = await Promise.race([
          window.ArenaAPI.loadCards(),
          new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 8000); })
        ]);
      } catch (timeoutErr) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">Could not load gallery. Try again later.</p>';
        return;
      }
      var gallery = (data.galleryCards || []).filter(function(c) {
        return c.combatStats || (c.cardData && c.cardData.combatStats);
      });

      if (gallery.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">No challengers available yet. Other players\u2019 Blindspot cards will appear here.</p>';
        return;
      }

      _pvpGallery = gallery;
      container.innerHTML = gallery.map(function(card) {
        var oppElo = estimateOpponentElo(card);
        var oppRank = getPvPRank(oppElo);
        return '<div class="bs-boss-card" style="cursor:pointer;">' +
          '<div class="bs-boss-avatar" style="width:36px;height:36px;font-size:0.9rem;">' +
            (card.avatar ? '<img src="' + escHtml(card.avatar) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '<i class="fas fa-user"></i>') +
          '</div>' +
          '<div class="bs-boss-card__info">' +
            '<div class="bs-boss-card__name">' + escHtml(card.name || 'Unnamed') + '</div>' +
            '<div class="bs-boss-card__class">' + escHtml(card.class || '') + ' <span class="bs-pvp-opp-elo" style="color:' + oppRank.color + ';"><i class="fas ' + oppRank.icon + '"></i> ' + oppElo + '</span></div>' +
          '</div>' +
          '<div class="bs-boss-card__action">' +
            '<button class="bs-btn" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-pvp="' + card.id + '">Challenge</button>' +
          '</div>' +
        '</div>';
      }).join('');

      container.querySelectorAll('[data-fight-pvp]').forEach(function(btn) {
        btn.addEventListener('click', function() { showPvPComparison(btn.dataset.fightPvp); });
      });
    } catch (err) {
      container.innerHTML = '<p style="text-align:center; color:var(--bs-danger);">Failed to load gallery.</p>';
    }
  }

  // ── PvP Comparison Overlay ──

  function showPvPComparison(opponentId) {
    var selectedCard = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
    if (!selectedCard) return;
    var opponent = _pvpGallery.find(function(c) { return c.id === opponentId; });
    if (!opponent) { if (_cb.startPvPBattle) _cb.startPvPBattle(opponentId); return; }

    if (_cb.ensureCombatStats) { _cb.ensureCombatStats(selectedCard); _cb.ensureCombatStats(opponent); }

    var oppElo = estimateOpponentElo(opponent);
    var oppRank = getPvPRank(oppElo);
    var oppName = opponent.name || 'Challenger';
    var oppClass = opponent.class || '';

    var titleEl = document.getElementById('bs-prefight-title');
    var flavorEl = document.getElementById('bs-prefight-flavor');
    var avatarEl = document.getElementById('bs-prefight-avatar');
    if (titleEl) titleEl.textContent = oppName;
    if (flavorEl) flavorEl.innerHTML = (oppClass ? '<span style="font-size:0.85rem;color:var(--bs-text-muted);">' + escHtml(oppClass) + '</span><br>' : '') +
      '<span style="font-size:0.8rem;color:' + oppRank.color + ';"><i class="fas ' + oppRank.icon + '"></i> ' + oppRank.name + ' &middot; ' + oppElo + ' Elo</span>';
    if (avatarEl) {
      if (opponent.avatar) {
        avatarEl.innerHTML = '<img src="' + escHtml(opponent.avatar) + '" alt="' + escHtml(oppName) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        avatarEl.style.width = '96px';
        avatarEl.style.height = '96px';
      } else {
        avatarEl.innerHTML = '<i class="fas fa-user"></i>';
        avatarEl.style.width = '64px';
        avatarEl.style.height = '64px';
      }
    }

    // Stat comparison
    var compEl = document.getElementById('bs-prefight-comparison');
    if (compEl) {
      var ps = selectedCard.combatStats || {};
      var os = opponent.combatStats || {};
      var labels = [
        { key: 'str', label: 'STR', icon: 'fa-fist-raised' },
        { key: 'agi', label: 'AGI', icon: 'fa-wind' },
        { key: 'int', label: 'INT', icon: 'fa-brain' },
        { key: 'end', label: 'END', icon: 'fa-shield-alt' },
        { key: 'lck', label: 'LCK', icon: 'fa-dice' }
      ];
      compEl.innerHTML =
        '<div class="bs-prefight-comparison__header">' +
          '<span class="bs-prefight-comparison__you">You</span>' +
          '<span class="bs-prefight-comparison__vs">VS</span>' +
          '<span class="bs-prefight-comparison__boss">' + escHtml(oppName) + '</span>' +
        '</div>' +
        labels.map(function(s) {
          var pv = ps[s.key] || 0;
          var ov = os[s.key] || 0;
          var diff = pv - ov;
          var diffClass = diff > 0 ? 'bs-stat-advantage' : diff < 0 ? 'bs-stat-disadvantage' : 'bs-stat-even';
          return '<div class="bs-prefight-stat-row">' +
            '<span class="bs-prefight-stat-row__pval">' + pv + '</span>' +
            '<div class="bs-prefight-stat-row__bar">' +
              '<div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--player" style="width:' + pv + '%"></div>' +
            '</div>' +
            '<span class="bs-prefight-stat-row__label"><i class="fas ' + s.icon + '"></i> ' + s.label + '</span>' +
            '<div class="bs-prefight-stat-row__bar">' +
              '<div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--boss" style="width:' + ov + '%"></div>' +
            '</div>' +
            '<span class="bs-prefight-stat-row__bval ' + diffClass + '">' + ov + '</span>' +
          '</div>';
        }).join('');
    }

    if (_cb.showOverlay) _cb.showOverlay('bs-prefight-overlay');
    if (_cb.renderCharmSelector) _cb.renderCharmSelector();

    // Wire fight button to PvP battle (clone to remove old handlers)
    var oldBtn = document.getElementById('bs-prefight-go');
    if (!oldBtn || !oldBtn.parentNode) return;
    var freshBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(freshBtn, oldBtn);
    freshBtn.addEventListener('click', function() {
      if (_cb.hideOverlay) _cb.hideOverlay('bs-prefight-overlay');
      if (_cb.startPvPBattle) _cb.startPvPBattle(opponentId);
    }, { once: true });
  }

  // ── Public API ──

  window.BsPvp = {
    renderGallery: renderPvPGallery,
    updateRatingDisplay: updatePvPRatingDisplay,
    showComparison: showPvPComparison,
    showEloChange: showEloChange,
    getGallery: function() { return _pvpGallery; },
    getPvPElo: getPvPElo,
    setPvPElo: setPvPElo,
    getPvPRecord: getPvPRecord,
    setPvPRecord: setPvPRecord,
    getPvPRank: getPvPRank,
    estimateOpponentElo: estimateOpponentElo,
    calcEloChange: calcEloChange,
    setCallbacks: setCallbacks
  };
})();
