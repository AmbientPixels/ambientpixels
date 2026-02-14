// dailyLog — Public READ API for daily activity log
// GET /api/dailyLog          → list of published entries, newest first
// GET /api/dailyLog?date=X   → single entry by date (YYYY-MM-DD)

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const date = (req.query && req.query.date) || '';
    const allEntries = (await storage.getState('dailyLog')) || [];

    // Only serve published entries to the public
    var published = allEntries.filter(function (e) { return e.status === 'published'; });

    // Single entry by date
    if (date) {
      var entry = published.find(function (e) { return e.date === date; });
      if (!entry) {
        context.res = {
          status: 404,
          headers: corsHeaders,
          body: { error: 'not_found', message: 'No published log for date: ' + date }
        };
        return;
      }

      context.res = {
        status: 200,
        headers: corsHeaders,
        body: {
          date: entry.date,
          title: entry.title,
          summary: entry.summary,
          highlights: entry.highlights || [],
          stats: entry.stats || {},
          published_at: entry.published_at,
          mood: entry.mood || 'steady'
        }
      };
      return;
    }

    // List (no full summary for index, keep payloads small)
    var list = published.map(function (e) {
      return {
        date: e.date,
        title: e.title,
        excerpt: (e.summary || '').substring(0, 200) + ((e.summary || '').length > 200 ? '...' : ''),
        highlights: (e.highlights || []).slice(0, 3),
        stats: e.stats || {},
        published_at: e.published_at,
        mood: e.mood || 'steady'
      };
    });

    // Newest first
    list.sort(function (a, b) {
      return b.date.localeCompare(a.date);
    });

    // Cap at 90 days
    if (list.length > 90) list = list.slice(0, 90);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: list
    };

  } catch (err) {
    context.log.error('[DailyLog] Error:', err.message || err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'internal_error', message: err.message }
    };
  }
};
