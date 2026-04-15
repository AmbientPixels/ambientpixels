// world-state-intel.js — Shared World Model (System 11)
//
// Aggregates existing digests into a canonical "state of the business"
// snapshot that every agent sees identically in their heartbeat prompt.
//
// PHILOSOPHY: Aggregator, not recomputer. Never duplicates logic from
// financeDigest / forgeOpsDigest / socialAccountStats / outcomeDigest /
// contentDigest / strategicDigest. Pulls fields through; single source of
// truth per metric.
//
// Import direction: this module imports FROM strategic-intel / social-intel
// pure helpers. NEVER the reverse (specialist intels must not know about
// world state).

const { _canonicalProduct } = require('./strategic-intel');
const { _computeCampaignPace } = require('./social-intel');

const MAX_BLOCK_CHARS = 1500;
const MAX_OBJECTIVES_IN_BLOCK = 5;
const MAX_CAMPAIGNS_IN_BLOCK = 5;
const MAX_RECENT_EVENTS = 8;
const RECENT_EVENT_WINDOW_DAYS = 7;

// Material event types — what counts as worth surfacing in the 7-day
// timeline. ceo-approval excluded as noise (routine approvals flood cap).
// campaign-pace-alert excluded — fires every heartbeat for behind-pace
// campaigns and would crowd out genuine events. Pace is already in the
// campaigns section of the digest.
const MATERIAL_EVENT_TYPES = new Set([
  'ceo-reject', 'ceo-revision', 'ceo-cancel',
  'campaign_auto_complete', 'campaign_enddate_complete',
  'stall-alert', 'system-directive-created',
  'experiment-auto-concluded'
]);

