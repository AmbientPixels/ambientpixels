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

  // ============================================================
  // CARD RARITY SYSTEM — based on forge visit count
  // ============================================================

  var CARD_RARITIES = _C.CARD_RARITIES;

  function getCardRarity() {
    var visits = getForgeVisitCount();
    var rarity = CARD_RARITIES[0];
    for (var i = CARD_RARITIES.length - 1; i >= 0; i--) {
      if (visits >= CARD_RARITIES[i].forges) {
        rarity = CARD_RARITIES[i];
        break;
      }
    }
    return rarity;
  }

  function getNextRarity() {
    var visits = getForgeVisitCount();
    for (var i = 0; i < CARD_RARITIES.length; i++) {
      if (visits < CARD_RARITIES[i].forges) {
        return { rarity: CARD_RARITIES[i], forgesNeeded: CARD_RARITIES[i].forges - visits };
      }
    }
    return null;
  }

  function renderRarityBadge() {
    var rarity = getCardRarity();
    return '<span class="bs-rarity-badge bs-rarity-badge--' + rarity.id + '">'
      + '<i class="fas ' + rarity.icon + '"></i> ' + rarity.name
      + '</span>';
  }

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
    document.querySelectorAll('.bs-screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('bs-screen-' + id);
    if (target) target.classList.add('active');
    document.body.classList.toggle('bs-battle-active', id === 'battle');
    updateBottomNav(id);
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
  function _buildCosmeticCaches() { if (_Cos.buildCaches) _Cos.buildCaches(_config); }
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
    } else if (item.slot === 'charm') {
      _progress.charms.push(item.id);
    } else if (item.title) {
      setCardTitle(item.title);
    }
  }

  // Sparks shop — stays in monolith (calls getSparks/spendSparks/awardCrate)
  var _sparksShopBound = false;
  function updateSparksShop() {
    var shop = document.getElementById('bs-sparks-shop');
    var btn = document.getElementById('bs-buy-ember-crate');
    if (!shop) return;
    var sparks = getSparks();
    var cost = 50;
    shop.style.display = sparks > 0 ? '' : 'none';
    if (btn) {
      btn.disabled = sparks < cost;
      btn.setAttribute('aria-label', 'Buy Ember Crate for ' + cost + ' Sparks' + (sparks < cost ? ' (not enough Sparks)' : ''));
    }
    if (!_sparksShopBound && btn) {
      _sparksShopBound = true;
      btn.addEventListener('click', function() {
        if (getSparks() < cost) { showSuccessToast('Not enough Sparks! Need ' + cost + '.'); return; }
        spendSparks(cost);
        awardCrate('ember');
        updateSparksShop();
        var sparksSpan = document.querySelector('.bs-hud-sparks');
        if (sparksSpan) sparksSpan.innerHTML = '<i class="fas fa-fire"></i> ' + getSparks() + ' sparks';
      });
    }
  }

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

  // Claimed boss rewards (prevent double-claiming)
  function getClaimedRewards() { return _progress.claimedRewards; }
  function claimReward(bossId) {
    if (!_progress.claimedRewards.includes(bossId)) _progress.claimedRewards.push(bossId);
  }
  function isRewardClaimed(bossId) {
    return _progress.claimedRewards.includes(bossId);
  }

  // Visual unlocks (earned from boss kills)
  function getUnlockedVisuals() { return _progress.visualUnlocks; }
  function unlockVisual(key) {
    if (!_progress.visualUnlocks.includes(key)) _progress.visualUnlocks.push(key);
  }
  function hasVisualUnlock(key) {
    return _progress.visualUnlocks.includes(key);
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
      _buildCosmeticCaches();
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
        startPvPBattle: startPvPBattle
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
        removeCardFromDeck: removeCardFromDeck
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
      if (_Asc.setCallbacks) _Asc.setCallbacks({
        playSfx: playSfx, showScreen: showScreen, renderLobby: renderLobby,
        showSuccessToast: showSuccessToast, syncProgressToServer: syncProgressToServer,
        setAscension: setAscension, awardCrate: awardCrate, unlockVisual: unlockVisual,
        setForgeWins: setForgeWins,
        getProgress: function() { return _progress; }
      });
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
      var cards = data.userCards || [];
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

  // ============================================================
  // CARD SWITCHER
  // ============================================================

  var _switcherBound = false;

  function switchCard(direction) {
    var deck = getDeck();
    if (deck.length <= 1) return;
    var currentIdx = getSelectedCardIndex();
    var nextIdx = direction === 'next'
      ? (currentIdx + 1) % deck.length
      : (currentIdx - 1 + deck.length) % deck.length;
    var nextCard = deck[nextIdx];
    if (!nextCard) return;

    var cardEl = document.getElementById('bs-player-card');
    if (!cardEl) return;

    // Slide out animation
    var outClass = direction === 'next' ? 'bs-card-slide-out-left' : 'bs-card-slide-out-right';
    var inClass = direction === 'next' ? 'bs-card-slide-in-right' : 'bs-card-slide-in-left';

    cardEl.classList.add(outClass);

    setTimeout(function() {
      // Update selected card
      _selectedCard = nextCard;
      ensureCombatStats(_selectedCard);
      _progress.selectedCardId = _selectedCard.id;
      syncProgressToServer();

      // Remove slide-out, render new card, add slide-in
      cardEl.classList.remove(outClass);
      renderLobby();
      cardEl.classList.add(inClass);

      setTimeout(function() {
        cardEl.classList.remove(inClass);
      }, 250);
    }, 250);
  }

  function renderCardSwitcher() {
    var deck = getDeck();
    var switcherEl = document.getElementById('bs-card-switcher');
    if (!switcherEl) return;

    if (deck.length <= 1) {
      switcherEl.style.display = 'none';
      return;
    }

    switcherEl.style.display = '';
    var countEl = document.getElementById('bs-card-count');
    if (countEl) {
      countEl.textContent = (getSelectedCardIndex() + 1) + ' / ' + deck.length;
    }

    if (!_switcherBound) {
      _switcherBound = true;
      var prevBtn = document.getElementById('bs-card-prev');
      var nextBtn = document.getElementById('bs-card-next');
      if (prevBtn) prevBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        switchCard('prev');
      });
      if (nextBtn) nextBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        switchCard('next');
      });
    }
  }

  // ============================================================
  // NEW CARD BUTTON
  // ============================================================

  var _newCardBound = false;

  function renderNewCardButton() {
    var btn = document.getElementById('bs-new-card-btn');
    if (!btn) return;

    var deckSize = getDeckSize();
    var needed = _config ? _config.forgeVisit.winsRequired : 3;
    var forgeReady = isForgeUnlocked() || getHighestBossDefeated() >= 10 || getForgeWins() >= needed || isForgePending();
    if (!forgeReady) {
      btn.style.display = 'none';
      return;
    }

    btn.style.display = '';
    if (deckSize >= MAX_DECK_SIZE) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-layer-group" aria-hidden="true"></i> Deck Full (' + MAX_DECK_SIZE + '/' + MAX_DECK_SIZE + ')';
    } else {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> New Card';
    }

    if (!_newCardBound) {
      _newCardBound = true;
      btn.addEventListener('click', function() {
        showNewCardClassPicker();
      });
    }
  }

  // ============================================================
  // NEW CARD — CLASS PICKER → CREATE → FORGE
  // ============================================================

  var NEW_CARD_CLASS_STATS = {
    Fighter:   { str: 90, agi: 55, int: 35, end: 80, lck: 40 },
    Caster:    { str: 35, agi: 45, int: 95, end: 40, lck: 85 },
    Rogue:     { str: 55, agi: 90, int: 60, end: 50, lck: 45 },
    Guardian:  { str: 65, agi: 35, int: 45, end: 95, lck: 60 },
    Trickster: { str: 45, agi: 65, int: 55, end: 45, lck: 90 }
  };

  var NEW_CARD_DEFAULT_AVATARS = {
    Fighter:   '/blindspot/img/demo/demo-knight.webp',
    Caster:    '/blindspot/img/demo/demo-mage.webp',
    Rogue:     '/blindspot/img/demo/demo-rogue.webp',
    Guardian:  '/blindspot/img/demo/demo-knight.webp',
    Trickster: '/blindspot/img/demo/demo-mage.webp'
  };

  var NEW_CARD_CLASSES = [
    { id: 'Fighter',   icon: 'fa-hand-fist',           label: 'Fighter',   desc: 'Power Strike — raw STR damage' },
    { id: 'Caster',    icon: 'fa-wand-magic-sparkles', label: 'Caster',    desc: 'Arcane Blast — INT + Vulnerable' },
    { id: 'Rogue',     icon: 'fa-user-ninja',          label: 'Rogue',     desc: 'Shadow Strike — always first' },
    { id: 'Guardian',  icon: 'fa-shield-halved',       label: 'Guardian',  desc: 'Fortify — heal + defense' },
    { id: 'Trickster', icon: 'fa-dice',                label: 'Trickster', desc: 'Wild Card — high risk, high reward' }
  ];

  function showNewCardClassPicker() {
    document.querySelector('.bs-class-picker-overlay')?.remove();

    var overlay = document.createElement('div');
    overlay.className = 'bs-overlay bs-class-picker-overlay';
    overlay.innerHTML =
      '<h2 style="font-family:Cinzel,serif;color:var(--bs-accent);margin-bottom:0.5rem;font-size:1.2rem;">Choose a Class</h2>' +
      '<p style="color:var(--bs-text-muted);font-size:0.8rem;margin-bottom:1rem;">Pick your fighting style. You\'ll customize in the Forge.</p>' +
      '<div class="bs-class-picker-grid">' +
      NEW_CARD_CLASSES.map(function(c) {
        return '<button class="bs-btn bs-btn--secondary bs-class-picker-btn" data-class="' + c.id + '">' +
          '<i class="fas ' + c.icon + '" style="font-size:1.2rem;color:var(--bs-accent);"></i>' +
          '<strong>' + c.label + '</strong>' +
          '<span style="font-size:0.7rem;color:var(--bs-text-muted);">' + c.desc + '</span>' +
          '</button>';
      }).join('') +
      '</div>' +
      '<button class="bs-btn bs-btn--secondary" id="bs-class-picker-cancel" style="margin-top:1rem;font-size:0.8rem;">Cancel</button>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.style.opacity = '1'; });

    overlay.querySelector('#bs-class-picker-cancel').addEventListener('click', function() {
      overlay.remove();
    });

    overlay.querySelectorAll('.bs-class-picker-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var chosenClass = btn.getAttribute('data-class');
        var stats = NEW_CARD_CLASS_STATS[chosenClass];
        btn.disabled = true;
        btn.innerHTML = '<span class="bs-spinner" style="display:inline-block;width:14px;height:14px;"></span> Creating\u2026';

        try {
          var defaultAvatar = NEW_CARD_DEFAULT_AVATARS[chosenClass] || '/blindspot/img/demo/demo-knight.webp';
          var cardId = await window.BlindspotSaveCard.save(
            { cardName: chosenClass, cardClass: chosenClass, cardRarity: 'Common', imageContainer: 'masked', artworkUrl: defaultAvatar },
            { ...stats }
          );

          // Load new card into deck
          var data = await window.ArenaAPI.loadCards();
          var cards = data.userCards || [];
          cards.forEach(function(c) { addCardToDeck(c); });

          // Select the new card
          _progress.selectedCardId = cardId;
          safeLSSet('bs-selected-card-id', cardId);
          await window.ArenaAPI.selectCard(cardId).catch(function() {});

          // Find the card data and set as selected
          var newCard = cards.find(function(c) { return c.id === cardId; });
          if (newCard) {
            _selectedCard = newCard;
            _selectedCard.combatStats = _selectedCard.combatStats || stats;
          }

          overlay.remove();
          renderLobby();

          // Open the Forge immediately
          openForgeScreen(true);
        } catch (e) {
          console.error('[Blindspot] New card creation failed:', e);
          showErrorToast('Could not create card: ' + (e.message || 'Unknown error'));
          btn.disabled = false;
          btn.innerHTML = '<i class="fas ' + NEW_CARD_CLASSES.find(function(cl) { return cl.id === chosenClass; }).icon + '" style="font-size:1.2rem;color:var(--bs-accent);"></i><strong>' + chosenClass + '</strong>';
        }
      });
    });
  }

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
      _loadProgressFromCache();
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

    updateLoadingProgress(85, 'Preparing lobby...');
    await new Promise(r => requestAnimationFrame(r));
    renderLobby();
    updateLoadingProgress(95, 'Almost ready...');
    bindPlayNavigation();
    updatePlayAuthUI();
    dismissLoadingGate();

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
      if (streak >= 5) streakHtml = `<span class="bs-hud-streak--hot" data-tooltip="Win streak — 5+ doubles forge points"><i class="fas fa-skull"></i> ${streak} streak</span>`;
      else if (streak >= 3) streakHtml = `<span class="bs-hud-streak--warm" data-tooltip="Win streak — 3+ earns bonus sparks"><i class="fas fa-skull"></i> ${streak} streak</span>`;
      else if (streak > 0) streakHtml = `<span data-tooltip="Current win streak"><i class="fas fa-skull"></i> ${streak} streak</span>`;

      const ascension = getAscension();
      const ascHtml = ascension > 0 ? `<span class="bs-ascension-badge"><i class="fas fa-star"></i> Ascension ${ascension}</span>` : '';
      const powerHtml = power > 0 ? `<span class="bs-hud-power" data-tooltip="Total combat power"><i class="fas fa-bolt"></i> ${power} power</span>` : '';

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

      statsEl.innerHTML = `
        <div class="bs-hud-line bs-hud-line--primary">${primaryParts.join('<span class="bs-hud-sep" aria-hidden="true">·</span>')}</div>
        ${secondaryParts.length ? '<div class="bs-hud-line bs-hud-line--secondary">' + secondaryParts.join('<span class="bs-hud-sep" aria-hidden="true">·</span>') + '</div>' : ''}
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

    const titleEl = document.getElementById('bs-card-title');
    const title = getCardTitle();
    if (titleEl) {
      titleEl.textContent = title || '';
      titleEl.style.display = title ? '' : 'none';
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
    }
  }

  // ============================================================
  // LOBBY ONBOARDING — delegated to bs-lobby-onboarding.js (window.BsLobbyOnboarding)
  // ============================================================

  var _Onb = window.BsLobbyOnboarding || {};
  function showLobbyOnboarding() { if (_Onb.show) _Onb.show(); }

  // ============================================================
  // PRE-FIGHT: ADVENTURE / FIGHT BUTTONS
  // ============================================================

  function setupPrefightButtons(bossId) {
    var goBtn = document.getElementById('bs-prefight-go');
    if (!goBtn || !goBtn.parentNode) return;
    var parent = goBtn.parentNode;
    var hasAdv = window.BsAdventure && window.BsAdventure.hasAdventure(bossId) && !isWeeklyBoss(bossId);

    // Replace with fresh button(s)
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;';

    if (hasAdv) {
      // Adventure button
      var advBtn = document.createElement('button');
      advBtn.className = 'bs-btn bs-btn--primary bs-btn--large bs-btn--glow';
      advBtn.innerHTML = '<i class="fas fa-book-open"></i> Adventure';
      wrapper.appendChild(advBtn);

      advBtn.addEventListener('click', async function () {
        hideOverlay('bs-prefight-overlay');
        var advBuffs = {};
        if (_Chm.setAdventureItems) _Chm.setAdventureItems([]);
        try {
          ensureCombatStats(_selectedCard);
          var boss = _bossesById[bossId];
          var result = await window.BsAdventure.launch(bossId, _selectedCard.combatStats, {
            containerEl: document.getElementById('bs-adventure-overlay'),
            playerClass: _selectedCard.class || _selectedCard.characterClass || '',
            bossWeakness: boss ? boss.weakness : null,
            bossName: boss ? boss.name : '',
            ascension: getAscension()
          });
          advBuffs = result.buffs || {};
          if (_Chm.setAdventureItems) _Chm.setAdventureItems(result.items || []);
        } catch (e) { console.warn('[BS] Adventure error:', e); }
        await startCampaignBattle(bossId, advBuffs);
      }, { once: true });

      // Fight button (skip adventure)
      var fightBtn = document.createElement('button');
      fightBtn.className = 'bs-btn bs-btn--secondary bs-btn--large';
      fightBtn.innerHTML = '<i class="fas fa-swords"></i> Fight';
      wrapper.appendChild(fightBtn);

      fightBtn.addEventListener('click', async function () {
        hideOverlay('bs-prefight-overlay');
        if (_Chm.setAdventureItems) _Chm.setAdventureItems([]);
        await startCampaignBattle(bossId, {});
      }, { once: true });
    } else {
      // No adventure — single Fight button
      var singleBtn = document.createElement('button');
      singleBtn.className = 'bs-btn bs-btn--primary bs-btn--large bs-btn--glow';
      singleBtn.textContent = 'Fight';
      wrapper.appendChild(singleBtn);

      singleBtn.addEventListener('click', async function () {
        hideOverlay('bs-prefight-overlay');
        if (_Chm.setAdventureItems) _Chm.setAdventureItems([]);
        await startCampaignBattle(bossId, {});
      }, { once: true });
    }

    // Replace the old button with new wrapper
    parent.replaceChild(wrapper, goBtn);
    // Restore original button structure on overlay close (for next open)
    var restoreBtn = function () {
      if (wrapper.parentNode) {
        var newGoBtn = document.createElement('button');
        newGoBtn.className = 'bs-btn bs-btn--primary bs-btn--large bs-btn--glow';
        newGoBtn.id = 'bs-prefight-go';
        newGoBtn.textContent = 'Fight';
        wrapper.parentNode.replaceChild(newGoBtn, wrapper);
      }
    };
    // Restore after a short delay when overlay hides
    setTimeout(function () {
      var overlay = document.getElementById('bs-prefight-overlay');
      if (!overlay) { restoreBtn(); return; }
      if (overlay.classList.contains('bs-overlay--hidden')) { restoreBtn(); return; }
      var observer = new MutationObserver(function () {
        if (overlay.classList.contains('bs-overlay--hidden')) { observer.disconnect(); restoreBtn(); }
      });
      observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
      // Safety: auto-disconnect after 60s to prevent leaks
      setTimeout(function () { observer.disconnect(); }, 60000);
    }, 100);
  }

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
    clearFirstRealFight: function() { _isFirstRealFight = false; }
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
      const battleData = await window.ArenaAPI.startBattle('pve', _selectedCard.id, bossId, { cardData: _selectedCard, tempBuffs: tempBuffs || {}, adventureItems: (_Chm.getAdventureItems ? _Chm.getAdventureItems() : []) || [] });
      _activeBattle = battleData;
      window.ArenaBattleUI.initBattle(battleData);
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

  // ============================================================
  // TUTORIAL (Stranger fight)
  // ============================================================

  var TUTORIAL_HINTS = _C.TUTORIAL_HINTS;

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
    var hint = step < TUTORIAL_HINTS.length ? TUTORIAL_HINTS[step] : null;
    document.querySelectorAll('.arena-move-btn').forEach(function (b) {
      b.classList.remove('bs-pulse-hint');
      if (hint) {
        // Disable all buttons except the one being taught
        var isTarget = b.dataset.move === hint.move;
        b.disabled = !isTarget;
        b.style.opacity = isTarget ? '' : '0.3';
        b.style.pointerEvents = isTarget ? '' : 'none';
      } else {
        // Tutorial done — re-enable all
        b.disabled = false;
        b.style.opacity = '';
        b.style.pointerEvents = '';
      }
    });
    if (hint) {
      var btn = document.querySelector('[data-move="' + hint.move + '"]');
      if (btn) btn.classList.add('bs-pulse-hint');
      var textEl = document.getElementById('bs-tutorial-text');
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
    document.querySelectorAll('.arena-move-btn').forEach(function (b) {
      b.classList.remove('bs-pulse-hint');
      b.removeEventListener('click', onTutorialMoveClick);
      b.disabled = false;
      b.style.opacity = '';
      b.style.pointerEvents = '';
    });
  }

  // ============================================================
  // TOAST NOTIFICATIONS — delegated to bs-toast.js (window.BsToast)
  // ============================================================

  function showToast(message, type) { if (window.BsToast) window.BsToast.show(message, type); }
  function showErrorToast(msg) { if (window.BsToast) window.BsToast.error(msg); }
  function showSuccessToast(msg) { if (window.BsToast) window.BsToast.success(msg); }

  // ============================================================
  // REWARD SYSTEM — Roulette + Boss Drops
  // ============================================================

  var LOOT_TABLE = _C.LOOT_TABLE;

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

  // ============================================================
  // AUTH UI
  // ============================================================

  function updatePlayAuthUI() {
    const el = document.getElementById('bs-topbar-user');
    if (!el) return;

    // Always check /.auth/me directly — don't rely on _profileData
    fetch('/.auth/me').then(r => r.json()).then(data => {
      if (data && data.clientPrincipal) {
        // User IS logged in
        sessionStorage.setItem('isAuthenticated', 'true');
        document.body.setAttribute('data-auth-state', 'signed-in');

        const name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'Player';
        el.innerHTML = `<i class="fas fa-user-check" style="color:var(--bs-accent); font-size:0.6rem;"></i> ${escHtml(name)} <a href="/.auth/logout?post_logout_redirect_uri=/blindspot/" style="color:var(--bs-text-muted); margin-left:0.5rem; font-size:0.65rem;" title="Sign out"><i class="fas fa-sign-out-alt"></i></a>`;
      } else {
        // Not logged in — show sign in link
        el.innerHTML = `<a href="/blindspot/login.html?redirect=/blindspot/play.html" style="color:var(--bs-accent); font-size:0.7rem;"><i class="fas fa-sign-in-alt"></i> Sign in</a>`;
      }
    }).catch(() => {
      // Auth check failed — show sign in link
      el.innerHTML = `<a href="/blindspot/login.html?redirect=/blindspot/play.html" style="color:var(--bs-accent); font-size:0.7rem;"><i class="fas fa-sign-in-alt"></i> Sign in</a>`;
    });
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
        safeLSSet('cardforge_saved_cards', JSON.stringify(cards));
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
    var palette = _selectedCard.palette || 'earth';

    // Render compact card in the player combatant slot
    var playerCard = document.getElementById('arena-player-card');
    if (playerCard) {
      playerCard.innerHTML = renderCardHTML(_selectedCard, 'compact');
      playerCard.style.overflow = 'hidden';
      playerCard.style.border = 'none';
      playerCard.style.background = 'none';
    }
  }

  // ── Ascension — delegated to bs-ascension.js (window.BsAscension) ──
  var _Asc = window.BsAscension || {};
  function showAscensionOffer(n) { if (_Asc.showOffer) _Asc.showOffer(n); }
  function getAscensionReward(level) { return _Asc.getReward ? _Asc.getReward(level) : ''; }

  // ============================================================
  // LEADERBOARD
  // ============================================================

  async function renderLeaderboard() {
    // Timeout wrapper to prevent infinite loading
    const TIMEOUT = 8000;
    const container = document.getElementById('bs-leaderboard-content');
    if (!container) return;
    container.innerHTML = '<div class="bs-loading"><div class="bs-spinner"></div> <i class="fas fa-trophy" style="color:var(--bs-accent);margin:0 0.3em;"></i>Consulting the ranks\u2026</div>';

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

  // ── Loot Choice — delegated to bs-loot-choice.js (window.BsLootChoice) ──
  var _Loot = window.BsLootChoice || {};
  function showLootChoice(options) { if (_Loot.show) _Loot.show(options); }

  // ============================================================
  // COMBAT TOOLTIPS (show damage estimates on move buttons)
  // ============================================================


  function showBattleHint(key) {
    var el = document.getElementById('bs-battle-hint');
    if (!el) return;
    var text = BATTLE_HINTS[key];
    if (!text) { el.style.visibility = 'hidden'; return; }
    el.innerHTML = '<i class="fas fa-lightbulb" style="color:var(--bs-accent);"></i> ' + text;
    el.style.visibility = 'visible';
  }

  function updateCombatTooltips() {
    // Class signature move — rename Ability button to class-specific name + icon
    if (_selectedCard) {
      var cardClass = _selectedCard.class || _selectedCard.characterClass || '';
      var sig = CLASS_SIGNATURE_MOVES[cardClass];
      if (sig) {
        var abilLabel = document.getElementById('arena-ability-label');
        var abilIcon = document.getElementById('arena-ability-icon');
        if (abilLabel) abilLabel.textContent = sig.name;
        if (abilIcon) abilIcon.className = 'fas ' + sig.icon;
      }
    }
    // Move upgrades — rename buttons based on stat thresholds
    if (_selectedCard && _selectedCard.combatStats) {
      var cs = _selectedCard.combatStats;
      Object.entries(MOVE_UPGRADES).forEach(function(entry) {
        var move = entry[0], upg = entry[1];
        if ((cs[upg.stat] || 0) >= upg.threshold) {
          var btn = document.querySelector('[data-move="' + move + '"] .arena-move-btn__label');
          var descEl = document.querySelector('[data-move="' + move + '"] .arena-move-btn__desc');
          if (btn) btn.textContent = upg.name;
          if (descEl) descEl.textContent = upg.desc;
        }
      });
    }
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
  // DEBUG / CHEAT CONSOLE — delegated to bs-debug.js (window.BsDebug)
  // ============================================================

  var _Dbg = window.BsDebug || {};
  if (_Dbg.setCallbacks) _Dbg.setCallbacks({ getConfig: function() { return _config; }, renderLobby: function() { renderLobby(); }, playVictoryAnimation: function() { playVictoryAnimation(); }, openForgeScreen: function(a, b) { openForgeScreen(a, b); }, getSelectedCard: function() { return _selectedCard; } });

  // ============================================================
  // BOOT
  // ============================================================

  document.addEventListener('DOMContentLoaded', () => {
    cleanupLocalStorage();
    if (isOnLandingPage()) initLanding();
    else if (isOnPlayPage()) initPlay();
  });

})();
