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
    // Stamped by socialEngagementPull so a post keeps its words after the
    // `actions` store has rolled past it. Absent on rows captured before that.
    post_text: typeof s.post_text === 'string' ? s.post_text : '',
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

const DAY_MS = 24 * 60 * 60 * 1000;
const METRIC_FIELDS = ['likes', 'comments', 'reposts'];

function postKeyOf(r) {
  return r.post_platform + '|' + (r.post_id || r.post_url || r.action_id);
}

function dayOffsetUTC(nowTs, daysBack) {
  return toIsoDayUTC(new Date(nowTs - (daysBack * DAY_MS)));
}

/**
 * Fold every snapshot of one post into what it EARNED, per day.
 *
 * A snapshot's metrics are the post's CUMULATIVE lifetime counts at the moment
 * we polled — not the engagement it gained since the last poll. The old
 * aggregate summed every row in the window, so a post polled ~22 times a week
 * contributed its lifetime likes 22 times over. Production read 374 likes and
 * 368 comments for a week in which the 155 posts involved held 17 and 17
 * between them, lifetime. That number measured the cron schedule.
 *
 * Engagement earned in a period is the INCREASE in the cumulative count across
 * it, so each rise is attributed to the day of the later sample.
 */
function foldPost(series) {
  const daily = {};
  const lifetime = { likes: null, comments: null, reposts: null };
  let firstSeenMs = null;

  for (let i = 0; i < series.length; i++) {
    const r = series[i];
    const ts = Date.parse(r.captured_at || '');
    if (Number.isNaN(ts)) continue;
    if (firstSeenMs === null) firstSeenMs = ts;
    const day = toIsoDayUTC(new Date(ts));

    for (let f = 0; f < METRIC_FIELDS.length; f++) {
      const field = METRIC_FIELDS[f];
      const n = r.metrics[field];
      // A failed pull stores null, which is "we do not know", not "zero". Reading
      // it as 0 would book a fake collapse and then a fake recovery next poll.
      if (!Number.isFinite(n)) continue;

      const prev = lifetime[field];
      // First real observation: whatever the post had by then was earned by
      // then. After that, only the rise counts.
      const inc = prev === null ? n : n - prev;
      lifetime[field] = n;

      // A fall means an unlike, a deleted post, or an API answering zeros. None
      // of those is negative engagement, and unclamped a deletion carves a
      // crater into the chart that reads as a bad week.
      if (inc > 0) {
        if (!daily[day]) daily[day] = { likes: 0, comments: 0, reposts: 0 };
        daily[day][field] += inc;
      }
    }
  }

  return {
    daily: daily,
    lifetime: {
      likes: lifetime.likes === null ? null : lifetime.likes,
      comments: lifetime.comments === null ? null : lifetime.comments,
      reposts: lifetime.reposts === null ? null : lifetime.reposts
    },
    firstSeenMs: firstSeenMs
  };
}

