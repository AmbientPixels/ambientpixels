// blogPosts — Public READ API for blog articles
// GET /api/blogPosts          → metadata list (no content_md), newest first
// GET /api/blogPosts?slug=X   → single post with full content_md

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
    const posts = (await storage.getState('blogPosts')) || [];

    // Single post by slug
    if (slug) {
      const post = posts.find(function (p) { return p.slug === slug; });
      if (!post) {
        context.res = {
          status: 404,
          headers: corsHeaders,
          body: { error: 'not_found', message: 'No blog post with slug: ' + slug }
        };
        return;
      }

      context.res = {
        status: 200,
        headers: corsHeaders,
        body: {
          slug: post.slug,
          title: post.title,
          kind: post.kind || 'article',
          excerpt: post.excerpt || '',
          content_md: post.content_md,
          published_at: post.published_at,
          updated_at: post.updated_at || post.published_at,
          tags: post.tags || [],
          created_by: post.created_by,
          cover_image: post.cover_image || null
        }
      };
      return;
    }

    // Metadata list (no content_md), newest first
    var list = posts.map(function (p) {
      return {
        slug: p.slug,
        title: p.title,
        kind: p.kind || 'article',
        excerpt: p.excerpt || '',
        published_at: p.published_at,
        updated_at: p.updated_at || p.published_at,
        tags: p.tags || [],
        created_by: p.created_by,
        cover_image: p.cover_image || null
      };
    });

    // Sort newest first
    list.sort(function (a, b) {
      return new Date(b.published_at || 0) - new Date(a.published_at || 0);
    });

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: list
    };

  } catch (err) {
    context.log.error('[BlogPosts] Error:', err.message || err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'internal_error', message: err.message }
    };
  }
};
