// blogSSR — Server-side rendered blog post pages for SEO
// GET /api/blogSSR/{slug} → full HTML page with article content, meta tags, JSON-LD
// The existing client-side blog.js will still hydrate for interactivity.

const storage = require('../_utils/companyStorage');

const SITE = 'https://www.ambientpixels.ai';

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(s) {
  return esc(s).replace(/\n/g, ' ');
}

// Simple markdown → HTML (covers 90% of blog content without external deps)
function mdToHtml(md) {
  if (!md) return '';
  var html = md
    // Code blocks (fenced)
    .replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre><code class="language-' + (lang || '') + '">' + esc(code.trim()) + '</code></pre>';
    })
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n+/g, '</p><p>')
    // Single newlines → br
    .replace(/\n/g, '<br>');

  // Wrap loose <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');

  return '<p>' + html + '</p>';
}

function formatDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function buildPage(post, slug) {
  var title = esc(post.title) + ' — AmbientPixels Blog';
  var description = escAttr(post.excerpt || post.title);
  var url = SITE + '/blog/' + encodeURIComponent(slug);
  var heroUrl = (post.hero_image && post.hero_image.url) || post.cover_image || SITE + '/blog/og-blog.png';
  var publishedAt = post.published_at || '';
  var updatedAt = post.updated_at || publishedAt;
  var author = post.created_by || 'AmbientPixels';
  var tags = post.tags || [];
  var articleHtml = mdToHtml(post.content_md || '');
  var wordCount = (post.content_md || '').split(/\s+/).length;
  var readingTime = Math.max(1, Math.round(wordCount / 200));

  // JSON-LD Article schema
  var jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': post.title,
    'description': post.excerpt || post.title,
    'url': url,
    'image': heroUrl,
    'datePublished': publishedAt,
    'dateModified': updatedAt,
    'author': {
      '@type': 'Organization',
      'name': 'AmbientPixels',
      'url': SITE
    },
    'publisher': {
      '@type': 'Organization',
      'name': 'AmbientPixels',
      'url': SITE,
      'logo': { '@type': 'ImageObject', 'url': SITE + '/images/og-ambientpixels.png' }
    },
    'wordCount': wordCount,
    'keywords': tags.join(', ')
  });

  var heroImgHtml = heroUrl && heroUrl !== SITE + '/blog/og-blog.png'
    ? '<div class="blog-hero-image"><img src="' + esc(heroUrl) + '" alt="' + escAttr(post.title) + '" loading="eager"></div>'
    : '';

  var tagsHtml = tags.slice(0, 4).map(function (t) {
    return '<span class="blog-tag">' + esc(t) + '</span>';
  }).join(' ');

  return '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <title>' + title + '</title>\n' +
    '  <meta name="description" content="' + description + '" />\n' +
    '  <link rel="canonical" href="' + esc(url) + '" />\n' +
    '  <meta property="og:type" content="article" />\n' +
    '  <meta property="og:title" content="' + escAttr(post.title) + '" />\n' +
    '  <meta property="og:description" content="' + description + '" />\n' +
    '  <meta property="og:url" content="' + esc(url) + '" />\n' +
    '  <meta property="og:image" content="' + esc(heroUrl) + '" />\n' +
    '  <meta property="og:image:width" content="1200" />\n' +
    '  <meta property="og:image:height" content="630" />\n' +
    '  <meta property="article:published_time" content="' + escAttr(publishedAt) + '" />\n' +
    '  <meta property="article:modified_time" content="' + escAttr(updatedAt) + '" />\n' +
    (tags.length ? '  <meta property="article:tag" content="' + escAttr(tags.join(', ')) + '" />\n' : '') +
    '  <meta name="twitter:card" content="summary_large_image" />\n' +
    '  <meta name="twitter:title" content="' + escAttr(post.title) + '" />\n' +
    '  <meta name="twitter:description" content="' + description + '" />\n' +
    '  <meta name="twitter:image" content="' + esc(heroUrl) + '" />\n' +
    '  <script type="application/ld+json">' + jsonLd + '</script>\n' +
    '  <link rel="icon" href="/images/favicon.ico" type="image/x-icon" />\n' +
    '  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous" />\n' +
    '  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />\n' +
    '  <link rel="stylesheet" href="/blog/blog.css" />\n' +
    '  <script src="/js/telemetry-config.js"></script>\n' +
    '  <script src="/js/telemetry-appinsights.js" defer></script>\n' +
    '  <script src="/js/product-analytics.js" defer></script>\n' +
    '</head>\n' +
    '<body class="blog-wrapper">\n' +
    '  <div class="ap-brand-bar">\n' +
    '    <div class="ap-brand-inner">\n' +
    '      <a href="/" class="ap-brand-logo">\n' +
    '        <img src="/images/ambient-pixel-logo-rainbow.png" alt="Ambient Pixels" />\n' +
    '        <span class="ap-brand-name">Ambient Pixels</span>\n' +
    '      </a>\n' +
    '      <nav class="ap-brand-nav">\n' +
    '        <a href="/">Home</a>\n' +
    '        <a href="/blog/" class="ap-brand-nav--active">Blog</a>\n' +
    '        <a href="/log/">Activity Log</a>\n' +
    '        <a href="/nova/">Nova</a>\n' +
    '        <a href="/projects/">Projects</a>\n' +
    '      </nav>\n' +
    '    </div>\n' +
    '    <div class="blog-spectrum-line"></div>\n' +
    '  </div>\n' +
    '\n' +
    '  <div class="blog-container">\n' +
    '    <div id="blog-header">\n' +
    '      <div class="blog-post-header">\n' +
    '        <a href="/blog/" class="blog-back"><i class="fas fa-arrow-left"></i> All Posts</a>\n' +
    '        <h1 class="blog-post-title">' + esc(post.title) + '</h1>\n' +
    '        <div class="blog-post-meta">\n' +
    '          <span class="blog-kind-badge">' + esc(post.kind || 'article') + '</span>\n' +
    (publishedAt ? '          <span><i class="fas fa-calendar"></i> ' + formatDate(publishedAt) + '</span>\n' : '') +
    (author ? '          <span><i class="fas fa-user"></i> ' + esc(author) + '</span>\n' : '') +
    '          <span><i class="fas fa-clock"></i> ' + readingTime + ' min read</span>\n' +
    '          ' + tagsHtml + '\n' +
    '        </div>\n' +
    heroImgHtml + '\n' +
    '      </div>\n' +
    '    </div>\n' +
    '    <div id="blog-content">\n' +
    '      <div class="blog-content">' + articleHtml + '</div>\n' +
    '    </div>\n' +
    '\n' +
    '    <div class="blog-footer">\n' +
    '      <div class="ap-footer-logo"><img src="/images/ambient-pixel-logo-rainbow.png" alt="Ambient Pixels" /></div>\n' +
    '      <div class="ap-footer-tagline">Built on the Grid.</div>\n' +
    '      <div class="ap-footer-links"><a href="/">Home</a> · <a href="/blog/">Blog</a> · <a href="/log/">Activity Log</a> · <a href="/nova/">Nova</a></div>\n' +
    '      <div class="ap-footer-legal">&copy; 2026 AmbientPixels.ai · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></div>\n' +
    '    </div>\n' +
    '  </div>\n' +
    '\n' +
    '  <script src="/blog/blog.js"></script>\n' +
    '</body>\n' +
    '</html>';
}

