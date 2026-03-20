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
    // Blindspot-specific: have they completed the Blindspot onboarding?
    // NOT based on CardForge XP/cards — a CardForge veteran is still
    // a new Blindspot player if they haven't been onboarded here.
    return !localStorage.getItem('blindspot-onboarded');
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
  // PROGRESSION SYSTEM
  // ============================================================

  // Card Power Rating = sum of all combat stats
  function getCardPower(card) {
    if (!card) return 0;
    // Try combatStats first (new format)
    if (card.combatStats) {
      const s = card.combatStats;
      return (s.str || 0) + (s.agi || 0) + (s.int || 0) + (s.end || 0) + (s.lck || 0);
    }
    // Fall back to legacy stats array
    if (card.stats && Array.isArray(card.stats)) {
      return card.stats.reduce((sum, s) => sum + (s.value || 0), 0);
    }
    return 0;
  }

  // Ensure card has combatStats (migrate from legacy if needed)
  function ensureCombatStats(card) {
    if (!card) return;
    if (card.combatStats) return;
    if (!card.stats || !Array.isArray(card.stats) || card.stats.length === 0) {
      // No stats at all — assign class-based defaults or generic
      card.combatStats = { str: 60, agi: 60, int: 60, end: 60, lck: 60 };
      return;
    }

    const STAT_MAP = {
      strength: 'str', power: 'str', combat: 'str', attack: 'str',
      agility: 'agi', speed: 'agi', dexterity: 'agi',
      intelligence: 'int', magic: 'int', wisdom: 'int', tech: 'int',
      endurance: 'end', defense: 'end', vitality: 'end', constitution: 'end',
      luck: 'lck', charisma: 'lck', fortune: 'lck'
    };

    card.combatStats = { str: 50, agi: 50, int: 50, end: 50, lck: 50 };
    card.stats.forEach(s => {
      const key = STAT_MAP[(s.name || '').toLowerCase().trim()];
      if (key) card.combatStats[key] = Math.min(100, Math.max(0, s.value || 0));
    });
  }

  // Win streak
  function getWinStreak() { return parseInt(localStorage.getItem('bs-win-streak') || '0', 10); }
  function setWinStreak(n) { localStorage.setItem('bs-win-streak', String(n)); }

  // Best win streak
  function getBestStreak() { return parseInt(localStorage.getItem('bs-best-streak') || '0', 10); }
  function setBestStreak(n) {
    if (n > getBestStreak()) localStorage.setItem('bs-best-streak', String(n));
  }

  // Card title (earned from boss milestones)
  function getCardTitle() { return localStorage.getItem('bs-card-title') || ''; }
  function setCardTitle(t) { localStorage.setItem('bs-card-title', t); }

  // Claimed boss rewards (prevent double-claiming)
  function getClaimedRewards() {
    try { return JSON.parse(localStorage.getItem('bs-claimed-rewards') || '[]'); }
    catch { return []; }
  }
  function claimReward(bossId) {
    const claimed = getClaimedRewards();
    if (!claimed.includes(bossId)) {
      claimed.push(bossId);
      localStorage.setItem('bs-claimed-rewards', JSON.stringify(claimed));
    }
  }
  function isRewardClaimed(bossId) {
    return getClaimedRewards().includes(bossId);
  }


  // Visual unlocks (earned from boss kills)
  function getUnlockedVisuals() {
    try { return JSON.parse(localStorage.getItem('bs-visual-unlocks') || '["palette_earth","container_masked"]'); }
    catch { return ['palette_earth', 'container_masked']; }
  }
  function unlockVisual(key) {
    const unlocks = getUnlockedVisuals();
    if (!unlocks.includes(key)) {
      unlocks.push(key);
      localStorage.setItem('bs-visual-unlocks', JSON.stringify(unlocks));
    }
  }
  function hasVisualUnlock(key) {
    return getUnlockedVisuals().includes(key);
  }

  // Apply boss reward to card
  async function applyBossReward(boss) {
    if (!boss.reward || isRewardClaimed(boss.id)) return null;

    const reward = boss.reward;

    if (reward.type === 'stat_bonus' && _selectedCard && _selectedCard.combatStats) {
      // Apply stat bonus to card
      _selectedCard.combatStats[reward.stat] = Math.min(100,
        (_selectedCard.combatStats[reward.stat] || 0) + reward.amount
      );

      // Save card with new stats
      try {
        const cardToSave = { ..._selectedCard };
        cardToSave.stats = [
          { name: 'Strength', value: cardToSave.combatStats.str },
          { name: 'Agility', value: cardToSave.combatStats.agi },
          { name: 'Intelligence', value: cardToSave.combatStats.int },
          { name: 'Endurance', value: cardToSave.combatStats.end },
          { name: 'Luck', value: cardToSave.combatStats.lck }
        ];
        const url = window.buildApiPath('saveCard');
        const headers = { 'Content-Type': 'application/json' };
        const authHeaders = await window.ArenaAPI.getPrincipalHeader();
        Object.assign(headers, authHeaders);
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfMeta && csrfMeta.content) headers['X-CSRF-Token'] = csrfMeta.content;
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(cardToSave) });
        if (!resp.ok) throw new Error('Save failed');
        claimReward(boss.id); // Only claim after successful save
      } catch (e) {
        // Revert stat change — player can re-earn on next fight
        _selectedCard.combatStats[reward.stat] = Math.min(100,
          (_selectedCard.combatStats[reward.stat] || 0) - reward.amount
        );
        console.warn('[Blindspot] Reward save failed, reverted:', e);
        return null; // Don't show reward popup if save failed
      }
    }

    if (reward.type === 'title') {
      setCardTitle(reward.title);
      claimReward(boss.id);
    }

    if (reward.type === 'visual') {
      unlockVisual(reward.unlock);
      claimReward(boss.id);
    }

    if (reward.type === 'forge_bonus') {
      // Add bonus forge points
      setForgeWins(getForgeWins() + Math.floor(reward.amount / (_config?.forgeVisit?.bonusPoints || 25)));
    }

    return reward;
  }

  // ============================================================
  // LOAD DATA
  // ============================================================

  async function loadGameData() {
    try {
      const [configResp, bossesResp, strangerResp] = await Promise.all([
        fetch('/blindspot/data/game-config.json').then(r => r.json()),
        fetch('/blindspot/data/bosses.json').then(r => r.json()),
        fetch('/blindspot/data/stranger-card.json').then(r => r.json())
      ]);
      _config = configResp;
      _bosses = bossesResp;
      _strangerCard = strangerResp;
    } catch (e) {
      console.error('[Blindspot] Failed to load game data:', e);
      showErrorToast('Failed to load game. Please refresh.');
      throw e;
    }
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
        // Suppress CardForge effect tier unlocks — they're irrelevant to Blindspot
        const savedApplyLock = window.CardForge?.applyEffectLockState;
        const savedGetUnlocks = window.EffectTiers?.getNewUnlocksForRank;
        if (window.CardForge) window.CardForge.applyEffectLockState = function() {};
        if (window.EffectTiers) window.EffectTiers.getNewUnlocksForRank = function() { return {}; };

        _origShowResults.call(window.ArenaResults, battleResult, battleData);

        // Restore
        if (window.CardForge && savedApplyLock) window.CardForge.applyEffectLockState = savedApplyLock;
        if (window.EffectTiers && savedGetUnlocks) window.EffectTiers.getNewUnlocksForRank = savedGetUnlocks;

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
    // Start loading in parallel for faster boot
    const gameDataPromise = loadGameData();
    const profilePromise = loadProfile();

    const fightBtn = document.getElementById('bs-fight-btn');
    if (!fightBtn) return;

    // Enable button as soon as possible — don't block on API
    await gameDataPromise;
    const profile = await profilePromise;

    // Update auth UI on landing page
    updateLandingAuthUI();

    fightBtn.addEventListener('click', async () => {
      fightBtn.disabled = true;
      fightBtn.innerHTML = '<span class="bs-spinner" style="display:inline-block;width:14px;height:14px;"></span>';

      if (!isNewPlayer(profile)) {
        window.location.href = '/blindspot/play.html';
        return;
      }

      // ALL new players fight as The Stranger first
      // Demo users: cardData passed directly (server accepts it)
      // Authenticated users: also pass cardData (server uses it when card isn't in collection)
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
      // Only show tutorial on first attempt (not on retries after losing)
      if (!localStorage.getItem('bs-tutorial-shown')) {
        localStorage.setItem('bs-tutorial-shown', 'true');
        showStrangerTutorial();
      }
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

    window.BlindspotQuickBuild.open(function onComplete(cardId) {
      _isStrangerFight = false;
      _isFirstRealFight = true;

      if (isDemo()) {
        // Demo users experienced the full build — now prompt sign-in to save
        showDemoSignInPrompt();
        return;
      }

      // Authenticated users: save and continue
      if (cardId) {
        window.ArenaAPI.selectCard(cardId).catch(e => console.warn('selectCard:', e));
      }
      localStorage.setItem('blindspot-onboarded', 'true');
      window.location.href = '/blindspot/play.html?firstFight=true';
    });
  }

  function showDemoSignInPrompt() {
    // Remove any existing prompt
    document.querySelector('.bs-demo-prompt')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay bs-demo-prompt';
    overlay.innerHTML = `
      <p class="bs-overlay__title">You built your card. Now make it real.</p>
      <p class="bs-overlay__subtitle">Sign in to save your card, track your rank, and climb the campaign.</p>
      <a href="/.auth/login/aad?post_login_redirect_uri=/blindspot/" class="bs-btn bs-btn--primary bs-btn--full bs-btn--glow" style="text-decoration:none; text-align:center; display:block; max-width:320px;">
        <i class="fas fa-sign-in-alt"></i> Sign In to Continue
      </a>
      <button class="bs-btn bs-btn--secondary bs-btn--full" style="margin-top:0.75rem; max-width:320px;" id="bs-demo-replay">
        <i class="fas fa-redo"></i> Start Over as Stranger
      </button>
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
    if (label) label.textContent = wins >= needed ? 'CARD EDITOR READY \u2014 Tap to customize' : `CARD EDITOR \u00b7 ${wins} / ${needed} wins`;
    if (fill) fill.style.width = pct + '%';
  }

  // ============================================================
  // PLAY PAGE (play.html)
  // ============================================================

  async function initPlay() {
    // Show lobby shell immediately while data loads
    showScreen('lobby');

    // Start data loading in parallel
    const gameDataPromise = loadGameData();
    const profilePromise = loadProfile();

    if (window.ArenaAudio) window.ArenaAudio.init();

    if (!window._bsBattleEventsBound) {
      window.ArenaBattleUI.bindEvents();
      window._bsBattleEventsBound = true;
    }

    hookBattleCompletion();

    // Wait for game data
    await gameDataPromise;

    // Wait for profile
    const profile = await profilePromise;

    if (!profile) {
      window.location.href = '/blindspot/';
      return;
    }

    const cards = await loadUserCards();
    if (cards.length > 0) {
      _selectedCard = profile.selectedCardId
        ? cards.find(c => c.id === profile.selectedCardId) || cards[0]
        : cards[0];
      ensureCombatStats(_selectedCard);
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

    // Sync Blindspot boss progress from server BEFORE rendering (authoritative source)
    if (profile.pveProgress && profile.pveProgress.blindspotHighestDefeated !== undefined) {
      localStorage.setItem('bs-highest-boss', String(profile.pveProgress.blindspotHighestDefeated - 100));
    } else {
      localStorage.setItem('bs-highest-boss', '0');
    }

    renderLobby();
    bindPlayNavigation();
    updatePlayAuthUI();
  }

  // ============================================================
  // LOBBY
  // ============================================================

  function renderLobby() {
    // Player card — show as a mini card with name + class
    const cardEl = document.getElementById('bs-player-card');
    if (cardEl && _selectedCard) {
      const hasAvatar = _selectedCard.avatar && _selectedCard.avatar.trim();
      cardEl.innerHTML = `
        <div class="bs-card-mini">
          ${hasAvatar ? `<img src="${escHtml(_selectedCard.avatar)}" alt="${escHtml(_selectedCard.name || 'Card')}" class="bs-card-mini__img">` : `<div class="bs-card-mini__icon"><i class="fas fa-user"></i></div>`}
          <div class="bs-card-mini__info">
            <span class="bs-card-mini__name">${escHtml(_selectedCard.name || 'Your Card')}</span>
            <span class="bs-card-mini__class">${escHtml(_selectedCard.class || _selectedCard.characterClass || '')}</span>
          </div>
        </div>
      `;
    }

    updateRankDisplay();
    updateForgeProgress();
    renderBounties();

    // PvP unlock check
    const highestBoss = getHighestBossDefeated();
    const pvpBtn = document.getElementById('bs-btn-pvp');
    const pvpLock = document.getElementById('bs-pvp-lock');
    if (highestBoss >= 10) {
      if (pvpBtn) pvpBtn.disabled = false;
      if (pvpLock) pvpLock.style.display = 'none';
    }

    // Power rating + stats
    const statsEl = document.getElementById('bs-lobby-stats');
    if (statsEl) {
      const power = getCardPower(_selectedCard);
      const streak = getWinStreak();
      const highestB = getHighestBossDefeated();

      let streakHtml = '';
      if (streak >= 3) streakHtml = `<span style="color:var(--bs-accent-glow);"><i class="fas fa-fire"></i> ${streak} streak</span>`;
      else if (streak > 0) streakHtml = `<span><i class="fas fa-fire"></i> ${streak} streak</span>`;

      const powerHtml = power > 0 ? `<span><i class="fas fa-bolt" style="color:var(--bs-accent);"></i> ${power} Power</span>` : '';

      statsEl.innerHTML = `
        ${powerHtml}
        <span><i class="fas fa-mountain"></i> Boss ${highestB}/10</span>
        ${streakHtml}
      `;
    }

    // Card title display
    const titleEl = document.getElementById('bs-card-title');
    const title = getCardTitle();
    if (titleEl) {
      titleEl.textContent = title || '';
      titleEl.style.display = title ? '' : 'none';
    }

    // Next boss reward preview
    const rewardEl = document.getElementById('bs-next-reward');
    if (rewardEl) {
      const nextBoss = _bosses.find(b => b.boss === highestBoss + 1);
      if (nextBoss && nextBoss.reward && !isRewardClaimed(nextBoss.id)) {
        rewardEl.innerHTML = `<i class="fas fa-gift" style="color:var(--bs-accent);"></i> Next reward: <strong>${nextBoss.reward.label}</strong>`;
        rewardEl.style.display = '';
      } else if (highestBoss >= 10) {
        rewardEl.innerHTML = '<i class="fas fa-crown" style="color:var(--bs-accent-glow);"></i> Campaign complete';
        rewardEl.style.display = '';
      } else {
        rewardEl.style.display = 'none';
      }
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
    if (label) label.textContent = ready ? 'CARD EDITOR READY \u2014 Tap to customize' : `CARD EDITOR \u00b7 ${wins} / ${needed} wins`;
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

      const rewardBadge = boss.reward
        ? `<span class="bs-boss-card__reward ${isRewardClaimed(boss.id) ? 'bs-boss-card__reward--claimed' : ''}">
            <i class="fas ${boss.reward.type === 'title' ? 'fa-crown' : boss.reward.type === 'forge_bonus' ? 'fa-fire' : 'fa-arrow-up'}"></i>
            ${escHtml(boss.reward.label)}
           </span>`
        : '';

      return `
        <div class="bs-boss-card ${statusClass}">
          <div class="bs-boss-avatar"><i class="fas ${icon}"></i></div>
          <div class="bs-boss-card__info">
            <div class="bs-boss-card__name">${escHtml(boss.name)} ${recordBadge}</div>
            <div class="bs-boss-card__class">${escHtml(boss.class)}</div>
            ${rewardBadge}
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
        // Clone button to remove any previously stacked handlers
        const oldBtn = document.getElementById('bs-prefight-go');
        const freshBtn = oldBtn.cloneNode(true);
        oldBtn.parentNode.replaceChild(freshBtn, oldBtn);
        freshBtn.addEventListener('click', async () => {
          hideOverlay('bs-prefight-overlay');
          await startCampaignBattle(bossId);
        }, { once: true });
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
      if (err.message && err.message.includes('not found')) {
        // Card doesn't exist on server — need to rebuild
        showErrorToast('Card not found. Please rebuild your card.');
        localStorage.removeItem('blindspot-onboarded');
        setTimeout(() => { window.location.href = '/blindspot/'; }, 2000);
      } else {
        showErrorToast('Failed to start battle: ' + err.message);
        showScreen('campaign');
      }
    }
  }

  // ============================================================
  // BATTLE RESULTS
  // ============================================================

  async function handlePlayPageResult(battleResult, battleData) {
    const isWin = battleResult.winner === 'player';

    // Track boss record
    if (_battleType === 'pve' && _currentBossId) {
      recordBossResult(_currentBossId, isWin);
    }

    loadProfile().then(() => updateRankDisplay());

    // Win streak tracking
    if (isWin) {
      const newStreak = getWinStreak() + 1;
      setWinStreak(newStreak);
      setBestStreak(newStreak);

      // Loot roulette — every win drops something
      const loot = rollLoot();
      await applyLootDrop(loot);
      setTimeout(() => showRewardDrop(loot, 'Victory Reward'), 1500);

      // Bounty checks
      if (getWinStreak() >= 3) completeBounty('streak3');
      // Track wins for win2 bounty
      const bountyData = getDailyBounties();
      bountyData.wins = (bountyData.wins || 0) + 1;
      localStorage.setItem('bs-bounties', JSON.stringify(bountyData));
      if (bountyData.wins >= 2) completeBounty('win2');
    } else {
      setWinStreak(0);
    }

    // Track fight for daily bounty
    completeBounty('play3');

    if (_battleType === 'pve' && isWin) {
      const boss = _bosses.find(b => b.id === _currentBossId);
      const prevHighest = getHighestBossDefeated();
      const isNewBossDefeat = boss && boss.boss > prevHighest;

      if (boss) setHighestBossDefeated(boss.boss);

      // Forge wins on NEW boss defeats + bonus for streaks
      if (isNewBossDefeat) {
        let forgeGain = 1;
        if (getWinStreak() >= 5) forgeGain = 2; // Streak bonus
        setForgeWins(getForgeWins() + forgeGain);
      }

      // Apply boss reward (stat bonus, title, etc.)
      if (isNewBossDefeat && boss) {
        const reward = await applyBossReward(boss);
        if (reward) {
          showRewardDrop(reward, boss);
        }
        completeBounty('newBoss');
      }

      // Boss 10 — The Architect
      if (boss && boss.boss === 10 && isNewBossDefeat) {
        setTimeout(() => {
          document.getElementById('arena-results-overlay').style.display = 'none';
          showOverlay('bs-architect-win');
        }, 2000);
        return;
      }

      // Show Blindspot rank-up message instead of CardForge's
      if (battleResult.rankUp) {
        const rankUpEl = document.getElementById('arena-results-rank-up');
        const newRankEl = document.getElementById('arena-results-new-rank');
        if (rankUpEl) rankUpEl.style.display = 'block';
        if (newRankEl) newRankEl.textContent = battleResult.newRank;
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
      if (getForgeWins() >= needed) {
        setTimeout(() => {
          document.getElementById('arena-results-overlay').style.display = 'none';
          showOverlay('bs-forge-trigger');
        }, 2000);
        return;
      }
    }

    showForgeProgressInResults();

    // Override CardForge button labels with Blindspot copy
    const againBtn = document.getElementById('arena-results-again');
    const lobbyBtn = document.getElementById('arena-results-lobby');
    if (againBtn) againBtn.textContent = isWin ? 'Next Fight' : 'Try Again';
    if (lobbyBtn) lobbyBtn.textContent = 'Lobby';

    // Override results with Blindspot flavor
    const titleEl = document.getElementById('arena-results-title');
    const subtitleEl = document.getElementById('arena-results-subtitle');
    if (isWin) {
      const boss = _bosses.find(b => b.id === _currentBossId);
      const streak = getWinStreak();
      if (titleEl) titleEl.textContent = streak >= 3 ? `${streak}x Victory!` : 'Victory';
      if (subtitleEl && boss) subtitleEl.textContent = `You defeated ${boss.name}`;
      // Show power after win (remove previous to prevent stacking)
      const power = getCardPower(_selectedCard);
      document.querySelector('.bs-results-power')?.remove();
      if (power > 0) {
        const powerEl = document.createElement('div');
        powerEl.className = 'bs-results-power';
        powerEl.innerHTML = `<i class="fas fa-bolt"></i> ${power} Power`;
        subtitleEl?.after(powerEl);
      }
    } else {
      if (titleEl) titleEl.textContent = 'Defeated';
      if (subtitleEl) subtitleEl.textContent = 'Your card remembers.';
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

    // Visual options for Look tab
    const PALETTES = [
      { id: 'earth', label: 'Earth', key: 'palette_earth' },
      { id: 'ocean', label: 'Ocean', key: 'palette_ocean' },
      { id: 'neon', label: 'Neon', key: 'palette_neon' },
      { id: 'fire', label: 'Fire', key: 'palette_fire' },
      { id: 'monochrome', label: 'Mono', key: 'palette_earth' },
      { id: 'sunset', label: 'Sunset', key: 'palette_earth' }
    ];
    const CONTAINERS = [
      { id: 'masked', label: 'Portrait', icon: 'fa-circle-user', key: 'container_masked' },
      { id: 'fullbleed', label: 'Full Art', icon: 'fa-image', key: 'container_fullbleed' },
      { id: 'framed', label: 'Framed', icon: 'fa-square', key: 'container_masked' }
    ];
    const uv = getUnlockedVisuals();

    const panel = document.getElementById('bs-forge-panel');
    const cardPower = getCardPower(_selectedCard);
    const cardAvatar = _selectedCard.avatar || '';
    const cardName = _selectedCard.name || 'Your Card';
    const cardClass = _selectedCard.class || _selectedCard.characterClass || '';

    panel.innerHTML = `
      <div class="bs-forge-layout">
        <div class="bs-forge-preview">
          <div class="bs-forge-card">
            ${cardAvatar ? `<img src="${escHtml(cardAvatar)}" alt="${escHtml(cardName)}" class="bs-forge-card__img">` : `<div class="bs-forge-card__placeholder"><i class="fas fa-user"></i></div>`}
            <div class="bs-forge-card__info">
              <span class="bs-forge-card__name">${escHtml(cardName)}</span>
              <span class="bs-forge-card__class">${escHtml(cardClass)}</span>
              <span class="bs-forge-card__power"><i class="fas fa-bolt"></i> ${cardPower} Power</span>
            </div>
          </div>
        </div>
        <div class="bs-forge-editor">
      <h2 class="bs-forge-screen__title"><i class="fas fa-fire" style="color:var(--bs-accent);"></i> The Forge</h2>
      <p style="text-align:center; color:var(--bs-text-muted); font-size:0.75rem; margin-bottom:0.5rem;">
        Forge #${getForgeVisitCount() + 1}
      </p>
      <div class="bs-forge-tabs">
        <button class="bs-forge-tab bs-forge-tab--active" data-tab="stats"><i class="fas fa-sliders"></i> Stats</button>
        <button class="bs-forge-tab" data-tab="look"><i class="fas fa-palette"></i> Look</button>
        <button class="bs-forge-tab" data-tab="details"><i class="fas fa-pen"></i> Details</button>
      </div>
      <div class="bs-forge-tab-content" id="bs-forge-tab-stats">
        <div class="bs-forge-screen__budget">
          <span>Power: <strong id="bs-forge-total" style="color:var(--bs-accent);">${totalBefore}</strong></span>
          <span style="margin-left:1.5rem;">Points: <strong id="bs-forge-remaining" style="color:var(--bs-accent);">${bonusPoints}</strong></span>
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
      </div>
      <div class="bs-forge-tab-content" id="bs-forge-tab-look" style="display:none;">
        <p style="font-size:0.8rem; color:var(--bs-text-muted); margin-bottom:0.75rem;">Unlock new looks by defeating bosses.</p>
        <div style="margin-bottom:1rem;">
          <label style="font-size:0.75rem; color:var(--bs-text-muted); display:block; margin-bottom:0.4rem;">Card Palette</label>
          <div class="bs-forge-options">
            ${PALETTES.map(p => `<button class="bs-forge-option ${uv.includes(p.key) ? '' : 'bs-forge-option--locked'}" data-palette="${p.id}" ${uv.includes(p.key) ? '' : 'disabled'}>${uv.includes(p.key) ? p.label : '<i class="fas fa-lock"></i>'}</button>`).join('')}
          </div>
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--bs-text-muted); display:block; margin-bottom:0.4rem;">Image Layout</label>
          <div class="bs-forge-options">
            ${CONTAINERS.map(c => `<button class="bs-forge-option ${uv.includes(c.key) ? '' : 'bs-forge-option--locked'}" data-container="${c.id}" ${uv.includes(c.key) ? '' : 'disabled'}><i class="fas ${c.icon}"></i> ${uv.includes(c.key) ? c.label : '<i class="fas fa-lock"></i>'}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="bs-forge-tab-content" id="bs-forge-tab-details" style="display:none;">
        <p style="font-size:0.8rem; color:var(--bs-text-muted); margin-bottom:0.75rem;">Change your card's identity.</p>
        <div style="margin-bottom:0.75rem;">
          <label style="font-size:0.75rem; color:var(--bs-text-muted); display:block; margin-bottom:0.3rem;">Card Name</label>
          <input type="text" id="bs-forge-name" value="${escHtml(_selectedCard.name || '')}" maxlength="30"
                 style="width:100%; padding:0.5rem; background:var(--bs-surface-2); border:1px solid var(--bs-border); border-radius:6px; color:var(--bs-text); font-family:'Share Tech Mono',monospace; font-size:0.85rem;">
        </div>
        <div style="margin-bottom:0.75rem;">
          <label style="font-size:0.75rem; color:var(--bs-text-muted); display:block; margin-bottom:0.3rem;">Quote</label>
          <input type="text" id="bs-forge-quote" value="${escHtml(_selectedCard.quote || '')}" maxlength="100"
                 style="width:100%; padding:0.5rem; background:var(--bs-surface-2); border:1px solid var(--bs-border); border-radius:6px; color:var(--bs-text); font-family:'Share Tech Mono',monospace; font-size:0.85rem;">
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--bs-text-muted); display:block; margin-bottom:0.3rem;">Avatar URL</label>
          <input type="url" id="bs-forge-avatar" value="${escHtml(_selectedCard.avatar || '')}" placeholder="https://..."
                 style="width:100%; padding:0.5rem; background:var(--bs-surface-2); border:1px solid var(--bs-border); border-radius:6px; color:var(--bs-text); font-family:'Share Tech Mono',monospace; font-size:0.8rem;">
        </div>
      </div>
      <div class="bs-forge-actions" style="display:flex; gap:0.75rem; justify-content:center; margin-top:1rem;">
        <button class="bs-btn bs-btn--secondary" id="bs-forge-cancel">Cancel</button>
        <button class="bs-btn bs-btn--primary bs-btn--glow" id="bs-forge-apply" disabled>
          <i class="fas fa-fire"></i> Forge
        </button>
      </div>
        </div>
      </div>
    `;

    showOverlay('bs-forge-screen');

    const remainingEl = document.getElementById('bs-forge-remaining');
    const totalEl = document.getElementById('bs-forge-total');
    const applyBtn = document.getElementById('bs-forge-apply');

    let _hasVisualChange = false;
    const previewPowerEl = panel.querySelector('.bs-forge-card__power');
    const previewNameEl = panel.querySelector('.bs-forge-card__name');

    function updateBudget() {
      const totalAllocated = Object.values(allocations).reduce((a, b) => a + b, 0);
      const remaining = bonusPoints - totalAllocated;
      if (remainingEl) remainingEl.textContent = remaining;
      if (totalEl) totalEl.textContent = totalBefore + totalAllocated;
      // Live update preview power
      if (previewPowerEl) previewPowerEl.innerHTML = `<i class="fas fa-bolt"></i> ${totalBefore + totalAllocated} Power`;
      // Enable forge if all stats spent OR if any visual/detail change was made
      if (applyBtn) applyBtn.disabled = !(remaining === 0 || _hasVisualChange);
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

    // Tab switching
    panel.querySelectorAll('.bs-forge-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.bs-forge-tab').forEach(t => t.classList.remove('bs-forge-tab--active'));
        tab.classList.add('bs-forge-tab--active');
        panel.querySelectorAll('.bs-forge-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById('bs-forge-tab-' + tab.dataset.tab);
        if (target) target.style.display = '';
      });
    });

    // Look tab: palette selection
    panel.querySelectorAll('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('[data-palette]').forEach(b => b.classList.remove('bs-forge-option--selected'));
        btn.classList.add('bs-forge-option--selected');
        _hasVisualChange = true;
        updateBudget();
      });
    });

    // Look tab: container selection
    panel.querySelectorAll('[data-container]').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('[data-container]').forEach(b => b.classList.remove('bs-forge-option--selected'));
        btn.classList.add('bs-forge-option--selected');
        _hasVisualChange = true;
        updateBudget();
      });
    });

    // Details tab: any input change enables forge + updates preview
    ['bs-forge-name', 'bs-forge-quote', 'bs-forge-avatar'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('input', () => {
        _hasVisualChange = true;
        updateBudget();
        // Live update preview name
        if (id === 'bs-forge-name' && previewNameEl) {
          previewNameEl.textContent = input.value || 'Your Card';
        }
        // Live update preview avatar
        if (id === 'bs-forge-avatar') {
          const previewImg = panel.querySelector('.bs-forge-card__img');
          if (previewImg && input.value.trim()) previewImg.src = input.value.trim();
        }
      });
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

      // Apply visual selections from Look tab
      const selectedPalette = panel.querySelector('.bs-forge-option--selected[data-palette]');
      const selectedContainer = panel.querySelector('.bs-forge-option--selected[data-container]');
      if (selectedPalette) _selectedCard.palette = selectedPalette.dataset.palette;
      if (selectedContainer) _selectedCard.imageContainer = selectedContainer.dataset.container;

      // Apply details from Details tab
      const nameInput = document.getElementById('bs-forge-name');
      const quoteInput = document.getElementById('bs-forge-quote');
      const avatarInput = document.getElementById('bs-forge-avatar');
      if (nameInput && nameInput.value.trim()) _selectedCard.name = nameInput.value.trim();
      if (quoteInput) _selectedCard.quote = quoteInput.value.trim();
      if (avatarInput && avatarInput.value.trim()) _selectedCard.avatar = avatarInput.value.trim();

      // Save via API
      try {
        const cardToSave = { ..._selectedCard, combatStats: newStats };
        if (selectedPalette) cardToSave.palette = selectedPalette.dataset.palette;
        if (selectedContainer) cardToSave.imageContainer = selectedContainer.dataset.container;
        // Include details tab changes
        if (nameInput && nameInput.value.trim()) cardToSave.name = nameInput.value.trim();
        if (quoteInput) cardToSave.quote = quoteInput.value.trim();
        if (avatarInput && avatarInput.value.trim()) cardToSave.avatar = avatarInput.value.trim();
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
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(cardToSave) });
        if (!resp.ok) throw new Error('Save failed: ' + resp.status);

        setForgeWins(0);
        localStorage.removeItem('bs-forge-pending');
        incForgeVisitCount();
        hideOverlay('bs-forge-screen');
        updateForgeProgress();
        renderLobby();
        completeBounty('forgeVisit');
        showSuccessToast('Card evolved!');
      } catch (e) {
        console.warn('[Blindspot] Forge save error:', e);
        hideOverlay('bs-forge-screen');
        showErrorToast('Failed to save evolution. Try again.');
      }
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
      ensureCombatStats(_selectedCard);
    }
    renderLobby();
  }

  // ============================================================
  // TUTORIAL (Stranger fight)
  // ============================================================

  const TUTORIAL_HINTS = [
    { move: 'strike',  text: 'Strike \u2014 basic attack. Deals STR damage. Disrupts enemy heals.' },
    { move: 'guard',   text: 'Guard \u2014 blocks 60% of strikes. Use when they attack.' },
    { move: 'heal',    text: 'Heal \u2014 recover HP. Warning: abilities punish healers hard.' },
    { move: 'counter', text: 'Counter \u2014 reflects enemy strikes back at them. Fails vs abilities.' },
    { move: 'ability', text: 'Ability \u2014 your class power. Costs 2 charges. Earned by fighting.' }
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
  // REWARD SYSTEM — Roulette + Boss Drops
  // ============================================================

  const LOOT_TABLE = [
    { weight: 30, type: 'stat_shard', stat: 'str', amount: 3, label: '+3 STR', rarity: 'common' },
    { weight: 30, type: 'stat_shard', stat: 'agi', amount: 3, label: '+3 AGI', rarity: 'common' },
    { weight: 30, type: 'stat_shard', stat: 'int', amount: 3, label: '+3 INT', rarity: 'common' },
    { weight: 30, type: 'stat_shard', stat: 'end', amount: 3, label: '+3 END', rarity: 'common' },
    { weight: 30, type: 'stat_shard', stat: 'lck', amount: 3, label: '+3 LCK', rarity: 'common' },
    { weight: 15, type: 'stat_shard', stat: 'str', amount: 5, label: '+5 STR', rarity: 'uncommon' },
    { weight: 15, type: 'stat_shard', stat: 'agi', amount: 5, label: '+5 AGI', rarity: 'uncommon' },
    { weight: 15, type: 'stat_shard', stat: 'int', amount: 5, label: '+5 INT', rarity: 'uncommon' },
    { weight: 15, type: 'stat_shard', stat: 'end', amount: 5, label: '+5 END', rarity: 'uncommon' },
    { weight: 15, type: 'stat_shard', stat: 'lck', amount: 5, label: '+5 LCK', rarity: 'uncommon' },
    { weight: 5, type: 'stat_shard', stat: 'str', amount: 8, label: '+8 STR', rarity: 'rare' },
    { weight: 5, type: 'stat_shard', stat: 'end', amount: 8, label: '+8 END', rarity: 'rare' },
    { weight: 3, type: 'stat_shard', stat: 'str', amount: 12, label: '+12 STR', rarity: 'epic' },
    { weight: 2, type: 'stat_shard', stat: 'int', amount: 12, label: '+12 INT', rarity: 'epic' }
  ];

  function rollLoot() {
    const totalWeight = LOOT_TABLE.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const item of LOOT_TABLE) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return LOOT_TABLE[0];
  }

  async function applyLootDrop(loot) {
    if (!_selectedCard || !_selectedCard.combatStats || loot.type !== 'stat_shard') return;

    const oldVal = _selectedCard.combatStats[loot.stat] || 0;
    _selectedCard.combatStats[loot.stat] = Math.min(100, oldVal + loot.amount);

    // Save with retry — revert on failure to prevent drift
    try {
      const cardToSave = { ..._selectedCard };
      cardToSave.stats = [
        { name: 'Strength', value: cardToSave.combatStats.str },
        { name: 'Agility', value: cardToSave.combatStats.agi },
        { name: 'Intelligence', value: cardToSave.combatStats.int },
        { name: 'Endurance', value: cardToSave.combatStats.end },
        { name: 'Luck', value: cardToSave.combatStats.lck }
      ];
      const url = window.buildApiPath('saveCard');
      const headers = { 'Content-Type': 'application/json' };
      const authHeaders = await window.ArenaAPI.getPrincipalHeader();
      Object.assign(headers, authHeaders);
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta && csrfMeta.content) headers['X-CSRF-Token'] = csrfMeta.content;
      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(cardToSave) });
      if (!resp.ok) throw new Error('Save failed');
    } catch (e) {
      // Revert stat change on save failure
      _selectedCard.combatStats[loot.stat] = oldVal;
      console.warn('[Blindspot] Loot save failed, reverted:', e);
    }
  }

  function showRewardDrop(reward, source) {
    const existing = document.querySelector('.bs-reward-drop');
    if (existing) existing.remove();

    const rarityColors = {
      common: 'var(--bs-text-muted)',
      uncommon: 'var(--bs-accent)',
      rare: '#7b2fff',
      epic: '#ff5252'
    };

    const iconMap = {
      stat_shard: 'fa-gem',
      stat_bonus: 'fa-arrow-up',
      title: 'fa-crown',
      forge_bonus: 'fa-fire'
    };

    const color = rarityColors[reward.rarity] || 'var(--bs-accent)';
    const rarityLabel = reward.rarity ? reward.rarity.charAt(0).toUpperCase() + reward.rarity.slice(1) : '';

    const drop = document.createElement('div');
    drop.className = 'bs-reward-drop';
    drop.innerHTML = `
      <div class="bs-reward-drop__content" style="border-color:${color};">
        <div class="bs-reward-drop__icon" style="color:${color};"><i class="fas ${iconMap[reward.type] || 'fa-gift'}"></i></div>
        <div class="bs-reward-drop__text">
          <span class="bs-reward-drop__title" style="color:${color};">${rarityLabel} Drop</span>
          <span class="bs-reward-drop__label">${escHtml(reward.label)}</span>
          ${source ? `<span class="bs-reward-drop__from">${escHtml(typeof source === 'string' ? source : source.name)}</span>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(drop);

    requestAnimationFrame(() => drop.classList.add('bs-reward-drop--visible'));

    setTimeout(() => {
      drop.classList.remove('bs-reward-drop--visible');
      setTimeout(() => drop.remove(), 500);
    }, 4000);
  }

  // ============================================================
  // DAILY BOUNTIES
  // ============================================================

  const BOUNTY_POOL = [
    { id: 'win_3_streak', text: 'Win 3 fights in a row', check: 'streak3' },
    { id: 'beat_new_boss', text: 'Defeat a new boss', check: 'newBoss' },
    { id: 'play_3', text: 'Play 3 fights today', check: 'play3' },
    { id: 'win_2', text: 'Win 2 fights today', check: 'win2' },
    { id: 'forge_card', text: 'Visit the Forge', check: 'forgeVisit' }
  ];

  function getDailyBounties() {
    const today = new Date().toISOString().slice(0, 10);
    const stored = JSON.parse(localStorage.getItem('bs-bounties') || '{}');
    if (stored.date !== today) {
      // Generate 3 new bounties for today
      const shuffled = [...BOUNTY_POOL].sort(() => Math.random() - 0.5);
      const bounties = shuffled.slice(0, 3).map(b => ({ ...b, done: false }));
      const data = { date: today, bounties, fights: 0 };
      localStorage.setItem('bs-bounties', JSON.stringify(data));
      return data;
    }
    return stored;
  }

  function completeBounty(checkType) {
    const data = getDailyBounties();
    let completed = false;
    data.bounties.forEach(b => {
      if (b.check === checkType && !b.done) {
        b.done = true;
        completed = true;
      }
    });
    if (checkType === 'play3') {
      data.fights = (data.fights || 0) + 1;
      if (data.fights >= 3) {
        data.bounties.forEach(b => {
          if (b.check === 'play3' && !b.done) { b.done = true; completed = true; }
        });
      }
    }
    localStorage.setItem('bs-bounties', JSON.stringify(data));
    if (completed) showSuccessToast('Bounty complete!');
    return completed;
  }

  function renderBounties() {
    const el = document.getElementById('bs-bounties');
    if (!el) return;

    const data = getDailyBounties();
    const doneCount = data.bounties.filter(b => b.done).length;

    el.innerHTML = `
      <div class="bs-bounties__header">
        <span><i class="fas fa-scroll"></i> Daily Bounties</span>
        <span class="bs-bounties__count">${doneCount}/3</span>
      </div>
      ${data.bounties.map(b => `
        <div class="bs-bounty ${b.done ? 'bs-bounty--done' : ''}">
          <i class="fas ${b.done ? 'fa-check-circle' : 'fa-circle'}"></i>
          <span>${escHtml(b.text)}</span>
        </div>
      `).join('')}
    `;
    el.style.display = '';
  }

  // ============================================================
  // AUTH UI
  // ============================================================

  function updatePlayAuthUI() {
    const el = document.getElementById('bs-topbar-user');
    if (!el) return;
    fetch('/.auth/me').then(r => r.json()).then(data => {
      if (data && data.clientPrincipal) {
        const name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'Player';
        el.innerHTML = `${escHtml(name)} <a href="/.auth/logout?post_logout_redirect_uri=/blindspot/" style="color:var(--bs-text-muted); margin-left:0.5rem; font-size:0.7rem;"><i class="fas fa-sign-out-alt"></i></a>`;
      }
    }).catch(() => {});
  }

  function updateLandingAuthUI() {
    const authArea = document.getElementById('bs-auth-area');
    if (!authArea) return;

    if (!isDemo()) {
      // Mark as authenticated for CardForge save pipeline
      sessionStorage.setItem('isAuthenticated', 'true');
      document.body.setAttribute('data-auth-state', 'signed-in');

      // User is logged in — show name + logout
      fetch('/.auth/me').then(r => r.json()).then(data => {
        if (data && data.clientPrincipal) {
          const name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'Player';
          authArea.innerHTML = `
            <span class="bs-landing__user">
              <i class="fas fa-user"></i> ${escHtml(name)}
              <a href="/.auth/logout?post_logout_redirect_uri=/blindspot/" class="bs-landing__signin" style="margin-left:0.75rem;">
                <i class="fas fa-sign-out-alt"></i> Sign out
              </a>
            </span>
          `;
        }
      }).catch(() => {});
    }
    // If demo, the sign-in link stays as-is
  }

  // ============================================================
  // STORAGE CLEANUP
  // ============================================================

  function cleanupLocalStorage() {
    try {
      // CardForge's cardforge_saved_cards can bloat localStorage with
      // renderedFront/renderedBack HTML (50-100KB per card). Strip these
      // to keep localStorage under the 5MB quota.
      const raw = localStorage.getItem('cardforge_saved_cards');
      if (!raw) return;
      const cards = JSON.parse(raw);
      let cleaned = false;
      cards.forEach(card => {
        if (card.cardData) {
          if (card.cardData.renderedFront) { delete card.cardData.renderedFront; cleaned = true; }
          if (card.cardData.renderedBack) { delete card.cardData.renderedBack; cleaned = true; }
          if (card.cardData.frontClasses) { delete card.cardData.frontClasses; cleaned = true; }
          if (card.cardData.backClasses) { delete card.cardData.backClasses; cleaned = true; }
          // Strip base64 avatars (AI-generated images can be 200-500KB each)
          if (card.cardData.avatar && card.cardData.avatar.startsWith('data:image/')) {
            card.cardData.avatar = '';
            cleaned = true;
          }
        }
        // Also strip top-level rendered HTML
        if (card.renderedFront) { delete card.renderedFront; cleaned = true; }
        if (card.renderedBack) { delete card.renderedBack; cleaned = true; }
      });
      // Cap to 10 most recent cards
      if (cards.length > 10) {
        cards.splice(10);
        cleaned = true;
      }
      if (cleaned) {
        localStorage.setItem('cardforge_saved_cards', JSON.stringify(cards));
        console.log('[Blindspot] Cleaned localStorage: removed rendered HTML from saved cards');
      }
    } catch (e) {
      console.warn('[Blindspot] Storage cleanup error:', e);
    }
  }

  // ============================================================
  // BOOT
  // ============================================================

  document.addEventListener('DOMContentLoaded', () => {
    cleanupLocalStorage();
    if (isOnLandingPage()) initLanding();
    else if (isOnPlayPage()) initPlay();
  });

})();
