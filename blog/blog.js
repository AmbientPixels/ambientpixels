// blog.js — Journal viewer for AmbientPixels (DS-compliant template)
// Emits .ap-* markup; relies on /css/ap-components.css + /blog/blog.css.
(function () {
  'use strict';

  if (window.ProductAnalytics) ProductAnalytics.init('blog');

  var API_BASE = (window.location.hostname.indexOf('ambientpixels.ai') !== -1)
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  var headerEl  = document.getElementById('blog-header');
  var contentEl = document.getElementById('blog-content');
  var loadingEl = document.getElementById('blog-loading');
  var errorEl   = document.getElementById('blog-error');

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

  // ---- Loaders --------------------------------------------------------

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
        if (window.ProductAnalytics) try { ProductAnalytics.track('post_viewed', { slug: slug, title: post.title || '' }); } catch(_){}
        try {
          var fp = (navigator.userAgent || '').slice(0, 64);
          var _utmSource = null, _utmContent = null;
          try {
            var _sp = new URLSearchParams(window.location.search);
            _utmSource = _sp.get('utm_source');
            _utmContent = _sp.get('utm_content');
          } catch (_e) { /* old browsers */ }
          fetch(API_BASE + '/blog-views', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: slug,
              fp: fp,
              referrer: document.referrer || '',
              url: window.location.href,
              utm_source: _utmSource,
              utm_content: _utmContent
            })
          }).catch(function () { /* silent */ });
        } catch (_e) { /* silent */ }
      })
      .catch(function (err) {
        if (err && err.code === 'NOT_FOUND') {
          showError('Post not found.', 'No journal entry with slug "' + esc(slug) + '".');
        } else {
          showError('Could not load post.', 'A network or server error occurred. Please try again.');
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
      .then(function (posts) { renderIndex(posts); })
      .catch(function () {
        showError('Could not load journal.', 'A network or server error occurred.');
      });
  }

  // ---- Renderers ------------------------------------------------------

  // Single entry — DS §4.5 "single entry template."
  function renderPost(post) {
    document.title = post.title + ' — AmbientPixels Journal';

    // OG meta for sharing
    var heroImg = post.hero_image || null;
    var heroUrl = (heroImg && heroImg.url) || post.cover_image || '';
    setMeta('og:title', post.title + ' — AmbientPixels Journal');
    setMeta('og:description', post.excerpt || post.title);
    setMeta('og:url', window.location.href);
    setMeta('description', post.excerpt || post.title);
    if (heroUrl) {
      setMeta('og:image', heroUrl);
      setMeta('og:type', 'article');
    }

    var dateStr = formatISO(post.published_at);
    var kindLabel = (post.kind || 'entry').toUpperCase();
    var readTime = estimateReadTime(post.content_md);

    // Title — split last 1–2 words as the italic punchline if title ends
    // in a period-style closing; otherwise italic just the final word.
    var titleHtml = italicizePunchline(post.title);

    var heroHtml = heroUrl
      ? '<div class="ap-journal-hero-image">' +
          '<img src="' + esc(heroUrl) + '" alt="' + esc((heroImg && heroImg.alt) || post.title) + '" loading="eager">' +
        '</div>'
      : '';

    var metaRail = '<div class="ap-sec-meta">' +
        (post.excerpt ? esc(post.excerpt) : 'Field notes from AmbientPixels.') +
      '</div>';

    headerEl.innerHTML =
      '<section class="ap-sec ap-journal-head">' +
        '<div class="ap-sec-head">' +
          '<div>' +
            '<div class="ap-sec-idx">' +
              '§ JOURNAL' +
              (post.kind ? ' / ' + esc(kindLabel) : '') +
              (dateStr ? ' &mdash; ' + esc(dateStr) : '') +
            '</div>' +
            '<h1 class="ap-display ap-journal-title">' + titleHtml + '</h1>' +
            (readTime ? '<div class="ap-journal-readtime">' + esc(readTime) + '</div>' : '') +
          '</div>' +
          metaRail +
        '</div>' +
        heroHtml +
      '</section>';

    // Render markdown body into .ap-journal-body
    var rawMd = post.content_md || '';
    // Some stored posts were saved wrapped in an explicit ```markdown fence;
    // marked would otherwise render the entire body as a single code block.
    rawMd = rawMd.replace(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```\s*$/i, '$1');
    var bodyHtml;
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      bodyHtml = DOMPurify.sanitize(marked.parse(rawMd), { USE_PROFILES: { html: true } });
    } else if (typeof marked !== 'undefined') {
      bodyHtml = '<p class="ap-journal-warn">Sanitizer unavailable — rendering as plain text.</p><pre>' + esc(rawMd) + '</pre>';
    } else {
      bodyHtml = '<pre>' + esc(rawMd) + '</pre>';
    }

    contentEl.innerHTML =
      '<section class="ap-sec ap-journal-body-sec">' +
        '<div class="ap-journal-body">' + bodyHtml + '</div>' +
        '<div class="ap-journal-nav">' +
          '<a class="ap-link-mono" href="/blog/">&larr; All dispatches.</a>' +
        '</div>' +
      '</section>';

    show('doc');
  }

  // Index — DS §4.5 "entries index."
  function renderIndex(posts) {
    document.title = 'Journal — AmbientPixels';

    headerEl.innerHTML =
      '<section class="ap-sec">' +
        '<div class="ap-sec-head">' +
          '<div>' +
            '<div class="ap-sec-idx">§ JOURNAL &mdash; DISPATCHES</div>' +
            '<h2 class="ap-display">Dispatches from<br><em>a running company.</em></h2>' +
          '</div>' +
          '<div class="ap-sec-meta">' +
            'Field notes, runbooks, and release notes. Published as they land. Not a content calendar.' +
          '</div>' +
        '</div>' +
        '<nav class="ap-journal-subnav" aria-label="Journal sub-nav">' +
          '<a href="/">Home</a>' +
          '<a href="/log/">Activity Log</a>' +
          '<a href="/nova/">Nova</a>' +
        '</nav>' +
      '</section>';

    if (!posts || posts.length === 0) {
      contentEl.innerHTML =
        '<section class="ap-sec">' +
          '<div class="ap-journal-empty">No dispatches published yet. Check back soon.</div>' +
        '</section>';
      show('doc');
      return;
    }

    var rows = posts.map(function (p, idx) {
      var n = String(idx + 1).padStart(2, '0');
      var dateStr = formatISO(p.published_at);
      var kindLabel = (p.kind || 'entry').toUpperCase();
      var readTime = estimateReadTime(p.content_md || '');
      var titleHtml = italicizePunchline(p.title);

      return (
        '<a class="ap-pd op-archive" href="/blog/' + esc(p.slug) + '">' +
          '<span class="n">' + n + '</span>' +
          '<div>' +
            '<h3>' + titleHtml + '</h3>' +
            '<span class="meta">' +
              (dateStr ? esc(dateStr) : '') +
              (dateStr && kindLabel ? ' &middot; ' : '') +
              esc(kindLabel) +
            '</span>' +
          '</div>' +
          '<p>' + esc(p.excerpt || '') + '</p>' +
          '<span class="year">' + esc(readTime || '&nbsp;') + '</span>' +
          '<span class="go" aria-hidden="true">&rarr;</span>' +
        '</a>'
      );
    }).join('');

    contentEl.innerHTML =
      '<section class="ap-sec">' +
        '<div class="ap-prods ap-shipped">' + rows + '</div>' +
      '</section>';

    show('doc');
  }

  // ---- State helpers --------------------------------------------------

  function show(state) {
    loadingEl.style.display = state === 'loading' ? '' : 'none';
    errorEl.style.display   = state === 'error'   ? '' : 'none';
    headerEl.style.display  = state === 'doc'     ? '' : 'none';
    contentEl.style.display = state === 'doc'     ? '' : 'none';
  }

  function showError(title, detail) {
    errorEl.innerHTML =
      '<section class="ap-sec">' +
        '<div class="ap-sec-idx">§ ERROR</div>' +
        '<h2 class="ap-display ap-journal-title">' + esc(title) + '</h2>' +
        '<p class="ap-journal-error-detail">' + esc(detail) + '</p>' +
        '<a class="ap-link-mono" href="/blog/">&larr; All dispatches.</a>' +
      '</section>';
    show('error');
  }

  // ---- Formatters -----------------------------------------------------

  // Wrap the last 1–2 words of a title in <em> + trailing period, per DS
  // §3.2 italic-punchline rule. If the title already ends with a period,
  // we respect it; otherwise we add one.
  function italicizePunchline(title) {
    if (!title) return '';
    var t = String(title).trim();
    // Strip trailing period so we can re-append after the em.
    var hadPeriod = /\.$/.test(t);
    t = t.replace(/\.$/, '');

    var words = t.split(/\s+/);
    if (words.length <= 2) {
      return '<em>' + esc(t) + '.</em>';
    }
    var tailLen = words.length >= 5 ? 2 : 1;
    var head = words.slice(0, words.length - tailLen).join(' ');
    var tail = words.slice(-tailLen).join(' ');
    return esc(head) + ' <em>' + esc(tail) + '.</em>';
  }

  function formatISO(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function estimateReadTime(md) {
    if (!md) return '';
    var words = String(md).split(/\s+/).filter(Boolean).length;
    var mins = Math.max(1, Math.round(words / 200));
    return mins + ' MIN';
  }

  function setMeta(name, content) {
    var el = document.querySelector('meta[property="' + name + '"]') ||
             document.querySelector('meta[name="' + name + '"]');
    if (el) el.setAttribute('content', content);
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
