// Agent XP / Reward Engine — Stage 1 (headless).
//
// Deterministic, outcome-based reward economy for the 8 agents. Reads events that
// are ALREADY logged (approvals, ships, engagement, completed tasks, followers,
// revenue) and writes ONE state key: `agentRewards`. Agents never self-report, so
// there is nothing to game. Purely additive; never auto-executes; no-op on error.
//
// See docs/superpowers/specs/2026-06-20-agent-xp-reward-system-design.md
//
// Pure cores (unit-tested):
//   extractEvents(state, prevRewards) -> normalized event list (stable ids)
//   applyEvents(events, prevRewards, nowMs) -> { rewards, newAwards }
//   applyCompany(rewards, stats, nowMs) -> rewards   (followers/revenue track)
//   levelFromXp / rankFromLevel / classFor  (helpers)
// IO:
//   runRewardsEngine({ storage, nowMs, log })

'use strict';

// ── Economy constants (all tunable here) ──────────────────────────────────────
const XP = {
  proposal_approved: 8,
  action_approved: 4,
  blog_ship: 6,
  social_ship: 2,
  doc_ship: 3,
  task_done: 1,
  review_done: 1   // reviewer credit, only when the reviewed task lands (CEO-approved 2026-07-17)
};
const ENGAGEMENT_PER = 25;        // +1 XP per 25 engagements
const ENGAGEMENT_XP_CAP = 8;      // cap engagement XP per post
const ASSIST_BASE = 5;
const ASSIST_RATIO = 0.4;         // assist XP = round(ASSIST_BASE * ASSIST_RATIO) = 2
const ASSIST_CAP_PER_PAIR = 2;    // per (from->to) pair
const ASSIST_WINDOW_MS = 7 * 86400000;
const DAILY_XP_CAP = 12;          // per-agent per-day soft cap; overflow -> Renown
const OVERFLOW_RENOWN_DIVISOR = 2;
const FOLLOWER_DRIP_SPLIT = 0.5;  // renown per new follower, per content agent
const RECENT_CAP = 25;
const PROCESSED_CAP = 3000;

// ── Revenue Seasons constants (2026-07-30 spec) ─────────────────────────────
const FLEET_AGENTS = ['nova', 'cipher', 'pixel', 'forge', 'echo', 'scout', 'scribe', 'quill', 'vale'];
const _FLEET_SET = {}; FLEET_AGENTS.forEach(function (id) { _FLEET_SET[id] = true; });
const CONVERSION_METRIC_RX = /revenue|customer|sale|checkout|conversion|lead/i;
const FALLBACK_WINDOW_MS = 30 * 86400000;
const REVENUE_XP = { saleBase: 100, perDollar: 1, lead: 15, scan: 3 };
const UNATTRIBUTED_SHARE = 0.5;   // organic conversions: half pays the fallback set
const POSITIVE_SALE_TYPES = { one_time: true, subscription_initial: true, subscription_renewal: true };
const CAP_EXEMPT_TYPES = { revenue_sale: true, funnel_lead: true };
const TASK_DONE_DAILY_XP_CAP = 3;
const REVENUE_LANE_TYPES = { revenue_sale: true, funnel_lead: true, funnel_scan: true };
const REVENUE_RECENT_CAP = 300;

const SEASON_PAR_FLOOR = 40;
const SEASON_PAR_GROWTH = 1.10;
// Par rises with the fleet but is CAPPED. Pure 110%-of-median sits above the median by
// construction, so more than half the fleet would miss par every season forever no matter
// how much they produced — the ladder would measure rank, not performance. The ceiling
// makes par an absolute bar a competent agent can actually clear and stay clear of.
const SEASON_PAR_CEILING = 120;
const SEASON_HISTORY_CAP = 12;
const LADDER_BY_MISSES = ['safe', 'watch', 'squeezed', 'retirement_pending'];
const VANGUARD_RANKS = 2;      // top-2 = vanguard
const PROBATION_RANKS = 2;     // bottom-2 = probation (only when fleet >= 6)

// Minimum trailing revenue XP across the fleet before merit reallocation engages.
// Below it, one stray point of signal — a single anonymous scan credited by fallback —
// would hand one agent the entire merit pool and flip everyone else over cap mid-month.
const MERIT_MIN_SIGNAL = 30;
const MERIT_FLOOR_PCT = 0.4;
const MERIT_PCT = 0.6;
const SQUEEZE_CAP_MULT = 0.7;
const TRAILING_REVENUE_WINDOW_MS = 14 * 86400000;

const PROTECTED_AGENTS = { nova: true, cipher: true };   // mirror constants.js PROTECTED_AGENTS — never auto-draft retirement
const FLEET_MIN = 5;                                     // mirror constants.js FLEET_MIN_SIZE
// Capability floor: protected agents can miss par and feel budget pressure like anyone,
// but must never lose the tools the fleet depends on. Nova is the orchestrator and the
// only product proposer; Cipher owns finance. Crippling either to punish a bad season
// costs the company more than the lesson is worth.
const TIER_FLOOR_AGENTS = PROTECTED_AGENTS;
// Ladder-exempt: structurally low-volume support roles. Their value is availability and
// judgement, not output volume, so a volume-ranked ladder would retire them on a cycle
// no matter how well they did the job. They still earn, rank, and show a ladder status —
// it just never drafts their retirement.
const RETIREMENT_EXEMPT_AGENTS = { vale: true, quill: true };

const RANKS = [
  { min: 50, name: 'Legend' },
  { min: 40, name: 'Elite' },
  { min: 25, name: 'Veteran' },
  { min: 10, name: 'Operator' },
  { min: 1, name: 'Rookie' }
];

const BASE_CLASS = {
  nova: 'Orchestrator', cipher: 'Strategist', pixel: 'Artisan', forge: 'Engineer',
  echo: 'Herald', scout: 'Pathfinder', scribe: 'Scribe', quill: 'Editor', vale: 'Steward'
};
const SPEC_SUFFIX = {
  assist: 'the Connector', engagement: 'the Amplifier', blog_ship: 'the Author',
  proposal_approved: 'the Strategist', task_done: 'the Workhorse', social_ship: 'the Voice',
  review_done: 'the Gatekeeper', revenue_sale: 'the Closer', funnel_lead: 'the Hunter'
};

const ACH_RENOWN = { bronze: 10, silver: 25, gold: 50, platinum: 100 };

