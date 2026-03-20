/**
 * Blindspot Flow — Game logic, player detection, battle orchestration,
 * campaign ladder, Forge system, PvP unlock.
 *
 * Runs on BOTH index.html (landing/stranger flow) and play.html (lobby/campaign/battle).
 *
 * CRITICAL NOTES:
 * - Boss IDs must match server's arena-bosses.json (boss-1 through boss-10)
 * - Stranger fight uses demo mode (cardData param) — only works for unauthenticated users
 * - Authenticated new players skip Stranger fight and go straight to Quick Build
 * - Forge stat save uses direct API call, not CardForge editor pipeline
 */
(function () {
  'use strict';

  // ============================================================
  // CONFIG & STATE
  // ============================================================

  let _config = null;
  let _bosses = [];
  let _strangerCard = null;
  let _profile = null;
  let _profileData = null; // raw API response (includes isDemo flag)
  let _selectedCard = null;
  let _activeBattle = null;
  let _isStrangerFight = false;
  let _isFirstRealFight = false;
  let _currentBossId = null;
  let _battleType = 'pve';
  let _hookInstalled = false;
  let _origShowResults = null;

  const RANKS = {
    bronze:   { xp: 0,    icon: 'fa-shield-halved', color: '#CD7F32', label: 'Bronze' },
    silver:   { xp: 500,  icon: 'fa-shield',        color: '#C0C0C0', label: 'Silver' },
    gold:     { xp: 1500, icon: 'fa-crown',          color: '#FFD700', label: 'Gold' },
    platinum: { xp: 3500, icon: 'fa-gem',            color: '#E5E4E2', label: 'Platinum' },
    diamond:  { xp: 7000, icon: 'fa-diamond',        color: '#B9F2FF', label: 'Diamond' }
  };
  const RANK_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

  // ============================================================
  // SHARED UTILITIES
  // ============================================================

  function isOnLandingPage() {
    return !!document.getElementById('bs-landing');
  }

  function isOnPlayPage() {
    return !!document.getElementById('bs-screen-lobby');
  }

  function showOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('bs-overlay--hidden');
  }

  function hideOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('bs-overlay--hidden');
  }

  function showScreen(id) {
    document.querySelectorAll('.bs-screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('bs-screen-' + id);
    if (target) target.classList.add('active');
  }

  function isNewPlayer(profile) {
    const onboarded = localStorage.getItem('blindspot-onboarded');
    if (onboarded) return false;
    return (!profile || (profile.xp === 0 && !profile.selectedCardId));
  }

  function isDemo() {
    return _profileData ? (_profileData.isDemo || false) : true;
  }

  function getForgeWins() {
    return parseInt(localStorage.getItem('bs-wins-to-forge') || '0', 10);
  }

  function setForgeWins(n) {
    localStorage.setItem('bs-wins-to-forge', String(n));
  }

  function isForgePending() {
    return localStorage.getItem('bs-forge-pending') === 'true';
  }

  function getHighestBossDefeated() {
    return parseInt(localStorage.getItem('bs-highest-boss') || '0', 10);
  }

  function setHighestBossDefeated(n) {
    const current = getHighestBossDefeated();
    if (n > current) localStorage.setItem('bs-highest-boss', String(n));
  }

  function getForgeVisitCount() {
    return parseInt(localStorage.getItem('bs-forge-visits') || '0', 10);
  }

  function incForgeVisitCount() {
    const c = getForgeVisitCount() + 1;
    localStorage.setItem('bs-forge-visits', String(c));
    return c;
  }

  // ============================================================
  // LOAD DATA
  // ============================================================

  async function loadGameData() {
    const [configResp, bossesResp, strangerResp] = await Promise.all([
      fetch('/blindspot/data/game-config.json').then(r => r.json()),
      fetch('/blindspot/data/bosses.json').then(r => r.json()),
      fetch('/blindspot/data/stranger-card.json').then(r => r.json())
    ]);
    _config = configResp;
    _bosses = bossesResp;
    _strangerCard = strangerResp;
  }

  async function loadProfile() {
    try {
      const data = await window.ArenaAPI.loadProfile();
      _profileData = data;
      _profile = data.profile || null;
      return _profile;
    } catch (e) {
      console.warn('[Blindspot] Could not load profile:', e);
      _profileData = null;
      _profile = null;
      return null;
    }
  }

  async function loadUserCards() {
    try {
      const data = await window.ArenaAPI.loadCards();
      return data.userCards || [];
    } catch (e) {
      console.warn('[Blindspot] Could not load cards:', e);
      return [];
    }
  }

  // ============================================================
  // BATTLE COMPLETION HOOK (installed once per page)
  // ============================================================

  function hookBattleCompletion() {
    if (_hookInstalled) return;
    if (!window.ArenaResults || !window.ArenaResults.showResults) {
      console.warn('[Blindspot] ArenaResults not available for hook');
      return;
    }

    _hookInstalled = true;
    _origShowResults = window.ArenaResults.showResults;

    window.ArenaResults.showResults = function (battleResult, battleData) {
      // Remove pulse hints
      document.querySelectorAll('.bs-pulse-hint').forEach(btn => {
        btn.classList.remove('bs-pulse-hint');
      });

      if (_isStrangerFight) {
        handleStrangerResult(battleResult, battleData);
        return;
      }

      if (_isFirstRealFight) {
        _origShowResults.call(window.ArenaResults, battleResult, battleData);
        handleFirstRealFightResult(battleResult, battleData);
        return;
      }

      if (isOnPlayPage()) {
        _origShowResults.call(window.ArenaResults, battleResult, battleData);
        handlePlayPageResult(battleResult, battleData);
        return;
      }

      _origShowResults.call(window.ArenaResults, battleResult, battleData);
    };
  }

  // ============================================================
  // LANDING PAGE (index.html)
  // ============================================================

  async function initLanding() {
    await loadGameData();
    const profile = await loadProfile();

    const fightBtn = document.getElementById('bs-fight-btn');
    if (!fightBtn) return;

    fightBtn.addEventListener('click', async () => {
      fightBtn.disabled = true;
      fightBtn.textContent = 'Loading...';

      if (!isNewPlayer(profile)) {
        window.location.href = '/blindspot/play.html';
        return;
      }

      // Authenticated new players can't use Stranger fight (cardData only works in demo)
      // Skip straight to Quick Build for them
      if (!isDemo()) {
        openBlindspotQuickBuild();
        return;
      }

      // Demo (unauthenticated) new player — start Stranger fight
      await startStrangerFight();
    });
  }

  async function startStrangerFight() {
    _isStrangerFight = true;

    document.getElementById('bs-landing').style.display = 'none';
    document.getElementById('bs-battle-container').style.display = 'block';

    if (window.ArenaAudio) window.ArenaAudio.init();

    // Bind battle UI events (only once)
    if (!window._bsBattleEventsBound) {
      window.ArenaBattleUI.bindEvents();
      window._bsBattleEventsBound = true;
    }

    // Hook battle completion (only once)
    hookBattleCompletion();

    try {
      // Demo mode: pass cardData so server uses it instead of looking up by ID
      const battleData = await window.ArenaAPI.startBattle(
        'pve',
        _strangerCard.id,
        _config.tutorialBoss.id, // 'boss-1' — matches server's arena-bosses.json
        { cardData: _strangerCard }
      );
      _activeBattle = battleData;

      if (window.ArenaAudio && window.ArenaBackgrounds) {
        window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
      }
      if (window.ArenaBackgrounds) window.ArenaBackgrounds.applyToBattleStage();

      window.ArenaBattleUI.initBattle(battleData);

      // Pulse animation on action buttons (round 1 hint)
      document.querySelectorAll('.arena-move-btn').forEach(btn => {
        btn.classList.add('bs-pulse-hint');
      });
    } catch (err) {
      console.error('[Blindspot] Failed to start stranger fight:', err);
      alert('Failed to start battle. Please try again.');
      document.getElementById('bs-landing').style.display = '';
      document.getElementById('bs-battle-container').style.display = 'none';
    }
  }

  function handleStrangerResult(battleResult, battleData) {
    const isWin = battleResult.winner === 'player';
    document.getElementById('bs-battle-container').style.display = 'none';

    if (isWin) {
      showOverlay('bs-stranger-win');

      document.getElementById('bs-build-btn').addEventListener('click', () => {
        hideOverlay('bs-stranger-win');
        openBlindspotQuickBuild();
      }, { once: true });
    } else {
      showOverlay('bs-stranger-loss');

      document.getElementById('bs-stranger-loss').addEventListener('click', () => {
        hideOverlay('bs-stranger-loss');
        startStrangerFight();
      }, { once: true });
    }
  }

  function openBlindspotQuickBuild() {
    if (!window.BlindspotQuickBuild) {
      console.error('[Blindspot] Quick Build not loaded');
      return;
    }

    window.BlindspotQuickBuild.open(function onComplete(cardId) {
      _isStrangerFight = false;
      _isFirstRealFight = true;

      if (cardId) {
        window.ArenaAPI.selectCard(cardId).catch(e => console.warn('selectCard error:', e));
      }

      // For demo users: redirect to play.html for the first real fight
      // For authenticated users: also redirect (they have a saved card now)
      if (isDemo()) {
        // Demo users can't do a "real" first fight (no persistence)
        // Mark as onboarded and send to play page
        localStorage.setItem('blindspot-onboarded', 'true');
        window.location.href = '/blindspot/play.html';
      } else {
        // Authenticated: redirect with firstFight flag
        localStorage.setItem('blindspot-onboarded', 'true');
        window.location.href = '/blindspot/play.html?firstFight=true';
      }
    });
  }

  function handleFirstRealFightResult(battleResult, battleData) {
    localStorage.setItem('blindspot-onboarded', 'true');

    const isWin = battleResult.winner === 'player';

    if (isWin) {
      setForgeWins(1);
    }
    showForgeProgressInResults();

    const againBtn = document.getElementById('arena-results-again');
    const lobbyBtn = document.getElementById('arena-results-lobby');

    if (againBtn) {
      againBtn.textContent = isWin ? 'Next Fight' : 'Try Again';
    }
    if (lobbyBtn) {
      lobbyBtn.textContent = 'Go to Lobby';
    }
  }

  function showForgeProgressInResults() {
    const container = document.getElementById('bs-results-forge');
    if (!container) return;
    container.style.display = 'block';

    const wins = getForgeWins();
    const needed = _config ? _config.forgeVisit.winsRequired : 3;
    const pct = Math.min(100, (wins / needed) * 100);

    const label = document.getElementById('bs-results-forge-label');
    const fill = document.getElementById('bs-results-forge-fill');
    if (label) label.textContent = wins >= needed ? 'FORGE READY' : `FORGE \u00b7 ${wins} / ${needed}`;
    if (fill) fill.style.width = pct + '%';
  }

  // ============================================================
  // PLAY PAGE (play.html)
  // ============================================================

  async function initPlay() {
    await loadGameData();

    if (window.ArenaAudio) window.ArenaAudio.init();

    // Bind battle UI events (once)
    if (!window._bsBattleEventsBound) {
      window.ArenaBattleUI.bindEvents();
      window._bsBattleEventsBound = true;
    }

    // Hook battle completion
    hookBattleCompletion();

    const profile = await loadProfile();

    if (!profile) {
      window.location.href = '/blindspot/';
      return;
    }

    const cards = await loadUserCards();
    if (cards.length > 0) {
      _selectedCard = profile.selectedCardId
        ? cards.find(c => c.id === profile.selectedCardId) || cards[0]
        : cards[0];
    }

    // Check for first fight param
    const params = new URLSearchParams(window.location.search);
    if (params.get('firstFight') === 'true' && _selectedCard) {
      _isFirstRealFight = true;
      const titleEl = document.getElementById('bs-prefight-title');
      if (titleEl) titleEl.textContent = 'Your first real test.';
      showOverlay('bs-prefight-overlay');
      document.getElementById('bs-prefight-go').addEventListener('click', async () => {
        hideOverlay('bs-prefight-overlay');
        await startCampaignBattle(_bosses[0].id);
      }, { once: true });
      // Also bind navigation for after the fight
      bindPlayNavigation();
      return;
    }

    renderLobby();
    bindPlayNavigation();

    // Sync boss progress from server profile
    if (profile.pveProgress && profile.pveProgress.highestBossDefeated) {
      setHighestBossDefeated(profile.pveProgress.highestBossDefeated);
    }
  }

  function renderLobby() {
    const cardEl = document.getElementById('bs-player-card');
    if (cardEl && _selectedCard) {
      if (_selectedCard.avatar) {
        cardEl.innerHTML = `<img src="${_selectedCard.avatar}" alt="${_selectedCard.name || 'Card'}">`;
      } else {
        cardEl.innerHTML = `<div style="text-align:center; padding:1rem;">
          <i class="fas fa-user" style="font-size:2rem; color:var(--bs-text-muted);"></i>
          <p style="font-size:0.8rem; color:var(--bs-text-muted); margin-top:0.5rem;">${_selectedCard.name || 'Your Card'}</p>
        </div>`;
      }
    }

    updateRankDisplay();
    updateForgeProgress();

    const highestBoss = getHighestBossDefeated();
    const pvpBtn = document.getElementById('bs-btn-pvp');
    const pvpLock = document.getElementById('bs-pvp-lock');
    if (highestBoss >= 10) {
      if (pvpBtn) pvpBtn.disabled = false;
      if (pvpLock) pvpLock.style.display = 'none';
    }
  }

  function updateRankDisplay() {
    if (!_profile) return;

    const badge = document.getElementById('bs-rank-badge');
    const xpFill = document.getElementById('bs-xp-fill');
    const xpText = document.getElementById('bs-xp-text');

    const rank = _profile.rank || 'bronze';
    const rankInfo = RANKS[rank] || RANKS.bronze;
    const nextIdx = RANK_ORDER.indexOf(rank) + 1;
    const nextRank = nextIdx < RANK_ORDER.length ? RANKS[RANK_ORDER[nextIdx]] : null;

    if (badge) {
      badge.innerHTML = `<i class="fas ${rankInfo.icon}" style="color:${rankInfo.color}"></i> <span>${rankInfo.label}</span>`;
    }

    const currentXp = _profile.xp || 0;
    const currentRankXp = rankInfo.xp;
    const nextRankXp = nextRank ? nextRank.xp : currentRankXp;

    if (nextRank) {
      const progress = ((currentXp - currentRankXp) / (nextRankXp - currentRankXp)) * 100;
      if (xpFill) xpFill.style.width = Math.min(100, Math.max(0, progress)) + '%';
      if (xpText) xpText.textContent = `${currentXp} / ${nextRankXp} XP`;
    } else {
      if (xpFill) xpFill.style.width = '100%';
      if (xpText) xpText.textContent = `${currentXp} XP \u2014 Max Rank`;
    }
  }

  function updateForgeProgress() {
    const wins = getForgeWins();
    const needed = _config ? _config.forgeVisit.winsRequired : 3;
    const ready = wins >= needed || isForgePending();

    const label = document.getElementById('bs-forge-label');
    const fill = document.getElementById('bs-forge-fill');
    const container = document.getElementById('bs-forge-progress');

    const pct = ready ? 100 : Math.min(100, (wins / needed) * 100);

    if (label) label.textContent = ready ? 'FORGE READY' : `FORGE \u00b7 ${wins} / ${needed}`;
    if (fill) fill.style.width = pct + '%';

    if (container) {
      container.classList.toggle('bs-forge-progress--ready', ready);
      container.onclick = ready ? () => openForgeScreen() : null;
    }
  }

  let _navBound = false;

  function bindPlayNavigation() {
    if (_navBound) return;
    _navBound = true;

    // Campaign
    document.getElementById('bs-btn-campaign')?.addEventListener('click', () => {
      showScreen('campaign');
      renderCampaignLadder();
    });

    // PvP
    document.getElementById('bs-btn-pvp')?.addEventListener('click', () => {
      showScreen('pvp');
      renderPvPGallery();
    });

    // Leaderboard
    document.getElementById('bs-btn-leaderboard')?.addEventListener('click', () => {
      window.open('/cardforge/arena.html#lobby', '_blank');
    });

    // Back buttons
    document.getElementById('bs-campaign-back')?.addEventListener('click', () => {
      showScreen('lobby');
      renderLobby();
    });
    document.getElementById('bs-pvp-back')?.addEventListener('click', () => {
      showScreen('lobby');
      renderLobby();
    });

    // Forge trigger buttons
    document.getElementById('bs-forge-now')?.addEventListener('click', () => {
      hideOverlay('bs-forge-trigger');
      openForgeScreen();
    });

    document.getElementById('bs-forge-later')?.addEventListener('click', () => {
      hideOverlay('bs-forge-trigger');
      localStorage.setItem('bs-forge-pending', 'true');
      updateForgeProgress();
    });

    // Forge unlock button
    document.getElementById('bs-forge-unlock-btn')?.addEventListener('click', () => {
      hideOverlay('bs-forge-unlock');
      openForgeScreen(true);
    });

    // Architect win continue
    document.getElementById('bs-architect-continue')?.addEventListener('click', () => {
      hideOverlay('bs-architect-win');
      refreshLobby();
      showScreen('lobby');
    });

    // Results buttons — DON'T re-bind forfeit (ArenaBattleUI.bindEvents already handles it)
    document.getElementById('arena-results-again')?.addEventListener('click', () => {
      document.getElementById('arena-results-overlay').style.display = 'none';
      if (_isFirstRealFight) {
        _isFirstRealFight = false;
        showScreen('campaign');
        renderCampaignLadder();
        return;
      }
      if (_battleType === 'pvp') {
        showScreen('pvp');
        renderPvPGallery();
      } else if (_currentBossId) {
        startCampaignBattle(_currentBossId);
      } else {
        showScreen('campaign');
        renderCampaignLadder();
      }
    });

    document.getElementById('arena-results-lobby')?.addEventListener('click', () => {
      document.getElementById('arena-results-overlay').style.display = 'none';
      _isFirstRealFight = false;
      refreshLobby();
      showScreen('lobby');
    });

    document.getElementById('arena-results-close')?.addEventListener('click', () => {
      document.getElementById('arena-results-overlay').style.display = 'none';
    });

    // Battle post-actions
    document.getElementById('arena-battle-again')?.addEventListener('click', () => {
      if (_currentBossId) {
        startCampaignBattle(_currentBossId);
      }
    });
    document.getElementById('arena-battle-back')?.addEventListener('click', () => {
      showScreen('lobby');
      refreshLobby();
    });
  }

  // ============================================================
  // CAMPAIGN LADDER
  // ============================================================

  function renderCampaignLadder() {
    const container = document.getElementById('bs-boss-ladder');
    if (!container) return;

    const highestDefeated = getHighestBossDefeated();

    container.innerHTML = _bosses.map(boss => {
      const defeated = boss.boss <= highestDefeated;
      const current = boss.boss === highestDefeated + 1;
      const locked = boss.boss > highestDefeated + 1;

      let statusClass = '';
      if (defeated) statusClass = 'bs-boss-card--defeated';
      else if (current) statusClass = 'bs-boss-card--current';
      else if (locked) statusClass = 'bs-boss-card--locked';

      return `
        <div class="bs-boss-card ${statusClass}">
          <div class="bs-boss-card__number">${boss.boss}</div>
          <div class="bs-boss-card__info">
            <div class="bs-boss-card__name">${boss.name}</div>
            <div class="bs-boss-card__class">${boss.class}</div>
            <div class="bs-boss-card__flavor">${boss.flavor}</div>
          </div>
          <div class="bs-boss-card__action">
            ${locked
              ? '<i class="fas fa-lock" style="color:var(--bs-text-muted);"></i>'
              : defeated
                ? `<button class="bs-btn" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-boss="${boss.id}"><i class="fas fa-check" style="color:var(--bs-success);"></i> Replay</button>`
                : `<button class="bs-btn" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-boss="${boss.id}">Fight</button>`
            }
          </div>
        </div>
      `;
    }).join('');

    // Bind fight buttons
    container.querySelectorAll('[data-fight-boss]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bossId = btn.dataset.fightBoss;
        const boss = _bosses.find(b => b.id === bossId);
        if (boss) {
          const flavorEl = document.getElementById('bs-prefight-flavor');
          const titleEl = document.getElementById('bs-prefight-title');
          if (flavorEl) flavorEl.textContent = `"${boss.flavor}"`;
          if (titleEl) titleEl.textContent = boss.name;

          showOverlay('bs-prefight-overlay');
          const goBtn = document.getElementById('bs-prefight-go');
          const handler = async () => {
            goBtn.removeEventListener('click', handler);
            hideOverlay('bs-prefight-overlay');
            await startCampaignBattle(bossId);
          };
          goBtn.addEventListener('click', handler);
        }
      });
    });
  }

  async function startCampaignBattle(bossId) {
    if (!_selectedCard) {
      alert('No card selected. Please build a card first.');
      return;
    }

    _currentBossId = bossId;
    _battleType = 'pve';
    if (!_isFirstRealFight) {
      _isStrangerFight = false;
    }

    showScreen('battle');

    if (window.ArenaAudio && window.ArenaBackgrounds) {
      window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
    }
    if (window.ArenaBackgrounds) window.ArenaBackgrounds.applyToBattleStage();

    try {
      const battleData = await window.ArenaAPI.startBattle('pve', _selectedCard.id, bossId);
      _activeBattle = battleData;
      window.ArenaBattleUI.initBattle(battleData);
    } catch (err) {
      console.error('[Blindspot] Failed to start campaign battle:', err);
      alert('Failed to start battle: ' + err.message);
      showScreen('campaign');
    }
  }

  function handlePlayPageResult(battleResult, battleData) {
    const isWin = battleResult.winner === 'player';

    // Refresh profile async
    loadProfile().then(() => updateRankDisplay());

    if (_battleType === 'pve' && isWin) {
      const wins = getForgeWins() + 1;
      setForgeWins(wins);

      const boss = _bosses.find(b => b.id === _currentBossId);
      if (boss) {
        setHighestBossDefeated(boss.boss);
      }

      // Boss 10 win
      if (boss && boss.boss === 10) {
        setTimeout(() => {
          document.getElementById('arena-results-overlay').style.display = 'none';
          showOverlay('bs-architect-win');
        }, 2000);
        return;
      }

      // Forge unlock at Silver
      if (battleResult.rankUp && _profile && _profile.rank === 'silver') {
        const shown = localStorage.getItem('bs-forge-unlock-shown');
        if (!shown) {
          localStorage.setItem('bs-forge-unlock-shown', 'true');
          setTimeout(() => {
            document.getElementById('arena-results-overlay').style.display = 'none';
            showOverlay('bs-forge-unlock');
          }, 2000);
          return;
        }
      }

      // Forge visit trigger
      const needed = _config ? _config.forgeVisit.winsRequired : 3;
      if (wins >= needed) {
        setTimeout(() => {
          document.getElementById('arena-results-overlay').style.display = 'none';
          showOverlay('bs-forge-trigger');
        }, 2000);
        return;
      }
    }

    showForgeProgressInResults();

    const againBtn = document.getElementById('arena-results-again');
    if (againBtn) {
      againBtn.textContent = isWin ? 'Next Fight' : 'Try Again';
    }
  }

  // ============================================================
  // PVP
  // ============================================================

  async function renderPvPGallery() {
    const container = document.getElementById('bs-pvp-grid');
    if (!container) return;

    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> Loading gallery...</div>';

    try {
      const data = await window.ArenaAPI.loadCards();
      const gallery = data.galleryCards || [];

      if (gallery.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">No cards in the gallery yet.</p>';
        return;
      }

      container.innerHTML = gallery.map(card => `
        <div class="bs-boss-card" style="cursor:pointer;">
          <div class="bs-boss-card__number" style="width:40px;">
            ${card.avatar ? `<img src="${card.avatar}" alt="" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">` : '<i class="fas fa-user"></i>'}
          </div>
          <div class="bs-boss-card__info">
            <div class="bs-boss-card__name">${card.name || 'Unnamed'}</div>
            <div class="bs-boss-card__class">${card.class || ''}</div>
          </div>
          <div class="bs-boss-card__action">
            <button class="bs-btn" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-pvp="${card.id}">Challenge</button>
          </div>
        </div>
      `).join('');

      container.querySelectorAll('[data-fight-pvp]').forEach(btn => {
        btn.addEventListener('click', () => startPvPBattle(btn.dataset.fightPvp));
      });
    } catch (err) {
      container.innerHTML = '<p style="text-align:center; color:var(--bs-danger);">Failed to load gallery.</p>';
    }
  }

  async function startPvPBattle(opponentId) {
    if (!_selectedCard) return;

    _currentBossId = null;
    _battleType = 'pvp';

    showScreen('battle');

    if (window.ArenaAudio && window.ArenaBackgrounds) {
      window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
    }

    try {
      const battleData = await window.ArenaAPI.startBattle('pvp', _selectedCard.id, opponentId);
      _activeBattle = battleData;
      window.ArenaBattleUI.initBattle(battleData);
    } catch (err) {
      console.error('[Blindspot] PvP battle error:', err);
      showScreen('pvp');
    }
  }

  // ============================================================
  // FORGE SCREEN (Constrained Evolution)
  // Uses direct API save — does NOT require CardForge editor
  // ============================================================

  function openForgeScreen(isFirstUnlock) {
    const bonusPoints = isFirstUnlock
      ? (_config ? _config.forgeVisit.firstUnlockBonusPoints : 35)
      : (_config ? _config.forgeVisit.bonusPoints : 25);

    if (!_selectedCard || !_selectedCard.combatStats) {
      alert('No card selected for evolution.');
      return;
    }

    const currentStats = { ..._selectedCard.combatStats };
    const allocations = { str: 0, agi: 0, int: 0, end: 0, lck: 0 };

    const statDefs = [
      { key: 'str', label: 'STR', desc: 'Raw damage.',          color: '#ff5252' },
      { key: 'agi', label: 'AGI', desc: 'Speed and evasion.',   color: '#00e676' },
      { key: 'int', label: 'INT', desc: 'Ability power.',       color: '#7b2fff' },
      { key: 'end', label: 'END', desc: 'How long you survive.', color: '#ff9100' },
      { key: 'lck', label: 'LCK', desc: 'The unexpected.',      color: '#ffd740' }
    ];

    const panel = document.getElementById('bs-forge-panel');
    panel.innerHTML = `
      <h2 class="bs-forge-screen__title">Evolve Your Card</h2>
      <div class="bs-forge-screen__budget">
        Distribute <strong id="bs-forge-remaining">${bonusPoints}</strong> points
      </div>
      ${statDefs.map(d => `
        <div class="bs-forge-stat">
          <span class="bs-forge-stat__label" style="color:${d.color}">${d.label}</span>
          <input type="range" class="bs-forge-stat__slider" data-stat="${d.key}"
                 min="${currentStats[d.key]}" max="100"
                 value="${currentStats[d.key]}">
          <span class="bs-forge-stat__value" data-stat="${d.key}">${currentStats[d.key]}</span>
          <span class="bs-forge-stat__desc">${d.desc}</span>
        </div>
      `).join('')}
      <div class="bs-forge-actions">
        <button class="bs-btn bs-btn--primary" id="bs-forge-apply" disabled>Apply</button>
      </div>
    `;

    showOverlay('bs-forge-screen');

    const remainingEl = document.getElementById('bs-forge-remaining');
    const applyBtn = document.getElementById('bs-forge-apply');

    function updateBudget() {
      const totalAllocated = Object.values(allocations).reduce((a, b) => a + b, 0);
      const remaining = bonusPoints - totalAllocated;
      if (remainingEl) remainingEl.textContent = remaining;
      if (applyBtn) applyBtn.disabled = remaining !== 0;
    }

    panel.querySelectorAll('.bs-forge-stat__slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.stat;
        const desiredAllocation = parseInt(slider.value, 10) - currentStats[key];

        const totalOther = Object.entries(allocations).reduce((sum, [k, v]) => k === key ? sum : sum + v, 0);
        const maxAllocation = bonusPoints - totalOther;
        const clamped = Math.min(Math.max(0, desiredAllocation), maxAllocation);
        const clampedVal = currentStats[key] + clamped;

        allocations[key] = clamped;
        slider.value = clampedVal;

        const display = panel.querySelector(`.bs-forge-stat__value[data-stat="${key}"]`);
        if (display) display.textContent = clampedVal;

        updateBudget();
      });
    });

    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying...';

      const newStats = {};
      statDefs.forEach(d => {
        newStats[d.key] = currentStats[d.key] + allocations[d.key];
      });

      // Update local card object
      _selectedCard.combatStats = newStats;

      // Save via the saveCard API — sends the full card object with updated stats
      try {
        // Build the updated card object to save
        const cardToSave = { ..._selectedCard };
        cardToSave.combatStats = newStats;
        // Update legacy stats array if present
        cardToSave.stats = [
          { name: 'Strength', value: newStats.str },
          { name: 'Agility', value: newStats.agi },
          { name: 'Intelligence', value: newStats.int },
          { name: 'Endurance', value: newStats.end },
          { name: 'Luck', value: newStats.lck }
        ];

        const url = window.buildApiPath('saveCard');
        const headers = { 'Content-Type': 'application/json' };
        const authHeaders = await window.ArenaAPI.getPrincipalHeader();
        Object.assign(headers, authHeaders);

        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(cardToSave)
        });
      } catch (e) {
        console.warn('[Blindspot] Forge save error:', e);
      }

      // Reset forge tracking
      setForgeWins(0);
      localStorage.removeItem('bs-forge-pending');
      incForgeVisitCount();

      hideOverlay('bs-forge-screen');
      updateForgeProgress();
      renderLobby();
    });
  }

  // ============================================================
  // LOBBY REFRESH
  // ============================================================

  async function refreshLobby() {
    await loadProfile();
    const cards = await loadUserCards();
    if (cards.length > 0) {
      _selectedCard = (_profile && _profile.selectedCardId)
        ? cards.find(c => c.id === _profile.selectedCardId) || cards[0]
        : cards[0];
    }
    renderLobby();
  }

  // ============================================================
  // BOOT
  // ============================================================

  document.addEventListener('DOMContentLoaded', () => {
    if (isOnLandingPage()) {
      initLanding();
    } else if (isOnPlayPage()) {
      initPlay();
    }
  });

})();
