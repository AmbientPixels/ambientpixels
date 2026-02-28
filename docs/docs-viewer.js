// docs-viewer.js — Fetches and renders published documents
(function () {
  'use strict';

  var API_BASE = (window.location.hostname.indexOf('ambientpixels.ai') !== -1)
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  var headerEl = document.getElementById('docs-header');
  var contentEl = document.getElementById('docs-content');
  var loadingEl = document.getElementById('docs-loading');
  var errorEl = document.getElementById('docs-error');

  // Parse slug from path: /docs/published/my-slug → "my-slug"
  var pathParts = window.location.pathname.replace(/\/$/, '').split('/');
  var slug = '';
  // Find the segment after "published"
  for (var i = 0; i < pathParts.length; i++) {
    if (pathParts[i] === 'published' && i + 1 < pathParts.length && pathParts[i + 1]) {
      slug = pathParts[i + 1];
      break;
    }
  }

  // Internal docs pipeline removed — redirect to blog
  showError('Internal docs retired', 'All documents are now published to the blog.');

  function loadSingleDoc() {}
  function loadDocIndex() {}

  function renderDoc(doc) {
    document.title = doc.title + ' — AmbientPixels Docs';

    var heroImg = doc.hero_image || null;
    var heroHtml = '';
    if (heroImg && heroImg.url) {
      heroHtml = '<div class="docs-hero-image">' +
        '<img src="' + esc(heroImg.url) + '" alt="' + esc(heroImg.alt || doc.title) + '" loading="eager">' +
      '</div>';
    }

    headerEl.innerHTML =
      '<h1 class="docs-title">' + esc(doc.title) + '</h1>' +
      '<div class="docs-meta">' +
        '<span class="docs-kind-badge">' + esc(doc.kind || 'doc') + '</span>' +
        (doc.published_at ? '<span><i class="fas fa-calendar"></i> ' + formatDate(doc.published_at) + '</span>' : '') +
        (doc.created_by ? '<span><i class="fas fa-user"></i> ' + esc(doc.created_by) + '</span>' : '') +
        (doc.tags && doc.tags.length ? '<span><i class="fas fa-tags"></i> ' + doc.tags.map(esc).join(', ') + '</span>' : '') +
      '</div>' +
      heroHtml;

    // Render markdown via marked.js + sanitize with DOMPurify
    var rawMd = doc.content_md || '';
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      var rawHtml = marked.parse(rawMd);
      contentEl.innerHTML = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
    } else if (typeof marked !== 'undefined') {
      // marked loaded but DOMPurify missing — do NOT render unsanitized HTML
      contentEl.innerHTML = '<p class="docs-warning">' +
        '<i class="fas fa-exclamation-triangle"></i> Sanitizer unavailable — rendering as plain text for safety.</p>' +
        '<pre class="docs-fallback-pre">' + esc(rawMd) + '</pre>';
    } else {
      // No renderer at all — escaped plain text
      contentEl.innerHTML = '<pre class="docs-fallback-pre">' + esc(rawMd) + '</pre>';
    }

    show('doc');
  }

  function renderIndex(docs) {
    document.title = 'Published Docs — AmbientPixels';

    headerEl.innerHTML =
      '<h1 class="docs-title">Published Documents</h1>' +
      '<div class="docs-meta"><span>AmbientPixels company documentation</span></div>';

    if (!docs || docs.length === 0) {
      contentEl.innerHTML = '<p style="opacity:0.4; text-align:center; padding:2rem 0;">No published documents yet.</p>';
      show('doc');
      return;
    }

    // Sort newest first
    docs.sort(function (a, b) {
      return new Date(b.published_at || 0) - new Date(a.published_at || 0);
    });

    var html = '<ul class="docs-index-list">';
    docs.forEach(function (d) {
      html += '<a href="/docs/published/' + esc(d.slug) + '" class="docs-index-item">' +
        '<div class="docs-index-title">' + esc(d.title) + '</div>' +
        '<div class="docs-index-meta">' +
          '<span class="docs-kind-badge">' + esc(d.kind || 'doc') + '</span>' +
          (d.published_at ? '<span>' + formatDate(d.published_at) + '</span>' : '') +
        '</div>' +
      '</a>';
    });
    html += '</ul>';

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
    errorEl.innerHTML = '<h2 style="font-size:1.2rem; margin-bottom:0.5rem;">' + esc(title) + '</h2>' +
      '<p>' + esc(detail) + '</p>' +
      '<a href="/docs/published/" style="display:inline-block; margin-top:1rem; color:#8A2BE2; font-size:0.8rem;">← All documents</a>';
    show('error');
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
