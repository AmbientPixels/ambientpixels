// blog.js — Public blog viewer for AmbientPixels
(function () {
  'use strict';

  var API_BASE = (window.location.hostname.indexOf('ambientpixels.ai') !== -1)
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  var headerEl = document.getElementById('blog-header');
  var contentEl = document.getElementById('blog-content');
  var loadingEl = document.getElementById('blog-loading');
  var errorEl = document.getElementById('blog-error');

  // Parse slug from path: /blog/my-slug → "my-slug"
  var pathParts = window.location.pathname.replace(/\/$/, '').split('/');
  var slug = '';
  for (var i = 0; i < pathParts.length; i++) {
    if (pathParts[i] === 'blog' && i + 1 < pathParts.length && pathParts[i + 1]) {
      slug = pathParts[i + 1];
      break;
    }
  }

  if (slug && slug !== 'index.html') {
    loadSinglePost(slug);
  } else {
    loadPostIndex();
  }

  function loadSinglePost(slug) {
    show('loading');
    fetch(API_BASE + '/blogPosts?slug=' + encodeURIComponent(slug))
      .then(function (res) {
        if (res.status === 404) throw { code: 'NOT_FOUND' };
        if (!res.ok) throw { code: 'SERVER_ERROR', status: res.status };
        return res.json();
      })
      .then(function (post) {
        renderPost(post);
      })
      .catch(function (err) {
        if (err && err.code === 'NOT_FOUND') {
          showError('Post not found', 'No blog post with slug "' + esc(slug) + '".');
        } else {
          showError('Could not load post', 'A network or server error occurred. Please try again.');
        }
      });
  }

  function loadPostIndex() {
    show('loading');
    fetch(API_BASE + '/blogPosts')
      .then(function (res) {
        if (!res.ok) throw new Error('Server error');
        return res.json();
      })
      .then(function (posts) {
        renderIndex(posts);
      })
      .catch(function () {
        showError('Could not load blog', 'A network or server error occurred.');
      });
  }

  function renderPost(post) {
    document.title = post.title + ' — AmbientPixels Blog';

    // Update OG meta tags for social sharing
    var heroImg = post.hero_image || null;
    var heroUrl = (heroImg && heroImg.url) || post.cover_image || '';
    setMeta('og:title', post.title + ' — AmbientPixels Blog');
    setMeta('og:description', post.excerpt || post.title);
    setMeta('og:url', window.location.href);
    setMeta('description', post.excerpt || post.title);
    if (heroUrl) {
      setMeta('og:image', heroUrl);
      setMeta('og:type', 'article');
    }

    var heroHtml = '';
    if (heroUrl) {
      heroHtml = '<div class="blog-hero-image">' +
        '<img src="' + esc(heroUrl) + '" alt="' + esc((heroImg && heroImg.alt) || post.title) + '" loading="eager">' +
      '</div>';
    }

    headerEl.innerHTML =
      '<div class="blog-post-header">' +
        '<a href="/blog/" class="blog-back"><i class="fas fa-arrow-left"></i> All Posts</a>' +
        '<h1 class="blog-post-title">' + esc(post.title) + '</h1>' +
        '<div class="blog-post-meta">' +
          '<span class="blog-kind-badge">' + esc(post.kind || 'article') + '</span>' +
          (post.published_at ? '<span><i class="fas fa-calendar"></i> ' + formatDate(post.published_at) + '</span>' : '') +
          (post.created_by ? '<span><i class="fas fa-user"></i> ' + esc(post.created_by) + '</span>' : '') +
          renderTags(post.tags) +
        '</div>' +
        heroHtml +
      '</div>';

    // Render markdown
    var rawMd = post.content_md || '';
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      var rawHtml = marked.parse(rawMd);
      contentEl.innerHTML = '<div class="blog-content">' + DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } }) + '</div>';
    } else if (typeof marked !== 'undefined') {
      contentEl.innerHTML = '<div class="blog-content"><p style="color:#f59e0b;"><i class="fas fa-exclamation-triangle"></i> Sanitizer unavailable — rendering as plain text.</p>' +
        '<pre>' + esc(rawMd) + '</pre></div>';
    } else {
      contentEl.innerHTML = '<div class="blog-content"><pre>' + esc(rawMd) + '</pre></div>';
    }

    show('doc');
  }

  function renderIndex(posts) {
    document.title = 'Blog — AmbientPixels';

    headerEl.innerHTML =
      '<div class="blog-header">' +
        '<h1><i class="fas fa-newspaper"></i>AmbientPixels Blog</h1>' +
        '<p>Articles, insights, and updates from our AI-operated company</p>' +
        '<div class="blog-nav">' +
          '<a href="/">Home</a>' +
          '<a href="/log/">Activity Log</a>' +
          '<a href="/nova/">Nova</a>' +
          '<a href="/cardforge/">CardForge</a>' +
        '</div>' +
      '</div>';

    if (!posts || posts.length === 0) {
      contentEl.innerHTML =
        '<div class="blog-empty">' +
          '<i class="fas fa-feather-alt"></i>' +
          'No posts published yet. Check back soon.' +
        '</div>';
      show('doc');
      return;
    }

    var html = '<div class="blog-grid">';
    posts.forEach(function (p) {
      var cardHero = (p.hero_image && p.hero_image.url) || p.cover_image || '';
      var thumbHtml = cardHero
        ? '<div class="blog-card-thumb"><img src="' + esc(cardHero) + '" alt="' + esc(p.title) + '" loading="lazy"></div>'
        : '';
      html +=
        '<a href="/blog/' + esc(p.slug) + '" class="blog-card' + (cardHero ? ' blog-card--has-thumb' : '') + '">' +
          thumbHtml +
          '<div class="blog-card-body">' +
            '<div class="blog-card-title">' + esc(p.title) + '</div>' +
            (p.excerpt ? '<div class="blog-card-excerpt">' + esc(p.excerpt) + '</div>' : '') +
            '<div class="blog-card-meta">' +
              '<span class="blog-kind-badge">' + esc(p.kind || 'article') + '</span>' +
              (p.published_at ? '<span><i class="fas fa-calendar"></i> ' + formatDate(p.published_at) + '</span>' : '') +
              (p.created_by ? '<span><i class="fas fa-user"></i> ' + esc(p.created_by) + '</span>' : '') +
              renderTags(p.tags) +
            '</div>' +
          '</div>' +
        '</a>';
    });
    html += '</div>';

    contentEl.innerHTML = html;
    show('doc');
  }

  function show(state) {
    loadingEl.style.display = state === 'loading' ? '' : 'none';
    errorEl.style.display = state === 'error' ? '' : 'none';
    headerEl.style.display = state === 'doc' ? '' : 'none';
    contentEl.style.display = state === 'doc' ? '' : 'none';
  }

  function showError(title, detail) {
    errorEl.innerHTML =
      '<div class="blog-error">' +
        '<h2>' + esc(title) + '</h2>' +
        '<p>' + esc(detail) + '</p>' +
        '<a href="/blog/" class="blog-back" style="margin-top:1rem;"><i class="fas fa-arrow-left"></i> All Posts</a>' +
      '</div>';
    show('error');
  }

  function renderTags(tags) {
    if (!tags || !tags.length) return '';
    return tags.slice(0, 4).map(function (t) {
      return '<span class="blog-tag">' + esc(t) + '</span>';
    }).join(' ');
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function setMeta(name, content) {
    var el = document.querySelector('meta[property="' + name + '"]') ||
             document.querySelector('meta[name="' + name + '"]');
    if (el) {
      el.setAttribute('content', content);
    }
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
