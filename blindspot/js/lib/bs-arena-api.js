/**
 * Blindspot Arena API — HTTP wrappers for all arena endpoints
 * Forked from CardForge arena-api.js — uses Blindspot battle/bosses endpoints
 */
window.ArenaAPI = (function () {
  'use strict';

  var _principalPromise = null;

  function fetchPrincipal() {
    if (!_principalPromise) {
      _principalPromise = fetch('/.auth/me')
        .then(function (resp) { return resp.ok ? resp.json() : { clientPrincipal: null }; })
        .then(function (data) {
          if (data && data.clientPrincipal) {
            return btoa(JSON.stringify(data.clientPrincipal));
          }
          return null;
        })
        .catch(function () { return null; });
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
      return apiFetch('arenaBattle', {
        method: 'POST',
        body: Object.assign({ action: 'move', battleId: battleId, round: round, move: move }, extra || {})
      });
    },
    forfeitBattle: function (battleId) {
      return apiFetch('arenaBattle', {
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
    }
  };
})();
