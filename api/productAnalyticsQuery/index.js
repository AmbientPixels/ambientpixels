// productAnalyticsQuery — Aggregation API for product analytics events
// GET /api/product-analytics-query?range=7d&product=all&metric=dau
// Reads daily-sharded blobs, computes metrics, caches 10 min.

const pa = require('../_utils/productAnalytics');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

const VALID_PRODUCTS = ['all', 'pixelagents', 'agentforge', 'ambientscore', 'blindspot', 'cardforge', 'storyforge', 'tileforge', 'blog', 'nova', 'dashboard'];
const VALID_METRICS = ['overview', 'dau', 'funnels', 'events', 'products'];

// In-memory cache: key → { data, ts }
var _cache = {};
var CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cacheKey(range, product, metric) {
  return range + ':' + product + ':' + metric;
}

function parseDays(range) {
  if (!range) return 7;
  var n = parseInt(range, 10);
  if (range.endsWith('d') && n > 0 && n <= 90) return n;
  return 7;
}

function dateRange(days) {
  var end = new Date();
  var start = new Date(end.getTime() - days * 86400000);
  return {
    startDate: start.toISOString().substring(0, 10),
    endDate: end.toISOString().substring(0, 10)
  };
}

// Funnel definitions per product
var FUNNELS = {
  ambientscore: ['page_view', 'scan_started', 'scan_completed', 'checkout_started', 'report_unlocked'],
  blindspot: ['page_view', 'card_created', 'battle_end', 'boss_defeated'],
  cardforge: ['page_view', 'quickbuild_completed', 'arena_battle_end'],
  storyforge: ['page_view', 'adventure_started'],
  blog: ['page_view', 'post_viewed'],
  pixelagents: ['page_view', 'agent_run_started', 'agent_run_completed', 'checkout_initiated'],
  agentforge: ['page_view', 'agent_submitted']
};

// ── Metric Computers ──

function computeOverview(events, product) {
  var filtered = product === 'all' ? events : events.filter(function (e) { return e.product === product; });
  var usersByDay = {};
  var totalByProduct = {};

  filtered.forEach(function (e) {
    var day = (e.ts || '').substring(0, 10);
    if (!usersByDay[day]) usersByDay[day] = new Set();
    if (e.userId) usersByDay[day].add(e.userId);

    if (!totalByProduct[e.product]) totalByProduct[e.product] = 0;
    totalByProduct[e.product]++;
  });

  var days = Object.keys(usersByDay).sort();
  var daily = days.map(function (d) {
    return { day: d, dau: usersByDay[d].size };
  });

  // Unique users across entire range
  var allUsers = new Set();
  filtered.forEach(function (e) { if (e.userId) allUsers.add(e.userId); });

  return {
    totalEvents: filtered.length,
    uniqueUsers: allUsers.size,
    daily: daily,
    byProduct: totalByProduct
  };
}

function computeDAU(events, product) {
  var filtered = product === 'all' ? events : events.filter(function (e) { return e.product === product; });
  var usersByDay = {};
  filtered.forEach(function (e) {
    var day = (e.ts || '').substring(0, 10);
    if (!usersByDay[day]) usersByDay[day] = new Set();
    if (e.userId) usersByDay[day].add(e.userId);
  });

  var days = Object.keys(usersByDay).sort();
  return days.map(function (d) {
    return { day: d, dau: usersByDay[d].size };
  });
}

function computeFunnels(events, product) {
  var products = product === 'all' ? Object.keys(FUNNELS) : [product];
  var result = {};

  products.forEach(function (p) {
    var steps = FUNNELS[p];
    if (!steps) return;

    var prodEvents = events.filter(function (e) { return e.product === p; });
    var funnelData = steps.map(function (step) {
      var usersAtStep = new Set();
      prodEvents.forEach(function (e) {
        if (e.event === step && e.userId) usersAtStep.add(e.userId);
      });
      return { step: step, users: usersAtStep.size };
    });

    result[p] = funnelData;
  });

  return result;
}

function computeEvents(events, product) {
  var filtered = product === 'all' ? events : events.filter(function (e) { return e.product === product; });
  var counts = {};
  filtered.forEach(function (e) {
    var key = e.product + ':' + e.event;
    if (!counts[key]) counts[key] = { product: e.product, event: e.event, count: 0 };
    counts[key].count++;
  });

  var sorted = Object.values(counts).sort(function (a, b) { return b.count - a.count; });
  return sorted.slice(0, 50);
}

function computeProducts(events) {
  var byProduct = {};
  events.forEach(function (e) {
    if (!byProduct[e.product]) byProduct[e.product] = { product: e.product, events: 0, users: new Set(), sessions: new Set() };
    byProduct[e.product].events++;
    if (e.userId) byProduct[e.product].users.add(e.userId);
    if (e.sessionId) byProduct[e.product].sessions.add(e.sessionId);
  });

  return Object.values(byProduct).map(function (p) {
    return { product: p.product, events: p.events, users: p.users.size, sessions: p.sessions.size };
  }).sort(function (a, b) { return b.users - a.users; });
}

// ── Main Handler ──

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    var range = req.query.range || '7d';
    var product = req.query.product || 'all';
    var metric = req.query.metric || 'overview';

    if (VALID_PRODUCTS.indexOf(product) === -1) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid product. Valid: ' + VALID_PRODUCTS.join(', ') } };
      return;
    }
    if (VALID_METRICS.indexOf(metric) === -1) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid metric. Valid: ' + VALID_METRICS.join(', ') } };
      return;
    }

    // Check cache
    var ck = cacheKey(range, product, metric);
    var cached = _cache[ck];
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      context.res = { status: 200, headers: CORS_HEADERS, body: cached.data };
      return;
    }

    // Load events for date range
    var days = parseDays(range);
    var dr = dateRange(days);
    var events = await pa.readEventRange(dr.startDate, dr.endDate);

    var result;
    switch (metric) {
      case 'overview': result = computeOverview(events, product); break;
      case 'dau': result = computeDAU(events, product); break;
      case 'funnels': result = computeFunnels(events, product); break;
      case 'events': result = computeEvents(events, product); break;
      case 'products': result = computeProducts(events); break;
      default: result = computeOverview(events, product);
    }

    var response = {
      range: range,
      product: product,
      metric: metric,
      generatedAt: new Date().toISOString(),
      data: result
    };

    // Cache result
    _cache[ck] = { data: response, ts: Date.now() };

    context.res = { status: 200, headers: CORS_HEADERS, body: response };
  } catch (err) {
    context.log.error('[ProductAnalyticsQuery] Error:', err.message);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Query failed', message: err.message } };
  }
};
