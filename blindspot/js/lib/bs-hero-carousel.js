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
  var _rotationTimer = null;
  var _rolling = false;
  var _lastRolled = null; // last slide the slot machine landed on (real or fallback)
  var _rollHappened = false; // once a roll has landed, ambient rotation stays off

  // Fallback slot-machine deck used when the gallery API is slow or empty
  // (cardforgeloadcards is currently very heavy — see slim-endpoint TODO).
  // Lets the click-to-roll feel instant; once real slides load they take
  // over for ambient rotation.
  var DEMO_FALLBACK_SLIDES = [
    { src: '/blindspot/img/fighters/knight.webp',  name: 'The Stranger', ts: 0 },
    { src: '/blindspot/img/demo/demo-knight.webp', name: 'The Stranger', ts: 0 },
    { src: '/blindspot/img/demo/demo-mage.webp',   name: 'The Stranger', ts: 0 },
    { src: '/blindspot/img/demo/demo-rogue.webp',  name: 'The Stranger', ts: 0 }
  ];

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
        // If a roll already happened (gallery resolved late), don't reset
        // the active index or restart rotation — the player has committed
        // to a chosen card and that visual should stay sticky.
        if (!_rollHappened) {
          _activeIdx = 0;
          renderSlides(stack, slides);
          if (slides.length > 1) startRotation(stack, slides);
        }
        try {
          document.dispatchEvent(new CustomEvent('bs-hero-ready', { detail: { slideCount: slides.length } }));
        } catch (e) { /* CustomEvent unsupported — silent skip */ }
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
    if (_rotationTimer) clearInterval(_rotationTimer);
    _rotationTimer = setInterval(function () {
      if (_rolling) return; // pause the ambient rotation while a roll is playing
      _activeIdx = (_activeIdx + 1) % slides.length;
      setActiveSlide(stack, _activeIdx);
    }, INTERVAL_MS);
  }

  function setActiveSlide(stack, idx) {
    var nodes = stack.querySelectorAll('.bs-hero-slide');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('bs-hero-slide--active', i === idx);
    }
    if (_slides[idx]) updateTag(_slides[idx]);
  }

  // Slot-machine roll — overlays the hero stack with a horizontal reel
  // (mirrors the loot-crate ceremony idiom in bs-crates.js). The strip
  // slides left, decelerates with cubic-bezier easing, and lands the
  // chosen tile centered under a gold pointer line. Replaces the
  // earlier crossfade roll for a more recognisable "rolling for an
  // outcome" feel.
  function startRoll(callback) {
    var stack = document.getElementById('bs-hero-stack');
    if (!stack) {
      if (callback) callback(null);
      return;
    }

    // If real gallery slides aren't loaded yet (API is slow), play the
    // slot machine on demo fallback art so the click feels instant.
    var usingFallback = !_slides || _slides.length === 0;
    var slides = usingFallback ? DEMO_FALLBACK_SLIDES : _slides;

    if (slides.length === 1) {
      _lastRolled = slides[0];
      if (callback) callback(slides[0]);
      return;
    }

    var prefersReducedMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Hard-avoid the previous landing — guarantees a different card on
    // every reroll so the dice always visibly moves. Falls back to full
    // random if the prior pick isn't in the current pool (e.g. real
    // slides arrived mid-session after a fallback roll).
    var picked;
    if (_lastRolled && slides.length > 1) {
      var pool = [];
      for (var p = 0; p < slides.length; p++) {
        if (slides[p].src !== _lastRolled.src) pool.push(p);
      }
      picked = pool.length > 0
        ? pool[Math.floor(Math.random() * pool.length)]
        : Math.floor(Math.random() * slides.length);
    } else {
      picked = Math.floor(Math.random() * slides.length);
    }
    _lastRolled = slides[picked];

    if (prefersReducedMotion) {
      _rollHappened = true;
      if (_rotationTimer) {
        clearInterval(_rotationTimer);
        _rotationTimer = null;
      }
      showRolledSlide(stack, slides[picked]);
      if (callback) callback(slides[picked]);
      return;
    }

    _rolling = true;

    // Each tile = full stage width so a complete portrait fills the window
    // as it slides past. The strip is N stage-widths long; the winner sits
    // a few from the end so the deceleration has visible context.
    var TILE_COUNT = 18;
    var WINNER_IDX = 14;
    var stageWidth = stack.offsetWidth || stack.clientWidth || 400;

    var tiles = [];
    for (var i = 0; i < TILE_COUNT; i++) {
      var slideIdx = (i === WINNER_IDX) ? picked : Math.floor(Math.random() * slides.length);
      tiles.push(slides[slideIdx]);
    }

    var reel = document.createElement('div');
    reel.className = 'bs-hero-reel';
    var stripEl = document.createElement('div');
    stripEl.className = 'bs-hero-reel__strip';
    for (var t = 0; t < tiles.length; t++) {
      // Build via DOM API — mixing inline style with JSON.stringify(url) in
      // an innerHTML string blew up because the URL's quotes prematurely
      // closed the style attribute, leaving every tile with url("").
      var tileEl = document.createElement('div');
      tileEl.className = 'bs-hero-reel__tile';
      tileEl.style.flex = '0 0 ' + stageWidth + 'px';
      tileEl.style.backgroundImage = 'url(' + JSON.stringify(tiles[t].src) + ')';
      stripEl.appendChild(tileEl);
    }
    reel.appendChild(stripEl);
    stack.appendChild(reel);

    // Force layout so the initial transform: translateX(0) commits before
    // we set the target — without this the transition can be skipped.
    void reel.offsetWidth;

    // Winner tile sits at the left edge of the visible window (tiles fill
    // the window exactly), so we just translate left by winner * stageWidth.
    var targetX = -(WINNER_IDX * stageWidth);

    stripEl.style.transition = 'transform 2.8s cubic-bezier(0.12, 0.65, 0.05, 1)';
    stripEl.style.transform = 'translateX(' + targetX + 'px)';

    // Reuse the loot-crate ratchet — its 12 decelerating ticks (~1.9s)
    // line up nicely with the strip's ease-out, so the audio sells the
    // visual deceleration. Same idiom as bs-crates.js, by design.
    if (window.BsSfx && window.BsSfx.play) {
      try { window.BsSfx.play('crateRatchet'); } catch (e) { /* audio init may need a user gesture; click counts */ }
    }

    setTimeout(function () {
      // Highlight the winner tile mid-frame + cymbal-crash reveal SFX
      var winnerTile = stripEl.children[WINNER_IDX];
      if (winnerTile) winnerTile.classList.add('bs-hero-reel__tile--winner');
      if (window.BsSfx && window.BsSfx.play) {
        try { window.BsSfx.play('crateReveal'); } catch (e) { /* silent */ }
      }

      setTimeout(function () {
        // Player has landed on their card — stop ambient rotation so the
        // chosen face stays put instead of cycling past on the next tick.
        _rollHappened = true;
        if (_rotationTimer) {
          clearInterval(_rotationTimer);
          _rotationTimer = null;
        }
        // Place the chosen face into the stack as a sticky slide. Behind
        // the reel via DOM order, so when the reel fades out the chosen
        // slide is what's revealed (not the static knight underneath).
        showRolledSlide(stack, slides[picked]);
        reel.classList.add('bs-hero-reel--fade');
        setTimeout(function () {
          if (reel.parentNode) reel.parentNode.removeChild(reel);
          _rolling = false;
          if (callback) callback(slides[picked]);
        }, 600);
      }, 600);
    }, 2900);
  }

  function flashLanding(stack, idx) {
    var nodes = stack.querySelectorAll('.bs-hero-slide');
    var node = nodes[idx];
    if (!node) return;
    node.classList.add('bs-hero-slide--landed');
    setTimeout(function () {
      if (node) node.classList.remove('bs-hero-slide--landed');
    }, 1400);
  }

  // After a roll lands, replace whatever's in the hero stack with a single
  // sticky slide showing the chosen face. Works for both real gallery
  // slides and the demo fallback deck — the chosen image sits in the
  // stack so when the reel fades out, the static knight underneath
  // doesn't show through.
  function showRolledSlide(stack, slide) {
    if (!stack || !slide || !slide.src) return;
    var existing = stack.querySelectorAll('.bs-hero-slide');
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].parentNode) existing[i].parentNode.removeChild(existing[i]);
    }
    var chosen = document.createElement('div');
    chosen.className = 'bs-hero-slide bs-hero-slide--active';
    chosen.style.backgroundImage = 'url(' + JSON.stringify(slide.src) + ')';
    // Insert before the reel so the chosen slide is behind it during fade-out.
    var reel = stack.querySelector('.bs-hero-reel');
    if (reel) stack.insertBefore(chosen, reel);
    else stack.appendChild(chosen);
    // Landing flash on the chosen slide
    setTimeout(function () {
      chosen.classList.add('bs-hero-slide--landed');
      setTimeout(function () { chosen.classList.remove('bs-hero-slide--landed'); }, 1400);
    }, 50);
    if (slide.name) updateTag(slide);
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
      // Last rolled slide (real or fallback) wins — that's the face the
      // player just watched land, which is what the Stranger fight should
      // borrow regardless of whether real gallery slides loaded.
      if (_lastRolled) return _lastRolled;
      if (!_slides || _slides.length === 0) return null;
      return _slides[_activeIdx] || _slides[0] || null;
    },
    getRandomSlide: function () {
      var pool = (_slides && _slides.length > 0) ? _slides : DEMO_FALLBACK_SLIDES;
      return pool[Math.floor(Math.random() * pool.length)];
    },
    // Slot machine can always run now — falls back to demo art if API is slow.
    hasSlides: function () { return true; },
    startRoll: startRoll
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
