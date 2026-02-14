// toolsWebSearch — Web Search Tool for AI Agents
// Brave Search API with 24h caching, audit logging, and rate limiting
// GET /api/toolsWebSearch?q=<query>&n=<max_results>&agent=<agentId>

const fetch = require('node-fetch');
const crypto = require('crypto');
const storage = require('../_utils/companyStorage');

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
const SERPAPI_KEY = process.env.SERPAPI_API_KEY || '';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RESULTS_CAP = 10;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// ── Cache key: SHA1 of normalized query + result count ──
function cacheKey(query, n) {
  var normalized = (query || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha1').update(normalized + '|n=' + n).digest('hex');
}

// ── Brave Search API ──
async function searchBrave(query, n) {
  var url = 'https://api.search.brave.com/res/v1/web/search?q=' +
    encodeURIComponent(query) + '&count=' + n;

  var res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY }
  });

  if (!res.ok) {
    throw new Error('Brave API ' + res.status + ': ' + (await res.text()).substring(0, 200));
  }

  var data = await res.json();
  var webResults = (data.web && data.web.results) || [];

  return webResults.slice(0, n).map(function (r, i) {
    return {
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      source: 'brave',
      rank: i + 1
    };
  });
}

// ── SerpAPI fallback ──
async function searchSerpApi(query, n) {
  var url = 'https://serpapi.com/search.json?engine=google&q=' +
    encodeURIComponent(query) + '&num=' + n + '&api_key=' + SERPAPI_KEY;

  var res = await fetch(url);

  if (!res.ok) {
    throw new Error('SerpAPI ' + res.status + ': ' + (await res.text()).substring(0, 200));
  }

  var data = await res.json();
  var results = data.organic_results || [];

  return results.slice(0, n).map(function (r, i) {
    return {
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      source: 'serpapi',
      rank: i + 1
    };
  });
}

// ── Audit log helper ──
async function auditLog(type, agent, query, cached, engine, resultCount, topUrls) {
  var timestamp = new Date().toISOString();
  var entry = {
    id: 'wslog-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    type: type,
    agent: agent || 'unknown',
    query: query,
    cached: !!cached,
    engine: engine || 'none',
    result_count: resultCount || 0,
    top_urls: (topUrls || []).slice(0, 3),
    timestamp: timestamp
  };

  // Governance log
  try {
    var govLog = (await storage.getState('governanceLog')) || [];
    govLog.push({
      id: 'gov-' + Date.now(),
      type: type,
      actor: agent || 'system',
      detail: 'web_search: "' + (query || '').substring(0, 80) + '" → ' + (resultCount || 0) + ' results' + (cached ? ' (cached)' : ''),
      engine: engine,
      timestamp: timestamp
    });
    if (govLog.length > 200) govLog.splice(0, govLog.length - 200);
    await storage.setState('governanceLog', govLog);
  } catch (e) { /* best-effort */ }

  // Action audit log
  try {
    var auditLog = (await storage.getState('actionAuditLog')) || [];
    auditLog.push(entry);
    if (auditLog.length > 500) auditLog.splice(0, auditLog.length - 500);
    await storage.setState('actionAuditLog', auditLog);
  } catch (e) { /* best-effort */ }
}

