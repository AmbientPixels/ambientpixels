/**
 * adventure-storage.js — StoryForge save/load via API with localStorage fallback
 */
window.AdventureStorage = (function () {
  'use strict';

  var SAVE_API = '/api/storyforgesave';
  var LOAD_API = '/api/storyforgeload';
  var LOCAL_KEY = 'storyforge-saves';

  // --- Save adventure to server (with localStorage fallback) ---
  function saveAdventure(adventure) {
    if (!adventure || !adventure.adventureId) return Promise.resolve(false);

    // Always save to localStorage immediately
    saveLocal(adventure);

    // Try server save
    return fetch(SAVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adventure)
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Server save failed (' + res.status + ')');
      return res.json();
    })
    .then(function (data) {
      return data.success || false;
    })
    .catch(function (err) {
      console.warn('Server save failed, using localStorage:', err.message);
      return false;
    });
  }

  // --- Load all adventures from server (with localStorage fallback) ---
  function loadAdventures() {
    return fetch(LOAD_API)
      .then(function (res) {
        if (!res.ok) throw new Error('Server load failed (' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        var serverAdventures = data.adventures || [];

        // Merge with localStorage (server is source of truth, local fills gaps)
        var localAdventures = loadAllLocal();
        var merged = mergeAdventures(serverAdventures, localAdventures);

        return merged;
      })
      .catch(function (err) {
        console.warn('Server load failed, using localStorage:', err.message);
        return loadAllLocal();
      });
  }

  // --- Load single adventure by ID ---
  function loadAdventure(adventureId) {
    return fetch(LOAD_API + '?id=' + encodeURIComponent(adventureId))
      .then(function (res) {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(function (data) {
        return data.adventure || null;
      })
      .catch(function () {
        // Fallback to localStorage
        var local = loadAllLocal();
        return local.find(function (a) { return a.adventureId === adventureId; }) || null;
      });
  }

  // --- Delete adventure ---
  function deleteAdventure(adventureId) {
    // Remove from localStorage
    var saves = getLocalSaves();
    delete saves[adventureId];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(saves));

    // Server delete would require a DELETE endpoint — defer to Phase 3+
    return Promise.resolve(true);
  }

  // --- localStorage helpers ---
  function saveLocal(adventure) {
    try {
      var saves = getLocalSaves();
      saves[adventure.adventureId] = adventure;
      localStorage.setItem(LOCAL_KEY, JSON.stringify(saves));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
        // Try to free space by removing oldest non-current save
        try {
          var saves2 = getLocalSaves();
          var ids = Object.keys(saves2).filter(function (id) { return id !== adventure.adventureId; });
          if (ids.length > 0) {
            ids.sort(function (a, b) {
              return (saves2[a].updatedAt || '').localeCompare(saves2[b].updatedAt || '');
            });
            delete saves2[ids[0]];
            saves2[adventure.adventureId] = adventure;
            localStorage.setItem(LOCAL_KEY, JSON.stringify(saves2));
            console.warn('localStorage quota hit, removed oldest save');
            return;
          }
        } catch (e2) { /* fall through */ }
      }
      console.warn('localStorage save failed:', e.message);
    }
  }

  function loadAllLocal() {
    var saves = getLocalSaves();
    return Object.values(saves);
  }

  function getLocalSaves() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  // --- Merge server + local adventures (server wins on conflict) ---
  function mergeAdventures(serverList, localList) {
    var map = {};

    // Local first (lower priority)
    localList.forEach(function (a) {
      if (a.adventureId) map[a.adventureId] = a;
    });

    // Server overwrites
    serverList.forEach(function (a) {
      if (a.adventureId) map[a.adventureId] = a;
    });

    return Object.values(map).sort(function (a, b) {
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    });
  }

  return {
    saveAdventure: saveAdventure,
    loadAdventures: loadAdventures,
    loadAdventure: loadAdventure,
    deleteAdventure: deleteAdventure,
    saveLocal: saveLocal
  };
})();
