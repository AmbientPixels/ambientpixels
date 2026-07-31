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

const RANKS = [
  { min: 50, name: 'Legend' },
  { min: 40, name: 'Elite' },
  { min: 25, name: 'Veteran' },
  { min: 10, name: 'Operator' },
  { min: 1, name: 'Rookie' }
];

const BASE_CLASS = {
  nova: 'Orchestrator', cipher: 'Strategist', pixel: 'Artisan', forge: 'Engineer',
  echo: 'Herald', scout: 'Pathfinder', scribe: 'Scribe', quill: 'Editor'
};
const SPEC_SUFFIX = {
  assist: 'the Connector', engagement: 'the Amplifier', blog_ship: 'the Author',
  proposal_approved: 'the Strategist', task_done: 'the Workhorse', social_ship: 'the Voice',
  review_done: 'the Gatekeeper'
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
  { id: 'level_50', label: 'Reached Level 50', tier: 'platinum', test: a => a.level >= 50 }
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
function _iso(ms) { return new Date(ms).toISOString(); }
function _day(iso) { return String(iso || '').substring(0, 10); }
function _dayDiff(d1, d2) { return Math.round((Date.parse(d2) - Date.parse(d1)) / 86400000); }

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
    streakDays: 0, lastActiveDay: null, dailyXp: 0, dailyXpDay: null,
    counters: { approvals: 0, blogs: 0, socialPosts: 0, docs: 0, tasksDone: 0, assists: 0, engagementTotal: 0, reviews: 0 },
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
    if (A.dailyXpDay !== day) { A.dailyXp = 0; A.dailyXpDay = day; }

    var computed = Math.round(_baseXpFor(e) * _streakMult(A.streakDays));
    var allowed = Math.max(0, DAILY_XP_CAP - A.dailyXp);
    var granted = Math.min(computed, allowed);
    var lost = computed - granted;
    A.dailyXp += granted;
    A.xp += granted;
    var renownGain = _overflowRenown(lost);
    A.renown += renownGain;

    _bumpCounters(A, e);
    A.recent.unshift({ at: e.at, type: e.type, xp: granted, renown: renownGain, reason: e.type, sourceId: e.id });
    if (A.recent.length > RECENT_CAP) A.recent = A.recent.slice(0, RECENT_CAP);
    newAwards.push({ agentId: aid, type: e.type, xp: granted, renown: renownGain, sourceId: e.id });
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

  return ev;
}

// ── IO orchestration ──────────────────────────────────────────────────────────
// Prompt block (Stage 5: the "nudge each other" progression block).
// Pure: given an agentId + the rewards ledger, render the per-agent YOUR PROGRESSION
// block. Reinforces the cardinal rule (XP comes from OUTCOMES, not activity) so the
// competitive nudge orients agents toward shipping real work, never toward gaming.
function _cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

function buildProgressionPromptBlock(agentId, rewards) {
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

  return '\n═══ YOUR PROGRESSION ═══\n' +
    'Level ' + lvl + ' ' + (me.rank || 'Rookie') + (me.class ? ' (' + me.class + ')' : '') + '. ' +
      into + '/' + xpForNext + ' XP to Level ' + (lvl + 1) + '. Renown ' + (me.renown || 0) + '. ' + (me.streakDays || 0) + '-day streak.\n' +
    peerLine + '\n' +
    recentLine + '\n' +
    'You earn XP ONLY from outcomes that land: CEO-approved work, published content, real engagement, completed peer-reviewed tasks, and assists where the helped work ships. Proposing, commenting, or messaging earns nothing. To climb, ship something real.\n';
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
      storage.getState('blogPostViews').then(function (v) { return Array.isArray(v) ? v.length : 0; })
    ]);
    var state = { approvalQueue: loaded[0], blogPosts: loaded[1], outcomeSnapshots: loaded[2], tasks: loaded[3], tasksArchive: loaded[4] };
    var sas = loaded[5] || {};
    var prev = loaded[7];

    var events = extractEvents(state, prev);
    var applied = applyEvents(events, prev, nowMs);

    var followerTotal = 0;
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

    await storage.setState('agentRewards', rewards);
    log('[rewardsEngine] events=' + events.length + ' awards=' + applied.newAwards.length + ' followers=' + followerTotal);
    return { ok: true, events: events.length, awards: applied.newAwards.length };
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
  runRewardsEngine: runRewardsEngine
};
