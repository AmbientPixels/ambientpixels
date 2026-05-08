/**
 * Blindspot Public Stats — fetches /api/blindspotstats once on load,
 * renders the 6 tiles, no auto-refresh. Refreshing the browser pulls fresh data.
 */
(function () {
  'use strict';

  function fmtCount(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return n.toLocaleString();
  }

  function fmtAsOf(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    var time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return date + ' ' + time;
  }

  function setTile(key, val) {
    var el = document.querySelector('[data-value-for="' + key + '"]');
    if (el) el.textContent = fmtCount(val);
  }

  function showError(msg) {
    var el = document.getElementById('bs-stats-error');
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
  }

  function endpointUrl() {
    if (typeof window.buildApiPath === 'function') return window.buildApiPath('stats');
    return '/api/blindspotstats';
  }

  fetch(endpointUrl(), { credentials: 'omit' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.ok || !data.stats) throw new Error('bad payload');
      setTile('players', data.stats.players);
      setTile('cardsForged', data.stats.cardsForged);
      setTile('cardsPublished', data.stats.cardsPublished);
      setTile('bossesDefeated', data.stats.bossesDefeated);
      setTile('battlesFought', data.stats.battlesFought);
      setTile('aiGenerations', data.stats.aiGenerations);
      var asOfEl = document.getElementById('bs-stats-asof');
      if (asOfEl) asOfEl.textContent = fmtAsOf(data.asOf);
      if (data._warning) {
        var warnEl = document.getElementById('bs-stats-warning');
        if (warnEl) {
          warnEl.textContent = data._warning;
          warnEl.hidden = false;
        }
      }
    })
    .catch(function (err) {
      console.warn('[bs-stats] load failed:', err);
      showError('Stats temporarily unavailable. Refresh in a minute.');
    });
})();
