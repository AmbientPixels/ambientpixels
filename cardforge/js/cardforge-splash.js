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

  // Static preset fallback — used if the gallery API is empty or fails.
  // Matches 5 curated preset characters already shipped in the image pack.
  var PRESET_FALLBACK = [
    { name: 'Aria Stormwind',    characterClass: 'Fantasy Ranger',    avatar: '/images/image-packs/characters/whispers-of-the-sylvan-queen.jpg' },
    { name: 'Zara-7',            characterClass: 'Cyberpunk Runner',  avatar: '/images/image-packs/characters/cyber-erenity.jpg' },
    { name: 'Dr. Elena Voss',    characterClass: 'Arcane Scholar',    avatar: '/images/image-packs/characters/ethereal-enigma.jpg' },
    { name: 'Commander Rex',     characterClass: 'Space Marine',      avatar: '/images/image-packs/characters/guardian-of-the-gilded-halls.jpg' },
    { name: 'Kenji Nakamura',    characterClass: 'Corporate Ronin',   avatar: '/images/image-packs/characters/the-enigmatic-neuromancer.jpg' },
    { name: 'Captain Nova',      characterClass: 'Legendary Hero',    avatar: '/images/image-packs/characters-03-super-heroes/nova-rivera.png' },
    { name: 'Divine Protector',  characterClass: 'Titan Guardian',    avatar: '/images/image-packs/characters/twilight-titan.jpg' },
    { name: 'Stealth Specialist',characterClass: 'Shadow Operative',  avatar: '/images/image-packs/characters/navigator-kairo.jpg' },
    { name: 'Seraphina',         characterClass: 'Celestial Warden',  avatar: '/images/image-packs/characters/seraphina.jpg' },
    { name: 'Ember Gaze',        characterClass: 'Flame Oracle',      avatar: '/images/image-packs/characters/ember-gaze.jpg' }
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
    if (!name || !avatar) return null;
    return { name: name, characterClass: characterClass, avatar: avatar, id: id };
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
      var list = Array.isArray(data) ? data : (data && Array.isArray(data.cards) ? data.cards : []);
      return list.map(normalizeCard).filter(Boolean);
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
    // Safe single-quoted url() for inline style attributes. Escape any
    // stray single quotes or backslashes in the source URL.
    return "url('" + String(src).replace(/\\/g, '\\\\').replace(/'/g, "%27") + "')";
  }

  function renderFan(cards) {
    var fan = document.getElementById('cf-hero-fan');
    if (!fan) return;
    var picks = cards.slice(0, 5);
    fan.innerHTML = picks.map(function (c, i) {
      return '<a class="cf-hero-fan__card" data-fan-pos="' + i + '" href="/cardforge/gallery.html" data-splash-cta="fan-card">' +
               '<div class="cf-hero-fan__portrait" style="background-image: ' + cssUrl(c.avatar) + ';"></div>' +
               '<div class="cf-hero-fan__label">' +
                 '<span class="cf-hero-fan__name">' + escHtml(c.name) + '</span>' +
                 (c.characterClass ? '<span class="cf-hero-fan__class">' + escHtml(c.characterClass) + '</span>' : '') +
               '</div>' +
             '</a>';
    }).join('');
  }

  function renderShowcase(cards) {
    var strip = document.getElementById('cf-showcase-strip');
    if (!strip) return;
    var picks = cards.slice(0, 10);
    strip.innerHTML = picks.map(function (c) {
      return '<a class="cf-showcase-card" href="/cardforge/gallery.html" data-splash-cta="showcase-card">' +
               '<div class="cf-showcase-card__portrait" style="background-image: ' + cssUrl(c.avatar) + ';"></div>' +
               '<div class="cf-showcase-card__label">' +
                 '<span class="cf-showcase-card__name">' + escHtml(c.name) + '</span>' +
                 (c.characterClass ? '<span class="cf-showcase-card__class">' + escHtml(c.characterClass) + '</span>' : '') +
               '</div>' +
             '</a>';
    }).join('');
  }

  async function initGallery() {
    // Render fallback immediately so the page never looks empty
    renderFan(pickRandom(PRESET_FALLBACK, 5));
    renderShowcase(PRESET_FALLBACK);

    // Upgrade in-place with real published cards (best-effort)
    var cards = await fetchPublishedCards();
    if (cards.length >= 5) {
      renderFan(pickRandom(cards, 5));
      renderShowcase(cards.slice(0, 10));
    } else if (cards.length > 0) {
      // Blend: real cards first, then presets to fill
      var blended = cards.concat(PRESET_FALLBACK).slice(0, 10);
      renderFan(pickRandom(blended, 5));
      renderShowcase(blended);
    }
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
