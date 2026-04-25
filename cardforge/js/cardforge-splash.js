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
    var userWrap = document.getElementById('cf-user-wrap');
    var avatarBtn = document.getElementById('cf-user-avatar');
    var menu = document.getElementById('cf-user-menu');
    if (!loginBtn || !userWrap) return;

    try {
      var res = await fetch('/.auth/me', { credentials: 'include' });
      if (!res.ok) throw new Error('auth fetch failed: ' + res.status);
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
      window.location.href = '/.auth/login/aadB2C?post_login_redirect_uri=/cardforge/';
    });

    // Avatar click → toggle popover. Document click outside → close.
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

  // ---- Gallery fetch + render ----------------------------------------

  var API_LOAD_CARDS = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';
  // Direct Function App URL — SWA's /api/* rewrite to the external Function
  // App is not actually proxying (returns the home page HTML for unknown
  // routes via navigationFallback). All other CardForge modules use the
  // direct URL for the same reason. Keep this in sync with the admin's
  // heroConfigUrl() in cardforge-admin-hero.js.
  var API_HERO_CONFIG = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeheroconfig';
  var DEFAULT_HERO_CONFIG = { mode: 'recent', curatedIds: [], updatedAt: null, updatedBy: null };

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

  async function fetchHeroConfig() {
    try {
      var res = await fetch(API_HERO_CONFIG, { credentials: 'omit' });
      if (!res.ok) return Object.assign({}, DEFAULT_HERO_CONFIG);
      var data = await res.json();
      if (!data || typeof data !== 'object') return Object.assign({}, DEFAULT_HERO_CONFIG);
      return {
        mode: (data.mode === 'random' || data.mode === 'curated') ? data.mode : 'recent',
        curatedIds: Array.isArray(data.curatedIds) ? data.curatedIds : [],
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
      };
    } catch (_) {
      return Object.assign({}, DEFAULT_HERO_CONFIG);
    }
  }

  function timeOf(card) {
    if (!card) return 0;
    var cd = card.cardData || {};
    // Real published cards carry publishDate/lastModified at the TOP level
    // as ISO strings (e.g. "2026-04-25T06:11:56.723Z"). Date.parse handles
    // those; Number() does not. Numeric epochs in cardData also work.
    var candidates = [
      card.publishDate, card.lastModified, card.createdAt, card.updatedAt, card.savedAt, card.timestamp,
      cd.publishDate, cd.lastModified, cd.createdAt, cd.updatedAt, cd.savedAt, cd.timestamp
    ];
    for (var i = 0; i < candidates.length; i++) {
      var v = candidates[i];
      if (v == null) continue;
      var t = (typeof v === 'number') ? v : Date.parse(v);
      if (!isNaN(t) && t > 0) return t;
    }
    return 0;
  }

  function applyHeroMode(cards, config) {
    var mode = (config && config.mode) || 'recent';
    if (mode === 'random') {
      return pickRandom(cards, 5);
    }
    var recentSorted = cards.slice().sort(function (a, b) { return timeOf(b) - timeOf(a); });
    if (mode === 'curated') {
      var ids = (config && Array.isArray(config.curatedIds)) ? config.curatedIds : [];
      var byId = {};
      cards.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
      var picked = [];
      var seen = {};
      ids.forEach(function (id) {
        if (byId[id] && !seen[id]) { picked.push(byId[id]); seen[id] = true; }
      });
      // Pad from recent sort to fill up to 5, skipping already-picked.
      for (var i = 0; i < recentSorted.length && picked.length < 5; i++) {
        var c = recentSorted[i];
        if (c && c.id && !seen[c.id]) { picked.push(c); seen[c.id] = true; }
      }
      return picked.slice(0, 5);
    }
    // recent (default)
    return recentSorted.slice(0, 5);
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
  var HERO_CONFIG_CACHE_KEY = 'cf_splash_hero_config_v1';

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

  function readHeroConfigCache() {
    try {
      var raw = localStorage.getItem(HERO_CONFIG_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.config) return null;
      return parsed.config;
    } catch (_) { return null; }
  }

  function writeHeroConfigCache(config) {
    try {
      localStorage.setItem(HERO_CONFIG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), config: config }));
    } catch (_) {}
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
    var cachedCards = readGalleryCache();
    var cachedConfig = readHeroConfigCache() || Object.assign({}, DEFAULT_HERO_CONFIG);
    if (cachedCards && cachedCards.length) {
      renderFan(applyHeroMode(cachedCards, cachedConfig));
      renderShowcase(cachedCards.slice(0, 10));
      revealAfterPaint();
    } else {
      showFanLoader();
    }

    // 2) Refresh cards + hero config in parallel — both are independent.
    var results = await Promise.all([fetchPublishedCards(), fetchHeroConfig()]);
    var cards = results[0];
    var config = results[1];
    var realCards = cards.filter(function (c) { return c.renderedFront && c.frontClasses; });
    if (realCards.length === 0) {
      hideFanLoader();
      return;
    }

    hideFanLoader();
    // Sort by createdAt desc so the "Recently forged" showcase actually
    // reflects recency, not API response order. Hero fan handles its own
    // sort inside applyHeroMode (recent/random/curated).
    var top10 = realCards.slice().sort(function (a, b) { return timeOf(b) - timeOf(a); }).slice(0, 10);
    var fanPicks = applyHeroMode(realCards, config);
    var prevSig = cachedCards ? gallerySignature(cachedCards.slice(0, 10)) : '';
    var nextSig = gallerySignature(top10);
    var prevConfigStamp = cachedConfig ? (cachedConfig.updatedAt || '') + '|' + (cachedConfig.mode || '') : '';
    var nextConfigStamp = (config.updatedAt || '') + '|' + (config.mode || '');
    if (nextSig !== prevSig || nextConfigStamp !== prevConfigStamp) {
      // Reset opacity-loaded state so the new render fades in fresh.
      clearLoadedClass();
      renderFan(fanPicks);
      renderShowcase(top10);
      revealAfterPaint();
    }
    writeGalleryCache(top10);
    writeHeroConfigCache(config);
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
