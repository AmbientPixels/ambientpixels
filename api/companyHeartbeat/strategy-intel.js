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
  },
  // Leading demand metric: humans who reached a free offer and used it, per week.
  // Deliberately reads publicScans7d and NOT scans7d — scans minted by our own
  // prospect lane carry tier==='agent' and are self-inflicted traffic. In the
  // week this landed, 42 of 43 scans were agent-minted; a resolver on the total
  // would have reported 43 and read as demand. Same failure class as founder
  // self-purchases scoring as revenue. If the field is absent, resolve to null
  // (unmeasured) rather than 0 — a missing pipe must never look like real zero.
  qualified_visitors_week: function (entry, sources) {
    const f = sources && sources.funnel;
    if (!f) return null;
    const n = Number(f.publicScans7d);
    return Number.isFinite(n) ? n : null;
  },
  // obj-resume-roast-demand's north star (kill gate: <15 by 2026-08-22).
  // Pre-counted by companyHeartbeat/pa-metrics.js from product-analytics
  // agent_run_completed events (product 'resumeroast') — COMPLETED roasts,
  // not started ones: 25 starts produced 5 completions in the first two days,
  // and a started-but-failed run is not a delivered roast. Discovered
  // 2026-08-08: this metric had NO resolver for its first week and the
  // objective read a phantom 0 the whole time. Null when the pipe is absent —
  // a kill gate must never fire on a zero nobody measured.
  // The company's single north star since the 2026-10-06 restart: real humans
  // who USED a free offer in the trailing 7 days — delivered Resume Roasts plus
  // successful public AmbientScore scans (see isQualifiedScan). Replaces
  // qualified_visitors_week, which read AmbientScore only and counted failed
  // scans. Null if EITHER half is unmeasured: a partial count would read as a
  // drop the moment one pipe broke.
  // CEO decision 8 (2026-10-06): widened from "AmbientScore scans + Resume Roast runs"
  // to every product's first-value event — any Pixel Agents run delivered (Resume
  // Roast is one of the 24 agents), a CardForge quick build, a StoryForge adventure
  // started, a Blindspot card created, an Agent Forge agent submitted — plus the
  // AmbientScore scans counted from cc_analytics (pa-metrics.countQualifiedUsesInEvents
  // deliberately excludes scan_completed so a scan is never counted twice).
  // Still null if EITHER half is unmeasured.
  qualified_uses_week: function (entry, sources) {
    const f = sources && sources.funnel;
    const scans = f ? Number(f.qualifiedScans7d) : NaN;
    const pa = sources ? sources.qualifiedPaUses7d : null;
    if (!Number.isFinite(scans) || pa === null || pa === undefined) return null;
    const uses = Number(typeof pa === 'object' ? pa.total : pa);
    return Number.isFinite(uses) ? scans + uses : null;
  },
  resume_roast_runs_14d: function (entry, sources) {
    if (!sources || sources.resumeRoastRuns14d === null || sources.resumeRoastRuns14d === undefined) return null;
    const n = Number(sources.resumeRoastRuns14d);
    return Number.isFinite(n) ? n : null;
  }
};

// A cc_analytics scan counts as demand only if a stranger got a result:
// not minted by our own prospect lane (tier 'agent'), not a failure (tier
// 'failed' — no result was delivered), and not a scan of our own site (the
// only internal-test signal a scan record carries; it has no device flag).
const OWN_DOMAIN_RE = /(^|\.|\/\/)ambientpixels\.ai(\/|$|:|\?)/i;
function isQualifiedScan(e) {
  if (!e || e.tier === 'agent' || e.tier === 'failed') return false;
  return !OWN_DOMAIN_RE.test(String(e.url || ''));
}

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

// Efficiency signal (2026-10-16): logged LLM spend over the last 7 days divided by
// qualified uses in the same window. llmSpendByDay = getGeminiCostSummary().byDay
// ({ 'YYYY-MM-DD': { cost } }), which covers every caller that logs to geminiUsage
// (the fleet and some product endpoints), so it slightly overstates fleet cost.
// null when either half is unmeasured — a failed read is never a zero.
function computeCostPerUse(sources, nowMs) {
  const byDay = sources && sources.llmSpendByDay;
  const uses = METRIC_RESOLVERS.qualified_uses_week(null, sources);
  if (!byDay || typeof byDay !== 'object' || uses === null) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let spend = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(now - i * 86400000).toISOString().substring(0, 10);
    const c = byDay[day] && Number(byDay[day].cost);
    if (Number.isFinite(c)) spend += c;
  }
  spend = Math.round(spend * 100) / 100;
  return { spend7d: spend, uses7d: uses, perUse: uses > 0 ? Math.round((spend / uses) * 100) / 100 : null };
}

