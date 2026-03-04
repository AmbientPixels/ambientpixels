/**
 * Arena App — main page controller
 * Init, screen navigation, state management
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
    lastOpponentId: null
  };

  const state = window._arenaState;

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
    if (hash && document.getElementById('arena-screen-' + hash)) {
      // We'll navigate after loading
    }

    // Load profile + cards
    try {
      const [profileData, cardsData] = await Promise.all([
        window.ArenaAPI.loadProfile().catch(() => null),
        window.ArenaAPI.loadCards().catch(() => ({ userCards: [] }))
      ]);

      if (!profileData || !profileData.profile) {
        // Not authenticated
        document.getElementById('arena-auth-gate').style.display = 'flex';
        document.getElementById('arena-lobby-main').style.display = 'none';
        return;
      }

      // Authenticated
      document.getElementById('arena-auth-gate').style.display = 'none';
      document.getElementById('arena-lobby-main').style.display = 'block';

      state.profile = profileData.profile;
      state.userCards = cardsData.userCards || [];

      // Render profile
      window.ArenaResults.updateRankDisplay(state.profile);

      // Render card strip
      window.ArenaCardSelect.renderCardStrip(state.userCards, 'arena-card-strip', onCardSelected);

      // Pre-select card if saved
      if (state.profile.selectedCardId) {
        const saved = state.userCards.find(c => c.id === state.profile.selectedCardId);
        if (saved) onCardSelected(saved, true);
      }

      // Load recent matches
      loadRecentMatches();

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

  function onCardSelected(card, skipSave) {
    state.selectedCard = card;
    window.ArenaCardSelect.renderChampionDisplay(card, 'arena-champion-display');
    window.ArenaCardSelect.highlightCard('arena-card-strip', card.id);

    // Enable mode buttons
    document.getElementById('arena-btn-pve').disabled = false;
    document.getElementById('arena-btn-pvp').disabled = false;

    // Save selection (fire and forget)
    if (!skipSave) {
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
      const battleData = await window.ArenaAPI.startBattle('pve', state.selectedCard.id, bossId);
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

  async function refreshLobby() {
    try {
      const profileData = await window.ArenaAPI.loadProfile();
      if (profileData.profile) {
        state.profile = profileData.profile;
        window.ArenaResults.updateRankDisplay(state.profile);
      }
      loadRecentMatches();
    } catch (err) {
      console.warn('[Arena] Refresh error:', err);
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  return { showScreen, refreshLobby };
})();