const ACHIEVEMENTS = [
  { id: 'first_approval', label: 'First CEO Yes', tier: 'bronze', test: a => a.counters.approvals >= 1 },
  { id: 'approvals_10', label: '10 Approvals', tier: 'silver', test: a => a.counters.approvals >= 10 },
  { id: 'approvals_50', label: '50 Approvals', tier: 'gold', test: a => a.counters.approvals >= 50 },
  { id: 'first_blog', label: 'First Blog Shipped', tier: 'bronze', test: a => a.counters.blogs >= 1 },
  { id: 'blogs_10', label: '10 Blogs Shipped', tier: 'silver', test: a => a.counters.blogs >= 10 },
  { id: 'first_assist', label: 'First Assist', tier: 'bronze', test: a => a.counters.assists >= 1 },
  { id: 'assists_25', label: '25 Assists', tier: 'silver', test: a => a.counters.assists >= 25 },
  { id: 'assists_100', label: '100 Assists', tier: 'gold', test: a => a.counters.assists >= 100 },
  { id: 'engagement_500', label: '500 Engagements', tier: 'silver', test: a => a.counters.engagementTotal >= 500 },
  { id: 'streak_7', label: '7-Day Streak', tier: 'silver', test: a => a.streakDays >= 7 },
  { id: 'streak_30', label: '30-Day Streak', tier: 'gold', test: a => a.streakDays >= 30 },
  { id: 'streak_90', label: '90-Day Streak', tier: 'platinum', test: a => a.streakDays >= 90 },
  { id: 'level_10', label: 'Reached Level 10', tier: 'silver', test: a => a.level >= 10 },
  { id: 'level_25', label: 'Reached Level 25', tier: 'gold', test: a => a.level >= 25 },
  { id: 'level_50', label: 'Reached Level 50', tier: 'platinum', test: a => a.level >= 50 },
  { id: 'first_lead', label: 'First Lead Captured', tier: 'bronze', test: a => (a.counters.leads || 0) >= 1 },
  { id: 'first_sale', label: 'First Blood — Attributed Sale', tier: 'platinum', test: a => (a.counters.sales || 0) >= 1 },
  { id: 'sales_10', label: '10 Attributed Sales', tier: 'platinum', test: a => (a.counters.sales || 0) >= 10 }
];

