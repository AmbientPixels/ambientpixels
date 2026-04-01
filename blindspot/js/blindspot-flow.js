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

  function populatePrefightOverlay(boss) { ensureCombatStats(_selectedCard); if (_Str.populatePrefightOverlay) _Str.populatePrefightOverlay(boss, _selectedCard); }
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
        if (_loadingFill) _loadingFill.style.width = _loadingCurrent.toFixed(1) + '%';
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
    // Server profile fallback — cache clear shouldn't reset a real player
    if (profile && (profile.selectedCardId || profile.xp > 0 || (profile.record && profile.record.wins > 0))) {
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
  function addSparks(n) { _progress.sparks += Math.max(0, n); }
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
    var unlocked = window.ArenaBackgrounds.getUnlockedArenas(highestBoss);

    // Only show picker if player has more than 1 arena unlocked
    if (unlocked.length <= 1) {
      container.style.display = 'none';
      return;
    }

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
          return '<button class="' + cls + '" data-arena="' + escHtml(arena.id) + '"'
            + (!isOpen ? ' disabled' : '')
            + ' title="' + escHtml(arena.name) + (!isOpen ? ' (Beat ' + escHtml(arena.bossName) + ')' : '') + '">'
            + '<img class="bs-arena-option__img" src="' + escHtml(arena.image) + '" alt="' + escHtml(arena.name) + '" loading="lazy">'
            + '<div class="bs-arena-option__name"><i class="fas ' + arena.icon + '"></i></div>'
            + (isActive ? '<div class="bs-arena-option__check"><i class="fas fa-check"></i></div>' : '')
            + (!isOpen ? '<div class="bs-arena-option__lock"><i class="fas fa-lock"></i></div>' : '')
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
        playSfx: playSfx, addSparks: addSparks, showSuccessToast: showSuccessToast,
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
      const data = await Promise.race([
        window.ArenaAPI.loadCards(),
        new Promise(function(_, reject) { setTimeout(function() { reject(new Error('loadCards timeout')); }, 8000); })
      ]);
      var cards = (data.userCards || []).filter(function(c) { return !c.isDefault; });
      // Cache deck to localStorage for quick access
      if (cards.length > 0) setDeck(cards);
      return cards;
    } catch (e) {
      console.warn('[Blindspot] Could not load cards:', e);
      // Fall back to cached deck
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
    showNewCardClassPicker: function() { showNewCardClassPicker(); }
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

    // If guest signed in, clear guest flag and sync their cached progress to server
    if (isGuestMode && profile && !profile.isDemo) {
      localStorage.removeItem('bs-guest-mode');
      isGuestMode = false;
      // Merge cached guest progress into server profile
      if (_S.loadFromCache) _S.loadFromCache();
      syncProgressToServer();
    }

    if (!profile && !isGuestMode) {
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
    var guestBanner = document.getElementById('bs-guest-banner');
    if (localStorage.getItem('bs-guest-mode') === 'true') {
      if (!guestBanner) {
        guestBanner = document.createElement('div');
        guestBanner.id = 'bs-guest-banner';
        guestBanner.style.cssText = 'text-align:center;padding:0.4rem 0.75rem;background:rgba(239,159,39,0.12);border:1px solid var(--bs-accent-dim);border-radius:6px;margin:0.5rem auto;max-width:360px;font-size:0.75rem;color:var(--bs-text-muted);';
        guestBanner.innerHTML = '<i class="fas fa-info-circle" style="color:var(--bs-accent);"></i> Guest mode — <a href="/blindspot/login.html?redirect=/blindspot/play.html" style="color:var(--bs-accent);text-decoration:underline;">Sign in</a> to save progress across devices';
        var lobbyScreen = document.getElementById('bs-screen-lobby');
        if (lobbyScreen) lobbyScreen.insertBefore(guestBanner, lobbyScreen.firstChild);
      }
    } else if (guestBanner) {
      guestBanner.remove();
    }

    renderCardSwitcher();
    renderNewCardButton();
    renderDeckButton();
    updateRankDisplay();
    updateForgeProgress();
    updateCrateBadge();
    renderBounties();
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
        pvpHtml = `<span style="color:${pvpRank.color};" data-tooltip="PvP Rating"><i class="fas ${pvpRank.icon}"></i> ${elo}</span>`;
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

    // Update quick-fight button label to show next boss
    const playBtnLabel = document.getElementById('bs-play-btn-label');
    if (playBtnLabel) {
      const nextBoss = _bossesByNumber[highestBoss + 1];
      if (nextBoss) {
        playBtnLabel.textContent = 'FIGHT ' + nextBoss.name.toUpperCase();
      } else if (highestBoss >= 10) {
        playBtnLabel.textContent = 'CAMPAIGN COMPLETE';
      }
    }

    // Apply equipped cosmetics to card display
    applyEquippedCosmetics();

    // Update collection badge
    var collBadge = document.getElementById('bs-collection-count');
    var owned = getOwnedCosmetics();
    if (collBadge) {
      collBadge.textContent = String(owned.length);
      var collBtn = document.getElementById('bs-btn-collection');
      if (collBtn) collBtn.style.display = owned.length > 0 ? '' : 'none';
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
      if (xpFill) xpFill.style.setProperty('--bar-pct', Math.min(100, Math.max(0, progress)) / 100);
      if (xpText) xpText.textContent = `${currentXp} / ${nextRank.xp} XP`;
    } else {
      if (xpFill) xpFill.style.setProperty('--bar-pct', '1');
      if (xpText) xpText.textContent = `${currentXp} XP \u2014 Max Rank`;
    }
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
    if (label) label.textContent = 'CARD FORGE \u00b7 ' + displayWins + '/' + needed;
    if (hint) hint.textContent = ready ? 'Tap to customize your card' : 'Win campaign fights to unlock';
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
    getHighestBossDefeated: function() { return getHighestBossDefeated(); },
    getForgeWins: function() { return getForgeWins(); },
    getForgeWinsRequired: function() { return _config ? _config.forgeVisit.winsRequired : 3; },
    isForgePending: function() { return isForgePending(); },
    getTowerFloor: function() { return getTowerFloor(); },
    isWeeklyBoss: function(id) { return isWeeklyBoss(id); },
    getBattleType: function() { return _battleType; },
    getCurrentBossId: function() { return _currentBossId; },
    getBossById: function(id) { return _bossesById[id]; },
    getBossByNumber: function(n) { return _bossesByNumber[n]; },
    isFirstRealFight: function() { return _isFirstRealFight; },
    clearFirstRealFight: function() { _isFirstRealFight = false; },
    initPvPTabs: function() { if (_Pvp.initPvPTabs) _Pvp.initPvPTabs(); },
    renderDefenseQueue: function() { if (_Pvp.renderDefenseQueue) _Pvp.renderDefenseQueue(); },
    pollInboxCount: function() { if (_Pvp.pollInboxCount) _Pvp.pollInboxCount(); },
    getPvpUnlockRequirement: function() { return _config && _config.pvpUnlock ? _config.pvpUnlock.requireBossDefeated : 3; }
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
    cleanupLocalStorage();
    if (isOnLandingPage()) initLanding();
    else if (isOnPlayPage()) initPlay();
  });

})();
