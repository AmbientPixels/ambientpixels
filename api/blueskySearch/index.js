// blueskySearch — thin wrapper around AT Protocol public search endpoint
// GET /api/blueskySearch?q=KEYWORD&maxAgeMinutes=120&minReplies=1&limit=25
// Returns: [{ uri, cid, author, text, indexedAt, replyCount, repostCount, likeCount }]
// CID is required for reply payloads — do not strip it from the response.

const { searchBluesky } = require('../_utils/blueskyDiscovery');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // Auth: require company secret for consistency with other internal endpoints
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (secret !== 'pixelpusher') {
    context.res = {
      status: 403,
      headers: corsHeaders,
      body: { error: 'Invalid or missing x-company-secret header' }
    };
    return;
  }

  const q = (req.query && req.query.q) || '';
  if (!q || q.length < 2) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Query parameter "q" required (min 2 chars)' }
    };
    return;
  }

  const maxAgeMinutes = parseInt((req.query && req.query.maxAgeMinutes) || '120', 10);
  const minReplies = parseInt((req.query && req.query.minReplies) || '0', 10);
  const limit = Math.min(parseInt((req.query && req.query.limit) || '25', 10), 100);

  try {
    const mapped = await searchBluesky(q, { maxAgeMinutes, minReplies, limit });
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: mapped
    };
  } catch (err) {
    context.log('[blueskySearch] Error:', String(err && err.message || err).substring(0, 300));
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Bluesky search failed', details: String(err && err.message || err).substring(0, 200) }
    };
  }
};