const COMPANY_ACH = [
  { id: 'followers_100', label: 'Fleet: 100 Followers', test: c => (c.lastFollowerTotal || 0) >= 100 },
  { id: 'followers_500', label: 'Fleet: 500 Followers', test: c => (c.lastFollowerTotal || 0) >= 500 },
  { id: 'followers_1k', label: 'Fleet: 1,000 Followers', test: c => (c.lastFollowerTotal || 0) >= 1000 },
  { id: 'followers_5k', label: 'Fleet: 5,000 Followers', test: c => (c.lastFollowerTotal || 0) >= 5000 },
  { id: 'revenue_first', label: 'First Dollar', test: c => (c.lastRevenueCents || 0) > 0 },
  { id: 'revenue_100', label: '$100 Earned', test: c => (c.lastRevenueCents || 0) >= 10000 },
  { id: 'revenue_1k', label: '$1,000 Earned', test: c => (c.lastRevenueCents || 0) >= 100000 },
  { id: 'blogviews_1k', label: '1,000 Blog Views', test: c => (c.counters.blogViews || 0) >= 1000 }
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function _arr(v) { return Array.isArray(v) ? v : []; }
function _hash(s) { s = String(s || ''); var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
function _iso(ms) { return new Date(ms).toISOString(); }
function _day(iso) { return String(iso || '').substring(0, 10); }
function _dayDiff(d1, d2) { return Math.round((Date.parse(d2) - Date.parse(d1)) / 86400000); }

function normalizeRewardsConfig(sysCfg) {
  var c = (sysCfg && sysCfg.rewards) || {};
  var mb = c.meritBudget || {};
  return {
    enabled: c.enabled !== false,
    meritBudget: { enabled: mb.enabled !== false, floorPct: Number.isFinite(mb.floorPct) ? mb.floorPct : MERIT_FLOOR_PCT, meritPct: Number.isFinite(mb.meritPct) ? mb.meritPct : MERIT_PCT },
    privileges: { enabled: !c.privileges || c.privileges.enabled !== false },
    parFloor: Number.isFinite(c.parFloor) ? c.parFloor : SEASON_PAR_FLOOR,
    squeezeMult: Number.isFinite(c.squeezeMult) ? c.squeezeMult : SQUEEZE_CAP_MULT,
    budgetMonthly: Number.isFinite(c.budgetMonthly) ? c.budgetMonthly : null
  };
}

// cumulative XP required to BE at level n. cost(k->k+1) = 50 + 25k.
function _cumulativeForLevel(n) { return 50 * (n - 1) + 25 * (n - 1) * n / 2; }
function levelFromXp(xp) {
  var lvl = 1;
  while (lvl < 99 && _cumulativeForLevel(lvl + 1) <= (xp || 0)) lvl++;
  return lvl;
}
function rankFromLevel(level) {
  for (var i = 0; i < RANKS.length; i++) if (level >= RANKS[i].min) return RANKS[i].name;
  return 'Rookie';
}
function classFor(agentId, entry) {
  var base = BASE_CLASS[agentId] || 'Operative';
  var rec = (entry && entry.recent) || [];
  if (!rec.length) return base;
  var tally = {};
  rec.forEach(function (r) { if (r && r.type) tally[r.type] = (tally[r.type] || 0) + 1; });
  var top = null, topN = 0;
  Object.keys(tally).forEach(function (t) { if (tally[t] > topN) { topN = tally[t]; top = t; } });
  var spec = SPEC_SUFFIX[top];
  return spec ? (base + ' ' + spec) : base;
}

function _newAgent(id) {
  return {
    xp: 0, level: 1, rank: 'Rookie', class: classFor(id, { recent: [] }), renown: 0,
    streakDays: 0, lastActiveDay: null, dailyXp: 0, dailyXpDay: null, dailyTaskXp: 0,
    seasonXp: 0, seasonRevenueXp: 0, revenueRecent: [],
    counters: { approvals: 0, blogs: 0, socialPosts: 0, docs: 0, tasksDone: 0, assists: 0, engagementTotal: 0, reviews: 0, sales: 0, leads: 0, scansAttributed: 0 },
    achievements: [], recent: []
  };
}
function _ensureAgent(rewards, id) {
  if (!rewards.perAgent[id]) rewards.perAgent[id] = _newAgent(id);
  return rewards.perAgent[id];
}
function _initRewards(prev, nowMs) {
  var r = (prev && prev.perAgent) ? JSON.parse(JSON.stringify(prev)) : { perAgent: {} };
  if (!r.perAgent || typeof r.perAgent !== 'object') r.perAgent = {};
  if (!r.company) r.company = {};
  if (!r.company.counters) r.company.counters = { followers: 0, revenueCents: 0, blogViews: 0 };
  if (r.company.lastFollowerTotal === undefined) r.company.lastFollowerTotal = null;
  if (r.company.lastRevenueCents === undefined) r.company.lastRevenueCents = null;
  if (!Array.isArray(r.company.achievements)) r.company.achievements = [];
  if (!Array.isArray(r.processedEventIds)) r.processedEventIds = [];
  if (!r.assistPairs || typeof r.assistPairs !== 'object') r.assistPairs = {};
  Object.keys(r.perAgent).forEach(function (id) {
    var A = r.perAgent[id];
    if (typeof A.seasonXp !== 'number') A.seasonXp = 0;
    if (typeof A.seasonRevenueXp !== 'number') A.seasonRevenueXp = 0;
    if (!Array.isArray(A.revenueRecent)) A.revenueRecent = [];
    if (typeof A.dailyTaskXp !== 'number') A.dailyTaskXp = 0;
  });
  // par starts NULL, not at the floor. The season in progress when this ledger is first
  // created is a partial one (deploy → month end); scoring it against a full-month par
  // would put the whole fleet on relegation watch for a season that never happened.
  // rolloverSeason's `par == null` branch takes no misses and sets the first real par.
  if (!r.seasonMeta) r.seasonMeta = { par: null, startedAt: _iso(nowMs), previousChampion: null };
  r.updatedAt = _iso(nowMs);
  r.season = _iso(nowMs).substring(0, 7);
  return r;
}

function _streakMult(streakDays) { return 1 + Math.min(0.25, 0.02 * (streakDays || 0)); }
function _overflowRenown(lost) { return lost > 0 ? Math.ceil(lost / OVERFLOW_RENOWN_DIVISOR) : 0; }

function _baseXpFor(e) {
  if (e.type === 'engagement') return Math.min(ENGAGEMENT_XP_CAP, Math.floor((e.amount || 0) / ENGAGEMENT_PER));
  if (e.type === 'assist') return Math.round(ASSIST_BASE * ASSIST_RATIO);
  return XP[e.type] || 0;
}
function _bumpCounters(A, e) {
  switch (e.type) {
    case 'proposal_approved': case 'action_approved': A.counters.approvals++; break;
    case 'blog_ship': A.counters.blogs++; break;
    case 'social_ship': A.counters.socialPosts++; break;
    case 'doc_ship': A.counters.docs++; break;
    case 'task_done': A.counters.tasksDone++; break;
    case 'review_done': A.counters.reviews = (A.counters.reviews || 0) + 1; break;
    case 'engagement': A.counters.engagementTotal += (e.amount || 0); break;
    case 'assist': A.counters.assists++; break;
    case 'revenue_sale': A.counters.sales = (A.counters.sales || 0) + 1; break;
    case 'funnel_lead': A.counters.leads = (A.counters.leads || 0) + 1; break;
    case 'funnel_scan': A.counters.scansAttributed = (A.counters.scansAttributed || 0) + 1; break;
  }
}
function _assistAllowed(rewards, from, to, atIso) {
  var key = from + '->' + to;
  var list = (rewards.assistPairs[key] || []).filter(function (ts) {
    return (Date.parse(atIso) - Date.parse(ts)) < ASSIST_WINDOW_MS;
  });
  rewards.assistPairs[key] = list;
  return list.length < ASSIST_CAP_PER_PAIR;
}
function _recordAssist(rewards, from, to, atIso) {
  var key = from + '->' + to;
  if (!rewards.assistPairs[key]) rewards.assistPairs[key] = [];
  rewards.assistPairs[key].push(atIso);
}
function _updateStreak(A, day) {
  if (!A.lastActiveDay) { A.streakDays = 1; A.lastActiveDay = day; return; }
  if (day === A.lastActiveDay) return;
  var diff = _dayDiff(A.lastActiveDay, day);
  if (diff === 1) A.streakDays = (A.streakDays || 0) + 1;
  else if (diff > 1) A.streakDays = 1;
  if (diff > 0) A.lastActiveDay = day;
}

// ── applyEvents: the economy core ─────────────────────────────────────────────
function applyEvents(events, prevRewards, nowMs) {
  var rewards = _initRewards(prevRewards, nowMs);
  var newAwards = [];
  var processed = {};
  rewards.processedEventIds.forEach(function (id) { processed[id] = true; });

  var queue = _arr(events).filter(function (e) { return e && e.id && !processed[e.id]; })
    .slice().sort(function (a, b) { return (Date.parse(a.at || 0) || 0) - (Date.parse(b.at || 0) || 0); });

  queue.forEach(function (e) {
    processed[e.id] = true;
    rewards.processedEventIds.push(e.id);
    var aid = e.agentId;
    if (!aid) return;
    var A = _ensureAgent(rewards, aid);
    var day = _day(e.at) || _day(_iso(nowMs));

    if (e.type === 'assist') {
      var ben = (e.meta && e.meta.beneficiary) || '?';
      if (!_assistAllowed(rewards, aid, ben, e.at || _iso(nowMs))) return; // pair cap — skip silently
      _recordAssist(rewards, aid, ben, e.at || _iso(nowMs));
    }

    _updateStreak(A, day);
    if (A.dailyXpDay !== day) { A.dailyXp = 0; A.dailyTaskXp = 0; A.dailyXpDay = day; }

    var hasOverride = e.xpOverride != null && Number.isFinite(Number(e.xpOverride));
    var computed = hasOverride ? Number(e.xpOverride) : Math.round(_baseXpFor(e) * _streakMult(A.streakDays));
    var granted, lost = 0;
    if (e.type === 'task_done') {
      // Churn nerf: task lane pays at most 3 XP/day, AND still sits inside the global 12/day cap.
      granted = Math.max(0, Math.min(computed, TASK_DONE_DAILY_XP_CAP - A.dailyTaskXp, DAILY_XP_CAP - A.dailyXp));
      A.dailyTaskXp += granted;
      A.dailyXp += granted;
    } else if (CAP_EXEMPT_TYPES[e.type]) {
      granted = computed;                     // sales/leads are never haircut
    } else {
      var allowed = Math.max(0, DAILY_XP_CAP - A.dailyXp);
      granted = Math.min(computed, allowed);
      lost = computed - granted;
      A.dailyXp += granted;
    }
    A.xp += granted;
    A.seasonXp += granted;
    if (REVENUE_LANE_TYPES[e.type] && granted > 0) {
      A.seasonRevenueXp += granted;
      A.revenueRecent.unshift({ at: e.at || _iso(nowMs), xp: granted });
      if (A.revenueRecent.length > REVENUE_RECENT_CAP) A.revenueRecent = A.revenueRecent.slice(0, REVENUE_RECENT_CAP);
    }
    var renownGain = _overflowRenown(lost);
    A.renown += renownGain;

    _bumpCounters(A, e);
    if (!(granted === 0 && renownGain === 0 && e.type === 'task_done')) {
      A.recent.unshift({ at: e.at, type: e.type, xp: granted, renown: renownGain, reason: e.type, sourceId: e.id });
      if (A.recent.length > RECENT_CAP) A.recent = A.recent.slice(0, RECENT_CAP);
      newAwards.push({ agentId: aid, type: e.type, xp: granted, renown: renownGain, sourceId: e.id });
    }
  });

  // recompute level/rank/class + unlock achievements (renown only, dedup by id)
  Object.keys(rewards.perAgent).forEach(function (id) {
    var A = rewards.perAgent[id];
    A.level = levelFromXp(A.xp);
    A.rank = rankFromLevel(A.level);
    A.class = classFor(id, A);
    ACHIEVEMENTS.forEach(function (ach) {
      if (A.achievements.some(function (x) { return x.id === ach.id; })) return;
      if (ach.test(A)) {
        A.achievements.push({ id: ach.id, label: ach.label, tier: ach.tier, at: _iso(nowMs) });
        A.renown += (ACH_RENOWN[ach.tier] || 0);
        newAwards.push({ agentId: id, type: 'achievement', achievement: ach.id, renown: ACH_RENOWN[ach.tier] || 0 });
      }
    });
  });

  if (rewards.processedEventIds.length > PROCESSED_CAP) {
    rewards.processedEventIds = rewards.processedEventIds.slice(-PROCESSED_CAP);
  }
  rewards.updatedAt = _iso(nowMs);
  return { rewards: rewards, newAwards: newAwards };
}

// ── applyCompany: followers / revenue / company achievements ──────────────────
function applyCompany(rewards, stats, nowMs) {
  var r = _initRewards(rewards, nowMs);
  var c = r.company;
  stats = stats || {};

  if (typeof stats.followerTotal === 'number') {
    if (c.lastFollowerTotal != null && stats.followerTotal > c.lastFollowerTotal) {
      var delta = stats.followerTotal - c.lastFollowerTotal;
      c.counters.followers += delta;
      ['echo', 'scribe'].forEach(function (id) {
        var A = _ensureAgent(r, id);
        A.renown += Math.round(delta * FOLLOWER_DRIP_SPLIT);
      });
    }
    c.lastFollowerTotal = stats.followerTotal;
  }
  if (typeof stats.revenueCents === 'number') {
    if (c.lastRevenueCents != null && stats.revenueCents > c.lastRevenueCents) {
      c.counters.revenueCents += (stats.revenueCents - c.lastRevenueCents);
    }
    c.lastRevenueCents = stats.revenueCents;
  }
  if (typeof stats.blogViews === 'number') c.counters.blogViews = stats.blogViews;

  COMPANY_ACH.forEach(function (ach) {
    if (c.achievements.some(function (x) { return x.id === ach.id; })) return;
    if (ach.test(c)) c.achievements.push({ id: ach.id, label: ach.label, at: _iso(nowMs) });
  });

  r.updatedAt = _iso(nowMs);
  return r;
}

// ── Attribution: utm_content (= action id) -> causal chain of fleet agents ───
// ctx: { actionsById, attributionIndex, tasksById } — all plain maps, all optional.
function resolveContributors(utmContent, ctx) {
  ctx = ctx || {};
  var out = [];
  if (!utmContent) return out;
  var a = (ctx.actionsById || {})[utmContent];
  if (a) {
    if (a.created_by) out.push(a.created_by);
    var t = a._parentTaskId && (ctx.tasksById || {})[a._parentTaskId];
    if (t) {
      if (t.assignee) out.push(t.assignee);
      if (t.reviewer) out.push(t.reviewer);
    }
  } else {
    // action trimmed by actionsArchiver — attribution survives in the index
    var ix = ((ctx.attributionIndex || {})[utmContent]) || null;
    if (ix && ix.agent) out.push(ix.agent);
  }
  var seen = {};
  return out.filter(function (id) {
    if (!_FLEET_SET[id] || seen[id]) return false;
    seen[id] = true; return true;
  });
}

// Fallback for unattributed conversions: distinct assignees of tasks touched in the
// last 30d that belong to ACTIVE campaigns whose northStarMetric reads as conversion.
function conversionFallbackAgents(state, nowMs) {
  state = state || {};
  var conv = {};
  _arr(state.campaigns).forEach(function (c) {
    if (c && c.id && c.status === 'active' && CONVERSION_METRIC_RX.test(c.northStarMetric || '')) conv[c.id] = true;
  });
  var cutoff = nowMs - FALLBACK_WINDOW_MS;
  var agents = {};
  _arr(state.tasks).concat(_arr(state.tasksArchive)).forEach(function (t) {
    if (!t || !conv[t.campaign_id] || !_FLEET_SET[t.assignee]) return;
    var ts = Date.parse(t.updatedAt || t.completedAt || t.createdAt || 0) || 0;
    if (ts >= cutoff) agents[t.assignee] = true;
  });
  return Object.keys(agents).sort();
}

// Split totalXp across the chain (or the 50% fallback set) as per-recipient events.
// idBase must be stable; per-recipient ids get '__<agent>' so dedup is per share.
function _emitSplit(ev, idBase, type, totalXp, at, utmContent, ctx, state, nowMs) {
  // Pay each source event EXACTLY once, ever. Per-recipient dedup alone is not enough:
  // both the recipient set and each share are recomputed from mutable state every run
  // (the conversion-campaign fallback set changes as the fleet works, and `reviewer` is
  // stamped on a task after the fact), so a changed chain would mint brand-new ids for
  // an event that was already paid. Freezing on the source id makes the first payout final.
  if (ctx && ctx.paidBases && ctx.paidBases[idBase]) return;
  var who = resolveContributors(utmContent, ctx);
  var xp = totalXp;
  if (!who.length) {
    who = conversionFallbackAgents(state, nowMs);
    xp = Math.floor(totalXp * UNATTRIBUTED_SHARE);
  }
  if (!who.length || xp <= 0) return;
  var share = Math.floor(xp / who.length);
  if (share < 1) {
    who = who.slice(0, Math.max(1, Math.floor(xp)));  // deterministic: chain order / sorted fallback
    share = 1;
  }
  who.forEach(function (id) {
    ev.push({ id: idBase + '__' + id, type: type, agentId: id, xpOverride: share, at: at || '' });
  });
}

// ── extractEvents: durable state -> normalized events with stable ids ─────────
function extractEvents(state, prevRewards) {
  state = state || {};
  var ev = [];

  _arr(state.approvalQueue).forEach(function (q) {
    if (q && q.status === 'approved' && /proposal/.test(q.type || '')) {
      ev.push({ id: 'appr_' + q.id, type: 'proposal_approved', agentId: q.proposedBy || 'nova', at: q.resolvedAt || q.createdAt || '' });
    }
  });

  _arr(state.blogPosts).forEach(function (b) {
    if (b && b.id) ev.push({ id: 'blog_' + b.id, type: 'blog_ship', agentId: b.author || b.createdBy || 'scribe', at: b.publishedAt || b.createdAt || '' });
  });

  var snaps = (state.outcomeSnapshots && typeof state.outcomeSnapshots === 'object') ? state.outcomeSnapshots : {};
  Object.keys(snaps).forEach(function (actionId) {
    var s = snaps[actionId];
    if (!s) return;
    var author = s.createdBy || 'echo';
    ev.push({ id: 'ship_' + actionId, type: 'social_ship', agentId: author, at: s.publishedAt || '' });
    if (s.complete) {
      var last = _arr(s.samples).slice(-1)[0];
      if (last) {
        var eng = (last.likes || 0) + (last.comments || 0) + (last.reposts || 0);
        ev.push({ id: 'eng_' + actionId, type: 'engagement', agentId: author, amount: eng, at: last.capturedAt || s.publishedAt || '' });
      }
    }
  });

  var tasks = _arr(state.tasks).concat(_arr(state.tasksArchive));
  var byId = {};
  tasks.forEach(function (t) { if (t && t.id) byId[t.id] = t; });
  tasks.forEach(function (t) {
    if (!t || t.status !== 'done') return;
    ev.push({ id: 'task_' + t.id, type: 'task_done', agentId: t.assignee || 'nova', at: t.completedAt || t.updatedAt || '' });
    // Reviewer credit: review work lives in reviewer/reviewedAt (never assignee), and
    // counts only when the reviewed task landed. Self-reviews earn nothing.
    if (t.reviewer && t.reviewedAt && t.reviewer !== t.assignee) {
      ev.push({ id: 'rev_' + t.id, type: 'review_done', agentId: t.reviewer, at: t.reviewedAt || t.completedAt || t.updatedAt || '' });
    }
    var pid = t.parent_task_id || t.parentTaskId;
    if (pid && byId[pid] && byId[pid].assignee && t.assignee && byId[pid].assignee !== t.assignee) {
      ev.push({ id: 'assist_' + t.id, type: 'assist', agentId: t.assignee, at: t.completedAt || t.updatedAt || '', meta: { beneficiary: byId[pid].assignee } });
    }
  });

  // ── Revenue lane (2026-07-30): sales, leads, public scans ──────────────────
  var nowMs = state._nowMs || Date.now();
  // Source ids already paid to ANY recipient (ledger ids are '<idBase>__<agent>').
  var paidBases = {};
  _arr(prevRewards && prevRewards.processedEventIds).forEach(function (pid) {
    var s = String(pid);
    var i = s.lastIndexOf('__');
    if (i > 0) paidBases[s.slice(0, i)] = true;
  });
  var ctx = {
    actionsById: (state.actionsById && typeof state.actionsById === 'object') ? state.actionsById : {},
    attributionIndex: (state.attributionIndex && typeof state.attributionIndex === 'object') ? state.attributionIndex : {},
    tasksById: byId,
    paidBases: paidBases
  };
  _arr(state.revenueLedgerEntries).forEach(function (r) {
    if (!r || !r.id || !POSITIVE_SALE_TYPES[r.type] || !(r.amountCents > 0)) return;
    var total = REVENUE_XP.saleBase + Math.floor(r.amountCents / 100) * REVENUE_XP.perDollar;
    _emitSplit(ev, 'sale_' + r.id, 'revenue_sale', total, r.occurredAt || r.recordedAt, r.utmContent, ctx, state, nowMs);
  });
  _arr(state.asLeads).forEach(function (l) {
    if (!l || !l.ts) return;
    _emitSplit(ev, 'lead_' + _day(l.ts).replace(/-/g, '') + '_' + _hash(l.ts + '|' + (l.email || '')),
      'funnel_lead', REVENUE_XP.lead, l.ts, l.utmContent, ctx, state, nowMs);
  });
  _arr(state.scans).forEach(function (s) {
    if (!s || s.tier === 'agent' || s.tier === 'failed' || !s.reportId) return;
    _emitSplit(ev, 'scan_' + s.reportId, 'funnel_scan', REVENUE_XP.scan, s.timestamp, null, ctx, state, nowMs);
  });

  return ev;
}

function _median(nums) {
  var s = nums.slice().sort(function (a, b) { return a - b; });
  if (!s.length) return 0;
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Season rollover. Call FIRST each run, on the raw previous ledger (before
// _initRewards stamps the current month over prev.season). Returns
// { rewards, rolled, transitions: [{agentId, from, to}] }.
function rolloverSeason(prev, nowMs, opts) {
  opts = opts || {};
  var nowMonth = _iso(nowMs).substring(0, 7);
  if (!prev || !prev.perAgent || !prev.season || prev.season === nowMonth) {
    return { rewards: prev, rolled: false, transitions: [] };
  }
  var r = JSON.parse(JSON.stringify(prev));
  var activeIds = (opts.activeIds && opts.activeIds.length) ? opts.activeIds : FLEET_AGENTS;
  var parFloor = Number.isFinite(opts.parFloor) ? opts.parFloor : SEASON_PAR_FLOOR;
  var par = (r.seasonMeta && Number.isFinite(r.seasonMeta.par)) ? r.seasonMeta.par : null;
  var fleet = activeIds.filter(function (id) { return r.perAgent[id]; });
  // Rank by season XP, then LIFETIME xp, then id. The lifetime tie-break matters:
  // without it an all-tied season (e.g. the first season after seasonXp is introduced)
  // ranks purely alphabetically, which would hand the fleet's top producer a probation
  // penalty for its name. See also the zero-spread guard on tiers below.
  var ranked = fleet.map(function (id) {
    return { id: id, sx: r.perAgent[id].seasonXp || 0, lx: r.perAgent[id].xp || 0 };
  }).sort(function (a, b) { return (b.sx - a.sx) || (b.lx - a.lx) || (a.id < b.id ? -1 : 1); });
  var transitions = [];

  var prevParts = String(prev.season).split('-');
  var monthsSkipped = Math.max(0,
    (Number(nowMonth.slice(0, 4)) - Number(prevParts[0])) * 12 +
    (Number(nowMonth.slice(5, 7)) - Number(prevParts[1])) - 1);

  ranked.forEach(function (row, i) {
    var A = r.perAgent[row.id];
    var belowPar = par != null && row.sx < par;
    // Deliberate: a multi-month engine outage = ONE rollover, ONE miss — misses measure agent performance, not cron uptime.
    if (par != null) A.parMisses = belowPar ? (A.parMisses || 0) + 1 : 0;
    else A.parMisses = A.parMisses || 0;
    var from = A.ladderStatus || 'safe';
    A.ladderStatus = LADDER_BY_MISSES[Math.min(A.parMisses, 3)];
    if (A.ladderStatus !== from) transitions.push({ agentId: row.id, from: from, to: A.ladderStatus });
    if (!Array.isArray(A.seasonHistory)) A.seasonHistory = [];
    A.seasonHistory.unshift({ season: r.season, seasonXp: row.sx, seasonRevenueXp: A.seasonRevenueXp || 0, rank: i + 1, par: par, belowPar: belowPar });
    if (A.seasonHistory.length > SEASON_HISTORY_CAP) A.seasonHistory = A.seasonHistory.slice(0, SEASON_HISTORY_CAP);
    A.seasonXp = 0;
    A.seasonRevenueXp = 0;
  });

  var inFleet = {};
  fleet.forEach(function (id) { inFleet[id] = true; });
  Object.keys(r.perAgent).forEach(function (id) {
    if (inFleet[id]) return;
    r.perAgent[id].seasonXp = 0;
    r.perAgent[id].seasonRevenueXp = 0;
  });

  // Privilege tiers need a REAL season signal. An unscored season (no par existed, so
  // nobody could pass or fail it) confers no privileges and imposes no penalties — the
  // same rationale that keeps it from counting par misses. Likewise a season where every
  // agent finished level: rank order carries no information. Without the `par == null`
  // half, a single point of XP — one anonymous visitor's scan credited by fallback —
  // would demote real agents to the economy model for a month.
  var spread = ranked.length ? (ranked[0].sx - ranked[ranked.length - 1].sx) : 0;
  var tiers = {};
  ranked.forEach(function (row, i) {
    if (par == null || spread <= 0) { tiers[row.id] = 'line'; return; }
    var probation = fleet.length >= 6 && i >= ranked.length - PROBATION_RANKS;
    if (probation && TIER_FLOOR_AGENTS[row.id]) probation = false;   // floored, never crippled
    tiers[row.id] = i < VANGUARD_RANKS ? 'vanguard' : (probation ? 'probation' : 'line');
  });

  var nextPar = Math.min(SEASON_PAR_CEILING,
    Math.max(parFloor, Math.round(SEASON_PAR_GROWTH * _median(ranked.map(function (x) { return x.sx; })))));
  r.seasonMeta = { par: nextPar, startedAt: _iso(nowMs), previousChampion: ranked.length ? ranked[0].id : null, monthsSkipped: monthsSkipped };
  r.privileges = { enabled: true, season: nowMonth, tiers: tiers };
  r.season = nowMonth;
  return { rewards: r, rolled: true, transitions: transitions };
}

function _round2(n) { return Math.round(n * 100) / 100; }

function computeTrailingRevenueXp(A, nowMs) {
  var cutoff = nowMs - TRAILING_REVENUE_WINDOW_MS;
  return _arr(A && A.revenueRecent).reduce(function (s, r) {
    var t = Date.parse(r && r.at || 0) || 0;
    return t >= cutoff ? s + (Number(r.xp) || 0) : s;
  }, 0);
}

// The continuous meritocracy: floor + performance share, squeeze redistribution.
// Pre-revenue (all trailing 0) this reduces to an even split == current behavior.
function computeBudgetPlan(rewards, opts) {
  opts = opts || {};
  var nowMs = opts.nowMs || Date.now();
  var pool = Number(opts.poolDollars) || 0;
  var floorPct = Number.isFinite(opts.floorPct) ? opts.floorPct : MERIT_FLOOR_PCT;
  var meritPct = Number.isFinite(opts.meritPct) ? opts.meritPct : MERIT_PCT;
  if (!(floorPct >= 0 && floorPct <= 1 && meritPct >= 0 && meritPct <= 1 &&
        Math.abs(floorPct + meritPct - 1) < 1e-9)) {
    floorPct = MERIT_FLOOR_PCT; meritPct = MERIT_PCT;   // invalid config: fall back to defaults
  }
  var squeezeMult = Number.isFinite(opts.squeezeMult) ? opts.squeezeMult : SQUEEZE_CAP_MULT;
  if (!(squeezeMult >= 0 && squeezeMult <= 1)) squeezeMult = SQUEEZE_CAP_MULT;
  // An explicit roster is authoritative: EVERY active agent gets a floor whether or not it
  // has earned a ledger entry yet. Filtering to ledger-present agents would divide the whole
  // pool among the handful who happen to have earned, inflating their caps far above the
  // registry. Without a roster, fall back to fleet agents that do have entries.
  var per = (rewards && rewards.perAgent) || {};
  var ids = (opts.activeIds && opts.activeIds.length)
    ? opts.activeIds.slice()
    : FLEET_AGENTS.filter(function (id) { return per[id]; });
  if (!ids.length || pool <= 0) return { enabled: false, perAgent: {}, computedAt: _iso(nowMs) };

  var trail = {};
  var total = 0;
  ids.forEach(function (id) { trail[id] = computeTrailingRevenueXp(per[id], nowMs); total += trail[id]; });

  // The survival floor follows the CEO's hand-tuned per-agent caps (role weight), NOT an
  // even split — flattening them would silently overwrite deliberate allocation. Only the
  // merit portion is performance-driven. Pre-revenue this reproduces today's caps exactly.
  // Falls back to an even split when no usable baseline is supplied.
  var base = opts.baselineCaps || null;
  var baseTotal = 0;
  if (base) ids.forEach(function (id) { var v = Number(base[id]); if (Number.isFinite(v) && v > 0) baseTotal += v; });
  var baseShare = function (id) {
    if (!base || baseTotal <= 0) return 1 / ids.length;
    var v = Number(base[id]);
    return (Number.isFinite(v) && v > 0) ? (v / baseTotal) : 0;
  };

  var meritLive = total >= MERIT_MIN_SIGNAL;
  var perAgent = {};
  ids.forEach(function (id) {
    var floorShare = pool * floorPct * baseShare(id);
    var meritShare = meritLive ? pool * meritPct * (trail[id] / total) : pool * meritPct * baseShare(id);
    perAgent[id] = floorShare + meritShare;
  });

  var champion = rewards.seasonMeta && rewards.seasonMeta.previousChampion;
  var freed = 0;
  ids.forEach(function (id) {
    if (((per[id] && per[id].ladderStatus) || 'safe') === 'squeezed') {
      var cut = perAgent[id] * (1 - squeezeMult);
      perAgent[id] -= cut;
      freed += cut;
    }
  });
  var championSqueezed = champion && per[champion] &&
    (per[champion].ladderStatus || 'safe') === 'squeezed';
  // Freed budget is deliberately DROPPED (not redistributed) when the champion is
  // absent from the active roster or is themselves squeezed — the pool may sum
  // below poolDollars in those cases. Consumers must not assume exact-sum.
  if (freed > 0 && champion && perAgent[champion] != null && !championSqueezed) perAgent[champion] += freed;

  ids.forEach(function (id) { perAgent[id] = _round2(perAgent[id]); });
  return { enabled: true, perAgent: perAgent, poolDollars: pool, trailing: trail, computedAt: _iso(nowMs) };
}

// ── IO orchestration ──────────────────────────────────────────────────────────
// Prompt block (Stage 5: the "nudge each other" progression block).
// Pure: given an agentId + the rewards ledger, render the per-agent YOUR PROGRESSION
// block. Reinforces the cardinal rule (XP comes from OUTCOMES, not activity) so the
// competitive nudge orients agents toward shipping real work, never toward gaming.
function _cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

function buildProgressionPromptBlock(agentId, rewards, nowMs) {
  if (!agentId || !rewards || !rewards.perAgent) return '';
  var me = rewards.perAgent[agentId];
  if (!me) return '';
  var lvl = me.level || 1;
  var xpForNext = 50 + 25 * lvl;
  var cumLvl = 50 * (lvl - 1) + 25 * (lvl - 1) * lvl / 2;
  var into = Math.max(0, (me.xp || 0) - cumLvl);

  var ranked = Object.keys(rewards.perAgent)
    .map(function (id) { return { id: id, xp: rewards.perAgent[id].xp || 0 }; })
    .sort(function (a, b) { return b.xp - a.xp; });
  var myIdx = ranked.findIndex(function (r) { return r.id === agentId; });
  var myPos = myIdx + 1, N = ranked.length, leader = ranked[0];

  var peerLine;
  if (myPos === 1) {
    var second = ranked[1];
    peerLine = 'You lead the fleet by XP' + (second ? ' (' + _cap(second.id) + ' is #2 with ' + second.xp + ' XP, ' + ((me.xp || 0) - second.xp) + ' behind).' : '.');
  } else {
    var above = ranked[myIdx - 1];
    peerLine = 'Fleet rank #' + myPos + ' of ' + N + '. ' + _cap(leader.id) + ' leads with ' + leader.xp + ' XP. Next up: ' + _cap(above.id) + ' (' + (above.xp - (me.xp || 0)) + ' XP ahead).';
  }

  var recent = Array.isArray(me.achievements) ? me.achievements.slice(-2).map(function (a) { return a.label || a.id; }) : [];
  var recentLine = recent.length ? 'Recent unlocks: ' + recent.join(', ') + '.' : 'No achievements unlocked yet.';

  var nowT = nowMs || Date.now();
  var seasonRanked = Object.keys(rewards.perAgent)
    .filter(function (id) { return _FLEET_SET[id]; })
    .map(function (id) { return { id: id, sx: rewards.perAgent[id].seasonXp || 0 }; })
    .sort(function (a, b) { return (b.sx - a.sx) || (a.id < b.id ? -1 : 1); });
  var sIdx = seasonRanked.findIndex(function (x) { return x.id === agentId; });
  var par = (rewards.seasonMeta && rewards.seasonMeta.par) || null;
  var month = rewards.season || _iso(nowT).substring(0, 7);
  var monthEnd = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1);
  var daysLeft = Math.max(0, Math.ceil((monthEnd - nowT) / 86400000));
  var top3 = seasonRanked.slice(0, 3).map(function (x, i) { return (i + 1) + '. ' + _cap(x.id) + ' ' + x.sx; }).join('  ');

  var seasonLine = sIdx >= 0
    ? 'Rank #' + (sIdx + 1) + ' of ' + seasonRanked.length +
      '. Top: ' + top3 + '. Your season XP ' + (me.seasonXp || 0) + (par ? '/' + par + ' par' : '') +
      '. ' + daysLeft + ' days left.'
    : '';

  // A disabled ladder must not keep threatening agents with consequences that are no
  // longer enforced — the prompt is the one channel a kill switch could otherwise miss.
  var status = (rewards.laddersActive === false) ? 'safe' : (me.ladderStatus || 'safe');
  var ladderLine = '';
  if (status === 'watch') {
    ladderLine = 'LADDER: You are on relegation watch (1 below-par season). Finish at or above par or your budget gets cut next season.\n';
  } else if (status === 'squeezed') {
    ladderLine = 'LADDER: Your budget is cut 30% this season (2 below-par seasons). Finishing at or above par restores it. One more below-par season auto-drafts a retirement proposal.\n';
  } else if (status === 'retirement_pending') {
    ladderLine = 'LADDER: A retirement proposal for you has been drafted for CEO decision. You are one CEO decision from retirement. Finishing the season at or above par is the only thing that resets this — and revenue-lane outcomes are by far the fastest way there. Your successor would inherit your memories.\n';
  }

  var tier = (rewards.privileges && rewards.privileges.enabled !== false && rewards.privileges.tiers && rewards.privileges.tiers[agentId]) || 'line';
  var tierLine = tier === 'vanguard'
    ? 'Privileges: VANGUARD — +1 action slot, full model tier, proposal rights.'
    : tier === 'probation'
      ? 'Privileges: PROBATION — -1 action slot, economy model, campaign/objective proposals blocked. Climb the season board to restore them.'
      : 'Privileges: LINE — standard slots and model.';

  return '\n═══ YOUR PROGRESSION — SEASON ' + month + ' ═══\n' +
    'Level ' + lvl + ' ' + (me.rank || 'Rookie') + (me.class ? ' (' + me.class + ')' : '') + '. ' +
      into + '/' + xpForNext + ' XP to Level ' + (lvl + 1) + '. Renown ' + (me.renown || 0) + '. ' + (me.streakDays || 0) + '-day streak.\n' +
    (seasonLine ? seasonLine + '\n' : '') +
    peerLine + '\n' +
    ladderLine +
    tierLine + '\n' +
    recentLine + '\n' +
    'Revenue lane pays most: attributed sale 100+ XP, lead 15, public scan 3 — split across every agent in the chain that produced it (writer, assignee, reviewer). Tasks pay at most 3 XP/day. ' +
    'You earn XP ONLY from outcomes that land: revenue, CEO-approved work, published content, real engagement, completed peer-reviewed tasks, and assists where the helped work ships. Proposing, commenting, or messaging earns nothing. To climb, ship something that sells.\n';
}

async function runRewardsEngine(opts) {
  opts = opts || {};
  var storage = opts.storage;
  var nowMs = opts.nowMs || Date.now();
  var log = opts.log || function () {};
  try {
    var loaded = await Promise.all([
      storage.getState('approvalQueue').then(function (v) { return v || []; }),
      storage.getState('blogPosts').then(function (v) { return v || []; }),
      storage.getState('outcomeSnapshots').then(function (v) { return v || {}; }),
      storage.getState('tasks').then(function (v) { return v || []; }),
      storage.getState('tasksArchive').then(function (v) { return v || []; }),
      storage.getState('socialAccountStats').then(function (v) { return v || {}; }),
      storage.getState('runtimeMemory').then(function (v) { return v || {}; }),
      storage.getState('agentRewards').then(function (v) { return v || null; }),
      storage.getState('blogPostViews').then(function (v) { return Array.isArray(v) ? v.length : 0; }),
      storage.getState('revenueLedger').then(function (v) { return (v && Array.isArray(v.entries)) ? v.entries : []; }),
      storage.getState('as_leads').then(function (v) { return v || []; }),
      storage.getState('cc_analytics').then(function (v) { return v || []; }),
      storage.getState('actions').then(function (v) { return v || []; }),
      storage.getState('actionAttributionIndex').then(function (v) { return (v && v.map) ? v.map : {}; }),
      storage.getState('campaigns').then(function (v) { return v || []; }),
      storage.getState('systemConfig').then(function (v) { return v || {}; }),
      storage.getState('agentRegistry').then(function (v) { return v || null; })
    ]);
    var cfg = normalizeRewardsConfig(loaded[15]);
    var registry = loaded[16];
    var activeIds = (registry && Array.isArray(registry.agents))
      ? registry.agents.filter(function (a) { return a && a.status === 'active'; }).map(function (a) { return a.id; })
      : FLEET_AGENTS;

    var actionsById = {};
    _arr(loaded[12]).forEach(function (a) { if (a && a.id) actionsById[a.id] = a; });

    var state = {
      approvalQueue: loaded[0], blogPosts: loaded[1], outcomeSnapshots: loaded[2],
      tasks: loaded[3], tasksArchive: loaded[4], _nowMs: nowMs
    };
    if (cfg.enabled) {
      state.revenueLedgerEntries = loaded[9];
      state.asLeads = loaded[10];
      state.scans = loaded[11];
      state.actionsById = actionsById;
      state.attributionIndex = loaded[13];
      state.campaigns = loaded[14];
    }

    var prev = loaded[7];
    // ORDER MATTERS: rollover must see the RAW prev.season before _initRewards
    // (inside applyEvents/applyCompany) stamps the current month over it.
    var rolled = cfg.enabled
      ? rolloverSeason(prev, nowMs, { activeIds: activeIds, parFloor: cfg.parFloor })
      : { rewards: prev, rolled: false, transitions: [] };

    var events = extractEvents(state, rolled.rewards);
    var applied = applyEvents(events, rolled.rewards, nowMs);

    var followerTotal = 0;
    var sas = loaded[5] || {};
    // Prod nests platforms under socialAccountStats.platforms (same shape bug
    // as the proposal generator, fixed 07-02); fall back to the flat shape.
    var sasPlatforms = (sas && sas.platforms) ? sas.platforms : sas;
    Object.keys(sasPlatforms || {}).forEach(function (k) {
      var f = sasPlatforms[k] && Number(sasPlatforms[k].followers);
      if (Number.isFinite(f)) followerTotal += f;
    });
    var rm = loaded[6] || {};
    var rev = rm.revenueDigest && Number(rm.revenueDigest.totalCents);
    var rewards = applyCompany(applied.rewards, {
      followerTotal: followerTotal,
      revenueCents: Number.isFinite(rev) ? rev : undefined,
      blogViews: loaded[8]
    }, nowMs);

    if (cfg.enabled && cfg.meritBudget.enabled) {
      var pool = cfg.budgetMonthly != null ? cfg.budgetMonthly
        : (loaded[15] && loaded[15].finance && Number(loaded[15].finance.budgetMonthly)) || 110;
      // Baseline = the CEO's hand-tuned registry caps. They weight the survival floor so
      // the plan preserves deliberate role allocation instead of flattening it; only the
      // merit portion moves with revenue.
      var baselineCaps = {};
      if (registry && Array.isArray(registry.agents)) {
        registry.agents.forEach(function (a) {
          if (a && a.id && Number.isFinite(Number(a.monthlyCap))) baselineCaps[a.id] = Number(a.monthlyCap);
        });
      }
      rewards.budgetPlan = computeBudgetPlan(rewards, {
        poolDollars: pool, floorPct: cfg.meritBudget.floorPct, meritPct: cfg.meritBudget.meritPct,
        squeezeMult: cfg.squeezeMult, activeIds: activeIds, baselineCaps: baselineCaps, nowMs: nowMs
      });
    } else {
      rewards.budgetPlan = { enabled: false, perAgent: {}, computedAt: _iso(nowMs) };
    }
    if (rewards.privileges) rewards.privileges.enabled = cfg.enabled && cfg.privileges.enabled;
    // Read by the prompt block so the kill switch reaches the agent-facing ladder text too.
    rewards.laddersActive = !!cfg.enabled;

    // While disabled, keep the stale season marker: _initRewards (inside applyEvents)
    // stamps the current month unconditionally, which would silently consume a rollover
    // the kill switch skipped. Preserving it lets the missed rollover fire on re-enable,
    // with rolloverSeason's monthsSkipped recording the gap honestly.
    if (!cfg.enabled && prev && prev.season) rewards.season = prev.season;

    // Retirement drafts — the ladder's final rung. IO-layer append, dedup-guarded
    // (transition-only + pending-queue check), never for protected agents, never
    // below fleet minimum. CEO decides; approveProposal owns the side effects.
    //
    // ORDER MATTERS: the queue is written BEFORE the ledger. If the ledger write then
    // fails, the next run re-rolls the season and re-fires the transition, and the
    // pending-dup check below makes the re-append a no-op. The reverse order would
    // consume the transition and lose the draft forever.
    if (cfg.enabled && rolled.transitions.length) {
      var pending = _arr(loaded[0]);
      var drafts = 0;
      rolled.transitions.forEach(function (t) {
        if (t.to !== 'retirement_pending' || PROTECTED_AGENTS[t.agentId] || RETIREMENT_EXEMPT_AGENTS[t.agentId]) return;
        if (activeIds.length - 1 - drafts < FLEET_MIN) return;
        var dup = pending.some(function (q) {
          return q && q.type === 'agent_retire_proposal' && q.status === 'pending' &&
            q.retire && q.retire.targetAgent === t.agentId;
        });
        if (dup) return;
        var A = rewards.perAgent[t.agentId] || {};
        var orphans = (registry && Array.isArray(registry.agents))
          ? registry.agents.filter(function (a) {
              return a && a.status === 'active' && a.reportsTo === t.agentId;
            }).map(function (a) { return a.id; })
          : [];
        pending.push({
          id: 'retpr_' + nowMs + '_rwd' + drafts,
          type: 'agent_retire_proposal',
          status: 'pending',
          proposedBy: 'rewards-engine',
          retire: {
            targetAgent: t.agentId,
            rationale: ('Season ladder: ' + (A.parMisses || 3) + ' consecutive below-par seasons. Auto-drafted by the rewards ladder per the 2026-07-30 Revenue Seasons spec. CEO decision required.').substring(0, 500),
            reassignmentPlan: 'Standard retire flow: open tasks reassign to the domain lead on approval. Successor seeding (knowledge inheritance) is Track C.',
            estimatedWinddownCost: 0,
            orphans: orphans
          },
          estimatedCost: 0,
          evidence: { source: 'rewards-ladder', season: (prev && prev.season) || null, parMisses: A.parMisses || null },
          createdAt: _iso(nowMs)
        });
        drafts++;
      });
      if (drafts > 0) await storage.setState('approvalQueue', pending);
    }

    await storage.setState('agentRewards', rewards);

    log('[rewardsEngine] events=' + events.length + ' awards=' + applied.newAwards.length + ' followers=' + followerTotal + ' rolled=' + rolled.rolled);
    return { ok: true, events: events.length, awards: applied.newAwards.length, rolled: rolled.rolled };
  } catch (err) {
    log('[rewardsEngine] Fatal (no-op): ' + (err && err.message ? err.message : String(err)));
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  levelFromXp: levelFromXp, rankFromLevel: rankFromLevel, classFor: classFor,
  extractEvents: extractEvents, applyEvents: applyEvents, applyCompany: applyCompany,
  buildProgressionPromptBlock: buildProgressionPromptBlock,
  resolveContributors: resolveContributors, conversionFallbackAgents: conversionFallbackAgents,
  rolloverSeason: rolloverSeason,
  computeBudgetPlan: computeBudgetPlan, computeTrailingRevenueXp: computeTrailingRevenueXp,
  normalizeRewardsConfig: normalizeRewardsConfig,
  runRewardsEngine: runRewardsEngine,
  SEASON_PAR_CEILING: SEASON_PAR_CEILING, MERIT_MIN_SIGNAL: MERIT_MIN_SIGNAL
};
