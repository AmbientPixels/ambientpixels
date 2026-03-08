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
        avatar: '',
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
        avatar: '',
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
        avatar: '',
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
    window.location.hash = screenId;
  }

  async function init() {
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

    // Results screen buttons
    document.getElementById('arena-results-lobby')?.addEventListener('click', () => {
      refreshLobby();
      showScreen('lobby');
    });
    document.getElementById('arena-results-again')?.addEventListener('click', () => {
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
