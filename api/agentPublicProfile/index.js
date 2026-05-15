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

function pickLatestPublicMemory(memories) {
  if (!Array.isArray(memories)) return null;
  for (let i = memories.length - 1; i >= 0; i--) {
    const m = memories[i];
    if (!m || typeof m.text !== 'string') continue;
    const text = m.text.trim();
    if (!text) continue;
    if (m.source && String(m.source).startsWith('auto:')) continue;
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
    const alloc = (await storage.getState('allocationDigest')) || null;
    if (alloc && alloc.system) {
      status = alloc.system.status || null;
      stat = { label: 'MTD spend', value: `$${Number(alloc.system.spent || 0).toFixed(2)} / $${Number(alloc.system.budget || 0).toFixed(0)}` };
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
    for (const [name, p] of Object.entries(platforms)) {
      if (p && typeof p.deltaWoW === 'number') {
        if (topDelta === null || Math.abs(p.deltaWoW) > Math.abs(topDelta)) {
          topDelta = p.deltaWoW;
          topPlatform = name;
        }
      }
    }
    status = 'GREEN';
    stat = topPlatform
      ? { label: 'Top platform WoW', value: `${topPlatform} ${topDelta >= 0 ? '+' : ''}${topDelta}` }
      : null;
  } else if (id === 'scout') {
    const candidates = (await storage.getState('blueskyCandidates')) || [];
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const thisWeek = candidates.filter(c => c && Date.parse(c.discoveredAt || '') >= weekAgo);
    status = 'GREEN';
    stat = { label: 'Discoveries this week', value: String(thisWeek.length) };
  }

  return { id, status, stat, latestMemory, asOf: new Date().toISOString() };
}

async function buildBatch() {
  // Pull system-level status from allocationDigest so the hub dots reflect
  // overall company health. Per-agent statuses default to GREEN — individual
  // profile pages still show the proper per-agent signal.
  const alloc = (await storage.getState('allocationDigest')) || null;
  const systemStatus = (alloc && alloc.system && alloc.system.status) || 'GREEN';
  const agents = ALLOWLIST.map(id => ({ id, status: id === 'cipher' ? systemStatus : 'GREEN' }));
  return { asOf: new Date().toISOString(), agents };
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
