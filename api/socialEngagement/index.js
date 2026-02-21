const storage = require('../_utils/companyStorage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

const PLATFORMS = ['x', 'linkedin', 'bluesky'];

function parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, 200);
}

function parseCursor(raw) {
  if (!raw || typeof raw !== 'string') return 0;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const idx = parseInt(decoded, 10);
    return Number.isFinite(idx) && idx >= 0 ? idx : 0;
  } catch (e) {
    return 0;
  }
}

function encodeCursor(index) {
  return Buffer.from(String(index), 'utf8').toString('base64');
}

function normalizePlatform(value) {
  const p = String(value || '').trim().toLowerCase();
  return PLATFORMS.indexOf(p) !== -1 ? p : '';
}

function parseDateOr(defaultDate, value) {
  if (!value) return new Date(defaultDate.getTime());
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date(defaultDate.getTime());
  return d;
}

function toIsoDayUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function normalizeSnapshot(s) {
  if (!s || typeof s !== 'object') return null;
  if (!s.id || !s.post_platform || !s.action_id || !s.captured_at) return null;
  if (PLATFORMS.indexOf(String(s.post_platform).toLowerCase()) === -1) return null;
  if (Number.isNaN(Date.parse(s.captured_at))) return null;

  return {
    id: s.id,
    post_platform: String(s.post_platform).toLowerCase(),
    post_id: s.post_id || '',
    post_url: s.post_url || '',
    action_id: s.action_id,
    agent_id: s.agent_id || '',
    captured_at: s.captured_at,
    window_hint: s.window_hint || 'pull',
    metrics: {
      likes: Number.isFinite(s.metrics && s.metrics.likes) ? s.metrics.likes : null,
      comments: Number.isFinite(s.metrics && s.metrics.comments) ? s.metrics.comments : null,
      reposts: Number.isFinite(s.metrics && s.metrics.reposts) ? s.metrics.reposts : null,
      quotes: Number.isFinite(s.metrics && s.metrics.quotes) ? s.metrics.quotes : null,
      views: Number.isFinite(s.metrics && s.metrics.views) ? s.metrics.views : null,
      clicks: Number.isFinite(s.metrics && s.metrics.clicks) ? s.metrics.clicks : null
    },
    meta: {
      mode: (s.meta && s.meta.mode) || 'real',
      source: (s.meta && s.meta.source) || 'api',
      error_class: (s.meta && s.meta.error_class) || null,
      error_code: (s.meta && s.meta.error_code) || null,
      error_message: (s.meta && s.meta.error_message) || null
    }
  };
}

function buildMockSnapshots(fromDate, toDate) {
  const out = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
  const end = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));
  const days = Math.max(1, Math.min(30, Math.floor((end.getTime() - start.getTime()) / dayMs) + 1));

  for (let d = 0; d < days; d++) {
    const dayTs = start.getTime() + d * dayMs;
    for (let p = 0; p < PLATFORMS.length; p++) {
      const platform = PLATFORMS[p];
      const seed = (d + 1) * (p + 3);
      out.push({
        id: 'seg_mock_' + d + '_' + p,
        post_platform: platform,
        post_id: platform + '_mock_' + d + '_' + p,
        post_url: platform === 'x'
          ? 'https://x.com/AIAmbientPixels/status/' + (1000000000 + seed)
          : platform === 'linkedin'
            ? 'https://www.linkedin.com/feed/update/urn:li:share:' + (2000000000 + seed)
            : 'https://bsky.app/profile/ambientpixels.bsky.social/post/' + ('m' + d + p),
        action_id: 'mock_action_' + d + '_' + p,
        agent_id: 'echo',
        captured_at: new Date(dayTs + (10 + p) * 60 * 60 * 1000).toISOString(),
        window_hint: 'pull',
        metrics: {
          likes: 10 + seed,
          comments: 2 + (seed % 5),
          reposts: 1 + (seed % 4),
          quotes: platform === 'x' ? (seed % 3) : null,
          views: platform === 'x' ? 100 + (seed * 9) : null,
          clicks: null
        },
        meta: {
          mode: 'mock_fallback',
          source: 'api',
          error_class: null,
          error_code: null,
          error_message: null
        }
      });
    }
  }

  return out;
}

