/**
 * Arena App — main page controller
 * Init, screen navigation, state management, demo mode
 */
window.ArenaApp = (function () {
  'use strict';

  // Global arena state
  window._arenaState = {
    profile: null,
    selectedCard: null,
    userCards: [],
    activeBattle: null,
    bosses: [],
    lastBattleType: 'pve',
    lastOpponentId: null,
    isDemo: false
  };

  const state = window._arenaState;

  // --- Demo sample cards ---
  function getDemoCards() {
    return [
      {
        id: 'demo-knight',
        name: 'Demo Knight',
        class: 'Fighter',
        avatar: '/cardforge/img/demo/demo-knight.webp',
        quote: 'Steel meets fate.',
        combatStats: { str: 80, agi: 50, int: 30, end: 90, lck: 50 },
        stats: [
          { name: 'Strength', value: 80 }, { name: 'Agility', value: 50 },
          { name: 'Intelligence', value: 30 }, { name: 'Endurance', value: 90 }, { name: 'Luck', value: 50 }
        ],
        badges: [{ category: 'courage', icon: 'bolt', quantity: 2, description: 'Brave warrior' }]
      },
      {
        id: 'demo-mage',
        name: 'Demo Mage',
        class: 'Caster',
        avatar: '/cardforge/img/demo/demo-mage.webp',
        quote: 'Knowledge is the ultimate weapon.',
        combatStats: { str: 30, agi: 50, int: 90, end: 50, lck: 80 },
        stats: [
          { name: 'Strength', value: 30 }, { name: 'Agility', value: 50 },
          { name: 'Intelligence', value: 90 }, { name: 'Endurance', value: 50 }, { name: 'Luck', value: 80 }
        ],
        badges: [{ category: 'wisdom', icon: 'book', quantity: 2, description: 'Arcane scholar' }]
      },
      {
        id: 'demo-rogue',
        name: 'Demo Rogue',
        class: 'Rogue',
        avatar: '/cardforge/img/demo/demo-rogue.webp',
        quote: 'Shadows never miss.',
        combatStats: { str: 50, agi: 90, int: 50, end: 40, lck: 70 },
        stats: [
          { name: 'Strength', value: 50 }, { name: 'Agility', value: 90 },
          { name: 'Intelligence', value: 50 }, { name: 'Endurance', value: 40 }, { name: 'Luck', value: 70 }
        ],
        badges: [{ category: 'champion', icon: 'trophy', quantity: 2, description: 'Silent striker' }]
      }
    ];
  }

  function showScreen(screenId) {
    document.querySelectorAll('.arena-screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('arena-screen-' + screenId);
    if (target) target.classList.add('active');

    // Music transitions
    const audio = window.ArenaAudio;
    if (audio) {
      if (screenId === 'lobby' || screenId === 'pve' || screenId === 'pvp') {
        // Play the currently selected arena's track in the lobby as a preview
        const selectedArena = window.ArenaBackgrounds ? window.ArenaBackgrounds.getSelected() : null;
        audio.playArenaMusic(selectedArena || 'menu');
      }
      // Battle music is started by startPveBattle via playArenaMusic
    }
    window.location.hash = screenId;
  }

  async function init() {
    // Init audio — binds SFX toggle, music toggle, volume slider internally
    if (window.ArenaAudio) window.ArenaAudio.init();

    // Bind events
    window.ArenaBattleUI.bindEvents();
    bindNavigation();

    // Check hash for initial screen
    const hash = window.location.hash.replace('#', '');

    // Load profile + cards
    try {
      const [profileData, cardsData] = await Promise.all([
        window.ArenaAPI.loadProfile().catch(() => null),
        window.ArenaAPI.loadCards().catch(() => ({ userCards: [] }))
      ]);

      if (!profileData || !profileData.profile) {
        // API completely failed — show error gate
        document.getElementById('arena-auth-gate').style.display = 'flex';
        document.getElementById('arena-lobby-main').style.display = 'none';
        return;
      }

      // Track demo mode
      state.isDemo = profileData.isDemo || false;

      // Show lobby
      document.getElementById('arena-auth-gate').style.display = 'none';
      document.getElementById('arena-lobby-main').style.display = 'block';

      // Start lobby music
      if (window.ArenaAudio) window.ArenaAudio.playMusic('menu');

      state.profile = profileData.profile;

      // Cards: use user's cards if available, else demo cards
      if (state.isDemo) {
        state.userCards = getDemoCards();
        showDemoBanner();
        disablePvP();
      } else {
        state.userCards = cardsData.userCards || [];
        showAuthStatus();
      }

      // Render profile
      window.ArenaResults.updateRankDisplay(state.profile);

      // Bridge _arenaProfile for EffectTiers API
      window._arenaProfile = state.profile;

      // Render tier-awareness widgets
      if (window.EffectTiers) {
        if (window.EffectTiers.renderRankRewardsPanel) window.EffectTiers.renderRankRewardsPanel('arena-rewards-panel');
        if (window.EffectTiers.renderNextRankPreview) window.EffectTiers.renderNextRankPreview('arena-next-rank-preview');
      }

      // Rank Rewards collapsible toggle
      var rewardsToggle = document.getElementById('arena-rewards-toggle');
      var rewardsPanel = document.getElementById('arena-rewards-panel');
      if (rewardsToggle && rewardsPanel) {
        rewardsToggle.addEventListener('click', function () {
          var expanded = rewardsPanel.style.display !== 'none';
          rewardsPanel.style.display = expanded ? 'none' : 'block';
          rewardsToggle.setAttribute('aria-expanded', String(!expanded));
          rewardsToggle.querySelector('i').className = 'fas ' + (expanded ? 'fa-chevron-down' : 'fa-chevron-up');
        });
      }

      // Render arena background picker — preview music on selection
      if (window.ArenaBackgrounds) {
        window.ArenaBackgrounds.renderPicker('arena-bg-picker', state.profile.rank, function (arenaId) {
          if (window.ArenaAudio) window.ArenaAudio.playArenaMusic(arenaId);
        });
      }

      // Render card strip
      window.ArenaCardSelect.renderCardStrip(state.userCards, 'arena-card-strip', onCardSelected);

      // Pre-select card if saved (or first demo card)
      if (state.isDemo && state.userCards.length > 0) {
        onCardSelected(state.userCards[0], true);
      } else if (state.profile.selectedCardId) {
        const saved = state.userCards.find(c => c.id === state.profile.selectedCardId);
        if (saved) onCardSelected(saved, true);
      }

      // Load recent matches (skip for demo — no history)
      if (!state.isDemo) {
        loadRecentMatches();
      }

      // Leaderboard toggle + sort bindings
      bindLeaderboard();

      // Check for first-time tutorial
      checkTutorial();

      // Navigate to hash screen if specified
      if (hash && hash !== 'lobby') {
        showScreen(hash);
      }
    } catch (err) {
      console.error('[Arena] Init error:', err);
      document.getElementById('arena-auth-gate').style.display = 'flex';
      document.getElementById('arena-lobby-main').style.display = 'none';
    }
  }

  function showDemoBanner() {
    var banner = document.getElementById('arena-demo-banner');
    if (banner) banner.style.display = 'flex';

    // Show login button in top bar
    var loginBtn = document.getElementById('arena-login-btn');
    if (loginBtn) loginBtn.style.display = 'inline-flex';
  }

  function showAuthStatus() {
    // Show logged-in user info in top bar
    fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (data) {
      if (!data || !data.clientPrincipal) return;
      var name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'User';
      var loginBtn = document.getElementById('arena-login-btn');
      var userStatus = document.getElementById('arena-user-status');
      var userName = document.getElementById('arena-user-name');
      if (loginBtn) loginBtn.style.display = 'none';
      if (userStatus) userStatus.style.display = 'inline-flex';
      if (userName) userName.textContent = name;
    }).catch(function () {});

    document.getElementById('arena-logout-btn')?.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.href = '/.auth/logout?post_logout_redirect_uri=/cardforge/arena.html';
    });
  }

  function disablePvP() {
    var pvpBtn = document.getElementById('arena-btn-pvp');
    if (pvpBtn) {
      pvpBtn.disabled = true;
      pvpBtn.title = 'Sign in to challenge other players';
      pvpBtn.style.opacity = '0.5';
      pvpBtn.style.cursor = 'not-allowed';
    }
  }

  function onCardSelected(card, skipSave) {
    state.selectedCard = card;
    window.ArenaCardSelect.renderChampionDisplay(card, 'arena-champion-display', state.profile);
    window.ArenaCardSelect.highlightCard('arena-card-strip', card.id);

    // Enable PvE button (PvP only if not demo)
    document.getElementById('arena-btn-pve').disabled = false;
    if (!state.isDemo) {
      document.getElementById('arena-btn-pvp').disabled = false;
    }

    // Save selection (fire and forget) — skip for demo
    if (!skipSave && !state.isDemo) {
      window.ArenaAPI.selectCard(card.id).catch(e => console.warn('Failed to save card selection:', e));
    }
  }

  async function loadRecentMatches() {
    try {
      const data = await window.ArenaAPI.loadHistory(5, 0);
      window.ArenaResults.renderMatchList(data.matches, 'arena-recent-matches');
    } catch (err) {
      console.warn('[Arena] Could not load history:', err);
    }
  }

  // --- Leaderboard ---

  let _lbLoaded = false;

  function bindLeaderboard() {
    var lbToggle = document.getElementById('arena-lb-toggle');
    var lbPanel = document.getElementById('arena-leaderboard');
    if (!lbToggle || !lbPanel) return;

    lbToggle.addEventListener('click', function () {
      var expanded = lbPanel.style.display !== 'none';
      lbPanel.style.display = expanded ? 'none' : 'block';
      lbToggle.setAttribute('aria-expanded', String(!expanded));
      lbToggle.querySelector('i').className = 'fas ' + (expanded ? 'fa-chevron-down' : 'fa-chevron-up');
      if (!expanded && !_lbLoaded) {
        loadLeaderboard('xp');
        _lbLoaded = true;
      }
    });

    // Sort buttons
    lbPanel.querySelectorAll('.arena-lb-sort-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        lbPanel.querySelectorAll('.arena-lb-sort-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        loadLeaderboard(btn.dataset.sort);
      });
    });
  }

  async function loadLeaderboard(sort) {
    var listEl = document.getElementById('arena-lb-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="arena-empty-state"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
      var data = await window.ArenaAPI.loadLeaderboard(sort, 50);
      renderLeaderboard(data.leaderboard || [], data.playerPosition);
    } catch (err) {
      console.warn('[Arena] Leaderboard error:', err);
      listEl.innerHTML = '<div class="arena-empty-state">Could not load leaderboard</div>';
    }
  }

  function renderLeaderboard(entries, playerPosition) {
    var listEl = document.getElementById('arena-lb-list');
    if (!listEl) return;

    if (entries.length === 0) {
      listEl.innerHTML = '<div class="arena-empty-state">No players ranked yet. Be the first!</div>';
      return;
    }

    var tierColors = {
      'Bronze': '#cd7f32',
      'Silver': '#c0c0c0',
      'Gold': '#ffd700',
      'Platinum': '#e5e4e2',
      'Diamond': '#b9f2ff'
    };

    listEl.innerHTML = entries.map(function (e) {
      var rankIcon = '';
      if (e.rank === 1) rankIcon = '<i class="fas fa-crown" style="color:#ffd700"></i>';
      else if (e.rank === 2) rankIcon = '<i class="fas fa-medal" style="color:#c0c0c0"></i>';
      else if (e.rank === 3) rankIcon = '<i class="fas fa-medal" style="color:#cd7f32"></i>';
      else rankIcon = '<span class="arena-lb-rank-num">' + e.rank + '</span>';

      var tierColor = tierColors[e.tier] || '#a0a0c0';
      var isPlayer = playerPosition && e.rank === playerPosition;

      return '<div class="arena-lb-row' + (isPlayer ? ' arena-lb-row--you' : '') + '">' +
        '<div class="arena-lb-rank">' + rankIcon + '</div>' +
        '<div class="arena-lb-player">' +
          '<span class="arena-lb-name">' + escHtml(e.displayName) + '</span>' +
          '<span class="arena-lb-tier" style="color:' + tierColor + '"><i class="fas fa-shield-halved"></i> ' + escHtml(e.tier) + '</span>' +
        '</div>' +
        '<div class="arena-lb-stats">' +
          '<span class="arena-lb-xp"><i class="fas fa-star"></i> ' + (e.xp || 0).toLocaleString() + '</span>' +
          '<span class="arena-lb-record">' + e.wins + 'W / ' + e.losses + 'L</span>' +
          '<span class="arena-lb-winrate">' + e.winRate + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // --- Tutorial / Onboarding ---

  var _tutorialStep = -1;
  var _tutorialActive = false;

  var TUTORIAL_STEPS = [
    { move: 'strike', text: 'Strike deals damage based on your STR stat. Try it now!' },
    { move: 'guard', text: 'Guard blocks 60% of incoming Strike damage. Use it to survive heavy hits!' },
    { move: 'ability', text: 'Abilities cost charges and deal INT-based damage. Use yours now!', fallback: 'heal', fallbackText: 'Heal recovers HP based on your END stat. Try healing up!' }
  ];

  function checkTutorial() {
    if (localStorage.getItem('arena-tutorial-complete')) return;
    if (state.isDemo) return;

    var overlay = document.getElementById('arena-tutorial-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';

    document.getElementById('arena-tutorial-start').addEventListener('click', startTutorial);
    document.getElementById('arena-tutorial-skip-welcome').addEventListener('click', skipTutorial);
  }

  function startTutorial() {
    var overlay = document.getElementById('arena-tutorial-overlay');
    if (overlay) overlay.style.display = 'none';

    _tutorialActive = true;
    _tutorialStep = -1;

    // Auto-select first card if none selected; fall back to demo card if collection is empty
    if (!state.selectedCard) {
      var cards = state.userCards.length > 0 ? state.userCards : getDemoCards();
      onCardSelected(cards[0], true);
    }

    if (state.selectedCard) {
      window.ArenaAPI.loadBosses().then(function (data) {
        var bosses = data.bosses || [];
        var dummy = bosses[0]; // First boss = Training Dummy
        if (dummy) {
          window.ArenaBattleUI.startBattle('pve', state.selectedCard, dummy);
          showScreen('battle');
          setTimeout(function () { advanceTutorial(); }, 1500);
        }
      }).catch(function () { skipTutorial(); });
    } else {
      skipTutorial();
    }
  }

  function advanceTutorial() {
    if (!_tutorialActive) return;
    _tutorialStep++;

    document.querySelectorAll('.arena-tutorial-highlight').forEach(function (el) {
      el.classList.remove('arena-tutorial-highlight');
    });

    if (_tutorialStep >= TUTORIAL_STEPS.length) {
      endTutorial();
      return;
    }

    var step = TUTORIAL_STEPS[_tutorialStep];
    var moveBtn = document.querySelector('[data-move="' + step.move + '"]');

    if (step.move === 'ability' && step.fallback) {
      var chargeEl = document.getElementById('arena-ability-charge');
      var chargeText = chargeEl ? chargeEl.textContent : '0/0';
      var charges = parseInt(chargeText.split('/')[0]) || 0;
      if (charges < 2) {
        moveBtn = document.querySelector('[data-move="' + step.fallback + '"]');
        step = { move: step.fallback, text: step.fallbackText };
      }
    }

    if (!moveBtn) { advanceTutorial(); return; }

    moveBtn.classList.add('arena-tutorial-highlight');

    var tooltip = document.getElementById('arena-tutorial-tooltip');
    var textEl = document.getElementById('arena-tutorial-text');
    if (tooltip && textEl) {
      textEl.textContent = step.text;
      tooltip.style.display = 'block';

      var rect = moveBtn.getBoundingClientRect();
      tooltip.style.top = (rect.top - tooltip.offsetHeight - 12) + 'px';
      tooltip.style.left = (rect.left + rect.width / 2 - tooltip.offsetWidth / 2) + 'px';

      var tooltipRect = tooltip.getBoundingClientRect();
      if (tooltipRect.left < 8) tooltip.style.left = '8px';
      if (tooltipRect.right > window.innerWidth - 8) tooltip.style.left = (window.innerWidth - tooltip.offsetWidth - 8) + 'px';
      if (tooltipRect.top < 8) tooltip.style.top = (rect.bottom + 12) + 'px';
    }

    var handler = function () {
      moveBtn.removeEventListener('click', handler);
      setTimeout(function () { advanceTutorial(); }, 2000);
    };
    moveBtn.addEventListener('click', handler);

    var skipBtn = document.getElementById('arena-tutorial-skip');
    if (skipBtn) skipBtn.onclick = skipTutorial;
  }

  function endTutorial() {
    _tutorialActive = false;
    localStorage.setItem('arena-tutorial-complete', 'true');

    var tooltip = document.getElementById('arena-tutorial-tooltip');
    if (tooltip) tooltip.style.display = 'none';

    document.querySelectorAll('.arena-tutorial-highlight').forEach(function (el) {
      el.classList.remove('arena-tutorial-highlight');
    });
  }

  function skipTutorial() {
    _tutorialActive = false;
    localStorage.setItem('arena-tutorial-complete', 'true');

    var overlay = document.getElementById('arena-tutorial-overlay');
    if (overlay) overlay.style.display = 'none';

    var tooltip = document.getElementById('arena-tutorial-tooltip');
    if (tooltip) tooltip.style.display = 'none';

    document.querySelectorAll('.arena-tutorial-highlight').forEach(function (el) {
      el.classList.remove('arena-tutorial-highlight');
    });
  }

  window._arenaTutorial = {
    isActive: function () { return _tutorialActive; },
    advance: advanceTutorial,
    end: endTutorial
  };

  // --- PvE ---

  async function openPveLadder() {
    showScreen('pve');
    const ladder = document.getElementById('arena-boss-ladder');
    if (ladder) ladder.innerHTML = '<div class="arena-loading"><i class="fas fa-spinner fa-spin"></i> Loading bosses...</div>';

    try {
      const data = await window.ArenaAPI.loadBosses();
      state.bosses = data.bosses || [];
      renderBossLadder(state.bosses);
    } catch (err) {
      if (ladder) ladder.innerHTML = `<div class="arena-error">Failed to load bosses: ${err.message}</div>`;
    }
  }

  function renderBossLadder(bosses) {
    const ladder = document.getElementById('arena-boss-ladder');
    if (!ladder) return;

    ladder.innerHTML = bosses.map(boss => {
      const locked = boss.locked;
      const stats = boss.stats || [];
      const statHtml = stats.map(s => `<span>${s.name}: ${s.value}</span>`).join(' ');

      return `
        <div class="arena-boss-card ${locked ? 'arena-boss-card--locked' : ''}" data-boss-id="${boss.id}">
          <div class="arena-boss-card__level">Lv. ${boss.bossLevel}</div>
          <div class="arena-boss-card__avatar">
            ${boss.avatar ? `<img src="${boss.avatar}" alt="${boss.name}">` : `<i class="fas ${locked ? 'fa-lock' : 'fa-skull-crossbones'}"></i>`}
          </div>
          <div class="arena-boss-card__info">
            <div class="arena-boss-card__name">${boss.name}</div>
            <div class="arena-boss-card__class">${boss.class}</div>
            <div class="arena-boss-card__bio">${boss.bio || ''}</div>
            ${!locked ? `<div class="arena-boss-card__stats">${statHtml}</div>` : ''}
          </div>
          <div class="arena-boss-card__action">
            ${locked
              ? '<span class="arena-boss-card__locked-label"><i class="fas fa-lock"></i> Locked</span>'
              : `<button class="arena-btn arena-btn--primary arena-btn--sm" data-fight-boss="${boss.id}">Fight</button>`
            }
          </div>
        </div>
      `;
    }).join('');

    // Bind fight buttons
    ladder.querySelectorAll('[data-fight-boss]').forEach(btn => {
      btn.addEventListener('click', () => startPveBattle(btn.dataset.fightBoss));
    });
  }

  async function startPveBattle(bossId) {
    if (!state.selectedCard) {
      alert('Select a champion card first!');
      showScreen('lobby');
      return;
    }

    state.lastBattleType = 'pve';
    state.lastOpponentId = bossId;

    showScreen('battle');
    if (window.ArenaAudio && window.ArenaBackgrounds) window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
    if (window.ArenaBackgrounds) window.ArenaBackgrounds.applyToBattleStage();
    window.ArenaBattleUI.enableMoves(false);

    try {
      // Demo mode: pass card data to server (no blob lookup)
      const extra = state.isDemo ? { cardData: state.selectedCard } : {};
      const battleData = await window.ArenaAPI.startBattle('pve', state.selectedCard.id, bossId, extra);
      state.activeBattle = battleData;
      window.ArenaBattleUI.initBattle(battleData);
    } catch (err) {
      alert(`Failed to start battle: ${err.message}`);
      showScreen('pve');
    }
  }

  // --- PvP ---

  async function openPvpSelect() {
    showScreen('pvp');
    const grid = document.getElementById('arena-gallery-grid');
    if (grid) grid.innerHTML = '<div class="arena-loading"><i class="fas fa-spinner fa-spin"></i> Loading gallery...</div>';

    try {
      const data = await window.ArenaAPI.loadCards();
      const gallery = data.galleryCards || [];
      renderGalleryGrid(gallery);
    } catch (err) {
      if (grid) grid.innerHTML = `<div class="arena-error">Failed to load gallery: ${err.message}</div>`;
    }
  }

  function renderGalleryGrid(cards) {
    const grid = document.getElementById('arena-gallery-grid');
    if (!grid) return;

    if (!cards || cards.length === 0) {
      grid.innerHTML = '<div class="arena-empty-state">No cards in the gallery yet.</div>';
      return;
    }

    grid.innerHTML = cards.map(card => `
      <div class="arena-gallery-card" data-card-id="${card.id}">
        <div class="arena-gallery-card__avatar">
          ${card.avatar ? `<img src="${card.avatar}" alt="${card.name}">` : '<i class="fas fa-user"></i>'}
        </div>
        <div class="arena-gallery-card__name">${card.name || 'Unnamed'}</div>
        <div class="arena-gallery-card__class">${card.class || ''}</div>
        <button class="arena-btn arena-btn--primary arena-btn--sm" data-fight-pvp="${card.id}">Challenge</button>
      </div>
    `).join('');

    grid.querySelectorAll('[data-fight-pvp]').forEach(btn => {
      btn.addEventListener('click', () => startPvpBattle(btn.dataset.fightPvp));
    });
  }

  async function startPvpBattle(opponentId) {
    if (!state.selectedCard) {
      alert('Select a champion card first!');
      showScreen('lobby');
      return;
    }

    state.lastBattleType = 'pvp';
    state.lastOpponentId = opponentId;

    showScreen('battle');
    if (window.ArenaAudio && window.ArenaBackgrounds) window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
    if (window.ArenaBackgrounds) window.ArenaBackgrounds.applyToBattleStage();
    window.ArenaBattleUI.enableMoves(false);

    try {
      const battleData = await window.ArenaAPI.startBattle('pvp', state.selectedCard.id, opponentId);
      state.activeBattle = battleData;
      window.ArenaBattleUI.initBattle(battleData);
    } catch (err) {
      alert(`Failed to start battle: ${err.message}`);
      showScreen('pvp');
    }
  }

  // --- Navigation ---

  function bindNavigation() {
    document.getElementById('arena-btn-pve')?.addEventListener('click', openPveLadder);
    document.getElementById('arena-btn-pvp')?.addEventListener('click', openPvpSelect);
    document.getElementById('arena-pve-back')?.addEventListener('click', () => showScreen('lobby'));
    document.getElementById('arena-pvp-back')?.addEventListener('click', () => showScreen('lobby'));
    document.getElementById('arena-history-back')?.addEventListener('click', () => showScreen('lobby'));
    document.getElementById('arena-view-history')?.addEventListener('click', openFullHistory);

    // Results modal buttons
    function closeResultsOverlay() {
      var overlay = document.getElementById('arena-results-overlay');
      if (overlay) overlay.style.display = 'none';
    }
    document.getElementById('arena-results-close')?.addEventListener('click', closeResultsOverlay);
    document.getElementById('arena-results-lobby')?.addEventListener('click', () => {
      closeResultsOverlay();
      refreshLobby();
      showScreen('lobby');
    });
    document.getElementById('arena-results-again')?.addEventListener('click', () => {
      closeResultsOverlay();
      if (state.lastBattleType === 'pve' && state.lastOpponentId) {
        startPveBattle(state.lastOpponentId);
      } else if (state.lastBattleType === 'pvp') {
        openPvpSelect();
      } else {
        showScreen('lobby');
      }
    });

    // Battle screen post-battle buttons (shown after battle ends)
    document.getElementById('arena-battle-back')?.addEventListener('click', () => {
      closeResultsOverlay();
      refreshLobby();
      showScreen('lobby');
    });
    document.getElementById('arena-battle-again')?.addEventListener('click', () => {
      closeResultsOverlay();
      if (state.lastBattleType === 'pve' && state.lastOpponentId) {
        startPveBattle(state.lastOpponentId);
      } else if (state.lastBattleType === 'pvp') {
        openPvpSelect();
      } else {
        showScreen('lobby');
      }
    });

    // Hash-based back button
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '') || 'lobby';
      if (document.getElementById('arena-screen-' + hash)) {
        document.querySelectorAll('.arena-screen').forEach(s => s.classList.remove('active'));
        document.getElementById('arena-screen-' + hash).classList.add('active');
      }
    });
  }

  async function openFullHistory() {
    showScreen('history');
    const container = document.getElementById('arena-full-history');
    if (container) container.innerHTML = '<div class="arena-loading"><i class="fas fa-spinner fa-spin"></i> Loading history...</div>';
    try {
      const data = await window.ArenaAPI.loadHistory(50, 0);
      window.ArenaResults.renderMatchList(data.matches, 'arena-full-history');
    } catch (err) {
      if (container) container.innerHTML = '<div class="arena-error">Failed to load match history.</div>';
    }
  }

  async function refreshLobby() {
    try {
      const profileData = await window.ArenaAPI.loadProfile();
      if (profileData.profile) {
        state.profile = profileData.profile;
        window.ArenaResults.updateRankDisplay(state.profile);
        window._arenaProfile = state.profile;
        if (window.EffectTiers) {
          if (window.EffectTiers.renderRankRewardsPanel) window.EffectTiers.renderRankRewardsPanel('arena-rewards-panel');
          if (window.EffectTiers.renderNextRankPreview) window.EffectTiers.renderNextRankPreview('arena-next-rank-preview');
        }
      }
      // Re-render arena picker (new rank may unlock arenas)
      if (window.ArenaBackgrounds) {
        window.ArenaBackgrounds.renderPicker('arena-bg-picker', state.profile.rank, function (arenaId) {
          if (window.ArenaAudio) window.ArenaAudio.playArenaMusic(arenaId);
        });
      }
      if (!state.isDemo) {
        loadRecentMatches();
      }
    } catch (err) {
      console.warn('[Arena] Refresh error:', err);
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  return { showScreen, refreshLobby };
})();