function extractRecentEvents(governanceLog, experiments, campaigns, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoff = now - (RECENT_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const events = [];

  // governanceLog events
  if (Array.isArray(governanceLog)) {
    for (let i = 0; i < governanceLog.length; i++) {
      const e = governanceLog[i];
      if (!e || !MATERIAL_EVENT_TYPES.has(e.type)) continue;
      const ts = Date.parse(e.timestamp || 0);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      events.push({
        type: e.type,
        timestamp: e.timestamp,
        summary: summarizeEvent(e),
        agent: (e.data && e.data.agentId) || null
      });
    }
  }

  // Experiment conclusions (supplement — may overlap with governanceLog)
  if (Array.isArray(experiments)) {
    for (let i = 0; i < experiments.length; i++) {
      const x = experiments[i];
      if (!x || x.status !== 'concluded' || !x.concludedAt) continue;
      const ts = Date.parse(x.concludedAt);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      // Skip if governanceLog already captured this
      const dupe = events.some(ev => ev.type === 'experiment-auto-concluded' && ev.summary.indexOf(x.hypothesis) !== -1);
      if (dupe) continue;
      events.push({
        type: 'experiment-concluded',
        timestamp: x.concludedAt,
        summary: 'experiment ' + x.hypothesis + ' ' + (x.result || 'inconclusive'),
        agent: x.agentId || null
      });
    }
  }

  // Recently-activated campaigns
  if (Array.isArray(campaigns)) {
    for (let i = 0; i < campaigns.length; i++) {
      const c = campaigns[i];
      if (!c || c.status !== 'active') continue;
      const ts = Date.parse(c.createdAt || c.created_at || 0);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      events.push({
        type: 'campaign_started',
        timestamp: c.createdAt || c.created_at,
        summary: 'campaign started: ' + String(c.title || c.id).substring(0, 50),
        agent: null
      });
    }
  }

  events.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  return events.slice(0, MAX_RECENT_EVENTS);
}

function summarizeEvent(e) {
  const data = e.data || {};
  const type = e.type;
  if (type === 'ceo-reject') return 'CEO rejected ' + (data.type || 'action') + (data.context ? ' (' + data.context + ')' : '');
  if (type === 'ceo-revision') return 'CEO requested revision on ' + (data.type || 'action');
  if (type === 'ceo-cancel') return 'CEO cancelled ' + (data.type || 'action');
  if (type === 'campaign_auto_complete' || type === 'campaign_enddate_complete') return 'campaign completed: ' + (data.campaignTitle || data.campaignId || 'unknown');
  if (type === 'stall-alert') return 'stall alert: ' + (data.agent || 'agent') + ' (' + (data.zeroRuns || '?') + ' zero-action runs)';
  if (type === 'system-directive-created') return 'directive from ' + (data.authorAgent || '?') + ' to ' + (data.targetAgent || '?');
  if (type === 'experiment-auto-concluded') return 'experiment concluded: ' + (data.hypothesis || '?') + ' ' + (data.verdict || '');
  return type;
}

function computeRunwayDays(financeDigest) {
  if (!financeDigest || !financeDigest.budget) return null;
  const monthly = financeDigest.budget.monthly || {};
  const daily = financeDigest.budget.daily || {};
  const monthlyBudget = Number(monthly.budget || 0);
  const monthlyActual = Number(monthly.actual || 0);
  const dailyAvg = Number(daily.actual || 0);
  if (dailyAvg <= 0) return null;
  if (monthlyActual >= monthlyBudget) return 0;
  return Math.floor((monthlyBudget - monthlyActual) / dailyAvg);
}

function computeHeroLine(products, financeStatus, outcomeCoverage) {
  const activeCount = (products || []).filter(p => p.status === 'active').length;
  return 'AmbientOS platform, ' + activeCount + ' products live. Finance ' + (financeStatus || 'unknown') +
    '. Outcome coverage: ' + (outcomeCoverage || 'building');
}

function buildWorldState(inputs, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const {
    financeDigest, forgeOpsDigest, outcomeDigest, strategicDigest,
    socialAccountStats, contentDigest,
    campaigns, objectives, tasks, approvalQueue, governanceLog,
    agentExperiments, executionMode, productFacts
  } = inputs || {};

  // ── COMPANY ──
  const runwayDays = computeRunwayDays(financeDigest);
  const activeMode = (executionMode && typeof executionMode === 'string') ? executionMode : 'supervised_autonomous';

  // ── FLEET ──
  const stalledAgents = (forgeOpsDigest && forgeOpsDigest.heartbeatHealth && Array.isArray(forgeOpsDigest.heartbeatHealth.stalledAgents))
    ? forgeOpsDigest.heartbeatHealth.stalledAgents.map(s => s.agent || s).filter(Boolean)
    : [];

  // ── FINANCE ──
  const finBudget = (financeDigest && financeDigest.budget) || {};
  const finTrend = (financeDigest && financeDigest.costTrend) || {};
  const financeStatus = (finBudget.monthly && finBudget.monthly.status) || (finBudget.daily && finBudget.daily.status) || 'unknown';
  const finance = {
    monthlySpendPct: (finBudget.monthly && finBudget.monthly.pct) || 0,
    monthlyActual: (finBudget.monthly && finBudget.monthly.actual) || 0,
    monthlyBudget: (finBudget.monthly && finBudget.monthly.budget) || 0,
    dailyAvg: (finBudget.daily && finBudget.daily.actual) || 0,
    burnTrend: finTrend.direction ? (finTrend.direction + (finTrend.deltaPct ? ' ' + finTrend.deltaPct + '%' : '')) : 'stable',
    projectedMonthEnd: finTrend.projected || null,
    status: String(financeStatus).toUpperCase()
  };

  // ── METRICS ──
  const followers = { x: 0, linkedin: 0, bluesky: 0, facebook: 0, total: 0 };
  if (socialAccountStats && socialAccountStats.platforms) {
    Object.keys(socialAccountStats.platforms).forEach(k => {
      const p = socialAccountStats.platforms[k];
      const count = Number((p && (p.followers || p.follower_count)) || 0);
      if (followers[k] !== undefined) followers[k] = count;
    });
    followers.total = (socialAccountStats.totals && socialAccountStats.totals.followers) || (followers.x + followers.linkedin + followers.bluesky + followers.facebook);
  }
  const blogViews30d = (contentDigest && contentDigest.topPosts)
    ? contentDigest.topPosts.reduce((s, p) => s + (p.views30d || p.views || 0), 0)
    : 0;
  const outTotals = (outcomeDigest && outcomeDigest.totals) || {};
  const outcomeCoverage = outTotals.snapshots
    ? (outTotals.complete || 0) + '/' + outTotals.snapshots + ' posts at t7'
    : 'no snapshots yet';

  // ── PRODUCTS ──
  const products = [];
  if (productFacts && productFacts.products) {
    Object.keys(productFacts.products).forEach(name => {
      const p = productFacts.products[name] || {};
      const canon = _canonicalProduct(name) || name;
      // Pull growth signal from strategicDigest if available
      let signal = null;
      if (strategicDigest && strategicDigest.perProduct) {
        const sp = strategicDigest.perProduct[canon] || strategicDigest.perProduct[name];
        if (sp && sp.verdict) signal = sp.verdict.toLowerCase();
      }
      products.push({
        name: name,
        status: p.status || 'active',
        launchedAt: p.launchedAt || null,
        signal: signal
      });
    });
  }

  // ── OBJECTIVES ──
  const activeObjectives = (Array.isArray(objectives) ? objectives : [])
    .filter(o => o && (o.status === 'active' || !o.status))
    .slice()
    .sort((a, b) => (a.progress || 0) - (b.progress || 0))
    .slice(0, MAX_OBJECTIVES_IN_BLOCK)
    .map(o => ({ id: o.id, title: String(o.title || o.id).substring(0, 50), progress: Number(o.progress || 0), endDate: o.endDate || null }));

  // ── CAMPAIGNS (with pace) ──
  const activeCampaigns = (Array.isArray(campaigns) ? campaigns : [])
    .filter(c => c && c.status === 'active')
    .slice(0, MAX_CAMPAIGNS_IN_BLOCK)
    .map(c => {
      const p = _computeCampaignPace(c, tasks, now);
      return {
        id: c.id,
        title: String(c.title || c.id).substring(0, 50),
        pace: p.pace,
        progress: p.pct,
        daysLeft: p.daysLeft,
        endDate: c.endDate || null
      };
    });

  // ── OPEN APPROVALS ──
  const pendingAQ = (Array.isArray(approvalQueue) ? approvalQueue : []).filter(a => a && a.status === 'pending');
  let oldestDays = 0;
  if (pendingAQ.length > 0) {
    const oldestTs = Math.min.apply(null, pendingAQ
      .map(a => Date.parse(a.submittedAt || a.createdAt || 0))
      .filter(t => Number.isFinite(t)));
    if (Number.isFinite(oldestTs)) oldestDays = Math.floor((now - oldestTs) / (24 * 60 * 60 * 1000));
  }

  // ── EXPERIMENTS ──
  const experimentsSummary = {
    active: (Array.isArray(agentExperiments) ? agentExperiments : []).filter(e => e && e.status === 'active').length,
    readyToConclude: (outcomeDigest && Array.isArray(outcomeDigest.perExperiment))
      ? outcomeDigest.perExperiment.filter(e => e && e.shouldAutoConclude).length : 0,
    linkedinPending: outTotals.linkedinPendingCount || 0
  };

  // ── RECENT EVENTS ──
  const recentEvents = extractRecentEvents(governanceLog, agentExperiments, campaigns, now);

  // ── Assembly ──
  const heroLine = computeHeroLine(products, finance.status, outcomeCoverage);

  return {
    generatedAt: new Date(now).toISOString(),
    company: {
      launched: (productFacts && productFacts.products && productFacts.products.AmbientOS && productFacts.products.AmbientOS.launchedAt) || null,
      activeMode: activeMode,
      runwayDays: runwayDays,
      hero: heroLine
    },
    fleet: {
      total: 8,
      stalled: stalledAgents,
      stalledCount: stalledAgents.length
    },
    finance: finance,
    metrics: {
      followers: followers,
      blogViews30d: blogViews30d,
      outcomeCoverage: outcomeCoverage
    },
    products: products,
    objectives: activeObjectives,
    campaigns: activeCampaigns,
    openApprovals: {
      count: pendingAQ.length,
      oldestDays: oldestDays
    },
    experiments: experimentsSummary,
    recentEvents: recentEvents
  };
}

// ── Prompt formatter ──
// Terse, high-density. HARD CAP at 1500 chars — throw if exceeded so silent
// bloat can't creep in as new sections are added.
function _buildWorldStatePromptBlock(worldState) {
  if (!worldState || !worldState.generatedAt) {
    return '\n═══ WORLD STATE — cache building, check back next heartbeat ═══\n';
  }

  const lines = [];
  const asOf = String(worldState.generatedAt).substring(0, 16).replace('T', ' ');
  lines.push('═══ WORLD STATE (as of ' + asOf + 'Z) ═══');

  const co = worldState.company || {};
  const runway = co.runwayDays != null ? co.runwayDays + 'd' : '—';
  lines.push('COMPANY: ' + (co.hero || 'AmbientOS platform') + '. Mode: ' + (co.activeMode || 'unknown') + '. Runway: ' + runway + ' at current burn.');

  const fin = worldState.finance || {};
  lines.push('FINANCE: $' + Number(fin.monthlyActual || 0).toFixed(2) + ' / $' + Number(fin.monthlyBudget || 0).toFixed(0) + ' monthly (' + (fin.monthlySpendPct || 0) + '%, trend ' + (fin.burnTrend || 'stable') + (fin.projectedMonthEnd ? ', projected $' + Number(fin.projectedMonthEnd).toFixed(2) : '') + '). Status: ' + (fin.status || 'unknown') + '.');

  const fleet = worldState.fleet || {};
  const stallList = fleet.stalled && fleet.stalled.length > 0 ? ' (' + fleet.stalled.join(', ') + ')' : '';
  lines.push('FLEET: ' + (fleet.total || 8) + ' agents, ' + (fleet.stalledCount || 0) + ' stalled' + stallList + '.');

  const fol = (worldState.metrics && worldState.metrics.followers) || {};
  lines.push('FOLLOWERS: bluesky ' + (fol.bluesky || 0) + ', linkedin ' + (fol.linkedin || 0) + ', x ' + (fol.x || 0) + ' (total ' + (fol.total || 0) + ').');

  const prodList = (worldState.products || []).slice(0, 7).map(p => {
    const parts = [p.name, '(', p.status];
    if (p.launchedAt) parts.push(', ' + p.launchedAt);
    if (p.signal && p.signal !== 'stable') parts.push(', ' + p.signal);
    parts.push(')');
    return parts.join('');
  }).join(', ');
  if (prodList) lines.push('PRODUCTS: ' + prodList + '.');

  const objs = worldState.objectives || [];
  if (objs.length > 0) {
    const oStr = objs.map(o => '"' + o.title + '" ' + o.progress + '%').join(', ');
    lines.push('OBJECTIVES (active, ' + objs.length + '): ' + oStr + '.');
  }

  const camps = worldState.campaigns || [];
  if (camps.length > 0) {
    const cStr = camps.map(c => '"' + c.title + '" ' + c.pace + ' ' + c.progress + '%' + (c.daysLeft != null ? ' (' + c.daysLeft + 'd left)' : '')).join(', ');
    lines.push('CAMPAIGNS (active, ' + camps.length + '): ' + cStr + '.');
  }

  const exp = worldState.experiments || {};
  lines.push('EXPERIMENTS: ' + (exp.active || 0) + ' active (' + (exp.readyToConclude || 0) + ' ready to conclude, ' + (exp.linkedinPending || 0) + ' LinkedIn pending metrics).');

  const aq = worldState.openApprovals || {};
  lines.push('OPEN APPROVALS: ' + (aq.count || 0) + ' pending' + (aq.oldestDays > 0 ? ' (oldest ' + aq.oldestDays + 'd)' : '') + '.');

  const events = worldState.recentEvents || [];
  if (events.length > 0) {
    lines.push('RECENT (7d, latest first):');
    events.slice(0, 5).forEach(e => {
      const ts = String(e.timestamp || '').substring(0, 16).replace('T', ' ');
      lines.push('- ' + ts + ': ' + String(e.summary || e.type).substring(0, 80));
    });
  }

  lines.push('═══ END WORLD STATE ═══');
  lines.push('');
  lines.push('(Summary only — check your dashboard for detail. Do not re-state these facts verbatim; build on them.)');

  const block = '\n' + lines.join('\n') + '\n';
  if (block.length > MAX_BLOCK_CHARS) {
    throw new Error('[worldState] prompt block exceeds ' + MAX_BLOCK_CHARS + ' char hard cap: ' + block.length + '. Trim fields before shipping.');
  }
  return block;
}

module.exports = {
  buildWorldState: buildWorldState,
  _buildWorldStatePromptBlock: _buildWorldStatePromptBlock,
  extractRecentEvents: extractRecentEvents,
  MAX_BLOCK_CHARS: MAX_BLOCK_CHARS
};