module.exports = async function (context, req) {
  // Slug comes from route binding, query param, or parsed from URL path
  var slug = (context.bindingData && context.bindingData.slug) || (req.query && req.query.slug) || '';

  // Fallback: parse from the request URL path (handles SWA rewrite scenarios)
  if (!slug && req.url) {
    var urlPath = req.url.split('?')[0];
    var parts = urlPath.split('/').filter(Boolean);
    // URL may be /api/blogSSR/my-slug or just /my-slug after rewrite
    var ssrIdx = parts.indexOf('blogSSR');
    if (ssrIdx !== -1 && parts[ssrIdx + 1]) {
      slug = parts[ssrIdx + 1];
    } else if (parts.length > 0) {
      slug = parts[parts.length - 1];
    }
  }

  if (!slug) {
    context.res = { status: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Missing slug' };
    return;
  }

  try {
    var posts = (await storage.getState('blogPosts')) || [];
    var post = posts.find(function (p) { return p.slug === slug; });

    if (!post) {
      context.res = { status: 404, headers: { 'Content-Type': 'text/html' }, body: '<h1>Post not found</h1><p><a href="/blog/">Back to blog</a></p>' };
      return;
    }

    // Resolve hero image
    if (post.hero_image_asset_id) {
      try {
        var assets = (await storage.getState('imageAssets')) || [];
        var asset = assets.find(function (a) { return a.id === post.hero_image_asset_id; });
        if (asset) post.hero_image = { url: asset.url, alt: asset.alt || post.title };
      } catch (_) { /* non-fatal */ }
    }

    var html = buildPage(post, slug);

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      },
      body: html
    };
  } catch (err) {
    context.log.error('[BlogSSR] Error:', err.message);
    context.res = { status: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Server error' };
  }
};
