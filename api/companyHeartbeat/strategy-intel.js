// strategy-intel.js — Strategic Engine SE-1/SE-2 (2026-06-11)
//
// Pure module: metric resolvers, companyStrategy digest, COMPANY STRATEGY
// prompt block, and measurable-objective evaluation. No storage calls, no
// requires — same testability class as quality-gate.js.
//
// SE-1: buildStrategyDigest(companyStrategy, sources, nowMs) → digest|null
//       _buildStrategyPromptBlock(digest) → string (hard char cap, throws over)
// SE-2: evaluateObjectives(objectives, sources, nowMs) → { changed, govEvents }
//       Mutates objectives in place (house pattern: processCampaignLifecycle).
//       Criteria live ON the objective ({metric,target,by,baseline}) so SE-2
//       works even if the companyStrategy key is missing.

const MAX_STRATEGY_BLOCK_CHARS = 1200;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Resolvers keyed by metric name. Each: (entry, sources, nowMs) → number|null.
// Adding a future metric = add one entry here; no schema change.
const METRIC_RESOLVERS = {
  bluesky_followers: function (entry, sources) {
    const s = sources && sources.socialAccountStats;
    const n = s && s.platforms && s.platforms.bluesky && Number(s.platforms.bluesky.followers);
    return Number.isFinite(n) ? n : null;
  },
  total_followers: function (entry, sources) {
    const s = sources && sources.socialAccountStats;
    const n = s && s.totals && Number(s.totals.followers);
    return Number.isFinite(n) ? n : null;
  },
  blog_views_week: function (entry, sources, nowMs) {
    const views = sources && sources.blogPostViews;
    if (!Array.isArray(views)) return null;
    const cutoff = nowMs - WEEK_MS;
    let count = 0;
    for (let i = 0; i < views.length; i++) {
      const t = Date.parse((views[i] && views[i].timestamp) || '');
      if (Number.isFinite(t) && t >= cutoff && t <= nowMs) count++;
    }
    return count;
  },
  // Revenue-visibility pipe: the PRIMARY north-star now measures itself.
  paying_customers: function (entry, sources) {
    const r = sources && sources.revenueDigest;
    const n = r && Number(r.payingCustomers);
    return Number.isFinite(n) ? n : null;
  }
};

// → { value: number|null, resolved: boolean }
function resolveNorthStarMetric(entry, sources, nowMs) {
  if (!entry || !entry.metric) return { value: null, resolved: false };
  if (entry.source === 'manual') {
    // Number(null) is 0 — guard explicitly so "no value yet" never reads as 0.
    if (entry.current === null || entry.current === undefined || entry.current === '') return { value: null, resolved: false };
    const v = Number(entry.current);
    return Number.isFinite(v) ? { value: v, resolved: true } : { value: null, resolved: false };
  }
  const resolver = METRIC_RESOLVERS[entry.metric];
  if (!resolver) return { value: null, resolved: false };
  try {
    const v = resolver(entry, sources || {}, nowMs);
    return Number.isFinite(v) ? { value: v, resolved: true } : { value: null, resolved: false };
  } catch (_e) {
    return { value: null, resolved: false };
  }
}

function _pctToTarget(current, target, baseline) {
  const t = Number(target), b = Number.isFinite(Number(baseline)) ? Number(baseline) : 0;
  if (!Number.isFinite(current) || !Number.isFinite(t)) return null;
  if (t === b) return current >= t ? 100 : 0; // div-0 guard
  return Math.max(0, Math.min(100, Math.round(((current - b) / (t - b)) * 100)));
}

// → digest | null. Null means "no strategy seeded" — callers emit nothing.
function buildStrategyDigest(companyStrategy, sources, nowMs) {
  const cs = companyStrategy;
  if (!cs || !Array.isArray(cs.northStar) || cs.northStar.length === 0) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const northStar = cs.northStar.slice(0, 5).map(function (e) {
    const r = resolveNorthStarMetric(e, sources, now);
    const byMs = Date.parse(e.by || '');
    return {
      metric: String(e.metric || ''),
      label: String(e.label || e.metric || ''),
      priority: Number(e.priority) || 99,
      target: Number(e.target),
      by: e.by || null,
      source: e.source || 'manual',
      baseline: Number.isFinite(Number(e.baseline)) ? Number(e.baseline) : null,
      current: r.value,
      resolved: r.resolved,
      pctToTarget: r.resolved ? _pctToTarget(r.value, e.target, e.baseline) : null,
      daysLeft: Number.isFinite(byMs) ? Math.ceil((byMs - now) / (24 * 60 * 60 * 1000)) : null
    };
  }).sort(function (a, b) { return a.priority - b.priority; });
  return {
    asOfUtc: new Date(now).toISOString(),
    mission: String(cs.mission || '').substring(0, 160),
    era: String(cs.era || '').substring(0, 40),
    eraGoal: String(cs.eraGoal || '').substring(0, 120),
    planningCadence: String(cs.planningCadence || 'monthly').substring(0, 20),
    riskPosture: String(cs.riskPosture || '').substring(0, 60),
    monthlyBudget: Number(cs.monthlyBudget) || null,
    northStar: northStar
  };
}

