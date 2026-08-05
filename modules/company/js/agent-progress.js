// Agent Progress dashboard — fused all-up view of fleet progression.
// Reads the rewards ledger + registry + allocation/reflection/finance digests and
// renders: Fleet Pulse, a portrait roster (level/XP/streak/health, click-to-expand),
// and a fleet-wide achievements feed. Read-only — actions live on the Fleet page.
//
// Pure helpers are exported for node tests; DOM render + fetch run only in the browser.
// See docs/superpowers/specs/2026-06-20-agent-progress-dashboard-design.md

(function () {
  'use strict';

  // ── Pure helpers (node-testable) ────────────────────────────────────────────
  function xpBarPct(level, xp) {
    var lvl = level || 1;
    var cost = 50 + 25 * lvl;
    var cum = 50 * (lvl - 1) + 25 * (lvl - 1) * lvl / 2;
    var into = Math.max(0, (xp || 0) - cum);
    return Math.max(0, Math.min(100, Math.round(into / cost * 100)));
  }

  function computeFleetPulse(rewards) {
    var pa = (rewards && rewards.perAgent) || {};
    var ids = Object.keys(pa);
    if (!ids.length) return { totalXp: 0, avgLevel: 0, topAgentId: null, achievementsUnlocked: 0 };
    var totalXp = 0, totalLvl = 0, ach = 0, top = null, topXp = -1;
    ids.forEach(function (id) {
      var a = pa[id] || {};
      totalXp += a.xp || 0;
      totalLvl += a.level || 1;
      ach += Array.isArray(a.achievements) ? a.achievements.length : 0;
      if ((a.xp || 0) > topXp) { topXp = a.xp || 0; top = id; }
    });
    return { totalXp: totalXp, avgLevel: Math.round(totalLvl / ids.length * 10) / 10, topAgentId: top, achievementsUnlocked: ach };
  }

  function sortByXp(rewards) {
    var pa = (rewards && rewards.perAgent) || {};
    return Object.keys(pa).sort(function (a, b) { return (pa[b].xp || 0) - (pa[a].xp || 0); });
  }

  function healthFlag(agentId, ctx) {
    ctx = ctx || {};
    var alloc = ctx.allocPA && ctx.allocPA[agentId];
    if (alloc && alloc.status === 'RED') return 'red';
    var rd = ctx.rdPA && ctx.rdPA[agentId];
    var drift = rd && rd.roleAdherence && rd.roleAdherence.drift;
    var stale = ctx.eff && ctx.eff[agentId] && ctx.eff[agentId].executed === 0;
    if ((alloc && alloc.status === 'YELLOW') || (drift && drift !== 'on-role') || stale) return 'yellow';
    return 'green';
  }

  function fleetHealth(ids, ctx) {
    var worst = 'green';
    ids.forEach(function (id) {
      var h = healthFlag(id, ctx);
      if (h === 'red') worst = 'red';
      else if (h === 'yellow' && worst !== 'red') worst = 'yellow';
    });
    return worst;
  }

  var _exports = { computeFleetPulse: computeFleetPulse, healthFlag: healthFlag, sortByXp: sortByXp, xpBarPct: xpBarPct, fleetHealth: fleetHealth };
  if (typeof module !== 'undefined' && module.exports) { module.exports = _exports; }

  // ── Browser-only below ──────────────────────────────────────────────────────
  if (typeof document === 'undefined') return;

  var API = (location.hostname.indexOf('ambientpixels.ai') !== -1)
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';
  var SECRET = (window.AP_SECRET || 'pixelpusher');

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function gj(path) { return fetch(API + path, { headers: { 'x-company-secret': SECRET } }).then(function (r) { return r.json(); }).catch(function () { return null; }); }
  function portrait(id, cls) { if (id === 'vale') return '<i class="fas fa-user-tie ' + cls + '" title="Vale" style="color:#9b8cff;display:inline-flex;align-items:center;justify-content:center;"></i>'; return '<img class="' + cls + '" src="/ambientos/img/' + esc(id) + '.webp" alt="' + esc(cap(id)) + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">'; }
  function dot(h) { return '<span class="ap-dot ap-dot-' + h + '" title="' + h + '"></span>'; }

  function load() {
    return Promise.all([
      gj('/agentRewards'),
      gj('/company-state?key=agentRegistry'),
      gj('/allocationDigest'),
      gj('/company-state?key=runtimeMemory')
    ]).then(function (a) {
      return {
        rewards: (a[0] && a[0].perAgent) ? a[0] : { perAgent: {}, company: {} },
        registry: (a[1] && a[1].value) || { agents: [] },
        allocPA: (a[2] && a[2].perAgent) || {},
        rdPA: (a[3] && a[3].value && a[3].value.reflectionDigest && a[3].value.reflectionDigest.perAgent) || {},
        eff: (a[3] && a[3].value && a[3].value.financeDigest && a[3].value.financeDigest.agentEfficiency) || {}
      };
    });
  }

  function roleOf(registry, id) {
    var ag = ((registry && registry.agents) || []).filter(function (x) { return x.id === id; })[0];
    return { name: (ag && ag.name) || cap(id), role: (ag && ag.role) || '', tier: ag && ag.tier };
  }

  function renderPulse(d) {
    var p = computeFleetPulse(d.rewards);
    var ids = Object.keys((d.rewards && d.rewards.perAgent) || {});
    var fh = fleetHealth(ids, d);
    var topRole = p.topAgentId ? roleOf(d.registry, p.topAgentId) : null;
    var topLvl = p.topAgentId ? (d.rewards.perAgent[p.topAgentId].level || 1) : 0;
    var topChip = p.topAgentId
      ? ('<span class="ap-chip-top">' + portrait(p.topAgentId, 'ap-chip-portrait') + esc(cap(p.topAgentId)) + ' L' + topLvl + '</span>')
      : '<span class="ap-chip-value">—</span>';
    var chips = [
      { l: 'Total XP', v: String(p.totalXp) },
      { l: 'Avg Level', v: 'Lv ' + p.avgLevel },
      { l: 'Top Agent', v: topChip, raw: true },
      { l: 'Achievements', v: String(p.achievementsUnlocked) },
      { l: 'Fleet Health', v: dot(fh) + ' ' + fh, raw: true }
    ];
    document.getElementById('ap-pulse').innerHTML = chips.map(function (c) {
      return '<div class="ap-chip"><div class="ap-chip-label">' + esc(c.l) + '</div><div class="ap-chip-value">' + (c.raw ? c.v : esc(c.v)) + '</div></div>';
    }).join('');
  }

  function renderRoster(d) {
    var pa = (d.rewards && d.rewards.perAgent) || {};
    var ids = sortByXp(d.rewards);
    if (!ids.length) { document.getElementById('ap-roster').innerHTML = '<div class="ap-empty">No reward data yet — the rewards engine populates this hourly (or POST /api/rewards-engine-trigger).</div>'; return; }
    document.getElementById('ap-roster').innerHTML = ids.map(function (id, i) {
      var a = pa[id];
      var r = roleOf(d.registry, id);
      var h = healthFlag(id, d);
      var lvl = a.level || 1;
      var pct = xpBarPct(lvl, a.xp);
      var costNext = 50 + 25 * lvl, cum = 50 * (lvl - 1) + 25 * (lvl - 1) * lvl / 2, into = Math.max(0, (a.xp || 0) - cum);
      var badges = (Array.isArray(a.achievements) ? a.achievements : []).map(function (b) {
        return '<span class="ap-badge ' + esc(b.tier || 'bronze') + '">' + esc(b.label || b.id) + '</span>';
      }).join('') || '<span class="ap-dim">No achievements yet.</span>';
      var ctr = a.counters || {};
      var counters = [['approvals', ctr.approvals], ['blogs', ctr.blogs], ['posts', ctr.socialPosts], ['tasks', ctr.tasksDone], ['assists', ctr.assists], ['engagement', ctr.engagementTotal]]
        .map(function (c) { return '<span class="ap-ctr">' + esc(c[0]) + ': <strong>' + (c[1] || 0) + '</strong></span>'; }).join('');
      var recent = (Array.isArray(a.recent) ? a.recent.slice(0, 6) : []).map(function (e) {
        return '<li>' + esc((e.at || '').slice(0, 10)) + ' · ' + esc(e.type) + (e.xp ? ' (+' + e.xp + ' XP)' : '') + '</li>';
      }).join('') || '<li class="ap-dim">No recent outcomes.</li>';

      return '<div class="ap-row" data-agent="' + esc(id) + '">' +
        '<div class="ap-row-head">' +
          '<span class="ap-rank-num">#' + (i + 1) + '</span>' +
          portrait(id, 'ap-portrait') +
          '<span class="ap-id"><span class="ap-name">' + esc(r.name) + '</span><span class="ap-sub">L' + lvl + ' · ' + esc(a.rank || 'Rookie') + (r.role ? ' · ' + esc(r.role) : '') + '</span></span>' +
          '<span class="ap-barwrap"><span class="ap-xpbar"><span class="ap-xpbar-fill" style="width:' + pct + '%"></span></span><span class="ap-barlabel">' + into + '/' + costNext + '</span></span>' +
          '<span class="ap-stat">' + (a.xp || 0) + ' XP</span>' +
          '<span class="ap-stat ap-dim">' + (a.renown || 0) + ' RN</span>' +
          '<span class="ap-stat ap-dim">' + (a.streakDays || 0) + 'd</span>' +
          dot(h) +
          '<i class="fas fa-chevron-down ap-chev"></i>' +
        '</div>' +
        '<div class="ap-detail" hidden>' +
          '<div class="ap-detail-grid">' +
            '<div class="ap-detail-col"><div class="ap-detail-h">Achievements</div><div class="ap-badges">' + badges + '</div>' +
              '<div class="ap-detail-h">Lifetime</div><div class="ap-counters">' + counters + '</div></div>' +
            '<div class="ap-detail-col"><div class="ap-detail-h">Recent outcomes</div><ul class="ap-recent">' + recent + '</ul>' +
              '<a class="ap-manage" href="/modules/company/fleet.html">Manage in Fleet →</a></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    document.getElementById('ap-roster').querySelectorAll('.ap-row-head').forEach(function (head) {
      head.addEventListener('click', function () {
        var row = head.parentElement;
        var det = row.querySelector('.ap-detail');
        if (det) det.hidden = !det.hidden;
        row.classList.toggle('open');
      });
    });
  }

  function renderAchievements(d) {
    var pa = (d.rewards && d.rewards.perAgent) || {};
    var all = [];
    var tiers = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
    Object.keys(pa).forEach(function (id) {
      (Array.isArray(pa[id].achievements) ? pa[id].achievements : []).forEach(function (a) {
        all.push({ agentId: id, label: a.label || a.id, tier: a.tier || 'bronze', at: a.at });
        if (tiers[a.tier || 'bronze'] != null) tiers[a.tier || 'bronze']++;
      });
    });
    // company milestones too
    var comp = (d.rewards && d.rewards.company && d.rewards.company.achievements) || [];
    comp.forEach(function (a) { all.push({ agentId: 'fleet', label: a.label || a.id, tier: 'gold', at: a.at }); });
    if (!all.length) { document.getElementById('ap-achievements').innerHTML = '<div class="ap-empty">No achievements unlocked yet.</div>'; return; }
    all.sort(function (x, y) { return (Date.parse(y.at || '') || 0) - (Date.parse(x.at || '') || 0); });
    var summary = '<div class="ap-ach-summary">' + tiers.bronze + ' bronze · ' + tiers.silver + ' silver · ' + tiers.gold + ' gold · ' + tiers.platinum + ' platinum</div>';
    var feed = '<ul class="ap-ach-feed">' + all.slice(0, 14).map(function (m) {
      return '<li><span class="ap-ach-date">' + esc((m.at || '').slice(0, 10)) + '</span> <span class="ap-badge ' + esc(m.tier) + '">' + esc(m.label) + '</span> <span class="ap-dim">' + esc(cap(m.agentId)) + '</span></li>';
    }).join('') + '</ul>';
    document.getElementById('ap-achievements').innerHTML = summary + feed;
  }

  function wireCollapse() {
    document.querySelectorAll('.sys-section-hdr').forEach(function (hdr) {
      hdr.addEventListener('click', function (e) {
        if (e.target.closest('.ap-row')) return; // don't collapse the whole section when expanding a row
        hdr.parentElement.classList.toggle('collapsed');
      });
    });
  }

  load().then(function (d) {
    try { renderPulse(d); } catch (e) {}
    try { renderRoster(d); } catch (e) {}
    try { renderAchievements(d); } catch (e) {}
    wireCollapse();
  }).catch(function () {
    var el = document.getElementById('ap-roster');
    if (el) el.innerHTML = '<div class="ap-empty">Failed to load agent progress.</div>';
  });
})();
