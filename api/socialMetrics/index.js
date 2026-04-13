const storage = require('../_utils/companyStorage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

const PLATFORMS = ['x', 'linkedin', 'bluesky'];
const EVENT_TYPES = ['approval', 'execution', 'retry'];
const RESULTS = ['success', 'failure'];
const ERROR_CLASSES = ['AUTH', 'RATE_LIMIT', 'PAYLOAD', 'MEDIA', 'NETWORK', 'UNKNOWN'];

// Canonical telemetry schema (definition + validator only; writes are out of scope in Phase 1)
const SOCIAL_METRICS_EVENT_SHAPE = {
  id: 'string',
  action_id: 'string',
  trace_id: 'string',
  attempt: 'number',
  platform: 'enum:x|linkedin|bluesky',
  event_type: 'enum:approval|execution|retry',
  result: 'enum:success|failure',
  error_class: 'enum:AUTH|RATE_LIMIT|PAYLOAD|MEDIA|NETWORK|UNKNOWN',
  error_code: 'string',
  error_message: 'string',
  created_at: 'iso-utc',
  executed_at: 'iso-utc',
  latency_ms: 'number',
  post_url: 'string',
  agent_id: 'string',
  campaign_id: 'string?',
  source_type: 'string?',
  source_id: 'string?'
};

function isIsoLike(value) {
  if (!value || typeof value !== 'string') return false;
  const t = Date.parse(value);
  return !Number.isNaN(t);
}

function parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(n, 100);
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
  const v = String(value || '').trim().toLowerCase();
  return PLATFORMS.indexOf(v) !== -1 ? v : '';
}

function normalizeResult(value) {
  const v = String(value || '').trim().toLowerCase();
  return RESULTS.indexOf(v) !== -1 ? v : '';
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

function getEventTimestamp(event) {
  const iso = event.executed_at || event.created_at;
  const ts = Date.parse(iso || '');
  return Number.isNaN(ts) ? null : ts;
}

function validateEventShape(event) {
  if (!event || typeof event !== 'object') return false;
  if (!event.id || typeof event.id !== 'string') return false;
  if (!event.action_id || typeof event.action_id !== 'string') return false;
  if (!event.trace_id || typeof event.trace_id !== 'string') return false;
  if (!Number.isFinite(event.attempt)) return false;
  if (PLATFORMS.indexOf(event.platform) === -1) return false;
  if (EVENT_TYPES.indexOf(event.event_type) === -1) return false;
  if (RESULTS.indexOf(event.result) === -1) return false;
  if (ERROR_CLASSES.indexOf(event.error_class) === -1) return false;
  if (!isIsoLike(event.created_at)) return false;
  if (event.executed_at && !isIsoLike(event.executed_at)) return false;
  if (event.latency_ms !== undefined && event.latency_ms !== null && !Number.isFinite(event.latency_ms)) return false;
  return true;
}

function buildDeterministicMockEvents(fromDate, toDate) {
  const events = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
  const end = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));
  const days = Math.max(1, Math.min(31, Math.floor((end.getTime() - start.getTime()) / dayMs) + 1));

  for (let d = 0; d < days; d++) {
    const dayTs = start.getTime() + (d * dayMs);
    for (let p = 0; p < PLATFORMS.length; p++) {
      const platform = PLATFORMS[p];
      const successCount = ((d + p) % 3) + 1;
      const failureCount = (d + p) % 4 === 0 ? 1 : 0;

      for (let s = 0; s < successCount; s++) {
        const ts = new Date(dayTs + (9 + s + p) * 60 * 60 * 1000).toISOString();
        const actionId = 'mock_act_' + d + '_' + p + '_s_' + s;
        events.push({
          id: 'sm_mock_' + d + '_' + p + '_s_' + s,
          action_id: actionId,
          trace_id: 'trace_mock_' + d + '_' + p + '_' + s,
          attempt: 1,
          platform: platform,
          event_type: 'execution',
          result: 'success',
          error_class: 'UNKNOWN',
          error_code: '',
          error_message: '',
          created_at: ts,
          executed_at: ts,
          latency_ms: 1200 + (d * 37) + (p * 53),
          post_url: platform === 'bluesky'
            ? 'https://bsky.app/profile/ambientpixels.bsky.social/post/mock' + d + p + s
            : platform === 'linkedin'
              ? 'https://www.linkedin.com/feed/update/mock' + d + p + s
              : 'https://x.com/AIAmbientPixels/status/mock' + d + p + s,
          agent_id: 'echo',
          campaign_id: d % 2 === 0 ? 'camp_mock_weekly' : null,
          source_type: 'blog',
          source_id: 'doc_mock_' + d
        });
      }

      for (let f = 0; f < failureCount; f++) {
        const ts = new Date(dayTs + (14 + p) * 60 * 60 * 1000).toISOString();
        events.push({
          id: 'sm_mock_' + d + '_' + p + '_f_' + f,
          action_id: 'mock_act_' + d + '_' + p + '_f_' + f,
          trace_id: 'trace_mock_fail_' + d + '_' + p,
          attempt: 1,
          platform: platform,
          event_type: 'execution',
          result: 'failure',
          error_class: p === 0 ? 'RATE_LIMIT' : p === 1 ? 'PAYLOAD' : 'NETWORK',
          error_code: p === 0 ? '429' : p === 1 ? 'CONTENT_TOO_LONG' : 'TIMEOUT',
          error_message: p === 0 ? 'Rate limited by platform API' : p === 1 ? 'Content validation failed' : 'Network timeout',
          created_at: ts,
          executed_at: ts,
          latency_ms: 3000 + (d * 31),
          post_url: '',
          agent_id: 'echo',
          campaign_id: 'camp_mock_weekly',
          source_type: 'blog',
          source_id: 'doc_mock_' + d
        });
      }
    }
  }

  return events;
}