// ── Main handler ──
module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS };
    return;
  }

  var query = (req.query && req.query.q) || '';
  var n = Math.min(parseInt(req.query && req.query.n, 10) || 5, MAX_RESULTS_CAP);
  var agent = (req.query && req.query.agent) || 'unknown';

  if (!query) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { ok: false, error: 'missing_query', message: 'q parameter is required' } };
    return;
  }

  // Check API keys
  if (!BRAVE_API_KEY && !SERPAPI_KEY) {
    await auditLog('tool:web_search.error', agent, query, false, 'none', 0, []);
    context.res = {
      status: 200, headers: CORS_HEADERS,
      body: { ok: false, error: 'missing_api_key', engine: 'none', query: query, cached: false, results: [], message: 'No search API key configured' }
    };
    return;
  }

  try {
    // ── Cache check ──
    var key = cacheKey(query, n);
    var cache = (await storage.getState('webSearchCache')) || {};
    var cached = cache[key];

    if (cached && cached.createdAt) {
      var age = Date.now() - new Date(cached.createdAt).getTime();
      if (age < CACHE_TTL_MS) {
        await auditLog('tool:web_search.completed', agent, query, true, cached.engine, cached.results.length, cached.results.map(function (r) { return r.url; }));
        context.res = {
          status: 200, headers: CORS_HEADERS,
          body: { ok: true, engine: cached.engine, query: query, cached: true, cached_at: cached.createdAt, results: cached.results }
        };
        return;
      }
    }

    // ── Live search ──
    await auditLog('tool:web_search.requested', agent, query, false, BRAVE_API_KEY ? 'brave' : 'serpapi', 0, []);

    var results = [];
    var engine = 'none';

    if (BRAVE_API_KEY) {
      engine = 'brave';
      results = await searchBrave(query, n);
    } else if (SERPAPI_KEY) {
      engine = 'serpapi';
      results = await searchSerpApi(query, n);
    }

    // ── Store in cache ──
    cache[key] = {
      query: query,
      n: n,
      createdAt: new Date().toISOString(),
      engine: engine,
      results: results
    };

    // Prune stale cache entries (older than 48h) to keep blob small
    var pruneThreshold = Date.now() - (48 * 60 * 60 * 1000);
    Object.keys(cache).forEach(function (k) {
      if (cache[k].createdAt && new Date(cache[k].createdAt).getTime() < pruneThreshold) {
        delete cache[k];
      }
    });

    await storage.setState('webSearchCache', cache);

    var topUrls = results.map(function (r) { return r.url; });
    await auditLog('tool:web_search.completed', agent, query, false, engine, results.length, topUrls);

    context.res = {
      status: 200, headers: CORS_HEADERS,
      body: { ok: true, engine: engine, query: query, cached: false, cached_at: null, results: results }
    };

  } catch (err) {
    context.log.error('[toolsWebSearch] Error:', err.message);
    await auditLog('tool:web_search.error', agent, query, false, 'none', 0, []);
    context.res = {
      status: 200, headers: CORS_HEADERS,
      body: { ok: false, error: 'search_failed', engine: 'none', query: query, cached: false, results: [], message: (err.message || 'Unknown error').substring(0, 200) }
    };
  }
};

// ── Exported for internal heartbeat calls (no HTTP overhead) ──
module.exports.searchInternal = async function (query, n, agent, contextLog) {
  var log = contextLog || { log: function () {}, error: function () {} };

  if (!query) {
    return { ok: false, error: 'missing_query', engine: 'none', query: '', cached: false, results: [] };
  }

  n = Math.min(n || 5, MAX_RESULTS_CAP);

  if (!BRAVE_API_KEY && !SERPAPI_KEY) {
    await auditLog('tool:web_search.error', agent, query, false, 'none', 0, []);
    return { ok: false, error: 'missing_api_key', engine: 'none', query: query, cached: false, results: [] };
  }

  try {
    var key = cacheKey(query, n);
    var cache = (await storage.getState('webSearchCache')) || {};
    var cached = cache[key];

    if (cached && cached.createdAt) {
      var age = Date.now() - new Date(cached.createdAt).getTime();
      if (age < CACHE_TTL_MS) {
        await auditLog('tool:web_search.completed', agent, query, true, cached.engine, cached.results.length, cached.results.map(function (r) { return r.url; }));
        return { ok: true, engine: cached.engine, query: query, cached: true, cached_at: cached.createdAt, results: cached.results };
      }
    }

    await auditLog('tool:web_search.requested', agent, query, false, BRAVE_API_KEY ? 'brave' : 'serpapi', 0, []);

    var results = [];
    var engine = 'none';

    if (BRAVE_API_KEY) {
      engine = 'brave';
      results = await searchBrave(query, n);
    } else if (SERPAPI_KEY) {
      engine = 'serpapi';
      results = await searchSerpApi(query, n);
    }

    cache[key] = { query: query, n: n, createdAt: new Date().toISOString(), engine: engine, results: results };

    var pruneThreshold = Date.now() - (48 * 60 * 60 * 1000);
    Object.keys(cache).forEach(function (k) {
      if (cache[k].createdAt && new Date(cache[k].createdAt).getTime() < pruneThreshold) {
        delete cache[k];
      }
    });
    await storage.setState('webSearchCache', cache);

    var topUrls = results.map(function (r) { return r.url; });
    await auditLog('tool:web_search.completed', agent, query, false, engine, results.length, topUrls);

    return { ok: true, engine: engine, query: query, cached: false, cached_at: null, results: results };

  } catch (err) {
    log.error('[toolsWebSearch] Internal error:', err.message);
    await auditLog('tool:web_search.error', agent, query, false, 'none', 0, []);
    return { ok: false, error: 'search_failed', engine: 'none', query: query, cached: false, results: [], message: (err.message || '').substring(0, 200) };
  }
};