// Per-product qualified uses (7d): the same two halves as qualified_uses_week,
// kept apart so agents can see WHICH product moves. AmbientScore scans come from
// funnel.qualifiedScans7d; every other product from qualifiedPaUses7d.byProduct
// (pa-metrics.countQualifiedUsesInEvents, which never counts scan_completed, so
// nothing is counted twice). Products at 0 are dropped. null when either half or
// the PA breakdown is unmeasured: a missing pipe must never read as zeros.
function computeByProduct(sources) {
  const f = sources && sources.funnel;
  const scans = f ? Number(f.qualifiedScans7d) : NaN;
  const pa = sources ? sources.qualifiedPaUses7d : null;
  if (!Number.isFinite(scans) || !pa || typeof pa !== 'object') return null;
  const bp = pa.byProduct;
  if (!bp || typeof bp !== 'object' || Array.isArray(bp)) return null;
  const out = {};
  if (scans > 0) out.ambientscore = scans;
  for (const k of Object.keys(bp)) {
    const n = Number(bp[k]);
    if (!Number.isFinite(n)) return null;
    if (n > 0) out[k] = (out[k] || 0) + n;
  }
  return out;
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
    northStar: northStar,
    costPerUse: computeCostPerUse(sources, now),
    byProduct: computeByProduct(sources)
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
  // Labels were shortened 2026-10-17 to fit the BY PRODUCT line under the cap
  // (the worst-case digest was already over it); meaning unchanged.
  lines.push('NORTH STARS:');
  digest.northStar.forEach(function (ns, i) {
    const cur = ns.resolved ? String(ns.current) : '?';
    const tags = [];
    if (i === 0) tags.push('PRIMARY');
    tags.push(ns.source === 'manual' ? (ns.resolved ? 'manual' : 'manual, unmeasured') : 'auto');
    const pct = ns.pctToTarget !== null ? ' (' + ns.pctToTarget + '%)' : '';
    lines.push((i + 1) + '. ' + ns.metric + ': ' + cur + ' → ' + ns.target + ' by ' + (ns.by || 'n/a') + pct + ' [' + tags.join(' · ') + ']');
  });
  lines.push('RULE: propose-objective / propose-campaign MUST name a "northStarMetric"; none = CEO scrutiny.');
  if (digest.byProduct !== undefined) {
    let bp = 'unmeasured';
    if (digest.byProduct && typeof digest.byProduct === 'object') {
      const names = Object.keys(digest.byProduct).filter(function (k) { return digest.byProduct[k] > 0; })
        .sort(function (a, b) { return (digest.byProduct[b] - digest.byProduct[a]) || (a < b ? -1 : a > b ? 1 : 0); });
      bp = names.length ? names.map(function (k) { return k + ' ' + digest.byProduct[k]; }).join(' · ') : 'none yet';
    }
    lines.push('BY PRODUCT (7d): ' + bp);
  }
  const cpu = digest.costPerUse;
  if (cpu) {
    lines.push('EFFICIENCY (7d): $' + cpu.spend7d.toFixed(2) + ' LLM spend / ' + cpu.uses7d + ' qualified uses = ' +
      (cpu.perUse !== null ? '$' + cpu.perUse.toFixed(2) + ' per use. Lower = better.'
        : 'no uses yet; this week\'s spend bought nothing. Spend only on work that can reach a real person.'));
  }
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
    // Persist when the measured VALUE moves, not only when the rounded pct does —
    // otherwise measuredValue/measuredAt only survive to storage on a pct change
    // (observed: dashboards showed "78, measured 07-17" for 4 days while the live
    // count was 76, because 76→78→76 never moved the rounded pct off 0%).
    // A frozen value still skips the write: no hourly blob churn for no news.
    if (obj.measuredValue !== r.value) { obj.measuredValue = r.value; out.changed = true; }
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
  computeCostPerUse: computeCostPerUse,
  computeByProduct: computeByProduct,
  _buildStrategyPromptBlock: _buildStrategyPromptBlock,
  evaluateObjectives: evaluateObjectives,
  isQualifiedScan: isQualifiedScan,
  METRIC_RESOLVERS: METRIC_RESOLVERS,
  MAX_STRATEGY_BLOCK_CHARS: MAX_STRATEGY_BLOCK_CHARS
};
