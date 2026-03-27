/**
 * Blindspot Arena API — HTTP wrappers for all arena endpoints
 * Forked from CardForge arena-api.js — uses Blindspot battle/bosses endpoints
 */
window.ArenaAPI = (function () {
  'use strict';

  var _principalPromise = null;

  function fetchPrincipal() {
    if (!_principalPromise) {
      var thisPromise = Promise.race([
        fetch('/.auth/me')
          .then(function (resp) { return resp.ok ? resp.json() : { clientPrincipal: null }; })
          .then(function (data) {
            if (data && data.clientPrincipal) {
              return btoa(JSON.stringify(data.clientPrincipal));
            }
            return null;
          })
          .catch(function () { return null; }),
        new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 5000); })
      ]).then(function (result) {
        // Clear cache atomically — only if WE are still the cached promise (prevents race condition)
        if (_principalPromise === thisPromise && result === null) _principalPromise = null;
        return result;
      });
      _principalPromise = thisPromise;
    }
    return _principalPromise;
  }

  async function apiFetch(endpoint, options) {
    options = options || {};
    var url = window.buildApiPath(endpoint, options.params || {});
    if (!url) throw new Error('Unknown endpoint: ' + endpoint);

    var fetchOpts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    };

    var principal = await fetchPrincipal();
    if (principal) {
      fetchOpts.headers['X-CF-Auth-Principal'] = principal;
    }

    if (fetchOpts.method === 'POST') {
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta && csrfMeta.content) {
        fetchOpts.headers['X-CSRF-Token'] = csrfMeta.content;
      }
    }

    if (options.body) {
      fetchOpts.body = JSON.stringify(options.body);
    }

    var resp = await fetch(url, fetchOpts);
    var data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || 'API error ' + resp.status);
    }
    return data;
  }

  return {
    loadProfile: function () {
      return apiFetch('arenaProfile');
    },
    selectCard: function (cardId) {
      return apiFetch('arenaProfile', {
        method: 'POST',
        body: { action: 'selectCard', cardId: cardId }
      });
    },
    loadBosses: function () {
      return apiFetch('arenaBosses');
    },
    startBattle: function (type, cardId, opponentId, extra) {
      return apiFetch('arenaBattle', {
        method: 'POST',
        body: Object.assign({ action: 'start', type: type, cardId: cardId, opponentId: opponentId }, extra || {})
      });
    },
    submitMove: function (battleId, round, move, extra) {
      // Auto-route async PvP battles to the async endpoint
      var endpoint = (battleId && battleId.indexOf('bs-async-') === 0) ? 'asyncBattle' : 'arenaBattle';
      // Dual-action: send moves array if move is an array, else legacy single move
      var payload = Object.assign({ action: 'move', battleId: battleId, round: round }, extra || {});
      if (Array.isArray(move)) {
        payload.moves = move;
      } else {
        payload.move = move;
      }
      return apiFetch(endpoint, { method: 'POST', body: payload });
    },
    forfeitBattle: function (battleId) {
      var endpoint = (battleId && battleId.indexOf('bs-async-') === 0) ? 'asyncBattle' : 'arenaBattle';
      return apiFetch(endpoint, {
        method: 'POST',
        body: { action: 'forfeit', battleId: battleId }
      });
    },
    loadHistory: function (limit, offset) {
      return apiFetch('arenaHistory', {
        params: { limit: limit || 20, offset: offset || 0 }
      });
    },
    loadLeaderboard: function (sort, limit) {
      return apiFetch('arenaLeaderboard', {
        params: { sort: sort || 'xp', limit: limit || 50 }
      });
    },
    loadCards: function () {
      return apiFetch('loadCards');
    },
    getPrincipalHeader: async function () {
      var principal = await fetchPrincipal();
      return principal ? { 'X-CF-Auth-Principal': principal } : {};
    },

    // ── Async PvP: Defense Queue ──

    loadDefenseQueue: function () {
      return apiFetch('defenseQueue');
    },
    registerDefense: function (cardId, cardData) {
      return apiFetch('defenseQueue', {
        method: 'POST',
        body: { action: 'register', cardId: cardId, cardData: cardData }
      });
    },
    withdrawDefense: function () {
      return apiFetch('defenseQueue', {
        method: 'POST',
        body: { action: 'withdraw' }
      });
    },

    // ── Async PvP: Battle ──

    startAsyncBattle: function (cardId, defenderId, extra) {
      return apiFetch('asyncBattle', {
        method: 'POST',
        body: Object.assign({ action: 'start', cardId: cardId, defenderId: defenderId }, extra || {})
      });
    },
    submitAsyncMove: function (battleId, round, move) {
      return apiFetch('asyncBattle', {
        method: 'POST',
        body: { action: 'move', battleId: battleId, round: round, move: move }
      });
    },
    forfeitAsyncBattle: function (battleId) {
      return apiFetch('asyncBattle', {
        method: 'POST',
        body: { action: 'forfeit', battleId: battleId }
      });
    },

    // ── Async PvP: Results Inbox ──

    loadInbox: function () {
      return apiFetch('resultsInbox');
    },
    dismissResult: function (resultId) {
      return apiFetch('resultsInbox', {
        method: 'POST',
        body: { action: 'dismiss', resultId: resultId }
      });
    },
    dismissAllResults: function () {
      return apiFetch('resultsInbox', {
        method: 'POST',
        body: { action: 'dismissAll' }
      });
    },
    clearReadResults: function () {
      return apiFetch('resultsInbox', {
        method: 'POST',
        body: { action: 'clear' }
      });
    },

    // ── Card Economy ──

    sellCard: function (cardId) {
      return apiFetch('sellCard', {
        method: 'POST',
        body: { cardId: cardId }
      });
    },
    lockCard: function (cardId, action) {
      return apiFetch('lockCard', {
        method: 'POST',
        body: { cardId: cardId, action: action }
      });
    }
  };
})();