// Renders the prompt block. '' when digest null (prompts unchanged).
// Throws if over hard cap — same discipline as _buildWorldStatePromptBlock.
function _buildStrategyPromptBlock(digest) {
  if (!digest || !Array.isArray(digest.northStar) || digest.northStar.length === 0) return '';
  const lines = [];
  lines.push('═══ COMPANY STRATEGY (era: ' + digest.era + ') ═══');
  if (digest.mission) lines.push('MISSION: ' + digest.mission);
  if (digest.eraGoal) lines.push('ERA GOAL: ' + digest.eraGoal);
  lines.push('NORTH STARS (every proposal, campaign and task should serve one):');
  digest.northStar.forEach(function (ns, i) {
    const cur = ns.resolved ? String(ns.current) : '?';
    const tags = [];
    if (i === 0) tags.push('PRIMARY');
    tags.push(ns.source === 'manual' ? (ns.resolved ? 'manual' : 'manual — telemetry pending') : 'auto');
    const pct = ns.pctToTarget !== null ? ' (' + ns.pctToTarget + '% of the way)' : '';
    lines.push((i + 1) + '. ' + ns.metric + ': ' + cur + ' → ' + ns.target + ' by ' + (ns.by || 'n/a') + pct + ' [' + tags.join(' · ') + ']');
  });
  lines.push('RULE: propose-objective / propose-campaign MUST include "northStarMetric" naming which north star it serves. Proposals serving none get flagged for CEO scrutiny.');
  const meta = [];
  if (digest.monthlyBudget) meta.push('BUDGET: $' + digest.monthlyBudget + '/mo');
  if (digest.riskPosture) meta.push('POSTURE: ' + digest.riskPosture);
  if (digest.planningCadence) meta.push('CADENCE: ' + digest.planningCadence);
  if (meta.length) lines.push(meta.join(' · '));
  lines.push('═══ END COMPANY STRATEGY ═══');
  const block = '\n' + lines.join('\n') + '\n';
  if (block.length > MAX_STRATEGY_BLOCK_CHARS) {
    throw new Error('[strategy] prompt block exceeds ' + MAX_STRATEGY_BLOCK_CHARS + ' char hard cap: ' + block.length + '. Trim fields before shipping.');
  }
  return block;
}

// SE-2. Mutates objectives in place; returns { changed, govEvents }.
// Only touches objectives with a valid criteria object and non-terminal status.
function evaluateObjectives(objectives, sources, nowMs) {
  const out = { changed: false, govEvents: [] };
  if (!Array.isArray(objectives)) return out;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  for (const obj of objectives) {
    if (!obj || obj.deletedAt) continue;
    if (obj.status === 'complete' || obj.status === 'canceled' || obj.status === 'archived') continue;
    const c = obj.criteria;
    if (!c || typeof c !== 'object' || !c.metric || !Number.isFinite(Number(c.target))) continue;
    const r = resolveNorthStarMetric({ metric: c.metric, source: c.source || 'auto', current: c.current }, sources, now);
    if (!r.resolved) continue; // unresolvable (manual/no telemetry) → leave untouched, no fake progress
    if (c.baseline === null || c.baseline === undefined) {
      // Objectives born from approved proposals carry baseline:null — stamp it
      // with the live value on first evaluation so progress measures the work
      // done SINCE approval, not credit for pre-existing numbers.
      c.baseline = r.value;
      c.baselineStampedAt = new Date(now).toISOString();
      out.changed = true;
    }
    const pct = _pctToTarget(r.value, c.target, c.baseline);
    obj.measuredAt = new Date(now).toISOString();
    obj.measuredValue = r.value;
    if (obj.progress !== pct) { obj.progress = pct; out.changed = true; }
    if (r.value >= Number(c.target)) {
      obj.status = 'complete';
      obj.progress = 100;
      obj.completedAt = new Date(now).toISOString();
      obj.completedBy = 'system:metric';
      out.changed = true;
      out.govEvents.push({
        id: 'gov-' + now + '-' + Math.random().toString(36).substring(2, 6),
        type: 'objective_auto_complete',
        data: { objectiveId: obj.id, title: obj.title, metric: c.metric, target: Number(c.target), finalValue: r.value },
        timestamp: new Date(now).toISOString()
      });
    } else {
      const byMs = Date.parse(c.by || '');
      if (Number.isFinite(byMs) && now > byMs && !obj.deadlineMissedAt) {
        obj.deadlineMissedAt = new Date(now).toISOString();
        out.changed = true;
        out.govEvents.push({
          id: 'gov-' + now + '-' + Math.random().toString(36).substring(2, 6),
          type: 'objective_deadline_miss',
          data: { objectiveId: obj.id, title: obj.title, metric: c.metric, target: Number(c.target), current: r.value, by: c.by },
          timestamp: new Date(now).toISOString()
        });
      }
    }
  }
  return out;
}

module.exports = {
  resolveNorthStarMetric: resolveNorthStarMetric,
  buildStrategyDigest: buildStrategyDigest,
  _buildStrategyPromptBlock: _buildStrategyPromptBlock,
  evaluateObjectives: evaluateObjectives,
  METRIC_RESOLVERS: METRIC_RESOLVERS,
  MAX_STRATEGY_BLOCK_CHARS: MAX_STRATEGY_BLOCK_CHARS
};
