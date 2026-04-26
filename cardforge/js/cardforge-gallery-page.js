/**
 * CardForge Gallery Page
 * Fetches published cards, renders them as a sortable grid, opens any
 * card in the lightbox on click. Uses the same renderedFront +
 * frontClasses payload pipeline as the splash showcase strip.
 *
 * Sort options:
 *   - recent  → newest createdAt first
 *   - rated   → curated/default cards first (placeholder until a real
 *               rating system lands), then by createdAt desc
 *   - all     → same data set, sorted by createdAt desc
 */
(function () {
  'use strict';

  var API_LOAD_CARDS = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';

  var allCards = [];
  var currentSort = 'recent';

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cssUrl(src) {
    return "url('" + String(src).replace(/\\/g, '\\\\').replace(/'/g, '%27') + "')";
  }

  function normalizeCard(entry) {
    var cd = entry.cardData || entry;
    var name = cd.name || entry.name || '';
    var characterClass = cd.characterClass || entry.characterClass || cd.class || entry.class || '';
    var avatar = cd.avatar || entry.avatar || entry.image || '';
    var id = entry.id || cd.id || cd.shareId || '';
    var renderedFront = cd.renderedFront || null;
    var frontClasses = cd.frontClasses || null;
    var createdAt = cd.createdAt || entry.createdAt || cd.publishedAt || entry.publishedAt || null;
    var isDefault = !!(entry.isDefault || cd.isDefault);
    if (!name && !renderedFront) return null;
    return {
      id: id,
      name: name,
      characterClass: characterClass,
      avatar: avatar,
      renderedFront: renderedFront,
      frontClasses: frontClasses,
      createdAt: createdAt,
      isDefault: isDefault,
      raw: entry
    };
  }

  async function fetchPublishedCards() {
    try {
      var headers = {};
      try {
        if (typeof window._cfGetAuthHeaders === 'function') {
          headers = await window._cfGetAuthHeaders();
        }
      } catch (_) {}
      var res = await fetch(API_LOAD_CARDS, { headers: headers, credentials: 'omit' });
      if (!res.ok) return [];
      var data = await res.json();
      var pool = [];
      if (Array.isArray(data)) pool = data;
      else if (data) {
        pool = []
          .concat(data.galleryCards || [])
          .concat(data.defaultCards || [])
          .concat(data.userCards || []);
      }
      return pool.map(normalizeCard).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function timeOf(c) {
    return c.createdAt ? new Date(c.createdAt).getTime() : 0;
  }

  function sortCards(cards, sort) {
    var copy = cards.slice();
    if (sort === 'rated') {
      // Real rating-driven sort. Tiebreak by recency so the gallery
      // doesn't look randomized at day-zero when most cards have count=0.
      var H = window.CardForgeHearts;
      copy.sort(function (a, b) {
        var ca = (H && a.id) ? (H.getCount(a.id) || 0) : 0;
        var cb = (H && b.id) ? (H.getCount(b.id) || 0) : 0;
        return (cb - ca) || (timeOf(b) - timeOf(a));
      });
    } else {
      // recent + all → newest first
      copy.sort(function (a, b) { return timeOf(b) - timeOf(a); });
    }
    return copy;
  }

  function renderCardContent(c) {
    if (c.renderedFront && c.frontClasses) {
      return '<div class="mini-card-scaler"><div class="' + escHtml(c.frontClasses) + '">' + c.renderedFront + '</div></div>';
    }
    // Fallback for cards lacking renderedFront — portrait + label.
    return (
      '<div class="cf-mini-fallback">' +
        '<div class="cf-mini-fallback__portrait" style="background-image: ' + cssUrl(c.avatar || '') + ';"></div>' +
        '<div class="cf-mini-fallback__label">' +
          '<span class="cf-mini-fallback__name">' + escHtml(c.name) + '</span>' +
          (c.characterClass ? '<span class="cf-mini-fallback__class">' + escHtml(c.characterClass) + '</span>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function showLoader() {
    var loader = document.getElementById('cf-gallery-loader');
    var grid = document.getElementById('cf-gallery-grid');
    if (loader) loader.hidden = false;
    if (grid) grid.hidden = true;
  }

  function hideLoader() {
    var loader = document.getElementById('cf-gallery-loader');
    var grid = document.getElementById('cf-gallery-grid');
    if (loader) loader.hidden = true;
    if (grid) grid.hidden = false;
  }

  function setCount(n) {
    var el = document.getElementById('cf-gallery-count');
    if (!el) return;
    el.textContent = n === 0 ? '' : (n === 1 ? '1 card' : n + ' cards');
  }

  function render(sort) {
    var grid = document.getElementById('cf-gallery-grid');
    var empty = document.getElementById('cf-gallery-empty');
    if (!grid || !empty) return;

    var sorted = sortCards(allCards, sort);
    setCount(sorted.length);

    if (!sorted.length) {
      grid.innerHTML = '';
      grid.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    grid.hidden = false;

    grid.innerHTML = sorted.map(function (c, i) {
      var heartHtml = (window.CardForgeHearts && c.id)
        ? window.CardForgeHearts.renderButton(c.id, { withCount: true, variant: 'gallery' })
        : '';
      // Wrap card button + heart as siblings inside a positioned wrapper.
      // Nesting <button> inside <button> is invalid HTML — browsers
      // auto-close the outer button when they parse the inner one,
      // which would render the heart as a SIBLING of the card in the
      // grid. The wrapper makes the sibling layout intentional and
      // gives the heart an absolute-positioning anchor.
      return (
        '<div class="cf-gallery__card-wrap">' +
          '<button type="button" class="cf-gallery__card mini-card" ' +
                  'data-card-index="' + i + '" ' +
                  'aria-label="' + escHtml('View ' + (c.name || 'card')) + '">' +
            renderCardContent(c) +
          '</button>' +
          heartHtml +
        '</div>'
      );
    }).join('');

    // Heart clicks must NOT bubble into the lightbox-open handler. Bind
    // the hearts module first (it stops propagation on its own clicks),
    // then wire card clicks → lightbox.
    if (window.CardForgeHearts && typeof window.CardForgeHearts.bindContainer === 'function') {
      window.CardForgeHearts.bindContainer(grid);
    }
    grid.querySelectorAll('.cf-gallery__card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.cardIndex, 10);
        if (window.CardForgeLightbox && typeof window.CardForgeLightbox.open === 'function') {
          var rawList = sorted.map(function (c) { return c.raw; });
          window.CardForgeLightbox.open(rawList, idx);
          if (window.ProductAnalytics && window.ProductAnalytics.track) {
            try { window.ProductAnalytics.track('cardforge.gallery.card_open', { id: sorted[idx].id, sort: sort }); } catch (_) {}
          }
        }
      });
    });
  }

  function wireFilters() {
    var pills = document.querySelectorAll('.cf-gallery__filter');
    pills.forEach(function (p) {
      p.addEventListener('click', function () {
        pills.forEach(function (q) {
          var active = q === p;
          q.classList.toggle('is-active', active);
          q.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        currentSort = p.dataset.sort || 'recent';
        render(currentSort);
        if (window.ProductAnalytics && window.ProductAnalytics.track) {
          try { window.ProductAnalytics.track('cardforge.gallery.sort', { sort: currentSort }); } catch (_) {}
        }
      });
    });
  }

  async function initAuth() {
    // Mirrors the splash auth pattern (cardforge-splash.js initAuth):
    // login button when signed out, avatar with popover menu when
    // signed in. Popover toggles on avatar click, closes on outside
    // click or Escape. Sign-out link inside the popover preserves
    // current page via post_logout_redirect_uri.
    var loginBtn = document.getElementById('cf-login-btn');
    var userWrap = document.getElementById('cf-user-wrap');
    var avatarBtn = document.getElementById('cf-user-avatar');
    var menu = document.getElementById('cf-user-menu');
    if (!loginBtn || !userWrap) return;
    try {
      var res = await fetch('/.auth/me', { credentials: 'include' });
      if (!res.ok) throw new Error('auth fetch failed');
      var data = await res.json();
      var principal = Array.isArray(data && data.clientPrincipal)
        ? data.clientPrincipal[0]
        : ((data && data.clientPrincipal) || null);
      if (principal && principal.userDetails) {
        var nameEl = userWrap.querySelector('.cf-splash-nav__user-name');
        if (nameEl) nameEl.textContent = principal.userDetails;
        userWrap.hidden = false;
        loginBtn.hidden = true;
      } else {
        loginBtn.hidden = false;
        userWrap.hidden = true;
      }
    } catch (_) {
      loginBtn.hidden = false;
      userWrap.hidden = true;
    }
    loginBtn.addEventListener('click', function () {
      // Route through the CardForge-themed login page so the user picks
      // Google vs Microsoft. The login page's redirect param sends them
      // back to the gallery after auth.
      window.location.href = '/cardforge/login.html?redirect=' + encodeURIComponent('/cardforge/gallery.html');
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

  async function init() {
    wireFilters();
    initAuth();
    showLoader();
    // Run hearts boot + cards fetch in parallel so we don't serialize
    // network roundtrips. Hearts module fetches /cardforgeratings and
    // /cardforgefavorites; cards fetch hits /cardforgeloadcards.
    var heartsBoot = (window.CardForgeHearts && typeof window.CardForgeHearts.init === 'function')
      ? window.CardForgeHearts.init()
      : Promise.resolve();
    var results = await Promise.all([fetchPublishedCards(), heartsBoot]);
    allCards = results[0];
    hideLoader();
    render(currentSort);

    // When a heart toggles anywhere (here, in the lightbox, in the
    // editor favorites tab), refresh count badges in place. We don't
    // re-render the grid — the heart button refreshes itself via
    // CardForgeHearts.refreshButtons, and only the rated-sort needs a
    // re-sort. Skip the re-sort if we're not on the rated tab.
    document.addEventListener(window.CardForgeHearts && window.CardForgeHearts.EVENT_CHANGED || 'cardforge:hearts-changed', function () {
      if (currentSort === 'rated') render(currentSort);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