function aggregateSocialMetrics(events, options) {
  const fromMs = options.fromDate.getTime();
  const toMs = options.toDate.getTime();
  const nowTs = options.nowTs || Date.now();
  const todayUtc = toIsoDayUTC(new Date(nowTs));

  const dailyMap = {};
  const hourly = [];
  for (let i = 0; i < 24; i++) {
    hourly.push({ hour: String(i).padStart(2, '0'), published: 0, failed: 0 });
  }

  const platformSplit = {
    x: { published: 0, failed: 0 },
    linkedin: { published: 0, failed: 0 },
    bluesky: { published: 0, failed: 0 }
  };

  const withTs = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const ts = getEventTimestamp(ev);
    if (ts === null) continue;
    if (ts < fromMs || ts > toMs) continue;
    if (options.platform && ev.platform !== options.platform) continue;
    if (options.result && ev.result !== options.result) continue;
    if (options.campaign && ev.campaign_id !== options.campaign) continue;
    withTs.push({ ev: ev, ts: ts });
  }

  withTs.sort(function (a, b) { return b.ts - a.ts; });

  let published = 0;
  let failed = 0;
  let publishedToday = 0;
  let failures24h = 0;
  let latencyTotal = 0;
  let latencyCount = 0;
  const failClassCount24h = {};
  const failClassLatest24h = {};

  for (let i = 0; i < withTs.length; i++) {
    const item = withTs[i];
    const ev = item.ev;

    if (ev.event_type === 'execution' || ev.event_type === 'retry') {
      if (ev.result === 'success') {
        published++;
        platformSplit[ev.platform].published++;
        if (toIsoDayUTC(new Date(item.ts)) === todayUtc) publishedToday++;
      } else if (ev.result === 'failure') {
        failed++;
        platformSplit[ev.platform].failed++;
        if ((nowTs - item.ts) <= (24 * 60 * 60 * 1000)) {
          failures24h++;
          var failClass = ev.error_class || 'UNKNOWN';
          failClassCount24h[failClass] = (failClassCount24h[failClass] || 0) + 1;
          failClassLatest24h[failClass] = Math.max(failClassLatest24h[failClass] || 0, item.ts);
        }
      }

      if (Number.isFinite(ev.latency_ms) && ev.latency_ms > 0) {
        latencyTotal += ev.latency_ms;
        latencyCount++;
      }

      const dt = new Date(item.ts);
      const day = toIsoDayUTC(dt);
      if (!dailyMap[day]) dailyMap[day] = { date: day, published: 0, failed: 0 };
      if (ev.result === 'success') dailyMap[day].published++;
      if (ev.result === 'failure') dailyMap[day].failed++;

      const hour = dt.getUTCHours();
      if (ev.result === 'success') hourly[hour].published++;
      if (ev.result === 'failure') hourly[hour].failed++;
    }
  }

  const totalExec = published + failed;
  const successRate = totalExec > 0 ? Math.round((published / totalExec) * 1000) / 10 : 0;
  const avgLatency = latencyCount > 0 ? Math.round(latencyTotal / latencyCount) : 0;

  let topIssue = null;
  const failClasses = Object.keys(failClassCount24h);
  if (failClasses.length > 0) {
    failClasses.sort(function (a, b) {
      if (failClassCount24h[b] !== failClassCount24h[a]) return failClassCount24h[b] - failClassCount24h[a];
      return (failClassLatest24h[b] || 0) - (failClassLatest24h[a] || 0);
    });
    const topClass = failClasses[0];
    topIssue = {
      error_class: topClass,
      count: failClassCount24h[topClass],
      last_occurrence: new Date(failClassLatest24h[topClass]).toISOString()
    };
  }

  let failStreak = 0;
  for (let i = 0; i < withTs.length; i++) {
    const ev = withTs[i].ev;
    if (ev.event_type !== 'execution' && ev.event_type !== 'retry') continue;
    if (ev.result === 'failure') failStreak++;
    else if (ev.result === 'success') break;
  }

  const recentFailures = withTs
    .filter(function (item) {
      const ev = item.ev;
      return (ev.event_type === 'execution' || ev.event_type === 'retry') && ev.result === 'failure';
    })
    .slice(0, 10)
    .map(function (item) {
      return {
        id: item.ev.id,
        action_id: item.ev.action_id,
        platform: item.ev.platform,
        error_class: item.ev.error_class || 'UNKNOWN',
        error_code: item.ev.error_code || '',
        error_message: item.ev.error_message || '',
        timestamp: new Date(item.ts).toISOString(),
        attempt: item.ev.attempt || 1
      };
    });

  const postsAll = withTs
    .filter(function (item) {
      const ev = item.ev;
      return ev.event_type === 'execution' || ev.event_type === 'retry';
    })
    .map(function (item) {
      return {
        id: item.ev.id,
        action_id: item.ev.action_id,
        platform: item.ev.platform,
        result: item.ev.result,
        timestamp: new Date(item.ts).toISOString(),
        attempt: item.ev.attempt || 1,
        error_class: item.ev.error_class || 'UNKNOWN',
        post_url: item.ev.post_url || '',
        campaign_id: item.ev.campaign_id || ''
      };
    });

  const offset = options.offset;
  const limit = options.limit;
  const recentPosts = postsAll.slice(offset, offset + limit);
  const nextCursor = (offset + limit) < postsAll.length ? encodeCursor(offset + limit) : null;

  const daily = Object.keys(dailyMap)
    .sort()
    .map(function (k) { return dailyMap[k]; });

  return {
    summary: {
      published: published,
      failed: failed,
      successRate: successRate,
      avgLatency: avgLatency,
      failStreak: failStreak,
      pendingApprovals: 0,
      publishedToday: publishedToday,
      failures24h: failures24h,
      topIssue: topIssue
    },
    trends: {
      daily: daily,
      hourly: hourly
    },
    platformSplit: platformSplit,
    recentFailures: recentFailures,
    recentPosts: recentPosts,
    nextCursor: nextCursor,
    _allPostRows: postsAll
  };
}

