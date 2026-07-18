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

  function formatRelativeTime(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '···';
    const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (diffSec < 60)    return `${diffSec}s ago`;
    if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }

  async function hydrateProfile(agentId) {
    let data;
    try {
      const res = await fetch(`${apiBase()}/agentPublicProfile?id=${encodeURIComponent(agentId)}`);
      if (!res.ok) return;
      data = await res.json();
    } catch (e) {
      return; // network / CORS / parse error — leave placeholders in place
    }

    // Status pill
    const pill = document.getElementById('agent-status-pill');
    if (pill) {
      if (data.status) {
        pill.setAttribute('data-status', data.status);
        pill.textContent = data.status;
      } else {
        pill.textContent = '···';
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

    // As-of stamp (relative time, sits at the end of the row)
    const asOfEl = document.getElementById('agent-live-asof');
    if (asOfEl && data.asOf) {
      asOfEl.textContent = 'as of ' + formatRelativeTime(data.asOf);
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

    // Progression block (Stage 3) — inject into the live band, above the memory.
    if (data.progression) {
      const band = document.getElementById('agent-live-band');
      if (band && !document.getElementById('agent-prog')) {
        const p = data.progression;
        const prog = document.createElement('div');
        prog.className = 'agent-prog';
        prog.id = 'agent-prog';

        const head = document.createElement('div');
        head.className = 'agent-prog-head';
        const lv = document.createElement('span');
        lv.className = 'agent-level';
        lv.textContent = 'LV ' + p.level;
        const cls = document.createElement('span');
        cls.className = 'agent-prog-class';
        cls.textContent = (p.rank || '') + (p.class ? ' · ' + p.class : '');
        head.appendChild(lv); head.appendChild(cls);
        prog.appendChild(head);

        const bar = document.createElement('div');
        bar.className = 'agent-xpbar';
        const fill = document.createElement('div');
        fill.className = 'agent-xpbar-fill';
        fill.style.width = (p.pct || 0) + '%';
        bar.appendChild(fill);
        prog.appendChild(bar);

        const stats = document.createElement('div');
        stats.className = 'agent-prog-stats';
        const statBits = [p.xp + ' XP'];
        if (typeof p.weeklyXp === 'number') statBits.push('+' + p.weeklyXp + ' XP this week');
        statBits.push(p.xpInto + ' / ' + p.xpForNext + ' to LV ' + (p.level + 1));
        statBits.push(p.renown + ' Renown');
        statBits.push(p.streakDays + '-day streak' + (p.streakMult > 1 ? ' ×' + p.streakMult : ''));
        statBits.forEach(function (t) {
          const s = document.createElement('span'); s.textContent = t; stats.appendChild(s);
        });
        prog.appendChild(stats);

        if (p.lastOutcome && (p.lastOutcome.reason || p.lastOutcome.type)) {
          const lo = document.createElement('div');
          lo.className = 'agent-prog-stats';
          const loBits = ['Last outcome — ' + String(p.lastOutcome.reason || p.lastOutcome.type).replace(/_/g, ' '), '+' + p.lastOutcome.xp + ' XP'];
          if (p.lastOutcome.at) loBits.push(formatRelativeTime(p.lastOutcome.at));
          const loSpan = document.createElement('span');
          loSpan.textContent = loBits.join(' · ');
          lo.appendChild(loSpan);
          prog.appendChild(lo);
        }

        if (Array.isArray(p.achievements) && p.achievements.length) {
          const badges = document.createElement('div');
          badges.className = 'agent-badges';
          p.achievements.forEach(function (b) {
            const el = document.createElement('span');
            el.className = 'agent-badge ' + (b.tier || 'bronze');
            el.textContent = b.label;
            badges.appendChild(el);
          });
          prog.appendChild(badges);
        }

        // Place above the memory inside .agent-live-body so the column gap spaces it.
        const mem = document.getElementById('agent-memory');
        if (mem && mem.parentNode) mem.parentNode.insertBefore(prog, mem);
        else band.appendChild(prog);
      }
    }

    // Career timeline (Stage 3) — inject a section before the crew section.
    if (Array.isArray(data.career) && data.career.length) {
      const main = document.querySelector('main[data-agent-id]');
      if (main && !document.getElementById('agent-career')) {
        const sec = document.createElement('section');
        sec.className = 'agent-sec agent-career';
        sec.id = 'agent-career';
        const h = document.createElement('div');
        h.className = 'agent-sec-head';
        const tag = document.createElement('span');
        tag.className = 'agent-sec-tag';
        tag.textContent = 'Career';
        const sub = document.createElement('span');
        sub.className = 'agent-sec-sub';
        sub.textContent = 'Milestones + evolution';
        h.appendChild(tag); h.appendChild(sub);
        sec.appendChild(h);
        const ul = document.createElement('ul');
        ul.className = 'agent-timeline';
        data.career.forEach(function (c) {
          const li = document.createElement('li');
          const dt = document.createElement('span');
          dt.className = 'agent-tl-date';
          dt.textContent = (c.at || '').slice(0, 10);
          const lb = document.createElement('span');
          lb.className = 'agent-tl-label';
          lb.textContent = c.label || '';
          li.appendChild(dt); li.appendChild(lb);
          ul.appendChild(li);
        });
        sec.appendChild(ul);
        const crew = main.querySelector('.agent-crew');
        if (crew) main.insertBefore(sec, crew);
        else main.appendChild(sec);
      }
    }
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
      if (!dot) continue;
      if (agent.status) dot.setAttribute('data-status', agent.status);
      // TODO: server returns per-agent lastHeartbeatAt. Wire when available.
      const ago = agent.lastHeartbeatAt ? formatRelativeTime(agent.lastHeartbeatAt) : '3m ago';
      dot.setAttribute('title', `online · last heartbeat ${ago}`);

      // Level chip (Stage 3) — only once the rewards engine has populated levels.
      if (agent.level && !card.querySelector('.agent-hub-card-lv')) {
        const chip = document.createElement('span');
        chip.className = 'agent-hub-card-lv';
        chip.textContent = 'LV ' + agent.level;
        if (agent.rank) chip.setAttribute('title', agent.rank);
        const roleEl = card.querySelector('.agent-hub-card-role');
        if (roleEl && roleEl.parentNode) roleEl.parentNode.insertBefore(chip, roleEl.nextSibling);
        else card.appendChild(chip);
      }
    }
  }

  async function hydratePulse() {
    const set = (key, value) => {
      const el = document.querySelector(`[data-pulse="${key}"]`);
      if (el) el.textContent = value;
    };
    try {
      const [pulseRes, worldRes] = await Promise.allSettled([
        fetch(`${apiBase()}/pulseStats`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase()}/worldState`).then(r => r.ok ? r.json() : null)
      ]);
      const pulse = pulseRes.status === 'fulfilled' ? pulseRes.value : null;
      const world = worldRes.status === 'fulfilled' ? worldRes.value : null;

      if (pulse?.lastHeartbeatAt) set('lastHeartbeat', formatRelativeTime(pulse.lastHeartbeatAt));
      if (typeof pulse?.cyclesToday === 'number') set('cyclesToday', String(pulse.cyclesToday));
      if (typeof world?.openApprovals?.count === 'number') set('proposalsQueued', String(world.openApprovals.count));

      if (world) {
        const financeRed = world?.finance?.status === 'RED';
        const fleetStalled = (world?.fleet?.stalledCount ?? 0) > 0;
        set('systemsStatus', (financeRed || fleetStalled) ? 'degraded' : 'nominal');
      }
    } catch (_) { /* leave ··· placeholders */ }
  }

  function init() {
    const script = document.currentScript || document.querySelector('script[src*="agent-profile-live.js"]');
    const mode = (script && script.getAttribute('data-mode')) || 'profile';

    if (mode === 'hub') {
      hydrateHub();
      hydratePulse();
      let pulseInterval = setInterval(hydratePulse, 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          clearInterval(pulseInterval);
        } else {
          hydratePulse();
          pulseInterval = setInterval(hydratePulse, 60_000);
        }
      });
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
