/**
 * CardForge Deck Store
 *
 * Cloud-syncs personal saved decks for signed-in users. localStorage stays
 * the synchronous source of truth (existing read paths keep working); this
 * module mirrors writes to a per-user blob and replaces local cache from
 * cloud on boot so the deck list is per-account, not per-browser.
 *
 * Public API (window.CardForgeDeckStore):
 *   - bootCloudSync()          → async; pull cloud → replace local cache
 *   - pushSave(deck)           → async; mirror one deck to cloud (no-op anon)
 *   - pushDelete(deckId)       → async; mirror delete to cloud (no-op anon)
 *   - hasLocalOrphans()        → bool; local has decks but cloud is empty
 *   - migrateLocalToCloud()    → async; upload all local decks to cloud
 *   - markMigrationDismissed() → mark "keep local" for this account
 *   - shouldOfferMigration()   → bool; not-yet-decided + has orphans
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cardforge_decks';
  var DECISION_KEY_PREFIX = 'cardforge_deck_migration_decision__';
  var BOOT_FLAG = '_deckStoreBootDone';
  var SAVE_ENDPOINT = 'cardforgesavedeck';
  var LOAD_ENDPOINT = 'cardforgeloadsaveddecks';
  var DELETE_ENDPOINT = 'cardforgedeletesaveddeck';

  var bootPromise = null;
  var lastCloudSnapshot = null; // last known cloud array

  function isSignedIn() {
    try {
      return sessionStorage.getItem('isAuthenticated') === 'true' ||
        (document.body && document.body.getAttribute('data-auth-state') === 'signed-in');
    } catch (_) { return false; }
  }

  function getCurrentUserId() {
    try {
      var info = JSON.parse(sessionStorage.getItem('userInfo') || '{}');
      return info.userId || null;
    } catch (_) { return null; }
  }

  function readLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  function writeLocal(decks) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(decks)); } catch (_) {}
  }

  async function getAuthHeaders() {
    if (typeof window._cfGetAuthHeaders === 'function') {
      try { return await window._cfGetAuthHeaders(); } catch (_) { return {}; }
    }
    return {};
  }

  function buildUrl(endpoint) {
    // endpoint is the bare Azure Function name. Use the configured base
    // when available, otherwise fall back to the production Function App.
    var base = (window._config && window._config.apiEndpoints && window._config.apiEndpoints.base) ||
               'https://ambientpixels-nova-api.azurewebsites.net/api';
    return base + '/' + endpoint;
  }

  function decisionKey() {
    var uid = getCurrentUserId();
    return uid ? (DECISION_KEY_PREFIX + uid) : null;
  }

  function getDecision() {
    var k = decisionKey();
    if (!k) return null;
    try { return localStorage.getItem(k) || null; } catch (_) { return null; }
  }

  function setDecision(value) {
    var k = decisionKey();
    if (!k) return;
    try { localStorage.setItem(k, value); } catch (_) {}
  }

  async function loadFromCloud() {
    if (!isSignedIn()) return null;
    try {
      var headers = Object.assign({ 'Accept': 'application/json' }, await getAuthHeaders());
      var resp = await fetch(buildUrl(LOAD_ENDPOINT), { method: 'GET', headers: headers, credentials: 'include' });
      if (!resp.ok) return null;
      var data = await resp.json();
      return Array.isArray(data && data.decks) ? data.decks : [];
    } catch (_) { return null; }
  }

  async function pushSave(deck) {
    if (!deck || !deck.id) return;
    if (!isSignedIn()) return;
    try {
      var headers = Object.assign(
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        await getAuthHeaders()
      );
      var body = { deck: deck };
      var uid = getCurrentUserId();
      if (uid) body.userId = uid; // body fallback for SWA proxy quirks
      await fetch(buildUrl(SAVE_ENDPOINT), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        credentials: 'include'
      });
    } catch (e) {
      if (window.console) console.warn('[DeckStore] pushSave failed:', e && e.message);
    }
  }

  async function pushDelete(deckId) {
    if (!deckId) return;
    if (!isSignedIn()) return;
    try {
      var headers = Object.assign(
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        await getAuthHeaders()
      );
      var body = { deckId: deckId };
      var uid = getCurrentUserId();
      if (uid) body.userId = uid;
      await fetch(buildUrl(DELETE_ENDPOINT), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        credentials: 'include'
      });
    } catch (e) {
      if (window.console) console.warn('[DeckStore] pushDelete failed:', e && e.message);
    }
  }

  /**
   * On boot: if signed in, pull cloud → REPLACE localStorage cache with the
   * cloud's view (cloud is the source of truth per account). If cloud is
   * empty AND local has decks, leave localStorage alone so the migration
   * banner can offer to upload.
   *
   * Idempotent — multiple calls return the same promise.
   */
  function bootCloudSync() {
    if (bootPromise) return bootPromise;
    bootPromise = (async function () {
      if (!isSignedIn()) {
        lastCloudSnapshot = null;
        return { synced: false, reason: 'anonymous' };
      }
      var cloud = await loadFromCloud();
      if (cloud === null) {
        // Cloud unreachable — keep local cache as-is
        return { synced: false, reason: 'cloud-error' };
      }
      lastCloudSnapshot = cloud;
      var local = readLocal();
      if (cloud.length > 0) {
        // Trust cloud; replace local cache entirely
        writeLocal(cloud);
        try { window.dispatchEvent(new CustomEvent('cardforge:decks-synced', { detail: { source: 'cloud', count: cloud.length } })); } catch (_) {}
        return { synced: true, replaced: true, count: cloud.length, hadLocal: local.length };
      }
      // Cloud empty: leave local alone — migration banner decides next step
      return { synced: true, replaced: false, count: 0, hadLocal: local.length };
    })();
    try { window[BOOT_FLAG] = true; } catch (_) {}
    return bootPromise;
  }

  function hasLocalOrphans() {
    if (!isSignedIn()) return false;
    if (!Array.isArray(lastCloudSnapshot) || lastCloudSnapshot.length > 0) return false;
    return readLocal().length > 0;
  }

  function shouldOfferMigration() {
    if (!hasLocalOrphans()) return false;
    var d = getDecision();
    return d !== 'uploaded' && d !== 'kept-local';
  }

  function markMigrationDismissed() {
    setDecision('kept-local');
  }

  async function migrateLocalToCloud() {
    if (!isSignedIn()) return { uploaded: 0 };
    var local = readLocal();
    if (!local.length) {
      setDecision('uploaded');
      return { uploaded: 0 };
    }
    var uploaded = 0;
    for (var i = 0; i < local.length; i++) {
      try { await pushSave(local[i]); uploaded++; } catch (_) {}
    }
    // Reload from cloud to confirm + replace local cache
    var cloud = await loadFromCloud();
    if (Array.isArray(cloud)) {
      writeLocal(cloud);
      lastCloudSnapshot = cloud;
    }
    setDecision('uploaded');
    try { window.dispatchEvent(new CustomEvent('cardforge:decks-synced', { detail: { source: 'migration', count: uploaded } })); } catch (_) {}
    return { uploaded: uploaded };
  }

  window.CardForgeDeckStore = {
    bootCloudSync: bootCloudSync,
    pushSave: pushSave,
    pushDelete: pushDelete,
    loadFromCloud: loadFromCloud,
    hasLocalOrphans: hasLocalOrphans,
    shouldOfferMigration: shouldOfferMigration,
    markMigrationDismissed: markMigrationDismissed,
    migrateLocalToCloud: migrateLocalToCloud
  };

  // Auto-boot once auth state is known. deck.html has window._authReady;
  // other pages may not. Use it when present, otherwise fire on DOM ready.
  function autoBoot() {
    if (window._authReady && typeof window._authReady.then === 'function') {
      window._authReady.then(function () { bootCloudSync(); }, function () { bootCloudSync(); });
    } else {
      bootCloudSync();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot);
  } else {
    autoBoot();
  }
})();
