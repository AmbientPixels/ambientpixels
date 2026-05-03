/**
 * Blindspot Lobby Gallery — "Hall of Fighters" horizontal carousel
 *
 * Renders a strip of recently-published community cards in the lobby.
 * Auto-scrolls, pauses on hover/focus/touch, opens a preview modal on click.
 *
 * API: window.BsLobbyGallery
 *   .init()         — fetch + render + start auto-scroll (idempotent)
 *   .refresh()      — re-fetch and re-render
 *   .openModal(s)   — open preview modal for a slide
 */
window.BsLobbyGallery = (function () {
  'use strict';

  var ENDPOINT_KEY = 'heroSlim';
  var FETCH_COUNT = 10;
  var MIN_CARDS_TO_SHOW = 3;
  var POINTER_RESUME_MS = 4000;

  var _section = null;
  var _strip = null;
  var _modal = null;
  var _modalCard = null;
  var _modalCreator = null;
  var _modalClose = null;
  var _lastFocus = null;
  var _resumeTimer = null;
  var _initialized = false;
  var _slides = [];
  var _rtf = null; // Lazy Intl.RelativeTimeFormat

  function init() {
    if (_initialized) return;
    _initialized = true;
    _section = document.getElementById('bs-lobby-gallery');
    _strip = document.getElementById('bs-lobby-gallery-strip');
    _modal = document.getElementById('bs-gallery-modal');
    _modalCard = document.getElementById('bs-gallery-modal-card');
    _modalCreator = document.getElementById('bs-gallery-modal-creator');
    _modalClose = _modal && _modal.querySelector('.bs-gallery-modal__close');
    if (!_section || !_strip) return;
    _wireModal();
    _wirePointer();
    fetchAndRender();
  }

  function refresh() { fetchAndRender(); }

  function _renderSkeleton() {
    if (!_strip) return;
    var html = '';
    for (var i = 0; i < 3; i++) {
      html += '<div class="bs-lobby-gallery__tile bs-lobby-gallery__tile--skeleton" aria-hidden="true"></div>';
    }
    _strip.innerHTML = html;
  }

  function fetchAndRender() {
    if (!_strip) return;
    _renderSkeleton();
    _section.hidden = false;
    var url;
    try {
      url = window.buildApiPath
        ? window.buildApiPath(ENDPOINT_KEY, { detail: 'full', count: FETCH_COUNT, surface: 'hall' })
        : '/api/blindspothero?detail=full&count=' + FETCH_COUNT + '&surface=hall';
    } catch (e) { url = '/api/blindspothero?detail=full&count=' + FETCH_COUNT + '&surface=hall'; }
    fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (data) {
        var slides = (data && Array.isArray(data.slides)) ? data.slides.filter(function (s) { return s && s.card; }) : [];
        if (slides.length < MIN_CARDS_TO_SHOW) {
          _section.hidden = true;
          return;
        }
        _slides = slides;
        _renderStrip(slides);
      })
      .catch(function (err) {
        try { console.warn('[BsLobbyGallery] fetch failed:', err.message); } catch (_) {}
        _section.hidden = true;
      });
  }

  function _renderStrip(slides) {
    if (!_strip) return;
    _strip.innerHTML = '';
    // Duplicate the slide list twice — the CSS animation translates the
    // strip from 0 to -50%, so the second half lines up exactly with the
    // first and the loop seam is invisible.
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < slides.length; i++) {
        _strip.appendChild(_renderTile(slides[i], pass === 1));
      }
    }
  }

  function _relativeTime(iso) {
    if (!iso) return 'Recently forged';
    var t = Date.parse(iso);
    if (isNaN(t)) return 'Recently forged';
    var diffSec = Math.round((Date.now() - t) / 1000);
    var future = diffSec < 0;
    var abs = Math.abs(diffSec);
    if (!_rtf && typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) {
      try { _rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); } catch (_) { _rtf = null; }
    }
    // Largest unit first — pick the first where abs >= seconds-per-unit.
    var units = [
      [31536000, 'year'],
      [2592000, 'month'],
      [86400, 'day'],
      [3600, 'hour'],
      [60, 'minute'],
      [1, 'second']
    ];
    var unit = 'second', value = abs;
    for (var i = 0; i < units.length; i++) {
      if (abs >= units[i][0]) {
        unit = units[i][1];
        value = Math.max(1, Math.round(abs / units[i][0]));
        break;
      }
    }
    var label = _rtf ? _rtf.format(future ? value : -value, unit) : (value + ' ' + unit + (value === 1 ? '' : 's') + (future ? ' from now' : ' ago'));
    return 'Forged ' + label;
  }

  function _renderTile(slide, isClone) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bs-lobby-gallery__tile';
    btn.setAttribute('role', 'listitem');
    var ariaName = slide.name || 'Featured Card';
    var ariaLabel = slide.creator
      ? 'View ' + ariaName + ' forged by ' + slide.creator
      : 'View ' + ariaName;
    btn.setAttribute('aria-label', ariaLabel);
    if (isClone) btn.setAttribute('aria-hidden', 'true'); // duplicate half is decorative

    var cardWrap = document.createElement('div');
    cardWrap.className = 'bs-lobby-gallery__card';
    var _CR = window.BsCardRenderer;
    // Force fullbleed in the carousel so cards read as a uniform trading-
    // card strip. Cards published with imageContainer:'masked' would
    // otherwise render as circular avatars and break the row's visual
    // rhythm (mirrors the same override used by renderDeckManagement).
    var carouselCard = slide.card;
    if (carouselCard && carouselCard.imageContainer !== 'fullbleed') {
      carouselCard = Object.assign({}, slide.card, { imageContainer: 'fullbleed' });
      if (carouselCard.design) {
        carouselCard.design = Object.assign({}, carouselCard.design, { imageContainer: 'fullbleed' });
      }
    }
    cardWrap.innerHTML = _CR && _CR.render ? _CR.render(carouselCard, 'compact') : '';
    btn.appendChild(cardWrap);

    if (slide.creator) {
      var byline = document.createElement('div');
      byline.className = 'bs-lobby-gallery__byline';
      byline.textContent = 'by ' + slide.creator;
      btn.appendChild(byline);
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      _lastFocus = btn;
      openModal(slide);
    });

    return btn;
  }
  function openModal(slide) {
    if (!_modal || !_modalCard || !slide || !slide.card) return;
    var _CR = window.BsCardRenderer;
    _modalCard.innerHTML = _CR && _CR.render ? _CR.render(slide.card, 'full') : '';
    var when = _relativeTime(slide.createdAt);
    if (slide.creator) {
      _modalCreator.innerHTML = when + ' by <strong></strong>';
      _modalCreator.querySelector('strong').textContent = slide.creator;
    } else {
      _modalCreator.textContent = when;
    }
    _modal.classList.remove('bs-overlay--hidden');
    if (_modalClose && _modalClose.focus) _modalClose.focus();
  }
  function _closeModal() {
    if (!_modal) return;
    _modal.classList.add('bs-overlay--hidden');
    if (_modalCard) _modalCard.innerHTML = '';
    if (_lastFocus && _lastFocus.focus) {
      try { _lastFocus.focus(); } catch (_) {}
    }
    _lastFocus = null;
  }
  function _wireModal() {
    if (!_modal) return;
    if (_modalClose) {
      _modalClose.addEventListener('click', _closeModal);
    }
    _modal.addEventListener('click', function (e) {
      if (e.target === _modal) _closeModal(); // backdrop click only
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !_modal.classList.contains('bs-overlay--hidden')) {
        _closeModal();
      }
    });
  }
  function _wirePointer() {
    var viewport = _section ? _section.querySelector('.bs-lobby-gallery__viewport') : null;
    if (!viewport || !_strip) return;

    function pause() {
      _strip.setAttribute('data-paused', 'true');
      if (_resumeTimer) { clearTimeout(_resumeTimer); _resumeTimer = null; }
    }
    function scheduleResume() {
      if (_resumeTimer) clearTimeout(_resumeTimer);
      _resumeTimer = setTimeout(function () {
        _strip.removeAttribute('data-paused');
        _resumeTimer = null;
      }, POINTER_RESUME_MS);
    }

    viewport.addEventListener('pointerdown', pause);
    viewport.addEventListener('pointerup', scheduleResume);
    viewport.addEventListener('pointercancel', scheduleResume);
    viewport.addEventListener('pointerleave', scheduleResume);
  }

  return { init: init, refresh: refresh, openModal: openModal };
})();
