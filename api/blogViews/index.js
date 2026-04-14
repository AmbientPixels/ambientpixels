// blogViews — Lightweight blog post view tracking
// POST: record a view { slug }
// GET: return view counts per slug

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

const MAX_VIEWS = 50000; // rolling cap

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // POST — record a view
  if (req.method === 'POST') {
    try {
      var body = req.body || {};
      var slug = (body.slug || '').trim();
      if (!slug || slug.length > 200) {
        context.res = { status: 400, headers: corsHeaders, body: JSON.stringify({ error: 'slug required' }) };
        return;
      }

      var views = (await storage.getState('blogPostViews')) || [];

      // Deduplicate: ignore repeat views of same slug within 30 min from same fingerprint
      var fp = (body.fp || '').trim().slice(0, 64);
      var now = Date.now();
      if (fp) {
        var recentDupe = views.some(function (v) {
          return v.slug === slug && v.fp === fp && (now - Date.parse(v.timestamp || '')) < 30 * 60 * 1000;
        });
        if (recentDupe) {
          context.res = { status: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, deduped: true }) };
          return;
        }
      }

      // Phase 2 UTM attribution: capture utm_source / utm_content (action_id).
      // Client may pass these from URL query params (window.location.search)
      // OR we can parse them here from body.url / body.referrer as fallback.
      var utmSource = (body.utm_source || '').toString().trim().slice(0, 50) || null;
      var utmContent = (body.utm_content || '').toString().trim().slice(0, 100) || null;
      if ((!utmSource || !utmContent) && body.url) {
        try {
          var _u = new URL(body.url);
          if (!utmSource) utmSource = _u.searchParams.get('utm_source') || null;
          if (!utmContent) utmContent = _u.searchParams.get('utm_content') || null;
          if (utmSource) utmSource = utmSource.slice(0, 50);
          if (utmContent) utmContent = utmContent.slice(0, 100);
        } catch (_e) { /* ignore malformed url */ }
      }

      views.push({
        slug: slug,
        timestamp: new Date(now).toISOString(),
        fp: fp || null,
        referrer: (body.referrer || '').slice(0, 200) || null,
        utmSource: utmSource,
        utmContent: utmContent
      });

      // Rolling cap
      if (views.length > MAX_VIEWS) views = views.slice(-MAX_VIEWS);

      await storage.setState('blogPostViews', views);
      context.res = { status: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      context.res = { status: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
    return;
  }

  // GET — return view counts per slug
  if (req.method === 'GET') {
    try {
      var allViews = (await storage.getState('blogPostViews')) || [];
      var counts = {};
      allViews.forEach(function (v) {
        if (v.slug) counts[v.slug] = (counts[v.slug] || 0) + 1;
      });

      // Also cross-reference with blogPosts for created_by attribution
      var blogPosts = (await storage.getState('blogPosts')) || [];
      var result = blogPosts.map(function (p) {
        return {
          slug: p.slug,
          title: p.title,
          created_by: p.created_by || 'unknown',
          views: counts[p.slug] || 0,
          published_at: p.published_at
        };
      }).sort(function (a, b) { return (b.views || 0) - (a.views || 0); });

      context.res = { status: 200, headers: corsHeaders, body: JSON.stringify(result) };
    } catch (err) {
      context.res = { status: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
    return;
  }
};
