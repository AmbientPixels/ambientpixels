// telemetrySummary — GET /api/telemetry/summary?range=7d|30d|1d
// Queries Azure Application Insights via the Log Analytics REST API (Kusto).
// Returns aggregated, PII-free traffic summary for Scout and the Traffic Brief card.
// Fails gracefully with { warning: "telemetry_unavailable" } if env/query fails.

const fetch = require('node-fetch');

const APP_ID = process.env.APPINSIGHTS_APP_ID || '';
const API_KEY = process.env.APPINSIGHTS_API_KEY || '';

const RANGE_MAP = { '1d': 'P1D', '7d': 'P7D', '30d': 'P30D' };
const VALID_RANGES = ['1d', '7d', '30d'];
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];

// Override App Insights' recorded page titles for known paths.
// Why: pageView events are recorded with whatever document.title was set
// at the moment, and several pages set document.title via JS in a way that
// leaks across navigations. Clicking the AmbientPixels logo back to "/"
// after visiting /blog records the homepage URL with the blog's title,
// so the dashboard ends up labeling 124 home views as "Blog — AmbientPixels".
// This map overrides the recorded title for known stable paths. Unmapped
// paths fall through to whatever App Insights recorded.
// Add new entries as paths get added — keys are post-cleaning paths
// (no trailing slash, no /index.html, lowercase).
const PAGE_TITLE_OVERRIDES = {
  '/': 'Home',
  '/blog': 'Blog',
  '/pixel-agents': 'Pixel Agents',
  '/blindspot': 'Blindspot',
  '/cardforge': 'CardForge',
  '/storyforge': 'StoryForge',
  '/agent-forge': 'Agent Forge',
  '/ambientscore': 'AmbientScore',
  '/projects': 'Projects',
  '/support': 'Support',
  '/nova': 'Nova',
  '/pixel-agents/analytics.html': 'Pixel Agents — Activity',
  '/pixel-agents/contact.html': 'Pixel Agents — Contact',
  '/pixel-agents/docs.html': 'Pixel Agents — Docs',
  '/pixel-agents/faq.html': 'Pixel Agents — FAQ',
  '/pixel-agents/run.html': 'Pixel Agents — Run',
  '/pixel-agents/changelog.html': 'Pixel Agents — Changelog'
};

// 10-minute in-memory cache per range
var _cache = { '1d': { ts: 0, data: null }, '7d': { ts: 0, data: null }, '30d': { ts: 0, data: null } };
var CACHE_TTL_MS = 10 * 60 * 1000;

function _rangeLabel(range) {
  var now = new Date();
  var days = range === '1d' ? 1 : range === '30d' ? 30 : 7;
  var start = new Date(now.getTime() - days * 86400000);
  return start.toISOString().slice(0, 10) + ' to ' + now.toISOString().slice(0, 10);
}

function _emptyResponse(range, warning) {
  return {
    range: range,
    rangeLabel: _rangeLabel(range),
    generatedAt: new Date().toISOString(),
    warning: warning || null,
    topPages: [],
    topReferrers: [],
    topCampaigns: [],
    dailyViews: [],
    events: { ctaClicks: 0, requestAccessClicks: 0 },
    performance: { pageLoadMs_p50: 0, pageLoadMs_p95: 0 },
    errors: []
  };
}

var _lastQueryErrors = [];
async function _kustoQuery(query, timespan, logger) {
  if (!APP_ID || !API_KEY) return null;
  var url = 'https://api.applicationinsights.io/v1/apps/' + APP_ID + '/query';
  try {
    var resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify({ query: query, timespan: timespan })
    });
    if (!resp.ok) {
      var errBody = '';
      try { errBody = await resp.text(); } catch (_) {}
      if (logger) logger('[telemetrySummary] Kusto query failed:', resp.status, errBody.substring(0, 300));
      _lastQueryErrors.push({ query: query.substring(0, 80), status: resp.status, error: errBody.substring(0, 500) });
      return null;
    }
    var data = await resp.json();
    return data;
  } catch (e) {
    _lastQueryErrors.push({ query: query.substring(0, 80), error: e.message });
    return null;
  }
}

function _parseRows(result, tableIdx) {
  if (!result || !result.tables || !result.tables[tableIdx || 0]) return [];
  var table = result.tables[tableIdx || 0];
  var cols = (table.columns || []).map(function (c) { return c.name; });
  return (table.rows || []).map(function (row) {
    var obj = {};
    cols.forEach(function (name, i) { obj[name] = row[i]; });
    return obj;
  });
}

