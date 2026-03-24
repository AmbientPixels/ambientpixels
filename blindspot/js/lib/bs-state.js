/**
 * Blindspot State — Progression & Server Sync
 *
 * Owns _progress (the single source of truth for all player state).
 * Server-first: loads from API, falls back to localStorage cache.
 * Debounced sync (1s) batches rapid mutations.
 *
 * API: window.BsState
 *   .progress        — the progress object (mutate in place)
 *   .isLoaded()      — whether progress has been loaded
 *   .load()          — async, loads from server/cache
 *   .sync()          — debounced push to server
 *   .flush()         — immediate sync (for page unload)
 *   .safeLSSet(k,v)  — quota-safe localStorage write
 *   .api             — BlindspotAPI (fetchPrincipal, loadProfile, syncProfile)
 */
window.BsState = (function () {
  'use strict';

  // ============================================================
  // SAFE LOCALSTORAGE — prevents QuotaExceededError from crashing game
  // ============================================================

  function safeLSSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch (e) {
      try {
        localStorage.removeItem('bs-session-stats');
        localStorage.removeItem('cardforge_saved_cards');
        localStorage.removeItem('bs-crate-history');
        localStorage.removeItem('bs-battle-log');
        localStorage.setItem(key, value);
      } catch (e2) { /* give up */ }
    }
  }

  // ============================================================
  // PROGRESSION — server-first, in-memory source of truth
  // ============================================================

  var _progress = {
    sparks: 0, highestBoss: 0, totalWins: 0, totalBounties: 0,
    winStreak: 0, bestStreak: 0, ascension: 0,
    towerFloor: 0, towerBest: 0, forgeWins: 0, forgeVisits: 0,
    cardTitle: '', selectedCardId: null,
    pvpElo: 1000, pvpRecord: { w: 0, l: 0 },
    crateWinCounter: 0, crates: [], charms: [], cosmetics: [],
    purchasedCosmetics: [], equipped: {},
    visualUnlocks: ['palette_earth', 'container_masked'],
    bossRecords: {}, masteryClaimed: {}, claimedRewards: [],
    towerClaimed: [], weeklyBoss: {}, challenges: {}, bounties: {},
    lastDaily: ''
  };
  var _progressLoaded = false;
  var _syncInFlight = false;
  var _syncTimer = null;

  // ============================================================
  // BLINDSPOT API — auth + profile sync
  // ============================================================

  var BlindspotAPI = {
    _principalPromise: null,
    fetchPrincipal: function () {
      if (!this._principalPromise) {
        this._principalPromise = fetch('/.auth/me')
          .then(function (r) { return r.ok ? r.json() : { clientPrincipal: null }; })
          .then(function (d) {
            return d && d.clientPrincipal ? btoa(JSON.stringify(d.clientPrincipal)) : null;
          })
          .catch(function () { return null; });
      }
      return this._principalPromise;
    },
    _apiFetch: async function (method, body) {
      var url = window.buildApiPath ? window.buildApiPath('blindspotProfile') : '';
      if (!url) url = 'https://ambientpixels-nova-api.azurewebsites.net/api/blindspotprofile';
      var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
      var principal = await this.fetchPrincipal();
      if (principal) opts.headers['X-CF-Auth-Principal'] = principal;
      if (body) opts.body = JSON.stringify(body);
      var resp = await fetch(url, opts);
      var data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'API error ' + resp.status);
      return data;
    },
    loadProfile: function () { return this._apiFetch('GET'); },
    syncProfile: function (profileData) { return this._apiFetch('POST', { action: 'sync', profile: profileData }); }
  };

  // ============================================================
  // LOAD / CACHE / SYNC
  // ============================================================

  async function loadProgressFromServer() {
    var isGuest = localStorage.getItem('bs-guest-mode') === 'true';
    if (isGuest) {
      _loadProgressFromCache();
      _progressLoaded = true;
      return;
    }
    try {
      var resp = await BlindspotAPI.loadProfile();
      if (resp && resp.profile && !resp.isDemo) {
        var p = resp.profile;
        for (var key in _progress) {
          if (p[key] !== undefined && p[key] !== null) _progress[key] = p[key];
        }
      }
    } catch (e) {
      console.warn('[Blindspot] server load failed, using cache:', e.message);
      _loadProgressFromCache();
    }
    _progressLoaded = true;
    _cacheProgressToLocalStorage();
  }

  function _loadProgressFromCache() {
    try {
      var cached = localStorage.getItem('bs-progress');
      if (cached) {
        var p = JSON.parse(cached);
        for (var key in _progress) {
          if (p[key] !== undefined && p[key] !== null) _progress[key] = p[key];
        }
        return;
      }
    } catch (e) { /* fall through to legacy keys */ }
    // Legacy: migrate from 24 individual keys (pre-optimization)
    function gi(k, d) { return parseInt(localStorage.getItem(k) || String(d), 10); }
    function gj(k, d) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch (e) { return d; } }
    _progress.sparks = gi('bs-sparks', 0);
    _progress.highestBoss = gi('bs-highest-boss', 0);
    _progress.totalWins = gi('bs-total-wins', 0);
    _progress.totalBounties = gi('bs-total-bounties', 0);
    _progress.winStreak = gi('bs-win-streak', 0);
    _progress.bestStreak = gi('bs-best-streak', 0);
    _progress.ascension = gi('bs-ascension', 0);
    _progress.towerFloor = gi('bs-tower-floor', 0);
    _progress.towerBest = gi('bs-tower-best', 0);
    _progress.forgeWins = gi('bs-wins-to-forge', 0);
    _progress.forgeVisits = gi('bs-forge-visits', 0);
    _progress.cardTitle = localStorage.getItem('bs-card-title') || '';
    _progress.selectedCardId = localStorage.getItem('bs-selected-card-id') || null;
    _progress.pvpElo = gi('bs-pvp-elo', 1000);
    _progress.pvpRecord = gj('bs-pvp-record', { w: 0, l: 0 });
    _progress.crateWinCounter = gi('bs-crate-win-counter', 0);
    _progress.crates = gj('bs-crates', []);
    _progress.charms = gj('bs-charms', []);
    _progress.cosmetics = gj('bs-cosmetics', []);
    _progress.purchasedCosmetics = gj('bs-purchased-cosmetics', []);
    _progress.equipped = gj('bs-equipped', {});
    _progress.visualUnlocks = gj('bs-visual-unlocks', ['palette_earth', 'container_masked']);
    _progress.bossRecords = gj('bs-boss-records', {});
    _progress.masteryClaimed = gj('bs-mastery-claimed', {});
    _progress.claimedRewards = gj('bs-claimed-rewards', []);
    _progress.towerClaimed = gj('bs-tower-claimed', []);
    _progress.weeklyBoss = gj('bs-weekly-boss', {});
    _progress.challenges = gj('bs-challenges', {});
    _progress.bounties = gj('bs-bounties', {});
    _progress.lastDaily = localStorage.getItem('bs-last-daily') || '';
  }

  function _cacheProgressToLocalStorage() {
    try { safeLSSet('bs-progress', JSON.stringify(_progress)); }
    catch (e) { /* cache write failure is non-fatal */ }
  }

  function syncProgressToServer() {
    _cacheProgressToLocalStorage();
    if (localStorage.getItem('bs-guest-mode') === 'true') return;
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(function () {
      if (_syncInFlight) return;
      _syncInFlight = true;
      var sentProgress = JSON.parse(JSON.stringify(_progress));
      BlindspotAPI.syncProfile(_progress)
        .then(function (resp) {
          if (resp && resp.profile) {
            var p = resp.profile;
            for (var key in _progress) {
              if (p[key] !== undefined && p[key] !== null) {
                if (typeof _progress[key] === 'object') continue;
                if (JSON.stringify(_progress[key]) !== JSON.stringify(sentProgress[key])) continue;
                _progress[key] = p[key];
              }
            }
          }
        })
        .catch(function (e) {
          console.warn('[Blindspot] sync failed:', e.message);
        })
        .finally(function () {
          _syncInFlight = false;
        });
    }, 1000);
  }

  function flushSyncBeforeNavigate() {
    if (localStorage.getItem('bs-guest-mode') === 'true') return;
    _cacheProgressToLocalStorage();
    if (_syncTimer) clearTimeout(_syncTimer);
    var url = window.buildApiPath ? window.buildApiPath('blindspotProfile') : 'https://ambientpixels-nova-api.azurewebsites.net/api/blindspotprofile';
    var body = JSON.stringify({ action: 'sync', profile: _progress });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      BlindspotAPI.syncProfile(_progress).catch(function() {});
    }
  }

  // Flush progress on page unload (pagehide works with bfcache)
  window.addEventListener('pagehide', flushSyncBeforeNavigate);

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    progress: _progress,
    isLoaded: function () { return _progressLoaded; },
    load: loadProgressFromServer,
    sync: syncProgressToServer,
    flush: flushSyncBeforeNavigate,
    safeLSSet: safeLSSet,
    loadFromCache: _loadProgressFromCache,
    api: BlindspotAPI
  };
})();
