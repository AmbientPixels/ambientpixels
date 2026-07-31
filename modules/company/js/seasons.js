// Seasons dashboard — does the Revenue Seasons economy measure anything real?
//
// Four panels: season header (honest about unscored seasons), standings with the
// revenue-vs-churn XP split, effort vs outcome, and the attribution trace.
// Read-only. Data comes from GET /api/agentRewards (one call) + revenueDigest.
//
// Pure helpers are exported for node tests; DOM render + fetch run only in the browser.
// See docs/superpowers/handoffs/2026-07-31-revenue-focus-handoff.md §4

(function () {
  'use strict';

  // Fleet agents only — the ledger can carry non-fleet entries (e.g. 'ceo') that must
  // never appear in standings. Mirrors FLEET_AGENTS in rewards-engine.js.
  var FLEET = ['nova', 'cipher', 'pixel', 'forge', 'echo', 'scout', 'scribe', 'quill', 'vale'];

  // ── Pure helpers (node-testable) ────────────────────────────────────────────

  // A season is "unscored" when no par existed to judge it against. The first season
  // after Revenue Seasons shipped is deliberately unscored — the UI must say so rather
  // than implying everyone is safe on merit.
  function seasonState(rewards) {
    var meta = (rewards && rewards.seasonMeta) || {};
    var par = meta.par;
    if (par == null || !isFinite(par)) return 'unscored';
    return 'scored';
  }

  // Season ranking: seasonXp desc, lifetime xp as tie-break, then id.
  // MUST match rewards-engine rolloverSeason — the Fleet page sorts by career xp and
  // will disagree; that is expected, they measure different things.
  function seasonStandings(rewards) {
    var pa = (rewards && rewards.perAgent) || {};
    return FLEET.filter(function (id) { return pa[id]; }).map(function (id) {
      var a = pa[id] || {};
      var sx = a.seasonXp || 0;
      var rx = a.seasonRevenueXp || 0;
      return {
        id: id,
        seasonXp: sx,
        revenueXp: rx,
        churnXp: Math.max(0, sx - rx),
        revenueShare: sx > 0 ? Math.round(rx / sx * 100) : 0,
        ladderStatus: a.ladderStatus || 'safe',
        tier: (rewards && rewards.privileges && rewards.privileges.enabled !== false &&
               rewards.privileges.tiers && rewards.privileges.tiers[id]) || 'line',
        lifetimeXp: a.xp || 0
      };
    }).sort(function (a, b) {
      return (b.seasonXp - a.seasonXp) || (b.lifetimeXp - a.lifetimeXp) || (a.id < b.id ? -1 : 1);
    });
  }

  function parProgress(seasonXp, par) {
    if (par == null || !isFinite(par) || par <= 0) return null;   // unscored → no bar
    return Math.max(0, Math.min(100, Math.round((seasonXp || 0) / par * 100)));
  }

  // Days remaining in the season month. season is 'YYYY-MM'.
  function daysLeft(season, nowMs) {
    if (!season || !/^\d{4}-\d{2}$/.test(season)) return null;
    var end = Date.UTC(Number(season.slice(0, 4)), Number(season.slice(5, 7)), 1);
    return Math.max(0, Math.ceil((end - nowMs) / 86400000));
  }

  // Effort vs outcome: is the fleet's season XP coming from revenue, or from churn?
  // This is the panel that answers "is the economy measuring anything real".
  function effortVsOutcome(rewards) {
    var rows = seasonStandings(rewards);
    var totalXp = 0, totalRev = 0;
    rows.forEach(function (r) { totalXp += r.seasonXp; totalRev += r.revenueXp; });
    return {
      rows: rows,
      totalSeasonXp: totalXp,
      totalRevenueXp: totalRev,
      totalChurnXp: Math.max(0, totalXp - totalRev),
      fleetRevenueShare: totalXp > 0 ? Math.round(totalRev / totalXp * 100) : 0,
      earningAgents: rows.filter(function (r) { return r.revenueXp > 0; }).length,
      idleAgents: rows.filter(function (r) { return r.seasonXp === 0; }).length
    };
  }

  // Attribution: what share of real money can we trace to work? 100% unattributed is
  // the alarm this panel exists to raise.
  function attributionSummary(digest) {
    var d = digest || {};
    var att = Number(d.attributedRevenueCents) || 0;
    var un = Number(d.unattributedRevenueCents) || 0;
    var total = att + un;
    return {
      attributedCents: att,
      unattributedCents: un,
      totalCents: total,
      unattributedPct: total > 0 ? Math.round(un / total * 100) : 0,
      hasRevenue: total > 0,
      byCampaign: d.byCampaign || {}
    };
  }

  // Per-agent revenue events inside the current season window.
  function revenueEvents(rewards, sinceMs) {
    var pa = (rewards && rewards.perAgent) || {};
    var out = [];
    FLEET.forEach(function (id) {
      var list = (pa[id] && pa[id].revenueRecent) || [];
      list.forEach(function (e) {
        var t = Date.parse((e && e.at) || 0) || 0;
        if (sinceMs && t < sinceMs) return;
        out.push({ id: id, at: e.at, xp: Number(e.xp) || 0 });
      });
    });
    return out.sort(function (a, b) { return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0); });
  }

  var _exports = {
    FLEET: FLEET, seasonState: seasonState, seasonStandings: seasonStandings,
    parProgress: parProgress, daysLeft: daysLeft, effortVsOutcome: effortVsOutcome,
    attributionSummary: attributionSummary, revenueEvents: revenueEvents
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = _exports; }

  // ── Browser-only below ──────────────────────────────────────────────────────
  if (typeof document === 'undefined') return;

  var API = (location.hostname.indexOf('ambientpixels.ai') !== -1)
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';
  var SECRET = 'pixelpusher';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function gj(path) { return fetch(API + path, { headers: { 'x-company-secret': SECRET } }).then(function (r) { return r.json(); }).catch(function () { return null; }); }
  function money(cents) { return '$' + (Math.round((cents || 0) / 100 * 100) / 100).toLocaleString(); }

  var LADDER_LABEL = { safe: 'Safe', watch: 'Watch', squeezed: 'Squeezed', retirement_pending: 'Retirement pending' };
  var LADDER_CLASS = { safe: 'green', watch: 'amber', squeezed: 'red', retirement_pending: 'red' };
  var TIER_CLASS = { vanguard: 'purple', line: 'blue', probation: 'amber' };

  function load() {
    return Promise.all([gj('/agentRewards'), gj('/revenueDigest'), gj('/allocationDigest')])
      .then(function (a) {
        return {
          rewards: (a[0] && a[0].perAgent) ? a[0] : { perAgent: {}, seasonMeta: {} },
          digest: a[1] || {},
          allocPA: (a[2] && a[2].perAgent) || {}
        };
      });
  }

  function renderHeader(d) {
    var r = d.rewards;
    var meta = r.seasonMeta || {};
    var state = seasonState(r);
    var dl = daysLeft(r.season, Date.now());
    var champ = meta.previousChampion;
    var eo = effortVsOutcome(r);

    var stateChip = state === 'unscored'
      ? '<span class="sn-badge amber" title="No par existed for this season, so nobody can pass or fail it. No ladder movement, no privilege tiers.">UNSCORED SEASON</span>'
      : '<span class="sn-badge green">Scored · par ' + esc(String(meta.par)) + '</span>';

    var cards = [
      { l: 'Season', v: esc(r.season || '—'), s: dl == null ? '' : dl + ' days left' },
      { l: 'Par', v: meta.par == null ? '—' : String(meta.par), s: state === 'unscored' ? 'not yet set' : 'to stay safe' },
      { l: 'Fleet revenue XP', v: String(eo.totalRevenueXp), s: eo.fleetRevenueShare + '% of all season XP' },
      { l: 'Earning agents', v: eo.earningAgents + ' / ' + eo.rows.length, s: eo.idleAgents + ' with no season XP' }
    ];

    document.getElementById('sn-header').innerHTML =
      '<div class="sn-statechip">' + stateChip +
        (champ ? '<span class="sn-champ">Last champion: ' + esc(cap(champ)) + '</span>' : '') +
        (r.laddersActive === false ? '<span class="sn-badge red">LADDER DISABLED</span>' : '') +
      '</div>' +
      '<div class="sn-hero">' + cards.map(function (c) {
        return '<div class="sn-hero-card"><div class="sn-label">' + c.l + '</div>' +
          '<div class="sn-value">' + c.v + '</div>' +
          (c.s ? '<div class="sn-sub">' + esc(c.s) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
  }

  function renderStandings(d) {
    var r = d.rewards;
    var par = (r.seasonMeta || {}).par;
    var rows = seasonStandings(r);
    if (!rows.length) { document.getElementById('sn-standings').innerHTML = '<div class="sn-empty">No season data yet.</div>'; return; }

    var html = '<table class="sn-table"><thead><tr>' +
      '<th>#</th><th>Agent</th><th>Season XP</th><th>Revenue / Churn</th><th>Par</th><th>Ladder</th><th>Tier</th><th>Budget</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (row, i) {
        var pct = parProgress(row.seasonXp, par);
        var alloc = d.allocPA[row.id] || {};
        var split = row.seasonXp === 0 ? '<span class="sn-dim">no XP</span>'
          : '<span class="sn-rev">' + row.revenueXp + '</span> / <span class="sn-churn">' + row.churnXp + '</span>' +
            ' <span class="sn-dim">(' + row.revenueShare + '% rev)</span>';
        var parCell = pct == null ? '<span class="sn-dim">unscored</span>'
          : '<div class="sn-bar" title="' + row.seasonXp + ' / ' + par + '"><div class="sn-bar-fill" style="width:' + pct + '%"></div></div>';
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td class="sn-agent">' + esc(cap(row.id)) + '</td>' +
          '<td class="sn-num">' + row.seasonXp + '</td>' +
          '<td>' + split + '</td>' +
          '<td>' + parCell + '</td>' +
          '<td><span class="sn-badge ' + (LADDER_CLASS[row.ladderStatus] || 'blue') + '">' + esc(LADDER_LABEL[row.ladderStatus] || row.ladderStatus) + '</span></td>' +
          '<td><span class="sn-badge ' + (TIER_CLASS[row.tier] || 'blue') + '">' + esc(row.tier) + '</span></td>' +
          '<td class="sn-num">' + (alloc.cap != null ? '$' + alloc.cap : '—') +
            (alloc.spent != null ? ' <span class="sn-dim">/ $' + alloc.spent + '</span>' : '') + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
    document.getElementById('sn-standings').innerHTML = html;
  }

  function renderEffort(d) {
    var eo = effortVsOutcome(d.rewards);
    var max = Math.max.apply(null, eo.rows.map(function (r) { return r.seasonXp; }).concat([1]));
    var verdict = eo.totalRevenueXp === 0
      ? '<div class="sn-verdict red">No season XP has come from revenue. Every point on this board was earned by internal activity.</div>'
      : '<div class="sn-verdict">' + eo.fleetRevenueShare + '% of fleet season XP came from revenue outcomes; the rest is internal activity.</div>';

    var bars = eo.rows.map(function (r) {
      var revW = Math.round(r.revenueXp / max * 100);
      var churnW = Math.round(r.churnXp / max * 100);
      return '<div class="sn-eo-row">' +
        '<div class="sn-eo-name">' + esc(cap(r.id)) + '</div>' +
        '<div class="sn-eo-track">' +
          '<div class="sn-eo-rev" style="width:' + revW + '%" title="revenue XP ' + r.revenueXp + '"></div>' +
          '<div class="sn-eo-churn" style="width:' + churnW + '%" title="churn XP ' + r.churnXp + '"></div>' +
        '</div>' +
        '<div class="sn-eo-val">' + r.revenueXp + ' / ' + r.churnXp + '</div>' +
      '</div>';
    }).join('');

    document.getElementById('sn-effort').innerHTML = verdict +
      '<div class="sn-legend"><span class="sn-key sn-eo-rev"></span>revenue XP <span class="sn-key sn-eo-churn"></span>internal activity XP</div>' +
      bars;
  }

  function renderAttribution(d) {
    var a = attributionSummary(d.digest);
    var evs = revenueEvents(d.rewards, 0).slice(0, 12);

    var alarm = !a.hasRevenue
      ? '<div class="sn-verdict">No revenue recorded yet.</div>'
      : (a.unattributedPct >= 50
        ? '<div class="sn-verdict red">' + a.unattributedPct + '% of revenue (' + money(a.unattributedCents) + ') cannot be traced to any campaign or link. Revenue we cannot attribute cannot be repeated.</div>'
        : '<div class="sn-verdict">' + (100 - a.unattributedPct) + '% of revenue is attributed to a campaign.</div>');

    var cards = '<div class="sn-hero">' +
      '<div class="sn-hero-card"><div class="sn-label">Total revenue</div><div class="sn-value">' + money(a.totalCents) + '</div></div>' +
      '<div class="sn-hero-card"><div class="sn-label">Attributed</div><div class="sn-value">' + money(a.attributedCents) + '</div></div>' +
      '<div class="sn-hero-card"><div class="sn-label">Unattributed</div><div class="sn-value sn-red">' + money(a.unattributedCents) + '</div><div class="sn-sub">' + a.unattributedPct + '% of all revenue</div></div>' +
      '</div>';

    var list = evs.length
      ? '<table class="sn-table"><thead><tr><th>When</th><th>Agent paid</th><th>Revenue XP</th></tr></thead><tbody>' +
        evs.map(function (e) {
          return '<tr><td class="sn-dim">' + esc(String(e.at || '').slice(0, 16).replace('T', ' ')) + '</td>' +
            '<td class="sn-agent">' + esc(cap(e.id)) + '</td><td class="sn-num">' + e.xp + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="sn-empty">No revenue-lane payouts recorded.</div>';

    document.getElementById('sn-attribution').innerHTML = alarm + cards + list;
  }

  function wireCollapse() {
    Array.prototype.forEach.call(document.querySelectorAll('.sys-section-hdr'), function (h) {
      h.addEventListener('click', function () {
        var s = h.parentElement;
        if (s) s.classList.toggle('collapsed');
      });
    });
  }

  load().then(function (d) {
    try { renderHeader(d); } catch (e) {}
    try { renderStandings(d); } catch (e) {}
    try { renderEffort(d); } catch (e) {}
    try { renderAttribution(d); } catch (e) {}
    wireCollapse();
  }).catch(function () {
    var el = document.getElementById('sn-standings');
    if (el) el.innerHTML = '<div class="sn-empty">Failed to load season data.</div>';
  });
})();
