/**
 * CardForge splash — continue-draft detection + auth + telemetry.
 *
 * Draft source (per Step 0.4 audit): no dedicated draft key; surface the
 * most recently saved card from cardforge_saved_cards as the "continue"
 * option. If none, banner stays hidden.
 */
(function () {
  'use strict';

  function readMostRecentCard() {
    try {
      var raw = localStorage.getItem('cardforge_saved_cards');
      if (!raw) return null;
      var cards = JSON.parse(raw);
      if (!Array.isArray(cards) || cards.length === 0) return null;
      var newest = cards[0];
      for (var i = 1; i < cards.length; i++) {
        var t1 = Number(cards[i].savedAt || cards[i].updatedAt || cards[i].timestamp || 0);
        var t0 = Number(newest.savedAt || newest.updatedAt || newest.timestamp || 0);
        if (t1 > t0) newest = cards[i];
      }
      return {
        name: newest.name || newest.cardName || 'Untitled card',
        savedAt: newest.savedAt || newest.updatedAt || newest.timestamp || null
      };
    } catch (_) {
      return null;
    }
  }

  function showContinueBanner(card) {
    var banner = document.getElementById('cf-continue-banner');
    if (!banner || !card) return;
    var nameEl = banner.querySelector('.cf-continue-banner__name');
    if (nameEl) nameEl.textContent = card.name;
    banner.hidden = false;
  }

  function trackCTA(e) {
    var btn = e.target.closest('[data-splash-cta]');
    if (!btn) return;
    if (window.ProductAnalytics && typeof window.ProductAnalytics.track === 'function') {
      try { window.ProductAnalytics.track('cardforge.splash.cta', { cta: btn.dataset.splashCta }); } catch (_) {}
    }
  }

  function trackContinue() {
    if (window.ProductAnalytics && typeof window.ProductAnalytics.track === 'function') {
      try { window.ProductAnalytics.track('cardforge.splash.continue', {}); } catch (_) {}
    }
  }

  async function initAuth() {
    var loginBtn = document.getElementById('cf-login-btn');
    var userStatus = document.getElementById('cf-user-status');
    if (!loginBtn || !userStatus) return;

    try {
      var res = await fetch('/.auth/me', { credentials: 'include' });
      if (!res.ok) throw new Error('auth fetch failed: ' + res.status);
      var data = await res.json();
      var principal = Array.isArray(data && data.clientPrincipal)
        ? data.clientPrincipal[0]
        : ((data && data.clientPrincipal) || null);

      if (principal && principal.userDetails) {
        var nameEl = userStatus.querySelector('.cf-splash-nav__user-name');
        if (nameEl) nameEl.textContent = principal.userDetails;
        userStatus.hidden = false;
        loginBtn.hidden = true;
      } else {
        loginBtn.hidden = false;
        userStatus.hidden = true;
      }
    } catch (_) {
      loginBtn.hidden = false;
      userStatus.hidden = true;
    }

    loginBtn.addEventListener('click', function () {
      window.location.href = '/.auth/login/aadB2C?post_login_redirect_uri=/cardforge/';
    });
  }

  // ---- Gallery fetch + render ----------------------------------------

  var API_LOAD_CARDS = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';

  // Preset fallbacks — used as initial placeholders before the API
  // resolves. Once real cards arrive they replace these. Each entry is
  // just a portrait + name + class — no synthesized CardForge card
  // styling (that collides with cardforge-card.css rules).
  var PRESET_FALLBACK = [
    { name: 'Aria Stormwind',     characterClass: 'Fantasy Ranger',    avatar: '/images/image-packs/characters/whispers-of-the-sylvan-queen.jpg' },
    { name: 'Zara-7',             characterClass: 'Cyberpunk Runner',  avatar: '/images/image-packs/characters/cyber-erenity.jpg' },
    { name: 'Dr. Elena Voss',     characterClass: 'Arcane Scholar',    avatar: '/images/image-packs/characters/ethereal-enigma.jpg' },
    { name: 'Commander Rex',      characterClass: 'Space Marine',      avatar: '/images/image-packs/characters/guardian-of-the-gilded-halls.jpg' },
    { name: 'Kenji Nakamura',     characterClass: 'Corporate Ronin',   avatar: '/images/image-packs/characters/the-enigmatic-neuromancer.jpg' },
    { name: 'Captain Nova',       characterClass: 'Legendary Hero',    avatar: '/images/image-packs/characters-03-super-heroes/nova-rivera.png' },
    { name: 'Divine Protector',   characterClass: 'Titan Guardian',    avatar: '/images/image-packs/characters/twilight-titan.jpg' },
    { name: 'Stealth Specialist', characterClass: 'Shadow Operative',  avatar: '/images/image-packs/characters/navigator-kairo.jpg' },
    { name: 'Seraphina',          characterClass: 'Celestial Warden',  avatar: '/images/image-packs/characters/seraphina.jpg' },
    { name: 'Ember Gaze',         characterClass: 'Flame Oracle',      avatar: '/images/image-packs/characters/ember-gaze.jpg' }
  ];

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function normalizeCard(entry) {
    // API returns either { cardData: {...} } or a flat card object.
    var cd = entry.cardData || entry;
    var name = cd.name || entry.name || '';
    var characterClass = cd.characterClass || entry.characterClass || '';
    var avatar = cd.avatar || entry.avatar || entry.image || '';
    var id = entry.id || cd.id || cd.shareId || '';
    var renderedFront = cd.renderedFront || null;
    var frontClasses = cd.frontClasses || null;
    if (!name && !renderedFront) return null;
    return {
      name: name, characterClass: characterClass, avatar: avatar, id: id,
      renderedFront: renderedFront, frontClasses: frontClasses
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
      // API response shape: { userCards, galleryCards, defaultCards, diagnostics }
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

  function pickRandom(arr, n) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i]; copy[i] = copy[j]; copy[j] = t;
    }
    return copy.slice(0, n);
  }

  function cssUrl(src) {
    return "url('" + String(src).replace(/\\/g, '\\\\').replace(/'/g, "%27") + "')";
  }

  function renderCardContent(c) {
    // Only render API-returned cards with full renderedFront HTML —
    // synthesizing a CardForge-styled card client-side collides with
    // cardforge-card.css's own .card-body / .card-header / .card-stats
    // rules and produces a broken "stacked panels" look. Preset cards
    // (no renderedFront) fall back to the portrait-only mini card,
    // which is only used on initial page load before the API resolves.
    if (c.renderedFront && c.frontClasses) {
      return '<div class="mini-card-scaler"><div class="' + escHtml(c.frontClasses) + '">' + c.renderedFront + '</div></div>';
    }
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

  // Centered fan-position map by card count, so a 4-card fan looks
  // balanced instead of having an empty 5th slot.
  var FAN_POS_BY_COUNT = {
    1: [2],
    2: [1, 3],
    3: [1, 2, 3],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4]
  };

  function renderFan(cards) {
    var fan = document.getElementById('cf-hero-fan');
    if (!fan) return;
    var picks = cards.slice(0, 5);
    var positions = FAN_POS_BY_COUNT[picks.length] || [0, 1, 2, 3, 4];
    fan.innerHTML = picks.map(function (c, i) {
      var pos = positions[i];
      return '<a class="cf-hero-fan__card mini-card" data-fan-pos="' + pos + '" href="/cardforge/gallery.html" data-splash-cta="fan-card" aria-label="' + escHtml(c.name || 'Card') + '">' +
               renderCardContent(c) +
             '</a>';
    }).join('');
  }

  function renderShowcase(cards) {
    var strip = document.getElementById('cf-showcase-strip');
    if (!strip) return;
    var picks = cards.slice(0, 10);
    strip.innerHTML = picks.map(function (c) {
      return '<a class="cf-showcase-card mini-card" href="/cardforge/gallery.html" data-splash-cta="showcase-card" aria-label="' + escHtml(c.name || 'Card') + '">' +
               renderCardContent(c) +
             '</a>';
    }).join('');
  }

  // Cache the gallery so return visitors see cards instantly on page
  // load instead of waiting for the API roundtrip. Cache is overwritten
  // by every successful fetch, so it stays fresh.
  var GALLERY_CACHE_KEY = 'cf_splash_gallery_v1';

  function readGalleryCache() {
    try {
      var raw = localStorage.getItem(GALLERY_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.cards) || !parsed.cards.length) return null;
      return parsed.cards;
    } catch (_) { return null; }
  }

  function writeGalleryCache(cards) {
    try {
      localStorage.setItem(GALLERY_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), cards: cards }));
    } catch (_) {}
  }

  function gallerySignature(cards) {
    return cards.map(function (c) { return c.id || c.name; }).join('|');
  }

  function showFanLoader() {
    var fan = document.getElementById('cf-hero-fan');
    if (!fan || fan.querySelector('.cf-hero-fan__loader')) return;
    var loader = document.createElement('div');
    loader.className = 'cf-hero-fan__loader';
    loader.setAttribute('aria-label', 'Loading gallery');
    fan.appendChild(loader);
  }

  function hideFanLoader() {
    var fan = document.getElementById('cf-hero-fan');
    if (!fan) return;
    var loader = fan.querySelector('.cf-hero-fan__loader');
    if (loader) loader.remove();
  }

  function fadeInRenderedCards() {
    var fan = document.getElementById('cf-hero-fan');
    var strip = document.getElementById('cf-showcase-strip');
    if (fan) fan.classList.add('cf-splash-loaded');
    if (strip) strip.classList.add('cf-splash-loaded');
  }

  function revealAfterPaint() {
    // Double-rAF so the new card DOM is painted BEFORE the opacity
    // transition starts; otherwise the transition state is the same
    // tick as insertion and no animation runs.
    requestAnimationFrame(function () {
      requestAnimationFrame(fadeInRenderedCards);
    });
  }

  function clearLoadedClass() {
    var fan = document.getElementById('cf-hero-fan');
    var strip = document.getElementById('cf-showcase-strip');
    if (fan) fan.classList.remove('cf-splash-loaded');
    if (strip) strip.classList.remove('cf-splash-loaded');
  }

  async function initGallery() {
    // 1) Render from cache instantly — kills the perceived API delay
    //    on every visit after the first. If no cache exists, show a
    //    small ember loader in the fan center so the user knows the
    //    forge is firing up rather than seeing an empty hero.
    var cached = readGalleryCache();
    if (cached && cached.length) {
      renderFan(cached.slice(0, 5));
      renderShowcase(cached.slice(0, 10));
      revealAfterPaint();
    } else {
      showFanLoader();
    }

    // 2) Refresh from the API and re-render only if the response
    //    differs from cache (avoids unnecessary DOM rebuild + flash).
    var cards = await fetchPublishedCards();
    var realCards = cards.filter(function (c) { return c.renderedFront && c.frontClasses; });
    if (realCards.length === 0) {
      hideFanLoader();
      return;
    }

    hideFanLoader();
    var top10 = realCards.slice(0, 10);
    var prevSig = cached ? gallerySignature(cached.slice(0, 10)) : '';
    var nextSig = gallerySignature(top10);
    if (nextSig !== prevSig) {
      // Reset opacity-loaded state so the new render fades in fresh.
      clearLoadedClass();
      renderFan(realCards.slice(0, 5));
      renderShowcase(top10);
      revealAfterPaint();
    }
    writeGalleryCache(top10);
  }

  function init() {
    var card = readMostRecentCard();
    if (card) showContinueBanner(card);

    document.addEventListener('click', trackCTA);
    var continueBtn = document.getElementById('cf-continue-btn');
    if (continueBtn) continueBtn.addEventListener('click', trackContinue);

    initAuth();
    initGallery();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
