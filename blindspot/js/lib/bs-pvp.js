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
          new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 15000); })
        ]);
      } catch (timeoutErr) {
        container.innerHTML = '<div style="text-align:center; padding:2rem;"><p style="color:var(--bs-text-muted); margin-bottom:0.75rem;">Could not load gallery.</p><button class="bs-btn bs-btn--primary" id="bs-pvp-gallery-retry" style="font-size:0.8rem; padding:0.5rem 1.2rem;"><i class="fas fa-rotate-right"></i> Retry</button></div>';
        var retryBtn = document.getElementById('bs-pvp-gallery-retry');
        if (retryBtn) retryBtn.addEventListener('click', function() { renderPvPGallery(); });
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

  // ═══════════════════════════════════════════════════════════════
  // ASYNC PVP — Defense Queue, Results Inbox, Revenge
  // ═══════════════════════════════════════════════════════════════

  var _inboxCache = [];
  var _defenseQueueCache = [];

  // ── PvP Sub-tab switching ──

  function initPvPTabs() {
    var tabs = document.querySelectorAll('[data-pvp-tab]');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = tab.dataset.pvpTab;
        tabs.forEach(function(t) {
          t.classList.toggle('bs-pvp-tab--active', t.dataset.pvpTab === target);
          t.setAttribute('aria-selected', t.dataset.pvpTab === target ? 'true' : 'false');
        });
        document.querySelectorAll('.bs-pvp-panel').forEach(function(p) {
          p.style.display = 'none';
          p.classList.remove('bs-pvp-panel--active');
        });
        var panel = document.getElementById('bs-pvp-panel-' + target);
        if (panel) { panel.style.display = ''; panel.classList.add('bs-pvp-panel--active'); }

        // Lazy-load tab content
        if (target === 'defense') renderDefensePanel();
        if (target === 'inbox') renderInboxPanel();
      });
    });
  }

  // ── Defense Queue Rendering ──

  async function renderDefenseQueue() {
    var container = document.getElementById('bs-async-queue');
    if (!container) return;

    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> Scouting defenders\u2026</div>';

    try {
      var data = await window.ArenaAPI.loadDefenseQueue();
      var queue = data.queue || [];
      _defenseQueueCache = queue;

      if (queue.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:1rem; font-size:0.85rem;">No defenders online yet. Be the first to register!</p>';
        return;
      }

      var myElo = getPvPElo();
      container.innerHTML = '<div style="font-size:0.75rem;color:var(--bs-accent);padding:0 1rem 0.3rem;"><i class="fas fa-shield-halved"></i> ' + queue.length + ' defender' + (queue.length !== 1 ? 's' : '') + ' in queue</div>' +
        queue.slice(0, 20).map(function(entry) {
          var rank = getPvPRank(entry.pvpElo || 1000);
          var eloDiff = (entry.pvpElo || 1000) - myElo;
          var diffLabel = eloDiff > 0 ? '+' + eloDiff : String(eloDiff);
          var diffColor = eloDiff > 50 ? 'var(--bs-danger)' : eloDiff < -50 ? 'var(--bs-success, #4ade80)' : 'var(--bs-text-muted)';
          return '<div class="bs-boss-card" style="cursor:pointer;">' +
            '<div class="bs-boss-avatar" style="width:36px;height:36px;font-size:0.9rem;">' +
              (entry.avatar ? '<img src="' + escHtml(entry.avatar) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '<i class="fas fa-shield-halved"></i>') +
            '</div>' +
            '<div class="bs-boss-card__info">' +
              '<div class="bs-boss-card__name">' + escHtml(entry.cardName) + ' <span style="font-size:0.7rem;color:var(--bs-text-muted);">(' + (entry.record.w || 0) + 'W/' + (entry.record.l || 0) + 'L)</span></div>' +
              '<div class="bs-boss-card__class">' + escHtml(entry.cardClass) + ' <span style="color:' + rank.color + ';font-size:0.8rem;"><i class="fas ' + rank.icon + '"></i> ' + (entry.pvpElo || 1000) + '</span> <span style="color:' + diffColor + ';font-size:0.75rem;">' + diffLabel + '</span></div>' +
            '</div>' +
            '<div class="bs-boss-card__action">' +
              '<button class="bs-btn bs-btn--sm" style="padding:0.4rem 0.8rem;font-size:0.8rem;background:var(--bs-accent);" data-async-fight="' + escHtml(entry.userId) + '"><i class="fas fa-swords"></i> Fight</button>' +
            '</div>' +
          '</div>';
        }).join('');

      container.querySelectorAll('[data-async-fight]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var defenderId = btn.dataset.asyncFight;
          var entry = _defenseQueueCache.find(function(e) { return e.userId === defenderId; });
          if (entry) showAsyncComparison(entry);
        });
      });
    } catch (err) {
      container.innerHTML = '<p style="text-align:center; color:var(--bs-danger); padding:1rem;">Failed to load defense queue.</p>';
    }
  }

  // ── Async PvP Comparison (pre-fight overlay) ──

  function showAsyncComparison(defender) {
    var selectedCard = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
    if (!selectedCard) return;
    if (_cb.ensureCombatStats) _cb.ensureCombatStats(selectedCard);

    var rank = getPvPRank(defender.pvpElo || 1000);

    var titleEl = document.getElementById('bs-prefight-title');
    var flavorEl = document.getElementById('bs-prefight-flavor');
    var avatarEl = document.getElementById('bs-prefight-avatar');
    if (titleEl) titleEl.textContent = defender.cardName;
    if (flavorEl) flavorEl.innerHTML =
      (defender.cardClass ? '<span style="font-size:0.85rem;color:var(--bs-text-muted);">' + escHtml(defender.cardClass) + '</span><br>' : '') +
      '<span style="font-size:0.8rem;color:' + rank.color + ';"><i class="fas ' + rank.icon + '"></i> ' + rank.name + ' &middot; ' + (defender.pvpElo || 1000) + ' Elo</span>' +
      '<br><span style="font-size:0.75rem;color:var(--bs-text-muted);"><i class="fas fa-shield-halved"></i> Defense: ' + (defender.record.w || 0) + 'W / ' + (defender.record.l || 0) + 'L</span>';
    if (avatarEl) {
      if (defender.avatar) {
        avatarEl.innerHTML = '<img src="' + escHtml(defender.avatar) + '" alt="' + escHtml(defender.cardName) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        avatarEl.style.width = '96px'; avatarEl.style.height = '96px';
      } else {
        avatarEl.innerHTML = '<i class="fas fa-shield-halved"></i>';
        avatarEl.style.width = '64px'; avatarEl.style.height = '64px';
      }
    }

    // Stat comparison
    var compEl = document.getElementById('bs-prefight-comparison');
    if (compEl) {
      var ps = selectedCard.combatStats || {};
      var os = defender.combatStats || {};
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
          '<span class="bs-prefight-comparison__boss">' + escHtml(defender.cardName) + '</span>' +
        '</div>' +
        labels.map(function(s) {
          var pv = ps[s.key] || 0; var ov = os[s.key] || 0;
          var diff = pv - ov;
          var diffClass = diff > 0 ? 'bs-stat-advantage' : diff < 0 ? 'bs-stat-disadvantage' : 'bs-stat-even';
          return '<div class="bs-prefight-stat-row">' +
            '<span class="bs-prefight-stat-row__pval">' + pv + '</span>' +
            '<div class="bs-prefight-stat-row__bar"><div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--player" style="width:' + pv + '%"></div></div>' +
            '<span class="bs-prefight-stat-row__label"><i class="fas ' + s.icon + '"></i> ' + s.label + '</span>' +
            '<div class="bs-prefight-stat-row__bar"><div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--boss" style="width:' + ov + '%"></div></div>' +
            '<span class="bs-prefight-stat-row__bval ' + diffClass + '">' + ov + '</span>' +
          '</div>';
        }).join('');
    }

    if (_cb.showOverlay) _cb.showOverlay('bs-prefight-overlay');
    if (_cb.renderCharmSelector) _cb.renderCharmSelector();

    // Wire fight button to async battle
    var oldBtn = document.getElementById('bs-prefight-go');
    if (!oldBtn || !oldBtn.parentNode) return;
    var freshBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(freshBtn, oldBtn);
    freshBtn.addEventListener('click', function() {
      if (_cb.hideOverlay) _cb.hideOverlay('bs-prefight-overlay');
      if (_cb.startAsyncBattle) _cb.startAsyncBattle(defender.userId, false);
    }, { once: true });
  }

  // ── Defense Panel ──

  async function renderDefensePanel() {
    var container = document.getElementById('bs-defense-status');
    if (!container) return;

    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> Checking defense status\u2026</div>';

    try {
      var data = await window.ArenaAPI.loadDefenseQueue();
      var myEntry = data.myEntry;
      var selectedCard = _cb.getSelectedCard ? _cb.getSelectedCard() : null;

      if (myEntry) {
        // Card is on defense
        var rank = getPvPRank(myEntry.pvpElo || 1000);
        container.innerHTML =
          '<div style="text-align:center;padding:1rem;">' +
            '<div style="font-size:1.1rem;color:var(--bs-accent);margin-bottom:0.5rem;"><i class="fas fa-shield-halved"></i> Card on Defense</div>' +
            '<div class="bs-boss-card" style="justify-content:center;margin:0.5rem auto;">' +
              '<div class="bs-boss-avatar" style="width:48px;height:48px;">' +
                (myEntry.avatar ? '<img src="' + escHtml(myEntry.avatar) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '<i class="fas fa-user"></i>') +
              '</div>' +
              '<div class="bs-boss-card__info">' +
                '<div class="bs-boss-card__name">' + escHtml(myEntry.cardName) + '</div>' +
                '<div class="bs-boss-card__class">' + escHtml(myEntry.cardClass) + ' <span style="color:' + rank.color + ';"><i class="fas ' + rank.icon + '"></i> ' + (myEntry.pvpElo || 1000) + '</span></div>' +
              '</div>' +
            '</div>' +
            '<div style="color:var(--bs-text-muted);font-size:0.85rem;margin:0.5rem 0;">' +
              'Defense Record: <strong>' + (myEntry.record.w || 0) + 'W</strong> / <strong>' + (myEntry.record.l || 0) + 'L</strong>' +
            '</div>' +
            '<p style="color:var(--bs-text-muted);font-size:0.8rem;margin:0.5rem 0 1rem;">Your card battles attackers while you\u2019re away. Earn Sparks even offline!</p>' +
            '<button class="bs-btn bs-btn--primary" id="bs-withdraw-defense" style="background:var(--bs-danger);border-color:var(--bs-danger);"><i class="fas fa-times"></i> Withdraw from Defense</button>' +
          '</div>';

        document.getElementById('bs-withdraw-defense').addEventListener('click', async function() {
          this.disabled = true; this.textContent = 'Withdrawing\u2026';
          try {
            await window.ArenaAPI.withdrawDefense();
            _S.progress.defenseCardId = null;
            _S.sync();
            renderDefensePanel();
          } catch (e) { this.disabled = false; this.textContent = 'Withdraw Failed'; }
        });
      } else {
        // No card on defense — show register CTA
        container.innerHTML =
          '<div style="text-align:center;padding:1rem;">' +
            '<div style="font-size:2rem;margin-bottom:0.5rem;"><i class="fas fa-shield-halved" style="color:var(--bs-accent);"></i></div>' +
            '<div style="font-size:1rem;color:var(--bs-text);margin-bottom:0.5rem;">Put a Card on Defense</div>' +
            '<p style="color:var(--bs-text-muted);font-size:0.85rem;margin:0 0 1rem;">Your card will fight attackers while you\u2019re away. Earn passive Sparks and track defense wins!</p>' +
            (selectedCard
              ? '<div style="margin-bottom:0.8rem;color:var(--bs-text);font-size:0.9rem;"><i class="fas fa-id-card"></i> Selected: <strong>' + escHtml(selectedCard.name || 'Unnamed') + '</strong></div>' +
                '<button class="bs-btn bs-btn--primary" id="bs-register-defense"><i class="fas fa-shield-halved"></i> Register for Defense</button>'
              : '<p style="color:var(--bs-danger);font-size:0.85rem;">Select a card first from your collection.</p>') +
          '</div>';

        var regBtn = document.getElementById('bs-register-defense');
        if (regBtn && selectedCard) {
          regBtn.addEventListener('click', async function() {
            this.disabled = true; this.textContent = 'Registering\u2026';
            try {
              await window.ArenaAPI.registerDefense(selectedCard.id, selectedCard);
              _S.progress.defenseCardId = selectedCard.id;
              _S.sync();
              renderDefensePanel();
            } catch (e) { this.disabled = false; this.textContent = 'Registration Failed'; }
          });
        }
      }
    } catch (err) {
      container.innerHTML = '<p style="text-align:center;color:var(--bs-danger);padding:1rem;">Failed to load defense status.</p>';
    }
  }

  // ── Inbox Panel ──

  async function renderInboxPanel() {
    var container = document.getElementById('bs-inbox-content');
    if (!container) return;

    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> Loading results\u2026</div>';

    try {
      var data = await window.ArenaAPI.loadInbox();
      var inbox = data.inbox || [];
      _inboxCache = inbox;
      updateInboxBadge(data.unreadCount || 0);

      if (inbox.length === 0) {
        container.innerHTML =
          '<div style="text-align:center;padding:2rem;color:var(--bs-text-muted);">' +
            '<div style="font-size:2rem;margin-bottom:0.5rem;"><i class="fas fa-inbox"></i></div>' +
            '<p>No results yet. Register a card for defense to start earning while offline!</p>' +
          '</div>';
        return;
      }

      // Summary bar
      var wins = inbox.filter(function(r) { return r.result === 'win'; }).length;
      var losses = inbox.filter(function(r) { return r.result === 'loss'; }).length;
      var totalSparks = data.totalSparks || 0;

      container.innerHTML =
        '<div style="display:flex;justify-content:space-between;padding:0.5rem 1rem;font-size:0.8rem;color:var(--bs-text-muted);border-bottom:1px solid var(--bs-border);">' +
          '<span><i class="fas fa-shield-halved"></i> ' + wins + 'W / ' + losses + 'L</span>' +
          '<span><i class="fas fa-bolt" style="color:var(--bs-accent);"></i> ' + totalSparks + ' Sparks earned</span>' +
          (data.unreadCount > 0 ? '<button class="bs-btn--link" id="bs-dismiss-all" style="font-size:0.75rem;color:var(--bs-accent);cursor:pointer;background:none;border:none;">Mark all read</button>' : '') +
        '</div>' +
        inbox.map(function(r) {
          var isWin = r.result === 'win';
          var icon = isWin ? 'fa-trophy' : 'fa-skull';
          var color = isWin ? 'var(--bs-success, #4ade80)' : 'var(--bs-danger)';
          var unreadDot = !r.read ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--bs-accent);margin-right:0.3rem;"></span>' : '';
          var ago = _timeAgo(r.foughtAt);
          return '<div class="bs-boss-card' + (!r.read ? ' bs-inbox-unread' : '') + '" style="cursor:default;">' +
            '<div class="bs-boss-avatar" style="width:32px;height:32px;font-size:0.8rem;color:' + color + ';">' +
              (r.opponentAvatar ? '<img src="' + escHtml(r.opponentAvatar) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '<i class="fas ' + icon + '"></i>') +
            '</div>' +
            '<div class="bs-boss-card__info" style="flex:1;">' +
              '<div class="bs-boss-card__name">' + unreadDot + '<span style="color:' + color + ';">' + (isWin ? 'Defended!' : 'Defeated') + '</span> vs ' + escHtml(r.opponentName) + '</div>' +
              '<div class="bs-boss-card__class" style="font-size:0.75rem;">' +
                '<span style="color:var(--bs-accent);">+' + (r.sparksEarned || 0) + ' <i class="fas fa-bolt"></i></span> ' +
                '<span style="color:' + (r.eloChange >= 0 ? 'var(--bs-success, #4ade80)' : 'var(--bs-danger)') + ';">' + (r.eloChange >= 0 ? '+' : '') + r.eloChange + ' Elo</span> ' +
                '<span style="color:var(--bs-text-muted);">' + r.rounds + 'R &middot; ' + ago + '</span>' +
              '</div>' +
            '</div>' +
            (r.canRevenge
              ? '<div class="bs-boss-card__action"><button class="bs-btn bs-btn--sm" style="padding:0.3rem 0.6rem;font-size:0.75rem;background:var(--bs-danger);" data-revenge="' + escHtml(r.opponentUserId) + '"><i class="fas fa-fire"></i> Revenge</button></div>'
              : '') +
          '</div>';
        }).join('');

      // Dismiss all
      var dismissBtn = document.getElementById('bs-dismiss-all');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', async function() {
          await window.ArenaAPI.dismissAllResults();
          updateInboxBadge(0);
          renderInboxPanel();
        });
      }

      // Revenge buttons
      container.querySelectorAll('[data-revenge]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var opponentUserId = btn.dataset.revenge;
          if (_cb.startAsyncBattle) _cb.startAsyncBattle(opponentUserId, true);
        });
      });
    } catch (err) {
      container.innerHTML = '<p style="text-align:center;color:var(--bs-danger);padding:1rem;">Failed to load inbox.</p>';
    }
  }

  // ── Inbox Badge ──

  function updateInboxBadge(count) {
    var badge = document.getElementById('bs-inbox-badge');
    if (!badge) return;
    _S.progress.asyncInboxCount = count;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  async function pollInboxCount() {
    try {
      var data = await window.ArenaAPI.loadInbox();
      updateInboxBadge((data && data.unreadCount) || 0);
    } catch (e) { /* silent */ }
  }

  // ── Time ago helper ──

  function _timeAgo(isoStr) {
    if (!isoStr) return '';
    var diff = Date.now() - new Date(isoStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  // ── Public API ──

  window.BsPvp = {
    renderGallery: renderPvPGallery,
    renderDefenseQueue: renderDefenseQueue,
    renderDefensePanel: renderDefensePanel,
    renderInboxPanel: renderInboxPanel,
    pollInboxCount: pollInboxCount,
    initPvPTabs: initPvPTabs,
    updateRatingDisplay: updatePvPRatingDisplay,
    updateInboxBadge: updateInboxBadge,
    showComparison: showPvPComparison,
    showAsyncComparison: showAsyncComparison,
    showEloChange: showEloChange,
    getGallery: function() { return _pvpGallery; },
    getDefenseQueue: function() { return _defenseQueueCache; },
    getInbox: function() { return _inboxCache; },
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