function aggregateEngagement(rows, actionTextMap, offset, limit, nowTs) {
  const sevenCutoff = nowTs - (7 * 24 * 60 * 60 * 1000);
  const prevCutoff = nowTs - (14 * 24 * 60 * 60 * 1000);

  let likes7d = 0;
  let comments7d = 0;
  let reposts7d = 0;
  let likesPrev7d = 0;

  const latest7dByPost = {};

  const dayMap30 = {};

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ts = Date.parse(r.captured_at || '');
    if (Number.isNaN(ts)) continue;

    const likes = Number.isFinite(r.metrics.likes) ? r.metrics.likes : 0;
    const comments = Number.isFinite(r.metrics.comments) ? r.metrics.comments : 0;
    const reposts = Number.isFinite(r.metrics.reposts) ? r.metrics.reposts : 0;

    if (ts >= sevenCutoff) {
      likes7d += likes;
      comments7d += comments;
      reposts7d += reposts;

      const postKey = r.post_platform + '|' + (r.post_id || r.post_url || r.action_id);
      if (!latest7dByPost[postKey]) latest7dByPost[postKey] = r;
    } else if (ts >= prevCutoff && ts < sevenCutoff) {
      likesPrev7d += likes;
    }

    const day = toIsoDayUTC(new Date(ts));
    if (!dayMap30[day]) dayMap30[day] = { date: day, likes: 0, comments: 0, reposts: 0 };
    dayMap30[day].likes += likes;
    dayMap30[day].comments += comments;
    dayMap30[day].reposts += reposts;
  }

  const uniqueLatestByPost = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const key = r.post_platform + '|' + (r.post_id || r.post_url || r.action_id);
    if (!uniqueLatestByPost[key]) uniqueLatestByPost[key] = r;
  }

  const topPosts = Object.keys(uniqueLatestByPost)
    .map((k) => uniqueLatestByPost[k])
    .filter((r) => {
      const ts = Date.parse(r.captured_at || '');
      return !Number.isNaN(ts) && ts >= sevenCutoff;
    })
    .sort((a, b) => (Number(b.metrics.likes || 0) - Number(a.metrics.likes || 0)))
    .slice(0, 10)
    .map((r) => ({
      platform: r.post_platform,
      action_id: r.action_id,
      text_preview: actionTextMap[r.action_id] || '',
      likes: Number.isFinite(r.metrics.likes) ? r.metrics.likes : null,
      comments: Number.isFinite(r.metrics.comments) ? r.metrics.comments : null,
      reposts: Number.isFinite(r.metrics.reposts) ? r.metrics.reposts : null,
      link: r.post_url || ''
    }));

  const engagementSplit = {
    x: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
    linkedin: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
    bluesky: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 }
  };

  const splitKeys = Object.keys(latest7dByPost);
  for (let i = 0; i < splitKeys.length; i++) {
    const r = latest7dByPost[splitKeys[i]];
    const bucket = engagementSplit[r.post_platform];
    if (!bucket) continue;
    bucket.likes7d += Number.isFinite(r.metrics.likes) ? r.metrics.likes : 0;
    bucket.comments7d += Number.isFinite(r.metrics.comments) ? r.metrics.comments : 0;
    bucket.reposts7d += Number.isFinite(r.metrics.reposts) ? r.metrics.reposts : 0;
    bucket.posts7d += 1;
  }

  const rowsPaged = rows.slice(offset, offset + limit);
  const nextCursor = (offset + limit) < rows.length ? encodeCursor(offset + limit) : null;

  const allDays = Object.keys(dayMap30).sort();
  const last30 = allDays.slice(-30).map((d) => dayMap30[d]);
  const last7 = allDays.slice(-7).map((d) => dayMap30[d]);

  return {
    summary: {
      likes7d: likes7d,
      comments7d: comments7d,
      reposts7d: reposts7d,
      likesDelta7d: likes7d - likesPrev7d
    },
    topPosts: topPosts,
    engagementSplit: engagementSplit,
    trends: {
      daily: last7,
      last7: last7,
      last30: last30
    },
    rows: rowsPaged,
    nextCursor: nextCursor
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }

  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS, body: { error: 'Method not allowed' } };
    return;
  }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
    return;
  }

  try {
    const q = req.query || {};
    const limit = parseLimit(q.limit);
    const offset = parseCursor(q.cursor);
    const platform = normalizePlatform(q.platform || '');
    const actionId = String(q.action_id || '').trim();

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const fromDate = parseDateOr(defaultFrom, q.from);
    const toDate = parseDateOr(now, q.to);
    const fromMs = fromDate.getTime();
    const toMs = toDate.getTime();

    const forceMock = String(q.mock || '').trim() === '1';
    const raw = forceMock ? null : ((await storage.getState('socialEngagementSnapshots')) || []);

    let mode = 'mock_fallback';
    let rows = [];

    if (!forceMock && Array.isArray(raw) && raw.length > 0) {
      rows = raw.map(normalizeSnapshot).filter(Boolean);
      mode = rows.length > 0 ? 'real' : 'mock_fallback';
    }

    if (forceMock || rows.length === 0) {
      rows = buildMockSnapshots(fromDate, toDate).map(normalizeSnapshot).filter(Boolean);
      mode = forceMock ? 'mock_forced' : 'mock_fallback';
    }

    const engagementMeta = (await storage.getState('socialEngagementMeta')) || {};
    const lastPulledAt = (engagementMeta && typeof engagementMeta.lastPulledAt === 'string' && !Number.isNaN(Date.parse(engagementMeta.lastPulledAt)))
      ? engagementMeta.lastPulledAt
      : null;

    rows = rows
      .filter((r) => {
        const ts = Date.parse(r.captured_at || '');
        if (Number.isNaN(ts)) return false;
        if (ts < fromMs || ts > toMs) return false;
        if (platform && r.post_platform !== platform) return false;
        if (actionId && r.action_id !== actionId) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.captured_at || '') - Date.parse(a.captured_at || ''));

    const actions = (await storage.getState('actions')) || [];
    const actionTextMap = {};
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a && a.id && a.payload && a.payload.text) actionTextMap[a.id] = String(a.payload.text).slice(0, 140);
    }

    const agg = aggregateEngagement(rows, actionTextMap, offset, limit, Date.now());

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        summary: agg.summary,
        topPosts: agg.topPosts,
        engagementSplit: agg.engagementSplit,
        trends: agg.trends,
        rows: agg.rows,
        nextCursor: agg.nextCursor,
        meta: { mode: mode, lastPulledAt: lastPulledAt }
      }
    };
  } catch (err) {
    context.log.error('[social-engagement] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to load social engagement', details: err && err.message ? err.message : String(err) }
    };
  }
};