function aggregateEngagement(rowsAll, rowsWindow, meta, offset, limit, nowTs) {
  meta = meta || {};
  const actionTextMap = meta.actionTextMap || {};
  const publishedAtByAction = meta.publishedAtByAction || {};

  // Group every snapshot by post, oldest first — deltas need time order, and
  // they need samples from BEFORE the reporting window or the first in-window
  // reading looks like it was all earned that day.
  const byPost = {};
  for (let i = 0; i < rowsAll.length; i++) {
    const r = rowsAll[i];
    const k = postKeyOf(r);
    if (!byPost[k]) byPost[k] = [];
    byPost[k].push(r);
  }
  const keys = Object.keys(byPost);
  keys.forEach((k) => byPost[k].sort((a, b) => Date.parse(a.captured_at || '') - Date.parse(b.captured_at || '')));

  const dayMap = {};
  const splitDayMap = { x: {}, linkedin: {}, bluesky: {} };
  const posts = [];

  for (let i = 0; i < keys.length; i++) {
    const series = byPost[keys[i]];
    const head = series[series.length - 1];
    const folded = foldPost(series);

    Object.keys(folded.daily).forEach((day) => {
      if (!dayMap[day]) dayMap[day] = { date: day, likes: 0, comments: 0, reposts: 0 };
      dayMap[day].likes += folded.daily[day].likes;
      dayMap[day].comments += folded.daily[day].comments;
      dayMap[day].reposts += folded.daily[day].reposts;

      const split = splitDayMap[head.post_platform];
      if (split) {
        if (!split[day]) split[day] = { likes: 0, comments: 0, reposts: 0 };
        split[day].likes += folded.daily[day].likes;
        split[day].comments += folded.daily[day].comments;
        split[day].reposts += folded.daily[day].reposts;
      }
    });

    // When the post went out, not when we last looked at it. "Top post this
    // week" used to filter on captured_at, so a July post re-polled on Tuesday
    // was this week's winner.
    const publishedAt = publishedAtByAction[head.action_id] || null;
    const publishedMs = publishedAt ? Date.parse(publishedAt) : folded.firstSeenMs;

    posts.push({
      platform: head.post_platform,
      action_id: head.action_id,
      // Stamped on the snapshot at capture time (durable), with the live action
      // as the fallback for posts captured before that shipped.
      text_preview: head.post_text || actionTextMap[head.action_id] || '',
      likes: folded.lifetime.likes,
      comments: folded.lifetime.comments,
      reposts: folded.lifetime.reposts,
      link: head.post_url || '',
      published_at: publishedAt || (folded.firstSeenMs ? new Date(folded.firstSeenMs).toISOString() : null),
      published_at_is_estimate: !publishedAt,
      publishedMs: Number.isFinite(publishedMs) ? publishedMs : null,
      daily: folded.daily
    });
  }

  // Calendar days, so the summary and the chart cannot disagree.
  const from7 = dayOffsetUTC(nowTs, 6);
  const from14 = dayOffsetUTC(nowTs, 13);
  const sumDays = (map, fromDay, toDay) => {
    const out = { likes: 0, comments: 0, reposts: 0 };
    Object.keys(map).forEach((d) => {
      if (d < fromDay || (toDay && d > toDay)) return;
      out.likes += map[d].likes || 0;
      out.comments += map[d].comments || 0;
      out.reposts += map[d].reposts || 0;
    });
    return out;
  };

  const earned7 = sumDays(dayMap, from7, null);
  const earnedPrev7 = sumDays(dayMap, from14, dayOffsetUTC(nowTs, 7));

  const published7 = posts.filter((p) => p.publishedMs !== null && p.publishedMs >= (nowTs - 7 * DAY_MS));
  const engaged7 = published7.filter((p) => (p.likes || 0) + (p.comments || 0) + (p.reposts || 0) > 0);

  const topPosts = published7
    .slice()
    .sort((a, b) => {
      const be = (b.likes || 0) + (b.comments || 0) + (b.reposts || 0);
      const ae = (a.likes || 0) + (a.comments || 0) + (a.reposts || 0);
      if (be !== ae) return be - ae;
      return (b.publishedMs || 0) - (a.publishedMs || 0);
    })
    .slice(0, 25)
    .map((p) => ({
      platform: p.platform,
      action_id: p.action_id,
      text_preview: p.text_preview,
      likes: p.likes,
      comments: p.comments,
      reposts: p.reposts,
      link: p.link,
      published_at: p.published_at,
      published_at_is_estimate: p.published_at_is_estimate
    }));

  const engagementSplit = {
    x: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
    linkedin: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
    bluesky: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 }
  };
  Object.keys(engagementSplit).forEach((p) => {
    const s = sumDays(splitDayMap[p], from7, null);
    engagementSplit[p].likes7d = s.likes;
    engagementSplit[p].comments7d = s.comments;
    engagementSplit[p].reposts7d = s.reposts;
  });
  published7.forEach((p) => {
    if (engagementSplit[p.platform]) engagementSplit[p.platform].posts7d += 1;
  });

  const rowsPaged = rowsWindow.slice(offset, offset + limit);
  const nextCursor = (offset + limit) < rowsWindow.length ? encodeCursor(offset + limit) : null;

  const allDays = Object.keys(dayMap).sort();
  const last30 = allDays.slice(-30).map((d) => dayMap[d]);
  const last7 = allDays.filter((d) => d >= from7).map((d) => dayMap[d]);

  return {
    summary: {
      likes7d: earned7.likes,
      comments7d: earned7.comments,
      reposts7d: earned7.reposts,
      likesDelta7d: earned7.likes - earnedPrev7.likes,
      // Everything above is engagement EARNED in the last 7 calendar days, not
      // the lifetime totals of posts we happened to poll. Named so a future
      // reader cannot mistake one for the other again.
      basis: 'earned',
      postsPublished7d: published7.length,
      postsEngaged7d: engaged7.length,
      zeroEngagementRate7d: published7.length
        ? Math.round(((published7.length - engaged7.length) / published7.length) * 100)
        : null
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

  // Demo mode: skip auth
  if (process.env.DEMO_MODE !== 'true') {
    const secret = (req.headers && req.headers['x-company-secret']) || '';
    const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
    if (!storage.validateSecret(secret) && !principal) {
      context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
      return;
    }
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

    // Demo mode: use mock snapshots
    let rows, mode;
    if (process.env.DEMO_MODE === 'true') {
      rows = buildMockSnapshots(fromDate, toDate).map(normalizeSnapshot).filter(Boolean);
      mode = 'demo';
    } else {
      const raw = (await storage.getState('socialEngagementSnapshots')) || [];
      rows = Array.isArray(raw) ? raw.map(normalizeSnapshot).filter(Boolean) : [];
      mode = 'real';
    }

    const engagementMeta = (await storage.getState('socialEngagementMeta')) || {};
    const lastPulledAt = (engagementMeta && typeof engagementMeta.lastPulledAt === 'string' && !Number.isNaN(Date.parse(engagementMeta.lastPulledAt)))
      ? engagementMeta.lastPulledAt
      : null;

    // Two views of the same store. The aggregates need EVERY snapshot of a post,
    // including ones older than the requested range: engagement earned in a week
    // is the rise across it, and a rise cannot be measured from inside the window
    // alone — the first in-window reading would look like it was all earned that
    // day. The paginated `rows` list stays scoped to from/to as before.
    const subjectRows = rows
      .filter((r) => {
        if (platform && r.post_platform !== platform) return false;
        if (actionId && r.action_id !== actionId) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.captured_at || '') - Date.parse(a.captured_at || ''));

    const windowRows = subjectRows.filter((r) => {
      const ts = Date.parse(r.captured_at || '');
      return !Number.isNaN(ts) && ts >= fromMs && ts <= toMs;
    });

    const actions = (await storage.getState('actions')) || [];
    const actionTextMap = {};
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a && a.id && a.payload && a.payload.text) actionTextMap[a.id] = String(a.payload.text).slice(0, 280);
    }

    // True publish times. socialMetricsEvents keeps months of execution records
    // while `actions` is trimmed to about a week, so this is the one place that
    // still knows when an older post actually went out.
    const metricEvents = (await storage.getState('socialMetricsEvents')) || [];
    const publishedAtByAction = {};
    for (let i = 0; i < metricEvents.length; i++) {
      const e = metricEvents[i];
      if (!e || e.event_type !== 'execution' || e.result !== 'success' || !e.action_id) continue;
      const at = e.executed_at || e.created_at;
      if (!at || Number.isNaN(Date.parse(at))) continue;
      const prior = publishedAtByAction[e.action_id];
      if (!prior || Date.parse(at) < Date.parse(prior)) publishedAtByAction[e.action_id] = at;
    }

    const agg = aggregateEngagement(
      subjectRows,
      windowRows,
      { actionTextMap: actionTextMap, publishedAtByAction: publishedAtByAction },
      offset,
      limit,
      Date.now()
    );

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

// Exported for tests. The aggregate is a pure function of snapshots + metadata,
// which is the whole reason the 22x inflation was assertable at all.
module.exports._aggregateEngagement = aggregateEngagement;
module.exports._normalizeSnapshot = normalizeSnapshot;
module.exports._foldPost = foldPost;
