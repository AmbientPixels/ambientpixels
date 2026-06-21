// /api/agentPublicProfile — public read-only endpoint for AmbientOS agent profile pages.
//
// Single-agent mode:
//   GET /api/agentPublicProfile?id=cipher
//   → { id, status, stat: {label,value}, latestMemory: {text,agoText}, asOf }
//
// Batch mode (hub page):
//   GET /api/agentPublicProfile?id=all
//   → { asOf, agents: [{id, status}, ...] }
//
// 60s in-memory cache. Anonymous. 30 req/min/IP rate limit.

const storage = require('../_utils/companyStorage');

const ALLOWLIST = ['nova', 'cipher', 'pixel', 'forge', 'scribe', 'quill', 'echo', 'scout'];
const CACHE_MS = 60 * 1000;
const cache = new Map(); // key -> { at, body }

const rateBuckets = new Map(); // ipHash -> { count, resetAt }
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

function hashIp(ip) {
  // Simple non-cryptographic hash — good enough for per-IP buckets.
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h) + ip.charCodeAt(i) | 0;
  return String(h);
}

function rateLimitOk(req) {
  const ip = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || 'unknown';
  const key = hashIp(String(ip).split(',')[0].trim());
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT;
}

function agoText(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Sources to suppress on public profile: system bookkeeping, not agent voice.
const MEMORY_NOISE_SOURCES = new Set([
  'auto:rate-limit',
  'auto:quality-gate',
  'auto:budget-rejected',
  'auto:budget-approved',
  'auto:campaign-pace',
  'auto:experiment-verdict'
]);

function pickLatestPublicMemory(memories) {
  if (!Array.isArray(memories)) return null;
  for (let i = memories.length - 1; i >= 0; i--) {
    const m = memories[i];
    if (!m || typeof m.text !== 'string') continue;
    const text = m.text.trim();
    if (!text) continue;
    // Allow non-auto sources and voice-bearing auto sources (reflection, consolidation, ceo-edit).
    // Suppress only pure system bookkeeping sources.
    if (m.source && MEMORY_NOISE_SOURCES.has(m.source)) continue;
    const truncated = text.length > 200 ? text.slice(0, 199) + '…' : text;
    return {
      text: truncated,
      agoText: agoText(m.timestamp)
    };
  }
  return null;
}

async function buildSingle(id) {
  const memories = (await storage.getState('agentMemories')) || {};
  const latestMemory = pickLatestPublicMemory(memories[id]);

  let status = null;
  let stat = null;

  if (id === 'cipher') {
    // allocationDigest lives inside runtimeMemory, not as a top-level state key.
    // Fall back to the top-level key for safety, then to financeDigest if both miss.
    const runtime = (await storage.getState('runtimeMemory')) || {};
    const alloc = runtime.allocationDigest || (await storage.getState('allocationDigest')) || null;
    if (alloc && alloc.system) {
      status = alloc.system.status || null;
      stat = { label: 'MTD spend', value: `$${Number(alloc.system.spent || 0).toFixed(2)} / $${Number(alloc.system.budget || 0).toFixed(0)}` };
    } else if (runtime.financeDigest && runtime.financeDigest.monthlyActual != null) {
      // Last-resort fallback: financeDigest carries the same monthly numbers.
      const fd = runtime.financeDigest;
      status = fd.status || 'GREEN';
      stat = { label: 'MTD spend', value: `$${Number(fd.monthlyActual || 0).toFixed(2)} / $${Number(fd.monthlyBudget || 0).toFixed(0)}` };
    }
  } else if (id === 'nova') {
    const tasks = (await storage.getState('tasks')) || [];
    const active = tasks.filter(t => t && t.assignee === 'nova' && t.status !== 'done' && !t._archived);
    status = 'GREEN';
    stat = { label: 'Active tasks', value: String(active.length) };
  } else if (id === 'pixel') {
    const tasks = (await storage.getState('tasks')) || [];
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const heroes = tasks.filter(t => t && t.assignee === 'pixel' && t.status === 'done'
      && (t.title || '').indexOf('Generate hero image') === 0
      && (t.completedAt || t.updatedAt || '').indexOf(monthPrefix) === 0);
    status = 'GREEN';
    stat = { label: 'Heroes this month', value: String(heroes.length) };
  } else if (id === 'forge') {
    const runs = (await storage.getState('heartbeatRuns')) || [];
    const okRuns = runs.filter(r => r && r.status === 'ok');
    const last = okRuns[okRuns.length - 1];
    status = okRuns.length > 0 ? 'GREEN' : 'YELLOW';
    stat = { label: 'Last heartbeat', value: last ? agoText(last.startedAt || last.timestamp) : '—' };
  } else if (id === 'scribe') {
    const posts = (await storage.getState('blogPosts')) || [];
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const thisMonth = posts.filter(p => p && (p.publishedAt || '').indexOf(monthPrefix) === 0);
    status = 'GREEN';
    stat = { label: 'Posts this month', value: String(thisMonth.length) };
  } else if (id === 'quill') {
    const tasks = (await storage.getState('tasks')) || [];
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const reviews = tasks.filter(t => t && t.reviewer === 'quill'
      && Date.parse(t.reviewedAt || '') >= weekAgo);
    status = 'GREEN';
    stat = { label: 'Edits this week', value: String(reviews.length) };
  } else if (id === 'echo') {
    const social = (await storage.getState('socialAccountStats')) || {};
    let topDelta = null;
    let topPlatform = null;
    const platforms = social.platforms || {};

    // Preferred: deltaWoW pre-computed on platforms (legacy path).
    for (const [name, p] of Object.entries(platforms)) {
      if (p && typeof p.deltaWoW === 'number') {
        if (topDelta === null || Math.abs(p.deltaWoW) > Math.abs(topDelta)) {
          topDelta = p.deltaWoW;
          topPlatform = name;
        }
      }
    }

    // Fallback: compute deltaWoW on the fly from socialWeeklySnapshots.
    if (topPlatform === null) {
      const snaps = (await storage.getState('socialWeeklySnapshots')) || [];
      if (Array.isArray(snaps) && snaps.length >= 2) {
        const latest = snaps[snaps.length - 1];
        const prev = snaps[snaps.length - 2];
        const f1 = latest && latest.followers || {};
        const f0 = prev && prev.followers || {};
        for (const name of Object.keys(f1)) {
          if (name === 'total') continue;
          const delta = Number(f1[name]) - Number(f0[name] || 0);
          if (!Number.isFinite(delta)) continue;
          if (topDelta === null || Math.abs(delta) > Math.abs(topDelta)) {
            topDelta = delta;
            topPlatform = name;
          }
        }
      }
    }

    status = 'GREEN';
    if (topPlatform !== null) {
      stat = { label: 'Top platform WoW', value: `${topPlatform} ${topDelta >= 0 ? '+' : ''}${topDelta}` };
    } else {
      // Last-resort: total followers across all platforms.
      const totalFollowers = social.totals && social.totals.followers;
      if (typeof totalFollowers === 'number') {
        stat = { label: 'Total followers', value: String(totalFollowers) };
      }
    }
  } else if (id === 'scout') {
    const candidates = (await storage.getState('blueskyCandidates')) || [];
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const thisWeek = candidates.filter(c => c && Date.parse(c.discoveredAt || '') >= weekAgo);
    status = 'GREEN';
    stat = { label: 'Discoveries this week', value: String(thisWeek.length) };
  }

  // Progression (Stage 3): level / rank / class / XP bar / Renown / streak / badges,
  // from the agentRewards ledger. Null when the rewards engine hasn't run yet.
  const rewards = (await storage.getState('agentRewards')) || null;
  const rw = rewards && rewards.perAgent && rewards.perAgent[id];
  let progression = null;
  if (rw) {
    const lvl = rw.level || 1;
    const xpForNext = 50 + 25 * lvl;                          // cost(lvl -> lvl+1)
    const cumLvl = 50 * (lvl - 1) + 25 * (lvl - 1) * lvl / 2; // cumulative XP at lvl
    const xpInto = Math.max(0, (rw.xp || 0) - cumLvl);
    const pct = Math.max(0, Math.min(100, Math.round(xpInto / xpForNext * 100)));
    progression = {
      level: lvl, rank: rw.rank || 'Rookie', class: rw.class || '',
      xp: rw.xp || 0, renown: rw.renown || 0, streakDays: rw.streakDays || 0,
      xpInto, xpForNext, pct,
      achievements: (Array.isArray(rw.achievements) ? rw.achievements.slice(-4) : [])
        .map(a => ({ label: a.label || a.id, tier: a.tier || 'bronze' }))
    };
  }

  // Career timeline: joined-the-fleet + doctrine evolutions + achievement unlocks.
  const registry = (await storage.getState('agentRegistry')) || null;
  const regAgent = (registry && Array.isArray(registry.agents)) ? registry.agents.find(a => a.id === id) : null;
  const career = [];
  if (regAgent && regAgent.hiredAt) career.push({ at: regAgent.hiredAt, label: 'Joined the fleet' });
  if (regAgent && Array.isArray(regAgent.doctrineHistory)) {
    regAgent.doctrineHistory.forEach(h => {
      const fields = Array.isArray(h.changedFields) && h.changedFields.length ? h.changedFields.join(', ') : 'role';
      career.push({ at: h.at, label: 'Evolved — ' + fields });
    });
  }
  if (rw && Array.isArray(rw.achievements)) {
    rw.achievements.forEach(a => career.push({ at: a.at, label: 'Unlocked — ' + (a.label || a.id) }));
  }
  const careerTop = career.filter(c => c.at)
    .sort((x, y) => (Date.parse(y.at || '') || 0) - (Date.parse(x.at || '') || 0))
    .slice(0, 8);

  return { id, status, stat, latestMemory, progression, career: careerTop, asOf: new Date().toISOString() };
}

async function buildBatch() {
  // Pull system-level status from allocationDigest so the hub dots reflect
  // overall company health. Per-agent statuses default to GREEN — individual
  // profile pages still show the proper per-agent signal.
  const alloc = (await storage.getState('allocationDigest')) || null;
  const systemStatus = (alloc && alloc.system && alloc.system.status) || 'GREEN';
  const configs = (await storage.getState('agentConfigs')) || {};
  const rewards = (await storage.getState('agentRewards')) || null;
  const rwPA = (rewards && rewards.perAgent) || {};
  const agents = ALLOWLIST.map(id => {
    const lastHeartbeatAt = configs[id] && configs[id].heartbeat && configs[id].heartbeat.lastBeat || null;
    const r = rwPA[id] || {};
    return {
      id,
      status: id === 'cipher' ? systemStatus : 'GREEN',
      lastHeartbeatAt,
      level: r.level || null,
      rank: r.rank || null,
      class: r.class || '',
      xp: r.xp || 0,
      renown: r.renown || 0,
      streakDays: r.streakDays || 0
    };
  });

  // Company progression + a fleet-wide recent-unlocks feed for the public leaderboard.
  const comp = (rewards && rewards.company) || {};
  const company = {
    followers: comp.lastFollowerTotal || (comp.counters && comp.counters.followers) || 0,
    revenueCents: comp.lastRevenueCents || 0,
    blogViews: (comp.counters && comp.counters.blogViews) || 0,
    achievements: Array.isArray(comp.achievements) ? comp.achievements.map(a => ({ id: a.id, label: a.label })) : []
  };
  const milestones = [];
  ALLOWLIST.forEach(id => {
    const r = rwPA[id];
    if (r && Array.isArray(r.achievements)) {
      r.achievements.forEach(a => milestones.push({ agentId: id, label: a.label || a.id, tier: a.tier || 'bronze', at: a.at }));
    }
  });
  const milestonesTop = milestones.filter(m => m.at)
    .sort((x, y) => (Date.parse(y.at || '') || 0) - (Date.parse(x.at || '') || 0))
    .slice(0, 12);

  return { asOf: new Date().toISOString(), agents, company, milestones: milestonesTop };
}

module.exports = async function (context, req) {
  const id = (req.query && req.query.id) || '';

  if (!id) {
    context.res = { status: 400, body: { error: 'missing id query param' } };
    return;
  }

  if (!rateLimitOk(req)) {
    context.res = { status: 429, body: { error: 'rate limit exceeded' } };
    return;
  }

  if (id !== 'all' && !ALLOWLIST.includes(id)) {
    context.res = { status: 404, body: { error: 'unknown agent id' } };
    return;
  }

  const now = Date.now();
  const cached = cache.get(id);
  if (cached && (now - cached.at) < CACHE_MS) {
    context.res = { status: 200, body: cached.body, headers: { 'Cache-Control': 'public, max-age=60' } };
    return;
  }

  try {
    const body = id === 'all' ? await buildBatch() : await buildSingle(id);
    cache.set(id, { at: now, body });
    context.res = { status: 200, body, headers: { 'Cache-Control': 'public, max-age=60' } };
  } catch (e) {
    context.log('[agentPublicProfile] error:', e && e.message);
    context.res = { status: 500, body: { error: 'internal' } };
  }
};
