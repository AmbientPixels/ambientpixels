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
  let _pvpGallery = [];
  let _pvpOpponentId = null;
  let _hookInstalled = false;
  let _origShowResults = null;
  let _battleRoundStats = null;
  let _submitMoveHooked = false;
  var _towerPendingFloor = 0;

  const RANKS = {
    bronze:   { xp: 0,    icon: 'fa-shield-halved', color: '#CD7F32', label: 'Bronze' },
    silver:   { xp: 500,  icon: 'fa-shield',        color: '#C0C0C0', label: 'Silver' },
    gold:     { xp: 1500, icon: 'fa-crown',          color: '#FFD700', label: 'Gold' },
    platinum: { xp: 3500, icon: 'fa-gem',            color: '#E5E4E2', label: 'Platinum' },
    diamond:  { xp: 7000, icon: 'fa-diamond',        color: '#B9F2FF', label: 'Diamond' }
  };
  const RANK_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

  // PvP Elo rating system
  const ELO_DEFAULT = 1000;
  const ELO_K = 32;
  const PVP_RANKS = [
    { name: 'Iron',     min: 0,    icon: 'fa-shield-halved', color: '#8a8a8a' },
    { name: 'Bronze',   min: 900,  icon: 'fa-shield-halved', color: '#CD7F32' },
    { name: 'Silver',   min: 1100, icon: 'fa-shield',        color: '#C0C0C0' },
    { name: 'Gold',     min: 1300, icon: 'fa-crown',          color: '#FFD700' },
    { name: 'Platinum', min: 1500, icon: 'fa-gem',            color: '#E5E4E2' },
    { name: 'Diamond',  min: 1700, icon: 'fa-diamond',        color: '#B9F2FF' }
  ];

  function getPvPElo() { return parseInt(localStorage.getItem('bs-pvp-elo') || ELO_DEFAULT, 10); }
  function setPvPElo(v) { localStorage.setItem('bs-pvp-elo', Math.max(0, Math.round(v))); }
  function getPvPRecord() {
    try { return JSON.parse(localStorage.getItem('bs-pvp-record') || '{"w":0,"l":0}'); }
    catch(e) { return { w: 0, l: 0 }; }
  }
  function setPvPRecord(rec) { localStorage.setItem('bs-pvp-record', JSON.stringify(rec)); }

  function getPvPRank(elo) {
    for (var i = PVP_RANKS.length - 1; i >= 0; i--) {
      if (elo >= PVP_RANKS[i].min) return PVP_RANKS[i];
    }
    return PVP_RANKS[0];
  }

  function showEloChange(text, color, newRankObj) {
    var el = document.createElement('div');
    el.className = 'bs-elo-toast';
    el.innerHTML = '<span class="bs-elo-toast__value" style="color:' + color + ';">' + text + '</span>' +
      (newRankObj ? '<span class="bs-elo-toast__rank" style="color:' + newRankObj.color + ';"><i class="fas ' + newRankObj.icon + '"></i> Rank Up: ' + newRankObj.name + '!</span>' : '');
    document.body.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('bs-elo-toast--active'); });
    setTimeout(function() {
      el.classList.add('bs-elo-toast--exit');
      setTimeout(function() { el.remove(); }, 600);
    }, 2500);
  }

  function estimateOpponentElo(card) {
    var power = getCardPower(card);
    // Map power (typically 50-250) to Elo range 800-1600
    return Math.min(1600, Math.max(800, Math.round(power * 4 + 600)));
  }

  function calcEloChange(playerElo, opponentElo, won) {
    var expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
    var score = won ? 1 : 0;
    return Math.round(ELO_K * (score - expected));
  }

  // Boss class → icon mapping
  const BOSS_ICONS = {
    Enforcer: 'fa-gavel', Fighter: 'fa-hand-fist', Scout: 'fa-binoculars',
    Hacker: 'fa-terminal', Berserker: 'fa-fire', Scholar: 'fa-book',
    Guardian: 'fa-shield-halved', Trickster: 'fa-dice', Caster: 'fa-wand-magic-sparkles',
    Rogue: 'fa-user-ninja', Medic: 'fa-heart-pulse', Pilot: 'fa-rocket'
  };

  // ============================================================
  // SOUND EFFECTS (Web Audio API — no files needed)
  // ============================================================

  let _audioCtx = null;

  function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  }

  function playSfx(name) {
    // Respect ArenaAudio mute toggle (shared SFX button in top bar)
    if (window.ArenaAudio && window.ArenaAudio.isMuted()) return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      const sfx = SFX_DEFS[name];
      if (sfx) sfx(ctx);
    } catch (e) { /* audio not supported — fail silently */ }
  }

  // Synth definitions — each creates oscillator nodes and schedules them
  const SFX_DEFS = {
    // Loot drop: bright sparkle arpeggio (3 rising notes)
    loot: function (ctx) {
      var t = ctx.currentTime;
      [523, 659, 784].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, t + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.08);
        osc.stop(t + i * 0.08 + 0.3);
      });
    },

    // Boss defeat: triumphant fanfare (power chord + octave rise)
    bossDefeat: function (ctx) {
      var t = ctx.currentTime;
      // Root + fifth + octave staggered
      [[262, 0], [330, 0.05], [392, 0.1], [523, 0.2]].forEach(function (pair) {
        var freq = pair[0], delay = pair[1];
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + delay);
        osc.stop(t + delay + 0.55);
      });
    },

    // Ascension: ethereal rising sweep with shimmer
    ascension: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.6);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.setValueAtTime(0.2, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.85);
      // Shimmer overtone
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(660, t + 0.2);
      osc2.frequency.exponentialRampToValueAtTime(1760, t + 0.7);
      gain2.gain.setValueAtTime(0.08, t + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(t + 0.2);
      osc2.stop(t + 0.95);
    },

    // Forge complete: anvil hit (short noise burst + metallic ring)
    forgeComplete: function (ctx) {
      var t = ctx.currentTime;
      // Noise burst (impact)
      var bufferSize = ctx.sampleRate * 0.05;
      var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
      var noise = ctx.createBufferSource();
      noise.buffer = buffer;
      var nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.25, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      noise.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(t);
      noise.stop(t + 0.1);
      // Metallic ring
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1047;
      gain.gain.setValueAtTime(0.1, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + 0.02);
      osc.stop(t + 0.45);
    },

    // Battle win: short victory jingle
    battleWin: function (ctx) {
      var t = ctx.currentTime;
      [392, 494, 587, 784].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, t + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.1);
        osc.stop(t + i * 0.1 + 0.35);
      });
    },

    // Battle loss: descending minor notes
    battleLoss: function (ctx) {
      var t = ctx.currentTime;
      [392, 349, 311, 262].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, t + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.15);
        osc.stop(t + i * 0.15 + 0.4);
      });
    }
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

  function updateBottomNav(screenId) {
    var navMap = { lobby: 'lobby', campaign: 'campaign', pvp: 'pvp', forge: 'forge', leaderboard: 'leaderboard', battle: '__none__' };
    document.querySelectorAll('.bs-bottom-nav__item').forEach(function(btn) {
      var isActive = btn.dataset.nav === navMap[screenId];
      btn.classList.toggle('bs-bottom-nav__item--active', isActive);
      btn.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  }

  function showScreen(id) {
    document.querySelectorAll('.bs-screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('bs-screen-' + id);
    if (target) target.classList.add('active');
    document.body.classList.toggle('bs-battle-active', id === 'battle');
    updateBottomNav(id);
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

  // Ascension system
  function getAscension() { return parseInt(localStorage.getItem('bs-ascension') || '0', 10); }
  function setAscension(n) { localStorage.setItem('bs-ascension', String(n)); }

  function getCardTitle() { return localStorage.getItem('bs-card-title') || ''; }
  function setCardTitle(t) { localStorage.setItem('bs-card-title', t); }

  // Infinite Tower state
  function getTowerFloor() { return parseInt(localStorage.getItem('bs-tower-floor') || '0', 10); }
  function setTowerFloor(n) { localStorage.setItem('bs-tower-floor', String(n)); }
  function getTowerBest() { return parseInt(localStorage.getItem('bs-tower-best') || '0', 10); }
  function setTowerBest(n) {
    if (n > getTowerBest()) localStorage.setItem('bs-tower-best', String(n));
  }
  function isTowerUnlocked() { return getAscension() >= 5; }
  function getTowerBossForFloor(floor) {
    // Cycle through 10 campaign bosses
    var bossNum = ((floor - 1) % 10) + 1;
    return _bosses.find(function(b) { return b.boss === bossNum && !b.weekly && !isWeeklyBoss(b.id); });
  }
  function getTowerMilestoneReward(floor) {
    // Milestone rewards every 5 floors
    var milestones = {
      5: { type: 'stat_bonus', stat: 'str', amount: 3, label: '+3 STR' },
      10: { type: 'stat_bonus', stat: 'agi', amount: 3, label: '+3 AGI' },
      15: { type: 'stat_bonus', stat: 'int', amount: 3, label: '+3 INT' },
      20: { type: 'stat_bonus', stat: 'end', amount: 3, label: '+3 END' },
      25: { type: 'stat_bonus', stat: 'lck', amount: 3, label: '+3 LCK' },
      30: { type: 'title', title: 'Tower Climber', label: 'Title: Tower Climber' },
      50: { type: 'title', title: 'Tower Master', label: 'Title: Tower Master' }
    };
    return milestones[floor] || null;
  }
  function getTowerClaimedFloors() {
    try { return JSON.parse(localStorage.getItem('bs-tower-claimed') || '[]'); }
    catch { return []; }
  }
  function claimTowerFloor(floor) {
    var claimed = getTowerClaimedFloors();
    if (!claimed.includes(floor)) {
      claimed.push(floor);
      localStorage.setItem('bs-tower-claimed', JSON.stringify(claimed));
    }
  }

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

  // ============================================================
  // WEEKLY ROTATING BOSS
  // ============================================================

  function getWeeklyBosses() {
    return _bosses.filter(function (b) { return b.weekly || isWeeklyBoss(b.id); });
  }

  function getISOWeekNumber() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    var week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }

  function getWeeklyBoss() {
    var pool = getWeeklyBosses();
    if (pool.length === 0) return null;
    return pool[getISOWeekNumber() % pool.length];
  }

  function getWeeklyBossKey() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    return d.getFullYear() + '-W' + getISOWeekNumber();
  }

  function getWeeklyRecord() {
    try {
      var data = JSON.parse(localStorage.getItem('bs-weekly-boss') || '{}');
      if (data.week !== getWeeklyBossKey()) return { week: getWeeklyBossKey(), wins: 0, losses: 0, rewardClaimed: false };
      return data;
    } catch (e) { return { week: getWeeklyBossKey(), wins: 0, losses: 0, rewardClaimed: false }; }
  }

  function recordWeeklyResult(isWin) {
    var rec = getWeeklyRecord();
    rec.week = getWeeklyBossKey();
    if (isWin) rec.wins++;
    else rec.losses++;
    localStorage.setItem('bs-weekly-boss', JSON.stringify(rec));
  }

  function isWeeklyRewardClaimed() {
    return getWeeklyRecord().rewardClaimed;
  }

  function claimWeeklyReward() {
    var rec = getWeeklyRecord();
    rec.rewardClaimed = true;
    localStorage.setItem('bs-weekly-boss', JSON.stringify(rec));
  }

  function getDaysUntilWeeklyReset() {
    var now = new Date();
    var dayOfWeek = now.getDay();
    var daysUntil = (8 - dayOfWeek) % 7;
    if (daysUntil === 0) daysUntil = 7;
    return daysUntil;
  }

  function isWeeklyBoss(bossId) {
    return bossId && bossId.startsWith('bs-weekly-');
  }

  function isWeeklyBossDefeated() {
    return getWeeklyRecord().wins > 0;
  }

  // Apply boss reward to card
  async function applyBossReward(boss) {
    var weekly = isWeeklyBoss(boss.id);
    if (weekly) {
      if (!boss.reward || isWeeklyRewardClaimed()) return null;
    } else {
      if (!boss.reward || isRewardClaimed(boss.id)) return null;
    }

    const reward = boss.reward;

    if (reward.type === 'stat_bonus' && _selectedCard && _selectedCard.combatStats) {
      _selectedCard.combatStats[reward.stat] = Math.min(100,
        (_selectedCard.combatStats[reward.stat] || 0) + reward.amount
      );
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
        if (weekly) claimWeeklyReward(); else claimReward(boss.id);
      } catch (e) {
        _selectedCard.combatStats[reward.stat] = Math.min(100,
          (_selectedCard.combatStats[reward.stat] || 0) - reward.amount
        );
        console.warn('[Blindspot] Reward save failed, reverted:', e);
        return null;
      }
    }

    if (reward.type === 'title') {
      setCardTitle(reward.title);
      if (weekly) claimWeeklyReward(); else claimReward(boss.id);
    }

    if (reward.type === 'visual') {
      unlockVisual(reward.unlock);
      if (weekly) claimWeeklyReward(); else claimReward(boss.id);
    }

    if (reward.type === 'forge_bonus') {
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
  // SESSION STATS TRACKING
  // ============================================================

  function resetBattleStats() {
    _battleRoundStats = {
      rounds: 0,
      damageDealt: 0,
      damageTaken: 0,
      healingDone: 0,
      moves: { strike: 0, guard: 0, ability: 0, heal: 0, counter: 0 }
    };
  }

  function trackRoundResult(roundResult) {
    if (!_battleRoundStats) resetBattleStats();
    _battleRoundStats.rounds++;
    _battleRoundStats.damageDealt += (roundResult.playerDamage || 0);
    _battleRoundStats.damageTaken += (roundResult.opponentDamage || 0);
    _battleRoundStats.healingDone += (roundResult.playerHeal || 0);
    const move = roundResult.playerMove;
    if (move && _battleRoundStats.moves.hasOwnProperty(move)) {
      _battleRoundStats.moves[move]++;
    }
  }

  function hookBattleTracking() {
    if (window._bsTrackingHooked) return;
    window._bsTrackingHooked = true;
    // Hook initBattle to reset stats
    if (window.ArenaBattleUI && window.ArenaBattleUI.initBattle) {
      const origInit = window.ArenaBattleUI.initBattle;
      window.ArenaBattleUI.initBattle = function (battleData) {
        resetBattleStats();
        return origInit.call(window.ArenaBattleUI, battleData);
      };
    }
    // Hook submitMove to track each round's result
    if (window.ArenaAPI && window.ArenaAPI.submitMove) {
      const origSubmit = window.ArenaAPI.submitMove;
      window.ArenaAPI.submitMove = async function () {
        const response = await origSubmit.apply(window.ArenaAPI, arguments);
        if (response && response.roundResult) {
          trackRoundResult(response.roundResult);
        }
        return response;
      };
    }
  }

  function renderSessionStats() {
    if (!_battleRoundStats || _battleRoundStats.rounds === 0) return;
    const s = _battleRoundStats;
    // Remove any previous stats panel
    document.querySelector('.bs-session-stats')?.remove();

    const moveIcons = { strike: 'fa-fist-raised', guard: 'fa-shield-halved', ability: 'fa-bolt', heal: 'fa-heart', counter: 'fa-rotate-left' };
    const moveLabels = { strike: 'Strike', guard: 'Guard', ability: 'Ability', heal: 'Heal', counter: 'Counter' };
    let movesHtml = '';
    for (const [move, count] of Object.entries(s.moves)) {
      if (count > 0) {
        movesHtml += `<span class="bs-session-stat__move"><i class="fas ${moveIcons[move]}"></i> ${count}</span>`;
      }
    }

    const panel = document.createElement('div');
    panel.className = 'bs-session-stats';
    panel.innerHTML = `
      <div class="bs-session-stats__title"><i class="fas fa-chart-bar"></i> Battle Stats</div>
      <div class="bs-session-stats__grid">
        <div class="bs-session-stat">
          <span class="bs-session-stat__val">${s.rounds}</span>
          <span class="bs-session-stat__label">Rounds</span>
        </div>
        <div class="bs-session-stat bs-session-stat--dmg">
          <span class="bs-session-stat__val">${s.damageDealt}</span>
          <span class="bs-session-stat__label">Damage Dealt</span>
        </div>
        <div class="bs-session-stat bs-session-stat--taken">
          <span class="bs-session-stat__val">${s.damageTaken}</span>
          <span class="bs-session-stat__label">Damage Taken</span>
        </div>
        <div class="bs-session-stat bs-session-stat--heal">
          <span class="bs-session-stat__val">${s.healingDone}</span>
          <span class="bs-session-stat__label">Healing</span>
        </div>
      </div>
      ${movesHtml ? `<div class="bs-session-stats__moves">${movesHtml}</div>` : ''}
    `;

    // Insert after subtitle/power row in results overlay
    const subtitle = document.getElementById('arena-results-subtitle');
    const power = document.querySelector('.bs-results-power');
    const insertAfter = power || subtitle;
    if (insertAfter) {
      insertAfter.after(panel);
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
      fightBtn.innerHTML = '<span class="bs-spinner" style="display:inline-block;width:14px;height:14px;"></span> Loading...';
      // Safety timeout — if nothing happens in 12s, reset the button
      const fightTimeout = setTimeout(() => {
        fightBtn.disabled = false;
        fightBtn.innerHTML = 'Fight';
        showErrorToast('Connection timed out. Try again.');
        document.getElementById('bs-landing').style.display = '';
        document.getElementById('bs-battle-container').style.display = 'none';
      }, 12000);

      if (!isNewPlayer(profile)) {
        window.location.href = '/blindspot/play.html';
        return;
      }

      // ALL new players fight as The Stranger first
      // Demo users: cardData passed directly (server accepts it)
      // Authenticated users: also pass cardData (server uses it when card isn't in collection)
      await showStrangerIntro();
      await startStrangerFight();
    });
  }

  function showStrangerIntro() {
    return new Promise(resolve => {
      // Only show intro on first stranger fight
      if (localStorage.getItem('bs-stranger-intro-shown')) { resolve(); return; }
      localStorage.setItem('bs-stranger-intro-shown', 'true');

      // Fade out landing screen
      const landing = document.getElementById('bs-landing');
      landing.style.opacity = '0';
      landing.style.transition = 'opacity 0.5s ease';

      const intro = document.getElementById('bs-stranger-intro');
      if (!intro) { resolve(); return; }

      setTimeout(() => {
        landing.style.display = 'none';
        landing.style.opacity = '';
        intro.classList.remove('bs-overlay--hidden');
        intro.style.display = '';

        // Reveal lines one by one
        const lines = intro.querySelectorAll('.bs-stranger-intro__line');
        const delays = [400, 1800, 3200];
        lines.forEach((line, i) => {
          setTimeout(() => line.classList.add('bs-intro-visible'), delays[i] || (i * 1400));
        });

        // Fade out and resolve after all lines shown
        setTimeout(() => {
          intro.classList.add('bs-intro-fadeout');
          setTimeout(() => {
            intro.classList.add('bs-overlay--hidden');
            intro.classList.remove('bs-intro-fadeout');
            resolve();
          }, 600);
        }, 5000);
      }, 500);
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
    hookBattleTracking();

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
      updateCombatTooltips();
      // Show combat guide on very first battle
      if (!localStorage.getItem('bs-combat-guide-shown')) {
        localStorage.setItem('bs-combat-guide-shown', 'true');
        showOverlay('bs-combat-guide');
      }
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

      // Authenticated users: save and show reveal celebration
      if (cardId) {
        window.ArenaAPI.selectCard(cardId).catch(e => console.warn('selectCard:', e));
      }
      localStorage.setItem('blindspot-onboarded', 'true');
      showCardRevealCelebration(cardId);
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

  function showCardRevealCelebration(cardId) {
    document.querySelector('.bs-reveal-celebration')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay bs-reveal-celebration';

    // Try to get card data from ArenaAPI cache or fall back to minimal display
    let cardHtml = '';
    const tryRender = async () => {
      let card = null;
      try {
        const data = await window.ArenaAPI.loadCards();
        const cards = data.userCards || [];
        card = cardId ? cards.find(c => c.id === cardId) : cards[cards.length - 1];
      } catch (e) { /* proceed without card data */ }

      const name = card?.name || 'Your Card';
      const cls = card?.class || card?.characterClass || '';
      const rarity = card?.rarity || 'Common';
      const avatar = card?.avatar || '';
      const palette = card?.palette || 'earth';
      const stats = card?.combatStats || {};
      const statDefs = [
        { key: 'strength', label: 'STR', color: '#D85A30' },
        { key: 'speed', label: 'SPD', color: '#C6A84C' },
        { key: 'defense', label: 'DEF', color: '#4A90A4' },
        { key: 'magic', label: 'MAG', color: '#8B5CF6' },
        { key: 'heal', label: 'HEL', color: '#22C55E' },
      ];

      const statsHtml = statDefs.map(d => {
        const val = stats[d.key] || 0;
        return `<div class="bs-reveal-stat">
          <span class="bs-reveal-stat__label" style="color:${d.color}">${d.label}</span>
          <div class="bs-reveal-stat__bar"><div class="bs-reveal-stat__fill" style="width:${val}%;background:${d.color}"></div></div>
          <span class="bs-reveal-stat__val">${val}</span>
        </div>`;
      }).join('');

      // Create particle elements
      let particles = '';
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const dist = 80 + Math.random() * 120;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        const size = 3 + Math.random() * 5;
        const delay = Math.random() * 0.4;
        particles += `<div class="bs-reveal-particle" style="--tx:${tx.toFixed(1)}px;--ty:${ty.toFixed(1)}px;--size:${size}px;--delay:${delay}s"></div>`;
      }

      overlay.innerHTML = `
        <div class="bs-reveal-particles">${particles}</div>
        <div class="bs-reveal-card-wrap">
          <div class="bs-reveal-card" data-palette="${escHtml(palette)}" data-rarity="${escHtml(rarity.toLowerCase())}">
            ${avatar ? `<img class="bs-reveal-card__img" src="${escHtml(avatar)}" alt="${escHtml(name)}">` : `<div class="bs-reveal-card__icon"><i class="fas fa-fire"></i></div>`}
            <div class="bs-reveal-card__info">
              <span class="bs-reveal-card__name">${escHtml(name)}</span>
              ${cls ? `<span class="bs-reveal-card__class">${escHtml(cls)}</span>` : ''}
              <span class="bs-reveal-card__rarity bs-reveal-card__rarity--${escHtml(rarity.toLowerCase())}">${escHtml(rarity)}</span>
            </div>
            <div class="bs-reveal-stats">${statsHtml}</div>
          </div>
        </div>
        <p class="bs-reveal-title">Your card is ready</p>
        <p class="bs-reveal-subtitle">The arena awaits.</p>
        <button class="bs-btn bs-btn--primary bs-btn--glow bs-reveal-enter" id="bs-reveal-enter">
          <i class="fas fa-shield-halved"></i> Enter the Arena
        </button>
      `;

      document.body.appendChild(overlay);

      // Trigger entrance animation after a frame
      requestAnimationFrame(() => {
        overlay.classList.add('bs-reveal-celebration--active');
      });

      document.getElementById('bs-reveal-enter')?.addEventListener('click', () => {
        overlay.classList.add('bs-reveal-celebration--exit');
        setTimeout(() => {
          window.location.href = '/blindspot/play.html?firstFight=true';
        }, 400);
      });

      // Auto-redirect after 8 seconds if user doesn't click
      setTimeout(() => {
        if (document.body.contains(overlay)) {
          window.location.href = '/blindspot/play.html?firstFight=true';
        }
      }, 8000);
    };

    tryRender();
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

    // Session stats panel
    renderSessionStats();
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
    hookBattleTracking();

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
    // Apply streak glow
    const cardDisplay0 = document.getElementById('bs-player-card');
    if (cardDisplay0) {
      const streak = getWinStreak();
      cardDisplay0.classList.toggle('bs-card-streak', streak >= 3);
      cardDisplay0.classList.toggle('bs-card-streak--hot', streak >= 5);
    }
    // Apply palette + ascension border to card display
    const cardDisplay = document.getElementById('bs-player-card');
    if (cardDisplay && _selectedCard) {
      const palette = _selectedCard.palette || 'earth';
      cardDisplay.setAttribute('data-palette', palette);
      const asc = getAscension();
      cardDisplay.setAttribute('data-ascension', asc > 0 ? String(asc) : '0');
    }
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
    renderChallenges();
    checkAndClaimChallenges();

    // PvP unlock check
    const highestBoss = getHighestBossDefeated();
    const pvpBtn = document.getElementById('bs-btn-pvp');
    const pvpLock = document.getElementById('bs-pvp-lock');
    if (highestBoss >= 10) {
      if (pvpBtn) pvpBtn.disabled = false;
      if (pvpLock) {
        var elo = getPvPElo();
        var pvpRank = getPvPRank(elo);
        pvpLock.style.display = '';
        pvpLock.className = 'bs-mode-btn__rank';
        pvpLock.innerHTML = '<i class="fas ' + pvpRank.icon + '" style="color:' + pvpRank.color + ';"></i> ' + pvpRank.name + ' <span style="color:var(--bs-text-muted);">' + elo + '</span>';
      }
    }

    // Power rating + stats
    const statsEl = document.getElementById('bs-lobby-stats');
    if (statsEl) {
      const power = getCardPower(_selectedCard);
      const streak = getWinStreak();
      const highestB = getHighestBossDefeated();

      let streakHtml = '';
      if (streak >= 5) streakHtml = `<span style="color:#ff3333;"><i class="fas fa-fire-flame-curved"></i> ${streak} STREAK</span>`;
      else if (streak >= 3) streakHtml = `<span style="color:var(--bs-accent-glow);"><i class="fas fa-fire"></i> ${streak} streak</span>`;
      else if (streak > 0) streakHtml = `<span><i class="fas fa-fire"></i> ${streak} streak</span>`;

      const ascension = getAscension();
      const ascHtml = ascension > 0 ? `<span class="bs-ascension-badge"><i class="fas fa-star"></i> Ascension ${ascension}</span>` : '';
      const powerHtml = power > 0 ? `<span data-tooltip="Sum of all combat stats"><i class="fas fa-bolt" style="color:var(--bs-accent);"></i> ${power} Power</span>` : '';

      // PvP Elo in lobby (only show if PvP unlocked)
      let pvpHtml = '';
      if (highestB >= 10) {
        const elo = getPvPElo();
        const pvpRank = getPvPRank(elo);
        pvpHtml = `<span style="color:${pvpRank.color};" data-tooltip="PvP Rating"><i class="fas ${pvpRank.icon}"></i> ${elo}</span>`;
      }

      // Tower best floor in lobby stats
      let towerHtml = '';
      if (isTowerUnlocked()) {
        const tBest = getTowerBest();
        const tCurrent = getTowerFloor();
        if (tCurrent > 0) {
          towerHtml = `<span style="color:var(--bs-accent);"><i class="fas fa-tower-observation"></i> Floor ${tCurrent}</span>`;
        } else if (tBest > 0) {
          towerHtml = `<span><i class="fas fa-tower-observation"></i> Best ${tBest}</span>`;
        } else {
          towerHtml = `<span style="color:var(--bs-accent);"><i class="fas fa-tower-observation"></i> NEW</span>`;
        }
      }

      statsEl.innerHTML = `
        ${powerHtml}
        <span><i class="fas fa-mountain"></i> Boss ${highestB}/10</span>
        ${pvpHtml}
        ${towerHtml}
        ${streakHtml}
      `;
    }

    // Update campaign button description when tower is unlocked
    const campaignDescEl = document.querySelector('#bs-btn-campaign .bs-mode-btn__desc');
    if (campaignDescEl && isTowerUnlocked()) {
      campaignDescEl.textContent = 'Campaign + Infinite Tower';
    }

    // Stat bar breakdown with damage/heal estimates
    const statBarEl = document.getElementById('bs-stat-bars');
    if (statBarEl && _selectedCard && _selectedCard.combatStats) {
      const cs = _selectedCard.combatStats;
      const strVal = cs.str || 0;
      const endVal = cs.end || 0;
      const statDefs = [
        { key: 'str', label: 'STR', color: '#ff5252', desc: 'Strike damage',
          estimate: function(v) { var lo = Math.round(v * 0.4); var hi = Math.round(v * 0.5); return lo > 0 ? lo + '-' + hi + ' dmg' : ''; } },
        { key: 'agi', label: 'AGI', color: '#00e676', desc: 'Speed + dodge',
          estimate: function(v) { return v >= 50 ? '+charge' : 'speed'; } },
        { key: 'int', label: 'INT', color: '#7b2fff', desc: 'Ability power',
          estimate: function(v) { var lo = Math.round(v * 0.55); var hi = Math.round(v * 0.7); return lo > 0 ? lo + '-' + hi + ' ability' : ''; } },
        { key: 'end', label: 'END', color: '#ff9100', desc: 'Heal + HP',
          estimate: function(v) { var hp = 50 + Math.round(v * 0.8) + Math.round(strVal * 0.2); var lo = Math.round(v * 0.3); var hi = Math.round(v * 0.4); return lo > 0 ? lo + '-' + hi + ' heal \u00b7 ' + hp + ' HP' : hp + ' HP'; } },
        { key: 'lck', label: 'LCK', color: '#ffd740', desc: 'Crit chance',
          estimate: function(v) { var lo = Math.round(v * 0.5); var hi = Math.round(v * 0.7); return lo > 0 ? lo + '-' + hi + ' wild' : ''; } }
      ];
      statBarEl.innerHTML = statDefs.map(d => {
        const val = cs[d.key] || 0;
        const est = d.estimate(val);
        return `<div class="bs-stat-bar-row">
          <span class="bs-stat-bar-label" style="color:${d.color}" data-tooltip="${d.desc}">${d.label}</span>
          <div class="bs-stat-bar-track"><div class="bs-stat-bar-fill" style="width:${val}%;background:${d.color};"></div></div>
          <span class="bs-stat-bar-val">${val}</span>
          ${est ? '<span class="bs-stat-bar-est" style="color:' + d.color + '">' + est + '</span>' : ''}
        </div>`;
      }).join('');
      statBarEl.style.display = '';
    }

    // Toggle stat bars on card click
    const _cardClickEl = document.getElementById('bs-player-card');
    if (_cardClickEl) {
      _cardClickEl.style.cursor = 'pointer';
      _cardClickEl.addEventListener('click', () => {
        const bars = document.getElementById('bs-stat-bars');
        if (bars) bars.style.display = bars.style.display === 'none' ? '' : 'none';
      });
    }

    // Toggle stat bars on card click
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

    // Primary PLAY button + Campaign button both open campaign
    const openCampaign = () => { showScreen('campaign'); renderCampaignLadder(); };
    // Smart ENTER ARENA: go straight to next boss fight
    const enterArena = () => {
      const highest = getHighestBossDefeated();
      const nextBoss = _bosses.find(b => b.boss === highest + 1);
      if (nextBoss) {
        // Show pre-fight overlay for next boss
        const flavorEl = document.getElementById('bs-prefight-flavor');
        const titleEl = document.getElementById('bs-prefight-title');
        const avatarEl = document.getElementById('bs-prefight-avatar');
        if (flavorEl) flavorEl.textContent = '"' + nextBoss.flavor + '"';
        if (titleEl) titleEl.textContent = nextBoss.name;
        if (avatarEl) {
          if (nextBoss.avatar) {
            avatarEl.innerHTML = '<img src="' + escHtml(nextBoss.avatar) + '" alt="' + escHtml(nextBoss.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            avatarEl.style.width = '96px';
            avatarEl.style.height = '96px';
          } else {
            const icon = BOSS_ICONS[nextBoss.class] || 'fa-skull';
            avatarEl.innerHTML = '<i class="fas ' + icon + '"></i>';
          }
        }
        showOverlay('bs-prefight-overlay');
        const oldBtn = document.getElementById('bs-prefight-go');
        const freshBtn = oldBtn.cloneNode(true);
        oldBtn.parentNode.replaceChild(freshBtn, oldBtn);
        freshBtn.addEventListener('click', async () => {
          hideOverlay('bs-prefight-overlay');
          await startCampaignBattle(nextBoss.id);
        }, { once: true });
      } else {
        // All bosses defeated — go to campaign to replay or ascend
        showScreen('campaign');
        renderCampaignLadder();
      }
    };
    document.getElementById('bs-play-btn')?.addEventListener('click', enterArena);
    document.getElementById('bs-btn-campaign')?.addEventListener('click', openCampaign);

    document.getElementById('bs-btn-pvp')?.addEventListener('click', () => {
      showScreen('pvp');
      renderPvPGallery();
    });

    document.getElementById('bs-btn-leaderboard')?.addEventListener('click', () => {
      showScreen('leaderboard');
      renderLeaderboard();
    });

    document.getElementById('bs-campaign-back')?.addEventListener('click', () => {
      showScreen('lobby');
      renderLobby();
    });
    document.getElementById('bs-leaderboard-back')?.addEventListener('click', () => {
      showScreen('lobby');
      renderLobby();
    });
    document.getElementById('bs-pvp-back')?.addEventListener('click', () => {
      showScreen('lobby');
      renderLobby();
    });

    // Combat guide
    document.getElementById('bs-combat-help-btn')?.addEventListener('click', () => { showOverlay('bs-combat-guide'); });
    document.getElementById('bs-combat-guide-close')?.addEventListener('click', () => { hideOverlay('bs-combat-guide'); });

    // Forge overlays
    document.getElementById('bs-forge-now')?.addEventListener('click', () => { hideOverlay('bs-forge-trigger'); openForgeScreen(); });
    document.getElementById('bs-forge-later')?.addEventListener('click', () => { hideOverlay('bs-forge-trigger'); localStorage.setItem('bs-forge-pending', 'true'); updateForgeProgress(); });
    document.getElementById('bs-forge-unlock-btn')?.addEventListener('click', () => { hideOverlay('bs-forge-unlock'); openForgeScreen(true); });

    // Architect win
    document.getElementById('bs-architect-continue')?.addEventListener('click', () => {
      hideOverlay('bs-architect-win');
      // First completion — offer ascension
      showAscensionOffer(0);
    });

    // Bottom nav handling
    document.querySelectorAll('.bs-bottom-nav__item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const nav = btn.dataset.nav;
        document.querySelectorAll('.bs-bottom-nav__item').forEach(function(b) { b.classList.remove('bs-bottom-nav__item--active'); });
        btn.classList.add('bs-bottom-nav__item--active');
        if (nav === 'lobby') { showScreen('lobby'); renderLobby(); }
        else if (nav === 'campaign') { showScreen('campaign'); renderCampaignLadder(); }
        else if (nav === 'forge') {
          var needed = _config ? _config.forgeVisit.winsRequired : 3;
          if (getForgeWins() >= needed || isForgePending()) { openForgeScreen(); }
          else { showErrorToast('Win ' + (needed - getForgeWins()) + ' more campaign fights to unlock the Forge'); }
        }
        else if (nav === 'leaderboard') { showScreen('leaderboard'); renderLeaderboard(); }
        else if (nav === 'pvp') {
          if (getHighestBossDefeated() >= 10) { showScreen('pvp'); renderPvPGallery(); }
          else { showErrorToast('Beat Boss 10 to unlock PvP'); }
        }
      });
    });

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
      if (_battleType === 'tower') {
        // Tower: continue climbing or restart
        if (getTowerFloor() > 0) {
          // Still in run — continue to next floor
          showScreen('campaign');
          renderCampaignLadder();
          setTimeout(function() { startTowerBattle(); }, 300);
        } else {
          // Run ended — back to campaign
          showScreen('campaign');
          renderCampaignLadder();
        }
        return;
      }
      if (_battleType === 'pvp') { showScreen('pvp'); renderPvPGallery(); }
      else if (_currentBossId) {
        const currentBoss = _bosses.find(b => b.id === _currentBossId);
        // Weekly boss — return to campaign after fight
        if (isWeeklyBoss(_currentBossId)) {
          showScreen('campaign'); renderCampaignLadder();
        }
        // Advance to next boss if current was defeated, otherwise retry same boss
        else {
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

    // Update progress counter in header
    const progressEl = document.getElementById('bs-campaign-progress');
    var campaignOnly = _bosses.filter(function (b) { return !b.weekly && !isWeeklyBoss(b.id); });
    if (progressEl) {
      const total = campaignOnly.length;
      const defeated = Math.min(highestDefeated, total);
      if (defeated >= total) {
        progressEl.innerHTML = '<i class="fas fa-crown" style="color:var(--bs-accent);"></i> ' + total + '/' + total + ' defeated';
      } else {
        progressEl.textContent = defeated + '/' + total + ' defeated';
      }
    }

    // Weekly boss challenge section
    var weeklyBoss = getWeeklyBoss();
    var daysLeft = getDaysUntilWeeklyReset();
    var weeklyHtml = '';
    var weeklyRec = getWeeklyRecord();
    var wDefeated = weeklyRec.wins > 0;
    var wRecord = weeklyRec;
    var wIcon = BOSS_ICONS[weeklyBoss.class] || 'fa-skull';
    var wRecordBadge = (wRecord.wins > 0 || wRecord.losses > 0)
      ? '<span class="bs-boss-card__record">' + wRecord.wins + 'W / ' + wRecord.losses + 'L</span>'
      : '';
    var wRewardClaimed = isWeeklyRewardClaimed();
    var wRewardBadge = weeklyBoss.reward
      ? '<span class="bs-boss-card__reward ' + (wRewardClaimed ? 'bs-boss-card__reward--claimed' : '') + '">'
        + '<i class="fas fa-arrow-up"></i> '
        + escHtml(weeklyBoss.reward.label)
        + '</span>'
      : '';

    weeklyHtml = '<div class="bs-weekly-challenge">'
      + '<div class="bs-weekly-challenge__header">'
      + '<span class="bs-weekly-challenge__title"><i class="fas fa-calendar-week"></i> Weekly Challenge</span>'
      + '<span class="bs-weekly-challenge__timer"><i class="fas fa-clock"></i> ' + daysLeft + 'd left</span>'
      + '</div>'
      + '<div class="bs-boss-card bs-boss-card--weekly ' + (wDefeated ? 'bs-boss-card--weekly-done' : '') + '" data-boss-class="' + escHtml(weeklyBoss.class) + '">'
      + '<span class="bs-boss-card__number"><i class="fas fa-star"></i></span>'
      + (weeklyBoss.avatar
        ? '<div class="bs-boss-avatar" style="padding:0;overflow:hidden;"><img src="' + escHtml(weeklyBoss.avatar) + '" alt="' + escHtml(weeklyBoss.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
        : '<div class="bs-boss-avatar"><i class="fas ' + wIcon + '"></i></div>')
      + '<div class="bs-boss-card__info">'
      + '<div class="bs-boss-card__name">' + escHtml(weeklyBoss.name) + ' ' + wRecordBadge + '</div>'
      + '<div class="bs-boss-card__class">' + escHtml(weeklyBoss.class) + '</div>'
      + wRewardBadge
      + '<div class="bs-boss-card__flavor">"' + escHtml(weeklyBoss.flavor) + '"</div>'
      + '</div>'
      + '<div class="bs-boss-card__action">'
      + '<button class="bs-btn bs-btn--weekly" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-boss="' + weeklyBoss.id + '">'
      + (wRewardClaimed ? '<i class="fas fa-redo"></i> Replay' : '<i class="fas fa-bolt"></i> Challenge')
      + '</button>'
      + '</div>'
      + '</div>'
      + '</div>';

    var campaignBosses = _bosses.filter(function (b) { return !b.weekly && !isWeeklyBoss(b.id); });
    container.innerHTML = weeklyHtml + campaignBosses.map((boss, i) => {
      const defeated = boss.boss <= highestDefeated;
      const current = boss.boss === highestDefeated + 1;
      const locked = boss.boss > highestDefeated + 1;

      let statusClass = '';
      if (defeated) statusClass = 'bs-boss-card--defeated';
      else if (current) statusClass = 'bs-boss-card--current';
      else if (locked) statusClass = 'bs-boss-card--locked';

      const icon = BOSS_ICONS[boss.class] || 'fa-skull';
      const record = getBossRecord(boss.id);

      const connector = i < campaignBosses.length - 1
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
        <div class="bs-boss-card ${statusClass}" data-boss-class="${escHtml(boss.class)}">
          <span class="bs-boss-card__number">${boss.boss}</span>
          ${boss.avatar ? `<div class="bs-boss-avatar" style="padding:0;overflow:hidden;"><img src="${escHtml(boss.avatar)}" alt="${escHtml(boss.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>` : `<div class="bs-boss-avatar"><i class="fas ${icon}"></i></div>`}
          <div class="bs-boss-card__info">
            <div class="bs-boss-card__name">${escHtml(boss.name)} ${recordBadge}</div>
            <div class="bs-boss-card__class">${escHtml(boss.class)}</div>
            ${current ? '<span class="bs-boss-card__here"><i class="fas fa-location-dot"></i> You are here</span>' : ''}
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
        // Check weekly bosses first, then campaign bosses
        const boss = _bosses.find(b => b.id === bossId);
        if (!boss) return;

        const flavorEl = document.getElementById('bs-prefight-flavor');
        const titleEl = document.getElementById('bs-prefight-title');
        const avatarEl = document.getElementById('bs-prefight-avatar');
        if (flavorEl) flavorEl.textContent = `"${boss.flavor}"`;
        if (titleEl) titleEl.textContent = boss.name;
        if (avatarEl) {
          if (boss.avatar) {
            avatarEl.innerHTML = `<img src="${escHtml(boss.avatar)}" alt="${escHtml(boss.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            avatarEl.style.width = '96px';
            avatarEl.style.height = '96px';
          } else {
            const icon = BOSS_ICONS[boss.class] || 'fa-skull';
            avatarEl.innerHTML = `<i class="fas ${icon}"></i>`;
          }
        }

        // Populate stat comparison
        const compEl = document.getElementById('bs-prefight-comparison');
        if (compEl && _selectedCard) {
          ensureCombatStats(_selectedCard);
          const ps = _selectedCard.combatStats || {};
          const bs = boss.combatStats || {};
          const labels = [
            { key: 'str', label: 'STR', icon: 'fa-fist-raised' },
            { key: 'agi', label: 'AGI', icon: 'fa-wind' },
            { key: 'int', label: 'INT', icon: 'fa-brain' },
            { key: 'end', label: 'END', icon: 'fa-shield-alt' },
            { key: 'lck', label: 'LCK', icon: 'fa-dice' }
          ];
          compEl.innerHTML = `
            <div class="bs-prefight-comparison__header">
              <span class="bs-prefight-comparison__you">You</span>
              <span class="bs-prefight-comparison__vs">VS</span>
              <span class="bs-prefight-comparison__boss">${escHtml(boss.name)}</span>
            </div>
            ${labels.map(s => {
              const pv = ps[s.key] || 0;
              const bv = bs[s.key] || 0;
              const diff = pv - bv;
              const diffClass = diff > 0 ? 'bs-stat-advantage' : diff < 0 ? 'bs-stat-disadvantage' : 'bs-stat-even';
              return `<div class="bs-prefight-stat-row">
                <span class="bs-prefight-stat-row__pval">${pv}</span>
                <div class="bs-prefight-stat-row__bar">
                  <div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--player" style="width:${pv}%"></div>
                </div>
                <span class="bs-prefight-stat-row__label"><i class="fas ${s.icon}"></i> ${s.label}</span>
                <div class="bs-prefight-stat-row__bar">
                  <div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--boss" style="width:${bv}%"></div>
                </div>
                <span class="bs-prefight-stat-row__bval ${diffClass}">${bv}</span>
              </div>`;
            }).join('')}
          `;
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

    // Render Infinite Tower section (after Ascension 5)
    renderTowerSection();
  }

  // ============================================================
  // INFINITE TOWER
  // ============================================================

  function renderTowerSection() {
    var section = document.getElementById('bs-tower-section');
    if (!section) return;

    if (!isTowerUnlocked()) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    var currentFloor = getTowerFloor();
    var bestFloor = getTowerBest();
    var inRun = currentFloor > 0;
    var nextFloor = inRun ? currentFloor + 1 : 1;
    var nextBoss = getTowerBossForFloor(nextFloor);
    var nextBossName = nextBoss ? nextBoss.name : 'Unknown';
    var nextBossClass = nextBoss ? nextBoss.class : '';
    var nextBossIcon = BOSS_ICONS[nextBossClass] || 'fa-skull';
    var cycle = Math.floor((nextFloor - 1) / 10) + 1;

    // Upcoming milestone
    var nextMilestone = 0;
    for (var m = 5; m <= 50; m += 5) {
      if (m > (inRun ? currentFloor : 0)) { nextMilestone = m; break; }
    }
    var milestoneReward = nextMilestone ? getTowerMilestoneReward(nextMilestone) : null;

    var bestHtml = bestFloor > 0
      ? '<div class="bs-tower__best"><i class="fas fa-trophy"></i> Best: Floor ' + bestFloor + '</div>'
      : '';

    var milestoneHtml = milestoneReward
      ? '<div class="bs-tower__milestone"><i class="fas fa-gift"></i> Floor ' + nextMilestone + ': ' + escHtml(milestoneReward.label) + '</div>'
      : '';

    var floorDisplay = inRun
      ? '<div class="bs-tower__floor-display">'
        + '<span class="bs-tower__floor-num">' + currentFloor + '</span>'
        + '<span class="bs-tower__floor-label">Current Floor</span>'
        + (cycle > 1 ? '<span class="bs-tower__cycle">Cycle ' + cycle + '</span>' : '')
        + '</div>'
      : '<div class="bs-tower__floor-display">'
        + '<span class="bs-tower__floor-num"><i class="fas fa-tower-observation"></i></span>'
        + '<span class="bs-tower__floor-label">Ready to climb</span>'
        + '</div>';

    var nextBossAvatar = nextBoss && nextBoss.avatar
      ? '<img src="' + escHtml(nextBoss.avatar) + '" alt="' + escHtml(nextBossName) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
      : '<i class="fas ' + nextBossIcon + '"></i>';

    section.innerHTML = '<div class="bs-tower">'
      + '<div class="bs-tower__header">'
      + '<span class="bs-tower__title"><i class="fas fa-tower-observation"></i> Infinite Tower</span>'
      + bestHtml
      + '</div>'
      + floorDisplay
      + '<div class="bs-tower__next">'
      + '<div class="bs-tower__next-avatar">' + nextBossAvatar + '</div>'
      + '<div class="bs-tower__next-info">'
      + '<div class="bs-tower__next-label">Floor ' + nextFloor + '</div>'
      + '<div class="bs-tower__next-name">' + escHtml(nextBossName) + '</div>'
      + '<div class="bs-tower__next-class">' + escHtml(nextBossClass) + '</div>'
      + '</div>'
      + '<button class="bs-btn bs-btn--primary bs-btn--glow bs-tower__enter" id="bs-tower-enter">'
      + '<i class="fas fa-bolt"></i> ' + (inRun ? 'Continue' : 'Enter')
      + '</button>'
      + '</div>'
      + milestoneHtml
      + '<p class="bs-tower__desc">Climb as high as you can. Lose once and you fall back to Floor 1.</p>'
      + '</div>';

    document.getElementById('bs-tower-enter').addEventListener('click', function() {
      startTowerBattle();
    }, { once: true });
  }

  function startTowerBattle() {
    var currentFloor = getTowerFloor();
    var nextFloor = currentFloor > 0 ? currentFloor + 1 : 1;
    var boss = getTowerBossForFloor(nextFloor);
    if (!boss) {
      showErrorToast('No boss found for floor ' + nextFloor);
      return;
    }
    // Set tower state before battle
    _battleType = 'tower';
    _towerPendingFloor = nextFloor;

    // Show prefight overlay with tower flavor
    var flavorEl = document.getElementById('bs-prefight-flavor');
    var titleEl = document.getElementById('bs-prefight-title');
    var avatarEl = document.getElementById('bs-prefight-avatar');
    if (flavorEl) flavorEl.textContent = 'Floor ' + nextFloor + ' — "' + boss.flavor + '"';
    if (titleEl) titleEl.textContent = boss.name;
    if (avatarEl) {
      if (boss.avatar) {
        avatarEl.innerHTML = '<img src="' + escHtml(boss.avatar) + '" alt="' + escHtml(boss.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        avatarEl.style.width = '96px';
        avatarEl.style.height = '96px';
      } else {
        var icon = BOSS_ICONS[boss.class] || 'fa-skull';
        avatarEl.innerHTML = '<i class="fas ' + icon + '"></i>';
      }
    }

    // Stat comparison
    var compEl = document.getElementById('bs-prefight-comparison');
    if (compEl && _selectedCard) {
      ensureCombatStats(_selectedCard);
      var ps = _selectedCard.combatStats || {};
      var bs = boss.combatStats || {};
      var labels = [
        { key: 'str', label: 'STR', icon: 'fa-fist-raised' },
        { key: 'agi', label: 'AGI', icon: 'fa-wind' },
        { key: 'int', label: 'INT', icon: 'fa-brain' },
        { key: 'end', label: 'END', icon: 'fa-shield-alt' },
        { key: 'lck', label: 'LCK', icon: 'fa-dice' }
      ];
      compEl.innerHTML = '<div class="bs-prefight-comparison__header">'
        + '<span class="bs-prefight-comparison__you">You</span>'
        + '<span class="bs-prefight-comparison__vs">VS</span>'
        + '<span class="bs-prefight-comparison__boss">' + escHtml(boss.name) + '</span>'
        + '</div>'
        + labels.map(function(s) {
          var pv = ps[s.key] || 0;
          var bv = bs[s.key] || 0;
          var diff = pv - bv;
          var diffClass = diff > 0 ? 'bs-stat-advantage' : diff < 0 ? 'bs-stat-disadvantage' : 'bs-stat-even';
          return '<div class="bs-prefight-stat-row">'
            + '<span class="bs-prefight-stat-row__pval">' + pv + '</span>'
            + '<div class="bs-prefight-stat-row__bar">'
            + '<div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--player" style="width:' + pv + '%"></div>'
            + '</div>'
            + '<span class="bs-prefight-stat-row__label"><i class="fas ' + s.icon + '"></i> ' + s.label + '</span>'
            + '<div class="bs-prefight-stat-row__bar">'
            + '<div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--boss" style="width:' + bv + '%"></div>'
            + '</div>'
            + '<span class="bs-prefight-stat-row__bval ' + diffClass + '">' + bv + '</span>'
            + '</div>';
        }).join('');
    }

    showOverlay('bs-prefight-overlay');
    var oldBtn = document.getElementById('bs-prefight-go');
    var freshBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(freshBtn, oldBtn);
    freshBtn.addEventListener('click', async function() {
      hideOverlay('bs-prefight-overlay');
      _currentBossId = boss.id;
      _battleType = 'tower';
      if (!_isFirstRealFight) _isStrangerFight = false;
      showScreen('battle');
      if (window.ArenaAudio && window.ArenaBackgrounds) {
        window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
      }
      if (window.ArenaBackgrounds) window.ArenaBackgrounds.applyToBattleStage();
      try {
        var battleData = await window.ArenaAPI.startBattle('pve', _selectedCard.id, boss.id);
        _activeBattle = battleData;
        window.ArenaBattleUI.initBattle(battleData);
        updateCombatTooltips();
        applyBattlePalette();
      } catch (err) {
        console.error('[Blindspot] Tower battle error:', err);
        showErrorToast('Failed to start tower battle: ' + err.message);
        showScreen('campaign');
        renderCampaignLadder();
      }
    }, { once: true });
  }

  function handleTowerResult(isWin) {
    if (isWin) {
      var newFloor = _towerPendingFloor;
      setTowerFloor(newFloor);
      setTowerBest(newFloor);

      // Check milestone rewards
      var milestone = getTowerMilestoneReward(newFloor);
      if (milestone && !getTowerClaimedFloors().includes(newFloor)) {
        claimTowerFloor(newFloor);
        if (milestone.type === 'stat_bonus' && _selectedCard) {
          ensureCombatStats(_selectedCard);
          var stat = milestone.stat;
          _selectedCard.combatStats[stat] = Math.min(100, (_selectedCard.combatStats[stat] || 0) + milestone.amount);
          showSuccessToast('Floor ' + newFloor + ' milestone! ' + milestone.label);
        } else if (milestone.type === 'title') {
          setCardTitle(milestone.title);
          showSuccessToast('Floor ' + newFloor + ' milestone! ' + milestone.label);
        }
      }
    } else {
      // Tower run over — reset floor
      var reachedFloor = getTowerFloor();
      setTowerFloor(0);
      showErrorToast('Tower run ended at Floor ' + (reachedFloor || _towerPendingFloor) + '. Best: Floor ' + getTowerBest());
    }
    _towerPendingFloor = 0;
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
      updateCombatTooltips();
      applyBattlePalette();
    } catch (err) {
      console.error('[Blindspot] Campaign battle error:', err);
      if (err.message && err.message.includes('not found')) {
        // Card doesn't exist on server — try reloading before giving up
        console.warn('[Blindspot] Card not found, attempting recovery...');
        try {
          const recoveryCards = await loadUserCards();
          if (recoveryCards.length > 0) {
            _selectedCard = recoveryCards[0];
            ensureCombatStats(_selectedCard);
            showErrorToast('Card reloaded. Try again.');
            showScreen('lobby');
            renderLobby();
            return;
          }
        } catch (recoveryErr) {
          console.warn('[Blindspot] Recovery failed:', recoveryErr);
        }
        // Final fallback — rebuild card
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
    playSfx(isWin ? 'battleWin' : 'battleLoss');

    // Track boss record
    if (_battleType === 'pve' && _currentBossId) {
      recordBossResult(_currentBossId, isWin);
      // Track weekly boss separately
      var weeklyBoss = getWeeklyBoss();
      if (weeklyBoss && _currentBossId === weeklyBoss.id) {
        recordWeeklyResult(isWin);
      }
    }

    // PvP Elo update
    if (_battleType === 'pvp') {
      var opponent = _pvpGallery.find(function(c) { return c.id === _pvpOpponentId; });
      var oppElo = opponent ? estimateOpponentElo(opponent) : ELO_DEFAULT;
      var playerElo = getPvPElo();
      var oldRank = getPvPRank(playerElo);
      var eloChange = calcEloChange(playerElo, oppElo, isWin);
      var newElo = Math.max(0, playerElo + eloChange);
      setPvPElo(newElo);
      var rec = getPvPRecord();
      if (isWin) rec.w++; else rec.l++;
      setPvPRecord(rec);
      var newRank = getPvPRank(newElo);
      // Show Elo change toast
      var sign = eloChange >= 0 ? '+' : '';
      var eloColor = eloChange >= 0 ? 'var(--bs-accent)' : 'var(--bs-danger, #ff5252)';
      showEloChange(sign + eloChange, eloColor, oldRank.name !== newRank.name ? newRank : null);

      // Update results modal with Elo info
      var xpSection = document.getElementById('arena-results-xp-section');
      if (xpSection) {
        var xpAmtEl = document.getElementById('arena-results-xp');
        if (xpAmtEl) xpAmtEl.innerHTML = '<span style="color:' + eloColor + ';">' + sign + eloChange + ' Elo</span>';
        var rankLabel = document.getElementById('arena-results-rank-label');
        if (rankLabel) {
          rankLabel.innerHTML =
            '<span style="color:' + oldRank.color + ';"><i class="fas ' + oldRank.icon + '"></i> ' + oldRank.name + '</span>' +
            ' <i class="fas fa-arrow-right" style="color:var(--bs-text-muted);margin:0 0.3rem;"></i> ' +
            '<span style="color:' + newRank.color + ';"><i class="fas ' + newRank.icon + '"></i> ' + newRank.name + ' (' + newElo + ')</span>';
        }
        // Show progress to next PvP rank instead of XP bar
        var barFill = document.getElementById('arena-results-xp-fill');
        var barText = document.getElementById('arena-results-xp-text');
        var pvpNextRank = PVP_RANKS[PVP_RANKS.indexOf(newRank) + 1];
        if (barFill && barText && pvpNextRank) {
          var pvpPct = Math.min(100, Math.max(0, ((newElo - newRank.min) / (pvpNextRank.min - newRank.min)) * 100));
          barFill.style.width = pvpPct + '%';
          barFill.style.background = newRank.color;
          barText.textContent = newElo + ' / ' + pvpNextRank.min + ' Elo';
        } else if (barFill && barText) {
          barFill.style.width = '100%';
          barFill.style.background = newRank.color;
          barText.textContent = newElo + ' Elo — Max Rank!';
        }
        // Rank up notification
        var rankUpEl = document.getElementById('arena-results-rank-up');
        var newRankEl = document.getElementById('arena-results-new-rank');
        if (oldRank.name !== newRank.name && eloChange > 0) {
          if (rankUpEl) rankUpEl.style.display = 'block';
          if (newRankEl) newRankEl.textContent = newRank.name;
        }
      }
    }

    loadProfile().then(() => updateRankDisplay());

    // Win streak tracking
    if (isWin) {
      incrementTotalWins();
      const newStreak = getWinStreak() + 1;
      setWinStreak(newStreak);
      setBestStreak(newStreak);

      // Loot choice — pick 1 of 3 rewards
      const lootOptions = [rollLoot(), rollLoot(), rollLoot()];
      const usedStats = new Set();
      lootOptions.forEach((l, i) => {
        if (l.stat && usedStats.has(l.stat)) {
          const available = ['str','agi','int','end','lck'].filter(s => !usedStats.has(s));
          if (available.length > 0) {
            const newStat = available[Math.floor(Math.random() * available.length)];
            lootOptions[i] = { ...l, stat: newStat, label: '+' + l.amount + ' ' + newStat.toUpperCase() };
          }
        }
        if (l.stat) usedStats.add(l.stat);
      });
      showLootChoice(lootOptions);

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

    // Infinite Tower results
    if (_battleType === 'tower') {
      handleTowerResult(isWin);
      // Override button labels for tower
      var tAgainBtn = document.getElementById('arena-results-again');
      var tLobbyBtn = document.getElementById('arena-results-lobby');
      if (isWin) {
        if (tAgainBtn) tAgainBtn.textContent = 'Next Floor';
        if (tLobbyBtn) tLobbyBtn.textContent = 'Exit Tower';
      } else {
        if (tAgainBtn) tAgainBtn.textContent = 'Try Again';
        if (tLobbyBtn) tLobbyBtn.textContent = 'Exit Tower';
      }
      var tTitleEl = document.getElementById('arena-results-title');
      var tSubEl = document.getElementById('arena-results-subtitle');
      if (isWin) {
        var clearedFloor = getTowerFloor();
        if (tTitleEl) tTitleEl.textContent = 'Floor ' + clearedFloor + ' Cleared';
        if (tSubEl) tSubEl.textContent = 'The tower stretches higher...';
      } else {
        if (tTitleEl) tTitleEl.textContent = 'Tower Run Over';
        if (tSubEl) tSubEl.textContent = 'You reached Floor ' + getTowerBest() + ' at your best.';
      }
      showForgeProgressInResults();
      return;
    }

    if (_battleType === 'pve' && isWin) {
      const boss = _bosses.find(b => b.id === _currentBossId);
      const prevHighest = getHighestBossDefeated();
      const isWeekly = isWeeklyBoss(_currentBossId);
      const isNewBossDefeat = !isWeekly && boss && boss.boss > prevHighest;

      if (boss && !isWeekly) setHighestBossDefeated(boss.boss);

      // Forge wins on NEW boss defeats + bonus for streaks
      if (isNewBossDefeat) {
        let forgeGain = 1;
        if (getWinStreak() >= 5) forgeGain = 2; // Streak bonus
        setForgeWins(getForgeWins() + forgeGain);
      }

      // Weekly boss: award stat reward + 2 forge wins on first weekly win
      if (isWeekly && !isWeeklyRewardClaimed()) {
        playSfx('bossDefeat');
        setForgeWins(getForgeWins() + 2);
        const reward = await applyBossReward(boss);
        if (reward) {
          showRewardDrop(reward, boss);
        }
      }

      // Play boss defeat fanfare on new boss kills
      if (isNewBossDefeat) playSfx('bossDefeat');

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
          const asc = getAscension();
          if (asc > 0) {
            // Already ascended before — offer ascension again
            showAscensionOffer(asc);
          } else {
            showOverlay('bs-architect-win');
          }
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
      if (subtitleEl) {
        const boss = _bosses.find(b => b.id === _currentBossId);
        const tips = {
          'Enforcer': 'Enforcers guard often. Use Ability to break through.',
          'Fighter': 'Fighters strike hard. Guard or Counter their attacks.',
          'Scout': 'Scouts are fast. High AGI lets them dodge. Use abilities.',
          'Hacker': 'Hackers use abilities frequently. Guard when they charge up.',
          'Berserker': 'Berserkers are all-in on strikes. Counter destroys them.',
          'Scholar': 'Scholars mix heals and abilities. Pressure them with strikes.',
          'Guardian': 'Guardians are tanks. Chip away with abilities, not strikes.',
          'Trickster': 'Tricksters are unpredictable. Watch their pattern and adapt.',
          'Caster': 'Casters hit hard with abilities. Guard when they have charges.'
        };
        const tip = boss ? (tips[boss.class] || 'Your card remembers.') : 'Your card remembers.';
        subtitleEl.textContent = tip;
      }
    }

    // Session stats panel
    renderSessionStats();
  }

  // ============================================================
  // PVP
  // ============================================================

  async function renderPvPGallery() {
    const container = document.getElementById('bs-pvp-grid');
    if (!container) return;

    // Render Elo rating header
    updatePvPRatingDisplay();

    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> Loading gallery...</div>';

    try {
      let data;
      try {
        data = await Promise.race([
          window.ArenaAPI.loadCards(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT))
        ]);
      } catch (timeoutErr) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">Could not load leaderboard. Try again later.</p>';
        return;
      }
      const gallery = data.galleryCards || [];

      if (gallery.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">No challengers available yet. Publish your card in CardForge to appear here.</p>';
        return;
      }

      _pvpGallery = gallery;
      container.innerHTML = gallery.map(card => {
        var oppElo = estimateOpponentElo(card);
        var oppRank = getPvPRank(oppElo);
        return `
        <div class="bs-boss-card" style="cursor:pointer;">
          <div class="bs-boss-avatar" style="width:36px;height:36px;font-size:0.9rem;">
            ${card.avatar ? `<img src="${escHtml(card.avatar)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-user"></i>'}
          </div>
          <div class="bs-boss-card__info">
            <div class="bs-boss-card__name">${escHtml(card.name || 'Unnamed')}</div>
            <div class="bs-boss-card__class">${escHtml(card.class || '')} <span class="bs-pvp-opp-elo" style="color:${oppRank.color};"><i class="fas ${oppRank.icon}"></i> ${oppElo}</span></div>
          </div>
          <div class="bs-boss-card__action">
            <button class="bs-btn" style="padding:0.5rem 1rem; font-size:0.8rem;" data-fight-pvp="${card.id}">Challenge</button>
          </div>
        </div>`;
      }).join('');

      container.querySelectorAll('[data-fight-pvp]').forEach(btn => {
        btn.addEventListener('click', () => startPvPBattle(btn.dataset.fightPvp));
      });
    } catch (err) {
      container.innerHTML = '<p style="text-align:center; color:var(--bs-danger);">Failed to load gallery.</p>';
    }
  }

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
      progressHtml = `<div class="bs-pvp-progress"><div class="bs-pvp-progress__fill" style="width:${pct}%;background:${rank.color};"></div></div>
        <span class="bs-pvp-next">${nextRank.name} at ${nextRank.min}</span>`;
    }
    el.innerHTML = `
      <div class="bs-pvp-rank-badge" style="color:${rank.color};">
        <i class="fas ${rank.icon}"></i> ${rank.name}
      </div>
      <div class="bs-pvp-elo">${elo} Elo</div>
      <div class="bs-pvp-record">${rec.w}W / ${rec.l}L</div>
      ${progressHtml}
    `;
  }

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

  async function startPvPBattle(opponentId) {
    if (!_selectedCard) return;
    _currentBossId = null;
    _battleType = 'pvp';
    _pvpOpponentId = opponentId;

    // Find opponent info from gallery
    var opponent = _pvpGallery.find(function(c) { return c.id === opponentId; }) || {};
    var playerName = _selectedCard.name || 'You';
    var playerAvatar = _selectedCard.avatar || '';
    var oppName = opponent.name || 'Challenger';
    var oppAvatar = opponent.avatar || '';
    var oppClass = opponent.class || '';

    // Create matchmaking overlay
    document.querySelector('.bs-matchmaking')?.remove();
    var overlay = document.createElement('div');
    overlay.className = 'bs-overlay bs-matchmaking';
    overlay.innerHTML =
      '<div class="bs-mm-content">' +
        '<div class="bs-mm-vs-row">' +
          '<div class="bs-mm-fighter bs-mm-fighter--left">' +
            (playerAvatar ? '<img src="' + escHtml(playerAvatar) + '" alt="" class="bs-mm-fighter__img">' : '<div class="bs-mm-fighter__icon"><i class="fas fa-user"></i></div>') +
            '<span class="bs-mm-fighter__name">' + escHtml(playerName) + '</span>' +
          '</div>' +
          '<div class="bs-mm-vs">' +
            '<div class="bs-mm-scanner"><div class="bs-spinner" style="width:28px;height:28px;border-width:3px;"></div></div>' +
            '<span class="bs-mm-vs__text">VS</span>' +
          '</div>' +
          '<div class="bs-mm-fighter bs-mm-fighter--right bs-mm-fighter--hidden">' +
            (oppAvatar ? '<img src="' + escHtml(oppAvatar) + '" alt="" class="bs-mm-fighter__img">' : '<div class="bs-mm-fighter__icon"><i class="fas fa-skull"></i></div>') +
            '<span class="bs-mm-fighter__name">' + escHtml(oppName) + '</span>' +
            (oppClass ? '<span class="bs-mm-fighter__class">' + escHtml(oppClass) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<p class="bs-mm-status">Searching for opponent<span class="bs-mm-dots"></span></p>' +
      '</div>';
    document.body.appendChild(overlay);

    // Animate: searching → reveal → fight
    requestAnimationFrame(function() { overlay.classList.add('bs-matchmaking--active'); });

    if (window.ArenaAudio && window.ArenaBackgrounds) {
      window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
    }

    // Start the API call in background while showing animation
    var battlePromise = window.ArenaAPI.startBattle('pvp', _selectedCard.id, opponentId);

    // After 1.5s, reveal opponent
    await new Promise(function(r) { setTimeout(r, 1500); });
    var rightFighter = overlay.querySelector('.bs-mm-fighter--right');
    if (rightFighter) rightFighter.classList.remove('bs-mm-fighter--hidden');
    var scanner = overlay.querySelector('.bs-mm-scanner');
    if (scanner) scanner.style.display = 'none';
    var vsText = overlay.querySelector('.bs-mm-vs__text');
    if (vsText) vsText.classList.add('bs-mm-vs__text--visible');
    var statusEl = overlay.querySelector('.bs-mm-status');
    if (statusEl) statusEl.textContent = 'Opponent found!';

    // Wait another 1.5s for reveal to land
    await new Promise(function(r) { setTimeout(r, 1500); });

    try {
      var battleData = await battlePromise;
      _activeBattle = battleData;
      // Fade out overlay, show battle
      overlay.classList.add('bs-matchmaking--exit');
      setTimeout(function() { overlay.remove(); }, 400);
      showScreen('battle');
      window.ArenaBattleUI.initBattle(battleData);
      updateCombatTooltips();
    } catch (err) {
      console.error('[Blindspot] PvP error:', err);
      overlay.remove();
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
      { key: 'str', label: 'STR', desc: 'Strike: 40-50% as dmg', color: '#ff5252', icon: 'fa-hand-fist' },
      { key: 'agi', label: 'AGI', desc: 'Turn order + dodge',    color: '#00e676', icon: 'fa-feather-pointed' },
      { key: 'int', label: 'INT', desc: 'Ability damage',        color: '#7b2fff', icon: 'fa-bolt' },
      { key: 'end', label: 'END', desc: 'Heal: 30-40% as HP',   color: '#ff9100', icon: 'fa-heart' },
      { key: 'lck', label: 'LCK', desc: 'Crit chance (5%+)',    color: '#ffd740', icon: 'fa-clover' }
    ];

    const totalBefore = Object.values(currentStats).reduce((a, b) => a + b, 0);
    const respecCost = _config ? _config.forgeVisit.winsRequired : 3;
    let _respecActive = false;

    // Visual options for Look tab
    const PALETTES = [
      { id: 'earth', label: 'Earth', key: 'palette_earth', unlock: 'Default' },
      { id: 'ocean', label: 'Ocean', key: 'palette_ocean', unlock: 'Beat Boss 2' },
      { id: 'neon', label: 'Neon', key: 'palette_neon', unlock: 'Beat Boss 4' },
      { id: 'fire', label: 'Fire', key: 'palette_fire', unlock: 'Beat Boss 8' },
      { id: 'monochrome', label: 'Mono', key: 'palette_earth', unlock: 'Default' },
      { id: 'sunset', label: 'Sunset', key: 'palette_earth', unlock: 'Default' },
      { id: 'inferno', label: 'Inferno', key: 'palette_inferno', unlock: 'Ascension 1' },
      { id: 'frost', label: 'Frost', key: 'palette_frost', unlock: 'Ascension 2' }
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
          <div class="bs-forge-card" data-palette="${_selectedCard.palette || 'earth'}" data-container="${_selectedCard.imageContainer || 'masked'}">
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
          ${getForgeWins() >= respecCost ? `<button class="bs-btn bs-btn--small" id="bs-forge-respec" style="margin-left:auto; font-size:0.65rem; padding:0.2rem 0.5rem;" title="Reset all stats and redistribute (costs ${respecCost} forge wins)"><i class="fas fa-rotate"></i> Respec</button>` : `<span id="bs-forge-respec-locked" style="margin-left:auto; font-size:0.6rem; color:var(--bs-text-muted); cursor:help;" title="Need ${respecCost} forge wins to respec"><i class="fas fa-lock"></i> Respec (${getForgeWins()}/${respecCost})</span>`}
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
            ${PALETTES.map(p => `<button class="bs-forge-option ${uv.includes(p.key) ? '' : 'bs-forge-option--locked'}" data-palette="${p.id}" ${uv.includes(p.key) ? '' : 'disabled'} title="${uv.includes(p.key) ? p.label : p.unlock}">${uv.includes(p.key) ? p.label : '<i class="fas fa-lock"></i> ' + p.unlock}</button>`).join('')}
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

    function getPool() {
      return _respecActive ? totalBefore + bonusPoints : bonusPoints;
    }

    function updateBudget() {
      const totalAllocated = Object.values(allocations).reduce((a, b) => a + b, 0);
      const pool = getPool();
      const remaining = pool - totalAllocated;
      if (remainingEl) remainingEl.textContent = remaining;
      const newTotal = _respecActive ? totalAllocated : totalBefore + totalAllocated;
      if (totalEl) totalEl.textContent = newTotal;
      if (previewPowerEl) previewPowerEl.innerHTML = `<i class="fas fa-bolt"></i> ${newTotal} Power`;
      // Enable forge if all points spent OR if any visual/detail change was made
      if (applyBtn) applyBtn.disabled = !(remaining === 0 || _hasVisualChange);
    }

    function activateRespec() {
      _respecActive = true;
      // Deduct forge wins for respec cost
      setForgeWins(getForgeWins() - respecCost);
      // Reset all allocations and sliders to 0
      statDefs.forEach(d => {
        allocations[d.key] = 0;
        const slider = panel.querySelector(`.bs-forge-stat__slider[data-stat="${d.key}"]`);
        if (slider) { slider.min = 0; slider.value = 0; }
        const display = panel.querySelector(`.bs-forge-stat__value[data-stat="${d.key}"]`);
        if (display) { display.textContent = '0'; display.style.color = 'var(--bs-accent)'; }
        const base = slider?.parentElement?.querySelector('.bs-forge-stat__base');
        if (base) { base.textContent = '0'; }
      });
      // Update respec button to show active state
      const respecBtn = document.getElementById('bs-forge-respec');
      if (respecBtn) {
        respecBtn.innerHTML = '<i class="fas fa-rotate"></i> Respec ON';
        respecBtn.disabled = true;
        respecBtn.style.background = 'var(--bs-accent)';
        respecBtn.style.color = 'var(--bs-bg)';
      }
      updateBudget();
      showSuccessToast(`Respec active! Redistribute ${totalBefore + bonusPoints} points.`);
    }

    panel.querySelectorAll('.bs-forge-stat__slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.stat;
        const base = _respecActive ? 0 : currentStats[key];
        const desiredAllocation = parseInt(slider.value, 10) - base;
        const totalOther = Object.entries(allocations).reduce((sum, [k, v]) => k === key ? sum : sum + v, 0);
        const pool = getPool();
        const maxAllocation = pool - totalOther;
        const clamped = Math.min(Math.max(0, desiredAllocation), maxAllocation);
        const clampedVal = base + clamped;

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

    // Respec button
    document.getElementById('bs-forge-respec')?.addEventListener('click', () => {
      if (_respecActive) return;
      if (!confirm(`Respec costs ${respecCost} forge wins. Reset all stats and redistribute?`)) return;
      activateRespec();
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

    // Flash preview card after visual change (sticky keeps it visible on mobile)
    function flashPreview() {
      const previewCard = panel.querySelector('.bs-forge-card');
      if (!previewCard) return;
      previewCard.style.transition = 'box-shadow 0.3s ease';
      previewCard.style.boxShadow = '0 0 20px var(--bs-accent)';
      setTimeout(() => { previewCard.style.boxShadow = ''; }, 800);
    }

    // Look tab: palette selection — only target option buttons, not the preview card itself
    panel.querySelectorAll('.bs-forge-option[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.bs-forge-option[data-palette]').forEach(b => b.classList.remove('bs-forge-option--selected'));
        btn.classList.add('bs-forge-option--selected');
        // Live update preview card palette
        const previewCard = panel.querySelector('.bs-forge-card');
        if (previewCard) previewCard.setAttribute('data-palette', btn.dataset.palette);
        _hasVisualChange = true;
        updateBudget();
        flashPreview();
      });
    });

    // Look tab: container selection — only target option buttons
    panel.querySelectorAll('.bs-forge-option[data-container]').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.bs-forge-option[data-container]').forEach(b => b.classList.remove('bs-forge-option--selected'));
        btn.classList.add('bs-forge-option--selected');
        // Live update preview card container
        const previewCard = panel.querySelector('.bs-forge-card');
        if (previewCard) previewCard.setAttribute('data-container', btn.dataset.container);
        _hasVisualChange = true;
        updateBudget();
        flashPreview();
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
      statDefs.forEach(d => { newStats[d.key] = (_respecActive ? 0 : currentStats[d.key]) + allocations[d.key]; });

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

        // Deduct forge wins: respec costs extra wins on top of the normal reset
        if (_respecActive) {
          setForgeWins(Math.max(0, getForgeWins() - respecCost));
        } else {
          setForgeWins(0);
        }
        localStorage.removeItem('bs-forge-pending');
        incForgeVisitCount();
        hideOverlay('bs-forge-screen');
        updateForgeProgress();
        renderLobby();
        completeBounty('forgeVisit');
        playSfx('forgeComplete');
        showSuccessToast(_respecActive ? 'Card respecced!' : 'Card evolved!');
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
  // CHALLENGES — persistent milestones for replayability
  // ============================================================

  const CHALLENGES = [
    { id: 'wins', name: 'Warrior', icon: 'fa-sword',
      desc: ['Win 10 fights', 'Win 25 fights', 'Win 50 fights'],
      target: [10, 25, 50],
      reward: [
        { stat: 'str', amount: 3, label: '+3 STR' },
        { stat: 'str', amount: 5, label: '+5 STR' },
        { forgeWins: 2, label: '+2 Forge Wins' }
      ]
    },
    { id: 'bosses', name: 'Slayer', icon: 'fa-dragon',
      desc: ['Defeat 3 bosses', 'Defeat 7 bosses', 'Defeat all 10 bosses'],
      target: [3, 7, 10],
      reward: [
        { stat: 'end', amount: 3, label: '+3 END' },
        { stat: 'end', amount: 5, label: '+5 END' },
        { forgeWins: 3, label: '+3 Forge Wins' }
      ]
    },
    { id: 'streak', name: 'Unstoppable', icon: 'fa-fire-flame-curved',
      desc: ['Get a 3 win streak', 'Get a 5 win streak', 'Get a 10 win streak'],
      target: [3, 5, 10],
      reward: [
        { stat: 'agi', amount: 3, label: '+3 AGI' },
        { stat: 'agi', amount: 5, label: '+5 AGI' },
        { stat: 'lck', amount: 8, label: '+8 LCK' }
      ]
    },
    { id: 'forge', name: 'Artisan', icon: 'fa-fire',
      desc: ['Visit the Forge 3 times', 'Visit the Forge 5 times', 'Visit the Forge 10 times'],
      target: [3, 5, 10],
      reward: [
        { stat: 'int', amount: 3, label: '+3 INT' },
        { forgeWins: 1, label: '+1 Forge Win' },
        { stat: 'int', amount: 8, label: '+8 INT' }
      ]
    },
    { id: 'ascension', name: 'Transcendent', icon: 'fa-star',
      desc: ['Reach Ascension 1', 'Reach Ascension 3', 'Reach Ascension 5'],
      target: [1, 3, 5],
      reward: [
        { stat: 'lck', amount: 5, label: '+5 LCK' },
        { forgeWins: 3, label: '+3 Forge Wins' },
        { stat: 'str', amount: 10, label: '+10 STR' }
      ]
    },
    { id: 'pvp', name: 'Gladiator', icon: 'fa-users',
      desc: ['Win 3 PvP fights', 'Win 10 PvP fights', 'Reach Gold PvP rank'],
      target: [3, 10, 'gold'],
      reward: [
        { stat: 'agi', amount: 3, label: '+3 AGI' },
        { stat: 'str', amount: 5, label: '+5 STR' },
        { forgeWins: 3, label: '+3 Forge Wins' }
      ]
    },
    { id: 'bounties', name: 'Completionist', icon: 'fa-scroll',
      desc: ['Complete 3 daily bounties', 'Complete 10 daily bounties', 'Complete 25 daily bounties'],
      target: [3, 10, 25],
      reward: [
        { stat: 'end', amount: 3, label: '+3 END' },
        { stat: 'lck', amount: 5, label: '+5 LCK' },
        { forgeWins: 2, label: '+2 Forge Wins' }
      ]
    },
    { id: 'power', name: 'Powerhouse', icon: 'fa-bolt',
      desc: ['Reach 200 Power', 'Reach 300 Power', 'Reach 400 Power'],
      target: [200, 300, 400],
      reward: [
        { stat: 'end', amount: 3, label: '+3 END' },
        { stat: 'int', amount: 5, label: '+5 INT' },
        { stat: 'str', amount: 8, label: '+8 STR' }
      ]
    }
  ];

  function getChallengeProgress() {
    try { return JSON.parse(localStorage.getItem('bs-challenges') || '{}'); }
    catch (e) { return {}; }
  }

  function saveChallengeProgress(data) {
    localStorage.setItem('bs-challenges', JSON.stringify(data));
  }

  function getChallengeCurrentValue(ch) {
    switch (ch.id) {
      case 'wins': return parseInt(localStorage.getItem('bs-total-wins') || '0', 10);
      case 'bosses': return getHighestBossDefeated();
      case 'streak': return getBestStreak();
      case 'forge': return getForgeVisitCount();
      case 'ascension': return getAscension();
      case 'pvp': return 'special'; // handled in tier check
      case 'bounties': return parseInt(localStorage.getItem('bs-total-bounties') || '0', 10);
      case 'power': return _selectedCard ? getCardPower(_selectedCard) : 0;
    }
    return 0;
  }

  function getChallengeClaimedTier(chId) {
    var data = getChallengeProgress();
    return data[chId] || 0; // 0=none, 1=bronze, 2=silver, 3=gold
  }

  function getChallengeTierReached(ch) {
    var val = getChallengeCurrentValue(ch);
    if (ch.id === 'pvp') {
      var rec = getPvPRecord();
      var elo = getPvPElo();
      var pvpRank = getPvPRank(elo);
      // Tier 1: 3 PvP wins
      if (rec.w < 3) return 0;
      // Tier 2: 10 PvP wins
      if (rec.w < 10) return 1;
      // Tier 3: Gold PvP rank
      var rankNames = PVP_RANKS.map(function(r) { return r.name; });
      var goldIdx = rankNames.indexOf('Gold');
      var curIdx = PVP_RANKS.indexOf(pvpRank);
      if (curIdx >= goldIdx) return 3;
      return 2;
    }
    for (var t = ch.target.length - 1; t >= 0; t--) {
      if (val >= ch.target[t]) return t + 1;
    }
    return 0;
  }

  async function checkAndClaimChallenges() {
    var data = getChallengeProgress();
    var newClaims = [];
    CHALLENGES.forEach(function(ch) {
      var reached = getChallengeTierReached(ch);
      var claimed = data[ch.id] || 0;
      while (claimed < reached) {
        claimed++;
        var tierIdx = claimed - 1;
        var reward = ch.reward[tierIdx];
        if (reward) {
          newClaims.push({ challenge: ch, tier: claimed, reward: reward });
        }
      }
      if (claimed > (data[ch.id] || 0)) {
        data[ch.id] = claimed;
      }
    });
    saveChallengeProgress(data);

    // Grant rewards
    for (var i = 0; i < newClaims.length; i++) {
      var claim = newClaims[i];
      var r = claim.reward;
      if (r.stat && r.amount && _selectedCard && _selectedCard.combatStats) {
        var oldVal = _selectedCard.combatStats[r.stat] || 0;
        _selectedCard.combatStats[r.stat] = Math.min(100, oldVal + r.amount);
        try {
          var cardToSave = Object.assign({}, _selectedCard);
          cardToSave.stats = [
            { name: 'Strength', value: cardToSave.combatStats.str },
            { name: 'Agility', value: cardToSave.combatStats.agi },
            { name: 'Intelligence', value: cardToSave.combatStats.int },
            { name: 'Endurance', value: cardToSave.combatStats.end },
            { name: 'Luck', value: cardToSave.combatStats.lck }
          ];
          var url = window.buildApiPath('saveCard');
          var headers = { 'Content-Type': 'application/json' };
          var authHeaders = await window.ArenaAPI.getPrincipalHeader();
          Object.assign(headers, authHeaders);
          var csrfMeta = document.querySelector('meta[name="csrf-token"]');
          if (csrfMeta && csrfMeta.content) headers['X-CSRF-Token'] = csrfMeta.content;
          fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(cardToSave) });
        } catch (e) {
          console.warn('[Blindspot] Challenge stat save error:', e);
          _selectedCard.combatStats[r.stat] = oldVal;
        }
      }
      if (r.forgeWins) {
        setForgeWins(getForgeWins() + r.forgeWins);
      }
      var tierNames = ['Bronze', 'Silver', 'Gold'];
      showSuccessToast(claim.challenge.name + ' ' + tierNames[claim.tier - 1] + '! ' + r.label);
    }
    return newClaims.length > 0;
  }

  function incrementTotalWins() {
    var v = parseInt(localStorage.getItem('bs-total-wins') || '0', 10);
    localStorage.setItem('bs-total-wins', String(v + 1));
  }

  function incrementTotalBounties() {
    var v = parseInt(localStorage.getItem('bs-total-bounties') || '0', 10);
    localStorage.setItem('bs-total-bounties', String(v + 1));
  }

  function renderChallenges() {
    var el = document.getElementById('bs-challenges');
    if (!el) return;

    var data = getChallengeProgress();
    var totalTiers = CHALLENGES.length * 3;
    var claimedTiers = 0;
    CHALLENGES.forEach(function(ch) { claimedTiers += (data[ch.id] || 0); });

    var tierColors = ['#CD7F32', '#C0C0C0', '#FFD700'];
    var tierNames = ['Bronze', 'Silver', 'Gold'];

    var rows = CHALLENGES.map(function(ch) {
      var claimed = data[ch.id] || 0;
      var reached = getChallengeTierReached(ch);
      var currentVal = getChallengeCurrentValue(ch);
      var nextTier = Math.min(claimed + 1, 3);
      var nextIdx = nextTier - 1;
      var isComplete = claimed >= 3;

      // Progress bar to next tier
      var pct = 0;
      var progressLabel = '';
      if (isComplete) {
        pct = 100;
        progressLabel = 'Complete!';
      } else if (ch.id === 'pvp') {
        var rec = getPvPRecord();
        if (nextTier === 1) { pct = Math.min(100, (rec.w / 3) * 100); progressLabel = rec.w + '/3 wins'; }
        else if (nextTier === 2) { pct = Math.min(100, (rec.w / 10) * 100); progressLabel = rec.w + '/10 wins'; }
        else { var elo = getPvPElo(); pct = Math.min(100, (elo / 1300) * 100); progressLabel = elo + '/1300 Elo'; }
      } else {
        var target = ch.target[nextIdx];
        if (typeof currentVal === 'number' && typeof target === 'number') {
          pct = Math.min(100, (currentVal / target) * 100);
          progressLabel = currentVal + '/' + target;
        }
      }

      // Tier pips
      var pips = '';
      for (var t = 0; t < 3; t++) {
        var pipClass = t < claimed ? 'bs-challenge-pip--claimed' : (t < reached ? 'bs-challenge-pip--ready' : '');
        pips += '<span class="bs-challenge-pip ' + pipClass + '" style="' + (t < claimed ? 'color:' + tierColors[t] : '') + '"><i class="fas ' + (t < claimed ? 'fa-star' : 'fa-circle') + '" aria-hidden="true"></i></span>';
      }

      return '<div class="bs-challenge ' + (isComplete ? 'bs-challenge--done' : '') + '" role="listitem">' +
        '<div class="bs-challenge__icon"><i class="fas ' + ch.icon + '" aria-hidden="true"></i></div>' +
        '<div class="bs-challenge__info">' +
          '<div class="bs-challenge__name">' + ch.name + '</div>' +
          '<div class="bs-challenge__desc">' + (isComplete ? 'All tiers complete' : escHtml(ch.desc[nextIdx])) + '</div>' +
          '<div class="bs-challenge__bar"><div class="bs-challenge__bar-fill" style="width:' + pct + '%;"></div></div>' +
          '<div class="bs-challenge__progress">' + progressLabel +
            (!isComplete && ch.reward[nextIdx] ? ' <span class="bs-challenge__reward">' + escHtml(ch.reward[nextIdx].label) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="bs-challenge__pips">' + pips + '</div>' +
      '</div>';
    }).join('');

    el.innerHTML =
      '<div class="bs-challenges__header" id="bs-challenges-toggle">' +
        '<span><i class="fas fa-trophy" aria-hidden="true"></i> Challenges</span>' +
        '<span class="bs-challenges__count" aria-label="' + claimedTiers + ' of ' + totalTiers + ' tiers complete">' + claimedTiers + '/' + totalTiers + '</span>' +
      '</div>' +
      '<div class="bs-challenges__list" id="bs-challenges-list" role="list">' + rows + '</div>';

    el.style.display = '';

    // Toggle collapse
    var toggle = document.getElementById('bs-challenges-toggle');
    var list = document.getElementById('bs-challenges-list');
    if (toggle && list) {
      // Restore collapse state
      var collapsed = localStorage.getItem('bs-challenges-collapsed') === 'true';
      if (collapsed) list.style.display = 'none';
      toggle.style.cursor = 'pointer';
      toggle.onclick = function() {
        var isHidden = list.style.display === 'none';
        list.style.display = isHidden ? '' : 'none';
        localStorage.setItem('bs-challenges-collapsed', isHidden ? 'false' : 'true');
      };
    }
  }

  // ============================================================
  // DAILY BOUNTIES
  // ============================================================

  const BOUNTY_POOL = [
    { id: 'win_3_streak', text: 'Win 3 fights in a row', check: 'streak3', reward: { xp: 25, stat: 'str', amount: 3, label: '+25 XP, +3 STR' } },
    { id: 'beat_new_boss', text: 'Defeat a new boss', check: 'newBoss', reward: { xp: 50, label: '+50 XP' } },
    { id: 'play_3', text: 'Play 3 fights today', check: 'play3', reward: { xp: 15, forgePoints: 1, label: '+15 XP, +1 Forge' } },
    { id: 'win_2', text: 'Win 2 fights today', check: 'win2', reward: { xp: 20, stat: 'agi', amount: 2, label: '+20 XP, +2 AGI' } },
    { id: 'forge_card', text: 'Visit the Forge', check: 'forgeVisit', reward: { xp: 10, label: '+10 XP' } }
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

  async function completeBounty(checkType) {
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
    if (completed) {
      incrementTotalBounties();
      // Grant bounty rewards
      const completedBounty = data.bounties.find(b => b.check === checkType && b.done);
      if (completedBounty && completedBounty.reward) {
        const r = completedBounty.reward;
        if (r.stat && r.amount && _selectedCard && _selectedCard.combatStats) {
          const oldVal = _selectedCard.combatStats[r.stat] || 0;
          _selectedCard.combatStats[r.stat] = Math.min(100, oldVal + r.amount);
          // Persist bounty stat reward to server
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
            fetch(url, { method: 'POST', headers, body: JSON.stringify(cardToSave) });
          } catch (saveErr) {
            console.warn('[Blindspot] Bounty stat save error:', saveErr);
            _selectedCard.combatStats[r.stat] = oldVal;
          }
        }
        if (r.forgePoints) {
          setForgeWins(getForgeWins() + r.forgePoints);
        }
        showSuccessToast('Bounty complete! ' + r.label);
      } else {
        showSuccessToast('Bounty complete!');
      }
    }
    return completed;
  }

  function renderBounties() {
    const el = document.getElementById('bs-bounties');
    if (!el) return;

    const data = getDailyBounties();
    const doneCount = data.bounties.filter(b => b.done).length;

    el.innerHTML = `
      <div class="bs-bounties__header">
        <span><i class="fas fa-scroll" aria-hidden="true"></i> Daily Bounties</span>
        <span class="bs-bounties__count" aria-label="${doneCount} of 3 bounties complete">${doneCount}/3</span>
      </div>
      ${data.bounties.map(b => `
        <div class="bs-bounty ${b.done ? 'bs-bounty--done' : ''}" role="listitem">
          <i class="fas ${b.done ? 'fa-check-circle' : 'fa-circle'}" aria-hidden="true"></i>
          <span>${escHtml(b.text)}</span>
          ${b.reward ? `<span class="bs-bounty__reward">${escHtml(b.reward.label)}</span>` : ''}
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
  // BATTLE CARD PALETTE
  // ============================================================

  function applyBattlePalette() {
    if (!_selectedCard) return;
    const palette = _selectedCard.palette || 'earth';
    const paletteColors = {
      earth: '#8b6914',
      ocean: '#4a9eff',
      neon: '#00d4ff',
      fire: '#ff6b3d',
      monochrome: '#888',
      sunset: '#ff8c42',
      inferno: '#ff3333',
      frost: '#88ddff',
      arcane: '#9b59b6',
      void: '#6666cc'
    };
    const color = paletteColors[palette] || '#8b6914';
    const playerCard = document.getElementById('arena-player-card');
    if (playerCard) {
      playerCard.style.borderColor = color;
      playerCard.style.boxShadow = '0 0 15px ' + color + '40';
    }
    // Also style the combatant frame
    const playerFrame = document.querySelector('.arena-combatant--player .arena-combatant__card');
    if (playerFrame) {
      playerFrame.style.borderColor = color;
      playerFrame.style.boxShadow = '0 0 15px ' + color + '40';
    }
  }

  // ============================================================
  // ASCENSION SYSTEM
  // ============================================================

  function showAscensionOffer(currentAscension) {
    const nextAsc = currentAscension + 1;
    // Create overlay dynamically
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.id = 'bs-ascension-offer';
    overlay.innerHTML = `
      <div class="bs-ascension-overlay">
        <p class="bs-overlay__title">Campaign Complete — Again.</p>
        <div class="bs-ascension-stars">
          ${Array.from({length: currentAscension}, () => '<i class="fas fa-star bs-ascension-star"></i>').join('')}
          <i class="fas fa-star bs-ascension-star" style="color:var(--bs-text-muted);opacity:0.3;"></i>
        </div>
        <p class="bs-overlay__subtitle">Ascend to level ${nextAsc}? Bosses grow stronger. Your legend grows.</p>
        <p style="font-size:0.75rem; color:var(--bs-text-muted); max-width:300px; margin:0 auto;">
          Bosses gain +${nextAsc * 20}% stats. You keep your card, rank, and visual unlocks.
          New palette unlocked: <strong style="color:var(--bs-accent);">${getAscensionReward(nextAsc)}</strong>
        </p>
        <div style="display:flex; gap:0.75rem; margin-top:1.5rem; justify-content:center; flex-wrap:wrap;">
          <button class="bs-btn bs-btn--primary bs-btn--glow" id="bs-ascend-btn">
            <i class="fas fa-arrow-up"></i> Ascend
          </button>
          <button class="bs-btn bs-btn--secondary" id="bs-ascend-skip">Stay at Ascension ${currentAscension}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('bs-ascend-btn').addEventListener('click', () => {
      performAscension(nextAsc);
      overlay.remove();
    }, { once: true });

    document.getElementById('bs-ascend-skip').addEventListener('click', () => {
      overlay.remove();
      showScreen('lobby');
      renderLobby();
    }, { once: true });
  }

  function getAscensionReward(level) {
    const rewards = {
      1: 'Inferno Palette',
      2: 'Frost Palette',
      3: 'Arcane Palette',
      4: 'Void Palette',
      5: 'Holographic Border + Infinite Tower'
    };
    return rewards[level] || 'Prestige Star ' + level;
  }

  function performAscension(newLevel) {
    playSfx('ascension');
    setAscension(newLevel);
    // Reset boss progress but keep stats/visuals/rank
    localStorage.setItem('bs-highest-boss', '0');
    localStorage.removeItem('bs-boss-records');
    // Unlock ascension visual reward
    const rewardMap = {
      1: 'palette_inferno',
      2: 'palette_frost',
      3: 'palette_arcane',
      4: 'palette_void',
      5: 'border_holographic'
    };
    if (rewardMap[newLevel]) unlockVisual(rewardMap[newLevel]);
    // Reset forge progress
    setForgeWins(0);
    localStorage.removeItem('bs-forge-pending');
    showSuccessToast('Ascended to level ' + newLevel + '! Bosses are now stronger.');
    showScreen('lobby');
    renderLobby();
  }

  // ============================================================
  // LEADERBOARD
  // ============================================================

  async function renderLeaderboard() {
    // Timeout wrapper to prevent infinite loading
    const TIMEOUT = 8000;
    const container = document.getElementById('bs-leaderboard-content');
    if (!container) return;
    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> Loading...</div>';

    try {
      let data;
      try {
        data = await Promise.race([
          window.ArenaAPI.loadCards(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT))
        ]);
      } catch (timeoutErr) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">Could not load leaderboard. Try again later.</p>';
        return;
      }
      const gallery = data.galleryCards || [];

      // Sort by power (sum of stats)
      const ranked = gallery.map(card => {
        let power = 0;
        if (card.combatStats) {
          power = (card.combatStats.str||0) + (card.combatStats.agi||0) + (card.combatStats.int||0) + (card.combatStats.end||0) + (card.combatStats.lck||0);
        } else if (card.stats && Array.isArray(card.stats)) {
          power = card.stats.reduce((s,st) => s + (st.value||0), 0);
        }
        return { ...card, power };
      }).sort((a, b) => b.power - a.power).slice(0, 20);

      if (ranked.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--bs-text-muted); padding:2rem;">No fighters yet. Be the first to publish your card.</p>';
        return;
      }

      // Check if current player is in the list
      const myCardId = _selectedCard ? _selectedCard.id : null;

      container.innerHTML = ranked.map((card, i) => {
        const isMe = card.id === myCardId;
        const medalIcon = i === 0 ? '<i class="fas fa-crown" style="color:#FFD700;"></i>' : i === 1 ? '<i class="fas fa-medal" style="color:#C0C0C0;"></i>' : i === 2 ? '<i class="fas fa-medal" style="color:#CD7F32;"></i>' : '';
        return `
          <div class="bs-boss-card ${isMe ? 'bs-boss-card--current' : ''}" style="cursor:default;">
            <span class="bs-boss-card__number" style="${i < 3 ? 'border-color:var(--bs-accent);color:var(--bs-accent);' : ''}">${i + 1}</span>
            <div class="bs-boss-avatar" style="width:36px;height:36px;font-size:0.9rem;">
              ${card.avatar ? `<img src="${escHtml(card.avatar)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-user"></i>'}
            </div>
            <div class="bs-boss-card__info">
              <div class="bs-boss-card__name">${medalIcon} ${escHtml(card.name || 'Unnamed')} ${isMe ? '<span style="color:var(--bs-accent);font-size:0.7rem;">(you)</span>' : ''}</div>
              <div class="bs-boss-card__class">${escHtml(card.class || '')} &middot; ${card.power} Power</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = '<p style="text-align:center; color:var(--bs-danger);">Failed to load leaderboard.</p>';
    }
  }

  // ============================================================
  // LOOT CHOICE (Pick 1 of 3)
  // ============================================================

  function showLootChoice(options) {
    const container = document.getElementById('bs-loot-options');
    if (!container) {
      // Fallback: auto-apply first option
      applyLootDrop(options[0]);
      showRewardDrop(options[0], 'Victory Reward');
      return;
    }

    const rarityColors = {
      common: 'var(--bs-text-muted)',
      uncommon: 'var(--bs-accent)',
      rare: '#7b2fff',
      epic: '#ff5252'
    };

    const statNames = { str: 'Strength', agi: 'Agility', int: 'Intelligence', end: 'Endurance', lck: 'Luck' };
    const statIcons = { str: 'fa-hand-fist', agi: 'fa-feather-pointed', int: 'fa-bolt', end: 'fa-heart', lck: 'fa-clover' };

    container.innerHTML = options.map((loot, i) => {
      const color = rarityColors[loot.rarity] || 'var(--bs-accent)';
      const icon = loot.stat ? (statIcons[loot.stat] || 'fa-gem') : 'fa-gem';
      const statLabel = loot.stat ? (statNames[loot.stat] || loot.stat.toUpperCase()) : '';
      const rarityLabel = loot.rarity ? loot.rarity.charAt(0).toUpperCase() + loot.rarity.slice(1) : '';
      return `
        <button class="bs-loot-card" data-loot-idx="${i}" style="border-color:${color};">
          <span class="bs-loot-card__rarity" style="color:${color};">${rarityLabel}</span>
          <i class="fas ${icon}" style="color:${color}; font-size:1.5rem;"></i>
          <span class="bs-loot-card__label">${escHtml(loot.label)}</span>
          <span class="bs-loot-card__stat">${escHtml(statLabel)}</span>
        </button>
      `;
    }).join('');

    showOverlay('bs-loot-choice');
    playSfx('loot');

    container.querySelectorAll('.bs-loot-card').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.lootIdx, 10);
        const chosen = options[idx];
        hideOverlay('bs-loot-choice');
        await applyLootDrop(chosen);
        showRewardDrop(chosen, 'Victory Reward');
      }, { once: true });
    });
  }

  // ============================================================
  // COMBAT TOOLTIPS (show damage estimates on move buttons)
  // ============================================================

  function updateCombatTooltips() {
    if (!_activeBattle || !_activeBattle.player) return;
    const stats = _activeBattle.player.combatStats;
    if (!stats) return;

    // Strike: STR * 0.4 to STR * 0.5
    const strMin = Math.floor(stats.str * 0.4);
    const strMax = Math.floor(stats.str * 0.5);
    const strEl = document.getElementById('arena-move-str');
    if (strEl) strEl.textContent = `~${strMin}-${strMax} dmg`;

    // Heal: END * 0.3 to END * 0.4
    const endMin = Math.floor(stats.end * 0.3);
    const endMax = Math.floor(stats.end * 0.4);
    const endEl = document.getElementById('arena-move-end');
    if (endEl) endEl.textContent = `~${endMin}-${endMax} HP`;

    // Ability: show INT
    const intEl = document.getElementById('arena-move-int');
    if (intEl) intEl.textContent = `INT ${stats.int}`;
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
