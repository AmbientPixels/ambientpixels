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

  // Synthetic preset cards — used as padding to complete the fan when
  // the gallery has fewer than 5 real cards, or as fallback when the
  // gallery API is unreachable. Each preset carries CardForge palette +
  // rarity class combinations so the synthesized card HTML picks up
  // full CardForge styling from cardforge-card.css (borders, glow,
  // rarity effects) rather than looking like a portrait thumbnail.
  var PRESET_FALLBACK = [
    { name: 'Aria Stormwind',     characterClass: 'Fantasy Ranger',    rarity: 'Legendary', avatar: '/images/image-packs/characters/whispers-of-the-sylvan-queen.jpg',
      palette: 'earth',     variant: 'dark',  rarityStyle: 'ornate',  stats: [68, 82, 74, 61, 90] },
    { name: 'Zara-7',             characterClass: 'Cyberpunk Runner',  rarity: 'Epic',      avatar: '/images/image-packs/characters/cyber-erenity.jpg',
      palette: 'neon',      variant: 'dark',  rarityStyle: 'ribbon',  stats: [58, 95, 88, 52, 78] },
    { name: 'Dr. Elena Voss',     characterClass: 'Arcane Scholar',    rarity: 'Rare',      avatar: '/images/image-packs/characters/ethereal-enigma.jpg',
      palette: 'frost',     variant: 'light', rarityStyle: 'border',  stats: [42, 64, 96, 70, 81] },
    { name: 'Commander Rex',      characterClass: 'Space Marine',      rarity: 'Legendary', avatar: '/images/image-packs/characters/guardian-of-the-gilded-halls.jpg',
      palette: 'inferno',   variant: 'dark',  rarityStyle: 'thick',   stats: [92, 58, 62, 88, 70] },
    { name: 'Kenji Nakamura',     characterClass: 'Corporate Ronin',   rarity: 'Epic',      avatar: '/images/image-packs/characters/the-enigmatic-neuromancer.jpg',
      palette: 'monochrome',variant: 'dark',  rarityStyle: 'double',  stats: [75, 84, 72, 66, 83] },
    { name: 'Captain Nova',       characterClass: 'Legendary Hero',    rarity: 'Legendary', avatar: '/images/image-packs/characters-03-super-heroes/nova-rivera.png',
      palette: 'fire',      variant: 'dark',  rarityStyle: 'inset',   stats: [89, 72, 80, 76, 92] },
    { name: 'Divine Protector',   characterClass: 'Titan Guardian',    rarity: 'Legendary', avatar: '/images/image-packs/characters/twilight-titan.jpg',
      palette: 'aurora',    variant: 'dark',  rarityStyle: 'ornate',  stats: [96, 48, 70, 92, 74] },
    { name: 'Stealth Specialist', characterClass: 'Shadow Operative',  rarity: 'Rare',      avatar: '/images/image-packs/characters/navigator-kairo.jpg',
      palette: 'shadow',    variant: 'dark',  rarityStyle: 'dashed',  stats: [52, 98, 76, 55, 86] },
    { name: 'Seraphina',          characterClass: 'Celestial Warden',  rarity: 'Legendary', avatar: '/images/image-packs/characters/seraphina.jpg',
      palette: 'aurora',    variant: 'light', rarityStyle: 'ornate',  stats: [70, 78, 90, 82, 88] },
    { name: 'Ember Gaze',         characterClass: 'Flame Oracle',      rarity: 'Epic',      avatar: '/images/image-packs/characters/ember-gaze.jpg',
      palette: 'inferno',   variant: 'dark',  rarityStyle: 'ribbon',  stats: [66, 80, 94, 58, 72] }
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

  function buildSyntheticFront(c) {
    // Mimic the cardforge-card.css structure so the preset renders
    // with real CardForge chrome (border, rarity frame, palette
    // colors, stat bars) instead of a portrait-only thumbnail.
    var STAT_LABELS = ['STR', 'AGI', 'INT', 'END', 'LCK'];
    var palette = c.palette || 'earth';
    var variant = c.variant || 'dark';
    var rarityStyle = c.rarityStyle || 'border';
    var classes = [
      'card-preview-canvas',
      'card-front',
      'align-center',
      'align-vertical-bottom',
      'align-style-bold',
      'palette-' + palette,
      'variant-' + variant,
      'container-fullbleed',
      'container-variant-standard',
      'effect-none',
      'rarity-style-' + rarityStyle,
      'stat-color-ember'
    ].join(' ');
    var stats = c.stats || [70, 70, 70, 70, 70];
    var statsHtml = STAT_LABELS.map(function (label, i) {
      var v = stats[i] != null ? stats[i] : 70;
      return '<div class="stat-item stat-item--combat">' +
               '<div class="stat-bar"><div class="stat-progress" style="width:' + v + '%;"></div></div>' +
               '<span class="stat-name">' + label + '</span>' +
               '<span class="stat-value">' + v + '</span>' +
             '</div>';
    }).join('');

    return '<div class="' + classes + '">' +
             '<div class="card-body">' +
               '<div class="card-portrait" style="background-image: ' + cssUrl(c.avatar) + '; background-size: cover; background-position: center; position: absolute; inset: 0;"></div>' +
               '<div class="card-hud" style="position: relative; z-index: 2;">' +
                 '<div class="card-header">' +
                   '<div class="card-name">' + escHtml(c.name) + '</div>' +
                   '<div class="card-rarity">' + escHtml((c.rarity || 'Rare').toUpperCase()) + '</div>' +
                 '</div>' +
                 '<div class="card-class">' + escHtml(c.characterClass || '') + '</div>' +
                 '<div class="card-stats">' + statsHtml + '</div>' +
               '</div>' +
             '</div>' +
           '</div>';
  }

  function renderCardContent(c) {
    // Full-fidelity API cards use their renderedFront HTML + frontClasses
    // (galleryCards / defaultCards from /api/cardforgeloadcards).
    if (c.renderedFront && c.frontClasses) {
      return '<div class="mini-card-scaler"><div class="' + escHtml(c.frontClasses) + '">' + c.renderedFront + '</div></div>';
    }
    // Preset cards synthesize a CardForge-styled card at runtime so
    // they match the real-card aesthetic — no portrait thumbnails.
    return '<div class="mini-card-scaler">' + buildSyntheticFront(c) + '</div>';
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

  async function initGallery() {
    // 1. Render synthesized preset cards immediately so the hero
    //    isn't empty while the API is in flight. These use the same
    //    buildSyntheticFront() template as the padding below, so the
    //    aesthetic stays consistent when we crossfade to real cards.
    renderFan(PRESET_FALLBACK.slice(0, 5));
    renderShowcase(PRESET_FALLBACK.slice(0, 10));
    revealAfterPaint();

    // 2. Fetch real gallery cards and pad with synthetic presets up
    //    to 5 for the fan / 10 for the showcase — so the fan is
    //    always full, and non-real cards still read as CardForge
    //    cards (not portrait thumbnails).
    var cards = await fetchPublishedCards();
    var realCards = cards.filter(function (c) { return c.renderedFront && c.frontClasses; });
    if (realCards.length === 0) return; // initial presets already look right.

    var fanCards = realCards.slice(0, 5);
    while (fanCards.length < 5 && fanCards.length < 5) {
      fanCards.push(PRESET_FALLBACK[fanCards.length % PRESET_FALLBACK.length]);
    }
    var showcaseCards = realCards.slice(0, 10);
    while (showcaseCards.length < 10) {
      showcaseCards.push(PRESET_FALLBACK[showcaseCards.length % PRESET_FALLBACK.length]);
    }

    var fan = document.getElementById('cf-hero-fan');
    var strip = document.getElementById('cf-showcase-strip');
    if (fan) fan.classList.remove('cf-splash-loaded');
    if (strip) strip.classList.remove('cf-splash-loaded');

    setTimeout(function () {
      renderFan(fanCards);
      renderShowcase(showcaseCards);
      revealAfterPaint();
    }, 240);
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
