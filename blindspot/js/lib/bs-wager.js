/**
 * bs-wager.js — Wager system UI (Challenger + Skull Ante)
 *
 * Renders:
 *   - Skull Ante challenge board (open challenges grid)
 *   - Post challenge modal (card picker, type selection)
 *   - Accept challenge modal (opponent card preview, own card picker)
 *   - Challenger invite in inbox
 *   - Active wager status
 *
 * API: window.BsWager
 */
(function () {
  'use strict';

  var _cb = {};
  var _boardCache = null;
  var _postInProgress = false;

  function setCallbacks(cb) { _cb = cb || {}; }

  // Callback helpers
  function getDeck() { return _cb.getDeck ? _cb.getDeck() : []; }
  function renderCardHTML(card, size) { return _cb.renderCardHTML ? _cb.renderCardHTML(card, size) : ''; }
  function escHtml(s) { return _cb.escHtml ? _cb.escHtml(s) : String(s); }
  function showToast(msg) { if (_cb.showToast) _cb.showToast(msg); }
  function getLockedCards() { return _cb.getLockedCards ? _cb.getLockedCards() : []; }
  function getSelectedCard() { return _cb.getSelectedCard ? _cb.getSelectedCard() : null; }
  function refreshDeck() { if (_cb.refreshDeck) _cb.refreshDeck(); }
  function getProgress() { return _cb.getProgress ? _cb.getProgress() : {}; }

  // ═══════════════════════════════════════
  // SKULL ANTE CHALLENGE BOARD
  // ═══════════════════════════════════════

  async function renderBoard() {
    var container = document.getElementById('bs-wager-board');
    if (!container) return;

    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> Loading challenge board...</div>';

    try {
      var data = await window.ArenaAPI.loadChallengeBoard();
      _boardCache = data;
      var challenges = data.challenges || [];
      var myChallenge = data.myChallenge;

      var html = '';

      // My active challenge
      if (myChallenge) {
        html += '<div class="bs-wager-my-challenge">' +
          '<div class="bs-wager-my-challenge__header"><i class="fas fa-skull"></i> Your Open Challenge</div>' +
          '<div class="bs-wager-my-challenge__card">' +
            '<span class="bs-wager-card__name">' + escHtml(myChallenge.cardPreview.name) + '</span>' +
            '<span class="bs-wager-card__meta">' + escHtml(myChallenge.cardPreview.class || '') + ' &middot; ' + escHtml(myChallenge.cardPreview.rarity || '') + '</span>' +
            '<span class="bs-wager-card__timer">' + formatTimeRemaining(myChallenge.expiresAt) + '</span>' +
          '</div>' +
          '<button class="bs-btn bs-btn--secondary bs-wager-cancel-btn" data-cancel-wager="' + escHtml(myChallenge.wagerId) + '"><i class="fas fa-times"></i> Cancel</button>' +
        '</div>';
      }

      // Post challenge button
      if (!myChallenge) {
        html += '<div class="bs-wager-post-row">' +
          '<button class="bs-btn bs-wager-post-btn" id="bs-wager-post-skull"><i class="fas fa-skull"></i> Post Skull Ante Challenge</button>' +
        '</div>';
      }

      // Challenge grid
      if (challenges.length === 0) {
        html += '<div class="bs-wager-empty">' +
          '<i class="fas fa-ghost" style="font-size:2rem;opacity:0.3;"></i>' +
          '<p>No open challenges in your rank range.</p>' +
        '</div>';
      } else {
        html += '<div class="bs-wager-grid">';
        for (var i = 0; i < challenges.length; i++) {
          var c = challenges[i];
          html += renderChallengeCard(c);
        }
        html += '</div>';
      }

      container.innerHTML = html;
      bindBoardEvents(container);
    } catch (err) {
      container.innerHTML = '<div class="bs-wager-empty"><p>Could not load challenge board.</p><p style="font-size:0.7rem;color:var(--bs-text-muted);">' + escHtml(err.message) + '</p></div>';
    }
  }

  function renderChallengeCard(challenge) {
    var preview = challenge.cardPreview || {};
    var timeLeft = formatTimeRemaining(challenge.expiresAt);
    var rankColor = getRankColor(challenge.peakRank);

    return '<div class="bs-wager-card" data-wager-id="' + escHtml(challenge.wagerId) + '">' +
      (preview.avatar ? '<div class="bs-wager-card__art" style="background-image:url(' + escHtml(preview.avatar) + ')"></div>' : '<div class="bs-wager-card__art bs-wager-card__art--empty"><i class="fas fa-skull"></i></div>') +
      '<div class="bs-wager-card__info">' +
        '<div class="bs-wager-card__name">' + escHtml(preview.name || 'Unknown') + '</div>' +
        '<div class="bs-wager-card__meta">' + escHtml(preview.class || '') + ' &middot; ' + escHtml(preview.rarity || '') + '</div>' +
        '<div class="bs-wager-card__rank" style="color:' + rankColor + '"><i class="fas fa-shield-halved"></i> ' + escHtml(challenge.peakRank || 'Iron') + '</div>' +
        '<div class="bs-wager-card__timer"><i class="fas fa-clock"></i> ' + timeLeft + '</div>' +
      '</div>' +
      '<button class="bs-btn bs-wager-accept-btn" data-accept-wager="' + escHtml(challenge.wagerId) + '">Accept</button>' +
    '</div>';
  }

  function bindBoardEvents(container) {
    container.addEventListener('click', function(e) {
      var acceptBtn = e.target.closest('[data-accept-wager]');
      if (acceptBtn) {
        e.stopPropagation();
        showAcceptModal(acceptBtn.dataset.acceptWager, 'skull');
        return;
      }
      var cancelBtn = e.target.closest('[data-cancel-wager]');
      if (cancelBtn) {
        e.stopPropagation();
        cancelChallenge(cancelBtn.dataset.cancelWager);
        return;
      }
      var postBtn = e.target.closest('#bs-wager-post-skull');
      if (postBtn) {
        e.stopPropagation();
        showPostModal('skull');
        return;
      }
    });
  }

  // ═══════════════════════════════════════
  // POST CHALLENGE MODAL
  // ═══════════════════════════════════════

  function showPostModal(tier) {
    var existing = document.getElementById('bs-wager-post-modal');
    if (existing) existing.remove();

    var deck = getDeck();
    var locked = getLockedCards();
    var eligible = deck.filter(function(c) { return !c.inActiveWager && locked.indexOf(c.id) === -1; });

    if (eligible.length === 0) {
      showToast('No eligible cards to wager. Unlock or free a card first.');
      return;
    }

    var isSkull = tier === 'skull';
    var title = isSkull ? '<i class="fas fa-skull"></i> Post Skull Ante Challenge' : '<i class="fas fa-swords"></i> Post Challenger Challenge';
    var subtitle = isSkull ? 'Your card is permanently on the line. Best of 3.' : 'Winner gets a copy of the loser\'s card. Best of 1.';

    var cardPickerHtml = '<div class="bs-wager-picker">';
    for (var i = 0; i < eligible.length; i++) {
      var c = eligible[i];
      var deckCard = Object.assign({}, c, { design: Object.assign({}, c.design || {}, { imageContainer: 'fullbleed' }) });
      cardPickerHtml += '<div class="bs-wager-picker__card" data-pick-id="' + escHtml(c.id) + '">' +
        renderCardHTML(deckCard, 'compact') +
        '<div class="bs-wager-picker__name">' + escHtml(c.name || 'Unnamed') + '</div>' +
      '</div>';
    }
    cardPickerHtml += '</div>';

    var typeSelector = '';
    if (isSkull) {
      typeSelector = '<div class="bs-wager-type-row">' +
        '<label class="bs-wager-type"><input type="radio" name="bs-wager-type" value="open" checked> <i class="fas fa-globe"></i> Open Challenge <span class="bs-wager-type__desc">Anyone in your rank range can accept (48hr)</span></label>' +
        '<label class="bs-wager-type"><input type="radio" name="bs-wager-type" value="direct"> <i class="fas fa-crosshairs"></i> Direct Challenge <span class="bs-wager-type__desc">Challenge a specific player (24hr)</span></label>' +
      '</div>' +
      '<div id="bs-wager-target-row" class="bs-wager-target-row" style="display:none;">' +
        '<label>Target Player ID:</label>' +
        '<input type="text" id="bs-wager-target-id" class="bs-wager-input" placeholder="Enter player ID">' +
      '</div>';
    }

    var overlay = document.createElement('div');
    overlay.id = 'bs-wager-post-modal';
    overlay.className = 'bs-wager-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML =
      '<div class="bs-wager-modal">' +
        '<h3 class="bs-wager-modal__title">' + title + '</h3>' +
        '<p class="bs-wager-modal__subtitle">' + subtitle + '</p>' +
        '<h4 class="bs-wager-modal__section">Choose your wager card:</h4>' +
        cardPickerHtml +
        typeSelector +
        '<div class="bs-wager-modal__actions">' +
          '<button class="bs-btn bs-btn--secondary" id="bs-wager-post-cancel">Cancel</button>' +
          '<button class="bs-btn bs-wager-modal__confirm" id="bs-wager-post-confirm" disabled><i class="fas fa-skull"></i> Post Challenge</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // State
    var selectedCardId = null;

    // Card picker click
    overlay.querySelectorAll('.bs-wager-picker__card').forEach(function(el) {
      el.addEventListener('click', function() {
        overlay.querySelectorAll('.bs-wager-picker__card').forEach(function(c) { c.classList.remove('bs-wager-picker__card--selected'); });
        el.classList.add('bs-wager-picker__card--selected');
        selectedCardId = el.dataset.pickId;
        document.getElementById('bs-wager-post-confirm').disabled = false;
      });
    });

    // Type radio toggle (skull only)
    if (isSkull) {
      overlay.querySelectorAll('input[name="bs-wager-type"]').forEach(function(radio) {
        radio.addEventListener('change', function() {
          var targetRow = document.getElementById('bs-wager-target-row');
          if (targetRow) targetRow.style.display = radio.value === 'direct' ? '' : 'none';
        });
      });
    }

    // Cancel
    document.getElementById('bs-wager-post-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Confirm
    document.getElementById('bs-wager-post-confirm').addEventListener('click', async function() {
      if (_postInProgress || !selectedCardId) return;
      _postInProgress = true;
      var btn = document.getElementById('bs-wager-post-confirm');
      if (btn) { btn.disabled = true; btn.textContent = 'Posting...'; }

      try {
        if (isSkull) {
          var challengeType = 'open';
          var typeRadio = overlay.querySelector('input[name="bs-wager-type"]:checked');
          if (typeRadio) challengeType = typeRadio.value;
          var targetUserId = null;
          if (challengeType === 'direct') {
            targetUserId = (document.getElementById('bs-wager-target-id') || {}).value;
            if (!targetUserId) { showToast('Enter a target player ID'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-skull"></i> Post Challenge'; _postInProgress = false; return; }
          }
          await window.ArenaAPI.postSkullChallenge(selectedCardId, challengeType, targetUserId);
        } else {
          var targetId = (document.getElementById('bs-wager-target-id') || {}).value;
          if (!targetId) { showToast('Enter a target player ID'); btn.disabled = false; btn.textContent = 'Post Challenge'; _postInProgress = false; return; }
          await window.ArenaAPI.postChallenger(selectedCardId, targetId);
        }
        overlay.remove();
        showToast('Challenge posted!');
        refreshDeck();
        renderBoard();
      } catch (err) {
        showToast('Post failed: ' + (err.message || 'Unknown error'));
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-skull"></i> Post Challenge'; }
      } finally {
        _postInProgress = false;
      }
    });
  }

  // ═══════════════════════════════════════
  // ACCEPT CHALLENGE MODAL
  // ═══════════════════════════════════════

  function showAcceptModal(wagerId, tier) {
    var existing = document.getElementById('bs-wager-accept-modal');
    if (existing) existing.remove();

    // Find the challenge from cache
    var challenge = null;
    if (_boardCache && _boardCache.challenges) {
      challenge = _boardCache.challenges.find(function(c) { return c.wagerId === wagerId; });
    }

    var deck = getDeck();
    var locked = getLockedCards();
    var eligible = deck.filter(function(c) { return !c.inActiveWager && locked.indexOf(c.id) === -1; });

    if (eligible.length === 0) {
      showToast('No eligible cards to wager.');
      return;
    }

    var isSkull = tier === 'skull';
    var opponentName = challenge && challenge.cardPreview ? challenge.cardPreview.name : 'Unknown';
    var title = isSkull ? '<i class="fas fa-skull"></i> Accept Skull Ante' : '<i class="fas fa-swords"></i> Accept Challenger';
    var warning = isSkull ? 'If you lose, your card is gone forever.' : 'If you lose, they get a copy of your card.';

    var cardPickerHtml = '<div class="bs-wager-picker">';
    for (var i = 0; i < eligible.length; i++) {
      var c = eligible[i];
      var deckCard = Object.assign({}, c, { design: Object.assign({}, c.design || {}, { imageContainer: 'fullbleed' }) });
      cardPickerHtml += '<div class="bs-wager-picker__card" data-pick-id="' + escHtml(c.id) + '">' +
        renderCardHTML(deckCard, 'compact') +
        '<div class="bs-wager-picker__name">' + escHtml(c.name || 'Unnamed') + '</div>' +
      '</div>';
    }
    cardPickerHtml += '</div>';

    var overlay = document.createElement('div');
    overlay.id = 'bs-wager-accept-modal';
    overlay.className = 'bs-wager-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML =
      '<div class="bs-wager-modal">' +
        '<h3 class="bs-wager-modal__title">' + title + '</h3>' +
        '<div class="bs-wager-opponent">' +
          '<span class="bs-wager-opponent__label">Opponent\'s card:</span>' +
          '<span class="bs-wager-opponent__name">' + escHtml(opponentName) + '</span>' +
        '</div>' +
        '<p class="bs-wager-modal__warning"><i class="fas fa-exclamation-triangle"></i> ' + warning + '</p>' +
        '<h4 class="bs-wager-modal__section">Choose your wager card:</h4>' +
        cardPickerHtml +
        '<div class="bs-wager-modal__actions">' +
          '<button class="bs-btn bs-btn--secondary" id="bs-wager-accept-cancel">Cancel</button>' +
          '<button class="bs-btn bs-wager-modal__confirm bs-wager-modal__confirm--danger" id="bs-wager-accept-confirm" disabled><i class="fas fa-skull"></i> Accept &amp; Fight</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var selectedCardId = null;

    overlay.querySelectorAll('.bs-wager-picker__card').forEach(function(el) {
      el.addEventListener('click', function() {
        overlay.querySelectorAll('.bs-wager-picker__card').forEach(function(c) { c.classList.remove('bs-wager-picker__card--selected'); });
        el.classList.add('bs-wager-picker__card--selected');
        selectedCardId = el.dataset.pickId;
        document.getElementById('bs-wager-accept-confirm').disabled = false;
      });
    });

    document.getElementById('bs-wager-accept-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    document.getElementById('bs-wager-accept-confirm').addEventListener('click', async function() {
      if (_postInProgress || !selectedCardId) return;
      _postInProgress = true;
      var btn = document.getElementById('bs-wager-accept-confirm');
      if (btn) { btn.disabled = true; btn.textContent = 'Accepting...'; }

      try {
        if (isSkull) {
          await window.ArenaAPI.acceptSkullChallenge(wagerId, selectedCardId);
        } else {
          await window.ArenaAPI.acceptChallenger(wagerId, selectedCardId);
        }
        overlay.remove();
        showToast('Challenge accepted! Battle starting...');
        refreshDeck();
        renderBoard();
      } catch (err) {
        showToast('Accept failed: ' + (err.message || 'Unknown error'));
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-skull"></i> Accept &amp; Fight'; }
      } finally {
        _postInProgress = false;
      }
    });
  }

  // ═══════════════════════════════════════
  // CANCEL / DECLINE
  // ═══════════════════════════════════════

  async function cancelChallenge(wagerId) {
    if (_postInProgress) return;
    _postInProgress = true;
    try {
      await window.ArenaAPI.declineSkullChallenge(wagerId);
      showToast('Challenge cancelled');
      refreshDeck();
      renderBoard();
    } catch (err) {
      showToast('Cancel failed: ' + (err.message || 'Unknown error'));
    } finally {
      _postInProgress = false;
    }
  }

  // ═══════════════════════════════════════
  // INBOX: Render wager invites inline
  // ═══════════════════════════════════════

  function renderInboxWagerEntry(entry) {
    if (entry.type === 'challenger_invite') {
      var preview = entry.cardPreview || {};
      var rmLabel = entry.isRematch ? ' (Rematch)' : '';
      var declineDisabled = entry.cannotDecline ? ' disabled title="Rematch — cannot decline"' : '';
      return '<div class="bs-wager-inbox-entry bs-wager-inbox-entry--invite">' +
        '<div class="bs-wager-inbox-entry__icon"><i class="fas fa-swords"></i></div>' +
        '<div class="bs-wager-inbox-entry__body">' +
          '<div class="bs-wager-inbox-entry__title">Challenger Invite' + rmLabel + '</div>' +
          '<div class="bs-wager-inbox-entry__desc">' + escHtml(preview.name || entry.challengerName || 'Unknown') + ' &middot; ' + escHtml(preview.class || '') + '</div>' +
        '</div>' +
        '<div class="bs-wager-inbox-entry__actions">' +
          '<button class="bs-btn bs-btn--small" data-accept-wager="' + escHtml(entry.wagerId) + '" data-wager-tier="challenger">Accept</button>' +
          '<button class="bs-btn bs-btn--small bs-btn--secondary" data-decline-wager="' + escHtml(entry.wagerId) + '" data-wager-tier="challenger"' + declineDisabled + '>Decline</button>' +
        '</div>' +
      '</div>';
    }
    if (entry.type === 'skull_ante_invite') {
      var preview2 = entry.cardPreview || {};
      return '<div class="bs-wager-inbox-entry bs-wager-inbox-entry--skull">' +
        '<div class="bs-wager-inbox-entry__icon"><i class="fas fa-skull" style="color:#ff3333;"></i></div>' +
        '<div class="bs-wager-inbox-entry__body">' +
          '<div class="bs-wager-inbox-entry__title">Skull Ante Challenge</div>' +
          '<div class="bs-wager-inbox-entry__desc">' + escHtml(preview2.name || entry.challengerName || 'Unknown') + ' &middot; ' + escHtml(preview2.class || '') + '</div>' +
        '</div>' +
        '<div class="bs-wager-inbox-entry__actions">' +
          '<button class="bs-btn bs-btn--small" data-accept-wager="' + escHtml(entry.wagerId) + '" data-wager-tier="skull">Accept</button>' +
          '<button class="bs-btn bs-btn--small bs-btn--secondary" data-decline-wager="' + escHtml(entry.wagerId) + '" data-wager-tier="skull">Decline</button>' +
        '</div>' +
      '</div>';
    }
    if (entry.type === 'challenger_win' || entry.type === 'challenger_loss' || entry.type === 'skull_win' || entry.type === 'skull_loss' || entry.type === 'wager_draw') {
      return renderWagerResultEntry(entry);
    }
    if (entry.type === 'challenger_declined' || entry.type === 'skull_ante_declined') {
      return '<div class="bs-wager-inbox-entry bs-wager-inbox-entry--declined">' +
        '<div class="bs-wager-inbox-entry__icon"><i class="fas fa-ban"></i></div>' +
        '<div class="bs-wager-inbox-entry__body">' +
          '<div class="bs-wager-inbox-entry__title">Challenge Declined</div>' +
          '<div class="bs-wager-inbox-entry__desc">Your challenge was declined.</div>' +
        '</div>' +
      '</div>';
    }
    return null;
  }

  function renderWagerResultEntry(entry) {
    var isWin = entry.type === 'challenger_win' || entry.type === 'skull_win';
    var isDraw = entry.type === 'wager_draw';
    var isSkull = entry.type === 'skull_win' || entry.type === 'skull_loss';
    var icon = isDraw ? 'fa-handshake' : isWin ? 'fa-trophy' : 'fa-heart-crack';
    var color = isDraw ? 'var(--bs-text-muted)' : isWin ? '#fbbf24' : '#ff5252';
    var title = isDraw ? 'Draw' : isWin ? (isSkull ? 'Skull Ante Won!' : 'Challenger Won!') : (isSkull ? 'Skull Ante Lost' : 'Challenger Lost');
    var desc = '';
    if (isWin && entry.cardWon) desc = 'Won: ' + escHtml(entry.cardWon.name);
    else if (!isWin && !isDraw && entry.cardLost) desc = 'Lost: ' + escHtml(entry.cardLost.name);
    else if (!isWin && !isDraw && entry.cardCopied) desc = 'Copied: ' + escHtml(entry.cardCopied.name);
    else if (isDraw) desc = entry.message || 'Cards returned.';
    if (entry.hasRematchToken) desc += ' — Rematch available!';

    return '<div class="bs-wager-inbox-entry bs-wager-inbox-entry--result">' +
      '<div class="bs-wager-inbox-entry__icon" style="color:' + color + '"><i class="fas ' + icon + '"></i></div>' +
      '<div class="bs-wager-inbox-entry__body">' +
        '<div class="bs-wager-inbox-entry__title">' + title + '</div>' +
        '<div class="bs-wager-inbox-entry__desc">' + desc + '</div>' +
      '</div>' +
    '</div>';
  }

  // Check if an inbox entry is a wager type
  function isWagerInboxEntry(entry) {
    var types = ['challenger_invite', 'skull_ante_invite', 'challenger_win', 'challenger_loss',
      'skull_win', 'skull_loss', 'wager_draw', 'challenger_declined', 'skull_ante_declined'];
    return types.indexOf(entry.type) !== -1;
  }

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════

  function formatTimeRemaining(expiresAt) {
    if (!expiresAt) return '';
    var ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'Expired';
    var hours = Math.floor(ms / 3600000);
    var mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 24) return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
    if (hours > 0) return hours + 'h ' + mins + 'm';
    return mins + 'm';
  }

  function getRankColor(rank) {
    var colors = { Iron: '#8a8a8a', Bronze: '#CD7F32', Silver: '#C0C0C0', Gold: '#FFD700', Platinum: '#E5E4E2', Diamond: '#B9F2FF' };
    return colors[rank] || '#8a8a8a';
  }

  // ═══════════════════════════════════════
  // ACTIVE WAGER SERIES TRACKER
  // ═══════════════════════════════════════

  function renderSeriesTracker(wager) {
    if (!wager || wager.tier !== 'skull') return '';
    var record = wager.seriesRecord || [null, null, null];
    var myUserId = getProgress().userId || '';
    var mySide = wager.playerA && wager.playerA.userId === myUserId ? 'playerA' : 'playerB';
    var oppSide = mySide === 'playerA' ? 'playerB' : 'playerA';

    var dots = '';
    for (var i = 0; i < 3; i++) {
      var cls = 'bs-wager-series__dot';
      if (record[i] === mySide) cls += ' bs-wager-series__dot--win';
      else if (record[i] === oppSide) cls += ' bs-wager-series__dot--loss';
      else if (record[i] === null && i <= (wager.currentMatchIndex || 0)) cls += ' bs-wager-series__dot--current';
      dots += '<div class="' + cls + '"></div>';
    }

    var myWins = record.filter(function(r) { return r === mySide; }).length;
    var oppWins = record.filter(function(r) { return r === oppSide; }).length;
    var oppName = wager[oppSide] && wager[oppSide].snapshot ? wager[oppSide].snapshot.name : 'Opponent';

    return '<div class="bs-wager-series">' +
      '<div class="bs-wager-series__header"><i class="fas fa-skull" style="color:#ff3333;"></i> Skull Ante Series</div>' +
      '<div class="bs-wager-series__score">' + myWins + ' — ' + oppWins + '</div>' +
      '<div class="bs-wager-series__dots">' + dots + '</div>' +
      '<div class="bs-wager-series__opponent">vs ' + escHtml(oppName) + '</div>' +
      (wager.status === 'active' ? '<div class="bs-wager-series__status">Match ' + ((wager.currentMatchIndex || 0) + 1) + ' of 3</div>' : '') +
    '</div>';
  }

  function renderActiveWagers() {
    var container = document.getElementById('bs-active-wagers');
    if (!container) return;

    var progress = getProgress();
    var activeWagers = progress.activeWagers || [];
    if (activeWagers.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = '';
    container.innerHTML = '<div class="bs-active-wagers__title"><i class="fas fa-swords"></i> Active Wagers (' + activeWagers.length + ')</div>' +
      '<div class="bs-active-wagers__list" id="bs-active-wagers-list"><div class="bs-loading"><div class="bs-spinner"></div></div></div>';

    // Load wager details (async, lazy)
    // For now, show count — details require API call to load each wager
    // TODO: Phase 8 — add endpoint to batch-load active wagers
  }

  // ═══════════════════════════════════════
  // WAGER RESULTS OVERLAY
  // ═══════════════════════════════════════

  function showWagerResult(result) {
    var existing = document.getElementById('bs-wager-result-overlay');
    if (existing) existing.remove();

    var isWin = result.outcome === 'win' && result.winnerId === (getProgress().userId || '');
    var isDraw = result.outcome === 'draw';
    var isSkull = result.tier === 'skull';

    var icon, title, subtitle, bgClass;
    if (isDraw) {
      icon = 'fa-handshake';
      title = 'Draw';
      subtitle = 'Series expired — both cards returned.';
      bgClass = 'bs-wager-result--draw';
    } else if (isWin) {
      icon = isSkull ? 'fa-skull' : 'fa-trophy';
      title = isSkull ? 'TROPHY KILL' : 'Challenger Victory!';
      subtitle = isSkull ? 'Their card is yours now.' : 'You received a copy of their card.';
      bgClass = 'bs-wager-result--win';
    } else {
      icon = 'fa-heart-crack';
      title = isSkull ? 'Skull Ante Lost' : 'Challenger Defeat';
      subtitle = isSkull ? 'Your card has been claimed.' : 'They received a copy of your card.';
      bgClass = 'bs-wager-result--loss';
    }

    var badgeHtml = '';
    if (result.badges && result.badges.length > 0) {
      badgeHtml = '<div class="bs-wager-result__badges">' +
        result.badges.map(function(b) { return renderBadge(b); }).join('') +
      '</div>';
    }

    var overlay = document.createElement('div');
    overlay.id = 'bs-wager-result-overlay';
    overlay.className = 'bs-wager-overlay';
    overlay.innerHTML =
      '<div class="bs-wager-result ' + bgClass + '">' +
        '<div class="bs-wager-result__icon"><i class="fas ' + icon + '"></i></div>' +
        '<h2 class="bs-wager-result__title">' + title + '</h2>' +
        '<p class="bs-wager-result__subtitle">' + subtitle + '</p>' +
        badgeHtml +
        '<button class="bs-btn bs-wager-result__dismiss" id="bs-wager-result-close">Continue</button>' +
      '</div>';

    document.body.appendChild(overlay);
    document.getElementById('bs-wager-result-close').addEventListener('click', function() {
      overlay.remove();
      refreshDeck();
    });
  }

  // ═══════════════════════════════════════
  // GHOST CARDS
  // ═══════════════════════════════════════

  var _ghostCards = [];

  function setGhostCards(ghosts) {
    _ghostCards = Array.isArray(ghosts) ? ghosts : [];
  }

  function getGhostCards() {
    return _ghostCards;
  }

  function renderGhostCard(ghost) {
    var name = ghost.name || 'Lost Card';
    return '<div class="bs-deck-card bs-deck-card--ghost" data-ghost-id="' + escHtml(ghost.cardId || ghost.id || '') + '">' +
      '<div class="bs-deck-card--ghost__overlay">' +
        '<i class="fas fa-skull"></i>' +
        '<span>LOST IN WAGER</span>' +
      '</div>' +
      '<div class="bs-deck-card--ghost__name">' + escHtml(name) + '</div>' +
      '<button class="bs-deck-card--ghost__dismiss" data-dismiss-ghost="' + escHtml(ghost.cardId || ghost.id || '') + '"><i class="fas fa-times"></i></button>' +
    '</div>';
  }

  function dismissGhost(cardId) {
    _ghostCards = _ghostCards.filter(function(g) { return (g.cardId || g.id) !== cardId; });
    // Persist dismissal
    try {
      var dismissed = JSON.parse(localStorage.getItem('bs-dismissed-ghosts') || '[]');
      if (dismissed.indexOf(cardId) === -1) dismissed.push(cardId);
      localStorage.setItem('bs-dismissed-ghosts', JSON.stringify(dismissed));
    } catch (e) { /* non-critical */ }
  }

  // Build ghost list from completed wagers where user lost a card
  function detectGhostCards(activeWagers, deck) {
    // Ghost cards are cards that were in activeWagers but are no longer in the deck
    // This is detected by checking if any wager with transferComplete has the user's card missing
    // For now, ghosts are populated by the inbox result entries (skull_loss)
    // The inbox handler can call setGhostCards with the lost card data
    var dismissed = [];
    try { dismissed = JSON.parse(localStorage.getItem('bs-dismissed-ghosts') || '[]'); } catch (e) {}
    return _ghostCards.filter(function(g) { return dismissed.indexOf(g.cardId || g.id) === -1; });
  }

  // ═══════════════════════════════════════
  // BADGE RENDERING
  // ═══════════════════════════════════════

  var BADGE_DEFS = {
    challenger_win:    { icon: 'fa-swords',          color: '#FFD700', label: 'Challenger' },
    skull_executioner:  { icon: 'fa-skull-crossbones', color: '#ff3333', label: 'Executioner' },
    skull_resurrect:    { icon: 'fa-cross',            color: '#4ade80', label: 'Resurrect' },
    skull_scar:         { icon: 'fa-skull',            color: '#8a8a8a', label: 'Scar' }
  };

  function renderBadge(badge) {
    var type = typeof badge === 'string' ? badge : (badge.type || '');
    var def = BADGE_DEFS[type];
    if (!def) return '';
    return '<span class="bs-wager-badge" style="color:' + def.color + ';" title="' + escHtml(def.label) + '">' +
      '<i class="fas ' + def.icon + '"></i> ' + escHtml(def.label) +
    '</span>';
  }

  function renderBadgeRow(badges) {
    if (!badges || badges.length === 0) return '';
    return '<div class="bs-wager-badge-row">' +
      badges.map(function(b) { return renderBadge(b); }).join('') +
    '</div>';
  }

  // ═══════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════

  window.BsWager = {
    setCallbacks: setCallbacks,
    renderBoard: renderBoard,
    showPostModal: showPostModal,
    showAcceptModal: showAcceptModal,
    renderInboxWagerEntry: renderInboxWagerEntry,
    isWagerInboxEntry: isWagerInboxEntry,
    // Phase 6b additions
    renderSeriesTracker: renderSeriesTracker,
    renderActiveWagers: renderActiveWagers,
    showWagerResult: showWagerResult,
    setGhostCards: setGhostCards,
    getGhostCards: getGhostCards,
    renderGhostCard: renderGhostCard,
    dismissGhost: dismissGhost,
    detectGhostCards: detectGhostCards,
    renderBadge: renderBadge,
    renderBadgeRow: renderBadgeRow,
    BADGE_DEFS: BADGE_DEFS
  };
})();
