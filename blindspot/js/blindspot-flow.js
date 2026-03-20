/**
 * Blindspot Flow — Game logic, player detection, battle orchestration,
 * campaign ladder, Forge system, PvP unlock.
 *
 * Runs on BOTH index.html (landing/stranger flow) and play.html (lobby/campaign/battle).
 *
 * CRITICAL NOTES:
 * - Boss IDs use bs-boss-1 through bs-boss-10 (bossLevel 101-110 on server)
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
  let _profileData = null;
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

  // Boss class → icon mapping
  const BOSS_ICONS = {
    Enforcer: 'fa-gavel', Fighter: 'fa-hand-fist', Scout: 'fa-binoculars',
    Hacker: 'fa-terminal', Berserker: 'fa-fire', Scholar: 'fa-book',
    Guardian: 'fa-shield-halved', Trickster: 'fa-dice', Caster: 'fa-wand-magic-sparkles',
    Rogue: 'fa-user-ninja', Medic: 'fa-heart-pulse', Pilot: 'fa-rocket'
  };

  // ============================================================
  // SHARED UTILITIES
  // ============================================================

  function isOnLandingPage() { return !!document.getElementById('bs-landing'); }
  function isOnPlayPage() { return !!document.getElementById('bs-screen-lobby'); }

  function showOverlay(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('bs-overlay--hidden'); el.style.display = ''; }
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
    if (localStorage.getItem('blindspot-onboarded')) return false;
    return (!profile || (profile.xp === 0 && !profile.selectedCardId));
  }

  function isDemo() { return _profileData ? (_profileData.isDemo || false) : true; }

  function getForgeWins() { return parseInt(localStorage.getItem('bs-wins-to-forge') || '0', 10); }
  function setForgeWins(n) { localStorage.setItem('bs-wins-to-forge', String(n)); }
  function isForgePending() { return localStorage.getItem('bs-forge-pending') === 'true'; }

  function getHighestBossDefeated() { return parseInt(localStorage.getItem('bs-highest-boss') || '0', 10); }
  function setHighestBossDefeated(n) {
    if (n > getHighestBossDefeated()) localStorage.setItem('bs-highest-boss', String(n));
  }

  function getForgeVisitCount() { return parseInt(localStorage.getItem('bs-forge-visits') || '0', 10); }
  function incForgeVisitCount() {
    const c = getForgeVisitCount() + 1;
    localStorage.setItem('bs-forge-visits', String(c));
    return c;
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Boss attempt tracking
  function getBossRecord(bossId) {
    try {
      const data = JSON.parse(localStorage.getItem('bs-boss-records') || '{}');
      return data[bossId] || { wins: 0, losses: 0 };
    } catch { return { wins: 0, losses: 0 }; }
  }

  function recordBossResult(bossId, isWin) {
    try {
      const data = JSON.parse(localStorage.getItem('bs-boss-records') || '{}');
      if (!data[bossId]) data[bossId] = { wins: 0, losses: 0 };
      if (isWin) data[bossId].wins++;
      else data[bossId].losses++;
      localStorage.setItem('bs-boss-records', JSON.stringify(data));
    } catch (e) { console.warn('recordBossResult error:', e); }
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
  // BATTLE COMPLETION HOOK
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
      // Remove tutorial if active
      removeTutorial();

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
      fightBtn.innerHTML = '<span class="bs-spinner" style="display:inline-block;width:14px;height:14px;"></span>';

      if (!isNewPlayer(profile)) {
        window.location.href = '/blindspot/play.html';
        return;
      }

      // Authenticated new players skip Stranger fight (cardData only works in demo)
      if (!isDemo()) {
        openBlindspotQuickBuild();
        return;
      }

      // Demo new player — start Stranger fight
      await startStrangerFight();
    });
  }

  async function startStrangerFight() {
    _isStrangerFight = true;

    // Clean up any existing tutorial from previous attempt
    removeTutorial();

    document.getElementById('bs-landing').style.display = 'none';
    const battleContainer = document.getElementById('bs-battle-container');
    battleContainer.style.display = 'block';

    if (window.ArenaAudio) window.ArenaAudio.init();

    if (!window._bsBattleEventsBound) {
      window.ArenaBattleUI.bindEvents();
      window._bsBattleEventsBound = true;
    }

    hookBattleCompletion();

    try {
      const battleData = await window.ArenaAPI.startBattle(
        'pve', _strangerCard.id, _config.tutorialBoss.id,
        { cardData: _strangerCard }
      );
      _activeBattle = battleData;

      if (window.ArenaAudio && window.ArenaBackgrounds) {
        window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
      }
      if (window.ArenaBackgrounds) window.ArenaBackgrounds.applyToBattleStage();

      window.ArenaBattleUI.initBattle(battleData);
      showStrangerTutorial();
    } catch (err) {
      console.error('[Blindspot] Stranger fight error:', err);
      document.getElementById('bs-landing').style.display = '';
      battleContainer.style.display = 'none';
      const fightBtn = document.getElementById('bs-fight-btn');
      if (fightBtn) { fightBtn.disabled = false; fightBtn.textContent = 'Fight'; }
      showErrorToast('Could not start battle. Try again.');
    }
  }

  function handleStrangerResult(battleResult, battleData) {
    const isWin = battleResult.winner === 'player';
    document.getElementById('bs-battle-container').style.display = 'none';

    if (isWin) {
      showOverlay('bs-stranger-win');
      document.getElementById('bs-build-btn')?.addEventListener('click', () => {
        hideOverlay('bs-stranger-win');
        openBlindspotQuickBuild();
      }, { once: true });
    } else {
      showOverlay('bs-stranger-loss');
      document.getElementById('bs-stranger-loss')?.addEventListener('click', () => {
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

    // Demo users can't save cards
    if (isDemo()) {
      showDemoSignInPrompt();
      return;
    }

    window.BlindspotQuickBuild.open(function onComplete(cardId) {
      _isStrangerFight = false;
      _isFirstRealFight = true;
      if (cardId) {
        window.ArenaAPI.selectCard(cardId).catch(e => console.warn('selectCard:', e));
      }
      localStorage.setItem('blindspot-onboarded', 'true');
      window.location.href = '/blindspot/play.html?firstFight=true';
    });
  }

  function showDemoSignInPrompt() {
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.innerHTML = `
      <p class="bs-overlay__title">You proved yourself.</p>
      <p class="bs-overlay__subtitle">Sign in to build your card, track your rank, and climb the campaign.</p>
      <a href="/.auth/login/aad?post_login_redirect_uri=/blindspot/" class="bs-btn bs-btn--primary bs-btn--full bs-btn--glow" style="text-decoration:none; text-align:center;">Sign In</a>
      <button class="bs-btn bs-btn--secondary" style="margin-top:0.75rem;" id="bs-demo-replay">Play Again as Stranger</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('bs-demo-replay')?.addEventListener('click', () => {
      overlay.remove();
      document.getElementById('bs-landing').style.display = '';
      const fightBtn = document.getElementById('bs-fight-btn');
      if (fightBtn) { fightBtn.disabled = false; fightBtn.textContent = 'Fight'; }
    });
  }

  function handleFirstRealFightResult(battleResult, battleData) {
    localStorage.setItem('blindspot-onboarded', 'true');
    const isWin = battleResult.winner === 'player';
    if (isWin) setForgeWins(1);
    showForgeProgressInResults();

    const againBtn = document.getElementById('arena-results-again');
    const lobbyBtn = document.getElementById('arena-results-lobby');
    if (againBtn) againBtn.textContent = isWin ? 'Next Fight' : 'Try Again';
    if (lobbyBtn) lobbyBtn.textContent = 'Go to Lobby';
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

    if (!window._bsBattleEventsBound) {
      window.ArenaBattleUI.bindEvents();
      window._bsBattleEventsBound = true;
    }

    hookBattleCompletion();

    const profile = await loadProfile();

    // No profile at all — redirect to landing
    if (!profile) {
      window.location.href = '/blindspot/';
      return;
    }

    const cards = await loadUserCards();
    if (cards.length > 0) {
      _selectedCard = profile.selectedCardId
        ? cards.find(c => c.id === profile.selectedCardId) || cards[0]
        : cards[0];
    } else {
      // No cards — user needs to build one first
      // Show a message and link to Quick Build on the landing page
      showScreen('lobby');
      const cardEl = document.getElementById('bs-player-card');
      if (cardEl) {
        cardEl.innerHTML = `<div style="text-align:center; padding:1.5rem;">
          <i class="fas fa-plus-circle" style="font-size:2.5rem; color:var(--bs-accent-dim); margin-bottom:0.75rem;"></i>
          <p style="font-size:0.85rem; color:var(--bs-text-muted);">No card yet</p>
          <a href="/blindspot/" class="bs-btn" style="margin-top:0.75rem; padding:0.5rem 1.25rem; font-size:0.8rem; text-decoration:none;">Build Your Card</a>
        </div>`;
      }
      bindPlayNavigation();
      return;
    }

    // First fight redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('firstFight') === 'true' && _selectedCard) {
      _isFirstRealFight = true;
      const titleEl = document.getElementById('bs-prefight-title');
      if (titleEl) titleEl.textContent = 'Your first real test.';
      showOverlay('bs-prefight-overlay');
      document.getElementById('bs-prefight-go')?.addEventListener('click', async () => {
        hideOverlay('bs-prefight-overlay');
        await startCampaignBattle(_bosses[0].id);
      }, { once: true });
      bindPlayNavigation();
      return;
    }

    renderLobby();
    bindPlayNavigation();

    // Sync Blindspot boss progress from server
    if (profile.pveProgress) {
      const bsHighest = profile.pveProgress.blindspotHighestDefeated || 100;
      setHighestBossDefeated(bsHighest - 100);
    }
  }

  // ============================================================
  // LOBBY
  // ============================================================

  function renderLobby() {
    // Player card
    const cardEl = document.getElementById('bs-player-card');
    if (cardEl && _selectedCard) {
      if (_selectedCard.avatar) {
        cardEl.innerHTML = `<img src="${escHtml(_selectedCard.avatar)}" alt="${escHtml(_selectedCard.name || 'Card')}">`;
      } else {
        cardEl.innerHTML = `<div style="text-align:center; padding:1rem;">
          <i class="fas fa-user" style="font-size:2rem; color:var(--bs-text-muted);"></i>
          <p style="font-size:0.8rem; color:var(--bs-text-muted); margin-top:0.5rem;">${escHtml(_selectedCard.name || 'Your Card')}</p>
        </div>`;
      }
    }

    updateRankDisplay();
    updateForgeProgress();

    // PvP unlock check
    const highestBoss = getHighestBossDefeated();
    const pvpBtn = document.getElementById('bs-btn-pvp');
    const pvpLock = document.getElementById('bs-pvp-lock');
    if (highestBoss >= 10) {
      if (pvpBtn) pvpBtn.disabled = false;
      if (pvpLock) pvpLock.style.display = 'none';
    }

    // Show win streak / stats summary
    const statsEl = document.getElementById('bs-lobby-stats');
    if (statsEl && _profile) {
      statsEl.innerHTML = `
        <span><i class="fas fa-trophy" style="color:var(--bs-accent);"></i> ${_profile.record?.wins || 0}W</span>
        <span><i class="fas fa-skull" style="color:var(--bs-danger);"></i> ${_profile.record?.losses || 0}L</span>
        <span><i class="fas fa-mountain" style="color:var(--bs-text-muted);"></i> Boss ${highestBoss}/10</span>
      `;
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

    if (badge) badge.innerHTML = `<i class="fas ${rankInfo.icon}" style="color:${rankInfo.color}"></i> <span>${rankInfo.label}</span>`;

    const currentXp = _profile.xp || 0;
    if (nextRank) {
      const progress = ((currentXp - rankInfo.xp) / (nextRank.xp - rankInfo.xp)) * 100;
      if (xpFill) xpFill.style.width = Math.min(100, Math.max(0, progress)) + '%';
      if (xpText) xpText.textContent = `${currentXp} / ${nextRank.xp} XP`;
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

  // ============================================================
  // NAVIGATION
  // ============================================================

  let _navBound = false;

  function bindPlayNavigation() {
    if (_navBound) return;
    _navBound = true;

    document.getElementById('bs-btn-campaign')?.addEventListener('click', () => {
      showScreen('campaign');
      renderCampaignLadder();
    });

    document.getElementById('bs-btn-pvp')?.addEventListener('click', () => {
      showScreen('pvp');
      renderPvPGallery();
    });

    document.getElementById('bs-btn-leaderboard')?.addEventListener('click', () => {
      window.open('/cardforge/arena.html#lobby', '_blank');
    });

    document.getElementById('bs-campaign-back')?.addEventListener('click', () => {
      showScreen('lobby');
      renderLobby();
    });
    document.getElementById('bs-pvp-back')?.addEventListener('click', () => {
      showScreen('lobby');
      renderLobby();
    });

    // Forge overlays
    document.getElementById('bs-forge-now')?.addEventListener('click', () => { hideOverlay('bs-forge-trigger'); openForgeScreen(); });
    document.getElementById('bs-forge-later')?.addEventListener('click', () => { hideOverlay('bs-forge-trigger'); localStorage.setItem('bs-forge-pending', 'true'); updateForgeProgress(); });
    document.getElementById('bs-forge-unlock-btn')?.addEventListener('click', () => { hideOverlay('bs-forge-unlock'); openForgeScreen(true); });

    // Architect win
    document.getElementById('bs-architect-continue')?.addEventListener('click', () => { hideOverlay('bs-architect-win'); refreshLobby(); showScreen('lobby'); });

    // Results buttons
    document.getElementById('arena-results-again')?.addEventListener('click', () => {
      document.getElementById('arena-results-overlay').style.display = 'none';
      if (_isFirstRealFight) {
        _isFirstRealFight = false;
        // After first fight, go to campaign (win advances, loss can retry from ladder)
        showScreen('lobby');
        renderLobby();
        return;
      }
      if (_battleType === 'pvp') { showScreen('pvp'); renderPvPGallery(); }
      else if (_currentBossId) {
        // Advance to next boss if current was defeated, otherwise retry same boss
        const currentBoss = _bosses.find(b => b.id === _currentBossId);
        const highest = getHighestBossDefeated();
        if (currentBoss && currentBoss.boss <= highest && currentBoss.boss < 10) {
          // Current boss defeated — advance to next
          const nextBoss = _bosses.find(b => b.boss === currentBoss.boss + 1);
          if (nextBoss) { startCampaignBattle(nextBoss.id); }
          else { showScreen('campaign'); renderCampaignLadder(); }
        } else {
          // Not yet defeated or last boss — retry same
          startCampaignBattle(_currentBossId);
        }
      }
      else { showScreen('campaign'); renderCampaignLadder(); }
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

    // Battle in-screen buttons
    document.getElementById('arena-battle-again')?.addEventListener('click', () => {
      if (_currentBossId) startCampaignBattle(_currentBossId);
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

    container.innerHTML = _bosses.map((boss, i) => {
      const defeated = boss.boss <= highestDefeated;
      const current = boss.boss === highestDefeated + 1;
      const locked = boss.boss > highestDefeated + 1;

      let statusClass = '';
      if (defeated) statusClass = 'bs-boss-card--defeated';
      else if (current) statusClass = 'bs-boss-card--current';
      else if (locked) statusClass = 'bs-boss-card--locked';

      const icon = BOSS_ICONS[boss.class] || 'fa-skull';
      const record = getBossRecord(boss.id);

      const connector = i < _bosses.length - 1
        ? `<div class="bs-ladder-connector ${defeated ? 'bs-ladder-connector--done' : ''}"></div>`
        : '';

      const recordBadge = (record.wins > 0 || record.losses > 0)
        ? `<span class="bs-boss-card__record">${record.wins}W / ${record.losses}L</span>`
        : '';

      return `
        <div class="bs-boss-card ${statusClass}">
          <div class="bs-boss-avatar"><i class="fas ${icon}"></i></div>
          <div class="bs-boss-card__info">
            <div class="bs-boss-card__name">${escHtml(boss.name)} ${recordBadge}</div>
            <div class="bs-boss-card__class">${escHtml(boss.class)}</div>
            <div class="bs-boss-card__flavor">"${escHtml(boss.flavor)}"</div>
          </div>
          <div class="bs-boss-card__action">
            ${locked
              ? '<i class="fas fa-lock" style="color:var(--bs-text-muted);"></i>'
              : `<button class="bs-btn" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-boss="${boss.id}">${defeated ? '<i class="fas fa-redo"></i> Replay' : 'Fight'}</button>`
            }
          </div>
        </div>
        ${connector}
      `;
    }).join('');

    // Bind fight buttons
    container.querySelectorAll('[data-fight-boss]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bossId = btn.dataset.fightBoss;
        const boss = _bosses.find(b => b.id === bossId);
        if (!boss) return;

        const flavorEl = document.getElementById('bs-prefight-flavor');
        const titleEl = document.getElementById('bs-prefight-title');
        const avatarEl = document.getElementById('bs-prefight-avatar');
        if (flavorEl) flavorEl.textContent = `"${boss.flavor}"`;
        if (titleEl) titleEl.textContent = boss.name;
        if (avatarEl) {
          const icon = BOSS_ICONS[boss.class] || 'fa-skull';
          avatarEl.innerHTML = `<i class="fas ${icon}"></i>`;
        }

        showOverlay('bs-prefight-overlay');
        const goBtn = document.getElementById('bs-prefight-go');
        const handler = async () => {
          goBtn.removeEventListener('click', handler);
          hideOverlay('bs-prefight-overlay');
          await startCampaignBattle(bossId);
        };
        goBtn.addEventListener('click', handler);
      });
    });
  }

  async function startCampaignBattle(bossId) {
    if (!_selectedCard) {
      showErrorToast('No card selected. Build a card first.');
      return;
    }

    _currentBossId = bossId;
    _battleType = 'pve';
    if (!_isFirstRealFight) _isStrangerFight = false;

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
      console.error('[Blindspot] Campaign battle error:', err);
      showErrorToast('Failed to start battle: ' + err.message);
      showScreen('campaign');
    }
  }

  // ============================================================
  // BATTLE RESULTS
  // ============================================================

  function handlePlayPageResult(battleResult, battleData) {
    const isWin = battleResult.winner === 'player';

    // Track boss record
    if (_battleType === 'pve' && _currentBossId) {
      recordBossResult(_currentBossId, isWin);
    }

    loadProfile().then(() => updateRankDisplay());

    if (_battleType === 'pve' && isWin) {
      const boss = _bosses.find(b => b.id === _currentBossId);
      const prevHighest = getHighestBossDefeated();
      const isNewBossDefeat = boss && boss.boss > prevHighest;

      if (boss) setHighestBossDefeated(boss.boss);

      // Forge wins only on NEW boss defeats
      const wins = isNewBossDefeat ? getForgeWins() + 1 : getForgeWins();
      if (isNewBossDefeat) setForgeWins(wins);

      // Boss 10 — The Architect
      if (boss && boss.boss === 10 && isNewBossDefeat) {
        setTimeout(() => {
          document.getElementById('arena-results-overlay').style.display = 'none';
          showOverlay('bs-architect-win');
        }, 2000);
        return;
      }

      // Forge unlock at Silver rank-up
      if (battleResult.rankUp && _profile && _profile.rank === 'silver') {
        if (!localStorage.getItem('bs-forge-unlock-shown')) {
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
    if (againBtn) againBtn.textContent = isWin ? 'Next Fight' : 'Try Again';
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
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">No challengers available yet. Publish your card in CardForge to appear here.</p>';
        return;
      }

      container.innerHTML = gallery.map(card => `
        <div class="bs-boss-card" style="cursor:pointer;">
          <div class="bs-boss-avatar" style="width:36px;height:36px;font-size:0.9rem;">
            ${card.avatar ? `<img src="${escHtml(card.avatar)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-user"></i>'}
          </div>
          <div class="bs-boss-card__info">
            <div class="bs-boss-card__name">${escHtml(card.name || 'Unnamed')}</div>
            <div class="bs-boss-card__class">${escHtml(card.class || '')}</div>
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
      console.error('[Blindspot] PvP error:', err);
      showErrorToast('PvP battle failed.');
      showScreen('pvp');
    }
  }

  // ============================================================
  // FORGE SCREEN
  // ============================================================

  function openForgeScreen(isFirstUnlock) {
    const bonusPoints = isFirstUnlock
      ? (_config ? _config.forgeVisit.firstUnlockBonusPoints : 35)
      : (_config ? _config.forgeVisit.bonusPoints : 25);

    if (!_selectedCard || !_selectedCard.combatStats) {
      showErrorToast('No card selected for evolution.');
      return;
    }

    const currentStats = { ..._selectedCard.combatStats };
    const allocations = { str: 0, agi: 0, int: 0, end: 0, lck: 0 };

    const statDefs = [
      { key: 'str', label: 'STR', desc: 'Raw damage.',          color: '#ff5252', icon: 'fa-hand-fist' },
      { key: 'agi', label: 'AGI', desc: 'Speed and evasion.',   color: '#00e676', icon: 'fa-feather-pointed' },
      { key: 'int', label: 'INT', desc: 'Ability power.',       color: '#7b2fff', icon: 'fa-bolt' },
      { key: 'end', label: 'END', desc: 'How long you survive.', color: '#ff9100', icon: 'fa-heart' },
      { key: 'lck', label: 'LCK', desc: 'The unexpected.',      color: '#ffd740', icon: 'fa-clover' }
    ];

    const totalBefore = Object.values(currentStats).reduce((a, b) => a + b, 0);

    const panel = document.getElementById('bs-forge-panel');
    panel.innerHTML = `
      <h2 class="bs-forge-screen__title"><i class="fas fa-fire" style="color:var(--bs-accent);"></i> Evolve Your Card</h2>
      <p style="text-align:center; color:var(--bs-text-muted); font-size:0.8rem; margin-bottom:0.75rem;">
        ${escHtml(_selectedCard.name || 'Your Card')} &middot; Forge #${getForgeVisitCount() + 1}
      </p>
      <div class="bs-forge-screen__budget">
        <span>Power: <strong id="bs-forge-total" style="color:var(--bs-accent);">${totalBefore}</strong></span>
        <span style="margin-left:1.5rem;">Points left: <strong id="bs-forge-remaining" style="color:var(--bs-accent);">${bonusPoints}</strong></span>
      </div>
      ${statDefs.map(d => `
        <div class="bs-forge-stat">
          <i class="fas ${d.icon}" style="color:${d.color}; width:16px; text-align:center;"></i>
          <span class="bs-forge-stat__label" style="color:${d.color}">${d.label}</span>
          <span class="bs-forge-stat__base">${currentStats[d.key]}</span>
          <span class="bs-forge-stat__arrow">\u2192</span>
          <input type="range" class="bs-forge-stat__slider" data-stat="${d.key}"
                 min="${currentStats[d.key]}" max="100" value="${currentStats[d.key]}">
          <span class="bs-forge-stat__value" data-stat="${d.key}">${currentStats[d.key]}</span>
          <span class="bs-forge-stat__desc">${d.desc}</span>
        </div>
      `).join('')}
      <div class="bs-forge-actions" style="display:flex; gap:0.75rem; justify-content:center;">
        <button class="bs-btn bs-btn--secondary" id="bs-forge-cancel">Cancel</button>
        <button class="bs-btn bs-btn--primary bs-btn--glow" id="bs-forge-apply" disabled>
          <i class="fas fa-fire"></i> Forge
        </button>
      </div>
    `;

    showOverlay('bs-forge-screen');

    const remainingEl = document.getElementById('bs-forge-remaining');
    const totalEl = document.getElementById('bs-forge-total');
    const applyBtn = document.getElementById('bs-forge-apply');

    function updateBudget() {
      const totalAllocated = Object.values(allocations).reduce((a, b) => a + b, 0);
      const remaining = bonusPoints - totalAllocated;
      if (remainingEl) remainingEl.textContent = remaining;
      if (totalEl) totalEl.textContent = totalBefore + totalAllocated;
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
        if (display) {
          display.textContent = clampedVal;
          display.style.color = clamped > 0 ? 'var(--bs-accent)' : 'var(--bs-text)';
        }
        updateBudget();
      });
    });

    document.getElementById('bs-forge-cancel')?.addEventListener('click', () => {
      hideOverlay('bs-forge-screen');
    });

    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.innerHTML = '<i class="fas fa-fire" style="animation: bs-spin 0.8s linear infinite;"></i> Forging...';

      const newStats = {};
      statDefs.forEach(d => { newStats[d.key] = currentStats[d.key] + allocations[d.key]; });

      // Forging animation
      panel.style.transition = 'box-shadow 0.5s ease';
      panel.style.boxShadow = '0 0 60px rgba(239, 159, 39, 0.5)';
      await new Promise(r => setTimeout(r, 1000));
      panel.style.boxShadow = '';

      _selectedCard.combatStats = newStats;

      // Save via API
      try {
        const cardToSave = { ..._selectedCard, combatStats: newStats };
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
        // Add CSRF token if available
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfMeta && csrfMeta.content) headers['X-CSRF-Token'] = csrfMeta.content;
        await fetch(url, { method: 'POST', headers, body: JSON.stringify(cardToSave) });
      } catch (e) {
        console.warn('[Blindspot] Forge save error:', e);
      }

      setForgeWins(0);
      localStorage.removeItem('bs-forge-pending');
      incForgeVisitCount();

      hideOverlay('bs-forge-screen');
      updateForgeProgress();
      renderLobby();
      showSuccessToast('Card evolved!');
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
  // TUTORIAL (Stranger fight)
  // ============================================================

  const TUTORIAL_HINTS = [
    { move: 'strike',  text: '\u2694\ufe0f Strike \u2014 your basic attack. Tap to hit them.' },
    { move: 'guard',   text: '\ud83d\udee1\ufe0f Guard \u2014 blocks 60% of strikes. Defend yourself.' },
    { move: 'heal',    text: '\u2764\ufe0f Heal \u2014 recover HP. Use when you\'re low.' },
    { move: 'counter', text: '\ud83d\udca5 Counter \u2014 reflects strikes back. Time it right.' },
    { move: 'ability', text: '\u26a1 Ability \u2014 class power. Costs 2 charges.' }
  ];

  let _tutorialStep = 0;
  let _tutorialEl = null;

  function showStrangerTutorial() {
    _tutorialStep = 0;
    _tutorialEl = document.createElement('div');
    _tutorialEl.className = 'bs-tutorial';
    _tutorialEl.innerHTML = `<div class="bs-tutorial__text" id="bs-tutorial-text">${TUTORIAL_HINTS[0].text}</div>`;
    document.body.appendChild(_tutorialEl);
    highlightTutorialMove(0);

    // Only the highlighted move button advances the tutorial
    document.querySelectorAll('.arena-move-btn').forEach(btn => {
      btn.addEventListener('click', onTutorialMoveClick);
    });
  }

  function onTutorialMoveClick(e) {
    const btn = e.currentTarget;
    const currentHint = TUTORIAL_HINTS[_tutorialStep];
    // Only advance if the clicked move matches the highlighted one
    if (currentHint && btn.dataset.move === currentHint.move) {
      advanceTutorial();
    }
  }

  function highlightTutorialMove(step) {
    document.querySelectorAll('.arena-move-btn').forEach(b => b.classList.remove('bs-pulse-hint'));
    if (step < TUTORIAL_HINTS.length) {
      const hint = TUTORIAL_HINTS[step];
      const btn = document.querySelector(`[data-move="${hint.move}"]`);
      if (btn) btn.classList.add('bs-pulse-hint');
      const textEl = document.getElementById('bs-tutorial-text');
      if (textEl) textEl.textContent = hint.text;
    }
  }

  function advanceTutorial() {
    _tutorialStep++;
    if (_tutorialStep >= TUTORIAL_HINTS.length) {
      removeTutorial();
      return;
    }
    highlightTutorialMove(_tutorialStep);
  }

  function removeTutorial() {
    if (_tutorialEl) { _tutorialEl.remove(); _tutorialEl = null; }
    document.querySelectorAll('.arena-move-btn').forEach(b => {
      b.classList.remove('bs-pulse-hint');
      b.removeEventListener('click', onTutorialMoveClick);
    });
  }

  // ============================================================
  // TOAST NOTIFICATIONS
  // ============================================================

  function showToast(message, type) {
    const existing = document.querySelector('.bs-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `bs-toast bs-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('bs-toast--visible'), 10);
    setTimeout(() => {
      toast.classList.remove('bs-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function showErrorToast(msg) { showToast(msg, 'error'); }
  function showSuccessToast(msg) { showToast(msg, 'success'); }

  // ============================================================
  // BOOT
  // ============================================================

  document.addEventListener('DOMContentLoaded', () => {
    if (isOnLandingPage()) initLanding();
    else if (isOnPlayPage()) initPlay();
  });

})();
