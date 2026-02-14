// publishedDocs — Public READ API for published documents
// GET /api/publishedDocs          → metadata list (no content_md)
// GET /api/publishedDocs?slug=X   → single doc with full content_md

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
    const slug = (req.query && req.query.slug) || '';
    const docs = (await storage.getState('publishedDocs')) || [];

    // Single doc by slug
    if (slug) {
      const doc = docs.find(function (d) { return d.slug === slug; });
      if (!doc) {
        context.res = {
          status: 404,
          headers: corsHeaders,
          body: { error: 'not_found', message: 'No published document with slug: ' + slug }
        };
        return;
      }

      context.res = {
        status: 200,
        headers: corsHeaders,
        body: {
          slug: doc.slug,
          title: doc.title,
          kind: doc.kind,
          target_path: doc.target_path,
          public_url: doc.public_url || ('/docs/published/' + doc.slug),
          content_md: doc.content_md,
          published_at: doc.published_at,
          updated_at: doc.updated_at || doc.published_at,
          tags: doc.tags || [],
          created_by: doc.created_by
        }
      };
      return;
    }

    // Metadata list (no content_md)
    var list = docs.map(function (d) {
      return {
        slug: d.slug,
        title: d.title,
        kind: d.kind,
        target_path: d.target_path,
        public_url: d.public_url || ('/docs/published/' + d.slug),
        published_at: d.published_at,
        updated_at: d.updated_at || d.published_at,
        tags: d.tags || []
      };
    });

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: list
    };

  } catch (err) {
    context.log.error('[PublishedDocs] Error:', err.message || err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'internal_error', message: err.message }
    };
  }
};
