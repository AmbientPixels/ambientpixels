// render.js — server-side article page for /blog/<slug>. Pure: no I/O.
//
// Why this exists: /blog/* is an SPA rewrite, so crawlers (X, LinkedIn,
// Google) always saw the shell's generic meta — every share card said
// "AmbientPixels — Journal" with no image, for every article ever published.
// This emits the SAME shell (head, nav, containers, footer, scripts) with the
// article's meta swapped in and a crawler-readable body pre-rendered into the
// containers. blog.js then hydrates over it in the browser, so humans get the
// exact client experience they always had.
//
// Keep the template in sync with blog/index.html if the shell changes.

const SITE = 'https://www.ambientpixels.ai';
const FALLBACK_OG = SITE + '/images/og/og-blog.png'; // /images/* passes the router; /blog/*.png did not

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return SITE + (s.charAt(0) === '/' ? '' : '/') + s;
}

// Inline transforms applied to already-escaped text. Order matters: images
// before links (shared bracket syntax), bold before italic (shared asterisk).
function inline(escText) {
  return escText
    .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

function renderBlocks(escText) {
  const blocks = escText.split(/\n{2,}/);
  let out = '';
  blocks.forEach(function (block) {
    const b = block.trim();
    if (!b) return;
    const h = b.match(/^(#{1,4})\s+(.+)$/);
    if (h && b.indexOf('\n') === -1) {
      const level = h[1].length + 1; // md # → h2: the article title owns the h1
      out += '<h' + level + '>' + inline(h[2].trim()) + '</h' + level + '>';
      return;
    }
    const lines = b.split('\n');
    if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) {
      out += '<ul>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
      return;
    }
    if (lines.every(function (l) { return /^\s*\d+\.\s+/.test(l); })) {
      out += '<ol>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*\d+\.\s+/, '')) + '</li>'; }).join('') + '</ol>';
      return;
    }
    out += '<p>' + inline(b).replace(/\n/g, '<br />') + '</p>';
  });
  return out;
}

// Deliberately a small, escape-first subset (headings, bold/italic, links,
// images, lists, code). The browser render uses marked + DOMPurify; this one
// only has to be safe and readable for crawlers, never fancy.
function renderMarkdownBasic(md) {
  const esc = escapeHtml(String(md == null ? '' : md));
  const segments = esc.split(/^```[^\n]*$/m);
  let out = '';
  segments.forEach(function (seg, i) {
    if (i % 2 === 1) {
      out += '<pre><code>' + seg.replace(/^\n+|\n+$/g, '') + '</code></pre>';
    } else {
      out += renderBlocks(seg);
    }
  });
  return out;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * @param {object} post  { slug, title, excerpt, content_md, published_at }
 * @param {object|null} hero  { url, alt } already resolved from imageAssets
 * @returns {string} full HTML document
 */
function renderArticlePage(post, hero) {
  post = post || {};
  const title = escapeHtml(post.title || 'Untitled');
  const fullTitle = title + ' — AmbientPixels Journal';
  const desc = escapeHtml(String(post.excerpt || post.title || '').slice(0, 300));
  const url = SITE + '/blog/' + encodeURIComponent(String(post.slug || ''));
  const heroUrl = hero && hero.url ? absoluteUrl(hero.url) : '';
  const ogImage = escapeHtml(heroUrl || FALLBACK_OG);
  const published = String(post.published_at || '');
  const dateLabel = escapeHtml(formatDate(published));
  const bodyHtml = renderMarkdownBasic(post.content_md || '');

  const heroBlock = heroUrl
    ? '<div class="ap-journal-hero-image"><img src="' + escapeHtml(heroUrl) + '" alt="' + escapeHtml((hero && hero.alt) || post.title || '') + '" /></div>'
    : '';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    + '  <meta charset="UTF-8" />\n'
    + '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
    + '  <meta name="description" content="' + desc + '" />\n'
    + '  <link rel="canonical" href="' + url + '" />\n'
    + '  <meta property="og:type" content="article" />\n'
    + '  <meta property="og:title" content="' + fullTitle + '" />\n'
    + '  <meta property="og:description" content="' + desc + '" />\n'
    + '  <meta property="og:url" content="' + url + '" />\n'
    + '  <meta property="og:image" content="' + ogImage + '" />\n'
    + (published ? '  <meta property="article:published_time" content="' + escapeHtml(published) + '" />\n' : '')
    + '  <meta name="twitter:card" content="summary_large_image" />\n'
    + '  <meta name="twitter:title" content="' + fullTitle + '" />\n'
    + '  <meta name="twitter:description" content="' + desc + '" />\n'
    + '  <meta name="twitter:image" content="' + ogImage + '" />\n'
    + '  <link rel="icon" href="/images/favicon.ico" type="image/x-icon" />\n'
    + '  <title>' + fullTitle + '</title>\n'
    + '  <link rel="preconnect" href="https://fonts.googleapis.com" />\n'
    + '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n'
    + '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,400;0,500;0,900;1,400&family=Archivo+Black&family=JetBrains+Mono:wght@400;500&display=swap" />\n'
    + '  <link rel="stylesheet" href="/css/ap-tokens.css" />\n'
    + '  <link rel="stylesheet" href="/css/ap-base.css" />\n'
    + '  <link rel="stylesheet" href="/css/ap-components.css" />\n'
    + '  <script defer src="/js/ap-nav-mobile.js"></script>\n'
    + '  <link rel="stylesheet" href="/blog/blog.css" />\n'
    + '  <script src="/js/telemetry-config.js"></script>\n'
    + '  <script src="/js/telemetry-appinsights.js" defer></script>\n'
    + '  <script src="/js/product-analytics.js" defer></script>\n'
    + '</head>\n'
    // Body attributes mirror blog/index.html verbatim so the page is
    // pixel-identical to the shell before hydration.
    + '<body class="polish-glow polish-tonal polish-hairlines polish-type" data-texture="paper" style="--tx-op: 0.13;">\n'
    + '  <div class="tx-layer" aria-hidden="true"></div>\n'
    + '  <nav class="ap-nav">\n'
    + '    <a class="ap-logo" href="/" aria-label="AmbientPixels home"><span class="m"><i></i></span>AmbientPixels.</a>\n'
    + '    <div class="ap-nav-links">\n'
    + '      <a href="/services/">Services.</a>\n'
    + '      <a href="/products/">Products.</a>\n'
    + '      <a href="/projects/">Work.</a>\n'
    + '      <a href="/about/">Studio.</a>\n'
    + '      <a href="/pulse/">Pulse.</a>\n'
    + '      <a href="/blog/" aria-current="page">Journal.</a>\n'
    + '      <a href="/pages/login.html">Login.</a>\n'
    + '    </div>\n'
    + '    <a class="ap-nav-cta" href="/#start">Start a project &rarr;</a>\n'
    + '  </nav>\n'
    + '  <main>\n'
    + '    <div id="blog-loading" class="ap-journal-status" style="display:none;">Loading&hellip;</div>\n'
    + '    <div id="blog-error" class="ap-journal-status" style="display:none;"></div>\n'
    // Pre-rendered for crawlers; blog.js re-renders these on load.
    + '    <div id="blog-header">\n'
    + '      <section class="ap-sec ap-journal-head">\n'
    + '        <div class="ap-sec-head">\n'
    + '          <div class="ap-sec-idx">&sect; JOURNAL</div>\n'
    + '          <h1 class="ap-display ap-journal-title">' + title + '</h1>\n'
    + (dateLabel ? '          <div class="ap-sec-meta">' + dateLabel + '</div>\n' : '')
    + '        </div>\n'
    + heroBlock
    + '      </section>\n'
    + '    </div>\n'
    + '    <div id="blog-content">\n'
    + '      <section class="ap-sec ap-journal-body-sec">\n'
    + '        <div class="ap-journal-body">' + bodyHtml + '</div>\n'
    + '        <div class="ap-journal-nav"><a class="ap-link-mono" href="/blog/">&larr; All dispatches.</a></div>\n'
    + '      </section>\n'
    + '    </div>\n'
    + '  </main>\n'
    + '  <footer class="ap-foot-wrap">\n'
    + '    <div class="ap-legal"><span>&copy; 2026 AmbientPixels &middot; Est. 2024 &middot; Seattle</span></div>\n'
    + '  </footer>\n'
    + '  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>\n'
    + '  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.3/dist/purify.min.js"></script>\n'
    + '  <script src="/blog/blog.js"></script>\n'
    + '</body>\n</html>\n';
}

module.exports = { renderArticlePage, renderMarkdownBasic, escapeHtml, absoluteUrl };
