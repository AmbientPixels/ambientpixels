// blogpage — server-rendered article page for /blog/<slug>.
//
// The SWA route {"route":"/blog/*"} rewrites here so crawlers get per-article
// meta (title, description, hero og:image) instead of the SPA shell's generic
// journal card. Humans get the same page and blog.js hydrates the full client
// experience over it. Every failure path 302s to /blog/ — the blog must
// degrade to the index, never to a dead page.

const storage = require('../_utils/companyStorage');
const { renderArticlePage } = require('./render');

function slugFromRequest(context, req) {
  let slug = (context.bindingData && context.bindingData.slug) || '';
  if (!slug) {
    // Fallback: SWA forwards the original path when rewriting cross-origin.
    const orig = (req.headers && (req.headers['x-ms-original-url'] || req.headers['X-MS-ORIGINAL-URL'])) || '';
    const m = String(orig).match(/\/blog\/([^/?#]+)/);
    if (m) slug = m[1];
  }
  slug = decodeURIComponent(String(slug || '')).replace(/\/+$/, '');
  return slug;
}

module.exports = async function (context, req) {
  const redirectHome = {
    status: 302,
    headers: { Location: 'https://www.ambientpixels.ai/blog/', 'Cache-Control': 'no-store' },
    body: ''
  };

  try {
    const slug = slugFromRequest(context, req);
    if (!slug || slug === 'index.html') {
      context.res = redirectHome;
      return;
    }

    const posts = (await storage.getState('blogPosts')) || [];
    const post = posts.find(function (p) { return p && p.slug === slug; });
    if (!post) {
      context.log('[blogpage] no post for slug:', slug);
      context.res = redirectHome;
      return;
    }

    // Same hero resolution as the blogPosts endpoint: asset id → imageAssets.
    let hero = null;
    if (post.hero_image_asset_id) {
      try {
        const assets = (await storage.getState('imageAssets')) || [];
        const a = assets.find(function (x) { return x && x.id === post.hero_image_asset_id && x.url; });
        if (a) hero = { url: a.url, alt: a.alt || post.title };
      } catch (e) { /* non-fatal — the card falls back to the brand image */ }
    }
    if (!hero && post.cover_image) hero = { url: post.cover_image, alt: post.title };

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      },
      body: renderArticlePage(post, hero)
    };
  } catch (err) {
    context.log.error('[blogpage] error:', err && err.message);
    context.res = redirectHome;
  }
};
