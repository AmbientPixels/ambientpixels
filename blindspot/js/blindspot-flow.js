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
  // STATE — delegated to bs-state.js (window.BsState)
  // _progress is the SAME object reference — in-place mutations work.
  // ============================================================

  var _S = window.BsState || {};
  var _progress = _S.progress;
  var BlindspotAPI = _S.api;
  function safeLSSet(key, value) { if (_S.safeLSSet) _S.safeLSSet(key, value); }
  function loadProgressFromServer() { return _S.load ? _S.load() : Promise.resolve(); }
  function syncProgressToServer() { if (_S.sync) _S.sync(); }
  function flushSyncBeforeNavigate() { if (_S.flush) _S.flush(); }

  // ============================================================
  // CONFIG & STATE
  // ============================================================

  let _config = null;
  let _bosses = [];
  var _bossesById = {};
  var _bossesByNumber = {};  // campaign bosses only (non-weekly)
  let _strangerCard = null;
  let _profile = null;
  let _profileData = null;
  let _selectedCard = null;
  let _activeBattle = null;
  let _isStrangerFight = false;
  let _isFirstRealFight = false;
  let _currentBossId = null;
  let _battleType = 'pve';
  function _pvpGalleryGet() { return _Pvp.getGallery ? _Pvp.getGallery() : []; }
  let _pvpOpponentId = null;
  let _hookInstalled = false;
  let _origShowResults = null;
  let _submitMoveHooked = false;
  var _towerPendingFloor = 0;
  var _pendingForge = false;
  var _lastStreakBonus = 0;
  var _lastStreakMsg = '';

  // ── Constants imported from bs-constants.js (window.BsConst) ──
  var _C = window.BsConst || {};
  var RANKS = _C.RANKS, RANK_ORDER = _C.RANK_ORDER;
  var ELO_DEFAULT = _C.ELO_DEFAULT, ELO_K = _C.ELO_K, PVP_RANKS = _C.PVP_RANKS;

  // ── PvP — delegated to bs-pvp.js (window.BsPvp) ──
  var _Pvp = window.BsPvp || {};
  function getPvPElo() { return _Pvp.getPvPElo ? _Pvp.getPvPElo() : _progress.pvpElo; }
  function setPvPElo(v) { if (_Pvp.setPvPElo) _Pvp.setPvPElo(v); else _progress.pvpElo = Math.max(0, Math.round(v)); }
  function getPvPRecord() { return _Pvp.getPvPRecord ? _Pvp.getPvPRecord() : _progress.pvpRecord; }
  function setPvPRecord(rec) { if (_Pvp.setPvPRecord) _Pvp.setPvPRecord(rec); else _progress.pvpRecord = rec; }
  function getPvPRank(elo) { return _Pvp.getPvPRank ? _Pvp.getPvPRank(elo) : PVP_RANKS[0]; }
  function showEloChange(text, color, rankObj) { if (_Pvp.showEloChange) _Pvp.showEloChange(text, color, rankObj); }
  function estimateOpponentElo(card) { return _Pvp.estimateOpponentElo ? _Pvp.estimateOpponentElo(card) : 1000; }
  function calcEloChange(playerElo, opponentElo, won) { return _Pvp.calcEloChange ? _Pvp.calcEloChange(playerElo, opponentElo, won) : 0; }

  var BOSS_ICONS = _C.BOSS_ICONS;
  var CLASS_PATTERNS = _C.CLASS_PATTERNS;

  // ============================================================
  // SOUND EFFECTS — delegated to bs-audio-sfx.js (window.BsSfx)
  // ============================================================

  function playSfx(name) { if (window.BsSfx) window.BsSfx.play(name); }
  function startBattleAmbient() { if (window.BsSfx) window.BsSfx.startAmbient(); }
  function stopBattleAmbient() { if (window.BsSfx) window.BsSfx.stopAmbient(); }

  // ============================================================
  // STRATEGY SYSTEM — delegated to bs-strategy.js (window.BsStrategy)
  // ============================================================

  var _Str = window.BsStrategy || {};
  var STAT_PASSIVES = _Str.STAT_PASSIVES, MOVE_UPGRADES = _Str.MOVE_UPGRADES, ARCHETYPES = _Str.ARCHETYPES;
  var WEAKNESS_LABELS = _Str.WEAKNESS_LABELS, WEAKNESS_COLORS = _Str.WEAKNESS_COLORS;
  var BOSS_ICONS = _Str.BOSS_ICONS, BATTLE_HINTS = _Str.BATTLE_HINTS, MOVE_BEATS = _Str.MOVE_BEATS;
  var PALETTE_UNLOCK_BOSSES = _C.PALETTE_UNLOCK_BOSSES, STREAK_MILESTONES = _C.STREAK_MILESTONES;

  function populatePrefightOverlay(boss) {
    ensureCombatStats(_selectedCard);
    if (_Str.populatePrefightOverlay) {
      _Str.populatePrefightOverlay(boss, _selectedCard, {
        deck: getDeck(),
        winStreak: getWinStreak(),
        bestStreak: getBestStreak()
      });
    }
  }
  function buildPrefightInfo(boss) { return _Str.buildPrefightInfo ? _Str.buildPrefightInfo(boss) : ''; }
  function detectArchetype(stats) { return _Str.detectArchetype ? _Str.detectArchetype(stats) : { id: 'balanced', name: 'Generalist' }; }
  function getActivePassives(stats) { return _Str.getActivePassives ? _Str.getActivePassives(stats) : []; }
  function getNextPassive(stats) { return _Str.getNextPassive ? _Str.getNextPassive(stats) : null; }
  function getMoveMatchup(a, b) { return _Str.getMoveMatchup ? _Str.getMoveMatchup(a, b) : 'draw'; }
  function flashMoveResult(a, b) { if (_Str.flashMoveResult) _Str.flashMoveResult(a, b); }

  // getNextUnlockTeasers stays — calls monolith functions (getNextRarity, getWinStreak, etc.)
  function getNextUnlockTeasers() {
    var teasers = [];
    var nextRar = getNextRarity();
    if (nextRar) {
      teasers.push({ context: 'lobby', icon: nextRar.rarity.icon, color: nextRar.rarity.color,
        text: nextRar.forgesNeeded + ' more forge visit' + (nextRar.forgesNeeded !== 1 ? 's' : '') + ' to ' + nextRar.rarity.name });
    }
    var streak = getWinStreak();
    for (var i = 0; i < STREAK_MILESTONES.length; i++) {
      if (streak < STREAK_MILESTONES[i].threshold) {
        var gap = STREAK_MILESTONES[i].threshold - streak;
        teasers.push({ context: 'lobby', icon: 'fa-fire', color: 'var(--bs-accent-glow)',
          text: gap + ' more win' + (gap !== 1 ? 's' : '') + ' in a row for ' + STREAK_MILESTONES[i].label });
        break;
      }
    }
    var highestBoss = getHighestBossDefeated();
    for (var j = 0; j < PALETTE_UNLOCK_BOSSES.length; j++) {
      if (highestBoss < PALETTE_UNLOCK_BOSSES[j].bossNum) {
        teasers.push({ context: 'campaign', icon: 'fa-palette', color: 'var(--bs-accent)',
          text: 'Beat Boss ' + PALETTE_UNLOCK_BOSSES[j].bossNum + ' to unlock ' + PALETTE_UNLOCK_BOSSES[j].palette + ' palette' });
        break;
      }
    }
    var nextPass = _selectedCard ? getNextPassive(_selectedCard.combatStats) : null;
    if (nextPass) {
      teasers.push({ context: 'forge', icon: nextPass.icon, color: WEAKNESS_COLORS[nextPass.stat] || 'var(--bs-accent)',
        text: nextPass.gap + ' more ' + (WEAKNESS_LABELS[nextPass.stat] || nextPass.stat) + ' to unlock ' + nextPass.name });
    }
    return teasers;
  }

  // CARD RARITY — delegated to bs-card-rarity.js (window.BsCardRarity)
  var _Rar = window.BsCardRarity || {};
  function getCardRarity() { return _Rar.getCardRarity ? _Rar.getCardRarity() : { id: 'common', name: 'Common', icon: 'fa-circle' }; }
  function getNextRarity() { return _Rar.getNextRarity ? _Rar.getNextRarity() : null; }
  function renderRarityBadge() { return _Rar.renderRarityBadge ? _Rar.renderRarityBadge() : ''; }

  var CLASS_SIGNATURE_MOVES = _C.CLASS_SIGNATURE_MOVES;

  var TUTORIAL_MAX_BATTLES = _C.TUTORIAL_MAX_BATTLES;
  var TUTORIAL_ROUND1_HINTS = _C.TUTORIAL_ROUND1_HINTS;
  var TUTORIAL_COUNTER_HINTS = _C.TUTORIAL_COUNTER_HINTS;

  function getTutorialBattleCount() {
    return parseInt(localStorage.getItem('bs-tutorial-battle-count') || '0', 10);
  }
  function incrementTutorialBattleCount() {
    var c = getTutorialBattleCount() + 1;
    safeLSSet('bs-tutorial-battle-count', String(c));
    return c;
  }
  function isInTutorialRange() {
    if (getTutorialBattleCount() > TUTORIAL_MAX_BATTLES) return false;
    // Server profile shows experienced player — skip tutorial after cache clear
    if (_profile && (_profile.xp > 0 || (_profile.record && _profile.record.wins > 0))) return false;
    return true;
  }

  function showTutorialHint(text) {
    var el = document.getElementById('bs-battle-hint');
    if (!el) return;
    el.innerHTML = '<i class="fas fa-lightbulb" style="color:var(--bs-accent);" aria-hidden="true"></i> ' +
      '<span>' + text + '</span>' +
      '<button class="bs-hint-dismiss" aria-label="Dismiss hint" style="margin-left:auto; background:none; border:none; color:var(--bs-text-muted); cursor:pointer; padding:0.25rem; font-size:0.85rem;"><i class="fas fa-times" aria-hidden="true"></i></button>';
    el.style.visibility = 'visible';
    var dismissBtn = el.querySelector('.bs-hint-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function() {
        el.style.visibility = 'hidden';
      }, { once: true });
    }
  }

  // ============================================================
  // SHARED UTILITIES
  // ============================================================

  function isOnLandingPage() { return !!document.getElementById('bs-landing'); }
  function isOnPlayPage() { return !!document.getElementById('bs-screen-lobby'); }

  function showOverlay(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('bs-overlay--hidden'); el.style.display = ''; }
    if (id === 'bs-prefight-overlay') { renderCharmSelector(); renderArenaSelector(); }
  }

  function hideOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('bs-overlay--hidden');
  }

  function updateBottomNav(screenId) {
    var navMap = { lobby: 'lobby', campaign: 'campaign', pvp: 'pvp', forge: 'forge', leaderboard: 'leaderboard', deck: 'lobby', battle: '__none__' };
    document.querySelectorAll('.bs-bottom-nav__item').forEach(function(btn) {
      var isActive = btn.dataset.nav === navMap[screenId];
      btn.classList.toggle('bs-bottom-nav__item--active', isActive);
      btn.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  }

  var _loadingTarget = 0;
  var _loadingCurrent = 0;
  var _loadingRAF = null;
  var _loadingFill = null;

  function updateLoadingProgress(pct, label) {
    _loadingTarget = Math.max(_loadingTarget, pct);
    if (!_loadingFill) _loadingFill = document.getElementById('bs-loading-fill');
    var step = document.getElementById('bs-loading-step');
    if (step) step.textContent = label || '';

    // Start or restart the animation loop
    if (!_loadingRAF && _loadingFill) _startLoadingAnim();
  }

  function _startLoadingAnim() {
    (function tick() {
      if (_loadingCurrent < _loadingTarget) {
        // Ease toward target — slower speed for smoother feel
        var diff = _loadingTarget - _loadingCurrent;
        var speed = Math.max(0.3, diff * 0.08);
        _loadingCurrent = Math.min(_loadingTarget, _loadingCurrent + speed);
        if (_loadingFill) {
          _loadingFill.style.width = _loadingCurrent.toFixed(1) + '%';
          // Kindling-into-flame: glow intensity + ember opacity scale with fill
          _loadingFill.style.setProperty('--bs-fill-pct', _loadingCurrent.toFixed(1));
        }
        _loadingRAF = requestAnimationFrame(tick);
      } else {
        _loadingRAF = null;
      }
    })();
  }

  function dismissLoadingGate() {
    _loadingTarget = 100;
    if (!_loadingRAF && _loadingFill) _startLoadingAnim();
    var gate = document.getElementById('bs-loading-gate');
    if (!gate) return;
    // Wait for bar to visually reach ~100%
    var waitMs = Math.max(400, (100 - _loadingCurrent) * 15);
    setTimeout(function() {
      document.body.classList.remove('bs-page--loading');
      gate.classList.add('bs-loading-gate--fade');
      setTimeout(function() { gate.remove(); }, 350);
    }, waitMs);
  }

  function showScreen(id) {
    // Reset charm/item state when leaving battle screen
    if (id !== 'battle' && _Chm.resetBattleState) _Chm.resetBattleState();
    document.querySelectorAll('.bs-screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('bs-screen-' + id);
    if (target) target.classList.add('active');
    document.body.classList.toggle('bs-battle-active', id === 'battle');
    updateBottomNav(id);
    window.scrollTo(0, 0);
  }

  function isNewPlayer(profile) {
    // localStorage flag is fastest check
    if (localStorage.getItem('blindspot-onboarded')) return false;
    // Server profile fallback — cache clear shouldn't reset a real player.
    // Check actual schema fields (see api/blindspotprofile createDefaultProfile).
    if (profile && (
      profile.selectedCardId ||
      (profile.totalWins || 0) > 0 ||
      (profile.pvpRecord && (profile.pvpRecord.w || 0) > 0) ||
      (profile.highestBoss || 0) > 0 ||
      (profile.forgeVisits || 0) > 0 ||
      (profile.sparks || 0) > 0
    )) {
      safeLSSet('blindspot-onboarded', 'true');
      return false;
    }
    // Trust server's authoritative isNew flag (false = profile blob already existed)
    if (_profileData && _profileData.isNew === false) {
      safeLSSet('blindspot-onboarded', 'true');
      return false;
    }
    return true;
  }

  function isDemo() { return _profileData ? (_profileData.isDemo || false) : true; }

  function getForgeWins() { return _progress.forgeWins; }
  function setForgeWins(n) { _progress.forgeWins = n; }
  function isForgePending() { return localStorage.getItem('bs-forge-pending') === 'true'; }
  function isForgeUnlocked() { return localStorage.getItem('bs-forge-unlocked') === 'true'; }
  function setForgeUnlocked() { safeLSSet('bs-forge-unlocked', 'true'); }

  function getHighestBossDefeated() { return _progress.highestBoss; }
  function setHighestBossDefeated(n) {
    if (n > _progress.highestBoss) _progress.highestBoss = n;
  }

  function getForgeVisitCount() { return _progress.forgeVisits; }
  function incForgeVisitCount() {
    _progress.forgeVisits++;
    return _progress.forgeVisits;
  }

  // Sparks — universal currency earned from all activities, spent on cosmetics
  function getSparks() { return _progress.sparks; }
  function addSparks(n) {
    _progress.sparks += Math.max(0, n);
    updateTopbarSparks();
  }
  function updateTopbarSparks() {
    var el = document.getElementById('bs-topbar-sparks');
    var numEl = document.getElementById('bs-topbar-sparks-num');
    if (el && numEl) {
      numEl.textContent = String(_progress.sparks || 0);
      el.hidden = false;
    }
    // Lobby Sparks Shop tile mirrors the same balance so it updates
    // in sync with every sparks award/spend without a separate render.
    var tileNum = document.getElementById('bs-sparks-tile-count');
    if (tileNum) tileNum.textContent = String(_progress.sparks || 0);
    // Directory row Sparks Shop chip — same number, third surface.
    var shopChip = document.getElementById('bs-shop-balance');
    var shopNum = document.getElementById('bs-shop-balance-num');
    if (shopChip && shopNum) {
      shopNum.textContent = String(_progress.sparks || 0);
      shopChip.hidden = false;
    }
  }

  // XP — rank progression. Awarded on PvE wins (and PvP / bounties later).
  // _progress.xp is the client mirror (synced to server via syncProfile).
  // _profile.xp is what updateRankDisplay reads, so we keep both in sync.
  function getXp() { return _progress.xp || 0; }
  function addXp(n) {
    var amount = Math.max(0, n | 0);
    if (amount === 0) return;
    _progress.xp = (_progress.xp || 0) + amount;
    if (_profile) _profile.xp = _progress.xp;
    if (typeof renderLevelHud === 'function') renderLevelHud(); // updateRankDisplay kept for stats screen
  }
  function spendSparks(n) {
    if (n > _progress.sparks) return false;
    _progress.sparks -= n;
    _progress.lifetimeSparksSpent = (_progress.lifetimeSparksSpent || 0) + n;
    syncProgressToServer();
    // Update all sparks displays
    var hudSparks = document.querySelector('.bs-hud-sparks');
    if (hudSparks) hudSparks.innerHTML = '<i class="fas fa-fire"></i> ' + _progress.sparks + ' sparks';
    var forgeSparks = document.getElementById('bs-forge-sparks');
    if (forgeSparks) forgeSparks.textContent = _progress.sparks;
    updateTopbarSparks();
    return true;
  }
  function getPurchasedCosmetics() { return _progress.purchasedCosmetics; }
  function addPurchasedCosmetic(key) {
    if (!_progress.purchasedCosmetics.includes(key)) _progress.purchasedCosmetics.push(key);
  }

  // ── Phase 8: Retention ──

  // Task 30: Daily spark bonus
  function checkDailyBonus() {
    var today = new Date().toISOString().slice(0, 10);
    if (_progress.lastDaily === today) return false;
    _progress.lastDaily = today;
    addSparks(10);
    showSuccessToast('Daily bonus: +10 Sparks!');
    return true;
  }

  // Task 31: Card level from XP
  function getCardLevel(xp) {
    return Math.min(50, Math.floor(Math.sqrt((xp || 0) / 50)) + 1);
  }

  // Task 33: Forfeit grace period
  function isEarlyForfeit() {
    var stats = _Ss.getStats ? _Ss.getStats() : null;
    return stats && stats.rounds <= 2;
  }

  // ============================================================
  // BATTLE CHARMS — delegated to bs-charms.js (window.BsCharms)
  // ============================================================

  var _Chm = window.BsCharms || {};
  function getOwnedCharms() { return _Chm.getOwned ? _Chm.getOwned() : []; }
  function removeCharm(id) { if (_Chm.remove) _Chm.remove(id); }
  function getCharmDef(id) { return _Chm.getDef ? _Chm.getDef(id) : null; }
  function renderCharmSelector() { if (_Chm.renderSelector) _Chm.renderSelector(); }

  function renderArenaSelector() {
    var container = document.getElementById('bs-arena-selector');
    if (!container || !window.ArenaBackgrounds) return;
    var highestBoss = getHighestBossDefeated();
    var arenas = window.ArenaBackgrounds.ARENAS;

    // Always render the rail — locked tiles surface what's still ahead
    // (each one shows its "Beat X" requirement inline, see the
    // bs-arena-option__req block below). Used to early-return + hide when
    // only the default arena was unlocked, but that left a blank slot
    // mid-prefight every time a new player or post-ascension player
    // opened the overlay. `unlocked` is no longer needed here.
    var selected = window.ArenaBackgrounds.getSelected();
    container.style.display = '';
    container.innerHTML = '<p class="bs-arena-selector__label"><i class="fas fa-map"></i> Choose Arena:</p>'
      + '<div class="bs-arena-options">'
      + arenas.map(function(arena) {
          var isOpen = window.ArenaBackgrounds.isUnlocked(arena, highestBoss);
          var isActive = arena.id === selected;
          var cls = 'bs-arena-option'
            + (isActive ? ' bs-arena-option--selected' : '')
            + (!isOpen ? ' bs-arena-option--locked' : '');
          var lockReq = !isOpen && arena.bossName ? 'Beat ' + arena.bossName : '';
          // Pill = arena image (button background); nameplate band sits at
          // the bottom of the pill, hosting the icon + name + lock req.
          // Lock badge centered on top of the dimmed image when locked;
          // checkmark top-left when active.
          var bgUrl = String(arena.image).replace(/'/g, '%27');
          return '<button class="' + cls + '" data-arena="' + escHtml(arena.id) + '"'
            + (!isOpen ? ' disabled' : '')
            + ' title="' + escHtml(arena.name) + (lockReq ? ' (' + escHtml(lockReq) + ')' : '') + '"'
            + ' style="background-image:url(\'' + bgUrl + '\');">'
            + (isActive ? '<span class="bs-arena-option__check" aria-hidden="true"><i class="fas fa-check"></i></span>' : '')
            + (!isOpen ? '<span class="bs-arena-option__lock" aria-hidden="true"><i class="fas fa-lock"></i></span>' : '')
            + '<span class="bs-arena-option__plate">'
              + '<span class="bs-arena-option__name"><i class="fas ' + arena.icon + '" aria-hidden="true"></i> ' + escHtml(arena.name) + '</span>'
              + (lockReq ? '<span class="bs-arena-option__req">' + escHtml(lockReq) + '</span>' : '')
            + '</span>'
            + '</button>';
        }).join('')
      + '</div>';

    container.querySelectorAll('.bs-arena-option:not([disabled])').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var arenaId = btn.dataset.arena;
        window.ArenaBackgrounds.setSelected(arenaId);
        renderArenaSelector();
        // Preview arena music on selection
        if (window.ArenaAudio) window.ArenaAudio.playArenaMusic(arenaId);
      });
    });
  }

  function addCharmButtonToBattle() { if (_Chm.addCharmButton) _Chm.addCharmButton(); }
  function addItemButtonsToBattle() { if (_Chm.addItemButtons) _Chm.addItemButtons(); }

  // ============================================================
  // COSMETIC INVENTORY — delegated to bs-cosmetics.js (window.BsCosmetics)
  // ============================================================

  var _Cos = window.BsCosmetics || {};
  function getOwnedCosmetics() { return _Cos.getOwned ? _Cos.getOwned() : []; }
  function getEquipped() { return _Cos.getEquipped ? _Cos.getEquipped() : {}; }
  function setEquipped(eq) { if (_Cos.setEquipped) _Cos.setEquipped(eq); }
  function equipCosmetic(slot, itemId) { if (_Cos.equip) _Cos.equip(slot, itemId); }
  function _buildCosmeticCaches() {
    if (_Cos.buildCaches) _Cos.buildCaches(_config);
    if (_Cos.setCallbacks) _Cos.setCallbacks({ getSparks: getSparks, spendSparks: spendSparks, toast: showSuccessToast });
  }
  function findCosmeticDef(itemId) { return _Cos.find ? _Cos.find(itemId) : null; }
  function getAllCosmeticsBySlot() { return _Cos.getAllBySlot ? _Cos.getAllBySlot() : {}; }
  function renderCollection() { if (_Cos.render) _Cos.render(); }
  function applyEquippedCosmetics() { if (_Cos.apply) _Cos.apply(); }
  var _collectionSlot = 'frame';

  // ============================================================
  // CRATE SYSTEM — delegated to bs-crates.js (window.BsCrates)
  // ============================================================

  var _Crt = window.BsCrates || {};
  function getCrates() { return _Crt.getCrates ? _Crt.getCrates() : []; }
  function addCrate(type) { return _Crt.addCrate ? _Crt.addCrate(type) : 0; }
  function removeCrate(i) { if (_Crt.removeCrate) _Crt.removeCrate(i); }
  function getCrateCount() { return _Crt.getCrateCount ? _Crt.getCrateCount() : 0; }
  function awardCrate(type) { if (_Crt.awardCrate) _Crt.awardCrate(type, _config); }
  function checkBattleCrate() { if (_Crt.checkBattleCrate) _Crt.checkBattleCrate(_config); }
  function updateCrateBadge() { if (_Crt.updateBadge) _Crt.updateBadge(); }
  function openCrateOverlay(i) { if (_Crt.openOverlay) _Crt.openOverlay(i, _config); }

  // applyCrateLoot stays in monolith — it orchestrates across card, forge, cosmetics, charms
  function applyCrateLoot(item) {
    if (!item) return;
    if (item.category === 'currency' || item.id.startsWith('sparks')) {
      addSparks(item.amount || 10);
    } else if (item.stat) {
      if (_selectedCard && _selectedCard.combatStats) {
        if (item.stat === 'all') {
          ['str', 'agi', 'int', 'end', 'lck'].forEach(function(s) {
            _selectedCard.combatStats[s] = Math.min(100, (_selectedCard.combatStats[s] || 0) + (item.amount || 3));
          });
        } else {
          _selectedCard.combatStats[item.stat] = Math.min(100, (_selectedCard.combatStats[item.stat] || 0) + (item.amount || 3));
        }
      }
      updateCardInDeck(_selectedCard);
    } else if (item.id.startsWith('forge_token')) {
      setForgeWins(getForgeWins() + (item.amount || 1));
    } else if (item.id === 'respec_scroll') {
      setForgeWins(getForgeWins() + 3);
    } else if (item.category === 'cosmetic') {
      if (!_progress.cosmetics.includes(item.id)) _progress.cosmetics.push(item.id);
    } else if (item.slot === 'charm' || item.slot === 'item') {
      _progress.charms.push(item.id);
    } else if (item.title) {
      setCardTitle(item.title);
    }
  }

  // Sparks shop — delegated to bs-sparks-shop.js (window.BsSparksShop)
  var _Shop = window.BsSparksShop || {};
  function updateSparksShop() { if (_Shop.render) _Shop.render(); }
  function renderShop() { if (_Shop.render) _Shop.render(); }
  function setShopTab(tab) { if (_Shop.setTab) _Shop.setTab(tab); }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Boss attempt tracking
  function getBossRecord(bossId) {
    return _progress.bossRecords[bossId] || { wins: 0, losses: 0 };
  }

  function recordBossResult(bossId, isWin) {
    if (!_progress.bossRecords[bossId]) _progress.bossRecords[bossId] = { wins: 0, losses: 0 };
    if (isWin) _progress.bossRecords[bossId].wins++;
    else _progress.bossRecords[bossId].losses++;
  }

  var MASTERY_TIERS = _C.MASTERY_TIERS;

  function getBossMastery(bossId) {
    var record = getBossRecord(bossId);
    var tier = null;
    for (var i = MASTERY_TIERS.length - 1; i >= 0; i--) {
      if (record.wins >= MASTERY_TIERS[i].wins) { tier = MASTERY_TIERS[i]; break; }
    }
    return { wins: record.wins, tier: tier };
  }

  function renderMasteryStars(bossId) {
    var mastery = getBossMastery(bossId);
    if (!mastery.tier) return '';
    var stars = '';
    for (var i = 0; i < MASTERY_TIERS.length; i++) {
      if (mastery.wins >= MASTERY_TIERS[i].wins) {
        stars += '<i class="fas ' + MASTERY_TIERS[i].icon + '" style="color:' + MASTERY_TIERS[i].color + ';font-size:0.55rem;"></i>';
      }
    }
    return '<span class="bs-mastery-stars" aria-label="Mastery: ' + mastery.tier.label + '">' + stars + '</span>';
  }

  function checkMasteryRewards(bossId) {
    var record = getBossRecord(bossId);
    var boss = _bossesById[bossId];
    if (!boss || boss.weekly || isWeeklyBoss(bossId)) return;
    if (!_progress.masteryClaimed[bossId]) _progress.masteryClaimed[bossId] = {};
    var claimed = _progress.masteryClaimed;

    for (var i = 0; i < MASTERY_TIERS.length; i++) {
      var t = MASTERY_TIERS[i];
      if (record.wins >= t.wins && !claimed[bossId][t.tier]) {
        claimed[bossId][t.tier] = true;
        addXp(75); // +75 XP per mastery tier-up — skill milestone

        // Bronze: +1 to boss weakness stat
        if (t.statBonus && boss.weakness && _selectedCard && _selectedCard.combatStats) {
          _selectedCard.combatStats[boss.weakness] = Math.min(100,
            (_selectedCard.combatStats[boss.weakness] || 0) + t.statBonus);
        }

        // Silver: title "BossName's Bane"
        if (t.titleSuffix) {
          setCardTitle(boss.name + t.titleSuffix);
        }

        // Gold: sparks reward
        if (t.sparks) {
          addSparks(t.sparks);
        }

        showToast(t.label + ' Mastery: ' + boss.name + (t.statBonus ? ' — +' + t.statBonus + ' ' + (WEAKNESS_LABELS[boss.weakness] || '') : '') + (t.titleSuffix ? ' — Title: ' + boss.name + t.titleSuffix : '') + (t.sparks ? ' — +' + t.sparks + ' Sparks' : ''), 'success');
      }
    }
  }

  // ============================================================
  // CARD RENDERER — delegated to bs-card-renderer.js (window.BsCardRenderer)
  // ============================================================

  var _CR = window.BsCardRenderer || {};
  function renderCardHTML(card, size) { return _CR.render ? _CR.render(card, size) : ''; }
  function ensureCombatStats(card) { if (_CR.ensureCombatStats) _CR.ensureCombatStats(card); }
  function getCardPower(card) { return _CR.getCardPower ? _CR.getCardPower(card) : 0; }
  window.renderCardHTML = renderCardHTML;

  // Win streak
  function getWinStreak() { return _progress.winStreak; }
  function setWinStreak(n) { _progress.winStreak = n; }

  // Best win streak
  function getBestStreak() { return _progress.bestStreak; }
  function setBestStreak(n) {
    if (n > _progress.bestStreak) _progress.bestStreak = n;
  }

  // Card title (earned from boss milestones)

  // Ascension system
  function getAscension() { return _progress.ascension; }
  function setAscension(n) { _progress.ascension = n; }

  function getCardTitle() { return _progress.cardTitle; }
  function setCardTitle(t) { _progress.cardTitle = t; }

  // Infinite Tower state
  function getTowerFloor() { return _progress.towerFloor; }
  function setTowerFloor(n) { _progress.towerFloor = n; }
  function getTowerBest() { return _progress.towerBest; }
  function setTowerBest(n) {
    if (n > _progress.towerBest) _progress.towerBest = n;
  }
  function isTowerUnlocked() { return getAscension() >= 5; }
  function getTowerBossForFloor(floor) {
    // Cycle through 10 campaign bosses
    var bossNum = ((floor - 1) % 10) + 1;
    return _bossesByNumber[bossNum];
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
  function getTowerClaimedFloors() { return _progress.towerClaimed; }
  function claimTowerFloor(floor) {
    if (!_progress.towerClaimed.includes(floor)) _progress.towerClaimed.push(floor);
  }

  // Claimed rewards + visual unlocks — delegated to bs-boss-rewards.js (window.BsBossRewards)
  var _BossRew = window.BsBossRewards || {};
  function getClaimedRewards() { return _BossRew.getClaimedRewards ? _BossRew.getClaimedRewards() : []; }
  function claimReward(bossId) { if (_BossRew.claimReward) _BossRew.claimReward(bossId); }
  function isRewardClaimed(bossId) { return _BossRew.isRewardClaimed ? _BossRew.isRewardClaimed(bossId) : false; }
  function getUnlockedVisuals() { return _BossRew.getUnlockedVisuals ? _BossRew.getUnlockedVisuals() : []; }
  function unlockVisual(key) { if (_BossRew.unlockVisual) _BossRew.unlockVisual(key); }
  function hasVisualUnlock(key) { return _BossRew.hasVisualUnlock ? _BossRew.hasVisualUnlock(key) : false; }

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
    var wb = _progress.weeklyBoss;
    if (!wb || wb.week !== getWeeklyBossKey()) {
      _progress.weeklyBoss = { week: getWeeklyBossKey(), wins: 0, losses: 0, rewardClaimed: false };
    }
    return _progress.weeklyBoss;
  }

  function recordWeeklyResult(isWin) {
    var rec = getWeeklyRecord();
    if (isWin) rec.wins++;
    else rec.losses++;
  }

  function isWeeklyRewardClaimed() {
    return getWeeklyRecord().rewardClaimed;
  }

  function claimWeeklyReward() {
    getWeeklyRecord().rewardClaimed = true;
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

  // applyBossReward — delegated to bs-boss-rewards.js
  function applyBossReward(boss) { return _BossRew.applyBossReward ? _BossRew.applyBossReward(boss) : Promise.resolve(null); }

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
      _buildCosmeticCaches();
      if (_Rar.setCallbacks) _Rar.setCallbacks({ getForgeVisitCount: getForgeVisitCount });
      if (_Shop.setCallbacks) _Shop.setCallbacks({
        getSparks: getSparks, spendSparks: spendSparks, awardCrate: awardCrate, toast: showSuccessToast,
        getDeck: getDeck, getSelectedCard: function() { return _selectedCard; },
        getLockedCards: function() { return _progress.lockedCards || []; },
        removeCardFromDeck: removeCardFromDeck, addSparks: addSparks
      });
      if (_Shop.setConfig) _Shop.setConfig(_config);
      if (_BossRew.setCallbacks) _BossRew.setCallbacks({
        getProgress: function() { return _progress; },
        getSelectedCard: function() { return _selectedCard; },
        getConfig: function() { return _config; },
        isWeeklyBoss: isWeeklyBoss,
        isWeeklyRewardClaimed: isWeeklyRewardClaimed,
        claimWeeklyReward: claimWeeklyReward,
        setCardTitle: setCardTitle,
        getForgeWins: getForgeWins,
        setForgeWins: setForgeWins
      });
      if (_Crt.setCallbacks) _Crt.setCallbacks({ applyCrateLoot: applyCrateLoot, renderLobby: renderLobby, updateSparksShop: updateSparksShop });
      if (_Chm.setCallbacks) _Chm.setCallbacks({ getConfig: function() { return _config; }, toast: showSuccessToast, sfx: playSfx });
      if (_Pvp.setCallbacks) _Pvp.setCallbacks({
        getSelectedCard: function() { return _selectedCard; },
        getCardPower: getCardPower,
        ensureCombatStats: ensureCombatStats,
        escHtml: escHtml,
        showOverlay: showOverlay,
        hideOverlay: hideOverlay,
        renderCharmSelector: renderCharmSelector,
        startPvPBattle: startPvPBattle,
        startAsyncBattle: startAsyncBattle,
        startLiveBattle: startLiveBattle,
        resumeLiveBattle: resumeLiveBattle,
        onLiveRoundResolved: onLiveRoundResolved,
        onLivePollUpdate: onLivePollUpdate,
        onLiveBattleComplete: onLiveBattleComplete
      });
      if (_Rew.setCallbacks) _Rew.setCallbacks({
        getHighestBoss: getHighestBossDefeated, getBestStreak: getBestStreak,
        getCurrentStreak: getWinStreak,
        getForgeVisits: getForgeVisitCount, getAscension: getAscension,
        getCardPower: function() { return _selectedCard ? getCardPower(_selectedCard) : 0; },
        getPvPRecord: getPvPRecord, getPvPElo: getPvPElo, getPvPRank: getPvPRank,
        getPvPRanks: function() { return PVP_RANKS; }
      });
      _bosses = bossesResp;
      // Build boss lookup maps for O(1) access
      _bossesById = {};
      _bossesByNumber = {};
      for (var bi = 0; bi < _bosses.length; bi++) {
        _bossesById[_bosses[bi].id] = _bosses[bi];
        if (!_bosses[bi].weekly && !isWeeklyBoss(_bosses[bi].id)) {
          _bossesByNumber[_bosses[bi].boss] = _bosses[bi];
        }
      }
      _strangerCard = strangerResp;
      if (_Camp.setCallbacks) _Camp.setCallbacks({
        escHtml: escHtml,
        getBosses: function() { return _bosses; },
        getBossesById: function() { return _bossesById; },
        getHighestBoss: getHighestBossDefeated,
        isWeeklyBoss: isWeeklyBoss,
        getWeeklyBoss: getWeeklyBoss,
        getDaysUntilWeeklyReset: getDaysUntilWeeklyReset,
        getWeeklyRecord: getWeeklyRecord,
        isWeeklyRewardClaimed: isWeeklyRewardClaimed,
        getBossRecord: getBossRecord,
        isRewardClaimed: isRewardClaimed,
        renderMasteryStars: renderMasteryStars,
        populatePrefightOverlay: populatePrefightOverlay,
        showOverlay: showOverlay,
        setupPrefightButtons: setupPrefightButtons,
        isTowerUnlocked: isTowerUnlocked,
        getTowerFloor: getTowerFloor,
        getTowerBest: getTowerBest,
        getTowerBossForFloor: getTowerBossForFloor,
        getTowerMilestoneReward: getTowerMilestoneReward,
        startTowerBattle: startTowerBattle
      });
      if (_Forge.setCallbacks) _Forge.setCallbacks({
        escHtml: escHtml,
        showOverlay: showOverlay,
        hideOverlay: hideOverlay,
        showScreen: showScreen,
        showErrorToast: showErrorToast,
        showSuccessToast: showSuccessToast,
        playSfx: playSfx,
        getConfig: function() { return _config; },
        getSelectedCard: function() { return _selectedCard; },
        setSelectedCard: function(c) { _selectedCard = c; _progress.selectedCardId = c.id; },
        getProgress: function() { return _progress; },
        renderCardHTML: renderCardHTML,
        ensureCombatStats: ensureCombatStats,
        getCardPower: getCardPower,
        getUnlockedVisuals: getUnlockedVisuals,
        getPurchasedCosmetics: getPurchasedCosmetics,
        addPurchasedCosmetic: addPurchasedCosmetic,
        getSparks: getSparks,
        spendSparks: spendSparks,
        getForgeWins: getForgeWins,
        setForgeWins: setForgeWins,
        getForgeVisitCount: getForgeVisitCount,
        incForgeVisitCount: incForgeVisitCount,
        setForgeUnlocked: setForgeUnlocked,
        getDeck: getDeck,
        getSelectedCardIndex: getSelectedCardIndex,
        updateCardInDeck: updateCardInDeck,
        updateForgeProgress: updateForgeProgress,
        completeBounty: completeBounty,
        setCardTitle: setCardTitle,
        getCardRarity: getCardRarity,
        syncProgressToServer: syncProgressToServer,
        renderLobby: renderLobby,
        getNextPassive: getNextPassive
      });
      if (_Deck.setCallbacks) _Deck.setCallbacks({
        getDeck: getDeck,
        getCardPower: getCardPower,
        ensureCombatStats: ensureCombatStats,
        renderCardHTML: renderCardHTML,
        escHtml: escHtml,
        getSelectedCard: function() { return _selectedCard; },
        setActiveCard: function(card) { _selectedCard = card; ensureCombatStats(_selectedCard); _progress.selectedCardId = _selectedCard.id; syncProgressToServer(); },
        removeCardFromDeck: removeCardFromDeck,
        showSuccessToast: showSuccessToast
      });
      var _Wager = window.BsWager || {};
      if (_Wager.setCallbacks) _Wager.setCallbacks({
        getDeck: getDeck,
        renderCardHTML: renderCardHTML,
        escHtml: escHtml,
        showToast: showSuccessToast,
        getLockedCards: function() { return _progress.lockedCards || []; },
        getSelectedCard: function() { return _selectedCard; },
        refreshDeck: function() { renderLobby(); },
        getProgress: function() { return _progress; }
      });
      if (_Br.setCallbacks) _Br.setCallbacks({
        playSfx: playSfx, addSparks: addSparks, addXp: addXp, showSuccessToast: showSuccessToast,
        showOverlay: showOverlay, safeLSSet: safeLSSet, syncProgressToServer: syncProgressToServer,
        getCardPower: getCardPower,
        // State accessors
        getBattleType: function() { return _battleType; },
        getCurrentBossId: function() { return _currentBossId; },
        getBossesById: function() { return _bossesById; },
        getSelectedCard: function() { return _selectedCard; },
        getProfile: function() { return _profile; },
        getConfig: function() { return _config; },
        getPvpOpponentId: function() { return _pvpOpponentId; },
        getPVP_RANKS: function() { return PVP_RANKS; },
        getELO_DEFAULT: function() { return ELO_DEFAULT; },
        // Pending forge / streak state
        setPendingForge: function(v) { _pendingForge = v; },
        setLastStreakBonus: function(v) { _lastStreakBonus = v; },
        setLastStreakMsg: function(v) { _lastStreakMsg = v; },
        getLastStreakBonus: function() { return _lastStreakBonus; },
        getLastStreakMsg: function() { return _lastStreakMsg; },
        // Progression
        checkDailyBonus: checkDailyBonus, recordBossResult: recordBossResult,
        getWeeklyBoss: getWeeklyBoss, recordWeeklyResult: recordWeeklyResult,
        checkMasteryRewards: checkMasteryRewards,
        getHighestBossDefeated: getHighestBossDefeated, setHighestBossDefeated: setHighestBossDefeated,
        getForgeWins: getForgeWins, setForgeWins: setForgeWins,
        getWinStreak: getWinStreak, setWinStreak: setWinStreak,
        setBestStreak: setBestStreak, incrementTotalWins: incrementTotalWins,
        setCardTitle: setCardTitle, getAscension: getAscension,
        isWeeklyBoss: isWeeklyBoss, isWeeklyRewardClaimed: isWeeklyRewardClaimed,
        isForgeUnlocked: isForgeUnlocked, setForgeUnlocked: setForgeUnlocked,
        // Actions
        applyBossReward: applyBossReward, showRewardDrop: showRewardDrop,
        awardCrate: awardCrate, showBossDialogue: showBossDialogue,
        showAscensionOffer: showAscensionOffer, showForgeProgressInResults: showForgeProgressInResults,
        rollLoot: rollLoot, showLootChoice: showLootChoice,
        completeBounty: completeBounty, getDailyBounties: getDailyBounties,
        checkBattleCrate: checkBattleCrate, handleTowerResult: handleTowerResult,
        getTowerFloor: getTowerFloor, getTowerBest: getTowerBest,
        getLossTip: getLossTip, renderSessionStats: renderSessionStats,
        loadProfile: loadProfile, updateRankDisplay: updateRankDisplay,
        // PvP
        pvpGalleryGet: _pvpGalleryGet, estimateOpponentElo: estimateOpponentElo,
        getPvPElo: getPvPElo, setPvPElo: setPvPElo,
        getPvPRecord: getPvPRecord, setPvPRecord: setPvPRecord,
        getPvPRank: getPvPRank, showEloChange: showEloChange, calcEloChange: calcEloChange,
        // Cosmetics
        getEquipped: getEquipped, findCosmeticDef: findCosmeticDef
      });
      if (_Loot.setCallbacks) _Loot.setCallbacks({
        showOverlay: showOverlay, hideOverlay: hideOverlay, playSfx: playSfx,
        applyLootDrop: applyLootDrop, showRewardDrop: showRewardDrop,
        getSparks: getSparks,
        getPendingForge: function() { return _pendingForge; },
        setPendingForge: function(v) { _pendingForge = v; }
      });
      if (_Rd.setCallbacks) _Rd.setCallbacks({
        getSelectedCard: function() { return _selectedCard; },
        escHtml: escHtml
      });
      if (_Lb.setCallbacks) _Lb.setCallbacks({
        getSelectedCard: function() { return _selectedCard; },
        escHtml: escHtml
      });
      if (_Ct.setCallbacks) _Ct.setCallbacks({
        getSelectedCard: function() { return _selectedCard; },
        getActiveBattle: function() { return _activeBattle; }
      });
      if (_Au.setCallbacks) _Au.setCallbacks({ escHtml: escHtml });
      if (_Asc.setCallbacks) _Asc.setCallbacks({
        playSfx: playSfx, showScreen: showScreen, renderLobby: renderLobby,
        showSuccessToast: showSuccessToast, syncProgressToServer: syncProgressToServer,
        setAscension: setAscension, awardCrate: awardCrate, unlockVisual: unlockVisual,
        setForgeWins: setForgeWins,
        getProgress: function() { return _progress; }
      });
      // _Land.setCallbacks moved to IIFE top level (before DOMContentLoaded)
      // to avoid circular dep: initLanding needs _cb.loadGameData, but
      // _cb.loadGameData was only set after loadGameData() ran.
    } catch (e) {
      console.error('[Blindspot] Failed to load game data:', e);
      showErrorToast('Failed to load game. Please refresh.');
      throw e;
    }
  }

  // Per-user localStorage keys that hold session state (cards, active
   // selection). These leak across accounts on the same browser if not
  // cleared when a different user logs in. List is intentionally
  // narrow — keys that are public/static (rank thresholds, ui prefs)
  // don't need to be cleared.
  var _PER_USER_KEYS = ['bs-deck', 'bs-selected-card-id'];

  function _clearPerUserCache() {
    _PER_USER_KEYS.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }

  // Detect a user-switch on the same browser. If the cached "last user"
  // differs from the principal that just logged in, the old user's
  // deck + selected-card-id are about to leak into this session — wipe
  // them before any code reads getDeck() or pulls a stale card id.
  function _checkUserSwitch(userId) {
    if (!userId) return;
    var prior;
    try { prior = localStorage.getItem('bs-last-user'); } catch (_) { prior = null; }
    if (prior && prior !== userId) {
      // Don't wipe on a guest → authed migration. The cards in bs-deck
      // belong to the same human who just signed in; the guest-signin
      // handler in initPlay needs to read them and call persistPending
      // to write them under the new userId. Clearing here would leave
      // the guest's just-built card unpersistable on the server.
      var isGuestMigration = (prior === 'demo-guest') && (localStorage.getItem('bs-guest-mode') === 'true');
      if (isGuestMigration) {
        console.log('[Blindspot] Guest → authed migration (demo-guest -> ' + userId + ') — preserving deck for persist');
      } else {
        console.log('[Blindspot] User switch detected (' + prior + ' -> ' + userId + ') — clearing per-user cache');
        _clearPerUserCache();
      }
    }
    safeLSSet('bs-last-user', userId);
  }

  async function loadProfile() {
    try {
      const data = await window.ArenaAPI.loadProfile();
      _profileData = data;
      _profile = data.profile || null;
      // Clear stale per-user cache if the logged-in user has changed
      // since the last session on this browser. Has to happen before
      // loadUserCards / renderLobby read getDeck().
      if (_profile && _profile.userId) _checkUserSwitch(_profile.userId);
      return _profile;
    } catch (e) {
      console.warn('[Blindspot] Could not load profile:', e);
      _profileData = null;
      _profile = null;
      return null;
    }
  }

  async function loadUserCards() {
    // Capture guest flag at fetch START — not at write time. This call runs
    // in parallel with profile load; the guest-signin handler may clear the
    // flag mid-flight, and we don't want a freshly-signed-in guest's deck
    // to get clobbered with the server's empty response (their cards
    // haven't been persisted to the server yet — that happens via
    // persistPending immediately after the flag is cleared).
    var wasGuestAtStart = localStorage.getItem('bs-guest-mode') === 'true';
    try {
      // slim=mine: ask the server to skip the gallery + default-cards-for-
      // gallery blob fetches entirely. The lobby only needs the player's
      // own cards; the heavy ~70MB gallery payload was the source of the
      // visible loading-bar pause around 60-75%. Gallery / Forge avatar
      // tray / PvP defender browser still call loadCards() with no opts
      // and get the full payload.
      const data = await Promise.race([
        window.ArenaAPI.loadCards({ slim: true }),
        new Promise(function(_, reject) { setTimeout(function() { reject(new Error('loadCards timeout')); }, 45000); })
      ]);
      var cards = (data.userCards || []).filter(function(c) { return !c.isDefault; });
      // Always overwrite the cache with what the server returned — even an
      // empty list. Skipping the empty case let the prior user's cards
      // persist when a new player with zero cards logged in on the same
      // browser (cross-account leak).
      // EXCEPT for guests (or guests-just-signed-in): anon users don't
      // write to the server, so the server response is always empty (or a
      // stale shared anon blob) and clobbering bs-deck would wipe their
      // just-built card. For guests, bs-deck IS the source of truth.
      if (!wasGuestAtStart) setDeck(cards);
      return cards;
    } catch (e) {
      console.warn('[Blindspot] Could not load cards:', e);
      // Fall back to cached deck only if the cache belongs to the current
      // user. getDeck() validates the namespace; if the cache is from a
      // prior account it returns []. Avoids leaking the prior user's
      // cards into this session on API failure.
      var cached = getDeck();
      if (cached.length > 0) return cached;
      return [];
    }
  }

  // ============================================================
  // CARD COLLECTION (DECK) MODEL
  // ============================================================

  var MAX_DECK_SIZE = 8;

  function getDeck() {
    try { return JSON.parse(localStorage.getItem('bs-deck') || '[]'); }
    catch(e) { return []; }
  }

  function setDeck(cards) {
    safeLSSet('bs-deck', JSON.stringify(cards));
  }

  function getDeckSize() { return getDeck().length; }

  function addCardToDeck(card) {
    var deck = getDeck();
    if (deck.length >= MAX_DECK_SIZE) return false;
    // Prevent duplicates by id
    if (card.id && deck.some(function(c) { return c.id === card.id; })) {
      // Update existing card
      deck = deck.map(function(c) { return c.id === card.id ? card : c; });
    } else {
      deck.push(card);
    }
    setDeck(deck);
    return true;
  }

  function updateCardInDeck(card) {
    if (!card || !card.id) return;
    var deck = getDeck();
    var found = false;
    deck = deck.map(function(c) {
      if (c.id === card.id) { found = true; return card; }
      return c;
    });
    if (found) setDeck(deck);
  }

  function removeCardFromDeck(cardId) {
    var deck = getDeck();
    deck = deck.filter(function(c) { return c.id !== cardId; });
    setDeck(deck);
  }

  function getSelectedCardIndex() {
    if (!_selectedCard || !_selectedCard.id) return 0;
    var deck = getDeck();
    for (var i = 0; i < deck.length; i++) {
      if (deck[i].id === _selectedCard.id) return i;
    }
    return 0;
  }

  // ── Card Switcher + New Card Button — delegated to bs-card-switcher.js (window.BsCardSwitcher) ──
  var _Sw = window.BsCardSwitcher || {};
  if (_Sw.setCallbacks) _Sw.setCallbacks({
    getDeck: getDeck, getDeckSize: getDeckSize, getSelectedCardIndex: getSelectedCardIndex,
    getConfig: function() { return _config; },
    getSelectedCard: function() { return _selectedCard; },
    setActiveCard: function(card) { _selectedCard = card; ensureCombatStats(_selectedCard); _progress.selectedCardId = _selectedCard.id; syncProgressToServer(); },
    renderLobby: function() { renderLobby(); },
    isForgeUnlocked: isForgeUnlocked, isForgePending: isForgePending,
    getForgeWins: getForgeWins, getHighestBossDefeated: getHighestBossDefeated,
    showNewCardClassPicker: function() { showNewCardClassPicker(); },
    showScreen: function(name) { showScreen(name); },
    renderDeckManagement: function() { renderDeckManagement(); }
  });
  function renderCardSwitcher() { if (_Sw.renderSwitcher) _Sw.renderSwitcher(); }
  function renderNewCardButton() { if (_Sw.renderNewCardBtn) _Sw.renderNewCardBtn(); }

  // NEW CARD CLASS PICKER — delegated to bs-class-picker.js (window.BsClassPicker)
  var _Cp = window.BsClassPicker || {};
  if (_Cp.setCallbacks) _Cp.setCallbacks({
    addCardsToDeck: function(cards) { cards.forEach(function(c) { addCardToDeck(c); }); },
    setSelectedCardId: function(id) { _progress.selectedCardId = id; },
    setSelectedCard: function(card) { _selectedCard = card; },
    safeLSSet: safeLSSet,
    renderLobby: function() { renderLobby(); },
    openForgeScreen: function(first) { openForgeScreen(first); },
    showErrorToast: showErrorToast
  });
  function showNewCardClassPicker() { if (_Cp.show) _Cp.show(); }

  // ============================================================
  // DECK MANAGEMENT — delegated to bs-deck.js (window.BsDeck)
  // ============================================================

  var _Deck = window.BsDeck || {};
  function renderDeckManagement() { if (_Deck.render) _Deck.render(); }
  function showDeckDeleteConfirm(cardId) { if (_Deck.showDeleteConfirm) _Deck.showDeleteConfirm(cardId); }
  function renderDeckButton() { if (_Deck.renderButton) _Deck.renderButton(); }

  // ============================================================
  // SESSION STATS — delegated to bs-session-stats.js (window.BsSessionStats)
  // ============================================================

  var _Ss = window.BsSessionStats || {};
  function hookBattleTracking() { if (_Ss.hookBattleTracking) _Ss.hookBattleTracking(); }
  function showBossDialogue(bossId, phase) { if (_Ss.showBossDialogue) _Ss.showBossDialogue(bossId, phase); }
  function getLossTip() { return _Ss.getLossTip ? _Ss.getLossTip() : 'Your card remembers.'; }
  function renderSessionStats() { if (_Ss.renderSessionStats) _Ss.renderSessionStats(); }
  if (_Ss.setCallbacks) _Ss.setCallbacks({
    flashMoveResult: function(a, b) { flashMoveResult(a, b); },
    playSfx: function(name) { playSfx(name); },
    isInTutorialRange: function() { return isInTutorialRange(); },
    showTutorialHint: function(text) { showTutorialHint(text); },
    startBattleAmbient: function() { startBattleAmbient(); },
    addCharmButtonToBattle: function() { addCharmButtonToBattle(); },
    addItemButtonsToBattle: function() { addItemButtonsToBattle(); },
    getBattleType: function() { return _battleType; },
    getCurrentBossId: function() { return _currentBossId; },
    getBossesById: function() { return _bossesById; }
  });

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
      // Fade out ambient audio
      stopBattleAmbient();
      // Remove tutorial if active
      removeTutorial();
      // Reset charm + adventure item state
      if (_Chm.resetBattleState) _Chm.resetBattleState();

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

  // ── Landing Page — delegated to bs-landing.js (window.BsLanding) ──
  var _Land = window.BsLanding || {};
  function initLanding() { if (_Land.initLanding) _Land.initLanding(); }
  function handleStrangerResult(r, d) { if (_Land.handleStrangerResult) _Land.handleStrangerResult(r, d); }
  function handleFirstRealFightResult(r, d) { if (_Land.handleFirstRealFightResult) _Land.handleFirstRealFightResult(r, d); }
  function showForgeProgressInResults() { if (_Land.showForgeProgressInResults) _Land.showForgeProgressInResults(); }

  // ============================================================
  // PLAY PAGE (play.html)
  // ============================================================

  async function initPlay() {
   try {
    // Show lobby shell immediately while data loads
    showScreen('lobby');

    // Start ALL data loading in parallel — track completion with smooth progress
    updateLoadingProgress(5, 'Connecting...');
    const gameDataPromise = loadGameData().then(r => { updateLoadingProgress(25, 'Arena loaded'); return r; });
    const profilePromise = loadProfile().then(r => { updateLoadingProgress(45, 'Profile loaded'); return r; });
    const progressPromise = loadProgressFromServer().then(r => { updateLoadingProgress(60, 'Progress loaded'); return r; });
    const cardsPromise = loadUserCards().then(r => { updateLoadingProgress(75, 'Cards loaded'); return r; });

    if (window.ArenaAudio) window.ArenaAudio.init();

    if (!window._bsBattleEventsBound && window.ArenaBattleUI) {
      window.ArenaBattleUI.bindEvents();
      window._bsBattleEventsBound = true;
    }

    hookBattleCompletion();
    hookBattleTracking();

    // Wait for everything in parallel
    const [, profile] = await Promise.all([gameDataPromise, profilePromise, progressPromise]);

    var isGuestMode = localStorage.getItem('bs-guest-mode') === 'true';

    // If guest signed in, clear guest flag, sync cached progress, AND
    // persist any guest-built cards to the server under their real userId.
    // Without the card persist, the deck survives in localStorage for this
    // session but is lost on the next device / cache clear.
    // NOTE: the server returns isDemo at the TOP level (data.isDemo) — NOT on
    // data.profile. Reading profile.isDemo is always undefined, so the original
    // `!profile.isDemo` check evaluated truthy for actual guests and silently
    // cleared bs-guest-mode, causing the line 1244 redirect to bounce them
    // back to splash. Use isDemo() which reads _profileData.isDemo.
    if (isGuestMode && profile && !isDemo()) {
      localStorage.removeItem('bs-guest-mode');
      isGuestMode = false;
      // Merge cached guest progress into server profile
      if (_S.loadFromCache) _S.loadFromCache();
      syncProgressToServer();
      // Persist every guest-built card to the server. Fire-and-forget —
      // the local deck cache continues to render the lobby; failure just
      // means the card stays local-only this session.
      var guestDeck = getDeck();
      if (guestDeck.length > 0 && window.BlindspotSaveCard && window.BlindspotSaveCard.persistPending) {
        guestDeck.forEach(function (c) {
          window.BlindspotSaveCard.persistPending(c).catch(function (e) {
            console.warn('[Blindspot] guest card persist failed:', e);
          });
        });
      }
    }

    // Pending card save: a player built a card as a guest and clicked
    // "Sign In & Enter the Arena" instead of "Continue as Guest". The
    // card was stashed in bs-pending-card-save (and the deck cache);
    // now that we have an authenticated principal, persist it to the
    // server under their real userId. The deck cache is already the
    // source of truth for rendering, so the server write is fire-and-
    // forget — failure just means the card is local-only this session.
    var pendingCardJSON = localStorage.getItem('bs-pending-card-save');
    if (pendingCardJSON && profile && !isDemo()) {
      try {
        var pendingCard = JSON.parse(pendingCardJSON);
        if (pendingCard && pendingCard.id) {
          ensureCombatStats(pendingCard);
          addCardToDeck(pendingCard);
          safeLSSet('bs-selected-card-id', pendingCard.id);
          if (window.BlindspotSaveCard && window.BlindspotSaveCard.persistPending) {
            window.BlindspotSaveCard.persistPending(pendingCard).then(function () {
              try { window.ArenaAPI.selectCard(pendingCard.id); } catch (e) {}
            }).catch(function (e) { console.warn('[Blindspot] persistPending failed:', e); });
          }
        }
      } catch (e) { console.warn('[Blindspot] pending card parse failed:', e); }
      localStorage.removeItem('bs-pending-card-save');
    }

    // Welcome crate for new guests. Authed users get theirs server-side
    // via createDefaultProfile() in blindspotprofile. Guests don't have
    // a server profile, so we grant client-side once per browser via
    // bs-welcome-crate-given flag — wiped only by a hard localStorage
    // reset (nuking the flag = "new player state", new crate is fair).
    if (isGuestMode && localStorage.getItem('bs-welcome-crate-given') !== 'true') {
      if (!_progress.crates) _progress.crates = [];
      if (_progress.crates.length === 0) {
        _progress.crates.push({ type: 'ember', earned: Date.now() });
        safeLSSet('bs-welcome-crate-given', 'true');
      } else {
        // Crates already present (e.g. legacy state) — just mark and move on
        safeLSSet('bs-welcome-crate-given', 'true');
      }
    }

    if (!profile && !isGuestMode) {
      dismissLoadingGate();
      window.location.href = '/blindspot/';
      return;
    }

    // Anonymous users get a demo profile from the server (isDemo: true).
    // play.html is the in-game lobby — anonymous visitors belong on the
    // splash where they can either sign in or pick the explicit "Continue
    // as guest" path. The guest flag is the deliberate opt-in to demo state.
    if (isDemo() && !isGuestMode) {
      dismissLoadingGate();
      window.location.href = '/blindspot/';
      return;
    }

    // Cards loaded in parallel — for guests, prefer localStorage deck
    var cards;
    if (isGuestMode) {
      var localDeck = getDeck();
      cards = localDeck.length > 0 ? localDeck : await cardsPromise;
    } else {
      cards = await cardsPromise;
      // Fallback: server returned nothing but localStorage has cards (e.g. guest who just built one)
      if (cards.length === 0) {
        var fallbackDeck = getDeck();
        if (fallbackDeck.length > 0) cards = fallbackDeck;
      }
      // Merge: if selected card is in localStorage but missing from server (blob replication lag),
      // inject it so the newly created card always shows up immediately
      var pendingCardId = localStorage.getItem('bs-selected-card-id');
      if (pendingCardId && !cards.find(function(c) { return c.id === pendingCardId; })) {
        var cachedDeck = getDeck();
        var cachedCard = cachedDeck.find(function(c) { return c.id === pendingCardId; });
        if (cachedCard) cards.push(cachedCard);
      }
    }
    if (cards.length > 0) {
      // Sync full server card data into deck cache so card switcher has complete data
      cards.forEach(function(c) { ensureCombatStats(c); addCardToDeck(c); });
      var savedCardId = _progress.selectedCardId || (profile && profile.selectedCardId);
      _selectedCard = savedCardId
        ? cards.find(c => c.id === savedCardId) || cards[0]
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
      updatePlayAuthUI();
      dismissLoadingGate();
      return;
    }

    // Sync arena boss progress into _progress if server has higher
    if (profile && profile.pveProgress && profile.pveProgress.blindspotHighestDefeated !== undefined) {
      var serverBoss = profile.pveProgress.blindspotHighestDefeated - 100;
      if (serverBoss > _progress.highestBoss) _progress.highestBoss = serverBoss;
    }

    // Sync locked cards from server profile to deck module
    if (_Deck.setLockedCards && Array.isArray(_progress.lockedCards)) {
      _Deck.setLockedCards(_progress.lockedCards);
    }

    updateLoadingProgress(85, 'Preparing lobby...');
    await new Promise(r => requestAnimationFrame(r));
    renderLobby();
    updateLoadingProgress(95, 'Almost ready...');
    bindPlayNavigation();
    updatePlayAuthUI();
    dismissLoadingGate();

    // Check for active live PvP battle to resume
    if (!checkForActiveLiveBattle()) {
      // Also check profile fallback
      if (_profile && _profile.activeLiveBattle) {
        resumeLiveBattle(_profile.activeLiveBattle);
      }
    }

    // Post-Quick-Build onboarding: show 3-step welcome on first lobby visit
    // Skip if server profile shows returning player (cache clear shouldn't re-onboard)
    if (!localStorage.getItem('bs-onboarded-lobby')) {
      var isReturning = _profile && (_profile.xp > 0 || (_profile.record && _profile.record.wins > 0));
      safeLSSet('bs-onboarded-lobby', 'true');
      if (!isReturning) {
        // Brief delay so player sees the lobby before onboarding overlay
        setTimeout(showLobbyOnboarding, 800);
      }
    }
   } catch (err) {
    console.error('[Blindspot] initPlay crashed:', err);
    dismissLoadingGate();
   }
  }

  // ============================================================
  // LOBBY
  // ============================================================

  function renderLobby() {
    // Lobby ambient music intentionally disabled. The torch-fire-loop
    // track + 'lobby-ambient' MUSIC_TRACKS entry are still in place;
    // re-enable by uncommenting the playMusic call.
    // if (window.ArenaAudio && window.ArenaAudio.playMusic) {
    //   try { window.ArenaAudio.playMusic('lobby-ambient'); } catch (e) {}
    // }
    // Sync selected card to deck cache
    if (_selectedCard && _selectedCard.id) updateCardInDeck(_selectedCard);
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
    // Player card — full rendered card with palette, container, stats
    const cardEl = document.getElementById('bs-player-card');
    if (cardEl && _selectedCard) {
      const rarity = getCardRarity();
      // Override rarity from progression system
      _selectedCard.rarity = rarity.label || _selectedCard.rarity;
      cardEl.innerHTML = renderCardHTML(_selectedCard, 'full');
    }

    // Guest mode banner
    // Guest banner — shows whenever the user is unauthenticated (either
    // explicit guest-mode flag from the Stranger flow, OR isDemo from the
    // profile API). Was previously only gated on the flag, so a user who
    // navigated directly to play.html while logged out saw no sign-in
    // surface at all.
    var guestBanner = document.getElementById('bs-guest-banner');
    var inGuest = localStorage.getItem('bs-guest-mode') === 'true' || (typeof isDemo === 'function' && isDemo());
    if (inGuest) {
      if (!guestBanner) {
        guestBanner = document.createElement('div');
        guestBanner.id = 'bs-guest-banner';
        // Quieter info-tint surface — the previous amber/accent border read
        // as a warning rather than a soft prompt. Neutral background + faint
        // border makes the link itself the only colored element.
        guestBanner.style.cssText = 'text-align:center;padding:0.4rem 0.75rem;background:rgba(255,255,255,0.04);border:1px solid var(--bs-border);border-radius:6px;margin:0.5rem auto;max-width:360px;font-size:0.75rem;color:var(--bs-text-muted);';
        guestBanner.innerHTML = '<i class="fas fa-info-circle" style="color:var(--bs-text-muted);"></i> Playing as guest — <a href="/blindspot/login.html?redirect=/blindspot/play.html" style="color:var(--bs-accent);text-decoration:underline;">Sign in</a> to save progress across devices';
        var lobbyScreen = document.getElementById('bs-screen-lobby');
        if (lobbyScreen) lobbyScreen.insertBefore(guestBanner, lobbyScreen.firstChild);
      }
    } else if (guestBanner) {
      guestBanner.remove();
    }

    renderCardSwitcher();
    renderNewCardButton();
    renderDeckButton();
    renderLevelHud(); // updateRankDisplay kept for stats screen
    updateForgeProgress();
    updateCrateBadge();
    renderBounties();
    updateTopbarSparks();
    if (window.BsLobbyGallery) window.BsLobbyGallery.init();
    renderChallenges();
    checkAndClaimChallenges();

    // PvP unlock check
    const highestBoss = getHighestBossDefeated();
    const pvpUnlockAt = _config && _config.pvpUnlock ? _config.pvpUnlock.requireBossDefeated : 3;
    const pvpBtn = document.getElementById('bs-btn-pvp');
    const pvpLock = document.getElementById('bs-pvp-lock');
    if (highestBoss >= pvpUnlockAt) {
      if (pvpBtn) pvpBtn.disabled = false;
      if (pvpLock) {
        var elo = getPvPElo();
        var pvpRank = getPvPRank(elo);
        pvpLock.style.display = '';
        pvpLock.className = 'bs-mode-btn__rank';
        var _pvpIcon1 = (window.BsCharms && window.BsCharms.pvpRankIconHtml) ? window.BsCharms.pvpRankIconHtml(pvpRank) : '<i class="fas ' + pvpRank.icon + '" style="color:' + pvpRank.color + ';"></i>';
        pvpLock.innerHTML = _pvpIcon1 + ' ' + pvpRank.name + ' <span style="color:var(--bs-text-muted);">' + elo + '</span>';
      }
    }

    // Power rating + stats
    const statsEl = document.getElementById('bs-lobby-stats');
    if (statsEl) {
      const power = getCardPower(_selectedCard);
      const streak = getWinStreak();
      const highestB = getHighestBossDefeated();

      let streakHtml = '';
      if (streak >= 5) streakHtml = `<span class="bs-hud-streak--hot" data-tooltip="Win streak — 5+ doubles forge points"><i class="fas fa-skull"></i> ${streak} streak</span>`;
      else if (streak >= 3) streakHtml = `<span class="bs-hud-streak--warm" data-tooltip="Win streak — 3+ earns bonus sparks"><i class="fas fa-skull"></i> ${streak} streak</span>`;
      else if (streak > 0) streakHtml = `<span data-tooltip="Current win streak"><i class="fas fa-skull"></i> ${streak} streak</span>`;

      const ascension = getAscension();
      const ascHtml = ascension > 0 ? `<span class="bs-ascension-badge"><i class="fas fa-star"></i> Ascension ${ascension}</span>` : '';
      const powerHtml = power > 0 ? `<span class="bs-hud-power" data-tooltip="Total combat power"><i class="fas fa-bolt"></i> ${power} power</span>` : '';

      // PvP Elo in lobby (only show if PvP unlocked)
      let pvpHtml = '';
      var pvpReq = _config && _config.pvpUnlock ? _config.pvpUnlock.requireBossDefeated : 3;
      if (highestB >= pvpReq) {
        const elo = getPvPElo();
        const pvpRank = getPvPRank(elo);
        const _pvpIcon2 = (window.BsCharms && window.BsCharms.pvpRankIconHtml) ? window.BsCharms.pvpRankIconHtml(pvpRank) : `<i class="fas ${pvpRank.icon}"></i>`;
        pvpHtml = `<span style="color:${pvpRank.color};" data-tooltip="PvP Rating">${_pvpIcon2} ${elo}</span>`;
      }

      // Tower best floor in lobby stats
      let towerHtml = '';
      if (isTowerUnlocked()) {
        const tBest = getTowerBest();
        const tCurrent = getTowerFloor();
        if (tCurrent > 0) {
          towerHtml = `<span class="bs-hud-accent"><i class="fas fa-tower-observation"></i> F${tCurrent}</span>`;
        } else if (tBest > 0) {
          towerHtml = `<span><i class="fas fa-tower-observation"></i> Best ${tBest}</span>`;
        } else {
          towerHtml = `<span class="bs-hud-accent"><i class="fas fa-tower-observation"></i> NEW</span>`;
        }
      }

      const sparksCount = getSparks();
      const sparksHtml = sparksCount > 0 ? `<span class="bs-hud-sparks" data-tooltip="Currency — buy crates and Forge cosmetics"><i class="fas fa-fire"></i> ${sparksCount} sparks</span>` : '';

      // Compact HUD: primary line (power · sparks · streak) + secondary line (boss · pvp · tower)
      const primaryParts = [powerHtml, sparksHtml, streakHtml].filter(Boolean);
      const secondaryParts = [
        `<span><i class="fas fa-mountain"></i> Boss ${highestB}/10</span>`,
        pvpHtml,
        towerHtml,
        ascHtml
      ].filter(Boolean);

      // Per-card history line
      let cardHistoryHtml = '';
      const cardId = _selectedCard ? _selectedCard.id : null;
      const _chProg = window.BsState ? window.BsState.progress : {};
      const _ch = cardId && _chProg.cardHistory ? _chProg.cardHistory[cardId] : null;
      if (_ch && (_ch.wins > 0 || _ch.losses > 0)) {
        const chParts = [];
        chParts.push(`<span data-tooltip="This card's battles"><i class="fas fa-swords" style="font-size:0.6rem;"></i> ${_ch.wins}W / ${_ch.losses}L</span>`);
        if (_ch.bestStreak > 1) chParts.push(`<span data-tooltip="Best win streak with this card"><i class="fas fa-fire"></i> ${_ch.bestStreak} best</span>`);
        if (_ch.bossesBeaten && _ch.bossesBeaten.length > 0) chParts.push(`<span data-tooltip="Unique bosses defeated by this card"><i class="fas fa-crown"></i> ${_ch.bossesBeaten.length} bosses</span>`);
        if (_ch.nemesis) chParts.push(`<span data-tooltip="Lost to this opponent the most" style="color:var(--bs-danger,#ff5252);"><i class="fas fa-skull-crossbones"></i> ${_ch.nemesis}</span>`);
        cardHistoryHtml = `<div class="bs-hud-line bs-hud-line--card">${chParts.join('<span class="bs-hud-sep" aria-hidden="true">·</span>')}</div>`;
      }

      statsEl.innerHTML = `
        <div class="bs-hud-line bs-hud-line--primary">${primaryParts.join('<span class="bs-hud-sep" aria-hidden="true">·</span>')}</div>
        ${secondaryParts.length ? '<div class="bs-hud-line bs-hud-line--secondary">' + secondaryParts.join('<span class="bs-hud-sep" aria-hidden="true">·</span>') + '</div>' : ''}
        ${cardHistoryHtml}
      `;
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

    // Build advisor — show archetype and next passive
    const advisorEl = document.getElementById('bs-build-advisor');
    if (advisorEl && _selectedCard && _selectedCard.combatStats) {
      const arch = detectArchetype(_selectedCard.combatStats);
      const nextPass = getNextPassive(_selectedCard.combatStats);
      let advisorHtml = '<div class="bs-build-advisor__archetype">'
        + '<i class="fas ' + arch.icon + '" style="color:' + arch.color + ';"></i> '
        + '<strong>' + arch.name + '</strong> <span style="color:var(--bs-text-muted);">— ' + escHtml(arch.desc) + '</span>'
        + '</div>';
      if (nextPass) {
        const gap = nextPass.threshold - (_selectedCard.combatStats[nextPass.stat] || 0);
        advisorHtml += '<div class="bs-build-advisor__next" style="font-size:0.7rem; color:var(--bs-text-muted); margin-top:0.25rem;">'
          + '<i class="fas fa-arrow-up" style="color:var(--bs-accent);"></i> '
          + 'Next unlock: <strong style="color:' + (WEAKNESS_COLORS[nextPass.stat] || 'var(--bs-accent)') + ';">'
          + nextPass.name + '</strong> (' + WEAKNESS_LABELS[nextPass.stat] + ' ' + (_selectedCard.combatStats[nextPass.stat] || 0)
          + '/' + nextPass.threshold + ' — need ' + gap + ' more)'
          + '</div>';
      }
      advisorEl.innerHTML = advisorHtml;
      advisorEl.style.display = '';
    }

    // Passives display — show active stat-threshold passives + rarity passive
    // Only show passives after player has used the Forge at least once
    const passivesEl = document.getElementById('bs-passives-display');
    if (passivesEl && _selectedCard && _selectedCard.combatStats && getForgeVisitCount() > 0) {
      const activePassives = getActivePassives(_selectedCard.combatStats);
      const rarity = getCardRarity();
      // Build rarity passive tags
      var rarityPassiveTags = '';
      if (rarity.critBonus > 0) {
        rarityPassiveTags += '<div class="bs-passive-tag" style="display:inline-flex; align-items:center; gap:0.25rem; padding:0.15rem 0.5rem; margin:0.15rem; border-radius:12px; font-size:0.65rem; border:1px solid ' + rarity.color + '44; background:' + rarity.color + '11;">'
          + '<i class="fas ' + rarity.icon + '" style="color:' + rarity.color + '; font-size:0.6rem;"></i> '
          + '<span style="color:' + rarity.color + ';">' + rarity.name + '</span> '
          + '<span style="color:var(--bs-text-muted);">+' + rarity.critBonus + '% crit</span>'
          + '</div>';
      }
      if (rarity.statBonus > 0) {
        rarityPassiveTags += '<div class="bs-passive-tag" style="display:inline-flex; align-items:center; gap:0.25rem; padding:0.15rem 0.5rem; margin:0.15rem; border-radius:12px; font-size:0.65rem; border:1px solid ' + rarity.color + '44; background:' + rarity.color + '11;">'
          + '<i class="fas fa-arrow-up" style="color:' + rarity.color + '; font-size:0.6rem;"></i> '
          + '<span style="color:' + rarity.color + ';">' + rarity.name + '</span> '
          + '<span style="color:var(--bs-text-muted);">+' + rarity.statBonus + ' all stats</span>'
          + '</div>';
      }
      const totalPassiveCount = activePassives.length + (rarity.critBonus > 0 ? 1 : 0) + (rarity.statBonus > 0 ? 1 : 0);
      if (totalPassiveCount > 0) {
        const isExpanded = passivesEl.dataset.expanded === 'true';
        const chevron = isExpanded ? 'fa-chevron-up' : 'fa-chevron-down';
        const listDisplay = isExpanded ? '' : 'display:none;';
        passivesEl.innerHTML = '<button class="bs-passives-toggle" aria-expanded="' + isExpanded + '" aria-controls="bs-passives-list" aria-label="Toggle passives list">'
            + '<i class="fas fa-star"></i> ' + totalPassiveCount + ' passive' + (totalPassiveCount !== 1 ? 's' : '') + ' <i class="fas ' + chevron + ' bs-passives-chevron"></i>'
            + '</button>'
          + '<div class="bs-passives-list" id="bs-passives-list" style="' + listDisplay + '">'
          + rarityPassiveTags
          + activePassives.map(function(p) {
            return '<div class="bs-passive-tag" style="display:inline-flex; align-items:center; gap:0.25rem; padding:0.15rem 0.5rem; margin:0.15rem; border-radius:12px; font-size:0.65rem; border:1px solid ' + (WEAKNESS_COLORS[p.stat] || 'var(--bs-border)') + '44; background:' + (WEAKNESS_COLORS[p.stat] || 'var(--bs-border)') + '11;">'
              + '<i class="fas ' + p.icon + '" style="color:' + (WEAKNESS_COLORS[p.stat] || 'var(--bs-accent)') + '; font-size:0.6rem;"></i> '
              + '<span style="color:' + (WEAKNESS_COLORS[p.stat] || 'var(--bs-text)') + ';">' + p.name + '</span> '
              + '<span style="color:var(--bs-text-muted);">' + p.desc + '</span>'
              + '</div>';
          }).join('')
          + '</div>';
        passivesEl.style.display = '';
        // Bind toggle (delegated, safe on re-render)
        var toggleBtn = passivesEl.querySelector('.bs-passives-toggle');
        if (toggleBtn) {
          toggleBtn.onclick = function() {
            var list = document.getElementById('bs-passives-list');
            var expanded = passivesEl.dataset.expanded === 'true';
            passivesEl.dataset.expanded = expanded ? 'false' : 'true';
            if (list) list.style.display = expanded ? 'none' : '';
            toggleBtn.setAttribute('aria-expanded', !expanded);
            var chevronEl = toggleBtn.querySelector('.bs-passives-chevron');
            if (chevronEl) {
              chevronEl.classList.toggle('fa-chevron-down', expanded);
              chevronEl.classList.toggle('fa-chevron-up', !expanded);
            }
          };
        }
      } else {
        passivesEl.style.display = 'none';
      }
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

    // Next unlock teasers (lobby context)
    var teasersEl = document.getElementById('bs-unlock-teasers');
    if (teasersEl) {
      var allTeasers = getNextUnlockTeasers();
      var lobbyTeasers = allTeasers.filter(function(t) { return t.context === 'lobby' || t.context === 'campaign'; });
      if (lobbyTeasers.length > 0) {
        teasersEl.innerHTML = lobbyTeasers.map(function(t) {
          return '<div class="bs-unlock-teaser"><i class="fas ' + t.icon + '" style="color:' + t.color + ';"></i> ' + escHtml(t.text) + '</div>';
        }).join('');
        teasersEl.style.display = '';
      } else {
        teasersEl.style.display = 'none';
      }
    }

    // Next boss reward preview
    const rewardEl = document.getElementById('bs-next-reward');
    if (rewardEl) {
      const nextBoss = _bossesByNumber[highestBoss + 1];
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

    // Campaign progress (count + boss-rail pips + lobby CTA all derive from
    // getHighestBossDefeated — single source of truth).
    renderCampaignProgress(highestBoss);

    // Stats strip — high-level glance tiles in the lobby's right column.
    // Click any tile or "View all" → opens the dedicated stats screen.
    renderStatsStrip();

    // Apply equipped cosmetics to card display
    applyEquippedCosmetics();

    // Update collection badge + render up to 3 thumbnail previews of owned
    // cosmetics (most recent first). Hides the whole row when nothing owned.
    var collBadge = document.getElementById('bs-collection-count');
    var owned = getOwnedCosmetics();
    if (collBadge) {
      collBadge.textContent = String(owned.length);
      var collBtn = document.getElementById('bs-btn-collection');
      if (collBtn) {
        // Always visible — when 0 owned, dim with the locked treatment
        // so new players see the slot. Clicking still opens Collection,
        // which handles its own empty state.
        collBtn.style.display = '';
        collBtn.classList.toggle('bs-loot--locked', owned.length === 0);
      }
    }
    var collPreview = document.getElementById('bs-collection-previews');
    if (collPreview) {
      var rarityColor = {
        common: 'var(--bs-text-muted, #8a8a8a)',
        uncommon: '#4ade80',
        rare: '#60a5fa',
        epic: '#c084fc',
        legendary: '#FFD89A'
      };
      var recent = owned.slice(-3).reverse();
      var thumbHtml = '';
      for (var ti = 0; ti < recent.length; ti++) {
        var def = (_Cos.find && _Cos.find(recent[ti])) || null;
        if (!def) continue;
        var iconClass = def.icon || 'fa-gem';
        var color = rarityColor[(def.rarity || 'common').toLowerCase()] || rarityColor.common;
        var labelAttr = ' title="' + escHtml((def.name || '') + ' — ' + (def.rarity || 'common')) + '"';
        thumbHtml += '<span class="bs-collection-panel__thumb" style="color:' + color + '"' + labelAttr + '><i class="fas ' + escHtml(iconClass) + '"></i></span>';
      }
      collPreview.innerHTML = thumbHtml;
    }

    // Equipped Loadout panel \u2014 fills the otherwise-empty card column with
    // the player's current cosmetic loadout. Six rows: charm, frame, back,
    // plate, victory, title. Each row shows label + tile + name; empty
    // slots get a dimmed dash placeholder.
    renderEquippedLoadout();

    // Directory row state chips (Boss Codex defeated count, Gallery owned).
    // Sparks Shop chip is wired in updateTopbarSparks so it stays live.
    var codexChip = document.getElementById('bs-codex-progress');
    if (codexChip) {
      var defeated = getHighestBossDefeated() || 0;
      codexChip.textContent = defeated + ' / 10';
      codexChip.hidden = false;
    }
    var galleryChip = document.getElementById('bs-gallery-count');
    if (galleryChip) {
      var deck = (_profile && Array.isArray(_profile.deck)) ? _profile.deck.length : 0;
      if (deck > 0) {
        galleryChip.textContent = deck + ' Owned';
        galleryChip.hidden = false;
      } else {
        galleryChip.hidden = true;
      }
    }
  }

  function renderEquippedLoadout() {
    var panel = document.getElementById('bs-loadout-panel');
    var rows = document.getElementById('bs-loadout-rows');
    if (!panel || !rows) return;

    var equipped = (_Cos && _Cos.getEquipped) ? (_Cos.getEquipped() || {}) : {};
    var equippedCharm = (_Chm && _Chm.getEquipped) ? _Chm.getEquipped() : null;
    var hasArtHelper = !!(window.BsCharms && window.BsCharms.assetArtHtml);
    var hasPreviewHelper = !!(window.BsCosmetics && window.BsCosmetics.cosmeticPreviewHtml);

    function tileHtml(category, id, name, fallbackIcon) {
      if (!id) {
        return '<span class="blindspot-loadout__tile blindspot-loadout__tile--empty" aria-hidden="true"><i class="fas fa-circle-dashed"></i></span>';
      }
      // Titles render as their FA icon in this compact panel — the painted
      // wax-seals read poorly at this size. Seals stay on the card and in
      // the Collection screen.
      if (category === 'titles') {
        return '<span class="blindspot-loadout__tile" title="' + escHtml(name || id) + '"><i class="fas ' + escHtml(fallbackIcon || 'fa-medal') + '"></i></span>';
      }
      // Cosmetic categories with live previews use those; everything else
      // falls through to assetArtHtml for the static art.
      if (hasPreviewHelper && (category === 'frames' || category === 'backs' || category === 'plates' || category === 'victory')) {
        var preview = window.BsCosmetics.cosmeticPreviewHtml(id);
        if (preview) {
          return '<span class="blindspot-loadout__tile" title="' + escHtml(name || id) + '">' + preview + '</span>';
        }
      }
      if (hasArtHelper) {
        var art = window.BsCharms.assetArtHtml(category, id, fallbackIcon || 'fa-star', name || id);
        return '<span class="blindspot-loadout__tile" title="' + escHtml(name || id) + '">' + art + '</span>';
      }
      return '<span class="blindspot-loadout__tile" title="' + escHtml(name || id) + '"><i class="fas ' + escHtml(fallbackIcon || 'fa-star') + '"></i></span>';
    }

    function cosmeticDef(id) {
      if (!id) return null;
      return (_Cos && _Cos.find) ? _Cos.find(id) : null;
    }
    function defName(id) {
      var def = cosmeticDef(id);
      return def ? def.name : id;
    }
    function charmDef(id) {
      if (!id || !_Chm || !_Chm.getDef) return null;
      return _Chm.getDef(id);
    }
    var equippedTitleDef = cosmeticDef(equipped.title);

    var slots = [
      { label: 'Charm',   id: equippedCharm, name: charmDef(equippedCharm) ? charmDef(equippedCharm).name : null, category: 'items',   fallbackIcon: charmDef(equippedCharm) ? charmDef(equippedCharm).icon : 'fa-flask' },
      { label: 'Frame',   id: equipped.frame,     name: defName(equipped.frame),     category: 'frames',  fallbackIcon: 'fa-border-all' },
      { label: 'Back',    id: equipped.back,      name: defName(equipped.back),      category: 'backs',   fallbackIcon: 'fa-circle' },
      { label: 'Plate',   id: equipped.nameplate, name: defName(equipped.nameplate), category: 'plates',  fallbackIcon: 'fa-tag' },
      { label: 'Victory', id: equipped.victory,   name: defName(equipped.victory),   category: 'victory', fallbackIcon: 'fa-burst' },
      { label: 'Title',   id: equipped.title,     name: defName(equipped.title),     category: 'titles',  fallbackIcon: (equippedTitleDef && equippedTitleDef.icon) || 'fa-medal' }
    ];

    rows.innerHTML = slots.map(function(s) {
      return '<div class="blindspot-loadout__row">'
        + '<span class="blindspot-loadout__label">' + escHtml(s.label) + '</span>'
        + tileHtml(s.category, s.id, s.name, s.fallbackIcon)
        + '<span class="blindspot-loadout__name' + (s.id ? '' : ' blindspot-loadout__name--empty') + '">' + escHtml(s.name || 'None') + '</span>'
        + '</div>';
    }).join('');

    panel.hidden = false;
  }

  // Single source of truth for campaign progress \u2014 drives the count meta,
  // boss-rail checkmark state on each pip, and the lobby Fight CTA label.
  function renderCampaignProgress(highestBoss) {
    const beaten = Math.max(0, Math.min(10, Number(highestBoss) || 0));

    // Count meta (X / 10 BOSSES)
    const countEl = document.getElementById('bs-campaign-count');
    if (countEl) countEl.textContent = beaten + ' / 10 BOSSES';

    // Per-pip three-state visual: defeated / current (next-up) / locked.
    // Defeated pips render with the green check; current pip gets a gold
    // call-to-action treatment; locked pips dim further with a lock badge
    // and don't lie on hover. Click routing in bs-nav.js mirrors this
    // (defeated + current → prefight, locked → toast, no navigation).
    const pips = document.querySelectorAll('.blindspot-boss-pip[data-boss-index]');
    pips.forEach(function (pip) {
      const idx = Number(pip.getAttribute('data-boss-index')) || 0;
      const defeated = idx > 0 && idx <= beaten;
      const current = idx === beaten + 1;
      const locked = idx > beaten + 1;
      pip.classList.toggle('is-done', defeated);
      pip.classList.toggle('blindspot-boss-pip--current', current);
      pip.classList.toggle('blindspot-boss-pip--locked', locked);
    });

    // CTA-LABEL \u2014 keep in sync with bs-nav.js enterArena cascade.
    // End-game players (10+ bosses) get a CTA that points at their next
    // real progression action, not a passive "REPLAY CAMPAIGN" status.
    // Cascade: weekly -> tower -> ascend -> replay.
    const playBtnLabel = document.getElementById('bs-play-btn-label');
    if (playBtnLabel) {
      if (beaten >= 10) {
        var weeklyBoss = getWeeklyBoss();
        var weeklyRec = weeklyBoss ? getWeeklyRecord() : null;
        var weeklyOpen = weeklyBoss && (!weeklyRec || (weeklyRec.wins || 0) === 0);
        var asc = getAscension();
        var towerOpen = isTowerUnlocked();

        if (weeklyOpen) {
          playBtnLabel.textContent = 'FIGHT ' + (weeklyBoss.name || 'Weekly Boss').toUpperCase();
        } else if (towerOpen) {
          playBtnLabel.textContent = 'ENTER INFINITE TOWER';
        } else if (asc < 5) {
          playBtnLabel.textContent = asc === 0 ? 'ASCEND' : 'ASCEND TO ASC ' + (asc + 1);
        } else {
          playBtnLabel.textContent = 'REPLAY CAMPAIGN';
        }
      } else {
        const nextBoss = _bossesByNumber[beaten + 1];
        playBtnLabel.textContent = nextBoss
          ? 'FIGHT ' + nextBoss.name.toUpperCase()
          : 'FIGHT NEXT BOSS';
      }
    }
  }

  // Boss Codex modal — renders all campaign bosses as a list. Defeated
  // bosses show full intel; locked bosses show a teaser silhouette.
  function renderBossCodex() {
    var listEl = document.getElementById('bs-codex-list');
    if (!listEl) return;

    var beaten = getHighestBossDefeated() || 0;
    // Pull only campaign bosses, ordered by their boss number.
    var entries = [];
    for (var n = 1; n <= 10; n++) {
      var b = _bossesByNumber[n];
      if (b) entries.push({ n: n, boss: b });
    }
    if (!entries.length) {
      listEl.innerHTML = '<div class="bs-codex-empty">Codex unavailable — boss data not loaded.</div>';
      return;
    }

    var html = entries.map(function(entry) {
      var b = entry.boss;
      var defeated = entry.n <= beaten;
      var statusClass = defeated ? 'bs-codex-row--defeated' : 'bs-codex-row--locked';
      var statusBadge = defeated
        ? '<span class="bs-codex-row__status"><i class="fas fa-check-circle"></i> Defeated</span>'
        : '<span class="bs-codex-row__status bs-codex-row__status--locked"><i class="fas fa-lock"></i> Locked</span>';

      var detailHtml;
      if (defeated) {
        var weakness = b.weakness ? String(b.weakness).toUpperCase() : '—';
        var sigName = (b.signaturePassive && b.signaturePassive.name) || '—';
        var sigDesc = (b.signaturePassive && b.signaturePassive.desc) || '';
        var element = b.element ? String(b.element).replace(/^./, function(c){ return c.toUpperCase(); }) : '—';
        var rewardLabel = (b.reward && b.reward.label) || '—';
        detailHtml =
            '<p class="bs-codex-row__flavor">' + escHtml(b.flavor || '') + '</p>'
          + '<dl class="bs-codex-row__intel">'
            + '<dt>Element</dt><dd>' + escHtml(element) + '</dd>'
            + '<dt>Weakness</dt><dd>' + escHtml(weakness) + '</dd>'
            + '<dt>Signature</dt><dd>' + escHtml(sigName) + (sigDesc ? ' &mdash; ' + escHtml(sigDesc) : '') + '</dd>'
            + '<dt>First-kill reward</dt><dd>' + escHtml(rewardLabel) + '</dd>'
          + '</dl>';
      } else {
        detailHtml = '<p class="bs-codex-row__flavor bs-codex-row__flavor--locked">Defeat to reveal lore, weakness, and signature move.</p>';
      }

      var pad = String(entry.n).padStart(2, '0');
      return '<div class="bs-codex-row ' + statusClass + '" role="listitem">'
        + '<div class="bs-codex-row__head">'
          + '<span class="bs-codex-row__num">' + pad + '</span>'
          + '<h3 class="bs-codex-row__name">' + escHtml(defeated ? (b.name || 'Boss ' + entry.n) : '???') + '</h3>'
          + statusBadge
        + '</div>'
        + detailHtml
        + '</div>';
    }).join('');

    listEl.innerHTML = html;
  }

  // Derive rank from lifetime XP. Self-heals legacy accounts whose stored
  // profile.rank lagged the threshold table — server-side rank-up wasn't
  // applied retroactively, so we recompute every render rather than trust
  // _profile.rank alone.
  function deriveRankFromXp(xp) {
    var n = Number(xp) || 0;
    for (var i = RANK_ORDER.length - 1; i >= 0; i--) {
      if (n >= RANKS[RANK_ORDER[i]].xp) return RANK_ORDER[i];
    }
    return 'bronze';
  }

  function updateRankDisplay() {
    if (!_profile) return;
    const badge = document.getElementById('bs-rank-badge');
    const xpFill = document.getElementById('bs-xp-fill');
    const xpText = document.getElementById('bs-xp-text');
    const xpBar = xpFill && xpFill.parentElement;
    const remainEl = document.getElementById('bs-xp-remaining');
    const streakEl = document.getElementById('bs-streak');
    const bestEl = document.getElementById('bs-best');

    const rank = deriveRankFromXp(_profile.xp);
    const rankInfo = RANKS[rank] || RANKS.bronze;
    const nextIdx = RANK_ORDER.indexOf(rank) + 1;
    const nextRank = nextIdx < RANK_ORDER.length ? RANKS[RANK_ORDER[nextIdx]] : null;

    if (badge) badge.innerHTML = `<i class="fas ${rankInfo.icon}" style="color:${rankInfo.color}"></i> <span>${rankInfo.label}</span>`;

    const nextEl = document.getElementById('bs-rank-next');
    if (nextEl) {
      if (nextRank) {
        nextEl.textContent = '→ ' + nextRank.label;
        nextEl.style.display = '';
      } else {
        nextEl.style.display = 'none';
      }
    }

    // Single computed XP object \u2014 all three (label, fill, headline) read from this.
    const currentXp = _profile.xp || 0;
    let xp;
    if (nextRank) {
      const span = nextRank.xp - rankInfo.xp;
      const into = Math.max(0, currentXp - rankInfo.xp);
      const required = Math.max(0, span);
      const remaining = Math.max(0, nextRank.xp - currentXp);
      const percent = required > 0 ? Math.min(100, Math.max(0, (into / required) * 100)) : 0;
      xp = { current: into, required: required, remaining: remaining, percent: percent, atMax: false };
    } else {
      xp = { current: currentXp, required: currentXp, remaining: 0, percent: 100, atMax: true };
    }

    if (xpFill) xpFill.style.width = xp.percent + '%';
    if (xpBar && xpBar.classList.contains('blindspot-bar')) xpBar.setAttribute('aria-valuenow', String(Math.round(xp.percent)));
    if (xpText) xpText.textContent = xp.atMax ? `${xp.current} XP \u2014 Max Rank` : `${xp.current} / ${xp.required} XP`;
    if (remainEl) remainEl.textContent = xp.atMax ? 'Max rank' : `${xp.remaining} XP`;

    // Header rank + power chips (HEADER-CHIPS) \u2014 surfaces the player's
    // identity numbers in the highest-attention spot. Hidden until populated
    // so guest / new players don't see empty placeholders.
    var rankChip = document.getElementById('bs-header-rank-chip');
    var rankLabel = document.getElementById('bs-header-rank-label');
    var rankIcon = document.getElementById('bs-header-rank-icon');
    if (rankChip && rankLabel) {
      rankLabel.textContent = rankInfo.label;
      rankLabel.style.color = rankInfo.color;
      // RANKS entries lack an `id` field -- pass the rank key explicitly
      // so _setRankBadge can resolve the pvp-ranks asset for it (the
      // lobby header chip uses the XP-based RANKS, NOT LEVEL_TIERS).
      if (rankIcon) _setRankBadge(rankIcon, rankInfo, { category: 'pvp-ranks', assetId: rank });
      rankChip.hidden = false;
    }
    var powerChip = document.getElementById('bs-header-power-chip');
    var powerEl = document.getElementById('bs-header-power');
    if (powerChip && powerEl) {
      var pwr = _selectedCard ? getCardPower(_selectedCard) : 0;
      if (pwr > 0) {
        powerEl.textContent = String(pwr);
        powerChip.hidden = false;
      } else {
        powerChip.hidden = true;
      }
    }

    // Streak / best \u2014 wired to live progress (was hardcoded mock markup).
    // Zero-state class so CSS can demote the red emphasis: red on
    // a `0` reads as "this is bad / dangerous" when it's actually
    // just "you don't have any yet."
    if (streakEl) {
      const streakVal = getWinStreak() || 0;
      streakEl.textContent = String(streakVal);
      streakEl.classList.toggle('is-zero', streakVal === 0);
    }
    if (bestEl) {
      const bestVal = getBestStreak() || 0;
      bestEl.textContent = String(bestVal);
      bestEl.classList.toggle('is-zero', bestVal === 0);
    }
  }

  // Swap an FA rank icon element to the illustrated rank-badge WebP. The
  // existing element gets replaced via outerHTML so subsequent renderers
  // re-resolve via getElementById and the id is preserved across swaps.
  // Falls back to the original className + style.color pattern when
  // BsCharms is unavailable or the asset id isn't in the registry.
  // opts:
  //   category — asset registry category (default 'ranks')
  //   assetId  — asset id lookup key (default tier.id; pass for systems
  //              like RANKS where the tier object has no `id` field
  //              and the caller knows the lowercase key)
  function _setRankBadge(el, tier, opts) {
    if (!el || !tier) return;
    opts = opts || {};
    var category = opts.category || 'ranks';
    var assetId = opts.assetId || tier.id;
    var bc = window.BsCharms;
    if (bc && bc.assetArtHtml && assetId) {
      var raw = bc.assetArtHtml(category, assetId, tier.icon, tier.label);
      if (raw.indexOf('<img') === 0) {
        // Preserve the id so re-render lookups still work
        var withId = raw.replace('<img', '<img id="' + el.id + '"');
        el.outerHTML = withId;
        return;
      }
    }
    // Fallback: keep the legacy FA icon behavior
    el.className = 'fas ' + (tier.icon || 'fa-shield-halved');
    el.style.color = tier.color || '';
  }

  function renderLevelHud() {
    if (!_profile) return;

    var levelNum = document.getElementById('bs-level-num');
    var tierEl   = document.getElementById('bs-level-tier');
    var iconEl   = document.getElementById('bs-level-icon');
    var xpText   = document.getElementById('bs-level-xp-text');
    var xpFill   = document.getElementById('bs-level-xp-fill');

    if (!levelNum) return; // Markup not present (e.g. on splash) — no-op

    var xp = _profile.xp || 0;
    var level = (_S.computeLevel && _S.computeLevel(xp)) || 1;
    var tier = (_S.getTier && _S.getTier(level)) || { label: 'Initiate', icon: 'fa-shield-halved', color: '#A09888' };
    var toNext = (_S.getXpToNextLevel && _S.getXpToNextLevel(xp)) || 0;
    var per = (window.BsConst && window.BsConst.LEVEL_XP_PER_LEVEL) || 50;
    var earnedThisLevel = per - toNext;
    var pct = Math.max(0, Math.min(100, (earnedThisLevel / per) * 100));

    levelNum.textContent = 'Lv ' + level;
    tierEl.textContent = tier.label;
    if (iconEl) _setRankBadge(iconEl, tier);
    if (xpText) xpText.textContent = toNext + ' XP to Lv ' + (level + 1);
    if (xpFill) xpFill.style.width = pct + '%';
  }

  function updateForgeProgress() {
    const wins = getForgeWins();
    const needed = _config ? _config.forgeVisit.winsRequired : 3;
    const campaignComplete = getHighestBossDefeated() >= 10;
    // Once unlocked, forge stays unlocked forever
    const ready = isForgeUnlocked() || campaignComplete || wins >= needed || isForgePending();

    // Set permanent unlock flag on first ready
    if (ready && !isForgeUnlocked()) setForgeUnlocked();

    const label = document.getElementById('bs-forge-label');
    const fill = document.getElementById('bs-forge-fill');
    const container = document.getElementById('bs-forge-progress');
    const hint = document.getElementById('bs-forge-hint');

    const displayWins = Math.min(Math.floor(wins), needed);
    const pct = ready ? 100 : Math.min(100, (wins / needed) * 100);
    // Once unlocked, the wins/needed count is misleading (it looks like
    // progress toward an unlock that's already been granted). Swap the
    // label to a "ready" state instead.
    if (label) label.textContent = ready ? 'CARD FORGE READY' : 'CARD FORGE \u00b7 ' + displayWins + '/' + needed;
    if (hint) hint.textContent = ready ? 'Customize your card' : 'Win campaign fights to unlock';
    if (fill) fill.style.setProperty('--bar-pct', pct / 100);
    if (container) {
      container.classList.toggle('bs-forge-progress--ready', ready);
      container.onclick = ready ? () => openForgeScreen(false, true) : null;
      if (ready) { container.removeAttribute('data-tooltip'); } else { container.setAttribute('data-tooltip', 'Customize stats, palette, art & name. Win ' + needed + ' fights to unlock.'); }
    }
  }

  // ============================================================
  // LOBBY ONBOARDING — delegated to bs-lobby-onboarding.js (window.BsLobbyOnboarding)
  // ============================================================

  var _Onb = window.BsLobbyOnboarding || {};
  function showLobbyOnboarding() { if (_Onb.show) _Onb.show(); }

  // ── Pre-Fight Buttons — delegated to bs-prefight-buttons.js (window.BsPrefightButtons) ──
  var _Pf = window.BsPrefightButtons || {};
  if (_Pf.setCallbacks) _Pf.setCallbacks({
    hideOverlay: function(id) { hideOverlay(id); },
    getSelectedCard: function() { return _selectedCard; },
    ensureCombatStats: ensureCombatStats,
    getBossById: function(id) { return _bossesById[id]; },
    getAscension: getAscension,
    isWeeklyBoss: isWeeklyBoss,
    setAdventureItems: function(items) { if (_Chm.setAdventureItems) _Chm.setAdventureItems(items); },
    startCampaignBattle: function(bossId, buffs) { startCampaignBattle(bossId, buffs); }
  });
  function setupPrefightButtons(bossId) { if (_Pf.setup) _Pf.setup(bossId); }

  // ============================================================
  // NAVIGATION — delegated to bs-nav.js (window.BsNav)
  // ============================================================

  var _Nav = window.BsNav || {};
  function bindPlayNavigation() { if (_Nav.bind) _Nav.bind(); }
  if (_Nav.setCallbacks) _Nav.setCallbacks({
    showScreen: function(id) { showScreen(id); },
    showOverlay: function(id) { showOverlay(id); },
    hideOverlay: function(id) { hideOverlay(id); },
    renderLobby: function() { renderLobby(); },
    renderCampaignLadder: function() { renderCampaignLadder(); },
    renderPvPGallery: function() { renderPvPGallery(); },
    renderGallery: function() { renderGallery(); },
    renderStatsScreen: function() { renderStatsScreen(); },
    renderLeaderboard: function() { renderLeaderboard(); },
    renderCollection: function() { renderCollection(); },
    renderDeckManagement: function() { renderDeckManagement(); },
    renderShop: function() { renderShop(); },
    setShopTab: function(tab) { setShopTab(tab); },
    openCrateOverlay: function(i) { openCrateOverlay(i); },
    getCrateCount: function() { return getCrateCount(); },
    openForgeScreen: function(a, b) { openForgeScreen(a, b); },
    updateForgeProgress: function() { updateForgeProgress(); },
    populatePrefightOverlay: function(boss) { populatePrefightOverlay(boss); },
    setupPrefightButtons: function(id) { setupPrefightButtons(id); },
    startCampaignBattle: function(id) { startCampaignBattle(id); },
    startTowerBattle: function() { startTowerBattle(); },
    refreshLobby: function() { refreshLobby(); },
    showAscensionOffer: function(n) { showAscensionOffer(n); },
    showErrorToast: function(msg) { showErrorToast(msg); },
    safeLSSet: function(k, v) { safeLSSet(k, v); },
    setCosmeticSlot: function(s) { if (_Cos.setSlot) _Cos.setSlot(s); },
    setCosmeticFilter: function(f) { if (_Cos.setFilter) _Cos.setFilter(f); },
    getHighestBossDefeated: function() { return getHighestBossDefeated(); },
    getForgeWins: function() { return getForgeWins(); },
    getForgeWinsRequired: function() { return _config ? _config.forgeVisit.winsRequired : 3; },
    isForgePending: function() { return isForgePending(); },
    getTowerFloor: function() { return getTowerFloor(); },
    isWeeklyBoss: function(id) { return isWeeklyBoss(id); },
    getWeeklyBoss: function() { return getWeeklyBoss(); },
    getWeeklyRecord: function() { return getWeeklyRecord(); },
    getAscension: function() { return getAscension(); },
    isTowerUnlocked: function() { return isTowerUnlocked(); },
    getBattleType: function() { return _battleType; },
    getCurrentBossId: function() { return _currentBossId; },
    getBossById: function(id) { return _bossesById[id]; },
    getBossByNumber: function(n) { return _bossesByNumber[n]; },
    isFirstRealFight: function() { return _isFirstRealFight; },
    clearFirstRealFight: function() { _isFirstRealFight = false; },
    initPvPTabs: function() { if (_Pvp.initPvPTabs) _Pvp.initPvPTabs(); },
    renderDefenseQueue: function() { if (_Pvp.renderDefenseQueue) _Pvp.renderDefenseQueue(); },
    pollInboxCount: function() { if (_Pvp.pollInboxCount) _Pvp.pollInboxCount(); },
    getPvpUnlockRequirement: function() { return _config && _config.pvpUnlock ? _config.pvpUnlock.requireBossDefeated : 3; },
    renderBossCodex: function() { renderBossCodex(); }
  });

  // ============================================================
  // CAMPAIGN + TOWER — delegated to bs-campaign.js (window.BsCampaign)
  // ============================================================

  var _Camp = window.BsCampaign || {};
  function renderCampaignLadder() { if (_Camp.renderLadder) _Camp.renderLadder(); }
  function renderTowerSection() { if (_Camp.renderTower) _Camp.renderTower(); }

  function startTowerBattle() {
    if (!_selectedCard) { showErrorToast('Select a card first.'); return; }
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
    populatePrefightOverlay(boss);
    // Override flavor text with tower-specific format
    var flavorEl = document.getElementById('bs-prefight-flavor');
    if (flavorEl) flavorEl.innerHTML = 'Floor ' + nextFloor + ' &mdash; &ldquo;' + escHtml(boss.flavor) + '&rdquo;' + (CLASS_PATTERNS[boss.class] ? '<br><span style="font-size:0.8rem;color:var(--bs-text-muted);display:inline-block;"><i class="fas fa-chess"></i> Tends to: ' + CLASS_PATTERNS[boss.class] + '</span>' : '');

    showOverlay('bs-prefight-overlay');
    var oldBtn = document.getElementById('bs-prefight-go');
    if (!oldBtn || !oldBtn.parentNode) return;
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
        var battleData = await window.ArenaAPI.startBattle('pve', _selectedCard.id, boss.id, { cardData: _selectedCard });
        _activeBattle = battleData;
        window.ArenaBattleUI.initBattle(battleData);
        // Telegraph: show boss's first committed move
        if (battleData.bossIntent) window.ArenaBattleUI.showBossIntent(battleData.bossIntent);
        addItemButtonsToBattle();
        addCharmButtonToBattle();
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

      // Tower XP scales with floor difficulty: +10 × floor, capped at +200
      // (so floor 20+ runs all reward the same — keeps high-floor grinding
      // from dominating the ladder).
      addXp(Math.min(200, newFloor * 10));

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

  async function startCampaignBattle(bossId, tempBuffs) {
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
      // Always send cardData as fallback — prevents "Card not found" if server save was delayed
      // Detect equipped element resist charm and extract its element for server
      var _eqCharm = _Chm.getEquipped ? _Chm.getEquipped() : null;
      var _eqCharmDef = _eqCharm && _Chm.getDef ? _Chm.getDef(_eqCharm) : null;
      var _eqElCharm = (_eqCharmDef && _eqCharmDef.effect === 'element_resist' && _eqCharmDef.element) ? _eqCharmDef.element : undefined;
      // Merge adventure items (from adventure encounters) + inventory items (from prefight picker)
      var _advItems = (_Chm.getAdventureItems ? _Chm.getAdventureItems() : []) || [];
      var _invItems = (_Chm.getSelectedItems ? _Chm.getSelectedItems() : []) || [];
      var _allItems = _advItems.concat(_invItems);
      const battleData = await window.ArenaAPI.startBattle('pve', _selectedCard.id, bossId, { cardData: _selectedCard, tempBuffs: tempBuffs || {}, adventureItems: _allItems, equippedElementCharm: _eqElCharm });
      _activeBattle = battleData;
      window.ArenaBattleUI.initBattle(battleData);
      // Telegraph: show boss's first committed move
      if (battleData.bossIntent) window.ArenaBattleUI.showBossIntent(battleData.bossIntent);
      // Render item buttons BEFORE consuming (consume clears the selection array)
      addItemButtonsToBattle();
      addCharmButtonToBattle();
      // Now consume selected items + equipped charm from inventory
      if (_Chm.consumeSelectedItems) _Chm.consumeSelectedItems();
      if (_eqCharm) { _Chm.remove(_eqCharm); _Chm.setEquipped(null); }
      updateCombatTooltips();
      applyBattlePalette();
      // Tutorial hint for first 3 campaign battles; normal hint otherwise
      var tutBattle = getTutorialBattleCount();
      if (tutBattle < TUTORIAL_MAX_BATTLES) {
        incrementTutorialBattleCount();
        showTutorialHint(TUTORIAL_ROUND1_HINTS[tutBattle] || TUTORIAL_ROUND1_HINTS[0]);
      } else {
        showBattleHint('round1');
      }
    } catch (err) {
      console.error('[Blindspot] Campaign battle error:', err);
      showErrorToast('Battle error: ' + (err.message || 'Unknown error'));
      showScreen('campaign');
    }
  }

  // ============================================================
  // BATTLE RESULTS — delegated to bs-battle-results.js (window.BsBattleResults)
  // ============================================================

  var _Br = window.BsBattleResults || {};
  function playVictoryAnimation() { if (_Br.playVictoryAnimation) _Br.playVictoryAnimation(); }
  async function handlePlayPageResult(battleResult, battleData) { if (_Br.handleResult) return _Br.handleResult(battleResult, battleData); }

  // ============================================================
  // PVP — delegated to bs-pvp.js (window.BsPvp)
  // ============================================================

  function renderPvPGallery() { if (_Pvp.renderGallery) return _Pvp.renderGallery(); }
  function updatePvPRatingDisplay() { if (_Pvp.updateRatingDisplay) _Pvp.updateRatingDisplay(); }
  function showPvPComparison(opponentId) { if (_Pvp.showComparison) _Pvp.showComparison(opponentId); }

  async function startPvPBattle(opponentId) {
    if (!_selectedCard) { showErrorToast('Select a card first.'); return; }
    _currentBossId = null;
    _battleType = 'pvp';
    _pvpOpponentId = opponentId;

    // Find opponent info from gallery
    var opponent = _pvpGalleryGet().find(function(c) { return c.id === opponentId; }) || {};
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
            '<span style="font-size:0.7rem;color:var(--bs-text-muted);font-family:\'Share Tech Mono\',monospace;"><i class="fas fa-crosshairs" style="color:var(--bs-accent);margin-right:0.3em;"></i>Seeking a worthy opponent\u2026</span>' +
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
    var battlePromise = window.ArenaAPI.startBattle('pvp', _selectedCard.id, opponentId, { cardData: _selectedCard });

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

  // ── Async PvP Battle (defense queue challenges + revenge) ──

  async function startAsyncBattle(defenderId, isRevenge) {
    if (!_selectedCard) { showErrorToast('Select a card first.'); return; }
    _battleType = 'async_pvp';

    // Find defender from queue cache
    var queue = _Pvp.getDefenseQueue ? _Pvp.getDefenseQueue() : [];
    var defender = queue.find(function(e) { return e.userId === defenderId; });

    // If revenge, defender might not be in queue — get from inbox cache
    if (!defender && isRevenge) {
      var inbox = _Pvp.getInbox ? _Pvp.getInbox() : [];
      var inboxEntry = inbox.find(function(r) { return r.opponentUserId === defenderId; });
      if (inboxEntry) {
        defender = {
          cardName: inboxEntry.opponentName,
          cardClass: inboxEntry.opponentClass || '',
          avatar: inboxEntry.opponentAvatar || '',
          userId: inboxEntry.opponentUserId
        };
      }
    }

    var playerName = _selectedCard.name || 'You';
    var playerAvatar = _selectedCard.avatar || '';
    var oppName = defender ? defender.cardName : 'Defender';
    var oppAvatar = defender ? defender.avatar : '';
    var oppClass = defender ? (defender.cardClass || '') : '';

    // Matchmaking overlay
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
            '<span style="font-size:0.7rem;color:var(--bs-text-muted);font-family:\'Share Tech Mono\',monospace;">' +
              (isRevenge ? '<i class="fas fa-fire" style="color:var(--bs-danger);margin-right:0.3em;"></i>Seeking revenge\u2026' : '<i class="fas fa-shield-halved" style="color:var(--bs-accent);margin-right:0.3em;"></i>Challenging defender\u2026') +
            '</span>' +
          '</div>' +
          '<div class="bs-mm-fighter bs-mm-fighter--right bs-mm-fighter--hidden">' +
            (oppAvatar ? '<img src="' + escHtml(oppAvatar) + '" alt="" class="bs-mm-fighter__img">' : '<div class="bs-mm-fighter__icon"><i class="fas fa-shield-halved"></i></div>') +
            '<span class="bs-mm-fighter__name">' + escHtml(oppName) + '</span>' +
            (oppClass ? '<span class="bs-mm-fighter__class">' + escHtml(oppClass) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<p class="bs-mm-status">' + (isRevenge ? 'Preparing revenge' : 'Connecting to defender') + '<span class="bs-mm-dots"></span></p>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('bs-matchmaking--active'); });

    if (window.ArenaAudio && window.ArenaBackgrounds) {
      window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
    }

    // Start the async battle API call
    var battlePromise = window.ArenaAPI.startAsyncBattle(
      _selectedCard.id, defenderId,
      { cardData: _selectedCard, isRevenge: isRevenge === true }
    );

    // Animate reveal
    await new Promise(function(r) { setTimeout(r, 1500); });
    var rightFighter = overlay.querySelector('.bs-mm-fighter--right');
    if (rightFighter) rightFighter.classList.remove('bs-mm-fighter--hidden');
    var scanner = overlay.querySelector('.bs-mm-scanner');
    if (scanner) scanner.style.display = 'none';
    var vsText = overlay.querySelector('.bs-mm-vs__text');
    if (vsText) vsText.classList.add('bs-mm-vs__text--visible');
    var statusEl = overlay.querySelector('.bs-mm-status');
    if (statusEl) statusEl.textContent = isRevenge ? 'Revenge time!' : 'Defender found!';

    await new Promise(function(r) { setTimeout(r, 1500); });

    try {
      var battleData = await battlePromise;
      _activeBattle = battleData;
      overlay.classList.add('bs-matchmaking--exit');
      setTimeout(function() { overlay.remove(); }, 400);
      showScreen('battle');
      window.ArenaBattleUI.initBattle(battleData);
      updateCombatTooltips();
    } catch (err) {
      console.error('[Blindspot] Async PvP error:', err);
      overlay.remove();
      showErrorToast(err.message || 'Async PvP battle failed.');
      showScreen('pvp');
    }
  }

  // ============================================================
  // LIVE PVP — real-time player vs player
  // ============================================================

  async function startLiveBattle(battleId) {
    _battleType = 'live_pvp';
    _currentBossId = null;

    if (window.ArenaAudio && window.ArenaBackgrounds) {
      window.ArenaAudio.playArenaMusic(window.ArenaBackgrounds.getSelected());
    }

    try {
      // Poll for initial battle state
      var data = await window.ArenaAPI.pollBattle(battleId);
      if (!data || data.status === 'expired') {
        showErrorToast('Battle expired.');
        _Pvp.clearActiveBattle();
        showScreen('pvp');
        return;
      }

      // Build battleData in the format ArenaBattleUI expects
      var battleData = buildLiveBattleData(data, battleId);
      _activeBattle = battleData;

      showScreen('battle');
      window.ArenaBattleUI.initBattle(battleData);
      updateCombatTooltips();

      // Show waiting indicator if it's the start of a round
      showLiveWaiting(data);

      // Start polling
      _Pvp.startBattlePoll(battleId);
    } catch (err) {
      console.error('[Blindspot] Live PvP error:', err);
      showErrorToast('Live PvP battle failed.');
      _Pvp.clearActiveBattle();
      showScreen('pvp');
    }
  }

  async function resumeLiveBattle(battleId) {
    try {
      var data = await window.ArenaAPI.pollBattle(battleId);
      if (!data || data.status === 'complete' || data.status === 'expired') {
        _Pvp.clearActiveBattle();
        if (data && data.status === 'complete') {
          onLiveBattleComplete(data);
        }
        return;
      }
      startLiveBattle(battleId);
    } catch (err) {
      _Pvp.clearActiveBattle();
    }
  }

  function buildLiveBattleData(pollData, battleId) {
    var config = window._config || {};
    return {
      battleId: battleId,
      type: 'live_pvp',
      player: {
        name: (pollData.myCard && pollData.myCard.name) || 'You',
        class: (pollData.myCard && pollData.myCard.class) || '',
        avatar: (pollData.myCard && pollData.myCard.avatar) || '',
        combatStats: pollData.myCombatStats || {},
        maxHp: pollData.myMaxHp,
        hp: pollData.myHp,
        passives: pollData.myPassives || [],
        abilityKey: pollData.myAbilityKey,
        element: pollData.myElement,
        abilityDef: pollData.abilityDefs ? pollData.abilityDefs[pollData.myAbilityKey] : null
      },
      opponent: {
        name: (pollData.opponentCard && pollData.opponentCard.name) || 'Opponent',
        class: (pollData.opponentCard && pollData.opponentCard.class) || '',
        avatar: (pollData.opponentCard && pollData.opponentCard.avatar) || '',
        combatStats: pollData.opponentCombatStats || {},
        maxHp: pollData.opponentMaxHp,
        hp: pollData.opponentHp,
        element: pollData.opponentElement,
        abilityKey: pollData.opponentAbilityKey
      },
      charges: { player: pollData.myCharges || 0, opponent: pollData.opponentCharges || 0 },
      chargeRate: 1,
      abilityCost: pollData.abilityCost || 2,
      maxCharges: pollData.maxCharges || 4,
      stamina: { player: pollData.myStamina || 20, opponent: pollData.opponentStamina || 20 },
      maxStamina: { player: pollData.myMaxStamina || 20, opponent: pollData.opponentMaxStamina || 20 },
      staminaRegen: { player: 2, opponent: 2 },
      cooldowns: { player: pollData.myCooldowns || {}, opponent: pollData.opponentCooldowns || {} },
      stances: { player: pollData.myStance || 'balanced', opponent: pollData.opponentStance || 'balanced' },
      elements: { player: pollData.myElement || 'chaos', opponent: pollData.opponentElement || 'chaos' },
      currentRound: pollData.currentRound || 1,
      totalRounds: 99,
      status: 'active'
    };
  }

  function showLiveWaiting(pollData) {
    var indicator = document.getElementById('arena-waiting-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'arena-waiting-indicator';
      indicator.className = 'arena-waiting-indicator';
      var field = document.querySelector('.arena-battle__field');
      if (field) field.appendChild(indicator);
    }

    if (pollData.myMoveSubmitted && !pollData.opponentMoveSubmitted) {
      indicator.innerHTML = '<i class="fas fa-hourglass-half fa-spin"></i> Waiting for opponent...';
      indicator.style.display = '';
    } else if (!pollData.myMoveSubmitted && pollData.opponentMoveSubmitted) {
      indicator.innerHTML = '<i class="fas fa-exclamation-circle" style="color:var(--bs-accent);"></i> Opponent ready! Choose your moves.';
      indicator.style.display = '';
    } else {
      indicator.style.display = 'none';
    }
  }

  function onLiveRoundResolved(pollData) {
    if (!_activeBattle) return;

    // Animate the round result using the full animation pipeline
    if (pollData.lastRoundResult && window.ArenaBattleUI && window.ArenaBattleUI.animateLiveRound) {
      window.ArenaBattleUI.animateLiveRound(pollData.lastRoundResult).then(function() {
        // Update battle state after animation
        _activeBattle.charges = { player: pollData.myCharges, opponent: pollData.opponentCharges };
        _activeBattle.stamina = { player: pollData.myStamina, opponent: pollData.opponentStamina };
        _activeBattle.cooldowns = { player: pollData.myCooldowns || {}, opponent: pollData.opponentCooldowns || {} };
        _activeBattle.stances = { player: pollData.myStance || 'balanced', opponent: pollData.opponentStance || 'balanced' };
        _activeBattle.currentRound = pollData.currentRound;

        var roundLabel = document.querySelector('.arena-round-label');
        if (roundLabel) roundLabel.textContent = 'Round ' + pollData.currentRound;

        if (window.ArenaBattleUI.enableMoves) window.ArenaBattleUI.enableMoves(true);
        showLiveWaiting(pollData);
      });
    } else {
      // Fallback: direct update
      _activeBattle.currentRound = pollData.currentRound;
      if (window.ArenaBattleUI) {
        window.ArenaBattleUI.updateHpBars(pollData.myHp, pollData.myMaxHp, pollData.opponentHp, pollData.opponentMaxHp);
        if (window.ArenaBattleUI.enableMoves) window.ArenaBattleUI.enableMoves(true);
      }
      showLiveWaiting(pollData);
    }
  }

  function onLivePollUpdate(pollData) {
    showLiveWaiting(pollData);

    // Update round countdown
    if (pollData.roundDeadline) {
      var offset = _Pvp.getClockOffset ? _Pvp.getClockOffset() : 0;
      var remaining = Math.max(0, new Date(pollData.roundDeadline).getTime() - (Date.now() + offset));
      var seconds = Math.ceil(remaining / 1000);
      var timerEl = document.getElementById('arena-round-timer');
      if (!timerEl) {
        timerEl = document.createElement('div');
        timerEl.id = 'arena-round-timer';
        timerEl.className = 'arena-round-timer';
        var roundLabel = document.querySelector('.arena-round-label');
        if (roundLabel && roundLabel.parentNode) roundLabel.parentNode.insertBefore(timerEl, roundLabel.nextSibling);
      }
      if (timerEl) {
        timerEl.textContent = seconds + 's';
        timerEl.style.color = seconds <= 10 ? 'var(--bs-danger)' : 'var(--bs-text-muted)';
      }
    }
  }

  function onLiveBattleComplete(data) {
    _Pvp.stopBattlePoll();
    localStorage.removeItem('bs-activeLiveBattle');

    // Remove waiting indicator and timer
    var indicator = document.getElementById('arena-waiting-indicator');
    if (indicator) indicator.remove();
    var timer = document.getElementById('arena-round-timer');
    if (timer) timer.remove();

    // Determine result
    var won = data.winner === 'you';
    var draw = !data.winner || data.winner === 'draw';
    var lost = data.winner === 'opponent';

    // Play audio
    var endAudio = window.ArenaAudio;
    if (endAudio) endAudio.play(won ? 'victory' : 'defeat');
    if (endAudio && typeof endAudio.stopMusic === 'function') endAudio.stopMusic();

    // Compute Elo change from the poll data or finalization
    var eloChange = 0;
    var sparksEarned = 0;
    if (data.finalization) {
      // Poll response includes finalization with player1/player2 data
      // We need to figure out which slot we are — check if poll perspective already translated
      // The finalization is stored as player1/player2 on server; we pick based on myCard
      var myUserId = _profile ? _profile.userId : null;
      if (data.finalization.player1 && data.finalization.player2) {
        // We can't directly know our slot from poll data, but the Elo change sign tells us:
        // If we won, our eloChange is positive
        var fin1 = data.finalization.player1;
        var fin2 = data.finalization.player2;
        if (won) {
          eloChange = fin1.eloChange > 0 ? fin1.eloChange : fin2.eloChange;
          sparksEarned = fin1.eloChange > 0 ? fin1.sparks : fin2.sparks;
        } else if (lost) {
          eloChange = fin1.eloChange < 0 ? fin1.eloChange : fin2.eloChange;
          sparksEarned = fin1.eloChange < 0 ? fin1.sparks : fin2.sparks;
        } else {
          sparksEarned = fin1.sparks; // Draw gives same to both
        }
      }
    }

    // Show Elo change toast
    if (eloChange !== 0 && _Pvp.showEloChange) {
      var changeText = (eloChange > 0 ? '+' : '') + eloChange;
      var changeColor = eloChange > 0 ? 'var(--bs-success, #4ade80)' : 'var(--bs-danger, #D85A30)';
      // Check for rank up
      var newElo = (_Pvp.getPvPElo ? _Pvp.getPvPElo() : 1000) + eloChange;
      var oldRank = _Pvp.getPvPRank ? _Pvp.getPvPRank(_Pvp.getPvPElo()) : null;
      var newRank = _Pvp.getPvPRank ? _Pvp.getPvPRank(newElo) : null;
      var rankUp = (newRank && oldRank && newRank.name !== oldRank.name && newElo > _Pvp.getPvPElo()) ? newRank : null;
      _Pvp.showEloChange(changeText, changeColor, rankUp);
    }

    // Update local Elo + Sparks
    if (_Pvp.setPvPElo && eloChange !== 0) {
      _Pvp.setPvPElo((_Pvp.getPvPElo ? _Pvp.getPvPElo() : 1000) + eloChange);
    }
    if (_Pvp.setPvPRecord) {
      var rec = _Pvp.getPvPRecord ? _Pvp.getPvPRecord() : { w: 0, l: 0 };
      if (won) rec.w = (rec.w || 0) + 1;
      else if (lost) rec.l = (rec.l || 0) + 1;
      _Pvp.setPvPRecord(rec);
    }
    if (sparksEarned > 0) {
      _progress.sparks = (_progress.sparks || 0) + sparksEarned;
      updateTopbarSparks();
    }

    // Show result toast — stakes-aware
    var isStakes = data.mode === 'stakes';
    var transferInfo = (data.finalization && data.finalization.transfer) || null;
    if (isStakes && transferInfo && transferInfo.cardName) {
      if (won) {
        showSuccessToast('Victory! You won "' + transferInfo.cardName + '" +' + sparksEarned + ' Sparks');
      } else if (lost) {
        showErrorToast('Defeated! You lost "' + transferInfo.cardName + '" +' + sparksEarned + ' Sparks');
      } else {
        showSuccessToast('Draw! Cards returned. +' + sparksEarned + ' Sparks');
      }
    } else {
      if (won) {
        showSuccessToast('Victory! +' + sparksEarned + ' Sparks');
      } else if (lost) {
        showErrorToast('Defeated! +' + sparksEarned + ' Sparks');
      } else {
        showSuccessToast('Draw! +' + sparksEarned + ' Sparks');
      }
    }

    // Return to PvP screen after delay
    setTimeout(function() {
      showScreen('pvp');
      _Pvp.clearActiveBattle();
      _Pvp.updateRatingDisplay();
    }, 3500);
  }

  // Check for active live battle on page load
  function checkForActiveLiveBattle() {
    var storedBattle = localStorage.getItem('bs-activeLiveBattle');
    if (storedBattle) {
      resumeLiveBattle(storedBattle);
      return true;
    }
    return false;
  }

  // ============================================================
  // FORGE SCREEN — delegated to bs-forge.js (window.BsForge)
  // ============================================================

  var _Forge = window.BsForge || {};
  function openForgeScreen(isFirstUnlock, showCardPicker) {
    if (_Forge.open) return _Forge.open(isFirstUnlock, showCardPicker);
  }

  // ============================================================
  // LOBBY REFRESH
  // ============================================================

  async function refreshLobby() {
    await loadProfile();
    const cards = await loadUserCards();
    if (cards.length > 0) {
      var savedId = _progress.selectedCardId || (_profile && _profile.selectedCardId);
      _selectedCard = savedId
        ? cards.find(c => c.id === savedId) || cards[0]
        : cards[0];
      ensureCombatStats(_selectedCard);
    }
    renderLobby();
  }

  // ── Tutorial — delegated to bs-tutorial.js (window.BsTutorial) ──
  var _Tut = window.BsTutorial || {};
  function showStrangerTutorial() { if (_Tut.show) _Tut.show(); }
  function removeTutorial() { if (_Tut.remove) _Tut.remove(); }

  // ============================================================
  // TOAST NOTIFICATIONS — delegated to bs-toast.js (window.BsToast)
  // ============================================================

  function showToast(message, type) { if (window.BsToast) window.BsToast.show(message, type); }
  function showErrorToast(msg) { if (window.BsToast) window.BsToast.error(msg); }
  function showSuccessToast(msg) { if (window.BsToast) window.BsToast.success(msg); }

  // ── Reward Drops — delegated to bs-reward-drops.js (window.BsRewardDrops) ──
  var _Rd = window.BsRewardDrops || {};
  function rollLoot() { return _Rd.rollLoot ? _Rd.rollLoot() : null; }
  function applyLootDrop(loot) { return _Rd.applyLootDrop ? _Rd.applyLootDrop(loot) : Promise.resolve(); }
  function showRewardDrop(reward, source) { if (_Rd.showRewardDrop) _Rd.showRewardDrop(reward, source); }

  // ============================================================
  // CHALLENGES — delegated to bs-rewards.js (window.BsRewards)
  // ============================================================

  var _Rew = window.BsRewards || {};
  var CHALLENGES = _Rew.CHALLENGES || [];
  function getChallengeProgress() { return _Rew.getChallengeProgress ? _Rew.getChallengeProgress() : {}; }
  function saveChallengeProgress(data) { if (_Rew.saveChallengeProgress) _Rew.saveChallengeProgress(data); }
  function getChallengeClaimedTier(chId) { return _Rew.getChallengeClaimedTier ? _Rew.getChallengeClaimedTier(chId) : 0; }
  function getChallengeTierReached(ch) { return _Rew.getChallengeTierReached ? _Rew.getChallengeTierReached(ch) : 0; }

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
    syncProgressToServer();

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

  function incrementTotalWins() { _progress.totalWins++; }
  function incrementTotalBounties() { _progress.totalBounties++; }

  function renderChallenges() { if (_Rew.renderChallenges) _Rew.renderChallenges(); }
  function renderBounties() { if (_Rew.renderBounties) _Rew.renderBounties(); }
  function getDailyBounties() { return _Rew.getDailyBounties ? _Rew.getDailyBounties() : { bounties: [], fights: 0 }; }

  // completeBounty stays in monolith — grants stat rewards, calls save API
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
    if (completed) {
      incrementTotalBounties();
      addXp(50); // +50 XP per bounty completion (rank progression feed)
      const completedBounty = data.bounties.find(b => b.check === checkType && b.done);
      if (completedBounty && completedBounty.reward) {
        const r = completedBounty.reward;
        if (r.stat && r.amount && _selectedCard && _selectedCard.combatStats) {
          const oldVal = _selectedCard.combatStats[r.stat] || 0;
          _selectedCard.combatStats[r.stat] = Math.min(100, oldVal + r.amount);
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

  // ── Auth UI — delegated to bs-auth-ui.js (window.BsAuthUI) ──
  var _Au = window.BsAuthUI || {};
  function updatePlayAuthUI() { if (_Au.update) _Au.update(); }

  // ── Storage Cleanup — delegated to bs-storage-cleanup.js (window.BsStorageCleanup) ──
  function cleanupLocalStorage() { if (window.BsStorageCleanup) window.BsStorageCleanup.run(safeLSSet); }




  // ── Battle Card Palette — delegated to bs-battle-palette.js (window.BsBattlePalette) ──
  var _Bp = window.BsBattlePalette || {};
  if (_Bp.setCallbacks) _Bp.setCallbacks({ getSelectedCard: function() { return _selectedCard; }, renderCardHTML: renderCardHTML });
  function applyBattlePalette() { if (_Bp.apply) _Bp.apply(); }

  // ── Ascension — delegated to bs-ascension.js (window.BsAscension) ──
  var _Asc = window.BsAscension || {};
  function showAscensionOffer(n) { if (_Asc.showOffer) _Asc.showOffer(n); }
  function getAscensionReward(level) { return _Asc.getReward ? _Asc.getReward(level) : ''; }

  // ── Leaderboard — delegated to bs-leaderboard.js (window.BsLeaderboard) ──
  var _Lb = window.BsLeaderboard || {};
  function renderLeaderboard() { if (_Lb.render) _Lb.render(); }

  // ── Player stats — read-only progression panel.
  // Two surfaces:
  //   - Lobby strip (4 tile glance: wins / best streak / bosses / forged)
  //   - Dedicated screen (#bs-screen-stats) with grouped sections
  // Both pull from _profile + a few derivations (losses summed from
  // bossRecords, cards published from the user blob). No new tracking.
  function _statsAggregateLosses() {
    if (!_profile || !_profile.bossRecords) return 0;
    var total = 0;
    for (var k in _profile.bossRecords) {
      if (_profile.bossRecords[k] && typeof _profile.bossRecords[k].losses === 'number') {
        total += _profile.bossRecords[k].losses;
      }
    }
    return total;
  }
  function _statsCountPublishedCards() {
    if (!_profileData || !Array.isArray(_profileData.userCards)) return 0;
    return _profileData.userCards.filter(function(c) {
      return c && (c.publishedToGallery === true || c.published === true);
    }).length;
  }
  function _statsCountMasteryTiers() {
    if (!_profile || !_profile.masteryClaimed) return 0;
    var n = 0;
    for (var k in _profile.masteryClaimed) {
      var rec = _profile.masteryClaimed[k];
      if (rec && typeof rec === 'object') n += Object.keys(rec).length;
      else if (typeof rec === 'number') n += rec;
    }
    return n;
  }
  function _statsDaysActive() {
    if (!_profile || !_profile.createdAt) return 0;
    var ms = Date.now() - new Date(_profile.createdAt).getTime();
    return Math.max(1, Math.floor(ms / (1000 * 60 * 60 * 24)));
  }
  function _statsFmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return '—'; }
  }
  function _statsTile(label, value, sub) {
    var subHtml = sub ? '<span class="bs-stats-tile__sub">' + escHtml(sub) + '</span>' : '';
    return '<div class="bs-stats-tile">'
      + '<span class="bs-stats-tile__label">' + escHtml(label) + '</span>'
      + '<span class="bs-stats-tile__value">' + escHtml(String(value)) + '</span>'
      + subHtml
      + '</div>';
  }

  function renderStatsStrip() {
    if (!_profile) return;
    var winsEl = document.getElementById('bs-stat-wins');
    var streakEl = document.getElementById('bs-stat-streak');
    var bossesEl = document.getElementById('bs-stat-bosses');
    var forgeEl = document.getElementById('bs-stat-forge');
    if (winsEl) winsEl.textContent = String(_profile.totalWins || 0);
    if (streakEl) streakEl.textContent = String(_profile.bestStreak || 0);
    if (bossesEl) bossesEl.textContent = (_profile.highestBoss || 0) + '/10';
    if (forgeEl) forgeEl.textContent = String(_profile.forgeVisits || 0);
  }

  function renderStatsScreen() {
    if (!_profile) return;
    var xp = _profile.xp || 0;
    var level = (_S && _S.computeLevel && _S.computeLevel(xp)) || 1;
    var tier = (_S && _S.getTier && _S.getTier(level)) || { label: 'Initiate', icon: 'fa-shield-halved', color: '#A09888' };
    var toNext = (_S && _S.getXpToNextLevel && _S.getXpToNextLevel(xp)) || 0;

    // Identity
    var rankIconEl = document.getElementById('bs-stats-rank-icon');
    var rankNameEl = document.getElementById('bs-stats-rank-name');
    var rankXpEl = document.getElementById('bs-stats-rank-xp');
    var prestigeEl = document.getElementById('bs-stats-prestige');
    var ageEl = document.getElementById('bs-stats-account-age');
    if (rankIconEl) _setRankBadge(rankIconEl, tier);
    if (rankNameEl) rankNameEl.textContent = 'Lv ' + level + ' — ' + tier.label;
    if (rankXpEl) rankXpEl.textContent = toNext + ' XP to Lv ' + (level + 1);
    if (prestigeEl) prestigeEl.textContent = String(_profile.ascension || 0);
    if (ageEl) ageEl.textContent = _statsDaysActive() + ' DAYS ACTIVE';

    // Combat
    var totalWins = _profile.totalWins || 0;
    var totalLosses = _statsAggregateLosses();
    var totalFights = totalWins + totalLosses;
    var winRate = totalFights > 0 ? Math.round((totalWins / totalFights) * 100) + '%' : '—';
    var pvpW = (_profile.pvpRecord && _profile.pvpRecord.w) || 0;
    var pvpL = (_profile.pvpRecord && _profile.pvpRecord.l) || 0;
    var combatGrid = document.getElementById('bs-stats-grid-combat');
    if (combatGrid) {
      combatGrid.innerHTML =
        _statsTile('Total Wins', totalWins) +
        _statsTile('Total Losses', totalLosses) +
        _statsTile('Win Rate', winRate, totalFights + ' fights') +
        _statsTile('Current Streak', _profile.winStreak || 0) +
        _statsTile('Best Streak', _profile.bestStreak || 0) +
        _statsTile('PvP Record', pvpW + 'W / ' + pvpL + 'L', 'Elo ' + (_profile.pvpElo || 0)) +
        _statsTile('Trophy Kills', _profile.trophyKills || 0) +
        _statsTile('Scars', _profile.scars || 0);
    }

    // Progression
    var progGrid = document.getElementById('bs-stats-grid-progression');
    if (progGrid) {
      progGrid.innerHTML =
        _statsTile('Bosses Defeated', (_profile.highestBoss || 0) + ' / 10') +
        _statsTile('Mastery Tiers', _statsCountMasteryTiers()) +
        _statsTile('Tower Best Floor', _profile.towerBest || 0) +
        _statsTile('Tower Current Floor', _profile.towerFloor || 0) +
        _statsTile('Bounties Done', _profile.totalBounties || 0) +
        _statsTile('Peak PvP Rank', _profile.peakRank || 'Iron');
    }

    // Forge & Gallery
    var forgeGrid = document.getElementById('bs-stats-grid-forge');
    if (forgeGrid) {
      forgeGrid.innerHTML =
        _statsTile('Cards Forged', _profile.forgeVisits || 0) +
        _statsTile('Cards Published', _statsCountPublishedCards()) +
        _statsTile('Forge Wins', Math.floor(_profile.forgeWins || 0)) +
        _statsTile('Crates Earned', _profile.crateWinCounter || 0);
    }

    // Cosmetics
    var cosmeticsCount = Array.isArray(_profile.cosmetics) ? _profile.cosmetics.length : 0;
    var palettes = Array.isArray(_profile.visualUnlocks) ? _profile.visualUnlocks.filter(function(u){ return /^palette/.test(u); }).length : 0;
    var containers = Array.isArray(_profile.visualUnlocks) ? _profile.visualUnlocks.filter(function(u){ return /^container/.test(u); }).length : 0;
    var charms = Array.isArray(_profile.charms) ? _profile.charms.length : 0;
    var cosGrid = document.getElementById('bs-stats-grid-cosmetics');
    if (cosGrid) {
      cosGrid.innerHTML =
        _statsTile('Cosmetics Owned', cosmeticsCount) +
        _statsTile('Palettes Unlocked', palettes) +
        _statsTile('Containers Unlocked', containers) +
        _statsTile('Charms Owned', charms);
    }

    // Account
    var acctGrid = document.getElementById('bs-stats-grid-account');
    if (acctGrid) {
      acctGrid.innerHTML =
        _statsTile('Joined', _statsFmtDate(_profile.createdAt)) +
        _statsTile('Last Played', _statsFmtDate(_profile.lastPlayedAt)) +
        _statsTile('Sparks', _profile.sparks || 0) +
        _statsTile('Lifetime Spent', _profile.lifetimeSparksSpent || 0);
    }
  }

  // ── Gallery — read-only browse of cards published to the public gallery.
  // Pulls galleryCards from the existing loadCards endpoint (already used
  // by the PvP screen). Click a card to open the detail modal.
  // Cards opt in via the publishedToGallery flag (set in the forge editor's
  // Details tab) — server-side cardforgepublish keeps published-cards.json
  // in sync, so this just consumes whatever's there.
  async function renderGallery() {
    const grid = document.getElementById('bs-gallery-grid');
    const countEl = document.getElementById('bs-gallery-count');
    if (!grid) return;
    grid.innerHTML = '<div class="bs-gallery__loading"><i class="fas fa-spinner fa-spin"></i> Loading cards…</div>';
    if (countEl) countEl.textContent = '';
    try {
      // Fetch cards + admin configs in parallel. Configs soft-fail to defaults
      // (no hidden cards, mode=recent, no curated) so a config issue never
      // breaks the gallery view.
      function fetchConfig(key) {
        var url = window.buildApiPath
          ? window.buildApiPath('adminConfig', { key: key })
          : '/api/blindspotadminconfig?key=' + key;
        return fetch(url, { credentials: 'omit' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      }
      const [data, modConfig, galleryConfig] = await Promise.all([
        window.ArenaAPI.loadCards(),
        fetchConfig('moderation'),
        fetchConfig('gallery')
      ]);

      const hiddenIds = new Set((modConfig && Array.isArray(modConfig.hiddenIds)) ? modConfig.hiddenIds : []);
      const mode = (galleryConfig && galleryConfig.mode) || 'recent';
      const curatedIds = (galleryConfig && Array.isArray(galleryConfig.curatedIds)) ? galleryConfig.curatedIds : [];

      // Apply existing publishedToGallery / has-art filters first, then moderation.
      let cards = (data.galleryCards || []).filter(function(c) {
        if (!c) return false;
        if (c.publishedToGallery === false) return false;
        const hasArt = c.avatar || c.image || c.imageUrl || c.art;
        if (!hasArt) return false;
        if (hiddenIds.has(c.id)) return false;
        return true;
      });

      // Apply gallery-config mode
      if (mode === 'curated' && curatedIds.length > 0) {
        const byId = new Map();
        for (const c of cards) byId.set(c.id, c);
        cards = curatedIds.map(id => byId.get(id)).filter(Boolean);
      } else if (mode === 'random') {
        cards = cards.slice();
        for (let i = cards.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = cards[i]; cards[i] = cards[j]; cards[j] = t;
        }
      } else {
        // 'recent' (default) and 'highest-rated' fallback
        cards = cards.slice().sort(function(a, b) {
          const ta = a.publishDate || a.publishedAt || a.createdAt || 0;
          const tb = b.publishDate || b.publishedAt || b.createdAt || 0;
          const da = ta ? Date.parse(ta) : 0;
          const db = tb ? Date.parse(tb) : 0;
          return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
        });
      }

      if (countEl) countEl.textContent = cards.length + (cards.length === 1 ? ' card' : ' cards');
      if (cards.length === 0) {
        grid.innerHTML = '<div class="bs-gallery__empty"><i class="fas fa-inbox"></i><p>No public cards yet. Publish your card from the forge to start the gallery.</p></div>';
        return;
      }
      grid.innerHTML = cards.map(function(c, i) {
        ensureCombatStats(c);
        return '<button class="bs-gallery-tile" data-gallery-idx="' + i + '" type="button" role="listitem" aria-label="View ' + escHtml(c.name || 'card') + '">'
          + renderCardHTML(c, 'full')
          + '</button>';
      }).join('');
      grid.querySelectorAll('.bs-gallery-tile').forEach(function(btn) {
        btn.addEventListener('click', function() {
          const idx = parseInt(btn.dataset.galleryIdx, 10);
          const card = cards[idx];
          if (card) openGalleryDetail(card);
        });
      });
    } catch (e) {
      console.warn('[Blindspot] Gallery load failed:', e);
      grid.innerHTML = '<div class="bs-gallery__empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load gallery. Try again later.</p></div>';
    }
  }

  function openGalleryDetail(card) {
    const modal = document.getElementById('bs-gallery-detail');
    const cardEl = document.getElementById('bs-gallery-detail-card');
    const metaEl = document.getElementById('bs-gallery-detail-meta');
    if (!modal || !cardEl) return;
    ensureCombatStats(card);
    cardEl.innerHTML = renderCardHTML(card, 'full');
    if (metaEl) {
      const power = (card.combatStats ? Object.values(card.combatStats).reduce(function(a,b){return a+(b||0)},0) : 0);
      const dateStr = card.publishDate ? new Date(card.publishDate).toLocaleDateString() : '';
      // publishedBy is a userId — opaque to other players. We surface a
      // truncated form as a creator handle until we wire actual display
      // names (creator profile work is in option C).
      const creator = card.publishedBy ? ('Forged by ' + String(card.publishedBy).slice(0, 8) + '…') : '';
      metaEl.innerHTML = '<div class="bs-gallery-detail__row"><i class="fas fa-bolt"></i> Power ' + power + '</div>'
        + (creator ? '<div class="bs-gallery-detail__row"><i class="fas fa-hammer"></i> ' + escHtml(creator) + '</div>' : '')
        + (dateStr ? '<div class="bs-gallery-detail__row"><i class="fas fa-calendar"></i> Published ' + escHtml(dateStr) + '</div>' : '');
    }
    modal.classList.remove('bs-modal-backdrop--hidden');
  }
  function closeGalleryDetail() {
    const modal = document.getElementById('bs-gallery-detail');
    if (modal) modal.classList.add('bs-modal-backdrop--hidden');
  }
  // Wire close button + backdrop click + back-to-lobby
  document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'bs-gallery-detail-close') closeGalleryDetail();
    if (e.target && e.target.id === 'bs-gallery-detail') closeGalleryDetail();
    if (e.target && e.target.closest && e.target.closest('#bs-gallery-back')) {
      showScreen('lobby');
      renderLobby();
    }
  });

  // ── Loot Choice — delegated to bs-loot-choice.js (window.BsLootChoice) ──
  var _Loot = window.BsLootChoice || {};
  function showLootChoice(options) { if (_Loot.show) _Loot.show(options); }

  // ── Combat Tooltips — delegated to bs-combat-tooltips.js (window.BsCombatTooltips) ──
  var _Ct = window.BsCombatTooltips || {};
  function showBattleHint(key) { if (_Ct.showHint) _Ct.showHint(key); }
  function updateCombatTooltips() { if (_Ct.update) _Ct.update(); }

  // ============================================================
  // DEBUG / CHEAT CONSOLE — delegated to bs-debug.js (window.BsDebug)
  // ============================================================

  var _Dbg = window.BsDebug || {};
  if (_Dbg.setCallbacks) _Dbg.setCallbacks({ getConfig: function() { return _config; }, renderLobby: function() { renderLobby(); }, playVictoryAnimation: function() { playVictoryAnimation(); }, openForgeScreen: function(a, b) { openForgeScreen(a, b); }, getSelectedCard: function() { return _selectedCard; } });

  // Landing callbacks — wired at top level (not inside loadGameData) to avoid
  // circular dep: initLanding needs _cb.loadGameData before loadGameData runs.
  // Getter callbacks return current values at call time, so they work even though
  // _config/_strangerCard are null until loadGameData populates them.
  if (_Land.setCallbacks) _Land.setCallbacks({
    loadGameData: loadGameData, loadProfile: loadProfile,
    showOverlay: showOverlay, hideOverlay: hideOverlay,
    showErrorToast: showErrorToast, safeLSSet: safeLSSet,
    isDemo: isDemo, isNewPlayer: isNewPlayer,
    getProgress: function() { return _progress; },
    getConfig: function() { return _config; },
    getStrangerCard: function() { return _strangerCard; },
    getBlindspotAPI: function() { return BlindspotAPI; },
    setIsStrangerFight: function(v) { _isStrangerFight = v; },
    setIsFirstRealFight: function(v) { _isFirstRealFight = v; },
    setActiveBattle: function(v) { _activeBattle = v; },
    hookBattleCompletion: hookBattleCompletion, hookBattleTracking: hookBattleTracking,
    removeTutorial: removeTutorial, showStrangerTutorial: showStrangerTutorial,
    applyBattlePalette: applyBattlePalette, updateCombatTooltips: updateCombatTooltips,
    renderCardHTML: renderCardHTML, ensureCombatStats: ensureCombatStats,
    addCardToDeck: addCardToDeck, flushSyncBeforeNavigate: flushSyncBeforeNavigate,
    setForgeWins: setForgeWins, isForgeUnlocked: isForgeUnlocked,
    getForgeWins: getForgeWins, renderSessionStats: renderSessionStats
  });

  // ============================================================
  // BOOT
  // ============================================================

  document.addEventListener('DOMContentLoaded', () => {
    if (window.ProductAnalytics) ProductAnalytics.init('blindspot');
    cleanupLocalStorage();
    if (isOnLandingPage()) initLanding();
    else if (isOnPlayPage()) initPlay();
  });

})();
