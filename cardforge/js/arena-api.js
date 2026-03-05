/**
 * Arena API — HTTP wrappers for all arena endpoints
 * Uses window.buildApiPath() from config.js and CSRF-patched fetch
 */
window.ArenaAPI = (function () {
  'use strict';

  // Fetch /.auth/me once and share the promise so concurrent callers all wait
  let _principalPromise = null;

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

  async function apiFetch(endpoint, options = {}) {
    const url = window.buildApiPath(endpoint, options.params || {});
    if (!url) throw new Error(`Unknown endpoint: ${endpoint}`);

    const fetchOpts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    };

    // Forward client principal for auth on direct API calls
    // Uses custom header name — Azure strips the reserved x-ms-client-principal on direct calls
    const principal = await fetchPrincipal();
    if (principal) {
      fetchOpts.headers['X-CF-Auth-Principal'] = principal;
    }

    // Add CSRF token for POST requests
    if (fetchOpts.method === 'POST') {
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta && csrfMeta.content) {
        fetchOpts.headers['X-CSRF-Token'] = csrfMeta.content;
      }
    }

    if (options.body) {
      fetchOpts.body = JSON.stringify(options.body);
    }

    const resp = await fetch(url, fetchOpts);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `API error ${resp.status}`);
    }
    return data;
  }

  return {
    // Profile
    loadProfile() {
      return apiFetch('arenaProfile');
    },

    selectCard(cardId) {
      return apiFetch('arenaProfile', {
        method: 'POST',
        body: { action: 'selectCard', cardId }
      });
    },

    // Bosses
    loadBosses() {
      return apiFetch('arenaBosses');
    },

    // Battle
    startBattle(type, cardId, opponentId, extra) {
      return apiFetch('arenaBattle', {
        method: 'POST',
        body: { action: 'start', type, cardId, opponentId, ...(extra || {}) }
      });
    },

    submitMove(battleId, round, move) {
      return apiFetch('arenaBattle', {
        method: 'POST',
        body: { action: 'move', battleId, round, move }
      });
    },

    forfeitBattle(battleId) {
      return apiFetch('arenaBattle', {
        method: 'POST',
        body: { action: 'forfeit', battleId }
      });
    },

    // History
    loadHistory(limit = 20, offset = 0) {
      return apiFetch('arenaHistory', {
        params: { limit, offset }
      });
    },

    // Load user's cards (reuse existing endpoint)
    loadCards() {
      return apiFetch('loadCards');
    },

    // Expose auth header for use by other modules (e.g., card editor)
    async getPrincipalHeader() {
      var principal = await fetchPrincipal();
      return principal ? { 'X-CF-Auth-Principal': principal } : {};
    }
  };
})();
