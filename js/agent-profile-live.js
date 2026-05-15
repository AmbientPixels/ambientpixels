// AmbientOS agent profile live band — fetches /api/agentPublicProfile and injects.
// Two modes:
//   - profile (default): reads data-agent-id from <main>, hydrates the §02 Right Now band
//   - hub: script tag carries data-mode="hub", hydrates the 8 status dots on the hub page
// Failure mode: silently leaves the band un-hydrated. Static content unaffected, no console errors.

(function () {
  'use strict';

  function apiBase() {
    return window.location.hostname.includes('ambientpixels.ai')
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
      : '/api';
  }

  async function hydrateProfile(agentId) {
    let data;
    try {
      const res = await fetch(`${apiBase()}/agentPublicProfile?id=${encodeURIComponent(agentId)}`);
      if (!res.ok) return;
      data = await res.json();
    } catch (e) {
      return; // network / CORS / parse error — leave band un-hydrated
    }

    const band = document.getElementById('agent-live-band');
    if (!band) return;

    // Status pill
    const pill = document.getElementById('agent-status-pill');
    if (pill) {
      if (data.status) {
        pill.setAttribute('data-status', data.status);
        pill.textContent = data.status;
      } else {
        pill.textContent = '—';
      }
    }

    // Stat chip
    const statEl = document.getElementById('agent-stat');
    if (statEl && data.stat && data.stat.label && data.stat.value) {
      statEl.innerHTML = '';
      statEl.appendChild(document.createTextNode(data.stat.label + ': '));
      const v = document.createElement('span');
      v.className = 'agent-stat-value';
      v.textContent = data.stat.value;
      statEl.appendChild(v);
    }

    // As-of stamp (in the section head)
    const asOfEl = document.getElementById('agent-live-asof');
    if (asOfEl && data.asOf) {
      asOfEl.textContent = 'as of ' + new Date(data.asOf).toUTCString().replace(' GMT', ' UTC');
    }

    // Latest memory quote (textContent prevents any HTML injection)
    const memoryEl = document.getElementById('agent-memory');
    if (memoryEl && data.latestMemory && data.latestMemory.text) {
      memoryEl.innerHTML = '';
      memoryEl.appendChild(document.createTextNode(data.latestMemory.text));
      if (data.latestMemory.agoText) {
        const ago = document.createElement('span');
        ago.className = 'agent-memory-ago';
        ago.textContent = data.latestMemory.agoText;
        memoryEl.appendChild(ago);
      }
      memoryEl.hidden = false;
    }

    band.classList.add('is-loaded');
  }

  async function hydrateHub() {
    let data;
    try {
      const res = await fetch(`${apiBase()}/agentPublicProfile?id=all`);
      if (!res.ok) return;
      data = await res.json();
    } catch (e) {
      return;
    }

    if (!data || !Array.isArray(data.agents)) return;

    for (const agent of data.agents) {
      const card = document.querySelector(`.agent-hub-card[data-agent-id="${agent.id}"]`);
      if (!card) continue;
      const dot = card.querySelector('.agent-hub-card-status');
      if (dot && agent.status) dot.setAttribute('data-status', agent.status);
    }
  }

  function init() {
    const script = document.currentScript || document.querySelector('script[src*="agent-profile-live.js"]');
    const mode = (script && script.getAttribute('data-mode')) || 'profile';

    if (mode === 'hub') {
      hydrateHub();
    } else {
      const main = document.querySelector('main[data-agent-id]');
      const agentId = main && main.getAttribute('data-agent-id');
      if (agentId) hydrateProfile(agentId);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