function isSocialType(type) {
  return typeof type === 'string' && type.indexOf('social_post') === 0;
}

async function countPendingSocialApprovals() {
  const queue = (await storage.getState('approvalQueue')) || [];
  const actions = (await storage.getState('actions')) || [];
  const actionMap = {};
  for (let i = 0; i < actions.length; i++) actionMap[actions[i].id] = actions[i];

  let count = 0;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i] || {};
    if (item.status && item.status !== 'pending') continue;

    let social = false;
    if (isSocialType(item.actionType) || isSocialType(item.type)) social = true;
    if (!social && item.action_id && actionMap[item.action_id]) {
      const a = actionMap[item.action_id];
      const t = a.type || a.action_type || '';
      if (isSocialType(t)) social = true;
    }

    if (social) count++;
  }

  return count;
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
    const clientPrincipal = (req.headers && req.headers['x-ms-client-principal']) || '';
    if (!storage.validateSecret(secret) && !clientPrincipal) {
      context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
      return;
    }
  }

  try {
    const q = req.query || {};
    const limit = parseLimit(q.limit);
    const offset = parseCursor(q.cursor);
    const platform = normalizePlatform(q.platform || '');
    const result = normalizeResult(q.result || '');
    const campaign = (q.campaign || '').trim();

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const fromDate = parseDateOr(defaultFrom, q.from);
    const toDate = parseDateOr(now, q.to);

    // Demo mode: use deterministic mock events
    let events, mode;
    if (process.env.DEMO_MODE === 'true') {
      events = buildDeterministicMockEvents(fromDate, toDate);
      mode = 'demo';
    } else {
      // Phase 5: read from socialIntel.metricsEvents
      var _siMetrics = (await storage.getState('socialIntel')) || {};
      const rawEvents = _siMetrics.metricsEvents || [];
      events = Array.isArray(rawEvents) ? rawEvents.filter(validateEventShape) : [];
      mode = 'real';
    }

    const aggregated = aggregateSocialMetrics(events, {
      fromDate: fromDate,
      toDate: toDate,
      platform: platform,
      result: result,
      campaign: campaign || '',
      limit: limit,
      offset: offset,
      nowTs: Date.now()
    });

    aggregated.summary.pendingApprovals = await countPendingSocialApprovals();

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        summary: aggregated.summary,
        trends: aggregated.trends,
        platformSplit: aggregated.platformSplit,
        recentFailures: aggregated.recentFailures,
        recentPosts: aggregated.recentPosts,
        nextCursor: aggregated.nextCursor,
        meta: {
          mode: mode
        }
      }
    };
  } catch (err) {
    context.log.error('[social-metrics] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to load social metrics', details: err && err.message ? err.message : String(err) }
    };
  }
};
