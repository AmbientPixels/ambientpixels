/**
 * CardForge Global Nav — single source of truth for the cf-splash-nav
 * header chrome across every CardForge page.
 *
 * Usage:
 *   <header data-cf-nav></header>                     (home — no active link)
 *   <header data-cf-nav="gallery"></header>           (highlight Gallery)
 *   <header data-cf-nav="decks"></header>             (highlight Decks)
 *   <header data-cf-nav="admin" data-cf-nav-extras="admin"></header>
 *
 * Notes:
 *   - Auto-mounts on DOMContentLoaded (or immediately if DOM is ready).
 *   - Idempotent — safe to re-mount; no-op if already mounted.
 *   - Owns auth: fetches /.auth/me, swaps Sign in <-> avatar dropdown,
 *     wires popover open/close + Escape + outside-click. Caches the
 *     principal at window._cfPrincipal and exposes a Promise at
 *     window._cfPrincipalReady so other modules can await it without
 *     hitting /.auth/me a second time.
 *   - Editor uses its own compact cf-page-bar; login is brand-only.
 *     Both opt out by simply not including the data-cf-nav placeholder.
 */
(function () {
  'use strict';

  var ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];

  // Registry of nav links — order matters (rendered left to right).
  // Each entry: { key, label, href, splashCta? } — `key` matches the
  // page's data-cf-nav value for active-state highlighting.
  var LINKS = [
    { key: 'gallery', label: 'Gallery', href: '/cardforge/gallery.html' },
    { key: 'decks',   label: 'Decks',   href: '/cardforge/deck.html' },
    { key: 'forge',   label: 'Forge',   href: '/cardforge/forge.html' },
    { key: 'editor',  label: 'Editor',  href: '/cardforge/editor.html', splashCta: 'nav-open-editor' }
  ];

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function buildLinks(activeKey, extras, isAdmin) {
    var html = '';
    var i;

    // Standard links — Gallery, Decks rendered before auth chrome
    for (i = 0; i < LINKS.length; i++) {
      var link = LINKS[i];
      if (link.key === 'editor') continue; // editor link is rendered AFTER auth chrome
      html += renderLink(link, activeKey);
    }

    // Optional Admin link — only if the page asks for it AND user is admin.
    // Hidden by default; flipped on once auth resolves.
    if (extras.indexOf('admin') !== -1) {
      html += '<a href="/cardforge/admin.html" data-cf-admin-link' +
        (isAdmin ? '' : ' hidden') +
        (activeKey === 'admin' ? ' class="cf-nav-active" aria-current="page"' : '') +
        '>Admin</a>';
    }

    // Auth chrome — login button + user dropdown (mutually exclusive)
    html += buildAuthMarkup();

    // Editor link comes after the auth chrome (matches splash + gallery)
    var editorLink = LINKS.filter(function (l) { return l.key === 'editor'; })[0];
    if (editorLink) html += renderLink(editorLink, activeKey);

    return html;
  }

  function renderLink(link, activeKey) {
    var attrs = ' href="' + escAttr(link.href) + '"';
    if (link.splashCta) attrs += ' data-splash-cta="' + escAttr(link.splashCta) + '"';
    if (link.key === activeKey) attrs += ' class="cf-nav-active" aria-current="page"';
    return '<a' + attrs + '>' + escAttr(link.label) + '</a>';
  }

  function buildAuthMarkup() {
    var here = window.location.pathname + window.location.search;
    return '' +
      '<button id="cf-login-btn" class="cf-splash-nav__auth cf-splash-nav__auth--login" type="button" hidden>' +
        '<i class="fas fa-right-to-bracket" aria-hidden="true"></i>' +
        '<span>Sign in</span>' +
      '</button>' +
      '<div class="cf-splash-nav__user-wrap" id="cf-user-wrap" hidden>' +
        '<button class="cf-splash-nav__avatar" id="cf-user-avatar" type="button" title="Account" aria-label="Account menu" aria-haspopup="true" aria-expanded="false">' +
          '<i class="fas fa-user" aria-hidden="true"></i>' +
        '</button>' +
        '<div class="cf-splash-nav__menu" id="cf-user-menu" hidden role="menu">' +
          '<div class="cf-splash-nav__menu-meta">' +
            'Signed in as <strong class="cf-splash-nav__user-name"></strong>' +
          '</div>' +
          '<a class="cf-splash-nav__menu-item" href="/.auth/logout?post_logout_redirect_uri=' + encodeURIComponent(here) + '" role="menuitem">' +
            '<i class="fas fa-right-from-bracket" aria-hidden="true"></i>' +
            '<span>Sign out</span>' +
          '</a>' +
        '</div>' +
      '</div>';
  }

  function brandMarkup() {
    return '' +
      '<a class="cf-splash-nav__brand" href="/cardforge/">' +
        '<i class="fas fa-fire-flame-curved cf-splash-nav__brand-mark" aria-hidden="true"></i>' +
        '<span>CardForge</span>' +
      '</a>';
  }

  // ---- Auth -----------------------------------------------------------

  // Single shared principal Promise. Other modules can await this
  // instead of hitting /.auth/me again.
  function loadPrincipal() {
    if (window._cfPrincipalReady) return window._cfPrincipalReady;
    window._cfPrincipalReady = (async function () {
      try {
        var res = await fetch('/.auth/me', { credentials: 'include' });
        if (!res.ok) return null;
        var data = await res.json();
        var p = Array.isArray(data && data.clientPrincipal)
          ? data.clientPrincipal[0]
          : ((data && data.clientPrincipal) || null);
        window._cfPrincipal = p || null;
        return p || null;
      } catch (_) {
        window._cfPrincipal = null;
        return null;
      }
    })();
    return window._cfPrincipalReady;
  }

  function isAdminPrincipal(p) {
    return !!(p && p.userId && ADMIN_USER_IDS.indexOf(p.userId) !== -1);
  }

  // ---- Wiring ---------------------------------------------------------

  function wireHeader(headerEl) {
    var loginBtn = headerEl.querySelector('#cf-login-btn');
    var userWrap = headerEl.querySelector('#cf-user-wrap');
    var avatarBtn = headerEl.querySelector('#cf-user-avatar');
    var menu = headerEl.querySelector('#cf-user-menu');
    var adminLink = headerEl.querySelector('[data-cf-admin-link]');

    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        var here = window.location.pathname + window.location.search;
        window.location.href = '/cardforge/login.html?redirect=' + encodeURIComponent(here);
      });
    }

    loadPrincipal().then(function (principal) {
      if (principal && principal.userDetails) {
        var nameEl = userWrap && userWrap.querySelector('.cf-splash-nav__user-name');
        if (nameEl) nameEl.textContent = principal.userDetails;
        if (userWrap) userWrap.hidden = false;
        if (loginBtn) loginBtn.hidden = true;
      } else {
        if (loginBtn) loginBtn.hidden = false;
        if (userWrap) userWrap.hidden = true;
      }
      // Admin link visibility — only show to admins. Markup is hidden
      // by default at injection time; we flip it on after auth resolves.
      if (adminLink && isAdminPrincipal(principal)) adminLink.hidden = false;
    });

    if (avatarBtn && menu) {
      avatarBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !menu.hidden;
        menu.hidden = open;
        avatarBtn.setAttribute('aria-expanded', String(!open));
      });
      document.addEventListener('click', function (e) {
        if (menu.hidden) return;
        if (e.target === avatarBtn || avatarBtn.contains(e.target)) return;
        if (menu.contains(e.target)) return;
        menu.hidden = true;
        avatarBtn.setAttribute('aria-expanded', 'false');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !menu.hidden) {
          menu.hidden = true;
          avatarBtn.setAttribute('aria-expanded', 'false');
          avatarBtn.focus();
        }
      });
    }
  }

  // ---- Mount ----------------------------------------------------------

  function mountOne(headerEl) {
    if (headerEl.dataset.cfNavMounted === '1') return;
    headerEl.dataset.cfNavMounted = '1';

    var activeKey = headerEl.getAttribute('data-cf-nav') || '';
    var extrasAttr = headerEl.getAttribute('data-cf-nav-extras') || '';
    var extras = extrasAttr.split(/[\s,]+/).filter(Boolean);

    headerEl.classList.add('cf-splash-nav');
    headerEl.innerHTML =
      brandMarkup() +
      '<div class="cf-splash-nav__links">' + buildLinks(activeKey, extras, false) + '</div>';

    wireHeader(headerEl);
  }

  function mount() {
    var headers = document.querySelectorAll('header[data-cf-nav]');
    for (var i = 0; i < headers.length; i++) mountOne(headers[i]);
  }

  window.CardForgeNav = { mount: mount };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
