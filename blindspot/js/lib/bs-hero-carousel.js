/* ============================================================
   bs-hero-carousel.js — splash hero auto-rotating image carousel
   Phase 1: shows last 5 most-recently published gallery cards.
   Falls back to the static knight portrait on any failure.
   ============================================================ */
(function () {
  'use strict';

  var INTERVAL_MS = 5000;
  var SLIDE_COUNT = 5;
  var FETCH_TIMEOUT_MS = 12000;

  // Tracked so the Stranger fight can "borrow" the currently-visible card's
  // avatar — matches the in-game lore (every fighter begins with someone
  // else's card).
  var _slides = [];
  var _activeIdx = 0;

  function galleryUrl() {
    if (typeof window.buildApiPath === 'function') {
      var url = window.buildApiPath('loadCards');
      if (url) return url;
    }
    return 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';
  }

  function init() {
    var stack = document.getElementById('bs-hero-stack');
    if (!stack) return;

    fetchGallerySlides()
      .then(function (slides) {
        if (!slides || slides.length === 0) return;
        _slides = slides;
        _activeIdx = 0;
        renderSlides(stack, slides);
        if (slides.length > 1) startRotation(stack, slides);
      })
      .catch(function () {
        // Stack stays empty — underlying static portrait shows through.
      });
  }

  function fetchGallerySlides() {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, FETCH_TIMEOUT_MS);
    var opts = controller ? { signal: controller.signal } : {};

    return fetch(galleryUrl(), opts)
      .then(function (r) {
        clearTimeout(timer);
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.galleryCards)) return [];
        return data.galleryCards
          .map(extractSlide)
          .filter(function (s) { return s && s.src; })
          .sort(function (a, b) { return b.ts - a.ts; })
          .slice(0, SLIDE_COUNT);
      });
  }

  function extractSlide(card) {
    if (!card) return null;
    // Avatar field has drifted across schemas — try the common locations.
    var src = card.avatar
      || (card.cardData && card.cardData.cardContent
        && card.cardData.cardContent.frontFace
        && card.cardData.cardContent.frontFace.characterImage
        && card.cardData.cardContent.frontFace.characterImage.url)
      || card.image
      || card.imageUrl
      || '';
    var ts = new Date(card.publishedAt || card.createdAt || card.updatedAt || 0).getTime();
    return {
      src: src,
      name: card.name || 'Featured Card',
      ts: isFinite(ts) ? ts : 0
    };
  }

  function renderSlides(stack, slides) {
    stack.innerHTML = '';
    slides.forEach(function (s, i) {
      // Preload — start the image fetch so the rotation crossfades smoothly.
      var preloader = new Image();
      preloader.src = s.src;

      var div = document.createElement('div');
      div.className = 'bs-hero-slide' + (i === 0 ? ' bs-hero-slide--active' : '');
      div.style.backgroundImage = 'url(' + JSON.stringify(s.src) + ')';
      div.setAttribute('data-name', s.name);
      stack.appendChild(div);
    });
    updateTag(slides[0]);
  }

  function startRotation(stack, slides) {
    setInterval(function () {
      _activeIdx = (_activeIdx + 1) % slides.length;
      var nodes = stack.querySelectorAll('.bs-hero-slide');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle('bs-hero-slide--active', i === _activeIdx);
      }
      updateTag(slides[_activeIdx]);
    }, INTERVAL_MS);
  }

  function updateTag(slide) {
    var tag = document.getElementById('bs-hero-tag');
    if (tag && slide && slide.name) {
      tag.textContent = slide.name;
    }
  }

  // Public — let other modules borrow the active hero slide's image. Used by
  // the Stranger fight to give a new player a real published card's face
  // for their first battle ("you fight with someone else's card").
  window.BsHeroCarousel = {
    getActiveSlide: function () {
      if (!_slides || _slides.length === 0) return null;
      return _slides[_activeIdx] || _slides[0] || null;
    },
    getRandomSlide: function () {
      if (!_slides || _slides.length === 0) return null;
      return _slides[Math.floor(Math.random() * _slides.length)];
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
