// sitemapXml — Dynamic sitemap that merges static pages + live blog posts
// GET /api/sitemapXml → application/xml

const storage = require('../_utils/companyStorage');

const SITE = 'https://www.ambientpixels.ai';

// 10-minute cache
var _cache = null;
var _cacheTs = 0;
var CACHE_TTL = 10 * 60 * 1000;

// Static pages (everything except blog posts — those come from blob)
var STATIC_PAGES = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/about/', changefreq: 'monthly', priority: '0.7' },
  { loc: '/projects/', changefreq: 'monthly', priority: '0.7' },
  { loc: '/art.html', changefreq: 'monthly', priority: '0.5' },
  { loc: '/blog/', changefreq: 'daily', priority: '0.9' },
  { loc: '/log/', changefreq: 'daily', priority: '0.8' },
  { loc: '/nova/', changefreq: 'weekly', priority: '0.8' },
  { loc: '/nova/about.html', changefreq: 'monthly', priority: '0.6' },
  { loc: '/nova/awareness.html', changefreq: 'weekly', priority: '0.6' },
  { loc: '/nova/dashboard.html', changefreq: 'weekly', priority: '0.6' },
  { loc: '/nova/logs.html', changefreq: 'weekly', priority: '0.5' },
  { loc: '/cardforge/', changefreq: 'weekly', priority: '0.8' },
  { loc: '/cardforge/deck.html', changefreq: 'weekly', priority: '0.6' },
  { loc: '/cardforge/arena.html', changefreq: 'weekly', priority: '0.7' },
  { loc: '/cardforge/devlog.html', changefreq: 'monthly', priority: '0.5' },
  { loc: '/blindspot/', changefreq: 'weekly', priority: '0.9' },
  { loc: '/blindspot/play.html', changefreq: 'weekly', priority: '0.7' },
  { loc: '/storyforge/', changefreq: 'weekly', priority: '0.8' },
  { loc: '/storyforge/play.html', changefreq: 'weekly', priority: '0.7' },
  { loc: '/storyforge/gallery.html', changefreq: 'weekly', priority: '0.6' },
  { loc: '/ambientscore/', changefreq: 'weekly', priority: '0.8' },
  { loc: '/glitchlab.html', changefreq: 'monthly', priority: '0.5' },
  { loc: '/privacy.html', changefreq: 'yearly', priority: '0.3' },
  { loc: '/terms.html', changefreq: 'yearly', priority: '0.3' }
];

function urlEntry(loc, changefreq, priority, lastmod) {
  var xml = '  <url>\n    <loc>' + SITE + loc + '</loc>\n';
  if (lastmod) xml += '    <lastmod>' + lastmod + '</lastmod>\n';
  xml += '    <changefreq>' + changefreq + '</changefreq>\n';
  xml += '    <priority>' + priority + '</priority>\n';
  xml += '  </url>\n';
  return xml;
}

module.exports = async function (context, req) {
  // Return cached version if fresh
  if (_cache && (Date.now() - _cacheTs) < CACHE_TTL) {
    context.res = { status: 200, headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=600' }, body: _cache };
    return;
  }

  try {
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static pages
    STATIC_PAGES.forEach(function (p) {
      xml += urlEntry(p.loc, p.changefreq, p.priority);
    });

    // Dynamic blog posts from blob storage
    var posts = (await storage.getState('blogPosts')) || [];
    posts.forEach(function (p) {
      if (!p.slug) return;
      var lastmod = (p.updated_at || p.published_at || '').substring(0, 10);
      xml += urlEntry('/blog/' + p.slug, 'monthly', '0.7', lastmod || undefined);
    });

    xml += '</urlset>\n';

    _cache = xml;
    _cacheTs = Date.now();

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=600' },
      body: xml
    };
  } catch (err) {
    context.log.error('[SitemapXml] Error:', err.message);
    context.res = { status: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Sitemap generation failed' };
  }
};