module.exports = async function (context, req) {
  var RES_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-AmbientOS-Key' } };
    return;
  }

  var range = (req.query && req.query.range) || '7d';
  if (VALID_RANGES.indexOf(range) === -1) range = '7d';
  var timespan = RANGE_MAP[range];

  // Light access guard: internal dashboard vs public
  var ambientosKey = process.env.AMBIENTOS_INTERNAL_KEY || process.env.AMBIENTCORE_INTERNAL_KEY || '';
  var reqKey = (req.headers && req.headers['x-ambientos-key']) || '';
  var isInternal = ambientosKey && reqKey === ambientosKey;

  if (!APP_ID || !API_KEY) {
    context.res = {
      status: 200,
      headers: RES_HEADERS,
      body: _emptyResponse(range, 'telemetry_unavailable: APPINSIGHTS_APP_ID or APPINSIGHTS_API_KEY not configured')
    };
    return;
  }

  // Check cache
  if (_cache[range] && _cache[range].data && (Date.now() - _cache[range].ts < CACHE_TTL_MS)) {
    var cached = _cache[range].data;
    context.res = { status: 200, headers: RES_HEADERS, body: cached };
    return;
  }

  try {
    // Top pages query — group by path, then pick the MOST COMMON title for each path.
    // Previous version used take_any(name) which is non-deterministic and could pick a stale
    // SPA-navigation title (e.g. "/" labeled as "StoryForge" because one of N visits was logged
    // with a stale document.title). Two-stage groupby fixes this by taking the dominant title.
    // Top pages query — adds uniqueSessions / uniqueUsers per row so the
    // dashboard can render trust dots (high session/view ratio = real users,
    // low ratio = bot-like / refresh-heavy). Two-stage groupby still picks
    // the dominant title for each clean path.
    var topPagesQuery = [
      'pageViews',
      '| where isnotempty(url)',
      '| extend parsedPath = tostring(parse_url(url).Path)',
      '| extend cleanPath = iff(parsedPath == "", "/", parsedPath)',
      '| extend cleanPath = replace_string(cleanPath, "/index.html", "/")',
      '| extend cleanPath = iff(cleanPath != "/" and cleanPath endswith "/", substring(cleanPath, 0, strlen(cleanPath) - 1), cleanPath)',
      '| extend cleanPath = iff(cleanPath == "", "/", cleanPath)',
      '| summarize titleCount = count(), uSess = dcount(session_Id), uUsers = dcount(user_Id) by path = cleanPath, name',
      '| summarize viewCount = sum(titleCount), uniqueSessions = sum(uSess), uniqueUsers = sum(uUsers), arg_max(titleCount, name) by path',
      '| project path, viewCount, uniqueSessions, uniqueUsers, pageTitle = name',
      '| top 20 by viewCount desc'
    ].join('\n');

    // Top referrers
    var topReferrersQuery = [
      'pageViews',
      '| extend ref = tostring(customDimensions["refUri"])',
      '| where isnotempty(ref)',
      '| extend refHost = tostring(parse_url(ref).Host)',
      '| where refHost != "ambientpixels.ai" and refHost != "www.ambientpixels.ai" and refHost != ""',
      '| summarize sessions = dcount(session_Id) by referrer = refHost',
      '| top 10 by sessions desc'
    ].join('\n');

    // Top campaigns (utm params) — use bracket access (safer than dot for dynamic dict keys)
    var topCampaignsQuery = [
      'pageViews',
      '| where isnotempty(url) and url contains "utm_"',
      '| extend qp = parse_url(url)["Query Parameters"]',
      '| extend campaign = tostring(qp["utm_campaign"]), source = tostring(qp["utm_source"]), medium = tostring(qp["utm_medium"])',
      '| where isnotempty(campaign)',
      '| summarize sessions = dcount(session_Id) by campaign, source, medium',
      '| top 10 by sessions desc'
    ].join('\n');

    // Diagnostic: how many pageViews even have utm_ in the URL? Helps distinguish "no UTMs in the wild" vs "query bug"
    var utmDiagnosticQuery = [
      'pageViews',
      '| where isnotempty(url)',
      '| summarize total = count(), withUtm = countif(url contains "utm_")'
    ].join('\n');

    // Performance — exclude bot user agents from latency percentiles.
    // Without this filter, Applebot/Googlebot/bingbot crawls (which take
    // 15-30s on JS-heavy pages) drag the dashboard P95 from ~4s to ~6s,
    // making it look worse than real-user experience actually is. Counts
    // and other queries are intentionally NOT bot-filtered so the page-view
    // numbers on the dashboard stay consistent with what users have been
    // tracking. Verified 2026-04-07 against last-7d data: 257 → 236 views,
    // p95 5977ms → 4053ms.
    var perfQuery = [
      'pageViews',
      '| where isnull(client_Browser) or not(client_Browser matches regex "(?i)bot|crawl|spider")',
      '| summarize p50 = percentile(duration, 50), p95 = percentile(duration, 95)'
    ].join('\n');

    // Errors — exclude TaskCanceledException from the count.
    // 80%+ of these events are HTTP 499 client cancellations from
    // user-facing endpoints (company-state, novachat, pixel-agent-catalog,
    // etc.) when a browser navigates away or refreshes while parallel
    // fetches are still in flight. They're not failures from the user's
    // perspective — the user just left the page. Real errors
    // (SyntaxError, TypeError, FunctionTimeoutException, etc.) are still
    // counted. Verified 2026-04-08: 90 events → 6 events shown.
    var errorsQuery = [
      'exceptions',
      '| where type != "System.Threading.Tasks.TaskCanceledException"',
      '| summarize count_ = count() by name = type',
      '| top 10 by count_ desc'
    ].join('\n');

    // Daily page views timeline
    var dailyViewsQuery = [
      'pageViews',
      '| extend day = format_datetime(timestamp, "yyyy-MM-dd")',
      '| summarize viewCount = count() by day',
      '| order by day asc'
    ].join('\n');

    // Run queries in parallel
    var _log = context.log.bind(context);
    var results = await Promise.all([
      _kustoQuery(topPagesQuery, timespan, _log),
      _kustoQuery(topReferrersQuery, timespan, _log),
      _kustoQuery(topCampaignsQuery, timespan, _log),
      _kustoQuery(perfQuery, timespan, _log),
      _kustoQuery(errorsQuery, timespan, _log),
      _kustoQuery(dailyViewsQuery, timespan, _log),
      _kustoQuery(utmDiagnosticQuery, timespan, _log)
    ]);

    // Log UTM diagnostic so we can see in Application Insights traces whether any
    // pageViews in the window even contain utm_ params. This makes the empty-campaigns
    // case unambiguous: 0 = no UTMs being posted, >0 = parse/query bug.
    var utmDiag = _parseRows(results[6]);
    if (utmDiag.length > 0) {
      context.log('[telemetrySummary] UTM diagnostic range=' + range + ' total=' + (utmDiag[0].total || 0) + ' withUtm=' + (utmDiag[0].withUtm || 0));
    }

    var pages = _parseRows(results[0]).map(function (r) {
      var path = r.path || '/';
      return {
        path: path,
        // Use override for known stable paths (see PAGE_TITLE_OVERRIDES at
        // the top of the file for why); fall through to whatever title
        // App Insights recorded for unmapped paths.
        pageTitle: PAGE_TITLE_OVERRIDES[path] || r.pageTitle || '',
        views: r.viewCount || 0,
        uniqueSessions: r.uniqueSessions || 0,
        uniqueUsers: r.uniqueUsers || 0
      };
    });
    var referrers = _parseRows(results[1]).map(function (r) { return { referrer: r.referrer || '', sessions: r.sessions || 0 }; });
    var campaigns = _parseRows(results[2]).map(function (r) { return { campaign: r.campaign || '', source: r.source || '', medium: r.medium || '', sessions: r.sessions || 0 }; });
    var perfRows = _parseRows(results[3]);
    var perf = perfRows.length > 0 ? { pageLoadMs_p50: Math.round(perfRows[0].p50 || 0), pageLoadMs_p95: Math.round(perfRows[0].p95 || 0) } : { pageLoadMs_p50: 0, pageLoadMs_p95: 0 };
    var errors = _parseRows(results[4]).map(function (r) { return { name: r.name || 'Unknown', count: r.count_ || 0 }; });
    var dailyViews = _parseRows(results[5]).map(function (r) {
      var d = r.day ? new Date(r.day).toISOString().slice(0, 10) : '';
      return { day: d, views: r.viewCount || 0 };
    });

    // Top-level totals — single source of truth for the hero strip + Phase 7
    // hero subscribers. Aggregated server-side from topPages so the browser
    // doesn't have to recompute.
    var totals = pages.reduce(function (acc, p) {
      acc.pageViews += p.views || 0;
      acc.uniqueSessions += p.uniqueSessions || 0;
      acc.uniqueUsers += p.uniqueUsers || 0;
      return acc;
    }, { pageViews: 0, uniqueSessions: 0, uniqueUsers: 0 });
    totals.totalErrors = errors.reduce(function (s, e) { return s + (e.count || 0); }, 0);

    var anyFailed = results.some(function (r) { return r === null; });
    var queryErrors = _lastQueryErrors.length > 0 ? _lastQueryErrors.slice() : undefined;
    _lastQueryErrors = [];

    var body = {
      range: range,
      rangeLabel: _rangeLabel(range),
      generatedAt: new Date().toISOString(),
      warning: anyFailed ? 'partial_data: some queries failed' : null,
      totals: totals,
      topPages: pages,
      topReferrers: referrers,
      topCampaigns: campaigns,
      dailyViews: dailyViews,
      events: { ctaClicks: 0, requestAccessClicks: 0 },
      performance: perf,
      errors: errors
    };

    // Cache successful result (do not cache failures)
    _cache[range] = { ts: Date.now(), data: body };

    context.res = {
      status: 200,
      headers: RES_HEADERS,
      body: body
    };
  } catch (err) {
    context.log('[telemetrySummary] Error:', err.message);
    context.res = {
      status: 200,
      headers: RES_HEADERS,
      body: _emptyResponse(range, 'telemetry_unavailable: ' + (err.message || 'query error'))
    };
  }
};

// Public view: limited payload (topPages only, no referrers/campaigns/perf/errors)
function _publicView(full) {
  return {
    range: full.range,
    rangeLabel: full.rangeLabel,
    generatedAt: full.generatedAt,
    warning: 'public_limited_view',
    topPages: full.topPages
  };
}
