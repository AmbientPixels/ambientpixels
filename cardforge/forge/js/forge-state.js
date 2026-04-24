/* forge-state.js — central pub-sub state store for the FORGE editor.
 * Per redesign-handoff.md §13.2 (adapted — no Zustand, vanilla JS).
 *
 * Load FIRST among forge-* modules so subsequent ones can subscribe.
 *
 * API:
 *   window.ForgeState.get()          → immutable snapshot
 *   window.ForgeState.set(patch)     → shallow merge, notifies subs, debounced save
 *   window.ForgeState.subscribe(fn)  → returns unsubscribe function
 *   window.ForgeState.reset()        → back to defaults (also clears draft)
 *   window.ForgeState.load()         → hydrate from localStorage (called on boot)
 *
 * Storage key: cardforge.forge.draft.v1 (localStorage, per spec §13.2)
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'cardforge.forge.draft.v1';
  var SAVE_DEBOUNCE_MS = 300;

  function makeDefaults() {
    return {
      // Identity
      name: '',
      classId: null,
      classLabel: '',
      rarity: 'Rare',
      portraitId: 'nova',        // default character so the preview has something on first load

      // Card design
      styleId: 'ember',

      // Stats — freeform 0-100, no budget cap (locked decision)
      stats: { STR: 72, AGI: 64, INT: 88, END: 58, LCK: 45 },

      // Overlays
      overlays: { rim: true, grain: false, foil: true, signature: false },

      // Flavor (optional — not yet surfaced in simplified UI)
      backstory: '',
      abilityLine: '',

      // Publish state
      hash: null,
      shareId: null,
      shareUrl: null,
      localOnly: false,
      mintedAt: null,
      autosavedAt: null
    };
  }

  var _state = makeDefaults();
  var _subscribers = [];
  var _saveTimer = null;

  function notify(prev) {
    _subscribers.forEach(function (fn) {
      try { fn(_state, prev); }
      catch (e) { /* subscriber errors must not break other subscribers */ }
    });
  }

  function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        _state.autosavedAt = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
      } catch (e) {
        // QuotaExceeded or disabled storage — fail silently
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function get() {
    // Return a snapshot reference — subscribers should treat it as immutable.
    // Not deep-frozen because perf (editor re-renders frequently).
    return _state;
  }

  function set(patch) {
    if (!patch || typeof patch !== 'object') return;
    var prev = _state;
    var next = {};
    for (var k in prev) next[k] = prev[k];
    for (var p in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, p)) next[p] = patch[p];
    }
    _state = next;
    notify(prev);
    scheduleSave();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    _subscribers.push(fn);
    return function unsubscribe() {
      var i = _subscribers.indexOf(fn);
      if (i >= 0) _subscribers.splice(i, 1);
    };
  }

  function reset() {
    var prev = _state;
    _state = makeDefaults();
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    notify(prev);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        var prev = _state;
        var merged = makeDefaults();
        for (var k in parsed) {
          if (Object.prototype.hasOwnProperty.call(parsed, k)) merged[k] = parsed[k];
        }
        _state = merged;
        notify(prev);
      }
    } catch (e) {
      // Corrupt draft — ignore and fall back to defaults
    }
  }

  window.ForgeState = {
    get: get,
    set: set,
    subscribe: subscribe,
    reset: reset,
    load: load,
    STORAGE_KEY: STORAGE_KEY
  };

  // Hydrate from localStorage immediately (synchronous on script load, before
  // any DOMContentLoaded handler fires).
  load();
})();
